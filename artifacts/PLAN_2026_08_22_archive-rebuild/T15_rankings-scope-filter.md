# T15: Global Rankings scope filter

> ## ⚠ ARBITRATION OVERRIDE — read before the body; these win over anything below
>
> **A. Use T12's real repository method names.** The body calls
> `ArchiveRepository.loadLeagues()` and `.loadLeagueSeasons()` to populate the two scope selects.
> Those do not exist — they were a guess made while T12 was being written in parallel, and three
> tickets each guessed a different set. T12 owns the file and shipped:
>
> ```ts
> listLeagues(options?)            // NOT loadLeagues
> listLeagueSeasons(options?)      // NOT loadLeagueSeasons
> listYears(options?)
> listTournaments(options?: { force?: boolean; year?: number })
> listSeasonTournaments(season)
> invalidateArchiveCaches(): Promise<void>
> ```
>
> Substitute at both call sites. The body's "two-call-site adaptation rule" is exactly right — this
> just settles which names it adapts to, so no adaptation is needed.
>
> **B. Your `dir` rename is confirmed and is now repo-wide.** The body renames the URL param from
> `direction` to `dir` and fixes `cypress/e2e/global-stats.cy.js:76-78`. That stands: archive tabs and
> rankings now agree on `dir`. The **wire** parameter sent to the API stays `direction`. This is a
> user-visible URL change to a shipped page, accepted because Gones has no users.
>
> **C. Rankings paging default stays `pageSize=100`**, unlike the archive tabs which default to 25.
> Two surfaces, two defaults, both deliberate — 100 is the existing shipped behaviour.
>
> **D. Wire error codes are snake_case** — `validation_failed` for a bad `scopeKind`, not
> `invalidRequest`. An unknown `scopeId` is **not** an error: it returns `200` with an empty page.

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T8, T13
**Commit outcome:** League and Season selects drive scoped ratings and the scope badge states which scope produced them.

## Context (self-contained)

- Goal: the Archive is being rebuilt on three tiers — **League → LeagueSeason → Tournament** — where a
  Tournament is a first-class top-level record that may stand alone (`seasonId: null`). Global Rankings
  gains a scope filter backed by **stored per-scope Glicko-2 ratings**, so
  `/global-stats?league=<id>&season=<id>` serves numbers read from the `player_statistics` table and
  never replayed on demand.
- This slice: the **whole frontend half** of that scope filter, and nothing else. Two selects, a scope
  badge, the query-string state that carries the scope, and the request that asks the server for that
  scope. The server side already exists on `main` when this ticket starts: `player_statistics` is keyed
  by `(scope_kind, scope_id, player_name)` and `GET /api/archive/global-player-statistics` serves a
  chosen scope. Nothing renders it yet — that is what this ticket adds.
- Out of scope here — do **not** touch:
  - **No backend work at all.** No C# file, no migration, no endpoint, no `backend/openapi/gones.json`.
    The endpoint, its scoping, its ordering and its paging are finished and are consumed as-is.
  - **No archive table work.** `src/app/features/archive/**` — the shell, the League Seasons tab, the
    Tournaments tab, the Season expansion — belongs to other tickets. Do not edit those files, do not
    add a tab, do not touch `src/app/app.routes.ts`.
  - **Do not regenerate the API client.** `src/app/api/generated/gones-api.ts` is generated, already
    carries the scoped operations, and is never hand-edited. If it does not carry them, stop — see
    Impl step 0.
  - **Do not delete legacy code.** `src/app/features/players/global-stats-catalog-cache.service.ts`
    keeps existing and keeps working: `src/app/features/leagues-archive/league-archive-detail.component.ts:87`
    still injects it. This ticket only stops `GlobalStatsComponent` from using it. The legacy surface is
    retired by a later ticket, not this one.
  - No i18n key outside the `globalStats.` namespace. No change to `src/styles.css`.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** That is why the
    `direction=` query parameter of `/global-stats` is renamed to `dir=` with no alias and no redirect:
    no bookmark exists to break.
  - **Expand → migrate → contract.** `/api/archive/**` was added beside `/api/leagues-archive/**`.
    Both serve. This page moves to the new one; the legacy league detail page stays on the old one.
    Every commit compiles and runs.
  - **Single-select at both levels — All, or exactly one League, or exactly one Season.** Deliberate:
    every selectable scope has a *stored* Glicko-2 rating, so there is never an on-demand replay and
    never a combinatorial subset. A multi-select would ask for a rating nobody computed.
  - **A standalone Tournament (`seasonId: null`) feeds the `global` scope only.** It belongs to no
    League and no Season, so a player whose only results are standalone appears under *All* and in no
    league or season scope. The empty-scope copy is written for exactly that case.
  - **The rankings page size default stays `100`**, unlike the archive table tabs which default to
    `25`. Two different surfaces, two different defaults, both deliberate.
  - `vitest` is the frontend test runner and `src/app/features/players/global-stats.component.test.ts`
    **mocks `effect()` to a no-op** at its top (`vi.mock('@angular/core', …)`). Therefore the fetch
    trigger in the component **must not be an `effect()`** — it stays inside the
    `route.queryParamMap.subscribe()` callback, which is what the component does today.

## Requirements

1. `/global-stats` accepts and emits the query-string state
   `?league=<id|all>&season=<id|all>&sort=&dir=&page=&size=&search=`. `league` and `season` both default
   to `all`. The sort direction parameter is named **`dir`**, not `direction`.
2. A **League** `<select>` offers *All leagues* plus one option per archived League. A **Season**
   `<select>` offers *All seasons* plus one option per archived LeagueSeason, **narrowed to the chosen
   League's Seasons** while a League is chosen.
3. Choosing a League that does not own the currently chosen Season resets the Season to `all`. Choosing
   a Season pins its owning League, so the two selects and the badge always agree.
4. The page requests `GET /api/archive/global-player-statistics` with
   `scopeKind` ∈ `global | league | season` and, for the latter two, `scopeId`. `season` wins over
   `league`: a chosen Season is the narrower scope, so it is the one requested.
5. A **visible scope badge** names the active scope on screen — `Rating scope: <name>` — so a scoped
   rating is never mistaken for the global one. When nothing is chosen it reads the global label, it
   never renders blank, and it falls back to the raw id while the catalog that holds the name has not
   landed.
6. **Positions renumber `1..n` inside the scope.** The server assigns `position` per scope and per page;
   the client renders that number and computes none of its own.
7. **Matches, tournaments and winrate are recomputed WITHIN the scope** — they are a player's record in
   that season, **not** their global numbers filtered down. The page renders exactly what the scoped
   response returned. A test asserts this by serving two different bodies for two scopes and checking
   the rendered numbers change with the scope.
8. `pageSize` defaults to `100` and the offered sizes stay `10 | 25 | 50 | 100`.
9. Empty scope reads sensibly: when a league or season scope is empty and no search is active, the table
   says *no player has a rating in this scope yet* and adds that standalone tournaments count towards
   the global ranking only. The generic *no players found* copy stays for an empty search result.
10. Every new string exists in **both** `catalogs.en` and `catalogs.fr` of `src/app/i18n/messages.ts`.
    `src/app/i18n/message-namespace.test.ts:17` asserts the two key sets are identical.
11. Styling uses only tokens already declared in `src/styles.css`. No hardcoded colour, no new token.
12. `npm run test`, `npm run typecheck`, `npm run lint` and `npm run build` are green, and
    `npx cypress run --spec cypress/e2e/global-stats.cy.js` passes against the rebuilt stack.

## Inputs

Read these before writing code. Paths and line refs are current as of this ticket.

- `src/app/features/players/global-stats.component.ts` — the component being changed. Note, in the
  on-disk file (it has uncommitted working-tree modifications, so read the file, not `git show`):
  - `:223-226` `inject(GlobalStatsCatalogCacheService)`, `inject(ActivatedRoute)`, `inject(Router)`,
    `inject(I18nService)`.
  - `:230-236` the `loading` / `error` / `stale` / `truncated` / `syncedAt` signals.
  - `:238` `readonly allRows = signal<GlobalPlayerStatisticsRow[]>([]);`
  - `:240-241` `showDecayedRating` / `visibleColumnCount` (`12` when the decayed column shows, `11`
    otherwise).
  - `:243-245` `currentPage`, `currentSize` (initial `100`), `routeParams`.
  - `:253-256` `currentSort`, a `computed` that re-parses the URL through the decayed-rating gate.
  - `:257-258` `currentDirection`, `searchDraft`.
  - `:260-275` `filteredRows` / `sortedRows` / `pagedRows` / `totalCount` / `totalPages` / `pageWindow` —
    the client-side filter, sort and slice this ticket replaces with the server's own.
  - `:279-290` the constructor: `this.route.queryParamMap.subscribe(...)` then `void this.loadCatalog()`.
  - `:296-313` `loadCatalog`, `onSync`.
  - `:315-329` `setSearchDraft` with `SEARCH_DEBOUNCE_MS = 300` (`:29`).
  - `:335-360` `sortBy`, `ariaSort`, `goPage`, `setSize` — four copies of the same
    "rebuild the query from signals then navigate" block.
  - `:362-376` `formatDelta`, `formatPct`, `formatOpponent`, `formatArchetype`.
  - Template: heading row + `<gones-sync-bar>` (`:36-44`), `.global-stats-controls` search + page size
    (`:46-72`), loading / error / truncated blocks (`:74-82`), status bar (`:85-87`), the
    `.ranking-table` (`:93-160`), the `#paginationNav` template (`:167-192`).
- `src/app/features/players/global-stats-query.ts` — the pure helpers. `GLOBAL_STATS_PAGE_SIZES`,
  `GLOBAL_STATS_SORTABLE_COLS`, `GLOBAL_STATS_GATED_SORT_COLS`, `GlobalStatsSortGate`,
  `GlobalStatsQuery`, `parseGlobalStatsQuery`, `toggleGlobalStatsSort`, `globalStatsPageWindow`,
  `sortGlobalStatsRows`, `globalStatsQueryParams`. Also has uncommitted modifications — read the file.
- `src/app/features/players/global-stats.component.test.ts` (637 lines) and
  `src/app/features/players/global-stats-query.test.ts` (406 lines) — the two test files this ticket
  extends. The component test does **source-string assertions** (`readFileSync` of the component at
  `:21`) as well as behavioural ones, and mocks `effect()` away at `:7-10`.
- `src/app/i18n/messages.ts` — EN `globalStats.*` block at `:180-209`, FR block at `:1427-1456`.
- `src/app/i18n/message-namespace.test.ts:17` — `expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())`.
- `src/styles.css:7-16` — the only colour tokens that may be used here:
  `--iron`, `--raised-iron`, `--soot`, `--ash`, `--dim-ash`, `--steel`, `--blood`, `--hot-blood`,
  `--create-green`, `--create-green-hot`. `:82` declares the shared `.error, .warning` block.
- `artifacts/GRILL_2026_08_22_archive-tournaments/PROTOTYPE_archive_tables.html`, tab
  **Global Rankings · scoped** (`:271-308`) — the agreed design, not one option among several:
  a bordered scope bar holding *League*, *Season* and the badge `◆ Rating scope: Ligue Lyon 2026`;
  a status line reading `Page 1 of 1 · 18 ranked players in this scope`; and the closing note
  *"Matches, tournaments and winrate are recomputed inside the scope — these are not the player's global
  numbers filtered down."* Its CSS at `:129-131` is the source of the two rules copied into the
  component's `styles` block below.
- `cypress/e2e/global-stats.cy.js` (80 lines) — mocks `**/api/leagues-archive/global-player-statistics/all`
  at `:37-43` and asserts `direction=desc` in the URL at `:76-78`. Both are rewritten here.
- `src/app/features/players/player-detail-cache.service.test.ts:36-40` — the repo idiom for faking the
  generated client in a unit test: `{ provide: Client, useValue: { getPlayer } }`.

### From Depends

**From T8 — already merged, consumed verbatim, do not redesign:**

`player_statistics` is keyed by `(scope_kind, scope_id, player_name)` with
`scope_kind IN ('global','league','season')` and `scope_id = ''` exactly when `scope_kind = 'global'`.
The rebuild writes **one row per (scope, player)**: the global scope, one scope per League, one scope
per LeagueSeason. **Rating, matches, wins, losses, draws, winrate, games, tournaments played, last
played date, Nemesis, Rival and most-played archetype are all recomputed within each scope** — a
player's `league` row is the Glicko-2 replay over that League's Tournaments only, from the published
seed 1500 / 350 / 0.06. **A standalone Tournament (`season_id IS NULL`) feeds the `global` scope only.**

Route, registered as `.WithName("GetArchiveGlobalPlayerStatistics")`:

```
GET /api/archive/global-player-statistics
      ?scopeKind=global|league|season   (optional, default "global")
      &scopeId=<string, 1..200 chars>   (required when scopeKind is league|season; ignored when global)
      &page=<int >= 1>                  (optional, default 1)
      &pageSize=10|25|50|100            (optional, default 100)
      &sort=<allowlist below>           (optional, default = the three-bucket ranking order)
      &direction=asc|desc               (optional, default desc)
      &search=<substring, <= 200 chars> (optional)
  200 application/json  ArchiveGlobalPlayerStatisticsResponse
  304                   (If-None-Match matches)
  400 application/problem+json  code "validation_failed"
Response headers: ETag, Cache-Control: public, max-age=60
```

`sort` allowlist: `rating`, `name`, `matches`, `wins`, `losses`, `winrate`, `tournaments`,
`playedMatchCount`, `matchWins`, `matchLosses`, `matchDraws`, `matchWinrate`, `playedGameCount`,
`gameWins`, `gameLosses`, `gameWinrate`, `tournamentsPlayed`, plus `decayedRating` **only** when
`Gones:PlayerStatistics:ExposeDecayedRating` is on. Anything else → `400`.

**A `scopeId` with no rows returns `200` with an empty page — never `404`.** `position` is
`offset + index + 1` **within the requested scope**, so positions renumber `1..n` per scope with no
client arithmetic. The catalog twin `GET /api/archive/global-player-statistics/all?scopeKind=&scopeId=`
also exists; **this ticket does not use it** — see *Interface contract → Decisions taken inside this
ticket*, D1.

Wire shape, camelCase, field names identical to the legacy endpoint:

```
ArchiveGlobalPlayerStatisticsResponse: items, page, pageSize, totalCount, sort, direction
ArchiveGlobalPlayerStatisticsRow:      position, playerName, playedMatchCount, matchWins, matchLosses,
                                       matchDraws, matchWinrate, playedGameCount, gameWins, gameLosses,
                                       gameWinrate, nemesis, rival, mostPlayedArchetype, rating,
                                       ratingDeviation, previousRating, lastRatingDelta,
                                       tournamentsPlayed, lastPlayedDate, provisional, inactive,
                                       decayedRating
```

`nemesis` and `rival` are `OpponentRecord | undefined`; `mostPlayedArchetype` is
`PlayerArchetypeUsage | undefined`. Both types are already exported from
`src/app/api/generated/gones-api.ts`.

**From T13 — already merged, consumed verbatim:**

`src/app/data/archive-repository.service.ts` exports the injectable `ArchiveRepository`, the single
funnel for archive reads and the owner of `invalidateArchiveCaches()`. It serves the two public
catalogs out of the `gones-archive-cache` IndexedDB database, over the routes
`GET /api/archive/leagues/all` and `GET /api/archive/league-seasons/all`, whose bodies are
`ArchiveCatalogResponse<T>` = `{ items, totalCount, truncated }` ordered `updatedAt DESC, id ASC`, with
item shapes:

```ts
interface ArchiveLeagueSummary { id: string; name: string; createdAt: string; updatedAt: string; documentVersion: number; }
interface ArchiveLeagueSeasonSummary {
  id: string; name: string; leagueId: string; status: 'active' | 'completed';
  updatedAt: string; documentVersion: number; tournamentCount: number; playerCount: number;
  firstTournamentDate: string | null; lastTournamentDate: string | null;
}
```

The generated client methods behind them are `getArchiveLeagueCatalog()` and
`getArchiveLeagueSeasonCatalog()`.

## Interface contract (level 5)

### Produces — `src/app/features/players/global-stats-query.ts`

```ts
/** The sentinel both scope levels use for "not narrowed". Never a document id. */
export const GLOBAL_STATS_SCOPE_ALL = 'all';

export type GlobalStatsScopeKind = 'global' | 'league' | 'season';

export interface GlobalStatsScopeSelection {
  kind: GlobalStatsScopeKind;
  /** `''` exactly when `kind === 'global'`; otherwise the League or LeagueSeason document id. */
  id: string;
}

export interface GlobalStatsQuery {
  page: number;
  size: GlobalStatsPageSize;
  search: string;
  sort?: GlobalStatsSortCol;
  direction?: 'asc' | 'desc';
  /** `'all'` or a League document id. */
  league: string;
  /** `'all'` or a LeagueSeason document id. */
  season: string;
}

/** Minimal shapes these helpers need, so they stay usable from a test without a wire type. */
export interface GlobalStatsLeagueOption { id: string; name: string; }
export interface GlobalStatsSeasonOption { id: string; name: string; leagueId: string; }

/**
 * The one scope the rankings are asked for. A Season is narrower than its League, so a chosen Season
 * wins; both `'all'` is the global scope, whose id is the empty string.
 */
export function resolveGlobalStatsScope(query: Pick<GlobalStatsQuery, 'league' | 'season'>): GlobalStatsScopeSelection;

/** The Seasons the Season select offers: every Season while the League is `'all'`, that League's otherwise. */
export function scopeSeasonOptions<T extends { leagueId: string }>(seasons: readonly T[], league: string): T[];

/** Choosing a League drops a Season it does not own, and always returns to page 1. */
export function selectScopeLeague(
  query: GlobalStatsQuery,
  league: string,
  seasons: readonly GlobalStatsSeasonOption[]
): GlobalStatsQuery;

/** Choosing a Season pins its owning League too, so the selects and the badge can never disagree. */
export function selectScopeSeason(
  query: GlobalStatsQuery,
  season: string,
  seasons: readonly GlobalStatsSeasonOption[]
): GlobalStatsQuery;

/**
 * The human name of the active scope, or `undefined` while the catalog holding it has not landed or
 * the id is unknown. The global scope has no name here — the caller labels it.
 */
export function globalStatsScopeName(
  scope: GlobalStatsScopeSelection,
  catalogs: { leagues: readonly GlobalStatsLeagueOption[]; seasons: readonly GlobalStatsSeasonOption[] }
): string | undefined;
```

Changed signatures — same names, same call sites, new behaviour:

```ts
/** Now also reads `league`, `season`, and the direction from `dir` (never from `direction`). */
export function parseGlobalStatsQuery(
  params: { get(key: string): string | null },
  gate: GlobalStatsSortGate = {}
): GlobalStatsQuery;

/** Now also writes `league` / `season` when narrowed, and writes the direction under the key `dir`. */
export function globalStatsQueryParams(query: GlobalStatsQuery): Params;
```

Parse rules, binding:

| Key | Accepted | Result |
| --- | --- | --- |
| `league` | any non-empty trimmed string | that string; missing, empty or whitespace → `'all'` |
| `season` | any non-empty trimmed string | that string; missing, empty or whitespace → `'all'` |
| `dir` | `asc` \| `desc` | that value; anything else, including a legacy `direction=` → `undefined` |
| `page` | integer ≥ 1 | that value, else `1` |
| `size` | `10` \| `25` \| `50` \| `100` | that value, else **`100`** |
| `sort` | a `GLOBAL_STATS_SORTABLE_COLS` member, `decayedRating` only when `gate.decayedRating` | that value, else `undefined` |
| `search` | any string | trimmed |

Serialise rules, binding — a default is omitted so the URL stays clean:
`league` when `!== 'all'` · `season` when `!== 'all'` · `page` when `!== 1` · `size` when `!== 100` ·
`search` when non-empty · `sort` when set · **`dir`** when `direction` is set. The key `direction` is
never written.

`toggleGlobalStatsSort` is unchanged and keeps carrying `league` / `season` through its spread.
`sortGlobalStatsRows`, `globalStatsPageWindow`, `GLOBAL_STATS_PAGE_SIZES`,
`GLOBAL_STATS_SORTABLE_COLS`, `GLOBAL_STATS_GATED_SORT_COLS` are unchanged and stay exported.
`sortGlobalStatsRows` loses its only production caller here but keeps its tests: the browser-local
archive still needs a client-side ranking order, and deleting it is another ticket's business.

### Produces — `src/app/features/players/global-stats.component.ts`

```ts
export class GlobalStatsComponent implements OnDestroy {
  // injected
  private readonly client: Client;                 // generated API client
  private readonly archive: ArchiveRepository;     // League + Season catalogs
  private readonly route: ActivatedRoute;
  private readonly router: Router;
  readonly i18n: I18nService;

  // state
  readonly loading: WritableSignal<boolean>;
  readonly error: WritableSignal<string>;
  readonly stale: WritableSignal<boolean>;
  readonly scopeError: WritableSignal<string>;
  readonly syncedAt: WritableSignal<string | undefined>;
  readonly rows: WritableSignal<ArchiveGlobalPlayerStatisticsRow[]>;
  readonly totalCount: WritableSignal<number>;
  readonly leagues: WritableSignal<ArchiveLeagueSummary[]>;
  readonly seasons: WritableSignal<ArchiveLeagueSeasonSummary[]>;
  readonly currentPage: WritableSignal<number>;
  readonly currentSize: WritableSignal<GlobalStatsPageSize>;
  readonly currentDirection: WritableSignal<'asc' | 'desc' | undefined>;
  readonly currentLeague: WritableSignal<string>;   // 'all' | League id
  readonly currentSeason: WritableSignal<string>;   // 'all' | Season id
  readonly searchDraft: WritableSignal<string>;     // what the input holds
  readonly committedSearch: WritableSignal<string>; // what the URL holds, and what is requested

  // derived
  readonly currentSort: Signal<GlobalStatsSortCol | undefined>;
  readonly scope: Signal<GlobalStatsScopeSelection>;
  readonly scopeLabel: Signal<string>;
  readonly seasonOptions: Signal<ArchiveLeagueSeasonSummary[]>;
  readonly pagedRows: Signal<ArchiveGlobalPlayerStatisticsRow[]>;   // === rows(); the server numbered them
  readonly totalPages: Signal<number>;
  readonly pageWindow: Signal<(number | 'gap')[]>;
  readonly showDecayedRating: Signal<boolean>;
  readonly visibleColumnCount: Signal<number>;
  readonly pageStatus: Signal<string>;
  readonly emptyMessage: Signal<string>;
  readonly scopeAll: string;                        // = GLOBAL_STATS_SCOPE_ALL, for the template

  // commands
  setLeague(league: string): void;
  setSeason(season: string): void;
  setSearchDraft(value: string): void;
  clearSearch(): void;
  sortBy(col: GlobalStatsSortCol): void;
  ariaSort(col: GlobalStatsSortCol): 'ascending' | 'descending' | null;
  goPage(page: number): void;
  setSize(size: GlobalStatsPageSize): void;
  onSync(): void;

  // helpers, unchanged
  formatDelta(value: number | null | undefined): string;
  formatPct(value: number | null | undefined): string;
  formatOpponent(value: OpponentRecord | null | undefined): string;
  formatArchetype(value: PlayerArchetypeUsage | null | undefined): string;
}
```

Removed from the component: `truncated`, `allRows`, `filteredRows`, `sortedRows`, and the injection of
`GlobalStatsCatalogCacheService`. `allRows` is replaced by `rows`, which now holds **one page**, not the
whole catalog — the old name would be a lie.

Request mapping, binding:

```ts
this.client.getArchiveGlobalPlayerStatistics(
  scope.kind,                                        // 'global' | 'league' | 'season'
  scope.kind === 'global' ? undefined : scope.id,    // scopeId
  this.currentPage(),                                // page
  this.currentSize(),                                // pageSize
  this.committedSearch() || undefined,               // search
  this.currentSort(),                                // sort
  this.currentDirection(),                           // direction  ← the wire keeps the long name
)
```

New `data-cy` hooks, binding — Cypress and the source-string tests key on these:

| `data-cy` | Element |
| --- | --- |
| `global-stats-scope` | the scope bar container |
| `global-stats-league-field` | the League `mat-form-field` |
| `global-stats-league-select` | the League `mat-select` |
| `global-stats-league-option-all` | the *All leagues* option |
| `global-stats-league-option-<leagueId>` | one League option |
| `global-stats-season-field` | the Season `mat-form-field` |
| `global-stats-season-select` | the Season `mat-select` |
| `global-stats-season-option-all` | the *All seasons* option |
| `global-stats-season-option-<seasonId>` | one Season option |
| `global-stats-scope-badge` | the badge naming the active scope |
| `global-stats-scope-error` | the League/Season catalog failure notice |
| `global-stats-scope-note` | the "recomputed inside the scope" note, scoped views only |
| `global-stats-empty-standalone-hint` | the standalone-tournament hint in an empty scope |

Existing hooks keep their names and their meaning: `global-stats-table`, `global-stats-no-results`,
`global-stats-count-status`, `global-stats-page-status`, `global-stats-page-size-select`,
`global-stats-search-input`, `global-stats-col-*`, `global-stats-cell-*`, `global-stats-row-*`,
`global-stats-loading`, `global-stats-error`, `global-stats-sync-bar`.
`global-stats-truncated` is removed with the signal that fed it.

### Produces — i18n keys (both catalogs, identical key sets)

| Key | `en` | `fr` |
| --- | --- | --- |
| `globalStats.scopeLeagueLabel` | `League` | `Ligue` |
| `globalStats.scopeSeasonLabel` | `Season` | `Saison` |
| `globalStats.scopeAllLeagues` | `All leagues` | `Toutes les ligues` |
| `globalStats.scopeAllSeasons` | `All seasons` | `Toutes les saisons` |
| `globalStats.scopeGlobalName` | `All tournaments` | `Tous les tournois` |
| `globalStats.scopeBadge` | `Rating scope: {scope}` | `Portée du classement : {scope}` |
| `globalStats.scopeBadgeAria` | `Rating scope` | `Portée du classement` |
| `globalStats.scopeNote` | `Matches, tournaments and winrate are each player's record inside this scope, not their global numbers filtered down.` | `Matchs, tournois et pourcentage de victoires sont le bilan de chaque joueur dans cette portée, et non ses chiffres globaux filtrés.` |
| `globalStats.scopeLoadFailed` | `Could not load the League and Season filters.` | `Impossible de charger les filtres Ligue et Saison.` |
| `globalStats.noResultsScope` | `No player has a rating in this scope yet.` | `Aucun joueur n'a encore de classement dans cette portée.` |
| `globalStats.standaloneHint` | `Standalone tournaments count towards the global ranking only.` | `Les tournois indépendants comptent uniquement pour le classement global.` |
| `globalStats.pageStatusScope` | `Page {page} of {total} ({count} players in this scope)` | `Page {page} sur {total} ({count} joueurs dans cette portée)` |

`globalStats.truncatedWarning` stays in both catalogs, unused by this component, so the key sets stay
symmetric and no unrelated surface breaks. Every other `globalStats.*` key keeps its current value.

### Consumes

```ts
// src/app/api/generated/gones-api.ts — generated, do not edit
getArchiveGlobalPlayerStatistics(
  scopeKind: string | undefined, scopeId: string | undefined,
  page: number | undefined, pageSize: number | undefined,
  search: string | undefined, sort: string | undefined, direction: string | undefined
): Observable<ArchiveGlobalPlayerStatisticsResponse>;

export interface ArchiveGlobalPlayerStatisticsResponse {
  items: ArchiveGlobalPlayerStatisticsRow[];
  page: number; pageSize: number; totalCount: number;
  sort?: string | undefined; direction?: string | undefined;
}
```

```ts
// src/app/data/archive-repository.service.ts — created by an earlier ticket, consumed here
@Injectable({ providedIn: 'root' })
export class ArchiveRepository {
  loadLeagues(options?: { force?: boolean }): Promise<{ items: ArchiveLeagueSummary[]; fetchedAt: string; stale: boolean; truncated: boolean }>;
  loadLeagueSeasons(options?: { force?: boolean }): Promise<{ items: ArchiveLeagueSeasonSummary[]; fetchedAt: string; stale: boolean; truncated: boolean }>;
}
```

**Adaptation rule, binding — do not guess, do not stub.** Open
`src/app/data/archive-repository.service.ts` before writing the component. If it exposes the two reads
under different names, call the ones it exposes: what matters is a `Promise` resolving to an object with
an `items` array of `ArchiveLeagueSummary` / `ArchiveLeagueSeasonSummary`. If it exposes neither, call
the generated client directly instead —
`firstValueFrom(this.client.getArchiveLeagueCatalog())` and
`firstValueFrom(this.client.getArchiveLeagueSeasonCatalog())`, both returning
`{ items, totalCount, truncated }` — and say so in the commit body. Change **only** the two call sites
inside `loadScopeCatalogs()`; nothing else in this ticket depends on the shape.

### Decisions taken inside this ticket

- **D1 — the page moves to the *paged* endpoint, not the catalog twin.** The fence names
  `GET /api/archive/global-player-statistics`, whose `page` / `pageSize` / `sort` / `direction` /
  `search` parameters map one-to-one onto the mandated query-string state, and whose `position` is
  already numbered per scope. Two further reasons: caching one 5000-row catalog *per scope* in
  `localStorage` would multiply the very storage this plan is moving out of `localStorage`, and the
  rankings routes are served `Cache-Control: public, max-age=60` precisely so an edit is not hidden
  behind a long-lived client copy. Consequence: filtering, sorting and paging become server round
  trips; the client-side `filteredRows` / `sortedRows` / slice disappear; the `truncated` warning
  disappears with the catalog cap that produced it.
- **D2 — `direction=` becomes `dir=` in the browser URL only.** The contract pins
  `?league=&season=&sort=&dir=&page=&size=&search=`. The **wire** parameter stays `direction` — that is
  the server's name and this ticket does not touch the server. So the component parses `dir` from the
  URL and sends `direction` to the API. With no users there is no alias and no redirect; a stale
  `?direction=desc` link simply falls back to the default order.
- **D3 — a Season pins its League.** Selecting a Season while the League select reads *All* sets the
  League to that Season's `leagueId`. Without it the badge would name a Season while the League select
  claimed *All leagues*, which is exactly the ambiguity the badge exists to remove.
- **D4 — last request wins.** Every fetch takes a monotonic token and a response whose token is no
  longer current is dropped. A slow global response landing after a fast season response would
  otherwise paint global numbers under a season badge — the precise mistake requirement 5 forbids.

### Errors

| Failure | Component state | Rendered |
| --- | --- | --- |
| rankings request rejects, `rows()` empty | `error = i18n.t('globalStats.errorLoad')`, `rows = []`, `stale = false` | `[data-cy="global-stats-error"]`, `role="alert"` |
| rankings request rejects, `rows()` non-empty | `stale = true`, `error = ''`, rows kept | the `<gones-sync-bar>` offline banner; the previous page stays on screen |
| League/Season catalog request rejects | `scopeError = i18n.t('globalStats.scopeLoadFailed')`, `leagues = []`, `seasons = []` | `[data-cy="global-stats-scope-error"]`, `role="status"`; both selects still offer *All*, the table still loads |
| scope has no rows (`200`, `totalCount: 0`), no search | `rows = []`, `totalCount = 0`, `error = ''` | `globalStats.noResultsScope` + `globalStats.standaloneHint` when the scope is not global; `globalStats.noResults` when it is |
| scope has no rows, search active | as above | `globalStats.noResults` only |
| `400 validation_failed` from a hand-typed bad `scopeId` | treated as any rejection: `error` set | `[data-cy="global-stats-error"]` |

The component never inspects the problem body; HTTP status is not classified here. A `400` and a
network failure render the same message, which is correct for a read-only public page.

### Invariants

1. `resolveGlobalStatsScope` is total: `('all','all') → {kind:'global', id:''}`; `(L,'all') → {kind:'league', id:L}`;
   `(*, S) → {kind:'season', id:S}` for any `S !== 'all'`. `id === ''` **iff** `kind === 'global'`.
2. `scopeId` is sent **only** when `kind !== 'global'`. The global scope sends `undefined`, never `''`.
3. Exactly one rankings request per query-string emission. No request is issued from a `@if`, a getter
   or an `effect()`.
4. `pagedRows()` is reference-equal to `rows()`; no client-side slice, sort or filter runs on the
   rankings rows. Rendered `position` values come from the response, unmodified.
5. `currentSize()` is one of `10 | 25 | 50 | 100`, default `100`, and is the `pageSize` sent.
6. `totalPages() === Math.max(1, Math.ceil(totalCount() / currentSize()))`.
7. `searchDraft()` drives the input; `committedSearch()` drives the request. They differ only inside the
   300 ms debounce window.
8. Changing League, Season, page size, sort or search resets `page` to `1`. Changing the page alone
   does not.
9. `seasonOptions()` ⊆ `seasons()`, and equals it exactly when `currentLeague() === 'all'`.
10. `scopeLabel()` is never the empty string: it is the resolved name, else the raw scope id, else the
    global label.
11. `globalStatsQueryParams` never emits a `direction` key and never emits `league` or `season` equal to
    `'all'`.
12. Responses are applied in issue order: a response is discarded unless its token is the newest issued.

## TDD

1. **Red** — write the failing tests first, in this order, and run them:
   - `src/app/features/players/global-stats-query.test.ts` — the 18 pure-helper tests named in the test
     plan. They fail to compile first (`resolveGlobalStatsScope` and friends do not exist), which counts
     as red.
   - `src/app/features/players/global-stats.component.test.ts` — the component tests named in the test
     plan, against the rewritten `buildComponent` harness.
   Command: `npx vitest run src/app/features/players/global-stats-query.test.ts src/app/features/players/global-stats.component.test.ts`
   Expect: failures naming the missing exports and the missing `data-cy` hooks. **Do not proceed while
   this command passes.**
2. **Green** — implement in this order: the query helpers, then the i18n keys, then the component class,
   then the template and styles. Re-run the same command until green.
3. **Refactor** — collapse the four duplicated "rebuild the query from signals then navigate" blocks in
   `sortBy` / `goPage` / `setSize` / `setSearchDraft` into the single `private query(): GlobalStatsQuery`
   helper and a single `private navigate(query: GlobalStatsQuery): void`. Keep the suite green.

## Test plan

### `src/app/features/players/global-stats-query.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `parseGlobalStatsQuery reads league and season` | `new URLSearchParams('league=L1&season=S1')` | `league === 'L1'`, `season === 'S1'` |
| `parseGlobalStatsQuery defaults both scope levels to all` | `new URLSearchParams('')` | `league === 'all'`, `season === 'all'` |
| `parseGlobalStatsQuery treats a blank scope as all` | `new URLSearchParams('league=%20&season=')` | `league === 'all'`, `season === 'all'` |
| `parseGlobalStatsQuery reads the direction from dir` | `new URLSearchParams('dir=asc')` | `direction === 'asc'` |
| `parseGlobalStatsQuery ignores the legacy direction key` | `new URLSearchParams('direction=asc')` | `direction === undefined` |
| `parseGlobalStatsQuery keeps the page size default at 100` | `new URLSearchParams('')` | `size === 100` |
| `globalStatsQueryParams omits an unnarrowed scope` | `{page:1,size:100,search:'',league:'all',season:'all'}` | `params` has no `league` and no `season` key |
| `globalStatsQueryParams writes both scope levels when narrowed` | `{…,league:'L1',season:'S1'}` | `params['league'] === 'L1'`, `params['season'] === 'S1'` |
| `globalStatsQueryParams writes dir and never direction` | `{…,direction:'desc',league:'all',season:'all'}` | `params['dir'] === 'desc'`, `params['direction'] === undefined` |
| `resolveGlobalStatsScope maps all and all to the global scope` | `{league:'all',season:'all'}` | `{kind:'global', id:''}` |
| `resolveGlobalStatsScope maps a league alone to the league scope` | `{league:'L1',season:'all'}` | `{kind:'league', id:'L1'}` |
| `resolveGlobalStatsScope prefers the season over its league` | `{league:'L1',season:'S1'}` | `{kind:'season', id:'S1'}` |
| `scopeSeasonOptions offers every season while the league is all` | 3 seasons across 2 leagues, `'all'` | all 3 returned |
| `scopeSeasonOptions narrows to the chosen league` | same, `'L1'` | only the 2 seasons whose `leagueId === 'L1'` |
| `selectScopeLeague drops a season the league does not own` | query `{league:'all',season:'S9',page:4}`, `'L1'`, seasons where `S9.leagueId === 'L2'` | `{league:'L1', season:'all', page:1}` |
| `selectScopeLeague keeps a season the league owns` | query `{league:'all',season:'S1'}`, `'L1'`, `S1.leagueId === 'L1'` | `season === 'S1'`, `league === 'L1'`, `page === 1` |
| `selectScopeSeason pins the owning league` | query `{league:'all',season:'all',page:3}`, `'S1'`, `S1.leagueId === 'L1'` | `{league:'L1', season:'S1', page:1}` |
| `selectScopeSeason clearing back to all keeps the league` | query `{league:'L1',season:'S1'}`, `'all'` | `{league:'L1', season:'all', page:1}` |
| `globalStatsScopeName resolves a season name` | `{kind:'season',id:'S1'}` + catalogs | `'Ligue Lyon 2026'` |
| `globalStatsScopeName returns undefined for an unknown id` | `{kind:'league',id:'nope'}` + catalogs | `undefined` |
| `globalStatsScopeName returns undefined for the global scope` | `{kind:'global',id:''}` | `undefined` |
| `toggleGlobalStatsSort keeps the scope` | `{…,league:'L1',season:'S1'}`, `'rating'` | `league === 'L1'`, `season === 'S1'`, `page === 1`, `direction === 'desc'` |

### `src/app/features/players/global-stats.component.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `requests the global scope by default` | no route params | `getArchiveGlobalPlayerStatistics` called once with `('global', undefined, 1, 100, undefined, undefined, undefined)` |
| `requests the league scope with its id` | `{ league: 'L1' }` | first arg `'league'`, second `'L1'` |
| `requests the season scope with its id` | `{ league: 'L1', season: 'S1' }` | first arg `'season'`, second `'S1'` |
| `sends the URL direction under the wire name` | `{ sort: 'matchWins', dir: 'asc' }` | 6th arg `'matchWins'`, 7th arg `'asc'` |
| **`keeps the numbers the scope returned`** | responder returning, for `'global'`, `{playerName:'Alice', position:1, playedMatchCount:40, tournamentsPlayed:12, matchWinrate:0.75}` and, for `'season'`+`'S1'`, `{playerName:'Alice', position:1, playedMatchCount:6, tournamentsPlayed:2, matchWinrate:0.5}`; route params `{ league:'L1', season:'S1' }` | `comp.pagedRows()[0].playedMatchCount === 6`, `.tournamentsPlayed === 2`, `.matchWinrate === 0.5` — the scoped record, **not** the global numbers filtered down |
| `renumbers positions from the scoped response` | scoped response whose rows carry `position: 1, 2, 3` | `comp.pagedRows().map(r => r.position)` is `[1,2,3]`, and the component computes no position of its own (`expect(source).not.toContain('start + i + 1')`) |
| `renders the scope note only in a scoped view` | source + `{ season: 'S1' }` vs no params | `source` contains `data-cy="global-stats-scope-note"` guarded by `scope().kind !== 'global'` |
| `names the active season in the badge` | `{ league:'L1', season:'S1' }`, catalogs holding `S1 = 'Ligue Lyon 2026'` | `comp.scopeLabel() === 'Ligue Lyon 2026'` |
| `names the active league in the badge` | `{ league: 'L1' }`, catalogs holding `L1 = 'Ligue Lyon'` | `comp.scopeLabel() === 'Ligue Lyon'` |
| `labels the badge global when nothing is chosen` | no params | `comp.scopeLabel() === 'All tournaments'` |
| `falls back to the raw id before the catalog lands` | `{ season: 'S9' }`, empty catalogs | `comp.scopeLabel() === 'S9'` |
| `narrows the season options to the chosen league` | `{ league: 'L1' }`, 3 seasons across 2 leagues | `comp.seasonOptions().map(s => s.id)` are only `L1`'s |
| `offers every season while the league is all` | no params, same catalogs | `comp.seasonOptions().length === 3` |
| `navigates with both scope keys when a season is chosen` | `comp.setSeason('S1')` with `S1.leagueId === 'L1'` | `router.navigate` last called with `queryParams` containing `{ league: 'L1', season: 'S1' }` and no `page` |
| `resets the season when the new league does not own it` | route `{ league:'L2', season:'S9' }` then `comp.setLeague('L1')` | `queryParams.season === undefined`, `queryParams.league === 'L1'` |
| `says the scope is empty rather than the archive` | `{ season: 'S1' }`, response `totalCount: 0` | `comp.emptyMessage() === 'No player has a rating in this scope yet.'` |
| `keeps the generic empty copy for an empty search` | `{ season:'S1', search:'zzz' }`, `totalCount: 0` | `comp.emptyMessage() === 'No players found.'` |
| `explains that standalone tournaments only feed the global scope` | source | contains `data-cy="global-stats-empty-standalone-hint"` and `globalStats.standaloneHint` |
| `counts players in this scope in the status line` | `{ season: 'S1' }`, `totalCount: 18` | `comp.pageStatus()` is `'Page 1 of 1 (18 players in this scope)'` |
| `counts players plainly in the global scope` | no params, `totalCount: 18` | `comp.pageStatus()` is `'Page 1 of 1 (18 players)'` |
| `sorting issues a new scoped request` | `{ season:'S1' }` then `comp.sortBy('rating')` | `router.navigate` called with `{ season:'S1', league:…, sort:'rating', dir:'desc' }` |
| `paging issues a new scoped request` | `{ season:'S1' }` then `comp.goPage(3)` | `queryParams.page === 3` and `queryParams.season === 'S1'` |
| `page size 100 is the default and is not written to the URL` | `comp.setSize(100)` | `queryParams.size === undefined`; `comp.currentSize() === 100` on a fresh component |
| `drops sort=decayedRating from the request while the column is off the wire` | `{ sort: 'decayedRating' }`, rows without `decayedRating` | 6th arg of the call is `undefined` |
| `sends sort=decayedRating once the column is on the wire` | `{ sort: 'decayedRating' }`, rows carrying `decayedRating: 1480`, then a second URL emission | 6th arg of the latest call is `'decayedRating'` |
| `surfaces a filter failure without hiding the table` | `catalogs.fail = true`, rankings response with 1 row | `comp.scopeError()` is `'Could not load the League and Season filters.'`, `comp.error()` is `''`, `comp.pagedRows().length === 1` |
| `reports a rankings failure when nothing is on screen` | client rejects, no prior rows | `comp.error() === 'Could not load global statistics.'`, `comp.stale() === false` |
| `keeps the previous page and goes stale when a refetch fails` | first call resolves 1 row, second rejects, then `comp.onSync()` | `comp.stale() === true`, `comp.error() === ''`, `comp.pagedRows().length === 1` |
| `drops a superseded response` | first call never resolves until after the second; two emissions | `comp.pagedRows()` holds the **second** scope's rows |
| `sync refetches the current scope` | `{ season:'S1' }` then `comp.onSync()` | the client is called twice, both times with `('season','S1',…)` |
| `renders every new scope key in both catalogs` | the 12 new keys | present in `catalogs.en` and `catalogs.fr`, and non-empty in both |

Delete outright, because the behaviour they pin no longer exists: the `GlobalStatsComponent — catalog
cache` describe (`:365-388`), `GlobalStatsComponent — sorting without a request` (`:457-472`),
`GlobalStatsComponent — paging without a request` (`:508-524`), the `jumps to the last page without
calling load again` case (`:491-505`, keep the `windows the pages around the current one` case above
it), and the `renumbers positions after filtering` case (`:440-455`, replaced by `renumbers positions
from the scoped response`). Keep every template-structure, format-helper, rating-cell and
match-column-label describe as they are.

### `cypress/e2e/global-stats.cy.js`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `renders all 11 column headers in order` (existing) | mocked scoped rankings | unchanged assertions |
| `clicking the Rating header navigates to ?sort=rating&dir=desc` (renamed from `…&direction=desc`) | click the rating header | URL includes `sort=rating` and `dir=desc` |
| `choosing a League scopes the request` (new) | pick `Ligue Lyon` in `global-stats-league-select` | the intercepted request's query carries `scopeKind=league&scopeId=lyon`; the URL carries `league=lyon` |
| `choosing a Season scopes the request and names it in the badge` (new) | pick `Ligue Lyon 2026` | request carries `scopeKind=season&scopeId=lyon-2026`; `global-stats-scope-badge` contains `Ligue Lyon 2026` |
| `an empty scope explains itself` (new) | scoped response `{items: [], totalCount: 0}` | `global-stats-no-results` reads the scope copy and `global-stats-empty-standalone-hint` is visible |

Run commands:

```bash
npx vitest run src/app/features/players/global-stats-query.test.ts
npx vitest run src/app/features/players/global-stats.component.test.ts
npx vitest run src/app/i18n
npm run test
npx cypress run --spec cypress/e2e/global-stats.cy.js
```

## Impl steps

- [ ] 0. Verify the two predecessor surfaces exist before writing a line
  - [ ] 0.1 Run `grep -n "getArchiveGlobalPlayerStatistics(" src/app/api/generated/gones-api.ts`.
        Expect two hits (interface + class). If there are none, **stop**: the scoped endpoint has not
        been generated into the client and this ticket cannot start.
  - [ ] 0.2 Run `grep -n "export interface ArchiveGlobalPlayerStatisticsResponse" -A 10 src/app/api/generated/gones-api.ts`
        and confirm the fields `items`, `page`, `pageSize`, `totalCount`, `sort`, `direction`.
  - [ ] 0.3 Read the generated signature printed by 0.1 and confirm the parameter order is
        `(scopeKind, scopeId, page, pageSize, search, sort, direction)`. If the generator emitted a
        different order, use the order in the file — it is generated from the server and wins.
  - [ ] 0.4 Run `grep -n "class ArchiveRepository" -A 40 src/app/data/archive-repository.service.ts` and
        write down the two method names that return the League catalog and the LeagueSeason catalog.
        Apply the adaptation rule in *Interface contract → Consumes* if they are not
        `loadLeagues` / `loadLeagueSeasons`.
  - [ ] 0.5 Run `grep -n "ArchiveLeagueSummary\|ArchiveLeagueSeasonSummary" src/app/api/generated/gones-api.ts | head`
        and confirm both interfaces are exported.

- [ ] 1. Red: pin the scope helpers in `src/app/features/players/global-stats-query.test.ts`
  - [ ] 1.1 Add to the file's import list from `./global-stats-query`:
        `GLOBAL_STATS_SCOPE_ALL`, `resolveGlobalStatsScope`, `scopeSeasonOptions`, `selectScopeLeague`,
        `selectScopeSeason`, `globalStatsScopeName`.
  - [ ] 1.2 Append two fixtures near the top of the file:
        ```ts
        const LEAGUES = [{ id: 'L1', name: 'Ligue Lyon' }, { id: 'L2', name: 'Circuit Rhône-Alpes' }];
        const SEASONS = [
          { id: 'S1', name: 'Ligue Lyon 2026', leagueId: 'L1' },
          { id: 'S2', name: 'Ligue Lyon 2025', leagueId: 'L1' },
          { id: 'S9', name: 'Circuit 2026', leagueId: 'L2' },
        ];
        const BASE_QUERY = { page: 1, size: 100 as const, search: '', league: 'all', season: 'all' };
        ```
  - [ ] 1.3 Append a `describe('global stats scope', …)` holding the 13 scope tests of the test plan,
        named exactly as listed.
  - [ ] 1.4 Update the existing `parseGlobalStatsQuery` and `globalStatsQueryParams` describes: every
        existing case that asserts on `direction=` in the params must now assert on `dir`, and add the
        6 parse/serialise cases of the test plan.
  - [ ] 1.5 Run `npx vitest run src/app/features/players/global-stats-query.test.ts`. Expect red.

- [ ] 2. Green: extend `src/app/features/players/global-stats-query.ts`
  - [ ] 2.1 Above `export interface GlobalStatsQuery`, insert the scope vocabulary:
        ```ts
        /** The sentinel both scope levels use for "not narrowed". Never a document id. */
        export const GLOBAL_STATS_SCOPE_ALL = 'all';

        export type GlobalStatsScopeKind = 'global' | 'league' | 'season';

        export interface GlobalStatsScopeSelection {
          kind: GlobalStatsScopeKind;
          /** `''` exactly when `kind === 'global'`; otherwise the League or LeagueSeason document id. */
          id: string;
        }

        export interface GlobalStatsLeagueOption { id: string; name: string; }
        export interface GlobalStatsSeasonOption { id: string; name: string; leagueId: string; }
        ```
  - [ ] 2.2 Add `league: string;` and `season: string;` to `GlobalStatsQuery`, each with the doc comment
        `/** `'all'` or a League document id. */` and `/** `'all'` or a LeagueSeason document id. */`.
  - [ ] 2.3 In `parseGlobalStatsQuery`, replace `const rawDir = params.get('direction') ?? undefined;`
        with `const rawDir = params.get('dir') ?? undefined;` and add above the `return`:
        ```ts
        // Single-select at both levels: every selectable scope has a stored rating, so 'all' or exactly
        // one id — there is no subset to combine and no on-demand replay to fall back on.
        const league = (params.get('league') ?? '').trim() || GLOBAL_STATS_SCOPE_ALL;
        const season = (params.get('season') ?? '').trim() || GLOBAL_STATS_SCOPE_ALL;
        ```
        and return `{ page, size, search, sort, direction, league, season }`.
  - [ ] 2.4 In `globalStatsQueryParams`, replace `if (query.direction) params['direction'] = query.direction;`
        with `if (query.direction) params['dir'] = query.direction;` and add, as the first two statements
        of the body:
        ```ts
        if (query.league !== GLOBAL_STATS_SCOPE_ALL) params['league'] = query.league;
        if (query.season !== GLOBAL_STATS_SCOPE_ALL) params['season'] = query.season;
        ```
  - [ ] 2.5 Append the five scope helpers, verbatim:
        ```ts
        /**
         * The one scope the rankings are asked for. A Season is narrower than its League, so a chosen
         * Season wins; both `'all'` is the global scope, whose id is the empty string.
         */
        export function resolveGlobalStatsScope(query: Pick<GlobalStatsQuery, 'league' | 'season'>): GlobalStatsScopeSelection {
          if (query.season !== GLOBAL_STATS_SCOPE_ALL) return { kind: 'season', id: query.season };
          if (query.league !== GLOBAL_STATS_SCOPE_ALL) return { kind: 'league', id: query.league };
          return { kind: 'global', id: '' };
        }

        /** The Seasons the Season select offers: every Season while the League is `'all'`, that League's otherwise. */
        export function scopeSeasonOptions<T extends { leagueId: string }>(seasons: readonly T[], league: string): T[] {
          return league === GLOBAL_STATS_SCOPE_ALL ? [...seasons] : seasons.filter(season => season.leagueId === league);
        }

        /** Choosing a League drops a Season it does not own, and always returns to page 1. */
        export function selectScopeLeague(
          query: GlobalStatsQuery,
          league: string,
          seasons: readonly GlobalStatsSeasonOption[]
        ): GlobalStatsQuery {
          const keeps = league !== GLOBAL_STATS_SCOPE_ALL
            && query.season !== GLOBAL_STATS_SCOPE_ALL
            && seasons.some(season => season.id === query.season && season.leagueId === league);
          return { ...query, league, season: keeps ? query.season : GLOBAL_STATS_SCOPE_ALL, page: 1 };
        }

        /**
         * Choosing a Season pins its owning League too: a badge naming a Season while the League select
         * still read "All leagues" is exactly the ambiguity the badge exists to remove.
         */
        export function selectScopeSeason(
          query: GlobalStatsQuery,
          season: string,
          seasons: readonly GlobalStatsSeasonOption[]
        ): GlobalStatsQuery {
          if (season === GLOBAL_STATS_SCOPE_ALL) return { ...query, season: GLOBAL_STATS_SCOPE_ALL, page: 1 };
          const owner = seasons.find(candidate => candidate.id === season);
          return { ...query, season, league: owner ? owner.leagueId : query.league, page: 1 };
        }

        /**
         * The human name of the active scope, or `undefined` while the catalog holding it has not landed
         * or the id is unknown. The global scope has no name here — the caller labels it.
         */
        export function globalStatsScopeName(
          scope: GlobalStatsScopeSelection,
          catalogs: { leagues: readonly GlobalStatsLeagueOption[]; seasons: readonly GlobalStatsSeasonOption[] }
        ): string | undefined {
          if (scope.kind === 'global') return undefined;
          const list = scope.kind === 'league' ? catalogs.leagues : catalogs.seasons;
          return list.find(entry => entry.id === scope.id)?.name;
        }
        ```
  - [ ] 2.6 Run `npx vitest run src/app/features/players/global-stats-query.test.ts`. Expect green.

- [ ] 3. Green: add the twelve i18n keys in both catalogs
  - [ ] 3.1 In `src/app/i18n/messages.ts`, immediately after the EN line
        `'globalStats.sortDesc': 'Sorted descending',` (`:209`), insert the twelve EN entries from
        *Interface contract → Produces — i18n keys*, in the table's order.
  - [ ] 3.2 Immediately after the FR line `'globalStats.sortDesc': 'Trié par ordre décroissant',`
        (`:1456`), insert the twelve FR entries in the same order.
  - [ ] 3.3 Run `npx vitest run src/app/i18n`. Expect green — `message-namespace.test.ts:17` proves the
        two key sets stayed identical.

- [ ] 4. Red: rewrite the component test harness in `src/app/features/players/global-stats.component.test.ts`
  - [ ] 4.1 Replace the `GlobalStatsCatalogCacheService` import (`:16`) with
        ```ts
        import { Client, ArchiveGlobalPlayerStatisticsResponse, ArchiveGlobalPlayerStatisticsRow, ArchiveLeagueSummary, ArchiveLeagueSeasonSummary } from '../../api/generated/gones-api';
        import { ArchiveRepository } from '../../data/archive-repository.service';
        ```
        and drop the `GlobalPlayerStatisticsRow` type import at `:20` in favour of
        `ArchiveGlobalPlayerStatisticsRow`.
  - [ ] 4.2 Replace `makeCatalogResult` (`:218-220`) with:
        ```ts
        function rankingsResponse(
          items: ArchiveGlobalPlayerStatisticsRow[],
          overrides: Partial<ArchiveGlobalPlayerStatisticsResponse> = {},
        ): ArchiveGlobalPlayerStatisticsResponse {
          return { items, page: 1, pageSize: 100, totalCount: items.length, sort: undefined, direction: undefined, ...overrides };
        }

        function leagueSummary(id: string, name: string): ArchiveLeagueSummary {
          return { id, name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', documentVersion: 1 };
        }

        function seasonSummary(id: string, name: string, leagueId: string): ArchiveLeagueSeasonSummary {
          return {
            id, name, leagueId, status: 'completed',
            updatedAt: '2026-01-01T00:00:00.000Z', documentVersion: 1,
            tournamentCount: 0, playerCount: 0, firstTournamentDate: null, lastTournamentDate: null,
          };
        }
        ```
  - [ ] 4.3 Replace `buildComponent` (`:222-251`) with:
        ```ts
        type Responder = ArchiveGlobalPlayerStatisticsResponse
          | ((scopeKind: string, scopeId: string | undefined) => ArchiveGlobalPlayerStatisticsResponse);

        function buildComponent(
          response: Responder = rankingsResponse([]),
          routeParams: Record<string, string | null> = {},
          catalogs: { leagues?: ArchiveLeagueSummary[]; seasons?: ArchiveLeagueSeasonSummary[]; fail?: boolean } = {},
        ) {
          const getArchiveGlobalPlayerStatistics = vi.fn((scopeKind: string, scopeId: string | undefined) =>
            of(typeof response === 'function' ? response(scopeKind, scopeId) : response));
          const client = { getArchiveGlobalPlayerStatistics } as unknown as Client;

          const catalogResult = <T>(items: T[]) => ({ items, fetchedAt: '2026-08-22T00:00:00.000Z', stale: false, truncated: false });
          const loadLeagues = vi.fn(async () => {
            if (catalogs.fail) throw new Error('offline');
            return catalogResult(catalogs.leagues ?? []);
          });
          const loadLeagueSeasons = vi.fn(async () => {
            if (catalogs.fail) throw new Error('offline');
            return catalogResult(catalogs.seasons ?? []);
          });
          const archive = { loadLeagues, loadLeagueSeasons } as unknown as ArchiveRepository;

          const route = {
            queryParamMap: of({ keys: [], has: () => false, get: (k: string) => routeParams[k] ?? null, getAll: () => [] }),
          } as unknown as ActivatedRoute;
          const router = { navigate: vi.fn(async () => true) } as unknown as Router;

          const injector = Injector.create({
            providers: [
              { provide: Client, useValue: client },
              { provide: ArchiveRepository, useValue: archive },
              { provide: ActivatedRoute, useValue: route },
              { provide: Router, useValue: router },
              DeckArchetypeSettingsService,
              I18nService,
            ],
          });

          const comp = runInInjectionContext(injector, () => new GlobalStatsComponent());
          return { comp, client: getArchiveGlobalPlayerStatistics, loadLeagues, loadLeagueSeasons, router };
        }
        ```
  - [ ] 4.4 Update `makeRow` (around `:190-216`) to return `ArchiveGlobalPlayerStatisticsRow` — the field
        list is unchanged, only the annotated type changes.
  - [ ] 4.5 Delete the five obsolete cases/describes named at the end of the *Test plan* section.
  - [ ] 4.6 Rewrite the surviving behavioural describes to await the client rather than the cache:
        replace every `await vi.waitFor(() => expect(comp.allRows().length)…)` with
        `await vi.waitFor(() => expect(comp.pagedRows().length)…)` and every `load` reference with the
        returned `client` spy.
  - [ ] 4.7 Add `describe('GlobalStatsComponent — scope filter', …)` holding the 26 component tests of
        the test plan, named exactly as listed.
  - [ ] 4.8 Extend the i18n-keys list at `:527-536` with the twelve new keys.
  - [ ] 4.9 Run `npx vitest run src/app/features/players/global-stats.component.test.ts`. Expect red.

- [ ] 5. Green: rewire `GlobalStatsComponent` to the scoped endpoint
  - [ ] 5.1 In `src/app/features/players/global-stats.component.ts`, replace the
        `GlobalStatsCatalogCacheService` import with
        ```ts
        import { firstValueFrom } from 'rxjs';
        import { Client, ArchiveGlobalPlayerStatisticsRow, ArchiveLeagueSummary, ArchiveLeagueSeasonSummary, OpponentRecord, PlayerArchetypeUsage } from '../../api/generated/gones-api';
        import { ArchiveRepository } from '../../data/archive-repository.service';
        ```
        and drop `GlobalPlayerStatisticsRow` and `sortGlobalStatsRows` from the imports.
  - [ ] 5.2 Extend the `./global-stats-query` import with `GLOBAL_STATS_SCOPE_ALL`,
        `GlobalStatsScopeSelection`, `resolveGlobalStatsScope`, `scopeSeasonOptions`,
        `selectScopeLeague`, `selectScopeSeason`, `globalStatsScopeName`.
  - [ ] 5.3 Replace the injected `cacheService` field (`:223`) with
        ```ts
        private readonly client = inject(Client);
        private readonly archive = inject(ArchiveRepository);
        ```
  - [ ] 5.4 Replace `readonly truncated = signal(false);` and `readonly allRows = …` with
        ```ts
        readonly scopeError = signal('');
        readonly rows = signal<ArchiveGlobalPlayerStatisticsRow[]>([]);
        readonly totalCount = signal(0);
        readonly leagues = signal<ArchiveLeagueSummary[]>([]);
        readonly seasons = signal<ArchiveLeagueSeasonSummary[]>([]);
        readonly committedSearch = signal('');
        readonly currentLeague = signal<string>(GLOBAL_STATS_SCOPE_ALL);
        readonly currentSeason = signal<string>(GLOBAL_STATS_SCOPE_ALL);
        readonly scopeAll = GLOBAL_STATS_SCOPE_ALL;
        private requestToken = 0;
        ```
  - [ ] 5.5 Point `showDecayedRating` at the new signal:
        `computed(() => this.rows().some(row => row.decayedRating !== null && row.decayedRating !== undefined))`.
  - [ ] 5.6 Delete `filteredRows`, `sortedRows` and the `totalCount` / `pagedRows` computeds, and put in
        their place:
        ```ts
        /** The server numbers the rows inside the requested scope, so positions renumber 1..n per scope. */
        readonly pagedRows = computed(() => this.rows());
        readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.currentSize())));

        readonly scope = computed<GlobalStatsScopeSelection>(() =>
          resolveGlobalStatsScope({ league: this.currentLeague(), season: this.currentSeason() }));

        readonly seasonOptions = computed(() => scopeSeasonOptions(this.seasons(), this.currentLeague()));

        /** Never blank: the resolved name, else the raw id, else the global label. */
        readonly scopeLabel = computed(() => {
          const scope = this.scope();
          if (scope.kind === 'global') return this.i18n.t('globalStats.scopeGlobalName');
          return globalStatsScopeName(scope, { leagues: this.leagues(), seasons: this.seasons() }) ?? scope.id;
        });

        readonly pageStatus = computed(() => this.i18n.t(
          this.scope().kind === 'global' ? 'globalStats.pageStatus' : 'globalStats.pageStatusScope',
          { page: this.currentPage(), total: this.totalPages(), count: this.totalCount() }));

        readonly emptyMessage = computed(() =>
          this.committedSearch() || this.scope().kind === 'global'
            ? this.i18n.t('globalStats.noResults')
            : this.i18n.t('globalStats.noResultsScope'));
        ```
  - [ ] 5.7 Replace the constructor body with:
        ```ts
        this.route.queryParamMap.subscribe((params) => {
          const query = parseGlobalStatsQuery(params);
          this.currentPage.set(query.page);
          this.currentSize.set(query.size);
          this.routeParams.set(params);
          this.currentDirection.set(query.direction);
          this.searchDraft.set(query.search);
          this.committedSearch.set(query.search);
          this.currentLeague.set(query.league);
          this.currentSeason.set(query.season);
          void this.loadRankings();
        });
        void this.loadScopeCatalogs();
        ```
        Do **not** convert this to an `effect()`: the component test replaces `effect` with a no-op.
  - [ ] 5.8 Replace `loadCatalog` with the two loaders:
        ```ts
        /**
         * One page of one scope. The rating shown always comes from the stored `(scopeKind, scopeId)` row,
         * so matches, tournaments and winrate are the player's record inside the scope — never their
         * global numbers filtered down.
         */
        private async loadRankings(): Promise<void> {
          const token = ++this.requestToken;
          const scope = this.scope();
          this.loading.set(true);
          try {
            const response = await firstValueFrom(this.client.getArchiveGlobalPlayerStatistics(
              scope.kind,
              scope.kind === 'global' ? undefined : scope.id,
              this.currentPage(),
              this.currentSize(),
              this.committedSearch() || undefined,
              this.currentSort(),
              this.currentDirection(),
            ));
            // A slower earlier request must not paint its scope under a newer scope's badge.
            if (token !== this.requestToken) return;
            this.rows.set(response.items ?? []);
            this.totalCount.set(response.totalCount ?? 0);
            this.syncedAt.set(new Date().toISOString());
            this.stale.set(false);
            this.error.set('');
          } catch {
            if (token !== this.requestToken) return;
            if (this.rows().length) this.stale.set(true);
            else this.error.set(this.i18n.t('globalStats.errorLoad'));
          } finally {
            if (token === this.requestToken) this.loading.set(false);
          }
        }

        /** The two selects. A failure here narrows the filter, it does not hide the ranking. */
        private async loadScopeCatalogs(): Promise<void> {
          try {
            const [leagues, seasons] = await Promise.all([this.archive.loadLeagues(), this.archive.loadLeagueSeasons()]);
            this.leagues.set(leagues.items);
            this.seasons.set(seasons.items);
            this.scopeError.set('');
          } catch {
            this.scopeError.set(this.i18n.t('globalStats.scopeLoadFailed'));
          }
        }
        ```
  - [ ] 5.9 Replace `onSync()` with `void this.loadRankings();`.
  - [ ] 5.10 Add the two private helpers and rewrite the four navigating commands against them:
        ```ts
        private query(): GlobalStatsQuery {
          return {
            page: this.currentPage(),
            size: this.currentSize(),
            search: this.committedSearch(),
            sort: this.currentSort(),
            direction: this.currentDirection(),
            league: this.currentLeague(),
            season: this.currentSeason(),
          };
        }

        private navigate(query: GlobalStatsQuery): void {
          void this.router.navigate([], { relativeTo: this.route, queryParams: globalStatsQueryParams(query) });
        }
        ```
        then: `setSearchDraft` debounces to `this.navigate({ ...this.query(), search: value, page: 1 })`;
        `sortBy` becomes `this.navigate(toggleGlobalStatsSort(this.query(), col))`;
        `goPage` becomes `this.navigate({ ...this.query(), page })`;
        `setSize` becomes `this.navigate({ ...this.query(), size, page: 1 })`.
  - [ ] 5.11 Add the two scope commands:
        ```ts
        setLeague(league: string): void {
          this.navigate(selectScopeLeague(this.query(), league, this.seasons()));
        }

        setSeason(season: string): void {
          this.navigate(selectScopeSeason(this.query(), season, this.seasons()));
        }
        ```

- [ ] 6. Green: the scope bar, the badge, the note and the empty state
  - [ ] 6.1 In the template, immediately after the closing `</div>` of `.global-stats-heading-row` and
        before `.global-stats-controls`, insert:
        ```html
        <div class="global-stats-scope" data-cy="global-stats-scope">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="global-stats-scope-field" data-cy="global-stats-league-field">
            <mat-label>{{ i18n.t('globalStats.scopeLeagueLabel') }}</mat-label>
            <mat-select data-cy="global-stats-league-select" [value]="currentLeague()" (selectionChange)="setLeague($event.value)">
              <mat-option [value]="scopeAll" data-cy="global-stats-league-option-all">{{ i18n.t('globalStats.scopeAllLeagues') }}</mat-option>
              @for (league of leagues(); track league.id) {
                <mat-option [value]="league.id" [attr.data-cy]="'global-stats-league-option-' + league.id">{{ league.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="global-stats-scope-field" data-cy="global-stats-season-field">
            <mat-label>{{ i18n.t('globalStats.scopeSeasonLabel') }}</mat-label>
            <mat-select data-cy="global-stats-season-select" [value]="currentSeason()" (selectionChange)="setSeason($event.value)">
              <mat-option [value]="scopeAll" data-cy="global-stats-season-option-all">{{ i18n.t('globalStats.scopeAllSeasons') }}</mat-option>
              @for (season of seasonOptions(); track season.id) {
                <mat-option [value]="season.id" [attr.data-cy]="'global-stats-season-option-' + season.id">{{ season.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <!-- The badge names the scope the numbers were computed in, so a scoped rating is never read as the global one. -->
          <span class="global-stats-scope-badge" [attr.aria-label]="i18n.t('globalStats.scopeBadgeAria')" data-cy="global-stats-scope-badge">
            <span aria-hidden="true">◆</span>{{ i18n.t('globalStats.scopeBadge', { scope: scopeLabel() }) }}
          </span>
        </div>
        @if (scopeError()) {
          <p class="warning" role="status" data-cy="global-stats-scope-error">{{ scopeError() }}</p>
        }
        ```
  - [ ] 6.2 Delete the `@if (truncated()) { … }` block (`:80-82`).
  - [ ] 6.3 Replace both `i18n.t('globalStats.pageStatus', { … })` interpolations — the status bar at
        `:86` and the bottom pagination at `:189` — with `{{ pageStatus() }}`.
  - [ ] 6.4 Replace the empty cell body at `:135` with:
        ```html
        <td [attr.colspan]="visibleColumnCount()" data-cy="global-stats-no-results">
          {{ emptyMessage() }}
          @if (scope().kind !== 'global' && !committedSearch()) {
            <span class="global-stats-empty-hint" data-cy="global-stats-empty-standalone-hint">{{ i18n.t('globalStats.standaloneHint') }}</span>
          }
        </td>
        ```
  - [ ] 6.5 Immediately after the closing `</div>` of `.table-wrap`, insert:
        ```html
        @if (scope().kind !== 'global') {
          <p class="global-stats-scope-note" data-cy="global-stats-scope-note">{{ i18n.t('globalStats.scopeNote') }}</p>
        }
        ```
  - [ ] 6.6 Append to the component's `styles` block, using only tokens already in `src/styles.css`:
        ```css
        .global-stats-scope { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; margin-top: 1.25rem; padding: .75rem; border: 1px solid var(--soot); background: var(--iron); }
        .global-stats-scope-field { width: 16rem; }
        .global-stats-scope-badge { display: inline-flex; align-items: center; gap: .4rem; padding: .28rem .6rem; border: 1px solid color-mix(in oklch, var(--hot-blood) 50%, var(--soot)); background: color-mix(in oklch, var(--blood) 16%, var(--iron)); color: var(--ash); font-size: .75rem; font-weight: 800; }
        .global-stats-scope-note { margin: .6rem 0 0; color: var(--steel); font-size: .8rem; }
        .global-stats-empty-hint { display: block; margin-top: .35rem; color: var(--steel); font-size: .8rem; }
        ```
  - [ ] 6.7 Run `npx vitest run src/app/features/players/global-stats.component.test.ts`. Expect green.

- [ ] 7. Update `cypress/e2e/global-stats.cy.js` to the scoped endpoint
  - [ ] 7.1 Replace the header comment (`:1-5`) with one sentence stating that the page now pages on the
        server against `/api/archive/global-player-statistics` and that the League and Season selects
        choose the scope.
  - [ ] 7.2 Replace `mockCatalog` (`:37-43`) with:
        ```js
        function mockRankings(items = [BASE_ROW], overrides = {}) {
          cy.intercept('GET', '**/api/archive/global-player-statistics?*', (req) => {
            req.reply({ items, page: 1, pageSize: 100, totalCount: items.length, ...overrides });
          }).as('rankings');
        }

        function mockScopeCatalogs(leagues = [], seasons = []) {
          cy.intercept('GET', '**/api/archive/leagues/all', { items: leagues, totalCount: leagues.length, truncated: false }).as('leagueCatalog');
          cy.intercept('GET', '**/api/archive/league-seasons/all', { items: seasons, totalCount: seasons.length, truncated: false }).as('seasonCatalog');
        }
        ```
  - [ ] 7.3 Replace every `mockCatalog()` call with `mockRankings()` plus `mockScopeCatalogs(...)`, and
        every `cy.wait('@catalog')` with `cy.wait('@rankings')`.
  - [ ] 7.4 Rename the test at `:76` to `clicking the Rating header navigates to ?sort=rating&dir=desc`
        and change its assertion to `.and('include', 'dir=desc')`.
  - [ ] 7.5 Append a `describe('Global Stats — scope filter', …)` with the three new Cypress cases of the
        test plan, seeding `mockScopeCatalogs` with one League `{ id: 'lyon', name: 'Ligue Lyon', … }` and
        one Season `{ id: 'lyon-2026', name: 'Ligue Lyon 2026', leagueId: 'lyon', … }`.
  - [ ] 7.6 Run `npx cypress run --spec cypress/e2e/global-stats.cy.js` against a running stack.

- [ ] 8. Validate and commit
  - [ ] 8.1 `npm run test`
  - [ ] 8.2 `npm run typecheck`
  - [ ] 8.3 `npm run lint`
  - [ ] 8.4 `npm run build`
  - [ ] 8.5 `git status --short` — confirm only the six files of *Outputs* changed, and that nothing
        under `backend/` or `src/app/features/archive/` was touched.

## Outputs

Files touched — six, and no others:

- `src/app/features/players/global-stats-query.ts` — scope vocabulary, `league` / `season` on
  `GlobalStatsQuery`, `dir` instead of `direction` in the URL, five new helpers.
- `src/app/features/players/global-stats-query.test.ts` — the new scope tests, the `dir` rename.
- `src/app/features/players/global-stats.component.ts` — scoped server paging, the two selects, the
  badge, the scope note, the scoped empty state.
- `src/app/features/players/global-stats.component.test.ts` — the rewritten harness and the scope suite.
- `src/app/i18n/messages.ts` — twelve keys in `catalogs.en` and twelve in `catalogs.fr`.
- `cypress/e2e/global-stats.cy.js` — intercepts the scoped endpoint and the two catalogs; asserts the
  scope filter end to end.

Behaviour change:

- `/global-stats` reads and writes `?league=&season=&sort=&dir=&page=&size=&search=`. The URL parameter
  `direction` is gone; the wire parameter `direction` is unchanged.
- The page pages, sorts and searches on the server, inside the chosen scope, instead of filtering one
  cached catalog in the browser. It no longer reads or writes the `gones.global-stats.catalog`
  `localStorage` entry; the entry is left in place for the legacy league detail page, which still uses it.
- The truncation warning is gone with the catalog cap that produced it.

Migrate / config: none. No migration, no configuration key, no environment variable, no route change.

## Validation

- [ ] `npx vitest run src/app/features/players/global-stats-query.test.ts` — all green, including the 13
      scope tests and the `dir` cases.
- [ ] `npx vitest run src/app/features/players/global-stats.component.test.ts` — all green, including
      `keeps the numbers the scope returned`, `renumbers positions from the scoped response` and
      `explains that standalone tournaments only feed the global scope`.
- [ ] `npx vitest run src/app/i18n` — green; `en` and `fr` key sets identical.
- [ ] `npm run test` — exit code `0`.
- [ ] `npm run typecheck` — exit code `0`, no output.
- [ ] `npm run lint` — exit code `0`, `All files pass linting.`
- [ ] `npm run build` — exit code `0`.
- [ ] `npx cypress run --spec cypress/e2e/global-stats.cy.js` — `All specs passed!`.
- [ ] Manual check, `npm run dev` then `http://127.0.0.1:4200/global-stats`:
      - the scope bar shows *League*, *Season* and a badge reading `◆ Rating scope: All tournaments`;
      - choosing a League narrows the Season select to that League's Seasons and the URL gains
        `?league=<id>`;
      - choosing a Season sets both `?league=<id>&season=<id>`, the badge names the Season, the status
        line reads `… players in this scope`, and the note under the table says the numbers are the
        record inside the scope;
      - the top row is `#1` in every scope;
      - a Season with no results reads *No player has a rating in this scope yet.* followed by
        *Standalone tournaments count towards the global ranking only.*;
      - switching the language to French translates every one of those strings.
- [ ] App functional — no broken path from this slice: `/players/:name`, the legacy
      `/leagues-archive/:id` detail page and the Events page all still load, because none of them share a
      file with this ticket.
- [ ] commit msg draft: `feat(global-stats): scope the rankings to a League or a Season`
