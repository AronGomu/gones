# T3: League and LeagueSeason command endpoints

> ## ⚠ ARBITRATION OVERRIDE — read before the body; these win over anything below
>
> **A. `DocumentVersion` is `int`, not `long`** — both occurrences. Archive rows deliberately do not
> derive `VersionedEntity` (that base forces a `Guid` PK and a `long Version`); the binding DDL is
> `document_id text PRIMARY KEY` with `version integer`, mapped `.IsConcurrencyToken()`. Precedent:
> `PlayerStatisticsRow` does not derive it either. **Load-bearing consequence:**
> `GonesDbContext.IncrementVersions` only auto-bumps `VersionedEntity`, so this ticket must increment
> `version` **explicitly** on every write.
>
> **B. Wire error codes are snake_case.** The body emits `staleArchiveDocument` and
> `archiveLeagueNotEmpty`. The repo emits snake_case codes API-wide from
> `backend/src/Gones.Api/Errors/ApiExceptions.cs`, so use `stale_version` (the existing type) and the
> new `archive_league_not_empty`. HTTP statuses are unchanged: `412` and `409`.
> The **browser-local** mirror keeps camelCase `staleArchiveDocument` — that is a local string, not a
> wire code, and the UX classifier keys on HTTP status first.
>
> **C. The three entity classes are `Archive`-prefixed** — `ArchiveLeague`, `ArchiveLeagueSeason`,
> `ArchiveTournament` in `Gones.Domain.Archive`, with documents `ArchiveLeagueDocument`,
> `ArchiveLeagueSeasonDocument`, `ArchiveTournamentDocument`. Use whatever T2 actually shipped if it
> differs; never rename another ticket's symbol.
>
> **D. Endpoint operation names are noun-first** — `ArchiveLeagueCreate`, `ArchiveLeagueRename`,
> `ArchiveLeagueDelete`, `ArchiveLeagueSeasonCreate`, `ArchiveLeagueSeasonRename`,
> `ArchiveLeagueSeasonChangeStatus`, `ArchiveLeagueSeasonMoveToLeague`, `ArchiveLeagueSeasonDelete`.
> Legacy `{Verb}Archive{Noun}` names live in `LeagueCommandEndpoints.cs` until T19, and two endpoints
> sharing a `.WithName()` throws at startup.

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T2
**Commit outcome:** Leagues and LeagueSeasons are creatable, renamable, re-parentable and deletable over HTTP.

## Context (self-contained)

- Goal: rebuild the Gones Archive on three tiers — **League → LeagueSeason → Tournament**. A Tournament
  becomes a first-class top-level record that may stand alone (`seasonId: null`); today's flat `League`
  becomes `LeagueSeason`; a brand-new `League` tier groups Seasons. Everything named `leagues-archive`
  becomes `archive`.
- This slice: the **write half of the two upper tiers**. T2 created the three tables
  (`archive_leagues`, `archive_league_seasons`, `archive_tournaments`) and their EF entities, but nothing
  can put a row in them over HTTP yet. T3 adds exactly eight organizer-gated command routes under
  `/api/archive` so a League and a LeagueSeason can be created, renamed, re-parented and deleted.
  T4 adds the Tournament commands on top of the response records this ticket defines.
- Out of scope here — **do not touch**:
  - **No Tournament command endpoints.** `POST/PATCH/DELETE /api/archive/tournaments**`,
    `.../rounds**`, `.../entries**`, `.../archetypes**`, `.../edit-batch`, `.../players/rename`,
    `/api/archive/restore`, `/api/archive/restore-full` all belong to T4. The only Tournament row this
    ticket ever writes is the `season_id = NULL` detach performed when a Season is deleted.
  - **No read endpoints.** `GET /api/archive/leagues/all`, `/league-seasons/all`, `/tournaments/all`,
    `/years`, `/league-seasons/{id}/tournaments`, `/tournaments/{id}`, `/tournaments/{id}/result`,
    `/league-seasons/{id}/result`, `/global-player-statistics*` belong to T5, T6, T7 and T8.
  - **No frontend.** No Angular component, service, route, i18n key or Cypress spec. The only two
    frontend-tree files this ticket may change are the machine-generated
    `backend/openapi/gones.json` and `src/app/api/generated/gones-api.ts`, rewritten wholesale by
    `npm run api:generate` — see step 8 and the decision note under `Assumptions in force`.
  - **Do not delete `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs`** or any other legacy
    file. The legacy `/api/leagues-archive/**` surface keeps serving until T17. Every commit between
    T2 and T17 must compile and run with **both** surfaces mounted.
  - No `player_statistics` work. `PlayerStatisticsRebuildService` is **not** called from this ticket
    (T8 re-keys the read model by scope and owns that wiring). The legacy `LeagueCommandService`
    keeps calling it; the new `ArchiveCommandService` does not.
  - No `ops/acceptance-matrix.json` row. `ops/acceptance-matrix.test.ts` only validates rows that
    already exist; it does not demand one per endpoint. T17 refreshes the matrix.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** Local data may
    be reset freely. Between T2 and T13 the archive is empty and the legacy pages render an empty list —
    that is expected, not a bug.
  - **The brief's error table names `notFound`, `invalidRequest` and `forbidden`; the codebase already
    emits `not_found`, `validation_failed` and `forbidden` for those exact statuses.** The codebase
    wins for those three: `ResourceNotFoundException` → `404 not_found`,
    `ApiValidationException` → `400 validation_failed`, and a policy rejection →
    `403 forbidden` produced by the `UseStatusCodePages` map at
    `backend/src/Gones.Api/Program.cs:189-213` (an endpoint cannot produce that body itself). Changing
    those two strings would rewrite the wire contract of every existing endpoint, which is far outside
    this fence. Only the two genuinely new codes are introduced verbatim as the brief writes them:
    `staleArchiveDocument` (412) and `archiveLeagueNotEmpty` (409). The frontend classifier keys on
    **HTTP status first**, so this costs nothing on the client — see
    `src/app/data/league-archive-command-ux.ts:22-32`, which tests `status === 403`, `status === 412`
    and only then a message string.
  - **No `Idempotency-Key` header on the two creation POSTs.** The legacy
    `POST /api/leagues-archive` requires one, but the brief's route table lists no idempotency error
    and the frontend that will call these routes (T13) is being written in parallel and cannot be told
    to send one. A route that ignores an unknown header works for both a client that sends it and a
    client that does not; a route that requires one breaks the client that does not. Recorded as a
    decision, not an oversight.
  - **Optimistic concurrency travels as `If-Match` carrying a strong ETag**, exactly as every other
    versioned Gones write does (`StrongETag.Encode/TryDecode` in
    `backend/src/Gones.Application/Concurrency/StrongETag.cs`). The brief's phrase "via
    documentVersion" and its own `412` row (`documentVersion` / `If-Match` mismatch) describe the same
    thing: the ETag is the base64 big-endian encoding of the document version, and the response body
    carries `documentVersion` alongside `eTag`.
  - **The generated API client is regenerated in this commit.** `.github/workflows/static.yml:21` runs
    `npm run api:check`, which diffs `backend/openapi/gones.json` and
    `src/app/api/generated/gones-api.ts` against a freshly booted API. Adding eight routes without
    regenerating turns that gate red. Both files are machine output, so this is not the hand-written
    frontend the fence excludes.

## Requirements

1. A new file `backend/src/Gones.Api/Archive/ArchiveCommandEndpoints.cs`, namespace `Gones.Api.Archive`,
   maps exactly these eight routes and no others.
2. All eight routes sit in one `app.MapGroup("/api/archive").RequireAuthorization(AuthorizationPolicies.Organizer)`
   group, mirroring `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:25`. Anonymous → `401`,
   role `User` → `403 forbidden`, roles `Organizer` and `Admin` → allowed.
3. Every route that mutates an existing row requires `If-Match`. A missing, malformed or non-matching
   `If-Match` returns `412` with `code: "staleArchiveDocument"`. A successful mutation bumps that row's
   `version` by exactly `1`, sets its `updated_at`, and returns the new strong ETag both in the `ETag`
   response header and in the body's `eTag` field.
4. `DELETE /api/archive/leagues/{leagueId}` returns `409` with `code: "archiveLeagueNotEmpty"` while any
   non-deleted LeagueSeason still references that League.
5. `DELETE /api/archive/league-seasons/{seasonId}` **detaches** every non-deleted Tournament that
   references it — sets `season_id = NULL`, bumps that Tournament's `version` and `updated_at` — inside
   the same transaction that soft-deletes the Season. It never deletes tournament data.
6. Concurrency is **per row**. Creating, renaming, re-parenting or deleting a LeagueSeason never bumps
   the `version` of its parent League. Detaching a Tournament never bumps the Season's or League's
   version beyond the one bump the Season's own delete already made.
7. Deletes are **soft**: `deleted_at` is stamped, the row stays. Every command resolves its target with
   `deleted_at IS NULL`; a soft-deleted or absent id is `404 not_found`.
8. Integration tests in `backend/tests/Gones.IntegrationTests/ArchiveCommandApiTests.cs` covering every
   route, every status code and the detach invariant.
9. `npm run backend:build`, `npm run backend:test`, `npm run api:check`, `npm run typecheck` and
   `npm run test` all pass. The legacy `/api/leagues-archive/**` surface still answers unchanged.

## Inputs

Read these before writing a line. Every fact this ticket relies on is at one of these locations.

- `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:20-47` — the organizer route-group idiom to
  copy: `app.MapGroup("/api/leagues-archive").RequireAuthorization(AuthorizationPolicies.Organizer)`,
  then `organizer.MapPost(...).WithName(...).Produces<T>(...)` one line per route.
- `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:49-66` — handler shape: `Results.Created($"…/{id}", response)`
  for a create, `httpResponse.Headers.ETag = response.ETag` on every success.
- `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:196-218` — `MutateAsync` (196), `RequiredVersion`
  (204) and `Validation` (218) helpers; `RequiredVersion` throws when `StrongETag.TryDecode` fails.
- `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:363-379` — the `FromSqlInterpolated(… FOR UPDATE)`
  row-locking idiom used inside an explicit `BeginTransactionAsync`.
- `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:498-535` — `RequireActiveAsync` (498),
  `RequireVersion` (503), `SaveAsync` (507, catching `DbUpdateConcurrencyException`) and `AddAudit` (527).
- `backend/src/Gones.Api/Security/AuthorizationPolicies.cs:19` — `public const string Organizer = "global-organizer";`
  The policy is `policy.RequireRole("Organizer", "Admin")` at line 68.
- `backend/src/Gones.Api/Errors/ApiExceptions.cs:3-9` — `public abstract class ApiException(string code, string safeMessage, int statusCode)`.
  This is the base for the two new archive exceptions.
- `backend/src/Gones.Api/Errors/ApiExceptions.cs:11-16,22` — `ApiValidationException(IReadOnlyDictionary<string, string[]>)`
  → `400 validation_failed`; `ResourceNotFoundException()` → `404 not_found`.
- `backend/src/Gones.Api/Errors/ApiExceptionHandler.cs:14-45` — how `ApiException.Code` reaches the wire:
  `problem.Extensions["code"] = code`, `problem.Extensions["message"] = message`,
  content type `application/problem+json`.
- `backend/src/Gones.Api/Program.cs:189-213` — `UseStatusCodePages` turns a bare `403` into
  `code: "forbidden"`, a bare `401` into `"unauthorized"`.
- `backend/src/Gones.Api/Program.cs:120` — `builder.Services.AddScoped<LeagueCommandService>();`
  (the line the new service registration goes next to).
- `backend/src/Gones.Api/Program.cs:239-240` — `app.MapPublicLeagueEndpoints(); app.MapLeagueCommandEndpoints();`
  (the lines the new mapping call goes next to; both are inside `if (runtimeConfiguration.Features.AuthV1)`).
- `backend/src/Gones.Api/Program.cs:1-29` — the `using` block the new `using Gones.Api.Archive;` joins,
  kept in the existing alphabetical-ish order right after `using Gones.Api.Admin;`.
- `backend/src/Gones.Application/Concurrency/StrongETag.cs` — `Encode(long) -> string` (quoted base64,
  throws below 1) and `TryDecode(string?, out long) -> bool` (rejects weak and malformed tags).
- `backend/src/Gones.Api/Organizations/OrganizationService.cs:418-424` —
  `internal static class OrganizationPrincipal { public static Guid UserId(ClaimsPrincipal principal); }`
  in namespace `Gones.Api.Organizations`.
- `backend/src/Gones.Domain/Persistence/SharedRecords.cs:5-9,27-35` — `VersionedEntity` (`Guid Id`,
  `long Version`) and `AuditRecord` (`ActorId`, `Action`, `EntityType`, `EntityId`, `RedactedDiff`, `OccurredAt`).
- `backend/src/Gones.Infrastructure/Persistence/SharedRecordConfigurations.cs:55` —
  `builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(entity => entity.ActorId)`, the FK that
  makes a real user row mandatory for the audit actor in the tests.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs:78-99` — `IncrementVersions()`, which
  forces `Version = 1` on `Added` and `OriginalValue + 1` on `Modified`, but **only** for
  `VersionedEntity` subclasses. Line 58-63 marks `Version` as a concurrency token for the same set.
- `backend/src/Gones.Infrastructure/Persistence/SnakeCaseModelBuilderExtensions.cs` — every CLR property
  name is snake_cased into its column name, so `SeasonId` ⇄ `season_id`, `DeletedAt` ⇄ `deleted_at`.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContextOptions.cs:10` —
  `options.UseNpgsql(connectionString, npgsql => npgsql.UseNodaTime())`, so a NodaTime `Instant`
  interpolated into raw SQL binds as `timestamptz`.
- `backend/tests/Gones.IntegrationTests/LeagueCommandApiTests.cs:17-60` — the integration-test skeleton
  to copy: `IAsyncLifetime`, a `PostgreSqlTestContainer`, `MigrateAsync()`, an `ApplicationUser` row for
  the audit actor's FK, then `new WebApplicationFactory<Program>().WithWebHostBuilder(...)` with
  `UseEnvironment("Testing")` and the four `UseSetting` values.
- `backend/tests/Gones.IntegrationTests/LeagueCommandApiTests.cs:381-408` — the `SendJsonAsync`,
  `Body` and `AssertProblem` helpers, verbatim reusable.
- `backend/src/Gones.Api/Security/AuthorizationPolicies.cs:126-150` — `NoIdentityAuthenticationHandler`:
  in the `Testing` environment, `X-Test-User` and `X-Test-Roles` headers stand in for a JWT.

**From Depends (T2) — spelled out, the worker cannot read the T2 ticket:**

T2 created the migration `RebuildArchiveThreeTier` in
`backend/src/Gones.Infrastructure/Persistence/Migrations/` producing exactly this schema. This DDL is
binding and is what the raw SQL below is written against:

```sql
CREATE TABLE archive_leagues (
  document_id      text PRIMARY KEY,
  name             text NOT NULL,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  version          integer NOT NULL,
  deleted_at       timestamptz NULL
);

CREATE TABLE archive_league_seasons (
  document_id            text PRIMARY KEY,
  league_id              text NOT NULL REFERENCES archive_leagues(document_id),
  name                   text NOT NULL,
  status                 text NOT NULL,
  updated_at             timestamptz NOT NULL,
  version                integer NOT NULL,
  deleted_at             timestamptz NULL,
  tournament_count       integer NOT NULL,
  player_count           integer NOT NULL,
  first_tournament_date  date NULL,
  last_tournament_date   date NULL,
  counts_version         integer NOT NULL
);
CREATE INDEX ix_archive_league_seasons_league_id ON archive_league_seasons (league_id);

CREATE TABLE archive_tournaments (
  document_id      text PRIMARY KEY,
  season_id        text NULL REFERENCES archive_league_seasons(document_id),
  name             text NOT NULL,
  tournament_date  date NOT NULL,
  status           text NOT NULL,
  document         jsonb NOT NULL,
  updated_at       timestamptz NOT NULL,
  version          integer NOT NULL,
  deleted_at       timestamptz NULL,
  player_count     integer NOT NULL,
  counts_version   integer NOT NULL
);
CREATE INDEX ix_archive_tournaments_season_id ON archive_tournaments (season_id);
CREATE INDEX ix_archive_tournaments_tournament_date ON archive_tournaments (tournament_date DESC);
```

T2 also produced, in `backend/src/Gones.Domain/Archive/`, three aggregates named **`League`,
`LeagueSeason` and `Tournament`** — short names inside the `Gones.Domain.Archive` namespace, *not*
`ArchiveLeague`/`ArchiveLeagueSeason`. The two this ticket writes, verbatim:

```csharp
using NodaTime;

namespace Gones.Domain.Archive;

public sealed class League
{
    public const int MaximumDocumentIdLength = 200;
    public const int MaximumNameLength = 200;

    public required string DocumentId { get; init; }
    public string Name { get; private set; } = null!;
    public Instant CreatedAt { get; private set; }
    public Instant UpdatedAt { get; private set; }
    public int Version { get; private set; } = 1;
    public Instant? DeletedAt { get; private set; }

    public static League Create(string documentId, string name, Instant now);
    public void Rename(string name, Instant now);
    public void SoftDelete(Instant now);
}

public sealed class LeagueSeason
{
    public const int MaximumDocumentIdLength = 200;
    public const int MaximumNameLength = 200;
    public const int MaximumStatusLength = 20;

    public required string DocumentId { get; init; }
    public string LeagueId { get; private set; } = null!;
    public string Name { get; private set; } = null!;
    public string Status { get; private set; } = null!;
    public Instant UpdatedAt { get; private set; }
    public int Version { get; private set; } = 1;
    public Instant? DeletedAt { get; private set; }

    public int TournamentCount { get; private set; }
    public int PlayerCount { get; private set; }
    public LocalDate? FirstTournamentDate { get; private set; }
    public LocalDate? LastTournamentDate { get; private set; }
    public int CountsVersion { get; private set; }

    public static LeagueSeason Create(string documentId, string leagueId, string name, string status, Instant now);
    public void Rename(string name, Instant now);
    public void ChangeStatus(string status, Instant now);
    public void MoveToLeague(string leagueId, Instant now);
    public void SoftDelete(Instant now);
    public void RefreshCatalogCounts(ArchiveSeasonCounts counts);
}
```

Four facts from T2 that this ticket depends on and does not re-derive:

1. **The three aggregates deliberately do not derive from `Gones.Domain.Persistence.VersionedEntity`** —
   that base carries a `Guid Id` primary key and a `long Version`, while the binding DDL says
   `document_id text PRIMARY KEY` and `version integer`. So `GonesDbContext.IncrementVersions()` never
   touches them and **every mutator ends in `Version = checked(Version + 1)` itself.** This ticket must
   therefore never bump a version by hand; calling the mutator is the bump.
2. **`Version` is `int`, not `long`.** It widens implicitly into `StrongETag.Encode(long)`, into
   `ArchiveCommandResponse.DocumentVersion`, and into every `long expected` comparison below, so no cast
   is written anywhere. The one place it matters is the test helper in step 2.5, which must read the
   column with `GetInt32`, not `GetInt64`.
3. **`Version` is an explicit EF concurrency token.** `ArchiveAggregateConfigurations.cs` calls
   `builder.Property(x => x.Version).IsConcurrencyToken();` on all three entities. That is what makes the
   racing-writers test in `Test plan` produce a `DbUpdateConcurrencyException` instead of a silent
   last-write-wins.
4. **`LeagueSeason.Create` stamps its own counters** — `TournamentCount = 0`, `PlayerCount = 0`,
   `FirstTournamentDate = null`, `LastTournamentDate = null`,
   `CountsVersion = ArchiveCatalogCounts.Version`. A Season is born with a computed zero, not an unknown
   one, so this ticket never touches `ArchiveCatalogCounts` or `RefreshCatalogCounts`.

DbSets T2 added to `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs`, immediately after
`public DbSet<LeagueArchiveAggregate> LeagueArchiveAggregates => Set<LeagueArchiveAggregate>();`:

```csharp
public DbSet<League> ArchiveLeagues => Set<League>();
public DbSet<LeagueSeason> ArchiveLeagueSeasons => Set<LeagueSeason>();
public DbSet<Tournament> ArchiveTournaments => Set<Tournament>();
```

T2 also produced:

```csharp
namespace Gones.Domain.Archive;

public static class ArchiveLockRule
{
    public const int LockWindowDays = 365;
    public static bool IsLocked(LocalDate tournamentDate, LocalDate today);
}
```

`ArchiveLockRule` is **not used by this ticket** — no League and no LeagueSeason is ever locked, only a
Tournament is, and Tournament writes belong to T4.

`Gones.Domain.Archive.Tournament` exposes `public void MoveToSeason(string? seasonId, Instant now)`,
which is exactly the detach this ticket performs when a Season is deleted. It is deliberately **not**
used: see the note in impl step 6.4.

## Interface contract (level 5)

### Produces — routes

All eight sit under one organizer group. Request and response bodies are `application/json`, camelCase
on the wire (`ConfigureHttpJsonOptions` + `ConfigureForNodaTime` at
`backend/src/Gones.Api/Program.cs:48-53`).

```
POST   /api/archive/leagues                            → 201 ArchiveCommandResponse
PATCH  /api/archive/leagues/{leagueId}/name            → 200 ArchiveCommandResponse
DELETE /api/archive/leagues/{leagueId}                 → 200 ArchiveDeleteResponse
POST   /api/archive/league-seasons                     → 201 ArchiveCommandResponse
PATCH  /api/archive/league-seasons/{seasonId}/name     → 200 ArchiveCommandResponse
PATCH  /api/archive/league-seasons/{seasonId}/status   → 200 ArchiveCommandResponse
PATCH  /api/archive/league-seasons/{seasonId}/league    → 200 ArchiveCommandResponse
DELETE /api/archive/league-seasons/{seasonId}          → 200 ArchiveDeleteResponse
```

| Route | Headers in | Body in | 201/200 | Other statuses |
| --- | --- | --- | --- | --- |
| `POST /api/archive/leagues` | — | `CreateArchiveLeagueRequest` | `201` + `Location: /api/archive/leagues/{id}` + `ETag` | `400` `401` `403` |
| `PATCH /api/archive/leagues/{leagueId}/name` | `If-Match` **required** | `RenameArchiveLeagueRequest` | `200` + `ETag` | `400` `401` `403` `404` `412` |
| `DELETE /api/archive/leagues/{leagueId}` | `If-Match` **required** | none | `200` + `ETag` | `401` `403` `404` `409` `412` |
| `POST /api/archive/league-seasons` | — | `CreateArchiveLeagueSeasonRequest` | `201` + `Location: /api/archive/league-seasons/{id}` + `ETag` | `400` `401` `403` `404` |
| `PATCH /api/archive/league-seasons/{seasonId}/name` | `If-Match` **required** | `RenameArchiveLeagueSeasonRequest` | `200` + `ETag` | `400` `401` `403` `404` `412` |
| `PATCH /api/archive/league-seasons/{seasonId}/status` | `If-Match` **required** | `ChangeArchiveLeagueSeasonStatusRequest` | `200` + `ETag` | `400` `401` `403` `404` `412` |
| `PATCH /api/archive/league-seasons/{seasonId}/league` | `If-Match` **required** | `MoveArchiveLeagueSeasonRequest` | `200` + `ETag` | `400` `401` `403` `404` `412` |
| `DELETE /api/archive/league-seasons/{seasonId}` | `If-Match` **required** | none | `200` + `ETag` | `401` `403` `404` `412` |

OpenAPI operation ids (`.WithName(...)`), all eight verified free of collision across
`backend/src/Gones.Api/`:

```
CreateArchiveLeague · RenameArchiveLeague · DeleteArchiveLeague
CreateArchiveLeagueSeason · RenameArchiveLeagueSeason · ChangeArchiveLeagueSeasonStatus
MoveArchiveLeagueSeason · DeleteArchiveLeagueSeason
```

### Produces — records

All in `backend/src/Gones.Api/Archive/ArchiveCommandEndpoints.cs`, all `internal sealed record`, all at
file scope below the two classes, matching how `LeagueCommandEndpoints.cs:625-661` ends.

```csharp
internal sealed record CreateArchiveLeagueRequest(string? Name);
internal sealed record RenameArchiveLeagueRequest(string? Name);
internal sealed record CreateArchiveLeagueSeasonRequest(string? LeagueId, string? Name, string? Status);
internal sealed record RenameArchiveLeagueSeasonRequest(string? Name);
internal sealed record ChangeArchiveLeagueSeasonStatusRequest(string? Status);
internal sealed record MoveArchiveLeagueSeasonRequest(string? LeagueId);

/// <summary>
/// Tier-agnostic write acknowledgement. Deliberately carries no `name`, `leagueId`, `status` or
/// `seasonId`: the brief hands this same record to the Tournament commands in T4, and a Tournament, a
/// LeagueSeason and a League have no field in common beyond identity and version. Callers refresh the
/// row itself through the catalog reads (T5-T7) after invalidating their cache.
/// </summary>
internal sealed record ArchiveCommandResponse(string Id, long DocumentVersion, Instant UpdatedAt, string ETag);

internal sealed record ArchiveDeleteResponse(string Id, bool Deleted, long DocumentVersion, string ETag);
```

On the wire (`Instant` renders as an ISO-8601 UTC string through
`NodaTime.Serialization.SystemTextJson`):

```json
{ "id": "3f2a…", "documentVersion": 2, "updatedAt": "2026-08-22T10:15:30Z", "eTag": "\"AAAAAAAAAAI=\"" }
{ "id": "3f2a…", "deleted": true, "documentVersion": 2, "eTag": "\"AAAAAAAAAAI=\"" }
```

### Produces — exceptions

```csharp
/// <summary>412. The brief's binding code for an archive optimistic-concurrency miss.</summary>
internal sealed class StaleArchiveDocumentException()
    : ApiException("staleArchiveDocument", "Archive document changed since it was read.", StatusCodes.Status412PreconditionFailed);

/// <summary>409. A League that still has at least one live LeagueSeason cannot be deleted.</summary>
internal sealed class ArchiveLeagueNotEmptyException()
    : ApiException("archiveLeagueNotEmpty", "League still has League Seasons and cannot be deleted.", StatusCodes.Status409Conflict);
```

Both derive from `public abstract class ApiException` in
`backend/src/Gones.Api/Errors/ApiExceptions.cs:3`, so `ApiExceptionHandler` already routes them.
They live in `ArchiveCommandEndpoints.cs`, not in `ApiExceptions.cs` — that shared file is outside this
fence and T4 will reuse both types from `Gones.Api.Archive`.

### Produces — service

```csharp
internal sealed class ArchiveCommandService(GonesDbContext database, IClock clock)
{
    public const int MaximumNameLength = 200;
    public const int MaximumIdLength = 200;

    public Task<ArchiveCommandResponse> CreateLeagueAsync(Guid actorId, CreateArchiveLeagueRequest request, CancellationToken cancellationToken);
    public Task<ArchiveCommandResponse> RenameLeagueAsync(string leagueId, Guid actorId, long expectedVersion, RenameArchiveLeagueRequest request, CancellationToken cancellationToken);
    public Task<ArchiveDeleteResponse>  DeleteLeagueAsync(string leagueId, Guid actorId, long expectedVersion, CancellationToken cancellationToken);
    public Task<ArchiveCommandResponse> CreateSeasonAsync(Guid actorId, CreateArchiveLeagueSeasonRequest request, CancellationToken cancellationToken);
    public Task<ArchiveCommandResponse> RenameSeasonAsync(string seasonId, Guid actorId, long expectedVersion, RenameArchiveLeagueSeasonRequest request, CancellationToken cancellationToken);
    public Task<ArchiveCommandResponse> ChangeSeasonStatusAsync(string seasonId, Guid actorId, long expectedVersion, ChangeArchiveLeagueSeasonStatusRequest request, CancellationToken cancellationToken);
    public Task<ArchiveCommandResponse> MoveSeasonAsync(string seasonId, Guid actorId, long expectedVersion, MoveArchiveLeagueSeasonRequest request, CancellationToken cancellationToken);
    public Task<ArchiveDeleteResponse>  DeleteSeasonAsync(string seasonId, Guid actorId, long expectedVersion, CancellationToken cancellationToken);
}
```

Registered as `builder.Services.AddScoped<ArchiveCommandService>();`.

### Consumes — the T2 domain surface

Binding, produced by T2, reproduced in full under `Inputs → From Depends` above. The eight members this
ticket calls, and nothing else:

```csharp
// namespace Gones.Domain.Archive
League.Create(string documentId, string name, Instant now) -> League
League.Rename(string name, Instant now) -> void
League.SoftDelete(Instant now) -> void

LeagueSeason.Create(string documentId, string leagueId, string name, string status, Instant now) -> LeagueSeason
LeagueSeason.Rename(string name, Instant now) -> void
LeagueSeason.ChangeStatus(string status, Instant now) -> void
LeagueSeason.MoveToLeague(string leagueId, Instant now) -> void
LeagueSeason.SoftDelete(Instant now) -> void
```

Properties read: `DocumentId`, `Name`, `LeagueId`, `Status`, `UpdatedAt`, `Version` (`int`), `DeletedAt`.
Each mutator already performs `Version = checked(Version + 1)` and sets `UpdatedAt = now`, so this ticket
never assigns either by hand.

```csharp
// backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs
public DbSet<League> ArchiveLeagues => Set<League>();
public DbSet<LeagueSeason> ArchiveLeagueSeasons => Set<LeagueSeason>();
```

`Gones.Domain.Archive.Tournament` is **never referenced from C#** in this ticket. The one Tournament
write — the detach on Season delete — is raw SQL against the binding DDL above, which removes the last
coupling to the aggregate T4 owns.

Naming hazard, worth one line: `Gones.Domain.Archive.League` and `Gones.Domain.Archive.Tournament` are
short names that collide with `Gones.Domain.Leagues` and the Calendar/Event types. Neither the endpoint
file nor the test file may `using Gones.Domain.Leagues;` — nothing in this slice needs it.

### Errors — exact code, status and message per failure path

| Path | Status | `code` | `message` |
| --- | --- | --- | --- |
| No credentials | `401` | `unauthorized` | `Request could not be completed.` |
| Authenticated, role `User` | `403` | `forbidden` | `Request could not be completed.` |
| Blank / whitespace / >200-char `name` | `400` | `validation_failed` | `One or more fields are invalid.`, `errors.name = ["Name is required and cannot exceed 200 characters."]` |
| `status` not `active` and not `completed` | `400` | `validation_failed` | `errors.status = ["Status must be active or completed."]` |
| Blank / >200-char `leagueId` in a body | `400` | `validation_failed` | `errors.leagueId = ["leagueId is required and cannot exceed 200 characters."]` |
| Target id absent or `deleted_at IS NOT NULL` | `404` | `not_found` | `Resource not found.` |
| `leagueId` in the body resolves to no live League | `404` | `not_found` | `Resource not found.` |
| `If-Match` missing, weak, or not decodable | `412` | `staleArchiveDocument` | `Archive document changed since it was read.` |
| `If-Match` version ≠ stored `version` | `412` | `staleArchiveDocument` | `Archive document changed since it was read.` |
| Two writers race and the token loses at save | `412` | `staleArchiveDocument` | `Archive document changed since it was read.` |
| `DELETE /leagues/{id}` with ≥1 live Season | `409` | `archiveLeagueNotEmpty` | `League still has League Seasons and cannot be deleted.` |
| Postgres deadlock / serialization failure | `409` | `conflict` | `Request conflicts with current resource state.` (already mapped at `ApiExceptionHandler.cs:18`) |

Every error body is `application/problem+json` with `type`, `status`, `title`, `detail`, `instance`,
`code`, `message`, `traceId`.

### Invariants

- **Pre**: `actorId` is a real `asp_net_users.id`. `audit_records.actor_id` has an FK to it
  (`SharedRecordConfigurations.cs:55`), so a synthetic actor in a test needs a real `ApplicationUser` row.
- **Post, every accepted mutation**: `version_after = version_before + 1`; `updated_at = clock.GetCurrentInstant()`;
  `ETag` header `== StrongETag.Encode(version_after) == body.eTag`; `body.documentVersion == version_after`.
- **Post, create**: `version == 1`, `ETag == StrongETag.Encode(1)`, and for a League
  `created_at == updated_at`. Ids are server-minted `Guid.NewGuid().ToString("D")`; a client-supplied id
  is impossible because no request record carries one.
- **Names are trimmed before storage** and validated after trimming. `"  Alpha  "` stores as `"Alpha"`.
- **Duplicate names are allowed** at both tiers. There is no unique index on `name` in the DDL, and the
  retired `PLACEHOLDER_LEAGUE_ID` / `Unassigned Tournaments` reserved-name rule
  (`LeagueNormalizer.IsUnassignedLeagueName`, still enforced on the legacy surface) is **not** carried
  over — the three-tier archive has no placeholder concept.
- **`status` defaults to `"active"`** when `CreateArchiveLeagueSeasonRequest.Status` is `null`. An
  explicitly supplied `""` is invalid, not a default.
- **No short circuits.** Renaming to the same name, setting the same status, or re-parenting to the same
  League is a normal accepted write: it bumps `version` and `updated_at`. One rule, no special cases.
- **Cross-tier isolation.** `SELECT version FROM archive_leagues WHERE document_id = X` is unchanged by
  every LeagueSeason command, including create, re-parent and delete.
- **Detach, never cascade.** After `DELETE /api/archive/league-seasons/{s}`:
  `SELECT count(*) FROM archive_tournaments WHERE season_id = s AND deleted_at IS NULL` is `0`, and the
  count of rows that previously had `season_id = s` is unchanged with `season_id IS NULL` and
  `version = version_before + 1`. Already soft-deleted Tournaments keep their historical `season_id`.
- **A deleted Season's denormalized counters are deliberately left stale.** `tournament_count`,
  `player_count`, `first_tournament_date` and `last_tournament_date` still describe the Tournaments that
  were just detached. That is correct: the row is a tombstone, every catalog read filters
  `deleted_at IS NULL`, and `LeagueSeason.RefreshCatalogCounts` is documented by T2 as touching neither
  `UpdatedAt` nor `Version` — recomputing them here would burn a query to fix numbers nothing reads.
- **Delete is idempotent-by-404.** A second `DELETE` of the same id returns `404 not_found`, because the
  row is resolved with `deleted_at IS NULL`.
- **Lock ordering.** Every path that touches a League row and a Season row together locks the **League**
  row first with `SELECT … FOR UPDATE` (`CreateSeasonAsync`, `MoveSeasonAsync`, `DeleteLeagueAsync`).
  A single, consistent order means these three can never deadlock against each other; if Postgres aborts
  one anyway, `ApiExceptionHandler.IsLostLockRace` already turns it into `409 conflict`.
- **`DeleteLeagueAsync` is race-free**: it holds the League's row lock while counting Seasons, and every
  Season create / re-parent targeting that League must take the same lock first, so no Season can appear
  between the count and the soft delete.
- **Units**: `version` is a monotonically increasing integer starting at `1`. `updated_at`, `created_at`
  and `deleted_at` are `timestamptz` in UTC. `eTag` is a strong ETag — a quoted base64 of the
  big-endian `Int64` version, e.g. version `1` is `"AAAAAAAAAAE="`.

## TDD

1. **Red** — write `backend/tests/Gones.IntegrationTests/ArchiveCommandApiTests.cs` first, all ten
   `[Fact]`s named in `Test plan` below, before `ArchiveCommandEndpoints.cs` exists. Run
   `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~ArchiveCommandApiTests`.
   Expected red: every test fails, most with `404` because `/api/archive/**` is unmapped.
2. **Green** — add `ArchiveCommandEndpoints.cs`, the DI registration and the `app.MapArchiveCommandEndpoints()`
   call. Re-run the same filter until all ten pass.
3. **Refactor** — only if the two `Delete*Async` bodies duplicate more than the shared
   `LockAsync`/`RequireVersion`/`SaveAsync` helpers already factor out. Keep green.

Assert behaviour, never implementation: assert HTTP status, the problem `code`, the response body
fields, and the resulting **table state** read back through a fresh `GonesDbContext`. Never assert that a
particular C# method was called.

## Test plan

File: `backend/tests/Gones.IntegrationTests/ArchiveCommandApiTests.cs`, namespace `Gones.IntegrationTests`,
`public sealed class ArchiveCommandApiTests : IAsyncLifetime`.

Seed, inserted after `MigrateAsync()` and before the `WebApplicationFactory` is built:

| Row | Table | Values |
| --- | --- | --- |
| actor | `asp_net_users` | `Id = 10000000-0000-0000-0000-000000000003`, `UserName = "archive-command-actor"` |
| `league-alpha` | `archive_leagues` | name `Alpha`, `created_at = updated_at = 2026-01-01T12:00:00Z`, version 1 |
| `league-beta` | `archive_leagues` | name `Beta`, same timestamps, version 1 |
| `season-alpha` | `archive_league_seasons` | league `league-alpha`, name `Alpha 2026`, status `active`, version 1 |
| `season-beta` | `archive_league_seasons` | league `league-beta`, name `Beta 2026`, status `active`, version 1 |
| `tournament-attached` | `archive_tournaments` | `season_id = season-alpha`, name `Attached`, date `2026-05-01`, status `completed`, `document = '{"rounds":[],"playerArchetypes":[]}'`, version 1 |
| `tournament-standalone` | `archive_tournaments` | `season_id = NULL`, name `Standalone`, date `2026-06-01`, status `completed`, same document, version 1 |

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Archive_League_create_is_organizer_gated_and_returns_a_versioned_ETag` | `POST /api/archive/leagues` `{"name":"  Nouvelle Ligue  "}` as anonymous, then `User`, then `Organizer` | `401`; `403` with `code == "forbidden"`; `201` with `Location == "/api/archive/leagues/{id}"`, `ETag == StrongETag.Encode(1)`, `body.documentVersion == 1`, `body.eTag == ETag`; DB row `name == "Nouvelle Ligue"` and `created_at == updated_at` |
| `Archive_League_rename_bumps_one_version_and_refuses_a_stale_If_Match` | `PATCH /api/archive/leagues/league-alpha/name` with no `If-Match`, then `Encode(99)`, then `Encode(1)` `{"name":"Alpha Renamed"}`; then the same on `/api/archive/leagues/missing-league/name` with `Encode(1)` | `412` `staleArchiveDocument`; `412` `staleArchiveDocument`; `200` with `documentVersion == 2` and `ETag == Encode(2)`, DB `name == "Alpha Renamed"`; `404` `not_found` |
| `Archive_League_delete_is_refused_while_a_League_Season_still_references_it` | `DELETE /api/archive/leagues/league-alpha` `If-Match: Encode(1)`; then `DELETE /api/archive/league-seasons/season-alpha` `If-Match: Encode(1)`; then retry the League delete | `409` with `code == "archiveLeagueNotEmpty"`, DB `league-alpha.deleted_at IS NULL` and `version == 1`; `200`; `200` with `body.deleted == true` and `documentVersion == 2`, DB `league-alpha.deleted_at IS NOT NULL`; a third `DELETE` with `Encode(2)` → `404` `not_found` |
| `Archive_League_Season_create_requires_a_live_parent_League_and_defaults_to_active` | `POST /api/archive/league-seasons` with `{"leagueId":"missing-league","name":"X"}`; `{"leagueId":"league-alpha","name":"  Saison 2027  "}`; `{"leagueId":"league-alpha","name":"Saison 2028","status":"completed"}`; `{"leagueId":"league-alpha","name":"Bad","status":"archived"}` | `404` `not_found`; `201` with `Location == "/api/archive/league-seasons/{id}"` and DB `name == "Saison 2027"`, `status == "active"`, `version == 1`, `league_id == "league-alpha"`; `201` with DB `status == "completed"`; `400` `validation_failed` |
| `Archive_League_Season_rename_status_and_re_parent_each_bump_exactly_one_version` | on `season-alpha`: `PATCH /name` `Encode(1)`, `PATCH /status` `{"status":"completed"}` `Encode(2)`, `PATCH /league` `{"leagueId":"league-beta"}` `Encode(3)`, then `PATCH /league` `{"leagueId":"missing-league"}` `Encode(4)` | `200 v2`; `200 v3`; `200 v4` with DB `league_id == "league-beta"` and `status == "completed"`; `404` `not_found` with DB `version` still `4`. In the same test: DB `league-alpha.version == 1` **and** `league-beta.version == 1` — a Season write never bumps a League |
| `Archive_League_Season_delete_detaches_its_Tournaments_and_never_deletes_them` | `DELETE /api/archive/league-seasons/season-alpha` `If-Match: Encode(1)` | `200` with `deleted == true`, `documentVersion == 2`; DB `archive_tournaments` still holds **2** rows; `tournament-attached.season_id IS NULL`, `version == 2`, `updated_at > 2026-05-01`; `tournament-standalone.season_id IS NULL` and `version == 1` (untouched); `season-alpha.deleted_at IS NOT NULL`; `league-alpha.version == 1` |
| `Archive_commands_reject_blank_and_over_long_names` | `POST /leagues` `{"name":"   "}`; `POST /leagues` `{"name":<201 chars>}`; `PATCH /leagues/league-alpha/name` `{"name":""}` `Encode(1)`; `POST /league-seasons` `{"leagueId":" ","name":"x"}` | four `400`s with `code == "validation_failed"`; DB `league-alpha.version == 1` and `archive_leagues` row count unchanged at `2` |
| `Archive_command_concurrency_lets_exactly_one_of_two_racing_renames_win` | two `PATCH /api/archive/leagues/league-beta/name` started without awaiting, both `If-Match: Encode(1)`, names `Winner A` / `Winner B` | exactly one `200` and exactly one `412`; the `412` body `code == "staleArchiveDocument"`; DB `league-beta.version == 2` |
| `Archive_commands_refuse_a_plain_User_on_every_route` | each of the eight routes once with `X-Test-Roles: User` and a valid `If-Match` where required | eight `403`s, each with `code == "forbidden"`; DB `league-alpha.version == 1` and `season-alpha.version == 1` |
| `Archive_commands_audit_the_actor_without_leaking_names` | `POST /leagues` `{"name":"Secret Ligue"}` then `PATCH /leagues/league-alpha/name` `{"name":"Also Secret"}` `Encode(1)` | `audit_records` contains `archive.league.created` and `archive.league.renamed`, both with `entity_type == "archiveLeague"` and `actor_id == Actor`; no `redacted_diff` contains `"Secret Ligue"` or `"Also Secret"` |

Run command, red and green:

```bash
cd /home/aron/projects/gones && dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~ArchiveCommandApiTests
```

## Impl steps

- [ ] 1. **Verify the T2 surface before writing a line — four greps, each with its expected answer.**
      T2 is merged; this step confirms it landed as specified rather than re-deriving it. Every command
      runs from `/home/aron/projects/gones`.
  - [ ] 1.1 `grep -n "public sealed class League\b\|public sealed class LeagueSeason\b\|namespace Gones.Domain.Archive" backend/src/Gones.Domain/Archive/*.cs`
        → expect `public sealed class League` and `public sealed class LeagueSeason` in namespace
        `Gones.Domain.Archive`. The aggregates use the **short** names; there is no `ArchiveLeague` type.
        If T2 landed different names, substitute them everywhere below — the routes, the request and
        response records, the error codes and the SQL all stay exactly as written.
  - [ ] 1.2 `grep -n "ArchiveLeagues\|ArchiveLeagueSeasons\|ArchiveTournaments" backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs`
        → expect `public DbSet<League> ArchiveLeagues => Set<League>();` and
        `public DbSet<LeagueSeason> ArchiveLeagueSeasons => Set<LeagueSeason>();` just after
        `GonesDbContext.cs:48`. If a `DbSet` is absent, add it there — a `DbSet` is model-only and forces
        no migration.
  - [ ] 1.3 `grep -n "static League Create\|static LeagueSeason Create\|public void Rename\|public void ChangeStatus\|public void MoveToLeague\|public void SoftDelete" backend/src/Gones.Domain/Archive/League.cs backend/src/Gones.Domain/Archive/LeagueSeason.cs`
        → expect all eight members from `Interface contract → Consumes`. Then
        `grep -n "checked(Version + 1)" backend/src/Gones.Domain/Archive/League.cs backend/src/Gones.Domain/Archive/LeagueSeason.cs`
        → expect a hit inside every mutator. **This is why no code in this ticket ever assigns `Version`.**
        If a mutator is missing, add it to T2's file following the sibling mutators already there,
        ending in `UpdatedAt = now; Version = checked(Version + 1);`.
  - [ ] 1.4 `grep -n "IsConcurrencyToken" backend/src/Gones.Infrastructure/Persistence/ArchiveAggregateConfigurations.cs`
        → expect three hits, one per aggregate. The aggregates do **not** derive from `VersionedEntity`,
        so `GonesDbContext.IncrementVersions()` skips them and this explicit call is the only thing making
        a lost race raise `DbUpdateConcurrencyException`. Without it the racing-writers test cannot pass.
        If a call is missing, add `builder.Property(entity => entity.Version).IsConcurrencyToken();` —
        model-only, no migration.
  - [ ] 1.5 `grep -n "archive_tournaments" -A 20 backend/src/Gones.Infrastructure/Persistence/Migrations/*RebuildArchiveThreeTier.cs | head -40`
        → expect exactly the eleven columns of the `archive_tournaments` DDL in `Inputs`, and **no `id`
        column** (the aggregate is not a `VersionedEntity`, its primary key is `document_id`). If an `id`
        column is present after all, the fixture `INSERT` in step 2.4 needs `id, ` prepended to its column
        list and `gen_random_uuid(), ` prepended to each `VALUES` row. Nothing else changes.
  - [ ] 1.6 `grep -n "version" backend/src/Gones.Infrastructure/Persistence/Migrations/*RebuildArchiveThreeTier.cs | head`
        → expect `integer`. `int` widens implicitly everywhere this ticket uses it, so no cast is written;
        the single consequence is that the test helper in step 2.5 reads it with `GetInt32`.

- [ ] 2. **Red: write the ten failing integration tests.**
  - [ ] 2.1 Create `backend/tests/Gones.IntegrationTests/ArchiveCommandApiTests.cs`. Copy the class
        skeleton from `backend/tests/Gones.IntegrationTests/LeagueCommandApiTests.cs:17-60` verbatim, then
        change: the class name to `ArchiveCommandApiTests`, `Actor` to
        `Guid.Parse("10000000-0000-0000-0000-000000000003")`, the `ApplicationUser` fields to
        `archive-command-actor` / `ARCHIVE-COMMAND-ACTOR` / `archive-command-actor@example.test` /
        `ARCHIVE-COMMAND-ACTOR@EXAMPLE.TEST`, and `UseSetting("GONES_AUTH_SIGNING_KEY", "t3-archive-command-signing-key-value")`.
        Drop the two `LeagueArchiveAggregates.Add(...)` seed lines.
  - [ ] 2.2 Copy the `SendJsonAsync`, `Body`, `AssertProblem`, `Client` and `CreateContext` helpers from
        `LeagueCommandApiTests.cs:381-408` and the private `CreateContext()` below them, unchanged apart
        from the `targetIfMatch` parameter, which this ticket does not use and should be dropped.
  - [ ] 2.3 In `InitializeAsync`, after `MigrateAsync()` and the `Users.Add(...)`, seed the four upper-tier
        rows through the T2 factories:
        ```csharp
        var seeded = Instant.FromUtc(2026, 1, 1, 12, 0);
        database.ArchiveLeagues.Add(League.Create("league-alpha", "Alpha", seeded));
        database.ArchiveLeagues.Add(League.Create("league-beta", "Beta", seeded));
        database.ArchiveLeagueSeasons.Add(LeagueSeason.Create("season-alpha", "league-alpha", "Alpha 2026", "active", seeded));
        database.ArchiveLeagueSeasons.Add(LeagueSeason.Create("season-beta", "league-beta", "Beta 2026", "active", seeded));
        await database.SaveChangesAsync();
        ```
        The test file's usings are `using Gones.Domain.Archive;` for `League`/`LeagueSeason` and
        `using Gones.Application.Concurrency;` for `StrongETag`. Do **not** copy
        `using Gones.Domain.Leagues;` from `LeagueCommandApiTests.cs` — it makes `League` ambiguous.
  - [ ] 2.4 Immediately after that `SaveChangesAsync()`, seed the two Tournament rows with raw SQL — the
        test must not reference the `Gones.Domain.Archive.Tournament` CLR type, which T4 owns:
        ```csharp
        await database.Database.ExecuteSqlRawAsync("""
            INSERT INTO archive_tournaments
              (document_id, season_id, name, tournament_date, status, document, updated_at, version, deleted_at, player_count, counts_version)
            VALUES
              ('tournament-attached', 'season-alpha', 'Attached', DATE '2026-05-01', 'completed',
               '{"rounds":[],"playerArchetypes":[]}'::jsonb, TIMESTAMPTZ '2026-05-01T12:00:00Z', 1, NULL, 0, 0),
              ('tournament-standalone', NULL, 'Standalone', DATE '2026-06-01', 'completed',
               '{"rounds":[],"playerArchetypes":[]}'::jsonb, TIMESTAMPTZ '2026-06-01T12:00:00Z', 1, NULL, 0, 0)
            """);
        ```
  - [ ] 2.5 Add a private helper the DB-state assertions share, so no test writes ad-hoc SQL:
        ```csharp
        private async Task<(int Version, string? SeasonId, DateTime UpdatedAt)> TournamentRowAsync(string documentId)
        {
            await using var database = CreateContext();
            var connection = database.Database.GetDbConnection();
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"SELECT version, season_id, updated_at FROM archive_tournaments WHERE document_id = '{documentId}'";
            await using var reader = await command.ExecuteReaderAsync();
            Assert.True(await reader.ReadAsync());
            return (reader.GetInt32(0), reader.IsDBNull(1) ? null : reader.GetString(1), reader.GetDateTime(2).ToUniversalTime());
        }
        ```
        `GetInt32`, not `GetInt64`: `archive_tournaments.version` is `integer` (confirmed in step 1.6),
        and `GetInt64` on an `int4` column throws `InvalidCastException`.
  - [ ] 2.6 Write the ten `[Fact]` methods exactly as named and specified in `Test plan`. Use
        `StrongETag.Encode(1)` etc. for `If-Match`; use `AssertProblem(response, HttpStatusCode.X, "code")`
        for every error assertion.
  - [ ] 2.7 Run `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~ArchiveCommandApiTests`.
        Confirm red: ten failures, mostly `Assert.Equal() Failure: Expected: Created, Actual: NotFound`.

- [ ] 3. **Create the endpoint file with its request, response and error types.**
  - [ ] 3.1 Create `backend/src/Gones.Api/Archive/ArchiveCommandEndpoints.cs` with this header:
        ```csharp
        using System.Security.Claims;
        using System.Text.Json;
        using Gones.Api.Errors;
        using Gones.Api.Organizations;
        using Gones.Api.Security;
        using Gones.Application.Concurrency;
        using Gones.Domain.Archive;
        using Gones.Domain.Persistence;
        using Gones.Infrastructure.Persistence;
        using Microsoft.AspNetCore.Mvc;
        using Microsoft.EntityFrameworkCore;
        using NodaTime;

        namespace Gones.Api.Archive;
        ```
  - [ ] 3.2 At the bottom of the same file, add the six request records, the two response records and the
        two exception classes exactly as written in `Interface contract → Produces — records` and
        `→ Produces — exceptions`.

- [ ] 4. **Write `ArchiveCommandService` — shared plumbing.**
  - [ ] 4.1 In `ArchiveCommandEndpoints.cs`, below the static endpoint class, add:
        ```csharp
        internal sealed class ArchiveCommandService(GonesDbContext database, IClock clock)
        {
            public const int MaximumNameLength = 200;
            public const int MaximumIdLength = 200;

            private const string LeagueEntityType = "archiveLeague";
            private const string SeasonEntityType = "archiveLeagueSeason";
            private static readonly JsonSerializerOptions AuditJsonOptions = new(JsonSerializerDefaults.Web);
        }
        ```
  - [ ] 4.2 Add the resolution helpers inside that class. The League lock is the shared entry point that
        makes `DeleteLeagueAsync` race-free:
        ```csharp
        private async Task<League> LockLeagueAsync(string leagueId, CancellationToken cancellationToken) =>
            await database.ArchiveLeagues
                .FromSqlInterpolated($"SELECT * FROM archive_leagues WHERE document_id = {leagueId} AND deleted_at IS NULL FOR UPDATE")
                .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        private async Task<LeagueSeason> RequireSeasonAsync(string seasonId, CancellationToken cancellationToken) =>
            await database.ArchiveLeagueSeasons
                .SingleOrDefaultAsync(item => item.DocumentId == seasonId && item.DeletedAt == null, cancellationToken)
            ?? throw new ResourceNotFoundException();

        private async Task<LeagueSeason> LockSeasonAsync(string seasonId, CancellationToken cancellationToken) =>
            await database.ArchiveLeagueSeasons
                .FromSqlInterpolated($"SELECT * FROM archive_league_seasons WHERE document_id = {seasonId} AND deleted_at IS NULL FOR UPDATE")
                .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();
        ```
  - [ ] 4.3 Add the validation, versioning, save, audit and response helpers inside the same class:
        ```csharp
        private static string RequiredName(string? value)
        {
            var name = value?.Trim();
            if (string.IsNullOrWhiteSpace(name) || name.Length > MaximumNameLength)
                throw Validation("name", $"Name is required and cannot exceed {MaximumNameLength} characters.");
            return name;
        }

        private static string RequiredStatus(string? value)
        {
            if (value is not ("active" or "completed"))
                throw Validation("status", "Status must be active or completed.");
            return value;
        }

        private static string RequiredId(string? value, string field)
        {
            var id = value?.Trim();
            if (string.IsNullOrWhiteSpace(id) || id.Length > MaximumIdLength)
                throw Validation(field, $"{field} is required and cannot exceed {MaximumIdLength} characters.");
            return id;
        }

        // `actual` is the aggregate's `int Version`, widened by the caller; `expected` is the decoded
        // If-Match, which StrongETag always yields as a long.
        private static void RequireVersion(long actual, long expected)
        {
            if (actual != expected) throw new StaleArchiveDocumentException();
        }

        private async Task SaveAsync(CancellationToken cancellationToken)
        {
            try
            {
                await database.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateConcurrencyException)
            {
                throw new StaleArchiveDocumentException();
            }
        }

        private void AddAudit(Guid actorId, string action, string entityType, string entityId, IReadOnlyList<string> fields) =>
            database.AuditRecords.Add(new AuditRecord
            {
                ActorId = actorId,
                Action = action,
                EntityType = entityType,
                EntityId = entityId,
                RedactedDiff = JsonSerializer.Serialize(new { fields }, AuditJsonOptions),
                OccurredAt = clock.GetCurrentInstant()
            });

        private static ArchiveCommandResponse Response(string id, long version, Instant updatedAt) =>
            new(id, version, updatedAt, StrongETag.Encode(version));

        private static ApiValidationException Validation(string field, string message) =>
            new(new Dictionary<string, string[]> { [field] = [message] });

        private static string NewId() => Guid.NewGuid().ToString("D");
        ```

- [ ] 5. **Write the three League commands.**
  - [ ] 5.1 Add `CreateLeagueAsync`:
        ```csharp
        public async Task<ArchiveCommandResponse> CreateLeagueAsync(Guid actorId, CreateArchiveLeagueRequest request, CancellationToken cancellationToken)
        {
            var name = RequiredName(request.Name);
            var league = League.Create(NewId(), name, clock.GetCurrentInstant());
            database.ArchiveLeagues.Add(league);
            AddAudit(actorId, "archive.league.created", LeagueEntityType, league.DocumentId, ["name"]);
            await SaveAsync(cancellationToken);
            return Response(league.DocumentId, league.Version, league.UpdatedAt);
        }
        ```
  - [ ] 5.2 Add `RenameLeagueAsync`:
        ```csharp
        public async Task<ArchiveCommandResponse> RenameLeagueAsync(string leagueId, Guid actorId, long expectedVersion, RenameArchiveLeagueRequest request, CancellationToken cancellationToken)
        {
            var name = RequiredName(request.Name);
            var league = await database.ArchiveLeagues
                .SingleOrDefaultAsync(item => item.DocumentId == leagueId && item.DeletedAt == null, cancellationToken)
                ?? throw new ResourceNotFoundException();
            RequireVersion(league.Version, expectedVersion);
            league.Rename(name, clock.GetCurrentInstant());
            AddAudit(actorId, "archive.league.renamed", LeagueEntityType, league.DocumentId, ["name"]);
            await SaveAsync(cancellationToken);
            return Response(league.DocumentId, league.Version, league.UpdatedAt);
        }
        ```
  - [ ] 5.3 Add `DeleteLeagueAsync`. The `409` check runs while the League's row lock is held, so no
        Season can be attached between the count and the soft delete:
        ```csharp
        public async Task<ArchiveDeleteResponse> DeleteLeagueAsync(string leagueId, Guid actorId, long expectedVersion, CancellationToken cancellationToken)
        {
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            var league = await LockLeagueAsync(leagueId, cancellationToken);
            RequireVersion(league.Version, expectedVersion);
            var stillReferenced = await database.ArchiveLeagueSeasons
                .AnyAsync(item => item.LeagueId == leagueId && item.DeletedAt == null, cancellationToken);
            if (stillReferenced) throw new ArchiveLeagueNotEmptyException();
            league.SoftDelete(clock.GetCurrentInstant());
            AddAudit(actorId, "archive.league.deleted", LeagueEntityType, league.DocumentId, ["deletedAt"]);
            await SaveAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new ArchiveDeleteResponse(league.DocumentId, true, league.Version, StrongETag.Encode(league.Version));
        }
        ```

- [ ] 6. **Write the five LeagueSeason commands.**
  - [ ] 6.1 Add `CreateSeasonAsync`. It locks the parent League first, so it serializes against
        `DeleteLeagueAsync`:
        ```csharp
        public async Task<ArchiveCommandResponse> CreateSeasonAsync(Guid actorId, CreateArchiveLeagueSeasonRequest request, CancellationToken cancellationToken)
        {
            var leagueId = RequiredId(request.LeagueId, "leagueId");
            var name = RequiredName(request.Name);
            var status = RequiredStatus(request.Status ?? "active");
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            _ = await LockLeagueAsync(leagueId, cancellationToken);
            // Create stamps TournamentCount = 0, PlayerCount = 0, both dates null and
            // CountsVersion = ArchiveCatalogCounts.Version itself, so nothing here touches the counters.
            var season = LeagueSeason.Create(NewId(), leagueId, name, status, clock.GetCurrentInstant());
            database.ArchiveLeagueSeasons.Add(season);
            AddAudit(actorId, "archive.season.created", SeasonEntityType, season.DocumentId, ["name", "leagueId", "status"]);
            await SaveAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Response(season.DocumentId, season.Version, season.UpdatedAt);
        }
        ```
  - [ ] 6.2 Add `RenameSeasonAsync` and `ChangeSeasonStatusAsync`, both plain single-row writes with no
        transaction — the concurrency token is the only guard they need:
        ```csharp
        public async Task<ArchiveCommandResponse> RenameSeasonAsync(string seasonId, Guid actorId, long expectedVersion, RenameArchiveLeagueSeasonRequest request, CancellationToken cancellationToken)
        {
            var name = RequiredName(request.Name);
            var season = await RequireSeasonAsync(seasonId, cancellationToken);
            RequireVersion(season.Version, expectedVersion);
            season.Rename(name, clock.GetCurrentInstant());
            AddAudit(actorId, "archive.season.renamed", SeasonEntityType, season.DocumentId, ["name"]);
            await SaveAsync(cancellationToken);
            return Response(season.DocumentId, season.Version, season.UpdatedAt);
        }

        public async Task<ArchiveCommandResponse> ChangeSeasonStatusAsync(string seasonId, Guid actorId, long expectedVersion, ChangeArchiveLeagueSeasonStatusRequest request, CancellationToken cancellationToken)
        {
            var status = RequiredStatus(request.Status);
            var season = await RequireSeasonAsync(seasonId, cancellationToken);
            RequireVersion(season.Version, expectedVersion);
            season.ChangeStatus(status, clock.GetCurrentInstant());
            AddAudit(actorId, "archive.season.status.changed", SeasonEntityType, season.DocumentId, ["status"]);
            await SaveAsync(cancellationToken);
            return Response(season.DocumentId, season.Version, season.UpdatedAt);
        }
        ```
  - [ ] 6.3 Add `MoveSeasonAsync`. It locks the **target** League before touching the Season, keeping the
        League-before-Season lock order that makes deadlock impossible:
        ```csharp
        public async Task<ArchiveCommandResponse> MoveSeasonAsync(string seasonId, Guid actorId, long expectedVersion, MoveArchiveLeagueSeasonRequest request, CancellationToken cancellationToken)
        {
            var leagueId = RequiredId(request.LeagueId, "leagueId");
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            _ = await LockLeagueAsync(leagueId, cancellationToken);
            var season = await RequireSeasonAsync(seasonId, cancellationToken);
            RequireVersion(season.Version, expectedVersion);
            season.MoveToLeague(leagueId, clock.GetCurrentInstant());
            AddAudit(actorId, "archive.season.league.changed", SeasonEntityType, season.DocumentId, ["leagueId"]);
            await SaveAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Response(season.DocumentId, season.Version, season.UpdatedAt);
        }
        ```
  - [ ] 6.4 Add `DeleteSeasonAsync`. The detach is raw SQL against the binding DDL so this ticket never
        references the `Gones.Domain.Archive.Tournament` CLR type that T4 owns, and it runs inside the same transaction
        as the soft delete so a Season is never tombstoned with children still pointing at it:
        ```csharp
        public async Task<ArchiveDeleteResponse> DeleteSeasonAsync(string seasonId, Guid actorId, long expectedVersion, CancellationToken cancellationToken)
        {
            await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
            var season = await LockSeasonAsync(seasonId, cancellationToken);
            RequireVersion(season.Version, expectedVersion);
            var now = clock.GetCurrentInstant();
            // Detach, never cascade: a Tournament outlives the Season it was played in and becomes
            // standalone. `Tournament.MoveToSeason(null, now)` would do exactly this per row, but a Season
            // may hold thousands of Tournaments and loading every aggregate to flip one column is the
            // wrong trade. One UPDATE writes the same three columns the mutator writes - season_id,
            // updated_at, version + 1 - and touches no derived counter, because detaching changes neither
            // the Tournament's player_count nor its counts_version. Raw SQL for a bulk archive write is
            // the established idiom; PlayerStatisticsRebuildService does the same.
            var detached = await database.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE archive_tournaments SET season_id = NULL, updated_at = {now}, version = version + 1 WHERE season_id = {seasonId} AND deleted_at IS NULL",
                cancellationToken);
            season.SoftDelete(now);
            AddAudit(actorId, "archive.season.deleted", SeasonEntityType, season.DocumentId, ["deletedAt"]);
            if (detached > 0) AddAudit(actorId, "archive.season.tournaments.detached", SeasonEntityType, season.DocumentId, ["seasonId"]);
            await SaveAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new ArchiveDeleteResponse(season.DocumentId, true, season.Version, StrongETag.Encode(season.Version));
        }
        ```

- [ ] 7. **Map the eight routes and register the service.**
  - [ ] 7.1 In `ArchiveCommandEndpoints.cs`, above `ArchiveCommandService`, add:
        ```csharp
        internal static class ArchiveCommandEndpoints
        {
            public static void MapArchiveCommandEndpoints(this WebApplication app)
            {
                var organizer = app.MapGroup("/api/archive").RequireAuthorization(AuthorizationPolicies.Organizer);

                organizer.MapPost("/leagues", CreateLeagueAsync).WithName("CreateArchiveLeague").Produces<ArchiveCommandResponse>(StatusCodes.Status201Created);
                organizer.MapPatch("/leagues/{leagueId}/name", RenameLeagueAsync).WithName("RenameArchiveLeague").Produces<ArchiveCommandResponse>();
                organizer.MapDelete("/leagues/{leagueId}", DeleteLeagueAsync).WithName("DeleteArchiveLeague").Produces<ArchiveDeleteResponse>();
                organizer.MapPost("/league-seasons", CreateSeasonAsync).WithName("CreateArchiveLeagueSeason").Produces<ArchiveCommandResponse>(StatusCodes.Status201Created);
                organizer.MapPatch("/league-seasons/{seasonId}/name", RenameSeasonAsync).WithName("RenameArchiveLeagueSeason").Produces<ArchiveCommandResponse>();
                organizer.MapPatch("/league-seasons/{seasonId}/status", ChangeSeasonStatusAsync).WithName("ChangeArchiveLeagueSeasonStatus").Produces<ArchiveCommandResponse>();
                organizer.MapPatch("/league-seasons/{seasonId}/league", MoveSeasonAsync).WithName("MoveArchiveLeagueSeason").Produces<ArchiveCommandResponse>();
                organizer.MapDelete("/league-seasons/{seasonId}", DeleteSeasonAsync).WithName("DeleteArchiveLeagueSeason").Produces<ArchiveDeleteResponse>();
            }
        }
        ```
  - [ ] 7.2 Inside the same static class, add the eight handlers and the two helpers:
        ```csharp
        private static async Task<IResult> CreateLeagueAsync(CreateArchiveLeagueRequest request, ClaimsPrincipal principal, HttpResponse httpResponse, ArchiveCommandService service, CancellationToken cancellationToken)
        {
            var response = await service.CreateLeagueAsync(OrganizationPrincipal.UserId(principal), request, cancellationToken);
            httpResponse.Headers.ETag = response.ETag;
            return Results.Created($"/api/archive/leagues/{response.Id}", response);
        }

        private static Task<IResult> RenameLeagueAsync(string leagueId, RenameArchiveLeagueRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken) =>
            OkAsync(response, service.RenameLeagueAsync(leagueId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), request, cancellationToken));

        private static async Task<IResult> DeleteLeagueAsync(string leagueId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken)
        {
            var result = await service.DeleteLeagueAsync(leagueId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), cancellationToken);
            response.Headers.ETag = result.ETag;
            return Results.Ok(result);
        }

        private static async Task<IResult> CreateSeasonAsync(CreateArchiveLeagueSeasonRequest request, ClaimsPrincipal principal, HttpResponse httpResponse, ArchiveCommandService service, CancellationToken cancellationToken)
        {
            var response = await service.CreateSeasonAsync(OrganizationPrincipal.UserId(principal), request, cancellationToken);
            httpResponse.Headers.ETag = response.ETag;
            return Results.Created($"/api/archive/league-seasons/{response.Id}", response);
        }

        private static Task<IResult> RenameSeasonAsync(string seasonId, RenameArchiveLeagueSeasonRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken) =>
            OkAsync(response, service.RenameSeasonAsync(seasonId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), request, cancellationToken));

        private static Task<IResult> ChangeSeasonStatusAsync(string seasonId, ChangeArchiveLeagueSeasonStatusRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken) =>
            OkAsync(response, service.ChangeSeasonStatusAsync(seasonId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), request, cancellationToken));

        private static Task<IResult> MoveSeasonAsync(string seasonId, MoveArchiveLeagueSeasonRequest request, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken) =>
            OkAsync(response, service.MoveSeasonAsync(seasonId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), request, cancellationToken));

        private static async Task<IResult> DeleteSeasonAsync(string seasonId, [FromHeader(Name = "If-Match")] string? ifMatch, HttpResponse response, ClaimsPrincipal principal, ArchiveCommandService service, CancellationToken cancellationToken)
        {
            var result = await service.DeleteSeasonAsync(seasonId, OrganizationPrincipal.UserId(principal), RequiredVersion(ifMatch), cancellationToken);
            response.Headers.ETag = result.ETag;
            return Results.Ok(result);
        }

        private static async Task<IResult> OkAsync(HttpResponse response, Task<ArchiveCommandResponse> pending)
        {
            var result = await pending;
            response.Headers.ETag = result.ETag;
            return Results.Ok(result);
        }

        private static long RequiredVersion(string? value)
        {
            if (!StrongETag.TryDecode(value, out var version)) throw new StaleArchiveDocumentException();
            return version;
        }
        ```
  - [ ] 7.3 In `backend/src/Gones.Api/Program.cs`, add `using Gones.Api.Archive;` on the line immediately
        after `using Gones.Api.Admin;` (line 2).
  - [ ] 7.4 In `backend/src/Gones.Api/Program.cs`, add
        `builder.Services.AddScoped<ArchiveCommandService>();` on the line immediately after
        `builder.Services.AddScoped<LeagueCommandService>();` (line 120).
  - [ ] 7.5 In `backend/src/Gones.Api/Program.cs`, add `app.MapArchiveCommandEndpoints();` on the line
        immediately after `app.MapLeagueCommandEndpoints();` (line 240), inside the same
        `if (runtimeConfiguration.Features.AuthV1)` block.

- [ ] 8. **Green, then regenerate the API contract.**
  - [ ] 8.1 Run `cd /home/aron/projects/gones && dotnet build backend/Gones.sln --configuration Release`.
        Expect exit `0` with no warnings-as-errors.
  - [ ] 8.2 Run `cd /home/aron/projects/gones && dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~ArchiveCommandApiTests`.
        Expect `Passed! - Failed: 0, Passed: 10`.
  - [ ] 8.3 Run `cd /home/aron/projects/gones && npm run backend:test`. Expect the whole solution green —
        in particular `LeagueCommandApiTests`, `LeagueArchiveRouteTests` and `ApiBoundaryTests`, which
        prove the legacy surface and the shared error codes are untouched.
  - [ ] 8.4 Bring up the database the generator needs — `compose.yaml:11-17` publishes it on
        `127.0.0.1:5433` with user `gones_migration` — then regenerate. `scripts/generate-api.mjs:26`
        defaults to port `5432`, so the connection string must be passed explicitly:
        ```bash
        cd /home/aron/projects/gones
        docker compose up -d --wait postgres migrator
        GONES_DB_CONNECTION='Host=127.0.0.1;Port=5433;Database=gones;Username=gones_migration;Password=local-migration-only' \
          npm run api:generate
        ```
        It boots the API, reads `/openapi/v1.json`, and rewrites `backend/openapi/gones.json` and
        `src/app/api/generated/gones-api.ts`.
  - [ ] 8.5 Run `GONES_DB_CONNECTION='Host=127.0.0.1;Port=5433;Database=gones;Username=gones_migration;Password=local-migration-only' npm run api:check`
        from `/home/aron/projects/gones`. Expect exit `0`. Confirm the diff on
        `backend/openapi/gones.json` adds exactly the eight new paths and the eight new schemas and
        removes nothing.
  - [ ] 8.6 Run `cd /home/aron/projects/gones && npm run typecheck && npm run lint && npm run test`.
        The regenerated client is new code in `src/`, so all three must stay green.

## Outputs

**Files created**

- `backend/src/Gones.Api/Archive/ArchiveCommandEndpoints.cs` — `ArchiveCommandEndpoints`,
  `ArchiveCommandService`, six request records, `ArchiveCommandResponse`, `ArchiveDeleteResponse`,
  `StaleArchiveDocumentException`, `ArchiveLeagueNotEmptyException`.
- `backend/tests/Gones.IntegrationTests/ArchiveCommandApiTests.cs` — ten integration tests.

**Files modified**

- `backend/src/Gones.Api/Program.cs` — one `using`, one `AddScoped`, one `Map…Endpoints()` call.
- `backend/src/Gones.Domain/Archive/*.cs` — **only** the mutators of step 1.3 that T2 did not already
  provide. No new property, no new column, no migration.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs` — **only** if step 1.2 found a missing
  `DbSet`. Model-only, no migration.
- `backend/src/Gones.Infrastructure/Persistence/*Archive*Configuration.cs` — **only** if step 1.4 found
  `Version` unmarked as a concurrency token. Model-only, no migration.
- `backend/openapi/gones.json`, `src/app/api/generated/gones-api.ts` — machine output of
  `npm run api:generate`.

**Public API / behaviour change**

- Eight new organizer-gated routes under `/api/archive`. Nothing existing changes: no legacy route, no
  legacy response shape, no shared error code.
- Two new problem `code` values enter the vocabulary: `staleArchiveDocument` and `archiveLeagueNotEmpty`.
  T4 reuses both.

**Migrate / config**

- **No migration.** T2's `RebuildArchiveThreeTier` already created every table and column this ticket
  writes. Any step-1 change is model-only (`DbSet`, concurrency token, domain method) and produces no
  schema delta — confirm with
  `dotnet ef migrations has-pending-model-changes --project backend/src/Gones.Infrastructure --startup-project backend/src/Gones.Api`,
  which must report no pending changes.
- **No new configuration key.** The row caps in `Gones:Archive:*` belong to the read endpoints (T5-T7).

## Validation

- [ ] tests pass:
  - [ ] `cd /home/aron/projects/gones && dotnet build backend/Gones.sln --configuration Release` → exit `0`
  - [ ] `cd /home/aron/projects/gones && dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~ArchiveCommandApiTests` → `Failed: 0, Passed: 10`
  - [ ] `cd /home/aron/projects/gones && npm run backend:test` → exit `0`, no regression in
        `LeagueCommandApiTests`, `LeagueArchiveRouteTests`, `ApiBoundaryTests`, `PersistenceKernelTests`
  - [ ] `cd /home/aron/projects/gones && GONES_DB_CONNECTION='Host=127.0.0.1;Port=5433;Database=gones;Username=gones_migration;Password=local-migration-only' npm run api:check` → exit `0`
  - [ ] `cd /home/aron/projects/gones && npm run typecheck` → exit `0`
  - [ ] `cd /home/aron/projects/gones && npm run lint` → exit `0`
  - [ ] `cd /home/aron/projects/gones && npm run test` → exit `0`
  - [ ] `cd /home/aron/projects/gones && dotnet ef migrations has-pending-model-changes --project backend/src/Gones.Infrastructure --startup-project backend/src/Gones.Api` → "No changes have been made to the model since the last migration."
- [ ] manual check — no UI in this slice. Prove the surface by hand against a running stack
      (`npm run dev`, which publishes the API on `http://127.0.0.1:5080` per `compose.yaml:94`) with an
      `Organizer` bearer token in `$TOKEN`:
      ```bash
      # create a League, keep its id and ETag
      curl -si -X POST http://127.0.0.1:5080/api/archive/leagues \
        -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        -d '{"name":"Ligue de Lyon"}'
      # -> HTTP/1.1 201 Created ; Location: /api/archive/leagues/<id> ; ETag: "AAAAAAAAAAE="

      # attach a Season
      curl -si -X POST http://127.0.0.1:5080/api/archive/league-seasons \
        -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        -d '{"leagueId":"<id>","name":"Saison 2026"}'
      # -> HTTP/1.1 201 Created

      # the League is no longer deletable
      curl -si -X DELETE http://127.0.0.1:5080/api/archive/leagues/<id> \
        -H "Authorization: Bearer $TOKEN" -H 'If-Match: "AAAAAAAAAAE="'
      # -> HTTP/1.1 409 Conflict ; {"code":"archiveLeagueNotEmpty", …}

      # a stale If-Match is refused
      curl -si -X PATCH http://127.0.0.1:5080/api/archive/leagues/<id>/name \
        -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        -H 'If-Match: "AAAAAAAAAGM="' -d '{"name":"Nope"}'
      # -> HTTP/1.1 412 Precondition Failed ; {"code":"staleArchiveDocument", …}
      ```
- [ ] app functional — no broken path from this slice:
  - [ ] `/api/leagues-archive/**` still answers exactly as before (proved by `npm run backend:test`).
  - [ ] The Angular app still builds and boots: `npm run build` → exit `0`. Nothing in `src/` calls the
        new routes yet; T13 wires them.
  - [ ] Between T2 and T13 the archive pages render an empty list. That is the expected state of the
        plan, not a regression from this ticket.
- [ ] commit msg draft: `feat(archive): command endpoints for Leagues and League Seasons`
