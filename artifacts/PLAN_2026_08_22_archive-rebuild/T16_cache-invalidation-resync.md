# T16: Centralized cache invalidation and manual resynchronize

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T13, T14
**Commit outcome:** Every archive mutation funnels through one `invalidateArchiveCaches()` method, a structural coverage test fails the build when a new mutating method skips it, and Settings offers a collapsed "Resynchronize everything" control that drops every archive cache store and restarts the backfill queue.

## Context (self-contained)

- **Goal:** the Archive is being rebuilt on three tiers — League → LeagueSeason → Tournament. A new `/archive/**` API and UI surface is being added *beside* the legacy `/api/leagues-archive/**` + `src/app/features/leagues-archive/**` one; the legacy half is deleted only at T17, so every commit up to then must compile and run with both halves alive. Public archive catalogs move off `localStorage` into IndexedDB (`gones-archive-cache`), written by a single backfill queue.
- **This slice:** the invalidation seam. T12 built the IndexedDB cache and the backfill queue, T13 built the archive shell and the League Seasons tab, T14 built the Tournaments tab and the detail/result pages. Every one of those pages can mutate. This ticket makes exactly one method responsible for dropping the cached copies and announcing the change, proves by test that no mutating method can skip it, and gives the user a manual escape hatch when the cache is stale for a reason the app cannot detect.
- **Why this ticket exists (the gap):** today's invalidation *does* work. `gones-league-updated` is dispatched at `src/app/features/leagues-archive/league-archive-detail.component.ts:145` and `:169` and at `src/app/features/tournaments-archive/tournament-archive-detail.component.ts:560`, and handled at `src/app/app.component.ts:165`, which covers all six of today's mutation sites. **Nothing proves it stays wired.** A seventh mutation site added tomorrow silently serves stale rows for 24 hours and no test goes red. The coverage test in this ticket is the deliverable that closes that hole — which is why it must be *structural*, enumerating methods from the source and the runtime prototype rather than from a hand-written list that rots the moment it is written.
- **Why the resynchronize button exists:** an Admin edit to *locked* data (a Tournament played more than 365 days ago) is invisible to a user until they ask for it, because a locked year partition is served from IndexedDB forever with no request (`cached && locked → serve local, no request`). That staleness is an **accepted risk** of the caching design, not a bug. This button is its escape hatch. It is collapsed by default because it is a heavy, rarely-needed operation: it throws away every cached catalog and re-downloads them.

**Out of scope here — do not touch:**

- Do **not** remove the existing `gones-league-updated` listener at `src/app/app.component.ts:165`, nor its three dispatch sites (`league-archive-detail.component.ts:145,169`, `tournament-archive-detail.component.ts:560`), nor `clearLeagueCatalogCache()` / `LEAGUE_CATALOG_CACHE_KEY` in `src/app/features/leagues-archive/league-archive-catalog-cache.service.ts`. The legacy components still exist and still depend on them. T17 deletes all of that; this ticket does not.
- Do **not** delete or modify `src/app/app.component.league-catalog-cache.test.ts`. It covers the legacy listener and must stay green.
- **No new HTTP endpoints.** No backend file changes at all.
- **No table work** — no column, sort, paging or expansion change to the archive tables from T13/T14.
- No Cypress spec in this ticket.
- No new file outside the ones listed in *Outputs*.

**Assumptions in force:**

- Gones is unreleased; there is no production environment and no users. Local data may be reset freely.
- Frontend is Angular 21 standalone components with signals; tests are Vitest, run with `npm run test` (`vitest run`). There is **no TestBed in this repo** — component tests build the instance with `Object.create(Component.prototype)` and `Object.assign` the collaborators, or use a bare `Injector`. Follow that idiom.
- `src/app/backend/server-authority-boundary.test.ts` (~lines 100-118) asserts an **exact** allowlist of files that may mention `indexedDB` or `IDB*`. Its `sourceFiles()` helper skips `*.test.ts`, so a test file is exempt, but `src/app/data/archive-repository.service.ts` is **not**: `invalidateArchiveCaches()` must never touch IndexedDB directly. It delegates to `src/app/backend/archive-cache.service.ts`, which T12 already added to that allowlist.
- `src/app/i18n/message-namespace.test.ts` asserts `Object.keys(en).sort()` equals `Object.keys(fr).sort()`. Every key added below must land in **both** catalogues.
- The archive public catalog cache is public data. It is a *cache*, never an authority: A10 keeps the browser-local authored archive in a different database (`gones-archive-local`), so clearing `gones-archive-cache` can never destroy a user-authored record.

## Requirements

1. `ArchiveRepository` (`src/app/data/archive-repository.service.ts`) exposes `invalidateArchiveCaches(): Promise<void>` — the single funnel every archive mutation goes through. It clears every `gones-archive-cache` store and then dispatches the `gones-archive-updated` window event.
2. `invalidateArchiveCaches()` **never rejects.** A mutation that already succeeded on the server must not surface as a failure to the user because a cache could not be dropped.
3. Every mutating method on `ArchiveRepository` reaches `invalidateArchiveCaches()` — either directly or through the one private mutation wrapper — and does so **after** the write succeeded, never before and never when it threw.
4. `src/app/data/archive-cache-invalidation.test.ts` proves requirement 3 **structurally**. It enumerates the class members from the source file *and* cross-checks that enumeration against `Object.getOwnPropertyNames(ArchiveRepository.prototype)`, so a method the parser missed fails the test instead of escaping it. A new mutating method added without routing through the funnel makes this test red.
5. `src/app/app.component.ts` listens for `gones-archive-updated` **beside** the existing `gones-league-updated` listener, and rebuilds its route state. Both listeners exist at once after this ticket.
6. The Settings page gains a **collapsed-by-default** "Resynchronize everything" section. Activating it clears every archive cache store and restarts the backfill queue, reports success or failure, and cannot be re-entered while it is running.
7. Every user-visible string added is present in **both** `en` and `fr` in `src/app/i18n/messages.ts`.
8. `npm run test`, `npm run typecheck` and `npm run lint` are green, and the app still compiles and runs with the legacy archive surface intact.

## Inputs

Files to read before editing:

- `src/app/data/archive-repository.service.ts` — created by T12. The class this ticket extends.
- `src/app/backend/archive-cache.service.ts` — created by T12. The IndexedDB public catalog cache over `gones-archive-cache`. This is the only file allowed to touch that database.
- `src/app/backend/archive-backfill-queue.ts` — created by T12. The single writer of year partitions.
- `src/app/app.component.ts:158-179` — the constructor. Line 165 is the existing `window.addEventListener('gones-league-updated', …)`, whose body is:
  ```ts
    window.addEventListener('gones-league-updated', () => {
      clearLeagueCatalogCache();
      void this.updateRouteState(this.router.url);
    });
  ```
  It sits directly after `window.addEventListener('gones-live-tournament-updated', (event) => this.handleLiveTournamentUpdated(event));` and directly before `this.router.events.pipe(filter(…))`.
- `src/app/app.component.league-catalog-cache.test.ts` — **the existing test idiom to imitate**: no zone.js, `effect()` stubbed to a no-op through `vi.mock('@angular/core', …)`, the shell built with a bare `Injector.create({ providers: [...] })` and `runInInjectionContext(injector, () => new AppComponent())`.
- `src/app/features/settings/settings.component.ts` — 1123 lines. Template ends at line 457 with `` ` `` then `})` at 458; `export class SettingsComponent {` is at line 459. `MatExpansionModule` is already in the `imports` array. Existing collapsed-panel markup at lines 101-105, 208-212, 294-298, 367-371. The card that ends at lines 432-435 (`</mat-expansion-panel>` / `</mat-card-content>` / `</mat-card>` / `}`) is the local-players card; the next block at line 437 is `@if (capabilities().orgNotifications && ownedOrganizations().length) {`.
- `src/app/features/settings/settings.component.test.ts` — 179 lines. **The structural-test idiom already in this repo**: `readFileSync(join(__dirname, 'settings.component.ts'), 'utf8')` plus a balanced-brace `templateBlock(opening)` helper, and behaviour tests built with `Object.create(SettingsComponent.prototype)`.
- `src/app/backend/server-authority-boundary.test.ts:24-37` — `sourceFiles()` / `filesMatching()`; note `!entry.name.endsWith('.test.ts')`.
- `src/app/i18n/messages.ts` — 2497 lines. `const en = {` at line 5, `const fr: Record<MessageKey, string> = {` at line 1255. `'settings.orgSaveFailed'` is the last `settings.*` key in each block: line **516** (en) and line **1759** (fr).
- `src/styles.css` — existing classes used below, all present: `.panel`, `.settings-panel`, `.settings-archetype-panel-card` (line 413), `.settings-collapsible-panel` (line 415+), `.settings-archetype-copy` (line 405), `.settings-saved`, `.secondary-action` (line 93), `.muted`. **Never hardcode a colour.**
- `src/app/shared/app-logger.ts` — `logBoundaryError(boundary: string, error: unknown, context?: Record<string, unknown>): void` and `logBoundaryInfo(boundary: string, context?: Record<string, unknown>): void`.

**From Depends — behaviour T13 and T14 left, spelled out:**

- T13 created `src/app/features/archive/archive-shell.component.ts` (tabs + shared toolbar) and `league-season-list.component.ts` (Tab 1), routed at `/archive/league-seasons`. T14 created `league-season-detail.component.ts`, `tournament-list.component.ts` (Tab 2), `tournament-detail.component.ts` and `tournament-result.component.ts`, routed at `/archive/tournaments`, `/archive/tournaments/:tournamentId`, `/archive/tournaments/:tournamentId/result`. **All of them mutate through `ArchiveRepository`; none of them dispatch a window event of their own.** This ticket does not edit any of those six components — the funnel lives one layer down, in the repository, which is why they need no change.
- T12 created `src/app/data/archive-repository.service.ts`, `src/app/backend/archive-cache.service.ts` and `src/app/backend/archive-backfill-queue.ts`, and added the latter two plus `src/app/backend/local-archive-backend.service.ts` to the IndexedDB allowlist in `src/app/backend/server-authority-boundary.test.ts`.
- T12's IndexedDB cache contract, binding and unchanged here:
  ```ts
  export const ARCHIVE_CACHE_DB_NAME = 'gones-archive-cache';
  export const ARCHIVE_CACHE_DB_VERSION = 1;
  export const CACHE_LEAGUE_STORE = 'leagues';              // key: 'catalog'
  export const CACHE_SEASON_STORE = 'league-seasons';       // key: 'catalog'
  export const CACHE_YEAR_PARTITION_STORE = 'year-partitions'; // key: year (number)
  export const CACHE_META_STORE = 'meta';                   // key: string
  ```
  Freshness rules the cache serves under, which are what makes stale locked data possible:
  ```
  cached && locked            → serve local, no request
  cached && !locked && <24h   → serve local, no request
  cached && !locked && ≥24h   → refetch that year
  !cached                     → enqueue in the backfill queue
  ```

## Interface contract (level 5)

### Produces

**1. `src/app/data/archive-repository.service.ts` — new exported constant and new public method.**

```ts
/**
 * The one announcement the whole archive makes. Exported so the shell listener and this dispatcher
 * cannot drift apart: a typo in either half is a compile error, not a silently dead listener.
 */
export const ARCHIVE_UPDATED_EVENT = 'gones-archive-updated';
```

```ts
// added to class ArchiveRepository
private readonly archiveCache = inject(ArchiveCacheService);

/**
 * The single funnel every archive mutation goes through: it drops every cached public catalog copy,
 * then announces the change so the shell can rebuild what it is showing.
 *
 * Never rejects. The write it follows has already succeeded; a cache that cannot be dropped is a
 * cache problem, not a mutation failure, and must not be reported to the user as one.
 */
async invalidateArchiveCaches(): Promise<void> {
  await this.archiveCache.clearAll();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ARCHIVE_UPDATED_EVENT));
}
```

**2. `src/app/data/archive-repository.service.ts` — the private mutation wrapper, sole indirection.**

Exactly one `private` member of `ArchiveRepository` may call `invalidateArchiveCaches()`. Its shape:

```ts
/**
 * Every mutating method's one exit: run the write, then invalidate. Invalidating before the write,
 * or invalidating when it threw, would drop a good cache and repopulate it from data the failed
 * write never changed.
 */
private async mutating<T>(action: () => Promise<T>): Promise<T> {
  const result = await action();
  await this.invalidateArchiveCaches();
  return result;
}
```

If T12 already shipped an equivalent private wrapper under another name (step 3.1 decides this by `grep`), that wrapper gains the `await this.invalidateArchiveCaches();` line instead and **no second wrapper is created** — the coverage test derives the wrapper's name from the source and does not hardcode it.

**3. `src/app/app.component.ts` — new listener, added beside the existing one.**

```ts
// The archive rebuild's own announcement. It sits beside the legacy `gones-league-updated` listener
// rather than replacing it: the legacy League pages still dispatch that one and are still routed,
// so both have to work at once until the legacy surface is retired. This handler does not clear a
// cache — `invalidateArchiveCaches()` already did, before it dispatched.
window.addEventListener(ARCHIVE_UPDATED_EVENT, () => {
  void this.updateRouteState(this.router.url);
});
```

**4. `src/app/features/settings/settings.component.ts` — new state and method.**

```ts
readonly archiveResyncing = signal(false);
readonly archiveResyncMessage = signal('');
private readonly archiveRepo = inject(ArchiveRepository);
private readonly archiveBackfill = inject(ArchiveBackfillQueue);

/**
 * The escape hatch for the one staleness the cache design accepts: a locked year partition is
 * served from IndexedDB forever with no request, so an Admin edit to data older than 365 days is
 * invisible here until the user asks for it. This is that ask.
 */
async resynchronizeArchive(): Promise<void>;
```

**5. `src/app/i18n/messages.ts` — five new keys, in `en` and in `fr`.**

| Key | `en` | `fr` |
| --- | --- | --- |
| `settings.archiveResync` | `Resynchronize everything` | `Tout resynchroniser` |
| `settings.archiveResyncRunning` | `Resynchronizing…` | `Resynchronisation…` |
| `settings.archiveResyncHelp` | `Clears every copy of the Archive cached in this browser and downloads it again. Use it when a League Season or a Tournament looks out of date: an edit made to data older than a year is not visible here until you ask for it. Nothing you created is deleted.` | `Vide toutes les copies de l’archive mises en cache dans ce navigateur et les télécharge à nouveau. À utiliser lorsqu’une saison de ligue ou un tournoi semble périmé : une modification apportée à des données de plus d’un an n’apparaît ici que si vous la demandez. Rien de ce que vous avez créé n’est supprimé.` |
| `settings.archiveResyncDone` | `Archive cache cleared. Fresh data is downloading.` | `Cache de l’archive vidé. Les données fraîches sont en cours de téléchargement.` |
| `settings.archiveResyncFailed` | `Could not resynchronize the Archive.` | `Impossible de resynchroniser l’archive.` |

**6. `src/app/data/archive-cache-invalidation.test.ts` — new test file.** Full source in *Impl steps* 1.1.

### Consumes

Binding, from T12. Verify each exists with this exact signature; step 3.2 and step 5.2 add it verbatim if it does not.

```ts
// src/app/backend/archive-cache.service.ts
@Injectable({ providedIn: 'root' })
export class ArchiveCacheService {
  /**
   * Drops every record in every `gones-archive-cache` store. Never rejects: an unavailable, blocked
   * or corrupt cache is already unusable, and the repair path must not fail because the thing it
   * repairs is broken.
   */
  clearAll(): Promise<void>;
}
```

```ts
// src/app/backend/archive-backfill-queue.ts
@Injectable({ providedIn: 'root' })
export class ArchiveBackfillQueue {
  /**
   * Cancels in-flight work, empties the queue, re-enqueues every year that is not cached, and
   * starts draining. Resolves once the queue has been re-armed, not once it has drained — a
   * multi-year backfill must not block the button that started it.
   */
  restart(): Promise<void>;
}
```

Also consumed, unchanged, from the existing repo:

```ts
// src/app/shared/app-logger.ts
export function logBoundaryError(boundary: string, error: unknown, context?: Record<string, unknown>): void;
export function logBoundaryInfo(boundary: string, context?: Record<string, unknown>): void;
```

### Errors

| Path | Behaviour | User-visible result |
| --- | --- | --- |
| `ArchiveCacheService.clearAll()` rejects | swallowed inside `clearAll()` by contract; `invalidateArchiveCaches()` sees a resolved promise | none — the mutation reports its own success |
| `window` is undefined (SSR / node test) | `invalidateArchiveCaches()` skips the dispatch, still clears | none |
| `action()` inside `mutating()` rejects | the rejection propagates **unchanged**; `invalidateArchiveCaches()` is **not** called | the calling page's existing error handling |
| `resynchronizeArchive()` — anything throws | caught, `logBoundaryError('settings.resynchronizeArchive', error)`, `archiveResyncMessage` ← `i18n.t('settings.archiveResyncFailed')`, `archiveResyncing` ← `false` | red-free status line with the failure copy |
| `resynchronizeArchive()` called while `archiveResyncing()` is `true` | returns immediately, no collaborator touched | button is already `[disabled]` |

No new error type, no new error code, no HTTP status: this ticket adds no endpoint.

### Invariants

- **I1 — one funnel.** Exactly one `private` member of `ArchiveRepository` contains `this.invalidateArchiveCaches()`. Enforced by test `exactly one private wrapper carries the invalidation`.
- **I2 — total coverage.** Every non-`private` member of `ArchiveRepository` whose name does not begin with a read verb (`list`, `get`, `load`, `read`, `find`, `count`, `has`, `is`), and which is neither `constructor` nor `invalidateArchiveCaches` nor the wrapper, contains either `this.<wrapper>(` or `this.invalidateArchiveCaches()`. Enforced by test `every mutating method reaches the invalidation funnel`.
- **I3 — the parser cannot miss a member.** Every name in `Object.getOwnPropertyNames(ArchiveRepository.prototype)` except `constructor` appears in the parsed member list. Enforced by test `the source parse sees every member the prototype has`.
- **I4 — no arrow-function members.** `ArchiveRepository` declares no `name = (…) =>` / `name = async (…) =>` class property, because such a member is invisible to both the parser and the prototype and would escape I2 and I3.
- **I5 — clear before announce.** Inside `invalidateArchiveCaches()`, the index of `this.archiveCache.clearAll()` is strictly less than the index of `ARCHIVE_UPDATED_EVENT`. A listener that re-reads must not be handed the cache it was told to stop trusting.
- **I6 — invalidate after write.** Inside the wrapper, the index of `await action()` is strictly less than the index of `this.invalidateArchiveCaches()`.
- **I7 — never rejects.** `invalidateArchiveCaches()` resolves for every input, including a `clearAll()` that rejects and a missing `window`.
- **I8 — idempotent.** Calling `invalidateArchiveCaches()` n times is indistinguishable from calling it once, apart from n dispatched events. The event carries **no `detail`**: listeners re-read, they never trust a payload.
- **I9 — the legacy seam survives.** `src/app/app.component.ts` still contains `window.addEventListener('gones-league-updated'`. Enforced by test `keeps the legacy League listener alive`.
- **I10 — no IndexedDB in the repository.** `src/app/data/archive-repository.service.ts` contains neither `indexedDB` nor an `IDB*` identifier, so it stays outside the allowlist in `src/app/backend/server-authority-boundary.test.ts`.
- **I11 — collapsed by default.** The Settings resynchronize panel renders with `[expanded]="false"` and no code path sets it open.
- **I12 — single-flight.** `resynchronizeArchive()` cannot run concurrently with itself; `archiveResyncing` is `false` on every exit path, success or failure.
- **I13 — order.** `resynchronizeArchive()` clears the caches **before** it restarts the queue, so the queue re-enqueues against an empty cache and does not skip years it thinks are still present.
- **I14 — ungated.** The resynchronize control has no capability, role or Power-User gate. It repairs a *public* read cache; gating it would hide the escape hatch from the anonymous visitor most likely to be looking at stale locked data.

## TDD

1. **Red** — write both test files first and run `npm run test`. Expect these named failures:
   - `archive cache invalidation › the source parse sees every member the prototype has` — passes trivially at first (nothing to miss), keep it.
   - `archive cache invalidation › exactly one private wrapper carries the invalidation` — **fails**: zero wrappers, `invalidateArchiveCaches` does not exist.
   - `archive cache invalidation › every mutating method reaches the invalidation funnel` — **fails**.
   - `archive cache invalidation › invalidateArchiveCaches clears the stores before it announces` — **fails**: method missing.
   - `archive cache invalidation › the app shell listens for the archive announcement` — **fails**: no listener.
   - `archive cache invalidation › keeps the legacy League listener alive` — passes from the start; it is a fence guard, not a red step.
   - `archive cache invalidation › declares no arrow-function member` — passes from the start; it is an escape-hatch guard.
   - `settings archive resynchronize › keeps the resynchronize section collapsed by default` — **fails**: markup missing.
   - `settings archive resynchronize › clears the archive caches, then restarts the backfill queue` — **fails**: `resynchronizeArchive` is not a function.
   - `settings archive resynchronize › reports a failed resynchronize and releases the button` — **fails**.
   - `settings archive resynchronize › ignores a second run while one is in flight` — **fails**.
2. **Green** — implement steps 3, 4 and 5. Nothing beyond what the named tests demand.
3. **Refactor** — only if needed. Keep green. Do not "simplify" the coverage test by replacing the parse + reflection cross-check with a literal list of method names: that list is exactly the thing this ticket exists to eliminate.

## Test plan

Run: `npm run test -- src/app/data/archive-cache-invalidation.test.ts src/app/features/settings/settings.component.test.ts`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `archive cache invalidation › the source parse sees every member the prototype has` | parsed member names from `archive-repository.service.ts`; `Object.getOwnPropertyNames(ArchiveRepository.prototype)` | every runtime name except `constructor` is in the parsed set; assertion message names the missing member |
| `archive cache invalidation › declares no arrow-function member` | class body of `ArchiveRepository` | `/\n {2}(?:private |protected |public |readonly |static )*[A-Za-z_$][\w$]*(?:\s*:[^=\n]+)?\s*=\s*(?:async\s*)?\(/` finds nothing |
| `archive cache invalidation › exactly one private wrapper carries the invalidation` | members whose body contains `this.invalidateArchiveCaches()`, excluding the funnel itself | exactly one, and it is `private` |
| `archive cache invalidation › every mutating method reaches the invalidation funnel` | non-private members minus `constructor`, `invalidateArchiveCaches`, the wrapper, and names matching `/^(list|get|load|read|find|count|has|is)/` | each body contains `this.<wrapper>(` or `this.invalidateArchiveCaches()`; failure message lists the offenders by name |
| `archive cache invalidation › invalidateArchiveCaches clears the stores before it announces` | body of `invalidateArchiveCaches` | contains `this.archiveCache.clearAll()` and `new CustomEvent(ARCHIVE_UPDATED_EVENT)`; `indexOf` of the first `<` `indexOf` of the second |
| `archive cache invalidation › the wrapper invalidates only after the write` | body of the wrapper | `indexOf('await action()')` `<` `indexOf('this.invalidateArchiveCaches()')` |
| `archive cache invalidation › the app shell listens for the archive announcement` | `src/app/app.component.ts` source | contains `window.addEventListener(ARCHIVE_UPDATED_EVENT` |
| `archive cache invalidation › keeps the legacy League listener alive` | `src/app/app.component.ts` source | still contains `window.addEventListener('gones-league-updated'` |
| `archive cache invalidation › the repository never touches IndexedDB directly` | `archive-repository.service.ts` source | matches neither `/\bindexedDB\b/` nor `/\bIDB[A-Z]\w*/` |
| `archive cache invalidation › announces with no payload` | body of `invalidateArchiveCaches` | contains `new CustomEvent(ARCHIVE_UPDATED_EVENT)` and not `detail:` |
| `settings archive resynchronize › keeps the resynchronize section collapsed by default` | `settings.component.ts` source | contains `data-cy="settings-archive-resync-panel" [expanded]="false"`; source does not contain `archiveResyncPanelExpanded` |
| `settings archive resynchronize › clears the archive caches, then restarts the backfill queue` | stub repo + queue recording call order into an array | order is `['invalidate', 'restart']`; `archiveResyncMessage()` is `'settings.archiveResyncDone'`; `archiveResyncing()` is `false` |
| `settings archive resynchronize › reports a failed resynchronize and releases the button` | `archiveBackfill.restart` rejects with `new Error('boom')` | `archiveResyncMessage()` is `'settings.archiveResyncFailed'`; `archiveResyncing()` is `false`; `console.error` was called once |
| `settings archive resynchronize › ignores a second run while one is in flight` | `archiveResyncing` seeded `true` | `invalidateArchiveCaches` not called; `restart` not called |
| existing `message namespace › en and fr have identical key sets` | `src/app/i18n/messages.ts` | still green after the five new keys land in both catalogues |
| existing `app shell drops the League catalog snapshot on mutation` (4 tests) | unchanged | still green — the legacy seam was not touched |

## Impl steps

- [ ] **1. Red: write the structural coverage test.**
  - [ ] 1.1 Create `src/app/data/archive-cache-invalidation.test.ts` with exactly this content:
    ```ts
    import '@angular/compiler';
    import { readFileSync } from 'node:fs';
    import { dirname, join } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { describe, expect, it } from 'vitest';
    import { ArchiveRepository } from './archive-repository.service';

    /**
     * The gap this file closes: invalidation *working* and invalidation *staying wired* are two
     * different properties, and only the first one was ever observable. Six mutation sites announced
     * themselves correctly and nothing at all would have gone red when a seventh forgot to.
     *
     * So this is deliberately not a list of method names. It reads the class back out of its own
     * source, cross-checks that reading against the runtime prototype so a parse miss cannot pass for
     * a clean sheet, and then holds every member that is not visibly a read to the funnel. A method
     * added tomorrow is guilty until its author either routes it or names it as a read.
     */

    const dataRoot = dirname(fileURLToPath(import.meta.url));
    const repositoryPath = join(dataRoot, 'archive-repository.service.ts');
    const repositorySource = readFileSync(repositoryPath, 'utf8');
    const shellSource = readFileSync(join(dataRoot, '..', 'app.component.ts'), 'utf8');

    const CLASS_HEADER = 'export class ArchiveRepository {';
    const FUNNEL = 'invalidateArchiveCaches';

    /**
     * Read verbs. A member whose name starts with one of these is a read and is exempt. Everything
     * else is presumed to mutate — that presumption is the whole point, and widening this list is the
     * one way to weaken this file, so widen it only for a member that genuinely reads.
     */
    const READ_PREFIXES = ['list', 'get', 'load', 'read', 'find', 'count', 'has', 'is'];

    interface Member {
      name: string;
      isPrivate: boolean;
      isGetter: boolean;
      body: string;
    }

    /** From the first `{` at or after `from` to the `}` that balances it. Braces stay balanced inside
     *  template-literal interpolations, so `${...}` is safe; a comment holding an unbalanced brace is
     *  not, and the cross-check below is what catches that. */
    function blockAt(source: string, from: number): string {
      const start = source.indexOf('{', from);
      expect(start, `no block after index ${from}`).toBeGreaterThan(-1);
      let depth = 0;
      for (let index = start; index < source.length; index++) {
        if (source[index] === '{') depth++;
        else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
      }
      throw new Error(`unbalanced block after index ${from}`);
    }

    function classBody(): string {
      const at = repositorySource.indexOf(CLASS_HEADER);
      expect(at, CLASS_HEADER).toBeGreaterThan(-1);
      return blockAt(repositorySource, at);
    }

    /** Every method declared at class-body indentation. Fields and accessors of the `x = signal()`
     *  kind are not methods and are not returned. */
    function members(): Member[] {
      const body = classBody();
      const header = /\n {2}(?<modifiers>(?:private |protected |public |static |readonly |async |get |set )*)(?<name>[A-Za-z_$][\w$]*)\s*(?:<[^<>]*>)?\(/g;
      const found: Member[] = [];
      for (const match of body.matchAll(header)) {
        const modifiers = match.groups?.modifiers ?? '';
        const name = match.groups?.name ?? '';
        found.push({
          name,
          isPrivate: modifiers.includes('private ') || modifiers.includes('protected '),
          isGetter: modifiers.includes('get '),
          body: blockAt(body, (match.index ?? 0) + match[0].length)
        });
      }
      return found;
    }

    function memberNamed(name: string): Member {
      const member = members().find((candidate) => candidate.name === name);
      expect(member, `member ${name}`).toBeDefined();
      return member!;
    }

    /** The wrapper is discovered, never named: this file must not care what T12 called its private
     *  mutation helper, only that there is exactly one of them and that it invalidates. */
    function wrapper(): Member {
      const carriers = members().filter((member) => member.name !== FUNNEL && member.body.includes(`this.${FUNNEL}()`));
      expect(carriers.map((member) => member.name), 'members calling the funnel').toHaveLength(1);
      return carriers[0];
    }

    describe('archive cache invalidation', () => {
      it('the source parse sees every member the prototype has', () => {
        const parsed = new Set(members().map((member) => member.name));
        const runtime = Object.getOwnPropertyNames(ArchiveRepository.prototype).filter((name) => name !== 'constructor');
        expect(runtime.filter((name) => !parsed.has(name))).toEqual([]);
      });

      it('declares no arrow-function member', () => {
        // An arrow property is on the instance, not the prototype, and its header does not match the
        // member scanner — it would be invisible to both halves of this file at once.
        const arrowMember = /\n {2}(?:private |protected |public |readonly |static )*[A-Za-z_$][\w$]*(?:\s*:[^=\n]+)?\s*=\s*(?:async\s*)?\(/;
        expect(classBody()).not.toMatch(arrowMember);
      });

      it('exactly one private wrapper carries the invalidation', () => {
        expect(wrapper().isPrivate).toBe(true);
      });

      it('every mutating method reaches the invalidation funnel', () => {
        const funnelName = wrapper().name;
        const offenders = members()
          .filter((member) => !member.isPrivate && !member.isGetter)
          .filter((member) => member.name !== FUNNEL && member.name !== funnelName)
          .filter((member) => !READ_PREFIXES.some((prefix) => member.name.startsWith(prefix)))
          .filter((member) => !member.body.includes(`this.${funnelName}(`) && !member.body.includes(`this.${FUNNEL}()`))
          .map((member) => member.name);
        expect(offenders, 'mutating methods that skip the invalidation funnel').toEqual([]);
      });

      it('invalidateArchiveCaches clears the stores before it announces', () => {
        const body = memberNamed(FUNNEL).body;
        expect(body).toContain('this.archiveCache.clearAll()');
        expect(body).toContain('new CustomEvent(ARCHIVE_UPDATED_EVENT)');
        expect(body.indexOf('this.archiveCache.clearAll()')).toBeLessThan(body.indexOf('ARCHIVE_UPDATED_EVENT'));
      });

      it('announces with no payload', () => {
        // Listeners re-read. A payload would invite one of them to trust it and skip the read.
        expect(memberNamed(FUNNEL).body).not.toContain('detail:');
      });

      it('the wrapper invalidates only after the write', () => {
        const body = wrapper().body;
        expect(body.indexOf('await action()')).toBeGreaterThan(-1);
        expect(body.indexOf('await action()')).toBeLessThan(body.indexOf(`this.${FUNNEL}()`));
      });

      it('the repository never touches IndexedDB directly', () => {
        // `server-authority-boundary.test.ts` holds an exact allowlist of files that may. This one is
        // not on it, and clearing goes through `archive-cache.service.ts`, which is.
        expect(repositorySource).not.toMatch(/\bindexedDB\b/);
        expect(repositorySource).not.toMatch(/\bIDB[A-Z]\w*/);
      });

      it('the app shell listens for the archive announcement', () => {
        expect(shellSource).toContain('window.addEventListener(ARCHIVE_UPDATED_EVENT');
      });

      it('keeps the legacy League listener alive', () => {
        // The legacy League pages still dispatch this and are still routed. Removing it here would
        // break them; retiring it is the legacy-surface ticket's job, not this one's.
        expect(shellSource).toContain("window.addEventListener('gones-league-updated'");
      });
    });
    ```
  - [ ] 1.2 Run `npm run test -- src/app/data/archive-cache-invalidation.test.ts`. Confirm the failures named in *TDD* step 1. Do not proceed until they are red for the stated reason (missing method/listener), not for an import error.

- [ ] **2. Red: write the Settings resynchronize tests.**
  - [ ] 2.1 In `src/app/features/settings/settings.component.test.ts`, append this block at end of file (after the closing `});` of `describe('settings server catalog cache', …)`):
    ```ts
    /**
     * The Archive cache serves a locked year partition from IndexedDB forever with no request, so an
     * edit to data older than a year is invisible here until the user asks for it. That staleness is
     * an accepted risk of the caching design; this control is its escape hatch, and these tests pin
     * that it stays collapsed, single-flight, and ordered clear-then-refill.
     */
    describe('settings archive resynchronize', () => {
      it('keeps the resynchronize section collapsed by default', () => {
        expect(source).toContain('data-cy="settings-archive-resync-panel" [expanded]="false"');
        expect(source).not.toContain('archiveResyncPanelExpanded');
      });

      it('clears the archive caches, then restarts the backfill queue', async () => {
        const order: string[] = [];
        const archiveRepo = { invalidateArchiveCaches: vi.fn(async () => { order.push('invalidate'); }) };
        const archiveBackfill = { restart: vi.fn(async () => { order.push('restart'); }) };
        const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
        Object.assign(component, {
          archiveRepo,
          archiveBackfill,
          i18n: { t: (key: string) => key },
          archiveResyncing: signal(false),
          archiveResyncMessage: signal('')
        });
        const logged = vi.spyOn(console, 'info').mockImplementation(() => undefined);

        await component.resynchronizeArchive();

        expect(order).toEqual(['invalidate', 'restart']);
        expect(component.archiveResyncMessage()).toBe('settings.archiveResyncDone');
        expect(component.archiveResyncing()).toBe(false);
        logged.mockRestore();
      });

      it('reports a failed resynchronize and releases the button', async () => {
        const archiveRepo = { invalidateArchiveCaches: vi.fn(async () => undefined) };
        const archiveBackfill = { restart: vi.fn(async () => { throw new Error('boom'); }) };
        const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
        Object.assign(component, {
          archiveRepo,
          archiveBackfill,
          i18n: { t: (key: string) => key },
          archiveResyncing: signal(false),
          archiveResyncMessage: signal('')
        });
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await component.resynchronizeArchive();

        expect(component.archiveResyncMessage()).toBe('settings.archiveResyncFailed');
        expect(component.archiveResyncing()).toBe(false);
        expect(logged).toHaveBeenCalledTimes(1);
        logged.mockRestore();
      });

      it('ignores a second run while one is in flight', async () => {
        const archiveRepo = { invalidateArchiveCaches: vi.fn(async () => undefined) };
        const archiveBackfill = { restart: vi.fn(async () => undefined) };
        const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
        Object.assign(component, {
          archiveRepo,
          archiveBackfill,
          i18n: { t: (key: string) => key },
          archiveResyncing: signal(true),
          archiveResyncMessage: signal('')
        });

        await component.resynchronizeArchive();

        expect(archiveRepo.invalidateArchiveCaches).not.toHaveBeenCalled();
        expect(archiveBackfill.restart).not.toHaveBeenCalled();
      });
    });
    ```
  - [ ] 2.2 Run `npm run test -- src/app/features/settings/settings.component.test.ts`. Confirm the four new tests fail and the existing ones stay green.

- [ ] **3. Green: the repository funnel.**
  - [ ] 3.1 Run `grep -n "private async .*<T>(action" src/app/data/archive-repository.service.ts` and record the result.
    - Output is **one line** → that method is the wrapper. Note its name as `<wrapper>` and go to 3.1a.
    - Output is **empty** → there is no wrapper. Go to 3.1b.
  - [ ] 3.1a (only if 3.1 printed a line) Inside that method, replace the line that returns the action's result so the body reads exactly:
    ```ts
        const result = await action();
        await this.invalidateArchiveCaches();
        return result;
    ```
    Keep every other statement the method already had, in place, above `const result = await action();` if it is a precondition (for example a `requireEnabled()` call) and below `await this.invalidateArchiveCaches();` otherwise. Add no second wrapper.
  - [ ] 3.1b (only if 3.1 printed nothing) Add this private method to `ArchiveRepository`, placed immediately above the first other `private` member of the class:
    ```ts
      /**
       * Every mutating method's one exit: run the write, then invalidate. Invalidating before the
       * write, or invalidating when it threw, would drop a good cache and refill it from data the
       * failed write never changed.
       */
      private async mutating<T>(action: () => Promise<T>): Promise<T> {
        const result = await action();
        await this.invalidateArchiveCaches();
        return result;
      }
    ```
    Then rewrite every mutating public method of `ArchiveRepository` to return `this.mutating(() => …)` wrapping the body it has today, leaving read methods untouched. The test `every mutating method reaches the invalidation funnel` names any method still outside.
  - [ ] 3.2 Run `grep -n "clearAll" src/app/backend/archive-cache.service.ts`.
    - Output is **non-empty** → `ArchiveCacheService.clearAll()` already exists; skip 3.2a and 3.2b.
    - Output is **empty** → do 3.2a, then 3.2b.
  - [ ] 3.2a (only if 3.2 printed nothing) Run `grep -n "IDBDatabase" src/app/backend/archive-cache.service.ts`. If it prints a field declaration such as `private database?: IDBDatabase;` or `private database?: Promise<IDBDatabase>;`, note the field name printed as `<handle>`; if it prints nothing, there is no `<handle>`.
  - [ ] 3.2b (only if 3.2 printed nothing) Add this public method to `ArchiveCacheService`, immediately after its last public method:
    ```ts
      /**
       * Drops every record in every `gones-archive-cache` store. Never rejects: an unavailable,
       * blocked or corrupt cache is already unusable, and the repair path must not fail because the
       * thing it repairs is broken. A10 keeps the authored archive in a different database, so this
       * cannot destroy a user-authored record.
       */
      async clearAll(): Promise<void> {
        await new Promise<void>((resolve) => {
          const factory = globalThis.indexedDB;
          if (!factory) {
            resolve();
            return;
          }
          const request = factory.deleteDatabase(ARCHIVE_CACHE_DB_NAME);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        });
      }
    ```
    If 3.2a found a `<handle>` field, insert these two lines as the **first** statements of `clearAll()`, before the `await new Promise…`, substituting the field name it printed — an open handle blocks `deleteDatabase` forever:
    ```ts
        (await this.<handle>)?.close();
        this.<handle> = undefined;
    ```
  - [ ] 3.3 In `src/app/data/archive-repository.service.ts`, add the exported event name directly above the `@Injectable({ providedIn: 'root' })` decorator of `ArchiveRepository`:
    ```ts
    /**
     * The one announcement the whole archive makes. Exported so the shell listener and this
     * dispatcher cannot drift apart: a typo in either half is a compile error, not a silently dead
     * listener.
     */
    export const ARCHIVE_UPDATED_EVENT = 'gones-archive-updated';
    ```
  - [ ] 3.4 In the same file, add `import { ArchiveCacheService } from '../backend/archive-cache.service';` to the import block, keeping the existing import ordering.
  - [ ] 3.5 In `ArchiveRepository`, add the injected cache beside the other injected fields:
    ```ts
      private readonly archiveCache = inject(ArchiveCacheService);
    ```
  - [ ] 3.6 In `ArchiveRepository`, add the funnel as the **last public method** of the class, above the private section:
    ```ts
      /**
       * The single funnel every archive mutation goes through: drop every cached public catalog copy,
       * then announce the change so the shell can rebuild what it is showing.
       *
       * Never rejects. The write it follows has already succeeded; a cache that cannot be dropped is a
       * cache problem, not a mutation failure, and must not be reported to the user as one.
       */
      async invalidateArchiveCaches(): Promise<void> {
        await this.archiveCache.clearAll();
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ARCHIVE_UPDATED_EVENT));
      }
    ```
  - [ ] 3.7 Run `npm run test -- src/app/data/archive-cache-invalidation.test.ts`. Every test except `the app shell listens for the archive announcement` must now be green.

- [ ] **4. Green: the shell listener.**
  - [ ] 4.1 In `src/app/app.component.ts`, add to the import block: `import { ARCHIVE_UPDATED_EVENT } from './data/archive-repository.service';` — keep it beside the existing `import { LeagueArchiveRepository } from './data/league-archive-repository.service';`.
  - [ ] 4.2 In the `AppComponent` constructor, insert this **immediately after** the closing `});` of the existing `window.addEventListener('gones-league-updated', …)` block (currently ending at line 168) and **before** `this.router.events.pipe(...)`:
    ```ts
        // The archive rebuild's own announcement. It sits beside the legacy `gones-league-updated`
        // listener rather than replacing it: the legacy League pages still dispatch that one and are
        // still routed, so both have to work at once. This handler clears no cache —
        // `invalidateArchiveCaches()` already did, before it dispatched.
        window.addEventListener(ARCHIVE_UPDATED_EVENT, () => {
          void this.updateRouteState(this.router.url);
        });
    ```
  - [ ] 4.3 Run `npm run test -- src/app/data/archive-cache-invalidation.test.ts src/app/app.component.league-catalog-cache.test.ts`. Both files fully green.

- [ ] **5. Green: the Settings resynchronize control.**
  - [ ] 5.1 Run `grep -n "restart" src/app/backend/archive-backfill-queue.ts`.
    - Output is **non-empty** → `ArchiveBackfillQueue.restart()` already exists; skip 5.2.
    - Output is **empty** → do 5.2.
  - [ ] 5.2 (only if 5.1 printed nothing) Add this public method to `ArchiveBackfillQueue`, immediately after its last public method:
    ```ts
      /**
       * Cancels in-flight work, empties the queue, re-enqueues every year that is not cached, and
       * starts draining. Resolves once the queue has been re-armed, not once it has drained: a
       * multi-year backfill must not block the button that started it.
       */
      async restart(): Promise<void> {
        this.cancelInFlight();
        this.queue.length = 0;
        await this.enqueueMissingYears();
        void this.drain();
      }
    ```
    Substitute the file's own names for the cancel, queue, enqueue and drain members — `grep -n "private " src/app/backend/archive-backfill-queue.ts` lists them; the four responsibilities above map one-to-one onto members that already exist, because the queue already performs them on first load.
  - [ ] 5.3 In `src/app/features/settings/settings.component.ts`, add to the import block:
    ```ts
    import { ArchiveBackfillQueue } from '../../backend/archive-backfill-queue';
    import { ArchiveRepository } from '../../data/archive-repository.service';
    ```
  - [ ] 5.4 In `SettingsComponent`, add the injected collaborators beside the existing `private readonly localBackend = inject(LocalLeagueArchiveBackend);`:
    ```ts
      private readonly archiveRepo = inject(ArchiveRepository);
      private readonly archiveBackfill = inject(ArchiveBackfillQueue);
    ```
  - [ ] 5.5 In `SettingsComponent`, add the two signals directly after `readonly playerEdits = signal<Record<string, string>>({});`:
    ```ts
      readonly archiveResyncing = signal(false);
      readonly archiveResyncMessage = signal('');
    ```
  - [ ] 5.6 In `SettingsComponent`, add this method directly after `blurExpansionHeader(event: Event): void { … }` (currently ending near line 579):
    ```ts
      /**
       * The escape hatch for the one staleness the cache design accepts: a locked year partition is
       * served from IndexedDB with no request at all, so an edit to data older than a year is
       * invisible here until the user asks for it. This is that ask — clear first, then refill, so
       * the queue cannot decide a year it just dropped is still present.
       */
      async resynchronizeArchive(): Promise<void> {
        if (this.archiveResyncing()) return;
        this.archiveResyncing.set(true);
        this.archiveResyncMessage.set('');
        try {
          await this.archiveRepo.invalidateArchiveCaches();
          await this.archiveBackfill.restart();
          this.archiveResyncMessage.set(this.i18n.t('settings.archiveResyncDone'));
          logBoundaryInfo('settings.resynchronizeArchive');
        } catch (error) {
          logBoundaryError('settings.resynchronizeArchive', error);
          this.archiveResyncMessage.set(this.i18n.t('settings.archiveResyncFailed'));
        } finally {
          this.archiveResyncing.set(false);
        }
      }
    ```
  - [ ] 5.7 In the `SettingsComponent` template, insert this card **between** the closing `}` of the local-players `@if` block (currently line 435) and the `@if (capabilities().orgNotifications && ownedOrganizations().length) {` block (currently line 437), separated by one blank line on each side. It carries **no `@if` guard**: it repairs a public read cache, and gating it would hide the escape hatch from the anonymous visitor most likely to be looking at stale locked data.
    ```html
      <mat-card class="panel settings-panel settings-archetype-panel-card" data-cy="settings-archive-resync-card">
        <mat-card-content data-cy="settings-archive-resync-card-content">
          <mat-expansion-panel class="settings-collapsible-panel settings-archetype-panel" data-cy="settings-archive-resync-panel" [expanded]="false">
            <mat-expansion-panel-header (click)="blurExpansionHeader($event)" data-cy="settings-archive-resync-panel-header">
              <mat-panel-title data-cy="settings-archive-resync-panel-title">{{ i18n.t('settings.archiveResync') }}</mat-panel-title>
            </mat-expansion-panel-header>

            <p class="muted settings-archetype-copy" data-cy="settings-archive-resync-copy">{{ i18n.t('settings.archiveResyncHelp') }}</p>

            <button mat-stroked-button type="button" class="secondary-action" data-cy="settings-archive-resync-button" [disabled]="archiveResyncing()" (click)="resynchronizeArchive()">{{ archiveResyncing() ? i18n.t('settings.archiveResyncRunning') : i18n.t('settings.archiveResync') }}</button>

            @if (archiveResyncMessage()) { <p class="settings-saved" role="status" data-cy="settings-archive-resync-status">{{ archiveResyncMessage() }}</p> }
          </mat-expansion-panel>
        </mat-card-content>
      </mat-card>
    ```
  - [ ] 5.8 In `src/app/i18n/messages.ts`, insert these five lines in the `en` catalogue directly after line 516 (`'settings.orgSaveFailed': 'Could not save preferences for {name}.',`):
    ```ts
      'settings.archiveResync': 'Resynchronize everything',
      'settings.archiveResyncRunning': 'Resynchronizing…',
      'settings.archiveResyncHelp': 'Clears every copy of the Archive cached in this browser and downloads it again. Use it when a League Season or a Tournament looks out of date: an edit made to data older than a year is not visible here until you ask for it. Nothing you created is deleted.',
      'settings.archiveResyncDone': 'Archive cache cleared. Fresh data is downloading.',
      'settings.archiveResyncFailed': 'Could not resynchronize the Archive.',
    ```
  - [ ] 5.9 In the same file, insert these five lines in the `fr` catalogue directly after line 1759 (`'settings.orgSaveFailed': 'Impossible d’enregistrer les préférences pour {name}.',` — the line number shifts by +5 after step 5.8, so anchor on the string, not the number):
    ```ts
      'settings.archiveResync': 'Tout resynchroniser',
      'settings.archiveResyncRunning': 'Resynchronisation…',
      'settings.archiveResyncHelp': 'Vide toutes les copies de l’archive mises en cache dans ce navigateur et les télécharge à nouveau. À utiliser lorsqu’une saison de ligue ou un tournoi semble périmé : une modification apportée à des données de plus d’un an n’apparaît ici que si vous la demandez. Rien de ce que vous avez créé n’est supprimé.',
      'settings.archiveResyncDone': 'Cache de l’archive vidé. Les données fraîches sont en cours de téléchargement.',
      'settings.archiveResyncFailed': 'Impossible de resynchroniser l’archive.',
    ```
  - [ ] 5.10 Run `npm run test -- src/app/features/settings/settings.component.test.ts src/app/i18n/message-namespace.test.ts`. All green.

- [ ] **6. Validate the whole slice.**
  - [ ] 6.1 Run `npm run test`.
  - [ ] 6.2 Run `npm run typecheck`.
  - [ ] 6.3 Run `npm run lint`.
  - [ ] 6.4 Run `npm run build`.
  - [ ] 6.5 Manual check per *Validation* below.
  - [ ] 6.6 Confirm the fence held: `git diff --name-only` lists only the files in *Outputs*, and `grep -c "gones-league-updated" src/app/app.component.ts src/app/features/leagues-archive/league-archive-detail.component.ts src/app/features/tournaments-archive/tournament-archive-detail.component.ts` prints `1`, `2`, `1`.

## Outputs

**Files touched:**

| File | Change |
| --- | --- |
| `src/app/data/archive-cache-invalidation.test.ts` | **new** — the structural coverage test |
| `src/app/data/archive-repository.service.ts` | `ARCHIVE_UPDATED_EVENT`, `archiveCache` injection, `invalidateArchiveCaches()`, the private wrapper's invalidation line (and, if T12 shipped no wrapper, the wrapper plus the rewrite of every mutating method through it) |
| `src/app/backend/archive-cache.service.ts` | `clearAll()` — **only if** step 3.2 found it absent |
| `src/app/backend/archive-backfill-queue.ts` | `restart()` — **only if** step 5.1 found it absent |
| `src/app/app.component.ts` | `ARCHIVE_UPDATED_EVENT` import + the second window listener |
| `src/app/features/settings/settings.component.ts` | two imports, two injections, two signals, `resynchronizeArchive()`, the collapsed resync card |
| `src/app/features/settings/settings.component.test.ts` | four appended tests |
| `src/app/i18n/messages.ts` | five keys in `en`, five in `fr` |

**Public API / behaviour change:**

- New public method `ArchiveRepository.invalidateArchiveCaches(): Promise<void>` and new exported constant `ARCHIVE_UPDATED_EVENT`.
- New window event `gones-archive-updated`, dispatched with no `detail`, handled by `AppComponent`.
- New Settings section "Resynchronize everything", collapsed by default, available to every visitor.

**Migrate / config:** none. No migration, no config key, no env var, no endpoint, no generated-client change — `npm run api:generate` output is untouched.

## Validation

- [ ] `npm run test` — exit code `0`. New file `src/app/data/archive-cache-invalidation.test.ts` reports 10 passing tests; `src/app/features/settings/settings.component.test.ts` reports its 4 new tests plus the 8 pre-existing ones; `src/app/app.component.league-catalog-cache.test.ts` reports its 4 pre-existing tests still passing; `src/app/i18n/message-namespace.test.ts` still passes `en and fr have identical key sets`; `src/app/backend/server-authority-boundary.test.ts` still passes `confines IndexedDB to the sanctioned local adapters`.
- [ ] `npm run typecheck` — exit code `0` (`tsc --noEmit` over `tsconfig.app.json` and `tsconfig.spec.json`).
- [ ] `npm run lint` — exit code `0`.
- [ ] `npm run build` — exit code `0`; the app compiles with both the archive and the legacy archive surfaces present.
- [ ] **The coverage test actually bites.** Prove it, do not assume it: temporarily add
  ```ts
    async touchEverything(): Promise<void> { return; }
  ```
  to `ArchiveRepository`, run `npm run test -- src/app/data/archive-cache-invalidation.test.ts`, and confirm `every mutating method reaches the invalidation funnel` fails with `touchEverything` named in the diff. **Remove the method again** and confirm green.
- [ ] **Manual, browser.** `npm run dev:env`, then:
  1. Open `/archive/league-seasons`, let the table load, and confirm in DevTools → Application → IndexedDB that `gones-archive-cache` holds rows.
  2. Rename a League Season from `/archive/league-seasons/:seasonId`. Confirm the `gones-archive-cache` stores are empty immediately after the save and repopulate on the next load, and that the breadcrumb shows the new name without a manual refresh.
  3. Open `/settings`. Confirm the "Resynchronize everything" section is **collapsed** on arrival, expands on click, and that its button clears `gones-archive-cache` and shows `Archive cache cleared. Fresh data is downloading.`
  4. Switch the language to French and confirm all five strings render translated, with no raw key visible.
  5. Open a legacy `/leagues-archive/:leagueId` page, rename the League, and confirm the legacy `localStorage` key `gones.leagues-archive.catalog.v2` is still dropped — the legacy seam is untouched.
- [ ] **App functional — no broken path from this slice.** Both listeners are registered; neither archive surface lost a behaviour; no route, endpoint or table changed.
- [ ] Commit msg draft: `feat(archive): funnel every mutation through one cache invalidation and give the user a resync`
