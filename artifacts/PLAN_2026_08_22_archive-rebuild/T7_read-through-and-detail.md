# T7: Read-through Season tournaments and Tournament detail

> ## ⚠ ARBITRATION OVERRIDE — read before the body; these win over anything below
>
> **A. You now depend on T5, and you do NOT declare the shared DTOs.** T5, T6 and T7 each declared
> `ArchiveCatalogResponse<T>` and two of you declared `ArchiveTournamentSummary`; duplicate
> declarations are compile errors. **T5 owns** `backend/src/Gones.Api/Archive/ArchiveResponses.cs`,
> holding `ArchiveCatalogResponse<T>`, `ArchiveLeagueSummary`, `ArchiveLeagueSeasonSummary`,
> `ArchiveTournamentSummary`, `ArchiveYearEntry` and `ArchiveYearsResponse`. **Consume them; delete
> the declarations from this ticket's Impl steps.** `ArchiveTournamentDetailResponse` is yours alone
> and stays here.
>
> **B. `TournamentDate` on the wire is `string`, not `LocalDate`.** Your body declares
> `LocalDate TournamentDate`; T6 declared `string` and wins on evidence — a `LocalDate` DTO member
> surfaces as an opaque `LocalDate` interface in the generated client
> (`src/app/api/generated/gones-api.ts:10826`), and the frozen frontend shape says
> `tournamentDate: string`. Format with `LocalDatePattern.Iso.Format`. This applies to
> `ArchiveTournamentDetailResponse.TournamentDate` too. `Instant UpdatedAt` stays `Instant`.
>
> **C. `DocumentVersion` is `int`, not `long`.** Archive rows do not derive `VersionedEntity`; the
> column is `version integer`. Change both occurrences in this ticket.
>
> **D. Your 404-code conflict is resolved in your favour** — the repo's existing `not_found` from
> `ApiExceptions.cs:19` wins over the brief's `notFound`. Wire codes are snake_case throughout:
> `stale_version`, `not_found`, `validation_failed`, plus new `archive_tournament_locked` and
> `archive_league_not_empty`.
>
> **E. `Cache-Control` on your routes is `max-age=60`, not `3600`.** Detail and result routes must
> not hide an edit in an HTTP cache for an hour; the 3600 figure applies to catalogs and the years
> index only. This resolves the caveat your body raises. Endpoint names are noun-first, e.g.
> `ArchiveSeasonTournaments`, `ArchiveTournamentDetail`.

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T2, T5
**Commit outcome:** A Season's tournaments and a single Tournament document are fetchable without touching the year-partition cache.

## Context (self-contained)

- Goal: the Archive is being rebuilt on three tiers — **League → LeagueSeason → Tournament**. What used
  to be a flat `League` becomes a `LeagueSeason`; a new `League` tier groups Seasons; a Tournament
  becomes a first-class top-level record that may stand alone (`seasonId: null`). Every `leagues-archive`
  name becomes `archive`.
- This slice: the two **read-through** server routes plus their two derived-result twins. They are the
  endpoints the browser calls when it cannot answer from its local cache. Concretely:
  - The Archive frontend caches public Tournament catalogs in IndexedDB as **year partitions**
    (`gones-archive-cache` / store `year-partitions`, one record per calendar year). A Season row in the
    table expands to its Tournaments. When every year in
    `[year(firstTournamentDate) .. year(lastTournamentDate)]` is cached, complete and locked, the client
    renders from IndexedDB and issues no request. Otherwise it calls
    `GET /api/archive/league-seasons/{seasonId}/tournaments`, renders the response, and **deliberately
    does not cache it**. That non-caching is load-bearing: only `archive-backfill-queue.ts` may ever
    write a year partition, and a partition is written and stamped `completedAt` in one IndexedDB
    transaction so a year is atomically whole or absent. If this read-through response were cached it
    would create a second writer and could leave a half-year partition behind. **Write no cache-writing
    behaviour into this slice, and do not add anything that invites one.**
  - `GET /api/archive/tournaments/{tournamentId}` serves the full document (rounds + playerArchetypes).
    A detail document is **never** stored in a year partition — year partitions hold slim summary rows
    only.
- The old `/api/leagues-archive/**` surface stays alive and serving through this ticket. The strategy is
  expand → migrate → contract: the new `/api/archive/**` routes are **added beside** the old ones, and
  the legacy endpoints, aggregate and frontend are deleted only at the last ticket of the plan. No
  compatibility shim is written; old code merely survives until unused.
- Out of scope here — do not touch:
  - **No year-partition endpoints.** `GET /api/archive/tournaments/all?year=` and `GET /api/archive/years`
    belong to another ticket. Do not add them, do not stub them.
  - **No League or LeagueSeason catalogs.** `GET /api/archive/leagues/all` and
    `GET /api/archive/league-seasons/all` belong to another ticket.
  - **No command endpoints.** No POST, PATCH, DELETE of any kind. No locking rule, no
    `409 archiveTournamentLocked`, no organizer gate.
  - **No scoped statistics.** `GET /api/archive/global-player-statistics*` is another ticket's.
  - **No frontend.** Not one file under `src/app/**` except the regenerated API client
    `src/app/api/generated/gones-api.ts`, which `npm run api:generate` rewrites mechanically.
  - **Do not delete or edit legacy endpoints.**
    `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs` and
    `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs` stay exactly as they are.
  - **No migration.** T2 already produced the one migration named `RebuildArchiveThreeTier`. This ticket
    adds no EF migration and changes no entity, no `DbContext`, no entity configuration.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** Local data may be
    reset freely.
  - The archive is **empty** at this point in the plan (an earlier ticket wiped it) and the legacy pages
    render an empty list. That is expected, not a bug to fix.
  - T2 has already created the three tables `archive_leagues`, `archive_league_seasons`,
    `archive_tournaments`, their EF entities and their `DbSet`s. The exact shapes this ticket consumes
    are spelled out under **Interface contract → Consumes**. If a T2 identifier differs from the name
    written there, substitute the actual identifier — the *shapes* are what this ticket needs, not the
    spellings. Never change a T2 file to make a name match.
  - **404 body code:** the plan's error table names the 404 code `notFound`. The repository's shared
    error handler `backend/src/Gones.Api/Errors/ApiExceptionHandler.cs` renders every
    `Gones.Api.Errors.ResourceNotFoundException` as `application/problem+json` with
    `"code": "not_found"` (snake_case, `backend/src/Gones.Api/Errors/ApiExceptions.cs:19`). Codebase
    wins: this ticket throws the existing `ResourceNotFoundException` and does **not** invent an
    archive-specific 404 type — a shared error type is not this ticket's to own. Consequently the tests
    here assert **HTTP 404 + `application/problem+json`** and never assert the `code` string, so they
    stay green whichever spelling the archive surface finally settles on.
  - `Cache-Control: public, max-age=3600` on all four routes is the plan's binding rule for archive read
    routes, including the detail document. It means an edit can stay invisible in an HTTP cache for up to
    an hour. That staleness is an accepted risk of the plan; the "Resynchronize everything" control in
    Settings (a later ticket) is its escape hatch. Do not lower the max-age.
  - Integration tests run against a real PostgreSQL 17 in Testcontainers
    (`backend/tests/Gones.IntegrationTests/PostgreSqlTestContainer.cs`, image `postgres:17-alpine`), so
    Docker must be available.

## Requirements

1. `GET /api/archive/league-seasons/{seasonId}/tournaments` returns
   `ArchiveCatalogResponse<ArchiveTournamentSummary>` for one LeagueSeason, ordered
   `tournamentDate DESC, id ASC`, capped by `Gones:Archive:MaximumSeasonTournamentSize` (default `5000`),
   `truncated: true` when the cap bit.
2. That route answers `404` when the `seasonId` is absent or soft-deleted, and `200` with
   `items: []`, `totalCount: 0`, `truncated: false` when the Season exists and holds no Tournament.
3. It never deserializes a Tournament document: every field on a row is a projected column. No row
   carries `rounds` or `playerArchetypes`.
4. It excludes soft-deleted Tournaments and Tournaments belonging to another Season, and it excludes
   standalone Tournaments (`season_id IS NULL`).
5. `GET /api/archive/tournaments/{tournamentId}` returns the full `PersistedArchiveTournament` document —
   `id`, `name`, `seasonId` (`null` for a standalone Tournament), `tournamentDate`, `status`, `rounds`,
   `playerArchetypes`, `documentVersion`, `updatedAt` — and `404` when absent or soft-deleted.
6. `GET /api/archive/tournaments/{tournamentId}/result` returns the computed `TournamentResult` for that
   Tournament, and `404` when absent or soft-deleted.
7. `GET /api/archive/league-seasons/{seasonId}/result` returns the computed `LeagueResult` over every
   visible Tournament of that Season with `scope: "season"`, and `404` when the Season is absent or
   soft-deleted. A Season with no Tournament yields `200` with empty `rows` and empty `startDate` /
   `endDate`.
8. All four routes are anonymous public GETs carrying `Cache-Control: public, max-age=3600` and an
   `ETag`, and answer `304 Not Modified` to a matching `If-None-Match`, with the `ETag` and
   `Cache-Control` still present on the 304.
9. A blank or over-200-character route id answers `400` (`ApiValidationException`, wire code
   `validation_failed`) rather than `404`, matching how the existing public reads validate a route value.
10. The response records are added under the `Gones.Api.Archive` namespace in new files. Nothing under
    `backend/src/Gones.Api/Leagues/**` is edited, and no helper is borrowed from
    `PublicLeagueEndpoints` — that file is deleted at the end of the plan, so a reference into it would
    break at deletion time. The three tiny HTTP-caching helpers are duplicated locally on purpose.
11. New integration tests cover every route and every failure path listed above.
12. `backend/openapi/gones.json` and `src/app/api/generated/gones-api.ts` are regenerated so
    `npm run api:check` passes.
13. The app compiles and runs: `npm run backend:build`, `npm run backend:test`, `npm run typecheck` and
    `npm run lint` are green.

## Inputs

Read before writing code:

- `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs` — the endpoint idiom to port, **not to edit**:
  - lines 30-36: the ceiling constant idiom
    (`public const int MaximumCatalogSize = 1000; public const string MaximumCatalogSizeKey = "Gones:Leagues:MaximumCatalogSize";`),
    read with `configuration.GetValue(MaximumCatalogSizeKey, MaximumCatalogSize)`.
  - lines 38-92: `MapPublicLeagueEndpoints`, the `.AllowAnonymous().WithName(...).Produces<T>()` shape.
  - lines 379-400 region (`ListCatalogAsync`, `PrepareCatalogAsync`) and `CapToCeiling`: the
    `Take(ceiling + 1)` truncation pattern and the `total + newest row` ETag input.
  - `GetAsync` / `GetLeagueResultAsync` / `GetTournamentAsync` / `GetTournamentResultAsync` and the
    `Derived<T>` helper (the legacy equivalents this ticket ports): they load the aggregate, compute the
    result through `LeagueRules`, and hash `"{version}:{representation}"` into the ETag.
  - `LoadAsync` → `throw new ResourceNotFoundException()`; `ValidateRouteValue` → 400 on a blank or
    oversized route value; `IsNotModified`, `HashETag`, `SetPublicCache`, `OrdinalCollation = "C"`.
- `backend/src/Gones.Domain/Leagues/LeagueRules.cs:96-120` — the two result computations reused here:

  ```csharp
  public static TournamentResult CalculateTournamentResult(TournamentDocument tournament)
  public static LeagueResult CalculateLeagueResult(LeagueDocument league)
  ```

  Verified by reading the bodies: `CalculateTournamentResult` reads only `tournament.Rounds` and
  `tournament.PlayerArchetypes`; `CalculateLeagueResult` reads only `league.Tournaments`. **Neither ever
  reads `TournamentDocument.LeagueId` nor `LeagueDocument.Id/Name/Status`**, which is what makes the
  adapter in this ticket safe.
- `backend/src/Gones.Domain/Leagues/LeagueDocuments.cs:8-25,85-95` — the legacy records the adapter fills
  and the result records returned on the wire:

  ```csharp
  public sealed record LeagueDocument(string Id, string Name, string Status, IReadOnlyList<TournamentDocument> Tournaments);
  public sealed record TournamentDocument(string Id, string LeagueId, string Name, string TournamentDate, string Status,
      IReadOnlyList<RoundDocument> Rounds, IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes);
  public sealed record RoundDocument(string Id, IReadOnlyList<RoundEntry> Entries);
  public sealed record PlayerArchetypeDocument(string PlayerName, string Archetype);
  public sealed record TournamentResult(string Scope, bool Incomplete, bool Provisional, IReadOnlyList<RankingRow> Rows);
  public sealed record LeagueResult(string Scope, string StartDate, string EndDate, bool Incomplete, bool Provisional, IReadOnlyList<RankingRow> Rows);
  ```

- `backend/src/Gones.Api/Errors/ApiExceptions.cs:10-19` — `ApiValidationException(IReadOnlyDictionary<string, string[]>)`
  → 400 `validation_failed`; `ResourceNotFoundException()` → 404 `not_found`.
- `backend/src/Gones.Api/Program.cs:236-251` — the registration block guarded by
  `if (!string.IsNullOrWhiteSpace(connectionString))`, where `app.MapPublicLeagueEndpoints();` sits at
  line 239. The new mapping call goes immediately after it.
- `backend/src/Gones.Api/Program.cs:53` — `options.SerializerOptions.ConfigureForNodaTime(DateTimeZoneProviders.Tzdb);`.
  A NodaTime `LocalDate` therefore serializes as `"2026-08-17"` and an `Instant` as an ISO 8601 UTC
  timestamp, with no converter to write. Precedent: `PublicEventEndpoints.cs:507-509` puts `LocalDate`
  straight on a response record.
- `backend/src/Gones.Api/Program.cs:178-183` — response compression is applied by
  `app.UseWhen(context => HttpMethods.IsGet(...) && no Authorization header && no refresh cookie && not /api/auth, ...)`.
  New anonymous GETs are compressed automatically; there is nothing to register.
- `backend/tests/Gones.IntegrationTests/PublicLeagueCatalogApiTests.cs` — the integration-test harness to
  copy: `PostgreSqlTestContainer`, `database.Database.MigrateAsync()`, the
  `CreateClient(params (string Key, string Value)[] settings)` helper that feeds `builder.UseSetting`,
  and the ETag/truncation/304 test shapes.
- `backend/tests/Gones.IntegrationTests/PublicLeagueApiTests.cs` — the detail/result test shapes and the
  soft-delete seeding idiom.
- `backend/openapi/gones.json` — the committed OpenAPI snapshot, compared by `npm run api:check`.
  Currently 122 paths, none of them under `/api/archive`.
- `scripts/generate-api.mjs` — `npm run api:generate` boots the API against
  `GONES_DB_CONNECTION` (default `Host=127.0.0.1;Port=5432;Database=gones;Username=gones;Password=gones`),
  scrapes `/openapi/v1.json`, and rewrites both `backend/openapi/gones.json` and
  `src/app/api/generated/gones-api.ts` through NSwag. The generated TypeScript method name comes from the
  route's `.WithName(...)`, which is why every new route below sets one.

**From Depends (T2)** — spelled out because the worker cannot read the T2 ticket. T2 created these; this
ticket only reads them.

- Namespace `Gones.Domain.Archive`, project `backend/src/Gones.Domain`.
- Tables and columns (snake_case, produced by the single T2 migration `RebuildArchiveThreeTier`):

  ```sql
  archive_leagues        (document_id text PK, name text, created_at timestamptz, updated_at timestamptz, version integer, deleted_at timestamptz NULL)
  archive_league_seasons (document_id text PK, league_id text -> archive_leagues(document_id), name text, status text,
                          updated_at timestamptz, version integer, deleted_at timestamptz NULL,
                          tournament_count integer, player_count integer,
                          first_tournament_date date NULL, last_tournament_date date NULL, counts_version integer)
  archive_tournaments    (document_id text PK, season_id text NULL -> archive_league_seasons(document_id), name text,
                          tournament_date date, status text, document jsonb, updated_at timestamptz, version integer,
                          deleted_at timestamptz NULL, player_count integer, counts_version integer)
  ```

- Entities and `DbSet`s on `Gones.Infrastructure.Persistence.GonesDbContext`:

  ```csharp
  public DbSet<ArchiveLeague> ArchiveLeagues => Set<ArchiveLeague>();
  public DbSet<ArchiveLeagueSeason> ArchiveLeagueSeasons => Set<ArchiveLeagueSeason>();
  public DbSet<ArchiveTournament> ArchiveTournaments => Set<ArchiveTournament>();
  ```

- Behaviour T2 left in place, relied on here:
  - A soft delete sets `DeletedAt` (and bumps `UpdatedAt`); a soft-deleted row must be invisible to every
    read in this ticket.
  - `ArchiveTournament.Document` holds `rounds` + `playerArchetypes` as canonical JSON;
    `ReadDocument()` deserializes it. The projected columns (`name`, `season_id`, `tournament_date`,
    `status`, `player_count`) exist precisely so a catalog query never touches the JSON.
  - Season counters (`TournamentCount`, `PlayerCount`, `FirstTournamentDate`, `LastTournamentDate`) are
    denormalized and recomputed inside the same transaction as a Tournament write. This ticket **reads
    none of them** — the Season row is loaded only to prove it exists and to name the Season result.

## Interface contract (level 5)

### Produces

**Route 1 — Season tournaments (read-through, never cached by the client).**

```
GET /api/archive/league-seasons/{seasonId}/tournaments
```

| Aspect | Value |
| --- | --- |
| Auth | anonymous |
| Route param | `seasonId: string`, 1..200 chars |
| Query params | none |
| `200` body | `ArchiveCatalogResponse<ArchiveTournamentSummary>` |
| `304` | on matching `If-None-Match`; `ETag` + `Cache-Control` still set; empty body |
| `400` | blank or >200-char `seasonId` |
| `404` | `seasonId` absent or soft-deleted |
| Headers | `ETag: "<64 hex chars>"` (weak-free, quoted), `Cache-Control: public, max-age=3600` |
| Ordering | `tournament_date DESC, document_id ASC` (`document_id` collated `C`) |
| Cap | `Gones:Archive:MaximumSeasonTournamentSize`, default `5000` |
| OpenAPI name | `GetArchiveSeasonTournaments` |

**Route 2 — Tournament detail document.**

```
GET /api/archive/tournaments/{tournamentId}
```

| Aspect | Value |
| --- | --- |
| Auth | anonymous |
| Route param | `tournamentId: string`, 1..200 chars |
| `200` body | `ArchiveTournamentDetailResponse` |
| `304` / `400` / `404` | as Route 1, on `tournamentId` |
| Headers | `ETag: StrongETag.Encode(version)`, `Cache-Control: public, max-age=3600` |
| OpenAPI name | `GetArchiveTournament` |

**Route 3 — Tournament result.**

```
GET /api/archive/tournaments/{tournamentId}/result
```

| Aspect | Value |
| --- | --- |
| Auth | anonymous |
| `200` body | `Gones.Domain.Leagues.TournamentResult` with `scope == "tournament"` |
| `304` / `400` / `404` | as Route 2 |
| Headers | `ETag: HashETag($"{version}:archive-tournament-result:{tournamentId}")`, `Cache-Control: public, max-age=3600` |
| OpenAPI name | `GetArchiveTournamentResult` |

**Route 4 — Season result.**

```
GET /api/archive/league-seasons/{seasonId}/result
```

| Aspect | Value |
| --- | --- |
| Auth | anonymous |
| `200` body | `Gones.Domain.Leagues.LeagueResult` with `scope == "season"` |
| `304` / `400` / `404` | as Route 1, on `seasonId` |
| Headers | `ETag` hashed over the Season's whole visible Tournament set (formula below), `Cache-Control: public, max-age=3600` |
| OpenAPI name | `GetArchiveSeasonResult` |

**Response records — new file `backend/src/Gones.Api/Archive/ArchiveResponses.cs`, verbatim:**

```csharp
using NodaTime;

namespace Gones.Api.Archive;

/// <summary>The envelope every archive catalog read returns: the rows, the whole count, and whether the
/// ceiling cut the rows short.</summary>
internal sealed record ArchiveCatalogResponse<T>(
    IReadOnlyList<T> Items,
    int TotalCount,
    bool Truncated);

/// <summary>
/// One Tournament row. Carries no <c>rounds</c> and no <c>playerArchetypes</c> — the detail document does
/// — and no <c>locked</c> flag: a row cached today as unlocked would become locked without a refetch, so
/// the client derives lock state from <c>tournamentDate</c>.
/// </summary>
internal sealed record ArchiveTournamentSummary(
    string Id,
    string Name,
    string? SeasonId,
    LocalDate TournamentDate,
    string Status,
    Instant UpdatedAt,
    long DocumentVersion,
    int PlayerCount);
```

Wire shape of `ArchiveTournamentSummary` (PascalCase → camelCase):

```json
{
  "id": "tournament-1",
  "name": "Spring Open",
  "seasonId": "season-1",
  "tournamentDate": "2026-08-17",
  "status": "completed",
  "updatedAt": "2026-08-17T10:00:00Z",
  "documentVersion": 1,
  "playerCount": 3
}
```

Wire shape of `ArchiveCatalogResponse<T>`:

```json
{ "items": [], "totalCount": 0, "truncated": false }
```

**Detail response record — new file `backend/src/Gones.Api/Archive/ArchiveTournamentReadEndpoints.cs`,
declared at the bottom of that file, verbatim:**

```csharp
/// <summary>The whole Tournament document: the wire twin of the frontend's
/// <c>PersistedArchiveTournament</c>. Never stored in a year partition.</summary>
internal sealed record ArchiveTournamentDetailResponse(
    string Id,
    string Name,
    string? SeasonId,
    LocalDate TournamentDate,
    string Status,
    IReadOnlyList<RoundDocument> Rounds,
    IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes,
    long DocumentVersion,
    Instant UpdatedAt);
```

Wire shape:

```json
{
  "id": "tournament-1",
  "name": "Spring Open",
  "seasonId": null,
  "tournamentDate": "2026-08-17",
  "status": "completed",
  "rounds": [{ "id": "round-1", "entries": [{ "kind": "match", "id": "entry-1", "table": "1",
    "player1Name": "Alice", "player2Name": "Bob", "player1Score": 2, "player2Score": 1,
    "player1DeckArchetype": "Tempo", "player2DeckArchetype": "Control" }] }],
  "playerArchetypes": [{ "playerName": "Alice", "archetype": "Tempo" }],
  "documentVersion": 1,
  "updatedAt": "2026-08-17T10:00:00Z"
}
```

**Configuration — new public constants on the endpoint class:**

```csharp
/// <summary>The read-through ceiling for one Season's Tournaments.</summary>
public const int MaximumSeasonTournamentSize = 5000;
public const string MaximumSeasonTournamentSizeKey = "Gones:Archive:MaximumSeasonTournamentSize";
```

Read as `configuration.GetValue(MaximumSeasonTournamentSizeKey, MaximumSeasonTournamentSize)`. No
`appsettings.json` entry is added: the default lives in code, exactly as `Gones:Leagues:MaximumCatalogSize`
does today.

**Registration:**

```csharp
public static void MapArchiveTournamentReadEndpoints(this WebApplication app)
```

called from `backend/src/Gones.Api/Program.cs` immediately after `app.MapPublicLeagueEndpoints();`.

### Consumes

From T2, `namespace Gones.Domain.Archive` (project `backend/src/Gones.Domain`). Read-only here.

```csharp
public sealed record ArchiveTournamentDocument(
    string Id,
    string? SeasonId,
    string Name,
    string TournamentDate,          // ISO 8601 date, "YYYY-MM-DD"
    string Status,                  // "active" | "completed"
    IReadOnlyList<RoundDocument> Rounds,
    IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes);

public sealed class ArchiveLeagueSeason : VersionedEntity
{
    public required string DocumentId { get; init; }
    public string LeagueId { get; }
    public string Name { get; }
    public string Status { get; }              // "active" | "completed"
    public Instant UpdatedAt { get; }
    public Instant? DeletedAt { get; }
    public int TournamentCount { get; }
    public int PlayerCount { get; }
    public LocalDate? FirstTournamentDate { get; }
    public LocalDate? LastTournamentDate { get; }
    public int CountsVersion { get; }
    public static ArchiveLeagueSeason Create(string documentId, string leagueId, string name, string status, Instant now);
    public void SoftDelete(Instant now);
}

public sealed class ArchiveTournament : VersionedEntity
{
    public required string DocumentId { get; init; }
    public string? SeasonId { get; }
    public string Name { get; }
    public LocalDate TournamentDate { get; }
    public string Status { get; }
    public string Document { get; }            // canonical JSON, jsonb column `document`
    public Instant UpdatedAt { get; }
    public Instant? DeletedAt { get; }
    public int PlayerCount { get; }
    public int CountsVersion { get; }
    public ArchiveTournamentDocument ReadDocument();
    public static ArchiveTournament Create(ArchiveTournamentDocument document, Instant now);
    public void Apply(ArchiveTournamentDocument document, Instant now);
    public void SoftDelete(Instant now);
}

public sealed class ArchiveLeague : VersionedEntity
{
    public required string DocumentId { get; init; }
    public string Name { get; }
    public Instant CreatedAt { get; }
    public Instant UpdatedAt { get; }
    public Instant? DeletedAt { get; }
    public static ArchiveLeague Create(string documentId, string name, Instant now);
}
```

`VersionedEntity` (`backend/src/Gones.Domain/Persistence/`, existing, unchanged):

```csharp
public abstract class VersionedEntity
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public long Version { get; set; } = 1;
}
```

`GonesDbContext` bumps `Version` on every save and marks it a concurrency token.

Existing, unchanged, consumed verbatim:

```csharp
namespace Gones.Application.Concurrency;
public static class StrongETag { public static string Encode(long version); public static bool TryDecode(string? etag, out long version); }

namespace Gones.Api.Errors;
public sealed class ApiValidationException(IReadOnlyDictionary<string, string[]> errors) : ApiException; // 400 validation_failed
public sealed class ResourceNotFoundException() : ApiException;                                          // 404 not_found

namespace Gones.Domain.Leagues;
public static class LeagueRules
{
    public static TournamentResult CalculateTournamentResult(TournamentDocument tournament);
    public static LeagueResult CalculateLeagueResult(LeagueDocument league);
}
```

### Errors

| Path | HTTP | Thrown | Wire body |
| --- | --- | --- | --- |
| blank / >200-char `seasonId` or `tournamentId` | `400` | `new ApiValidationException(new Dictionary<string, string[]> { ["seasonId"] = ["Value must contain 1 to 200 characters."] })` | `application/problem+json`, `code: "validation_failed"`, `errors.seasonId[0]` |
| `seasonId` not in `archive_league_seasons`, or `deleted_at IS NOT NULL` | `404` | `new ResourceNotFoundException()` | `application/problem+json`, `code: "not_found"` (the plan's table calls this `notFound`; the shared handler emits `not_found` — see Assumptions) |
| `tournamentId` not in `archive_tournaments`, or `deleted_at IS NOT NULL` | `404` | `new ResourceNotFoundException()` | as above |
| matching `If-None-Match` | `304` | — | empty; `ETag` + `Cache-Control` present |

No other status code is produced by this slice. There is no `409`, no `412`, no `403` — this ticket writes
nothing.

### Invariants

- **Ordering, binding:** `tournamentDate DESC, id ASC`. The `id` tiebreak is `document_id` collated `C`
  (`EF.Functions.Collate(row.DocumentId, "C")`), so it matches the browser's ordinal string sort. Ordering
  is total: `document_id` is the primary key, so no two rows tie.
- **Visibility:** a row is visible iff `deleted_at IS NULL`. Applies to Seasons and to Tournaments,
  independently, on every route.
- **Membership:** Route 1 and Route 4 select `season_id = {seasonId}` exactly. `season_id IS NULL`
  (standalone) never appears in either.
- **Nullability:** `ArchiveTournamentSummary.SeasonId` and `ArchiveTournamentDetailResponse.SeasonId` are
  `string?` and serialize as JSON `null` for a standalone Tournament — never omitted, never `""`.
  `tournamentDate` is never null. `rounds` and `playerArchetypes` are never null; empty arrays instead.
- **Units:** `tournamentDate` is a calendar date `YYYY-MM-DD` with no timezone. `updatedAt` is an
  ISO 8601 UTC instant.
- **Idempotency:** all four routes are pure reads. Two identical requests with no intervening write return
  byte-identical bodies and the same `ETag`.
- **No document deserialization on Route 1:** the LINQ projection selects only
  `DocumentId, Name, SeasonId, TournamentDate, Status, UpdatedAt, Version, PlayerCount`. The `Document`
  column is never selected. Enforced by a test asserting no row carries `rounds`.
- **Truncation:** `Take(ceiling + 1)`; if `count > ceiling`, drop the extra row, set `truncated: true`, and
  log a warning through `ILoggerFactory`. `totalCount` is always the whole visible count of the Season, not
  the returned row count — that is what makes the flag readable.
- **ETag inputs, exact:**
  - Route 1: `HashETag($"{seasonId}:{total}:{newest?.UpdatedAt}:{newest?.DocumentId}:{newest?.Version}:archive-season-tournaments:{ceiling}")`
    where `newest` is the Season's visible Tournament ordered `UpdatedAt DESC, DocumentId ASC` and `total`
    is the visible count. Every write bumps a Tournament's `UpdatedAt` and `Version`; a create, a soft
    delete or a move across Seasons moves `total`. The Season's own `Version` is **not** an input —
    concurrency is per-Tournament and editing a Tournament never bumps its Season's version.
  - Route 2: `StrongETag.Encode(tournament.Version)`.
  - Route 3: `HashETag($"{tournament.Version}:archive-tournament-result:{tournamentId}")`.
  - Route 4: `HashETag($"{seasonId}:{total}:{newest?.UpdatedAt}:{newest?.DocumentId}:{newest?.Version}:archive-season-result")`
    with the same `newest` / `total` as Route 1.
  The two Season routes differ by their representation suffix, which keeps them in separate ETag
  namespaces: without it a client holding the row-list ETag would be answered `304` and go on reading a
  result body.
- **Result scope strings:** `TournamentResult.Scope` stays `"tournament"` as the domain produces it.
  `LeagueResult.Scope` is rewritten to `"season"` with `result with { Scope = "season" }`, because under
  the three-tier vocabulary `League` now names the *top* tier and a Season result labelled `"league"`
  would be actively wrong.
- **`LeagueResult` date fields:** `StartDate` / `EndDate` are the min / max `tournamentDate` of the Season
  as ISO strings, `""` when the Season has no Tournament — this is what `CalculateLeagueResult` already
  produces from an empty `Tournaments` list.
- **Adapter fidelity:** the legacy `TournamentDocument.LeagueId` slot is filled with
  `document.SeasonId ?? string.Empty`. Neither result computation reads it (verified above); it exists
  only because the record requires a non-null string.
- **Read-through, not cached:** these routes exist so the client can render without writing anything to
  IndexedDB. Nothing in this slice writes, warms or invalidates a cache.

## TDD

1. **Red** — write both integration test files first and run them. Every test below must fail (the routes
   do not exist yet, so the harness returns `404` from routing, or the file does not compile against a
   missing symbol). Named failing tests:
   - `ArchiveSeasonTournamentsApiTests`: `Returns_the_Season_tournaments_newest_first`,
     `Omits_soft_deleted_and_foreign_and_standalone_Tournaments`,
     `Omits_rounds_and_archetypes_from_every_row`,
     `Answers_an_empty_page_for_a_Season_with_no_Tournament`,
     `Answers_404_for_an_unknown_or_soft_deleted_Season`,
     `Answers_400_for_a_blank_or_oversized_Season_id`,
     `Truncates_at_the_configured_ceiling`,
     `Answers_304_on_a_matching_ETag`,
     `Changes_its_ETag_when_a_Tournament_changes`.
   - `ArchiveTournamentDetailApiTests`: `Returns_the_whole_document_with_rounds_and_archetypes`,
     `Serves_a_standalone_Tournament_with_a_null_seasonId`,
     `Answers_404_for_an_unknown_or_soft_deleted_Tournament`,
     `Answers_304_on_a_matching_ETag`,
     `Computes_the_Tournament_result`,
     `Computes_the_Season_result_over_every_Tournament`,
     `Answers_empty_rows_for_the_result_of_a_Season_with_no_Tournament`,
     `Answers_404_for_a_result_of_an_unknown_id`,
     `Sets_the_catalog_cache_control_on_every_route`.
2. **Green** — write `ArchiveResponses.cs`, `ArchiveTournamentReadEndpoints.cs`, register the mapping in
   `Program.cs`. Minimum code to pass; no extra route, no extra field.
3. **Refactor** — only the three local HTTP helpers (`HashETag`, `IsNotModified`, `SetCatalogCache`) and
   the two shared query helpers (`VisibleTournaments`, `LoadSeasonAsync`). Keep green. Do not extract
   anything into `Gones.Api/Leagues/**`.

Assert behaviour through HTTP — status, headers, JSON — never through a handler method call.

## Test plan

Shared seed for both files (created once in `InitializeAsync`, after `MigrateAsync()`):

| Row | Values |
| --- | --- |
| League `league-1` | name `League One`, `2026-01-01T00:00:00Z` |
| Season `season-1` | league `league-1`, name `Season One`, status `completed`, `2026-01-01T00:00:00Z` |
| Season `season-empty` | league `league-1`, name `Season Empty`, status `active`, `2026-01-01T00:00:00Z` |
| Season `season-gone` | league `league-1`, name `Season Gone`, status `completed`, then `SoftDelete` |
| Tournament `t-old` | season `season-1`, `2026-03-01`, 1 round, Alice 2-1 Bob, `updatedAt 2026-03-01T10:00Z` |
| Tournament `t-new` | season `season-1`, `2026-08-17`, 1 round, Alice 2-0 Cara, `updatedAt 2026-08-17T10:00Z` |
| Tournament `t-deleted` | season `season-1`, `2026-05-01`, then `SoftDelete` |
| Tournament `t-standalone` | `seasonId: null`, `2026-06-01`, 1 round, Bob 2-0 Cara |
| Season `season-2` | league `league-1`, name `Season Two`, status `active` |
| Tournament `t-foreign` | season `season-2`, `2026-07-01`, 1 round, Alice 2-0 Bob |

`season-empty` holds no Tournament and must stay that way — it is the fixture for the empty-page and
empty-result tests.

`ArchiveSeasonTournamentsApiTests` — path `/api/archive/league-seasons/season-1/tournaments`:

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Returns_the_Season_tournaments_newest_first` | GET path | `200`; `items[].id == ["t-new", "t-old"]`; `totalCount == 2`; `truncated == false`; `items[0]` carries exactly `id, name, seasonId, tournamentDate, status, updatedAt, documentVersion, playerCount`; `items[0].tournamentDate == "2026-08-17"`; `items[0].seasonId == "season-1"`; `items[0].playerCount == 2` |
| `Omits_soft_deleted_and_foreign_and_standalone_Tournaments` | GET path | `items[].id` contains none of `t-deleted`, `t-foreign`, `t-standalone`; `totalCount == 2` |
| `Omits_rounds_and_archetypes_from_every_row` | GET path | for every item: `TryGetProperty("rounds", out _) == false` and `TryGetProperty("playerArchetypes", out _) == false` |
| `Answers_an_empty_page_for_a_Season_with_no_Tournament` | GET `/api/archive/league-seasons/season-empty/tournaments` | `200`; `items.GetArrayLength() == 0`; `totalCount == 0`; `truncated == false` |
| `Answers_404_for_an_unknown_or_soft_deleted_Season` | GET `.../season-missing/tournaments` and `.../season-gone/tournaments` | both `404`; `Content.Headers.ContentType.MediaType == "application/problem+json"` |
| `Answers_400_for_a_blank_or_oversized_Season_id` | GET `.../{new string('x', 201)}/tournaments` and `.../%20/tournaments` | both `400` |
| `Truncates_at_the_configured_ceiling` | client built with `("Gones:Archive:MaximumSeasonTournamentSize", "1")`, GET path | `200`; `items.GetArrayLength() == 1`; `items[0].id == "t-new"`; `truncated == true`; `totalCount == 2` |
| `Answers_304_on_a_matching_ETag` | GET path, then GET with `If-None-Match: <etag>` | `304`; same `ETag`; `Cache-Control == "public, max-age=3600"` |
| `Changes_its_ETag_when_a_Tournament_changes` | capture ETag; `Apply` a renamed document to `t-new` at a later instant; GET again | ETag differs |

`ArchiveTournamentDetailApiTests`:

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Returns_the_whole_document_with_rounds_and_archetypes` | GET `/api/archive/tournaments/t-new` | `200`; `id == "t-new"`; `name == "Tournament New"`; `seasonId == "season-1"`; `tournamentDate == "2026-08-17"`; `status == "completed"`; `rounds[0].entries[0].player1Name == "Alice"`; `playerArchetypes[0].playerName == "Alice"`; `documentVersion >= 1`; `updatedAt` present |
| `Serves_a_standalone_Tournament_with_a_null_seasonId` | GET `/api/archive/tournaments/t-standalone` | `200`; `GetProperty("seasonId").ValueKind == JsonValueKind.Null` |
| `Answers_404_for_an_unknown_or_soft_deleted_Tournament` | GET `/api/archive/tournaments/t-missing` and `/t-deleted` | both `404`, `application/problem+json` |
| `Answers_304_on_a_matching_ETag` | GET `/api/archive/tournaments/t-new`, replay with `If-None-Match` | `304`; ETag preserved |
| `Computes_the_Tournament_result` | GET `/api/archive/tournaments/t-new/result` | `200`; `scope == "tournament"`; `rows[0].playerName == "Alice"`; `rows[0].rank == 1`; `rows.GetArrayLength() == 2` |
| `Computes_the_Season_result_over_every_Tournament` | GET `/api/archive/league-seasons/season-1/result` | `200`; `scope == "season"`; `startDate == "2026-03-01"`; `endDate == "2026-08-17"`; `rows` contains `Alice`, `Bob`, `Cara`; Alice's `playedMatchCount == 2`; the soft-deleted `t-deleted` contributes nothing |
| `Answers_empty_rows_for_the_result_of_a_Season_with_no_Tournament` | GET `/api/archive/league-seasons/season-empty/result` | `200`; `rows.GetArrayLength() == 0`; `startDate == ""`; `endDate == ""`; `incomplete == false` |
| `Answers_404_for_a_result_of_an_unknown_id` | GET `/api/archive/tournaments/t-missing/result`, `/api/archive/league-seasons/season-missing/result`, `/api/archive/league-seasons/season-gone/result` | all `404` |
| `Sets_the_catalog_cache_control_on_every_route` | GET each of the four routes | each: `Cache-Control == "public, max-age=3600"` and `ETag != null` |

Run:

```bash
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveSeasonTournamentsApiTests|FullyQualifiedName~ArchiveTournamentDetailApiTests"
```

## Impl steps

- [ ] 1. Confirm the T2 surface this ticket reads, before writing a line against it
  - [ ] 1.1 Run `ls backend/src/Gones.Domain/Archive/` and
        `grep -rn "class ArchiveTournament\b\|class ArchiveLeagueSeason\b\|class ArchiveLeague\b\|record ArchiveTournamentDocument" backend/src/Gones.Domain --include=*.cs`.
        Note the actual class names.
  - [ ] 1.2 Run `grep -n "ArchiveTournaments\|ArchiveLeagueSeasons\|ArchiveLeagues" backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs`.
        Note the actual `DbSet` property names.
  - [ ] 1.3 If any name differs from the **Consumes** block above, use the actual name everywhere below.
        This is a spelling substitution only — if a *shape* is missing (for example `ReadDocument()` or the
        `PlayerCount` column), stop and report it rather than adding it to a T2 file.

- [ ] 2. Red: the Season-tournaments integration test
  - [ ] 2.1 Create `backend/tests/Gones.IntegrationTests/ArchiveSeasonTournamentsApiTests.cs` with:

        ```csharp
        using System.Net;
        using System.Net.Http.Json;
        using System.Text.Json;
        using Gones.Domain.Archive;
        using Gones.Domain.Leagues;
        using Gones.Infrastructure.Persistence;
        using Microsoft.AspNetCore.Hosting;
        using Microsoft.AspNetCore.Mvc.Testing;
        using Microsoft.EntityFrameworkCore;
        using NodaTime;

        namespace Gones.IntegrationTests;

        /// <summary>
        /// The read-through a Season row falls back to when its years are not all cached. The client
        /// renders this response and deliberately does not cache it: only the backfill queue writes a
        /// year partition, and a second writer could leave a half-written year behind.
        /// </summary>
        public sealed class ArchiveSeasonTournamentsApiTests : IAsyncLifetime
        {
            private const string Path = "/api/archive/league-seasons/season-1/tournaments";
            private static readonly Instant Seeded = Instant.FromUtc(2026, 1, 1, 0, 0);

            private readonly PostgreSqlTestContainer postgres = new();
            private readonly List<WebApplicationFactory<Program>> factories = [];

            public async Task InitializeAsync()
            {
                await postgres.StartAsync();
                await using var database = CreateContext();
                await database.Database.MigrateAsync();
                await ArchiveSeed.SeedAsync(database);
            }

            public async Task DisposeAsync()
            {
                foreach (var factory in factories) await factory.DisposeAsync();
                await postgres.DisposeAsync();
            }

            private HttpClient CreateClient(params (string Key, string Value)[] settings)
            {
                var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
                {
                    builder.UseEnvironment("Testing");
                    builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
                    builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
                    builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t7-archive-read-through-signing-key");
                    builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
                    foreach (var (key, value) in settings) builder.UseSetting(key, value);
                });
                factories.Add(factory);
                return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            }

            private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
                .ConfigureGones(postgres.GetConnectionString()).Options);
        }
        ```

  - [ ] 2.2 Create the shared seed helper `backend/tests/Gones.IntegrationTests/ArchiveSeed.cs`:

        ```csharp
        using Gones.Domain.Archive;
        using Gones.Domain.Leagues;
        using Gones.Infrastructure.Persistence;
        using Microsoft.EntityFrameworkCore;
        using NodaTime;

        namespace Gones.IntegrationTests;

        /// <summary>The three-tier fixture both archive read-through test classes seed.</summary>
        internal static class ArchiveSeed
        {
            internal static readonly Instant Seeded = Instant.FromUtc(2026, 1, 1, 0, 0);

            internal static async Task SeedAsync(GonesDbContext database)
            {
                database.ArchiveLeagues.Add(ArchiveLeague.Create("league-1", "League One", Seeded));
                database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-1", "league-1", "Season One", "completed", Seeded));
                database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-2", "league-1", "Season Two", "active", Seeded));
                database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-empty", "league-1", "Season Empty", "active", Seeded));
                database.ArchiveLeagueSeasons.Add(ArchiveLeagueSeason.Create("season-gone", "league-1", "Season Gone", "completed", Seeded));
                database.ArchiveTournaments.Add(ArchiveTournament.Create(
                    Tournament("t-old", "season-1", "Tournament Old", "2026-03-01", "Alice", "Bob", 2, 1),
                    Instant.FromUtc(2026, 3, 1, 10, 0)));
                database.ArchiveTournaments.Add(ArchiveTournament.Create(
                    Tournament("t-new", "season-1", "Tournament New", "2026-08-17", "Alice", "Cara", 2, 0),
                    Instant.FromUtc(2026, 8, 17, 10, 0)));
                database.ArchiveTournaments.Add(ArchiveTournament.Create(
                    Tournament("t-deleted", "season-1", "Tournament Deleted", "2026-05-01", "Dave", "Erin", 2, 0),
                    Instant.FromUtc(2026, 5, 1, 10, 0)));
                database.ArchiveTournaments.Add(ArchiveTournament.Create(
                    Tournament("t-foreign", "season-2", "Tournament Foreign", "2026-07-01", "Alice", "Bob", 2, 0),
                    Instant.FromUtc(2026, 7, 1, 10, 0)));
                database.ArchiveTournaments.Add(ArchiveTournament.Create(
                    Tournament("t-standalone", null, "Tournament Standalone", "2026-06-01", "Bob", "Cara", 2, 0),
                    Instant.FromUtc(2026, 6, 1, 10, 0)));
                await database.SaveChangesAsync();

                (await database.ArchiveLeagueSeasons.SingleAsync(row => row.DocumentId == "season-gone"))
                    .SoftDelete(Instant.FromUtc(2026, 8, 18, 10, 0));
                (await database.ArchiveTournaments.SingleAsync(row => row.DocumentId == "t-deleted"))
                    .SoftDelete(Instant.FromUtc(2026, 8, 18, 10, 0));
                await database.SaveChangesAsync();
            }

            internal static ArchiveTournamentDocument Tournament(
                string id, string? seasonId, string name, string date, string player1, string player2, int score1, int score2) =>
                new(id, seasonId, name, date, "completed",
                    [new RoundDocument($"{id}-round-1", [new MatchRoundEntry($"{id}-entry-1", "1", player1, player2, score1, score2, "Tempo", "Control")])],
                    [new PlayerArchetypeDocument(player1, "Tempo"), new PlayerArchetypeDocument(player2, "Control")]);
        }
        ```

  - [ ] 2.3 Add the nine `[Fact]` methods of `ArchiveSeasonTournamentsApiTests` from the **Test plan**
        table, each asserting exactly the listed expectations. Ordering assertion, verbatim:

        ```csharp
        Assert.Equal(["t-new", "t-old"], items.Select(item => item.GetProperty("id").GetString()!).ToArray());
        ```

  - [ ] 2.4 Run
        `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveSeasonTournamentsApiTests"`
        and confirm every test fails. Record the failure output.

- [ ] 3. Red: the detail and result integration test
  - [ ] 3.1 Create `backend/tests/Gones.IntegrationTests/ArchiveTournamentDetailApiTests.cs` with the same
        `IAsyncLifetime` / `CreateClient` / `CreateContext` scaffolding as step 2.1 (signing key
        `"t7-archive-detail-signing-key-value"`, no `Path` constant) and `ArchiveSeed.SeedAsync(database)`
        in `InitializeAsync`.
  - [ ] 3.2 Add the nine `[Fact]` methods from the **Test plan** table for this class.
  - [ ] 3.3 Run
        `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentDetailApiTests"`
        and confirm every test fails. Record the failure output.

- [ ] 4. Green: the shared archive response records
  - [ ] 4.1 Run `ls backend/src/Gones.Api/Archive/ 2>/dev/null` and
        `grep -rn "record ArchiveCatalogResponse\|record ArchiveTournamentSummary" backend/src/Gones.Api --include=*.cs`.
  - [ ] 4.2 If neither record exists, create `backend/src/Gones.Api/Archive/ArchiveResponses.cs` with the
        verbatim content from **Interface contract → Produces → Response records**. If they already exist
        (another ticket landed first), do not create the file and do not edit theirs — reuse them, and if a
        field list differs from the contract above, stop and report the conflict.

- [ ] 5. Green: the endpoint class
  - [ ] 5.1 Create `backend/src/Gones.Api/Archive/ArchiveTournamentReadEndpoints.cs` with the header,
        constants and route table:

        ```csharp
        using System.Linq.Expressions;
        using System.Security.Cryptography;
        using System.Text;
        using Gones.Api.Errors;
        using Gones.Application.Concurrency;
        using Gones.Domain.Archive;
        using Gones.Domain.Leagues;
        using Gones.Infrastructure.Persistence;
        using Microsoft.EntityFrameworkCore;
        using NodaTime;

        namespace Gones.Api.Archive;

        /// <summary>
        /// The archive reads the browser falls back to when its IndexedDB year partitions cannot answer:
        /// one Season's Tournaments, one Tournament document, and the two derived standings.
        ///
        /// <para>The client renders the Season read-through and deliberately does not cache it. Year
        /// partitions have exactly one writer — the backfill queue — and a partition is written and
        /// stamped complete in a single IndexedDB transaction, so a year is atomically whole or absent.
        /// Caching this response would make a second writer and could leave a half-written year behind.
        /// A detail document is never stored in a partition either: partitions hold summary rows.</para>
        /// </summary>
        internal static class ArchiveTournamentReadEndpoints
        {
            private const int MaximumArchiveIdLength = 200;
            private const string CatalogCacheControl = "public, max-age=3600";
            /// <summary>Postgres collation that orders text byte by byte, the way the browser's ordinal sort does.</summary>
            private const string OrdinalCollation = "C";

            /// <summary>The read-through ceiling for one Season's Tournaments.</summary>
            public const int MaximumSeasonTournamentSize = 5000;
            public const string MaximumSeasonTournamentSizeKey = "Gones:Archive:MaximumSeasonTournamentSize";

            public static void MapArchiveTournamentReadEndpoints(this WebApplication app)
            {
                app.MapGet("/api/archive/league-seasons/{seasonId}/tournaments", GetSeasonTournamentsAsync)
                    .AllowAnonymous()
                    .WithName("GetArchiveSeasonTournaments")
                    .Produces<ArchiveCatalogResponse<ArchiveTournamentSummary>>()
                    .Produces(StatusCodes.Status304NotModified)
                    .ProducesProblem(StatusCodes.Status400BadRequest)
                    .ProducesProblem(StatusCodes.Status404NotFound);
                app.MapGet("/api/archive/league-seasons/{seasonId}/result", GetSeasonResultAsync)
                    .AllowAnonymous()
                    .WithName("GetArchiveSeasonResult")
                    .Produces<LeagueResult>()
                    .Produces(StatusCodes.Status304NotModified)
                    .ProducesProblem(StatusCodes.Status400BadRequest)
                    .ProducesProblem(StatusCodes.Status404NotFound);
                app.MapGet("/api/archive/tournaments/{tournamentId}", GetTournamentAsync)
                    .AllowAnonymous()
                    .WithName("GetArchiveTournament")
                    .Produces<ArchiveTournamentDetailResponse>()
                    .Produces(StatusCodes.Status304NotModified)
                    .ProducesProblem(StatusCodes.Status400BadRequest)
                    .ProducesProblem(StatusCodes.Status404NotFound);
                app.MapGet("/api/archive/tournaments/{tournamentId}/result", GetTournamentResultAsync)
                    .AllowAnonymous()
                    .WithName("GetArchiveTournamentResult")
                    .Produces<TournamentResult>()
                    .Produces(StatusCodes.Status304NotModified)
                    .ProducesProblem(StatusCodes.Status400BadRequest)
                    .ProducesProblem(StatusCodes.Status404NotFound);
            }
        }
        ```

  - [ ] 5.2 Append the Season-tournaments handler inside the class:

        ```csharp
            private static async Task<IResult> GetSeasonTournamentsAsync(
                string seasonId,
                HttpRequest request,
                HttpResponse response,
                GonesDbContext database,
                IConfiguration configuration,
                ILoggerFactory loggerFactory,
                CancellationToken cancellationToken)
            {
                ValidateRouteValue(seasonId, nameof(seasonId));
                await EnsureSeasonExistsAsync(seasonId, database, cancellationToken);
                var ceiling = configuration.GetValue(MaximumSeasonTournamentSizeKey, MaximumSeasonTournamentSize);
                var (total, etag) = await SeasonStampAsync(seasonId, $"archive-season-tournaments:{ceiling}", database, cancellationToken);
                SetCatalogCache(response, etag);
                if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

                // One row past the ceiling is what tells a truncated read-through from a Season that ends
                // exactly there. The document column is never selected: every field here is a projected
                // column, which is the whole point of the slim row.
                var fetched = await SeasonTournaments(database, seasonId)
                    .OrderByDescending(row => row.TournamentDate)
                    .ThenBy(row => EF.Functions.Collate(row.DocumentId, OrdinalCollation))
                    .Take(ceiling + 1)
                    .Select(row => new ArchiveTournamentSummary(
                        row.DocumentId,
                        row.Name,
                        row.SeasonId,
                        row.TournamentDate,
                        row.Status,
                        row.UpdatedAt,
                        row.Version,
                        row.PlayerCount))
                    .ToListAsync(cancellationToken);
                var truncated = CapToCeiling(fetched, ceiling, total, loggerFactory);

                return Results.Ok(new ArchiveCatalogResponse<ArchiveTournamentSummary>(fetched, total, truncated));
            }
        ```

  - [ ] 5.3 Append the detail handler:

        ```csharp
            private static async Task<IResult> GetTournamentAsync(
                string tournamentId,
                HttpRequest request,
                HttpResponse response,
                GonesDbContext database,
                CancellationToken cancellationToken)
            {
                var tournament = await LoadTournamentAsync(tournamentId, database, cancellationToken);
                var etag = StrongETag.Encode(tournament.Version);
                SetCatalogCache(response, etag);
                if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
                var document = tournament.ReadDocument();
                return Results.Ok(new ArchiveTournamentDetailResponse(
                    document.Id,
                    document.Name,
                    document.SeasonId,
                    tournament.TournamentDate,
                    document.Status,
                    document.Rounds,
                    document.PlayerArchetypes,
                    tournament.Version,
                    tournament.UpdatedAt));
            }
        ```

  - [ ] 5.4 Append the Tournament-result handler:

        ```csharp
            private static async Task<IResult> GetTournamentResultAsync(
                string tournamentId,
                HttpRequest request,
                HttpResponse response,
                GonesDbContext database,
                CancellationToken cancellationToken)
            {
                var tournament = await LoadTournamentAsync(tournamentId, database, cancellationToken);
                var etag = HashETag($"{tournament.Version}:archive-tournament-result:{tournamentId}");
                SetCatalogCache(response, etag);
                if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
                return Results.Ok(LeagueRules.CalculateTournamentResult(ToLegacyTournament(tournament.ReadDocument())));
            }
        ```

  - [ ] 5.5 Append the Season-result handler:

        ```csharp
            private static async Task<IResult> GetSeasonResultAsync(
                string seasonId,
                HttpRequest request,
                HttpResponse response,
                GonesDbContext database,
                CancellationToken cancellationToken)
            {
                ValidateRouteValue(seasonId, nameof(seasonId));
                var season = await LoadSeasonAsync(seasonId, database, cancellationToken);
                var (_, etag) = await SeasonStampAsync(seasonId, "archive-season-result", database, cancellationToken);
                SetCatalogCache(response, etag);
                if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

                // The standings need the documents, so this is the one Season route that reads JSON.
                var tournaments = await SeasonTournaments(database, seasonId)
                    .OrderBy(row => row.TournamentDate)
                    .ThenBy(row => EF.Functions.Collate(row.DocumentId, OrdinalCollation))
                    .ToListAsync(cancellationToken);
                var league = new LeagueDocument(
                    season.DocumentId,
                    season.Name,
                    season.Status,
                    tournaments.Select(row => ToLegacyTournament(row.ReadDocument())).ToList());
                // `League` now names the top tier, so a Season's standings must not call themselves one.
                return Results.Ok(LeagueRules.CalculateLeagueResult(league) with { Scope = "season" });
            }
        ```

  - [ ] 5.6 Append the query, adapter and validation helpers:

        ```csharp
            private static IQueryable<ArchiveTournament> SeasonTournaments(GonesDbContext database, string seasonId) =>
                database.ArchiveTournaments.AsNoTracking()
                    .Where(row => row.DeletedAt == null && row.SeasonId == seasonId);

            /// <summary>
            /// The count and the ETag both Season routes share. Every write bumps a Tournament's
            /// <c>UpdatedAt</c> and <c>Version</c>, so the newest row plus the count identifies the set: an
            /// edit moves the stamp, a create, a soft delete or a move across Seasons moves the count. The
            /// Season's own version is deliberately not an input — concurrency is per-Tournament, and
            /// editing a Tournament never bumps its Season. <paramref name="representation"/> keeps the two
            /// bodies in separate ETag namespaces; without it a client holding the row-list ETag would be
            /// answered 304 and go on reading a result body.
            /// </summary>
            private static async Task<(int Total, string ETag)> SeasonStampAsync(
                string seasonId,
                string representation,
                GonesDbContext database,
                CancellationToken cancellationToken)
            {
                var query = SeasonTournaments(database, seasonId);
                var total = await query.CountAsync(cancellationToken);
                var newest = await query
                    .OrderByDescending(row => row.UpdatedAt)
                    .ThenBy(row => EF.Functions.Collate(row.DocumentId, OrdinalCollation))
                    .Select(row => new { row.UpdatedAt, row.DocumentId, row.Version })
                    .FirstOrDefaultAsync(cancellationToken);
                return (total, HashETag($"{seasonId}:{total}:{newest?.UpdatedAt}:{newest?.DocumentId}:{newest?.Version}:{representation}"));
            }

            private static async Task<ArchiveLeagueSeason> LoadSeasonAsync(string seasonId, GonesDbContext database, CancellationToken cancellationToken) =>
                await database.ArchiveLeagueSeasons.AsNoTracking()
                    .SingleOrDefaultAsync(row => row.DocumentId == seasonId && row.DeletedAt == null, cancellationToken)
                    ?? throw new ResourceNotFoundException();

            private static async Task EnsureSeasonExistsAsync(string seasonId, GonesDbContext database, CancellationToken cancellationToken)
            {
                if (!await database.ArchiveLeagueSeasons.AsNoTracking()
                        .AnyAsync(row => row.DocumentId == seasonId && row.DeletedAt == null, cancellationToken))
                    throw new ResourceNotFoundException();
            }

            private static async Task<ArchiveTournament> LoadTournamentAsync(string tournamentId, GonesDbContext database, CancellationToken cancellationToken)
            {
                ValidateRouteValue(tournamentId, nameof(tournamentId));
                return await database.ArchiveTournaments.AsNoTracking()
                    .SingleOrDefaultAsync(row => row.DocumentId == tournamentId && row.DeletedAt == null, cancellationToken)
                    ?? throw new ResourceNotFoundException();
            }

            /// <summary>
            /// The three-tier document in the shape the Swiss engine takes. The <c>LeagueId</c> slot is
            /// filled only because the record demands a non-null string: neither
            /// <c>CalculateTournamentResult</c> nor <c>CalculateLeagueResult</c> ever reads it.
            /// </summary>
            private static TournamentDocument ToLegacyTournament(ArchiveTournamentDocument document) =>
                new(document.Id,
                    document.SeasonId ?? string.Empty,
                    document.Name,
                    document.TournamentDate,
                    document.Status,
                    document.Rounds,
                    document.PlayerArchetypes);

            private static bool CapToCeiling<T>(List<T> fetched, int ceiling, int total, ILoggerFactory loggerFactory)
            {
                if (fetched.Count <= ceiling) return false;
                fetched.RemoveRange(ceiling, fetched.Count - ceiling);
                loggerFactory.CreateLogger("Gones.Api.Archive")
                    .LogWarning("Archive Season Tournament read-through truncated: total={Total} ceiling={Ceiling}", total, ceiling);
                return true;
            }

            private static void ValidateRouteValue(string value, string field)
            {
                if (string.IsNullOrWhiteSpace(value) || value.Length > MaximumArchiveIdLength)
                    throw new ApiValidationException(new Dictionary<string, string[]>
                    {
                        [field] = [$"Value must contain 1 to {MaximumArchiveIdLength} characters."]
                    });
            }

            // The three caching helpers are local copies rather than references into the legacy public
            // League endpoints: that file is deleted when the old surface retires, and a reference into it
            // would break at deletion time.
            private static void SetCatalogCache(HttpResponse response, string etag)
            {
                response.Headers.ETag = etag;
                response.Headers.CacheControl = CatalogCacheControl;
            }

            private static bool IsNotModified(HttpRequest request, string etag) =>
                request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

            private static string HashETag(string value) =>
                $"\"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)))}\"";
        ```

  - [ ] 5.7 Append the detail response record after the closing brace of the class, verbatim from
        **Interface contract → Produces → Detail response record**.
  - [ ] 5.8 Delete the unused `using System.Linq.Expressions;` if the compiler flags it; keep the file
        warning-free (`dotnet build` treats the solution's warnings as configured — do not add a
        suppression).

- [ ] 6. Green: register the routes
  - [ ] 6.1 In `backend/src/Gones.Api/Program.cs`, add `using Gones.Api.Archive;` to the using block if the
        namespace is not already imported.
  - [ ] 6.2 In the same file, inside `if (!string.IsNullOrWhiteSpace(connectionString)) { ... }`, insert
        `app.MapArchiveTournamentReadEndpoints();` on the line immediately after
        `app.MapPublicLeagueEndpoints();` (line 239 today). Leave `app.MapLeagueCommandEndpoints();` and
        every other mapping untouched.

- [ ] 7. Green: run the tests
  - [ ] 7.1 Run
        `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveSeasonTournamentsApiTests|FullyQualifiedName~ArchiveTournamentDetailApiTests"`.
        Every test must pass. Fix the implementation, never the assertion, unless the assertion contradicts
        the **Interface contract** above.
  - [ ] 7.2 Run `npm run backend:test` and confirm the whole backend suite is green — in particular
        `Gones.ArchitectureTests` and `backend/tests/Gones.IntegrationTests/ApiBoundaryTests.cs`, which pin
        route inventory.

- [ ] 8. Regenerate the API contract
  - [ ] 8.1 Ensure a local PostgreSQL is reachable at the generator's default
        `Host=127.0.0.1;Port=5432;Database=gones;Username=gones;Password=gones` — `npm run db:reset` brings
        the local stack up.
  - [ ] 8.2 Run `npm run api:generate`. It rewrites `backend/openapi/gones.json` and
        `src/app/api/generated/gones-api.ts`.
  - [ ] 8.3 Run `npm run api:check` and confirm it exits 0.
  - [ ] 8.4 Confirm the snapshot gained exactly the four new paths and nothing else:

        ```bash
        node -e "const d=require('./backend/openapi/gones.json');console.log(Object.keys(d.paths).filter(p=>p.startsWith('/api/archive')).sort().join('\n'))"
        ```

        Expected output, exactly:

        ```
        /api/archive/league-seasons/{seasonId}/result
        /api/archive/league-seasons/{seasonId}/tournaments
        /api/archive/tournaments/{tournamentId}
        /api/archive/tournaments/{tournamentId}/result
        ```

        (If another archive ticket already landed, its paths appear too — only assert that these four are
        present and that no path outside `/api/archive` changed.)

- [ ] 9. Verify the fence held
  - [ ] 9.1 Run `git status --short` and confirm the changed set is exactly the files listed under
        **Outputs** — no file under `src/app/**` except `src/app/api/generated/gones-api.ts`, nothing under
        `backend/src/Gones.Api/Leagues/**`, no new file under
        `backend/src/Gones.Infrastructure/Persistence/Migrations/`.
  - [ ] 9.2 Run `git diff -- backend/src/Gones.Api/Leagues/ backend/src/Gones.Domain/Leagues/` and confirm
        it is empty.
  - [ ] 9.3 Run `grep -rn "year\|partition\|cache" backend/src/Gones.Api/Archive/ArchiveTournamentReadEndpoints.cs`
        and confirm the only hits are the doc comment and `CatalogCacheControl` — no year query parameter,
        no partition logic leaked in from the neighbouring ticket.

## Outputs

Files touched:

- `backend/src/Gones.Api/Archive/ArchiveResponses.cs` — **new** (skipped if another archive ticket already
  created it with the same records): `ArchiveCatalogResponse<T>`, `ArchiveTournamentSummary`.
- `backend/src/Gones.Api/Archive/ArchiveTournamentReadEndpoints.cs` — **new**: the four routes, their
  handlers, the local helpers, `ArchiveTournamentDetailResponse`.
- `backend/src/Gones.Api/Program.cs` — one added line
  (`app.MapArchiveTournamentReadEndpoints();`) plus a using if needed.
- `backend/tests/Gones.IntegrationTests/ArchiveSeed.cs` — **new**: the shared three-tier fixture.
- `backend/tests/Gones.IntegrationTests/ArchiveSeasonTournamentsApiTests.cs` — **new**: 9 tests.
- `backend/tests/Gones.IntegrationTests/ArchiveTournamentDetailApiTests.cs` — **new**: 9 tests.
- `backend/openapi/gones.json` — regenerated, +4 paths.
- `src/app/api/generated/gones-api.ts` — regenerated, +4 client methods
  (`getArchiveSeasonTournaments`, `getArchiveSeasonResult`, `getArchiveTournament`,
  `getArchiveTournamentResult`) and their DTO interfaces.

Public API / behaviour change:

- Four new anonymous public GET routes under `/api/archive`. Nothing existing changes behaviour: the whole
  `/api/leagues-archive/**` surface is untouched and still serving.
- No frontend consumes these routes yet. They stay dormant until the Tournaments-tab ticket wires the
  Season expansion to them.

Migrate / config:

- **No migration.** No entity, no `DbContext`, no entity configuration is edited.
- One new configuration key, defaulted in code, absent from `appsettings.json`:
  `Gones:Archive:MaximumSeasonTournamentSize` = `5000`.

## Validation

- [ ] tests pass:
  - `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveSeasonTournamentsApiTests|FullyQualifiedName~ArchiveTournamentDetailApiTests"`
    → exit 0, `Passed! - Failed: 0, Passed: 18`.
  - `npm run backend:test` → exit 0, no failed test in any of `Gones.UnitTests`, `Gones.IntegrationTests`,
    `Gones.ArchitectureTests`.
  - `npm run backend:build` → exit 0, `Build succeeded`, 0 warnings from
    `backend/src/Gones.Api/Archive/**`.
  - `npm run api:check` → exit 0 (silent success; a stale contract throws
    `Generated API contract stale: ... Run npm run api:generate.`).
  - `npm run typecheck` → exit 0 (the regenerated client must compile).
  - `npm run lint` → exit 0.
- [ ] manual check — API only, no UI. With the local stack up (`npm run db:reset`, backend running):

  ```bash
  curl -sS -D- -o /dev/null http://127.0.0.1:5080/api/archive/league-seasons/does-not-exist/tournaments
  # expect: HTTP/1.1 404, content-type: application/problem+json

  curl -sS -D- http://127.0.0.1:5080/api/archive/tournaments/does-not-exist
  # expect: HTTP/1.1 404
  ```

  On a seeded Season (substitute a real id):

  ```bash
  ETAG=$(curl -sS -D- -o /dev/null http://127.0.0.1:5080/api/archive/league-seasons/<id>/tournaments | grep -i '^etag:' | cut -d' ' -f2- | tr -d '\r')
  curl -sS -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" http://127.0.0.1:5080/api/archive/league-seasons/<id>/tournaments
  # expect: 304
  ```

  Expect `cache-control: public, max-age=3600` on every one of the four routes.
- [ ] app functional — no broken path from this slice: `/api/leagues-archive/**` still answers exactly as
  before (`npm run backend:test` covers it through `PublicLeagueApiTests`, `PublicLeagueCatalogApiTests`,
  `LeagueArchiveRouteTests`), the frontend still builds against the regenerated client, and the four new
  routes have no caller yet.
- [ ] commit msg draft: `feat(archive): serve a Season's tournaments and one Tournament without the year cache`
