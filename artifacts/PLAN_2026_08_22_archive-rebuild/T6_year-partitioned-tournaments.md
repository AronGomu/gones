# T6: Year-partitioned Tournament catalog and the years index

> ## ⚠ ARBITRATION OVERRIDE — read before the body; these win over anything below
>
> **A. You now depend on T5, and you do NOT declare the shared DTOs.** T5, T6 and T7 each declared
> `ArchiveCatalogResponse<T>`; a duplicate declaration is a compile error. **T5 owns**
> `backend/src/Gones.Api/Archive/ArchiveResponses.cs`, holding `ArchiveCatalogResponse<T>`,
> `ArchiveLeagueSummary`, `ArchiveLeagueSeasonSummary`, `ArchiveTournamentSummary`,
> `ArchiveYearEntry` and `ArchiveYearsResponse`. **Consume them; delete the declarations from this
> ticket's Impl steps.** The body's create-if-absent grep guard is replaced by a plain import.
>
> **B. Your `string TournamentDate` decision WINS and is now binding on T7.** T7 declared the same
> record with `LocalDate TournamentDate`. Your reasoning is the one backed by evidence — a `LocalDate`
> DTO member surfaces as an opaque `LocalDate` interface in the generated client
> (`src/app/api/generated/gones-api.ts:10826`), and the frozen frontend shape says
> `tournamentDate: string`. So: **all `LocalDate`-typed wire fields are ISO strings**, formatted with
> `LocalDatePattern.Iso.Format` — including `ArchiveLeagueSeasonSummary.FirstTournamentDate` and
> `.LastTournamentDate`, which become `string?`. `Instant UpdatedAt` stays `Instant`, matching the
> existing `PublicLeagueCatalogItemResponse` precedent.
>
> **C. `DocumentVersion` is `int`, not `long`.** Archive rows do not derive `VersionedEntity`; the
> column is `version integer`. Change the one occurrence in this ticket.
>
> **D. Endpoint operation names are noun-first** — `ArchiveTournamentYearCatalog`, `ArchiveYears`.
> Two endpoints sharing a `.WithName()` throws at startup and the legacy names live until T19.

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T2, T5
**Commit outcome:** `GET /api/archive/tournaments/all?year=YYYY` and `GET /api/archive/years` serve one year at a time.

## Context (self-contained)

- Goal: rebuild the Archive on three tiers — **League → LeagueSeason → Tournament**. Tournament becomes
  a first-class top-level record that may stand alone (`seasonId: null`); today's flat `League` becomes
  `LeagueSeason`; a new `League` tier groups Seasons. `leagues-archive` → `archive` everywhere.
- This slice: the **public read surface for Tournaments, partitioned by calendar year**. The browser
  cannot hold the whole Tournament table in one body the way it holds the League and Season catalogs —
  the measured mtgtop8 peak is about **17,500 Tournaments in a single year**. So the wire unit is one
  year, and a separate index tells the client which years exist, how many rows each holds, and whether
  the year is old enough that it can never change again. T12 caches those partitions in IndexedDB; this
  ticket only serves them.
- Out of scope here — do **not** touch any of it:
  - `GET /api/archive/leagues/all` and `GET /api/archive/league-seasons/all` (T5 owns them).
  - `GET /api/archive/league-seasons/{seasonId}/tournaments`, `GET /api/archive/tournaments/{tournamentId}`
    and any detail/read-through route (T7 owns them).
  - Every command endpoint, the lock enforcement on writes, `409 archiveTournamentLocked` (T3/T4).
  - Every frontend file. No IndexedDB, no cache, no backfill queue, no component (T12–T14).
  - `player_statistics` and its scoping (T8).
  - Deleting or editing `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs`,
    `LeagueCommandEndpoints.cs`, `LeagueArchiveAggregate.cs` or the `league_aggregates` table. The legacy
    `/api/leagues-archive/**` surface keeps serving; **only T17 deletes it.**
  - No `docs/adr/**` file, no `docs/CONTEXT.md`, no `docs/GLOSSARY.md` (T17 owns docs).
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** No data
    migration, no route alias, no compatibility shim.
  - T2 has already landed: the three archive tables exist, the migration `RebuildArchiveThreeTier` is in
    the tree, and the archive is **empty** (T1 wiped it). An empty archive is the expected state between
    T2 and T13 — the legacy pages rendering an empty list is not a bug to fix here.
  - Between T2 and T17 the new `/api/archive/**` surface lives **beside** the old
    `/api/leagues-archive/**` one. Every commit must compile and the app must run.
  - Backend is ASP.NET minimal APIs on .NET 10, EF Core 10 + PostgreSQL, NodaTime, xUnit
    (`npm run backend:test`). Response compression already covers every anonymous GET by the rule at
    `backend/src/Gones.Api/Program.cs:178-183` (GET, no `Authorization` header, no refresh cookie, not
    under `/api/auth`) — the two new routes are compressed by construction and need no wiring.
  - The global rate limiter already covers `/api` requests; public read routes in this repo declare no
    explicit policy (see `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs:44-97`), so neither new
    route declares one either.
  - **Codebase-vs-brief divergences, recorded and not fixed here:** the plan brief's DDL sketch types
    `archive_tournaments.version` as `integer` and makes `document_id` the primary key, while this
    repo's `VersionedEntity` (`backend/src/Gones.Domain/Persistence/SharedRecords.cs:5-9`) gives every
    aggregate a `Guid Id` primary key and a `long Version` (`version bigint`, see
    `backend/src/Gones.Infrastructure/Persistence/Migrations/20260802204547_AddLeagueAggregates.cs:26`).
    The codebase wins. T2 owns that table; this ticket only reads it, and puts `long` on the wire as
    `documentVersion`, exactly as `PublicLeagueCatalogItemResponse.DocumentVersion` already does.
  - The brief's error table names the 400 code `invalidRequest`. The repo's `ApiValidationException`
    emits `validation_failed` and a bare framework 400 is relabelled `malformed_request` by
    `app.UseStatusCodePages` at `backend/src/Gones.Api/Program.cs:189-195`. The brief is binding, so this
    ticket adds a dedicated exception whose code is literally `invalidRequest` and binds `year` as a
    string so framework binding can never answer first. See `Interface contract`.

## Requirements

- `GET /api/archive/tournaments/all?year=YYYY` returns `ArchiveCatalogResponse<ArchiveTournamentSummary>`
  holding **only** the Tournaments whose `tournamentDate` falls in calendar year `YYYY`.
- `year` is **required**. Missing, blank, non-integer, or outside `1..9999` → `400` with `code`
  `invalidRequest`. **There is no all-years mode**, and none may be added.
- Rows are ordered `tournamentDate DESC, id ASC`, where `id` is the Tournament's document id compared
  with the ordinal (`"C"`) collation.
- Soft-deleted rows (`deleted_at IS NOT NULL`) are invisible to both routes, in the rows and in every
  count.
- The row cap is `Gones:Archive:MaximumTournamentYearSize`, default `25000`. One row past the ceiling is
  read so a full year can be told from a truncated one; the extra row is dropped and `truncated` is
  `true`. `totalCount` always reports the whole year, capped or not.
- `ArchiveTournamentSummary` carries **no** `rounds`, **no** `playerArchetypes`, and **no** `locked`
  field. `playerCount` comes from the denormalized `player_count` column — the JSON document is never
  deserialized on this path.
- Each year has its **own ETag**, derived only from that year's rows, so one year can be revalidated
  without touching any other. A write inside year A must not change year B's ETag.
- `GET /api/archive/years` returns `ArchiveYearsResponse` whose `years` are **ascending by year**, one
  entry per year that holds at least one visible Tournament. A year with no rows is simply absent.
- `ArchiveYearEntry.tournamentCount` is produced by a SQL `GROUP BY`. Loading Tournament rows to count
  them in memory is forbidden and is asserted against.
- `ArchiveYearEntry.locked` is computed **server-side** and **is** on the wire. A year is locked when
  the newest date it can possibly hold — 31 December of that year — is locked by the shared rule.
- The years ETag includes the current UTC day, because `locked` is derived from today: a client holding
  yesterday's ETag must not be answered `304` against yesterday's lock flags.
- Both routes are anonymous, and both answer `Cache-Control: public, max-age=3600` plus an `ETag`, on
  the `200` **and** on the `304`.
- Both routes are registered so that the OpenAPI snapshot and the generated TypeScript client are
  regenerated in the same commit (`npm run api:check` must pass).

## Inputs

Read these before editing. Line numbers are as of this commit.

- `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs`
  - `:30-36` — the ceiling idiom to copy: `public const int MaximumCatalogSize = 1000;` +
    `public const string MaximumCatalogSizeKey = "Gones:Leagues:MaximumCatalogSize";`, read with
    `configuration.GetValue(key, default)`.
  - `:20-21` — `private const string CatalogCacheControl = "public, max-age=3600";`
  - `:25` — `internal const string OrdinalCollation = "C";` (the byte-by-byte Postgres collation).
  - `:370-400` — `ListCatalogAsync`: `Take(ceiling + 1)` → project → `CapToCeiling`.
  - `:436-473` — `PrepareCatalogAsync` (count + newest-row stamp → ETag → cache headers) and
    `CapToCeiling` (drop the extra row, log the truncation, return the flag).
  - `:625-630` — `IsNotModified` and `HashETag`.
  - **Do not call into this class.** T17 deletes the file; the two three-line helpers are copied into
    the new archive file instead, so nothing this ticket writes dies with it.
- `backend/src/Gones.Api/Events/PublicEventEndpoints.cs:379,478` — the repo's date-on-the-wire idiom:
  `private static string FormatDate(LocalDate date) => LocalDatePattern.Iso.Format(date);`. A raw
  NodaTime `LocalDate` in a response record leaks into the generated client as an opaque
  `LocalDate` interface (`src/app/api/generated/gones-api.ts:10826`), which is why `tournamentDate`
  is a `string` on the wire.
- `backend/src/Gones.Api/Errors/ApiExceptions.cs` — `ApiException(code, safeMessage, statusCode)` and
  the existing subclasses. `backend/src/Gones.Api/Errors/ApiExceptionHandler.cs:28-38` shows the
  problem body: `code`, `message`, `traceId` extensions on a `ProblemDetails`.
- `backend/src/Gones.Api/Program.cs:1-29` (using block), `:236-252` (the
  `if (!string.IsNullOrWhiteSpace(connectionString))` map block).
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs:19-51` — the `DbSet` list;
  `:53-66` — `OnModelCreating`, which snake-cases every table/column via `UseSnakeCaseNames()`.
- `backend/tests/Gones.IntegrationTests/PublicLeagueCatalogApiTests.cs` — the integration-test harness
  to copy: `PostgreSqlTestContainer`, `Database.MigrateAsync()`, `WebApplicationFactory<Program>` with
  `UseEnvironment("Testing")` + `GONES_DB_CONNECTION` / `GONES_ALLOWED_ORIGINS` /
  `GONES_AUTH_SIGNING_KEY` / `GONES_PUBLIC_APP_ORIGIN`, and the `CreateClient(params (string, string)[])`
  override pattern used by `Truncates_at_the_configured_ceiling` (`:140-153`).
- `backend/tests/Gones.IntegrationTests/GlobalStatsRatingApiTests.cs:68-84,434-438` — the fake-clock
  harness: `services.RemoveAll<IClock>(); services.AddSingleton<IClock>(clock);` with a
  `private sealed class MutableClock(Instant current) : IClock` exposing `Set`.
- `backend/src/Gones.Api/Gones.Api.csproj:11` — `<InternalsVisibleTo Include="Gones.IntegrationTests" />`,
  which is what lets a test assert on an `internal static` query helper.
- `scripts/generate-api.mjs:8,19-33` — `npm run api:generate` boots the API against
  `GONES_DB_CONNECTION` (default `Host=127.0.0.1;Port=5432;Database=gones;Username=gones;Password=gones`),
  reads `/openapi/v1.json`, and writes `backend/openapi/gones.json` +
  `src/app/api/generated/gones-api.ts`. `npm run api:check` fails if either is stale.

- **From Depends (T2) — already in the tree, consumed verbatim:**
  - Table `archive_tournaments`, snake-cased from the EF entity, with columns
    `document_id, season_id, name, tournament_date (date), status, updated_at, version, deleted_at,
    player_count, counts_version`, plus indexes `ix_archive_tournaments_season_id` and
    `ix_archive_tournaments_tournament_date` (descending on `tournament_date`).
  - The EF entity and its `DbSet`:

    ```csharp
    // namespace Gones.Domain.Archive
    public sealed class ArchiveTournament : VersionedEntity   // VersionedEntity => Guid Id, long Version
    {
        public required string DocumentId { get; init; }
        public string? SeasonId { get; }           // null == standalone Tournament
        public string Name { get; }
        public LocalDate TournamentDate { get; }
        public string Status { get; }              // "active" | "completed"
        public Instant UpdatedAt { get; }
        public Instant? DeletedAt { get; }         // non-null == soft deleted
        public int PlayerCount { get; }            // denormalized; never derived from the JSON here
    }

    // GonesDbContext
    public DbSet<ArchiveTournament> ArchiveTournaments => Set<ArchiveTournament>();
    ```

    This ticket reads **only** the members listed above and never the JSON document column.
  - The shared lock rule:

    ```csharp
    // namespace Gones.Domain.Archive
    public static class ArchiveLockRule
    {
        public const int LockWindowDays = 365;
        public static bool IsLocked(LocalDate tournamentDate, LocalDate today);
    }
    ```

    Semantics, binding: `locked ⇔ (today - tournamentDate) > 365 whole UTC calendar days`. Exactly 365
    days old is **not** locked; 366 days old **is**.
  - If T2 placed these types in a different namespace than `Gones.Domain.Archive`, or named the entity's
    factory differently, **only the `using` line and the single seed helper in each test file change**.
    Every type name, member name, route, status code and assertion in this ticket is fixed.

## Interface contract (level 5)

### Produces — routes

```
GET /api/archive/tournaments/all?year={year}
  anonymous
  200 application/json   ArchiveCatalogResponse<ArchiveTournamentSummary>
  304                    (empty body, ETag + Cache-Control preserved)
  400 application/problem+json  code=invalidRequest
  response headers on 200 and 304:
    ETag: "<64 lowercase hex chars>"          (strong, quoted, SHA-256 of the year's stamp)
    Cache-Control: public, max-age=3600

GET /api/archive/years
  anonymous
  200 application/json   ArchiveYearsResponse
  304                    (empty body, ETag + Cache-Control preserved)
  response headers on 200 and 304:
    ETag: "<64 lowercase hex chars>"
    Cache-Control: public, max-age=3600
```

`GET /api/archive/tournaments/all` is a literal segment and therefore always wins over T7's
`GET /api/archive/tournaments/{tournamentId}`; no ordering work is needed between the two tickets.

### Produces — wire schema

TypeScript (the frontend source of truth this must mirror; C# is PascalCase, the wire is camelCase):

```ts
export interface ArchiveCatalogResponse<T> {
  items: T[];
  totalCount: number;
  truncated: boolean;
}

export interface ArchiveTournamentSummary {
  id: string;
  name: string;
  seasonId: string | null;
  tournamentDate: string;   // ISO 8601 date, `YYYY-MM-DD`
  status: LeagueStatus;     // 'active' | 'completed'
  updatedAt: string;        // ISO 8601 UTC instant
  documentVersion: number;
  playerCount: number;
}

export interface ArchiveYearEntry {
  year: number;
  locked: boolean;
  tournamentCount: number;
}

export interface ArchiveYearsResponse {
  years: ArchiveYearEntry[];   // ascending by year
}
```

C# DTOs, verbatim, in `backend/src/Gones.Api/Archive/`:

```csharp
// ArchiveCatalogResponse.cs  — namespace Gones.Api.Archive
/// <summary>The envelope every archive catalog read answers with.</summary>
internal sealed record ArchiveCatalogResponse<T>(IReadOnlyList<T> Items, int TotalCount, bool Truncated);
```

```csharp
// ArchiveTournamentContracts.cs — namespace Gones.Api.Archive
/// <summary>
/// One Tournament as the table prints it. Deliberately carries no <c>locked</c> flag: a row cached
/// today as unlocked would silently become locked without a refetch, so the client derives the flag
/// from <see cref="TournamentDate"/>. It also carries no rounds and no archetypes — the detail
/// document is a different route, and a detail document is never stored in a year partition.
/// </summary>
internal sealed record ArchiveTournamentSummary(
    string Id,
    string Name,
    string? SeasonId,
    string TournamentDate,
    string Status,
    Instant UpdatedAt,
    long DocumentVersion,
    int PlayerCount);

/// <summary>
/// One year of the archive. <c>Locked</c> is on the wire here, unlike on a Tournament row, because
/// this index is fetched every session and is never cached across a day boundary.
/// </summary>
internal sealed record ArchiveYearEntry(int Year, bool Locked, int TournamentCount);

internal sealed record ArchiveYearsResponse(IReadOnlyList<ArchiveYearEntry> Years);

/// <summary>The GROUP BY projection behind <see cref="ArchiveYearsResponse"/>.</summary>
internal sealed record ArchiveYearCount(int Year, int TournamentCount);
```

### Produces — configuration

| Key | Type | Default | Applies to |
| --- | --- | --- | --- |
| `Gones:Archive:MaximumTournamentYearSize` | `int` | `25000` | `GET /api/archive/tournaments/all?year=` |

`25000` is the measured mtgtop8 peak of about 17,500 Tournaments in a single year plus headroom. Read
with `configuration.GetValue(MaximumTournamentYearSizeKey, MaximumTournamentYearSize)`. No
`appsettings.json` entry is added — the constant **is** the default, exactly as
`Gones:Leagues:MaximumCatalogSize` works today.

### Produces — exception type

```csharp
// appended to backend/src/Gones.Api/Errors/ApiExceptions.cs
/// <summary>
/// A malformed archive query string. Separate from <see cref="ApiValidationException"/> because the
/// archive wire contract names this failure <c>invalidRequest</c> and the browser cache keys its
/// retry decision on that code rather than on a field map.
/// </summary>
public sealed class ArchiveInvalidRequestException(string safeMessage)
    : ApiException("invalidRequest", safeMessage, StatusCodes.Status400BadRequest);
```

### Produces — internal query helper (asserted by a test)

```csharp
// PublicArchiveTournamentEndpoints
internal static IQueryable<ArchiveYearCount> YearCountsQuery(GonesDbContext database);
```

### Consumes

From T2, verbatim and non-negotiable — `Gones.Domain.Archive.ArchiveTournament` (members
`DocumentId`, `SeasonId`, `Name`, `TournamentDate`, `Status`, `UpdatedAt`, `Version`, `DeletedAt`,
`PlayerCount`), `GonesDbContext.ArchiveTournaments`, and
`Gones.Domain.Archive.ArchiveLockRule.IsLocked(LocalDate tournamentDate, LocalDate today)` with
`LockWindowDays = 365`. Redesigning any of them is forbidden.

### Errors

| Path | HTTP | `code` | `message` (== `detail`) |
| --- | --- | --- | --- |
| `year` absent or blank | `400` | `invalidRequest` | `Query parameter 'year' is required.` |
| `year` not a run of digits | `400` | `invalidRequest` | `Query parameter 'year' must be an integer between 1 and 9999.` |
| `year` < 1 or > 9999 (incl. any signed value) | `400` | `invalidRequest` | `Query parameter 'year' must be an integer between 1 and 9999.` |

Body is `application/problem+json`: `type: "urn:gones:problem:invalidRequest"`, `status: 400`,
`title: "Bad Request"`, `detail` and `message` as above, `instance: "/api/archive/tournaments/all"`,
plus `traceId`. That shape is produced by the existing `ApiExceptionHandler` — no handler change.

`GET /api/archive/years` has no failure path: no parameter, and an empty archive answers
`200 {"years":[]}`.

### Invariants

1. **Visibility.** Both routes read `ArchiveTournaments.AsNoTracking().Where(row => row.DeletedAt == null)`
   and nothing else. A soft-deleted row is absent from the rows, from `totalCount`, from
   `tournamentCount`, and from the ETag stamp.
2. **Year selection.** Year `Y` means `TournamentDate >= new LocalDate(Y, 1, 1) && TournamentDate <= new LocalDate(Y, 12, 31)`.
   A half-open comparison on the column, never `date_part(...) = Y`, so
   `ix_archive_tournaments_tournament_date` stays usable.
3. **Ordering, rows.** `ORDER BY tournament_date DESC, document_id COLLATE "C" ASC`. Total, and stable
   across repeated calls, because `document_id` is unique.
4. **Ordering, years.** Strictly ascending by `year`, ordered in Postgres and preserved in memory.
5. **Truncation.** `Take(ceiling + 1)`; `truncated = fetched.Count > ceiling`; when truncated, the extra
   row is dropped and a warning is logged under the `Gones.Api.Archive` category. `TotalCount` is the
   uncapped count of the year in every case.
6. **Per-year ETag isolation.** The year partition ETag hashes only
   `total`, the year's newest `UpdatedAt`, that row's `DocumentId`, that row's `Version`, the literal
   `archive-tournaments-year`, the year, and the ceiling. It contains nothing about any other year, so a
   write in year A leaves year B's ETag byte-identical. The current UTC day is **not** in it — the body
   has no date-derived field, and putting the day in would expire every partition nightly for nothing.
7. **Years ETag.** Hashes the current UTC day *plus* the archive-wide count and newest-row stamp. The day
   is load-bearing: `locked` flips at a day boundary and a stale `304` would hide the flip.
8. **`locked` derivation.** `ArchiveLockRule.IsLocked(new LocalDate(year, 12, 31), today)` and nothing
   else. 31 December is the newest date a Tournament of that year can carry, so if that day is locked
   every row in the year is locked. `today = clock.GetCurrentInstant().InUtc().Date` — injected `IClock`,
   never `SystemClock.Instance` and never `DateTime.UtcNow`.
9. **No JSON deserialization.** Neither route touches the aggregate's JSON document column.
   `playerCount` is the projected `player_count` column.
10. **`GROUP BY`, not row loading.** The years index aggregates in Postgres.
    `YearCountsQuery(database).ToQueryString()` must contain `GROUP BY`.
11. **Nullability.** `SeasonId` is the only nullable field on a row and is `null` exactly for a
    standalone Tournament. `Name`, `Status`, `TournamentDate` are non-null. `years` is never null; it is
    `[]` for an empty archive.
12. **Idempotency.** Both routes are pure reads. Two identical requests with no intervening write return
    byte-identical bodies and identical ETags.
13. **Units.** `tournamentDate` is a calendar date with no time and no zone, formatted
    `LocalDatePattern.Iso` (`YYYY-MM-DD`). `updatedAt` is a UTC instant. `year` is a proleptic ISO
    calendar year.

## TDD

1. **Red** — write both integration test files first and run them. `ArchiveTournamentYearCatalogApiTests`
   and `ArchiveYearsApiTests` compile (they read every response through `JsonElement` and depend on no
   type this ticket adds) and fail: every request answers `404` because neither route is mapped, and
   `Years_index_is_grouped_in_the_database` fails to compile until `YearCountsQuery` exists — write that
   one test last, after the endpoint file is stubbed, or stub the method as
   `throw new NotImplementedException()` first. Named failing tests, listed in `Test plan` below.
2. **Green** — add `ArchiveInvalidRequestException`, the DTO files, the endpoint file, and the
   `Program.cs` registration. Minimum code to turn all of them green.
3. **Refactor** — only the shared prologue between the two handlers if it is genuinely duplicated. Keep
   green. Do not generalize toward T5's or T7's routes; they are not yours.

## Test plan

Both suites run against a real Postgres through `PostgreSqlTestContainer` and
`await database.Database.MigrateAsync()`.

**File 1 — `backend/tests/Gones.IntegrationTests/ArchiveTournamentYearCatalogApiTests.cs`**
Path constant: `/api/archive/tournaments/all`. Seed (all `status: "completed"`):

| document id | seasonId | tournamentDate | updatedAt (UTC) | player_count | state |
| --- | --- | --- | --- | --- | --- |
| `t-2028-a` | `season-one` | `2028-07-04` | 2031-05-01 10:00 | 4 | visible |
| `t-2030-a` | `season-one` | `2030-03-05` | 2031-05-01 11:00 | 8 | visible |
| `t-2030-b` | `season-one` | `2030-03-05` | 2031-05-01 12:00 | 6 | visible |
| `t-2030-c` | `null` | `2030-11-20` | 2031-05-01 13:00 | 12 | visible |
| `t-2031-a` | `season-one` | `2031-01-15` | 2031-05-01 14:00 | 5 | visible |
| `t-2031-standalone` | `null` | `2031-02-02` | 2031-05-01 15:00 | 3 | visible |
| `t-2031-gone` | `season-one` | `2031-05-05` | 2031-05-01 16:00 | 9 | soft deleted |

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Returns_only_the_requested_year` | `?year=2031` | `200`; `items[].id` == `["t-2031-standalone","t-2031-a"]`; `totalCount` == `2`; `truncated` == `false` |
| `Orders_by_date_descending_then_id_ascending` | `?year=2030` | `items[].id` == `["t-2030-c","t-2030-a","t-2030-b"]` — the 2030-03-05 pair proves the ordinal id tiebreak |
| `Returns_an_empty_partition_for_a_year_with_no_rows` | `?year=1999` | `200`; `items` == `[]`; `totalCount` == `0`; `truncated` == `false`; `ETag` present; `Cache-Control` == `public, max-age=3600` |
| `Excludes_a_soft_deleted_Tournament` | `?year=2031` | no item with id `t-2031-gone`; `totalCount` == `2` |
| `Carries_every_summary_field` | `?year=2031` | each item has exactly the keys `id,name,seasonId,tournamentDate,status,updatedAt,documentVersion,playerCount`; `t-2031-a.tournamentDate` == `"2031-01-15"`; `status` == `"completed"`; `documentVersion` >= `1` |
| `Reports_a_standalone_Tournament_with_a_null_season` | `?year=2031` | `t-2031-standalone.seasonId` is JSON `null`; `t-2031-a.seasonId` == `"season-one"` |
| `Reads_the_denormalized_player_count` | `?year=2030` | `t-2030-c.playerCount` == `12`, `t-2030-a.playerCount` == `8` (values written straight into `player_count` by the seed, so a JSON-derived number could not match) |
| `Omits_the_document_and_the_lock_flag_from_every_row` | `?year=2030` | no item exposes `rounds`, `playerArchetypes` or `locked` |
| `Rejects_a_missing_year` | no query string | `400`; `code` == `"invalidRequest"`; `message` == `"Query parameter 'year' is required."`; content type `application/problem+json` |
| `Rejects_a_blank_year` | `?year=` | same as above |
| `Rejects_a_non_integer_year` | `?year=abc` | `400`; `code` == `"invalidRequest"`; `message` == `"Query parameter 'year' must be an integer between 1 and 9999."` |
| `Rejects_a_year_outside_the_supported_range` | `?year=0`, `?year=10000`, `?year=-2031` (xUnit `[Theory]`) | `400` and `code` == `"invalidRequest"` for each |
| `Truncates_at_the_configured_ceiling` | `?year=2030` with `Gones:Archive:MaximumTournamentYearSize=2` | `items.length` == `2`; `truncated` == `true`; `totalCount` == `3` |
| `Answers_304_on_a_matching_ETag` | `?year=2030`, replay with `If-None-Match` | `304`; same `ETag`; `Cache-Control` == `public, max-age=3600` |
| `Gives_each_year_its_own_ETag` | ETags of `?year=2030` and `?year=2031`, then insert a new visible 2031 row, then re-read both | the two ETags differ from each other; after the insert `?year=2030`'s ETag is **unchanged** and `?year=2031`'s ETag **changed** |
| `Sets_the_catalog_cache_control` | `?year=2030` | `Cache-Control` == `public, max-age=3600`; `ETag` non-null |
| `Is_anonymous` | `?year=2030` with no `Authorization` header | `200` |

**File 2 — `backend/tests/Gones.IntegrationTests/ArchiveYearsApiTests.cs`**
Path constant: `/api/archive/years`. Same seed as File 1, plus one visible row `t-2029-a`,
`tournamentDate 2029-09-09`, `updatedAt 2031-05-01 09:00`, `player_count 2`. Clock is a `MutableClock`
starting at `Instant.FromUtc(2031, 12, 31, 12, 0)`.

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Lists_every_year_that_holds_a_Tournament_ascending` | — | `years[].year` == `[2028, 2029, 2030, 2031]` |
| `Omits_a_year_with_no_Tournament` | — | no entry with `year == 2027`; `1999` absent too |
| `Counts_the_Tournaments_of_each_year` | — | `2028 → 1`, `2029 → 1`, `2030 → 3`, `2031 → 2` (the soft-deleted 2031 row is not counted) |
| `Marks_a_year_locked_only_when_its_last_day_is_more_than_365_days_old` | clock `2031-12-31`, then `clock.Set(Instant.FromUtc(2032,1,1,0,0))` | at `2031-12-31`: `2029 → locked true`, `2030 → locked false` (31 Dec 2030 is exactly 365 days old), `2031 → locked false`. After the move to `2032-01-01`: `2030 → locked true` (366 days), `2031 → locked false` |
| `Changes_its_ETag_when_the_day_changes` | ETag at `2031-12-31`, `clock.Set(2032-01-01)`, ETag again | the two ETags differ — a client cannot be answered `304` against yesterday's lock flags |
| `Answers_304_on_a_matching_ETag` | read, replay with `If-None-Match`, same clock | `304`; same `ETag`; `Cache-Control` == `public, max-age=3600` |
| `Years_index_is_grouped_in_the_database` | `PublicArchiveTournamentEndpoints.YearCountsQuery(database).ToQueryString()` | contains `GROUP BY`; contains `count(`; does **not** contain the JSON document column |
| `Sets_the_catalog_cache_control` | — | `Cache-Control` == `public, max-age=3600`; `ETag` non-null |
| `Is_anonymous` | no `Authorization` header | `200` |

**Run commands**

```bash
dotnet test backend/Gones.sln --configuration Release \
  --filter "FullyQualifiedName~ArchiveTournamentYearCatalogApiTests|FullyQualifiedName~ArchiveYearsApiTests"
npm run backend:test
```

## Impl steps

- [ ] 1. Red: the year-partition suite
  - [ ] 1.1 Create `backend/tests/Gones.IntegrationTests/ArchiveTournamentYearCatalogApiTests.cs` with
        this skeleton, then fill in every `[Fact]` from the **File 1** table above:

        ```csharp
        using System.Net;
        using System.Net.Http.Json;
        using System.Text.Json;
        using Gones.Domain.Archive;
        using Gones.Infrastructure.Persistence;
        using Microsoft.AspNetCore.Hosting;
        using Microsoft.AspNetCore.Mvc.Testing;
        using Microsoft.EntityFrameworkCore;
        using NodaTime;
        using NodaTime.Text;

        namespace Gones.IntegrationTests;

        /// <summary>
        /// The Tournament catalog, one calendar year per body. A whole-archive body is not an option:
        /// the measured peak is about 17,500 Tournaments in a single year, so the wire unit is a year
        /// and each year carries its own ETag, which is what lets a client revalidate one year without
        /// invalidating the rest of the archive.
        /// </summary>
        public sealed class ArchiveTournamentYearCatalogApiTests : IAsyncLifetime
        {
            private const string Path = "/api/archive/tournaments/all";
            private static readonly Instant Seeded = Instant.FromUtc(2031, 5, 1, 10, 0);

            private readonly PostgreSqlTestContainer postgres = new();
            private readonly List<WebApplicationFactory<Program>> factories = [];

            public async Task InitializeAsync()
            {
                await postgres.StartAsync();
                await using var database = CreateContext();
                await database.Database.MigrateAsync();
                await SeedAsync(database, "t-2028-a", "season-one", "Twenty Eight", "2028-07-04", Seeded, 4, deleted: false);
                await SeedAsync(database, "t-2030-a", "season-one", "March A", "2030-03-05", Seeded.Plus(Duration.FromHours(1)), 8, deleted: false);
                await SeedAsync(database, "t-2030-b", "season-one", "March B", "2030-03-05", Seeded.Plus(Duration.FromHours(2)), 6, deleted: false);
                await SeedAsync(database, "t-2030-c", null, "November", "2030-11-20", Seeded.Plus(Duration.FromHours(3)), 12, deleted: false);
                await SeedAsync(database, "t-2031-a", "season-one", "January", "2031-01-15", Seeded.Plus(Duration.FromHours(4)), 5, deleted: false);
                await SeedAsync(database, "t-2031-standalone", null, "Standalone", "2031-02-02", Seeded.Plus(Duration.FromHours(5)), 3, deleted: false);
                await SeedAsync(database, "t-2031-gone", "season-one", "Removed", "2031-05-05", Seeded.Plus(Duration.FromHours(6)), 9, deleted: true);
            }

            public async Task DisposeAsync()
            {
                foreach (var factory in factories) await factory.DisposeAsync();
                await postgres.DisposeAsync();
            }

            // ... [Fact] methods from the File 1 table ...

            private HttpClient CreateClient(params (string Key, string Value)[] settings)
            {
                var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
                {
                    builder.UseEnvironment("Testing");
                    builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
                    builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
                    builder.UseSetting("GONES_AUTH_SIGNING_KEY", "t6-archive-year-catalog-signing-key");
                    builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
                    builder.UseSetting("Gones:PlayerStatistics:RebuildOnStartup", "false");
                    foreach (var (key, value) in settings) builder.UseSetting(key, value);
                });
                factories.Add(factory);
                return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            }

            private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
                .ConfigureGones(postgres.GetConnectionString()).Options);

            /// <summary>
            /// One archive Tournament row. T2 owns <c>ArchiveTournament</c> and its factory, so this is
            /// the single place in this file that touches their shape — no assertion below depends on
            /// it. <c>player_count</c> and <c>deleted_at</c> are written in SQL on purpose: the
            /// assertions then prove the endpoint reads the projected columns rather than deriving
            /// anything from the stored JSON document.
            /// </summary>
            internal static async Task SeedAsync(
                GonesDbContext database, string id, string? seasonId, string name, string date,
                Instant updatedAt, int playerCount, bool deleted)
            {
                database.ArchiveTournaments.Add(ArchiveTournament.Create(
                    documentId: id,
                    seasonId: seasonId,
                    name: name,
                    tournamentDate: LocalDatePattern.Iso.Parse(date).Value,
                    status: "completed",
                    now: updatedAt));
                await database.SaveChangesAsync();
                await database.Database.ExecuteSqlInterpolatedAsync(
                    $"UPDATE archive_tournaments SET player_count = {playerCount} WHERE document_id = {id}");
                if (deleted)
                {
                    await database.Database.ExecuteSqlInterpolatedAsync(
                        $"UPDATE archive_tournaments SET deleted_at = {updatedAt} WHERE document_id = {id}");
                }
            }
        }
        ```

  - [ ] 1.2 In the same file, write every `[Fact]` listed in the **File 1** table, reading each body with
        `await response.Content.ReadFromJsonAsync<JsonElement>()` and asserting through
        `body.GetProperty("items")`, `GetProperty("totalCount")`, `GetProperty("truncated")`.
  - [ ] 1.3 For `Carries_every_summary_field`, assert the key set exactly:
        `Assert.Equal(["id","name","seasonId","tournamentDate","status","updatedAt","documentVersion","playerCount"], item.EnumerateObject().Select(p => p.Name).Order().ToArray().Order())` —
        simplest form: compare `item.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal)`
        against the same list ordered the same way.
  - [ ] 1.4 For `Rejects_a_year_outside_the_supported_range`, use
        `[Theory] [InlineData("0")] [InlineData("10000")] [InlineData("-2031")]`.
  - [ ] 1.5 For `Gives_each_year_its_own_ETag`, after capturing both ETags call
        `await using var database = CreateContext();` and
        `await SeedAsync(database, "t-2031-new", null, "Added", "2031-03-03", Seeded.Plus(Duration.FromDays(2)), 7, deleted: false);`
        then re-read both years and assert 2030's ETag is equal and 2031's is not.
  - [ ] 1.6 Run
        `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentYearCatalogApiTests"`
        and confirm the failures are `404`/assertion failures, not compile errors.

- [ ] 2. Red: the years-index suite
  - [ ] 2.1 Create `backend/tests/Gones.IntegrationTests/ArchiveYearsApiTests.cs` reusing
        `ArchiveTournamentYearCatalogApiTests.SeedAsync` for the seed, adding
        `await ArchiveTournamentYearCatalogApiTests.SeedAsync(database, "t-2029-a", "season-one", "Twenty Nine", "2029-09-09", Instant.FromUtc(2031, 5, 1, 9, 0), 2, deleted: false);`
        alongside the seven rows of File 1.
  - [ ] 2.2 In that file add the clock harness, copied from
        `backend/tests/Gones.IntegrationTests/GlobalStatsRatingApiTests.cs:77-81,434-438`:

        ```csharp
        private readonly MutableClock clock = new(Instant.FromUtc(2031, 12, 31, 12, 0));
        // ... inside WithWebHostBuilder:
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<IClock>();
            services.AddSingleton<IClock>(clock);
        });
        // ... at the bottom of the class:
        private sealed class MutableClock(Instant current) : IClock
        {
            public Instant GetCurrentInstant() => current;
            public void Set(Instant value) => current = value;
        }
        ```

        with `using Microsoft.Extensions.DependencyInjection;` and
        `using Microsoft.Extensions.DependencyInjection.Extensions;`.
  - [ ] 2.3 Write every `[Fact]` from the **File 2** table except
        `Years_index_is_grouped_in_the_database`.
  - [ ] 2.4 Run
        `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveYearsApiTests"`
        and confirm every test fails on `404`.

- [ ] 3. Green: the `invalidRequest` error type
  - [ ] 3.1 Append to `backend/src/Gones.Api/Errors/ApiExceptions.cs`, after
        `public sealed class ResourceConflictException(...)`:

        ```csharp
        /// <summary>
        /// A malformed archive query string. Separate from <see cref="ApiValidationException"/> because
        /// the archive wire contract names this failure <c>invalidRequest</c> and the browser cache keys
        /// its retry decision on that code rather than on a field map.
        /// </summary>
        public sealed class ArchiveInvalidRequestException(string safeMessage)
            : ApiException("invalidRequest", safeMessage, StatusCodes.Status400BadRequest);
        ```

        If a sibling ticket already added this exact class, leave it alone and skip this sub-step.

- [ ] 4. Green: the shared archive response envelope
  - [ ] 4.1 Create `backend/src/Gones.Api/Archive/ArchiveCatalogResponse.cs`:

        ```csharp
        namespace Gones.Api.Archive;

        /// <summary>The envelope every archive catalog read answers with.</summary>
        internal sealed record ArchiveCatalogResponse<T>(IReadOnlyList<T> Items, int TotalCount, bool Truncated);
        ```

        If this file already exists with this exact shape (a sibling archive ticket may have created
        it), leave it as it is and skip this sub-step. Never declare a second copy of the type.

- [ ] 5. Green: the Tournament and year DTOs
  - [ ] 5.1 Create `backend/src/Gones.Api/Archive/ArchiveTournamentContracts.cs` containing exactly
        `ArchiveTournamentSummary`, `ArchiveYearEntry`, `ArchiveYearsResponse` and `ArchiveYearCount` as
        written verbatim in `Interface contract → Produces — wire schema`, with
        `using NodaTime;` and `namespace Gones.Api.Archive;`.

- [ ] 6. Green: the endpoint file
  - [ ] 6.1 Create `backend/src/Gones.Api/Archive/PublicArchiveTournamentEndpoints.cs` with this header,
        constants and registration:

        ```csharp
        using System.Globalization;
        using System.Security.Cryptography;
        using System.Text;
        using Gones.Api.Errors;
        using Gones.Domain.Archive;
        using Gones.Infrastructure.Persistence;
        using Microsoft.EntityFrameworkCore;
        using NodaTime;
        using NodaTime.Text;

        namespace Gones.Api.Archive;

        /// <summary>
        /// The public Tournament reads, partitioned by calendar year. A single whole-archive body was
        /// rejected: the measured peak is about 17,500 Tournaments in one year, so a client that wanted
        /// last month would have paid for a decade. One year is the unit of transfer, of caching and of
        /// revalidation, and <c>/api/archive/years</c> is the index that says which years exist.
        /// </summary>
        internal static class PublicArchiveTournamentEndpoints
        {
            private const string CatalogCacheControl = "public, max-age=3600";
            /// <summary>Postgres collation that orders text byte by byte, the way <c>StringComparer.Ordinal</c> does.</summary>
            private const string OrdinalCollation = "C";
            private const int MinimumYear = 1;
            private const int MaximumYear = 9999;

            /// <summary>
            /// The year-partition ceiling. Far above the League catalog's because a row here is a fixed
            /// width summary, and because the measured mtgtop8 peak is about 17,500 Tournaments in a
            /// single year — this is that number plus headroom.
            /// </summary>
            public const int MaximumTournamentYearSize = 25_000;
            public const string MaximumTournamentYearSizeKey = "Gones:Archive:MaximumTournamentYearSize";

            public static void MapPublicArchiveTournamentEndpoints(this WebApplication app)
            {
                app.MapGet("/api/archive/tournaments/all", ListYearCatalogAsync)
                    .AllowAnonymous()
                    .WithName("GetArchiveTournamentYearCatalog")
                    .Produces<ArchiveCatalogResponse<ArchiveTournamentSummary>>()
                    .Produces(StatusCodes.Status304NotModified)
                    .ProducesProblem(StatusCodes.Status400BadRequest);
                app.MapGet("/api/archive/years", ListYearsAsync)
                    .AllowAnonymous()
                    .WithName("GetArchiveYears")
                    .Produces<ArchiveYearsResponse>()
                    .Produces(StatusCodes.Status304NotModified);
            }
        }
        ```

  - [ ] 6.2 Inside that class add the year-partition handler:

        ```csharp
            private static async Task<IResult> ListYearCatalogAsync(
                string? year,
                HttpRequest request,
                HttpResponse response,
                GonesDbContext database,
                IConfiguration configuration,
                ILoggerFactory loggerFactory,
                CancellationToken cancellationToken)
            {
                var requestedYear = ParseYear(year);
                var ceiling = configuration.GetValue(MaximumTournamentYearSizeKey, MaximumTournamentYearSize);
                var partition = VisibleTournamentsOfYear(database, requestedYear);
                var total = await partition.CountAsync(cancellationToken);
                // Every write bumps UpdatedAt to now, so this year's newest row plus this year's count
                // identify this year: an edit moves the stamp, a create, a soft delete or a date that
                // leaves the year moves the count. Nothing about another year is hashed in, which is
                // exactly what lets one year be revalidated while the rest of the archive stays cached.
                var stamp = await partition
                    .OrderByDescending(row => row.UpdatedAt)
                    .ThenBy(row => EF.Functions.Collate(row.DocumentId, OrdinalCollation))
                    .Select(row => new { row.UpdatedAt, row.DocumentId, row.Version })
                    .FirstOrDefaultAsync(cancellationToken);
                var etag = HashETag($"{total}:{stamp?.UpdatedAt}:{stamp?.DocumentId}:{stamp?.Version}:archive-tournaments-year:{requestedYear}:{ceiling}");
                response.Headers.ETag = etag;
                response.Headers.CacheControl = CatalogCacheControl;
                if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

                // One row past the ceiling is what tells a truncated year from a year that ends exactly
                // there.
                var fetched = await partition
                    .OrderByDescending(row => row.TournamentDate)
                    .ThenBy(row => EF.Functions.Collate(row.DocumentId, OrdinalCollation))
                    .Take(ceiling + 1)
                    .Select(row => new
                    {
                        row.DocumentId,
                        row.Name,
                        row.SeasonId,
                        row.TournamentDate,
                        row.Status,
                        row.UpdatedAt,
                        row.Version,
                        row.PlayerCount
                    })
                    .ToListAsync(cancellationToken);
                var truncated = CapToCeiling(fetched, ceiling, total, requestedYear, loggerFactory);
                var items = fetched
                    .Select(row => new ArchiveTournamentSummary(
                        row.DocumentId,
                        row.Name,
                        row.SeasonId,
                        LocalDatePattern.Iso.Format(row.TournamentDate),
                        row.Status,
                        row.UpdatedAt,
                        row.Version,
                        row.PlayerCount))
                    .ToList();

                return Results.Ok(new ArchiveCatalogResponse<ArchiveTournamentSummary>(items, total, truncated));
            }
        ```

  - [ ] 6.3 Inside that class add the years handler and its query:

        ```csharp
            private static async Task<IResult> ListYearsAsync(
                HttpRequest request,
                HttpResponse response,
                GonesDbContext database,
                IClock clock,
                CancellationToken cancellationToken)
            {
                var today = clock.GetCurrentInstant().InUtc().Date;
                var visible = VisibleTournaments(database);
                var total = await visible.CountAsync(cancellationToken);
                var stamp = await visible
                    .OrderByDescending(row => row.UpdatedAt)
                    .ThenBy(row => EF.Functions.Collate(row.DocumentId, OrdinalCollation))
                    .Select(row => new { row.UpdatedAt, row.DocumentId, row.Version })
                    .FirstOrDefaultAsync(cancellationToken);
                // The day is part of what this body says: `locked` is derived from today, so without it
                // a client holding yesterday's ETag would be answered 304 against yesterday's flags and
                // would go on believing a year is still editable.
                var etag = HashETag($"{LocalDatePattern.Iso.Format(today)}:{total}:{stamp?.UpdatedAt}:{stamp?.DocumentId}:{stamp?.Version}:archive-years");
                response.Headers.ETag = etag;
                response.Headers.CacheControl = CatalogCacheControl;
                if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

                var counts = await YearCountsQuery(database).ToListAsync(cancellationToken);
                var years = counts
                    .OrderBy(row => row.Year)
                    .Select(row => new ArchiveYearEntry(
                        // The newest date a Tournament of year Y can carry is 31 December Y, so one call
                        // decides the whole year: if that day is locked, every row in the year is.
                        row.Year,
                        ArchiveLockRule.IsLocked(new LocalDate(row.Year, 12, 31), today),
                        row.TournamentCount))
                    .ToList();

                return Results.Ok(new ArchiveYearsResponse(years));
            }

            /// <summary>
            /// The years index as a GROUP BY. Exposed so a test can assert the aggregation happens in
            /// Postgres: counting in memory would mean loading every Tournament in the archive to answer
            /// a route the client calls on every session.
            /// </summary>
            internal static IQueryable<ArchiveYearCount> YearCountsQuery(GonesDbContext database) =>
                VisibleTournaments(database)
                    .GroupBy(row => row.TournamentDate.Year)
                    .OrderBy(group => group.Key)
                    .Select(group => new ArchiveYearCount(group.Key, group.Count()));
        ```

  - [ ] 6.4 Inside that class add the shared query and header helpers:

        ```csharp
            private static IQueryable<ArchiveTournament> VisibleTournaments(GonesDbContext database) =>
                database.ArchiveTournaments.AsNoTracking().Where(row => row.DeletedAt == null);

            /// <summary>
            /// A closed range on the stored column rather than <c>date_part('year', …) = year</c>, so
            /// <c>ix_archive_tournaments_tournament_date</c> stays usable.
            /// </summary>
            private static IQueryable<ArchiveTournament> VisibleTournamentsOfYear(GonesDbContext database, int year)
            {
                var firstDay = new LocalDate(year, 1, 1);
                var lastDay = new LocalDate(year, 12, 31);
                return VisibleTournaments(database)
                    .Where(row => row.TournamentDate >= firstDay && row.TournamentDate <= lastDay);
            }

            /// <summary>
            /// <paramref name="year"/> arrives as a string and is parsed here on purpose. Bound as an
            /// <c>int?</c>, minimal-API model binding would answer <c>?year=abc</c> with its own bare
            /// 400, which <c>UseStatusCodePages</c> labels <c>malformed_request</c> — and the archive
            /// wire contract names this failure <c>invalidRequest</c>.
            /// </summary>
            private static int ParseYear(string? year)
            {
                if (string.IsNullOrWhiteSpace(year))
                    throw new ArchiveInvalidRequestException("Query parameter 'year' is required.");
                if (!int.TryParse(year.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var parsed)
                    || parsed < MinimumYear
                    || parsed > MaximumYear)
                {
                    throw new ArchiveInvalidRequestException(
                        $"Query parameter 'year' must be an integer between {MinimumYear} and {MaximumYear}.");
                }
                return parsed;
            }

            /// <summary>
            /// Drops the row read past the ceiling and reports whether there was one.
            /// </summary>
            private static bool CapToCeiling<T>(List<T> fetched, int ceiling, int total, int year, ILoggerFactory loggerFactory)
            {
                if (fetched.Count <= ceiling) return false;
                fetched.RemoveRange(ceiling, fetched.Count - ceiling);
                loggerFactory.CreateLogger("Gones.Api.Archive")
                    .LogWarning("Public archive Tournament year partition truncated: year={Year} total={Total} ceiling={Ceiling}", year, total, ceiling);
                return true;
            }

            private static bool IsNotModified(HttpRequest request, string etag) =>
                request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

            private static string HashETag(string value) =>
                $"\"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)))}\"";
        ```

        These two header helpers are copies, not calls into
        `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs:625-630`: T17 deletes that file, and
        nothing this ticket writes may die with it.

- [ ] 7. Green: register the routes
  - [ ] 7.1 In `backend/src/Gones.Api/Program.cs`, add `using Gones.Api.Archive;` immediately after
        `using Gones.Api.Admin;` (line 2), keeping the block alphabetical.
  - [ ] 7.2 In the same file, inside `if (!string.IsNullOrWhiteSpace(connectionString))`, add
        `app.MapPublicArchiveTournamentEndpoints();` on the line **immediately after**
        `app.MapPublicLeagueEndpoints();`. Leave `app.MapPublicLeagueEndpoints();` in place — the legacy
        surface keeps serving until T17.
  - [ ] 7.3 Run `npm run backend:build` and fix any compile error.

- [ ] 8. Green: prove the GROUP BY
  - [ ] 8.1 Add the last test to `backend/tests/Gones.IntegrationTests/ArchiveYearsApiTests.cs`:

        ```csharp
            [Fact]
            public async Task Years_index_is_grouped_in_the_database()
            {
                await using var database = CreateContext();
                var sql = Gones.Api.Archive.PublicArchiveTournamentEndpoints.YearCountsQuery(database).ToQueryString();

                // Counting in memory would mean loading every Tournament in the archive to answer a
                // route the client calls on every session.
                Assert.Contains("GROUP BY", sql, StringComparison.Ordinal);
                Assert.Contains("count(", sql, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("document", sql.Replace("document_id", string.Empty, StringComparison.Ordinal), StringComparison.Ordinal);
            }
        ```

  - [ ] 8.2 Run
        `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentYearCatalogApiTests|FullyQualifiedName~ArchiveYearsApiTests"`
        and get both suites green.

- [ ] 9. Regenerate the API client
  - [ ] 9.1 Start a local Postgres reachable at the script's default DSN
        (`Host=127.0.0.1;Port=5432;Database=gones;Username=gones;Password=gones`) or export
        `GONES_DB_CONNECTION`, then run `npm run api:generate`.
  - [ ] 9.2 Confirm the diff touches only `backend/openapi/gones.json` and
        `src/app/api/generated/gones-api.ts`, and that it adds
        `/api/archive/tournaments/all` and `/api/archive/years` plus the
        `ArchiveCatalogResponseOfArchiveTournamentSummary`, `ArchiveTournamentSummary`,
        `ArchiveYearEntry` and `ArchiveYearsResponse` schemas.
  - [ ] 9.3 Run `npm run api:check` and confirm it exits `0`.

- [ ] 10. Full validation
  - [ ] 10.1 Run `npm run backend:build`.
  - [ ] 10.2 Run `npm run backend:test`.
  - [ ] 10.3 Run `npm run typecheck`.
  - [ ] 10.4 Run `npm run test`.
  - [ ] 10.5 Run `npm run lint`.
  - [ ] 10.6 Run `npm run migration:smoke` — this ticket adds no migration, so it must stay green
        without a new file appearing in
        `backend/src/Gones.Infrastructure/Persistence/Migrations/`.

## Outputs

Files touched:

- `backend/src/Gones.Api/Archive/PublicArchiveTournamentEndpoints.cs` — **new**
- `backend/src/Gones.Api/Archive/ArchiveCatalogResponse.cs` — **new** (skipped if a sibling already
  created it with the identical shape)
- `backend/src/Gones.Api/Archive/ArchiveTournamentContracts.cs` — **new**
- `backend/src/Gones.Api/Errors/ApiExceptions.cs` — one appended class
- `backend/src/Gones.Api/Program.cs` — one `using`, one `Map…()` call
- `backend/tests/Gones.IntegrationTests/ArchiveTournamentYearCatalogApiTests.cs` — **new**
- `backend/tests/Gones.IntegrationTests/ArchiveYearsApiTests.cs` — **new**
- `backend/openapi/gones.json` — regenerated
- `src/app/api/generated/gones-api.ts` — regenerated

Public API / behavior change:

- Adds `GET /api/archive/tournaments/all?year=YYYY` and `GET /api/archive/years`. Both anonymous, both
  `public, max-age=3600` + ETag + 304.
- Adds the problem code `invalidRequest` at `400`.
- Nothing existing changes. `/api/leagues-archive/**` is untouched and keeps serving.

Migrate / config:

- **No migration.** The tables come from T2's `RebuildArchiveThreeTier`.
- One new configuration key, `Gones:Archive:MaximumTournamentYearSize`, default `25000`, defined as a
  constant with no `appsettings.json` entry.

## Validation

- [ ] tests pass:
  - `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveTournamentYearCatalogApiTests|FullyQualifiedName~ArchiveYearsApiTests"` → exit `0`, `Failed: 0`
  - `npm run backend:test` → exit `0`
  - `npm run test` → exit `0`
  - `npm run typecheck` → exit `0`
  - `npm run lint` → exit `0`
  - `npm run backend:build` → exit `0`
  - `npm run api:check` → exit `0`
  - `npm run migration:smoke` → exit `0`
- [ ] manual check (no UI in this slice — curl against a locally seeded API):

  ```bash
  curl -is 'http://127.0.0.1:5000/api/archive/tournaments/all?year=2031' | head -20
  # expect: HTTP/1.1 200, ETag: "<64 hex>", Cache-Control: public, max-age=3600
  #         body {"items":[…],"totalCount":N,"truncated":false}, no "locked", no "rounds"

  curl -is 'http://127.0.0.1:5000/api/archive/tournaments/all' | head -12
  # expect: HTTP/1.1 400, application/problem+json, "code":"invalidRequest",
  #         "message":"Query parameter 'year' is required."

  curl -is 'http://127.0.0.1:5000/api/archive/tournaments/all?year=abc' | head -12
  # expect: HTTP/1.1 400, "code":"invalidRequest",
  #         "message":"Query parameter 'year' must be an integer between 1 and 9999."

  curl -is 'http://127.0.0.1:5000/api/archive/years' | head -12
  # expect: HTTP/1.1 200, {"years":[{"year":…,"locked":…,"tournamentCount":…}, …]} ascending

  ETAG=$(curl -sD - -o /dev/null 'http://127.0.0.1:5000/api/archive/tournaments/all?year=2031' | grep -i '^etag:' | cut -d' ' -f2- | tr -d '\r')
  curl -is -H "If-None-Match: $ETAG" 'http://127.0.0.1:5000/api/archive/tournaments/all?year=2031' | head -5
  # expect: HTTP/1.1 304, same ETag, Cache-Control: public, max-age=3600
  ```

- [ ] app functional — no broken path from this slice: the two routes are additive, no existing route,
      component or table is modified, `/api/leagues-archive/**` still answers, and the app compiles and
      runs.
- [ ] commit msg draft: `feat(archive): serve the Tournament catalog one year at a time`
