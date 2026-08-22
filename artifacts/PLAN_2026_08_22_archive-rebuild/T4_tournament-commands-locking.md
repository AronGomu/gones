# T4: Tournament command endpoints with derived locking

> ## ⚠ ARBITRATION OVERRIDE — read before the body; these win over anything below
>
> **A. Endpoint operation names must be noun-first, or the app will not start.**
> This ticket's body proposes `.WithName("ApplyArchiveTournamentEditBatch")`. **That name is already
> taken** by the legacy route at `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:33`, and
> two endpoints sharing a `WithName` throws at startup. The legacy file survives until T19, so the
> collision is real for fifteen tickets.
>
> **Binding rule for every new `/api/archive/**` endpoint, read and write:** the operation name is
> **noun-first**, `Archive{Tier}{Verb}`. Collision-free by construction against every legacy
> `{Verb}Archive{Noun}` name. Examples, binding:
>
> ```
> ArchiveTournamentCreate         ArchiveTournamentEdit          ArchiveTournamentDelete
> ArchiveTournamentMoveToSeason   ArchiveTournamentApplyEditBatch ArchiveTournamentRenamePlayer
> ArchiveTournamentAddRound       ArchiveTournamentDeleteRound   ArchiveTournamentImportRound
> ArchiveTournamentReplaceRound   ArchiveTournamentAddEntry      ArchiveTournamentEditEntry
> ArchiveTournamentDeleteEntry    ArchiveTournamentUpdateArchetype
> ArchiveRestore                  ArchiveRestoreFull
> ```
>
> Where the body says `ApplyArchiveTournamentEditBatch`, read `ArchiveTournamentApplyEditBatch`.
> The same rule binds T3, T5, T6, T7 and T8 for their own routes.
>
> **B. Wire error codes are snake_case** per arbitration R3, so the `409` code is
> `archive_tournament_locked`, not `archiveTournamentLocked`. The `Commit outcome` line below and the
> body's error table predate that ruling. HTTP statuses are unchanged.
>
> **C. `DocumentVersion` is `int`, not `long`** — all six occurrences. Archive rows deliberately do
> not derive `VersionedEntity` (that base forces a `Guid` PK and a `long Version`); the binding DDL is
> `document_id text PRIMARY KEY` with `version integer`. **This reinforces the decision the body
> already made correctly:** because `GonesDbContext.IncrementVersions` only auto-bumps
> `VersionedEntity`, the Season counter rewrite must increment nothing implicitly, which is exactly
> why the body writes those counters with raw parameterized SQL and loads Seasons `AsNoTracking()`.
> Keep that. It is what makes per-Tournament concurrency true.
>
> **D. The three entity classes are `Archive`-prefixed** — `ArchiveLeague`, `ArchiveLeagueSeason`,
> `ArchiveTournament` in `Gones.Domain.Archive`, documents `ArchiveLeagueDocument`,
> `ArchiveLeagueSeasonDocument`, `ArchiveTournamentDocument`. The body already uses the prefixed
> document names; the entity names follow the same rule.
>
> **E. `TournamentDate` on the wire is a `string`** (ISO, via `LocalDatePattern.Iso.Format`), never a
> `LocalDate` — a `LocalDate` DTO member surfaces as an opaque interface in the generated client at
> `src/app/api/generated/gones-api.ts:10826`. Parse to `LocalDate` at the boundary for
> `ArchiveLockRule.IsLocked`.

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T3
**Commit outcome:** Standalone and attached Tournaments are writable over HTTP, and a Tournament older than 365 days refuses non-Admin writes with `409 archiveTournamentLocked`.

## Context (self-contained)

- Goal: the Archive is being rebuilt on three tiers — **League → LeagueSeason → Tournament**. A Tournament becomes a first-class top-level record that may stand alone (`seasonId: null`). Today's flat `League` becomes `LeagueSeason`; a new `League` tier groups Seasons. `leagues-archive` → `archive` everywhere.
- This slice: the **write half of the Tournament tier**. Every `/api/archive/tournaments/**` command route, plus `POST /api/archive/restore` and `POST /api/archive/restore-full`. It ports the legacy commands in `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:29-45` (rounds, entries, archetypes, edit-batch, move, rename player, restore, restore-full) onto the new per-Tournament row, adds the derived 365-day lock, and keeps the owning Season's denormalized counters correct.
- Out of scope here — do **not** touch:
  - **No read endpoints.** `GET /api/archive/tournaments/**`, `/api/archive/years`, `/api/archive/league-seasons/{id}/tournaments`, `/api/archive/leagues/all` and the whole `/api/archive/global-player-statistics` surface belong to other tickets. Integration tests in this ticket assert stored state through `GonesDbContext`, never through a GET.
  - **No frontend.** No file under `src/app/**` is hand-edited. The one exception is the *generated* client `src/app/api/generated/gones-api.ts` plus the OpenAPI snapshot `backend/openapi/gones.json`, both refreshed by `npm run api:generate` — mandatory, because `npm run api:check` fails on drift.
  - **No `player_statistics` work.** Do **not** call `PlayerStatisticsRebuildService.RebuildAsync` from any code path added here, do not touch `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModel.cs`, and do not add a `scope_kind`/`scope_id` column. A later ticket re-keys that table by scope and wires the rebuild into the new archive write transaction.
  - **Do not delete `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs`**, nor `LeagueArchiveAggregate.cs`, nor any other legacy file. The old `/api/leagues-archive/**` surface keeps serving; it is retired in the last ticket of the plan, when nothing calls it.
  - No `/api/archive/leagues/**` and no `/api/archive/league-seasons/**` command routes — the predecessor ticket owns those.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** Local data may be reset freely (`npm run db:reset`). This is why there is no data migration and no route alias.
  - **Expand → migrate → contract.** This ticket *adds* routes beside the existing ones. Every commit must compile and the app must run.
  - The archive is **empty** at this point in the plan and the legacy pages render an empty list. That is expected, not a bug to fix.
  - The predecessor ticket has already created the three tables (`archive_leagues`, `archive_league_seasons`, `archive_tournaments`), the three aggregates, the derived lock rule and the `RebuildArchiveThreeTier` migration, and has shipped the League/Season command endpoints. **This ticket adds no EF migration.** If you find yourself scaffolding one, you have drifted out of scope.
  - **Codebase reality overrides the wire-error table of the plan brief.** The brief's §4.1 lists `412 staleArchiveDocument`, `404 notFound`, `400 invalidRequest`, `403 forbidden`. The server already emits, from `backend/src/Gones.Api/Errors/ApiExceptions.cs`, the codes `stale_version` (412), `not_found` (404), `validation_failed` (400) and `forbidden` (403, from the authorization policy). Those existing codes stay. The frontend classifier keys on **HTTP status first**, so status parity is what matters; `staleArchiveDocument` is the *browser-local* mirror's `Error.message`, not a server code. The one genuinely new code is `archiveTournamentLocked` at `409`, and it is emitted verbatim.

## Requirements

1. Every command route listed in "Interface contract → Produces → Routes" exists, is mapped under the `AuthorizationPolicies.Organizer` policy group, and answers with the documented status codes.
2. A Tournament with `seasonId: null` is creatable, editable and deletable through exactly the same routes as an attached one.
3. `PATCH /api/archive/tournaments/{tournamentId}/season` with body `{"seasonId": "<id>"}` moves the Tournament, and with body `{"seasonId": null}` detaches it to standalone. It is the only move operation.
4. Every write path enforces the derived lock: a caller who is **not** in the `Admin` role, writing a Tournament whose `tournamentDate` is more than 365 whole UTC days before today, is refused with `409` and `code: "archiveTournamentLocked"`. A Tournament dated exactly 365 days ago is **not** locked; 366 days ago **is**.
5. The Admin role bypasses the lock on every one of those paths.
6. Any Tournament write recomputes the owning Season's denormalized counters (`tournament_count`, `player_count`, `first_tournament_date`, `last_tournament_date`, `counts_version`) inside the **same transaction**. A move recomputes **both** the old and the new Season.
7. Concurrency is **per-Tournament**: every existing-row write requires a matching `If-Match` and bumps only `archive_tournaments.version`. Recomputing a Season's counters must **not** bump `archive_league_seasons.version` and must **not** move its `updated_at`. Neither may a Tournament write touch `archive_leagues`.
8. Round, entry, archetype, player-rename and edit-batch semantics are the **existing** ones: they reuse the pure functions in `backend/src/Gones.Domain/Leagues/LeagueCommands.cs` rather than reimplementing normalization, archetype merging or Swiss-standings-derived counts.
9. The staged-edit contract of ADR 0037 is preserved: `POST /api/archive/tournaments/{tournamentId}/edit-batch` takes one fixed explicit intent batch, `If-Match` is mandatory, an empty batch is refused, a validation or concurrency failure writes nothing, and one successful batch produces exactly **one** version bump.
10. `POST /api/archive/restore` (Organizer) and `POST /api/archive/restore-full` (Admin) accept a v5 archive bundle, remap every id, rewire the tier links to the new ids, and are idempotent on `Idempotency-Key`.
11. Integration tests cover the lock boundary at exactly 365 and exactly 366 days, on both the create path and an existing-row path, for both a non-Admin and an Admin.
12. `npm run backend:build`, `npm run backend:test`, `npm run typecheck` and `npm run api:check` are green.

## Inputs

Read these before writing code.

- `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs` — the file being ported.
  - `:25-45` the organizer route group and every route to port.
  - `:57-70` the `Idempotency-Key` create shape and the `Results.Created($"…/{id}", response)` + `httpResponse.Headers.ETag` pattern.
  - `:139-160` server-side id minting for rounds and entries (`NewId()`; the client id is discarded on add, forced to the route id on edit).
  - `:253-283` `MutateAsync`: load → `RequireVersion` → apply → audit → save, and the `ArgumentException → 400`, `KeyNotFoundException → 404`, `InvalidOperationException → 409` mapping.
  - `:361-401` `ExecuteIdempotentAsync`: `pg_advisory_xact_lock` on `(scope, key)`, stored response, request-hash mismatch → `IdempotencyConflictException`.
  - `:315-355` `ApplyTournamentEditBatchAsync`: `SELECT … FOR UPDATE` in deterministic id order before any transform.
  - `:432-452` `SaveAsync` and its `DbUpdateConcurrencyException → ConcurrencyConflictException` mapping.
  - `:466-476` `AddAudit`, whose `RedactedDiff` is `{"fields":[…]}` and never carries names or documents.
- `backend/src/Gones.Domain/Leagues/LeagueCommands.cs` — the pure functions to reuse: `AddTournament`, `EditTournament`, `AddRound`, `DeleteRound`, `ReplaceRound`, `AddEntry`, `EditEntry`, `DeleteEntry`, `UpdateArchetype`, `RenamePlayer`, `ApplyTournamentEditBatch`, `Restore`. Note `RequireActive(league)` at `:266-269` gates on the **carrier League's** status.
- `backend/src/Gones.Domain/Leagues/LeagueCommands.cs:328-340` — the intent records reused verbatim: `EditArchiveTournamentIntent`, `AddArchiveRoundIntent`, `ReplaceArchiveRoundIntent`, `UpdateArchiveArchetypeIntent`, `ArchiveTournamentEditBatch`.
- `backend/src/Gones.Domain/Leagues/LeagueDocuments.cs:22-56` — `RoundDocument`, `PlayerArchetypeDocument`, and the polymorphic `RoundEntry` / `MatchRoundEntry` / `ByeRoundEntry` / `InvalidRoundEntry` (`kind` discriminator).
- `backend/src/Gones.Domain/Leagues/LeagueCatalogCounts.cs` — the counter idiom being mirrored: `Version` is the per-row formula stamp, `From(document)` returns `(document.Tournaments.Count, LeagueRules.CalculateLeagueResult(document).Rows.Count)`.
- `backend/src/Gones.Domain/Leagues/LeagueRules.cs:107` — `public static LeagueResult CalculateLeagueResult(LeagueDocument league)`.
- `backend/src/Gones.Domain/Leagues/RoundCsvAdapter.cs` — `RoundCsvAdapter.Import(text, idFactory)` returns `.Entries`.
- `backend/src/Gones.Api/Errors/ApiExceptions.cs` — `ApiValidationException`, `ResourceNotFoundException`, `ResourceConflictException(string code = "conflict")`, `ConcurrencyConflictException`, `IdempotencyConflictException`.
- `backend/src/Gones.Api/Errors/ApiExceptionHandler.cs:14-25` — every `ApiException` becomes `application/problem+json` with `code`, `message`, `traceId`.
- `backend/src/Gones.Api/Security/AuthorizationPolicies.cs:11-13` — `AuthorizationPolicies.Organizer = "global-organizer"` (`RequireRole("Organizer","Admin")`) and `AuthorizationPolicies.Admin = "admin"` (`RequireRole("Admin")`).
- `backend/src/Gones.Api/Organizations/OrganizationService.cs:418-431` — `OrganizationPrincipal.UserId(principal)` and **`OrganizationPrincipal.IsAdmin(principal)`**. `IsAdmin` is the existing Admin capability check; use it. Do not invent a new one and do not add a new policy.
- `backend/src/Gones.Domain/Identity/GlobalRoles.cs:3-7` — `GlobalRoles.Admin = "Admin"`.
- `backend/src/Gones.Application/Concurrency/StrongETag.cs` — `Encode(long)` / `TryDecode(string?, out long)`.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs:66-99` — `SaveChangesAsync` auto-increments `Version` on every **tracked, Modified** `VersionedEntity`. This is exactly why the Season counters are written with raw SQL: a tracked Season edit would bump its `version`, which requirement 7 forbids.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContextOptions.cs:8-12` — `UseNpgsql(…, npgsql => npgsql.UseNodaTime())`, so NodaTime `LocalDate` maps to a Postgres `date`.
- `backend/src/Gones.Api/Program.cs:48-54` — app-wide JSON: `ConfigureForNodaTime(DateTimeZoneProviders.Tzdb)`, so an `Instant` serializes ISO and a `LocalDate` serializes `"YYYY-MM-DD"`.
- `backend/src/Gones.Api/Program.cs:120` (`builder.Services.AddScoped<LeagueCommandService>();`) and `backend/src/Gones.Api/Program.cs:240` (`app.MapLeagueCommandEndpoints();`) — the two registration sites.
- `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs:130` — `var today = clock.GetCurrentInstant().InUtc().Date;` is the repo's way of getting a `LocalDate` "today".
- `docs/adr/0037-power-user-staged-archive-edits.md` — the staged-edit contract summarized in requirement 9.
- `backend/tests/Gones.IntegrationTests/LeagueCommandApiTests.cs` — the integration harness to copy: `PostgreSqlTestContainer`, `database.Database.MigrateAsync()`, an `ApplicationUser` row for the audit actor FK, `WebApplicationFactory<Program>` with `UseEnvironment("Testing")` + `GONES_DB_CONNECTION` / `GONES_ALLOWED_ORIGINS` / `GONES_AUTH_SIGNING_KEY` / `GONES_PUBLIC_APP_ORIGIN`, and the `X-Test-User` / `X-Test-Roles` headers honoured by `NoIdentityAuthenticationHandler` (`backend/src/Gones.Api/Security/AuthorizationPolicies.cs:129-146`).
- `backend/tests/Gones.UnitTests/LeagueCommandsTests.cs` — the unit-test shape for pure command functions.

### From Depends (T3 — League and LeagueSeason command endpoints)

T3 is already merged when you start, so these symbols exist on disk. **Verify each one with the grep in Impl step 1 before writing against it**; where the real name differs from the expectation below, use the real one and change nothing in T3's files.

- Tables, columns and aggregates for the three tiers, created by the predecessor of T3 and used here:
  - `archive_leagues(document_id, name, created_at, updated_at, version, deleted_at)`
  - `archive_league_seasons(document_id, league_id, name, status, updated_at, version, deleted_at, tournament_count, player_count, first_tournament_date, last_tournament_date, counts_version)`
  - `archive_tournaments(document_id, season_id, name, tournament_date, status, document, updated_at, version, deleted_at, player_count, counts_version)`
- Expected C# aggregates in namespace `Gones.Domain.Archive`, all deriving `Gones.Domain.Persistence.VersionedEntity`:

```csharp
public sealed class ArchiveTournamentAggregate : VersionedEntity
{
    public required string DocumentId { get; init; }
    public string? SeasonId { get; private set; }
    public string Name { get; private set; }
    public LocalDate TournamentDate { get; private set; }
    public string Status { get; private set; }
    public Instant UpdatedAt { get; private set; }
    public Instant? DeletedAt { get; private set; }
    public string Document { get; private set; }        // jsonb: rounds + playerArchetypes
    public int PlayerCount { get; private set; }
    public int CountsVersion { get; private set; }

    public static ArchiveTournamentAggregate Create(ArchiveTournamentDocument document, Instant now);
    public ArchiveTournamentDocument ReadDocument();
    public void Apply(ArchiveTournamentDocument document, Instant now);   // reprojects SeasonId/Name/TournamentDate/Status
    public void SoftDelete(Instant now);
}

public sealed class ArchiveLeagueSeasonAggregate : VersionedEntity { public required string DocumentId { get; init; } /* … */ }
public sealed class ArchiveLeagueAggregate : VersionedEntity { public required string DocumentId { get; init; } /* … */ }
```

- Expected document records in namespace `Gones.Domain.Archive`:

```csharp
public sealed record ArchiveLeagueDocument(string Id, string Name);
public sealed record ArchiveLeagueSeasonDocument(string Id, string LeagueId, string Name, string Status);
public sealed record ArchiveTournamentDocument(
    string Id,
    string? SeasonId,
    string Name,
    string TournamentDate,                                   // ISO 8601 date, "YYYY-MM-DD"
    string Status,                                           // "active" | "completed"
    IReadOnlyList<RoundDocument> Rounds,                     // from Gones.Domain.Leagues
    IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes  // from Gones.Domain.Leagues
);
```

- Expected `DbSet`s on `GonesDbContext`: `ArchiveLeagues`, `ArchiveLeagueSeasons`, `ArchiveTournaments`.
- The derived lock rule, binding and verbatim:

```csharp
namespace Gones.Domain.Archive;

public static class ArchiveLockRule
{
    public const int LockWindowDays = 365;
    public static bool IsLocked(LocalDate tournamentDate, LocalDate today);
}
```

  Semantics: `locked ⇔ (today - tournamentDate) > 365 whole UTC calendar days`.
- Response envelopes defined by T3 and **consumed verbatim** here:

```csharp
internal sealed record ArchiveCommandResponse(string Id, long DocumentVersion, Instant UpdatedAt, string ETag);
internal sealed record ArchiveDeleteResponse(string Id, bool Deleted, long DocumentVersion, string ETag);
```

- T3's route group prefix is `/api/archive`. Mapping a second group on the same prefix is legal in ASP.NET minimal APIs — the prefixes concatenate and every route pattern added here is distinct from T3's.

## Interface contract (level 5)

### Produces — routes

All routes below live in one group:

```csharp
var archive = app.MapGroup("/api/archive").RequireAuthorization(AuthorizationPolicies.Organizer);
```

| Method | Pattern | `.WithName(...)` | Headers in | Body in | Success | Body out |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/archive/tournaments` | `CreateArchiveTournamentRow` | `Idempotency-Key` (required) | `CreateArchiveTournamentRequest` | `201` + `Location: /api/archive/tournaments/{id}` + `ETag` | `ArchiveTournamentCommandResponse` |
| PATCH | `/api/archive/tournaments/{tournamentId}` | `EditArchiveTournamentRow` | `If-Match` (required) | `EditArchiveTournamentRequest` | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| PATCH | `/api/archive/tournaments/{tournamentId}/season` | `MoveArchiveTournamentToSeason` | `If-Match` (required) | `MoveArchiveTournamentRequest` | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| DELETE | `/api/archive/tournaments/{tournamentId}` | `DeleteArchiveTournamentRow` | `If-Match` (required) | — | `200` + `ETag` | `ArchiveDeleteResponse` |
| POST | `/api/archive/tournaments/{tournamentId}/rounds` | `AddArchiveTournamentRound` | `If-Match` (required) | — | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| DELETE | `/api/archive/tournaments/{tournamentId}/rounds/{roundId}` | `DeleteArchiveTournamentRound` | `If-Match` (required) | — | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| POST | `/api/archive/tournaments/{tournamentId}/rounds/{roundId}/import` | `ImportArchiveTournamentRound` | `If-Match` (required) | `ImportArchiveRoundRequest` | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| POST | `/api/archive/tournaments/{tournamentId}/rounds/{roundId}/replace` | `ReplaceArchiveTournamentRound` | `If-Match` (required) | `ReplaceArchiveRoundRequest` | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| POST | `/api/archive/tournaments/{tournamentId}/rounds/{roundId}/entries` | `AddArchiveTournamentEntry` | `If-Match` (required) | `RoundEntry` | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| PATCH | `/api/archive/tournaments/{tournamentId}/rounds/{roundId}/entries/{entryId}` | `EditArchiveTournamentEntry` | `If-Match` (required) | `RoundEntry` | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| DELETE | `/api/archive/tournaments/{tournamentId}/rounds/{roundId}/entries/{entryId}` | `DeleteArchiveTournamentEntry` | `If-Match` (required) | — | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| PATCH | `/api/archive/tournaments/{tournamentId}/archetypes/{playerName}` | `UpdateArchiveTournamentArchetype` | `If-Match` (required) | `UpdateArchivePlayerArchetypeRequest` | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| POST | `/api/archive/tournaments/{tournamentId}/edit-batch` | `ApplyArchiveTournamentEditBatch` | `If-Match` (required) | `ArchiveTournamentEditBatchRequest` | `200` + `ETag` | `ArchiveTournamentEditBatchResponse` |
| POST | `/api/archive/tournaments/{tournamentId}/players/rename` | `RenameArchiveTournamentPlayer` | `If-Match` (required) | `RenameArchivePlayerRequest` | `200` + `ETag` | `ArchiveTournamentCommandResponse` |
| POST | `/api/archive/restore` | `RestoreArchiveBundle` | `Idempotency-Key` (required) | `ArchiveRestoreRequest` | `201` | `ArchiveRestoreResponse` |
| POST | `/api/archive/restore-full` | `RestoreFullArchiveBundle` | `Idempotency-Key` (required) | `ArchiveRestoreRequest` | `201` | `ArchiveRestoreResponse` |

`POST /api/archive/restore-full` carries an extra `.RequireAuthorization(AuthorizationPolicies.Admin)`, mirroring `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:42-45`.

### Produces — request records

File `backend/src/Gones.Api/Archive/ArchiveTournamentCommandEndpoints.cs`, namespace `Gones.Api.Archive`:

```csharp
internal sealed record CreateArchiveTournamentRequest(string Name, string TournamentDate, string? SeasonId);
internal sealed record EditArchiveTournamentRequest(string Name, string TournamentDate, string? Status);
internal sealed record MoveArchiveTournamentRequest(string? SeasonId);
internal sealed record ImportArchiveRoundRequest(string Text);
internal sealed record ReplaceArchiveRoundRequest(IReadOnlyList<RoundEntry> Entries);
internal sealed record UpdateArchivePlayerArchetypeRequest(string Archetype);
internal sealed record RenameArchivePlayerRequest(string FromName, string ToName);

/// <summary>Presence of <see cref="ArchiveSeasonMoveIntent"/> is the move discriminator: a null
/// intent means "do not move", and an intent whose SeasonId is null means "detach to standalone".</summary>
internal sealed record ArchiveSeasonMoveIntent(string? SeasonId);

internal sealed record ArchiveTournamentEditBatchRequest(
    ArchiveSeasonMoveIntent? MoveToSeason,
    EditArchiveTournamentIntent? EditTournament,
    string? Status,
    IReadOnlyList<AddArchiveRoundIntent> AddRounds,
    IReadOnlyList<string> DeleteRoundIds,
    IReadOnlyList<ReplaceArchiveRoundIntent> ReplaceRounds,
    IReadOnlyList<UpdateArchiveArchetypeIntent> UpdateArchetypes);

internal sealed record ArchiveRestoreRequest(
    string Kind,
    int Version,
    IReadOnlyList<ArchiveLeagueDocument> Leagues,
    IReadOnlyList<ArchiveLeagueSeasonDocument> LeagueSeasons,
    IReadOnlyList<ArchiveTournamentDocument> Tournaments);
```

`EditArchiveTournamentIntent`, `AddArchiveRoundIntent`, `ReplaceArchiveRoundIntent`, `UpdateArchiveArchetypeIntent` are the **existing public records** in `Gones.Domain.Leagues` (`backend/src/Gones.Domain/Leagues/LeagueCommands.cs:328-333`). Import them; do not redeclare them.

### Produces — response records

```csharp
internal sealed record ArchiveTournamentCommandResponse(
    string Id,
    string? SeasonId,
    string Name,
    string TournamentDate,                                    // "YYYY-MM-DD"
    string Status,                                            // "active" | "completed"
    IReadOnlyList<RoundDocument> Rounds,
    IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes,
    long DocumentVersion,
    Instant UpdatedAt,
    string ETag);

internal sealed record ArchiveTournamentEditBatchResponse(ArchiveTournamentCommandResponse Tournament);

internal sealed record ArchiveRestoredId(string SourceId, string Id, string Name, long DocumentVersion, string ETag);

internal sealed record ArchiveRestoreResponse(
    IReadOnlyList<ArchiveRestoredId> Leagues,
    IReadOnlyList<ArchiveRestoredId> LeagueSeasons,
    IReadOnlyList<ArchiveRestoredId> Tournaments);
```

`ArchiveTournamentCommandResponse` carries the `Id` / `DocumentVersion` / `UpdatedAt` / `ETag` envelope of T3's `ArchiveCommandResponse` **plus** the authoritative document, because ADR 0037 requires a successful staged save to adopt the authoritative document without a refetch. `DELETE` returns T3's `ArchiveDeleteResponse` unchanged — a deleted row has no document to adopt.

### Produces — domain functions

File `backend/src/Gones.Domain/Archive/ArchiveTournamentCommands.cs`, namespace `Gones.Domain.Archive`:

```csharp
public static class ArchiveTournamentCommands
{
    public static ArchiveTournamentDocument Create(string tournamentId, string? seasonId, string name, string tournamentDate);
    public static ArchiveTournamentDocument Edit(ArchiveTournamentDocument tournament, string name, string tournamentDate, string? status);
    public static ArchiveTournamentDocument MoveToSeason(ArchiveTournamentDocument tournament, string? seasonId);
    public static ArchiveTournamentDocument AddRound(ArchiveTournamentDocument tournament, string roundId);
    public static ArchiveTournamentDocument DeleteRound(ArchiveTournamentDocument tournament, string roundId);
    public static ArchiveTournamentDocument ReplaceRound(ArchiveTournamentDocument tournament, string roundId, IReadOnlyList<RoundEntry> entries, bool mergeImportedArchetypes);
    public static ArchiveTournamentDocument AddEntry(ArchiveTournamentDocument tournament, string roundId, RoundEntry entry);
    public static ArchiveTournamentDocument EditEntry(ArchiveTournamentDocument tournament, string roundId, string entryId, RoundEntry entry);
    public static ArchiveTournamentDocument DeleteEntry(ArchiveTournamentDocument tournament, string roundId, string entryId);
    public static ArchiveTournamentDocument UpdateArchetype(ArchiveTournamentDocument tournament, string playerName, string archetype);
    public static ArchiveTournamentDocument RenamePlayer(ArchiveTournamentDocument tournament, string fromName, string toName);
    public static ArchiveTournamentDocument ApplyEditBatch(ArchiveTournamentDocument tournament, ArchiveTournamentEditBatch command);
    public static IReadOnlyList<ArchiveTournamentDocument> Restore(IReadOnlyList<ArchiveTournamentDocument> tournaments, Func<string> idFactory);
    public static LocalDate ParseDate(string value);      // LocalDatePattern.Iso; ArgumentException("tournamentDate") on failure
    public static string FormatDate(LocalDate value);     // LocalDatePattern.Iso
}
```

File `backend/src/Gones.Domain/Archive/ArchiveSeasonCounts.cs`, namespace `Gones.Domain.Archive`:

```csharp
public static class ArchiveSeasonCounts
{
    public const int Version = 1;
    public static ArchiveSeasonCountsResult From(IReadOnlyList<ArchiveTournamentDocument> tournaments);
}

public sealed record ArchiveSeasonCountsResult(
    int TournamentCount,
    int PlayerCount,
    string? FirstTournamentDate,   // ISO "YYYY-MM-DD", null when the Season has no Tournament
    string? LastTournamentDate);
```

`PlayerCount` is the **distinct standings row count across the Season's Tournaments** — `LeagueRules.CalculateLeagueResult(carrier).Rows.Count` over a carrier `LeagueDocument` holding those Tournaments — which is exactly what `LeagueCatalogCounts.From` computes for a legacy League. It is not the sum of per-Tournament player counts (that would double-count a player who attended twice).

### Produces — the Season counter write

Raw SQL, so EF's version increment never sees the row:

```csharp
await database.Database.ExecuteSqlRawAsync(
    """
    UPDATE archive_league_seasons
    SET tournament_count = @tournamentCount,
        player_count = @playerCount,
        first_tournament_date = @firstDate,
        last_tournament_date = @lastDate,
        counts_version = @countsVersion
    WHERE document_id = @seasonId AND deleted_at IS NULL
    """,
    [
        new NpgsqlParameter("tournamentCount", NpgsqlDbType.Integer) { Value = counts.TournamentCount },
        new NpgsqlParameter("playerCount", NpgsqlDbType.Integer) { Value = counts.PlayerCount },
        new NpgsqlParameter("firstDate", NpgsqlDbType.Date) { Value = first is null ? DBNull.Value : ArchiveTournamentCommands.ParseDate(first) },
        new NpgsqlParameter("lastDate", NpgsqlDbType.Date) { Value = last is null ? DBNull.Value : ArchiveTournamentCommands.ParseDate(last) },
        new NpgsqlParameter("countsVersion", NpgsqlDbType.Integer) { Value = ArchiveSeasonCounts.Version },
        new NpgsqlParameter("seasonId", NpgsqlDbType.Text) { Value = seasonId }
    ],
    cancellationToken);
```

### Consumes

Verbatim, from T3 and its predecessor — do not redesign, do not rename:

```csharp
// Gones.Domain.Archive
public static class ArchiveLockRule { public const int LockWindowDays = 365; public static bool IsLocked(LocalDate tournamentDate, LocalDate today); }
public sealed record ArchiveTournamentDocument(string Id, string? SeasonId, string Name, string TournamentDate, string Status, IReadOnlyList<RoundDocument> Rounds, IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes);
public sealed record ArchiveLeagueSeasonDocument(string Id, string LeagueId, string Name, string Status);
public sealed record ArchiveLeagueDocument(string Id, string Name);
public sealed class ArchiveTournamentAggregate : VersionedEntity { /* Create / ReadDocument / Apply / SoftDelete, see "From Depends" */ }

// Gones.Api.Archive (T3)
internal sealed record ArchiveDeleteResponse(string Id, bool Deleted, long DocumentVersion, string ETag);

// Gones.Domain.Leagues (existing, unchanged)
public static class LeagueCommands { /* AddTournament, EditTournament, AddRound, DeleteRound, ReplaceRound, AddEntry, EditEntry, DeleteEntry, UpdateArchetype, RenamePlayer, ApplyTournamentEditBatch, Restore */ }
public sealed record ArchiveTournamentEditBatch(EditArchiveTournamentIntent? EditTournament, IReadOnlyList<AddArchiveRoundIntent> AddRounds, IReadOnlyList<string> DeleteRoundIds, IReadOnlyList<ReplaceArchiveRoundIntent> ReplaceRounds, IReadOnlyList<UpdateArchiveArchetypeIntent> UpdateArchetypes, string? Status = null);

// Gones.Api.Organizations (existing, unchanged)
internal static class OrganizationPrincipal { public static Guid UserId(ClaimsPrincipal principal); public static bool IsAdmin(ClaimsPrincipal principal); }
```

### Errors — exact code per failure path

| Path | HTTP | `code` | Raised by |
| --- | --- | --- | --- |
| Non-Admin writes a Tournament whose stored `tournamentDate` is locked | `409` | `archiveTournamentLocked` | `throw new ResourceConflictException("archiveTournamentLocked")` |
| Non-Admin creates a Tournament with a locked requested date | `409` | `archiveTournamentLocked` | same |
| Non-Admin sets a Tournament's date into the locked window | `409` | `archiveTournamentLocked` | same |
| Missing / malformed / mismatched `If-Match` | `412` | `stale_version` | `throw new ConcurrencyConflictException()` |
| Lost EF concurrency race on save | `412` | `stale_version` | `catch (DbUpdateConcurrencyException)` → `ConcurrencyConflictException` |
| `tournamentId` absent or soft-deleted | `404` | `not_found` | `throw new ResourceNotFoundException()` |
| `seasonId` (create or move target) absent or soft-deleted | `404` | `not_found` | `throw new ResourceNotFoundException()` |
| `roundId` / `entryId` absent | `404` | `not_found` | `catch (KeyNotFoundException)` → `ResourceNotFoundException` |
| Blank name, unparsable date, bad `status`, empty edit batch, duplicate intent ids, bad bundle `kind`/`version`, dangling bundle link, cap exceeded | `400` | `validation_failed` | `throw new ApiValidationException(new Dictionary<string,string[]>{[field]=[message]})` |
| Domain refuses the transition (duplicate round id, round already deleted in the same batch, …) | `409` | `conflict` | `catch (InvalidOperationException)` → `ResourceConflictException()` |
| Missing or >200-char `Idempotency-Key` | `400` | `validation_failed` | `ApiValidationException` |
| `Idempotency-Key` replayed with a different request body | `409` | `idempotency_conflict` | `throw new IdempotencyConflictException()` |
| Anonymous caller | `401` | — | `AuthorizationPolicies.Organizer` |
| Authenticated `User` role | `403` | `forbidden` | `AuthorizationPolicies.Organizer` |
| `Organizer` calling `/api/archive/restore-full` | `403` | `forbidden` | `AuthorizationPolicies.Admin` |

### Invariants

- **Lock predicate.** `locked(t) ⇔ ArchiveLockRule.IsLocked(t.TournamentDate, clock.GetCurrentInstant().InUtc().Date)`. 365 days → not locked. 366 days → locked. Evaluated once per request, from the injected `IClock`, never from `DateTime.UtcNow`.
- **Lock scope.** Guarded: every existing-row write. Guarded on the *requested* date as well: `POST /api/archive/tournaments`, `PATCH /api/archive/tournaments/{id}` and the `editTournament` intent of `edit-batch`. **Exempt:** `POST /api/archive/restore` and `POST /api/archive/restore-full`. Rationale, and it is deliberate: the archive's core workflow is bulk-importing years of historical results, so the restore endpoints are the historical-entry path — they mint brand-new ids in one shot and rewrite no protected row. The interactive create/edit path is for recent events, and is refused for a locked date so a non-Admin can never produce a row they are immediately forbidden to fill.
- **Admin bypass.** `OrganizationPrincipal.IsAdmin(principal) == true` skips the lock check on every path. It skips nothing else — `If-Match`, validation and 404s still apply.
- **Per-Tournament concurrency.** A Tournament write increments `archive_tournaments.version` by exactly 1 and moves only that row's `updated_at`. `archive_league_seasons.version`, `archive_league_seasons.updated_at`, `archive_leagues.version` and `archive_leagues.updated_at` are unchanged by every route in this ticket except the restore routes, which *insert* new League and Season rows at version 1.
- **Counter recomputation.** Runs after `SaveChangesAsync` and before `CommitAsync`, in the same transaction, reading `archive_tournaments` with `AsNoTracking()` filtered `season_id = @id AND deleted_at IS NULL`. On a move, both the old and the new Season are recomputed, and the two `UPDATE`s are issued in ascending ordinal order of `document_id` so two opposing concurrent moves cannot deadlock.
- **Empty Season.** A Season with no live Tournament gets `tournament_count = 0`, `player_count = 0`, `first_tournament_date = NULL`, `last_tournament_date = NULL`, `counts_version = ArchiveSeasonCounts.Version`.
- **Standalone Tournament.** `seasonId = null` means no Season counter work at all on that write.
- **Server-owned ids.** Round ids and entry ids are minted server-side with `Guid.NewGuid().ToString("D")`. A client-supplied entry id is discarded on add and forced to the route's `{entryId}` on edit, exactly as `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:139-160` does.
- **New Tournament status** is `"active"` (`LeagueCommands.AddTournament` sets it).
- **No status gate on content writes.** A Tournament with `status = "completed"` stays editable. The legacy "completed League must be reopened before source data can change" rule (`LeagueCommands.RequireActive`) was a *League*-level freeze; in the three-tier archive the freeze mechanism is the derived 365-day lock. The carrier League built inside `ArchiveTournamentCommands` is therefore always `"active"`, and the owning Season's status is never read on a Tournament write — reading it would couple the tiers that requirement 7 keeps apart.
- **Ordering and idempotency.** Rounds keep insertion order. `edit-batch` applies intents in the fixed order delete → add(+replace) → replace → archetypes → status, inherited from `LeagueCommands.ApplyTournamentEditBatch`. Replaying an `Idempotency-Key` with an identical body returns the stored response and writes nothing.
- **Audit.** One `AuditRecord` per successful command, `EntityType = "archive_tournament"`, `EntityId = tournamentId`, `RedactedDiff = {"fields":[…]}`. It never contains a player name, a Tournament name or a document.
- **Units.** `tournamentDate` is a calendar date with no time and no zone. `updatedAt` is a UTC `Instant`. `documentVersion` starts at 1 and increments by 1.

## TDD

1. **Red.** Write the four test files first, in this order, and run them to see them fail:
   - `backend/tests/Gones.UnitTests/ArchiveTournamentCommandsTests.cs`
   - `backend/tests/Gones.IntegrationTests/ArchiveTournamentCommandApiTests.cs`
   - `backend/tests/Gones.IntegrationTests/ArchiveTournamentLockApiTests.cs`
   - `backend/tests/Gones.IntegrationTests/ArchiveRestoreApiTests.cs`
   The unit file fails to compile until `ArchiveTournamentCommands` and `ArchiveSeasonCounts` exist; the integration files compile and fail with `404`/`405` until the routes are mapped. Both are legitimate red.
2. **Green.** Add the domain file, then the service, then the endpoint map, then the registration — the minimum that makes each named test pass. Assert behaviour through HTTP status, problem `code`, response body and `GonesDbContext` reads, never through internal call counts.
3. **Refactor.** Only to remove duplication between the mutate paths (they all share load → lock-guard → transform → save → recount). Keep every test green.

## Test plan

Unit — `backend/tests/Gones.UnitTests/ArchiveTournamentCommandsTests.cs`:

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Creates_a_standalone_tournament_active_with_a_trimmed_name` | `Create("t1", null, "  Open  ", "2026-08-17")` | `SeasonId == null`, `Name == "Open"`, `Status == "active"`, `Rounds` empty |
| `Creates_an_attached_tournament_carrying_its_season_id` | `Create("t1", "season-1", "Open", "2026-08-17")` | `SeasonId == "season-1"` |
| `Moves_a_tournament_between_seasons_and_to_standalone` | `MoveToSeason(doc, "season-2")` then `MoveToSeason(_, null)` | `SeasonId` is `"season-2"` then `null`; `Rounds` and `PlayerArchetypes` unchanged by reference equality of content |
| `Adds_and_deletes_a_round` | `AddRound(doc, "round-1")` then `DeleteRound(_, "round-1")` | one round, then none |
| `Refuses_a_duplicate_round_id` | `AddRound` twice with `"round-1"` | `InvalidOperationException` |
| `Refuses_an_unknown_round_id` | `DeleteRound(doc, "missing")` | `KeyNotFoundException` |
| `Normalizes_an_added_entry_through_the_shared_rules` | `AddEntry(doc, "round-1", new ByeRoundEntry("e1", "2", "  Carol  ", "  Earth  "))` | stored entry has `PlayerName == "Carol"`, `DeckArchetype == "Earth"` |
| `Merges_imported_archetypes_into_the_tournament` | `ReplaceRound(doc, "round-1", importedEntries, mergeImportedArchetypes: true)` | `PlayerArchetypes` contains every imported player name, sorted |
| `Updates_one_archetype_and_keeps_the_sort` | `UpdateArchetype(doc, "Bob", "Midrange")` | `PlayerArchetypes` contains `("Bob","Midrange")` and stays name-sorted |
| `Renames_a_player_inside_the_tournament` | `RenamePlayer(doc, "Alice", "Alicia")` | every entry referencing `Alice` now reads `Alicia` |
| `Applies_every_edit_batch_intent_in_order` | batch: edit + delete `round-1` + add `round-2` with entries + replace + archetype + `Status = "completed"` | resulting document reflects all six, rounds ordered `[round-2]` after the delete |
| `Refuses_a_round_deleted_and_replaced_in_one_batch` | batch with `round-1` in both lists | `ArgumentException` |
| `Restores_a_bundle_with_fresh_round_and_entry_ids` | `Restore([doc], () => Guid.NewGuid().ToString("D"))` | tournament, round and entry ids all differ from the source; names, dates, statuses and `SeasonId` preserved |
| `Parses_and_formats_an_iso_date` | `ParseDate("2026-08-17")`, `FormatDate(new LocalDate(2026,8,17))` | round-trips; `ParseDate("17/08/2026")` throws `ArgumentException` |
| `Season_counts_are_the_distinct_standings_rows_and_the_date_bounds` | two Tournaments sharing one player, dated `2026-01-05` and `2026-03-09` | `TournamentCount == 2`, `PlayerCount ==` distinct player count, `FirstTournamentDate == "2026-01-05"`, `LastTournamentDate == "2026-03-09"` |
| `Season_counts_of_an_empty_season_are_zero_with_null_dates` | `From([])` | `(0, 0, null, null)` |

Integration — `backend/tests/Gones.IntegrationTests/ArchiveTournamentCommandApiTests.cs`:

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Tournament_commands_reject_anonymous_and_plain_User_callers` | `POST /api/archive/tournaments` with no role, then role `User` | `401`, then `403` with `code == "forbidden"` |
| `Tournament_create_requires_an_Idempotency_Key_and_replays_the_same_row` | create with no key; then key `k1` twice; then key `k1` with a different name | `400 validation_failed`; `201` twice with the same `id`; `409 idempotency_conflict` |
| `Tournament_create_accepts_a_standalone_row` | body `{name:"Standalone", tournamentDate:"<today>", seasonId:null}` | `201`, `Location == "/api/archive/tournaments/{id}"`, `ETag` present, body `seasonId == null`, `status == "active"`, `documentVersion == 1` |
| `Tournament_create_rejects_an_unknown_season` | `seasonId:"missing-season"` | `404 not_found`, no row inserted |
| `Tournament_create_stamps_the_owning_Season_counters` | create two Tournaments in `season-1` dated `2026-01-05` and `2026-03-09` | `archive_league_seasons` row for `season-1` has `tournament_count == 2`, `first_tournament_date == 2026-01-05`, `last_tournament_date == 2026-03-09`, `counts_version == 1`, and `version` still `1` |
| `Tournament_metadata_edit_and_delete_bump_only_the_Tournament_version` | `PATCH /{id}` then `DELETE /{id}` with the returned ETags | `200` each; tournament `version` `2` then `3`; Season `version` and `updated_at` unchanged throughout; `DELETE` body `deleted == true`; `deleted_at` set |
| `Tournament_writes_refuse_a_stale_If_Match_with_412` | `PATCH /{id}` with `If-Match: StrongETag.Encode(99)`, and again with no header | `412 stale_version` both times, stored `version` unchanged |
| `Tournament_season_move_attaches_detaches_and_recomputes_both_Seasons` | `PATCH /{id}/season` `{seasonId:"season-2"}`, then `{seasonId:null}` | `200` each; `season_id` follows; `season-1` and `season-2` counters both recomputed; neither Season's `version` moves |
| `Round_add_import_replace_delete_commands_match_current_source_semantics` | add round → import CSV `"Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist\n2, Carol ,Won 2-0,Dan, Aggro ,Control"` → replace with one bye → delete | round id is a `Guid`; imported entry `player1Name == "Carol"`; `playerArchetypes` gains `Carol`; replaced entry `kind == "bye"`; final round list empty |
| `Entry_add_edit_delete_and_archetype_update_are_intent_scoped` | add bye with `id:"ignored-client-id"` → patch it → `PATCH /archetypes/Carol` → delete | added entry id `!= "ignored-client-id"`; patched entry keeps the route id; archetype updated; entry removed |
| `Tournament_player_rename_is_scoped_to_one_Tournament` | two Tournaments in `season-1` both containing `Alice`; rename in the first only | first Tournament reads `Alicia`, second still reads `Alice` |
| `Tournament_edit_batch_applies_every_intent_with_one_version_bump` | batch: `editTournament` + one `addRounds` + one `deleteRoundIds` + one `replaceRounds` + one `updateArchetypes` | `200`; `tournament.documentVersion` is exactly the pre-batch version + 1; body reflects every intent; response `eTag` equals the `ETag` header |
| `Tournament_edit_batch_refuses_an_empty_batch` | all arrays empty, every optional null | `400 validation_failed`, stored version unchanged |
| `Tournament_edit_batch_rolls_back_completely_on_an_invalid_intent` | `deleteRoundIds:["round-1"]` and `replaceRounds:[{roundId:"round-1",…}]` | `400 validation_failed`; document and version byte-identical to before |
| `Tournament_edit_batch_moves_to_a_Season_and_recomputes_both_Seasons` | batch with `moveToSeason:{seasonId:"season-2"}` plus an `editTournament` | `200`, one version bump, `season_id == "season-2"`, both Season counter rows recomputed, neither Season `version` moved |
| `Tournament_edit_batch_detaches_to_standalone` | batch with `moveToSeason:{seasonId:null}` | `200`, `season_id IS NULL`, old Season recomputed to `tournament_count = 0` and null date bounds |
| `Unknown_tournament_round_or_entry_returns_404` | `PATCH /api/archive/tournaments/missing`, `DELETE …/rounds/missing`, `DELETE …/entries/missing` | `404 not_found` each |
| `Archive_writes_never_touch_the_legacy_league_aggregates` | run a create + a round add | `league_archive_aggregates` row count and versions unchanged |

Integration — `backend/tests/Gones.IntegrationTests/ArchiveTournamentLockApiTests.cs`. `Today` is `SystemClock.Instance.GetCurrentInstant().InUtc().Date`; seeds are written straight through `GonesDbContext` so the date is exact:

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Tournament_dated_365_days_ago_is_writable_by_an_Organizer` | seed dated `Today.PlusDays(-365)`; `PATCH /{id}` as `Organizer` | `200`, version bumped |
| `Tournament_dated_366_days_ago_refuses_an_Organizer_write` | seed dated `Today.PlusDays(-366)`; `PATCH /{id}` as `Organizer` | `409`, `code == "archiveTournamentLocked"`, version unchanged |
| `Tournament_dated_366_days_ago_accepts_an_Admin_write` | same seed; `PATCH /{id}` as `Admin` | `200`, version bumped |
| `Locked_Tournament_refuses_every_content_route_for_an_Organizer` | on the 366-day row as `Organizer`: `POST /rounds`, `DELETE /rounds/{r}`, `POST /rounds/{r}/import`, `POST /rounds/{r}/replace`, `POST /rounds/{r}/entries`, `PATCH /rounds/{r}/entries/{e}`, `DELETE /rounds/{r}/entries/{e}`, `PATCH /archetypes/{name}`, `POST /edit-batch`, `POST /players/rename`, `PATCH /season`, `DELETE /{id}` | `409 archiveTournamentLocked` on all twelve; document unchanged |
| `Creating_a_Tournament_dated_366_days_ago_is_refused_for_an_Organizer` | `POST /api/archive/tournaments` `tournamentDate: Today.PlusDays(-366)` as `Organizer` | `409 archiveTournamentLocked`, no row inserted |
| `Creating_a_Tournament_dated_365_days_ago_is_accepted_for_an_Organizer` | same at `-365` | `201` |
| `Creating_a_Tournament_dated_366_days_ago_is_accepted_for_an_Admin` | same at `-366` as `Admin` | `201` |
| `Organizer_cannot_move_a_fresh_Tournament_into_the_locked_window` | fresh row dated `Today`; `PATCH /{id}` with `tournamentDate: Today.PlusDays(-366)` as `Organizer` | `409 archiveTournamentLocked`, stored date unchanged |
| `Admin_can_move_a_fresh_Tournament_into_the_locked_window` | same as `Admin` | `200`, stored date updated |

Integration — `backend/tests/Gones.IntegrationTests/ArchiveRestoreApiTests.cs`:

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Archive_restore_remaps_every_id_and_rewires_the_tier_links` | bundle with 1 League, 1 Season, 1 attached + 1 standalone Tournament, each Tournament with a round and an entry | `201`; every returned `id != sourceId`; stored Season's `league_id` is the new League id; attached Tournament's `season_id` is the new Season id; standalone Tournament's `season_id IS NULL`; round and entry ids are fresh `Guid`s |
| `Archive_restore_stamps_the_restored_Season_counters` | same bundle | Season row has `tournament_count == 1`, non-null date bounds, `counts_version == 1`, `version == 1` |
| `Archive_restore_refuses_a_bundle_that_is_not_version_5` | `version: 4` | `400 validation_failed`, nothing inserted |
| `Archive_restore_refuses_a_wrong_kind` | `kind: "fullArchive"` on `/api/archive/restore` | `400 validation_failed` |
| `Archive_restore_refuses_a_dangling_season_link` | a Tournament whose `seasonId` names no Season in the bundle | `400 validation_failed`, nothing inserted |
| `Archive_restore_uniquifies_a_colliding_League_and_Season_name` | restore the same bundle twice with different keys | second run's names are `"<name> (restored)"` |
| `Archive_restore_is_exempt_from_the_365_day_lock` | bundle whose Tournament is dated `Today.PlusDays(-1000)`, as `Organizer` | `201` |
| `Archive_restore_full_requires_Admin` | `POST /api/archive/restore-full` as `Organizer`, then as `Admin` | `403 forbidden`, then `201` |
| `Archive_restore_replays_by_Idempotency_Key` | same key twice with the same body, then the same key with a different body | identical `201` payload; then `409 idempotency_conflict` |
| `Archive_restore_refuses_an_oversized_bundle` | 101 Leagues on `/api/archive/restore-full` | `400 validation_failed` |

Run commands:

```bash
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentCommandsTests"
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentCommandApiTests"
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentLockApiTests"
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveRestoreApiTests"
npm run backend:test
```

## Impl steps

- [ ] 1. Reconcile with what the predecessor tickets actually shipped
  - [ ] 1.1 Run `grep -rn "class ArchiveTournamentAggregate\|record ArchiveTournamentDocument\|record ArchiveLeagueSeasonDocument\|record ArchiveLeagueDocument\|class ArchiveLockRule" backend/src --include=*.cs` and write the real names into a scratch note. Where a name differs from the "From Depends" section above, use the **real** name everywhere below. Never rename a symbol another ticket owns.
  - [ ] 1.2 Run `grep -rn "ArchiveTournaments\|ArchiveLeagueSeasons\|ArchiveLeagues" backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs` and note the real `DbSet` property names.
  - [ ] 1.3 Run `grep -rn "record ArchiveCommandResponse\|record ArchiveDeleteResponse" backend/src --include=*.cs` and note the real `ArchiveDeleteResponse` shape. If its constructor differs from `(string Id, bool Deleted, long DocumentVersion, string ETag)`, map onto the real one; do not edit T3's file.
  - [ ] 1.4 Run `grep -rn "IsLocked" backend/src/Gones.Domain --include=*.cs`. If `ArchiveLockRule` does **not** exist, create `backend/src/Gones.Domain/Archive/ArchiveLockRule.cs` with exactly `public const int LockWindowDays = 365;` and `public static bool IsLocked(LocalDate tournamentDate, LocalDate today) => Period.Between(tournamentDate, today, PeriodUnits.Days).Days > LockWindowDays;`.
  - [ ] 1.5 Run `grep -rn "ArchiveTournamentDocument" backend/src/Gones.Domain --include=*.cs | head`. If `TournamentDate` is typed `LocalDate` rather than `string`, keep the record as it is and convert at every boundary with `ArchiveTournamentCommands.ParseDate` / `FormatDate`; the carrier conversion in step 3.3 then formats it.
  - [ ] 1.6 Confirm no migration is needed: `ls backend/src/Gones.Infrastructure/Persistence/Migrations | grep RebuildArchiveThreeTier` must print a file. If it does not, stop — the dependency is not merged.

- [ ] 2. Red — write the failing tests
  - [ ] 2.1 Create `backend/tests/Gones.UnitTests/ArchiveTournamentCommandsTests.cs` with every unit test named in "Test plan", modelled on `backend/tests/Gones.UnitTests/LeagueCommandsTests.cs`.
  - [ ] 2.2 Create `backend/tests/Gones.IntegrationTests/ArchiveTournamentCommandApiTests.cs`. Copy the `IAsyncLifetime` harness from `backend/tests/Gones.IntegrationTests/LeagueCommandApiTests.cs:17-60` verbatim (container, `MigrateAsync`, the `ApplicationUser` actor row, the `WebApplicationFactory<Program>` settings, `SendJsonAsync` / `Body` / `AssertProblem` / `CreateContext`), then seed the archive fixture: one `archive_leagues` row `league-1`, two `archive_league_seasons` rows `season-1` and `season-2` both pointing at `league-1`, and one `archive_tournaments` row `tournament-1` in `season-1` dated `Today` with one round `round-1` holding one `MatchRoundEntry("entry-1","1","Alice","Bob",2,1,"Tempo","Control")`.
  - [ ] 2.3 Create `backend/tests/Gones.IntegrationTests/ArchiveTournamentLockApiTests.cs` with the same harness and a seed of three Tournaments: `fresh` dated `Today`, `edge-365` dated `Today.PlusDays(-365)`, `locked-366` dated `Today.PlusDays(-366)`, each with one round and one entry.
  - [ ] 2.4 Create `backend/tests/Gones.IntegrationTests/ArchiveRestoreApiTests.cs` with the same harness and an empty archive.
  - [ ] 2.5 Run `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~Archive"` and record that it fails.

- [ ] 3. Domain — reuse the existing mutation rules through a carrier League
  - [ ] 3.1 Create `backend/src/Gones.Domain/Archive/ArchiveTournamentCommands.cs` with `using Gones.Domain.Leagues; using NodaTime; using NodaTime.Text;` and `namespace Gones.Domain.Archive;`.
  - [ ] 3.2 Add the private carrier constants and the round-trip helpers:

```csharp
    /// <summary>
    /// Synthetic carrier League. It exists only for the length of one call: the round, entry and
    /// archetype rules already live in <see cref="LeagueCommands"/>, and re-implementing entry
    /// normalization or archetype merging on the Tournament tier would fork them.
    /// </summary>
    private const string CarrierId = "archive-carrier";
    private const string CarrierName = "Archive Carrier";

    private static LeagueDocument ToCarrier(ArchiveTournamentDocument tournament) => new(
        CarrierId,
        CarrierName,
        "active",
        [new TournamentDocument(tournament.Id, CarrierId, tournament.Name, tournament.TournamentDate, tournament.Status, tournament.Rounds, tournament.PlayerArchetypes)]);

    private static ArchiveTournamentDocument FromCarrier(ArchiveTournamentDocument original, LeagueDocument carrier)
    {
        var tournament = carrier.Tournaments.Single(item => item.Id == original.Id);
        return original with
        {
            Name = tournament.Name,
            TournamentDate = tournament.TournamentDate,
            Status = tournament.Status,
            Rounds = tournament.Rounds,
            PlayerArchetypes = tournament.PlayerArchetypes
        };
    }

    private static ArchiveTournamentDocument Delegate(ArchiveTournamentDocument tournament, Func<LeagueDocument, LeagueDocument> command) =>
        FromCarrier(tournament, command(ToCarrier(tournament)));
```

  - [ ] 3.3 Add `Create`:

```csharp
    public static ArchiveTournamentDocument Create(string tournamentId, string? seasonId, string name, string tournamentDate)
    {
        var carrier = LeagueCommands.AddTournament(new LeagueDocument(CarrierId, CarrierName, "active", []), tournamentId, name, tournamentDate);
        var created = carrier.Tournaments.Single();
        _ = ParseDate(created.TournamentDate);
        return new ArchiveTournamentDocument(created.Id, seasonId, created.Name, created.TournamentDate, created.Status, created.Rounds, created.PlayerArchetypes);
    }
```

  - [ ] 3.4 Add the delegating mutators, one line each:

```csharp
    public static ArchiveTournamentDocument Edit(ArchiveTournamentDocument tournament, string name, string tournamentDate, string? status)
    {
        _ = ParseDate(tournamentDate);
        return Delegate(tournament, carrier => LeagueCommands.EditTournament(carrier, tournament.Id, name, tournamentDate, status));
    }

    public static ArchiveTournamentDocument MoveToSeason(ArchiveTournamentDocument tournament, string? seasonId) =>
        tournament with { SeasonId = seasonId };

    public static ArchiveTournamentDocument AddRound(ArchiveTournamentDocument tournament, string roundId) =>
        Delegate(tournament, carrier => LeagueCommands.AddRound(carrier, tournament.Id, roundId));

    public static ArchiveTournamentDocument DeleteRound(ArchiveTournamentDocument tournament, string roundId) =>
        Delegate(tournament, carrier => LeagueCommands.DeleteRound(carrier, tournament.Id, roundId));

    public static ArchiveTournamentDocument ReplaceRound(ArchiveTournamentDocument tournament, string roundId, IReadOnlyList<RoundEntry> entries, bool mergeImportedArchetypes) =>
        Delegate(tournament, carrier => LeagueCommands.ReplaceRound(carrier, tournament.Id, roundId, entries, mergeImportedArchetypes));

    public static ArchiveTournamentDocument AddEntry(ArchiveTournamentDocument tournament, string roundId, RoundEntry entry) =>
        Delegate(tournament, carrier => LeagueCommands.AddEntry(carrier, tournament.Id, roundId, entry));

    public static ArchiveTournamentDocument EditEntry(ArchiveTournamentDocument tournament, string roundId, string entryId, RoundEntry entry) =>
        Delegate(tournament, carrier => LeagueCommands.EditEntry(carrier, tournament.Id, roundId, entryId, entry));

    public static ArchiveTournamentDocument DeleteEntry(ArchiveTournamentDocument tournament, string roundId, string entryId) =>
        Delegate(tournament, carrier => LeagueCommands.DeleteEntry(carrier, tournament.Id, roundId, entryId));

    public static ArchiveTournamentDocument UpdateArchetype(ArchiveTournamentDocument tournament, string playerName, string archetype) =>
        Delegate(tournament, carrier => LeagueCommands.UpdateArchetype(carrier, tournament.Id, playerName, archetype));

    public static ArchiveTournamentDocument RenamePlayer(ArchiveTournamentDocument tournament, string fromName, string toName) =>
        Delegate(tournament, carrier => LeagueCommands.RenamePlayer(carrier, fromName, toName));

    public static ArchiveTournamentDocument ApplyEditBatch(ArchiveTournamentDocument tournament, ArchiveTournamentEditBatch command) =>
        Delegate(tournament, carrier => LeagueCommands.ApplyTournamentEditBatch(carrier, tournament.Id, command));
```

  - [ ] 3.5 Add `Restore`, reusing `LeagueCommands.Restore` so round and entry ids are remapped by the existing code path. The caller passes documents whose `SeasonId` is **already** the new Season id; order is preserved, so zip by index:

```csharp
    public static IReadOnlyList<ArchiveTournamentDocument> Restore(IReadOnlyList<ArchiveTournamentDocument> tournaments, Func<string> idFactory)
    {
        ArgumentNullException.ThrowIfNull(tournaments);
        if (tournaments.Count == 0) return [];
        var carrier = new LeagueDocument(
            CarrierId,
            CarrierName,
            "active",
            tournaments.Select(item => new TournamentDocument(item.Id, CarrierId, item.Name, item.TournamentDate, item.Status, item.Rounds, item.PlayerArchetypes)).ToArray());
        var restored = LeagueCommands.Restore(carrier, idFactory(), CarrierName, idFactory);
        return restored.Tournaments
            .Select((item, index) => new ArchiveTournamentDocument(item.Id, tournaments[index].SeasonId, item.Name, item.TournamentDate, item.Status, item.Rounds, item.PlayerArchetypes))
            .ToArray();
    }
```

  - [ ] 3.6 Add the date helpers:

```csharp
    public static LocalDate ParseDate(string value)
    {
        var parsed = LocalDatePattern.Iso.Parse(value?.Trim() ?? string.Empty);
        if (!parsed.Success) throw new ArgumentException("Tournament date must be an ISO 8601 calendar date.", "tournamentDate");
        return parsed.Value;
    }

    public static string FormatDate(LocalDate value) => LocalDatePattern.Iso.Format(value);
```

  - [ ] 3.7 Create `backend/src/Gones.Domain/Archive/ArchiveSeasonCounts.cs`:

```csharp
using Gones.Domain.Leagues;

namespace Gones.Domain.Archive;

/// <summary>
/// The four numbers a LeagueSeason row prints, denormalized onto <c>archive_league_seasons</c> so the
/// catalog never deserializes a Tournament document. Bump <see cref="Version"/> in the same commit as
/// any change to how a number is derived.
/// </summary>
public static class ArchiveSeasonCounts
{
    public const int Version = 1;
    private const string CarrierId = "archive-carrier";

    public static ArchiveSeasonCountsResult From(IReadOnlyList<ArchiveTournamentDocument> tournaments)
    {
        ArgumentNullException.ThrowIfNull(tournaments);
        if (tournaments.Count == 0) return new ArchiveSeasonCountsResult(0, 0, null, null);
        var carrier = new LeagueDocument(
            CarrierId,
            "Archive Carrier",
            "active",
            tournaments.Select(item => new TournamentDocument(item.Id, CarrierId, item.Name, item.TournamentDate, item.Status, item.Rounds, item.PlayerArchetypes)).ToArray());
        var dates = tournaments
            .Select(item => item.TournamentDate)
            .Where(date => !string.IsNullOrWhiteSpace(date))
            .Order(StringComparer.Ordinal)
            .ToArray();
        return new ArchiveSeasonCountsResult(
            tournaments.Count,
            LeagueRules.CalculateLeagueResult(carrier).Rows.Count,
            dates.Length == 0 ? null : dates[0],
            dates.Length == 0 ? null : dates[^1]);
    }
}

public sealed record ArchiveSeasonCountsResult(int TournamentCount, int PlayerCount, string? FirstTournamentDate, string? LastTournamentDate);
```

  - [ ] 3.8 Run `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentCommandsTests"` — the unit tests must now be green.

- [ ] 4. API — request and response records
  - [ ] 4.1 Create `backend/src/Gones.Api/Archive/ArchiveTournamentCommandEndpoints.cs` with `namespace Gones.Api.Archive;` and the usings `System.Security.Claims`, `System.Security.Cryptography`, `System.Text`, `System.Text.Json`, `Gones.Api.Errors`, `Gones.Api.Organizations`, `Gones.Api.Security`, `Gones.Application.Concurrency`, `Gones.Domain.Archive`, `Gones.Domain.Leagues`, `Gones.Infrastructure.Persistence`, `Microsoft.AspNetCore.Mvc`, `Microsoft.EntityFrameworkCore`, `NodaTime`, `NodaTime.Serialization.SystemTextJson`, `Npgsql`, `NpgsqlTypes`.
  - [ ] 4.2 Append every request record from "Interface contract → Produces — request records" at the bottom of the file.
  - [ ] 4.3 Append every response record from "Interface contract → Produces — response records" below them.

- [ ] 5. API — `ArchiveTournamentCommandService`
  - [ ] 5.1 In the same file add `internal sealed class ArchiveTournamentCommandService(GonesDbContext database, IClock clock)` — **no `PlayerStatisticsRebuildService` parameter**; statistics are another ticket's scope and adding the dependency here would silently widen it.
  - [ ] 5.2 Add the shared guards:

```csharp
    private LocalDate Today() => clock.GetCurrentInstant().InUtc().Date;

    private void RequireUnlocked(LocalDate tournamentDate, bool isAdmin)
    {
        if (isAdmin) return;
        if (ArchiveLockRule.IsLocked(tournamentDate, Today())) throw new ResourceConflictException("archiveTournamentLocked");
    }

    private static void RequireVersion(ArchiveTournamentAggregate aggregate, long expectedVersion)
    {
        if (aggregate.Version != expectedVersion) throw new ConcurrencyConflictException();
    }

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private static string NewId() => Guid.NewGuid().ToString("D");
```

  - [ ] 5.3 Add the locking load. It takes a row lock so two concurrent writers of the same Tournament serialize before either transform runs, mirroring `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:322-330`:

```csharp
    private async Task<ArchiveTournamentAggregate> LockRowAsync(string tournamentId, CancellationToken cancellationToken) =>
        await database.ArchiveTournaments
            .FromSqlInterpolated($"SELECT * FROM archive_tournaments WHERE document_id = {tournamentId} AND deleted_at IS NULL FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
        ?? throw new ResourceNotFoundException();
```

  - [ ] 5.4 Add the Season existence check (`AsNoTracking`, so the row is never tracked and can never be version-bumped):

```csharp
    private async Task RequireSeasonAsync(string? seasonId, CancellationToken cancellationToken)
    {
        if (seasonId is null) return;
        if (string.IsNullOrWhiteSpace(seasonId)) throw Validation("seasonId", "Season ID cannot be blank; use null for a standalone Tournament.");
        var exists = await database.ArchiveLeagueSeasons.AsNoTracking()
            .AnyAsync(item => item.DocumentId == seasonId && item.DeletedAt == null, cancellationToken);
        if (!exists) throw new ResourceNotFoundException();
    }
```

  - [ ] 5.5 Add the counter recomputation, using the raw `UPDATE` from "Interface contract → Produces — the Season counter write". It must be called **after** `SaveChangesAsync` and **before** `CommitAsync`:

```csharp
    private async Task RecomputeSeasonCountsAsync(IEnumerable<string?> seasonIds, CancellationToken cancellationToken)
    {
        // Ordered so two opposing concurrent moves take the two Season row locks in the same order.
        var ids = seasonIds.OfType<string>().Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        foreach (var seasonId in ids)
        {
            var documents = await database.ArchiveTournaments.AsNoTracking()
                .Where(item => item.SeasonId == seasonId && item.DeletedAt == null)
                .ToListAsync(cancellationToken);
            var counts = ArchiveSeasonCounts.From(documents.Select(item => item.ReadDocument()).ToArray());
            /* the parameterized UPDATE from the Interface contract section */
        }
    }
```

  - [ ] 5.6 Add the single mutate funnel every existing-row route goes through:

```csharp
    public async Task<ArchiveTournamentCommandResponse> MutateAsync(
        string tournamentId,
        Guid actorId,
        bool isAdmin,
        long expectedVersion,
        string auditAction,
        IReadOnlyList<string> fields,
        Func<ArchiveTournamentDocument, ArchiveTournamentDocument> command,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var aggregate = await LockRowAsync(tournamentId, cancellationToken);
        RequireVersion(aggregate, expectedVersion);
        RequireUnlocked(aggregate.TournamentDate, isAdmin);
        var previousSeasonId = aggregate.SeasonId;
        ArchiveTournamentDocument changed;
        try
        {
            changed = command(aggregate.ReadDocument());
        }
        catch (ArgumentException exception) { throw Validation(exception.ParamName ?? "command", exception.Message); }
        catch (KeyNotFoundException) { throw new ResourceNotFoundException(); }
        catch (InvalidOperationException) { throw new ResourceConflictException(); }
        RequireUnlocked(ArchiveTournamentCommands.ParseDate(changed.TournamentDate), isAdmin);
        await RequireSeasonAsync(changed.SeasonId, cancellationToken);
        try { aggregate.Apply(changed, clock.GetCurrentInstant()); }
        catch (ArgumentException exception) { throw Validation(exception.ParamName ?? "command", exception.Message); }
        catch (InvalidOperationException) { throw new ResourceConflictException(); }
        AddAudit(actorId, auditAction, aggregate.DocumentId, fields);
        try { await database.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateConcurrencyException) { throw new ConcurrencyConflictException(); }
        await RecomputeSeasonCountsAsync([previousSeasonId, changed.SeasonId], cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Response(aggregate);
    }
```

  - [ ] 5.7 Add `CreateAsync(Guid actorId, bool isAdmin, string idempotencyKey, CreateArchiveTournamentRequest request, CancellationToken)`: validate the date with `ArchiveTournamentCommands.ParseDate`, `RequireUnlocked(parsedDate, isAdmin)`, `await RequireSeasonAsync(request.SeasonId, …)`, build the document with `ArchiveTournamentCommands.Create(NewId(), request.SeasonId, request.Name, request.TournamentDate)`, `database.ArchiveTournaments.Add(ArchiveTournamentAggregate.Create(document, clock.GetCurrentInstant()))`, audit `archive.tournament.created` with fields `["tournament"]`, `SaveChangesAsync`, then `RecomputeSeasonCountsAsync([request.SeasonId], …)`. Wrap the whole body in `ExecuteIdempotentAsync`.
  - [ ] 5.8 Add `DeleteAsync(string tournamentId, Guid actorId, bool isAdmin, long expectedVersion, CancellationToken)`: same funnel as 5.6 but calling `aggregate.SoftDelete(clock.GetCurrentInstant())` instead of `Apply`, auditing `archive.tournament.deleted` with fields `["deletedAt"]`, recomputing the old Season, and returning `new ArchiveDeleteResponse(aggregate.DocumentId, true, aggregate.Version, StrongETag.Encode(aggregate.Version))`.
  - [ ] 5.9 Add `AddAudit` and `Response`:

```csharp
    private void AddAudit(Guid actorId, string action, string entityId, IReadOnlyList<string> fields) => database.AuditRecords.Add(new AuditRecord
    {
        ActorId = actorId,
        Action = action,
        EntityType = "archive_tournament",
        EntityId = entityId,
        RedactedDiff = JsonSerializer.Serialize(new { fields }, StoredJsonOptions),
        OccurredAt = clock.GetCurrentInstant()
    });

    private static ArchiveTournamentCommandResponse Response(ArchiveTournamentAggregate aggregate)
    {
        var document = aggregate.ReadDocument();
        return new ArchiveTournamentCommandResponse(
            document.Id, document.SeasonId, document.Name, document.TournamentDate, document.Status,
            document.Rounds, document.PlayerArchetypes,
            aggregate.Version, aggregate.UpdatedAt, StrongETag.Encode(aggregate.Version));
    }
```

  - [ ] 5.10 Add the idempotency helper, ported from `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:361-401` with a simpler stored payload:

```csharp
    private static readonly JsonSerializerOptions StoredJsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        .ConfigureForNodaTime(DateTimeZoneProviders.Tzdb);

    private sealed record StoredArchiveCommand(string RequestHash, string ResponseJson);

    private async Task<T> ExecuteIdempotentAsync<T>(Guid actorId, string key, string command, object request, Func<Task<T>> execute, CancellationToken cancellationToken)
    {
        var scope = $"archive-command:{actorId:D}:{command}";
        var requestHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request, StoredJsonOptions))));
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await database.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({scope}), hashtext({key}))", cancellationToken);
        var existing = await database.IdempotencyRecords.AsNoTracking().SingleOrDefaultAsync(item => item.Scope == scope && item.Key == key, cancellationToken);
        if (existing is not null)
        {
            var stored = JsonSerializer.Deserialize<StoredArchiveCommand>(existing.ResponseBody, StoredJsonOptions)
                ?? throw new InvalidOperationException("Stored archive command response is invalid.");
            if (stored.RequestHash != requestHash) throw new IdempotencyConflictException();
            await transaction.CommitAsync(cancellationToken);
            return JsonSerializer.Deserialize<T>(stored.ResponseJson, StoredJsonOptions)!;
        }

        var response = await execute();
        var now = clock.GetCurrentInstant();
        database.IdempotencyRecords.Add(new IdempotencyRecord
        {
            Scope = scope,
            Key = key,
            ResponseStatusCode = StatusCodes.Status201Created,
            ResponseBody = JsonSerializer.Serialize(new StoredArchiveCommand(requestHash, JsonSerializer.Serialize(response, StoredJsonOptions)), StoredJsonOptions),
            CreatedAt = now,
            ExpiresAt = now + Duration.FromHours(24)
        });
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return response;
    }
```

  - [ ] 5.11 Add `ApplyEditBatchAsync(string tournamentId, Guid actorId, bool isAdmin, long expectedVersion, ArchiveTournamentEditBatchRequest request, CancellationToken)`. It validates through `ValidateEditBatch` (step 5.12), then calls `MutateAsync` once with a composed command: `document => { var edited = ArchiveTournamentCommands.ApplyEditBatch(document, batch); return request.MoveToSeason is null ? edited : ArchiveTournamentCommands.MoveToSeason(edited, request.MoveToSeason.SeasonId); }`, audit action `archive.tournament.edit_batch.applied`, fields = the intent names present. One `MutateAsync` call is what keeps ADR 0037's single-version-bump promise.
  - [ ] 5.12 Add `ValidateEditBatch`, ported from `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:518-532`: every intent array must be non-null; every intent row and its `Entries` must be non-null; the batch must not be empty — empty means `MoveToSeason is null && EditTournament is null && Status is null && AddRounds.Count == 0 && DeleteRoundIds.Count == 0 && ReplaceRounds.Count == 0 && UpdateArchetypes.Count == 0` → `Validation("command", "Edit batch cannot be empty.")`. Return `new ArchiveTournamentEditBatch(request.EditTournament, request.AddRounds, request.DeleteRoundIds, request.ReplaceRounds, request.UpdateArchetypes, request.Status)`.
  - [ ] 5.13 Add `RestoreAsync(Guid actorId, string key, ArchiveRestoreRequest request, string expectedKind, int leagueCap, int seasonCap, int tournamentCap, CancellationToken)`:
    - validate `request.Kind == expectedKind` else `Validation("kind", $"Expected {expectedKind} export.")`;
    - validate `request.Version == 5` else `Validation("version", "Archive bundle version is unsupported.")`;
    - validate the three caps else `Validation("<collection>", "…")`;
    - build `leagueIdMap`, `seasonIdMap` from source id → `NewId()`; reject a `leagueSeasons[].leagueId` absent from `leagueIdMap` and a non-null `tournaments[].seasonId` absent from `seasonIdMap` with `Validation("leagueSeasons"/"tournaments", "Bundle link does not resolve inside the bundle.")`;
    - uniquify each League and Season name against the stored names plus the names added in this call, with the existing algorithm from `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:494-503` (`name`, then `"{name} (restored)"`, then `"{name} (restored) {n}"`);
    - remap Tournaments with `ArchiveTournamentCommands.Restore(tournamentsWithNewSeasonIds, NewId)`;
    - add every aggregate, audit `archive.league.restored` / `archive.league_season.restored` / `archive.tournament.restored`, `SaveChangesAsync`, then `RecomputeSeasonCountsAsync(newSeasonIds, …)`;
    - return `ArchiveRestoreResponse`; wrap the whole body in `ExecuteIdempotentAsync` with command `"restore"` / `"restore-full"`.
    - **Do not call `RequireUnlocked` anywhere in this method** — restore is the historical-import path and is exempt by design.

- [ ] 6. API — map the routes
  - [ ] 6.1 In the same file add `internal static class ArchiveTournamentCommandEndpoints` with `public static void MapArchiveTournamentCommandEndpoints(this WebApplication app)` and the group `var archive = app.MapGroup("/api/archive").RequireAuthorization(AuthorizationPolicies.Organizer);`.
  - [ ] 6.2 Map the sixteen routes exactly as the "Produces — routes" table lists them, each with its `.WithName(...)` and a `.Produces<T>()` matching the "Body out" column (`.Produces<ArchiveTournamentCommandResponse>(StatusCodes.Status201Created)` for the create, `.Produces<ArchiveRestoreResponse>(StatusCodes.Status201Created)` for both restores).
  - [ ] 6.3 Add the two header helpers, copied from `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:465-479`:

```csharp
    private static long RequiredVersion(string? value)
    {
        if (!StrongETag.TryDecode(value, out var version)) throw new ConcurrencyConflictException();
        return version;
    }

    private static string RequiredIdempotencyKey(string? value)
    {
        var key = value?.Trim();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200)
            throw new ApiValidationException(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["Idempotency-Key header is required and cannot exceed 200 characters."] });
        return key;
    }
```

  - [ ] 6.4 Add the shared `MutateAsync(HttpResponse response, Task<ArchiveTournamentCommandResponse> pending)` wrapper that awaits, sets `response.Headers.ETag = result.ETag` and returns `Results.Ok(result)`.
  - [ ] 6.5 Wire each handler to `service.MutateAsync(...)` with the exact audit action and fields:

| Route | audit action | fields |
| --- | --- | --- |
| `PATCH /{id}` | `archive.tournament.edited` | `["name","tournamentDate","status"]` |
| `PATCH /{id}/season` | `archive.tournament.season.changed` | `["seasonId"]` |
| `POST /{id}/rounds` | `archive.tournament.round.added` | `["rounds"]` |
| `DELETE /{id}/rounds/{roundId}` | `archive.tournament.round.deleted` | `["rounds"]` |
| `POST /{id}/rounds/{roundId}/import` | `archive.tournament.round.imported` | `["rounds","playerArchetypes"]` |
| `POST /{id}/rounds/{roundId}/replace` | `archive.tournament.round.replaced` | `["rounds"]` |
| `POST /{id}/rounds/{roundId}/entries` | `archive.tournament.entry.added` | `["entries"]` |
| `PATCH /{id}/rounds/{roundId}/entries/{entryId}` | `archive.tournament.entry.edited` | `["entries"]` |
| `DELETE /{id}/rounds/{roundId}/entries/{entryId}` | `archive.tournament.entry.deleted` | `["entries"]` |
| `PATCH /{id}/archetypes/{playerName}` | `archive.tournament.archetype.updated` | `["playerArchetypes"]` |
| `POST /{id}/players/rename` | `archive.tournament.player_name.renamed` | `["playerNames"]` |
| `POST /{id}/edit-batch` | `archive.tournament.edit_batch.applied` | present intent names |

  - [ ] 6.6 In the round-add handler mint the id before the call: `var roundId = NewId();` then `document => ArchiveTournamentCommands.AddRound(document, roundId)`.
  - [ ] 6.7 In the import handler call `var imported = RoundCsvAdapter.Import(request.Text, NewId);` and pass `imported.Entries` with `mergeImportedArchetypes: true`; the replace handler passes `request.Entries` with `false`.
  - [ ] 6.8 In the entry-add handler force a fresh id and in the entry-edit handler force the route id, with the exact `switch` from `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:141-148` and `:157-163`.
  - [ ] 6.9 Every handler resolves `isAdmin` as `OrganizationPrincipal.IsAdmin(principal)` and `actorId` as `OrganizationPrincipal.UserId(principal)`.
  - [ ] 6.10 In `backend/src/Gones.Api/Program.cs`, after line 120 `builder.Services.AddScoped<LeagueCommandService>();`, add `builder.Services.AddScoped<ArchiveTournamentCommandService>();`.
  - [ ] 6.11 In `backend/src/Gones.Api/Program.cs`, after line 240 `app.MapLeagueCommandEndpoints();`, add `app.MapArchiveTournamentCommandEndpoints();` and the matching `using Gones.Api.Archive;` if the file does not already import it.
  - [ ] 6.12 Run `npm run backend:build` and fix compile errors.

- [ ] 7. Green — make the integration tests pass
  - [ ] 7.1 Run `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentCommandApiTests"` and fix until green.
  - [ ] 7.2 Run `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentLockApiTests"` and fix until green.
  - [ ] 7.3 Run `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveRestoreApiTests"` and fix until green.
  - [ ] 7.4 Run `npm run backend:test` and confirm no previously green test regressed — in particular `LeagueCommandApiTests`, `LeagueArchiveRouteTests`, `ApiBoundaryTests` and `MigrationSafetyTests`.

- [ ] 8. Refresh the generated API client
  - [ ] 8.1 Ensure a local Postgres is reachable at the default `Host=127.0.0.1;Port=5432;Database=gones;Username=gones;Password=gones`, or export `GONES_DB_CONNECTION`. `npm run db:reset` prepares one.
  - [ ] 8.2 Run `npm run api:generate`. It rewrites `backend/openapi/gones.json` and `src/app/api/generated/gones-api.ts`.
  - [ ] 8.3 Run `npm run api:check` — it must exit `0`.
  - [ ] 8.4 Run `npm run typecheck` and `npm run lint` — both must be clean. Do not hand-edit the generated client; if it does not typecheck, fix the C# record or route that produced it and regenerate.

- [ ] 9. Final validation and commit
  - [ ] 9.1 Run the full gate: `npm run test && npm run typecheck && npm run lint && npm run backend:build && npm run backend:test && npm run api:check`.
  - [ ] 9.2 Confirm `git status` shows no file under `src/app/**` other than `src/app/api/generated/gones-api.ts`, and no new file under `backend/src/Gones.Infrastructure/Persistence/Migrations/`.
  - [ ] 9.3 Commit with `feat(archive): write Tournaments through their own rows and freeze them after a year`.

## Outputs

Files added:

- `backend/src/Gones.Domain/Archive/ArchiveTournamentCommands.cs`
- `backend/src/Gones.Domain/Archive/ArchiveSeasonCounts.cs`
- `backend/src/Gones.Api/Archive/ArchiveTournamentCommandEndpoints.cs`
- `backend/tests/Gones.UnitTests/ArchiveTournamentCommandsTests.cs`
- `backend/tests/Gones.IntegrationTests/ArchiveTournamentCommandApiTests.cs`
- `backend/tests/Gones.IntegrationTests/ArchiveTournamentLockApiTests.cs`
- `backend/tests/Gones.IntegrationTests/ArchiveRestoreApiTests.cs`
- `backend/src/Gones.Domain/Archive/ArchiveLockRule.cs` — **only** if step 1.4 found it missing.

Files edited:

- `backend/src/Gones.Api/Program.cs` — two added lines (service registration, endpoint mapping).
- `backend/openapi/gones.json` — regenerated.
- `src/app/api/generated/gones-api.ts` — regenerated.

Public API / behaviour change:

- Sixteen new authenticated command routes under `/api/archive`. No existing route changes shape or status code.
- One new wire error code: `archiveTournamentLocked` at `409`.
- New audit actions under the `archive.` prefix with `entity_type = "archive_tournament"`.

Migrate / config:

- **No EF migration.** No new configuration key, no new environment variable, no new authorization policy.
- Known, accepted gap handed to the next tickets: `player_statistics` is not rebuilt by any path added here, so ratings do not yet reflect the new archive. The scoped-statistics ticket re-keys that table and wires the rebuild into this write transaction. The archive is empty at this point in the plan, so nothing is stale in practice.

## Validation

- [ ] `npm run backend:build` — exit `0`.
- [ ] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentCommandsTests"` — exit `0`.
- [ ] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentCommandApiTests"` — exit `0`.
- [ ] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentLockApiTests"` — exit `0`; in particular the 365-day case passes and the 366-day case is refused.
- [ ] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveRestoreApiTests"` — exit `0`.
- [ ] `npm run backend:test` — exit `0`, no regression in `LeagueCommandApiTests`, `LeagueArchiveRouteTests`, `ApiBoundaryTests`, `MigrationSafetyTests`.
- [ ] `npm run api:check` — exit `0` (regenerate with `npm run api:generate` first).
- [ ] `npm run typecheck` — exit `0`.
- [ ] `npm run lint` — exit `0`.
- [ ] `npm run test` — exit `0` (frontend untouched; this proves it).
- [ ] Manual check with the API running and a `db:reset` database:

```bash
# Organizer creates a standalone Tournament dated today -> 201
curl -sS -i -X POST http://127.0.0.1:5000/api/archive/tournaments \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: manual-1' \
  -H 'X-Test-User: 10000000-0000-0000-0000-000000000001' -H 'X-Test-Roles: Organizer' \
  -d '{"name":"Standalone","tournamentDate":"'"$(date -u +%F)"'","seasonId":null}'

# Organizer creates one dated 366 days ago -> 409 archiveTournamentLocked
curl -sS -X POST http://127.0.0.1:5000/api/archive/tournaments \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: manual-2' \
  -H 'X-Test-User: 10000000-0000-0000-0000-000000000001' -H 'X-Test-Roles: Organizer' \
  -d '{"name":"Old","tournamentDate":"'"$(date -u -d '366 days ago' +%F)"'","seasonId":null}' | grep archiveTournamentLocked

# Same call as Admin -> 201
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:5000/api/archive/tournaments \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: manual-3' \
  -H 'X-Test-User: 10000000-0000-0000-0000-000000000001' -H 'X-Test-Roles: Admin' \
  -d '{"name":"Old","tournamentDate":"'"$(date -u -d '366 days ago' +%F)"'","seasonId":null}'
```

- [ ] App functional — no broken path from this slice: the legacy `/api/leagues-archive/**` surface and the legacy archive pages still answer exactly as before, because nothing in this ticket edits them.
- [ ] commit msg draft: `feat(archive): write Tournaments through their own rows and freeze them after a year`
