# T5: Whole-catalog read endpoints for Leagues and League Seasons

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T2
**Commit outcome:** `GET /api/archive/leagues/all` and `GET /api/archive/league-seasons/all` serve slim rows with ETag and 304.

## Context (self-contained)

- Goal: the Archive is being rebuilt on three tiers — **League → LeagueSeason → Tournament**. Today's
  flat `League` becomes `LeagueSeason`; a new `League` tier groups Seasons; Tournament becomes a
  first-class top-level record that may stand alone (`seasonId: null`). `leagues-archive` → `archive`
  everywhere.
- This slice: the two **whole-catalog** public read endpoints of the new surface. The frontend list
  page (built later) downloads each catalog once, caches it in IndexedDB for 24h, and does its own
  paging, sorting and filtering in the browser. These two routes are what it downloads.
- Out of scope here — **do not touch**:
  - **No Tournament read endpoints.** `GET /api/archive/tournaments/all?year=` and
    `GET /api/archive/years` belong to another ticket; `GET /api/archive/league-seasons/{id}/tournaments`,
    `GET /api/archive/tournaments/{id}` and the `/result` routes belong to yet another. Do not add
    them, do not stub them.
  - **No command endpoints.** No `POST`/`PATCH`/`DELETE` of any kind.
  - **No frontend.** No file under `src/`, including no `npm run api:generate` output beyond the two
    regenerated contract artifacts named in `Impl steps` step 6.
  - **No schema change.** The three tables and their entity classes already exist when this ticket
    starts; do not add a column, an index, a migration or a check constraint.
  - **Do not delete `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs`** or any other legacy
    file. The old `/api/leagues-archive/**` surface keeps serving beside the new one until the final
    ticket of the plan retires it. Every commit must compile and the app must run.
  - No ADR, no `docs/**` edit, no `ops/acceptance-matrix.json` row.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** No data
    migration, no route alias, no backwards compatibility.
  - **Expand → migrate → contract.** The new `/api/archive/**` surface is *added beside* the existing
    `/api/leagues-archive/**` one. No compatibility shim is written; the old code merely survives
    until unused.
  - Between this ticket and the frontend tickets the archive tables are **empty** (an earlier ticket
    wiped them). Both routes answering `{"items":[],"totalCount":0,"truncated":false}` in a running
    dev app is expected and correct, not a bug to fix.
  - **The response rows never carry a Tournament document.** `rounds` and `playerArchetypes` live in
    the `archive_tournaments.document` jsonb column and are served only by the Tournament detail
    route. A catalog query must never deserialize them — that is the whole point of ADR 0042 and it
    is preserved here.
  - Backend is ASP.NET minimal APIs on .NET 10, EF Core + Npgsql + NodaTime, xUnit integration tests
    against a `postgres:17-alpine` Testcontainer.
  - **Codebase wins over this ticket.** If T2's entity classes carry different property names from
    the ones inlined below, use the names in the T2 source files and keep the wire shape in
    `Interface contract` exactly as specified. The wire shape is frozen; the C# property names are
    not this ticket's to invent.

## Requirements

1. A new file `backend/src/Gones.Api/Archive/PublicArchiveEndpoints.cs` exposes exactly two routes:
   `GET /api/archive/leagues/all` and `GET /api/archive/league-seasons/all`. No other route.
2. Both routes are **anonymous** public GETs. No authorization, no authentication, no rate-limit
   policy of their own.
3. Both answer `200` with `ArchiveCatalogResponse<T>` — `items` / `totalCount` / `truncated`, camelCase
   on the wire — exactly as `Interface contract` freezes it.
4. `totalCount` is the number of **visible** rows in the whole table, not the number of rows returned.
   A row is visible when `deleted_at IS NULL`. A soft-deleted row appears in neither `items` nor
   `totalCount`.
5. Ordering on both routes is `updatedAt DESC, id ASC`, where `id` is the text document id, not a
   surrogate key.
6. Each route is capped by its own configuration key, read through
   `configuration.GetValue(key, default)`:
   `Gones:Archive:MaximumLeagueCatalogSize` default `2000`, and
   `Gones:Archive:MaximumSeasonCatalogSize` default `5000`.
7. A capped response sets `truncated: true`, returns exactly `ceiling` items, keeps `totalCount` at
   the full visible count, and logs one warning. Truncation is detected by fetching `ceiling + 1`
   rows and dropping the extra — never by comparing `totalCount` to `ceiling`.
8. Both routes set `Cache-Control: public, max-age=3600` and a strong `ETag`, on the `200` **and** on
   the `304`. A request whose `If-None-Match` equals the current ETag is answered `304` with an empty
   body and both headers still set.
9. The two routes live in **separate ETag namespaces**: the same archive state must never produce the
   same ETag for both, so a client holding one cannot be answered `304` and go on reading the other.
10. The Season catalog ETag must move when a Season's denormalized counters move, even though those
    counters are written by a Tournament command rather than by a Season command. An ETag that only
    watched `updated_at` of the newest row would serve stale counters for up to an hour behind a `304`.
11. Both queries are SQL projections. Neither joins `archive_tournaments`, neither reads a jsonb
    column, and neither issues a per-row query. The whole-catalog request budget is **4 database
    commands**, independent of row count.
12. Both routes are compressed by the existing app-wide branch, which compresses only GET requests
    carrying no `Authorization` header and no session cookie (ADR 0042's BREACH narrowing). A
    credentialed request to either route is answered uncompressed. This needs **no new code** — the
    branch is already `UseWhen`-mounted outermost in `Program.cs` — but it is asserted by test.
13. `backend/openapi/gones.json` and `src/app/api/generated/gones-api.ts` are regenerated and
    committed, because `npm run api:check` runs in CI (`.github/workflows/static.yml:21`) and fails on
    a stale contract.

## Inputs

**Files to read before writing code**

- `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs` — the idiom to copy:
  - lines **30-36**: the ceiling constant + configuration key pair.
    ```csharp
    public const int MaximumCatalogSize = 1000;
    public const string MaximumCatalogSizeKey = "Gones:Leagues:MaximumCatalogSize";
    ```
  - line **21**: `private const string CatalogCacheControl = "public, max-age=3600";`
  - lines **371-400**: `ListCatalogAsync` — `configuration.GetValue(key, default)`, then
    `PrepareCatalogAsync`, then `.OrderByDescending(...).ThenBy(...).Take(ceiling + 1).Select(...)`,
    then `CapToCeiling`.
  - line **429**: the soft-delete filter.
    ```csharp
    private static IQueryable<LeagueArchiveAggregate> VisibleLeagues(GonesDbContext database) =>
        database.LeagueArchiveAggregates.AsNoTracking().Where(aggregate => aggregate.DeletedAt == null);
    ```
  - lines **438-459**: `PrepareCatalogAsync` — count, stamp, `HashETag`, headers, `IsNotModified`.
  - lines **463-472**: `CapToCeiling` — drops the `ceiling + 1`-th row and logs the warning.
  - lines **628-632**: the two helpers this ticket **copies rather than calls**:
    ```csharp
    internal static bool IsNotModified(HttpRequest request, string etag) =>
        request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

    internal static string HashETag(string value) =>
        $"\"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)))}\"";
    ```
- `backend/src/Gones.Api/Program.cs`:
  - lines **1-29**: the `using` block where `using Gones.Api.Archive;` must be inserted, alphabetically
    before `using Gones.Api.Errors;`.
  - lines **178-183**: the compression branch, already correct for the new routes, no edit needed:
    ```csharp
    app.UseWhen(
        context => HttpMethods.IsGet(context.Request.Method)
            && !context.Request.Headers.ContainsKey(HeaderNames.Authorization)
            && !context.Request.Cookies.ContainsKey(RefreshCookie.Name)
            && !context.Request.Path.StartsWithSegments("/api/auth"),
        branch => branch.UseResponseCompression());
    ```
  - line **239**: `app.MapPublicLeagueEndpoints();` — the new registration goes on the line above it,
    inside the `if (!string.IsNullOrWhiteSpace(connectionString))` block that starts at line 237.
  - lines **48-54**: the JSON options. `PropertyNamingPolicy` is left at the ASP.NET default, so C#
    `PascalCase` record members serialize as `camelCase`. `ConfigureForNodaTime(DateTimeZoneProviders.Tzdb)`
    makes `Instant` an ISO-8601 UTC string (`"2031-05-01T12:00:00Z"`) and `LocalDate` an ISO date
    string (`"2031-05-01"`); a `LocalDate?` that is null serializes as JSON `null`.
- `backend/tests/Gones.IntegrationTests/PublicLeagueCatalogApiTests.cs` — the integration-test idiom to
  copy in full: `IAsyncLifetime`, `PostgreSqlTestContainer`, `List<WebApplicationFactory<Program>>`,
  `CreateClient(params (string Key, string Value)[] settings)` threading `builder.UseSetting`, the
  `JsonElement` assertions, the `If-None-Match` replay, the per-row byte budget.
- `backend/tests/Gones.IntegrationTests/ResponseCompressionTests.cs` — the compression assertions to
  copy: `Read("br")`, `DecodeAsync`, `Assert.Equal("br", response.Content.Headers.ContentEncoding.Single())`,
  and the credentialed-request variant using `RefreshCookie.Name`.
- `backend/tests/Gones.IntegrationTests/PerformanceBudgetTests.cs` lines **139-150, 210-229** — the
  `CommandCountingInterceptor` and the `services.RemoveAll<DbContextOptions<GonesDbContext>>()` +
  `AddDbContext(... .AddInterceptors(commands))` wiring that makes the 4-command budget observable.
- `backend/tests/Gones.IntegrationTests/EventTableRenameTests.cs` lines **198-240** — the raw-SQL seed
  idiom: `database.Database.ExecuteSqlRawAsync("""INSERT INTO ... VALUES ({0}, {1})""", value0, value1)`
  with positional parameters, including NodaTime `Instant` parameters.
- `docs/adr/0042-slim-league-archive-catalog.md` — the rule this ticket carries forward: serve summary
  rows projected in SQL, never documents; compress only anonymous GETs, because compressing a body
  that carries a session secret alongside attacker-influenced input is the BREACH side channel.

**From Depends (T2) — spelled out, because the worker cannot read T2**

T2 has already created three tables and their EF entity classes. It also produced exactly one
migration named `RebuildArchiveThreeTier`. This ticket reads two of the three tables and writes no
migration.

The binding SQL (T2 created this; do not re-create it, do not alter it):

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

`archive_tournaments` is listed only so the worker knows it exists and knows **not to query it**.

The EF entity classes and their `DbSet`s, as this ticket consumes them
(`backend/src/Gones.Domain/Archive/*.cs`, registered on `GonesDbContext`):

```csharp
namespace Gones.Domain.Archive;

public sealed class ArchiveLeague
{
    public required string DocumentId { get; init; }   // PK, maps to document_id
    public string Name { get; }                        // name
    public Instant CreatedAt { get; }                  // created_at
    public Instant UpdatedAt { get; }                  // updated_at
    public int Version { get; }                        // version
    public Instant? DeletedAt { get; }                 // deleted_at
}

public sealed class ArchiveLeagueSeason
{
    public required string DocumentId { get; init; }   // PK, maps to document_id
    public string LeagueId { get; }                    // league_id
    public string Name { get; }                        // name
    public string Status { get; }                      // status: "active" | "completed"
    public Instant UpdatedAt { get; }                  // updated_at
    public int Version { get; }                        // version
    public Instant? DeletedAt { get; }                 // deleted_at
    public int TournamentCount { get; }                // tournament_count
    public int PlayerCount { get; }                    // player_count
    public LocalDate? FirstTournamentDate { get; }     // first_tournament_date
    public LocalDate? LastTournamentDate { get; }      // last_tournament_date
    public int CountsVersion { get; }                  // counts_version
}
```

```csharp
// on Gones.Infrastructure.Persistence.GonesDbContext
public DbSet<ArchiveLeague> ArchiveLeagues => Set<ArchiveLeague>();
public DbSet<ArchiveLeagueSeason> ArchiveLeagueSeasons => Set<ArchiveLeagueSeason>();
public DbSet<ArchiveTournament> ArchiveTournaments => Set<ArchiveTournament>();
```

Setter visibility is T2's business and irrelevant here: this ticket only reads, and its tests seed
through raw SQL against the DDL above rather than through T2's constructors, so it is coupled to the
frozen schema and not to a C# factory signature.

Behaviour T2 left in place that this ticket relies on:

- A delete is a **soft delete**: `deleted_at` is set, the row stays.
- `version` starts at `1` and is incremented by one on every write to that row.
- `updated_at` is set to the write instant on every write to that row.
- The Season counters `tournament_count`, `player_count`, `first_tournament_date`,
  `last_tournament_date` are denormalized and recomputed inside the same transaction as the
  Tournament write that changes them, exactly as ADR 0042 does today for `TournamentCount` /
  `PlayerCount` / `CountsVersion`.

## Interface contract (level 5)

### Produces — HTTP

```
GET /api/archive/leagues/all
  auth:      anonymous
  request:   no route values, no query string, no body
  200:       application/json  ArchiveCatalogResponse<ArchiveLeagueSummary>
             ETag: "<64 lowercase hex chars>"
             Cache-Control: public, max-age=3600
  304:       empty body, when If-None-Match equals the current ETag
             ETag and Cache-Control still set
  no other status code is reachable

GET /api/archive/league-seasons/all
  auth:      anonymous
  request:   no route values, no query string, no body
  200:       application/json  ArchiveCatalogResponse<ArchiveLeagueSeasonSummary>
             ETag: "<64 lowercase hex chars>"
             Cache-Control: public, max-age=3600
  304:       empty body, when If-None-Match equals the current ETag
             ETag and Cache-Control still set
  no other status code is reachable
```

Unknown query-string parameters are ignored, exactly as they are on `/api/leagues-archive/all`: the
handlers bind no query parameter at all.

### Produces — wire shapes (TypeScript, the frozen source of truth)

```ts
export interface ArchiveCatalogResponse<T> {
  items: T[];
  totalCount: number;
  truncated: boolean;
}

export interface ArchiveLeagueSummary {
  id: string;
  name: string;
  createdAt: string;    // ISO 8601 UTC instant, e.g. "2031-05-01T12:00:00Z"
  updatedAt: string;    // ISO 8601 UTC instant
  documentVersion: number;
}

export interface ArchiveLeagueSeasonSummary {
  id: string;
  name: string;
  leagueId: string;
  status: 'active' | 'completed';
  updatedAt: string;    // ISO 8601 UTC instant
  documentVersion: number;
  tournamentCount: number;
  playerCount: number;
  firstTournamentDate: string | null;   // "YYYY-MM-DD"; null when the Season has no Tournament
  lastTournamentDate: string | null;    // "YYYY-MM-DD"; null when the Season has no Tournament
}
```

### Produces — C# DTOs, verbatim

At the bottom of `backend/src/Gones.Api/Archive/PublicArchiveEndpoints.cs`, outside the static class,
in namespace `Gones.Api.Archive`:

```csharp
/// <summary>
/// The envelope every whole-catalog archive read answers: the rows, the size of the whole visible
/// table, and whether the row cap cut the list short.
/// </summary>
internal sealed record ArchiveCatalogResponse<TItem>(
    IReadOnlyList<TItem> Items,
    int TotalCount,
    bool Truncated);

/// <summary>A League catalog row: the top tier has no page of its own, only a column and a filter.</summary>
internal sealed record ArchiveLeagueSummary(
    string Id,
    string Name,
    Instant CreatedAt,
    Instant UpdatedAt,
    int DocumentVersion);

/// <summary>
/// A LeagueSeason catalog row: everything the Season table prints, and nothing else. The four
/// counters are read straight off the denormalized columns, so no Tournament is touched (ADR 0042).
/// </summary>
internal sealed record ArchiveLeagueSeasonSummary(
    string Id,
    string Name,
    string LeagueId,
    string Status,
    Instant UpdatedAt,
    int DocumentVersion,
    int TournamentCount,
    int PlayerCount,
    LocalDate? FirstTournamentDate,
    LocalDate? LastTournamentDate);
```

### Produces — C# API surface, verbatim

```csharp
namespace Gones.Api.Archive;

internal static class PublicArchiveEndpoints
{
    private const string CatalogCacheControl = "public, max-age=3600";
    private const string LogCategory = "Gones.Api.Archive";

    /// <summary>
    /// The League catalog ceiling. A League row is fixed width — five scalar fields, no document —
    /// so the cap exists to bound the body, not to bound the work.
    /// </summary>
    public const int MaximumLeagueCatalogSize = 2000;
    public const string MaximumLeagueCatalogSizeKey = "Gones:Archive:MaximumLeagueCatalogSize";

    /// <summary>The LeagueSeason catalog ceiling: more rows than Leagues, still fixed width.</summary>
    public const int MaximumSeasonCatalogSize = 5000;
    public const string MaximumSeasonCatalogSizeKey = "Gones:Archive:MaximumSeasonCatalogSize";

    public static void MapPublicArchiveEndpoints(this WebApplication app);

    private static Task<IResult> ListLeagueCatalogAsync(
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken);

    private static Task<IResult> ListLeagueSeasonCatalogAsync(
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken);

    private static IQueryable<ArchiveLeague> VisibleLeagues(GonesDbContext database);
    private static IQueryable<ArchiveLeagueSeason> VisibleSeasons(GonesDbContext database);

    /// <summary>
    /// The prologue both catalog routes share: the visible count, the ETag and the caching headers.
    /// </summary>
    private static Task<(int Total, bool NotModified)> PrepareCatalogAsync<TEntity>(
        IQueryable<TEntity> visible,
        Expression<Func<TEntity, Instant?>> updatedAt,
        Expression<Func<TEntity, long>> stampWeight,
        string representation,
        int ceiling,
        HttpRequest request,
        HttpResponse response,
        CancellationToken cancellationToken)
        where TEntity : class;

    private static bool CapToCeiling<T>(List<T> fetched, int ceiling, int total, string catalog, ILoggerFactory loggerFactory);

    private static bool IsNotModified(HttpRequest request, string etag);
    private static string HashETag(string value);
}
```

Route registration, verbatim:

```csharp
    public static void MapPublicArchiveEndpoints(this WebApplication app)
    {
        app.MapGet("/api/archive/leagues/all", ListLeagueCatalogAsync)
            .AllowAnonymous()
            .WithName("GetArchiveLeagueCatalog")
            .Produces<ArchiveCatalogResponse<ArchiveLeagueSummary>>()
            .Produces(StatusCodes.Status304NotModified);
        app.MapGet("/api/archive/league-seasons/all", ListLeagueSeasonCatalogAsync)
            .AllowAnonymous()
            .WithName("GetArchiveLeagueSeasonCatalog")
            .Produces<ArchiveCatalogResponse<ArchiveLeagueSeasonSummary>>()
            .Produces(StatusCodes.Status304NotModified);
    }
```

### Produces — the ETag input strings, verbatim

```
leagues:        "{total}:{maxUpdatedAt}:{stampWeight}:archive-leagues:{ceiling}"
league-seasons: "{total}:{maxUpdatedAt}:{stampWeight}:archive-league-seasons:{ceiling}"
```

hashed by `HashETag`, i.e. `"\"" + lowercase-hex(SHA256(utf8(value))) + "\""`, where:

| token | leagues | league-seasons |
| --- | --- | --- |
| `total` | `COUNT(*)` over visible rows | `COUNT(*)` over visible rows |
| `maxUpdatedAt` | `MAX(updated_at)` over visible rows, `null` when empty | same |
| `stampWeight` | `SUM(version)` | `SUM(version + tournament_count + player_count + counts_version)`, `0` when empty |
| representation literal | `archive-leagues` | `archive-league-seasons` |
| `ceiling` | the effective configured cap | the effective configured cap |

`{maxUpdatedAt}` is `Instant?.ToString()` interpolated, matching how `PrepareCatalogAsync` in
`PublicLeagueEndpoints.cs:455` interpolates its own `Instant`.

### Produces — configuration

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `Gones:Archive:MaximumLeagueCatalogSize` | `int` | `2000` | max rows in `GET /api/archive/leagues/all` |
| `Gones:Archive:MaximumSeasonCatalogSize` | `int` | `5000` | max rows in `GET /api/archive/league-seasons/all` |

Read with `configuration.GetValue(MaximumLeagueCatalogSizeKey, MaximumLeagueCatalogSize)`. Neither key
is added to any `appsettings*.json`; the default is the shipped value, and tests override it through
`WebApplicationFactory.UseSetting`.

### Consumes

From T2, binding, do not redesign: the two tables `archive_leagues` and `archive_league_seasons`, the
two entity classes `Gones.Domain.Archive.ArchiveLeague` and `Gones.Domain.Archive.ArchiveLeagueSeason`,
and the two `DbSet`s `GonesDbContext.ArchiveLeagues` and `GonesDbContext.ArchiveLeagueSeasons` — all
reproduced verbatim under **Inputs → From Depends**.

From `Program.cs`, binding, do not redesign: the compression branch at lines 178-183, which already
covers the two new routes and must not be edited.

### Errors

Neither route can fail with a client error: there is no route value, no query parameter and no body to
validate, and an empty archive is a valid `200` with `items: []`.

| Failure path | Result |
| --- | --- |
| `If-None-Match` matches the current ETag | `304 Not Modified`, empty body, `ETag` + `Cache-Control` still set |
| `If-None-Match` present but stale, or absent | `200` with the full body |
| archive empty | `200` `{"items":[],"totalCount":0,"truncated":false}` — never `404` |
| visible rows exceed the ceiling | `200`, `truncated: true`, exactly `ceiling` items, `totalCount` unchanged, one `LogWarning` |
| database unreachable | the existing `ApiExceptionHandler` answers `500 application/problem+json`; add no handling |

The `LogWarning` message string, verbatim, on category `Gones.Api.Archive`:

```
"Public archive catalog truncated: catalog={Catalog} total={Total} ceiling={Ceiling}"
```

with `{Catalog}` bound to `"leagues"` or `"league-seasons"`.

### Invariants

- **Visibility.** A row is included iff `deleted_at IS NULL`. Applies identically to `items` and to
  `totalCount`.
- **Ordering.** `ORDER BY updated_at DESC, document_id ASC`. Total and deterministic: `document_id` is
  the primary key, so no two rows tie. `document_id` is the same string the wire calls `id`.
- **Truncation.** Fetch `ceiling + 1`; `truncated == fetched.Count > ceiling`; on truncation exactly
  `ceiling` items are returned. `totalCount` is always the whole visible count, never `min(total, ceiling)`.
  A ceiling of `n` with exactly `n` visible rows yields `truncated: false`.
- **Nullability.** `firstTournamentDate` and `lastTournamentDate` are the only nullable wire fields;
  they are both null exactly when the Season has no Tournament. Every other field is non-null.
- **ETag namespacing.** The two routes never produce the same ETag for the same archive state, because
  the representation literal differs. The ceiling is inside the ETag input, so changing the
  configured cap invalidates a cached body whose truncation flag would otherwise be wrong.
- **ETag freshness.** The Season ETag moves whenever any visible Season row is written, including a
  counter recomputation driven by a Tournament write: `version` increments on every row write and is
  summed, `updated_at` moves and is maxed, and the three counters are summed as well. The League ETag
  moves whenever any visible League row is written, for the same reason.
- **No document read.** Neither handler references `GonesDbContext.ArchiveTournaments`, no `Include`,
  no join, no jsonb column. The Season counters come from the denormalized columns only.
- **Query budget.** Each request issues at most 4 database commands: count, max, sum, fetch. A `304`
  issues at most 3 — the fetch does not run. The budget is independent of the number of rows.
- **Idempotency / safety.** Both routes are `GET`: safe, idempotent, no write, no side effect beyond
  the truncation log line.
- **Units.** `updatedAt` / `createdAt` are UTC instants at whatever precision Postgres stored;
  `firstTournamentDate` / `lastTournamentDate` are calendar dates with no time and no zone;
  `documentVersion` is a monotonically increasing per-row integer starting at `1`.

## TDD

1. **Red** — write `backend/tests/Gones.IntegrationTests/PublicArchiveCatalogApiTests.cs` first, with
   all seventeen tests named in `Test plan`, before `PublicArchiveEndpoints.cs` exists. Run
   `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~PublicArchiveCatalogApiTests`.
   The file will not compile until the DTO records exist, so create
   `backend/src/Gones.Api/Archive/PublicArchiveEndpoints.cs` containing **only** the three DTO records
   and an empty `MapPublicArchiveEndpoints` body, register nothing in `Program.cs`, and re-run: every
   test must now fail on `404 NotFound` rather than on a compile error. That 404 is the red state —
   record it before going green.
2. **Green** — implement the two handlers and the three private helpers, register the group in
   `Program.cs`, re-run the same filter until all seventeen pass. Write no code that no failing test
   demands.
3. **Refactor** — only `PrepareCatalogAsync` and `CapToCeiling` are shared; if either route grows a
   second copy of the prologue, fold it back into the generic helper. Keep the filter green.

## Test plan

All in `backend/tests/Gones.IntegrationTests/PublicArchiveCatalogApiTests.cs`, class
`PublicArchiveCatalogApiTests : IAsyncLifetime`.

**Seed, created once in `InitializeAsync` through raw SQL after `await database.Database.MigrateAsync()`**

| Row | Table | Values |
| --- | --- | --- |
| `league-one` | `archive_leagues` | name `League One`, created_at `Seeded`, updated_at `Seeded`, version 1, deleted_at null |
| `league-two` | `archive_leagues` | name `League Two`, created_at `Seeded`, updated_at `Seeded + 1h`, version 1, deleted_at null |
| `league-gone` | `archive_leagues` | name `League Gone`, created_at `Seeded`, updated_at `Seeded + 3h`, version 2, deleted_at `Seeded + 3h` |
| `season-alpha` | `archive_league_seasons` | league_id `league-one`, name `Alpha`, status `completed`, updated_at `Seeded`, version 1, counters `tournament_count 2`, `player_count 3`, `first_tournament_date 2031-05-01`, `last_tournament_date 2031-05-02`, counts_version 1 |
| `season-beta` | `archive_league_seasons` | league_id `league-two`, name `Beta`, status `active`, updated_at `Seeded + 2h`, version 1, counters all `0`, both dates `NULL`, counts_version 1 |
| `season-gone` | `archive_league_seasons` | league_id `league-one`, name `Gone`, status `completed`, updated_at `Seeded + 3h`, version 2, counters `0`, dates `NULL`, counts_version 1, deleted_at `Seeded + 3h` |

`Seeded` = `Instant.FromUtc(2031, 5, 1, 12, 0)`. No row is written to `archive_tournaments`: the Season
counters are denormalized, so the catalog must print them without a single Tournament existing.

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Serves_every_visible_League_as_a_slim_row` | `GET /api/archive/leagues/all` | `200`; `items` ids `["league-two","league-one"]`; `totalCount` `2`; `truncated` false; `items[0]` has exactly the keys `id,name,createdAt,updatedAt,documentVersion`; `items[0].name == "League Two"` |
| `Omits_a_soft_deleted_League_from_the_rows_and_the_count` | same request | no item has id `league-gone`; `totalCount == 2` |
| `Serves_every_visible_Season_with_its_denormalized_counters` | `GET /api/archive/league-seasons/all` | `200`; ids `["season-beta","season-alpha"]`; `totalCount` `2`; the `season-alpha` row has `leagueId == "league-one"`, `status == "completed"`, `tournamentCount == 2`, `playerCount == 3`, `firstTournamentDate == "2031-05-01"`, `lastTournamentDate == "2031-05-02"`, `documentVersion == 1` |
| `Serves_null_tournament_dates_for_a_Season_with_no_Tournament` | same request | the `season-beta` row: `firstTournamentDate` and `lastTournamentDate` are `JsonValueKind.Null`; `tournamentCount == 0`; `playerCount == 0` |
| `Omits_a_soft_deleted_Season_from_the_rows_and_the_count` | same request | no item has id `season-gone`; `totalCount == 2` |
| `Orders_both_catalogs_newest_updated_first` | both requests | league ids `["league-two","league-one"]` and season ids `["season-beta","season-alpha"]`, i.e. strictly descending `updatedAt` |
| `Serves_a_Season_row_without_any_Tournament_document` | `GET /api/archive/league-seasons/all` | no item exposes `tournaments`, `rounds`, `playerArchetypes` or `document`; the raw `items` JSON averages under 400 bytes a row |
| `Keeps_a_League_row_under_250_bytes` | `GET /api/archive/leagues/all` | raw `items` JSON length divided by item count `< 250` |
| `Truncates_the_League_catalog_at_the_configured_ceiling` | `CreateClient(("Gones:Archive:MaximumLeagueCatalogSize", "1"))`, `GET /api/archive/leagues/all` | `items` length `1`; `truncated` true; `totalCount == 2` |
| `Truncates_the_Season_catalog_at_the_configured_ceiling` | `CreateClient(("Gones:Archive:MaximumSeasonCatalogSize", "1"))`, `GET /api/archive/league-seasons/all` | `items` length `1`; `truncated` true; `totalCount == 2` |
| `Reports_no_truncation_when_the_row_count_equals_the_ceiling` | `CreateClient(("Gones:Archive:MaximumSeasonCatalogSize", "2"))` | `items` length `2`; `truncated` **false**; `totalCount == 2` |
| `Answers_304_on_a_matching_ETag` (`[Theory]`, `[InlineData("/api/archive/leagues/all")]`, `[InlineData("/api/archive/league-seasons/all")]`) | first `GET`, then replay with `If-None-Match: <etag>` | replay is `304`; replay `ETag` equals the first; replay `Cache-Control` is `public, max-age=3600` |
| `Sets_the_catalog_cache_control_and_a_strong_ETag` (same `[Theory]` data) | one `GET` | `Cache-Control == "public, max-age=3600"`; `ETag` not null; `ETag.IsWeak` false |
| `Keeps_the_two_catalogs_in_separate_ETag_namespaces` | one `GET` on each route | the two ETags differ |
| `Changes_the_Season_catalog_ETag_when_a_counter_moves` | read ETag; `UPDATE archive_league_seasons SET player_count = 9, version = version + 1 WHERE document_id = 'season-alpha'`; read again | the second ETag differs from the first; a follow-up conditional request with the **old** ETag is `200`, not `304` |
| `Changes_the_League_catalog_ETag_when_a_League_is_renamed` | read ETag; `UPDATE archive_leagues SET name = 'Renamed', updated_at = ..., version = version + 1 WHERE document_id = 'league-one'`; read again | the two ETags differ |
| `Stays_inside_the_four_command_budget` | factory with `CommandCountingInterceptor`; one `GET` on each route | each request issues `<= 4` database commands |
| `Is_anonymous_on_both_routes` (same `[Theory]` data) | `GET` with no `Authorization` header and no cookie | `200` |
| `Compresses_an_anonymous_catalog_read_with_brotli` | `GET /api/archive/league-seasons/all` with `Accept-Encoding: br` | `Content-Encoding == "br"`; the decoded body equals the identity body |
| `Does_not_compress_a_credentialed_catalog_read` | same request plus `Authorization: Bearer not-a-real-access-token`, and a second variant with header `Cookie: {RefreshCookie.Name}=not-a-real-refresh-token` | `200` in both cases; `Content-Encoding` empty in both cases |

Run command for the whole file:

```bash
dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~PublicArchiveCatalogApiTests
```

## Impl steps

- [ ] 1. Write the failing integration test file
  - [ ] 1.1 Create `backend/tests/Gones.IntegrationTests/PublicArchiveCatalogApiTests.cs` with namespace
        `Gones.IntegrationTests` and these usings: `System.IO.Compression`, `System.Net`,
        `System.Net.Http.Headers`, `System.Net.Http.Json`, `System.Text.Json`, `Gones.Api.Archive`,
        `Gones.Infrastructure.Identity`, `Gones.Infrastructure.Persistence`,
        `Microsoft.AspNetCore.Hosting`, `Microsoft.AspNetCore.Mvc.Testing`,
        `Microsoft.EntityFrameworkCore`, `Microsoft.EntityFrameworkCore.Diagnostics`,
        `Microsoft.Extensions.DependencyInjection`, `Microsoft.Extensions.DependencyInjection.Extensions`,
        `System.Data.Common`, `NodaTime`.
  - [ ] 1.2 In the same file declare `public sealed class PublicArchiveCatalogApiTests : IAsyncLifetime`
        with the fields
        ```csharp
        private const string LeaguePath = "/api/archive/leagues/all";
        private const string SeasonPath = "/api/archive/league-seasons/all";
        private static readonly Instant Seeded = Instant.FromUtc(2031, 5, 1, 12, 0);
        private readonly PostgreSqlTestContainer postgres = new();
        private readonly List<WebApplicationFactory<Program>> factories = [];
        ```
  - [ ] 1.3 Copy `CreateClient(params (string Key, string Value)[] settings)`, `CreateContext()` and
        `DisposeAsync()` verbatim from `backend/tests/Gones.IntegrationTests/PublicLeagueCatalogApiTests.cs:180-199`,
        changing only the `GONES_AUTH_SIGNING_KEY` value to `"t-archive-catalog-signing-key-value"`.
  - [ ] 1.4 Write `InitializeAsync`: `await postgres.StartAsync();`, open the context, `await
        database.Database.MigrateAsync();`, then insert the six seed rows of `Test plan` with
        `database.Database.ExecuteSqlRawAsync` using the positional-parameter idiom of
        `backend/tests/Gones.IntegrationTests/EventTableRenameTests.cs:201-213`, for example
        ```csharp
        await database.Database.ExecuteSqlRawAsync("""
            INSERT INTO archive_leagues (document_id, name, created_at, updated_at, version, deleted_at)
            VALUES ({0}, {1}, {2}, {3}, {4}, {5})
            """, "league-one", "League One", Seeded, Seeded, 1, (Instant?)null);
        ```
        and for a Season
        ```csharp
        await database.Database.ExecuteSqlRawAsync("""
            INSERT INTO archive_league_seasons
                (document_id, league_id, name, status, updated_at, version, deleted_at,
                 tournament_count, player_count, first_tournament_date, last_tournament_date, counts_version)
            VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7}, {8}, {9}, {10}, {11})
            """, "season-alpha", "league-one", "Alpha", "completed", Seeded, 1, (Instant?)null,
            2, 3, (LocalDate?)new LocalDate(2031, 5, 1), (LocalDate?)new LocalDate(2031, 5, 2), 1);
        ```
  - [ ] 1.5 Add every test of `Test plan` by its exact name. Use `JsonElement` assertions in the style
        of `PublicLeagueCatalogApiTests.cs:50-73`; for the "exactly these keys" assertion enumerate
        `item.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal)` and
        compare to `["createdAt", "documentVersion", "id", "name", "updatedAt"]`.
  - [ ] 1.6 Add the private nested `CommandCountingInterceptor` copied verbatim from
        `backend/tests/Gones.IntegrationTests/PerformanceBudgetTests.cs:210-229`, plus a
        `CreateCountingClient(CommandCountingInterceptor commands)` that mirrors
        `PerformanceBudgetTests.cs:132-150` — `services.RemoveAll<DbContextOptions<GonesDbContext>>();
        services.RemoveAll<DbContextOptions>(); services.AddDbContext<GonesDbContext>(options =>
        options.ConfigureGones(postgres.GetConnectionString()).AddInterceptors(commands));` — for
        `Stays_inside_the_four_command_budget`.
  - [ ] 1.7 Add the compression helpers copied from
        `backend/tests/Gones.IntegrationTests/ResponseCompressionTests.cs`: a
        `static HttpRequestMessage Read(string path, string? encoding)` that sets
        `Accept-Encoding`, and a `static Task<string> DecodeAsync(HttpResponseMessage response, string encoding)`
        that wraps the content stream in `BrotliStream`/`GZipStream` with `CompressionMode.Decompress`.
  - [ ] 1.8 Run `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~PublicArchiveCatalogApiTests`
        and confirm it fails to compile on the missing `Gones.Api.Archive` namespace. This is red.

- [ ] 2. Create the endpoint file with its DTOs and an unregistered map method
  - [ ] 2.1 Create `backend/src/Gones.Api/Archive/PublicArchiveEndpoints.cs` with
        ```csharp
        using System.Linq.Expressions;
        using System.Security.Cryptography;
        using System.Text;
        using Gones.Domain.Archive;
        using Gones.Infrastructure.Persistence;
        using Microsoft.EntityFrameworkCore;
        using NodaTime;

        namespace Gones.Api.Archive;
        ```
  - [ ] 2.2 In the same file add `internal static class PublicArchiveEndpoints` holding only the four
        constants and the two configuration keys, verbatim from `Interface contract → Produces — C# API
        surface`, plus `private const string CatalogCacheControl = "public, max-age=3600";` and
        `private const string LogCategory = "Gones.Api.Archive";`, and an empty
        `public static void MapPublicArchiveEndpoints(this WebApplication app) { }`.
  - [ ] 2.3 At the bottom of the same file, outside the class, add the three records
        `ArchiveCatalogResponse<TItem>`, `ArchiveLeagueSummary` and `ArchiveLeagueSeasonSummary`
        verbatim from `Interface contract → Produces — C# DTOs`, XML doc comments included.
  - [ ] 2.4 Run the test filter again; confirm the file compiles and the tests now fail on
        `404 NotFound` instead of a compile error. This is the recorded red state.

- [ ] 3. Implement the shared prologue and the truncation helper
  - [ ] 3.1 In `PublicArchiveEndpoints`, add the two visibility filters:
        ```csharp
        private static IQueryable<ArchiveLeague> VisibleLeagues(GonesDbContext database) =>
            database.ArchiveLeagues.AsNoTracking().Where(league => league.DeletedAt == null);

        private static IQueryable<ArchiveLeagueSeason> VisibleSeasons(GonesDbContext database) =>
            database.ArchiveLeagueSeasons.AsNoTracking().Where(season => season.DeletedAt == null);
        ```
  - [ ] 3.2 In the same class add `PrepareCatalogAsync`, verbatim:
        ```csharp
        /// <summary>
        /// The prologue both catalog routes share: the visible count, the ETag and the caching headers.
        ///
        /// <para><paramref name="representation"/> keeps the two bodies in separate ETag namespaces, so
        /// a client holding the League ETag can never be answered 304 and go on reading Seasons. The
        /// ceiling is inside the input because it decides <c>truncated</c>: lowering the cap must
        /// invalidate a cached body whose flag would otherwise be wrong.</para>
        ///
        /// <para><paramref name="stampWeight"/> is the deviation from the League catalog's newest-row
        /// stamp, and it is load-bearing. A Season's counters are written by a <em>Tournament</em>
        /// command, and a Tournament moved between two Seasons that are neither of them the newest row
        /// leaves the newest row untouched — that archive would keep answering 304 with stale counters
        /// for the whole hour the body is cacheable. Summing a strictly increasing per-row version plus
        /// the counters themselves moves on every write to any row.</para>
        /// </summary>
        private static async Task<(int Total, bool NotModified)> PrepareCatalogAsync<TEntity>(
            IQueryable<TEntity> visible,
            Expression<Func<TEntity, Instant?>> updatedAt,
            Expression<Func<TEntity, long>> stampWeight,
            string representation,
            int ceiling,
            HttpRequest request,
            HttpResponse response,
            CancellationToken cancellationToken)
            where TEntity : class
        {
            var total = await visible.CountAsync(cancellationToken);
            var newest = await visible.MaxAsync(updatedAt, cancellationToken);
            var weight = await visible.SumAsync(stampWeight, cancellationToken);
            var etag = HashETag($"{total}:{newest}:{weight}:{representation}:{ceiling}");
            response.Headers.ETag = etag;
            response.Headers.CacheControl = CatalogCacheControl;
            return (total, IsNotModified(request, etag));
        }
        ```
  - [ ] 3.3 In the same class add `CapToCeiling`, verbatim:
        ```csharp
        /// <summary>
        /// Both routes read one row past the ceiling, which is what tells a truncated catalog from an
        /// archive that ends exactly there. Drops the extra row and reports whether there was one.
        /// </summary>
        private static bool CapToCeiling<T>(List<T> fetched, int ceiling, int total, string catalog, ILoggerFactory loggerFactory)
        {
            if (fetched.Count <= ceiling) return false;
            fetched.RemoveRange(ceiling, fetched.Count - ceiling);
            loggerFactory.CreateLogger(LogCategory)
                .LogWarning("Public archive catalog truncated: catalog={Catalog} total={Total} ceiling={Ceiling}", catalog, total, ceiling);
            return true;
        }
        ```
  - [ ] 3.4 In the same class add the two private copies of the caching helpers — copies, not calls
        into `PublicLeagueEndpoints`, because that file is deleted by the last ticket of this plan and
        this one must survive it:
        ```csharp
        private static bool IsNotModified(HttpRequest request, string etag) =>
            request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

        private static string HashETag(string value) =>
            $"\"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)))}\"";
        ```

- [ ] 4. Implement the two handlers
  - [ ] 4.1 In `PublicArchiveEndpoints`, add `ListLeagueCatalogAsync`, verbatim:
        ```csharp
        /// <summary>
        /// Every League in one cacheable body. A League is a name and two timestamps — it has no page of
        /// its own, only a column and a filter on the Season table — so the row is projected straight out
        /// of Postgres and nothing is deserialized to answer this route (ADR 0042).
        /// </summary>
        private static async Task<IResult> ListLeagueCatalogAsync(
            HttpRequest request,
            HttpResponse response,
            GonesDbContext database,
            IConfiguration configuration,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken)
        {
            var ceiling = configuration.GetValue(MaximumLeagueCatalogSizeKey, MaximumLeagueCatalogSize);
            var (total, notModified) = await PrepareCatalogAsync(
                VisibleLeagues(database),
                league => (Instant?)league.UpdatedAt,
                league => (long)league.Version,
                "archive-leagues",
                ceiling,
                request,
                response,
                cancellationToken);
            if (notModified) return Results.StatusCode(StatusCodes.Status304NotModified);

            var fetched = await VisibleLeagues(database)
                .OrderByDescending(league => league.UpdatedAt)
                .ThenBy(league => league.DocumentId)
                .Take(ceiling + 1)
                .Select(league => new ArchiveLeagueSummary(
                    league.DocumentId,
                    league.Name,
                    league.CreatedAt,
                    league.UpdatedAt,
                    league.Version))
                .ToListAsync(cancellationToken);
            var truncated = CapToCeiling(fetched, ceiling, total, "leagues", loggerFactory);

            return Results.Ok(new ArchiveCatalogResponse<ArchiveLeagueSummary>(fetched, total, truncated));
        }
        ```
  - [ ] 4.2 In the same class add `ListLeagueSeasonCatalogAsync`, verbatim:
        ```csharp
        /// <summary>
        /// Every LeagueSeason in one cacheable body. The four counters the Season table prints —
        /// <c>tournamentCount</c>, <c>playerCount</c> and the two boundary dates — are denormalized onto
        /// the row and recomputed inside the transaction of the Tournament write that changes them, so
        /// this route answers them without touching <c>archive_tournaments</c> and without deserializing
        /// a single Tournament document (ADR 0042).
        /// </summary>
        private static async Task<IResult> ListLeagueSeasonCatalogAsync(
            HttpRequest request,
            HttpResponse response,
            GonesDbContext database,
            IConfiguration configuration,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken)
        {
            var ceiling = configuration.GetValue(MaximumSeasonCatalogSizeKey, MaximumSeasonCatalogSize);
            var (total, notModified) = await PrepareCatalogAsync(
                VisibleSeasons(database),
                season => (Instant?)season.UpdatedAt,
                season => (long)season.Version + season.TournamentCount + season.PlayerCount + season.CountsVersion,
                "archive-league-seasons",
                ceiling,
                request,
                response,
                cancellationToken);
            if (notModified) return Results.StatusCode(StatusCodes.Status304NotModified);

            var fetched = await VisibleSeasons(database)
                .OrderByDescending(season => season.UpdatedAt)
                .ThenBy(season => season.DocumentId)
                .Take(ceiling + 1)
                .Select(season => new ArchiveLeagueSeasonSummary(
                    season.DocumentId,
                    season.Name,
                    season.LeagueId,
                    season.Status,
                    season.UpdatedAt,
                    season.Version,
                    season.TournamentCount,
                    season.PlayerCount,
                    season.FirstTournamentDate,
                    season.LastTournamentDate))
                .ToListAsync(cancellationToken);
            var truncated = CapToCeiling(fetched, ceiling, total, "league-seasons", loggerFactory);

            return Results.Ok(new ArchiveCatalogResponse<ArchiveLeagueSeasonSummary>(fetched, total, truncated));
        }
        ```
  - [ ] 4.3 Replace the empty `MapPublicArchiveEndpoints` body with the registration block verbatim
        from `Interface contract → Route registration`.

- [ ] 5. Register the group and go green
  - [ ] 5.1 In `backend/src/Gones.Api/Program.cs`, insert `using Gones.Api.Archive;` as the second line
        of the using block, between `using Gones.Api.Admin;` and `using Gones.Api.Errors;`.
  - [ ] 5.2 In `backend/src/Gones.Api/Program.cs:239`, insert `app.MapPublicArchiveEndpoints();` on the
        line **immediately above** `app.MapPublicLeagueEndpoints();`, inside the existing
        `if (!string.IsNullOrWhiteSpace(connectionString))` block. Leave
        `app.MapPublicLeagueEndpoints();` in place — the legacy surface keeps serving.
  - [ ] 5.3 Run `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~PublicArchiveCatalogApiTests`
        until all tests pass.
  - [ ] 5.4 If `MaxAsync` or `SumAsync` fails to translate, do **not** fall back to client evaluation:
        replace the failing call with an explicit projection first —
        `visible.Select(updatedAt).MaxAsync(cancellationToken)` and
        `visible.Select(stampWeight).SumAsync(cancellationToken)` — and re-run. Client evaluation would
        load the whole table to build an ETag and silently break the 4-command budget test.

- [ ] 6. Regenerate the API contract
  - [ ] 6.1 Start a local Postgres for the generator — `npm run dev -- --no-docker` is not enough; use
        the project's dev stack or an existing local instance reachable at the default
        `Host=127.0.0.1;Port=5432;Database=gones;Username=gones;Password=gones`.
  - [ ] 6.2 Run `npm run api:generate`. It rewrites `backend/openapi/gones.json` and
        `src/app/api/generated/gones-api.ts`.
  - [ ] 6.3 Run `npm run api:check` and confirm exit code `0`.
  - [ ] 6.4 Confirm the diff on those two files touches only the two new operations
        (`GetArchiveLeagueCatalog`, `GetArchiveLeagueSeasonCatalog`) and their three new schemas. If it
        touches anything else, the working tree was already stale — regenerate on a clean tree before
        committing.

- [ ] 7. Full validation
  - [ ] 7.1 `npm run backend:build`
  - [ ] 7.2 `npm run backend:test`
  - [ ] 7.3 `npm run typecheck`
  - [ ] 7.4 `npm run lint`
  - [ ] 7.5 `npm run test`

## Outputs

**Files touched**

| Path | Change |
| --- | --- |
| `backend/src/Gones.Api/Archive/PublicArchiveEndpoints.cs` | **new** — two routes, two handlers, three shared helpers, three DTO records |
| `backend/src/Gones.Api/Program.cs` | +2 lines — `using Gones.Api.Archive;` and `app.MapPublicArchiveEndpoints();` |
| `backend/tests/Gones.IntegrationTests/PublicArchiveCatalogApiTests.cs` | **new** — the whole test plan above |
| `backend/openapi/gones.json` | regenerated by `npm run api:generate` |
| `src/app/api/generated/gones-api.ts` | regenerated by `npm run api:generate` |

Nothing else. No migration, no ADR, no `docs/**`, no `src/app/**` hand-edit, no deletion.

**Public API / behaviour change**

- Two new anonymous public GET routes, additive: `GET /api/archive/leagues/all` and
  `GET /api/archive/league-seasons/all`.
- No existing route changes shape, status code or headers. `/api/leagues-archive/**` is untouched.
- Both new routes join the existing compression branch automatically, so an anonymous browser read is
  brotli-encoded and a credentialed one is not.

**Migrate / config**

- No database migration.
- Two new optional configuration keys, both defaulted in code and absent from every `appsettings*.json`:
  `Gones:Archive:MaximumLeagueCatalogSize` (`2000`) and `Gones:Archive:MaximumSeasonCatalogSize` (`5000`).
- No environment variable, no CLI flag, no feature flag.

## Validation

- [ ] tests pass:
  - `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~PublicArchiveCatalogApiTests` → exit `0`, 0 failed
  - `npm run backend:test` → exit `0`, 0 failed across all three test projects
  - `npm run test` → exit `0`
  - `npm run typecheck` → exit `0`
  - `npm run lint` → exit `0`
  - `npm run backend:build` → exit `0`, `Build succeeded`, 0 warnings introduced
  - `npm run api:check` → exit `0` and no `Generated API contract stale` message
- [ ] manual check — with a running dev stack:
  ```bash
  curl -i http://127.0.0.1:5080/api/archive/leagues/all
  curl -i http://127.0.0.1:5080/api/archive/league-seasons/all
  ```
  Expect on both: `HTTP/1.1 200 OK`, `cache-control: public, max-age=3600`, an `etag:` header of 64
  hex characters in quotes, and a body of `{"items":[],"totalCount":0,"truncated":false}` against the
  empty archive this stage of the plan leaves behind. Then:
  ```bash
  ETAG=$(curl -sI http://127.0.0.1:5080/api/archive/leagues/all | tr -d '\r' | awk '/^etag:/ {print $2}')
  curl -i -H "If-None-Match: $ETAG" http://127.0.0.1:5080/api/archive/leagues/all
  ```
  Expect `HTTP/1.1 304 Not Modified` with the same `etag:` and `cache-control:` and no body. And:
  ```bash
  curl -sI -H 'Accept-Encoding: br' http://127.0.0.1:5080/api/archive/league-seasons/all | grep -i content-encoding
  curl -sI -H 'Accept-Encoding: br' -H 'Authorization: Bearer x' http://127.0.0.1:5080/api/archive/league-seasons/all | grep -i content-encoding
  ```
  Expect `content-encoding: br` on the first and **no output** on the second.
- [ ] app functional — no broken path from this slice: `/api/leagues-archive/all` still answers `200`
  with its own body and its own ETag, the legacy archive pages still render, and the app builds and
  runs. This slice only adds routes.
- [ ] commit msg draft: `feat(archive): serve the League and Season catalogs as slim rows`
