# T14: Tournaments tab and Season expansion

> ## ⚠ ARBITRATION OVERRIDE — read before the body; these win over anything below
>
> **A. Use T12's real repository method names.** The body calls `loadTournamentYear`,
> `fetchSeasonTournaments`, `listLeagueSeasonSummaries` and `listLeagueSummaries`. None exist — they
> were guesses made while T12 was written in parallel. T12 owns the file and shipped:
>
> ```ts
> listLeagues(options?)
> listLeagueSeasons(options?)
> listYears(options?)
> listTournaments(options?: { force?: boolean; year?: number })   // per-year via the `year` option
> listSeasonTournaments(season)
> invalidateArchiveCaches(): Promise<void>
> ```
>
> Tab 2's per-year fetch is `listTournaments({ year })`. There is no sixth read method.
>
> **B. Season expansion goes through `ArchiveRepository.listSeasonTournaments`, not through the
> component.** The body re-implements the §8.1 read path inline with `readYearPartition` +
> `fetchSeasonTournaments`. Its cache branch would silently drop browser-local Tournaments, breaking
> ADR 0028. Keep `readSeasonTournaments` as a thin pure adapter over the repository result; the
> repository owns the cached-and-complete-and-locked decision. T18 depends on this.
>
> **C. Truncation on a cache-served year is derivable after all.** The body records as a residual
> risk that `ArchiveYearPartition` has no `truncated` field. It does not need one: T12 stores the
> server's uncapped `totalCount` in `rowCount`, so the warning re-raises on `items.length < rowCount`.
>
> **D. Two gaps this ticket reported are now their own tickets** — arbitration R19. Staged-edit UI is
> **T17**; the browser-local union is **T18**. Retiring the legacy surface moved to **T19**. Good
> catch; nothing to do here beyond not carrying them.

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T13, T7
**Commit outcome:** `/archive/tournaments` lists every Tournament and a Season row expands to its children.

## Context (self-contained)

- Goal: the Archive is being rebuilt on three tiers — **League → LeagueSeason → Tournament**. What used
  to be a flat `League` becomes a `LeagueSeason`; a new `League` tier groups Seasons; a Tournament
  becomes a first-class top-level record that may stand alone (`seasonId: null`, no League at all).
  Every `leagues-archive` name becomes `archive`. The card grid becomes a paginated, sortable,
  expandable table across two tabs.
- This slice: **Tab 2 of that table plus every page it links to, and the expansion of a Tab 1 Season
  row into its Tournaments.** Concretely:
  - `/archive/tournaments` renders one row per Tournament for **one calendar year at a time**, in the
    Variant B two-line treatment. The League line of a standalone Tournament (`seasonId: null`) is
    **empty** — a standalone Tournament belongs to no League, and printing a placeholder there would
    invent a relationship the data does not have.
  - A Season row on Tab 1 expands one level into its Tournaments, rendered as **one compact
    continuous clickable line each**, never a nested table.
  - That expansion uses a **read path that must not write the cache**. The Archive frontend caches
    public Tournament catalogs in IndexedDB as **year partitions** (database `gones-archive-cache`,
    store `year-partitions`, one record per calendar year). When **every** year in
    `[year(firstTournamentDate) .. year(lastTournamentDate)]` is cached **and** complete **and**
    locked, the client renders from IndexedDB and issues **no** request. Otherwise it calls
    `GET /api/archive/league-seasons/{seasonId}/tournaments`, renders the response, and
    **deliberately does not cache it**. That non-caching is load-bearing: only
    `src/app/backend/archive-backfill-queue.ts` may ever write a year partition, and a partition is
    written and stamped `completedAt` in one IndexedDB transaction so a year is atomically whole or
    absent. Caching this read-through response would create a second writer and could leave a
    half-year partition behind. **Write no cache-writing behaviour into this slice, and do not add
    anything that invites one.**
  - `/archive/league-seasons/:seasonId`, `/archive/tournaments/:tournamentId`,
    `/archive/tournaments/:tournamentId/result` and `/archive/tournaments/:tournamentId/result/metagames`
    are the pages those rows and lines link to.
- The old `/leagues-archive/**` frontend and the old `/api/leagues-archive/**` surface stay alive and
  serving through this ticket. The strategy is expand → migrate → contract: the new pages are **added
  beside** the old ones, and the legacy components, routes and endpoints are deleted only at the last
  ticket of the plan. No compatibility shim is written; old code merely survives until unused.
- Out of scope here — do **not** touch any of it:
  - **Do not delete or edit** `src/app/features/leagues-archive/**` or
    `src/app/features/tournaments-archive/**`. The `/leagues-archive` route at
    `src/app/app.routes.ts:93`, the `/leagues-archive/:leagueId[...]` routes at
    `src/app/app.routes.ts:97-100`, and the retired-path redirects built by
    `archiveRedirectRoutes()` at `src/app/app.routes.ts:63-80` and spread at line `101`, stay
    exactly as they are. They are removed at the last ticket of the plan, not here.
  - **Every line number in this ticket was read off the tree before the preceding ticket landed.**
    That ticket edits `app.routes.ts`, `app-breadcrumbs.ts`, `messages.ts` and `styles.css` too, so
    the numbers shift. Anchor on the quoted **text**, never on the number.
  - **No rankings work.** `/global-stats`, its scope filter, `player_statistics`, Glicko-2 and
    `src/app/features/players/**` belong to another ticket. Do not add a scope selector, do not touch
    `global-stats.component.ts` or `global-stats-query.ts`.
  - **No resynchronize control.** The "Resynchronize everything" section in Settings and the
    `archive-cache-invalidation.test.ts` coverage test belong to another ticket. Do not add a Settings
    control, do not add a per-page sync button (see *Assumptions in force*).
  - **No backend.** Not one file under `backend/**`. No endpoint, no DTO, no migration, no
    `backend/openapi/gones.json`, no `npm run api:generate`. Every route this ticket calls already
    exists.
  - **No cache writing, no backfill queue.** Do not create, edit or import
    `src/app/backend/archive-backfill-queue.ts`. Do not add a write, warm or invalidate call to
    `src/app/backend/archive-cache.service.ts`.
  - **No editing UI.** No create, rename, move, delete, round edit, archetype edit or status toggle on
    any of the four new pages. They are read surfaces (see *Assumptions in force*).
  - **No new Cypress spec.** The existing specs drive the legacy routes and must stay green untouched.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** Local data may
    be reset freely. This is why there is no data migration and no route alias.
  - The archive may be **empty** at this point in the plan. An empty years index is a first-class
    state this ticket renders, not a bug to fix.
  - **The four new pages are read-only.** The plan's ticket list has no other slice that builds a
    staged-edit UI on the new `/archive/**` pages, and the legacy editor
    `src/app/features/tournaments-archive/tournament-archive-detail.component.ts` keeps working until
    the last ticket deletes it. Building an editor here would take on the whole of ADR 0037 unasked.
    This is recorded as a plan gap, not silently absorbed.
  - **Tab 2 lists server rows only.** Year partitions and the years index are server surfaces; a
    browser-local archive Tournament has no year partition and no `updatedAt` on the wire, and no
    ticket in this plan defines how it joins a year-partitioned table. Recorded as a plan gap.
  - **No per-page sync bar.** `gones-sync-bar` is the shared cache affordance of ADR 0039, and the
    plan puts the tabs **and the shared toolbar** in `archive-shell.component.ts`, which this ticket
    does not own. Rendering a second sync button here would put two on one page once the shell is
    wired in.
  - **This ticket renders its own two-link tab strip rather than importing the shell.** The plan names
    the file `src/app/features/archive/archive-shell.component.ts` and its job ("tabs + shared
    toolbar") but freezes neither its selector, its inputs nor its content-projection shape, and this
    ticket may not invent a shared symbol another ticket owns. Six lines of local `<a routerLink>`
    markup cannot break; a guessed selector can. If the shell later absorbs the strip, deleting the
    local `<nav class="archive-tabs">` is a one-hunk change.
  - **Route registration is flat, matching the plan's route list.** Angular backtracks out of a
    parent whose children do not match, so a top-level `archive/tournaments` route still resolves
    even if the shell is registered as `{ path: 'archive', children: [...] }`.
  - **`ArchiveTournamentRow` is declared locally, structurally.** The plan defines
    `ArchiveTournamentSummary` as a wire shape but never says which frontend module exports it, and
    the generated client cannot supply it: `npm run api:generate` renders NodaTime types as opaque
    index-signature interfaces — `export interface Instant { [key: string]: any }` at
    `src/app/api/generated/gones-api.ts:10626` and the same for `LocalDate` at line `10826` — which is
    why `src/app/backend/aspnet-api-backend.service.ts:41` already converts with `String(item.updatedAt)`
    at the adapter boundary. This ticket therefore declares the row shape it consumes under a
    **distinct** name, with primitive fields, so any module's `ArchiveTournamentSummary` is
    structurally assignable to it.
  - **The only pre-existing files this ticket edits are** `src/app/features/archive/league-season-list.component.ts`
    (additively, for the expansion), `src/app/app.routes.ts`, `src/app/app-breadcrumbs.ts`,
    `src/app/i18n/messages.ts` and `src/styles.css`. Everything else it creates.
  - Repo-wide gates that apply to every file written here, verified by reading them:
    - `src/app/shared/data-cy-coverage.test.ts` — **every element** in a `template:` literal carries
      `data-cy` or `[attr.data-cy]`, and every **static** `data-cy` value is unique **within one
      file**. `<ng-container>`, `<ng-template>`, `<svg>`, `<path>` and friends are exempt.
    - `src/app/shared/back-button-coverage.test.ts` — every component reached by a
      `loadComponent: () => import('./…')` in `src/app/app.routes.ts` contains both `position="top"`
      and `position="bottom"`.
    - `src/app/backend/server-authority-boundary.test.ts` (~lines 100-118) — the tokens `indexedDB`,
      `IDBDatabase` and any `IDB…` identifier may appear only in four allowlisted files. No file
      written here may name one.
    - `src/app/i18n/messages.ts` is one `const en = {…}` object (line 5) and one
      `const fr: Record<MessageKey, string> = {…}` object (line 1255). A duplicate key in either
      literal is a TypeScript error, `ts(1117)`.

## Requirements

1. `/archive/tournaments` renders the **Variant B** Tab 2 table: four visual columns carrying six
   values — `Tournament / League`, `Date / Updated`, `Players`, `Status`.
2. On a Tournament with `seasonId: null` the League line renders **empty** — no placeholder text, no
   dash, no "Unassigned".
3. The Tournament name is the link, to `/archive/tournaments/:tournamentId`.
4. Tab 2 shows **one calendar year**. `year` is required by `GET /api/archive/tournaments/all?year=`,
   so on first load with no `?year=` the tab selects the **newest year present in
   `GET /api/archive/years`**, writes it into the URL with `replaceUrl: true`, and loads it. With an
   empty years index it renders the empty-archive state and issues no year request.
5. The year `<select>` offers exactly the years the years index returned, newest first. It offers no
   "all years" option.
6. Sorting: paired headers sort on their **first** value (`name`, `date`); an explicit sort `<select>`
   reaches all six keys `name | leagueName | date | updated | players | status`. Default `date`, `desc`.
7. Paging is client-side over the loaded year: sizes `25 | 50 | 100`, default `25`.
8. Search filters the loaded year client-side, case-insensitively, over the Tournament name **and**
   the League name.
9. Every one of `sort`, `dir`, `page`, `size`, `search`, `year`, `season` round-trips through the
   query string, and a default is omitted from the URL (`year` excepted — it is always written).
10. States rendered on Tab 2: loading skeleton rows that do not shift the layout, empty year, empty
    archive, and the truncation warning when the server capped the year.
11. A locked Tournament shows the 🔒 marker on its row, derived from `tournamentDate` — never from a
    stored flag.
12. A Season row on Tab 1 expands one level. `aria-expanded` is on the row **and** on the expander
    control; the expanded children are `<a>` elements, so they are keyboard reachable by construction.
13. The expansion read path is exactly: every year of the Season's span cached **and** complete **and**
    locked → render from IndexedDB, **issue no request**; otherwise
    `GET /api/archive/league-seasons/{seasonId}/tournaments`, render, **and do not cache**.
14. A test proves the read-through path leaves the cache untouched, by construction (the source has no
    writer) and by observation (a recording double reports no call other than the two reads).
15. A Season whose span is empty (`firstTournamentDate` and `lastTournamentDate` both `null`) expands
    to the empty state with **no** request and **no** cache read.
16. The expanded list shows at most `SEASON_EXPANSION_PREVIEW_LIMIT` lines; past that a final line
    links to `/archive/league-seasons/:seasonId`.
17. `/archive/league-seasons/:seasonId` renders the Season, its League, its counters and its whole
    Tournament list through the same read path, and says so when the list came from the server.
18. `/archive/tournaments/:tournamentId` renders the Tournament document read-only: name, date,
    status, lock marker, Season link or standalone marker, the computed ranking, the rounds, and a
    link to the result.
19. `/archive/tournaments/:tournamentId/result` and `…/result/metagames` render standings and
    archetype share for one Tournament, with the two download controls, matching the legacy result
    page's behaviour.
20. Every user-visible string goes through `I18nService.t` and exists in **both** the `en` and the `fr`
    catalogue of `src/app/i18n/messages.ts`.
21. Every new colour comes from an existing `src/styles.css` token. No literal colour is written.
22. `/archive/**` breadcrumbs no longer render "Not Found".
23. `npm run test`, `npm run typecheck`, `npm run lint` and `npm run build` are green, and
    `npm run e2e:ci` still passes with no spec edited.

## Inputs

Read before writing code.

**Prototype — the frozen visual contract.**
`artifacts/GRILL_2026_08_22_archive-tournaments/PROTOTYPE_archive_tables.html`, tab **B** (section
`#p-b`, lines 203-236) and tab **Edge states** (section `#p-s`, lines 296-330). The Variant B row is
built by the `#b-body` script block at lines 397-403:

```js
'<tr class="row"><td><span class="b-name"><span><span class="chev">▸</span> <a href="#" class="nm">'+esc(s.n)+'</a></span>'+
'<span class="sub">'+esc(s.lg)+'</span></span></td>'+
'<td class="b-meta">'+s.lp+'<br><span class="dim">upd. '+s.up+'</span></td>'+
'<td class="num b-meta">'+s.t+' tourn.<br><span class="dim">'+s.p+' players</span></td>'+
'<td>'+st(s.st)+lk(s)+'</td></tr>'+kidsRow(s,4)
```

and the expanded children by `kidsRow` at lines 388-394:

```js
'<tr class="kids" hidden><td colspan="'+span+'"><div class="kidlist">'+
  s.kids.map(k=>'<a class="kid" href="#"><b>'+esc(k[1])+'</b><span class="sep">·</span>'+k[0]+
    '<span class="sep">·</span>'+k[2]+' players<span class="sep">·</span>'+k[3]+'</a>').join('')+
  (s.kids.length<s.t?'<a class="kid" href="#"><b>Show all '+s.t+' tournaments</b></a>':'')+
  '</div></td></tr>'
```

The four edge states are the prototype's `#p-s` panel: skeleton rows (`.skel`), the empty block
(`.empty` with a `<strong>` headline), the truncation bar (`.warnbar`, *"Showing the first 5,000 of
6,214 tournaments. This archive is larger than one catalog request returns. Narrow the year or search
to reach the rest."*) and the read-through placeholder (`.kid.readthru`, *"Fetching 9 tournaments from
the server — 2019 is not cached in this browser…"*).

**Existing detail / result idiom — read, do not edit.**

- `src/app/features/tournaments-archive/tournament-archive-detail.component.ts`
  - lines 1-31: the import block and the `@Component({ standalone: true, imports: [...] })` shape.
  - line 172: `readonly result = computed(() => this.tournament() ? calculateTournamentResult(this.tournament()!) : { rows: [], incomplete: true, provisional: false });`
  - line 141: the status chip —
    `<span class="status archive-tournament-status" [class.completed]="t.status === 'completed'" data-cy="archive-tournament-status-badge"><span class="status-dot" aria-hidden="true" …></span>{{ statusLabel() }}</span>`
  - line 183: `readonly statusLabel = computed(() => this.i18n.t(this.tournament()?.status === 'completed' ? 'archive.tournamentCompleted' : 'archive.tournamentActive'));`
  - lines 148, 168: the ranking section and the rounds section, `<gones-ranking-table [rows]="result().rows" [emptyText]="…" />`.
  - lines 214-228: `async load()` — `route.snapshot.paramMap.get(...)`, `try/catch` with
    `logBoundaryError(...)` then `this.error.set(this.i18n.t(...))`, `finally { this.loading.set(false); }`.
- `src/app/features/tournaments-archive/tournament-archive-result.component.ts`
  - lines 13-104: the whole template — hero, `result-counts` badges, standings table, metagame bars,
    the footer with the two cross-links and the two download buttons.
  - lines 106-124: the class fields, `page = signal<'standings' | 'metagames'>('standings')`,
    `pageLabel`, `topStandingRows` (`summary()?.topRows.slice(0, 8)`), `metagameBars`, `metagameColumns`.
  - lines 133-172: `downloadResultImage()`, `downloadAllResultImages()`, `resultFilenameBase()`.
  - **lines 179-351**: `interface MetagameBar` through `function crc32(...)` — the pure helper block
    (`buildMetagameBars`, `splitMetagameBars`, `captureElementAsPng`, `collectDocumentCss`,
    `downloadBlob`, `sanitizeFilename`, `nextFrame`, `ZipFile`, `createZip`, `copyUint8ArrayBuffer`,
    `zipLocalHeader`, `zipCentralHeader`, `zipEndRecord`, `crc32`). Copied verbatim by this ticket.
- `src/app/features/leagues-archive/league-archive-list.component.ts` — the list idiom: `signal`
  state, `computed` filter/page derivations, `goPage`, `onSearchChange`, the pagination `<nav>` at
  lines 76-82.

**Sorting / paging / query-string idiom — read, do not edit.**

- `src/app/features/players/global-stats-query.ts:36-107` — `GlobalStatsQuery`,
  `parseGlobalStatsQuery(params: { get(key: string): string | null }, …)`,
  `toggleGlobalStatsSort`, `globalStatsPageWindow`, and `globalStatsQueryParams(query): Params`
  (lines 189-198) which omits defaults.
- `src/app/features/players/global-stats.component.ts:99-104` — the sortable header shape
  `<th (click)="sortBy('rating')" [attr.aria-sort]="ariaSort('rating')" class="sortable-col" …>`.
- `src/app/features/players/global-stats.component.ts:279-289` — the constructor
  `this.route.queryParamMap.subscribe((params) => { … })` then `void this.load…()`.
- `src/app/features/players/global-stats.component.ts:324-327` —
  `void this.router.navigate([], { relativeTo: this.route, queryParams: globalStatsQueryParams(query) });`

**Shared components — read for their exact input surface.**

- `src/app/shared/back-button.component.ts` — selector `gones-back-button`,
  `@Input() link: string | unknown[] | null`, `@Input() label: string`,
  `@Input() position: 'top' | 'bottom'`.
- `src/app/shared/ranking-table.component.ts` — selector `gones-ranking-table`,
  `@Input() rows: RankingRow[]`, `@Input() emptyText: string`, `@Input() collapsed`.
- `src/app/i18n/i18n.service.ts` — `t(key, params?)`, `plural(count, oneKey, manyKey, params?)`,
  `formatDate(value, options?)`, `formatDateTime(value, options?)`, `language`.

**Domain — read for the exact signatures consumed.**

- `src/app/domain/models.ts:31` `export type LeagueStatus = 'active' | 'completed';`
- `src/app/domain/models.ts:67-75` `TournamentDocument { id; leagueId; name; tournamentDate; status; rounds; playerArchetypes }`
- `src/app/domain/models.ts:77-80` `PlayerArchetypeDocument`, `82-85` `RoundDocument`.
- `src/app/domain/results.ts:26-35` `export function calculateTournamentResult(tournament: TournamentDocument)`
  → `{ scope: 'tournament'; incomplete: boolean; provisional: boolean; rows: RankingRow[] }`.
  Verified by reading the body: it reads **only** `tournament.rounds` and
  `tournament.playerArchetypes`, through `collectTournamentEntries` (line 57) and
  `tournamentPlayerArchetypeRows` (`src/app/domain/tournament-archetypes.ts`). It never reads
  `leagueId`. That is what makes the adapter in this ticket safe.
- `src/app/domain/tournament-summary.ts:34` `export function buildTournamentSummary(tournament: TournamentDocument, now = new Date()): TournamentSummary`
  with `TournamentSummary { tournamentName; tournamentDate; generatedAt; status; topRows; archetypeShares; stats }`.
- `src/app/domain/results.ts:5-22` `RankingRow`.

**Styling — read for the tokens and the classes to reuse.**

- `src/styles.css:3-18` — the whole token set: `--forge --black-metal --iron --raised-iron --soot
  --ash --dim-ash --steel --blood --hot-blood --create-green --create-green-hot --rust-plate`.
  **There is no `--link` token**; the global rule `a { color: oklch(86% 0.18 28); }` at line 32 gives
  links their colour, so a link must inherit rather than be recoloured.
- `src/styles.css:42-45` — `.status`, `.status.completed`, `.status-dot`.
- `src/styles.css:605-606` — `.table-wrap`; `700-702` — `.ranking-table` (note `min-width: 680px`
  and `white-space: nowrap`, which Variant B overrides); `699` — `.empty`; `82-86` — `.error`, `.warning`.

**From Depends — spelled out, because the worker cannot read another ticket.**

*From T7 (backend, already deployed by the time this ticket runs). Four anonymous public GETs,
`Cache-Control: public, max-age=60` on detail and result routes and `public, max-age=3600` on the
Season tournaments route, ETag + `304`:*

```
GET /api/archive/league-seasons/{seasonId}/tournaments
  200 → { "items": ArchiveTournamentSummary[], "totalCount": number, "truncated": boolean }
        ordered tournamentDate DESC, id ASC; capped by Gones:Archive:MaximumSeasonTournamentSize (5000)
        excludes soft-deleted rows, excludes other Seasons, excludes standalone (season_id IS NULL)
  400 → blank or >200-char seasonId, application/problem+json, code "validation_failed"
  404 → seasonId absent or soft-deleted, application/problem+json, code "not_found"

GET /api/archive/tournaments/{tournamentId}
  200 → { "id", "name", "seasonId": string|null, "tournamentDate": "YYYY-MM-DD", "status",
          "rounds": RoundDocument[], "playerArchetypes": PlayerArchetypeDocument[],
          "documentVersion": number, "updatedAt": ISO-8601 }
  400 / 404 → as above, on tournamentId

GET /api/archive/tournaments/{tournamentId}/result       → TournamentResult, scope "tournament"
GET /api/archive/league-seasons/{seasonId}/result        → LeagueResult,      scope "season"
```

with the row shape, on the wire, camelCase:

```json
{ "id": "tournament-1", "name": "Spring Open", "seasonId": "season-1",
  "tournamentDate": "2026-08-17", "status": "completed",
  "updatedAt": "2026-08-17T10:00:00Z", "documentVersion": 1, "playerCount": 3 }
```

`seasonId` serialises as JSON `null` for a standalone Tournament — never omitted, never `""`.
The row carries **no** `locked` field on purpose: a row cached today as unlocked would become locked
without a refetch, so the client derives lock state from `tournamentDate`. It carries no `rounds` and
no `playerArchetypes` either; only the detail document does.

*From T6 (backend, already deployed):*

```
GET /api/archive/tournaments/all?year=YYYY
  200 → { "items": ArchiveTournamentSummary[], "totalCount": number, "truncated": boolean }
        ordered tournamentDate DESC, id ASC; capped by Gones:Archive:MaximumTournamentYearSize (25000)
  400 → missing or non-integer `year`. There is no all-years mode.

GET /api/archive/years
  200 → { "years": [ { "year": number, "locked": boolean, "tournamentCount": number } ] }  ascending by year
```

*From T5 (backend, already deployed):*

```
GET /api/archive/leagues/all         → { items: ArchiveLeagueSummary[],       totalCount, truncated }
GET /api/archive/league-seasons/all  → { items: ArchiveLeagueSeasonSummary[], totalCount, truncated }
```

```ts
interface ArchiveLeagueSummary { id: string; name: string; createdAt: string; updatedAt: string; documentVersion: number; }
interface ArchiveLeagueSeasonSummary {
  id: string; name: string; leagueId: string; status: 'active' | 'completed';
  updatedAt: string; documentVersion: number;
  tournamentCount: number; playerCount: number;
  firstTournamentDate: string | null;   // null when the Season has no Tournament
  lastTournamentDate: string | null;
}
```

*From T10 — `src/app/domain/archive-models.ts` exists and exports, binding:*

```ts
export const ARCHIVE_LOCK_WINDOW_DAYS = 365;
/** A Tournament locks 365 days after the day it was played. Derived, never stored. */
export function isArchiveTournamentLocked(tournamentDate: string, now: Date = new Date()): boolean;
```

Semantics, binding: `locked ⇔ (now - tournamentDate) > 365 days`, compared on whole UTC calendar
days. Exactly 365 days ago is **not** locked; 366 days ago **is**. A browser-local record
(`local-` id prefix) is never locked.

*From T12 — two `providedIn: 'root'` services exist. This ticket calls them from exactly three
factory bodies and nowhere else:*

| Symbol | File | Member this ticket calls |
| --- | --- | --- |
| `ArchiveRepository` | `src/app/data/archive-repository.service.ts` | `listYears()`, `loadTournamentYear(year)`, `listLeagueSummaries()`, `listLeagueSeasonSummaries()`, `fetchSeasonTournaments(seasonId)`, `getTournament(tournamentId)` |
| `ArchiveCacheService` | `src/app/backend/archive-cache.service.ts` | `readYearPartition(year)` |

and the year-partition record it stores, binding:

```ts
export interface ArchiveYearPartition {
  year: number;
  completedAt: string | undefined;   // ABSENT ⇒ the year is not cached. Never write a partial one.
  rowCount: number;
  items: ArchiveTournamentSummary[];
}
```

> **Substitution rule, binding.** Those two class names and seven member names are owned by another
> ticket, and the *shapes* are what this ticket needs, not the spellings. If an actual member differs,
> adapt **only the body of the three factory functions named in Impl step 1.4, 2.6 and 5.3**. Never
> edit a T12 file, never change a port interface declared here, and never widen a factory into
> business logic — the factories are adapters and nothing else.

*From T13 — `src/app/features/archive/` exists and holds `archive-shell.component.ts` (tabs +
shared toolbar) and `league-season-list.component.ts` (Tab 1, the League Seasons table in the same
Variant B treatment), and `src/app/app.routes.ts` already registers `archive` → redirect to
`archive/league-seasons` and `archive/league-seasons`. This ticket edits only
`league-season-list.component.ts`, additively, and only to attach the expansion.*

## Interface contract (level 5)

### Produces

#### P1 — Routes registered in `src/app/app.routes.ts`

Added inside `buildRoutes(features)`, immediately after the existing `archive/league-seasons` route,
in exactly this order (`archive/tournaments` before `archive/tournaments/:tournamentId`, and the two
`result` paths after their parent):

```ts
{ path: 'archive/tournaments', loadComponent: () => import('./features/archive/tournament-list.component').then((m) => m.TournamentListComponent) },
{ path: 'archive/league-seasons/:seasonId', loadComponent: () => import('./features/archive/league-season-detail.component').then((m) => m.LeagueSeasonDetailComponent) },
{ path: 'archive/tournaments/:tournamentId', loadComponent: () => import('./features/archive/tournament-detail.component').then((m) => m.TournamentDetailComponent) },
{ path: 'archive/tournaments/:tournamentId/result', loadComponent: () => import('./features/archive/tournament-result.component').then((m) => m.TournamentResultComponent) },
{ path: 'archive/tournaments/:tournamentId/result/metagames', loadComponent: () => import('./features/archive/tournament-result.component').then((m) => m.TournamentResultComponent) }
```

No guard. No `data`. No redirect. Every one of these is a public read.

#### P2 — Query-string grammar for `/archive/tournaments`

```
/archive/tournaments?sort=&dir=&page=&size=&search=&year=&season=
```

| Param | Type | Default | Invalid value |
| --- | --- | --- | --- |
| `sort` | `name \| leagueName \| date \| updated \| players \| status` | `date` | falls back to `date` |
| `dir` | `asc \| desc` | `desc` | falls back to `desc` |
| `page` | integer ≥ 1 | `1` | falls back to `1` |
| `size` | `25 \| 50 \| 100` | `25` | falls back to `25` |
| `search` | string, trimmed | `''` | — |
| `year` | 4-digit integer | `null` → resolved to the newest indexed year | falls back to `null` |
| `season` | string | `null` | — |

Serialisation omits every default **except** `year`, which is written whenever it is non-null.

#### P3 — `src/app/features/archive/league-season-detail.component.ts` (new)

The home of the shared row shape and of the read path, because the Season page is the read path's
primary consumer. The other three components import from here with `import type`, so nothing but the
Tab 1 list takes a runtime dependency on this module.

```ts
import { InjectionToken, inject, signal, computed } from '@angular/core';
import { LeagueStatus } from '../../domain/models';
import { isArchiveTournamentLocked } from '../../domain/archive-models';

/**
 * One Tournament row of the archive catalog. Declared here, structurally, with primitive fields:
 * the generated client renders `LocalDate`/`Instant` as opaque index-signature interfaces, so a
 * generated type cannot be consumed by a view. Any module's `ArchiveTournamentSummary` is
 * assignable to this.
 */
export interface ArchiveTournamentRow {
  readonly id: string;
  readonly name: string;
  /** `null` ⇒ standalone: the Tournament belongs to no Season and therefore to no League. */
  readonly seasonId: string | null;
  readonly tournamentDate: string;   // ISO 8601 calendar date, `YYYY-MM-DD`, no timezone
  readonly status: LeagueStatus;
  readonly updatedAt: string;        // ISO 8601 UTC instant
  readonly documentVersion: number;
  readonly playerCount: number;
}

/** One LeagueSeason row. Structural mirror of `ArchiveLeagueSeasonSummary`. */
export interface ArchiveSeasonRow {
  readonly id: string;
  readonly name: string;
  readonly leagueId: string;
  readonly status: LeagueStatus;
  readonly updatedAt: string;
  readonly documentVersion: number;
  readonly tournamentCount: number;
  readonly playerCount: number;
  readonly firstTournamentDate: string | null;
  readonly lastTournamentDate: string | null;
}

/**
 * The subset of the cached year-partition record this read path needs. Structural on purpose: the
 * real record carries `rowCount` too, and is assignable to this.
 */
export interface CachedYearPartition {
  readonly year: number;
  /** ABSENT ⇒ the year is not cached. A partition is never written half-complete. */
  readonly completedAt: string | undefined;
  readonly items: readonly ArchiveTournamentRow[];
}

/** The read-through page, exactly as `GET /api/archive/league-seasons/{id}/tournaments` returns it. */
export interface SeasonTournamentsPage {
  readonly items: readonly ArchiveTournamentRow[];
  readonly totalCount: number;
  readonly truncated: boolean;
}

/**
 * The two reads the Season expansion is allowed to perform — and nothing else. There is deliberately
 * no writer on this interface: the backfill queue is the single writer of year partitions, and a
 * port that cannot write cannot become a second one.
 */
export interface SeasonTournamentsSource {
  readYearPartition(year: number): Promise<CachedYearPartition | undefined>;
  fetchSeasonTournaments(seasonId: string): Promise<SeasonTournamentsPage>;
}

/** What the Season page additionally needs, on top of the two reads above. */
export interface ArchiveSeasonSource extends SeasonTournamentsSource {
  getSeason(seasonId: string): Promise<ArchiveSeasonRow | undefined>;
  getLeagueName(leagueId: string): Promise<string | undefined>;
}

export const ARCHIVE_SEASON_SOURCE = new InjectionToken<ArchiveSeasonSource>('ARCHIVE_SEASON_SOURCE', {
  providedIn: 'root',
  factory: archiveSeasonSourceFactory
});

/** `'cache'` ⇒ served from IndexedDB with no request. `'server'` ⇒ read through, and not cached. */
export interface SeasonTournamentsRead {
  readonly origin: 'cache' | 'server';
  readonly items: readonly ArchiveTournamentRow[];
  readonly truncated: boolean;
}

export type SeasonExpansionState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly origin: 'cache' | 'server'; readonly items: readonly ArchiveTournamentRow[]; readonly truncated: boolean }
  | { readonly status: 'failed' };

/** Lines shown inside an expanded Season row before the "show all" line replaces the rest. */
export const SEASON_EXPANSION_PREVIEW_LIMIT = 10;

/**
 * The calendar years a Season spans, ascending and gapless. `[]` when either bound is absent — a
 * Season with no Tournament spans no year, and must not be read through for nothing.
 */
export function seasonSpanYears(firstTournamentDate: string | null, lastTournamentDate: string | null): number[];

/**
 * A whole calendar year is locked exactly when its last possible day is locked, so no Tournament
 * inside it can still be edited by a non-Admin — which is what makes a cached partition of that year
 * safe to serve forever.
 */
export function isArchiveYearLocked(year: number, now?: Date): boolean;

/** `tournamentDate` DESC, then `id` ASC ordinal. Total: `id` is a primary key, so no two rows tie. */
export function sortTournamentRowsByDateDesc(rows: readonly ArchiveTournamentRow[]): ArchiveTournamentRow[];

/**
 * The §8.1 read path, binding:
 *   every year of the span cached && complete && locked → render from IndexedDB, issue no request
 *   otherwise → GET the Season's tournaments, render, and do NOT cache the result
 */
export function readSeasonTournaments(
  season: Pick<ArchiveSeasonRow, 'id' | 'firstTournamentDate' | 'lastTournamentDate'>,
  source: SeasonTournamentsSource,
  now?: Date
): Promise<SeasonTournamentsRead>;

export class LeagueSeasonDetailComponent { /* route /archive/league-seasons/:seasonId */ }
```

Reference implementation of the read path — copy it, it is the contract:

```ts
export async function readSeasonTournaments(
  season: Pick<ArchiveSeasonRow, 'id' | 'firstTournamentDate' | 'lastTournamentDate'>,
  source: SeasonTournamentsSource,
  now: Date = new Date()
): Promise<SeasonTournamentsRead> {
  const years = seasonSpanYears(season.firstTournamentDate, season.lastTournamentDate);
  // A Season with no Tournament spans no year: neither store is asked anything.
  if (!years.length) return { origin: 'cache', items: [], truncated: false };

  const partitions = await Promise.all(years.map((year) => source.readYearPartition(year)));
  const servableLocally = years.every((year, index) =>
    isArchiveYearLocked(year, now) && partitions[index]?.completedAt !== undefined);

  if (servableLocally) {
    const items = partitions.flatMap((partition) => partition?.items ?? []).filter((row) => row.seasonId === season.id);
    return { origin: 'cache', items: sortTournamentRowsByDateDesc(items), truncated: false };
  }

  // Read through. The response is rendered and dropped: caching it here would make this a second
  // writer of the year partitions and could leave a half-year behind.
  const page = await source.fetchSeasonTournaments(season.id);
  return { origin: 'server', items: [...page.items], truncated: page.truncated };
}
```

#### P4 — `src/app/features/archive/tournament-list.component.ts` (new)

```ts
import type { ArchiveTournamentRow } from './league-season-detail.component';

export const ARCHIVE_TABLE_PAGE_SIZES = [25, 50, 100] as const;
export type ArchiveTablePageSize = (typeof ARCHIVE_TABLE_PAGE_SIZES)[number];

export const ARCHIVE_TOURNAMENT_SORT_KEYS = ['name', 'leagueName', 'date', 'updated', 'players', 'status'] as const;
export type ArchiveTournamentSortKey = (typeof ARCHIVE_TOURNAMENT_SORT_KEYS)[number];

export interface ArchiveTournamentQuery {
  readonly page: number;
  readonly size: ArchiveTablePageSize;
  readonly search: string;
  readonly sort: ArchiveTournamentSortKey;
  readonly dir: 'asc' | 'desc';
  readonly year: number | null;
  readonly season: string | null;
}

/** One entry of `GET /api/archive/years`. */
export interface ArchiveYearOption {
  readonly year: number;
  readonly locked: boolean;
  readonly tournamentCount: number;
}

/** One loaded year partition, however it was obtained. */
export interface ArchiveYearRows {
  readonly items: readonly ArchiveTournamentRow[];
  readonly totalCount: number;
  readonly truncated: boolean;
}

export interface ArchiveTournamentTabSource {
  listYears(): Promise<readonly ArchiveYearOption[]>;
  loadYear(year: number): Promise<ArchiveYearRows>;
  /** `seasonId` → the name of the League that Season belongs to. A missing key renders an empty League line. */
  listSeasonLeagueNames(): Promise<ReadonlyMap<string, string>>;
}

export const ARCHIVE_TOURNAMENT_TAB_SOURCE = new InjectionToken<ArchiveTournamentTabSource>(
  'ARCHIVE_TOURNAMENT_TAB_SOURCE', { providedIn: 'root', factory: archiveTournamentTabSourceFactory });

/** Accepts both `URLSearchParams` (tests) and Angular `ParamMap` (router) — both expose `.get()`. */
export function parseArchiveTournamentQuery(params: { get(key: string): string | null }): ArchiveTournamentQuery;

/** Router query params. Every default is omitted; `year` is written whenever it is non-null. */
export function archiveTournamentQueryParams(query: ArchiveTournamentQuery): Params;

/** New key → `desc`, page 1. Same key → flip the direction, page 1. */
export function toggleArchiveTournamentSort(query: ArchiveTournamentQuery, key: ArchiveTournamentSortKey): ArchiveTournamentQuery;

export function filterArchiveTournamentRows(
  rows: readonly ArchiveTournamentRow[],
  search: string,
  seasonId: string | null,
  leagueNameOf: (row: ArchiveTournamentRow) => string
): ArchiveTournamentRow[];

export function sortArchiveTournamentRows(
  rows: readonly ArchiveTournamentRow[],
  sort: ArchiveTournamentSortKey,
  dir: 'asc' | 'desc',
  leagueNameOf: (row: ArchiveTournamentRow) => string
): ArchiveTournamentRow[];

export class TournamentListComponent { /* route /archive/tournaments */ }
```

#### P5 — `src/app/features/archive/tournament-detail.component.ts` (new)

```ts
import type { ArchiveTournamentRow } from './league-season-detail.component';
import { PlayerArchetypeDocument, RoundDocument, TournamentDocument } from '../../domain/models';

/** The whole Tournament document as `GET /api/archive/tournaments/{id}` serves it. */
export interface ArchiveTournamentDetail {
  readonly id: string;
  readonly name: string;
  readonly seasonId: string | null;
  readonly tournamentDate: string;
  readonly status: LeagueStatus;
  readonly rounds: readonly RoundDocument[];
  readonly playerArchetypes: readonly PlayerArchetypeDocument[];
  readonly documentVersion: number;
  readonly updatedAt: string;
}

export interface ArchiveTournamentDetailSource {
  /** `undefined` for `404` — an absent or soft-deleted Tournament is a page state, not an error. */
  getTournament(tournamentId: string): Promise<ArchiveTournamentDetail | undefined>;
  getSeasonName(seasonId: string): Promise<string | undefined>;
}

export const ARCHIVE_TOURNAMENT_DETAIL_SOURCE = new InjectionToken<ArchiveTournamentDetailSource>(
  'ARCHIVE_TOURNAMENT_DETAIL_SOURCE', { providedIn: 'root', factory: archiveTournamentDetailSourceFactory });

/**
 * Adapts the three-tier document to the shape the two result calculators still take. The legacy
 * `leagueId` slot is filled with `seasonId ?? ''` and is never read: `calculateTournamentResult`
 * and `buildTournamentSummary` reach only `rounds` and `playerArchetypes`. It exists solely because
 * the record requires a non-null string.
 */
export function toResultInput(detail: ArchiveTournamentDetail): TournamentDocument;

export class TournamentDetailComponent { /* route /archive/tournaments/:tournamentId */ }
```

#### P6 — `src/app/features/archive/tournament-result.component.ts` (new)

```ts
export class TournamentResultComponent { /* routes …/result and …/result/metagames */ }
```

Reuses `ARCHIVE_TOURNAMENT_DETAIL_SOURCE` and `toResultInput` from P5. Carries a verbatim copy of the
pure helper block at `tournament-archive-result.component.ts:179-351` (`MetagameBar`,
`buildMetagameBars`, `splitMetagameBars`, `captureElementAsPng`, `collectDocumentCss`,
`downloadBlob`, `sanitizeFilename`, `nextFrame`, `ZipFile`, `createZip`, `copyUint8ArrayBuffer`,
`zipLocalHeader`, `zipCentralHeader`, `zipEndRecord`, `crc32`), because the file those live in is
deleted at the end of the plan and a reference into it would break at deletion time. Duplication is
the deliberate choice, exactly as the backend slice of this plan duplicated its three HTTP-caching
helpers rather than reaching into a doomed file.

#### P7 — Additions to `src/app/features/archive/league-season-list.component.ts` (T13's file, additive)

Exactly these public members are added to the existing component class:

```ts
/** The one expanded Season, or `null`. One at a time: an expansion may issue a read-through
 *  request, and holding several in flight multiplies exactly the cost §8.1 exists to avoid. */
readonly expandedSeasonId = signal<string | null>(null);
readonly expansion = signal<SeasonExpansionState>({ status: 'loading' });

isSeasonExpanded(seasonId: string): boolean;
seasonChildrenRowId(seasonId: string): string;      // `archive-season-children-${seasonId}`
expandedChildren(): readonly ArchiveTournamentRow[]; // capped at SEASON_EXPANSION_PREVIEW_LIMIT
hasMoreChildren(): boolean;
async toggleSeasonExpansion(season: ArchiveSeasonRow): Promise<void>;
```

and exactly these markup changes to the existing row loop:

- The row `<tr>` gains `[attr.aria-expanded]="isSeasonExpanded(season.id)"` and
  `(click)="toggleSeasonExpansion(season)"`.
- The name cell gains, **before** the name link, an expander button:
  `<button type="button" class="archive-expand" [attr.aria-expanded]="isSeasonExpanded(season.id)" [attr.aria-controls]="seasonChildrenRowId(season.id)" [attr.aria-label]="expandLabel(season)" [attr.data-cy]="'archive-season-expand-' + season.id" (click)="$event.stopPropagation(); toggleSeasonExpansion(season)">▸</button>`
- A children `<tr class="archive-children" [id]="seasonChildrenRowId(season.id)" [hidden]="!isSeasonExpanded(season.id)">` is emitted after each row `<tr>`, with a single `<td [attr.colspan]="4">`.
- The name link itself gains `(click)="$event.stopPropagation()"` so following the link never also
  toggles the row.

#### P8 — `src/app/app-breadcrumbs.ts`

A branch for `segments[0] === 'archive'`, placed **before** the
`if (segments[0] !== 'leagues-archive') return [{ label: menu, link: ['/'] }, { label: t('nav.notFound') }];`
fall-through, which is line 70 today. Labels are static — no name resolver is added, because that would mean new
lookup plumbing through `AppComponent` for a label:

| Path | Crumbs |
| --- | --- |
| `/archive`, `/archive/league-seasons` | `Menu` → `crumb.archive` |
| `/archive/league-seasons/:seasonId` | `Menu` → `crumb.archive` (→ `/archive/league-seasons`) → `crumb.season` |
| `/archive/tournaments` | `Menu` → `crumb.archive` (→ `/archive/league-seasons`) → `crumb.archiveTournaments` |
| `/archive/tournaments/:id` | `Menu` → `crumb.archive` (→ …) → `crumb.archiveTournaments` (→ `/archive/tournaments`) → `crumb.tournament` |
| `/archive/tournaments/:id/result[/metagames]` | … → `crumb.tournament` (→ `/archive/tournaments/:id`) → `crumb.result` |

#### P9 — i18n keys, both catalogues

Added to `src/app/i18n/messages.ts`: to `const en` after `'archive.reopenConfirm'` (line 572 today)
and to `const fr` after its `'archive.reopenConfirm'` (line 1813 today). Existing keys are reused wherever an exact
match exists — `common.previous`, `common.next`, `common.players`, `common.active`, `common.completed`,
`tournament.rounds`, `tournament.roundN`, `tournament.entriesCount`, `tournament.ranking`,
`tournament.emptyRanking`, `tournament.notFoundTitle`, `tournament.notFoundBody`,
`nav.returnToMenu`, `nav.backToPrevious`, and the whole `result.*` group.

```ts
  // Archive tabs (T14)
  'crumb.archive': 'Archive',
  'crumb.archiveTournaments': 'Tournaments',
  'crumb.season': 'Season',
  'archiveTabs.aria': 'Archive sections',
  'archiveTabs.leagueSeasons': 'League Seasons',
  'archiveTabs.tournaments': 'Tournaments',
  'archiveTournaments.title': 'Archive',
  'archiveTournaments.search': 'Search',
  'archiveTournaments.searchPlaceholder': 'Tournament or League name…',
  'archiveTournaments.year': 'Year',
  'archiveTournaments.rows': 'Rows',
  'archiveTournaments.sort': 'Sort',
  'archiveTournaments.colTournamentLeague': 'Tournament / League',
  'archiveTournaments.colDateUpdated': 'Date / Updated',
  'archiveTournaments.colPlayers': 'Players',
  'archiveTournaments.colStatus': 'Status',
  'archiveTournaments.sortName': 'Tournament name',
  'archiveTournaments.sortLeagueName': 'League name',
  'archiveTournaments.sortDate': 'Date played',
  'archiveTournaments.sortUpdated': 'Last updated',
  'archiveTournaments.sortPlayers': 'Players',
  'archiveTournaments.sortStatus': 'Status',
  'archiveTournaments.updatedAt': 'upd. {date}',
  'archiveTournaments.pageStatus': 'Page {page} of {total} · {count} Tournaments',
  'archiveTournaments.noneMatch': 'No Tournament matches this view.',
  'archiveTournaments.emptyYear': 'No Tournament was played in {year}.',
  'archiveTournaments.emptyArchive': 'This archive holds no Tournament yet.',
  'archiveTournaments.loadFailed': 'Could not load Tournaments. Check connection, then retry.',
  'archiveTournaments.truncated': 'Showing the first {shown} of {total} Tournaments for {year}. This year is larger than one catalog request returns. Narrow the search to reach the rest.',
  'archiveTournaments.seasonFilter': 'Filtered to a single Season.',
  'archiveTournaments.clearSeasonFilter': 'Show every Season',
  'archiveTournaments.paginationAria': 'Archive Tournament pages',
  'archiveTournaments.loadingAria': 'Loading Tournaments',
  'archiveTournaments.yearAria': 'Year shown',
  'archiveTournaments.openAria': 'Open Tournament {name}',
  'archiveTournaments.locked': 'Locked — played more than 365 days ago',
  'archiveSeason.kicker': 'League Season',
  'archiveSeason.expandAria': 'Show the Tournaments of {name}',
  'archiveSeason.collapseAria': 'Hide the Tournaments of {name}',
  'archiveSeason.fetching': 'Fetching this Season’s Tournaments from the server — its years are not stored in this browser…',
  'archiveSeason.loadFailed': 'Could not load this Season’s Tournaments.',
  'archiveSeason.noTournaments': 'This Season holds no Tournament yet.',
  'archiveSeason.showAll': 'Show all {count} Tournaments',
  'archiveSeason.childLine': '{date} · {players} · {status}',
  'archiveSeason.playerCount': '{count} player',
  'archiveSeason.playerCountPlural': '{count} players',
  'archiveSeason.tournamentCount': '{count} Tournament',
  'archiveSeason.tournamentCountPlural': '{count} Tournaments',
  'archiveSeason.meta': '{tournaments} · {players}',
  'archiveSeason.tournaments': 'Tournaments',
  'archiveSeason.notFoundTitle': 'Season not found',
  'archiveSeason.notFoundBody': 'The requested League Season does not exist or was deleted.',
  'archiveSeason.loadOneFailed': 'Could not load this League Season.',
  'archiveSeason.readThrough': 'Read from the server. This list is not stored in this browser.',
  'archiveSeason.locked': 'Locked — every Tournament of this Season is more than 365 days old',
  'archiveSeason.datesRange': '{start} — {end}',
  'archiveSeason.noDates': 'No Tournament date yet',
  'archiveDetail.kicker': 'Archived Tournament',
  'archiveDetail.season': 'Season',
  'archiveDetail.standalone': 'Standalone Tournament — no League',
  'archiveDetail.updated': 'Updated {date}',
  'archiveDetail.locked': 'Locked — played more than 365 days ago',
  'archiveDetail.loadFailed': 'Could not load this Tournament.',
  'archiveDetail.readOnly': 'This page is read-only.',
  'archiveDetail.seeResult': 'See the Result',
  'archiveDetail.backToTournaments': 'Back to Tournaments',
```

French, verbatim:

```ts
  'crumb.archive': 'Archive',
  'crumb.archiveTournaments': 'Tournois',
  'crumb.season': 'Saison',
  'archiveTabs.aria': 'Sections de l’archive',
  'archiveTabs.leagueSeasons': 'Saisons de ligue',
  'archiveTabs.tournaments': 'Tournois',
  'archiveTournaments.title': 'Archive',
  'archiveTournaments.search': 'Rechercher',
  'archiveTournaments.searchPlaceholder': 'Nom de tournoi ou de ligue…',
  'archiveTournaments.year': 'Année',
  'archiveTournaments.rows': 'Lignes',
  'archiveTournaments.sort': 'Trier',
  'archiveTournaments.colTournamentLeague': 'Tournoi / Ligue',
  'archiveTournaments.colDateUpdated': 'Date / Mise à jour',
  'archiveTournaments.colPlayers': 'Joueurs',
  'archiveTournaments.colStatus': 'Statut',
  'archiveTournaments.sortName': 'Nom du tournoi',
  'archiveTournaments.sortLeagueName': 'Nom de la ligue',
  'archiveTournaments.sortDate': 'Date jouée',
  'archiveTournaments.sortUpdated': 'Dernière mise à jour',
  'archiveTournaments.sortPlayers': 'Joueurs',
  'archiveTournaments.sortStatus': 'Statut',
  'archiveTournaments.updatedAt': 'maj. {date}',
  'archiveTournaments.pageStatus': 'Page {page} sur {total} · {count} tournois',
  'archiveTournaments.noneMatch': 'Aucun tournoi ne correspond à cette vue.',
  'archiveTournaments.emptyYear': 'Aucun tournoi n’a été joué en {year}.',
  'archiveTournaments.emptyArchive': 'Cette archive ne contient encore aucun tournoi.',
  'archiveTournaments.loadFailed': 'Impossible de charger les tournois. Vérifiez la connexion puis réessayez.',
  'archiveTournaments.truncated': 'Affichage des {shown} premiers tournois sur {total} pour {year}. Cette année dépasse ce qu’une requête de catalogue renvoie. Affinez la recherche pour atteindre le reste.',
  'archiveTournaments.seasonFilter': 'Filtré sur une seule saison.',
  'archiveTournaments.clearSeasonFilter': 'Afficher toutes les saisons',
  'archiveTournaments.paginationAria': 'Pages des tournois de l’archive',
  'archiveTournaments.loadingAria': 'Chargement des tournois',
  'archiveTournaments.yearAria': 'Année affichée',
  'archiveTournaments.openAria': 'Ouvrir le tournoi {name}',
  'archiveTournaments.locked': 'Verrouillé — joué il y a plus de 365 jours',
  'archiveSeason.kicker': 'Saison de ligue',
  'archiveSeason.expandAria': 'Afficher les tournois de {name}',
  'archiveSeason.collapseAria': 'Masquer les tournois de {name}',
  'archiveSeason.fetching': 'Récupération des tournois de cette saison depuis le serveur — ses années ne sont pas stockées dans ce navigateur…',
  'archiveSeason.loadFailed': 'Impossible de charger les tournois de cette saison.',
  'archiveSeason.noTournaments': 'Cette saison ne contient encore aucun tournoi.',
  'archiveSeason.showAll': 'Afficher les {count} tournois',
  'archiveSeason.childLine': '{date} · {players} · {status}',
  'archiveSeason.playerCount': '{count} joueur',
  'archiveSeason.playerCountPlural': '{count} joueurs',
  'archiveSeason.tournamentCount': '{count} tournoi',
  'archiveSeason.tournamentCountPlural': '{count} tournois',
  'archiveSeason.meta': '{tournaments} · {players}',
  'archiveSeason.tournaments': 'Tournois',
  'archiveSeason.notFoundTitle': 'Saison introuvable',
  'archiveSeason.notFoundBody': 'La saison de ligue demandée n’existe pas ou a été supprimée.',
  'archiveSeason.loadOneFailed': 'Impossible de charger cette saison de ligue.',
  'archiveSeason.readThrough': 'Lu depuis le serveur. Cette liste n’est pas stockée dans ce navigateur.',
  'archiveSeason.locked': 'Verrouillée — tous les tournois de cette saison ont plus de 365 jours',
  'archiveSeason.datesRange': '{start} — {end}',
  'archiveSeason.noDates': 'Pas encore de date de tournoi',
  'archiveDetail.kicker': 'Tournoi archivé',
  'archiveDetail.season': 'Saison',
  'archiveDetail.standalone': 'Tournoi indépendant — sans ligue',
  'archiveDetail.updated': 'Mis à jour le {date}',
  'archiveDetail.locked': 'Verrouillé — joué il y a plus de 365 jours',
  'archiveDetail.loadFailed': 'Impossible de charger ce tournoi.',
  'archiveDetail.readOnly': 'Cette page est en lecture seule.',
  'archiveDetail.seeResult': 'Voir le résultat',
  'archiveDetail.backToTournaments': 'Retour aux tournois',
```

#### P10 — CSS appended to `src/styles.css`

Tokens only. `.archive-child-line` never sets `color`, so it inherits the global link colour from
`src/styles.css:32` instead of hardcoding one.

```css
/* archive-variant-b — the two-line Archive table, its expansion and its edge states. Tokens only. */
.archive-tabs { display: flex; gap: 2px; margin: 0 0 1rem; border-bottom: 1px solid var(--soot); }
.archive-tabs a { padding: .7rem 1.1rem; border: 1px solid transparent; border-bottom: 0; color: var(--steel); font-size: .9rem; font-weight: 700; text-decoration: none; }
.archive-tabs a:hover, .archive-tabs a:focus-visible { color: var(--ash); }
.archive-tabs a.is-selected { position: relative; top: 1px; border-color: var(--soot); background: var(--iron); color: var(--ash); }
.archive-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; margin: 0 0 .9rem; }
.archive-statusline { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; margin: 0 0 .6rem; color: var(--steel); font-size: .82rem; }
.archive-table { min-width: 0; }
.archive-table td { vertical-align: middle; white-space: nowrap; }
.archive-table .archive-sort-header { cursor: pointer; user-select: none; }
.archive-row { cursor: pointer; }
.archive-row-name { display: flex; flex-direction: column; gap: .12rem; white-space: normal; }
.archive-row-sub { color: var(--steel); font-size: .78rem; min-height: 1.1em; }
.archive-row-meta { color: var(--dim-ash); font-size: .82rem; }
.archive-row-meta .archive-row-secondary { color: var(--steel); }
.archive-lock { margin-left: .4rem; color: var(--steel); font-size: .78rem; }
.archive-expand { min-height: 0; padding: 0 .35rem 0 0; border: 0; background: transparent; color: var(--steel); font: inherit; cursor: pointer; }
.archive-expand[aria-expanded="true"] { color: var(--hot-blood); }
.archive-children > td { padding: 0; border-bottom: 1px solid var(--soot); background: var(--black-metal); }
.archive-child-list { padding: .35rem .7rem .5rem 2.1rem; }
.archive-child-line { display: block; margin: .1rem 0; padding: .36rem .5rem .36rem .75rem; border-left: 2px solid var(--rust-plate); font-size: .85rem; text-decoration: none; }
.archive-child-line:hover, .archive-child-line:focus-visible { border-left-color: var(--hot-blood); background: color-mix(in oklch, var(--blood) 14%, transparent); text-decoration: none; }
.archive-child-meta { color: var(--dim-ash); }
.archive-child-separator { margin: 0 .45rem; color: var(--soot); }
.archive-child-placeholder { display: block; padding: .36rem .5rem .36rem .75rem; border-left: 2px solid var(--rust-plate); color: var(--steel); font-size: .85rem; font-style: italic; }
.archive-skeleton { height: .72rem; background: linear-gradient(90deg, var(--raised-iron), var(--soot), var(--raised-iron)); background-size: 200% 100%; animation: archive-skeleton-shimmer 1.3s linear infinite; }
@keyframes archive-skeleton-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .archive-skeleton { animation: none; } }
```

### Consumes

Verbatim from the predecessors, binding, **not to be redesigned**:

- The five wire routes and the row / detail JSON shapes reproduced under **Inputs → From Depends**.
- `isArchiveTournamentLocked(tournamentDate: string, now?: Date): boolean` and
  `ARCHIVE_LOCK_WINDOW_DAYS = 365` from `src/app/domain/archive-models.ts`.
- `ArchiveYearPartition { year; completedAt: string | undefined; rowCount; items }` — `completedAt`
  absent means the year is **not** cached.
- The IndexedDB names, for reference only; **this ticket names none of them in any file it writes**:
  `ARCHIVE_CACHE_DB_NAME = 'gones-archive-cache'`, `CACHE_YEAR_PARTITION_STORE = 'year-partitions'`.
- `ArchiveRepository` / `ArchiveCacheService` members, under the substitution rule stated in
  **Inputs → From Depends**.
- `src/app/features/archive/league-season-list.component.ts` and its row loop.
- Existing app symbols, unchanged: `BackButtonComponent`, `RankingTableComponent`, `I18nService`,
  `logBoundaryError`, `calculateTournamentResult`, `buildTournamentSummary`,
  `formatPlayerWithArchetype`, `TournamentDocument`, `RoundDocument`, `PlayerArchetypeDocument`,
  `LeagueStatus`.

### Errors

| Path | Surface | Rendered as |
| --- | --- | --- |
| `listYears()` / `loadYear()` rejects | Tab 2 | `<p class="error" role="alert" data-cy="archive-tournaments-error">` with `archiveTournaments.loadFailed`; the table is not rendered; `logBoundaryError('archive-tournament-list.load', error, { year })` |
| years index empty | Tab 2 | `.empty` block with `archiveTournaments.emptyArchive`; no year request is issued |
| loaded year holds no row | Tab 2 | `.empty` block with `archiveTournaments.emptyYear` |
| search/season filter matches nothing | Tab 2 | `.empty` block with `archiveTournaments.noneMatch` |
| `truncated: true` | Tab 2 | `<p class="warning" role="status" data-cy="archive-tournaments-truncated">` with `archiveTournaments.truncated`, `{shown}` = rendered row count, `{total}` = `totalCount`, `{year}` = the year |
| `readSeasonTournaments` rejects | expansion | `expansion.set({ status: 'failed' })` → one `.archive-child-placeholder` line with `archiveSeason.loadFailed`; `logBoundaryError('archive-season-expansion.load', error, { seasonId })` |
| `getSeason()` resolves `undefined` (404) | Season page | `<mat-card class="panel">` with `archiveSeason.notFoundTitle` / `archiveSeason.notFoundBody` |
| `getSeason()` rejects | Season page | `.error` with `archiveSeason.loadOneFailed` |
| `getTournament()` resolves `undefined` (404) | detail / result | `<mat-card class="panel">` with `tournament.notFoundTitle` / `tournament.notFoundBody`, and `result.notFoundTitle` / `result.notFoundBody` on the result page |
| `getTournament()` rejects | detail / result | `.error` with `archiveDetail.loadFailed` / `result.loadFailed` |
| image or zip download throws | result | `.error` with `result.downloadImageFailed` / `result.downloadAllFailed` |

No page in this slice writes, so no `403`, `409` or `412` is reachable from it. A rejected request is
never rethrown into the router: every `load()` catches, logs through `logBoundaryError` and sets an
error signal, exactly as `tournament-archive-detail.component.ts:225` does.

### Invariants

- **Single writer.** No file written or edited by this ticket writes a year partition, warms a cache
  or invalidates one. `SeasonTournamentsSource` has no writer member, and
  `league-season-detail.component.ts` never imports `archive-backfill-queue`.
- **Read-path decision, binding.** `origin === 'cache'` ⇔ the span is non-empty **and** every year in
  it satisfies `isArchiveYearLocked(year, now) && partition?.completedAt !== undefined`. A single
  unlocked year, or a single missing / half-written partition, sends the whole Season through the
  server. There is no partial mix of the two origins.
- **Empty span short-circuit.** `firstTournamentDate === null || lastTournamentDate === null` ⇒
  zero cache reads, zero requests, `{ origin: 'cache', items: [], truncated: false }`.
- **Ordering.** Cache-served rows are re-sorted `tournamentDate DESC, id ASC` (ordinal `id` compare,
  matching the `C` collation the endpoints ask Postgres for). Server-served rows are rendered in the
  order received — the endpoint already guarantees that order — and are never re-sorted.
- **Membership.** A cache-served Season list keeps only rows with `row.seasonId === season.id`.
  `seasonId: null` (standalone) never appears in a Season expansion or on a Season page.
- **Lock derivation.** Row lock = `isArchiveTournamentLocked(row.tournamentDate)`. Year lock =
  `isArchiveTournamentLocked(\`${year}-12-31\`)`. Season lock = every Tournament of the Season locked,
  which for a cached Season is every year of its span locked. No lock state is ever read from a stored
  field.
- **Nullability.** `seasonId` is `string | null`, never `undefined`, never `''`. A row whose
  `seasonId` is `null`, or whose `seasonId` is absent from the season→League map, renders the League
  line as an **empty** `.archive-row-sub` span — present in the DOM so the two-line row keeps its
  height (`min-height: 1.1em`), holding no text.
- **Sort totality and stability.** Every comparator ends in `id` ASC ordinal, so the order is total
  and a re-sort of the same rows is byte-identical. An **empty** League name sorts **last in both
  directions**, the same rule the rankings table applies to a missing winrate: an absent value is not
  a small value.
- **Paging.** `page` is clamped into `[1, totalPages]` at render time; `totalPages = max(1, ceil(total / size))`.
  Changing `search`, `sort`, `size`, `year` or `season` resets `page` to 1.
- **Units.** `tournamentDate` is a calendar date `YYYY-MM-DD` with no timezone and is rendered through
  `i18n.formatDate(value, { dateStyle: 'medium' })`. `updatedAt` is a UTC instant and is rendered
  through `i18n.formatDateTime(value)`.
- **Idempotency.** Every page in this slice is a pure read. Re-entering a route with the same query
  string produces the same DOM and the same number of requests.
- **Accessibility.** An expandable row carries `aria-expanded` on the `<tr>` **and** on its expander
  `<button>`, which also carries `aria-controls` pointing at the children row's `id`. Every expanded
  child is an `<a routerLink>`, so it is in the tab order without a `tabindex`. The children `<tr>`
  is `[hidden]` when collapsed, so its links leave the tab order with it. Sortable headers carry
  `[attr.aria-sort]` (`ascending` / `descending` / omitted).
- **data-cy.** Every element in every new template carries `data-cy` or `[attr.data-cy]`, and every
  static `data-cy` value is unique within its file. Per-row identifiers use the binding form,
  `[attr.data-cy]="'archive-tournaments-row-' + row.id"`, which is the repo's sanctioned escape hatch
  for a deliberately repeated marker.

## TDD

1. **Red** — write the failing tests first, in this order, each named exactly as in the Test plan:
   1. `league-season-detail.component.test.ts` — the pure read path: `seasonSpanYears`,
      `isArchiveYearLocked`, `sortTournamentRowsByDateDesc`, `readSeasonTournaments`, and the two
      cache-untouched tests. These fail with "cannot find module" until the file exists.
   2. `tournament-list.component.test.ts` — the pure query/filter/sort helpers, then the component's
      first-load year resolution and its rendering states.
   3. `tournament-detail.component.test.ts` and `tournament-result.component.test.ts` — the adapter
      and the page states.
   4. The expansion-wiring assertions, in `league-season-detail.component.test.ts`, reading
      `league-season-list.component.ts` as text.
2. **Green** — write the minimum that passes: the pure functions first (they need no Angular), then
   the components, then the wiring, then routes / breadcrumbs / i18n / CSS.
3. **Refactor** — only if needed, keeping green. Do not extract a fifth module: the file layout of
   this slice is fixed at four new components plus their sibling tests.

Harness, verified by reading `src/app/features/leagues-archive/league-archive-list.component.test.ts`
and `src/app/app-breadcrumbs.test.ts`: **this repo has no TestBed and no zone.js.** Every component
test starts with

```ts
import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
```

builds the component in a bare `Injector.create({ providers: [...] })` with every dependency listed
explicitly — including `I18nService` and
`{ provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>('en') } }`,
which pins the language so a rendered string is a stable assertion — and drives its public surface
directly. Template shape that cannot be driven that way is asserted against the component's **source
text**, read with `readFileSync(join(__dirname, '…'), 'utf8')`, which is this repo's established
idiom for template claims.

## Test plan

`src/app/features/archive/league-season-detail.component.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `seasonSpanYears spans both bounds inclusively` | `('2019-11-24', '2021-01-02')` | `[2019, 2020, 2021]` |
| `seasonSpanYears returns one year for a single-year season` | `('2026-01-02', '2026-08-17')` | `[2026]` |
| `seasonSpanYears is empty when the season has no tournament` | `(null, null)`, `('2026-01-02', null)`, `(null, '2026-01-02')` | `[]` for all three |
| `seasonSpanYears tolerates reversed bounds` | `('2021-01-02', '2019-11-24')` | `[2019, 2020, 2021]` |
| `isArchiveYearLocked locks a year whose last day is past the window` | `(2019, new Date('2026-08-22T00:00:00Z'))` | `true` |
| `isArchiveYearLocked keeps the current year open` | `(2026, new Date('2026-08-22T00:00:00Z'))` | `false` |
| `isArchiveYearLocked keeps a year open while its December is inside the window` | `(2025, new Date('2026-08-22T00:00:00Z'))` | `false` — 2025-12-31 is 234 days old |
| `sortTournamentRowsByDateDesc orders by date then id` | rows `[{id:'b',date:'2026-01-01'},{id:'a',date:'2026-01-01'},{id:'c',date:'2026-02-01'}]` | ids `['c','a','b']` |
| `readSeasonTournaments serves a fully cached locked span from IndexedDB` | span 2019-2019, partition `{ completedAt: '…', items: [seasonRow, otherSeasonRow] }`, `now` 2026 | `origin === 'cache'`, one item (the Season's), **`fetchSeasonTournaments` never called** |
| `readSeasonTournaments reads through when one year is not cached` | span 2019-2020, 2019 cached+complete, 2020 `undefined` | `origin === 'server'`, items from the page, `fetchSeasonTournaments` called once with the season id |
| `readSeasonTournaments reads through when a partition is not complete` | partition `{ completedAt: undefined, items: [row] }` | `origin === 'server'` |
| `readSeasonTournaments reads through when a spanned year is not locked` | span 2026-2026, partition complete, `now` 2026 | `origin === 'server'` |
| `readSeasonTournaments never writes the cache on the read-through path` | source built as a recording double whose `get` trap throws on any member other than `readYearPartition` and `fetchSeasonTournaments` | resolves, and the recorded call log is exactly `['readYearPartition:2020', 'fetchSeasonTournaments:season-1']` |
| `readSeasonTournaments touches neither store for a season with no tournament` | `firstTournamentDate: null, lastTournamentDate: null` | `{ origin: 'cache', items: [], truncated: false }`, both spies called `0` times |
| `readSeasonTournaments carries the truncation flag off the read-through page` | page `{ truncated: true }` | `truncated === true` |
| `the season read path imports no cache writer` | source of `league-season-detail.component.ts` | does **not** contain `archive-backfill-queue`, `writeYearPartition`, `completedAt:` assignment, `indexedDB` or `IDB` |
| `SeasonTournamentsSource declares no writer` | source | the `interface SeasonTournamentsSource` block contains exactly the members `readYearPartition` and `fetchSeasonTournaments` |
| `the season page renders its tournaments through the read path` | component with a fake `ARCHIVE_SEASON_SOURCE` | `component.tournaments()` equals the read rows; `component.origin() === 'server'` |
| `the season page says so when the list came from the server` | source | `@if (origin() === 'server')` guards `data-cy="archive-season-read-through"` |
| `a missing season renders the not-found card, not an error` | `getSeason` → `undefined` | `component.notFound() === true`, `component.error() === ''` |
| `the season page carries both back buttons` | source | contains `position="top"` and `position="bottom"` |
| `the tab 1 row is expandable` | source of `league-season-list.component.ts` | contains `[attr.aria-expanded]="isSeasonExpanded(season.id)"`, `archive-season-expand-`, `aria-controls`, `class="archive-children"` and `toggleSeasonExpansion(season)` |
| `the tab 1 expansion uses the shared read path` | source of `league-season-list.component.ts` | contains `readSeasonTournaments(` and imports it from `./league-season-detail.component` |
| `the expanded children are links, not a nested table` | source of `league-season-list.component.ts` | the block between `class="archive-child-list"` and its close contains `<a` and contains no `<table` |
| `expanding a second season collapses the first` | `toggleSeasonExpansion(a)` then `toggleSeasonExpansion(b)` | `isSeasonExpanded(a.id) === false`, `isSeasonExpanded(b.id) === true` |
| `toggling the same season twice collapses it` | `toggleSeasonExpansion(a)` twice | `expandedSeasonId() === null` |
| `the expanded list is capped and offers the rest` | 14 children | `expandedChildren().length === 10`, `hasMoreChildren() === true` |
| `a short expanded list offers no show-all line` | 3 children | `hasMoreChildren() === false` |

`src/app/features/archive/tournament-list.component.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `parseArchiveTournamentQuery defaults every field` | `new URLSearchParams('')` | `{ page: 1, size: 25, search: '', sort: 'date', dir: 'desc', year: null, season: null }` |
| `parseArchiveTournamentQuery reads every field` | `'sort=players&dir=asc&page=3&size=100&search=lyon&year=2024&season=s1'` | that exact object |
| `parseArchiveTournamentQuery rejects an unknown sort key` | `'sort=rating'` | `sort === 'date'` |
| `parseArchiveTournamentQuery rejects an unknown page size` | `'size=42'` | `size === 25` |
| `parseArchiveTournamentQuery rejects a non-integer year` | `'year=20x4'` | `year === null` |
| `archiveTournamentQueryParams omits defaults` | the default query with `year: 2026` | `{ year: 2026 }` only |
| `archiveTournamentQueryParams round-trips a full query` | full query | `parseArchiveTournamentQuery(new URLSearchParams(params))` deep-equals the input |
| `toggleArchiveTournamentSort opens a new key descending` | query `sort:'date'`, key `'name'` | `{ sort: 'name', dir: 'desc', page: 1 }` |
| `toggleArchiveTournamentSort flips the current key` | query `sort:'date',dir:'desc'`, key `'date'` | `dir === 'asc'`, `page === 1` |
| `filterArchiveTournamentRows matches the tournament name case-insensitively` | rows, `'ÉTAPE'`… `'etape'` | the matching row only |
| `filterArchiveTournamentRows matches the league name` | search `'lyon'`, league name `'Ligue Lyon'` | that row |
| `filterArchiveTournamentRows keeps one season when asked` | `seasonId: 's1'` | only `seasonId === 's1'` rows; standalone rows excluded |
| `sortArchiveTournamentRows sorts by date desc by default` | mixed dates | newest first, `id` ASC within a date |
| `sortArchiveTournamentRows sorts by players ascending` | player counts `[3, 1, 2]` | `[1, 2, 3]` |
| `sortArchiveTournamentRows puts a standalone row last when sorting by league name` | one row with `seasonId: null`, `dir` both ways | the standalone row is last in **both** directions |
| `sortArchiveTournamentRows is total` | two rows sharing every sorted value | ordered by `id` ASC |
| `the tab selects the newest indexed year on first load` | years `[2024, 2025, 2026]`, no `?year=` | `loadYear` called once with `2026`; `router.navigate` called with `queryParams: { year: 2026 }` and `replaceUrl: true` |
| `the tab honours the year in the url` | `?year=2024` | `loadYear` called once with `2024`, `router.navigate` not called |
| `an unknown year falls back to the newest indexed one` | `?year=1999`, years `[2025, 2026]` | `loadYear` called with `2026` |
| `an empty archive asks for no year` | `listYears` → `[]` | `loadYear` never called, `emptyArchive() === true` |
| `the year select offers the indexed years newest first` | years `[2024, 2025, 2026]` | `component.yearOptions().map(o => o.year)` is `[2026, 2025, 2024]` |
| `the tab offers no all-years option` | source | does not contain `allYears`, `'all'` as a year value, or `archiveTournaments.allYears` |
| `a standalone tournament renders an empty league line` | row `seasonId: null` | `component.leagueNameOf(row) === ''` |
| `a tournament whose season is unknown renders an empty league line` | row `seasonId: 'ghost'`, empty map | `''` |
| `the league line is a real element even when empty` | source | `class="archive-row-sub"` is rendered unconditionally inside `archive-row-name` |
| `a locked row is marked` | row dated 400 days ago | `component.isLocked(row) === true` |
| `a row played exactly 365 days ago is not marked` | row dated `now - 365d` | `false` |
| `the truncation warning states both counts` | `loadYear` → `{ items: 3 rows, totalCount: 6214, truncated: true }` | `truncated() === true`; source guards `data-cy="archive-tournaments-truncated"` with `@if (truncated())` |
| `paging slices the sorted rows` | 30 rows, `size: 25` | page 1 has 25 rows, page 2 has 5, no id appears twice |
| `changing the search resets the page` | page 3, then `onSearchChange('x')` | the navigation carries `page` omitted (i.e. 1) |
| `a failed load renders the error, not an empty table` | `listYears` rejects | `error()` is the `archiveTournaments.loadFailed` string, `rows().length === 0` |
| `the loading state renders skeleton rows` | source | `@if (loading())` block contains `class="archive-skeleton"` |
| `the tab strip marks the tournaments tab selected` | source | `class="archive-tabs"` block contains `routerLink="/archive/league-seasons"` and a `/archive/tournaments` link carrying `is-selected` |
| `every sort key is reachable from the select` | `component.sortKeys` | deep-equals `['name','leagueName','date','updated','players','status']` |
| `the list carries both back buttons` | source | contains `position="top"` and `position="bottom"` |

`src/app/features/archive/tournament-detail.component.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `toResultInput fills the legacy league slot without inventing a league` | detail with `seasonId: 's1'` / `seasonId: null` | `leagueId === 's1'` / `leagueId === ''`; every other field identical |
| `the ranking is computed from the document` | detail with two rounds | `component.result().rows.length` equals the distinct player count |
| `a standalone tournament says so instead of linking a season` | `seasonId: null` | `component.seasonName() === ''`; source guards `data-cy="archive-tournament-standalone"` with `@if (!tournament()?.seasonId)` |
| `a season-bound tournament links its season` | `seasonId: 's1'` | source contains `[routerLink]="['/archive/league-seasons', t.seasonId]"` |
| `a locked tournament is marked` | dated 400 days ago | `component.locked() === true` |
| `a missing tournament renders the not-found card` | `getTournament` → `undefined` | `notFound() === true`, `error() === ''` |
| `a failed read renders the error` | `getTournament` rejects | `error()` is the `archiveDetail.loadFailed` string |
| `the detail page offers no mutation` | source | contains none of `save(`, `delete(`, `rename(`, `edit-batch`, `startEdit`, `ngModel` |
| `the detail page carries both back buttons` | source | contains `position="top"` and `position="bottom"` |

`src/app/features/archive/tournament-result.component.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `the standings page shows the top eight rows` | a 12-player tournament | `component.topStandingRows().length === 8` |
| `the metagames route opens the metagame page` | router url ending `/result/metagames` | `component.page() === 'metagames'` |
| `the standings route opens the standings page` | url ending `/result` | `component.page() === 'standings'` |
| `the metagame bars are split into two columns` | 9 archetype shares | `component.metagameColumns().length === 2`, `[0].length === 5`, `[1].length === 4` |
| `the result page cross-links both views and the tournament` | source | contains `'/archive/tournaments', tournamentId(), 'result', 'metagames'`, `'/archive/tournaments', tournamentId(), 'result'` and `['/archive/tournaments', tournamentId()]` |
| `the result page keeps both download controls` | source | contains `data-cy="archive-tournament-result-download-image"` and `…-download-all` |
| `a missing tournament renders the not-found card` | `getTournament` → `undefined` | `notFound() === true` |
| `the result page carries both back buttons` | source | contains `position="top"` and `position="bottom"` |

`src/app/app-breadcrumbs.test.ts` (extended, existing file)

| Test | Input | Expect |
| ---- | ----- | ------ |
| `labels the archive tournaments tab` | `buildBreadcrumbs('/archive/tournaments', en)` | `['Menu', 'Archive', 'Tournaments']` |
| `labels an archived tournament and links its tab` | `'/archive/tournaments/t1'` | 4 labels ending `'Tournament'`; crumb 2 links `['/archive/tournaments']` |
| `labels an archived tournament result` | `'/archive/tournaments/t1/result'` | 5 labels ending `'Result'` |
| `labels a league season` | `'/archive/league-seasons/s1'` | `['Menu', 'Archive', 'Season']` |
| `no archive path renders Not Found` | each of the five paths | no crumb equals `translate('en', 'nav.notFound')` |

Repo-wide gates that must stay green, run as part of `npm run test`:
`src/app/shared/data-cy-coverage.test.ts`, `src/app/shared/back-button-coverage.test.ts`,
`src/app/backend/server-authority-boundary.test.ts`, `src/app/data-mode-routes.test.ts`.

Run commands:

```bash
npx vitest run src/app/features/archive          # this slice only, while iterating
npx vitest run src/app/app-breadcrumbs.test.ts
npm run test                                     # the whole suite, before handing over
```

## Impl steps

- [ ] 1. **Season read path — pure core, red first.**
  - [ ] 1.1 `mkdir -p src/app/features/archive` (T13 already created it; the command is idempotent).
  - [ ] 1.2 Create `src/app/features/archive/league-season-detail.component.test.ts` with the header
        block from **TDD** and the first fourteen rows of its Test plan table — `seasonSpanYears`,
        `isArchiveYearLocked`, `sortTournamentRowsByDateDesc`, `readSeasonTournaments` and the two
        cache-untouched tests. Run `npx vitest run src/app/features/archive` and confirm it fails on
        the missing module.
  - [ ] 1.3 Create `src/app/features/archive/league-season-detail.component.ts` and paste into it,
        verbatim, the type block, the constant `SEASON_EXPANSION_PREVIEW_LIMIT = 10` and the four
        function signatures from **Interface contract → P3**, plus the reference body of
        `readSeasonTournaments` given there.
  - [ ] 1.4 In the same file, add the private year helper and the two remaining bodies:

        ```ts
        function yearOf(value: string | null): number | null {
          const match = /^(\d{4})-\d{2}-\d{2}$/.exec(value ?? '');
          return match ? Number(match[1]) : null;
        }

        export function seasonSpanYears(firstTournamentDate: string | null, lastTournamentDate: string | null): number[] {
          const first = yearOf(firstTournamentDate);
          const last = yearOf(lastTournamentDate);
          if (first === null || last === null) return [];
          const from = Math.min(first, last);
          const to = Math.max(first, last);
          return Array.from({ length: to - from + 1 }, (_, index) => from + index);
        }

        /** The last day of the year is the newest Tournament it can hold, so it decides the year. */
        export function isArchiveYearLocked(year: number, now: Date = new Date()): boolean {
          return isArchiveTournamentLocked(`${year}-12-31`, now);
        }

        export function sortTournamentRowsByDateDesc(rows: readonly ArchiveTournamentRow[]): ArchiveTournamentRow[] {
          return [...rows].sort((left, right) =>
            (left.tournamentDate < right.tournamentDate ? 1 : left.tournamentDate > right.tournamentDate ? -1 : 0)
            || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
        }
        ```
  - [ ] 1.5 Add the `ARCHIVE_SEASON_SOURCE` token and its factory — **the only place in this file that
        names a T12 symbol**:

        ```ts
        function archiveSeasonSourceFactory(): ArchiveSeasonSource {
          const repo = inject(ArchiveRepository);
          const cache = inject(ArchiveCacheService);
          return {
            readYearPartition: (year) => cache.readYearPartition(year),
            fetchSeasonTournaments: (seasonId) => repo.fetchSeasonTournaments(seasonId),
            getSeason: async (seasonId) => (await repo.listLeagueSeasonSummaries()).find((season) => season.id === seasonId),
            getLeagueName: async (leagueId) => (await repo.listLeagueSummaries()).find((league) => league.id === leagueId)?.name
          };
        }
        ```
  - [ ] 1.6 Run `npx vitest run src/app/features/archive`; the fourteen pure-core tests go green.

- [ ] 2. **Season detail page.**
  - [ ] 2.1 Append the five Season-page rows of the Test plan to
        `league-season-detail.component.test.ts`. Confirm they fail.
  - [ ] 2.2 In `league-season-detail.component.ts`, add the `@Component({ standalone: true, imports:
        [RouterLink, MatCardModule, BackButtonComponent] })` decorator and the
        `LeagueSeasonDetailComponent` class with fields
        `loading`, `error`, `notFound`, `season`, `leagueName`, `origin`, `truncated`,
        `tournaments`, all `signal`s, and `readonly i18n = inject(I18nService)`,
        `private readonly source = inject(ARCHIVE_SEASON_SOURCE)`,
        `private readonly route = inject(ActivatedRoute)`.
  - [ ] 2.3 Add `async load()`: read `seasonId` from `this.route.snapshot.paramMap`, call
        `source.getSeason`; `undefined` → `notFound.set(true)` and return; otherwise set the Season,
        `void this.source.getLeagueName(season.leagueId).then(…)`, then
        `const read = await readSeasonTournaments(season, this.source);` and set `origin`, `truncated`
        and `tournaments` from it. Wrap in `try/catch/finally` exactly as
        `tournament-archive-detail.component.ts:214-228` does, logging
        `logBoundaryError('archive-season-detail.load', error, { seasonId })` and setting
        `archiveSeason.loadOneFailed`. Call it from the constructor with `void this.load();`.
  - [ ] 2.4 Write the template: `gones-back-button position="top"` with
        `[link]="['/archive/league-seasons']"`; a `.page-heading` with `.kicker`
        (`archiveSeason.kicker`), the Season name as `<h1>`, the League name, the status chip
        (`class="status"` + `[class.completed]` + `.status-dot`, copied from
        `tournament-archive-detail.component.ts:141`) and the 🔒 marker when every spanned year is
        locked; the counters line through `archiveSeason.meta`; the date range through
        `archiveSeason.datesRange` or `archiveSeason.noDates`; then the Tournament list rendered as
        `.archive-child-list` lines identical in shape to the expansion (step 7.3), uncapped; then
        `@if (origin() === 'server')` → `<p class="muted" data-cy="archive-season-read-through">{{ i18n.t('archiveSeason.readThrough') }}</p>`;
        then the not-found `<mat-card class="panel">`; then `gones-back-button position="bottom"`.
        Give every element a unique static `data-cy` prefixed `archive-season-`, using
        `[attr.data-cy]="'archive-season-tournament-' + row.id"` for the repeated line.
  - [ ] 2.5 Run `npx vitest run src/app/features/archive` — green.

- [ ] 3. **Tab 2 pure helpers.**
  - [ ] 3.1 Create `src/app/features/archive/tournament-list.component.test.ts` with the sixteen
        helper rows of its Test plan table. Confirm they fail.
  - [ ] 3.2 Create `src/app/features/archive/tournament-list.component.ts` and paste the constants,
        types and signatures from **Interface contract → P4**.
  - [ ] 3.3 Implement `parseArchiveTournamentQuery` on the `{ get(key: string): string | null }` shape,
        applying the fallback column of the P2 table field by field. `year`: accept only
        `/^\d{4}$/`, else `null`. `search`: `(params.get('search') ?? '').trim()`.
  - [ ] 3.4 Implement `archiveTournamentQueryParams`: start from `{}`, add `sort` unless `'date'`,
        `dir` unless `'desc'`, `page` unless `1`, `size` unless `25`, `search` unless empty, `season`
        unless `null`, and `year` whenever it is not `null`.
  - [ ] 3.5 Implement `toggleArchiveTournamentSort`:
        `const same = query.sort === key; return { ...query, sort: key, dir: same && query.dir === 'desc' ? 'asc' : 'desc', page: 1 };`
  - [ ] 3.6 Implement `filterArchiveTournamentRows`: lowercase the trimmed search once, keep a row when
        `seasonId === null || row.seasonId === seasonId`, and when the search is empty or
        `row.name.toLowerCase().includes(term) || leagueNameOf(row).toLowerCase().includes(term)`.
  - [ ] 3.7 Implement `sortArchiveTournamentRows` with one comparator per key, `sign = dir === 'asc' ? 1 : -1`,
        an ordinal string compare (`left < right ? -1 : left > right ? 1 : 0` — **not** `localeCompare`,
        which is locale-dependent and would disagree with the server's `C` collation), the
        empty-League-name-last rule applied **before** the sign, and `id` ASC as the final tiebreak.
  - [ ] 3.8 Run `npx vitest run src/app/features/archive` — the sixteen helper tests go green.

- [ ] 4. **Tab 2 component.**
  - [ ] 4.1 Append the remaining Tab 2 rows of the Test plan to `tournament-list.component.test.ts`.
        Confirm they fail.
  - [ ] 4.2 Add the `ARCHIVE_TOURNAMENT_TAB_SOURCE` token and its factory — the only T12 call site in
        this file:

        ```ts
        function archiveTournamentTabSourceFactory(): ArchiveTournamentTabSource {
          const repo = inject(ArchiveRepository);
          return {
            listYears: () => repo.listYears(),
            loadYear: (year) => repo.loadTournamentYear(year),
            listSeasonLeagueNames: async () => {
              const [seasons, leagues] = await Promise.all([repo.listLeagueSeasonSummaries(), repo.listLeagueSummaries()]);
              const leagueNames = new Map(leagues.map((league) => [league.id, league.name]));
              return new Map(seasons.flatMap((season) => {
                const name = leagueNames.get(season.leagueId);
                return name === undefined ? [] : [[season.id, name] as const];
              }));
            }
          };
        }
        ```
  - [ ] 4.3 Add the `@Component({ standalone: true, imports: [FormsModule, RouterLink, MatButtonModule,
        MatFormFieldModule, MatInputModule, MatSelectModule, BackButtonComponent] })` decorator and the
        `TournamentListComponent` class: `i18n`, `source = inject(ARCHIVE_TOURNAMENT_TAB_SOURCE)`,
        `route`, `router`; signals `loading`, `error`, `years`, `rows`, `totalCount`, `truncated`,
        `query`, `seasonLeagueNames`; `readonly sortKeys = ARCHIVE_TOURNAMENT_SORT_KEYS`;
        `readonly pageSizes = ARCHIVE_TABLE_PAGE_SIZES`.
  - [ ] 4.4 Add `leagueNameOf = (row: ArchiveTournamentRow): string => row.seasonId === null ? '' : (this.seasonLeagueNames().get(row.seasonId) ?? '');`
        and `isLocked(row: ArchiveTournamentRow): boolean { return isArchiveTournamentLocked(row.tournamentDate); }`.
  - [ ] 4.5 Add the derivations: `filteredRows` = `filterArchiveTournamentRows(rows(), query().search, query().season, this.leagueNameOf)`;
        `sortedRows` = `sortArchiveTournamentRows(filteredRows(), query().sort, query().dir, this.leagueNameOf)`;
        `totalPages` = `Math.max(1, Math.ceil(filteredRows().length / query().size))`;
        `currentPage` = `Math.min(Math.max(query().page, 1), totalPages())`;
        `pagedRows` = the slice; `yearOptions` = `[...years()].sort((a, b) => b.year - a.year)`;
        `emptyArchive` = `!loading() && !error() && years().length === 0`.
  - [ ] 4.6 Add the constructor: subscribe to `this.route.queryParamMap`, set `query` from
        `parseArchiveTournamentQuery(params)`, and call `void this.load();` on each emission.
  - [ ] 4.7 Add `async load()`: load `listYears()` once (skip if already loaded), resolve the year as
        *the URL year when the index contains it, else the newest indexed year, else `null`*; when the
        resolved year differs from `query().year`, call
        `void this.router.navigate([], { relativeTo: this.route, queryParams: archiveTournamentQueryParams({ ...this.query(), year: resolved, page: 1 }), replaceUrl: true })`
        and return — the subscription re-enters with the corrected URL; otherwise
        `const page = await this.source.loadYear(resolved)` and set `rows`, `totalCount`, `truncated`,
        plus `this.seasonLeagueNames.set(await this.source.listSeasonLeagueNames())`. Catch, log
        `logBoundaryError('archive-tournament-list.load', error, { year })`, set
        `archiveTournaments.loadFailed`; `finally` clear `loading`.
  - [ ] 4.8 Add the navigation handlers `onSearchChange(value)`, `setSize(size)`, `setSort(key)`,
        `sortBy(key)` (via `toggleArchiveTournamentSort`), `setYear(year)`, `goPage(page)` and
        `clearSeasonFilter()`; each builds the next query, resets `page` to 1 except `goPage`, and
        navigates with `archiveTournamentQueryParams`. Add
        `ariaSort(key): 'ascending' | 'descending' | null`.
  - [ ] 4.9 Write the template, in this order: `gones-back-button position="top" [link]="['/']"
        [label]="i18n.t('nav.returnToMenu')"`; `.page-heading` with `archiveTournaments.title`;
        `<nav class="archive-tabs" [attr.aria-label]="i18n.t('archiveTabs.aria')">` holding
        `<a routerLink="/archive/league-seasons">` and
        `<a class="is-selected" routerLink="/archive/tournaments">`; `.archive-toolbar` with the
        search input, the year `<mat-select>`, the rows `<mat-select>` and the sort `<mat-select>`;
        the season-filter chip guarded by `@if (query().season)` carrying the
        `archiveTournaments.clearSeasonFilter` button; `@if (error())`; `@if (truncated())`;
        `.archive-statusline` with `archiveTournaments.pageStatus`; the
        `<div class="table-wrap"><table class="ranking-table archive-table">` with the four
        `<th class="archive-sort-header" [attr.aria-sort]="ariaSort('…')" (click)="sortBy('…')">`
        headers; the `@if (loading())` skeleton `<tr>`s using `class="archive-skeleton"`; the
        `@for (row of pagedRows(); track row.id)` body; the three `@empty`/empty-state blocks; the
        pagination `<nav>` copied in shape from `league-archive-list.component.ts:76-82`; and
        `gones-back-button position="bottom"`.
  - [ ] 4.10 Write the row exactly in the Variant B shape, four `<td>`s:

        ```html
        <tr class="archive-row" [attr.data-cy]="'archive-tournaments-row-' + row.id">
          <td [attr.data-cy]="'archive-tournaments-name-cell-' + row.id">
            <span class="archive-row-name" [attr.data-cy]="'archive-tournaments-name-' + row.id">
              <a [routerLink]="['/archive/tournaments', row.id]" [attr.aria-label]="i18n.t('archiveTournaments.openAria', { name: row.name })" [attr.data-cy]="'archive-tournaments-link-' + row.id">{{ row.name }}</a>
              <span class="archive-row-sub" [attr.data-cy]="'archive-tournaments-league-' + row.id">{{ leagueNameOf(row) }}</span>
            </span>
          </td>
          <td class="archive-row-meta" [attr.data-cy]="'archive-tournaments-dates-' + row.id">{{ i18n.formatDate(row.tournamentDate, { dateStyle: 'medium' }) }}<span class="archive-row-secondary" [attr.data-cy]="'archive-tournaments-updated-' + row.id">{{ i18n.t('archiveTournaments.updatedAt', { date: i18n.formatDateTime(row.updatedAt) }) }}</span></td>
          <td class="archive-row-meta" [attr.data-cy]="'archive-tournaments-players-' + row.id">{{ row.playerCount }}</td>
          <td [attr.data-cy]="'archive-tournaments-status-cell-' + row.id">
            <span class="status" [class.completed]="row.status === 'completed'" [attr.data-cy]="'archive-tournaments-status-' + row.id"><span class="status-dot" aria-hidden="true" [attr.data-cy]="'archive-tournaments-status-dot-' + row.id"></span>{{ row.status === 'completed' ? i18n.t('common.completed') : i18n.t('common.active') }}</span>
            @if (isLocked(row)) { <span class="archive-lock" [attr.title]="i18n.t('archiveTournaments.locked')" [attr.aria-label]="i18n.t('archiveTournaments.locked')" [attr.data-cy]="'archive-tournaments-lock-' + row.id">🔒</span> }
          </td>
        </tr>
        ```

        The `.archive-row-sub` span is rendered **unconditionally**: an empty League line still has to
        occupy its line, or a standalone row would be one line shorter than its neighbours.
  - [ ] 4.11 Run `npx vitest run src/app/features/archive` — green.

- [ ] 5. **Tournament detail page.**
  - [ ] 5.1 Create `src/app/features/archive/tournament-detail.component.test.ts` from its Test plan
        table. Confirm it fails.
  - [ ] 5.2 Create `src/app/features/archive/tournament-detail.component.ts` with the types, the token
        and `toResultInput` from **Interface contract → P5**:

        ```ts
        export function toResultInput(detail: ArchiveTournamentDetail): TournamentDocument {
          return {
            id: detail.id,
            leagueId: detail.seasonId ?? '',
            name: detail.name,
            tournamentDate: detail.tournamentDate,
            status: detail.status,
            rounds: [...detail.rounds],
            playerArchetypes: [...detail.playerArchetypes]
          };
        }
        ```
  - [ ] 5.3 Add the factory — the only T12 call site in this file:

        ```ts
        function archiveTournamentDetailSourceFactory(): ArchiveTournamentDetailSource {
          const repo = inject(ArchiveRepository);
          return {
            getTournament: async (tournamentId) => (await repo.getTournament(tournamentId)) ?? undefined,
            getSeasonName: async (seasonId) => (await repo.listLeagueSeasonSummaries()).find((season) => season.id === seasonId)?.name
          };
        }
        ```
  - [ ] 5.4 Add `TournamentDetailComponent`: signals `loading`, `error`, `notFound`, `tournament`,
        `seasonName`; `readonly result = computed(() => this.tournament() ? calculateTournamentResult(toResultInput(this.tournament()!)) : { rows: [], incomplete: true, provisional: false });`
        `readonly locked = computed(() => { const t = this.tournament(); return t ? isArchiveTournamentLocked(t.tournamentDate) : false; });`
        and `async load()` following the same try/catch/finally shape, logging
        `logBoundaryError('archive-tournament-detail.load', …)`.
  - [ ] 5.5 Write the template: top back button linking `['/archive/tournaments']` with
        `archiveDetail.backToTournaments`; `.page-heading` with `.kicker` (`archiveDetail.kicker`),
        the name, the date, `archiveDetail.updated`, the status chip, the lock marker; then either
        `<a [routerLink]="['/archive/league-seasons', t.seasonId]">{{ seasonName() }}</a>` or, under
        `@if (!tournament()?.seasonId)`, `data-cy="archive-tournament-standalone"` with
        `archiveDetail.standalone`; then
        `<gones-ranking-table [rows]="result().rows" [emptyText]="i18n.t('tournament.emptyRanking')" …/>`;
        then a read-only rounds section listing `tournament.roundN` and `tournament.entriesCount` per
        round with the round entries in a `.table-wrap > table.ranking-table`, **inputs replaced by
        plain text** — this page has no `ngModel` and no button that mutates; then a link to
        `['/archive/tournaments', id, 'result']` with `archiveDetail.seeResult`; then
        `<p class="muted" data-cy="archive-tournament-read-only">{{ i18n.t('archiveDetail.readOnly') }}</p>`;
        the not-found `<mat-card class="panel">` using `tournament.notFoundTitle` /
        `tournament.notFoundBody`; and the bottom back button.
  - [ ] 5.6 Run `npx vitest run src/app/features/archive` — green.

- [ ] 6. **Tournament result page.**
  - [ ] 6.1 Create `src/app/features/archive/tournament-result.component.test.ts` from its Test plan
        table. Confirm it fails.
  - [ ] 6.2 Create `src/app/features/archive/tournament-result.component.ts`. Copy
        `src/app/features/tournaments-archive/tournament-archive-result.component.ts` **lines 179-351**
        into it verbatim, with a header comment recording why it is a copy: the source file is deleted
        at the end of this plan, so a reference into it would break at deletion time.
  - [ ] 6.3 Add `TournamentResultComponent` mirroring
        `tournament-archive-result.component.ts:106-176`, with three changes: the document comes from
        `ARCHIVE_TOURNAMENT_DETAIL_SOURCE.getTournament` instead of `repo.getLeague`, the summary is
        `buildTournamentSummary(toResultInput(detail))`, and the title renders the Season name when
        there is one and nothing when there is not — never `result.unknownLeague`, which would state
        a League a standalone Tournament does not have.
  - [ ] 6.4 Port the template from `tournament-archive-result.component.ts:13-104`, re-pointing every
        `routerLink` at `['/archive/tournaments', tournamentId(), …]` and re-prefixing every `data-cy`
        to `archive-tournament-result-`. Keep both download buttons and both cross-links.
  - [ ] 6.5 Run `npx vitest run src/app/features/archive` — green.

- [ ] 7. **Season row expansion on Tab 1.**
  - [ ] 7.1 Append the seven expansion rows of the Test plan to
        `league-season-detail.component.test.ts`, including the two that read
        `league-season-list.component.ts` as text with
        `readFileSync(join(__dirname, 'league-season-list.component.ts'), 'utf8')`. Confirm they fail.
  - [ ] 7.2 In `src/app/features/archive/league-season-list.component.ts`, import
        `{ ArchiveSeasonRow, ArchiveTournamentRow, SeasonExpansionState, SEASON_EXPANSION_PREVIEW_LIMIT, ARCHIVE_SEASON_SOURCE, readSeasonTournaments }`
        from `'./league-season-detail.component'` and add the members from
        **Interface contract → P7**:

        ```ts
        private readonly seasonSource = inject(ARCHIVE_SEASON_SOURCE);
        readonly expandedSeasonId = signal<string | null>(null);
        readonly expansion = signal<SeasonExpansionState>({ status: 'loading' });

        isSeasonExpanded(seasonId: string): boolean { return this.expandedSeasonId() === seasonId; }
        seasonChildrenRowId(seasonId: string): string { return `archive-season-children-${seasonId}`; }
        expandLabel(season: ArchiveSeasonRow): string {
          return this.i18n.t(this.isSeasonExpanded(season.id) ? 'archiveSeason.collapseAria' : 'archiveSeason.expandAria', { name: season.name });
        }
        expandedChildren(): readonly ArchiveTournamentRow[] {
          const state = this.expansion();
          return state.status === 'ready' ? state.items.slice(0, SEASON_EXPANSION_PREVIEW_LIMIT) : [];
        }
        hasMoreChildren(): boolean {
          const state = this.expansion();
          return state.status === 'ready' && state.items.length > SEASON_EXPANSION_PREVIEW_LIMIT;
        }
        expandedTotal(): number {
          const state = this.expansion();
          return state.status === 'ready' ? state.items.length : 0;
        }

        /** One Season open at a time: an expansion may issue a read-through request. */
        async toggleSeasonExpansion(season: ArchiveSeasonRow): Promise<void> {
          if (this.isSeasonExpanded(season.id)) { this.expandedSeasonId.set(null); return; }
          this.expandedSeasonId.set(season.id);
          this.expansion.set({ status: 'loading' });
          try {
            const read = await readSeasonTournaments(season, this.seasonSource);
            if (this.expandedSeasonId() !== season.id) return;   // a faster click won
            this.expansion.set({ status: 'ready', origin: read.origin, items: read.items, truncated: read.truncated });
          } catch (error) {
            logBoundaryError('archive-season-expansion.load', error, { seasonId: season.id });
            if (this.expandedSeasonId() === season.id) this.expansion.set({ status: 'failed' });
          }
        }
        ```
  - [ ] 7.3 Patch the existing row loop of that component's template with the four markup changes
        listed in **Interface contract → P7**, and emit the children row immediately after the row
        `<tr>`:

        ```html
        <tr class="archive-children" [id]="seasonChildrenRowId(season.id)" [hidden]="!isSeasonExpanded(season.id)" [attr.data-cy]="'archive-season-children-' + season.id">
          <td [attr.colspan]="4" [attr.data-cy]="'archive-season-children-cell-' + season.id">
            <div class="archive-child-list" [attr.data-cy]="'archive-season-child-list-' + season.id">
              @if (expansion().status === 'loading') {
                <span class="archive-child-placeholder" [attr.data-cy]="'archive-season-child-loading-' + season.id">{{ i18n.t('archiveSeason.fetching') }}</span>
              } @else if (expansion().status === 'failed') {
                <span class="archive-child-placeholder" [attr.data-cy]="'archive-season-child-failed-' + season.id">{{ i18n.t('archiveSeason.loadFailed') }}</span>
              } @else {
                @for (child of expandedChildren(); track child.id) {
                  <a class="archive-child-line" [routerLink]="['/archive/tournaments', child.id]" [attr.data-cy]="'archive-season-child-' + child.id">
                    <b [attr.data-cy]="'archive-season-child-name-' + child.id">{{ child.name }}</b><span class="archive-child-separator" aria-hidden="true" [attr.data-cy]="'archive-season-child-sep-' + child.id">·</span><span class="archive-child-meta" [attr.data-cy]="'archive-season-child-meta-' + child.id">{{ i18n.t('archiveSeason.childLine', { date: i18n.formatDate(child.tournamentDate, { dateStyle: 'medium' }), players: i18n.plural(child.playerCount, 'archiveSeason.playerCount', 'archiveSeason.playerCountPlural'), status: child.status === 'completed' ? i18n.t('common.completed') : i18n.t('common.active') }) }}</span>
                  </a>
                } @empty {
                  <span class="archive-child-placeholder" [attr.data-cy]="'archive-season-child-empty-' + season.id">{{ i18n.t('archiveSeason.noTournaments') }}</span>
                }
                @if (hasMoreChildren()) {
                  <a class="archive-child-line" [routerLink]="['/archive/league-seasons', season.id]" [attr.data-cy]="'archive-season-child-more-' + season.id"><b [attr.data-cy]="'archive-season-child-more-label-' + season.id">{{ i18n.t('archiveSeason.showAll', { count: expandedTotal() }) }}</b></a>
                }
              }
            </div>
          </td>
        </tr>
        ```
  - [ ] 7.4 Run `npx vitest run src/app/features/archive` — green. If a T13 identifier in that
        component differs from a name used above (for instance the row loop variable is not `season`),
        adapt the **call sites only**; never change a member signature declared in P7.

- [ ] 8. **Routes.**
  - [ ] 8.1 In `src/app/app.routes.ts`, insert the five route objects from **Interface contract → P1**
        immediately after the existing `archive/league-seasons` route inside `buildRoutes`.
  - [ ] 8.2 Run `npx vitest run src/app/data-mode-routes.test.ts src/app/shared/back-button-coverage.test.ts`
        — both green. `back-button-coverage` now walks the four new components and demands both
        positions in each.

- [ ] 9. **Breadcrumbs.**
  - [ ] 9.1 Append the five breadcrumb rows of the Test plan to `src/app/app-breadcrumbs.test.ts`.
        Confirm they fail on the `Not Found` label.
  - [ ] 9.2 In `src/app/app-breadcrumbs.ts`, insert the `archive` branch **before** the
        `if (segments[0] !== 'leagues-archive')` line (line 70 today):

        ```ts
        if (segments[0] === 'archive') {
          const root = { label: menu, link: ['/'] };
          const archive = { label: t('crumb.archive'), link: ['/archive/league-seasons'] };
          if (segments[1] === 'league-seasons' && segments[2]) return [root, archive, { label: t('crumb.season') }];
          if (segments[1] !== 'tournaments') return [root, { label: t('crumb.archive') }];
          const tab = { label: t('crumb.archiveTournaments'), link: ['/archive/tournaments'] };
          if (!segments[2]) return [root, archive, { label: t('crumb.archiveTournaments') }];
          const tournamentId = decodeURIComponent(segments[2]);
          if (segments[3] === 'result') {
            return [root, archive, tab, { label: t('crumb.tournament'), link: ['/archive/tournaments', tournamentId] }, { label: t('crumb.result') }];
          }
          return [root, archive, tab, { label: t('crumb.tournament') }];
        }
        ```
  - [ ] 9.3 Run `npx vitest run src/app/app-breadcrumbs.test.ts` — green.

- [ ] 10. **i18n.**
  - [ ] 10.1 Run `grep -n "'archiveTabs\.\|'archiveTournaments\.\|'archiveSeason\.\|'archiveDetail\.\|'crumb\.archive\|'crumb\.season'" src/app/i18n/messages.ts`.
        Any key that already exists was added by the preceding ticket: **reuse it and do not re-add it**
        — a duplicate key in either object literal is `ts(1117)`.
  - [ ] 10.2 Insert the remaining `en` keys from **Interface contract → P9** after
        `'archive.reopenConfirm'` in `const en` (line 572 today).
  - [ ] 10.3 Insert the matching `fr` keys after `'archive.reopenConfirm'` in `const fr`
        (line 1813 today).
        `const fr: Record<MessageKey, string>` makes a missing French key a compile error, so
        `npm run typecheck` is the check that both halves landed.
  - [ ] 10.4 Run `npm run typecheck`.

- [ ] 11. **CSS.**
  - [ ] 11.1 Run `grep -n "\.archive-" src/styles.css`. Append from **Interface contract → P10** only
        the selectors that are **absent**; never redefine one the preceding ticket already wrote.
  - [ ] 11.2 Append the surviving block at the end of `src/styles.css`.
  - [ ] 11.3 Run `npx vitest run src/app/shared/card-hover-contract.test.ts` — green (the appended
        block touches none of its markers).

- [ ] 12. **Whole-suite gates.**
  - [ ] 12.1 `npm run test`.
  - [ ] 12.2 `npm run typecheck`.
  - [ ] 12.3 `npm run lint`.
  - [ ] 12.4 `npm run build`.
  - [ ] 12.5 `npm run e2e:ci`.
  - [ ] 12.6 `git status --porcelain` — confirm the changed set is exactly the eight files listed under
        **Outputs**, plus the four new sibling test files, and nothing under
        `src/app/features/leagues-archive/`, `src/app/features/tournaments-archive/` or `backend/`.

## Outputs

**Files created (8):**

- `src/app/features/archive/tournament-list.component.ts`
- `src/app/features/archive/tournament-list.component.test.ts`
- `src/app/features/archive/league-season-detail.component.ts`
- `src/app/features/archive/league-season-detail.component.test.ts`
- `src/app/features/archive/tournament-detail.component.ts`
- `src/app/features/archive/tournament-detail.component.test.ts`
- `src/app/features/archive/tournament-result.component.ts`
- `src/app/features/archive/tournament-result.component.test.ts`

**Files edited (6):**

- `src/app/features/archive/league-season-list.component.ts` — additive: the expansion members and the
  children row.
- `src/app/app.routes.ts` — five new routes inside `buildRoutes`.
- `src/app/app-breadcrumbs.ts` — one `archive` branch.
- `src/app/app-breadcrumbs.test.ts` — five new assertions.
- `src/app/i18n/messages.ts` — new keys in both catalogues.
- `src/styles.css` — the `archive-variant-b` block appended.

**Behaviour change**

- Five new public routes render; no existing route changes behaviour.
- `/archive/**` breadcrumbs stop rendering "Not Found".
- No API surface changes. No cache write is added. No mutation is added.

**Migrate / config**

- None. No migration, no configuration key, no environment variable, no `npm run api:generate`.

## Validation

- [ ] tests pass:
  - `npx vitest run src/app/features/archive` — the four new suites green.
  - `npx vitest run src/app/app-breadcrumbs.test.ts` — green, including the five new cases.
  - `npx vitest run src/app/shared/data-cy-coverage.test.ts src/app/shared/back-button-coverage.test.ts src/app/backend/server-authority-boundary.test.ts src/app/data-mode-routes.test.ts` — green.
  - `npm run test` — whole suite green, exit code `0`.
  - `npm run typecheck` — `tsc --noEmit` on both projects, no output, exit code `0`.
  - `npm run lint` — exit code `0`.
  - `npm run build` — exit code `0`.
  - `npm run e2e:ci` — exit code `0`, with no Cypress spec edited.
- [ ] manual check (UI), with `npm run dev` and a seeded archive (`npm run dev:env`):
  - `/archive/tournaments` opens on the newest year, the URL gains `?year=<newest>` with no history
    entry, and the table shows four columns carrying six values.
  - A standalone Tournament's row shows an **empty** second line under its name and is still exactly
    as tall as its neighbours.
  - Clicking a paired header toggles `aria-sort`; the sort `<select>` reaches `leagueName`,
    `updated` and `status`, which no header exposes.
  - `/archive/league-seasons`: clicking a Season row's chevron expands it into compact one-line
    children; `Tab` reaches every child line; `Enter` on the expander toggles it; the DOM shows
    `aria-expanded` flipping on both the `<tr>` and the button.
  - Expanding a Season whose years are **not** cached shows the italic fetching placeholder, then the
    lines. Open DevTools → Application → IndexedDB → `gones-archive-cache` → `year-partitions`
    **before and after**: the store is byte-identical. That is the invariant this ticket exists to
    protect.
  - Expanding a Season whose years are all cached, complete and locked issues **no** request — check
    the Network tab.
  - Switching the language to French re-renders every string on all five pages; none stays English.
- [ ] app functional — no broken path from this slice: `/leagues-archive`,
  `/leagues-archive/:leagueId` and `/leagues-archive/:leagueId/tournaments-archive/:tournamentId`
  still render exactly as before, and the retired-path redirects still resolve.
- [ ] commit msg draft: `feat(archive): list every Tournament and expand a Season without writing the cache`

---

## Notes for the reviewer — decisions taken here, and gaps found

Recorded in the ticket because a level-5 spec may not leave them to the implementer.

1. **The shell is not imported.** The plan freezes `archive-shell.component.ts`'s existence but not
   its selector or inputs. Guessing one breaks the build; six lines of local tab markup cannot. If
   the shell's contract lands before this ticket is implemented, replacing the local
   `<nav class="archive-tabs">` with it is a one-hunk change and the tests here do not pin the strip's
   internals, only that both tabs are reachable and that Tournaments is the selected one.
2. **No "All loaded" year option**, though the prototype's Variant B toolbar offers one. A union of
   whichever partitions this browser happens to hold renders a list whose completeness depends on
   cache history, and the table cannot distinguish it from a complete one — the exact failure the
   truncation warning exists to prevent.
3. **One Season expanded at a time**, though the prototype allows several. An expansion may issue a
   read-through request; several in flight multiply the cost §8.1 exists to avoid.
4. **The expander is a real `<button>`**, not the prototype's `<span class="chev">`, because the
   fence requires the expanded children to be keyboard reachable and the row to carry
   `aria-expanded`. The whole-row click still toggles, as §9 requires.
5. **`ArchiveTournamentRow` is declared locally and structurally**, because the plan never says which
   frontend module exports `ArchiveTournamentSummary` and the generated client cannot supply it —
   `Instant` and `LocalDate` are generated as opaque index-signature interfaces
   (`src/app/api/generated/gones-api.ts:10626,10826`).
6. **The result page's zip/PNG helpers are duplicated**, not extracted, because extracting them would
   edit a legacy file this ticket may not touch and the plan's own backend slice set the precedent of
   duplicating rather than referencing into a doomed file.
7. **Empty League name sorts last in both directions**, matching how the rankings table already
   treats a missing winrate. An absent value is not a small value.
8. **Gap, not absorbed: no ticket owns the new staged-edit UI.** These four pages are read-only. The
   legacy editor at `src/app/features/tournaments-archive/tournament-archive-detail.component.ts` is
   deleted at the end of the plan, and no remaining ticket rebuilds it on `/archive/**`. Editing the
   archive would be lost at that point.
9. **Gap, not absorbed: browser-local archive records are not listed.** The plan creates a local
   authority (`local-archive-backend.service.ts`) and a local IndexedDB database
   (`gones-archive-local`), but Tab 2 is year-partitioned off server data and no ticket defines how a
   browser-local Tournament — which has no year partition and no server `updatedAt` — joins that
   table. Today's dual-source League list (ADR 0028) has no successor here.
10. **Residual risk: a cached year loses its truncation flag.** `ArchiveYearPartition` carries
    `rowCount` but no `truncated`, so a year served from IndexedDB cannot re-raise the warning the
    fresh read raised. The port returns `truncated` and the adapter decides; getting that right is the
    cache ticket's business, not this one's.
