# T12: IndexedDB catalog cache, year partitions and backfill queue

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T10, T6
**Commit outcome:** Public archive catalogs are served from IndexedDB and one writer owns the year partitions.

## Context (self-contained)

- Goal: the Archive is rebuilt on three tiers — **League → LeagueSeason → Tournament**. Tournament
  becomes a first-class top-level record that may stand alone (`seasonId: null`); today's flat
  `League` becomes `LeagueSeason`; a new `League` tier groups Seasons. `leagues-archive` → `archive`
  everywhere.
- This slice: the **browser storage half** of that rebuild. Today the public League catalog lives in
  `localStorage` (`gones.leagues-archive.catalog.v2`, ~2.9 MB of UTF-16 against a ~5 MB quota).
  The three-tier archive is far larger — the measured mtgtop8 peak is about 17,500 Tournaments in a
  single calendar year — so the public catalogs move to a dedicated IndexedDB database
  `gones-archive-cache`, the Tournament table is stored **one calendar year per record**, and a
  single-writer queue fills those year records. After this ticket `localStorage` holds **only**
  language, view preference, table filters/sort/page-size and the existing auth coordination keys.
  **No catalog.**
- **The critical invariant of this ticket is single-writer atomicity.** Only
  `src/app/backend/archive-backfill-queue.ts` creates or updates a record in the `year-partitions`
  store, and a partition is written **and** stamped `completedAt` in **one** IndexedDB transaction,
  so a year is atomically whole or absent. A crash or a rejected fetch mid-backfill leaves **no**
  record — never a half one. Two tests exist for exactly that and they are not optional.
- Out of scope here — do **not** touch any of it:
  - **No component and no route.** `src/app/features/archive/**` and `src/app/app.routes.ts` belong
    to T13 and T14. This ticket ships services and pure functions only.
  - **Do not modify `src/app/shared/catalog-cache.ts`.** The Calendar/Event catalog, the global
    Player Statistics catalog and the per-player catalog still use it and this plan does not touch
    them. This ticket **imports** `CATALOG_TTL_MS` from it and changes nothing inside it.
  - **Do not delete `src/app/data/league-archive-repository.service.ts`**, nor
    `src/app/features/leagues-archive/league-archive-catalog-cache.service.ts`, nor any other legacy
    file. The legacy archive keeps working until T17 deletes it.
  - Do **not** implement the manual "Resynchronize everything" control, and do not add a Settings
    entry for it — T16 owns it.
  - Do **not** add the coverage test `src/app/data/archive-cache-invalidation.test.ts` — T16 owns it.
  - Do **not** edit `src/app/app.component.ts`. The `gones-archive-updated` event this ticket
    dispatches gets its listener when T13 lands the shell; until then it is dispatched and unheard,
    which breaks nothing.
  - Do **not** edit `src/app/backend/aspnet-api-backend.service.ts`, `application-backend.ts`,
    `src/app/i18n/messages.ts`, any `docs/adr/**` file, `docs/CONTEXT.md` or `docs/GLOSSARY.md`
    (T17 owns docs), and no backend C# file.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** Local data
    may be reset freely. No migration of an existing `localStorage` catalog is written: the old key
    simply stops being read by the new surface, and T17 removes its last reader.
  - T6 has landed: `GET /api/archive/tournaments/all?year=YYYY` and `GET /api/archive/years` serve
    partitions, and `npm run api:generate` has already put `getArchiveTournamentYearCatalog` and
    `getArchiveYears` on the generated `Client`.
  - T5 has landed with T6 (T6 could not ship without T2, and T13 consumes both): the generated
    `Client` also carries `getArchiveLeagueCatalog` and `getArchiveLeagueSeasonCatalog`. If
    `getArchiveLeagueCatalog` is **not** yet on the generated client when this ticket is executed,
    stop and land T5 first — this ticket does not stub a missing endpoint and does not modify the
    generated client.
  - T7 has landed with it for `getArchiveSeasonTournaments`; same rule.
  - T10 has landed: `src/app/domain/archive-models.ts` exports `ArchiveLeagueDocument`,
    `PersistedArchiveLeague`, `LeagueSeasonDocument`, `PersistedLeagueSeason`,
    `ArchiveTournamentDocument`, `PersistedArchiveTournament`, `ARCHIVE_DATA_VERSION = 5` and
    `isArchiveTournamentLocked`, and `src/app/backend/local-archive-backend.service.ts` exports the
    browser-local authority class. See `Inputs → From Depends` for the exact reconciliation rule if
    a T10 symbol is spelled differently — **T10's spelling wins, and only the import line and the
    call site change.**
  - Frontend is Angular 21 standalone + signals + zoneless, tested with Vitest (`npm run test`,
    `vitest.config.ts` → `environment: 'jsdom'`, `include: ['src/**/*.test.ts', 'ops/**/*.test.ts']`,
    `globals: true`).
  - **`fake-indexeddb` is not a dependency and this ticket adds none.** jsdom ships no IndexedDB, so
    the whole surface is stubbed in-memory inside the test files, exactly as
    `src/app/backend/local-league-archive-backend.service.test.ts:14-165` and
    `src/app/backend/local-live-backend.service.test.ts:150-190` already do. The block is given
    verbatim in `Impl steps` step 1.
  - **Codebase-vs-brief divergences, recorded and not fixed here:**
    - The plan brief cites `CATALOG_TTL_MS` at `src/app/shared/catalog-cache.ts:13`. It is at
      **line 12**. The constant and its value (`24 * 60 * 60 * 1000`) are exactly as the brief
      states; only the line number is off. The codebase wins.
    - The brief's frontend response types (`ArchiveLeagueSummary.updatedAt: string`,
      `ArchiveLeagueSeasonSummary.firstTournamentDate: string | null`) describe the **runtime JSON**.
      The generated client types NodaTime fields as the opaque interfaces `Instant` and `LocalDate`
      (`src/app/api/generated/gones-api.ts:10826` for `LocalDate`, `:11264` for `updatedAt: Instant`)
      even though `ConfigureForNodaTime` puts a plain ISO string on the wire
      (`backend/src/Gones.Api/Program.cs:53`). The repo already coerces those with `String(...)` at
      `src/app/backend/aspnet-api-backend.service.ts:46,282`. This ticket therefore declares its own
      **raw** response types with `unknown` for every NodaTime-shaped field and normalizes at the
      boundary. Nothing about the wire contract changes.
    - `src/app/backend/server-authority-boundary.test.ts` holds **two** pinned lists this ticket must
      touch, not one: the IndexedDB allowlist (`:100-112`) and the `shared/catalog-cache` importer
      allowlist (`:171-186`). Reusing `CATALOG_TTL_MS` instead of redefining it — which the plan
      requires — makes `archive-cache.service.ts` an importer of that module, so the second list
      gains exactly one entry. Both edits are in `Impl steps` step 7.

## Requirements

1. A new IndexedDB database `gones-archive-cache`, version `1`, with exactly four object stores:
   `leagues`, `league-seasons`, `year-partitions`, `meta`.
2. `leagues` and `league-seasons` each hold **one** record under the key `'catalog'`: the whole
   public catalog as served by `GET /api/archive/leagues/all` and
   `GET /api/archive/league-seasons/all`, plus the instant it was fetched, its `totalCount` and its
   `truncated` flag.
3. `year-partitions` holds one record per calendar year, keyed by the **number** `year`, shaped
   exactly as `ArchiveYearPartition` in `Interface contract`.
4. **Only `src/app/backend/archive-backfill-queue.ts` creates or updates a `year-partitions`
   record.** `ArchiveCacheService` may read partitions and may purge the store wholesale through
   `clearAll()`; it exposes no method that writes a single partition. A test scans every non-test
   file under `src/` and asserts the exact set that names the partition store.
5. A partition is built with `completedAt` already stamped and written by a single `put` inside a
   single `runTransaction(..., 'readwrite', ...)`. A rejected loader, a rejected `put` or an aborted
   transaction leaves the store **exactly** as it was: no new record, and no mutation of an existing
   one.
6. A record whose `completedAt` is `undefined` is treated as **absent** by every reader, so a record
   written by any other means can never be served as a complete year.
7. Year freshness follows the brief exactly:
   `cached && locked` → serve local, no request · `cached && !locked && <24h` → serve local, no
   request · `cached && !locked && ≥24h` → refetch that year · `!cached` → enqueue in the backfill
   queue. The 24 h bound is the existing `CATALOG_TTL_MS` imported from
   `src/app/shared/catalog-cache.ts`, never redefined.
8. Season expansion follows the brief exactly: when every year in
   `[year(firstTournamentDate) .. year(lastTournamentDate)]` is cached, complete **and** locked, the
   children are rendered from IndexedDB with **no** request; otherwise
   `GET /api/archive/league-seasons/{id}/tournaments` is issued and its answer is **not** cached.
   A test proves the second branch writes nothing.
9. The League and Season catalogs are served from IndexedDB while their record is under
   `CATALOG_TTL_MS` old, refetched past it, and refetched unconditionally under `{ force: true }`.
10. Every list the repository returns is the **union** of the server rows and the browser-local rows
    (ADR 0028), local rows flagged `isLocal: true`. A browser-local row is **never** written into
    `gones-archive-cache`: the cache mirrors public server answers and nothing else.
11. `ArchiveRepository.invalidateArchiveCaches()` clears all four stores and then dispatches
    `new CustomEvent('gones-archive-updated')` on `window`. It is the single funnel every archive
    mutation will call.
12. Cache failure is never fatal: a rejected read is a miss, a rejected write is swallowed, and a
    browser with no `indexedDB` at all still renders server + local data.
13. `src/app/data/archive-repository.service.ts` names **no** IndexedDB symbol, so it stays off the
    IndexedDB allowlist; it reaches storage only through `ArchiveCacheService` and
    `ArchiveBackfillQueue`.
14. `src/app/backend/server-authority-boundary.test.ts` lists `src/app/backend/archive-cache.service.ts`
    and `src/app/backend/archive-backfill-queue.ts` in its IndexedDB allowlist, and
    `src/app/backend/archive-cache.service.ts` in its `shared/catalog-cache` importer allowlist.
15. After this ticket `localStorage` holds **only** language, view preference, table
    filters/sort/page-size and the existing auth coordination keys
    (`gones.auth.sessionGeneration`, `gones.auth.privatePurgeRequired`,
    `gones.auth.coordinationProbe`). None of the three new files touches `localStorage`, asserted by
    a source scan in the cache test.
16. `npm run test`, `npm run typecheck` and `npm run lint` are green, and the app compiles and runs.

## Inputs

Read these before editing. Line numbers are as of this commit.

- `src/app/backend/indexed-db.ts` — the promise wrapper this ticket reuses and does **not**
  duplicate. Exports `openDatabase(name, version, upgrade)`, `getAll<T>(db, store)`,
  `getAllKeys(db, store)`, `get<T>(db, store, key)`, `put(db, store, value)`,
  `remove(db, store, key)`, `requestResult<T>(request)` and
  `runTransaction<T>(db, stores, mode, action)`. `runTransaction` resolves **only after the
  transaction commits** and rejects on `onerror` / `onabort` — that is what makes the atomicity
  test meaningful. `openDatabase` rejects with `new Error('indexedDbUnavailable')` when
  `globalThis.indexedDB` is absent.
- `src/app/shared/catalog-cache.ts` — `:12` `export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;`,
  `:15-20` `CatalogEntry<T>`, `:23-29` `CatalogResult<T>`, `:57-60` `isCatalogFresh`, whose
  "an instant that will not parse is stale" rule this ticket mirrors. **Import the constant, change
  nothing in this file.**
- `src/app/backend/local-league-archive-backend.service.ts:35-49` — the browser-store idiom to
  follow: exported `DB_NAME` / store constants, a `private database?: Promise<IDBDatabase>` memo
  (`:314-322`), `openDatabase` with a guarded `createObjectStore`.
- `src/app/backend/local-league-archive-backend.service.test.ts:14-215` — the in-memory IndexedDB
  fake, its `failPutAt` injection hook, its `readwriteTransactionCount` counter and its
  `beforeEach`/`afterEach` install/restore of `globalThis.indexedDB`. Step 1 reproduces it adapted.
- `src/app/data/league-archive-repository.service.ts` — the repository idiom: `@Injectable({
  providedIn: 'root' })`, injected ports, `listLeagues()` at `:66-88` with its
  `Promise.allSettled([serverRead, localRead])`, its degrade to the local half when the server
  rejects and its `throw server.reason` only when **both** reject (`:76-78`), and `private port(id)`
  at `:255-257` routing every id on its `local-` prefix.
- `src/app/features/leagues-archive/league-archive-catalog-cache.service.ts:37-62` — the TTL load
  shape being ported to IndexedDB: fresh entry → serve `fromCache: true`; fetch → store → serve;
  rejection with an entry → serve `stale: true`; rejection without → rethrow.
- `src/app/features/players/player-detail-cache.service.test.ts:37-42` — the DI test idiom:
  `Injector.create({ providers: [Service, { provide: Client, useValue: { method } }] })`.
- `src/app/backend/server-authority-boundary.test.ts` — `:100-112` the IndexedDB allowlist,
  `:171-186` the `shared/catalog-cache` importer allowlist, `:24-40` the `sourceFiles()` /
  `filesMatching()` helpers those lists use (they skip `*.test.ts`, so a fake in a test file is
  invisible to them).
- `src/app/api/generated/gones-api.ts` — `Client` is `@Injectable` (`:697-700`) and is injected with
  `inject(Client)`. Generated response types are **interfaces with an index signature**
  (`:10561-10567`), NodaTime fields are the opaque `Instant` / `LocalDate` interfaces (`:10826`,
  `:11264`), and query parameters arrive as positional arguments typed `T | undefined`
  (`getGlobalPlayerStatistics(page: number | undefined, ...)`, `:38`).
- `src/app/backend/aspnet-api-backend.service.ts:46,282` — `updatedAt: String(item.updatedAt)`, the
  existing coercion for a NodaTime field.
- `src/app/domain/models.ts:83-118` — `RoundEntry = MatchRoundEntry | ByeRoundEntry |
  InvalidRoundEntry`, with `player1Name` / `player2Name` on a match, `playerName` on a bye and no
  player on an invalid entry. Re-exported unchanged by `archive-models.ts`; this ticket counts
  distinct players from those three shapes.
- `docs/adr/0039-ttl-cache-contract.md` — one TTL contract for every data page: load once, serve
  under 24 h, refetch past it, and **"mutation invalidates its own entry … the TTL governs
  navigation; it never governs correctness."**
- `docs/adr/0031-authenticated-offline-read-cache.md` — why an authority and a cache never share a
  database, why `server-authority-boundary.test.ts` pins the exact file set allowed to touch
  IndexedDB, and the "a cache failure is never fatal: a write error is logged and swallowed, a read
  error is a miss" rule this ticket implements.
- `docs/adr/0028-dual-source-league-archive.md` — the local/server union rule: two stores, one list;
  a record belongs to exactly one store for its whole life; the `local-` id prefix is the whole
  routing rule; nothing ever synchronises in either direction.

- **From Depends (T6) — already in the tree, consumed verbatim:**
  - `GET /api/archive/tournaments/all?year=YYYY` → `200 ArchiveCatalogResponse<ArchiveTournamentSummary>`
    (`items` / `totalCount` / `truncated`), rows ordered `tournamentDate DESC, id ASC`, `totalCount`
    always the uncapped visible count of that year, cap `Gones:Archive:MaximumTournamentYearSize`
    default `25000`, `Cache-Control: public, max-age=3600`, per-year ETag. `year` is **required**;
    missing/non-integer/out of `1..9999` → `400` with `code: invalidRequest`. There is no all-years
    mode.
  - `GET /api/archive/years` → `200 ArchiveYearsResponse` = `{ years: ArchiveYearEntry[] }`,
    **ascending by year**, one entry per year holding at least one visible Tournament, each
    `{ year, locked, tournamentCount }`. `locked` **is** on the wire here and is computed server-side
    as "31 December of that year is more than 365 days old"; the years ETag includes the current UTC
    day, because `locked` flips at a day boundary.
  - Generated client operations, from `.WithName("GetArchiveTournamentYearCatalog")` and
    `.WithName("GetArchiveYears")`: `client.getArchiveTournamentYearCatalog(year)` — `year` is bound
    as a **string** query parameter server-side, so the generated argument is `string | undefined` —
    and `client.getArchiveYears()`.
  - `ArchiveTournamentSummary` carries **no** `locked`, **no** `rounds` and **no** `playerArchetypes`.
    A detail document is never stored in a year partition.
- **From T5 — consumed verbatim:** `client.getArchiveLeagueCatalog()` and
  `client.getArchiveLeagueSeasonCatalog()`, both `ArchiveCatalogResponse<T>` with rows ordered
  `updatedAt DESC, id ASC`, caps `Gones:Archive:MaximumLeagueCatalogSize` (2000) and
  `Gones:Archive:MaximumSeasonCatalogSize` (5000).
- **From T7 — consumed verbatim:** `client.getArchiveSeasonTournaments(seasonId)` →
  `ArchiveCatalogResponse<ArchiveTournamentSummary>` for one Season, ordered
  `tournamentDate DESC, id ASC`, cap `Gones:Archive:MaximumSeasonTournamentSize` (5000); `404` when
  the Season id is absent or soft-deleted; `200` with `items: []` when it exists and holds no
  Tournament. **This answer is deliberately never cached.**
- **From Depends (T10) — consumed verbatim:**
  - `src/app/domain/archive-models.ts`:
    `PersistedArchiveLeague` = `{ id, name, createdAt, documentVersion, updatedAt, eTag? }` ·
    `PersistedLeagueSeason` = `{ id, name, leagueId, status, documentVersion, updatedAt, eTag? }` ·
    `PersistedArchiveTournament` = `{ id, name, seasonId: string | null, tournamentDate, status,
    rounds, playerArchetypes, documentVersion, updatedAt, eTag? }` · `LeagueStatus =
    'active' | 'completed'` · `RoundDocument`, `RoundEntry` re-exported from `models.ts`.
  - `src/app/backend/local-archive-backend.service.ts` — the browser-local ADR 0028 authority over
    the database `gones-archive-local`.
  - **Reconciliation rule, binding and mechanical.** This ticket calls T10 through exactly one class
    and three list methods:

    | This ticket calls | Expected T10 symbol | Expected return |
    | --- | --- | --- |
    | `inject(LocalArchiveBackend)` | `LocalArchiveBackend` in `src/app/backend/local-archive-backend.service.ts` | — |
    | `local.listLeagues()` | `listLeagues` | `Promise<PersistedArchiveLeague[]>` |
    | `local.listLeagueSeasons()` | `listLeagueSeasons` | `Promise<PersistedLeagueSeason[]>` |
    | `local.listTournaments()` | `listTournaments` | `Promise<PersistedArchiveTournament[]>` |

    Open `src/app/backend/local-archive-backend.service.ts` before step 6. If a name differs,
    **T10's name wins** — change only the import line and the call site in
    `archive-repository.service.ts`, and change nothing about the `LocalArchiveSource` interface's
    return shapes. If a list method returns an envelope (for example
    `{ leagues, truncated }`, the shape `LeagueArchiveCatalog` uses today) unwrap it at the call
    site. If a method genuinely does not exist, keep `LocalArchiveSource` as declared and provide it
    from the closest T10 method; do **not** open a second IndexedDB connection from
    `archive-repository.service.ts` — that file must stay off the IndexedDB allowlist.
  - `isArchiveTournamentLocked(tournamentDate, now?)` from `archive-models.ts` exists and is the
    per-Tournament lock rule. **This ticket does not call it:** year-level `locked` comes from
    `GET /api/archive/years`, which computes it server-side against 31 December, and mixing the two
    would give a year two sources of truth. T13/T14 use the per-row rule for the 🔒 marker.

## Interface contract (level 5)

### Produces — `src/app/backend/archive-cache.service.ts`

```ts
/** Public catalog cache (ADR 0039 TTL contract), moved off `localStorage`. */
export const ARCHIVE_CACHE_DB_NAME = 'gones-archive-cache';
export const ARCHIVE_CACHE_DB_VERSION = 1;
export const CACHE_LEAGUE_STORE = 'leagues';
export const CACHE_SEASON_STORE = 'league-seasons';
export const CACHE_YEAR_PARTITION_STORE = 'year-partitions';
export const CACHE_META_STORE = 'meta';
/** Every store, in creation order. `clearAll()` purges exactly these and nothing else. */
export const ARCHIVE_CACHE_STORES = [
  CACHE_LEAGUE_STORE, CACHE_SEASON_STORE, CACHE_YEAR_PARTITION_STORE, CACHE_META_STORE
] as const;
/** The single key both catalog stores use: one record holds the whole catalog. */
export const ARCHIVE_CATALOG_KEY = 'catalog';
/** The single key the `meta` store currently uses. */
export const ARCHIVE_YEARS_META_KEY = 'years';

/** Re-exported so the queue reads one TTL and `shared/catalog-cache` keeps one new importer. */
export { CATALOG_TTL_MS };

export type ArchiveRowStatus = 'active' | 'completed';

export interface ArchiveLeagueSummary {
  id: string;
  name: string;
  createdAt: string;                    // ISO 8601 UTC instant
  updatedAt: string;                    // ISO 8601 UTC instant
  documentVersion: number;
}

export interface ArchiveLeagueSeasonSummary {
  id: string;
  name: string;
  leagueId: string;
  status: ArchiveRowStatus;
  updatedAt: string;                    // ISO 8601 UTC instant
  documentVersion: number;
  tournamentCount: number;
  playerCount: number;
  firstTournamentDate: string | null;   // "YYYY-MM-DD"; null when the Season has no Tournament
  lastTournamentDate: string | null;    // "YYYY-MM-DD"; null when the Season has no Tournament
}

export interface ArchiveTournamentSummary {
  id: string;
  name: string;
  seasonId: string | null;              // null ⇒ standalone
  tournamentDate: string;               // "YYYY-MM-DD"
  status: ArchiveRowStatus;
  updatedAt: string;                    // ISO 8601 UTC instant
  documentVersion: number;
  playerCount: number;
}

export interface ArchiveYearEntry {
  year: number;
  locked: boolean;
  tournamentCount: number;
}

/** One whole public catalog, as one record, under the key `'catalog'`. */
export interface ArchiveCatalogRecord<T> {
  key: typeof ARCHIVE_CATALOG_KEY;
  items: T[];
  totalCount: number;
  truncated: boolean;
  fetchedAt: string;                    // ISO 8601 UTC instant
}

/**
 * One calendar year of Tournament rows. `completedAt` ABSENT ⇒ the year is not cached; a partial
 * record is never written. Written only by `archive-backfill-queue.ts`, in one transaction.
 */
export interface ArchiveYearPartition {
  year: number;
  completedAt: string | undefined;
  rowCount: number;                     // the server's uncapped totalCount for that year
  items: ArchiveTournamentSummary[];
}

/** The years index as last fetched. Valid only while `utcDay` is today: `locked` flips at midnight. */
export interface ArchiveYearsMetaRecord {
  key: typeof ARCHIVE_YEARS_META_KEY;
  years: ArchiveYearEntry[];
  fetchedAt: string;                    // ISO 8601 UTC instant
  utcDay: string;                       // "YYYY-MM-DD", UTC
}

/** Mirrors `isCatalogFresh`: an instant that will not parse is stale, never fresh. */
export function isArchiveCatalogFresh(record: ArchiveCatalogRecord<unknown>, now?: number): boolean;

/** Today in UTC as `YYYY-MM-DD`. */
export function utcDayKey(now?: number): string;

@Injectable({ providedIn: 'root' })
export class ArchiveCacheService {
  /** The one open handle, memoised. Rejects with `Error('indexedDbUnavailable')` without IndexedDB. */
  database(): Promise<IDBDatabase>;

  readLeagueCatalog(): Promise<ArchiveCatalogRecord<ArchiveLeagueSummary> | null>;
  writeLeagueCatalog(record: ArchiveCatalogRecord<ArchiveLeagueSummary>): Promise<void>;
  readSeasonCatalog(): Promise<ArchiveCatalogRecord<ArchiveLeagueSeasonSummary> | null>;
  writeSeasonCatalog(record: ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>): Promise<void>;

  /** `null` for an absent record and for a record whose `completedAt` is undefined. */
  readYearPartition(year: number): Promise<ArchiveYearPartition | null>;
  /** Every stored partition, incomplete ones dropped. Order is unspecified; callers sort. */
  readAllYearPartitions(): Promise<ArchiveYearPartition[]>;

  readYearsMeta(): Promise<ArchiveYearsMetaRecord | null>;
  writeYearsMeta(record: ArchiveYearsMetaRecord): Promise<void>;

  /** Purges all four stores in one transaction. The only writable path this class has to partitions. */
  clearAll(): Promise<void>;
}
```

### Produces — `src/app/backend/archive-backfill-queue.ts`

```ts
/** One year as the server answered it, before it becomes a partition. */
export interface ArchiveYearPage {
  items: ArchiveTournamentSummary[];
  totalCount: number;
  truncated: boolean;
}

export type ArchiveYearLoader = (year: number) => Promise<ArchiveYearPage>;

export type ArchiveYearFreshness = 'fresh' | 'stale' | 'missing';

export interface ArchiveBackfillFailure { year: number; error: unknown }

export interface ArchiveBackfillReport {
  written: number[];                    // years whose partition was committed, in run order
  failed: ArchiveBackfillFailure[];     // years whose loader or write rejected; nothing was stored
}

/** A record is complete only when it exists and carries a `completedAt` stamp. */
export function isArchiveYearPartitionComplete(
  partition: ArchiveYearPartition | null | undefined
): partition is ArchiveYearPartition;

/**
 * §8.2 of the archive contract, verbatim:
 *   !cached                     → 'missing'
 *   cached && locked            → 'fresh'
 *   cached && !locked && <24h   → 'fresh'
 *   cached && !locked && ≥24h   → 'stale'
 * An unparsable `completedAt` on an unlocked year is 'stale'; on a locked year it stays 'fresh',
 * because locked rows can never change and the timestamp is then decoration.
 */
export function classifyArchiveYear(
  partition: ArchiveYearPartition | null | undefined,
  entry: ArchiveYearEntry,
  now?: number
): ArchiveYearFreshness;

/**
 * The single writer of the `year-partitions` store. One year at a time, one transaction per year,
 * `completedAt` stamped before the write so a year is atomically whole or absent.
 */
@Injectable({ providedIn: 'root' })
export class ArchiveBackfillQueue {
  /** Years waiting, in enqueue order, deduplicated. */
  readonly pending: Signal<readonly number[]>;
  /** True while a drain is in flight. At most one drain per instance, ever. */
  readonly running: Signal<boolean>;

  /** Appends years not already queued. Never starts work. */
  enqueue(years: readonly number[]): void;

  /**
   * Processes the queue to exhaustion, sequentially. A year enqueued during the run is picked up by
   * the same run. Calling `drain` while a drain is running returns the in-flight promise and
   * **ignores** the second `loader` — one writer means one loader.
   * Never rejects: a failing year lands in `report.failed`.
   */
  drain(loader: ArchiveYearLoader): Promise<ArchiveBackfillReport>;
}
```

### Produces — `src/app/data/archive-repository.service.ts`

```ts
/** Renames `gones-league-updated`. Dispatched after every cache purge. */
export const ARCHIVE_UPDATED_EVENT = 'gones-archive-updated';

/** A row plus where it lives. `isLocal` is repository-only and is never stored in the cache. */
export type ArchiveLeagueRow = ArchiveLeagueSummary & { isLocal: boolean };
export type ArchiveLeagueSeasonRow = ArchiveLeagueSeasonSummary & { isLocal: boolean };
export type ArchiveTournamentRow = ArchiveTournamentSummary & { isLocal: boolean };

export interface ArchiveCatalogResult<T> {
  items: T[];
  totalCount: number;      // server totalCount + the browser-local row count
  truncated: boolean;      // the server hit its row cap
  fetchedAt: string;       // ISO instant of the server half; for Tournaments the OLDEST partition
  fromCache: boolean;      // the server half came from IndexedDB, no request was made
  stale: boolean;          // the server was not reached, or a year could not be refreshed
}

export interface ArchiveSeasonTournamentsResult {
  items: ArchiveTournamentRow[];
  /** true ⇒ served from IndexedDB or from the browser-local store; no request was made. */
  fromCache: boolean;
}

/** `[]` when either bound is null, when a bound is not a `YYYY-…` string, or when last < first. */
export function archiveYearRange(
  firstTournamentDate: string | null,
  lastTournamentDate: string | null
): number[];

/** `tournamentDate DESC, id ASC` with ordinal id comparison — the server's order, reproduced. */
export function compareArchiveTournamentRows(
  left: ArchiveTournamentSummary,
  right: ArchiveTournamentSummary
): number;

@Injectable({ providedIn: 'root' })
export class ArchiveRepository {
  listLeagues(options?: { force?: boolean }): Promise<ArchiveCatalogResult<ArchiveLeagueRow>>;
  listLeagueSeasons(options?: { force?: boolean }): Promise<ArchiveCatalogResult<ArchiveLeagueSeasonRow>>;
  /** Ascending by year. Served from the `meta` snapshot only while it carries today's UTC day. */
  listYears(options?: { force?: boolean }): Promise<ArchiveYearEntry[]>;
  /** Backfills every missing or stale year, then serves every cached partition plus local rows. */
  listTournaments(options?: { force?: boolean }): Promise<ArchiveCatalogResult<ArchiveTournamentRow>>;
  /** §8.1 read-through. Writes nothing, ever. */
  listSeasonTournaments(season: {
    id: string;
    firstTournamentDate: string | null;
    lastTournamentDate: string | null;
  }): Promise<ArchiveSeasonTournamentsResult>;
  /** The single funnel every archive mutation goes through. */
  invalidateArchiveCaches(): Promise<void>;
}
```

The generated client is consumed through a **narrow structural port declared in this file**, so no
generated type name — least of all the generic envelope's mangled name — is imported anywhere:

```ts
/** The runtime JSON, not the generated typing: NodaTime fields arrive as ISO strings. */
interface RawCatalog<T> { items: T[]; totalCount: number; truncated: boolean }
interface RawArchiveLeague { id: string; name: string; createdAt: unknown; updatedAt: unknown; documentVersion: number }
interface RawArchiveSeason {
  id: string; name: string; leagueId: string; status: string; updatedAt: unknown; documentVersion: number;
  tournamentCount: number; playerCount: number; firstTournamentDate?: unknown; lastTournamentDate?: unknown;
}
interface RawArchiveTournament {
  id: string; name: string; seasonId?: string | null; tournamentDate: unknown; status: string;
  updatedAt: unknown; documentVersion: number; playerCount: number;
}
interface RawArchiveYears { years: { year: number; locked: boolean; tournamentCount: number }[] }

/** Exactly the five archive reads this repository makes, and nothing else on `Client`. */
export interface ArchiveReadClient {
  getArchiveLeagueCatalog(): Observable<RawCatalog<RawArchiveLeague>>;
  getArchiveLeagueSeasonCatalog(): Observable<RawCatalog<RawArchiveSeason>>;
  getArchiveTournamentYearCatalog(year: string | undefined): Observable<RawCatalog<RawArchiveTournament>>;
  getArchiveYears(): Observable<RawArchiveYears>;
  getArchiveSeasonTournaments(seasonId: string): Observable<RawCatalog<RawArchiveTournament>>;
}
```

### Consumes

- `src/app/backend/indexed-db.ts` — `openDatabase`, `get`, `getAll`, `put`, `requestResult`,
  `runTransaction`, verbatim; no new wrapper is written and none of these is modified.
- `src/app/shared/catalog-cache.ts` — `CATALOG_TTL_MS` only. Neither `readCatalogEntry` nor
  `writeCatalogEntry` nor `clearCatalogEntry` may be imported by any file this ticket writes: they
  are `localStorage`, which is exactly what this ticket removes from the archive.
- `Client` from `src/app/api/generated/gones-api`, injected as `ArchiveReadClient`.
- T10, per the reconciliation table in `Inputs`.

### Errors

Nothing this ticket writes throws a new error type. Failure is expressed as degradation, and every
path is pinned:

| Path | Behaviour |
| --- | --- |
| `openDatabase` rejects (`indexedDbUnavailable`, `indexedDbBlocked`, `indexedDbOpenFailed`) | Every `ArchiveCacheService` read resolves `null`, every write resolves `undefined`, `clearAll()` resolves. The repository still serves server + local rows. |
| A cache read rejects mid-transaction | Swallowed → treated as a miss (`null` / `[]`). |
| A cache write rejects | Swallowed → resolves. The previous record stays; the next load refetches. |
| `ArchiveBackfillQueue` loader rejects for year Y | `{ year: Y, error }` in `report.failed`. **No record written for Y.** Y is removed from `pending`. `drain` does not reject. |
| The partition `put` rejects or the transaction aborts | Same as above. The store is unchanged, including any pre-existing record for Y. |
| `getArchiveLeagueCatalog` / `getArchiveLeagueSeasonCatalog` rejects, a cached record exists | Serve the cached record, `fromCache: false`, `stale: true`. |
| …rejects, no cached record, browser-local rows exist | Serve the local half alone, `stale: true`, `totalCount` = local count, `truncated: false`. |
| …rejects, no cached record, no local rows | **Rethrow the original rejection.** No empty-state lie (ADR 0031). |
| `getArchiveYears` rejects, a `meta` snapshot exists (any day) | Use its `years` with every `locked` forced to `false`, and do not run the queue. Results are `stale: true`. |
| `getArchiveYears` rejects, no snapshot | Serve every stored partition, `stale: true`. If there is no partition and no local Tournament, rethrow. |
| `getArchiveSeasonTournaments` rejects with `404` (unknown or soft-deleted Season) | Rethrown unchanged; the caller renders it. This ticket adds no not-found sentinel. |
| `getArchiveTournamentYearCatalog` answers `400 invalidRequest` | Impossible by construction: the repository only requests years returned by `GET /api/archive/years`, which are integers in `1..9999`. If it happens it is a loader rejection like any other. |

### Invariants

1. **Single writer.** `archive-backfill-queue.ts` is the only non-test file that calls
   `objectStore(CACHE_YEAR_PARTITION_STORE).put(...)`. `archive-cache.service.ts` names the store
   only to read it and to include it in the `clearAll()` purge. Asserted by a source scan over
   every non-test `.ts` file under `src/`.
2. **Atomic year.** A partition object is fully built — `year`, `completedAt`, `rowCount`, `items` —
   **before** the transaction opens, and written by a single `put` inside a single
   `runTransaction(..., ['year-partitions'], 'readwrite', ...)`. There is no read-modify-write, no
   second request in that transaction, and no code path that writes `completedAt` separately.
3. **Whole or absent.** `readYearPartition` and `readAllYearPartitions` drop any record whose
   `completedAt` is `undefined`, so even a record produced outside this code can never be served.
4. **The read-through never writes.** `listSeasonTournaments` reaches no writing method: not
   `writeLeagueCatalog`, not `writeSeasonCatalog`, not `writeYearsMeta`, not `queue.enqueue`, not
   `queue.drain`. Asserted with a fully recording stub.
5. **Public only.** A record in `gones-archive-cache` originates from a server response. Browser-local
   rows carry `isLocal: true`, are added after the cache is read, and the stored shapes
   (`ArchiveCatalogRecord<T>`, `ArchiveYearPartition`) have no `isLocal` field at all.
6. **One TTL.** `CATALOG_TTL_MS` is imported from `src/app/shared/catalog-cache.ts` and re-exported
   once. No file this ticket writes contains the literal `24 * 60 * 60 * 1000` or `86400000`.
7. **Freshness is total.** `classifyArchiveYear` returns exactly one of `'fresh' | 'stale' |
   'missing'` for every input, including `null`, a record with `completedAt: undefined` and a record
   with an unparsable `completedAt`.
8. **Ordering.** Cached Tournament rows are served `tournamentDate DESC, id ASC`, ids compared
   ordinally (`<` / `>` on the raw strings, never `localeCompare`), reproducing Postgres
   `COLLATE "C"`. Years are served ascending. League and Season catalogs keep the server's order and
   are never re-sorted; local rows are appended after the server rows.
9. **Nullability.** `seasonId`, `firstTournamentDate` and `lastTournamentDate` normalize `undefined`
   to `null`. `status` normalizes to `'completed'` when the wire says `completed` and to `'active'`
   otherwise. Every instant and date is coerced with `String(...)`.
10. **Idempotency.** `enqueue` deduplicates against `pending`. Two `listTournaments()` calls with a
    warm cache issue zero requests and return equal arrays. `invalidateArchiveCaches()` is safe to
    call twice; the second call clears empty stores and dispatches a second event.
11. **Units.** `completedAt`, `fetchedAt` and `updatedAt` are ISO 8601 UTC instants;
    `tournamentDate`, `firstTournamentDate`, `lastTournamentDate` and `utcDay` are `YYYY-MM-DD`;
    `year` is a proleptic ISO calendar year as a `number`; `rowCount` and `totalCount` are row counts,
    not byte sizes.
12. **`rowCount` is the uncapped count.** A truncated year is therefore visible as
    `items.length < rowCount` and needs no extra stored field — which is what keeps the stored shape
    exactly the four fields the plan froze.
13. **No `localStorage`.** None of the three new files contains `localStorage`, `sessionStorage`,
    `readCatalogEntry` or `writeCatalogEntry`.
14. **The repository stays off the IndexedDB allowlist.** `archive-repository.service.ts` contains no
    `indexedDB` token and no `IDB*` type name, so the allowlist assertion still passes with only the
    two backend files added.

## TDD

1. **Red — the storage contract.** Write `src/app/backend/archive-cache.service.test.ts` first, with
   the in-memory IndexedDB fake and the fifteen named tests of `Test plan`. Run
   `npx vitest run src/app/backend/archive-cache.service.test.ts` and watch it fail to resolve
   `./archive-cache.service`.
2. **Green.** Write `src/app/backend/archive-cache.service.ts` until those fifteen pass.
3. **Red — the single-writer contract.** Write `src/app/backend/archive-backfill-queue.test.ts`,
   including the two non-negotiable atomicity tests: `an aborted write leaves the previously stored
   partition unchanged` and `a rejected loader writes no record at all`. Run it and watch it fail.
4. **Green.** Write `src/app/backend/archive-backfill-queue.ts` until they pass.
5. **Red — the read paths.** Write `src/app/data/archive-repository.service.test.ts`, including
   `expanding an uncached Season fetches read-through and writes nothing to the cache`. Run it and
   watch it fail.
6. **Green.** Write `src/app/data/archive-repository.service.ts` until they pass.
7. **Red — the boundary.** Run `npx vitest run src/app/backend/server-authority-boundary.test.ts`:
   `confines IndexedDB to the sanctioned local adapters` now fails with the two new files listed as
   unexpected, and `keeps the public catalog cache helper to its declared importers` fails with
   `archive-cache.service.ts` as an unexpected importer. Then extend both allowlists and watch both
   go green — the failure is the proof the assertions still bind.
8. **Refactor** only while green. Assert behaviour — a stored record, a request that was or was not
   made, a store left untouched — never a private method name.

## Test plan

Run each file with `npx vitest run <path>`; the suite with `npm run test`.

### `src/app/backend/archive-cache.service.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `names the documented database, version, stores and keys` | the exported constants | `'gones-archive-cache'`, `1`, `['leagues','league-seasons','year-partitions','meta']`, `'catalog'`, `'years'` |
| `creates all four stores on first open` | `database()` on an empty fake | the fake's store map has exactly the four names |
| `a missing catalog row reads as null` | fresh database | `readLeagueCatalog()` → `null`, `readSeasonCatalog()` → `null`, `readYearsMeta()` → `null` |
| `a League catalog round-trips with its rows, count, truncation flag and fetch instant` | write `{ key:'catalog', items:[league('a')], totalCount: 7, truncated: true, fetchedAt: '2026-08-22T10:00:00.000Z' }` | `readLeagueCatalog()` deep-equals it |
| `the two catalog stores are independent` | write only the Season catalog | `readSeasonCatalog()` non-null, `readLeagueCatalog()` → `null` |
| `reads a year partition by its numeric year key` | store a complete 2026 partition | `readYearPartition(2026)` deep-equals it; `readYearPartition(2025)` → `null` |
| `treats a partition without completedAt as absent` | store `{ year: 2026, completedAt: undefined, rowCount: 0, items: [] }` | `readYearPartition(2026)` → `null` and `readAllYearPartitions()` → `[]` |
| `reads every complete partition in one call` | store 2024, 2025 complete and 2026 incomplete | `readAllYearPartitions()` has exactly the two years, in any order |
| `a years-index snapshot round-trips through the meta store` | write `{ key:'years', years:[{year:2026,locked:false,tournamentCount:3}], fetchedAt, utcDay:'2026-08-22' }` | `readYearsMeta()` deep-equals it |
| `clearAll empties every store in one transaction` | all four stores populated | after `clearAll()` every read is `null` / `[]`, and the fake counted exactly **one** readwrite transaction for the purge |
| `a failed read is a miss, never a throw` | fake `get` made to throw | `readLeagueCatalog()` resolves `null` |
| `a failed write resolves and leaves the previous row in place` | `failPutAt` armed on the second put | `writeLeagueCatalog(second)` resolves; `readLeagueCatalog()` still returns the first record |
| `an absent indexedDB makes every read a miss and every write a no-op` | `delete globalThis.indexedDB` | all four reads resolve `null`/`[]`, both writes and `clearAll()` resolve, nothing throws |
| `exposes no method that writes a single year partition` | `Object.getOwnPropertyNames(ArchiveCacheService.prototype).filter(n => /partition/i.test(n))` | `['readAllYearPartitions','readYearPartition']` |
| `never puts into the year-partition store` | the file's own source text | matches neither `/objectStore\(CACHE_YEAR_PARTITION_STORE\)\.put\(/` nor `/CACHE_YEAR_PARTITION_STORE\]\s*,\s*'readwrite'/` |
| `holds no localStorage and no second TTL` | the file's own source text | no `localStorage`, no `readCatalogEntry`, no `writeCatalogEntry`, no `24 * 60 * 60 * 1000`; `CATALOG_TTL_MS === 86_400_000` |
| `isArchiveCatalogFresh follows the 24h contract` | `fetchedAt` now / `-23h` / `-24h` / `'not-a-date'` | `true`, `true`, `false`, `false` |
| `utcDayKey formats the UTC day` | `Date.parse('2026-08-22T23:30:00Z')` | `'2026-08-22'` |

### `src/app/backend/archive-backfill-queue.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `classifies an absent partition as missing` | `null`, `{year:2026,locked:false,tournamentCount:1}` | `'missing'` |
| `classifies a partition without completedAt as missing` | `{year:2026,completedAt:undefined,…}` | `'missing'` |
| `classifies a locked year as fresh whatever its age` | `completedAt` 400 days old, `locked: true` | `'fresh'` |
| `classifies an unlocked year under 24h as fresh` | `completedAt` = now − 23 h, `locked: false` | `'fresh'` |
| `classifies an unlocked year at exactly 24h as stale` | `completedAt` = now − `CATALOG_TTL_MS`, `locked: false` | `'stale'` |
| `classifies an unparsable completedAt as stale when unlocked and fresh when locked` | `completedAt: 'soon'` | `'stale'` then `'fresh'` |
| `writes a partition stamped completedAt in one transaction` | `enqueue([2026])`, loader → 2 items / `totalCount: 2` | stored record `{ year: 2026, completedAt: <ISO>, rowCount: 2, items: [...] }`; the fake counted exactly **one** readwrite transaction |
| `records the uncapped totalCount so truncation is visible` | loader → 3 items, `totalCount: 25001`, `truncated: true` | stored `rowCount === 25001`, `items.length === 3` |
| **`an aborted write leaves the previously stored partition unchanged`** | store 2026 with `rowCount: 2`; arm `failPutAt` on the next put; `enqueue([2026])` + `drain` | `readYearPartition(2026)` still deep-equals the **first** record; `report.failed` = `[{ year: 2026, … }]`; `report.written` = `[]`; `drain` did not reject |
| **`a rejected loader writes no record at all`** | empty store, loader rejects `new Error('offline')` | `readYearPartition(2026)` → `null`; `readAllYearPartitions()` → `[]`; `report.failed[0].error.message === 'offline'` |
| `a failed year does not stop the run` | `enqueue([2024, 2025])`, loader rejects for 2024 and resolves for 2025 | `written` = `[2025]`, `failed` = `[{year:2024,…}]`, 2025 stored |
| `drains in enqueue order, one year at a time` | `enqueue([2026, 2024, 2025])`, loader records call order and asserts no overlap | loader called `[2026, 2024, 2025]`; never two in flight |
| `deduplicates a year already queued` | `enqueue([2026]); enqueue([2026, 2027])` | `pending()` = `[2026, 2027]`; the loader sees 2026 once |
| `a year enqueued during a drain is processed by that drain` | loader for 2026 calls `enqueue([2027])` | one `drain` promise, `written` = `[2026, 2027]` |
| `a second drain while one is running joins the first` | two `drain(loaderA)` / `drain(loaderB)` without awaiting | the same report instance resolves both; `loaderB` never called; `running()` was `true` between |
| `pending and running track the queue` | before / during / after | `pending()` `[2026]` → `[]`, `running()` `false` → `true` → `false` |
| `is the only file that writes the year-partition store` | scan every non-test `.ts` under `src/` for `CACHE_YEAR_PARTITION_STORE` | exactly `['src/app/backend/archive-backfill-queue.ts','src/app/backend/archive-cache.service.ts']`, and only this file matches `/objectStore\(CACHE_YEAR_PARTITION_STORE\)\.put\(/` |

### `src/app/data/archive-repository.service.test.ts`

Built on a recording `ArchiveCacheService` stub (`vi.fn()` per method), a recording
`ArchiveBackfillQueue` stub, a `Client` stub of the five reads, and a `LocalArchiveBackend` stub of
the three list reads.

| Test | Input | Expect |
| ---- | ----- | ------ |
| `serves the League catalog from IndexedDB while it is under 24h old` | cached record `fetchedAt` = now − 1 h | `getArchiveLeagueCatalog` never called; `fromCache: true`, `stale: false` |
| `refetches the League catalog past 24h and rewrites the record` | cached record 25 h old | client called once; `writeLeagueCatalog` called with the fresh rows and a new `fetchedAt`; `fromCache: false` |
| `force ignores a fresh record` | fresh record, `{ force: true }` | client called once, `writeLeagueCatalog` called |
| `normalizes the wire shape` | server row with `updatedAt` as an object, `seasonId` absent, `status: 'completed'`, `firstTournamentDate: undefined` | stored/returned row has `String(updatedAt)`, `seasonId: null`, `status: 'completed'`, `firstTournamentDate: null` |
| `merges browser-local Leagues and flags them` | 1 server League, 1 local League | items length 2, local row `isLocal: true`, server row `isLocal: false`, `totalCount` = server `totalCount` + 1 |
| `never writes a browser-local row into the cache` | as above | the record passed to `writeLeagueCatalog` contains only the server row and no `isLocal` key |
| `derives local Season counters from the local Tournaments` | local Season `s1`, two local Tournaments on `s1` dated `2026-03-01` and `2026-05-04`, 3 distinct players | row `tournamentCount: 2`, `playerCount: 3`, `firstTournamentDate: '2026-03-01'`, `lastTournamentDate: '2026-05-04'` |
| `a rejected catalog read with a cached record serves it as stale` | client rejects, record exists | items from the record, `stale: true`, `fromCache: false` |
| `a rejected catalog read with no record but local rows serves the local half as stale` | client rejects, no record, 1 local row | items = the local row, `stale: true`, `truncated: false` |
| `a rejected catalog read with no record and no local rows rethrows` | client rejects, nothing anywhere | rejects with the original error |
| `the Season catalog obeys the same four rules` | fresh / stale / force / rejected | same four outcomes through `listLeagueSeasons` |
| `caches the years index for the current UTC day only` | two `listYears()` calls same day | `getArchiveYears` called once; `writeYearsMeta` called once with `utcDay` = today |
| `refetches the years index after the UTC day rolls over` | snapshot `utcDay` = yesterday | `getArchiveYears` called; the snapshot is not served |
| `falls back to the snapshot with locked forced false when the years index rejects` | client rejects, snapshot with `locked: true` | returned entries carry `locked: false`; `queue.drain` never called |
| `listTournaments enqueues every missing or stale year and drains once` | years `[2024 locked, 2025 unlocked, 2026 unlocked]`, 2024 cached complete, 2025 cached 30 h old, 2026 uncached | `enqueue` called with `[2025, 2026]`; `drain` called once |
| `listTournaments orders rows by date desc then id ordinal asc` | partitions with `2026-01-02/id-b`, `2026-01-02/id-a`, `2025-12-31/id-c` | `['id-a','id-b','id-c']` — same date sorts by ordinal id ascending |
| `listTournaments reports the oldest partition instant as fetchedAt` | partitions stamped `10:00Z` and `12:00Z` | `fetchedAt === '…10:00…'` |
| `listTournaments marks the result stale when a year failed` | `drain` report with one failure | `stale: true` |
| `listTournaments appends browser-local Tournaments` | 1 local Tournament | present with `isLocal: true`, counted in `totalCount` |
| **`expanding a Season whose years are all cached, complete and locked serves from IndexedDB`** | Season `2024-02-01 → 2024-11-30`, year 2024 locked and cached with 3 rows (2 on this Season) | `getArchiveSeasonTournaments` never called; 2 items, ordered; `fromCache: true` |
| **`expanding an uncached Season fetches read-through and writes nothing`** | Season `2026-01-05 → 2026-06-06`, no partition | `getArchiveSeasonTournaments` called once with the Season id; `fromCache: false`; **every** cache write method and both queue methods report zero calls |
| `expanding a Season whose year is unlocked fetches read-through` | year 2026 cached, complete, `locked: false` | client called; nothing written |
| `expanding a Season spanning a cached and an uncached year fetches read-through` | 2024 cached+locked, 2025 absent | client called once |
| `expanding a Season with no tournament dates returns an empty list with no request` | `firstTournamentDate: null` | `items: []`, `fromCache: true`, client never called |
| `expanding a browser-local Season reads the local store, never the network` | Season id `local-abc` | client never called; items are the local Tournaments of that Season, `isLocal: true`, `fromCache: true` |
| `a 404 from the read-through propagates unchanged` | client rejects `{ status: 404 }` | rejects with that object |
| `invalidateArchiveCaches clears every store then dispatches gones-archive-updated` | listener on `window` | `clearAll` called once; the event fired exactly once, `type === 'gones-archive-updated'`, and it fired **after** `clearAll` resolved |
| `archiveYearRange spans both bounds inclusively` | `('2024-12-31','2026-01-01')` / `(null,'2026-01-01')` / `('2026-01-01','2024-01-01')` | `[2024,2025,2026]` / `[]` / `[]` |
| `names no IndexedDB symbol` | the file's own source text | matches neither `/\bindexedDB\b/` nor `/\bIDB[A-Z]\w*/` |

### `src/app/backend/server-authority-boundary.test.ts` (extended, not rewritten)

| Test | Expect |
| ---- | ------ |
| `confines IndexedDB to the sanctioned local adapters` | the array gains `'src/app/backend/archive-backfill-queue.ts'` and `'src/app/backend/archive-cache.service.ts'`, sorted first, and still passes |
| `keeps the public catalog cache helper to its declared importers` | the array gains `'src/app/backend/archive-cache.service.ts'`, sorted first, and still passes |

## Impl steps

- [ ] 1. Stand up the storage test with its in-memory IndexedDB fake (**red**)
  - [ ] 1.1 Create `src/app/backend/archive-cache.service.test.ts` and paste this **FAKE-IDB block**
        at the top, verbatim. It is the fake from
        `src/app/backend/local-league-archive-backend.service.test.ts:14-165`, extended with
        `clear()` and with string-normalized keys so a numeric `year` key resolves:

        ```ts
        import '@angular/compiler';
        import { readFileSync } from 'node:fs';
        import { dirname, join } from 'node:path';
        import { fileURLToPath } from 'node:url';
        import { afterEach, beforeEach, describe, expect, it } from 'vitest';

        /**
         * `fake-indexeddb` is not a dependency and this ticket adds none, so the IndexedDB surface the
         * cache uses is stubbed in-memory here — the same fake `local-league-archive-backend.service.test.ts`
         * uses, plus `clear()` and string-normalized keys, because the year store is keyed by a number.
         */
        interface FakeStore { keyPath: string; rows: Map<string, unknown> }
        interface FakeDatabaseState { version: number; stores: Map<string, FakeStore> }

        const databases = new Map<string, FakeDatabaseState>();
        let failPutAt: number | null = null;
        let putCount = 0;
        let readwriteTransactionCount = 0;

        function clone<T>(value: T): T {
          return typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
        }

        class FakeRequest<T> {
          result!: T;
          error: DOMException | null = null;
          onsuccess: (() => void) | null = null;
          onerror: (() => void) | null = null;
          onupgradeneeded: (() => void) | null = null;
          onblocked: (() => void) | null = null;
        }

        class FakeObjectStore {
          constructor(private readonly store: FakeStore, private readonly transaction: FakeTransaction) {}

          getAll(): FakeRequest<unknown[]> {
            return this.transaction.enqueue(() => [...this.store.rows.values()].map((row) => clone(row)));
          }

          get(key: unknown): FakeRequest<unknown> {
            const row = this.store.rows.get(String(key));
            return this.transaction.enqueue(() => (row === undefined ? undefined : clone(row)));
          }

          put(value: Record<string, unknown>): FakeRequest<string> {
            return this.transaction.enqueue(() => {
              putCount += 1;
              if (putCount === failPutAt) throw new DOMException('Injected put failure', 'ConstraintError');
              const key = String(value[this.store.keyPath]);
              this.store.rows.set(key, clone(value));
              return key;
            });
          }

          delete(key: unknown): FakeRequest<undefined> {
            return this.transaction.enqueue(() => { this.store.rows.delete(String(key)); return undefined; });
          }

          clear(): FakeRequest<undefined> {
            return this.transaction.enqueue(() => { this.store.rows.clear(); return undefined; });
          }
        }

        class FakeTransaction {
          error: DOMException | null = null;
          oncomplete: (() => void) | null = null;
          onerror: (() => void) | null = null;
          onabort: (() => void) | null = null;
          private pending = 0;
          private failed = false;
          private settled = false;
          private readonly snapshot: Map<string, Map<string, unknown>>;

          constructor(private readonly state: FakeDatabaseState, readonly mode: string) {
            this.snapshot = new Map([...state.stores].map(([name, store]) => [name, new Map([...store.rows].map(([key, value]) => [key, clone(value)]))]));
          }

          abort(): void { this.failed = true; queueMicrotask(() => this.settle(true)); }

          objectStore(name: string): FakeObjectStore {
            const store = this.state.stores.get(name);
            if (!store) throw new Error(`NotFoundError: object store ${name}`);
            return new FakeObjectStore(store, this);
          }

          enqueue<T>(run: () => T): FakeRequest<T> {
            const request = new FakeRequest<T>();
            this.pending += 1;
            queueMicrotask(() => {
              this.pending -= 1;
              try { request.result = run(); request.onsuccess?.(); }
              catch (error) { this.failed = true; request.error = error as DOMException; request.onerror?.(); }
              if (this.pending === 0) setTimeout(() => this.settle(), 0);
            });
            return request;
          }

          private settle(aborted = false): void {
            if (this.settled) return;
            this.settled = true;
            if (this.failed) {
              for (const [name, rows] of this.snapshot) {
                const store = this.state.stores.get(name);
                if (store) store.rows = new Map(rows);
              }
              if (aborted) this.onabort?.(); else this.onerror?.();
            } else this.oncomplete?.();
          }
        }

        class FakeDatabase {
          readonly objectStoreNames: { contains: (name: string) => boolean };

          constructor(private readonly state: FakeDatabaseState) {
            this.objectStoreNames = { contains: (name: string) => this.state.stores.has(name) };
          }

          createObjectStore(name: string, options: { keyPath: string }): void {
            this.state.stores.set(name, { keyPath: options.keyPath, rows: new Map() });
          }

          transaction(_names: string[], mode: string): FakeTransaction {
            if (mode === 'readwrite') readwriteTransactionCount += 1;
            return new FakeTransaction(this.state, mode);
          }

          close(): void {}
        }

        const fakeIndexedDb = {
          open(name: string, version: number): FakeRequest<FakeDatabase> {
            const request = new FakeRequest<FakeDatabase>();
            queueMicrotask(() => {
              const existing = databases.get(name);
              const state = existing ?? { version: 0, stores: new Map<string, FakeStore>() };
              if (!existing) databases.set(name, state);
              const upgradeNeeded = state.version < version;
              request.result = new FakeDatabase(state);
              if (upgradeNeeded) { state.version = version; request.onupgradeneeded?.(); }
              queueMicrotask(() => request.onsuccess?.());
            });
            return request;
          }
        };

        const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

        function installFakeIndexedDb(): void {
          Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDb as unknown as IDBFactory, configurable: true, writable: true });
        }

        beforeEach(() => {
          databases.clear();
          failPutAt = null;
          putCount = 0;
          readwriteTransactionCount = 0;
          installFakeIndexedDb();
        });

        afterEach(() => {
          if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
          else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'indexedDB');
        });
        ```
  - [ ] 1.2 Below the block, import the subject:
        `import { ARCHIVE_CACHE_DB_NAME, ARCHIVE_CACHE_DB_VERSION, ARCHIVE_CACHE_STORES, ARCHIVE_CATALOG_KEY, ARCHIVE_YEARS_META_KEY, ArchiveCacheService, ArchiveLeagueSummary, ArchiveYearPartition, CACHE_LEAGUE_STORE, CACHE_META_STORE, CACHE_SEASON_STORE, CACHE_YEAR_PARTITION_STORE, CATALOG_TTL_MS, isArchiveCatalogFresh, utcDayKey } from './archive-cache.service';`
  - [ ] 1.3 Add the fixture helpers:
        ```ts
        const league = (id: string): ArchiveLeagueSummary =>
          ({ id, name: `League ${id}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', documentVersion: 1 });
        const partition = (year: number, rowCount = 0, completedAt: string | undefined = '2026-08-22T10:00:00.000Z'): ArchiveYearPartition =>
          ({ year, completedAt, rowCount, items: [] });
        const cacheSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'archive-cache.service.ts'), 'utf8');
        ```
  - [ ] 1.4 Write every row of the `archive-cache.service.test.ts` table in `Test plan` as an `it(...)`
        with that exact name. For the incomplete-partition and injected-failure cases, seed the store
        through the fake directly (`databases.get(ARCHIVE_CACHE_DB_NAME)`) so the test never depends
        on a writer the service is forbidden to have.
  - [ ] 1.5 Run `npx vitest run src/app/backend/archive-cache.service.test.ts` and confirm it fails on
        the missing module.

- [ ] 2. Implement `src/app/backend/archive-cache.service.ts` (**green**)
  - [ ] 2.1 Create the file with the header, the imports and the constants:
        ```ts
        import { Injectable } from '@angular/core';
        import { CATALOG_TTL_MS } from '../shared/catalog-cache';
        import { get, getAll, openDatabase, put, requestResult, runTransaction } from './indexed-db';

        /**
         * The public archive catalog cache (ADR 0039's TTL contract, moved off `localStorage`).
         *
         * A10 of the archive plan: an authority and a cache never share a database, because "purge the
         * cache" must not be able to delete user-authored records. The browser-authored archive lives in
         * `gones-archive-local`; everything here is a copy of a public server answer and may be dropped
         * at any moment without losing anything.
         *
         * This class deliberately owns **no** way to write a single year partition. Only
         * `archive-backfill-queue.ts` does, so a year is written and stamped in one transaction and can
         * never be observed half-filled. The one writable path here is `clearAll()`, a wholesale purge —
         * dropping every year keeps the whole-or-absent rule, dropping part of one would break it.
         *
         * Every read swallows its own failure: a database that is disabled, blocked or holding a
         * half-written value is a cache miss, never an error a page has to render.
         */
        export const ARCHIVE_CACHE_DB_NAME = 'gones-archive-cache';
        export const ARCHIVE_CACHE_DB_VERSION = 1;
        export const CACHE_LEAGUE_STORE = 'leagues';
        export const CACHE_SEASON_STORE = 'league-seasons';
        export const CACHE_YEAR_PARTITION_STORE = 'year-partitions';
        export const CACHE_META_STORE = 'meta';
        export const ARCHIVE_CACHE_STORES = [CACHE_LEAGUE_STORE, CACHE_SEASON_STORE, CACHE_YEAR_PARTITION_STORE, CACHE_META_STORE] as const;
        export const ARCHIVE_CATALOG_KEY = 'catalog';
        export const ARCHIVE_YEARS_META_KEY = 'years';

        /** One TTL for the whole app (ADR 0039). Re-exported so nothing downstream redefines 24 hours. */
        export { CATALOG_TTL_MS };
        ```
  - [ ] 2.2 Append the record types exactly as `Interface contract → Produces —
        src/app/backend/archive-cache.service.ts` declares them: `ArchiveRowStatus`,
        `ArchiveLeagueSummary`, `ArchiveLeagueSeasonSummary`, `ArchiveTournamentSummary`,
        `ArchiveYearEntry`, `ArchiveCatalogRecord<T>`, `ArchiveYearPartition`,
        `ArchiveYearsMetaRecord`, comments included.
  - [ ] 2.3 **Reconciliation check.** Open `src/app/domain/archive-models.ts`. If it already exports
        an `ArchiveTournamentSummary` (or any other of the five row types) with the identical field
        list, delete the local declaration of that type and re-export instead —
        `export type { ArchiveTournamentSummary } from '../domain/archive-models';` — so the app has
        one definition. If it does not, keep the local one. Change no field either way.
  - [ ] 2.4 Append the two pure helpers:
        ```ts
        /** An instant that will not parse is stale, so a corrupt record cannot pin a page to old data. */
        export function isArchiveCatalogFresh(record: ArchiveCatalogRecord<unknown>, now = Date.now()): boolean {
          const fetchedAt = Date.parse(record.fetchedAt);
          return Number.isFinite(fetchedAt) && now - fetchedAt < CATALOG_TTL_MS;
        }

        /** The UTC day, `YYYY-MM-DD`. The years index is only valid for the day it was fetched. */
        export function utcDayKey(now = Date.now()): string {
          return new Date(now).toISOString().slice(0, 10);
        }
        ```
  - [ ] 2.5 Append the service, with the memoised handle and the guarded upgrade:
        ```ts
        @Injectable({ providedIn: 'root' })
        export class ArchiveCacheService {
          private handle?: Promise<IDBDatabase>;

          database(): Promise<IDBDatabase> {
            this.handle ??= openDatabase(ARCHIVE_CACHE_DB_NAME, ARCHIVE_CACHE_DB_VERSION, (database) => {
              for (const store of ARCHIVE_CACHE_STORES) {
                if (database.objectStoreNames.contains(store)) continue;
                database.createObjectStore(store, { keyPath: store === CACHE_YEAR_PARTITION_STORE ? 'year' : 'key' });
              }
            });
            return this.handle;
          }
        ```
  - [ ] 2.6 Add the four catalog/meta accessors, each one line over the private helpers of 2.8:
        ```ts
          readLeagueCatalog(): Promise<ArchiveCatalogRecord<ArchiveLeagueSummary> | null> {
            return this.readOne<ArchiveCatalogRecord<ArchiveLeagueSummary>>(CACHE_LEAGUE_STORE, ARCHIVE_CATALOG_KEY);
          }

          writeLeagueCatalog(record: ArchiveCatalogRecord<ArchiveLeagueSummary>): Promise<void> {
            return this.writeOne(CACHE_LEAGUE_STORE, record);
          }

          readSeasonCatalog(): Promise<ArchiveCatalogRecord<ArchiveLeagueSeasonSummary> | null> {
            return this.readOne<ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>>(CACHE_SEASON_STORE, ARCHIVE_CATALOG_KEY);
          }

          writeSeasonCatalog(record: ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>): Promise<void> {
            return this.writeOne(CACHE_SEASON_STORE, record);
          }

          readYearsMeta(): Promise<ArchiveYearsMetaRecord | null> {
            return this.readOne<ArchiveYearsMetaRecord>(CACHE_META_STORE, ARCHIVE_YEARS_META_KEY);
          }

          writeYearsMeta(record: ArchiveYearsMetaRecord): Promise<void> {
            return this.writeOne(CACHE_META_STORE, record);
          }
        ```
  - [ ] 2.7 Add the two partition **readers** and the purge. Note the completeness filter — it is what
        makes a foreign half-record unservable:
        ```ts
          /** `null` unless the record exists AND carries `completedAt`: a year is whole or it is absent. */
          async readYearPartition(year: number): Promise<ArchiveYearPartition | null> {
            const stored = await this.readOne<ArchiveYearPartition>(CACHE_YEAR_PARTITION_STORE, year);
            return stored?.completedAt ? stored : null;
          }

          async readAllYearPartitions(): Promise<ArchiveYearPartition[]> {
            try {
              const rows = await getAll<ArchiveYearPartition>(await this.database(), CACHE_YEAR_PARTITION_STORE);
              return rows.filter((row) => Boolean(row?.completedAt));
            } catch {
              return [];
            }
          }

          /**
           * Drops every cached catalog in one transaction. Wholesale is the point: a partial purge of the
           * year store would leave a year present but wrong, and only the queue may decide a year's
           * contents.
           */
          async clearAll(): Promise<void> {
            try {
              const database = await this.database();
              await runTransaction(database, [...ARCHIVE_CACHE_STORES], 'readwrite', async (transaction) => {
                await Promise.all(ARCHIVE_CACHE_STORES.map((store) => requestResult(transaction.objectStore(store).clear())));
              });
            } catch {
              // A cache that cannot be dropped expires on its own; the next load overwrites it.
            }
          }
        ```
  - [ ] 2.8 Close the class with the two private helpers — named without the word "partition" so the
        prototype assertion of 1.4 stays exact:
        ```ts
          private async readOne<T>(store: string, key: IDBValidKey): Promise<T | null> {
            try {
              return await get<T>(await this.database(), store, key);
            } catch {
              return null;
            }
          }

          private async writeOne(store: string, value: unknown): Promise<void> {
            try {
              await put(await this.database(), store, value);
            } catch {
              // Cache failure must not hide fresh public data.
            }
          }
        }
        ```
  - [ ] 2.9 Run `npx vitest run src/app/backend/archive-cache.service.test.ts` until green.

- [ ] 3. Stand up the single-writer test (**red**)
  - [ ] 3.1 Create `src/app/backend/archive-backfill-queue.test.ts` and paste the same **FAKE-IDB
        block** from 1.1 verbatim, plus `import { readdirSync } from 'node:fs';` and
        `import { relative } from 'node:path';` for the repo scan.
  - [ ] 3.2 Import the subjects:
        `import { ARCHIVE_CACHE_DB_NAME, ArchiveCacheService, ArchiveYearEntry, ArchiveYearPartition, ArchiveTournamentSummary, CACHE_YEAR_PARTITION_STORE, CATALOG_TTL_MS } from './archive-cache.service';`
        and
        `import { ArchiveBackfillQueue, ArchiveYearPage, classifyArchiveYear, isArchiveYearPartitionComplete } from './archive-backfill-queue';`
  - [ ] 3.3 Add the builders:
        ```ts
        const row = (id: string, tournamentDate: string): ArchiveTournamentSummary =>
          ({ id, name: id, seasonId: null, tournamentDate, status: 'completed', updatedAt: '2026-08-01T00:00:00.000Z', documentVersion: 1, playerCount: 4 });
        const page = (items: ArchiveTournamentSummary[], totalCount = items.length, truncated = false): ArchiveYearPage => ({ items, totalCount, truncated });
        const entry = (year: number, locked: boolean): ArchiveYearEntry => ({ year, locked, tournamentCount: 1 });
        const build = (): { queue: ArchiveBackfillQueue; cache: ArchiveCacheService } => {
          const cache = new ArchiveCacheService();
          return { cache, queue: new ArchiveBackfillQueue(cache) };
        };
        ```
        If `ArchiveBackfillQueue` ends up constructed through `inject()` rather than a constructor
        parameter, build it with
        `Injector.create({ providers: [ArchiveBackfillQueue, { provide: ArchiveCacheService, useValue: cache }] }).get(ArchiveBackfillQueue)` instead — pick one in step 4.1 and keep it.
  - [ ] 3.4 Write every row of the `archive-backfill-queue.test.ts` table as an `it(...)` with that
        exact name. For `an aborted write leaves the previously stored partition unchanged`, seed the
        first partition through a first successful `drain`, then set `failPutAt = putCount + 1` before
        the second `drain`, and assert with `readYearPartition(2026)` **and** with the raw fake row.
  - [ ] 3.5 Write the single-writer scan as its own `it`:
        ```ts
        function sourceFiles(directory: string): string[] {
          return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
            const path = join(directory, item.name);
            if (item.isDirectory()) return sourceFiles(path);
            return item.isFile() && item.name.endsWith('.ts') && !item.name.endsWith('.test.ts') ? [path] : [];
          });
        }
        ```
        then assert the set of files whose text matches `/CACHE_YEAR_PARTITION_STORE/` equals
        `['src/app/backend/archive-backfill-queue.ts', 'src/app/backend/archive-cache.service.ts']`
        and that only this file matches `/objectStore\(CACHE_YEAR_PARTITION_STORE\)\.put\(/`.
  - [ ] 3.6 Run `npx vitest run src/app/backend/archive-backfill-queue.test.ts` and confirm it fails on
        the missing module.

- [ ] 4. Implement `src/app/backend/archive-backfill-queue.ts` (**green**)
  - [ ] 4.1 Create the file with the header and the freshness rules:
        ```ts
        import { Injectable, computed, inject, signal } from '@angular/core';
        import {
          ArchiveCacheService, ArchiveTournamentSummary, ArchiveYearEntry, ArchiveYearPartition,
          CACHE_YEAR_PARTITION_STORE, CATALOG_TTL_MS
        } from './archive-cache.service';
        import { requestResult, runTransaction } from './indexed-db';

        /**
         * The **only** writer of the `year-partitions` store.
         *
         * The Tournament table cannot be fetched in one body — the measured peak is about 17,500
         * Tournaments in a single year — so it is cached one calendar year per record, and this queue
         * fills those records one at a time. Everything here exists to keep one rule true: a year is
         * atomically whole or absent. The partition is built with its `completedAt` stamp already set
         * and written by a single `put` inside a single transaction, so a browser killed mid-backfill
         * leaves no record rather than a half one, and a reader never has to ask whether a year it can
         * see is finished.
         */
        export interface ArchiveYearPage { items: ArchiveTournamentSummary[]; totalCount: number; truncated: boolean }
        export type ArchiveYearLoader = (year: number) => Promise<ArchiveYearPage>;
        export type ArchiveYearFreshness = 'fresh' | 'stale' | 'missing';
        export interface ArchiveBackfillFailure { year: number; error: unknown }
        export interface ArchiveBackfillReport { written: number[]; failed: ArchiveBackfillFailure[] }

        /** Complete means stamped. An unstamped record is not a year, it is debris. */
        export function isArchiveYearPartitionComplete(partition: ArchiveYearPartition | null | undefined): partition is ArchiveYearPartition {
          return Boolean(partition && partition.completedAt);
        }

        /**
         * Freshness of one cached year.
         *
         * A locked year can never change again, so it is served whatever its age — that is the whole
         * reason the years index puts `locked` on the wire. An unlocked year obeys the one 24h TTL of
         * ADR 0039, and an instant that will not parse counts as expired, so a corrupt stamp cannot pin
         * a page to old data forever.
         */
        export function classifyArchiveYear(
          partition: ArchiveYearPartition | null | undefined,
          entry: ArchiveYearEntry,
          now = Date.now()
        ): ArchiveYearFreshness {
          if (!isArchiveYearPartitionComplete(partition)) return 'missing';
          if (entry.locked) return 'fresh';
          const completedAt = Date.parse(partition.completedAt!);
          return Number.isFinite(completedAt) && now - completedAt < CATALOG_TTL_MS ? 'fresh' : 'stale';
        }
        ```
  - [ ] 4.2 Add the class with its queue state:
        ```ts
        @Injectable({ providedIn: 'root' })
        export class ArchiveBackfillQueue {
          private readonly cache = inject(ArchiveCacheService);
          private readonly queued = signal<readonly number[]>([]);
          private inFlight?: Promise<ArchiveBackfillReport>;

          readonly pending = computed(() => this.queued());
          readonly running = signal(false);

          /** Appends the years not already waiting. Enqueueing never starts work. */
          enqueue(years: readonly number[]): void {
            const current = this.queued();
            const added = years.filter((year) => Number.isInteger(year) && !current.includes(year));
            if (added.length === 0) return;
            this.queued.set([...current, ...added]);
          }
        ```
        If step 3.3 chose the constructor form, replace `inject(ArchiveCacheService)` with a
        `constructor(private readonly cache: ArchiveCacheService) {}` — keep one form, not both.
  - [ ] 4.3 Add `drain`, single-flight and sequential:
        ```ts
          /**
           * One drain at a time, one year at a time. A second caller joins the run in flight instead of
           * starting a second writer — "single writer" is not a comment, it is this branch.
           */
          drain(loader: ArchiveYearLoader): Promise<ArchiveBackfillReport> {
            this.inFlight ??= this.run(loader).finally(() => {
              this.inFlight = undefined;
              this.running.set(false);
            });
            return this.inFlight;
          }

          private async run(loader: ArchiveYearLoader): Promise<ArchiveBackfillReport> {
            this.running.set(true);
            const report: ArchiveBackfillReport = { written: [], failed: [] };
            for (let next = this.take(); next !== undefined; next = this.take()) {
              try {
                await this.store(next, await loader(next));
                report.written.push(next);
              } catch (error) {
                report.failed.push({ year: next, error });
              }
            }
            return report;
          }

          /** Shifts the head off the queue, so a year enqueued mid-run is picked up by this run. */
          private take(): number | undefined {
            const [head, ...rest] = this.queued();
            if (head === undefined) return undefined;
            this.queued.set(rest);
            return head;
          }
        ```
  - [ ] 4.4 Add the atomic write. **Do not split it, do not read before writing, do not stamp
        `completedAt` in a second step:**
        ```ts
          /**
           * The atomic unit of this whole cache: the record is complete in memory before the transaction
           * opens, so the only two outcomes are a committed whole year and no change at all. A rejected
           * `put` rolls the transaction back and `runTransaction` rejects, which lands the year in
           * `report.failed` with nothing written.
           */
          private async store(year: number, page: ArchiveYearPage): Promise<void> {
            const partition: ArchiveYearPartition = {
              year,
              completedAt: new Date().toISOString(),
              // The server's uncapped count, so a truncated year is visible as items.length < rowCount.
              rowCount: page.totalCount,
              items: page.items
            };
            const database = await this.cache.database();
            await runTransaction(database, [CACHE_YEAR_PARTITION_STORE], 'readwrite', async (transaction) => {
              await requestResult(transaction.objectStore(CACHE_YEAR_PARTITION_STORE).put(partition));
            });
          }
        }
        ```
  - [ ] 4.5 Run `npx vitest run src/app/backend/archive-backfill-queue.test.ts` until green, the two
        atomicity tests included.

- [ ] 5. Stand up the repository test (**red**)
  - [ ] 5.1 Create `src/app/data/archive-repository.service.test.ts`. It uses **no** IndexedDB fake:
        the storage rules are proven in steps 1–4, and here the point is which collaborator was
        called and which was not.
        ```ts
        import '@angular/compiler';
        import { readFileSync } from 'node:fs';
        import { dirname, join } from 'node:path';
        import { fileURLToPath } from 'node:url';
        import { Injector } from '@angular/core';
        import { of, throwError } from 'rxjs';
        import { beforeEach, describe, expect, it, vi } from 'vitest';
        import { Client } from '../api/generated/gones-api';
        import { ArchiveBackfillQueue } from '../backend/archive-backfill-queue';
        import { ArchiveCacheService } from '../backend/archive-cache.service';
        import { LocalArchiveBackend } from '../backend/local-archive-backend.service';
        import { ARCHIVE_UPDATED_EVENT, ArchiveRepository, archiveYearRange } from './archive-repository.service';
        ```
  - [ ] 5.2 Add the recording stubs. Every write method is a `vi.fn()` so "wrote nothing" is one
        assertion:
        ```ts
        function cacheStub(overrides: Partial<Record<keyof ArchiveCacheService, unknown>> = {}) {
          return {
            database: vi.fn(async () => { throw new Error('indexedDbUnavailable'); }),
            readLeagueCatalog: vi.fn(async () => null),
            writeLeagueCatalog: vi.fn(async () => undefined),
            readSeasonCatalog: vi.fn(async () => null),
            writeSeasonCatalog: vi.fn(async () => undefined),
            readYearPartition: vi.fn(async () => null),
            readAllYearPartitions: vi.fn(async () => []),
            readYearsMeta: vi.fn(async () => null),
            writeYearsMeta: vi.fn(async () => undefined),
            clearAll: vi.fn(async () => undefined),
            ...overrides
          };
        }

        function queueStub() {
          return { enqueue: vi.fn(), drain: vi.fn(async () => ({ written: [], failed: [] })), pending: () => [], running: () => false };
        }

        function build(parts: { cache?: ReturnType<typeof cacheStub>; queue?: ReturnType<typeof queueStub>; client?: object; local?: object }) {
          const cache = parts.cache ?? cacheStub();
          const queue = parts.queue ?? queueStub();
          const local = parts.local ?? { listLeagues: async () => [], listLeagueSeasons: async () => [], listTournaments: async () => [] };
          const injector = Injector.create({ providers: [
            ArchiveRepository,
            { provide: ArchiveCacheService, useValue: cache },
            { provide: ArchiveBackfillQueue, useValue: queue },
            { provide: LocalArchiveBackend, useValue: local },
            { provide: Client, useValue: parts.client ?? {} }
          ] });
          return { repo: injector.get(ArchiveRepository), cache, queue };
        }
        ```
        The `useValue` stubs are structural, so a missing method surfaces as a failing test rather
        than a type error.
  - [ ] 5.3 Write every row of the `archive-repository.service.test.ts` table as an `it(...)` with
        that exact name. For the two bolded read-through tests assert, in one block:
        ```ts
        expect(cache.writeLeagueCatalog).not.toHaveBeenCalled();
        expect(cache.writeSeasonCatalog).not.toHaveBeenCalled();
        expect(cache.writeYearsMeta).not.toHaveBeenCalled();
        expect(cache.clearAll).not.toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
        expect(queue.drain).not.toHaveBeenCalled();
        ```
  - [ ] 5.4 Run `npx vitest run src/app/data/archive-repository.service.test.ts` and confirm it fails
        on the missing module.

- [ ] 6. Implement `src/app/data/archive-repository.service.ts` (**green**)
  - [ ] 6.1 **Reconciliation check first.** Open `src/app/backend/local-archive-backend.service.ts` and
        `src/app/domain/archive-models.ts` and map them onto the table in `Inputs → From Depends
        (T10)`. Note the real class name and the real list-method names before writing a line; T10's
        spelling wins and only the import line and call sites change.
  - [ ] 6.2 Create the file with the header, imports and the narrow client port declared verbatim in
        `Interface contract → Produces — src/app/data/archive-repository.service.ts` (`RawCatalog`,
        `RawArchiveLeague`, `RawArchiveSeason`, `RawArchiveTournament`, `RawArchiveYears`,
        `ArchiveReadClient`). Header:
        ```ts
        /**
         * The archive read funnel (ADR 0028's two stores, one list; ADR 0039's one TTL).
         *
         * Public catalogs come from the server and are cached in `gones-archive-cache`; browser-authored
         * records come from the local authority and are never written into that cache — a purge must not
         * be able to delete something the user wrote. Every returned row carries `isLocal`, which is the
         * whole routing rule the table and the detail pages use.
         *
         * This file names no IndexedDB symbol on purpose: storage lives behind `ArchiveCacheService` and
         * `ArchiveBackfillQueue`, which is what keeps `server-authority-boundary.test.ts`'s allowlist
         * down to the two files that genuinely need the API.
         */
        ```
  - [ ] 6.3 Add the row types and the two exported pure functions:
        ```ts
        export const ARCHIVE_UPDATED_EVENT = 'gones-archive-updated';

        export type ArchiveLeagueRow = ArchiveLeagueSummary & { isLocal: boolean };
        export type ArchiveLeagueSeasonRow = ArchiveLeagueSeasonSummary & { isLocal: boolean };
        export type ArchiveTournamentRow = ArchiveTournamentSummary & { isLocal: boolean };

        export interface ArchiveCatalogResult<T> {
          items: T[]; totalCount: number; truncated: boolean; fetchedAt: string; fromCache: boolean; stale: boolean;
        }
        export interface ArchiveSeasonTournamentsResult { items: ArchiveTournamentRow[]; fromCache: boolean }

        /** Both bounds inclusive. A Season with no Tournament has no year and needs no request. */
        export function archiveYearRange(firstTournamentDate: string | null, lastTournamentDate: string | null): number[] {
          if (!firstTournamentDate || !lastTournamentDate) return [];
          const from = Number(firstTournamentDate.slice(0, 4));
          const to = Number(lastTournamentDate.slice(0, 4));
          if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return [];
          return Array.from({ length: to - from + 1 }, (_, index) => from + index);
        }

        /** The server's `tournament_date DESC, document_id COLLATE "C" ASC`, reproduced byte for byte. */
        export function compareArchiveTournamentRows(left: ArchiveTournamentSummary, right: ArchiveTournamentSummary): number {
          if (left.tournamentDate !== right.tournamentDate) return left.tournamentDate < right.tournamentDate ? 1 : -1;
          if (left.id === right.id) return 0;
          return left.id < right.id ? -1 : 1;
        }
        ```
  - [ ] 6.4 Add the private normalizers, one per tier. They are the only place a NodaTime-typed field
        is touched:
        ```ts
        const toStatus = (value: string): ArchiveRowStatus => (value === 'completed' ? 'completed' : 'active');
        const toText = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
        const toOptionalText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

        const toLeagueRow = (raw: RawArchiveLeague): ArchiveLeagueSummary =>
          ({ id: raw.id, name: raw.name, createdAt: toText(raw.createdAt), updatedAt: toText(raw.updatedAt), documentVersion: raw.documentVersion });

        const toSeasonRow = (raw: RawArchiveSeason): ArchiveLeagueSeasonSummary => ({
          id: raw.id, name: raw.name, leagueId: raw.leagueId, status: toStatus(raw.status),
          updatedAt: toText(raw.updatedAt), documentVersion: raw.documentVersion,
          tournamentCount: raw.tournamentCount, playerCount: raw.playerCount,
          firstTournamentDate: toOptionalText(raw.firstTournamentDate),
          lastTournamentDate: toOptionalText(raw.lastTournamentDate)
        });

        const toTournamentRow = (raw: RawArchiveTournament): ArchiveTournamentSummary => ({
          id: raw.id, name: raw.name, seasonId: raw.seasonId ?? null, tournamentDate: toText(raw.tournamentDate),
          status: toStatus(raw.status), updatedAt: toText(raw.updatedAt), documentVersion: raw.documentVersion,
          playerCount: raw.playerCount
        });
        ```
  - [ ] 6.5 Add the browser-local mappers. The server denormalizes these counters in SQL; a local
        record has no server to ask, so they are derived here with the same definition:
        ```ts
        /** Distinct players of a Tournament: both sides of a match, the player of a bye, nobody for an invalid entry. */
        function localPlayerNames(tournament: PersistedArchiveTournament): Set<string> {
          const names = new Set<string>();
          for (const round of tournament.rounds) {
            for (const entry of round.entries) {
              if (entry.kind === 'match') {
                if (entry.player1Name) names.add(entry.player1Name);
                if (entry.player2Name) names.add(entry.player2Name);
              } else if (entry.kind === 'bye' && entry.playerName) names.add(entry.playerName);
            }
          }
          return names;
        }

        function localSeasonRow(season: PersistedLeagueSeason, tournaments: PersistedArchiveTournament[]): ArchiveLeagueSeasonRow {
          const mine = tournaments.filter((tournament) => tournament.seasonId === season.id);
          const dates = mine.map((tournament) => tournament.tournamentDate).filter(Boolean).sort();
          const players = new Set<string>();
          for (const tournament of mine) for (const name of localPlayerNames(tournament)) players.add(name);
          return {
            id: season.id, name: season.name, leagueId: season.leagueId, status: season.status,
            updatedAt: season.updatedAt, documentVersion: season.documentVersion,
            tournamentCount: mine.length, playerCount: players.size,
            firstTournamentDate: dates[0] ?? null, lastTournamentDate: dates[dates.length - 1] ?? null,
            isLocal: true
          };
        }
        ```
        plus the two one-liners for a local League row and a local Tournament row
        (`playerCount: localPlayerNames(tournament).size`), both with `isLocal: true`.
  - [ ] 6.6 Add the class shell and the shared catalog routine, so the League and Season catalogs
        cannot drift apart:
        ```ts
        @Injectable({ providedIn: 'root' })
        export class ArchiveRepository {
          private readonly client: ArchiveReadClient = inject(Client);
          private readonly cache = inject(ArchiveCacheService);
          private readonly queue = inject(ArchiveBackfillQueue);
          private readonly local: LocalArchiveSource = inject(LocalArchiveBackend);
        ```
        with `LocalArchiveSource` declared just above the class as the three-method interface in
        `Inputs → From Depends (T10)`. If the assignment on the `client` line fails to typecheck, the
        generated client's shape has drifted — widen the offending `Raw*` field to `unknown` and
        normalize it; **never** cast the client with `as unknown as`.
  - [ ] 6.7 Implement `listLeagues` / `listLeagueSeasons` over one private
        `loadCatalog<TRaw, TRow>(...)` that takes: the read, the write, the fetch, the normalizer and
        the local half. Order of operations, binding:
        1. `force` false and a record exists and `isArchiveCatalogFresh(record)` → serve it,
           `fromCache: true`, `stale: false`, **no request**.
        2. otherwise fetch; on success write the record (server rows only, no `isLocal`) and serve it
           `fromCache: false`, `stale: false`.
        3. on rejection with a record → serve the record, `stale: true`.
        4. on rejection without a record and with at least one local row → serve the local half,
           `stale: true`, `totalCount` = local count, `truncated: false`.
        5. on rejection with neither → rethrow.
        In every served case the local rows are appended after the server rows and
        `totalCount = serverTotalCount + localRows.length`.
  - [ ] 6.8 Implement `listYears`:
        ```ts
          async listYears(options: { force?: boolean } = {}): Promise<ArchiveYearEntry[]> {
            const snapshot = await this.cache.readYearsMeta();
            // `locked` flips at midnight UTC, so a snapshot is worthless the moment the day rolls over —
            // the same reason the server puts the UTC day in this endpoint's ETag.
            if (!options.force && snapshot && snapshot.utcDay === utcDayKey()) return snapshot.years;
            try {
              const response = await firstValueFrom(this.client.getArchiveYears());
              const years = [...(response.years ?? [])].sort((left, right) => left.year - right.year);
              await this.cache.writeYearsMeta({ key: ARCHIVE_YEARS_META_KEY, years, fetchedAt: new Date().toISOString(), utcDay: utcDayKey() });
              return years;
            } catch (error) {
              // Offline: the snapshot still says which years exist, but never that one is immutable.
              if (snapshot) return snapshot.years.map((entry) => ({ ...entry, locked: false }));
              throw error;
            }
          }
        ```
  - [ ] 6.9 Implement `listTournaments`: `listYears()` (its rejection caught → fall back to
        `readAllYearPartitions()` and `stale: true`, rethrowing only when there is no partition and no
        local Tournament) → `readAllYearPartitions()` → `classifyArchiveYear` per entry →
        `queue.enqueue(missing ∪ stale)` → `queue.drain((year) => firstValueFrom(this.client
        .getArchiveTournamentYearCatalog(String(year))).then((response) => ({ items: (response.items ?? []).map(toTournamentRow), totalCount: response.totalCount, truncated: response.truncated })))`
        → re-read the partitions → flatten, append local Tournaments, sort with
        `compareArchiveTournamentRows`. `totalCount` = Σ `rowCount` + local count; `truncated` =
        any partition with `items.length < rowCount`; `fetchedAt` = the **oldest** `completedAt`
        served, or `new Date().toISOString()` when no partition was served; `stale` =
        `report.failed.length > 0` or the years index came from the fallback path. Under
        `{ force: true }` every year is enqueued regardless of its classification.
  - [ ] 6.10 Implement `listSeasonTournaments`, the §8.1 read-through. It must reach no writer:
        ```ts
          async listSeasonTournaments(season: { id: string; firstTournamentDate: string | null; lastTournamentDate: string | null }): Promise<ArchiveSeasonTournamentsResult> {
            // A browser-authored Season has no server half; asking the API for it would 404 forever.
            if (season.id.startsWith('local-')) {
              const tournaments = await this.local.listTournaments();
              return { items: tournaments.filter((item) => item.seasonId === season.id).map(localTournamentRow).sort(compareArchiveTournamentRows), fromCache: true };
            }
            const years = archiveYearRange(season.firstTournamentDate, season.lastTournamentDate);
            if (years.length === 0) return { items: [], fromCache: true };
            const index = new Map((await this.listYears()).map((entry) => [entry.year, entry]));
            const partitions = await Promise.all(years.map((year) => this.cache.readYearPartition(year)));
            // Cached, complete AND locked for every year the Season spans — anything less and a row could
            // have changed since the partition was taken, so the server answers instead.
            const servable = years.every((year, position) => index.get(year)?.locked === true && isArchiveYearPartitionComplete(partitions[position]));
            if (servable) {
              const items = partitions
                .flatMap((partition) => partition?.items ?? [])
                .filter((item) => item.seasonId === season.id)
                .map((item) => ({ ...item, isLocal: false }))
                .sort(compareArchiveTournamentRows);
              return { items, fromCache: true };
            }
            // Deliberately not cached: caching it here would make a second writer of the year store and
            // could leave a half-year behind. Rendering it and forgetting it is the whole design.
            const response = await firstValueFrom(this.client.getArchiveSeasonTournaments(season.id));
            return { items: (response.items ?? []).map((raw) => ({ ...toTournamentRow(raw), isLocal: false })).sort(compareArchiveTournamentRows), fromCache: false };
          }
        ```
        If T10 exports a local-id predicate (`isLocalArchiveId` or similar), import and call it
        instead of the inline `startsWith('local-')` — same rule, one definition.
  - [ ] 6.11 Implement the invalidation funnel:
        ```ts
          /**
           * The single funnel every archive mutation goes through: drop every cached catalog, then tell
           * the app. The TTL governs navigation, never correctness (ADR 0039), so a write must never wait
           * out 24 hours to become visible.
           */
          async invalidateArchiveCaches(): Promise<void> {
            await this.cache.clearAll();
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ARCHIVE_UPDATED_EVENT));
          }
        }
        ```
  - [ ] 6.12 Run `npx vitest run src/app/data/archive-repository.service.test.ts` until green.

- [ ] 7. Extend the two pinned allowlists (**red → green**)
  - [ ] 7.1 In `src/app/backend/server-authority-boundary.test.ts`, inside
        `confines IndexedDB to the sanctioned local adapters`, add the two entries in sorted position,
        each with the one-line reason the list's other entries carry:
        ```ts
            expect(filesMatching(/\bindexedDB\b|\bIDB[A-Z]\w*/)).toEqual([
              // The single writer of the public year partitions: one year, one transaction, whole or absent.
              'src/app/backend/archive-backfill-queue.ts',
              // Public archive catalog cache (ADR 0039 TTL), moved off `localStorage` by the archive rebuild.
              'src/app/backend/archive-cache.service.ts',
              // Promise wrapper over the raw request/transaction API. No data rules.
              'src/app/backend/indexed-db.ts',
        ```
        leaving the remaining three entries untouched.
  - [ ] 7.2 In the same file, inside `keeps the public catalog cache helper to its declared importers`,
        add the single new importer in sorted position:
        ```ts
            expect(filesMatching(/from '[^']*shared\/catalog-cache'/)).toEqual([
              // Imports `CATALOG_TTL_MS` only — the archive cache is IndexedDB and writes no `localStorage`.
              'src/app/backend/archive-cache.service.ts',
              // Public Event catalog — anonymous GET responses.
              'src/app/features/events/event-catalog-cache.service.ts',
        ```
        leaving the remaining three entries untouched.
  - [ ] 7.3 Run `npx vitest run src/app/backend/server-authority-boundary.test.ts` and confirm both
        assertions pass and no other test in that file moved.

- [ ] 8. Validate the whole slice
  - [ ] 8.1 `npm run test`
  - [ ] 8.2 `npm run typecheck`
  - [ ] 8.3 `npm run lint`
  - [ ] 8.4 `npm run build`
  - [ ] 8.5 Confirm the fence held: `git status --short` lists exactly six files — the three new
        sources, their three tests — plus the modified `src/app/backend/server-authority-boundary.test.ts`.
        Nothing under `src/app/features/`, nothing in `src/app/app.routes.ts`, nothing in
        `src/app/shared/catalog-cache.ts`, nothing deleted.

## Outputs

| File | Change |
| --- | --- |
| `src/app/backend/archive-cache.service.ts` | **new** — `gones-archive-cache` v1 with the four stores, the cached record shapes, `isArchiveCatalogFresh`, `utcDayKey`, `ArchiveCacheService` (reads, catalog/meta writes, wholesale `clearAll`), and the single re-export of `CATALOG_TTL_MS` |
| `src/app/backend/archive-cache.service.test.ts` | **new** — 18 tests incl. the prototype and source assertions that keep partition writes out of this class |
| `src/app/backend/archive-backfill-queue.ts` | **new** — `classifyArchiveYear`, `isArchiveYearPartitionComplete`, `ArchiveBackfillQueue`; the only writer of `year-partitions` |
| `src/app/backend/archive-backfill-queue.test.ts` | **new** — 17 tests incl. the two atomicity proofs and the repo-wide single-writer scan |
| `src/app/data/archive-repository.service.ts` | **new** — `ArchiveRepository` (League/Season catalogs, years index, year-partitioned Tournaments, read-through Season expansion, `invalidateArchiveCaches`), `archiveYearRange`, `compareArchiveTournamentRows`, `ARCHIVE_UPDATED_EVENT` |
| `src/app/data/archive-repository.service.test.ts` | **new** — 29 tests incl. the "read-through writes nothing" proof |
| `src/app/backend/server-authority-boundary.test.ts` | **modified** — two allowlist entries added to the IndexedDB list, one to the `shared/catalog-cache` importer list |

Public API / behaviour change:

- A second browser database appears, `gones-archive-cache` v1, stores `leagues`, `league-seasons`,
  `year-partitions`, `meta`. It holds public server answers only and may be deleted at any time.
- A new DOM event `gones-archive-updated` is dispatched by `ArchiveRepository.invalidateArchiveCaches()`.
  It renames `gones-league-updated`, which keeps being dispatched by the legacy components until T17;
  the new event gets its listener when T13 lands the archive shell.
- **`localStorage` is not written by anything in this slice.** After this ticket the archive's storage
  is IndexedDB, and `localStorage` keeps only: language, view preference, table filters/sort/page
  size, and the existing auth coordination keys `gones.auth.sessionGeneration`,
  `gones.auth.privatePurgeRequired`, `gones.auth.coordinationProbe`. The legacy key
  `gones.leagues-archive.catalog.v2` still exists and is still read by the legacy page until T17
  deletes it; nothing in the new surface reads or writes it.

Migration / config: none. No database migration, no environment variable, no configuration key, no
new dependency, no `package.json` change, no generated-client regeneration.

## Validation

- [ ] `npx vitest run src/app/backend/archive-cache.service.test.ts` — 18 passed, 0 failed
- [ ] `npx vitest run src/app/backend/archive-backfill-queue.test.ts` — 17 passed, 0 failed, including
      `an aborted write leaves the previously stored partition unchanged` and
      `a rejected loader writes no record at all`
- [ ] `npx vitest run src/app/data/archive-repository.service.test.ts` — 29 passed, 0 failed, including
      `expanding an uncached Season fetches read-through and writes nothing`
- [ ] `npx vitest run src/app/backend/server-authority-boundary.test.ts` — all passed; the IndexedDB
      allowlist now names six files and the catalog-cache importer list five
- [ ] `npm run test` — whole suite green, exit code 0
- [ ] `npm run typecheck` — `tsc --noEmit` on both projects, exit code 0, no output
- [ ] `npm run lint` — exit code 0
- [ ] `npm run build` — exit code 0, the app still compiles with the legacy archive untouched
- [ ] Manual check (no UI in this slice): `npm run dev`, open the app, run in the console
      `indexedDB.databases().then(console.log)` — `gones-archive-cache` must **not** exist yet,
      because nothing routes to it until T13. Then, still in the console,
      `(await ng.getInjector?.()) ?? null` is not needed: instead confirm the negative case only —
      no page load creates the database and no page writes `localStorage` under a
      `gones.archive.*` key (`Object.keys(localStorage).filter(k => k.startsWith('gones.archive'))`
      → `[]`).
- [ ] `git status --short` — exactly the seven paths in `Outputs`, nothing else, nothing deleted,
      nothing staged
- [ ] commit msg draft: `feat(archive): serve public archive catalogs from IndexedDB with one year-partition writer`
