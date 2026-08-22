# T18: Browser-local archive records unioned into both tabs

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T14, T10
**Commit outcome:** Records authored in this browser appear in both archive tabs beside server records, as ADR 0028 requires.

## Context (self-contained)

- **Goal:** the Gones Archive is being rebuilt on three tiers — **League → LeagueSeason → Tournament**. A Tournament is a first-class top-level record that may stand alone (`seasonId: null`). The card grid became a paginated, sortable, expandable table across two tabs: `/archive/league-seasons` (Tab 1) and `/archive/tournaments` (Tab 2). `leagues-archive` → `archive` everywhere.
- **This slice:** the archive has **two authorities**, not one. ADR 0028 (`docs/adr/0028-dual-source-league-archive.md`) says the archive **reads from both stores and writes to exactly one, decided per record by its id**: a `local-` prefixed id lives in this browser's IndexedDB database and is never sent to a server; everything else lives on the server. An earlier ticket built the browser-local authority — the database `gones-archive-local` with the object stores `leagues`, `league-seasons` and `tournaments` — and another built the repository that reads the server. **No ticket joined the browser-local records into either tab.** Without this slice a visitor who authors a Tournament while signed out sees it vanish from every list, which is exactly the silent data loss ADR 0028 was written to prevent. This ticket closes that hole: it unions the browser-local records into Tab 1, Tab 2, the Tab 1 Season expansion and the Season page, it makes a local row visually distinguishable, it keeps a local row permanently unlocked, and it keeps a local row out of the public catalog cache forever.
- **Out of scope here — hard fence, do not cross:**
  - **NO backend work.** Do not touch `backend/**`, do not add or edit a migration, do not touch `src/app/api/generated/**`, do not run `npm run api:generate`.
  - **Do NOT delete legacy code.** `src/app/features/leagues-archive/**`, `src/app/features/tournaments-archive/**`, `src/app/data/league-archive-*.ts`, `src/app/backend/local-league-archive-backend.service.ts`, `src/app/domain/models.ts` and the legacy routes in `src/app/app.routes.ts` all keep working after this commit. A later ticket retires them; this one does not. The app must compile and run at the end of this commit.
  - **NO rankings work.** Do not touch `src/app/features/players/**`, `/global-stats`, `src/app/features/players/global-stats-query.ts`, or anything about Glicko-2 or scoped player statistics.
  - **NO mutation surface.** This slice adds no create/edit/delete affordance to `/archive/**`. It is a read-path union only. Do not call `invalidateArchiveCaches()`, do not issue a `POST`, `PATCH` or `DELETE`.
  - **NO new IndexedDB file.** Do not add a file that names `indexedDB` or an `IDB*` type: `src/app/backend/server-authority-boundary.test.ts` asserts an exact allowlist of such files with `toEqual`, and adding one turns it red. This ticket reaches storage only through the already-allowlisted services.
  - **NO second local adapter.** Do not open `gones-archive-local` from a second place. The browser-local authority class is the only reader of that database.
  - **NO new colour.** Use only the tokens already declared in `src/styles.css:4-17` — `--app-toolbar-height`, `--forge`, `--black-metal`, `--iron`, `--raised-iron`, `--soot`, `--ash`, `--dim-ash`, `--steel`, `--blood`, `--hot-blood`, `--create-green`, `--create-green-hot`, `--rust-plate`. Never a literal colour.
  - Do not add a runtime dependency. Do not change `ops/acceptance-matrix.json`, `scripts/full-stack-ci.mjs` or the Cypress spec list.
- **Assumptions in force:**
  1. **Gones is unreleased. There is no production environment and there are no users.** Local data may be reset freely. There is no data migration and no route alias.
  2. **A10 — an authority and a cache never share a database.** The browser-local authority is `gones-archive-local`; the public catalog cache is `gones-archive-cache`. They are two databases precisely so that "purge the cache" can never delete a record the user authored. That is why the invariant below is absolute: **a `local-` row is never written into `gones-archive-cache`.**
  3. Angular 21 standalone components with signals; Vitest (`npm run test`, `environment: 'jsdom'`, `globals: true`, `include: ['src/**/*.test.ts', 'ops/**/*.test.ts']`); specs import `{ describe, expect, it }` from `'vitest'` explicitly, as every existing spec does.
  4. `npm run typecheck` runs `tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.spec.json`. `tsconfig.json` sets `"strict": true`, `"isolatedModules": true`, `"noImplicitReturns": true`, `"noPropertyAccessFromIndexSignature": true`. A type-only re-export must be `export type { … }`.
  5. ESLint `@typescript-eslint/no-unused-vars` is an error with `argsIgnorePattern: '^_'` / `varsIgnorePattern: '^_'`.
  6. `src/app/i18n/message-namespace.test.ts:16-18` asserts `Object.keys(en).sort()` equals `Object.keys(fr).sort()`. **Every key added to one catalogue must be added to the other in the same commit**, or the suite is red.
  7. `cypress/e2e/league-local.cy.js` is wired into CI at `scripts/full-stack-ci.mjs:65`, twelfth in the ordered spec list. The file path must keep existing and keep passing; `ops/acceptance-matrix.json:243-247` names it as the Cypress evidence for the ADR 0028 row `doc-league-local`.
  8. Predecessor tickets have already landed the files this ticket edits. If a symbol named below is absent from the working tree, the predecessor named beside it in `Inputs → From Depends` owns it — open that file and use the name it actually exports. **Codebase wins over this document for a name; this document wins for behaviour.**

## Requirements

1. `ArchiveRepository.listLeagues`, `.listLeagueSeasons`, `.listYears`, `.listTournaments` and `.listSeasonTournaments` each return the **union** of the server rows and the browser-local rows. The union happens inside the repository; **no component performs it.**
2. Every returned row carries `isLocal: boolean`. `isLocal === true` exactly for a row whose `id` starts with `local-`.
3. **A browser-local row is NEVER written into `gones-archive-cache`.** Not into the League catalog record, not into the Season catalog record, not into a year partition, not into the years meta record. The local store is an **authority**; the cache is a **cache**; they live in two databases for this reason. Proved by test on all three write paths.
4. **A browser-local row is NEVER locked**, whatever its `tournamentDate` and whatever the date the test runs on. Tab 1, Tab 2, the Season expansion and the Season page all derive the lock from `isArchiveTournamentRowLocked` / `isLeagueSeasonRowLocked`, which key on the `local-` id prefix. No second lock derivation exists.
5. Local rows are ordinary rows for **sorting, filtering, searching and pagination**: they are merged before the filter step, they are counted in `totalRows()` / `totalCount`, they participate in every sort key, they can be searched by name and by League name, and they can fall on any page.
6. **Tab 2's year filter buckets a local Tournament by its own `tournamentDate` year.** Selecting year `Y` shows the local Tournaments played in `Y` and hides those played outside it, exactly as it does for server rows. A local Tournament whose `tournamentDate` is not a `YYYY-MM-DD` string is bucketed into the **current UTC year**.
7. **The Tab 2 year index includes years that only browser-local Tournaments occupy.** `GET /api/archive/years` only knows server rows; without this union a local Tournament in an otherwise-empty year would be unreachable from Tab 2. A local-only year is `locked: false` and issues **no** server request.
8. **A local row never changes a server year's `locked` flag.** `locked` describes the server's rows and drives the cache-freshness classifier; a local row is never cached, so it cannot make a cached partition stale.
9. **Cross-authority joins are impossible.** A local Tournament never appears inside a server Season's expansion, and a server Tournament never appears inside a local Season's expansion. The Season's own id decides which store answers.
10. A local row is **visually distinguishable**: a `Local only` badge in the name cell of both tabs, of the Season expansion child line and of the Season page header, plus a one-line notice — rendered only when the list holds at least one local row — saying the records live in this browser and clearing site data deletes them (ADR 0028's stated consequence).
11. `cypress/e2e/league-local.cy.js` covers the union on the **new** routes `/archive/league-seasons` and `/archive/tournaments`, seeding `gones-archive-local` directly so the spec depends on no editing UI.
12. Every new i18n key is added to **both** the `en` block and the `fr` block of `src/app/i18n/messages.ts`.
13. `npm run test`, `npm run typecheck`, `npm run lint` and `npm run build` are green, and `npx cypress run --spec cypress/e2e/league-local.cy.js` passes against a running stack.

## Inputs

### Files to read before writing code (repo-relative to `/home/aron/projects/gones`)

- `docs/adr/0028-dual-source-league-archive.md` — **read first, in full.** The rule this ticket implements: *"The League Archive reads from both stores and writes to exactly one, decided per league by its id."* Also binding here: *"Origin is encoded in the id"*, *"The list is heterogeneous […] The `Local only` badge is not decoration — it is the user-facing form of the routing rule"*, *"Clearing site data destroys local leagues. There is no server copy. The list page says so"*, and *"A tournament never crosses the boundary."*
- `src/app/data/league-archive-repository.service.ts` — **the union to mirror, not to edit.** Lines 68-83 are the legacy `listLeagues()`: a `Promise.allSettled` over the server read and the browser read, concatenated server-half-first; a rejected server read degrades to the local list alone and raises `serverUnavailable`; only both rejecting propagates. Lines 250-257 are the routing rule: `private port(id) { return isLocalLeagueId(id) ? this.local : this.server; }`. Reproduce the *shape* of that degradation in the new repository; do not import from this file and do not modify it.
- `src/app/data/league-archive-origin.ts` — the legacy `local-` prefix rule: `export const LOCAL_LEAGUE_ID_PREFIX = 'local-';` and `isLocalLeagueId(id)` returning `typeof id === 'string' && id.startsWith(LOCAL_LEAGUE_ID_PREFIX)`. The new archive twin is `src/app/data/archive-origin.ts` with `LOCAL_ARCHIVE_ID_PREFIX = 'local-'`, `isLocalArchiveId(id)`, `newLocalArchiveId(uuid?)` and **no placeholder concept**. Use the new one.
- `src/app/data/archive-summary.ts` — the two row-level lock derivations this ticket must use everywhere, already keyed on the id prefix:
  ```ts
  export function isArchiveTournamentRowLocked(row: Pick<ArchiveTournamentSummary, 'id' | 'tournamentDate'>, now: Date = new Date()): boolean {
    return !isLocalArchiveId(row.id) && isArchiveTournamentLocked(row.tournamentDate, now);
  }
  export function isLeagueSeasonRowLocked(row: Pick<ArchiveLeagueSeasonSummary, 'id' | 'lastTournamentDate'>, now: Date = new Date()): boolean {
    return row.lastTournamentDate !== null && !isLocalArchiveId(row.id) && isArchiveTournamentLocked(row.lastTournamentDate, now);
  }
  ```
- `src/app/data/archive-repository.service.ts` — the file this ticket edits most. See `From Depends` for its exact current surface.
- `src/app/features/archive/league-season-list.component.ts`, `src/app/features/archive/tournament-list.component.ts`, `src/app/features/archive/league-season-detail.component.ts` — the three components this ticket edits.
- `src/app/i18n/messages.ts` — 2497 lines. `const en = {` at line 5, its terminator `} as const;` at line 1251. `const fr: Record<MessageKey, string> = {` at line 1255, its terminator `};` at line 2483. `export const catalogs` at 2485. The existing legacy pair to imitate in tone is `'leagues.localBadge': 'Local only'` (line 536) / `'Local uniquement'` (line 1778) and `'leagues.localNotice'` (lines 537 / 1779). **Do not reuse, rename or delete those two keys** — they belong to the legacy list page, which stays alive.
- `src/styles.css` — tokens at lines 4-17. `.status` / `.status.completed` / `.status-dot` at lines 43-45. `.league-card-local-badge` at line 564 is the legacy badge whose visual language the new badge follows (uppercase, letter-spaced, hairline border, `--dim-ash` on `--black-metal`); it is **not** reused, because it is absolutely positioned for a card and this badge is inline in a table cell.
- `src/app/shared/app-logger.ts:1-3` — `logBoundaryError(boundary: string, error: unknown, context: Record<string, unknown> = {}): void`.
- `src/app/i18n/i18n.service.ts` — `t(key, params?)`, `plural(count, oneKey, manyKey, params?)`, `formatDate(value, options?)`, `formatDateTime(value, options?)` (defaults to `{ dateStyle: 'medium', timeStyle: 'short' }`), `language`.
- `src/app/i18n/message-namespace.test.ts:16-18` — the `en` / `fr` key-parity assertion.
- `cypress/e2e/league-local.cy.js` — 467 lines, the spec this ticket rewrites. Reusable helpers to keep: `seedSettings(win)`, the `visit(path, { clearLocalStore })` + re-seed + `cy.reload()` dance (test isolation can race the settings self-heal into French), the `profile` fixture, `stubSignedIn(globalRole)`, and the `readLocalLeagueRows()` raw-IndexedDB read pattern.
- `scripts/full-stack-ci.mjs:53-77` — the ordered Cypress spec list. `cypress/e2e/league-local.cy.js` is line 65. **Do not reorder or extend this list.**

### From Depends — spelled out, because the worker cannot read the predecessor tickets

**From T10 — `src/app/domain/archive-models.ts` (already committed, do not redesign):**

```ts
export const ARCHIVE_DATA_VERSION = 5;
export const ARCHIVE_LOCK_WINDOW_DAYS = 365;
export type LeagueStatus = 'active' | 'completed';   // re-exported from './models'

export interface ArchiveLeagueDocument { id: string; name: string; createdAt: string; }
export interface PersistedArchiveLeague extends ArchiveLeagueDocument { documentVersion: number; updatedAt: string; eTag?: string; }

export interface LeagueSeasonDocument { id: string; name: string; leagueId: string; status: LeagueStatus; }
export interface PersistedLeagueSeason extends LeagueSeasonDocument { documentVersion: number; updatedAt: string; eTag?: string; }

export interface ArchiveTournamentDocument {
  id: string; name: string; seasonId: string | null; tournamentDate: string;   // `YYYY-MM-DD`
  status: LeagueStatus; rounds: RoundDocument[]; playerArchetypes: PlayerArchetypeDocument[];
}
export interface PersistedArchiveTournament extends ArchiveTournamentDocument { documentVersion: number; updatedAt: string; eTag?: string; }

/** `locked ⇔ (now − tournamentDate) > 365` on whole UTC calendar days. 365 ⇒ false, 366 ⇒ true,
 *  future ⇒ false, unparseable ⇒ false. Pure. */
export function isArchiveTournamentLocked(tournamentDate: string, now?: Date): boolean;
```

**From T10 — `src/app/data/archive-origin.ts`:**

```ts
export const LOCAL_ARCHIVE_ID_PREFIX = 'local-';
export function isLocalArchiveId(id: string | null | undefined): boolean;
export function newLocalArchiveId(uuid?: string): string;
```

**From T10 — `src/app/backend/local-archive-backend.service.ts`:** the browser-local ADR 0028 authority over the database `gones-archive-local` version `1`, object stores `leagues`, `league-seasons`, `tournaments`, all `keyPath: 'id'`. `@Injectable({ providedIn: 'root' }) export class LocalArchiveBackend`. The three reads this ticket's repository already consumes return whole documents:

| Call | Returns |
| --- | --- |
| `listArchiveLeagues()` | `Promise<ArchiveCatalogResponse<PersistedArchiveLeague>>`, ordered `updatedAt DESC, id ASC`, always `truncated: false` and `totalCount === items.length` |
| `listLeagueSeasons()` | `Promise<ArchiveCatalogResponse<PersistedLeagueSeason>>`, same ordering and caps |
| `listArchiveTournaments()` | `Promise<ArchiveCatalogResponse<PersistedArchiveTournament>>`, ordered `tournamentDate DESC, id ASC` |

Every id it mints is `newLocalArchiveId()`, so **every row it holds starts with `local-`**. Its `tournamentDate` may be the empty string: `createTournament` in `src/app/domain/models.ts:237` stores `String(tournamentDate ?? '')`, so an undated Tournament is a real, reachable state.
**If those three method names differ in the working tree, T10's names win** — the repository already adapts them through a private `LocalArchiveSource` interface declared in `archive-repository.service.ts`; change only the adapter, never the shapes below.

**From T12 — `src/app/backend/archive-cache.service.ts` (already committed):**

```ts
export const ARCHIVE_CACHE_DB_NAME = 'gones-archive-cache';
export const ARCHIVE_CACHE_DB_VERSION = 1;
export const CACHE_LEAGUE_STORE = 'leagues';
export const CACHE_SEASON_STORE = 'league-seasons';
export const CACHE_YEAR_PARTITION_STORE = 'year-partitions';
export const CACHE_META_STORE = 'meta';
export const ARCHIVE_CATALOG_KEY = 'catalog';
export const ARCHIVE_YEARS_META_KEY = 'years';

export interface ArchiveCatalogRecord<T> { key: typeof ARCHIVE_CATALOG_KEY; items: T[]; totalCount: number; truncated: boolean; fetchedAt: string; }
export interface ArchiveYearPartition { year: number; completedAt: string | undefined; rowCount: number; items: ArchiveTournamentSummary[]; }
export interface ArchiveYearsMetaRecord { key: typeof ARCHIVE_YEARS_META_KEY; years: ArchiveYearEntry[]; fetchedAt: string; utcDay: string; }
export function isArchiveCatalogFresh(record: ArchiveCatalogRecord<unknown>, now?: number): boolean;
export function utcDayKey(now?: number): string;

@Injectable({ providedIn: 'root' })
export class ArchiveCacheService {
  readLeagueCatalog(): Promise<ArchiveCatalogRecord<ArchiveLeagueSummary> | null>;
  writeLeagueCatalog(record: ArchiveCatalogRecord<ArchiveLeagueSummary>): Promise<void>;
  readSeasonCatalog(): Promise<ArchiveCatalogRecord<ArchiveLeagueSeasonSummary> | null>;
  writeSeasonCatalog(record: ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>): Promise<void>;
  readYearPartition(year: number): Promise<ArchiveYearPartition | null>;
  readAllYearPartitions(): Promise<ArchiveYearPartition[]>;
  readYearsMeta(): Promise<ArchiveYearsMetaRecord | null>;
  writeYearsMeta(record: ArchiveYearsMetaRecord): Promise<void>;
  clearAll(): Promise<void>;
}
```

**From T12 — `src/app/backend/archive-backfill-queue.ts`:** the **single writer** of `year-partitions`.

```ts
export interface ArchiveYearPage { items: ArchiveTournamentSummary[]; totalCount: number; truncated: boolean; }
export type ArchiveYearLoader = (year: number) => Promise<ArchiveYearPage>;
export type ArchiveYearFreshness = 'fresh' | 'stale' | 'missing';
export interface ArchiveBackfillReport { written: number[]; failed: { year: number; error: unknown }[]; }
export function isArchiveYearPartitionComplete(partition: ArchiveYearPartition | null | undefined): partition is ArchiveYearPartition;
export function classifyArchiveYear(partition: ArchiveYearPartition | null | undefined, entry: ArchiveYearEntry, now?: number): ArchiveYearFreshness;

@Injectable({ providedIn: 'root' })
export class ArchiveBackfillQueue {
  readonly pending: Signal<readonly number[]>;
  readonly running: Signal<boolean>;
  enqueue(years: readonly number[]): void;
  drain(loader: ArchiveYearLoader): Promise<ArchiveBackfillReport>;   // never rejects
  restart(): Promise<void>;
}
```

**From T12 — `src/app/data/archive-repository.service.ts`, its current surface, which this ticket extends:**

```ts
export const ARCHIVE_UPDATED_EVENT = 'gones-archive-updated';

export type ArchiveLeagueRow = ArchiveLeagueSummary & { isLocal: boolean };
export type ArchiveLeagueSeasonRow = ArchiveLeagueSeasonSummary & { isLocal: boolean };
export type ArchiveTournamentRow = ArchiveTournamentSummary & { isLocal: boolean };

export interface ArchiveCatalogResult<T> {
  items: T[]; totalCount: number; truncated: boolean; fetchedAt: string; fromCache: boolean; stale: boolean;
}
export interface ArchiveSeasonTournamentsResult { items: ArchiveTournamentRow[]; fromCache: boolean; }

export function archiveYearRange(firstTournamentDate: string | null, lastTournamentDate: string | null): number[];
export function compareArchiveTournamentRows(left: ArchiveTournamentSummary, right: ArchiveTournamentSummary): number;

@Injectable({ providedIn: 'root' })
export class ArchiveRepository {
  listLeagues(options?: { force?: boolean }): Promise<ArchiveCatalogResult<ArchiveLeagueRow>>;
  listLeagueSeasons(options?: { force?: boolean }): Promise<ArchiveCatalogResult<ArchiveLeagueSeasonRow>>;
  listYears(options?: { force?: boolean }): Promise<ArchiveYearEntry[]>;
  listTournaments(options?: { force?: boolean }): Promise<ArchiveCatalogResult<ArchiveTournamentRow>>;
  listSeasonTournaments(season: { id: string; firstTournamentDate: string | null; lastTournamentDate: string | null }): Promise<ArchiveSeasonTournamentsResult>;
  invalidateArchiveCaches(): Promise<void>;
}
```

Behaviour already in place, which this ticket must preserve exactly:

- `listLeagues` / `listLeagueSeasons` follow one private `loadCatalog(...)`: (1) not forced, a record exists and `isArchiveCatalogFresh(record)` → serve it, `fromCache: true`, `stale: false`, no request; (2) otherwise fetch, and on success write the record — **server rows only, no `isLocal` key** — and serve it `fromCache: false`, `stale: false`; (3) on rejection with a record → serve the record, `stale: true`; (4) on rejection without a record but with at least one local row → serve the local half alone, `stale: true`, `totalCount` = local count, `truncated: false`; (5) on rejection with neither → **rethrow** (never lie with an empty state, ADR 0031). In every served case local rows are appended **after** the server rows and `totalCount = serverTotalCount + localRows.length`.
- `listYears` serves the `meta` snapshot only while `snapshot.utcDay === utcDayKey()` — `locked` flips at midnight UTC. On a rejected fetch with a snapshot it returns `snapshot.years.map(entry => ({ ...entry, locked: false }))`; with no snapshot it rethrows.
- `listTournaments` currently covers **every** year: `listYears()` → `readAllYearPartitions()` → `classifyArchiveYear` per entry → `queue.enqueue(missing ∪ stale)` → `queue.drain(loader)` → re-read the partitions → flatten, append local Tournaments, sort with `compareArchiveTournamentRows`. `totalCount` = Σ `rowCount` + local count; `truncated` = any partition with `items.length < rowCount`; `fetchedAt` = the **oldest** `completedAt` served, or now when none was; `stale` = `report.failed.length > 0` or the years index came from the fallback path. `{ force: true }` enqueues every year regardless of classification.
- `listSeasonTournaments` is the §8.1 read-through and **writes nothing, ever**: a `local-` Season id is answered from the browser store with `fromCache: true`; otherwise, when every year of `archiveYearRange(first, last)` is `locked` in the years index **and** has a complete partition, it serves those partitions filtered to `row.seasonId === season.id` with `fromCache: true`; otherwise it issues `GET /api/archive/league-seasons/{id}/tournaments` and returns `fromCache: false` **without caching the answer**.
- The private structural port to the generated client, so no generated type name is imported:
  ```ts
  export interface ArchiveReadClient {
    getArchiveLeagueCatalog(): Observable<RawCatalog<RawArchiveLeague>>;
    getArchiveLeagueSeasonCatalog(): Observable<RawCatalog<RawArchiveSeason>>;
    getArchiveTournamentYearCatalog(year: string | undefined): Observable<RawCatalog<RawArchiveTournament>>;
    getArchiveYears(): Observable<RawArchiveYears>;
    getArchiveSeasonTournaments(seasonId: string): Observable<RawCatalog<RawArchiveTournament>>;
  }
  ```

**From T13 — `src/app/features/archive/league-season-list.component.ts` (Tab 1), the parts this ticket edits:**

```ts
export const ALL_LEAGUES = 'all';
export const LEAGUE_SEASON_SORT_KEYS = ['name','leagueName','lastPlayed','updated','tournaments','players','status'] as const;
export const DEFAULT_LEAGUE_SEASON_SORT: LeagueSeasonSortKey = 'lastPlayed';
export const DEFAULT_LEAGUE_SEASON_DIRECTION: 'asc' | 'desc' = 'desc';

export interface LeagueSeasonRow {
  id: string; name: string; leagueId: string; leagueName: string; status: LeagueStatus;
  updatedAt: string; documentVersion: number; tournamentCount: number; playerCount: number;
  firstTournamentDate: string | null; lastTournamentDate: string | null; locked: boolean;
}

export function buildLeagueSeasonRows(seasons: readonly ArchiveLeagueSeasonSummary[], leagues: readonly ArchiveLeagueSummary[], now?: Date): LeagueSeasonRow[];
export function filterLeagueSeasonRows(rows: readonly LeagueSeasonRow[], query: Pick<LeagueSeasonQuery,'search'|'league'>): LeagueSeasonRow[];
export function sortLeagueSeasonRows(rows: readonly LeagueSeasonRow[], sort: LeagueSeasonSortKey, dir: 'asc'|'desc'): LeagueSeasonRow[];
```

with the component holding `seasons = signal<ArchiveLeagueSeasonSummary[]>([])`, `leagues = signal<ArchiveLeagueSummary[]>([])`, and the pipeline `rows → filteredRows → sortedRows → pagedRows`, `totalRows = filteredRows().length`, `totalPages = max(1, ceil(totalRows/size))`, `currentPage` clamped without rewriting the URL. The row template is the Variant B two-line table: the name cell holds `<a class="archive-name-link" [routerLink]="['/archive/league-seasons', row.id]">{{ row.name }}</a>` above `<span class="archive-sub">{{ leagueLabel(row) }}</span>`, and the status cell holds the `.status` chip followed by `@if (row.locked) { <span class="archive-lock" …>🔒</span> }`.

**From T14 — `src/app/features/archive/league-season-detail.component.ts` and `tournament-list.component.ts` (Tab 2 + expansion), the parts this ticket edits:**

```ts
// league-season-detail.component.ts
export interface ArchiveTournamentRow {
  readonly id: string; readonly name: string; readonly seasonId: string | null;
  readonly tournamentDate: string; readonly status: LeagueStatus; readonly updatedAt: string;
  readonly documentVersion: number; readonly playerCount: number;
}
export interface ArchiveSeasonRow {
  readonly id: string; readonly name: string; readonly leagueId: string; readonly status: LeagueStatus;
  readonly updatedAt: string; readonly documentVersion: number; readonly tournamentCount: number;
  readonly playerCount: number; readonly firstTournamentDate: string | null; readonly lastTournamentDate: string | null;
}
export interface CachedYearPartition { readonly year: number; readonly completedAt: string | undefined; readonly items: readonly ArchiveTournamentRow[]; }
export interface SeasonTournamentsPage { readonly items: readonly ArchiveTournamentRow[]; readonly totalCount: number; readonly truncated: boolean; }
export interface SeasonTournamentsSource {
  readYearPartition(year: number): Promise<CachedYearPartition | undefined>;
  fetchSeasonTournaments(seasonId: string): Promise<SeasonTournamentsPage>;
}
export interface ArchiveSeasonSource extends SeasonTournamentsSource {
  getSeason(seasonId: string): Promise<ArchiveSeasonRow | undefined>;
  getLeagueName(leagueId: string): Promise<string | undefined>;
}
export const ARCHIVE_SEASON_SOURCE = new InjectionToken<ArchiveSeasonSource>('ARCHIVE_SEASON_SOURCE', { providedIn: 'root', factory: archiveSeasonSourceFactory });
export interface SeasonTournamentsRead { readonly origin: 'cache' | 'server'; readonly items: readonly ArchiveTournamentRow[]; readonly truncated: boolean; }
export type SeasonExpansionState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly origin: 'cache' | 'server'; readonly items: readonly ArchiveTournamentRow[]; readonly truncated: boolean }
  | { readonly status: 'failed' };
export const SEASON_EXPANSION_PREVIEW_LIMIT = 10;
export function seasonSpanYears(firstTournamentDate: string | null, lastTournamentDate: string | null): number[];
export function isArchiveYearLocked(year: number, now?: Date): boolean;
export function sortTournamentRowsByDateDesc(rows: readonly ArchiveTournamentRow[]): ArchiveTournamentRow[];
export function readSeasonTournaments(season: Pick<ArchiveSeasonRow,'id'|'firstTournamentDate'|'lastTournamentDate'>, source: SeasonTournamentsSource, now?: Date): Promise<SeasonTournamentsRead>;

// tournament-list.component.ts
export const ARCHIVE_TABLE_PAGE_SIZES = [25, 50, 100] as const;
export const ARCHIVE_TOURNAMENT_SORT_KEYS = ['name','leagueName','date','updated','players','status'] as const;
export interface ArchiveTournamentQuery {
  readonly page: number; readonly size: ArchiveTablePageSize; readonly search: string;
  readonly sort: ArchiveTournamentSortKey; readonly dir: 'asc' | 'desc';
  readonly year: number | null; readonly season: string | null;
}
export interface ArchiveYearOption { readonly year: number; readonly locked: boolean; readonly tournamentCount: number; }
export interface ArchiveYearRows { readonly items: readonly ArchiveTournamentRow[]; readonly totalCount: number; readonly truncated: boolean; }
export interface ArchiveTournamentTabSource {
  listYears(): Promise<readonly ArchiveYearOption[]>;
  loadYear(year: number): Promise<ArchiveYearRows>;
  listSeasonLeagueNames(): Promise<ReadonlyMap<string, string>>;
}
export const ARCHIVE_TOURNAMENT_TAB_SOURCE = new InjectionToken<ArchiveTournamentTabSource>('ARCHIVE_TOURNAMENT_TAB_SOURCE', { providedIn: 'root', factory: archiveTournamentTabSourceFactory });
export function parseArchiveTournamentQuery(params: { get(key: string): string | null }): ArchiveTournamentQuery;
export function archiveTournamentQueryParams(query: ArchiveTournamentQuery): Params;
export function toggleArchiveTournamentSort(query: ArchiveTournamentQuery, key: ArchiveTournamentSortKey): ArchiveTournamentQuery;
export function filterArchiveTournamentRows(rows: readonly ArchiveTournamentRow[], search: string, seasonId: string | null, leagueNameOf: (row: ArchiveTournamentRow) => string): ArchiveTournamentRow[];
export function sortArchiveTournamentRows(rows: readonly ArchiveTournamentRow[], sort: ArchiveTournamentSortKey, dir: 'asc'|'desc', leagueNameOf: (row: ArchiveTournamentRow) => string): ArchiveTournamentRow[];
```

Tab 2's `load()` resolves the year as *the URL year when the index contains it, else the newest indexed year, else `null`*; when the resolved year differs from `query().year` it navigates with `replaceUrl: true` and returns, letting the `queryParamMap` subscription re-enter with the corrected URL. Its `leagueNameOf` is `row.seasonId === null ? '' : (this.seasonLeagueNames().get(row.seasonId) ?? '')`, and an empty League name sorts **last in both directions**.

**Known predecessor drift this ticket repairs — the repository method names, ruled binding:** the two component files were written against guessed repository names. The binding read surface is `listLeagues`, `listLeagueSeasons`, `listYears`, `listTournaments`, `listSeasonTournaments`. Wherever a component calls `listLeagueCatalog`, `listLeagueSeasonCatalog`, `listLeagueSummaries`, `listLeagueSeasonSummaries`, `fetchSeasonTournaments` or `loadTournamentYear` on `ArchiveRepository`, **rewrite the call site** to the binding name — that is part of this ticket, because those shims are exactly where a component-side union would otherwise have to live. Open `src/app/data/archive-repository.service.ts` and use the names that file exports.

## Interface contract (level 5)

### Produces — `src/app/data/archive-repository.service.ts` (edited)

Two new module-level exports:

```ts
/**
 * The calendar year a Tournament row belongs to on Tab 2. A browser-local Tournament may carry an
 * empty `tournamentDate` — `createTournament` stores `String(tournamentDate ?? '')` — and a record
 * the user authored must never become unreachable, so an unusable date is bucketed into the current
 * UTC year rather than dropped.
 */
export function archiveTournamentYear(
  row: Pick<ArchiveTournamentSummary, 'tournamentDate'>,
  now: Date = new Date()
): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(row.tournamentDate)
    ? Number(row.tournamentDate.slice(0, 4))
    : now.getUTCFullYear();
}

/**
 * The years index, unioned. A browser-local Tournament adds its own year to the index and adds to
 * that year's count, but NEVER changes a server year's `locked` flag: `locked` describes the server's
 * rows and drives `classifyArchiveYear`, and a local row is never cached, so it cannot make a cached
 * partition stale. A year only browser-local Tournaments occupy is `locked: false` and has no server
 * partition to read.
 */
export function mergeLocalArchiveYears(
  server: readonly ArchiveYearEntry[],
  localYears: readonly number[]
): ArchiveYearEntry[] {
  const counts = new Map<number, number>();
  for (const year of localYears) counts.set(year, (counts.get(year) ?? 0) + 1);
  const merged: ArchiveYearEntry[] = server.map((entry) => ({
    ...entry,
    tournamentCount: entry.tournamentCount + (counts.get(entry.year) ?? 0)
  }));
  const known = new Set(server.map((entry) => entry.year));
  for (const [year, count] of counts) {
    if (!known.has(year)) merged.push({ year, locked: false, tournamentCount: count });
  }
  return merged.sort((left, right) => left.year - right.year);
}
```

Two changed signatures on `ArchiveRepository`:

```ts
/**
 * `year` absent ⇒ every indexed year, as before. `year` present ⇒ exactly that year: its server
 * partition (backfilled when missing or stale) plus the browser-local Tournaments played in it.
 * A year the SERVER index does not contain issues no request at all — it exists only because a
 * browser-local Tournament falls in it, and there is nothing on the server to fetch for it.
 */
listTournaments(options?: { force?: boolean; year?: number }): Promise<ArchiveCatalogResult<ArchiveTournamentRow>>;
```

```ts
/** `truncated` is the server half's row cap; a cache-served or browser-local answer is never truncated. */
export interface ArchiveSeasonTournamentsResult {
  items: ArchiveTournamentRow[];
  fromCache: boolean;
  truncated: boolean;
}
```

New private member, extracted from the existing `listYears` body **without changing its behaviour**, so `listTournaments` can see the server's own index while `listYears` publishes the unioned one:

```ts
/**
 * The server's years index alone. `stale` is true when the fetch failed and the `meta` snapshot was
 * used instead — in which case every `locked` has been forced to `false`, because an offline snapshot
 * may say which years exist but never that one is immutable.
 */
private async serverYears(options: { force?: boolean }): Promise<{ years: ArchiveYearEntry[]; stale: boolean }>;
```

`listYears` becomes, verbatim:

```ts
  async listYears(options: { force?: boolean } = {}): Promise<ArchiveYearEntry[]> {
    const localYears = (await this.localTournamentRows()).map((row) => archiveTournamentYear(row));
    try {
      const server = await this.serverYears(options);
      return mergeLocalArchiveYears(server.years, localYears);
    } catch (error) {
      // A browser-local Tournament is authority data: it must stay reachable when the server is not.
      if (localYears.length === 0) throw error;
      return mergeLocalArchiveYears([], localYears);
    }
  }
```

`listTournaments` becomes, verbatim in its ordering:

```ts
  async listTournaments(options: { force?: boolean; year?: number } = {}): Promise<ArchiveCatalogResult<ArchiveTournamentRow>> {
    const localRows = await this.localTournamentRows();
    const localItems = options.year === undefined
      ? localRows
      : localRows.filter((row) => archiveTournamentYear(row) === options.year);

    let entries: ArchiveYearEntry[] = [];
    let yearsStale = false;
    try {
      const server = await this.serverYears(options);
      entries = server.years;
      yearsStale = server.stale;
    } catch (error) {
      const stored = await this.cache.readAllYearPartitions();
      if (stored.length === 0 && localItems.length === 0) throw error;
      entries = stored.map((partition) => ({ year: partition.year, locked: false, tournamentCount: partition.rowCount }));
      yearsStale = true;
    }

    const selected = options.year === undefined ? entries : entries.filter((entry) => entry.year === options.year);
    // A local-only year is absent from `selected`, so nothing is enqueued for it and no request is made.
    const partitions = new Map(
      (await Promise.all(selected.map(async (entry) => [entry.year, await this.cache.readYearPartition(entry.year)] as const)))
    );
    const due = selected
      .filter((entry) => options.force === true || classifyArchiveYear(partitions.get(entry.year), entry) !== 'fresh')
      .map((entry) => entry.year);
    this.queue.enqueue(due);
    const report = due.length ? await this.queue.drain(this.yearLoader()) : { written: [], failed: [] };
    const served = (await Promise.all(selected.map((entry) => this.cache.readYearPartition(entry.year))))
      .filter(isArchiveYearPartitionComplete);

    const serverItems = served.flatMap((partition) => partition.items.map((item) => ({ ...item, isLocal: false })));
    const completions = served.map((partition) => partition.completedAt).filter((value): value is string => value !== undefined).sort();
    return {
      items: [...serverItems, ...localItems].sort(compareArchiveTournamentRows),
      totalCount: served.reduce((total, partition) => total + partition.rowCount, 0) + localItems.length,
      truncated: served.some((partition) => partition.items.length < partition.rowCount),
      fetchedAt: completions[0] ?? new Date().toISOString(),
      fromCache: report.written.length === 0,
      stale: report.failed.length > 0 || yearsStale
    };
  }
```

with the two helpers it leans on:

```ts
  /** Every browser-local Tournament as a row, `isLocal: true`. The one place the local store is read. */
  private async localTournamentRows(): Promise<ArchiveTournamentRow[]> { /* existing local mapping, unchanged */ }

  /** The single loader the backfill queue is ever given. It returns SERVER rows only, by construction. */
  private yearLoader(): ArchiveYearLoader { /* existing loader body, unchanged */ }
```

`listSeasonTournaments` keeps its body and gains `truncated` on all three return paths: `false` on the browser-local path, `false` on the cache path, and `response.truncated ?? false` on the read-through path.

### Produces — `src/app/features/archive/league-season-list.component.ts` (Tab 1, edited)

```ts
export interface LeagueSeasonRow {
  id: string; name: string; leagueId: string; leagueName: string; status: LeagueStatus;
  updatedAt: string; documentVersion: number; tournamentCount: number; playerCount: number;
  firstTournamentDate: string | null; lastTournamentDate: string | null;
  locked: boolean;
  /** This row lives in `gones-archive-local`. Display only — the lock keys on the id, not on this. */
  isLocal: boolean;
}

/**
 * Joins the two catalogs and derives the lock. Pure; `now` is injectable for the tests. Accepts rows
 * from either authority: `isLocal` is optional so a bare wire summary is still assignable.
 */
export function buildLeagueSeasonRows(
  seasons: readonly (ArchiveLeagueSeasonSummary & { isLocal?: boolean })[],
  leagues: readonly (ArchiveLeagueSummary & { isLocal?: boolean })[],
  now?: Date
): LeagueSeasonRow[];
```

Body, verbatim:

```ts
export function buildLeagueSeasonRows(
  seasons: readonly (ArchiveLeagueSeasonSummary & { isLocal?: boolean })[],
  leagues: readonly (ArchiveLeagueSummary & { isLocal?: boolean })[],
  now: Date = new Date()
): LeagueSeasonRow[] {
  const names = new Map(leagues.map((league) => [league.id, league.name]));
  return seasons.map((season) => ({
    ...season,
    leagueName: names.get(season.leagueId) ?? '',
    // One lock derivation for the whole app: `isLeagueSeasonRowLocked` keys on the `local-` id prefix,
    // so a browser-local Season is never locked whatever its dates. Deriving it from `isLocal` here
    // would be a second rule that could drift from the first.
    locked: isLeagueSeasonRowLocked(season, now),
    isLocal: season.isLocal ?? false
  }));
}
```

Component members added:

```ts
  readonly seasons = signal<ArchiveLeagueSeasonRow[]>([]);   // retyped from ArchiveLeagueSeasonSummary[]
  readonly leagues = signal<ArchiveLeagueRow[]>([]);         // retyped from ArchiveLeagueSummary[]
  /** At least one row in this browser — the ADR 0028 notice is rendered only then. */
  readonly hasLocalRows: Signal<boolean>;                    // computed(() => this.rows().some((row) => row.isLocal))
```

`load()` calls `this.repo.listLeagueSeasons(options)` and `this.repo.listLeagues(options)` and keeps its existing `Promise.allSettled` degradation: a rejected Season catalog sets `archive.loadFailed`; a rejected League catalog is survivable and only sets `stale`.

Markup added, and nothing else changes in the template:

```html
<!-- immediately after the truncated warning, before .archive-status-line -->
@if (hasLocalRows()) {
  <p class="archive-local-notice" role="status" data-cy="archive-seasons-local-notice">{{ i18n.t('archive.localNotice') }}</p>
}
<!-- inside the name cell, immediately after the <a class="archive-name-link"> element -->
@if (row.isLocal) {
  <span class="archive-local-badge" [attr.title]="i18n.t('archive.localBadgeTitle')" [attr.data-cy]="'archive-seasons-local-badge-' + row.id">{{ i18n.t('archive.localBadge') }}</span>
}
```

### Produces — `src/app/features/archive/tournament-list.component.ts` (Tab 2, edited)

```ts
  /** The whole lock rule for a row of this table. A browser-local row is never locked. */
  isLocked(row: ArchiveTournamentRow): boolean { return isArchiveTournamentRowLocked(row); }

  readonly hasLocalRows: Signal<boolean>;   // computed(() => this.pagedRows().some((row) => row.isLocal))
```

and the token factory, rewritten to the binding repository names:

```ts
function archiveTournamentTabSourceFactory(): ArchiveTournamentTabSource {
  const repo = inject(ArchiveRepository);
  return {
    listYears: () => repo.listYears(),
    // One year at a time, and the union is the repository's job: this returns the server partition
    // for `year` plus the browser-local Tournaments played in `year`.
    loadYear: (year) => repo.listTournaments({ year }),
    listSeasonLeagueNames: async () => {
      const [seasons, leagues] = await Promise.all([repo.listLeagueSeasons(), repo.listLeagues()]);
      const leagueNames = new Map(leagues.items.map((league) => [league.id, league.name]));
      return new Map(seasons.items.flatMap((season) => {
        const name = leagueNames.get(season.leagueId);
        return name === undefined ? [] : [[season.id, name] as const];
      }));
    }
  };
}
```

Markup added:

```html
@if (hasLocalRows()) {
  <p class="archive-local-notice" role="status" data-cy="archive-tournaments-local-notice">{{ i18n.t('archive.localNotice') }}</p>
}
<!-- inside the name cell, immediately after the tournament name link -->
@if (row.isLocal) {
  <span class="archive-local-badge" [attr.title]="i18n.t('archive.localBadgeTitle')" [attr.data-cy]="'archive-tournaments-local-badge-' + row.id">{{ i18n.t('archive.localBadge') }}</span>
}
```

### Produces — `src/app/features/archive/league-season-detail.component.ts` (expansion + Season page, edited)

```ts
export interface ArchiveTournamentRow {
  readonly id: string; readonly name: string; readonly seasonId: string | null;
  readonly tournamentDate: string; readonly status: LeagueStatus; readonly updatedAt: string;
  readonly documentVersion: number; readonly playerCount: number;
  /** This row lives in `gones-archive-local`. Display only. */
  readonly isLocal: boolean;
}

export interface ArchiveSeasonRow {
  readonly id: string; readonly name: string; readonly leagueId: string; readonly status: LeagueStatus;
  readonly updatedAt: string; readonly documentVersion: number; readonly tournamentCount: number;
  readonly playerCount: number; readonly firstTournamentDate: string | null; readonly lastTournamentDate: string | null;
  readonly isLocal: boolean;
}

/**
 * The one read the Season expansion and the Season page are allowed to perform. It replaces the
 * former two-member port (`readYearPartition` + `fetchSeasonTournaments`): the §8.1 cache-vs-server
 * decision AND the browser-local union both live in `ArchiveRepository.listSeasonTournaments`, and a
 * component that re-derived either would be a second source of truth. Still an interface, so the
 * tests can stub it.
 */
export interface SeasonTournamentsSource {
  listSeasonTournaments(season: Pick<ArchiveSeasonRow, 'id' | 'firstTournamentDate' | 'lastTournamentDate'>):
    Promise<{ items: readonly ArchiveTournamentRow[]; fromCache: boolean; truncated: boolean }>;
}

export interface ArchiveSeasonSource extends SeasonTournamentsSource {
  getSeason(seasonId: string): Promise<ArchiveSeasonRow | undefined>;
  getLeagueName(leagueId: string): Promise<string | undefined>;
}

/** Unchanged signature; the body is now a thin adapter over the repository's one read. */
export function readSeasonTournaments(
  season: Pick<ArchiveSeasonRow, 'id' | 'firstTournamentDate' | 'lastTournamentDate'>,
  source: SeasonTournamentsSource,
  now?: Date
): Promise<SeasonTournamentsRead>;
```

Bodies, verbatim:

```ts
export async function readSeasonTournaments(
  season: Pick<ArchiveSeasonRow, 'id' | 'firstTournamentDate' | 'lastTournamentDate'>,
  source: SeasonTournamentsSource,
  _now: Date = new Date()
): Promise<SeasonTournamentsRead> {
  const read = await source.listSeasonTournaments(season);
  return { origin: read.fromCache ? 'cache' : 'server', items: [...read.items], truncated: read.truncated };
}

function archiveSeasonSourceFactory(): ArchiveSeasonSource {
  const repo = inject(ArchiveRepository);
  return {
    listSeasonTournaments: (season) => repo.listSeasonTournaments(season),
    getSeason: async (seasonId) => (await repo.listLeagueSeasons()).items.find((season) => season.id === seasonId),
    getLeagueName: async (leagueId) => (await repo.listLeagues()).items.find((league) => league.id === leagueId)?.name
  };
}
```

`seasonSpanYears`, `isArchiveYearLocked` and `sortTournamentRowsByDateDesc` keep their current exported signatures and bodies. They are no longer on the read path; they remain the documented year-lock vocabulary and their existing tests stay green.

The Season page's 🔒 marker changes source: it is `isLeagueSeasonRowLocked(season)` — **not** "every spanned year locked" — so a browser-local Season is never marked locked.

Markup added:

```html
<!-- Season page header, after the Season name -->
@if (season()?.isLocal) {
  <span class="archive-local-badge" [attr.title]="i18n.t('archive.localBadgeTitle')" data-cy="archive-season-local-badge">{{ i18n.t('archive.localBadge') }}</span>
}
<!-- inside each .archive-child-line, after the Tournament name -->
@if (row.isLocal) {
  <span class="archive-local-badge" [attr.title]="i18n.t('archive.localBadgeTitle')" [attr.data-cy]="'archive-season-child-local-' + row.id">{{ i18n.t('archive.localBadge') }}</span>
}
```

### Produces — i18n keys, `src/app/i18n/messages.ts`

Four keys, appended to the `en` block before its `} as const;` terminator **and** to the `fr` block before its `};` terminator, in this order in both.

| Key | `en` | `fr` |
| --- | --- | --- |
| `archive.localBadge` | `Local only` | `Local uniquement` |
| `archive.localBadgeTitle` | `Stored in this browser only — never sent to the server` | `Stocké uniquement dans ce navigateur — jamais envoyé au serveur` |
| `archive.localNotice` | `Records you create while signed out are stored in this browser only. They are never sent to the server, and clearing site data deletes them. Export is the backup.` | `Les enregistrements créés hors connexion sont stockés uniquement dans ce navigateur. Ils ne sont jamais envoyés au serveur et effacer les données du site les supprime. L’export est la sauvegarde.` |
| `archive.localUndated` | `Undated Tournaments created in this browser are listed under {year}.` | `Les tournois sans date créés dans ce navigateur sont listés sous {year}.` |

`archive.localUndated` is rendered on Tab 2, inside the local notice paragraph, **only** when the current year's rows include a local Tournament whose `tournamentDate` does not match `/^\d{4}-\d{2}-\d{2}$/`. It is the user-facing form of the bucketing rule; without it an undated record appears in a year it was never played in, with no explanation.

The existing keys `leagues.localBadge` (line 536 / 1778) and `leagues.localNotice` (537 / 1779) are **not** reused, renamed or deleted: they belong to the legacy list page, which keeps working until it is retired.

### Produces — CSS, appended to `src/styles.css`

Tokens only, no literal colour:

```css
/* archive-local — the ADR 0028 dual-source markers. Tokens only. */
.archive-local-badge { display: inline-flex; align-items: center; margin-left: .4rem; padding: .08rem .38rem; border: 1px solid var(--soot); background: var(--black-metal); color: var(--dim-ash); font-size: .64rem; font-weight: 900; letter-spacing: .06em; line-height: 1.5; text-transform: uppercase; vertical-align: middle; white-space: nowrap; }
.archive-local-notice { margin: 0 0 .6rem; color: var(--steel); font-size: .82rem; }
```

### Consumes

Verbatim from the predecessors, binding, not to be redesigned:

- `isArchiveTournamentLocked(tournamentDate: string, now?: Date): boolean` and `ARCHIVE_LOCK_WINDOW_DAYS = 365` from `src/app/domain/archive-models.ts`.
- `isLocalArchiveId(id: string | null | undefined): boolean` and `LOCAL_ARCHIVE_ID_PREFIX = 'local-'` from `src/app/data/archive-origin.ts`.
- `isArchiveTournamentRowLocked(row, now?)` and `isLeagueSeasonRowLocked(row, now?)` from `src/app/data/archive-summary.ts`.
- `ArchiveCacheService`, `ArchiveYearPartition`, `ArchiveCatalogRecord<T>`, `ArchiveYearsMetaRecord`, `isArchiveCatalogFresh`, `utcDayKey` from `src/app/backend/archive-cache.service.ts`.
- `ArchiveBackfillQueue`, `ArchiveYearLoader`, `ArchiveBackfillReport`, `classifyArchiveYear`, `isArchiveYearPartitionComplete` from `src/app/backend/archive-backfill-queue.ts`.
- `LocalArchiveBackend` from `src/app/backend/local-archive-backend.service.ts`, reached **only** through the private `LocalArchiveSource` adapter already declared in `archive-repository.service.ts`.
- `ArchiveLeagueRow`, `ArchiveLeagueSeasonRow`, `ArchiveTournamentRow`, `ArchiveCatalogResult<T>`, `archiveYearRange`, `compareArchiveTournamentRows`, `ARCHIVE_UPDATED_EVENT` from `src/app/data/archive-repository.service.ts`.
- Existing app symbols, unchanged: `I18nService`, `logBoundaryError`, `BackButtonComponent`, `ArchiveShellComponent` (selector `gones-archive-shell`).

### Errors

No new exception type is defined and none is thrown. Every failure is a degradation, and every path is pinned:

| Path | Behaviour |
| --- | --- |
| Server League/Season catalog rejects, local rows exist | Serve the local half alone, `stale: true`, `totalCount` = local count, `truncated: false`. Tab 1 renders the rows and the sync bar's offline state, **no** error banner. |
| Server League/Season catalog rejects, no local rows and no cached record | Rethrow. Tab 1 sets `archive.loadFailed` and logs `logBoundaryError('archive-league-season-list.load', reason)`. Never an empty-state lie (ADR 0031). |
| `GET /api/archive/years` rejects, local Tournaments exist | `listYears()` returns `mergeLocalArchiveYears([], localYears)` — the local years alone, every `locked: false`. Tab 2 renders those years and their local rows. |
| `GET /api/archive/years` rejects, no local Tournament and no stored partition | Rethrow. Tab 2 renders `archiveTournaments.loadFailed` and logs `logBoundaryError('archive-tournament-list.load', error, { year })`. |
| A year's loader rejects inside `drain` | `{ year, error }` lands in `report.failed`, **no partition is written**, `stale: true`. Local rows for that year are still served. |
| `listSeasonTournaments` on a `local-` Season | Answered from the browser store. No request is made, not even when the server is reachable. `fromCache: true`, `truncated: false`. |
| `listSeasonTournaments` rejects with `404` | Rethrown unchanged; the expansion sets `{ status: 'failed' }` and renders one `.archive-child-placeholder` with `archiveSeason.loadFailed`. |
| A browser-local read rejects (`indexedDbUnavailable`, `indexedDbBlocked`, `indexedDbOpenFailed`) | Treated as **no local rows**: the server half still renders. A browser with no IndexedDB is a server-only archive, never a blank page. |

### Invariants

1. **Cache purity, the load-bearing one.** No record written to `gones-archive-cache` ever contains a row whose `id` starts with `local-`, and no stored shape has an `isLocal` field. Three write paths, all covered: `writeLeagueCatalog`, `writeSeasonCatalog` and the backfill queue's year-partition `put` — whose loader returns the server response verbatim and never sees the local store. The local store is an **authority** and the cache is a **cache**; they are two databases for exactly this reason (assumption A10), so that "purge the cache" can never delete a record the user authored.
2. **`isLocal` is display, the id is truth.** `row.isLocal === isLocalArchiveId(row.id)` for every row the repository returns. Every lock decision keys on the **id**, through `isArchiveTournamentRowLocked` / `isLeagueSeasonRowLocked`, never on `isLocal`. There is exactly one lock derivation per tier in the whole frontend.
3. **A local row is never locked.** `isArchiveTournamentRowLocked({ id: 'local-…', tournamentDate })` is `false` for every date, including `'1900-01-01'`. `isLeagueSeasonRowLocked({ id: 'local-…', lastTournamentDate })` likewise. No 🔒 renders on a local row on either tab, in the expansion or on the Season page.
4. **Union ordering.** Server rows first, local rows appended, then the list is sorted by the surface's own comparator. `listTournaments` sorts the union with `compareArchiveTournamentRows` (`tournamentDate DESC, id ASC`, ordinal id compare). Tab 1 and Tab 2 then apply filter → sort → page, in that order, over the union.
5. **Counting.** `totalCount` includes the local rows on every list. Tab 1's `totalRows()` is `filteredRows().length` over the union; Tab 2's pager counts the union. A local row can therefore fall on any page and is never pinned to page 1.
6. **Year bucketing is total.** Every local Tournament belongs to exactly one year: `Number(tournamentDate.slice(0, 4))` when `tournamentDate` matches `/^\d{4}-\d{2}-\d{2}$/`, otherwise `now.getUTCFullYear()`. Selecting year `Y` on Tab 2 shows exactly the local Tournaments whose bucket is `Y`. No local Tournament is shown in two years and none is shown in none.
7. **The years index never loses a local year, and never gains a false lock.** `mergeLocalArchiveYears` adds a missing year with `locked: false`, adds to an existing year's `tournamentCount`, and leaves every existing `locked` byte-identical. Its output is sorted ascending by `year` and holds no duplicate year.
8. **A local-only year costs no request.** `listTournaments({ year })` restricts its backfill and its partition reads to years present in the **server** index, so a year that exists only because of a browser-local Tournament enqueues nothing and fetches nothing.
9. **No cross-authority join.** `listSeasonTournaments` picks its store from `isLocalArchiveId(season.id)`. A local Tournament never appears under a server Season and a server Tournament never under a local Season. This is ADR 0028's *"A tournament never crosses the boundary"* on the read side.
10. **The read-through still writes nothing.** `listSeasonTournaments` reaches no writing method — not `writeLeagueCatalog`, not `writeSeasonCatalog`, not `writeYearsMeta`, not `queue.enqueue`, not `queue.drain`.
11. **Single writer, unchanged.** `archive-backfill-queue.ts` remains the only non-test file that writes the `year-partitions` store. Nothing in this ticket writes any IndexedDB store.
12. **No new IndexedDB namer.** No file added or edited by this ticket contains `indexedDB` or an `IDB*` type name, so the allowlist assertion in `src/app/backend/server-authority-boundary.test.ts` passes untouched. The Cypress spec is not under `src/` and is not scanned.
13. **Purity.** `archiveTournamentYear`, `mergeLocalArchiveYears`, `buildLeagueSeasonRows`, `filterLeagueSeasonRows`, `sortLeagueSeasonRows`, `filterArchiveTournamentRows` and `sortArchiveTournamentRows` never mutate an argument, never touch the DOM, never inject, and read the clock only through an explicit defaulted `now`.
14. **Units.** `tournamentDate`, `firstTournamentDate` and `lastTournamentDate` are `YYYY-MM-DD` calendar dates with no time and no zone. `updatedAt`, `createdAt`, `fetchedAt` and `completedAt` are ISO 8601 UTC instants. `year` is a proleptic ISO calendar year as a `number`. `documentVersion` is a positive integer.
15. **Idempotency.** Two `listTournaments({ year })` calls with a warm cache issue zero requests and return equal arrays. Nothing in this slice mutates, so re-entering any route with the same query string produces the same DOM.
16. **i18n parity.** `Object.keys(catalogs.en).sort()` equals `Object.keys(catalogs.fr).sort()` after this commit.

## TDD

1. **Red** — write every test named in `Test plan` first, in this order: the repository union and cache-purity tests, then Tab 1, then Tab 2, then the expansion and Season page, then the i18n parity check, then the Cypress spec. Run them and confirm each fails for the stated reason — a test that passes before the change proves nothing. Assert behaviour (what a caller or a reader sees), never a private field.
2. **Green** — write the minimum code in `Impl steps` order to turn each red test green. Do not write a line that no test asks for.
3. **Refactor** — only if needed, and only while green. The two union helpers (`archiveTournamentYear`, `mergeLocalArchiveYears`) exist because their rules are testable in isolation; keep them pure.

## Test plan

Run the frontend suites with `npx vitest run <path>` while iterating and `npm run test` before finishing.

### `src/app/data/archive-repository.service.test.ts` (extended, not rewritten)

Existing tests stay. The stubs already in the file are reused: an `ArchiveCacheService` stub, an `ArchiveBackfillQueue` stub, a `Client` stub of the five reads, and a `LocalArchiveBackend` stub of the three list methods, provided through `TestBed.configureTestingModule({ providers: […] })`.

| Test | Input | Expect |
| ---- | ----- | ------ |
| `archiveTournamentYear reads the year out of a dated row` | `{ tournamentDate: '2024-03-01' }` | `2024` |
| `archiveTournamentYear buckets an undated local row into the current UTC year` | `{ tournamentDate: '' }`, `now = 2026-08-22T00:00:00Z` | `2026` |
| `archiveTournamentYear buckets a malformed date into the current UTC year` | `{ tournamentDate: '2024-3-1' }`, same `now` | `2026` |
| `mergeLocalArchiveYears adds a year only local rows occupy` | server `[{ year: 2025, locked: true, tournamentCount: 4 }]`, local `[2019]` | `[{ year: 2019, locked: false, tournamentCount: 1 }, { year: 2025, locked: true, tournamentCount: 4 }]` |
| `mergeLocalArchiveYears adds to an existing year without unlocking it` | server `[{ year: 2020, locked: true, tournamentCount: 2 }]`, local `[2020, 2020]` | `[{ year: 2020, locked: true, tournamentCount: 4 }]` |
| `mergeLocalArchiveYears sorts ascending and never duplicates a year` | server `[{ year: 2025, … }, { year: 2021, … }]`, local `[2023, 2023, 2021]` | years `[2021, 2023, 2025]`, length `3` |
| `listLeagues unions the browser-local Leagues and flags them` | 1 server League, 1 local League | `items.length === 2`; the `local-` row has `isLocal: true`, the server row `isLocal: false`; `totalCount === serverTotalCount + 1` |
| `listLeagueSeasons unions the browser-local Seasons and flags them` | 1 server Season, 1 local Season | as above, on `listLeagueSeasons` |
| `listLeagues never writes a browser-local row into the cache` | as above | the record passed to `writeLeagueCatalog` holds exactly the server row; no item id starts with `local-`; no item has an `isLocal` key |
| `listLeagueSeasons never writes a browser-local row into the cache` | as above | same, on `writeSeasonCatalog` |
| `the year loader never hands a browser-local row to the backfill queue` | 1 local Tournament in 2025, server year 2025 returns 3 rows | every `items[]` the captured `ArchiveYearLoader` resolves has no id starting with `local-` and no `isLocal` key |
| `listYears exposes a year that only a browser-local Tournament occupies` | server years `[2025]`, one local Tournament dated `2019-05-04` | the result contains `{ year: 2019, locked: false, tournamentCount: 1 }` |
| `listYears keeps serving local years when the years endpoint fails` | `getArchiveYears()` rejects, one local Tournament dated `2019-05-04`, no meta snapshot | resolves `[{ year: 2019, locked: false, tournamentCount: 1 }]`, does not reject |
| `listYears still rethrows when the server fails and this browser holds nothing` | `getArchiveYears()` rejects, no local Tournament, no snapshot | rejects with the original error |
| `listTournaments restricted to a year serves that year plus its local rows` | server 2025 partition of 2 rows, local Tournaments dated `2025-02-02` and `2019-05-04` | `items.length === 3`; the `2019` local row is absent; `totalCount === 2 + 1` |
| `listTournaments restricted to a local-only year issues no request` | server years `[2025]`, `{ year: 2019 }`, one local Tournament dated `2019-05-04` | `queue.enqueue` never called; the client's year read never called; `items` is exactly the one local row |
| `listTournaments without a year serves every year and every local row` | two server years, three local Tournaments across two of them | `items.length === serverRows + 3`; ordering is `tournamentDate DESC, id ASC` |
| `listTournaments sorts local rows into the server order, not after it` | server row `2025-06-01`, local row `2025-07-01` | `items[0].id` is the local row's id |
| `listSeasonTournaments answers a browser-local Season from the browser store` | Season id `local-abc` with two local Tournaments | the client is never called; `fromCache: true`; `truncated: false`; both rows `isLocal: true` |
| `listSeasonTournaments never joins a local Tournament into a server Season` | Season id `server-1`, one local Tournament with `seasonId: 'local-abc'` | no returned row has `isLocal: true` |
| `listSeasonTournaments reports the read-through truncation` | read-through response `{ truncated: true }` | `{ fromCache: false, truncated: true }` |

### `src/app/features/archive/league-season-list.component.test.ts` (extended)

| Test | Input | Expect |
| ---- | ----- | ------ |
| `buildLeagueSeasonRows flags a browser-local Season` | one Season `{ id: 'local-1', isLocal: true }`, one `{ id: 's-1', isLocal: false }` | `rows[0].isLocal === true`, `rows[1].isLocal === false` |
| `buildLeagueSeasonRows never locks a browser-local Season` | `{ id: 'local-1', lastTournamentDate: '1990-01-01' }`, `now = 2026-08-22` | `locked === false` |
| `buildLeagueSeasonRows still locks an old server Season` | `{ id: 's-1', lastTournamentDate: '1990-01-01' }`, same `now` | `locked === true` |
| `buildLeagueSeasonRows defaults isLocal to false for a bare wire summary` | a summary with no `isLocal` key | `rows[0].isLocal === false` |
| `the list reads the unioned catalogs` | repository stub | `listLeagueSeasons` and `listLeagues` are each called once on load; no other repository method is called |
| `a browser-local Season is searchable beside a server one` | local `Home Season`, server `Away Season`, `?search=home` | one row, the local one |
| `a browser-local Season obeys the League filter` | local Season under local League `local-L`, `?league=local-L` | only that row |
| `a browser-local Season sorts among the server rows` | local `lastTournamentDate: '2026-01-01'`, server `'2025-01-01'`, default sort | the local row is first |
| `a browser-local Season is counted in the pager` | 25 server Seasons + 1 local, `size=25` | `totalRows() === 26`, `totalPages() === 2`, and the local row is reachable on page 2 with `?page=2` |
| `the local badge renders only on browser-local rows` | one local, one server | exactly one `[data-cy^="archive-seasons-local-badge-"]`, and it is inside the local row |
| `the local notice renders only when this browser holds a row` | server-only list, then a list with one local row | absent, then present with `archive.localNotice` |
| `no lock marker renders on a browser-local row` | local Season `lastTournamentDate: '1990-01-01'` | `[data-cy="archive-seasons-lock-local-1"]` does not exist |

### `src/app/features/archive/tournament-list.component.test.ts` (extended)

| Test | Input | Expect |
| ---- | ----- | ------ |
| `isLocked is false for a browser-local Tournament of any age` | `{ id: 'local-1', tournamentDate: '1990-01-01' }` | `false` |
| `isLocked is true for an old server Tournament` | `{ id: 't-1', tournamentDate: '1990-01-01' }` | `true` |
| `the tab loads one year through the repository` | source stub | `loadYear(2025)` was called with the resolved year and nothing else was |
| `the year select offers a year only a browser-local Tournament occupies` | years `[{2025},{2019, locked:false, tournamentCount:1}]` | the select holds an option for `2019` |
| `selecting a year hides browser-local Tournaments played outside it` | `?year=2025`, source returns only the 2025 union | no row dated outside 2025 renders |
| `a browser-local Tournament is searchable beside a server one` | local `Kitchen Table`, server `Grand Prix`, `?search=kitchen` | one row, the local one |
| `a browser-local Tournament sorts among the server rows` | local `2025-07-01`, server `2025-06-01`, default `date desc` | the local row is first |
| `a browser-local Tournament is counted in the pager` | 25 server rows + 1 local, `size=25` | 2 pages, the local row reachable on page 2 |
| `the local badge renders only on browser-local rows` | one local, one server | exactly one `[data-cy^="archive-tournaments-local-badge-"]` |
| `the local notice explains the undated bucket only when one is shown` | a local row with `tournamentDate: ''`, then one with a real date | the notice contains `archive.localUndated` interpolated with the year, then does not |
| `no lock marker renders on a browser-local row` | local row dated `1990-01-01` | no 🔒 in that row |

### `src/app/features/archive/league-season-detail.component.test.ts` (extended)

| Test | Input | Expect |
| ---- | ----- | ------ |
| `readSeasonTournaments delegates to the repository read` | stub source returning `{ items, fromCache: true, truncated: false }` | `{ origin: 'cache', items, truncated: false }`; the stub is called exactly once with the Season |
| `readSeasonTournaments reports a server read` | stub returning `{ fromCache: false, truncated: true }` | `{ origin: 'server', truncated: true }` |
| `readSeasonTournaments never reads a year partition itself` | a source stub recording every member call | only `listSeasonTournaments` was called |
| `expanding a browser-local Season lists its browser-local Tournaments` | Season `local-1` with two local children | both lines render, each with a local badge |
| `an expanded browser-local child carries no lock marker` | local child dated `1990-01-01` | no 🔒 in the child line |
| `the Season page marks a browser-local Season and never locks it` | Season `{ id: 'local-1', lastTournamentDate: '1990-01-01' }` | `[data-cy="archive-season-local-badge"]` exists; no 🔒 |

### `src/app/i18n/messages.test.ts` (extended)

| Test | Input | Expect |
| ---- | ----- | ------ |
| `en local badge is Local only` | `translate('en', 'archive.localBadge')` | `'Local only'` |
| `fr local badge is Local uniquement` | `translate('fr', 'archive.localBadge')` | `'Local uniquement'` |
| `the local notice says the browser is the only copy in both languages` | both catalogues | `en` matches `/this browser only/`; `fr` matches `/uniquement dans ce navigateur/` |

`src/app/i18n/message-namespace.test.ts:16-18` already asserts key-set parity and must stay green with no edit.

### `cypress/e2e/league-local.cy.js` (rewritten for the new routes)

Run with `npx cypress run --spec cypress/e2e/league-local.cy.js` against a running stack.

| Test | Input | Expect |
| ---- | ----- | ------ |
| `lists browser-local Seasons and Tournaments beside server ones in both tabs` | `gones-archive-local` seeded with one League, one Season, two Tournaments; every `/api/archive/**` read stubbed with a one-row server catalog | Tab 1 shows the local Season and the server Season; Tab 2 shows the local Tournaments and the server one; only the local rows carry `[data-cy^="archive-seasons-local-badge-"]` / `[data-cy^="archive-tournaments-local-badge-"]`; the notice renders on both tabs |
| `never locks a browser-local record however old it is` | local Tournament dated `1990-01-01`, server Tournament dated `1990-01-01` | the server row shows 🔒; the local row does not |
| `keeps browser-local records out of the public catalog cache` | after visiting both tabs and expanding the local Season | reading every store of `gones-archive-cache` finds no id starting with `local-` and no `isLocal` key |
| `buckets a browser-local Tournament under its own year` | local Tournaments dated `2019-05-04` and `2025-02-02`, server years `[2025]` | the year select offers `2019`; `?year=2025` hides the 2019 row; `?year=2019` shows it and hides the 2025 one |
| `survives a fully unavailable archive API` | every `/api/archive/**` stubbed `401`, local records seeded | both tabs still list the local records, no `[data-cy="archive-seasons-error"]` and no `[data-cy="archive-tournaments-error"]`; every recorded request was answered `401` |
| `expands a browser-local Season without making a request` | Tab 1, click the local Season's expander | the child lines render; no `/api/archive/league-seasons/local-…/tournaments` request was recorded |

The seeding helper, written once at the top of the spec and used by every test:

```js
const LOCAL_ARCHIVE_DB_NAME = 'gones-archive-local';
const ARCHIVE_CACHE_DB_NAME = 'gones-archive-cache';

/** Write the three browser-local stores directly. No editing UI exists on `/archive/**` yet, and
 *  seeding the authority is what this spec is about — not how a record got there. */
function seedLocalArchive(win, { leagues = [], leagueSeasons = [], tournaments = [] }) {
  return new Cypress.Promise((resolve, reject) => {
    const open = win.indexedDB.open(LOCAL_ARCHIVE_DB_NAME, 1);
    open.onupgradeneeded = () => {
      for (const store of ['leagues', 'league-seasons', 'tournaments']) {
        if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store, { keyPath: 'id' });
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(['leagues', 'league-seasons', 'tournaments'], 'readwrite');
      for (const row of leagues) transaction.objectStore('leagues').put(row);
      for (const row of leagueSeasons) transaction.objectStore('league-seasons').put(row);
      for (const row of tournaments) transaction.objectStore('tournaments').put(row);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  });
}

/** Every row of every `gones-archive-cache` store, for the purity assertion. Resolves `[]` when the
 *  database was never created — a browser that cached nothing has cached nothing local either. */
function readArchiveCacheRows(win) {
  return new Cypress.Promise((resolve, reject) => {
    const open = win.indexedDB.open(ARCHIVE_CACHE_DB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const stores = [...database.objectStoreNames];
      if (!stores.length) { database.close(); resolve([]); return; }
      const rows = [];
      const transaction = database.transaction(stores, 'readonly');
      for (const store of stores) {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => rows.push(...request.result);
      }
      transaction.oncomplete = () => { database.close(); resolve(rows); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  });
}
```

The existing test `folds this browser's matches into the player page only while Online-only is off` is **kept unchanged**, in its own `describe`, with a comment saying it still exercises the legacy `gones-leagues` store and the legacy `/leagues-archive` pages, and that it retires with them. The player page has not been re-pointed at `gones-archive-local` by any ticket in this plan; deleting its coverage now would drop a proved capability with nothing replacing it.

## Impl steps

- [ ] 1. **Red: the repository union and the cache-purity invariant.**
  - [ ] 1.1 Open `src/app/data/archive-repository.service.ts` and read it end to end. Note the exact names of: the private local-store adapter interface, the private catalog loader, the private year loader, and the local row mappers. Every step below edits that file in place.
  - [ ] 1.2 Append the twenty-one rows of `Test plan → src/app/data/archive-repository.service.test.ts` to that spec, reusing the stubs already declared in it. Add `import { archiveTournamentYear, mergeLocalArchiveYears } from './archive-repository.service';` to the existing import.
  - [ ] 1.3 Run `npx vitest run src/app/data/archive-repository.service.test.ts` and confirm the new tests fail — the two helpers do not exist and `listTournaments` takes no `year`.

- [ ] 2. **Green: the two pure union helpers.**
  - [ ] 2.1 In `src/app/data/archive-repository.service.ts`, add `export function archiveTournamentYear(row, now = new Date()): number` with the body given verbatim in `Interface contract → Produces — archive-repository.service.ts`, above the `@Injectable` class and below the existing exported comparators.
  - [ ] 2.2 Directly beneath it, add `export function mergeLocalArchiveYears(server, localYears): ArchiveYearEntry[]` with its verbatim body.
  - [ ] 2.3 Run `npx vitest run src/app/data/archive-repository.service.test.ts -t 'archiveTournamentYear'` and `-t 'mergeLocalArchiveYears'`; those nine tests go green.

- [ ] 3. **Green: `listYears` and `listTournaments` union the browser-local store.**
  - [ ] 3.1 Extract the current `listYears` body into `private async serverYears(options: { force?: boolean }): Promise<{ years: ArchiveYearEntry[]; stale: boolean }>` with **no behaviour change**: the fresh-snapshot short circuit returns `{ years: snapshot.years, stale: false }`, the successful fetch returns `{ years, stale: false }`, the caught-with-snapshot path returns `{ years: snapshot.years.map((entry) => ({ ...entry, locked: false })), stale: true }`, and the caught-without-snapshot path rethrows.
  - [ ] 3.2 Add `private async localTournamentRows(): Promise<ArchiveTournamentRow[]>` if the file does not already have an equivalent: it calls the local adapter's tournament list and maps each document through the existing local-tournament row mapper (`isLocal: true`). Wrap the call in `try { … } catch { return []; }` — a browser with no IndexedDB is a server-only archive, never a blank page.
  - [ ] 3.3 Replace the `listYears` body with the eleven-line version given verbatim in `Interface contract`.
  - [ ] 3.4 Replace the `listTournaments` signature with `listTournaments(options: { force?: boolean; year?: number } = {})` and its body with the version given verbatim in `Interface contract`.
  - [ ] 3.5 Add `truncated` to `ArchiveSeasonTournamentsResult` and set it on all three `listSeasonTournaments` return paths: `false` on the browser-local branch, `false` on the cache branch, `response.truncated ?? false` on the read-through branch.
  - [ ] 3.6 Run `npx vitest run src/app/data/archive-repository.service.test.ts` until every test in the file, old and new, is green.
  - [ ] 3.7 Run `npx vitest run src/app/backend/server-authority-boundary.test.ts` and confirm it is still green — this ticket adds no IndexedDB namer.

- [ ] 4. **Tab 1 — the League Seasons tab lists browser-local Seasons.**
  - [ ] 4.1 Append the twelve rows of `Test plan → league-season-list.component.test.ts` to that spec. Confirm they fail.
  - [ ] 4.2 In `src/app/features/archive/league-season-list.component.ts`, add `isLocal: boolean;` as the last field of `interface LeagueSeasonRow`, with the doc comment `/** This row lives in gones-archive-local. Display only — the lock keys on the id, not on this. */`.
  - [ ] 4.3 Widen `buildLeagueSeasonRows`'s two parameters to `readonly (ArchiveLeagueSeasonSummary & { isLocal?: boolean })[]` and `readonly (ArchiveLeagueSummary & { isLocal?: boolean })[]`, and replace its body with the verbatim version in `Interface contract`: `locked: isLeagueSeasonRowLocked(season, now)` and `isLocal: season.isLocal ?? false`.
  - [ ] 4.4 Replace the `isArchiveTournamentLocked` import with `import { isLeagueSeasonRowLocked } from '../../data/archive-summary';`, dropping the now-unused import so `@typescript-eslint/no-unused-vars` stays quiet.
  - [ ] 4.5 Retype the two signals: `readonly seasons = signal<ArchiveLeagueSeasonRow[]>([]);` and `readonly leagues = signal<ArchiveLeagueRow[]>([]);`, importing both types from `../../data/archive-repository.service`.
  - [ ] 4.6 In `load()`, change the two repository calls to `this.repo.listLeagueSeasons(options)` and `this.repo.listLeagues(options)`. Leave the `Promise.allSettled` degradation, the `syncedAt` / `truncated` / `stale` assignments and the two `logBoundaryError` boundaries exactly as they are.
  - [ ] 4.7 Add `readonly hasLocalRows: Signal<boolean>;` beside the other derived signals and, in the constructor, `this.hasLocalRows = computed(() => this.rows().some((row) => row.isLocal));`.
  - [ ] 4.8 In the template, immediately after the `@if (truncated())` warning paragraph and before `<div class="archive-status-line" …>`, insert the `archive-seasons-local-notice` paragraph given in `Interface contract`.
  - [ ] 4.9 In the row loop's name cell, immediately after the closing `</a>` of `.archive-name-link`, insert the `archive-seasons-local-badge-` span given in `Interface contract`.
  - [ ] 4.10 Run `npx vitest run src/app/features/archive/league-season-list.component.test.ts` — green.

- [ ] 5. **Tab 2 — the Tournaments tab lists browser-local Tournaments, year filter included.**
  - [ ] 5.1 Append the eleven rows of `Test plan → tournament-list.component.test.ts` to that spec. Confirm they fail.
  - [ ] 5.2 In `src/app/features/archive/tournament-list.component.ts`, replace `archiveTournamentTabSourceFactory` with the verbatim version in `Interface contract`: `listYears: () => repo.listYears()`, `loadYear: (year) => repo.listTournaments({ year })`, and `listSeasonLeagueNames` reading `.items` off `repo.listLeagueSeasons()` and `repo.listLeagues()`.
  - [ ] 5.3 Replace `isLocked(row)`'s body with `return isArchiveTournamentRowLocked(row);` and change the import to `import { isArchiveTournamentRowLocked } from '../../data/archive-summary';`, dropping the direct `isArchiveTournamentLocked` import if nothing else in the file uses it.
  - [ ] 5.4 Add `readonly hasLocalRows = computed(() => this.pagedRows().some((row) => row.isLocal));` and `readonly localUndatedShown = computed(() => this.pagedRows().some((row) => row.isLocal && !/^\d{4}-\d{2}-\d{2}$/.test(row.tournamentDate)));`.
  - [ ] 5.5 In the template, immediately after the `@if (truncated())` warning and before the table wrapper, insert:
        ```html
        @if (hasLocalRows()) {
          <p class="archive-local-notice" role="status" data-cy="archive-tournaments-local-notice">{{ i18n.t('archive.localNotice') }}@if (localUndatedShown()) { {{ ' ' + i18n.t('archive.localUndated', { year: query().year }) }} }</p>
        }
        ```
  - [ ] 5.6 In the row loop's name cell, immediately after the Tournament name link, insert the `archive-tournaments-local-badge-` span given in `Interface contract`.
  - [ ] 5.7 Run `npx vitest run src/app/features/archive/tournament-list.component.test.ts` — green.

- [ ] 6. **The Season expansion and the Season page.**
  - [ ] 6.1 Append the six rows of `Test plan → league-season-detail.component.test.ts` to that spec, and update any existing test that stubs `SeasonTournamentsSource` with `readYearPartition` / `fetchSeasonTournaments` to stub the single `listSeasonTournaments` member instead. Confirm the new ones fail.
  - [ ] 6.2 In `src/app/features/archive/league-season-detail.component.ts`, add `readonly isLocal: boolean;` as the last field of `interface ArchiveTournamentRow` and of `interface ArchiveSeasonRow`.
  - [ ] 6.3 Replace `interface SeasonTournamentsSource`'s two members with the single `listSeasonTournaments(season)` member given in `Interface contract`, keeping `ArchiveSeasonSource extends SeasonTournamentsSource` unchanged. Delete the now-unused `CachedYearPartition` and `SeasonTournamentsPage` interfaces **only if nothing else in the file or its spec names them**; otherwise leave them exported and untouched.
  - [ ] 6.4 Replace `readSeasonTournaments`'s body with the four-line adapter given verbatim in `Interface contract`. Keep the exported name, the parameter list and the `SeasonTournamentsRead` return type; rename the unused clock parameter to `_now` so ESLint stays quiet.
  - [ ] 6.5 Replace `archiveSeasonSourceFactory` with the verbatim version in `Interface contract` — `repo.listSeasonTournaments`, `(await repo.listLeagueSeasons()).items.find(…)`, `(await repo.listLeagues()).items.find(…)?.name`. Drop the `ArchiveCacheService` injection and its import: the component no longer touches the cache.
  - [ ] 6.6 Change the Season page's 🔒 condition to `isLeagueSeasonRowLocked(season)` from `../../data/archive-summary`, replacing the "every spanned year locked" derivation.
  - [ ] 6.7 Add the `archive-season-local-badge` span to the Season page header after the Season name, and the `archive-season-child-local-` span to each `.archive-child-line` after the Tournament name, both exactly as given in `Interface contract`.
  - [ ] 6.8 Run `npx vitest run src/app/features/archive` — every archive component spec green.

- [ ] 7. **i18n, both catalogues.**
  - [ ] 7.1 In `src/app/i18n/messages.ts`, insert the four English strings — `archive.localBadge`, `archive.localBadgeTitle`, `archive.localNotice`, `archive.localUndated`, values exactly as tabulated — at the end of the `en` object, immediately before its `} as const;` terminator (line 1251 today), under the comment `// Archive dual-source markers (ADR 0028)`.
  - [ ] 7.2 Insert the four French strings, values exactly as tabulated, at the end of the `fr` object, immediately before its `};` terminator (line 2483 today), under the same comment.
  - [ ] 7.3 Append the three rows of `Test plan → src/app/i18n/messages.test.ts` to that spec.
  - [ ] 7.4 Run `npx vitest run src/app/i18n` — `message-namespace.test.ts`'s key-parity assertion and the three new tests are green.

- [ ] 8. **Styles.**
  - [ ] 8.1 Append the two rules of `Interface contract → Produces — CSS` to the end of `src/styles.css`, after the archive block already there. Verify by eye that every colour is a `var(--token)` from lines 4-17 and that no literal `oklch(`, `#` or `rgb(` was introduced.

- [ ] 9. **Cypress: the dual-source union on the new routes.**
  - [ ] 9.1 In `cypress/e2e/league-local.cy.js`, replace the file header comment with one that states what the spec now proves: browser-local archive records are unioned into both `/archive/**` tabs, are never locked, and never reach `gones-archive-cache`.
  - [ ] 9.2 Add the constants `LOCAL_ARCHIVE_DB_NAME = 'gones-archive-local'` and `ARCHIVE_CACHE_DB_NAME = 'gones-archive-cache'`, and the two helpers `seedLocalArchive(win, rows)` and `readArchiveCacheRows(win)` given verbatim in `Test plan`. Keep the existing `seedSettings`, `visit`, `profile` and `stubSignedIn` helpers.
  - [ ] 9.3 Add a `visitArchive(path, { seed })` helper that, in `onBeforeLoad`, deletes both `gones-archive-local` and `gones-archive-cache`, then calls `seedLocalArchive(win, seed)` — a deterministic start, since a previous run in the same browser may have left rows behind.
  - [ ] 9.4 Add the fixtures: one local League `{ id: 'local-league-1', name: 'Browser League', createdAt: '2026-08-01T00:00:00Z', documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z' }`; one local Season `{ id: 'local-season-1', name: 'Browser Season', leagueId: 'local-league-1', status: 'active', documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z' }`; and three local Tournaments under it — `local-t-1` dated `2025-02-02`, `local-t-2` dated `2019-05-04`, `local-t-old` dated `1990-01-01` — each `{ seasonId: 'local-season-1', status: 'completed', rounds: [], playerArchetypes: [], documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z' }`.
  - [ ] 9.5 Add the server stubs: `GET **/api/archive/leagues/all` → one League; `GET **/api/archive/league-seasons/all` → one Season; `GET **/api/archive/years` → `{ years: [{ year: 2025, locked: false, tournamentCount: 1 }] }`; `GET **/api/archive/tournaments/all?year=*` → one Tournament for 2025 and an ancient one dated `1990-01-01` for the lock test; `GET **/api/archive/league-seasons/*/tournaments` → recorded, so the "no request for a local Season" assertion can be made.
  - [ ] 9.6 Write the six tests of `Test plan → cypress/e2e/league-local.cy.js` in a `describe('Archive browser-local union (ADR 0028)')`.
  - [ ] 9.7 Move the existing `folds this browser's matches into the player page only while Online-only is off` test, unchanged, into a second `describe('Legacy browser-local League Archive — retires with the legacy pages')`, with a comment saying it exercises `gones-leagues` and `/leagues-archive` and that the players page has not been re-pointed at `gones-archive-local`. Delete the other four legacy tests and the helpers only they used (`createLocalLeague`, `deleteLeague`, `captureDownloads`, `readCapturedDownload`, `assertNoErrorBanner`, `stubServerLeagueReads`, `serverLeague`, `serverLeagueSummary`) **only if the kept test does not use them**; `stubSignedOut`, `readLocalLeagueRows`, `serverPlayerPayload` and `createLocalLeague` are used by it and stay.
  - [ ] 9.8 Run `npx cypress run --spec cypress/e2e/league-local.cy.js` against a running stack and iterate until green.

- [ ] 10. **Full validation.**
  - [ ] 10.1 `npm run test`
  - [ ] 10.2 `npm run typecheck`
  - [ ] 10.3 `npm run lint`
  - [ ] 10.4 `npm run build`
  - [ ] 10.5 `git status --porcelain` and confirm the changed-file list matches `Outputs` exactly — nothing under `backend/`, nothing under `src/app/features/leagues-archive/`, `src/app/features/tournaments-archive/` or `src/app/data/league-archive-*`.

## Outputs

Files touched — exactly these eleven, nothing else:

| File | Change |
| --- | --- |
| `src/app/data/archive-repository.service.ts` | `archiveTournamentYear`, `mergeLocalArchiveYears`, `serverYears`, unioned `listYears`, year-scoped `listTournaments`, `truncated` on `ArchiveSeasonTournamentsResult` |
| `src/app/data/archive-repository.service.test.ts` | +21 tests |
| `src/app/features/archive/league-season-list.component.ts` | `LeagueSeasonRow.isLocal`, lock via `isLeagueSeasonRowLocked`, R11 repository calls, `hasLocalRows`, badge + notice |
| `src/app/features/archive/league-season-list.component.test.ts` | +12 tests |
| `src/app/features/archive/tournament-list.component.ts` | tab source rewired to `listYears` / `listTournaments({ year })` / `listLeagueSeasons` / `listLeagues`, lock via `isArchiveTournamentRowLocked`, `hasLocalRows`, `localUndatedShown`, badge + notice |
| `src/app/features/archive/tournament-list.component.test.ts` | +11 tests |
| `src/app/features/archive/league-season-detail.component.ts` | `isLocal` on both row shapes, single-member `SeasonTournamentsSource`, `readSeasonTournaments` as an adapter, factory rewired, Season lock via `isLeagueSeasonRowLocked`, badges |
| `src/app/features/archive/league-season-detail.component.test.ts` | +6 tests, existing source stubs updated |
| `src/app/i18n/messages.ts` | +4 keys in `en`, +4 in `fr` |
| `src/app/i18n/messages.test.ts` | +3 tests |
| `src/styles.css` | `.archive-local-badge`, `.archive-local-notice` |
| `cypress/e2e/league-local.cy.js` | rewritten for `/archive/**`, +6 tests, one legacy test kept |

Public API / behaviour change:

- `ArchiveRepository.listTournaments` accepts `{ year }` and, when given, serves exactly that year.
- `ArchiveRepository.listYears` returns a union that may contain years the server never reported.
- `ArchiveSeasonTournamentsResult` gains `truncated: boolean`.
- `SeasonTournamentsSource` collapses from two members to one; `readSeasonTournaments` keeps its signature.
- `LeagueSeasonRow`, `ArchiveTournamentRow` and `ArchiveSeasonRow` each gain `isLocal: boolean`.
- Four new i18n keys in both catalogues; two new CSS classes.

Migrate / config: **none.** No migration, no environment variable, no config key, no backend change, no generated-client regeneration.

## Validation

- [ ] `npm run test` — exits `0`; the 53 tests added by this ticket pass and no existing test regresses. `src/app/backend/server-authority-boundary.test.ts` and `src/app/i18n/message-namespace.test.ts` are green with no edit.
- [ ] `npm run typecheck` — exits `0`, no output.
- [ ] `npm run lint` — exits `0`, `All files pass linting.`
- [ ] `npm run build` — exits `0`, bundle written to `dist/`.
- [ ] `npx cypress run --spec cypress/e2e/league-local.cy.js` against a running stack — `All specs passed!`, 7 tests (6 union + 1 kept legacy), 0 failing.
- [ ] Manual check, signed out, DevTools open: seed nothing, visit `/archive/league-seasons` — no local notice, no badge. Author nothing; instead, in the console, open `gones-archive-local` and put one Season and one Tournament dated `1990-01-01`, reload: the Season appears in Tab 1 with a `Local only` badge and **no** 🔒, the Tournament appears in Tab 2 under year `1990` with a badge and no 🔒, the notice renders once per tab, and `Application → IndexedDB → gones-archive-cache` contains **no** id starting with `local-`.
- [ ] App functional — `/leagues-archive`, `/leagues-archive/:id` and the legacy tournament pages still load and still work; `git diff --stat` lists no file under `backend/`, `src/app/features/leagues-archive/`, `src/app/features/tournaments-archive/` or `src/app/data/league-archive-*`.
- [ ] commit msg draft: `feat(archive): union browser-local records into both archive tabs`
