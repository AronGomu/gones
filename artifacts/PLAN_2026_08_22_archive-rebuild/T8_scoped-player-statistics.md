# T8: Per-scope Glicko-2 read model and scoped statistics endpoint

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T4
**Commit outcome:** `player_statistics` is keyed by scope; scoped rankings are queryable and every rating shown was actually computed in that scope.

## Context (self-contained)

- Goal: the Archive is being rebuilt on three tiers — **League → LeagueSeason → Tournament** — where a
  Tournament is a first-class top-level record that may stand alone (`seasonId: null`). Global Rankings
  gains a scope filter backed by **stored per-scope Glicko-2 ratings**, so
  `/global-stats?league=<id>&season=<id>` serves numbers read from `player_statistics` and never
  replayed per request.
- This slice: the whole server half of that scope filter. `player_statistics` is re-keyed from
  `(player_name)` to `(scope_kind, scope_id, player_name)`, the rebuild writes one row per
  `(scope, player)` for the global scope plus one scope per League plus one scope per LeagueSeason, and
  two new anonymous read routes serve a chosen scope. Nothing renders it yet.
- Out of scope here — do **not** touch:
  - **No frontend.** No component, no service, no template, no i18n key, no Cypress spec. T15 owns the
    scope filter UI. The one frontend-shaped file you *do* rewrite is the **generated** API client
    `src/app/api/generated/gones-api.ts`, produced by `npm run api:generate`, because `npm run api:check`
    runs in CI (`.github/workflows/static.yml:21`). Regenerating it is mechanical, not authorship.
  - **No change to the Glicko-2 algorithm itself.** `backend/src/Gones.Domain/Leagues/Glicko2.cs`,
    `Glicko2Decay.cs`, `MarginOfVictory.cs` and `LeagueRules.CalculateGlobalPlayerStatistics` keep their
    current maths byte for byte. This ticket changes *what data is fed in*, never *how it is folded*.
  - **Do not delete the legacy endpoints.** `GET /api/leagues-archive/global-player-statistics` and
    `GET /api/leagues-archive/global-player-statistics/all` keep serving. You will add a
    `scope_kind = 'global'` filter to them (below) — that is a correctness pin, not a removal.
  - No `LeagueArchiveAggregate` deletion, no `PublicLeagueEndpoints.cs` deletion, no route removal.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** Local data may
    be reset freely. That is why there is no data backfill: the migration adds the columns with
    database-level defaults purely so `NOT NULL` is legal, and the next rebuild rewrites every row.
  - **Expand → migrate → contract.** The new `/api/archive/**` surface is added *beside* the existing
    `/api/leagues-archive/**` one. The old aggregate, endpoints, components and specs are deleted only at
    T17, when nothing calls them. **No compatibility shim is written.** Every commit compiles and runs.
  - Between T2 and T13 the legacy archive is **empty** (T1 wiped it) and the legacy pages render an empty
    list. That is expected and acceptable, not a bug to fix.
  - `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs` is on T17's deletion list. Therefore the new
    archive endpoint **duplicates** the helpers and response records it needs rather than calling into
    that file. See *Decisions taken inside this ticket*, D1.
  - `dotnet ef` needs `--startup-project backend/src/Gones.Infrastructure` — `Gones.Api` does not
    reference `Microsoft.EntityFrameworkCore.Design`.
  - `backend/tests/Gones.UnitTests` references only `Gones.Domain`, `Gones.Application` and
    `Gones.Infrastructure` (`backend/tests/Gones.UnitTests/Gones.UnitTests.csproj:22-24`). It cannot see
    `Gones.Api` internals. `Gones.Api.csproj:11` has `<InternalsVisibleTo Include="Gones.IntegrationTests" />`,
    so anything touching `Gones.Api` internals is tested from `Gones.IntegrationTests`.
  - **T2's C# names for the three new aggregates are not pinned by the plan; the three table names and
    every column name are.** This ticket therefore reads the new archive through **column names only**
    (raw SQL for persisted rows, EF metadata column lookup for rows still in the change tracker) and
    never names a T2 CLR type. See *Decisions taken inside this ticket*, D2. If the codebase contradicts
    a column name below, the codebase wins — fix the SQL, report it.

## Requirements

1. `player_statistics` is keyed by `(scope_kind, scope_id, player_name)`. `scope_kind` is one of
   `global | league | season`, enforced by a check constraint. `scope_id` is `''` **exactly when**
   `scope_kind = 'global'`.
2. `PlayerStatisticsRow` carries `ScopeKind` and `ScopeId` as the first two required members.
   Every other column of `PlayerStatisticsReadModel.cs` is unchanged.
3. One EF migration, named exactly `ScopePlayerStatistics`, and nothing else.
4. `PlayerStatisticsRebuildService` writes **one row per (scope, player)**: the global scope, one scope
   per League that has at least one contributing Tournament, one scope per LeagueSeason that has at
   least one contributing Tournament. The rebuild stays a **wholesale rewrite inside the caller's write
   transaction** — it still does not call `SaveChangesAsync` and it still stamps
   `player_statistics_meta` itself.
5. **Rating, matches played, wins, losses, draws, winrate, games, tournaments played, last played date,
   Nemesis, Rival and most-played archetype are all recomputed WITHIN each scope.** They are *not*
   global numbers filtered down. A player's `league` row is the Glicko-2 replay over that League's
   Tournaments only, starting from the published seed (1500 / 350 / 0.06), and its
   `tournamentsPlayed` counts only that League's Tournaments — so the same player can be `provisional`
   in one League and ranked in another. This must be asserted by a test.
6. **A standalone Tournament (`season_id IS NULL`) belongs to no League and no Season, so it feeds the
   `global` scope ONLY.** It never creates, and never contributes to, a `league` or `season` scope row.
   This must be asserted by a test.
7. `PlayerStatisticsFormula.Version` goes from `2` to `3` in this same commit, so
   `PlayerStatisticsStartupRebuild` repairs every stored row on the next start.
8. `GET /api/archive/global-player-statistics?scopeKind=&scopeId=&page=&pageSize=&sort=&direction=&search=`
   serves the paged scoped rankings. **Response field names are unchanged from the legacy endpoint —
   only scope selection is new.**
9. `GET /api/archive/global-player-statistics/all?scopeKind=&scopeId=` serves the whole scope in one
   cacheable body, capped by `Gones:GlobalStats:MaximumCatalogSize` (default `5000`).
10. **A `scopeId` with no rows returns `200` with an empty page — never `404`.** Both routes. This must
    be asserted by a test.
11. Both routes are anonymous public GETs with `Cache-Control: public, max-age=3600`, a strong-ish
    hashed `ETag`, and `304` on a matching `If-None-Match`.
12. The two surviving readers of `player_statistics` that have no scope concept are pinned to the global
    scope so they cannot read three copies of a player: the legacy
    `/api/leagues-archive/global-player-statistics[/all]` queries, and
    `backend/src/Gones.Api/Leagues/PlayerEndpoints.cs` `FindAsync` — whose
    `SingleOrDefaultAsync(row => row.PlayerName == playerName)` would otherwise throw and return `500`
    the moment two scopes hold the same player.
13. `npm run backend:build` and `npm run backend:test` are green; `npm run typecheck` is green;
    `npm run api:check` is green.

## Inputs

Read these before writing code. Paths and line refs are current as of this ticket.

- `docs/adr/0040-player-statistics-read-model.md` — owns the **wholesale-rewrite-inside-the-write-transaction**
  rule: *"The table is rebuilt synchronously inside the same transaction as every archive commit, import,
  restore and delete. A failed write rolls the statistics back with it, so the table can never disagree
  with the archive it summarises."* Also: *"Bump `PlayerStatisticsFormula.Version` in the same commit as
  any change to the statistics maths."*
- `docs/adr/0043-glicko2-player-rating.md` — owns the rating columns and their meaning: published
  defaults rating 1500 / deviation 350 / volatility 0.06 / τ 0.5; rating period = one calendar date;
  byes ignored; `0-0` excluded from the rating but counted in the statistics; provisional = fewer than 5
  Tournaments; inactive = no completed Tournament in 12 months; both flags **derived at read time**,
  never stored; `decayedRating` always computed, exposed only by
  `Gones:PlayerStatistics:ExposeDecayedRating` (default `false`).
- `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModel.cs` — `PlayerStatisticsRow`
  (13 statistics members + 8 ADR 0043 rating members), `PlayerStatisticsRow.From`,
  `ToGlobalPlayerStatistics()`, `PlayerStatisticsMeta` with `SingletonId = 1`.
- `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModelConfigurations.cs:9-42` —
  `builder.ToTable("player_statistics")`, `builder.HasKey(row => row.PlayerName)`, eleven indexes
  including `ix_player_statistics_player_name_pattern` with `text_pattern_ops`.
- `backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs` — the whole current rebuild:
  `LockAsync` (`pg_advisory_xact_lock(hashtext('gones:player-statistics'), hashtext('rebuild'))`),
  the tracked read of `LeagueArchiveAggregates` merged with `ChangeTracker` Added/Deleted entries,
  `DELETE FROM player_statistics`, `AddRange`, `StampAsync` upsert into `player_statistics_meta`.
- `backend/src/Gones.Api/Leagues/PlayerStatisticsStartupRebuild.cs` — `EnabledKey =
  "Gones:PlayerStatistics:RebuildOnStartup"`, default `true`; runs when the stored `FormulaVersion` is
  not `PlayerStatisticsFormula.Version`.
- `backend/src/Gones.Domain/Leagues/PlayerStatisticsFormula.cs` — `public const int Version = 2;`
- `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs` — the endpoint you are mirroring:
  - `:30-36` the ceiling idiom (`MaximumCatalogSize` + `MaximumCatalogSizeKey`).
  - `:38-46` `GlobalStatsAllowedPageSizes = [10, 25, 50, 100]`, `GlobalStatsDefaultPageSize = 100`,
    `GlobalStatsMaximumCatalogSize = 5000`, `GlobalStatsMaximumCatalogSizeKey = "Gones:GlobalStats:MaximumCatalogSize"`,
    `GlobalStatsSortAllowlist`.
  - `:46-55` + `:161` the two route registrations you are twinning.
  - `:104-152` `GetGlobalPlayerStatisticsAsync` — validation, ETag, ordering, paging.
  - `:155-192` `GetGlobalPlayerStatisticsCatalogAsync`.
  - `:194-286` `FilterGlobalStats`, `OrderGlobalStats`, `GlobalSortByCount`, `GlobalSortByRating`,
    `GlobalSortByWinrate`.
  - `:288-330` `ToGlobalStatsRow`, `RoundRating`, `ReadModelStampAsync`.
  - `:474-520` `EscapeLikePattern`, `SetPublicCache`, `IsNotModified`, `HashETag`, `Validation`.
  - `:540-585` the response records `GlobalPlayerStatisticsResponse`,
    `GlobalPlayerStatisticsCatalogResponse`, `GlobalPlayerStatisticsRow`.
- `backend/src/Gones.Api/Leagues/PlayerRankingRules.cs` — `ProvisionalTournamentThreshold = 5`,
  `InactiveMonths = 12`, `ActiveRankedBucket = 0`, `InactiveRankedBucket = 1`, `ProvisionalBucket = 2`,
  `IsProvisional`, `IsInactive`, `InactiveCutoff`, `Iso`. **Not on T17's deletion list — reuse it.**
- `backend/src/Gones.Api/Leagues/PlayerStatisticsDecayedRatingExposure.cs` — `Enabled(IConfiguration)`.
  **Not on T17's deletion list — reuse it.**
- `backend/src/Gones.Api/Leagues/PlayerEndpoints.cs:95-106` — `FindAsync`, the `SingleOrDefaultAsync`
  that breaks under multiple scopes.
- `backend/src/Gones.Domain/Leagues/LeagueDocuments.cs:6-25` — `GonesData(int Version,
  IReadOnlyList<LeagueDocument> Leagues, IReadOnlyList<JsonElement> CalendarEvents)`,
  `LeagueDocument(string Id, string Name, string Status, IReadOnlyList<TournamentDocument> Tournaments)`,
  `TournamentDocument(string Id, string LeagueId, string Name, string TournamentDate, string Status,
  IReadOnlyList<RoundDocument> Rounds, IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes)`.
  `:142-163` `GlobalPlayerStatistics` — 21 positional members.
- `backend/src/Gones.Domain/Leagues/LeagueRules.cs:135-176` — `CalculateGlobalPlayerStatistics(GonesData
  data, DateOnly? asOf = null)`. It filters `tournament.Status != "completed"` itself and returns rows
  ordered by `PlayerName` ordinal, only for players with `PlayedMatchCount > 0`.
  `:235-260` `ReplayRatings` — skips tournaments whose `TournamentDate.Length == 0`.
- `backend/src/Gones.Domain/Leagues/LeagueJson.cs` — `LeagueJson.Deserialize<T>(JsonElement)`,
  camelCase naming policy, `JsonSerializerDefaults.Web`.
- `backend/src/Gones.Domain/Leagues/LeagueNormalizer.cs:10` — `GonesDataVersion = 4`.
- `backend/src/Gones.Api/Errors/ApiExceptions.cs:10-14` — `ApiValidationException(IReadOnlyDictionary<string,
  string[]> errors)` → code `validation_failed`, HTTP `400`.
- `backend/src/Gones.Api/Program.cs:122` `AddSingleton<PlayerStatisticsRebuildService>()`,
  `:129` the hosted-service insert, `:236-252` the `if (!string.IsNullOrWhiteSpace(connectionString))`
  block where public routes are mapped.
- `backend/tests/Gones.IntegrationTests/PostgreSqlTestContainer.cs` — the `postgres:17-alpine`
  Testcontainers helper every integration class uses.
- `backend/tests/Gones.IntegrationTests/GlobalStatsRatingApiTests.cs:49-83` — the exact
  `WebApplicationFactory<Program>` + `MutableClock` + `Gones:PlayerStatistics:RebuildOnStartup=false`
  fixture idiom you will copy. `MutableClock` is a `private sealed class MutableClock(Instant current) :
  IClock` declared per test class (see `:240` of `BrevoWebhookAndAdminTests.cs` for the shape).
- `backend/tests/Gones.IntegrationTests/PlayerStatisticsRebuildTests.cs:333-340` — the
  `RebuildAsync()` helper: open a transaction, `new PlayerStatisticsRebuildService(NullLogger<…>.Instance)
  .RebuildAsync(database, ct)`, `SaveChangesAsync`, `CommitAsync`.
- `backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs` — no `Up` may both `DropTable` and
  `CreateTable`; `Committed_migrations_fully_describe_the_model` fails on a drifted model snapshot.
- `scripts/smoke-full-stack.mjs:57` — `const expectedMigrations = [...]`, a hardcoded list that throws
  `PostgreSQL migrations differ.` if the database does not match it exactly.

- **From Depends (T4 — "Tournament command endpoints with derived locking"):** T4 leaves the three-tier
  archive writable over HTTP. What this ticket consumes from it is **the database shape, not its C#
  API**. The three tables and every column name below are frozen by the plan's contract section and are
  what you read:

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
  ```

  Behaviour T4 leaves in place that this ticket depends on:
  - `archive_tournaments.document` is `jsonb` holding the Tournament's `rounds` and `playerArchetypes`
    at the **root** of the JSON object, serialized by `LeagueJson` (camelCase). Both readings of the
    contract — the whole tournament document, or a `{rounds, playerArchetypes}` envelope — put those two
    properties at the root, which is why this ticket reads them by name and ignores everything else.
  - `archive_tournaments.status` is `'active' | 'completed'`, the same vocabulary
    `LeagueRules.CalculateGlobalPlayerStatistics` filters on.
  - A soft-deleted row has `deleted_at IS NOT NULL` and must be excluded.
  - `season_id IS NULL` means **standalone**. Deleting a Season detaches its Tournaments
    (`season_id = null`); it never cascades a delete of tournament data.
  - Every archive command runs `PlayerStatisticsRebuildService.RebuildAsync(database, ct)` inside its
    write transaction, and — following the established idiom at
    `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:242,423,443,517` — may call it **before**
    `SaveChangesAsync`. That is why the reader in this ticket overlays the EF change tracker on top of
    the persisted rows instead of trusting SQL alone.

## Interface contract (level 5)

### Produces — SQL

Migration name, binding: **`ScopePlayerStatistics`**. Exactly one migration, no more.

```sql
ALTER TABLE player_statistics ADD COLUMN scope_kind text NOT NULL DEFAULT 'global';
ALTER TABLE player_statistics ADD COLUMN scope_id   text NOT NULL DEFAULT '';
ALTER TABLE player_statistics DROP CONSTRAINT pk_player_statistics;
ALTER TABLE player_statistics ADD CONSTRAINT pk_player_statistics
  PRIMARY KEY (scope_kind, scope_id, player_name);
ALTER TABLE player_statistics ADD CONSTRAINT ck_player_statistics_scope_kind
  CHECK (scope_kind IN ('global','league','season'));
```

No other column, index or table changes. `ix_player_statistics_player_name_pattern` and the eleven
sort indexes stay exactly as they are.

### Produces — C#

```csharp
// backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModel.cs
public sealed class PlayerStatisticsRow
{
    public required string ScopeKind { get; init; }   // "global" | "league" | "season"
    public required string ScopeId { get; init; }     // "" when global
    public required string PlayerName { get; init; }
    // …every existing member unchanged…

    public static PlayerStatisticsRow From(GlobalPlayerStatistics statistics, string scopeKind, string scopeId);
    public GlobalPlayerStatistics ToGlobalPlayerStatistics();   // unchanged
}

/// <summary>The three scopes `player_statistics` is keyed by, and the one id the global scope uses.</summary>
public static class PlayerStatisticsScope
{
    public const string Global = "global";
    public const string League = "league";
    public const string Season = "season";

    /// <summary>`scope_id` is the empty string exactly when `scope_kind` is <see cref="Global"/>.</summary>
    public const string GlobalScopeId = "";

    public static bool IsKnownKind(string? kind) => kind is Global or League or Season;
}
```

```csharp
// backend/src/Gones.Domain/Leagues/PlayerStatisticsFormula.cs
public const int Version = 3;   // was 2
```

```csharp
// backend/src/Gones.Api/Leagues/ArchiveScopeSource.cs   (new file)
namespace Gones.Api.Leagues;

/// <summary>One (scopeKind, scopeId) partition of the archive, shaped for the statistics maths.</summary>
internal sealed record ArchiveStatisticsScope(string ScopeKind, string ScopeId, GonesData Data);

internal static class ArchiveScopeSource
{
    /// <summary>
    /// Every scope the rebuild must write, in a deterministic order: global first, then every League
    /// scope by ordinal id, then every LeagueSeason scope by ordinal id.
    /// </summary>
    public static Task<IReadOnlyList<ArchiveStatisticsScope>> LoadAsync(
        GonesDbContext database,
        IReadOnlyList<LeagueDocument> legacyLeagues,
        CancellationToken cancellationToken);
}
```

```csharp
// backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs   (signature unchanged)
public Task RebuildAsync(GonesDbContext database, CancellationToken cancellationToken);
```

### Produces — HTTP

```
GET /api/archive/global-player-statistics
      ?scopeKind=global|league|season   (optional, default "global")
      &scopeId=<string, 1..200 chars>   (required when scopeKind is league|season; ignored when global)
      &page=<int >= 1>                  (optional, default 1)
      &pageSize=10|25|50|100            (optional, default 100)
      &sort=<see allowlist>             (optional, default = the three-bucket ranking order)
      &direction=asc|desc               (optional, default desc)
      &search=<substring, <= 200 chars> (optional)
  200 application/json  ArchiveGlobalPlayerStatisticsResponse
  304                   (If-None-Match matches)
  400 application/problem+json  code "validation_failed"
```

```
GET /api/archive/global-player-statistics/all
      ?scopeKind=global|league|season   (optional, default "global")
      &scopeId=<string, 1..200 chars>   (required when scopeKind is league|season; ignored when global)
  200 application/json  ArchiveGlobalPlayerStatisticsCatalogResponse
  304                   (If-None-Match matches)
  400 application/problem+json  code "validation_failed"
```

Response headers on both, on `200` and on `304`: `ETag: "<64 lowercase hex chars>"` and
`Cache-Control: public, max-age=3600`.

Wire shape — **field names identical to the legacy endpoint**, C# type names deliberately distinct so
the two coexist in one OpenAPI document (see D1):

```csharp
// backend/src/Gones.Api/Archive/ArchivePlayerStatisticsEndpoints.cs   (new file)
namespace Gones.Api.Archive;

internal sealed record ArchiveGlobalPlayerStatisticsResponse(
    IReadOnlyList<ArchiveGlobalPlayerStatisticsRow> Items,
    int Page,
    int PageSize,
    int TotalCount,
    string? Sort,
    string? Direction);

internal sealed record ArchiveGlobalPlayerStatisticsCatalogResponse(
    IReadOnlyList<ArchiveGlobalPlayerStatisticsRow> Items,
    int TotalCount,
    bool Truncated);

internal sealed record ArchiveGlobalPlayerStatisticsRow(
    int Position,
    string PlayerName,
    int PlayedMatchCount,
    int MatchWins,
    int MatchLosses,
    int MatchDraws,
    double? MatchWinrate,
    int PlayedGameCount,
    int GameWins,
    int GameLosses,
    double? GameWinrate,
    OpponentRecord? Nemesis,
    OpponentRecord? Rival,
    PlayerArchetypeUsage? MostPlayedArchetype,
    int Rating,
    double RatingDeviation,
    int PreviousRating,
    int LastRatingDelta,
    int TournamentsPlayed,
    string? LastPlayedDate,
    bool Provisional,
    bool Inactive,
    int? DecayedRating);
```

JSON is camelCase: `items`, `page`, `pageSize`, `totalCount`, `sort`, `direction`, `truncated`; row
fields `position`, `playerName`, `playedMatchCount`, `matchWins`, `matchLosses`, `matchDraws`,
`matchWinrate`, `playedGameCount`, `gameWins`, `gameLosses`, `gameWinrate`, `nemesis`, `rival`,
`mostPlayedArchetype`, `rating`, `ratingDeviation`, `previousRating`, `lastRatingDelta`,
`tournamentsPlayed`, `lastPlayedDate`, `provisional`, `inactive`, `decayedRating`.

### Produces — sort allowlist

| `sort` value | Orders by | Notes |
| --- | --- | --- |
| *(absent)* | three-bucket ranking order | active ranked by rating desc → inactive ranked by rating desc → provisional by tournaments desc then matches desc; every tie on `player_name` ordinal asc |
| `rating` | `floor(rating + 0.5)` | provisional bucket pinned last in both directions |
| `name` | `player_name` collated `"C"` | **new in this ticket** |
| `matches` | `played_match_count` | alias |
| `wins` | `match_wins` | alias |
| `losses` | `match_losses` | alias |
| `winrate` | `match_winrate` | alias, nulls last in both directions |
| `tournaments` | `tournaments_played` | alias |
| `playedMatchCount` `matchWins` `matchLosses` `matchDraws` `matchWinrate` `playedGameCount` `gameWins` `gameLosses` `gameWinrate` `tournamentsPlayed` | the same column | carried over from the legacy endpoint, unchanged |
| `decayedRating` | `floor(decayed_rating + 0.5)` | accepted **only** when `Gones:PlayerStatistics:ExposeDecayedRating` is on; otherwise `400` |

Anything else → `400`.

### Consumes

- The three-table DDL and the write-transaction behaviour of T4, quoted verbatim under **Inputs → From
  Depends** above. Do not redesign it.
- `LeagueRules.CalculateGlobalPlayerStatistics(GonesData data, DateOnly? asOf = null)` — called once per
  scope, with a `GonesData` that contains **only that scope's Tournaments**. Its maths is untouched;
  scoping is achieved entirely by what is fed in.
- `PlayerRankingRules.{ProvisionalTournamentThreshold, InactiveMonths, ActiveRankedBucket,
  InactiveRankedBucket, ProvisionalBucket, IsProvisional, IsInactive, InactiveCutoff, Iso}`.
- `PlayerStatisticsDecayedRatingExposure.Enabled(IConfiguration)`.
- `Gones:GlobalStats:MaximumCatalogSize`, default `5000` — the **same configuration key** the legacy
  catalog uses, re-declared as a constant in the new file (D1).

### Errors

| HTTP | `code` | `errors` key | Message | Raised when |
| --- | --- | --- | --- | --- |
| `400` | `validation_failed` | `scopeKind` | `Scope kind must be global, league, or season.` | `scopeKind` present and not one of the three |
| `400` | `validation_failed` | `scopeId` | `Scope id is required for a league or season scope.` | `scopeKind` is `league` or `season` and `scopeId` is null, empty or whitespace |
| `400` | `validation_failed` | `scopeId` | `Scope id must contain 1 to 200 characters.` | `scopeId` longer than 200 characters |
| `400` | `validation_failed` | `page` | `Page must be at least 1.` | `page < 1` |
| `400` | `validation_failed` | `pageSize` | `Page size must be 10, 25, 50, or 100.` | `pageSize` not in `[10, 25, 50, 100]` |
| `400` | `validation_failed` | `search` | `Search must be at most 200 characters.` | `search.Length > 200` |
| `400` | `validation_failed` | `sort` | `Sort column is not valid.` | `sort` outside the allowlist |
| `400` | `validation_failed` | `direction` | `Direction must be asc or desc.` | `direction` present and not `asc`/`desc` |

All eight are thrown as `new ApiValidationException(new Dictionary<string, string[]> { [field] = [message] })`
and rendered by the existing `ApiExceptionHandler` as
`{ "type": "urn:gones:problem:validation_failed", "status": 400, … }`.

**There is no `404` on either route.** An unknown `scopeId` is a legal query over an empty partition.

### Invariants

1. `scope_id = ''` ⇔ `scope_kind = 'global'`. A `league` or `season` row never has an empty `scope_id`.
2. `(scope_kind, scope_id, player_name)` is unique. The check constraint
   `ck_player_statistics_scope_kind` rejects any other `scope_kind`.
3. A scope with no player who played a valid Match in it produces **zero rows**. Empty scopes are not
   materialized; the endpoint answers them with an empty page, not a `404`.
4. **A standalone Tournament (`season_id IS NULL`) contributes to the `global` scope and to nothing
   else.** Same for a Tournament whose `season_id` does not resolve to a live (`deleted_at IS NULL`)
   season row — defensive, and it degrades to standalone rather than to a phantom scope.
5. Every number in a scoped row is computed from that scope's Tournaments alone. There is no
   post-filtering of global numbers anywhere in this ticket.
6. The rebuild is **idempotent**: running it twice with no archive change produces byte-identical rows.
   `CalculateGlobalPlayerStatistics` reads one clock, and only for idle deviation growth and the decayed
   rating, in whole months over a date — so two rebuilds on the same day agree exactly.
7. The rebuild **does not call `SaveChangesAsync`**. Its `DELETE FROM player_statistics` is raw SQL that
   must share the caller's transaction with the save that stages the replacement.
8. The rebuild takes `pg_advisory_xact_lock(hashtext('gones:player-statistics'), hashtext('rebuild'))`
   **first**, before reading anything. Unchanged from today, and load-bearing: two transactions editing
   different Tournaments both rewrite the whole table, and without the lock the loser's `DELETE` is
   evaluated against a pre-commit snapshot and its inserts collide on the primary key.
9. Ordering inside a scope is the ADR 0043 three-bucket order by default, with every tie broken on
   `player_name` collated `"C"` ascending. `Position` in the response is `offset + index + 1`.
10. `provisional` and `inactive` are derived from the request clock at read time, never stored. The
    request date is therefore part of the ETag input.
11. The scope pair `(scopeKind, scopeId)` is part of the ETag input on both routes, so two scopes can
    never be answered `304` against each other's body.
12. Scope enumeration order is deterministic: global, then League scopes by `scope_id` ordinal
    ascending, then Season scopes by `scope_id` ordinal ascending; and inside a scope, Tournaments are
    ordered by `document_id` ordinal ascending before being handed to the domain.

### Decisions taken inside this ticket

Recorded here because a later reader will otherwise re-litigate them.

- **D1 — the new endpoint duplicates rather than reuses.** `PublicLeagueEndpoints.cs` is on T17's
  deletion list. The new archive endpoint therefore carries its own copies of the filter/order/ETag
  helpers and its own response records, in `Gones.Api.Archive`. Reusing the legacy file's internals
  would make the new surface depend on the dying one, which the plan's "no compatibility shim is
  written" rule forbids, and would leave T17 relocating code out of a file it is told to delete.
  The C# record names differ (`ArchiveGlobalPlayerStatisticsRow` vs `GlobalPlayerStatisticsRow`) so the
  OpenAPI document has no schema collision; the **JSON field names are identical**, which is what the
  contract froze.
- **D2 — the archive is read by column name, never by T2's CLR type name.** The plan pins the three
  table names and every column, but not the C# aggregate names, and this ticket is written in parallel
  with T2/T4. Persisted rows are read with a raw `DbCommand` over the frozen column names; rows still in
  the change tracker are read through `IProperty.GetColumnName(StoreObjectIdentifier)`, again by column
  name. That is why `ArchiveScopeSource` names no archive entity type.
- **D3 — the global scope also reads the legacy `league_aggregates` table, until T17.** The legacy
  archive is empty in production (T1 wiped it) but not in the existing integration tests, which seed
  `LeagueArchiveAggregates` and assert the resulting rows. Dropping the legacy read here would turn a
  dozen green tests red for no product reason, and the plan forbids deleting legacy code outside T17.
  League and Season scopes read the **new tables only** — a legacy aggregate has no League and no Season
  to belong to.
- **D4 — `pageSize` default stays `100`, allowed set stays `[10, 25, 50, 100]`.** The contract's
  query-string sketch shows `&page=1&pageSize=25`, but the same paragraph says the response is "the
  existing paged global-statistics response … Only the scope selection is new". `25` is a legal value in
  the existing set, so the sketch is satisfied by an explicit request; changing the default would change
  behaviour the contract said was unchanged.
- **D5 — the sort allowlist is the union.** The contract lists
  `sort=rating|name|matches|wins|losses|winrate|tournaments`; the existing endpoint accepts eleven
  camelCase column names. Both are honoured: the seven short names are added as aliases (`name` is
  genuinely new), the eleven existing names keep working. Nothing is removed.
- **D6 — `Cache-Control: public, max-age=3600` on both routes**, per the contract's blanket rule for
  archive read routes, even though the legacy paged route uses `max-age=60`. Noted risk: `inactive` and
  `provisional` flip on a date boundary, and a one-hour fresh window can show yesterday's buckets for up
  to an hour. The ETag carries the request date, so a revalidation corrects it immediately.
- **D7 — validation failures use the existing `ApiValidationException`**, whose code is
  `validation_failed`, not the `invalidRequest` string the plan's error table names. `validation_failed`
  is what every other endpoint in this API already emits for a `400`, and the frontend classifier keys
  on HTTP status first. Renaming it would be an API-wide change far outside this fence.

## TDD

1. **Red** — write these first, watch them fail for the stated reason, and do not write production code
   until each has failed once:
   - `PlayerStatisticsRowTests.Round_trips_every_rating_column` — updated call
     `PlayerStatisticsRow.From(statistics, "league", "league-1")`; fails to compile (`From` takes one
     argument).
   - `PlayerStatisticsRowTests.Carries_the_scope_it_was_computed_in` — fails to compile.
   - `ScopedPlayerStatisticsRebuildTests.*` (7 tests) — fail: `ArchiveScopeSource` does not exist.
   - `ArchiveScopedStatisticsApiTests.*` (11 tests) — fail: `404` from an unmapped route.
2. **Green** — minimum production code to pass, in the order of *Impl steps*.
3. **Refactor** — only if needed. Keep green.

## Test plan

New file `backend/tests/Gones.IntegrationTests/ScopedPlayerStatisticsRebuildTests.cs`.
Seed (written straight to the three archive tables with raw SQL through `GonesDbContext`, so the fixture
does not depend on T2's C# API either):

- `archive_leagues`: `L1`, `L2`.
- `archive_league_seasons`: `S1 → L1`, `S2 → L1`, `S3 → L2`.
- `archive_tournaments`, all `status = 'completed'` unless stated:
  - `T-S1-a` (season `S1`, date `2030-01-05`): `Alice 2-0 Bob`.
  - `T-S1-b` (season `S1`, date `2030-02-05`): `Alice 2-1 Bob`.
  - `T-S2-a` (season `S2`, date `2030-03-05`): `Bob 2-0 Alice`.
  - `T-S3-a` (season `S3`, date `2030-04-05`): `Alice 2-0 Carol`.
  - `T-LONE`  (season `NULL`, date `2030-05-05`): `Alice 2-0 Dana`.
  - `T-ACTIVE` (season `S1`, date `2030-06-05`, `status = 'active'`): `Erin 2-0 Frank`.
  - `T-GONE`  (season `S1`, date `2030-07-05`, `deleted_at` set): `Gina 2-0 Hugo`.

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Writes_one_row_per_scope_and_player` | rebuild over the seed | distinct `(ScopeKind, ScopeId)` pairs are exactly `("global","")`, `("league","L1")`, `("league","L2")`, `("season","S1")`, `("season","S2")`, `("season","S3")`; every row's `ScopeId` is `""` iff `ScopeKind == "global"` |
| `Counts_only_the_scopes_tournaments` | rebuild | `global/Alice.PlayedMatchCount == 5`; `league L1/Alice == 3`; `league L2/Alice == 1`; `season S1/Alice == 2`; `season S2/Alice == 1`; `season S3/Alice == 1` |
| `Counts_tournaments_played_within_the_scope` | rebuild | `global/Alice.TournamentsPlayed == 5`; `season S1/Alice.TournamentsPlayed == 2`; `season S2/Alice.TournamentsPlayed == 1` |
| `Recomputes_the_rating_inside_the_scope_rather_than_filtering_the_global_one` | rebuild | `season S2/Alice.Rating != global/Alice.Rating`; `season S2/Alice.PreviousRating == 1500.0` and `RatingDeviation == 350.0` before its single period is folded is **not** asserted — instead assert `season S2/Alice.Rating < 1500` (she only lost there) while `global/Alice.Rating > 1500`, and `season S1/Alice.MatchWinrate == 1.0` while `global/Alice.MatchWinrate == 0.8` |
| `Keeps_a_standalone_tournament_out_of_every_league_and_season_scope` | rebuild | `Dana` has exactly one row and its scope is `("global","")`; no `league`/`season` row anywhere mentions `Dana`; `season S1/Alice.PlayedMatchCount` is unchanged by `T-LONE` |
| `Ignores_active_and_deleted_tournaments_in_every_scope` | rebuild | no row for `Erin`, `Frank`, `Gina` or `Hugo` in any scope |
| `Is_idempotent_across_scopes` | rebuild twice | the full ordered projection `(ScopeKind, ScopeId, ToGlobalPlayerStatistics())` is equal between runs |

New file `backend/tests/Gones.IntegrationTests/ArchiveScopedStatisticsApiTests.cs`. Seed
`player_statistics` **directly** (the fixture is the assertion), with
`Gones:PlayerStatistics:RebuildOnStartup=false` and a frozen `MutableClock`, exactly as
`GlobalStatsRatingApiTests` does. Rows: `("global","")` → `Alice`, `Bob`, `Carol`;
`("league","L1")` → `Alice`, `Bob`; `("season","S1")` → `Alice`.

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Defaults_to_the_global_scope` | `GET /api/archive/global-player-statistics` | `200`; `totalCount == 3`; player names `Alice`, `Bob`, `Carol` |
| `Serves_a_league_scope` | `?scopeKind=league&scopeId=L1` | `200`; `totalCount == 2`; names `Alice`, `Bob` |
| `Serves_a_season_scope` | `?scopeKind=season&scopeId=S1` | `200`; `totalCount == 1`; names `Alice` |
| `Answers_an_unknown_scope_id_with_an_empty_page` | `?scopeKind=league&scopeId=does-not-exist` | `200`, **not** `404`; `totalCount == 0`; `items` empty; `page == 1` |
| `Answers_an_unknown_scope_id_with_an_empty_catalog` | `/all?scopeKind=season&scopeId=nope` | `200`; `totalCount == 0`; `items` empty; `truncated == false` |
| `Ignores_a_scope_id_on_the_global_scope` | `?scopeKind=global&scopeId=L1` | `200`; identical body to `Defaults_to_the_global_scope` |
| `Rejects_an_unknown_scope_kind` | `?scopeKind=continent` | `400`; problem `type` ends `validation_failed`; `errors.scopeKind` present |
| `Rejects_a_league_scope_without_an_id` | `?scopeKind=league` | `400`; `errors.scopeId` present |
| `Keeps_the_legacy_field_names` | `?scopeKind=league&scopeId=L1` | the row object's property names are exactly the 23 listed in *Interface contract → Produces — HTTP*, and the envelope's are exactly `items`, `page`, `pageSize`, `totalCount`, `sort`, `direction` |
| `Caches_each_scope_under_its_own_etag` | `GET` global, then `GET` `league/L1` | the two `ETag` values differ; replaying each with `If-None-Match` gives `304`; replaying the global ETag against the League scope gives `200`; both responses carry `Cache-Control: public, max-age=3600` |
| `Sorts_by_every_allowlisted_key_inside_the_scope` | `?scopeKind=league&scopeId=L1&sort=<key>` for `rating`, `name`, `matches`, `wins`, `losses`, `winrate`, `tournaments`, `playedMatchCount`, `matchWins`, `matchLosses`, `matchDraws`, `matchWinrate`, `playedGameCount`, `gameWins`, `gameLosses`, `gameWinrate`, `tournamentsPlayed`, each with `direction=asc` and `desc` | every request `200`; `totalCount == 2` every time; `sort=continent` → `400` |

Updated file `backend/tests/Gones.UnitTests/PlayerStatisticsRowTests.cs`:

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Round_trips_every_rating_column` (existing, updated) | `PlayerStatisticsRow.From(statistics, PlayerStatisticsScope.League, "L1").ToGlobalPlayerStatistics()` | equals the source `GlobalPlayerStatistics` record |
| `Carries_the_scope_it_was_computed_in` (new) | `PlayerStatisticsRow.From(statistics, PlayerStatisticsScope.Season, "S1")` | `ScopeKind == "season"`, `ScopeId == "S1"` |
| `Uses_an_empty_scope_id_for_the_global_scope` (new) | `PlayerStatisticsRow.From(statistics, PlayerStatisticsScope.Global, PlayerStatisticsScope.GlobalScopeId)` | `ScopeId == string.Empty` |

Run commands:

```bash
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ScopedPlayerStatisticsRebuildTests"
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveScopedStatisticsApiTests"
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~PlayerStatisticsRowTests"
npm run backend:test
```

## Impl steps

- [ ] 1. Red: pin the new behaviour in failing tests before any production code exists
  - [ ] 1.1 Edit `backend/tests/Gones.UnitTests/PlayerStatisticsRowTests.cs`: change the single assertion
        line `Assert.Equal(statistics, PlayerStatisticsRow.From(statistics).ToGlobalPlayerStatistics());`
        to `Assert.Equal(statistics, PlayerStatisticsRow.From(statistics, PlayerStatisticsScope.League, "L1").ToGlobalPlayerStatistics());`
  - [ ] 1.2 In the same file append two tests:

        ```csharp
        [Fact]
        public void Carries_the_scope_it_was_computed_in()
        {
            var row = PlayerStatisticsRow.From(Sample(), PlayerStatisticsScope.Season, "S1");
            Assert.Equal("season", row.ScopeKind);
            Assert.Equal("S1", row.ScopeId);
        }

        [Fact]
        public void Uses_an_empty_scope_id_for_the_global_scope()
        {
            var row = PlayerStatisticsRow.From(Sample(), PlayerStatisticsScope.Global, PlayerStatisticsScope.GlobalScopeId);
            Assert.Equal("global", row.ScopeKind);
            Assert.Equal(string.Empty, row.ScopeId);
        }
        ```
        …and extract the existing 21-argument `new GlobalPlayerStatistics(...)` literal from
        `Round_trips_every_rating_column` into `private static GlobalPlayerStatistics Sample() => new(...)`
        so all three tests share it.
  - [ ] 1.3 Create `backend/tests/Gones.IntegrationTests/ScopedPlayerStatisticsRebuildTests.cs` with the
        seven tests named in *Test plan*, the seven-Tournament seed described there, and a
        `SeedArchiveAsync()` helper that writes the three archive tables with
        `database.Database.ExecuteSqlRawAsync` (raw `INSERT INTO archive_leagues / archive_league_seasons /
        archive_tournaments (...) VALUES (...)`, `document` built with `LeagueJson.Serialize(new { rounds = …,
        playerArchetypes = Array.Empty<PlayerArchetypeDocument>() })`). Reuse the `RebuildAsync()` helper
        shape from `backend/tests/Gones.IntegrationTests/PlayerStatisticsRebuildTests.cs:333-340`.
  - [ ] 1.4 Create `backend/tests/Gones.IntegrationTests/ArchiveScopedStatisticsApiTests.cs` with the
        eleven tests named in *Test plan*, copying the fixture shape of
        `backend/tests/Gones.IntegrationTests/GlobalStatsRatingApiTests.cs:49-90` verbatim — frozen
        `MutableClock`, `builder.UseSetting("Gones:PlayerStatistics:RebuildOnStartup", "false")`, a
        hand-stamped `PlayerStatisticsMeta` row.
  - [ ] 1.5 Run `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ScopedPlayerStatisticsRebuildTests|FullyQualifiedName~ArchiveScopedStatisticsApiTests|FullyQualifiedName~PlayerStatisticsRowTests"`
        and record that it fails to build / fails.

- [ ] 2. Re-key the read model
  - [ ] 2.1 In `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModel.cs`, insert as the
        first two members of `PlayerStatisticsRow`, above `public required string PlayerName`:

        ```csharp
            /// <summary>Which partition of the archive this row was computed over: "global", "league" or "season".</summary>
            public required string ScopeKind { get; init; }

            /// <summary>The League or LeagueSeason document id, and the empty string for the global scope.</summary>
            public required string ScopeId { get; init; }
        ```
  - [ ] 2.2 In the same file change the factory signature to
        `public static PlayerStatisticsRow From(GlobalPlayerStatistics statistics, string scopeKind, string scopeId) => new()`
        and add `ScopeKind = scopeKind,` and `ScopeId = scopeId,` as the first two initializers.
        `ToGlobalPlayerStatistics()` is unchanged — the scope is the key, not part of the statistics.
  - [ ] 2.3 In the same file, above `PlayerStatisticsRow`, add:

        ```csharp
        /// <summary>
        /// The three partitions <c>player_statistics</c> is keyed by. A standalone Tournament belongs to no
        /// League and no LeagueSeason, so it feeds <see cref="Global"/> and nothing else.
        /// </summary>
        public static class PlayerStatisticsScope
        {
            public const string Global = "global";
            public const string League = "league";
            public const string Season = "season";

            /// <summary><c>scope_id</c> is the empty string exactly when <c>scope_kind</c> is <see cref="Global"/>.</summary>
            public const string GlobalScopeId = "";

            public static bool IsKnownKind(string? kind) => kind is Global or League or Season;
        }
        ```
  - [ ] 2.4 In `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModelConfigurations.cs`,
        replace `builder.HasKey(row => row.PlayerName);` with
        `builder.HasKey(row => new { row.ScopeKind, row.ScopeId, row.PlayerName });` and add, right after
        the existing `builder.Property(row => row.PlayerName).HasColumnType("text");`:

        ```csharp
                builder.Property(row => row.ScopeKind).HasColumnType("text");
                builder.Property(row => row.ScopeId).HasColumnType("text");
                builder.ToTable(table => table.HasCheckConstraint(
                    "ck_player_statistics_scope_kind",
                    $"scope_kind IN ('{PlayerStatisticsScope.Global}','{PlayerStatisticsScope.League}','{PlayerStatisticsScope.Season}')"));
        ```
        Leave all eleven `HasIndex` calls exactly as they are: the composite primary key already indexes
        `(scope_kind, scope_id)` as its leading columns, which is the only new access path.

- [ ] 3. The migration
  - [ ] 3.1 Run, from the repository root:
        `dotnet ef migrations add ScopePlayerStatistics --project backend/src/Gones.Infrastructure --startup-project backend/src/Gones.Infrastructure`
  - [ ] 3.2 Open the generated `backend/src/Gones.Infrastructure/Persistence/Migrations/*_ScopePlayerStatistics.cs`
        and hand-add the database-level defaults on the two `AddColumn<string>` calls —
        `defaultValue: "global"` on `scope_kind`, `defaultValue: ""` on `scope_id` — mirroring
        `20260820160349_AddPlayerRatingColumns.cs`, whose comment states the rule: the defaults exist only
        so `NOT NULL` is legal for rows that already exist between the migration and the next rebuild, and
        they are deliberately database-level only so the model declares no default.
  - [ ] 3.3 In the same file, add the class-level `<summary>` doc comment stating: this re-keys the ADR
        0040 read model by scope; there is no backfill because the whole table is rewritten by the rebuild
        that `PlayerStatisticsFormula.Version` going to 3 in this commit triggers.
  - [ ] 3.4 Verify the `Up` body contains no `DropTable`/`CreateTable` pair (it must be
        `AddColumn` ×2, `DropPrimaryKey`, `AddPrimaryKey`, `AddCheckConstraint`) — that pair is what
        `backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs` rejects.
  - [ ] 3.5 Append the new migration id to the hardcoded list at `scripts/smoke-full-stack.mjs:57`
        (`const expectedMigrations = [...]`) as the last element, spelled exactly
        `'<timestamp>_ScopePlayerStatistics'`. Omitting this breaks the full-stack gate for every later
        ticket.
  - [ ] 3.6 Run `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~MigrationSafetyTests"`
        and confirm `Committed_migrations_fully_describe_the_model` passes (no model-snapshot drift).

- [ ] 4. The per-scope archive reader
  - [ ] 4.1 Create `backend/src/Gones.Api/Leagues/ArchiveScopeSource.cs` with exactly this content:

        ```csharp
        using System.Data;
        using System.Data.Common;
        using System.Globalization;
        using System.Text.Json;
        using Gones.Domain.Leagues;
        using Gones.Infrastructure.Persistence;
        using Microsoft.EntityFrameworkCore;
        using Microsoft.EntityFrameworkCore.ChangeTracking;
        using Microsoft.EntityFrameworkCore.Metadata;
        using Microsoft.EntityFrameworkCore.Storage;
        using NodaTime;

        namespace Gones.Api.Leagues;

        /// <summary>One <c>(scopeKind, scopeId)</c> partition of the archive, shaped for the statistics maths.</summary>
        internal sealed record ArchiveStatisticsScope(string ScopeKind, string ScopeId, GonesData Data);

        /// <summary>One Archive Tournament, read by column name.</summary>
        internal sealed record ArchiveTournamentSource(
            string DocumentId,
            string? SeasonId,
            string Name,
            string TournamentDate,
            string Status,
            string Document);

        /// <summary>
        /// Splits the three-tier archive into the scopes <c>player_statistics</c> is keyed by: the global
        /// scope, one scope per League, one scope per LeagueSeason.
        ///
        /// <para><b>A standalone Tournament — <c>season_id IS NULL</c> — belongs to no League and no Season,
        /// so it feeds the global scope only.</b> The same fallback covers a Tournament whose season row is
        /// gone: it degrades to standalone rather than inventing a scope.</para>
        ///
        /// <para>Every scope is a full, independent input to
        /// <see cref="LeagueRules.CalculateGlobalPlayerStatistics"/>. Nothing here filters a global number
        /// down: a League rating is a Glicko-2 replay over that League's Tournaments from the published
        /// seed, and a League <c>tournamentsPlayed</c> counts that League's Tournaments only. That is the
        /// whole point of storing per-scope rows rather than one global row and a WHERE clause.</para>
        ///
        /// <para>The archive is read by <b>column name</b> and never by entity type. Persisted rows come
        /// from a raw command over the frozen column names; rows the caller has staged but not yet saved
        /// come from the change tracker, matched through <see cref="IProperty.GetColumnName(in StoreObjectIdentifier)"/>.
        /// Both halves are needed because an archive command runs this rebuild inside its write
        /// transaction and may do so before <c>SaveChangesAsync</c>.</para>
        /// </summary>
        internal static class ArchiveScopeSource
        {
            private const string SeasonTable = "archive_league_seasons";
            private const string TournamentTable = "archive_tournaments";

            public static async Task<IReadOnlyList<ArchiveStatisticsScope>> LoadAsync(
                GonesDbContext database,
                IReadOnlyList<LeagueDocument> legacyLeagues,
                CancellationToken cancellationToken)
            {
                var seasons = await LoadSeasonsAsync(database, cancellationToken);
                var tournaments = await LoadTournamentsAsync(database, cancellationToken);

                var scopes = new List<ArchiveStatisticsScope>
                {
                    // The global scope carries every live Tournament, standalone ones included, plus the
                    // legacy aggregates that have not been retired yet. Delete the legacy half at T17.
                    Scope(PlayerStatisticsScope.Global, PlayerStatisticsScope.GlobalScopeId, tournaments, legacyLeagues)
                };

                var attached = tournaments
                    .Where(tournament => tournament.SeasonId is not null && seasons.ContainsKey(tournament.SeasonId))
                    .ToList();

                foreach (var group in attached
                    .GroupBy(tournament => seasons[tournament.SeasonId!], StringComparer.Ordinal)
                    .OrderBy(group => group.Key, StringComparer.Ordinal))
                {
                    scopes.Add(Scope(PlayerStatisticsScope.League, group.Key, group.ToList(), []));
                }

                foreach (var group in attached
                    .GroupBy(tournament => tournament.SeasonId!, StringComparer.Ordinal)
                    .OrderBy(group => group.Key, StringComparer.Ordinal))
                {
                    scopes.Add(Scope(PlayerStatisticsScope.Season, group.Key, group.ToList(), []));
                }

                return scopes;
            }

            private static ArchiveStatisticsScope Scope(
                string scopeKind,
                string scopeId,
                IReadOnlyList<ArchiveTournamentSource> tournaments,
                IReadOnlyList<LeagueDocument> extraLeagues)
            {
                // The synthetic League exists because the domain walks data.Leagues[].Tournaments[]. It is a
                // container, never a scope: the statistics maths reads a Tournament's status and date and
                // never the League around it.
                var containerId = $"{scopeKind}:{scopeId}";
                var documents = tournaments
                    .OrderBy(tournament => tournament.DocumentId, StringComparer.Ordinal)
                    .Select(tournament =>
                    {
                        using var parsed = JsonDocument.Parse(tournament.Document);
                        return new TournamentDocument(
                            tournament.DocumentId,
                            containerId,
                            tournament.Name,
                            tournament.TournamentDate,
                            tournament.Status,
                            ReadArray<RoundDocument>(parsed.RootElement, "rounds"),
                            ReadArray<PlayerArchetypeDocument>(parsed.RootElement, "playerArchetypes"));
                    })
                    .ToList();
                var leagues = new List<LeagueDocument>(extraLeagues)
                {
                    new(containerId, containerId, "completed", documents)
                };
                return new ArchiveStatisticsScope(
                    scopeKind,
                    scopeId,
                    new GonesData(LeagueNormalizer.GonesDataVersion, leagues, []));
            }

            private static IReadOnlyList<T> ReadArray<T>(JsonElement root, string property) =>
                root.TryGetProperty(property, out var element) && element.ValueKind == JsonValueKind.Array
                    ? LeagueJson.Deserialize<List<T>>(element)
                    : [];

            /// <summary>Season document id → League document id, for every live Season.</summary>
            private static async Task<Dictionary<string, string>> LoadSeasonsAsync(
                GonesDbContext database,
                CancellationToken cancellationToken)
            {
                var seasons = await QueryAsync(
                    database,
                    "SELECT document_id, league_id FROM archive_league_seasons WHERE deleted_at IS NULL",
                    reader => (DocumentId: reader.GetString(0), LeagueId: reader.GetString(1)),
                    cancellationToken);
                var byId = seasons.ToDictionary(season => season.DocumentId, season => season.LeagueId, StringComparer.Ordinal);
                foreach (var entry in TrackedEntries(database, SeasonTable))
                {
                    var documentId = Text(ColumnValue(entry, "document_id"));
                    if (documentId is null) continue;
                    if (entry.State == EntityState.Deleted || ColumnValue(entry, "deleted_at") is not null)
                    {
                        byId.Remove(documentId);
                        continue;
                    }
                    var leagueId = Text(ColumnValue(entry, "league_id"));
                    if (leagueId is not null) byId[documentId] = leagueId;
                }
                return byId;
            }

            private static async Task<List<ArchiveTournamentSource>> LoadTournamentsAsync(
                GonesDbContext database,
                CancellationToken cancellationToken)
            {
                var stored = await QueryAsync(
                    database,
                    """
                    SELECT document_id, season_id, name, tournament_date::text, status, document::text
                    FROM archive_tournaments
                    WHERE deleted_at IS NULL
                    """,
                    reader => new ArchiveTournamentSource(
                        reader.GetString(0),
                        reader.IsDBNull(1) ? null : reader.GetString(1),
                        reader.GetString(2),
                        reader.GetString(3),
                        reader.GetString(4),
                        reader.GetString(5)),
                    cancellationToken);
                var byId = stored.ToDictionary(tournament => tournament.DocumentId, StringComparer.Ordinal);
                foreach (var entry in TrackedEntries(database, TournamentTable))
                {
                    var documentId = Text(ColumnValue(entry, "document_id"));
                    if (documentId is null) continue;
                    if (entry.State == EntityState.Deleted || ColumnValue(entry, "deleted_at") is not null)
                    {
                        byId.Remove(documentId);
                        continue;
                    }
                    byId[documentId] = new ArchiveTournamentSource(
                        documentId,
                        Text(ColumnValue(entry, "season_id")),
                        Text(ColumnValue(entry, "name")) ?? string.Empty,
                        IsoDate(ColumnValue(entry, "tournament_date")),
                        Text(ColumnValue(entry, "status")) ?? string.Empty,
                        Text(ColumnValue(entry, "document")) ?? "{}");
                }
                return byId.Values.ToList();
            }

            private static IEnumerable<EntityEntry> TrackedEntries(GonesDbContext database, string table) =>
                database.ChangeTracker.Entries().Where(entry => entry.Metadata.GetTableName() == table);

            /// <summary>
            /// The current value behind a column, found by column name so this file names no archive entity
            /// type. The plan freezes the column names; it does not freeze the CLR ones.
            /// </summary>
            private static object? ColumnValue(EntityEntry entry, string column)
            {
                var table = entry.Metadata.GetTableName();
                if (table is null) return null;
                var identifier = StoreObjectIdentifier.Table(table, entry.Metadata.GetSchema());
                var property = entry.Metadata.GetProperties()
                    .FirstOrDefault(candidate => candidate.GetColumnName(identifier) == column);
                return property is null ? null : entry.Property(property.Name).CurrentValue;
            }

            private static string? Text(object? value) => value switch
            {
                null => null,
                string text => text,
                _ => value.ToString()
            };

            /// <summary>
            /// A stored Tournament date as the ISO string the domain compares and groups rating periods by.
            /// The three shapes a <c>date</c> column can surface as are all handled, so this does not depend
            /// on which CLR type the archive aggregate chose.
            /// </summary>
            private static string IsoDate(object? value) => value switch
            {
                null => string.Empty,
                LocalDate local => local.ToString("uuuu-MM-dd", CultureInfo.InvariantCulture),
                DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                DateTime moment => moment.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                string text => text.Length >= 10 ? text[..10] : text,
                _ => string.Empty
            };

            /// <summary>
            /// Reads through the context's own connection and enlists in the caller's transaction, so the
            /// rows this sees are the rows the rebuild's <c>DELETE</c> and inserts will be committed beside.
            /// </summary>
            private static async Task<List<T>> QueryAsync<T>(
                GonesDbContext database,
                string sql,
                Func<DbDataReader, T> read,
                CancellationToken cancellationToken)
            {
                var connection = database.Database.GetDbConnection();
                if (connection.State != ConnectionState.Open) await connection.OpenAsync(cancellationToken);
                await using var command = connection.CreateCommand();
                command.CommandText = sql;
                command.Transaction = database.Database.CurrentTransaction?.GetDbTransaction();
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                var rows = new List<T>();
                while (await reader.ReadAsync(cancellationToken)) rows.Add(read(reader));
                return rows;
            }
        }
        ```
  - [ ] 4.2 Run `npm run backend:build` and fix any compile error in this file only.

- [ ] 5. Rebuild one row per (scope, player)
  - [ ] 5.1 In `backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs`, replace the body of
        `RebuildAsync` from `var data = new GonesData(...)` through the `logger.LogInformation(...)` call
        with:

        ```csharp
                var scopes = await ArchiveScopeSource.LoadAsync(
                    database,
                    live.Select(aggregate => aggregate.ReadDocument()).ToList(),
                    cancellationToken);
                var rows = new List<PlayerStatisticsRow>();
                foreach (var scope in scopes)
                {
                    foreach (var statistics in LeagueRules.CalculateGlobalPlayerStatistics(scope.Data))
                    {
                        rows.Add(PlayerStatisticsRow.From(statistics, scope.ScopeKind, scope.ScopeId));
                    }
                }

                // The delete runs inside the caller's transaction; the inserts are staged for the same
                // SaveChangesAsync. Any row this context still tracks belongs to the state being replaced.
                await database.Database.ExecuteSqlRawAsync("DELETE FROM player_statistics", cancellationToken);
                foreach (var entry in database.ChangeTracker.Entries<PlayerStatisticsRow>().ToList()) entry.State = EntityState.Detached;
                database.PlayerStatistics.AddRange(rows);
                await StampAsync(database, cancellationToken);

                logger.LogInformation(
                    "Player statistics rebuilt: {RowCount} rows across {ScopeCount} scopes in {ElapsedMilliseconds} ms.",
                    rows.Count,
                    scopes.Count,
                    Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        ```
        Keep everything above it — `ArgumentNullException.ThrowIfNull`, `Stopwatch.GetTimestamp`,
        `await LockAsync(...)` first, and the tracked `stored`/`pending`/`deleted`/`live` block — exactly
        as it is. `live` now feeds only the global scope.
  - [ ] 5.2 In the same file, extend the class `<summary>` with one paragraph:

        ```csharp
        /// <para>Since the three-tier rebuild the table holds <b>one row per (scope, player)</b>: the global
        /// scope, one scope per League, one scope per LeagueSeason. Each scope is recomputed from its own
        /// Tournaments — rating, matches, tournaments played and winrate are all replayed inside the scope
        /// and are never a global number filtered down. A standalone Tournament belongs to no League and no
        /// Season, so it feeds the global scope only. The cost is roughly three passes over the archive
        /// instead of one, because every attached Tournament is walked once for its Season, once for its
        /// League and once globally.</para>
        ```
  - [ ] 5.3 In `backend/src/Gones.Domain/Leagues/PlayerStatisticsFormula.cs` change
        `public const int Version = 2;` to `public const int Version = 3;` and append to the class
        `<summary>`:

        ```csharp
        /// <para>Version 3 re-keys the table by scope: the same maths now runs once per partition of the
        /// archive — global, per League, per LeagueSeason — so every stored row has to be recomputed.</para>
        ```
  - [ ] 5.4 Run
        `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ScopedPlayerStatisticsRebuildTests"`
        and get it green.
  - [ ] 5.5 Run
        `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~PlayerStatisticsRebuildTests|FullyQualifiedName~PlayerStatisticsRatingRebuildTests|FullyQualifiedName~PlayerStatisticsStartupTests|FullyQualifiedName~MigrationImportServiceTests"`
        and confirm the legacy rebuild tests are still green — they must be, because the legacy aggregates
        still feed the global scope.

- [ ] 6. Pin the scope-blind readers to the global scope
  - [ ] 6.1 In `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs`, add a single helper next to
        `FilterGlobalStats`:

        ```csharp
            /// <summary>
            /// The legacy rankings only ever meant the whole archive, and <c>player_statistics</c> now holds a
            /// row per scope. Without this the same player would appear once per League they played in.
            /// Removed with this file at T17.
            /// </summary>
            private static IQueryable<PlayerStatisticsRow> GlobalScope(IQueryable<PlayerStatisticsRow> query) =>
                query.Where(row => row.ScopeKind == PlayerStatisticsScope.Global);
        ```
  - [ ] 6.2 In the same file wrap the three `database.PlayerStatistics.AsNoTracking()` reads in it:
        line 124 becomes `var query = FilterGlobalStats(GlobalScope(database.PlayerStatistics.AsNoTracking()), search);`;
        line 162 becomes `var total = await GlobalScope(database.PlayerStatistics.AsNoTracking()).CountAsync(cancellationToken);`;
        line 171 becomes `var fetched = await GlobalScope(database.PlayerStatistics.AsNoTracking())`.
  - [ ] 6.3 In `backend/src/Gones.Api/Leagues/PlayerEndpoints.cs` `FindAsync`, add the same predicate to
        both queries: `.SingleOrDefaultAsync(row => row.ScopeKind == PlayerStatisticsScope.Global && row.PlayerName == playerName, cancellationToken)`
        and `.Where(row => row.ScopeKind == PlayerStatisticsScope.Global && EF.Functions.ILike(row.PlayerName, pattern, "\\"))`.
        Add `using Gones.Infrastructure.Persistence;` if it is not already imported. Without this the
        `SingleOrDefaultAsync` throws `InvalidOperationException` — a `500` — as soon as one player has
        both a global and a League row.
  - [ ] 6.4 Extend the `<summary>` on `FindAsync` with: *"Scoped to the global partition: the player page
        is the whole archive, and the read model now holds one row per (scope, player)."*

- [ ] 7. The scoped read endpoints
  - [ ] 7.1 Create `backend/src/Gones.Api/Archive/ArchivePlayerStatisticsEndpoints.cs` with exactly this
        content:

        ```csharp
        using System.Globalization;
        using System.Linq.Expressions;
        using System.Security.Cryptography;
        using System.Text;
        using Gones.Api.Errors;
        using Gones.Api.Leagues;
        using Gones.Domain.Leagues;
        using Gones.Infrastructure.Persistence;
        using Microsoft.EntityFrameworkCore;
        using NodaTime;

        namespace Gones.Api.Archive;

        /// <summary>
        /// The scoped rankings: the same materialized read model as the legacy route, addressed by the
        /// partition it was computed in. <c>scopeKind=global</c> is the whole archive; <c>league</c> and
        /// <c>season</c> select the stored rows for one League or one LeagueSeason, whose ratings, match
        /// counts, tournament counts and winrates were each replayed inside that scope.
        ///
        /// <para>Deliberately self-contained rather than calling into <c>PublicLeagueEndpoints</c>: that file
        /// is deleted when the legacy archive is retired, and the new surface must not depend on the dying
        /// one. The response field names are identical on the wire; only the C# type names differ, so the two
        /// coexist in one OpenAPI document.</para>
        ///
        /// <para>A <c>scopeId</c> with no rows is a legal query over an empty partition and answers
        /// <c>200</c> with an empty page. It is not a <c>404</c>: the scope is a filter, not a resource.</para>
        /// </summary>
        internal static class ArchivePlayerStatisticsEndpoints
        {
            private const string CatalogCacheControl = "public, max-age=3600";
            private const int MaximumSearchLength = 200;
            private const int MaximumScopeIdLength = 200;
            private const int DefaultPageSize = 100;
            private static readonly int[] AllowedPageSizes = [10, 25, 50, 100];

            /// <summary>The rankings catalog ceiling, under the key the legacy catalog already uses.</summary>
            public const int MaximumCatalogSize = 5000;
            public const string MaximumCatalogSizeKey = "Gones:GlobalStats:MaximumCatalogSize";

            /// <summary>
            /// The contract's short sort keys, mapped onto the columns the legacy endpoint already sorts by.
            /// Both spellings are accepted so neither the contract nor the existing surface is broken.
            /// </summary>
            private static readonly Dictionary<string, string> SortAliases = new(StringComparer.Ordinal)
            {
                ["matches"] = "playedMatchCount",
                ["wins"] = "matchWins",
                ["losses"] = "matchLosses",
                ["winrate"] = "matchWinrate",
                ["tournaments"] = "tournamentsPlayed"
            };

            private static readonly HashSet<string> SortAllowlist = new(StringComparer.Ordinal)
            {
                "playedMatchCount", "matchWins", "matchLosses", "matchDraws", "matchWinrate",
                "playedGameCount", "gameWins", "gameLosses", "gameWinrate",
                "rating", "tournamentsPlayed", "name"
            };

            public static void MapArchivePlayerStatisticsEndpoints(this WebApplication app)
            {
                app.MapGet("/api/archive/global-player-statistics", GetAsync)
                    .AllowAnonymous()
                    .WithName("GetArchiveGlobalPlayerStatistics")
                    .Produces<ArchiveGlobalPlayerStatisticsResponse>()
                    .Produces(StatusCodes.Status304NotModified)
                    .ProducesProblem(StatusCodes.Status400BadRequest);
                app.MapGet("/api/archive/global-player-statistics/all", GetCatalogAsync)
                    .AllowAnonymous()
                    .WithName("GetArchiveGlobalPlayerStatisticsCatalog")
                    .Produces<ArchiveGlobalPlayerStatisticsCatalogResponse>()
                    .Produces(StatusCodes.Status304NotModified)
                    .ProducesProblem(StatusCodes.Status400BadRequest);
            }

            private static async Task<IResult> GetAsync(
                string? scopeKind,
                string? scopeId,
                int? page,
                int? pageSize,
                string? search,
                string? sort,
                string? direction,
                HttpRequest request,
                HttpResponse response,
                GonesDbContext database,
                IConfiguration configuration,
                IClock clock,
                CancellationToken cancellationToken)
            {
                var scope = ValidateScope(scopeKind, scopeId);
                var pageNumber = page ?? 1;
                var size = pageSize ?? DefaultPageSize;
                var exposeDecayedRating = PlayerStatisticsDecayedRatingExposure.Enabled(configuration);
                if (pageNumber < 1) throw Validation("page", "Page must be at least 1.");
                if (!AllowedPageSizes.Contains(size)) throw Validation("pageSize", "Page size must be 10, 25, 50, or 100.");
                if (search?.Length > MaximumSearchLength) throw Validation("search", $"Search must be at most {MaximumSearchLength} characters.");
                var column = NormalizeSort(sort, exposeDecayedRating);
                if (direction is not null && direction is not ("asc" or "desc")) throw Validation("direction", "Direction must be asc or desc.");

                var query = Filter(Scoped(database, scope), search);
                var total = await query.CountAsync(cancellationToken);
                var today = clock.GetCurrentInstant().InUtc().Date;
                var normalizedQuery = $"sort={sort}&dir={direction}&search={search?.Trim() ?? string.Empty}&page={pageNumber}&size={size}";
                var etag = HashETag($"{await StampAsync(database, cancellationToken)}:{PlayerRankingRules.Iso(today)}:{scope.Kind}:{scope.Id}:{total}:{normalizedQuery}:{exposeDecayedRating}");
                SetCache(response, etag);
                if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

                var isDescending = !string.Equals(direction, "asc", StringComparison.Ordinal);
                var offset = (pageNumber - 1) * size;
                var rows = await Order(query, column, isDescending, today)
                    .Skip(offset)
                    .Take(size)
                    .ToListAsync(cancellationToken);
                var items = rows.Select((row, index) => ToRow(offset + index + 1, row, today, exposeDecayedRating)).ToList();

                return Results.Ok(new ArchiveGlobalPlayerStatisticsResponse(items, pageNumber, size, total, sort, direction));
            }

            private static async Task<IResult> GetCatalogAsync(
                string? scopeKind,
                string? scopeId,
                HttpRequest request,
                HttpResponse response,
                GonesDbContext database,
                IConfiguration configuration,
                ILoggerFactory loggerFactory,
                IClock clock,
                CancellationToken cancellationToken)
            {
                var scope = ValidateScope(scopeKind, scopeId);
                var ceiling = configuration.GetValue(MaximumCatalogSizeKey, MaximumCatalogSize);
                var total = await Scoped(database, scope).CountAsync(cancellationToken);
                var exposeDecayedRating = PlayerStatisticsDecayedRatingExposure.Enabled(configuration);
                var today = clock.GetCurrentInstant().InUtc().Date;
                var etag = HashETag($"{await StampAsync(database, cancellationToken)}:{PlayerRankingRules.Iso(today)}:{scope.Kind}:{scope.Id}:{total}:catalog:{ceiling}:{exposeDecayedRating}");
                SetCache(response, etag);
                if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

                // One row past the ceiling is what tells a truncated catalog from a scope that ends exactly there.
                var fetched = await Scoped(database, scope)
                    .OrderByDescending(row => row.PlayedMatchCount)
                    .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation))
                    .Take(ceiling + 1)
                    .ToListAsync(cancellationToken);
                var truncated = fetched.Count > ceiling;
                var items = (truncated ? fetched.Take(ceiling) : fetched)
                    .Select((row, index) => ToRow(index + 1, row, today, exposeDecayedRating))
                    .ToList();
                if (truncated)
                {
                    loggerFactory.CreateLogger("Gones.Api.Archive")
                        .LogWarning("Scoped player statistics catalog truncated: scope={ScopeKind}:{ScopeId} total={Total} ceiling={Ceiling}", scope.Kind, scope.Id, total, ceiling);
                }

                return Results.Ok(new ArchiveGlobalPlayerStatisticsCatalogResponse(items, total, truncated));
            }

            /// <summary>Postgres collation that orders text byte by byte, the way <c>StringComparer.Ordinal</c> does.</summary>
            private const string OrdinalCollation = "C";

            private readonly record struct StatisticsScope(string Kind, string Id);

            /// <summary>
            /// The scope selection. <c>scopeId</c> is required for a League or a Season and ignored for the
            /// global scope, whose stored id is the empty string. An id nothing matches is not an error — it
            /// selects an empty partition.
            /// </summary>
            private static StatisticsScope ValidateScope(string? scopeKind, string? scopeId)
            {
                var kind = string.IsNullOrWhiteSpace(scopeKind) ? PlayerStatisticsScope.Global : scopeKind;
                if (!PlayerStatisticsScope.IsKnownKind(kind))
                    throw Validation("scopeKind", "Scope kind must be global, league, or season.");
                if (kind == PlayerStatisticsScope.Global) return new StatisticsScope(kind, PlayerStatisticsScope.GlobalScopeId);
                if (string.IsNullOrWhiteSpace(scopeId))
                    throw Validation("scopeId", "Scope id is required for a league or season scope.");
                if (scopeId.Length > MaximumScopeIdLength)
                    throw Validation("scopeId", $"Scope id must contain 1 to {MaximumScopeIdLength} characters.");
                return new StatisticsScope(kind, scopeId);
            }

            private static IQueryable<PlayerStatisticsRow> Scoped(GonesDbContext database, StatisticsScope scope) =>
                database.PlayerStatistics.AsNoTracking()
                    .Where(row => row.ScopeKind == scope.Kind && row.ScopeId == scope.Id);

            private static string? NormalizeSort(string? sort, bool exposeDecayedRating)
            {
                if (sort is null) return null;
                if (sort == "decayedRating" && exposeDecayedRating) return sort;
                if (SortAliases.TryGetValue(sort, out var mapped)) return mapped;
                if (SortAllowlist.Contains(sort)) return sort;
                throw Validation("sort", "Sort column is not valid.");
            }

            private static IQueryable<PlayerStatisticsRow> Filter(IQueryable<PlayerStatisticsRow> query, string? search)
            {
                if (string.IsNullOrWhiteSpace(search)) return query;
                var term = EscapeLikePattern(search.Trim());
                return query.Where(row => EF.Functions.ILike(row.PlayerName, $"%{term}%", "\\"));
            }

            /// <summary>
            /// The ADR 0043 three-bucket default — active ranked by rating, then inactive ranked by rating,
            /// then provisional by how much they have played — or one explicit column. Every tie breaks on the
            /// Player Name collated <c>C</c>, because Player Names are exact and the database collation is not.
            /// </summary>
            private static IQueryable<PlayerStatisticsRow> Order(
                IQueryable<PlayerStatisticsRow> query,
                string? sort,
                bool descending,
                LocalDate today)
            {
                if (sort is null)
                {
                    var cutoff = PlayerRankingRules.InactiveCutoff(today);
                    return query
                        .OrderBy(row => row.TournamentsPlayed < PlayerRankingRules.ProvisionalTournamentThreshold
                            ? PlayerRankingRules.ProvisionalBucket
                            : row.LastPlayedDate == null
                              || string.Compare(EF.Functions.Collate(row.LastPlayedDate, OrdinalCollation), cutoff) <= 0
                                ? PlayerRankingRules.InactiveRankedBucket
                                : PlayerRankingRules.ActiveRankedBucket)
                        .ThenByDescending(row => row.TournamentsPlayed < PlayerRankingRules.ProvisionalTournamentThreshold
                            ? 0d
                            : Math.Floor(row.Rating + 0.5))
                        .ThenByDescending(row => row.TournamentsPlayed < PlayerRankingRules.ProvisionalTournamentThreshold
                            ? row.TournamentsPlayed
                            : 0)
                        .ThenByDescending(row => row.TournamentsPlayed < PlayerRankingRules.ProvisionalTournamentThreshold
                            ? row.PlayedMatchCount
                            : 0)
                        .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));
                }
                return sort switch
                {
                    "name" => descending
                        ? query.OrderByDescending(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation))
                        : query.OrderBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation)),
                    "playedMatchCount" => ByCount(query, row => row.PlayedMatchCount, descending),
                    "matchWins" => ByCount(query, row => row.MatchWins, descending),
                    "matchLosses" => ByCount(query, row => row.MatchLosses, descending),
                    "matchDraws" => ByCount(query, row => row.MatchDraws, descending),
                    "matchWinrate" => ByWinrate(query, row => row.MatchWinrate, row => row.MatchWinrate == null, descending),
                    "playedGameCount" => ByCount(query, row => row.PlayedGameCount, descending),
                    "gameWins" => ByCount(query, row => row.GameWins, descending),
                    "gameLosses" => ByCount(query, row => row.GameLosses, descending),
                    "gameWinrate" => ByWinrate(query, row => row.GameWinrate, row => row.GameWinrate == null, descending),
                    "rating" => ByRating(query, row => Math.Floor(row.Rating + 0.5), descending),
                    "tournamentsPlayed" => ByCount(query, row => row.TournamentsPlayed, descending),
                    "decayedRating" => ByRating(query, row => Math.Floor(row.DecayedRating + 0.5), descending),
                    _ => throw new InvalidOperationException($"Unknown sort: {sort}")
                };
            }

            private static IQueryable<PlayerStatisticsRow> ByCount(
                IQueryable<PlayerStatisticsRow> query,
                Expression<Func<PlayerStatisticsRow, int>> column,
                bool descending) =>
                (descending ? query.OrderByDescending(column) : query.OrderBy(column))
                    .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));

            /// <summary>Provisional players are pinned last in both directions: an unranked rating is not comparable to a ranked one.</summary>
            private static IQueryable<PlayerStatisticsRow> ByRating(
                IQueryable<PlayerStatisticsRow> query,
                Expression<Func<PlayerStatisticsRow, double>> column,
                bool descending)
            {
                var provisionalLast = query.OrderBy(row =>
                    row.TournamentsPlayed < PlayerRankingRules.ProvisionalTournamentThreshold ? 1 : 0);
                return (descending ? provisionalLast.ThenByDescending(column) : provisionalLast.ThenBy(column))
                    .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));
            }

            /// <summary>A null winrate sorts last in both directions, rather than flipping with Postgres' own null placement.</summary>
            private static IQueryable<PlayerStatisticsRow> ByWinrate(
                IQueryable<PlayerStatisticsRow> query,
                Expression<Func<PlayerStatisticsRow, double?>> column,
                Expression<Func<PlayerStatisticsRow, bool>> missing,
                bool descending)
            {
                var nullsLast = query.OrderBy(missing);
                return (descending ? nullsLast.ThenByDescending(column) : nullsLast.ThenBy(column))
                    .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));
            }

            /// <summary>
            /// One stored row on the wire. The rating is rounded here so every surface prints the same integer,
            /// and the delta is the difference of the two rounded numbers so a client can never derive a
            /// previous rating that disagrees with the one it was sent.
            /// </summary>
            private static ArchiveGlobalPlayerStatisticsRow ToRow(int position, PlayerStatisticsRow row, LocalDate today, bool exposeDecayedRating)
            {
                var rating = RoundRating(row.Rating);
                var previousRating = RoundRating(row.PreviousRating);
                return new(
                    position,
                    row.PlayerName,
                    row.PlayedMatchCount,
                    row.MatchWins,
                    row.MatchLosses,
                    row.MatchDraws,
                    row.MatchWinrate,
                    row.PlayedGameCount,
                    row.GameWins,
                    row.GameLosses,
                    row.GameWinrate,
                    row.Nemesis,
                    row.Rival,
                    row.MostPlayedArchetype,
                    rating,
                    row.RatingDeviation,
                    previousRating,
                    rating - previousRating,
                    row.TournamentsPlayed,
                    row.LastPlayedDate,
                    PlayerRankingRules.IsProvisional(row.TournamentsPlayed),
                    PlayerRankingRules.IsInactive(row.LastPlayedDate, row.TournamentsPlayed, today),
                    exposeDecayedRating ? RoundRating(row.DecayedRating) : null);
            }

            private static int RoundRating(double value) => (int)Math.Round(value, MidpointRounding.AwayFromZero);

            /// <summary>When the read model last changed. Every rebuild moves it, inside its own transaction.</summary>
            private static async Task<string> StampAsync(GonesDbContext database, CancellationToken cancellationToken)
            {
                var rebuiltAt = await database.PlayerStatisticsMeta.AsNoTracking()
                    .Select(meta => (Instant?)meta.RebuiltAt)
                    .SingleOrDefaultAsync(cancellationToken);
                return rebuiltAt?.ToUnixTimeTicks().ToString(CultureInfo.InvariantCulture) ?? "unbuilt";
            }

            private static string EscapeLikePattern(string value) =>
                value.Replace("\\", "\\\\", StringComparison.Ordinal)
                    .Replace("%", "\\%", StringComparison.Ordinal)
                    .Replace("_", "\\_", StringComparison.Ordinal);

            private static void SetCache(HttpResponse response, string etag)
            {
                response.Headers.ETag = etag;
                response.Headers.CacheControl = CatalogCacheControl;
            }

            private static bool IsNotModified(HttpRequest request, string etag) =>
                request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

            private static string HashETag(string value) =>
                $"\"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)))}\"";

            private static ApiValidationException Validation(string field, string message) =>
                new(new Dictionary<string, string[]> { [field] = [message] });
        }

        internal sealed record ArchiveGlobalPlayerStatisticsResponse(
            IReadOnlyList<ArchiveGlobalPlayerStatisticsRow> Items,
            int Page,
            int PageSize,
            int TotalCount,
            string? Sort,
            string? Direction);

        internal sealed record ArchiveGlobalPlayerStatisticsCatalogResponse(
            IReadOnlyList<ArchiveGlobalPlayerStatisticsRow> Items,
            int TotalCount,
            bool Truncated);

        internal sealed record ArchiveGlobalPlayerStatisticsRow(
            int Position,
            string PlayerName,
            int PlayedMatchCount,
            int MatchWins,
            int MatchLosses,
            int MatchDraws,
            double? MatchWinrate,
            int PlayedGameCount,
            int GameWins,
            int GameLosses,
            double? GameWinrate,
            OpponentRecord? Nemesis,
            OpponentRecord? Rival,
            PlayerArchetypeUsage? MostPlayedArchetype,
            int Rating,
            double RatingDeviation,
            int PreviousRating,
            int LastRatingDelta,
            int TournamentsPlayed,
            string? LastPlayedDate,
            bool Provisional,
            bool Inactive,
            int? DecayedRating);
        ```
  - [ ] 7.2 In `backend/src/Gones.Api/Program.cs`, add `using Gones.Api.Archive;` beside the existing
        `using Gones.Api.Leagues;` if it is not already there, and add
        `app.MapArchivePlayerStatisticsEndpoints();` immediately after `app.MapPublicLeagueEndpoints();`
        inside the `if (!string.IsNullOrWhiteSpace(connectionString))` block.
  - [ ] 7.3 Run
        `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveScopedStatisticsApiTests"`
        and get it green.

- [ ] 8. Regenerate the API contract artifacts
  - [ ] 8.1 Ensure a Postgres is reachable at the connection `scripts/generate-api.mjs` defaults to
        (`Host=127.0.0.1;Port=5432;Database=gones;Username=gones;Password=gones`) — `npm run db:reset`
        brings the local stack up — then run `npm run api:generate`.
  - [ ] 8.2 Confirm the diff touches exactly `backend/openapi/gones.json` and
        `src/app/api/generated/gones-api.ts`, and that `gones.json` gained
        `"/api/archive/global-player-statistics"` and `"/api/archive/global-player-statistics/all"`.
  - [ ] 8.3 Run `npm run api:check` and confirm it exits `0`.

- [ ] 9. Full green
  - [ ] 9.1 Run `npm run backend:build`.
  - [ ] 9.2 Run `npm run backend:test` and record the total. It must be the pre-change total plus the
        21 tests added here (7 rebuild + 11 API + 2 new unit; the third unit test is an edit of an
        existing one), with zero failures.
  - [ ] 9.3 Run `npm run typecheck`.
  - [ ] 9.4 Run `npm run lint`.
  - [ ] 9.5 Run `npm run test` (Vitest) and confirm it is unaffected.

## Outputs

Files created:

- `backend/src/Gones.Api/Leagues/ArchiveScopeSource.cs`
- `backend/src/Gones.Api/Archive/ArchivePlayerStatisticsEndpoints.cs`
- `backend/src/Gones.Infrastructure/Persistence/Migrations/<timestamp>_ScopePlayerStatistics.cs` (+ its
  `.Designer.cs`)
- `backend/tests/Gones.IntegrationTests/ScopedPlayerStatisticsRebuildTests.cs`
- `backend/tests/Gones.IntegrationTests/ArchiveScopedStatisticsApiTests.cs`

Files modified:

- `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModel.cs`
- `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModelConfigurations.cs`
- `backend/src/Gones.Infrastructure/Persistence/Migrations/GonesDbContextModelSnapshot.cs` (regenerated)
- `backend/src/Gones.Domain/Leagues/PlayerStatisticsFormula.cs`
- `backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs`
- `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs` (global-scope pin only — **no deletion**)
- `backend/src/Gones.Api/Leagues/PlayerEndpoints.cs` (global-scope pin only)
- `backend/src/Gones.Api/Program.cs` (one `Map…` line)
- `backend/tests/Gones.UnitTests/PlayerStatisticsRowTests.cs`
- `scripts/smoke-full-stack.mjs` (one array element)
- `backend/openapi/gones.json`, `src/app/api/generated/gones-api.ts` (both regenerated, never hand-edited)

Public API / behaviour change:

- **New:** `GET /api/archive/global-player-statistics` and `GET /api/archive/global-player-statistics/all`,
  anonymous, ETag + `304`, `Cache-Control: public, max-age=3600`.
- **Changed:** `player_statistics` now holds one row per `(scope_kind, scope_id, player_name)`. The
  legacy `/api/leagues-archive/global-player-statistics[/all]` and `/api/players/{playerName}` read the
  `global` partition and are otherwise byte-identical.
- **Changed:** the startup rebuild runs once on the first boot after this commit, because
  `PlayerStatisticsFormula.Version` moved from `2` to `3`.

Migrate / config:

- One migration, `ScopePlayerStatistics`. No data backfill; the rebuild rewrites everything.
- No new configuration key. `Gones:GlobalStats:MaximumCatalogSize` (default `5000`),
  `Gones:PlayerStatistics:RebuildOnStartup` (default `true`) and
  `Gones:PlayerStatistics:ExposeDecayedRating` (default `false`) all keep their current meaning and now
  apply to the scoped routes too.

## Validation

- [ ] tests pass:
  - `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~PlayerStatisticsRowTests"` → exit `0`
  - `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ScopedPlayerStatisticsRebuildTests"` → exit `0`, 7 passed
  - `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~ArchiveScopedStatisticsApiTests"` → exit `0`, 11 passed
  - `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~MigrationSafetyTests"` → exit `0`
  - `npm run backend:test` → exit `0`, `Failed: 0`, total = previous total + 21
  - `npm run test` → exit `0`
  - `npm run typecheck` → exit `0`
  - `npm run lint` → exit `0`
- [ ] `npm run backend:build` → exit `0`, `0 Error(s)`
- [ ] `npm run api:check` → exit `0` (no diff against the regenerated snapshot and client)
- [ ] schema check — against a database migrated to head:
  ```bash
  psql -c "\d player_statistics" | grep -E "scope_kind|scope_id|pk_player_statistics"
  ```
  expected: `scope_kind | text | not null`, `scope_id | text | not null`, and
  `"pk_player_statistics" PRIMARY KEY, btree (scope_kind, scope_id, player_name)`
- [ ] scope invariant check — after a rebuild over seeded three-tier data:
  ```bash
  psql -Atc "SELECT count(*) FROM player_statistics WHERE (scope_kind = 'global') <> (scope_id = '')"
  ```
  expected: `0`
- [ ] manual check (no UI in this slice — API only), against a running stack seeded with at least one
  League holding two Seasons plus one standalone Tournament:
  ```bash
  curl -s "http://127.0.0.1:8080/api/archive/global-player-statistics?scopeKind=global" | jq '.totalCount'
  curl -s "http://127.0.0.1:8080/api/archive/global-player-statistics?scopeKind=league&scopeId=<leagueId>" | jq '.items[0]'
  curl -s "http://127.0.0.1:8080/api/archive/global-player-statistics?scopeKind=season&scopeId=<seasonId>" | jq '.items[0]'
  curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:8080/api/archive/global-player-statistics?scopeKind=season&scopeId=no-such-season"
  curl -sI "http://127.0.0.1:8080/api/archive/global-player-statistics" | grep -i -E 'etag|cache-control'
  ```
  expected: the League `rating`/`playedMatchCount`/`tournamentsPlayed` are **smaller than or different
  from** the global ones for the same player; the unknown season returns `200`; the headers show an
  `ETag` and `Cache-Control: public, max-age=3600`; the standalone Tournament's players appear in the
  global body and in no League or Season body.
- [ ] app functional — no broken path from this slice: `/api/leagues-archive/global-player-statistics`
  and `/api/players/{playerName}` still answer `200` with the same numbers they did before the commit
  (they now read the `global` partition), and the app boots with the startup rebuild logging
  `Player statistics rebuilt: N rows across M scopes`.
- [ ] commit msg draft: `feat(archive): key player statistics by scope so rankings can be read per League and Season`
