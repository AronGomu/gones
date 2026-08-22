# T13: Archive shell, routes and the League Seasons tab

> ## ⚠ ARBITRATION OVERRIDE — read before the body; these win over anything below
>
> **A. Use T12's real repository method names.** The body calls
> `ArchiveRepository.listLeagueCatalog()` and `.listLeagueSeasonCatalog()`. Those do not exist — they
> were a guess made while T12 was being written in parallel. T12 owns the file and shipped:
>
> ```ts
> listLeagues(options?)            // NOT listLeagueCatalog
> listLeagueSeasons(options?)      // NOT listLeagueSeasonCatalog
> listYears(options?)
> listTournaments(options?)
> listSeasonTournaments(season)
> invalidateArchiveCaches(): Promise<void>
> ```
>
> Substitute throughout. Nothing else about the call sites changes.
>
> **B. Seven sort keys, not six** — `name | leagueName | lastPlayed | updated | tournaments |
> players | status`. The body already has this right; confirming it against the brief's "all six",
> which is a miscount.
>
> **C. `?dir=` is now used by `/global-stats` too.** The body notes the two surfaces disagree because
> the shipped rankings page uses `?direction=`. T15 renames the rankings param to `dir` and fixes
> `cypress/e2e/global-stats.cy.js:76-78`, so they agree. The **wire** parameter sent to the API stays
> `direction`. No action here beyond dropping that caveat.

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T12, T5, T3
**Commit outcome:** `/archive/league-seasons` renders the Variant B table, sortable and paginated.

## Context (self-contained)

- **Goal.** The Archive is being rebuilt on three tiers — **League → LeagueSeason → Tournament**.
  Today's flat `League` becomes `LeagueSeason`; a new `League` tier groups Seasons; a Tournament
  becomes a first-class top-level record that may stand alone (`seasonId: null`). The card grid
  becomes a paginated, sortable, expandable table across two tabs. `leagues-archive` → `archive`
  everywhere.
- **This slice.** The first user-visible page of the new Archive: the shell (title, sync bar, two-tab
  strip) and **Tab 1 — League Seasons**, rendered as the Variant B two-line table, with query-string
  driven sort / direction / page / page-size / search / League filter, a loading skeleton, an empty
  state and a truncated-catalog warning. It is a **read-only** page: it renders rows served by the
  catalog reads and never writes.
- **Where it sits.** The three new tables, the `/api/archive/**` read surface and the browser-side
  IndexedDB catalog cache already exist when this ticket starts. This ticket is the first consumer of
  them. The next ticket adds Tab 2 and the Season → Tournaments expansion; the ticket after that adds
  the Rankings scope filter; the one after that the cache-invalidation funnel and the Settings
  resynchronize control; the final ticket deletes the legacy surface.
- **Why `T3` is a dependency.** `POST /api/archive/league-seasons` and `POST /api/archive/leagues`
  are how rows get into the two catalogs this page reads. The manual validation of this ticket
  creates a League and two Seasons over HTTP with those routes before loading the page. This ticket
  itself calls **no** command endpoint.

### Out of scope here — do not touch

- **No Tournaments tab.** `src/app/features/archive/tournament-list.component.ts` is another
  ticket's file. Do not create it, do not stub it. This ticket registers `/archive/tournaments` as a
  **temporary redirect placeholder** only (see `Impl steps` step 4.3 and the decision recorded under
  `Assumptions in force`).
- **No Season expansion.** A Season row is **not** expandable in this ticket. No chevron, no
  `aria-expanded`, no `tr.archive-seasons-kids` row, no click handler on the row, no call to
  `GET /api/archive/league-seasons/{id}/tournaments`. The exact markup contract the next ticket must
  add is frozen under `Interface contract → Produces — frozen expansion contract`; **write that
  contract into the ticket file only, not into the component.**
- **No rankings work.** `src/app/features/players/global-stats.component.ts`,
  `global-stats-query.ts`, `global-stats-catalog-cache.service.ts` are untouched. No `scopeKind`, no
  `scopeId`, no scope badge.
- **No resynchronize button** in Settings. `src/app/features/settings/**` is untouched.
- **No create / rename / delete affordance** of any tier. No `MatDialog`, no `TextPromptDialogComponent`,
  no `PowerUserSettingsService`. This page is read-only.
- **Do not delete or modify the legacy archive.** `src/app/features/leagues-archive/**`,
  `src/app/features/tournaments-archive/**`, `src/app/data/league-archive-*.ts`,
  `src/app/backend/local-league-archive-backend.service.ts` and the routes `leagues-archive`,
  `leagues-archive/:leagueId`, `leagues-archive/:leagueId/tournaments-archive/:tournamentId`,
  `leagues-archive/:leagueId/tournaments-archive/:tournamentId/result`,
  `.../result/metagames`, and the five redirects produced by `archiveRedirectRoutes()` in
  `src/app/app.routes.ts:66-80` all keep working exactly as they do today. They are retired by the
  final ticket of the plan, not by this one.
- **No backend change.** No file under `backend/`. No `npm run api:generate`.
- **No Cypress spec.** No file under `cypress/`. No row in `ops/acceptance-matrix.json`.
- **No ADR, no `docs/**` edit.**
- **No edit to an existing test file.** In particular `src/app/data-mode-routes.test.ts`,
  `src/app/app-breadcrumbs.test.ts`, `src/app/i18n/messages.test.ts` and
  `src/app/i18n/message-namespace.test.ts` are left alone; the route, breadcrumb and i18n assertions
  this ticket needs live in its own two sibling test files.

### Assumptions in force

- **Gones is unreleased. There is no production environment and there are no users.** Local data may
  be reset freely. There is no data migration and no route alias.
- **Expand → migrate → contract.** The new `/archive/**` pages are *added beside* the existing
  `/leagues-archive/**` ones. No compatibility shim is written; the old code merely survives until
  unused. Every commit compiles and the app runs.
- **The archive may be empty when this page first loads.** An earlier ticket wiped it. A `200` with
  `{"items":[],"totalCount":0,"truncated":false}` rendering the empty state is correct behaviour, not
  a bug to fix.
- **The table treatment is FIXED.** The user chose **Variant B — two-line rows** from
  `artifacts/GRILL_2026_08_22_archive-tournaments/PROTOTYPE_archive_tables.html`, tab **B**. Four
  visual columns carry six values. Do not invent a different treatment, do not fall back to Variant A
  or C, do not reuse the card grid.
- **Never hardcode a colour.** Only the tokens already declared in `src/styles.css:5-17` —
  `--forge`, `--black-metal`, `--iron`, `--raised-iron`, `--soot`, `--ash`, `--dim-ash`, `--steel`,
  `--blood`, `--hot-blood`, `--create-green`, `--create-green-hot`, `--rust-plate` — and the existing
  classes `.table-wrap`, `.ranking-table`, `.status`, `.status-dot`, `.page-heading`, `.muted`,
  `.error`, `.warning`, `.sr-only`, `.secondary-action`.
- **Decision — the Tournaments tab route is a redirect placeholder.** The fence offered a choice.
  This ticket registers
  `{ path: 'archive/tournaments', pathMatch: 'full', redirectTo: 'archive/league-seasons' }`.
  Chosen over "no route at all" because the tab strip links to `/archive/tournaments` and the
  alternative sends a click to the `**` 404 page; chosen over "placeholder component" because that
  would create a third component file this fence does not allow. The next ticket replaces the
  redirect with a `loadComponent` entry in a single edit.
- **Decision — the sort `<select>` exposes all seven keys of the binding sort list, not six.** The
  brief's binding sort-key list for Tab 1 is
  `name | leagueName | lastPlayed | updated | tournaments | players | status` — six paired values plus
  `status`, which is its own unpaired column. All seven are offered.
- **Decision — `aria-sort` is set on the column that *owns* the active key, not only on its first
  value.** Sorting by `updated` (the second value of the `Last played / Updated` column) still marks
  that column `aria-sort`, because the column genuinely is the sorted one. Clicking a paired header
  still selects its **first** value, exactly as the brief binds.
- **Decision — browser-local (`local-` prefixed) Seasons are not merged into this table.** The
  browser-local authority is a different ticket's surface and the fence names only the two server
  catalogs. The legacy `/leagues-archive` page keeps showing browser-local Leagues until the final
  ticket retires it, so nothing becomes unreachable in the meantime.
- **Codebase wins over this ticket.** If a symbol inlined below under `Inputs → From Depends` is
  spelled differently in the file the predecessor actually committed, use the committed spelling and
  keep the wire shape and the behaviour in `Interface contract` exactly as specified.

## Requirements

1. A new directory `src/app/features/archive/` holds exactly two new components and their two
   sibling tests. No other file is created there.
2. `ArchiveShellComponent` (`gones-archive-shell`) renders the page title, the sync bar and the
   two-tab strip, and projects the active tab's content through `<ng-content />`. It owns no data and
   issues no request.
3. `LeagueSeasonListComponent` renders **Tab 1** of the Variant B table: four `<th>`, four `<td>` per
   row, six values, per `Interface contract → Produces — the Variant B row`.
4. The **Season name cell is a link** to `/archive/league-seasons/{id}`. Nothing else in the row is
   interactive in this ticket.
5. The 🔒 marker is **visible** on a locked Season row. A Season is locked when it has at least one
   Tournament and its **latest** Tournament is locked — which is exactly "every one of its
   Tournaments is locked", because the latest one locks last. A Season with no Tournament is never
   locked.
6. All list state lives in the query string:
   `?sort=&dir=&page=&size=&search=&league=`. Reloading the URL reproduces the view exactly. Every
   control navigates; no control mutates a local copy of the state and skips the URL.
7. Default sort `lastPlayed`, default direction `desc`, default page `1`, default size `25`. Page
   sizes are `25 | 50 | 100`. A default value is **omitted** from the emitted query string.
8. An unknown, malformed or out-of-range query-string value falls back to its default rather than
   erroring, matching `parseGlobalStatsQuery` in
   `src/app/features/players/global-stats-query.ts:49-71`.
9. Sorting, filtering and paging happen **in the browser** over the whole downloaded catalog. The page
   issues at most two catalog reads per load and never re-reads on a sort, a filter or a page change.
10. Three states are implemented: **loading skeleton** (five skeleton rows in the real table, so the
    layout does not jump), **empty** (two distinct messages — nothing in the archive vs. nothing
    matched the filter), and **truncated** (a `.warning` banner naming the shown and total counts).
11. A failed catalog read renders `.error` with `role="alert"` and does not throw.
12. Sortable headers carry `aria-sort` and their sort action is a real `<button type="button">`, so
    the table is sortable from the keyboard. The page-status line is an `aria-live="polite"` region.
13. Routes `archive` (redirect to `archive/league-seasons`), `archive/league-seasons` and
    `archive/tournaments` (temporary redirect placeholder) are registered in `src/app/app.routes.ts`.
14. `buildBreadcrumbs` answers `/archive/**` with `[Menu, Archive]` instead of falling through to the
    Not-Found branch.
15. Every new message key exists in **both** the `en` and the `fr` block of `src/app/i18n/messages.ts`.
    `src/app/i18n/message-namespace.test.ts:16-18` asserts the two key sets are identical and will
    fail otherwise.
16. **Every element in both inline templates carries `data-cy` or `[attr.data-cy]`, and every static
    `data-cy` value is unique inside its file.** `src/app/shared/data-cy-coverage.test.ts` walks every
    file in `src/app` containing `template:` + a backtick and enforces both rules. Exempt tags:
    `ng-container`, `ng-template`, `ng-content`, `svg`, `path`, `defs`, `g`, `use`, `circle`, `rect`,
    `line`, `polyline`, `polygon`, `br`, `hr`.
17. `npm run test`, `npm run typecheck` and `npm run lint` are green, and `npm run build` succeeds.

## Inputs

### Files to read before writing code

- `artifacts/GRILL_2026_08_22_archive-tournaments/PROTOTYPE_archive_tables.html` — **tab B only**.
  The `<section class="panel" id="p-b">` block and the `// B` branch of the render script. The CSS to
  reproduce is `.b-name`, `.b-name .sub`, `.b-meta`, `.lock`, `.skel`, `.empty`, `.pager`, `.tabs`,
  `.toolbar`, `.field`, `.statusline`, `.warnbar`, `.nm`, `.lg`, `.dim`.
- `src/app/features/leagues-archive/league-archive-list.component.ts` — the existing list idiom:
  `gones-back-button` top and bottom, `gones-sync-bar`, `readonly loading/error/syncedAt/stale`
  signals, `async load(options: { force?: boolean } = {})` with `Promise.allSettled`,
  `sync(): void { void this.load({ force: true }); }`, `goPage`, and the
  `pageIndex/pageSize/totalPages/pagedLeagues` computed chain.
- `src/app/features/players/global-stats.component.ts` — the query-string idiom this ticket copies:
  `this.route.queryParamMap.subscribe(...)` in the constructor, `routeParams` signal + `computed`
  gate, `sortBy` / `ariaSort` / `goPage` / `setSize` navigating with
  `this.router.navigate([], { relativeTo: this.route, queryParams: ... })`, the 300 ms search
  debounce with `ngOnDestroy` clearing the timer, and the `<div class="table-wrap"><table
  class="ranking-table">` shape with `[attr.aria-sort]` headers.
- `src/app/features/players/global-stats-query.ts` — `parseGlobalStatsQuery` (lines 49-71),
  `toggleGlobalStatsSort` (79-83) and `globalStatsQueryParams` (177-185). Copy the shapes; **do not
  import from this file** — it is a different feature's module.
- `src/app/app.routes.ts:93-100` — route registration style inside `buildRoutes`.
- `src/app/app-breadcrumbs.ts:70-83` — the `leagues-archive` breadcrumb branch and, critically, the
  guard on line 70 that returns Not-Found for any first segment that is not `leagues-archive`.
- `src/app/shared/data-cy-coverage.test.ts:51-111` — the two rules described in Requirement 16.
- `src/styles.css:5-17` (tokens), `:35` (`.sr-only`), `:42-45` (`.status`, `.status.completed`,
  `.status-dot`), `:57-58` (`.page-heading`), `:81-82` (`.muted`, `.error`/`.warning`), `:605-606`
  (`.table-wrap`), `:700-702` (`.ranking-table`).
- `src/app/i18n/messages.ts` — `const en = {` opens at line 5 and closes with `} as const;` at line
  1250; `const fr: Record<MessageKey, string> = {` opens at line 1254 and closes with `};` at line
  2483. New keys go at the end of each block, before its closing brace.

### From Depends — spelled out, because the worker cannot read the predecessor tickets

**From T5 — the two catalog routes (already deployed, this ticket only consumes their payloads).**
Both are anonymous public `GET`s answering `200` with `Cache-Control: public, max-age=3600`, a strong
`ETag` and a `304` on a matching `If-None-Match`:

```
GET /api/archive/leagues/all         → 200 ArchiveCatalogResponse<ArchiveLeagueSummary>
GET /api/archive/league-seasons/all  → 200 ArchiveCatalogResponse<ArchiveLeagueSeasonSummary>
```

Wire shapes, frozen:

```ts
export interface ArchiveCatalogResponse<T> {
  items: T[];
  totalCount: number;   // whole visible table, NOT the number of items returned
  truncated: boolean;   // the server row cap cut the list short
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
  updatedAt: string;                     // ISO 8601 UTC instant
  documentVersion: number;
  tournamentCount: number;
  playerCount: number;
  firstTournamentDate: string | null;    // "YYYY-MM-DD"; null when the Season has no Tournament
  lastTournamentDate: string | null;     // "YYYY-MM-DD"; null when the Season has no Tournament
}
```

Server ordering on both routes is `updatedAt DESC, id ASC`. `firstTournamentDate` and
`lastTournamentDate` are the **only** nullable fields; every other field is non-null. Row caps:
`Gones:Archive:MaximumLeagueCatalogSize` default `2000`, `Gones:Archive:MaximumSeasonCatalogSize`
default `5000`. When a cap bites, `items.length === ceiling` while `totalCount` stays the full
visible count and `truncated` is `true`.

**From T10 — the frontend domain module.** `src/app/domain/archive-models.ts` exports, verbatim:

```ts
export type LeagueStatus = 'active' | 'completed';   // re-exported from './models'

export const ARCHIVE_LOCK_WINDOW_DAYS = 365;

/** A Tournament locks 365 days after the day it was played. Derived, never stored. */
export function isArchiveTournamentLocked(tournamentDate: string, now?: Date): boolean;
```

Semantics, binding: `locked ⇔ (now - tournamentDate) > 365 days`, compared on whole UTC calendar
days. Played exactly 365 days ago → **not** locked; 366 days ago → locked. `tournamentDate` is a
`YYYY-MM-DD` string.

**From T10 — the summary row types.** `src/app/data/archive-summary.ts` re-exports the two catalog row
interfaces above under exactly the names `ArchiveLeagueSummary` and `ArchiveLeagueSeasonSummary`, the
same way `src/app/data/league-archive-summary.ts` declares `LeagueArchiveSummary` today. Import them
from `../../data/archive-summary`.

**From T12 — the archive repository.** `src/app/data/archive-repository.service.ts` exports the
injectable class `ArchiveRepository`. This ticket calls exactly two of its methods and nothing else:

```ts
@Injectable({ providedIn: 'root' })
export class ArchiveRepository {
  /** The whole League catalog, served from `gones-archive-cache` under the 24h TTL. */
  listLeagueCatalog(options?: { force?: boolean }): Promise<CatalogResult<ArchiveLeagueSummary[]>>;

  /** The whole LeagueSeason catalog, served from `gones-archive-cache` under the 24h TTL. */
  listLeagueSeasonCatalog(options?: { force?: boolean }): Promise<CatalogResult<ArchiveLeagueSeasonSummary[]>>;

  /** The single funnel every archive mutation goes through. Not called by this ticket. */
  invalidateArchiveCaches(): Promise<void>;
}
```

`{ force: true }` bypasses the TTL and refetches. `CatalogResult<T>` is the **existing** type in
`src/app/shared/catalog-cache.ts:26-32`, unchanged by this plan:

```ts
export interface CatalogResult<T> {
  items: T;
  fetchedAt: string;   // ISO 8601 UTC instant of the read that produced `items`
  fromCache: boolean;
  stale: boolean;      // the server read failed and a cached copy was served instead
  truncated: boolean;  // the server row cap cut the list short
}
```

`listLeagueCatalog` / `listLeagueSeasonCatalog` **reject** when the server read fails and no cached
copy exists. They never reject when a cached copy exists; they resolve with `stale: true`.

**From T3 — the command routes used only by this ticket's manual validation, never by its code.**

```
POST /api/archive/leagues        body {"name": string}                                  → 201
POST /api/archive/league-seasons body {"leagueId": string, "name": string, "status": "active"|"completed"} → 201
```

Both are organizer-gated and answer
`{ "id": string, "documentVersion": number, "updatedAt": string, "eTag": string }`.

## Interface contract (level 5)

### Produces — `src/app/features/archive/archive-shell.component.ts`

```ts
import { Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../i18n/i18n.service';
import { SyncBarComponent } from '../../shared/sync-bar.component';

/** Which tab the host page is. Route segment and value are deliberately the same string. */
export type ArchiveTab = 'league-seasons' | 'tournaments';

@Component({
  selector: 'gones-archive-shell',
  standalone: true,
  imports: [RouterLink, SyncBarComponent],
  template: `…`,
  styles: [`…`]
})
export class ArchiveShellComponent {
  readonly i18n = inject(I18nService);
  readonly activeTab = input.required<ArchiveTab>();
  readonly syncedAt = input<string | undefined>(undefined);
  readonly loading = input(false);
  readonly stale = input(false);
  readonly sync = output<void>();
}
```

Template, verbatim:

```html
    <div class="archive-heading-row" data-cy="archive-heading-row">
      <section class="page-heading" data-cy="archive-heading">
        <div data-cy="archive-heading-text"><h1 data-cy="archive-title">{{ i18n.t('archive.title') }}</h1></div>
      </section>
      <gones-sync-bar cyPrefix="archive" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="sync.emit()" data-cy="archive-sync-bar" />
    </div>
    <nav class="archive-tabs" [attr.aria-label]="i18n.t('archive.tabsAria')" data-cy="archive-tabs">
      <a
        class="archive-tab"
        [class.is-selected]="activeTab() === 'league-seasons'"
        [attr.aria-current]="activeTab() === 'league-seasons' ? 'page' : null"
        routerLink="/archive/league-seasons"
        data-cy="archive-tab-league-seasons"
      >{{ i18n.t('archive.tabLeagueSeasons') }}</a>
      <a
        class="archive-tab"
        [class.is-selected]="activeTab() === 'tournaments'"
        [attr.aria-current]="activeTab() === 'tournaments' ? 'page' : null"
        routerLink="/archive/tournaments"
        data-cy="archive-tab-tournaments"
      >{{ i18n.t('archive.tabTournaments') }}</a>
    </nav>
    <ng-content />
```

Styles, verbatim (tokens only, mirroring the prototype's `.tabs` block):

```css
    .archive-heading-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; }
    .archive-heading-row .page-heading { flex: 1 1 auto; min-width: 0; margin: 0; }
    .archive-tabs { display: flex; gap: 2px; margin: 1rem 0 1rem; border-bottom: 1px solid var(--soot); }
    .archive-tab { padding: .7rem 1.15rem; border: 1px solid transparent; border-bottom: 0; color: var(--steel); font-size: .9rem; font-weight: 700; text-decoration: none; }
    .archive-tab:hover, .archive-tab:focus-visible { color: var(--ash); }
    .archive-tab:focus-visible { outline: 2px solid var(--hot-blood); outline-offset: -2px; }
    .archive-tab.is-selected { position: relative; top: 1px; border-color: var(--soot); background: var(--iron); color: var(--ash); }
```

**Invariants of the shell:** it injects nothing but `I18nService`; it holds no signal of its own; it
never calls the router imperatively; `sync` is emitted only by the sync bar's own button.

### Produces — `src/app/features/archive/league-season-list.component.ts`

Module-level exports, verbatim and complete:

```ts
export const LEAGUE_SEASON_PAGE_SIZES = [25, 50, 100] as const;
export type LeagueSeasonPageSize = (typeof LEAGUE_SEASON_PAGE_SIZES)[number];
export const DEFAULT_LEAGUE_SEASON_PAGE_SIZE: LeagueSeasonPageSize = 25;

/** The binding sort vocabulary of Tab 1. Six paired values plus the unpaired `status`. */
export const LEAGUE_SEASON_SORT_KEYS = [
  'name', 'leagueName', 'lastPlayed', 'updated', 'tournaments', 'players', 'status'
] as const;
export type LeagueSeasonSortKey = (typeof LEAGUE_SEASON_SORT_KEYS)[number];
export const DEFAULT_LEAGUE_SEASON_SORT: LeagueSeasonSortKey = 'lastPlayed';
export const DEFAULT_LEAGUE_SEASON_DIRECTION: 'asc' | 'desc' = 'desc';

/** The four visual columns of Variant B. */
export type LeagueSeasonColumn = 'seasonLeague' | 'datesUpdated' | 'counts' | 'status';

/** Which sort keys each column owns. `aria-sort` is set on the column that owns the active key. */
export const LEAGUE_SEASON_COLUMN_KEYS: Record<LeagueSeasonColumn, readonly LeagueSeasonSortKey[]> = {
  seasonLeague: ['name', 'leagueName'],
  datesUpdated: ['lastPlayed', 'updated'],
  counts: ['tournaments', 'players'],
  status: ['status']
};

/** A paired header sorts on its FIRST value; the second stays reachable through the sort select. */
export const LEAGUE_SEASON_COLUMN_PRIMARY: Record<LeagueSeasonColumn, LeagueSeasonSortKey> = {
  seasonLeague: 'name',
  datesUpdated: 'lastPlayed',
  counts: 'tournaments',
  status: 'status'
};

/** Sentinel for "no League filter". Never a real document id. */
export const ALL_LEAGUES = 'all';

export const ARCHIVE_SEARCH_DEBOUNCE_MS = 300;

/** The whole list state, and the whole query string. Nothing about this view lives elsewhere. */
export interface LeagueSeasonQuery {
  sort: LeagueSeasonSortKey;
  dir: 'asc' | 'desc';
  page: number;                 // 1-based, always >= 1
  size: LeagueSeasonPageSize;
  search: string;               // already trimmed
  league: string;               // a League document id, or ALL_LEAGUES
}

export const DEFAULT_LEAGUE_SEASON_QUERY: LeagueSeasonQuery = {
  sort: DEFAULT_LEAGUE_SEASON_SORT,
  dir: DEFAULT_LEAGUE_SEASON_DIRECTION,
  page: 1,
  size: DEFAULT_LEAGUE_SEASON_PAGE_SIZE,
  search: '',
  league: ALL_LEAGUES
};

/**
 * One rendered row: the catalog row joined to its League's name and stamped with the derived lock.
 * `leagueName` is `''` when the League is absent from the League catalog — which happens when the
 * League catalog was truncated by its row cap. The template prints the "Unknown League" message for
 * that case rather than an empty line.
 */
export interface LeagueSeasonRow {
  id: string;
  name: string;
  leagueId: string;
  leagueName: string;
  status: LeagueStatus;
  updatedAt: string;
  documentVersion: number;
  tournamentCount: number;
  playerCount: number;
  firstTournamentDate: string | null;
  lastTournamentDate: string | null;
  locked: boolean;
}

/**
 * Reads the list state out of the URL. Accepts both `URLSearchParams` (tests) and Angular `ParamMap`
 * (router) — both expose `.get()`. Every unknown, malformed or out-of-range value falls back to its
 * default, exactly as `parseGlobalStatsQuery` does.
 *
 * `knownLeagueIds` is the gate on `?league=`: an id that is not in the League catalog resolves to
 * `ALL_LEAGUES`, so a stale bookmark shows the whole list instead of a permanently empty table whose
 * cause is invisible. Callers pass an empty set before the catalog lands and the real set after, so
 * this must be re-derived when the catalog arrives, never captured once.
 */
export function parseLeagueSeasonQuery(
  params: { get(key: string): string | null },
  knownLeagueIds?: ReadonlySet<string>
): LeagueSeasonQuery;

/** Serialises to Angular router query params, omitting every value that equals its default. */
export function leagueSeasonQueryParams(query: LeagueSeasonQuery): Params;

/** New key → `desc`, page 1. Same key → flip the direction, page 1. */
export function toggleLeagueSeasonSort(query: LeagueSeasonQuery, key: LeagueSeasonSortKey): LeagueSeasonQuery;

/** Joins the two catalogs and derives the lock. Pure; `now` is injectable for the tests. */
export function buildLeagueSeasonRows(
  seasons: readonly ArchiveLeagueSeasonSummary[],
  leagues: readonly ArchiveLeagueSummary[],
  now?: Date
): LeagueSeasonRow[];

/** League filter then case-insensitive substring over Season name and League name. Order preserved. */
export function filterLeagueSeasonRows(
  rows: readonly LeagueSeasonRow[],
  query: Pick<LeagueSeasonQuery, 'search' | 'league'>
): LeagueSeasonRow[];

/** Total, deterministic ordering. Never mutates `rows`. */
export function sortLeagueSeasonRows(
  rows: readonly LeagueSeasonRow[],
  sort: LeagueSeasonSortKey,
  dir: 'asc' | 'desc'
): LeagueSeasonRow[];
```

Bodies that are behaviour, not style — write them exactly like this:

```ts
/** Fixed locale so the order is a property of the code, not of the reader's browser. `numeric` puts
 *  "Season 2" before "Season 10"; `sensitivity: 'base'` makes "Étape" and "Etape" adjacent. */
const NAME_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function parseLeagueSeasonQuery(
  params: { get(key: string): string | null },
  knownLeagueIds: ReadonlySet<string> = new Set<string>()
): LeagueSeasonQuery {
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const rawSize = Number(params.get('size') ?? DEFAULT_LEAGUE_SEASON_PAGE_SIZE);
  const size: LeagueSeasonPageSize = (LEAGUE_SEASON_PAGE_SIZES as readonly number[]).includes(rawSize)
    ? (rawSize as LeagueSeasonPageSize)
    : DEFAULT_LEAGUE_SEASON_PAGE_SIZE;

  const rawSort = params.get('sort') ?? '';
  const sort: LeagueSeasonSortKey = (LEAGUE_SEASON_SORT_KEYS as readonly string[]).includes(rawSort)
    ? (rawSort as LeagueSeasonSortKey)
    : DEFAULT_LEAGUE_SEASON_SORT;

  const rawDir = params.get('dir') ?? '';
  const dir: 'asc' | 'desc' = rawDir === 'asc' || rawDir === 'desc' ? rawDir : DEFAULT_LEAGUE_SEASON_DIRECTION;

  const rawLeague = params.get('league') ?? ALL_LEAGUES;
  const league = rawLeague !== ALL_LEAGUES && knownLeagueIds.has(rawLeague) ? rawLeague : ALL_LEAGUES;

  return { sort, dir, page, size, search: (params.get('search') ?? '').trim(), league };
}

export function leagueSeasonQueryParams(query: LeagueSeasonQuery): Params {
  const params: Params = {};
  if (query.sort !== DEFAULT_LEAGUE_SEASON_SORT) params['sort'] = query.sort;
  if (query.dir !== DEFAULT_LEAGUE_SEASON_DIRECTION) params['dir'] = query.dir;
  if (query.page !== 1) params['page'] = query.page;
  if (query.size !== DEFAULT_LEAGUE_SEASON_PAGE_SIZE) params['size'] = query.size;
  if (query.search) params['search'] = query.search;
  if (query.league !== ALL_LEAGUES) params['league'] = query.league;
  return params;
}

export function toggleLeagueSeasonSort(query: LeagueSeasonQuery, key: LeagueSeasonSortKey): LeagueSeasonQuery {
  const same = query.sort === key;
  const dir: 'asc' | 'desc' = same && query.dir === 'desc' ? 'asc' : 'desc';
  return { ...query, sort: key, dir, page: 1 };
}

export function buildLeagueSeasonRows(
  seasons: readonly ArchiveLeagueSeasonSummary[],
  leagues: readonly ArchiveLeagueSummary[],
  now: Date = new Date()
): LeagueSeasonRow[] {
  const names = new Map(leagues.map((league) => [league.id, league.name]));
  return seasons.map((season) => ({
    ...season,
    leagueName: names.get(season.leagueId) ?? '',
    // Every Tournament of the Season is locked exactly when its LATEST one is, because the latest
    // one locks last. A Season with no Tournament has nothing to lock and stays editable.
    locked: season.lastTournamentDate !== null && isArchiveTournamentLocked(season.lastTournamentDate, now)
  }));
}

export function filterLeagueSeasonRows(
  rows: readonly LeagueSeasonRow[],
  query: Pick<LeagueSeasonQuery, 'search' | 'league'>
): LeagueSeasonRow[] {
  const term = query.search.trim().toLowerCase();
  return rows.filter((row) =>
    (query.league === ALL_LEAGUES || row.leagueId === query.league)
    && (!term || row.name.toLowerCase().includes(term) || row.leagueName.toLowerCase().includes(term)));
}

export function sortLeagueSeasonRows(
  rows: readonly LeagueSeasonRow[],
  sort: LeagueSeasonSortKey,
  dir: 'asc' | 'desc'
): LeagueSeasonRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    // `lastPlayed` is the only nullable sort key. A Season with no Tournament sorts last in BOTH
    // directions, so flipping the direction never lifts an empty Season above a played one.
    if (sort === 'lastPlayed') {
      const missing = Number(left.lastTournamentDate === null) - Number(right.lastTournamentDate === null);
      if (missing) return missing;
    }
    return sign * compareLeagueSeasonBy(left, right, sort) || compareOrdinal(left.id, right.id);
  });
}

function compareLeagueSeasonBy(left: LeagueSeasonRow, right: LeagueSeasonRow, sort: LeagueSeasonSortKey): number {
  switch (sort) {
    case 'name': return NAME_COLLATOR.compare(left.name, right.name);
    case 'leagueName': return NAME_COLLATOR.compare(left.leagueName, right.leagueName);
    case 'lastPlayed': return compareOrdinal(left.lastTournamentDate ?? '', right.lastTournamentDate ?? '');
    case 'updated': return compareNumbers(instantValue(left.updatedAt), instantValue(right.updatedAt));
    case 'tournaments': return compareNumbers(left.tournamentCount, right.tournamentCount);
    case 'players': return compareNumbers(left.playerCount, right.playerCount);
    case 'status': return compareOrdinal(left.status, right.status);
  }
}

/** An instant that will not parse sorts as the epoch rather than poisoning the comparator with NaN. */
function instantValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Code-unit order, matching the `id ASC` tiebreak the server orders its catalogs by. */
function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
```

Component class, verbatim signature:

```ts
@Component({
  selector: 'gones-league-season-list',
  standalone: true,
  imports: [FormsModule, RouterLink, ArchiveShellComponent, BackButtonComponent],
  template: `…`,
  styles: [`…`]
})
export class LeagueSeasonListComponent implements OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly repo = inject(ArchiveRepository);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  readonly loading = signal(true);
  readonly error = signal('');
  readonly stale = signal(false);
  readonly truncated = signal(false);
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly seasons = signal<ArchiveLeagueSeasonSummary[]>([]);
  readonly leagues = signal<ArchiveLeagueSummary[]>([]);
  readonly searchDraft = signal('');

  readonly pageSizes = LEAGUE_SEASON_PAGE_SIZES;
  readonly sortKeys = LEAGUE_SEASON_SORT_KEYS;
  /** Five skeleton rows, the same height as five real ones, so the table does not jump on load. */
  readonly skeletonRows = [0, 1, 2, 3, 4] as const;

  readonly leagueIds: Signal<ReadonlySet<string>>;
  readonly query: Signal<LeagueSeasonQuery>;
  readonly rows: Signal<LeagueSeasonRow[]>;
  readonly filteredRows: Signal<LeagueSeasonRow[]>;
  readonly sortedRows: Signal<LeagueSeasonRow[]>;
  readonly totalRows: Signal<number>;
  readonly totalPages: Signal<number>;
  /** The URL's page clamped into range. The URL is NOT rewritten: a clamp that navigated would loop. */
  readonly currentPage: Signal<number>;
  readonly pagedRows: Signal<LeagueSeasonRow[]>;
  /** True when at least one filter is active, which selects the "nothing matched" empty message. */
  readonly filtered: Signal<boolean>;
  /** What the "nothing matched" message quotes: the search term, or the filtered League's name. */
  readonly filterLabel: Signal<string>;

  constructor();
  ngOnDestroy(): void;

  /** Reads both catalogs. `force` bypasses the 24h TTL. Never throws. */
  load(options?: { force?: boolean }): Promise<void>;
  sync(): void;

  /** Clicking a paired header selects its FIRST value; clicking the active key flips the direction. */
  sortByColumn(column: LeagueSeasonColumn): void;
  ariaSort(column: LeagueSeasonColumn): 'ascending' | 'descending' | null;
  setSort(key: LeagueSeasonSortKey): void;
  toggleDirection(): void;
  setSearchDraft(value: string): void;
  clearSearch(): void;
  setLeague(leagueId: string): void;
  setSize(size: LeagueSeasonPageSize): void;
  goPage(page: number): void;

  /** `null` renders the em dash; a `YYYY-MM-DD` or an instant renders in the active locale. */
  formatDate(value: string | null): string;
  leagueLabel(row: LeagueSeasonRow): string;
  statusLabel(row: LeagueSeasonRow): string;
  sortLabel(key: LeagueSeasonSortKey): string;
  columnLabel(column: LeagueSeasonColumn): string;
}
```

Method bodies that are behaviour, verbatim:

```ts
  constructor() {
    this.leagueIds = computed(() => new Set(this.leagues().map((league) => league.id)));
    this.query = computed(() => {
      const params = this.routeParams();
      return params ? parseLeagueSeasonQuery(params, this.leagueIds()) : DEFAULT_LEAGUE_SEASON_QUERY;
    });
    this.rows = computed(() => buildLeagueSeasonRows(this.seasons(), this.leagues()));
    this.filteredRows = computed(() => filterLeagueSeasonRows(this.rows(), this.query()));
    this.sortedRows = computed(() => sortLeagueSeasonRows(this.filteredRows(), this.query().sort, this.query().dir));
    this.totalRows = computed(() => this.filteredRows().length);
    this.totalPages = computed(() => Math.max(1, Math.ceil(this.totalRows() / this.query().size)));
    this.currentPage = computed(() => Math.min(Math.max(this.query().page, 1), this.totalPages()));
    this.pagedRows = computed(() => {
      const start = (this.currentPage() - 1) * this.query().size;
      return this.sortedRows().slice(start, start + this.query().size);
    });
    this.filtered = computed(() => this.query().search !== '' || this.query().league !== ALL_LEAGUES);
    this.filterLabel = computed(() =>
      this.query().search || this.leagues().find((league) => league.id === this.query().league)?.name || '');

    this.route.queryParamMap.subscribe((params) => {
      this.routeParams.set(params);
      // The draft mirrors the URL on every navigation, including Back, so the input never disagrees
      // with the list it filters.
      this.searchDraft.set((params.get('search') ?? '').trim());
    });
    void this.load();
  }

  ngOnDestroy(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
  }

  async load(options: { force?: boolean } = {}): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    const [seasons, leagues] = await Promise.allSettled([
      this.repo.listLeagueSeasonCatalog(options),
      this.repo.listLeagueCatalog(options)
    ]);
    if (seasons.status === 'rejected') {
      logBoundaryError('archive-league-season-list.load', seasons.reason);
      this.error.set(this.i18n.t('archive.loadFailed'));
      this.loading.set(false);
      return;
    }
    this.seasons.set(seasons.value.items);
    this.syncedAt.set(seasons.value.fetchedAt);
    this.truncated.set(seasons.value.truncated);
    // A failed League catalog is survivable: every Season still renders, with its League name blank
    // and the "Unknown League" label in its place. A failed Season catalog is not.
    if (leagues.status === 'fulfilled') this.leagues.set(leagues.value.items);
    else logBoundaryError('archive-league-season-list.load-leagues', leagues.reason);
    this.stale.set(seasons.value.stale || leagues.status !== 'fulfilled' || leagues.value.stale);
    this.loading.set(false);
  }

  sync(): void { void this.load({ force: true }); }

  private navigate(query: LeagueSeasonQuery): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: leagueSeasonQueryParams(query) });
  }

  sortByColumn(column: LeagueSeasonColumn): void {
    this.navigate(toggleLeagueSeasonSort(this.query(), LEAGUE_SEASON_COLUMN_PRIMARY[column]));
  }

  ariaSort(column: LeagueSeasonColumn): 'ascending' | 'descending' | null {
    if (!LEAGUE_SEASON_COLUMN_KEYS[column].includes(this.query().sort)) return null;
    return this.query().dir === 'asc' ? 'ascending' : 'descending';
  }

  setSort(key: LeagueSeasonSortKey): void {
    // Choosing a key from the select never flips the direction: it is a column picker, and the
    // direction has its own control beside it.
    this.navigate({ ...this.query(), sort: key, page: 1 });
  }

  toggleDirection(): void {
    this.navigate({ ...this.query(), dir: this.query().dir === 'asc' ? 'desc' : 'asc', page: 1 });
  }

  setSearchDraft(value: string): void {
    this.searchDraft.set(value);
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(
      () => this.navigate({ ...this.query(), search: value.trim(), page: 1 }),
      ARCHIVE_SEARCH_DEBOUNCE_MS
    );
  }

  clearSearch(): void { this.setSearchDraft(''); }
  setLeague(leagueId: string): void { this.navigate({ ...this.query(), league: leagueId, page: 1 }); }
  setSize(size: LeagueSeasonPageSize): void { this.navigate({ ...this.query(), size, page: 1 }); }
  goPage(page: number): void { this.navigate({ ...this.query(), page }); }

  formatDate(value: string | null): string { return value ? this.i18n.formatDate(value) : '—'; }
  leagueLabel(row: LeagueSeasonRow): string { return row.leagueName || this.i18n.t('archive.unknownLeague'); }
  statusLabel(row: LeagueSeasonRow): string {
    return this.i18n.t(row.status === 'completed' ? 'common.completed' : 'common.active');
  }
```

`private readonly routeParams = signal<{ get(key: string): string | null } | null>(null);` is declared
with the other signals.

### Produces — the Variant B row, frozen

Four `<th>`, four `<td>`, six values:

| Header (`th`) | Line 1 | Line 2 | Header click sorts on | Column owns keys |
| --- | --- | --- | --- | --- |
| `Season / League` | Season name, **the link** to `/archive/league-seasons/{id}` | League name | `name` | `name`, `leagueName` |
| `Last played / Updated` | `lastTournamentDate`, or `—` | `upd. {updatedAt}` | `lastPlayed` | `lastPlayed`, `updated` |
| `Tourn. / Players` | `{tournamentCount} tourn.` | `{playerCount} players` | `tournaments` | `tournaments`, `players` |
| `Status` | active/completed chip + 🔒 when locked | — | `status` | `status` |

Template of the list component, verbatim:

```html
    <gones-back-button data-cy="archive-seasons-back-top" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />

    <gones-archive-shell
      activeTab="league-seasons"
      [syncedAt]="syncedAt()"
      [loading]="loading()"
      [stale]="stale()"
      (sync)="sync()"
      data-cy="archive-seasons-shell"
    >
      <div class="archive-toolbar" data-cy="archive-seasons-toolbar">
        <div class="archive-field archive-field--grow" data-cy="archive-seasons-search-field">
          <label for="archive-seasons-search" data-cy="archive-seasons-search-label">{{ i18n.t('archive.searchLabel') }}</label>
          <input
            id="archive-seasons-search"
            type="search"
            data-cy="archive-seasons-search-input"
            [placeholder]="i18n.t('archive.searchPlaceholder')"
            [ngModel]="searchDraft()"
            (ngModelChange)="setSearchDraft($event)"
          />
          @if (searchDraft()) {
            <button type="button" class="archive-ghost-button" data-cy="archive-seasons-search-clear" (click)="clearSearch()">{{ i18n.t('common.clear') }}</button>
          }
        </div>
        <div class="archive-field" data-cy="archive-seasons-league-field">
          <label for="archive-seasons-league" data-cy="archive-seasons-league-label">{{ i18n.t('archive.leagueFilterLabel') }}</label>
          <select id="archive-seasons-league" data-cy="archive-seasons-league-select" [ngModel]="query().league" (ngModelChange)="setLeague($event)">
            <option [value]="allLeagues" data-cy="archive-seasons-league-option-all">{{ i18n.t('archive.leagueFilterAll') }}</option>
            @for (league of leagues(); track league.id) {
              <option [value]="league.id" [attr.data-cy]="'archive-seasons-league-option-' + league.id">{{ league.name }}</option>
            }
          </select>
        </div>
        <div class="archive-field" data-cy="archive-seasons-sort-field">
          <label for="archive-seasons-sort" data-cy="archive-seasons-sort-label">{{ i18n.t('archive.sortLabel') }}</label>
          <select id="archive-seasons-sort" data-cy="archive-seasons-sort-select" [ngModel]="query().sort" (ngModelChange)="setSort($event)">
            @for (key of sortKeys; track key) {
              <option [value]="key" [attr.data-cy]="'archive-seasons-sort-option-' + key">{{ sortLabel(key) }}</option>
            }
          </select>
          <button
            type="button"
            class="archive-ghost-button"
            data-cy="archive-seasons-direction-button"
            [attr.aria-label]="i18n.t('archive.directionToggleAria', { direction: i18n.t(query().dir === 'asc' ? 'archive.ascending' : 'archive.descending') })"
            (click)="toggleDirection()"
          >{{ query().dir === 'asc' ? '↑' : '↓' }}</button>
        </div>
        <div class="archive-field" data-cy="archive-seasons-size-field">
          <label for="archive-seasons-size" data-cy="archive-seasons-size-label">{{ i18n.t('archive.sizeLabel') }}</label>
          <select id="archive-seasons-size" data-cy="archive-seasons-size-select" [ngModel]="query().size" (ngModelChange)="setSize(+$event)">
            @for (size of pageSizes; track size) {
              <option [value]="size" [attr.data-cy]="'archive-seasons-size-option-' + size">{{ size }}</option>
            }
          </select>
        </div>
      </div>

      @if (error()) { <p class="error" role="alert" data-cy="archive-seasons-error">{{ error() }}</p> }
      @if (truncated()) { <p class="warning" role="status" data-cy="archive-seasons-truncated">{{ i18n.t('archive.truncatedSeasons', { shown: seasons().length }) }}</p> }

      <div class="archive-status-line" data-cy="archive-seasons-status-line">
        <span aria-live="polite" data-cy="archive-seasons-page-status">{{ i18n.t('archive.pageStatus', { page: currentPage(), total: totalPages(), count: totalRows() }) }}</span>
      </div>

      <div class="table-wrap" data-cy="archive-seasons-table-wrap">
        <table class="ranking-table archive-table" [attr.aria-label]="i18n.t('archive.seasonsAria')" data-cy="archive-seasons-table">
          <thead data-cy="archive-seasons-thead">
            <tr data-cy="archive-seasons-header-row">
              <th scope="col" [attr.aria-sort]="ariaSort('seasonLeague')" data-cy="archive-seasons-col-season-league">
                <button type="button" class="archive-sort-button" data-cy="archive-seasons-sort-season-league" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('seasonLeague') })" (click)="sortByColumn('seasonLeague')">{{ i18n.t('archive.colSeasonLeague') }}</button>
              </th>
              <th scope="col" [attr.aria-sort]="ariaSort('datesUpdated')" data-cy="archive-seasons-col-dates">
                <button type="button" class="archive-sort-button" data-cy="archive-seasons-sort-dates" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('datesUpdated') })" (click)="sortByColumn('datesUpdated')">{{ i18n.t('archive.colLastPlayedUpdated') }}</button>
              </th>
              <th scope="col" class="archive-num" [attr.aria-sort]="ariaSort('counts')" data-cy="archive-seasons-col-counts">
                <button type="button" class="archive-sort-button" data-cy="archive-seasons-sort-counts" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('counts') })" (click)="sortByColumn('counts')">{{ i18n.t('archive.colTournamentsPlayers') }}</button>
              </th>
              <th scope="col" [attr.aria-sort]="ariaSort('status')" data-cy="archive-seasons-col-status">
                <button type="button" class="archive-sort-button" data-cy="archive-seasons-sort-status" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('status') })" (click)="sortByColumn('status')">{{ i18n.t('archive.colStatus') }}</button>
              </th>
            </tr>
          </thead>
          <tbody data-cy="archive-seasons-tbody">
            @if (loading()) {
              @for (index of skeletonRows; track index) {
                <tr [attr.data-cy]="'archive-seasons-skeleton-row-' + index">
                  <td [attr.data-cy]="'archive-seasons-skeleton-name-' + index"><span class="archive-skel archive-skel--wide" [attr.data-cy]="'archive-seasons-skeleton-name-bar-' + index" aria-hidden="true"></span><span class="archive-skel archive-skel--sub" [attr.data-cy]="'archive-seasons-skeleton-league-bar-' + index" aria-hidden="true"></span></td>
                  <td [attr.data-cy]="'archive-seasons-skeleton-dates-' + index"><span class="archive-skel" [attr.data-cy]="'archive-seasons-skeleton-dates-bar-' + index" aria-hidden="true"></span></td>
                  <td class="archive-num" [attr.data-cy]="'archive-seasons-skeleton-counts-' + index"><span class="archive-skel archive-skel--narrow" [attr.data-cy]="'archive-seasons-skeleton-counts-bar-' + index" aria-hidden="true"></span></td>
                  <td [attr.data-cy]="'archive-seasons-skeleton-status-' + index"><span class="archive-skel archive-skel--narrow" [attr.data-cy]="'archive-seasons-skeleton-status-bar-' + index" aria-hidden="true"></span></td>
                </tr>
              }
            } @else if (!pagedRows().length) {
              <tr data-cy="archive-seasons-empty-row">
                <td colspan="4" data-cy="archive-seasons-empty-cell">
                  <div class="archive-empty" data-cy="archive-seasons-empty">
                    <strong data-cy="archive-seasons-empty-title">{{ filtered() ? i18n.t('archive.emptySearchTitle', { search: filterLabel() }) : i18n.t('archive.emptyTitle') }}</strong>
                    <span data-cy="archive-seasons-empty-body">{{ filtered() ? i18n.t('archive.emptySearchBody') : i18n.t('archive.emptyBody') }}</span>
                  </div>
                </td>
              </tr>
            } @else {
              @for (row of pagedRows(); track row.id) {
                <tr [attr.data-cy]="'archive-seasons-row-' + row.id">
                  <td [attr.data-cy]="'archive-seasons-cell-name-' + row.id">
                    <span class="archive-two-line" [attr.data-cy]="'archive-seasons-name-stack-' + row.id">
                      <a class="archive-name-link" [routerLink]="['/archive/league-seasons', row.id]" [attr.aria-label]="i18n.t('archive.openSeasonAria', { name: row.name })" [attr.data-cy]="'archive-seasons-link-' + row.id">{{ row.name }}</a>
                      <span class="archive-sub" [attr.data-cy]="'archive-seasons-league-' + row.id">{{ leagueLabel(row) }}</span>
                    </span>
                  </td>
                  <td [attr.data-cy]="'archive-seasons-cell-dates-' + row.id">
                    <span class="archive-two-line" [attr.data-cy]="'archive-seasons-dates-stack-' + row.id">
                      <span [attr.data-cy]="'archive-seasons-last-played-' + row.id">{{ formatDate(row.lastTournamentDate) }}</span>
                      <span class="archive-sub" [attr.data-cy]="'archive-seasons-updated-' + row.id">{{ i18n.t('archive.updatedPrefix', { date: formatDate(row.updatedAt) }) }}</span>
                    </span>
                  </td>
                  <td class="archive-num" [attr.data-cy]="'archive-seasons-cell-counts-' + row.id">
                    <span class="archive-two-line" [attr.data-cy]="'archive-seasons-counts-stack-' + row.id">
                      <span [attr.data-cy]="'archive-seasons-tournaments-' + row.id">{{ i18n.t('archive.tournamentsValue', { count: row.tournamentCount }) }}</span>
                      <span class="archive-sub" [attr.data-cy]="'archive-seasons-players-' + row.id">{{ i18n.t('archive.playersValue', { count: row.playerCount }) }}</span>
                    </span>
                  </td>
                  <td [attr.data-cy]="'archive-seasons-cell-status-' + row.id">
                    <span class="status" [class.completed]="row.status === 'completed'" [attr.data-cy]="'archive-seasons-status-' + row.id"><span class="status-dot" aria-hidden="true" [attr.data-cy]="'archive-seasons-status-dot-' + row.id"></span>{{ statusLabel(row) }}</span>
                    @if (row.locked) {
                      <span class="archive-lock" role="img" [attr.aria-label]="i18n.t('archive.lockedAria')" [attr.title]="i18n.t('archive.lockedTitle')" [attr.data-cy]="'archive-seasons-lock-' + row.id">🔒</span>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <nav class="archive-pager" [attr.aria-label]="i18n.t('archive.paginationAria')" data-cy="archive-seasons-pagination">
        <button type="button" data-cy="archive-seasons-page-previous" [disabled]="currentPage() <= 1" (click)="goPage(currentPage() - 1)">{{ i18n.t('common.previous') }}</button>
        <span data-cy="archive-seasons-page-indicator">{{ i18n.t('archive.pageIndicator', { page: currentPage(), total: totalPages() }) }}</span>
        <button type="button" data-cy="archive-seasons-page-next" [disabled]="currentPage() >= totalPages()" (click)="goPage(currentPage() + 1)">{{ i18n.t('common.next') }}</button>
      </nav>
    </gones-archive-shell>

    <gones-back-button data-cy="archive-seasons-back-bottom" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
```

`allLeagues` is a public field on the component: `readonly allLeagues = ALL_LEAGUES;` — a template
cannot reference a module constant directly.

Styles of the list component, verbatim (tokens only; the two-line cells are the whole point of
Variant B and the `min-width` override is what removes the horizontal scroll on mobile):

```css
    .archive-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; margin: 0 0 .85rem; }
    .archive-field { display: flex; align-items: center; gap: .45rem; padding: .5rem .7rem; border: 1px solid var(--soot); background: var(--iron); }
    .archive-field--grow { flex: 1 1 12rem; min-width: 11rem; }
    .archive-field--grow input { width: 100%; }
    .archive-field label { color: var(--steel); font-size: .72rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    .archive-field input, .archive-field select { min-width: 6ch; border: 0; background: transparent; color: var(--ash); font: inherit; font-size: .88rem; outline: 0; }
    .archive-field select { cursor: pointer; }
    .archive-field input::placeholder { color: var(--steel); }
    .archive-field input:focus-visible, .archive-field select:focus-visible { outline: 2px solid var(--hot-blood); outline-offset: 2px; }
    .archive-ghost-button { min-height: 1.9rem; padding: .2rem .5rem; border: 1px solid var(--soot); background: var(--black-metal); color: var(--dim-ash); font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; }
    .archive-ghost-button:hover { background: var(--raised-iron); color: var(--ash); }
    .archive-status-line { margin: 0 0 .5rem; color: var(--dim-ash); font-size: .85rem; font-weight: 800; }
    /* The global rule pins `.ranking-table` to a 680px floor, which is exactly the horizontal scroll
       Variant B exists to remove. Two class selectors outrank it without `!important`. */
    .ranking-table.archive-table { width: 100%; min-width: 0; border-collapse: collapse; font-size: .88rem; }
    .archive-table th, .archive-table td { padding: .55rem .7rem; border-bottom: 1px solid var(--soot); text-align: left; vertical-align: middle; }
    .archive-table thead th { background: var(--black-metal); color: var(--dim-ash); font-size: .72rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
    .archive-table td.archive-num, .archive-table th.archive-num { text-align: right; }
    .archive-table th.archive-num .archive-sort-button { text-align: right; }
    .archive-sort-button { width: 100%; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; letter-spacing: inherit; text-align: inherit; text-transform: inherit; cursor: pointer; }
    .archive-sort-button:hover { color: var(--ash); }
    .archive-sort-button:focus-visible { outline: 2px solid var(--hot-blood); outline-offset: 2px; }
    .archive-table th[aria-sort="ascending"] .archive-sort-button::after { content: ' ↑'; color: var(--hot-blood); }
    .archive-table th[aria-sort="descending"] .archive-sort-button::after { content: ' ↓'; color: var(--hot-blood); }
    .archive-table tbody tr:nth-child(even) { background: color-mix(in oklch, var(--raised-iron) 52%, var(--iron)); }
    .archive-table tbody tr:hover { background: color-mix(in oklch, var(--blood) 13%, var(--raised-iron)); }
    .archive-two-line { display: flex; flex-direction: column; gap: .12rem; white-space: normal; }
    .archive-sub { color: var(--steel); font-size: .78rem; }
    .archive-name-link { color: var(--ash); font-weight: 700; text-decoration: none; }
    .archive-name-link:hover, .archive-name-link:focus-visible { color: var(--hot-blood); text-decoration: underline; text-underline-offset: .16em; }
    .archive-lock { margin-left: .4rem; color: var(--steel); font-size: .78rem; }
    .archive-empty { padding: 2.4rem 1rem; text-align: center; color: var(--steel); }
    .archive-empty strong { display: block; margin-bottom: .4rem; color: var(--dim-ash); font-size: 1rem; }
    .archive-skel { display: block; height: .72rem; margin: .2rem 0; background: linear-gradient(90deg, var(--raised-iron), var(--soot), var(--raised-iron)); background-size: 200% 100%; animation: archive-skel-shimmer 1.3s linear infinite; }
    .archive-skel--wide { width: 70%; }
    .archive-skel--sub { width: 45%; height: .6rem; }
    .archive-skel--narrow { width: 40%; }
    @keyframes archive-skel-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .archive-skel { animation: none; } }
    .archive-pager { display: flex; align-items: center; justify-content: center; gap: 1rem; margin: .85rem 0 0; color: var(--steel); font-size: .84rem; }
    .archive-pager button { min-height: 2.4rem; padding: .45rem .8rem; border: 1px solid var(--soot); background: var(--iron); color: var(--dim-ash); font: inherit; font-size: .82rem; font-weight: 700; cursor: pointer; }
    .archive-pager button:disabled { opacity: .38; cursor: not-allowed; }
    .archive-pager button:not(:disabled):hover { background: var(--raised-iron); color: var(--ash); }
```

### Produces — routes

Inserted in `buildRoutes` in `src/app/app.routes.ts`, immediately **before** the existing
`{ path: 'leagues-archive', … }` entry:

```ts
    { path: 'archive', pathMatch: 'full', redirectTo: 'archive/league-seasons' },
    { path: 'archive/league-seasons', loadComponent: () => import('./features/archive/league-season-list.component').then((m) => m.LeagueSeasonListComponent) },
    // Placeholder until the Tournaments tab ships: the tab strip links here, and bouncing back to the
    // Seasons tab beats sending the click to the 404 page. Replaced by a `loadComponent` entry then.
    { path: 'archive/tournaments', pathMatch: 'full', redirectTo: 'archive/league-seasons' },
```

Route table after this ticket:

| Path | Kind | Result |
| --- | --- | --- |
| `/archive` | redirect, `pathMatch: 'full'` | `/archive/league-seasons` |
| `/archive/league-seasons` | lazy component | `LeagueSeasonListComponent` |
| `/archive/tournaments` | redirect, `pathMatch: 'full'` | `/archive/league-seasons` (temporary) |
| `/archive/league-seasons/:seasonId` | **not registered** | `**` → `NotFoundComponent` (next ticket) |
| `/leagues-archive**` | unchanged | unchanged |

### Produces — breadcrumbs

In `src/app/app-breadcrumbs.ts`, inserted immediately **before** the line
`if (segments[0] !== 'leagues-archive') return [{ label: menu, link: ['/'] }, { label: t('nav.notFound') }];`:

```ts
  if (segments[0] === 'archive') return [{ label: menu, link: ['/'] }, { label: t('crumb.archive') }];
```

Post-condition: `buildBreadcrumbs('/archive')`, `buildBreadcrumbs('/archive/league-seasons')` and
`buildBreadcrumbs('/archive/league-seasons?sort=name')`'s path portion all answer
`[{ label: 'Menu', link: ['/'] }, { label: 'Archive' }]` in EN and
`[{ label: 'Menu', link: ['/'] }, { label: 'Archive' }]` in FR. No League or Season is fetched: the
function's `getLeague` lookup is not called for an `archive` path.

### Produces — i18n keys

Added at the end of the `en` block (before `} as const;`) and at the end of the `fr` block (before
its closing `};`), in this order in both.

| Key | `en` | `fr` |
| --- | --- | --- |
| `crumb.archive` | `Archive` | `Archive` |
| `archive.title` | `Archive` | `Archive` |
| `archive.tabsAria` | `Archive sections` | `Sections de l’archive` |
| `archive.tabLeagueSeasons` | `League Seasons` | `Saisons de ligue` |
| `archive.tabTournaments` | `Tournaments` | `Tournois` |
| `archive.seasonsAria` | `League Seasons` | `Saisons de ligue` |
| `archive.colSeasonLeague` | `Season / League` | `Saison / Ligue` |
| `archive.colLastPlayedUpdated` | `Last played / Updated` | `Dernier tournoi / Mise à jour` |
| `archive.colTournamentsPlayers` | `Tourn. / Players` | `Tournois / Joueurs` |
| `archive.colStatus` | `Status` | `Statut` |
| `archive.sortByAria` | `Sort by {column}` | `Trier par {column}` |
| `archive.sortLabel` | `Sort` | `Tri` |
| `archive.sortName` | `Season name` | `Nom de la saison` |
| `archive.sortLeagueName` | `League name` | `Nom de la ligue` |
| `archive.sortLastPlayed` | `Last played` | `Dernier tournoi` |
| `archive.sortUpdated` | `Updated` | `Mise à jour` |
| `archive.sortTournaments` | `Tournaments` | `Tournois` |
| `archive.sortPlayers` | `Players` | `Joueurs` |
| `archive.sortStatus` | `Status` | `Statut` |
| `archive.ascending` | `ascending` | `croissant` |
| `archive.descending` | `descending` | `décroissant` |
| `archive.directionToggleAria` | `Change sort direction, currently {direction}` | `Changer le sens du tri, actuellement {direction}` |
| `archive.searchLabel` | `Search` | `Rechercher` |
| `archive.searchPlaceholder` | `Season or League name…` | `Nom de saison ou de ligue…` |
| `archive.leagueFilterLabel` | `League` | `Ligue` |
| `archive.leagueFilterAll` | `All Leagues` | `Toutes les ligues` |
| `archive.sizeLabel` | `Rows` | `Lignes` |
| `archive.updatedPrefix` | `upd. {date}` | `maj {date}` |
| `archive.tournamentsValue` | `{count} tourn.` | `{count} tourn.` |
| `archive.playersValue` | `{count} players` | `{count} joueurs` |
| `archive.unknownLeague` | `Unknown League` | `Ligue inconnue` |
| `archive.lockedAria` | `Locked` | `Verrouillée` |
| `archive.lockedTitle` | `Locked — every Tournament of this Season is more than 365 days old` | `Verrouillée — tous les tournois de cette saison ont plus de 365 jours` |
| `archive.openSeasonAria` | `Open Season {name}` | `Ouvrir la saison {name}` |
| `archive.pageStatus` | `Page {page} of {total} · {count} Seasons` | `Page {page} sur {total} · {count} saisons` |
| `archive.pageIndicator` | `Page {page} of {total}` | `Page {page} sur {total}` |
| `archive.paginationAria` | `League Season list pagination` | `Pagination de la liste des saisons de ligue` |
| `archive.emptyTitle` | `No League Season yet` | `Aucune saison de ligue` |
| `archive.emptyBody` | `The archive holds no League Season.` | `L’archive ne contient aucune saison de ligue.` |
| `archive.emptySearchTitle` | `No Season matches “{search}”` | `Aucune saison ne correspond à «\u00a0{search}\u00a0»` |
| `archive.emptySearchBody` | `Try a different search, or clear the League filter.` | `Essayez une autre recherche ou effacez le filtre de ligue.` |
| `archive.truncatedSeasons` | `This archive holds more League Seasons than one catalog request returns. Only the {shown} most recently updated are listed.` | `Cette archive contient plus de saisons de ligue qu’une seule requête ne peut renvoyer. Seules les {shown} les plus récemment mises à jour sont listées.` |
| `archive.loadFailed` | `Could not load the Archive. Check connection, then retry.` | `Impossible de charger l’archive. Vérifiez la connexion puis réessayez.` |

`sortLabel(key)` maps `name → archive.sortName`, `leagueName → archive.sortLeagueName`,
`lastPlayed → archive.sortLastPlayed`, `updated → archive.sortUpdated`,
`tournaments → archive.sortTournaments`, `players → archive.sortPlayers`,
`status → archive.sortStatus`. `columnLabel(column)` maps
`seasonLeague → archive.colSeasonLeague`, `datesUpdated → archive.colLastPlayedUpdated`,
`counts → archive.colTournamentsPlayers`, `status → archive.colStatus`.

**No existing key is renamed or deleted.** The `archive.*` namespace already holds six legacy keys
(`archive.tournamentActive`, `archive.tournamentCompleted`, `archive.markComplete`, `archive.reopen`,
`archive.completeConfirm`, `archive.reopenConfirm`, `src/app/i18n/messages.ts:567-572` and
`1808-1813`). None of the keys above collides with them. Status chips reuse the existing
`common.active` / `common.completed`; the pager reuses `common.previous` / `common.next`; the search
clear reuses `common.clear`.

### Produces — frozen expansion contract for the next ticket

**Written here, not implemented here.** The Season row becomes expandable in the next ticket, and it
must do so by adding exactly this to the markup above and nothing else:

```html
  <!-- on the existing <tr>, replacing nothing -->
  <tr
    class="archive-row"
    [class.is-open]="isExpanded(row.id)"
    [attr.aria-expanded]="isExpanded(row.id)"
    [attr.aria-controls]="'archive-seasons-kids-' + row.id"
    (click)="toggleExpansion(row.id)"
    [attr.data-cy]="'archive-seasons-row-' + row.id"
  >
  <!-- a chevron as the first child of the name stack, before the link -->
  <span class="archive-chevron" aria-hidden="true" [attr.data-cy]="'archive-seasons-chevron-' + row.id">▸</span>
  <!-- and one sibling row per expanded Season -->
  <tr class="archive-kids" [id]="'archive-seasons-kids-' + row.id" [hidden]="!isExpanded(row.id)" [attr.data-cy]="'archive-seasons-kids-' + row.id">
    <td colspan="4" [attr.data-cy]="'archive-seasons-kids-cell-' + row.id"> … </td>
  </tr>
```

Binding rules the next ticket inherits: the **name cell is the link** and its click must
`stopPropagation()` so opening a Season does not also toggle its row; children render as **one
compact continuous clickable line** per Tournament — name (bold) · date · player count · status — not
a nested table; a Season whose years are not all cached fetches
`GET /api/archive/league-seasons/{id}/tournaments` and does **not** write the result to IndexedDB.

### Consumes

- From T5, verbatim, do not redesign: `ArchiveCatalogResponse<T>`, `ArchiveLeagueSummary`,
  `ArchiveLeagueSeasonSummary` as reproduced under `Inputs → From Depends`.
- From T10, verbatim, do not redesign: `isArchiveTournamentLocked(tournamentDate: string, now?: Date): boolean`
  and `LeagueStatus` from `src/app/domain/archive-models.ts`; `ArchiveLeagueSummary` and
  `ArchiveLeagueSeasonSummary` from `src/app/data/archive-summary.ts`.
- From T12, verbatim, do not redesign: `ArchiveRepository.listLeagueCatalog` and
  `ArchiveRepository.listLeagueSeasonCatalog` as reproduced under `Inputs → From Depends`.
- From the existing codebase, unchanged: `CatalogResult<T>` (`src/app/shared/catalog-cache.ts:26-32`),
  `SyncBarComponent` (`src/app/shared/sync-bar.component.ts`, inputs `cyPrefix` required,
  `syncedAt`, `loading`, `stale`; output `sync`), `BackButtonComponent`
  (`src/app/shared/back-button.component.ts`, `@Input() link | label | position`), `I18nService`
  (`t`, `formatDate`, `plural`, `language`), `logBoundaryError`
  (`src/app/shared/app-logger.ts`).

### Errors

| Failure path | Behaviour |
| --- | --- |
| `listLeagueSeasonCatalog` rejects | `error` = `archive.loadFailed`, `.error[role=alert]`, `loading` false, table renders the empty state. `logBoundaryError('archive-league-season-list.load', reason)`. Nothing is thrown. |
| `listLeagueCatalog` rejects | Non-fatal. Seasons still render; `leagueName` is `''` and the cell prints `archive.unknownLeague`; the League filter select offers only "All Leagues"; `stale` is set true. `logBoundaryError('archive-league-season-list.load-leagues', reason)`. |
| either resolves with `stale: true` | `stale` true → the sync bar renders its offline banner. No error banner. |
| `truncated: true` on the Season catalog | `.warning[role=status]` with `archive.truncatedSeasons`. The table still renders the rows that arrived. |
| `?page=` beyond the last page | `currentPage()` clamps to `totalPages()`. The URL is **not** rewritten. |
| `?sort=`, `?dir=`, `?size=` unknown | Falls back to `lastPlayed` / `desc` / `25`. No error. |
| `?league=` naming an id absent from the League catalog | Falls back to `ALL_LEAGUES`. No error, no empty table. |
| `updatedAt` unparseable | Sorts as epoch `0`; `formatDate` returns the raw string (existing `I18nService.formatDate` behaviour). |
| `/archive/league-seasons/:id` visited | `**` route → `NotFoundComponent`. Expected until the next ticket. |

No exception type is defined or thrown by this ticket.

### Invariants

- **Query-string is the only state.** Every one of `sort`, `dir`, `page`, `size`, `search`, `league`
  is read from the URL on every navigation and written back through `router.navigate`. No control
  keeps a private copy. `searchDraft` is the debounce buffer only, and is re-synced from the URL on
  every `queryParamMap` emission.
- **Round trip.** `parseLeagueSeasonQuery(new URLSearchParams(leagueSeasonQueryParams(q)), ids)`
  equals `q` for every `q` whose `league` is in `ids`.
- **Default omission.** `leagueSeasonQueryParams(DEFAULT_LEAGUE_SEASON_QUERY)` is `{}`.
- **Read budget.** One page load issues exactly two catalog reads. A sort, a filter, a page change or
  a page-size change issues **zero**. Only `sync()` re-reads, and it passes `{ force: true }`.
- **Purity.** `buildLeagueSeasonRows`, `filterLeagueSeasonRows`, `sortLeagueSeasonRows`,
  `parseLeagueSeasonQuery`, `leagueSeasonQueryParams` and `toggleLeagueSeasonSort` never mutate an
  argument, never touch the DOM, never inject and never read the clock except through
  `buildLeagueSeasonRows`'s explicit `now` parameter.
- **Total ordering.** `sortLeagueSeasonRows` breaks every tie with `id` ascending, in both
  directions. `id` is the primary key, so the order is total and stable across runs.
- **Nulls last.** `lastTournamentDate === null` sorts after every non-null value in **both**
  directions.
- **Lock derivation.** `row.locked === (row.lastTournamentDate !== null && isArchiveTournamentLocked(row.lastTournamentDate, now))`.
  Never read from the wire, never cached across a day.
- **Paging.** `pagedRows().length <= query().size`; `pagedRows()` is
  `sortedRows().slice((currentPage()-1)*size, currentPage()*size)`; `totalPages() >= 1` even when
  `totalRows() === 0`; `1 <= currentPage() <= totalPages()`.
- **Filter before sort before page**, always in that order.
- **No mutation.** No file in this ticket calls a `POST`, `PATCH` or `DELETE` route, and
  `invalidateArchiveCaches()` is never called.
- **No storage.** Neither component names `localStorage`, `indexedDB` or an `IDB*` symbol.
  `src/app/backend/server-authority-boundary.test.ts:100-118` asserts an exact allowlist of files
  matching `/\bindexedDB\b|\bIDB[A-Z]\w*/` and would fail if either component appeared.
- **Legacy untouched.** `git diff --stat` after this ticket lists exactly seven files (see `Outputs`).
  None is under `src/app/features/leagues-archive/`, `src/app/features/tournaments-archive/`,
  `src/app/data/league-archive-*`, `cypress/` or `backend/`.

## TDD

1. **Red.** Write `src/app/features/archive/league-season-list.component.test.ts` and
   `src/app/features/archive/archive-shell.component.test.ts` first, with every test named below.
   Run `npm run test -- league-season-list archive-shell` and confirm they fail — at this point they
   fail on the missing modules, which is the correct red.
2. **Green.** Write `archive-shell.component.ts`, then `league-season-list.component.ts`, then the
   i18n keys, then the route entries, then the breadcrumb branch — the minimum that turns each named
   test green. Do not add behaviour no test names.
3. **Refactor.** Only if needed. Keep green. Re-run the whole suite, not just the two files:
   `data-cy-coverage.test.ts` and `message-namespace.test.ts` are global gates this ticket can break
   from a distance.

The harness, because this repo has **no TestBed and no zone.js**: pin the template with source-text
assertions read via `readFileSync`, and drive behaviour by constructing the component in a bare
`Injector` with `runInInjectionContext`, exactly as
`src/app/features/leagues-archive/league-archive-list.component.test.ts:1-24,214-244` and
`src/app/app-breadcrumbs.test.ts:1-12` do. Both test files must open with:

```ts
import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// No TestBed / zone.js in this repo, so `effect()` — which drags `ChangeDetectionScheduler` into
// I18nService — is stubbed and the component is built in a bare Injector.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});
```

## Test plan

Run with `npm run test`. Targeted: `npx vitest run src/app/features/archive`.

### `src/app/features/archive/archive-shell.component.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `renders both tabs, always` | source text | contains `data-cy="archive-tab-league-seasons"` and `data-cy="archive-tab-tournaments"`, each exactly once |
| `the tabs are links, not buttons` | source text | matches `routerLink="/archive/league-seasons"` and `routerLink="/archive/tournaments"` |
| `marks the active tab with aria-current` | source text | contains `activeTab() === 'league-seasons' ? 'page' : null` and `activeTab() === 'tournaments' ? 'page' : null` |
| `the tab strip is a labelled nav` | source text | contains `<nav class="archive-tabs"` and `i18n.t('archive.tabsAria')` |
| `renders the sync bar with the archive prefix` | source text | contains `cyPrefix="archive"` and `(sync)="sync.emit()"` |
| `projects the tab body` | source text | contains `<ng-content />` |
| `owns no data` | source text | does **not** match `ArchiveRepository`, `inject(Router`, `signal(`, `fetch(` |
| `hardcodes no colour` | source text | does not match `/#[0-9a-fA-F]{3,8}\b\|rgb\(\|hsl\(\|oklch\(/` |

### `src/app/features/archive/league-season-list.component.test.ts`

**`parseLeagueSeasonQuery`**

| Test | Input | Expect |
| ---- | ----- | ------ |
| `defaults an empty query string` | `new URLSearchParams('')` | `{ sort: 'lastPlayed', dir: 'desc', page: 1, size: 25, search: '', league: 'all' }` |
| `reads every parameter` | `'sort=players&dir=asc&page=3&size=50&search=lyon&league=lg-1'`, ids `['lg-1']` | `{ sort:'players', dir:'asc', page:3, size:50, search:'lyon', league:'lg-1' }` |
| `rejects an unknown sort key` | `'sort=rating'` | `sort === 'lastPlayed'` |
| `accepts all seven sort keys` | each of `name leagueName lastPlayed updated tournaments players status` | `sort` equals the input, for all seven |
| `rejects an unknown direction` | `'dir=sideways'` | `dir === 'desc'` |
| `rejects a page size off the menu` | `'size=30'` | `size === 25` |
| `accepts 25, 50 and 100` | `'size=25' \| 'size=50' \| 'size=100'` | `25 \| 50 \| 100` |
| `rejects a non-integer or zero page` | `'page=0'`, `'page=-2'`, `'page=abc'`, `'page=1.5'` | `page === 1` for all four |
| `trims the search term` | `'search=%20lyon%20'` | `search === 'lyon'` |
| `drops a League id the catalog does not know` | `'league=ghost'`, ids `['lg-1']` | `league === 'all'` |
| `drops any League id when no catalog has landed` | `'league=lg-1'`, no ids argument | `league === 'all'` |

**`leagueSeasonQueryParams`**

| Test | Input | Expect |
| ---- | ----- | ------ |
| `omits every default` | `DEFAULT_LEAGUE_SEASON_QUERY` | `{}` |
| `emits only what differs` | `{ ...default, page: 2, search: 'x' }` | `{ page: 2, search: 'x' }` |
| `round-trips` | `{ sort:'players', dir:'asc', page:3, size:50, search:'lyon', league:'lg-1' }` | `parseLeagueSeasonQuery(new URLSearchParams(params as Record<string,string>), new Set(['lg-1']))` deep-equals the input |

**`toggleLeagueSeasonSort`**

| Test | Input | Expect |
| ---- | ----- | ------ |
| `a new key starts descending` | default query, `'name'` | `{ sort:'name', dir:'desc', page:1 }` |
| `the same key flips to ascending` | `{ sort:'name', dir:'desc' }`, `'name'` | `dir === 'asc'` |
| `the same key flips back to descending` | `{ sort:'name', dir:'asc' }`, `'name'` | `dir === 'desc'` |
| `any sort change returns to page 1` | `{ ...default, page: 7 }`, `'players'` | `page === 1` |

**`buildLeagueSeasonRows`**

| Test | Input | Expect |
| ---- | ----- | ------ |
| `joins the League name onto the Season row` | season `leagueId:'lg-1'`, league `{id:'lg-1',name:'Ligue Lyon'}` | `rows[0].leagueName === 'Ligue Lyon'` |
| `leaves the League name blank when the League is missing` | season `leagueId:'lg-9'`, leagues `[]` | `rows[0].leagueName === ''` |
| `a Season with no Tournament is never locked` | `lastTournamentDate: null` | `locked === false` |
| `a Season whose latest Tournament is 400 days old is locked` | `lastTournamentDate` = `now - 400d`, `now = 2026-08-22T00:00:00Z` | `locked === true` |
| `a Season whose latest Tournament is 365 days old is not locked` | `lastTournamentDate` = `now - 365d` | `locked === false` |
| `a Season whose latest Tournament is 366 days old is locked` | `lastTournamentDate` = `now - 366d` | `locked === true` |
| `carries every catalog field through untouched` | full summary | `rows[0]` contains the same `id`, `name`, `leagueId`, `status`, `updatedAt`, `documentVersion`, `tournamentCount`, `playerCount`, `firstTournamentDate`, `lastTournamentDate` |

**`filterLeagueSeasonRows`**

| Test | Input | Expect |
| ---- | ----- | ------ |
| `no filter returns every row in order` | `{ search:'', league:'all' }` | same ids, same order |
| `filters by League id` | `{ search:'', league:'lg-1' }` | only rows whose `leagueId === 'lg-1'` |
| `matches the Season name, case-insensitively` | `{ search:'LYON', league:'all' }` | the row named `Ligue Lyon 2026` |
| `matches the League name too` | Season `Étape 12`, League `Ligue Lyon`, `search:'lyon'` | that row is kept |
| `combines the League filter and the search` | `{ search:'2026', league:'lg-1' }` | only rows satisfying both |
| `an unmatched search returns nothing` | `{ search:'vintage', league:'all' }` | `[]` |

**`sortLeagueSeasonRows`**

| Test | Input | Expect |
| ---- | ----- | ------ |
| `sorts by lastPlayed descending by default` | three rows | newest `lastTournamentDate` first |
| `sorts by lastPlayed ascending` | same, `'asc'` | oldest first |
| `a Season with no Tournament sorts last descending` | one row `lastTournamentDate: null` | the null row is last |
| `a Season with no Tournament sorts last ascending too` | same, `'asc'` | the null row is still last |
| `sorts names naturally, not lexically` | `Season 2`, `Season 10` | ascending gives `['Season 2','Season 10']` |
| `folds accents when sorting names` | `Étape`, `Etape B` | adjacent, no crash |
| `sorts by tournaments numerically` | counts `2, 10` | ascending gives `[2, 10]` |
| `sorts by players numerically` | counts `9, 84` | ascending gives `[9, 84]` |
| `sorts by updated chronologically` | two instants | descending gives the newer first |
| `sorts by leagueName` | `Circuit`, `Ligue` | ascending gives `['Circuit','Ligue']` |
| `sorts by status` | `active`, `completed` | ascending gives `['active','completed']` |
| `breaks every tie on id ascending, in both directions` | two rows, identical `tournamentCount`, ids `b`, `a` | `['a','b']` for `asc` **and** for `desc` |
| `never mutates the input array` | frozen input | `Object.isFrozen` input unchanged, result is a new array |

**Component behaviour (bare `Injector`)**

| Test | Input | Expect |
| ---- | ----- | ------ |
| `loads both catalogs once on construction` | stub repo | `listLeagueSeasonCatalog` and `listLeagueCatalog` each called exactly once |
| `clears loading and publishes the sync stamp` | catalogs resolve `fetchedAt:'2026-08-20T10:00:00.000Z'` | `loading() === false`, `syncedAt() === '2026-08-20T10:00:00.000Z'` |
| `surfaces a truncated Season catalog` | `truncated: true` | `truncated() === true` |
| `surfaces a stale read` | `stale: true` | `stale() === true` |
| `renders the failure message when the Season catalog rejects` | Season read rejects | `error() === 'Could not load the Archive. Check connection, then retry.'`, `loading() === false`, no throw |
| `survives a failed League catalog` | League read rejects, Seasons resolve | `error() === ''`, `rows().length` equals the Season count, `rows()[0].leagueName === ''`, `stale() === true` |
| `sync forces a refetch` | call `sync()` | both repo methods called with `{ force: true }` |
| `pages to 25 rows by default` | 60 Seasons | `pagedRows().length === 25`, `totalPages() === 3`, `currentPage() === 1` |
| `a page beyond the end clamps without navigating` | 5 Seasons, `?page=9` | `currentPage() === 1`, `pagedRows().length === 5`, `router.navigate` not called |
| `the second page holds different rows` | 60 Seasons, `?page=2` | no id from page 1 appears |
| `sortByColumn navigates on the column's first key` | click `datesUpdated` while sorted by `lastPlayed desc` | `router.navigate` called with `{ sort: undefined-or-omitted, dir: 'asc' }` — i.e. `queryParams` deep-equals `{ dir: 'asc' }` |
| `sortByColumn on a new column starts descending and omits the default` | click `counts` | `queryParams` deep-equals `{ sort: 'tournaments' }` |
| `ariaSort marks the column that owns the active key` | `?sort=updated&dir=asc` | `ariaSort('datesUpdated') === 'ascending'`, `ariaSort('seasonLeague') === null` |
| `ariaSort marks nothing else` | `?sort=players` | `ariaSort('counts') === 'descending'`, all three others `null` |
| `setSort keeps the direction and returns to page 1` | `?sort=name&dir=asc&page=4`, `setSort('players')` | `queryParams` deep-equals `{ sort: 'players', dir: 'asc' }` |
| `toggleDirection flips and returns to page 1` | `?page=4`, `toggleDirection()` | `queryParams` deep-equals `{ dir: 'asc' }` |
| `setLeague navigates and returns to page 1` | `setLeague('lg-1')` with `lg-1` in the catalog | `queryParams` deep-equals `{ league: 'lg-1' }` |
| `setSize navigates and returns to page 1` | `setSize(50)` | `queryParams` deep-equals `{ size: 50 }` |
| `search is debounced by 300 ms` | `vi.useFakeTimers()`, `setSearchDraft('ly')` | `router.navigate` not called before 299 ms, called once at 300 ms with `{ search: 'ly' }` |
| `a second keystroke restarts the debounce` | `setSearchDraft('l')` then at 200 ms `setSearchDraft('ly')` | exactly one navigation, carrying `search: 'ly'` |
| `clearSearch empties the draft and the query` | `clearSearch()` after a term | `searchDraft() === ''`, navigation `queryParams` deep-equals `{}` |
| `ngOnDestroy cancels a pending debounce` | `setSearchDraft('x')`, `ngOnDestroy()`, advance 500 ms | `router.navigate` never called |
| `filtered() is false with no filter and true with either` | default; `?search=x`; `?league=lg-1` | `false`, `true`, `true` |
| `filterLabel quotes the search term when there is one` | `?search=vintage&league=lg-1` | `filterLabel() === 'vintage'` |
| `filterLabel quotes the filtered League's name when there is no search` | `?league=lg-1`, League named `Ligue Lyon` | `filterLabel() === 'Ligue Lyon'` |
| `filterLabel is empty with no filter at all` | default | `filterLabel() === ''` |
| `formatDate renders an em dash for a null date` | `formatDate(null)` | `'—'` |
| `leagueLabel falls back to the unknown-League message` | row with `leagueName: ''` | `'Unknown League'` in EN |
| `statusLabel translates both statuses` | `active`, `completed` | `'Active'`, `'Completed'` in EN; `'Active'`, `'Terminée'` in FR |

**Template (source-text assertions)**

| Test | Expect |
| ---- | ------ |
| `renders exactly four header cells` | `source.match(/<th /g)` has length `4` |
| `each header carries aria-sort and a real button` | contains `[attr.aria-sort]="ariaSort('seasonLeague')"`, `…('datesUpdated')`, `…('counts')`, `…('status')`, and four `class="archive-sort-button"` occurrences of `type="button"` |
| `the header labels are the paired ones` | contains `archive.colSeasonLeague`, `archive.colLastPlayedUpdated`, `archive.colTournamentsPlayers`, `archive.colStatus` |
| `the Season name cell is the link` | contains `[routerLink]="['/archive/league-seasons', row.id]"` inside the block opened by `'archive-seasons-cell-name-'` |
| `the row itself is not interactive in this slice` | source does **not** contain `aria-expanded`, `toggleExpansion`, `archive-seasons-chevron`, `archive-seasons-kids` |
| `every row carries both values of all three paired cells` | contains `archive-seasons-league-`, `archive-seasons-updated-`, `archive-seasons-players-` |
| `the lock marker is visible on a locked row and only there` | `source.match(/data-cy]="'archive-seasons-lock-/g)` has length `1`, and the block opened by `@if (row.locked) {` contains it |
| `the lock marker is announced` | contains `role="img"` and `i18n.t('archive.lockedAria')` |
| `the status chip reuses the shared classes` | contains `class="status"` and `class="status-dot"` |
| `the skeleton renders five rows inside the real table` | contains `@for (index of skeletonRows; track index)` and `skeletonRows = [0, 1, 2, 3, 4]` |
| `the empty state spans all four columns` | contains `colspan="4"` |
| `the empty state distinguishes a filtered miss from an empty archive` | contains `archive.emptySearchTitle` and `archive.emptyTitle` |
| `the truncation warning is a status region` | contains `class="warning" role="status"` and `archive.truncatedSeasons` |
| `the load failure is an alert` | contains `class="error" role="alert"` |
| `the page status is a live region` | contains `aria-live="polite"` beside `archive-seasons-page-status` |
| `previous is disabled on page 1 and next on the last page` | matches `[disabled]="currentPage() <= 1"` and `[disabled]="currentPage() >= totalPages()"` |
| `the pager nav is labelled` | contains `i18n.t('archive.paginationAria')` |
| `every select is labelled by a real label element` | contains `for="archive-seasons-search"`, `for="archive-seasons-league"`, `for="archive-seasons-sort"`, `for="archive-seasons-size"` |
| `the sort select offers all seven keys` | contains `@for (key of sortKeys; track key)` and `sortKeys = LEAGUE_SEASON_SORT_KEYS` |
| `hardcodes no colour` | source does not match `/#[0-9a-fA-F]{3,8}\b\|rgb\(\|hsl\(\|oklch\(/` |
| `the table keeps the shared wrapper classes` | contains `class="table-wrap"` and `class="ranking-table archive-table"` |
| `names no browser store` | source does not match `/localStorage\|indexedDB\|IDB[A-Z]/` |
| `calls no mutation` | source does not match `/createLeagueSeason\|invalidateArchiveCaches\|deleteLeagueSeason/` |

**Routes**

| Test | Expect |
| ---- | ------ |
| `registers the archive index redirect` | `buildRoutes({authV1:true,adminV1:true})` has `{ path: 'archive', pathMatch: 'full', redirectTo: 'archive/league-seasons' }` |
| `registers the League Seasons tab` | a route with `path === 'archive/league-seasons'` and a `loadComponent` function |
| `registers the Tournaments tab as a placeholder redirect` | route `path === 'archive/tournaments'` with `redirectTo === 'archive/league-seasons'` |
| `does not register the Season detail route yet` | no route with `path === 'archive/league-seasons/:seasonId'` |
| `leaves every legacy archive route in place` | the five paths `leagues-archive`, `leagues-archive/:leagueId`, `leagues-archive/:leagueId/tournaments-archive/:tournamentId`, `…/result`, `…/result/metagames` are all still present |
| `leaves the legacy redirects in place` | routes `leagues` and `leagues/:leagueId` still present |
| `archive routes are registered whatever the capability flags` | both `{authV1:false,adminV1:false}` and `{authV1:true,adminV1:true}` expose all three |

**Breadcrumbs**

| Test | Expect |
| ---- | ------ |
| `labels /archive as Archive in EN` | `buildBreadcrumbs('/archive', en)` → labels `['Menu','Archive']` |
| `labels /archive/league-seasons as Archive in EN` | labels `['Menu','Archive']`, second crumb has no `link` |
| `labels /archive in FR` | `buildBreadcrumbs('/archive/league-seasons')` → labels `['Menu','Archive']` |
| `does not fall through to Not Found` | no crumb label equals `'Not Found'` or `'Introuvable'` |
| `leaves the legacy archive breadcrumb intact` | `buildBreadcrumbs('/leagues-archive', en)` → `['Menu','Leagues Archive']` |

**i18n**

| Test | Expect |
| ---- | ------ |
| `every new key exists in en and fr` | for each of the 43 keys in the table above, `catalogs.en[key]` and `catalogs.fr[key]` are truthy |
| `no new key is left as its English text in French` | for the four keys `archive.tabLeagueSeasons`, `archive.searchPlaceholder`, `archive.emptyTitle`, `archive.loadFailed`, `catalogs.fr[key] !== catalogs.en[key]` |
| `the interpolations survive translation` | `catalogs.fr['archive.pageStatus']` contains `{page}`, `{total}` and `{count}`; `catalogs.fr['archive.updatedPrefix']` contains `{date}`; `catalogs.fr['archive.openSeasonAria']` contains `{name}` |
| `no legacy archive key was replaced` | `catalogs.en['archive.markComplete']` and `catalogs.en['archive.reopen']` still equal `'Mark complete'` and `'Reopen'` |

## Impl steps

- [ ] 1. Red — the shell test
  - [ ] 1.1 Create `src/app/features/archive/archive-shell.component.test.ts` with the eight tests named in `Test plan → archive-shell.component.test.ts`, opening with the `import '@angular/compiler';` + `vi.mock('@angular/core', …)` preamble from `TDD`, and `const source = readFileSync(join(__dirname, 'archive-shell.component.ts'), 'utf8');`.
  - [ ] 1.2 Run `npx vitest run src/app/features/archive/archive-shell.component.test.ts` and confirm it fails on the missing module.
- [ ] 2. Red — the list test
  - [ ] 2.1 Create `src/app/features/archive/league-season-list.component.test.ts` with the same preamble, `const source = readFileSync(join(__dirname, 'league-season-list.component.ts'), 'utf8');`, and every test named in `Test plan → league-season-list.component.test.ts` — pure-function, component-behaviour, template, routes, breadcrumbs and i18n blocks.
  - [ ] 2.2 In that file, add the shared fixtures: `function seasonSummary(overrides: Partial<ArchiveLeagueSeasonSummary> = {}): ArchiveLeagueSeasonSummary` defaulting to `{ id: 's-1', name: 'Ligue Lyon 2026', leagueId: 'lg-1', status: 'active', updatedAt: '2026-08-18T10:00:00.000Z', documentVersion: 1, tournamentCount: 12, playerCount: 84, firstTournamentDate: '2026-01-12', lastTournamentDate: '2026-08-17' }`, and `function leagueSummary(overrides: Partial<ArchiveLeagueSummary> = {}): ArchiveLeagueSummary` defaulting to `{ id: 'lg-1', name: 'Ligue Lyon', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z', documentVersion: 1 }`.
  - [ ] 2.3 In that file, add the component harness: `function buildComponent(options: { seasons?: ArchiveLeagueSeasonSummary[]; leagues?: ArchiveLeagueSummary[]; query?: string; language?: SettingsLanguage; seasonsError?: unknown; leaguesError?: unknown } = {})` building an `Injector.create({ providers: [ { provide: ArchiveRepository, useValue: repo }, { provide: ActivatedRoute, useValue: { queryParamMap: of(new URLSearchParams(options.query ?? '')) } }, { provide: Router, useValue: router }, { provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>(options.language ?? 'en') } }, I18nService ] })` and returning `{ component: runInInjectionContext(injector, () => new LeagueSeasonListComponent()), repo, router }`. `router` is `{ navigate: vi.fn(async () => true) }`. `of(...)` comes from `rxjs`; a `URLSearchParams` satisfies the `.get()` shape the component reads.
  - [ ] 2.4 Add `function settled(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 0)); }` and await it after `buildComponent` in every behaviour test, matching `league-archive-list.component.test.ts:207-209`.
  - [ ] 2.5 Run `npx vitest run src/app/features/archive` and confirm both files fail on missing modules.
- [ ] 3. Green — the two components
  - [ ] 3.1 Create `src/app/features/archive/archive-shell.component.ts` with the class, template and styles reproduced verbatim in `Interface contract → Produces — src/app/features/archive/archive-shell.component.ts`.
  - [ ] 3.2 Create `src/app/features/archive/league-season-list.component.ts` with, in this order: the imports; the module-level constants and types from `Interface contract → Produces — src/app/features/archive/league-season-list.component.ts`; the six exported pure functions with the bodies given there; the private helpers `compareLeagueSeasonBy`, `instantValue`, `compareNumbers`, `compareOrdinal`, `NAME_COLLATOR`.
  - [ ] 3.3 In the same file, add the `@Component` decorator with `selector: 'gones-league-season-list'`, `standalone: true`, `imports: [FormsModule, RouterLink, ArchiveShellComponent, BackButtonComponent]`, the `template` reproduced verbatim in `Interface contract → Produces — the Variant B row`, and the `styles` reproduced verbatim after it.
  - [ ] 3.4 In the same file, add `export class LeagueSeasonListComponent implements OnDestroy` with every field, computed and method from the class signature and the verbatim method bodies, plus `readonly allLeagues = ALL_LEAGUES;` and `private readonly routeParams = signal<{ get(key: string): string | null } | null>(null);`.
  - [ ] 3.5 In the same file, add `sortLabel(key: LeagueSeasonSortKey): string` returning `this.i18n.t(LEAGUE_SEASON_SORT_LABEL_KEYS[key])` and `columnLabel(column: LeagueSeasonColumn): string` returning `this.i18n.t(LEAGUE_SEASON_COLUMN_LABEL_KEYS[column])`, with the two module-level maps `const LEAGUE_SEASON_SORT_LABEL_KEYS: Record<LeagueSeasonSortKey, MessageKey> = { name: 'archive.sortName', leagueName: 'archive.sortLeagueName', lastPlayed: 'archive.sortLastPlayed', updated: 'archive.sortUpdated', tournaments: 'archive.sortTournaments', players: 'archive.sortPlayers', status: 'archive.sortStatus' };` and `const LEAGUE_SEASON_COLUMN_LABEL_KEYS: Record<LeagueSeasonColumn, MessageKey> = { seasonLeague: 'archive.colSeasonLeague', datesUpdated: 'archive.colLastPlayedUpdated', counts: 'archive.colTournamentsPlayers', status: 'archive.colStatus' };` (`MessageKey` imported from `../../i18n/messages`).
  - [ ] 3.6 Import list of `league-season-list.component.ts`, exact: `import { Component, OnDestroy, Signal, computed, inject, signal } from '@angular/core';`, `import { FormsModule } from '@angular/forms';`, `import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';`, `import { ArchiveRepository } from '../../data/archive-repository.service';`, `import { ArchiveLeagueSeasonSummary, ArchiveLeagueSummary } from '../../data/archive-summary';`, `import { LeagueStatus, isArchiveTournamentLocked } from '../../domain/archive-models';`, `import { I18nService } from '../../i18n/i18n.service';`, `import { MessageKey } from '../../i18n/messages';`, `import { logBoundaryError } from '../../shared/app-logger';`, `import { BackButtonComponent } from '../../shared/back-button.component';`, `import { ArchiveShellComponent } from './archive-shell.component';`.
- [ ] 4. Green — routes
  - [ ] 4.1 In `src/app/app.routes.ts`, inside `buildRoutes`, insert `{ path: 'archive', pathMatch: 'full', redirectTo: 'archive/league-seasons' },` on the line immediately above the existing `{ path: 'leagues-archive', loadComponent: () => import('./features/leagues-archive/league-archive-list.component')…` entry.
  - [ ] 4.2 Immediately below it, insert `{ path: 'archive/league-seasons', loadComponent: () => import('./features/archive/league-season-list.component').then((m) => m.LeagueSeasonListComponent) },`.
  - [ ] 4.3 Immediately below that, insert the placeholder with its comment: `// Placeholder until the Tournaments tab ships: the tab strip links here, and bouncing back to the` / `// Seasons tab beats sending the click to the 404 page. Replaced by a \`loadComponent\` entry then.` / `{ path: 'archive/tournaments', pathMatch: 'full', redirectTo: 'archive/league-seasons' },`.
  - [ ] 4.4 Change nothing else in this file. The `archiveRedirectRoutes()` function and every `leagues-archive` entry stay byte-identical.
- [ ] 5. Green — breadcrumbs
  - [ ] 5.1 In `src/app/app-breadcrumbs.ts`, insert `  if (segments[0] === 'archive') return [{ label: menu, link: ['/'] }, { label: t('crumb.archive') }];` on the line immediately **above** `if (segments[0] !== 'leagues-archive') return [{ label: menu, link: ['/'] }, { label: t('nav.notFound') }];`.
  - [ ] 5.2 Change nothing else in this file.
- [ ] 6. Green — i18n
  - [ ] 6.1 In `src/app/i18n/messages.ts`, insert the 43 English entries from `Interface contract → Produces — i18n keys`, in that order, immediately before the `} as const;` that closes `const en`, under the comment `  // Archive (three-tier rebuild)`.
  - [ ] 6.2 Insert the 43 French entries, in the same order, immediately before the `};` that closes `const fr`.
  - [ ] 6.3 Run `npx vitest run src/app/i18n` and confirm `message-namespace.test.ts` still reports identical key sets.
- [ ] 7. Green — the whole suite
  - [ ] 7.1 Run `npx vitest run src/app/features/archive` and confirm every named test passes.
  - [ ] 7.2 Run `npm run test` and confirm `src/app/shared/data-cy-coverage.test.ts` passes; if it reports a missing `data-cy`, add one to the named tag rather than exempting it, and if it reports a duplicate, rename the later occurrence.
  - [ ] 7.3 Run `npm run typecheck`.
  - [ ] 7.4 Run `npm run lint`.
  - [ ] 7.5 Run `npm run build`.
- [ ] 8. Manual verification against a running stack
  - [ ] 8.1 `npm run db:reset && npm run dev` in one terminal.
  - [ ] 8.2 Create a League: `curl -sS -X POST http://127.0.0.1:5000/api/archive/leagues -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"name":"Ligue Lyon"}'` and keep the returned `id` as `$LEAGUE`.
  - [ ] 8.3 Create two Seasons: `curl -sS -X POST http://127.0.0.1:5000/api/archive/league-seasons -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d "{\"leagueId\":\"$LEAGUE\",\"name\":\"Ligue Lyon 2026\",\"status\":\"active\"}"` and again with `"Ligue Lyon 2025"` / `"completed"`.
  - [ ] 8.4 Open `http://127.0.0.1:4200/archive` and confirm it lands on `/archive/league-seasons`, the tab strip shows both tabs with League Seasons selected, and both Seasons render as two-line rows.
  - [ ] 8.5 Click each of the four headers and confirm the URL gains `?sort=…&dir=…`, the arrow moves, and `aria-sort` is set on exactly one header (inspect the element).
  - [ ] 8.6 Reload the URL produced in 8.5 and confirm the table comes back in the same order.
  - [ ] 8.7 Tab to a header button with the keyboard and press Enter; confirm the sort changes.
  - [ ] 8.8 Type `vintage` in the search box, confirm the empty state appears after ~300 ms and the URL carries `?search=vintage`; clear it and confirm the rows return.
  - [ ] 8.9 Set the League filter to `Ligue Lyon`, confirm `?league=<id>` appears; hand-edit the URL to `?league=ghost` and confirm the full list returns rather than an empty table.
  - [ ] 8.10 Throttle the network in devtools and reload; confirm five skeleton rows render inside the table and the layout does not jump when the real rows arrive.
  - [ ] 8.11 At 375 px width, confirm the table does not scroll horizontally.
  - [ ] 8.12 Confirm the breadcrumb reads `Menu › Archive`, and switch the language to French and confirm it still does and every visible string is French.
  - [ ] 8.13 Click the Tournaments tab and confirm it returns to `/archive/league-seasons` rather than the 404 page.
  - [ ] 8.14 Confirm `/leagues-archive` still renders the legacy card grid untouched.

## Outputs

**Files created**

- `src/app/features/archive/archive-shell.component.ts`
- `src/app/features/archive/archive-shell.component.test.ts`
- `src/app/features/archive/league-season-list.component.ts`
- `src/app/features/archive/league-season-list.component.test.ts`

**Files modified**

- `src/app/app.routes.ts` — three route entries added inside `buildRoutes`. Nothing removed.
- `src/app/app-breadcrumbs.ts` — one `if (segments[0] === 'archive')` branch added. Nothing removed.
- `src/app/i18n/messages.ts` — 43 keys added to `en`, the same 43 added to `fr`. Nothing removed.

**Public API / behaviour change**

- New pages: `/archive` (redirects), `/archive/league-seasons` (renders), `/archive/tournaments`
  (redirects, temporarily).
- New exported symbols, all from `src/app/features/archive/`: `ArchiveTab`, `ArchiveShellComponent`,
  `LEAGUE_SEASON_PAGE_SIZES`, `LeagueSeasonPageSize`, `DEFAULT_LEAGUE_SEASON_PAGE_SIZE`,
  `LEAGUE_SEASON_SORT_KEYS`, `LeagueSeasonSortKey`, `DEFAULT_LEAGUE_SEASON_SORT`,
  `DEFAULT_LEAGUE_SEASON_DIRECTION`, `LeagueSeasonColumn`, `LEAGUE_SEASON_COLUMN_KEYS`,
  `LEAGUE_SEASON_COLUMN_PRIMARY`, `ALL_LEAGUES`, `ARCHIVE_SEARCH_DEBOUNCE_MS`, `LeagueSeasonQuery`,
  `DEFAULT_LEAGUE_SEASON_QUERY`, `LeagueSeasonRow`, `parseLeagueSeasonQuery`,
  `leagueSeasonQueryParams`, `toggleLeagueSeasonSort`, `buildLeagueSeasonRows`,
  `filterLeagueSeasonRows`, `sortLeagueSeasonRows`, `LeagueSeasonListComponent`.
- No existing exported symbol changes name, signature or behaviour.

**Migrate / config**

- None. No database migration, no configuration key, no environment variable, no generated API
  client change.

## Validation

- [ ] tests pass:
  - `npx vitest run src/app/features/archive` — every named test green.
  - `npm run test` — whole suite green, exit code `0`. `src/app/shared/data-cy-coverage.test.ts` and
    `src/app/i18n/message-namespace.test.ts` in particular.
  - `npm run typecheck` — exit code `0`, no output.
  - `npm run lint` — exit code `0`, no findings.
  - `npm run build` — exit code `0`, bundle written.
- [ ] manual check (UI): `Impl steps` 8.1-8.14, all fourteen observed.
- [ ] app functional — no broken path from this slice:
  - `git diff --stat` lists exactly the seven files under `Outputs`.
  - `git diff -- src/app/features/leagues-archive src/app/features/tournaments-archive src/app/data cypress backend` is **empty**.
  - `git diff src/app/app.routes.ts` shows only additions.
  - `/leagues-archive`, `/leagues-archive/:leagueId` and `/leagues` still load exactly as before.
- [ ] commit msg draft: `feat(archive): render the League Seasons tab on the new archive shell`
