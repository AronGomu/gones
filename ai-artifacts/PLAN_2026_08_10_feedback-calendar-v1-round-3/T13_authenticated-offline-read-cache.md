# T13: Authenticated offline read cache

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** none
**Commit outcome:** Everything a signed-in visitor already loaded from the server — their League Archives and, for an Organizer or Admin, their running tournaments — is cached in this browser and served back when the network is gone. A successful server read always overwrites its cache row.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice covers the second half of feedback #14 — "whenever a user logs in and retrieves all their remote data, it is cached and stored locally, so that the next time the user connects to the website without an internet connection, they should see everything that has already been loaded", plus its conflict rule — "the remote data always prevails and erases the local data" — as it applies to the cache.
- This slice: the cache itself. T14 then applies "remote prevails" to the local deck-archetype catalog on sign-in.
- Out of scope here: writes. Nothing in the cache is ever sent to the server, ever replayed, and no mutation is queued while offline. The browser-local League store (`gones-leagues`) and Live store (`gones-live`) are separate authorities and are untouched. The anonymous public calendar cache (`localStorage` `gones.calendar-v1.all-tournaments`) is untouched.
- Assumptions in force:
  - The cache is **per user and dies on logout**. Rows are keyed `<userId>:<resource>`; `SessionScopeService.clear()` deletes the whole database. Keeping user A's private rows readable by user B in the same browser would be a data leak.
  - The cache is a **read** cache only: a cache hit is a degraded answer, never a source of truth, and it never merges with a server response.
  - Read `docs/adr/0031-authenticated-offline-read-cache.md` before coding.
  - No TestBed — services are constructed directly with fakes.

## Inputs

- `src/app/backend/indexed-db.ts` — the only promise wrapper allowed to touch raw IndexedDB. Exports `openDatabase(name, version, upgrade)`, `getAll<T>(db, store)`, `get<T>(db, store, key)`, `put(db, store, value)`, `remove(db, store, key)`. Rejections carry `Error('indexedDbUnavailable' | 'indexedDbOpenFailed' | 'indexedDbBlocked' | …)`.
- `src/app/backend/server-authority-boundary.test.ts` — **this ticket must edit it.** Its test `confines IndexedDB to the sanctioned local adapters` asserts that the files matching `/\bindexedDB\b|\bIDB[A-Z]\w*/` are exactly `src/app/backend/indexed-db.ts`, `src/app/backend/local-league-archive-backend.service.ts`, `src/app/backend/local-live-backend.service.ts`. The new cache service uses the `IDBDatabase` type, so it must be added to that list with a comment naming ADR 0031. Its comment already says "Adding a file here is an ADR decision" — this is that decision.
- `src/app/auth/auth.service.ts`:
  - `readonly profile = signal<UserProfileResponse | null>(null)` (exposed as `auth.profile()`), `readonly enabled`.
  - `private readonly sessionScope = inject(SessionScopeService);`
  - `clear(): void { this.tokens.clear(); this.profile.set(null); this.sessionScope.clear(); }` — called by `logout()`, by a failed bootstrap and by account deletion.
  - `async login(request) { this.acceptToken(await firstValueFrom(this.client.login(request))); return this.loadProfile(); }`
- `src/app/auth/session-scope.service.ts` — `SessionScopeService` with `register(reset: () => void)`, `clear()` (runs every registered reset, then purges service-worker API caches). Registering the cache purge here is the intended extension point.
- `src/app/data/league-archive-repository.service.ts` — `LeagueArchiveRepository`, injects `LEAGUE_ARCHIVE_BACKEND` as `server` and `LocalLeagueArchiveBackend` as `local`. Its `listLeagues()` today:
  ```ts
  const [server, local] = await Promise.allSettled([this.server.listLeagueArchives(), this.local.listLeagueArchives()]);
  this.serverUnavailable.set(server.status === 'rejected');
  if (server.status === 'rejected' && local.status === 'rejected') throw server.reason;
  return [...(server.status === 'fulfilled' ? server.value : []), ...(local.status === 'fulfilled' ? local.value : [])];
  ```
  and `getLeague(id)` routes with `this.port(id)` on `isLocalLeagueId(id)`.
- `src/app/data/live-tournament-repository.service.ts` — `LiveTournamentRepository`, `constructor(@Inject(LIVE_BACKEND) private readonly backend: LiveBackendPort)`, methods `list()`, `get(id)`.
- `src/app/backend/application-backend.ts` — `LIVE_BACKEND_MODE` injection token resolving to `'aspnet-api'` (Organizer/Admin) or `'browser-local'` (anonymous/User); `LIVE_BACKEND` picks the adapter from it.
- `src/app/data/league-archive-origin.ts` — `isLocalLeagueId(id)`.
- **From Depends:** none.

## Requirements

### New service

`src/app/backend/server-read-cache.service.ts`:

```ts
export const SERVER_READ_CACHE_DB_NAME = 'gones-cache';
export const SERVER_READ_CACHE_STORE = 'reads';
const SERVER_READ_CACHE_DB_VERSION = 1;

export interface CachedRead<T> { value: T; cachedAt: string; }
export interface ServerReadResult<T> { value: T; stale: boolean; cachedAt?: string; }

@Injectable({ providedIn: 'root' })
export class ServerReadCacheService {
  /**
   * Read-through with an offline fallback (ADR 0031). A fulfilled load always overwrites the cache
   * row — remote prevails, unconditionally. A rejected load falls back to the row when there is one,
   * flagged stale, and rethrows when there is not. Anonymous callers are passed straight through and
   * cache nothing.
   */
  async read<T>(resource: string, load: () => Promise<T>): Promise<ServerReadResult<T>>;

  /** Drops the whole database. Registered with SessionScopeService, so logout purges it. */
  async purge(): Promise<void>;
}
```

- The row shape stored under key `<userId>:<resource>` is `{ key, value, cachedAt }`; the object store is created with `keyPath: 'key'`.
- `userId` comes from `inject(AuthService).profile()?.id`. When it is `undefined`, `read` returns `{ value: await load(), stale: false }` and writes nothing.
- Every IndexedDB failure is swallowed on the write path (`logBoundaryError('server-read-cache.write', error)`) — a broken cache must never break a working server read.
- On the read path, an IndexedDB failure is treated as a cache miss.
- The constructor calls `inject(SessionScopeService).register(() => void this.purge())`.
- If `AuthService.profile()` exposes the user id under a different field name than `id`, use whatever `UserProfileResponse` actually declares; pick the stable identifier, not the email.

### Wiring

- `LeagueArchiveRepository`:
  - inject `ServerReadCacheService` as `cache`.
  - `listLeagues()` wraps only the **server** half:
    ```ts
    const serverRead = this.cache.read('leagues', () => this.server.listLeagueArchives());
    const [server, local] = await Promise.allSettled([serverRead, this.local.listLeagueArchives()]);
    ```
    and unwraps `.value`. `serverUnavailable` becomes `server.status === 'rejected' || (server.status === 'fulfilled' && server.value.stale)` — a cached answer is still "the server is not reachable", which is what the existing banner says.
  - `getLeague(id)` wraps the server branch only: when `!isLocalLeagueId(id)`, `return (await this.cache.read(`league:${id}`, () => this.server.getLeagueArchive(id))).value;`.
- `LiveTournamentRepository`:
  - inject `LIVE_BACKEND_MODE` and `ServerReadCacheService`.
  - `list()` and `get(id)` go through the cache **only** when the mode is `'aspnet-api'`; the browser-local adapter is already offline and must not be double-stored.
- No mutation method is wrapped. A mutation that fails offline still fails.

### Boundary test

Add to the allowlist in `src/app/backend/server-authority-boundary.test.ts`:

```ts
// Per-user offline read cache for server responses (ADR 0031). Reads only; purged on logout.
'src/app/backend/server-read-cache.service.ts',
```
keeping the array alphabetically sorted as `filesMatching` returns it.

## TDD

1. **Red** — write `src/app/backend/server-read-cache.service.test.ts` with the six tests below, plus the two repository tests. All fail.
2. **Green** — write the service, wire the two repositories, extend the boundary allowlist.
3. **Refactor** — only if needed. Keep green.

## Test plan

Construct `ServerReadCacheService` directly with a fake store rather than a real IndexedDB. Extract the
persistence behind a tiny private seam so a test can substitute it:

```ts
// exported for tests only
export interface ServerReadCacheStore {
  read(key: string): Promise<CachedRead<unknown> | null>;
  write(key: string, entry: CachedRead<unknown>): Promise<void>;
  clear(): Promise<void>;
}
```

The service takes the real IndexedDB-backed store by default and accepts an override in the constructor.

| Test | Input | Expect |
| --- | --- | --- |
| `a successful read is cached under the signed-in user` | profile id `u1`, `read('leagues', () => Promise.resolve([1]))` | resolves `{ value: [1], stale: false }`; the fake store holds key `'u1:leagues'` |
| `a successful read overwrites whatever was cached` | store pre-seeded with `'u1:leagues'` → `[9]`, then `read('leagues', () => Promise.resolve([1]))` | resolves `{ value: [1] }`; the stored value is `[1]`, not a merge |
| `a failed read falls back to the cached row and flags it stale` | store pre-seeded with `'u1:leagues'` → `[9]`, `read('leagues', () => Promise.reject(new Error('offline')))` | resolves `{ value: [9], stale: true }` |
| `a failed read with no cached row rethrows` | empty store, same rejecting load | rejects with the original `Error('offline')` |
| `an anonymous caller is passed through and caches nothing` | profile `null`, `read('leagues', () => Promise.resolve([1]))` | resolves `{ value: [1], stale: false }`; the fake store stays empty |
| `two users do not share a row` | write as `u1`, then switch the profile to `u2` and read with a rejecting load | rejects — `u2` has no row of its own |
| `logout purges the cache` (`src/app/auth/session-scope.service.test.ts`) | a `SessionScopeService` with the cache's reset registered, then `clear()` | the registered reset ran |
| `the league repository serves a cached list when the server is unreachable` (`src/app/data/league-archive-repository.service.test.ts`) | fake server port that rejects, cache pre-seeded, fake local port returning `[]` | `listLeagues()` resolves to the cached leagues and `serverUnavailable()` is `true` |

Run: `npx vitest run src/app/backend src/app/data src/app/auth/session-scope.service.test.ts`

## Impl steps

- [x] 1. Read `docs/adr/0031-authenticated-offline-read-cache.md`. — criterion: the ADR's read/write/purge rules are restated in the implementation plan below before any code is written.
- [x] 2. Create `src/app/backend/server-read-cache.service.test.ts` with the six service tests and the fake `ServerReadCacheStore`. Confirm red. — criterion: `npx vitest run src/app/backend/server-read-cache.service.test.ts` fails with the service missing.
- [x] 3. Create `src/app/backend/server-read-cache.service.ts` with the constants, the `ServerReadCacheStore` seam, the IndexedDB-backed default store built on `openDatabase` / `get` / `put` from `./indexed-db`, `read()`, `purge()`, and the `SessionScopeService.register` call in the constructor. — criterion: the file exists and `npx vitest run src/app/backend/server-read-cache.service.test.ts` is green (all six tests).
- [x] 4. Add `'src/app/backend/server-read-cache.service.ts'` to the IndexedDB allowlist in `src/app/backend/server-authority-boundary.test.ts`, with a comment naming ADR 0031. — criterion: `npx vitest run src/app/backend/server-authority-boundary.test.ts` green with a four-entry allowlist.
- [x] 5. Run `npx vitest run src/app/backend` — green. (7 files, 90 tests passed.)
- [x] 6. Add the logout-purge test to `src/app/auth/session-scope.service.test.ts`. Confirm it passes with the constructor registration in place. — criterion: `npx vitest run src/app/auth/session-scope.service.test.ts` green, and the test proves user A's rows are cleared before user B can read them.
- [x] 7. Add the repository test to `src/app/data/league-archive-repository.service.test.ts`. Confirm red. — criterion: the new test fails before step 8's wiring lands.
- [x] 8. Wire `ServerReadCacheService` into `LeagueArchiveRepository.listLeagues()` and `getLeague(id)`, including the new `serverUnavailable` rule. — criterion: `npx vitest run src/app/data/league-archive-repository.service.test.ts` green, cached-list test included.
- [x] 9. Wire `ServerReadCacheService` and `LIVE_BACKEND_MODE` into `LiveTournamentRepository.list()` and `get(id)`, caching only when the mode is `'aspnet-api'`. — criterion: a test proves `browser-local` mode never reaches the cache and `aspnet-api` mode does.
- [x] 10. Run `npx vitest run src/app/backend src/app/data src/app/auth` — green. (33 files, 291 tests passed.)
- [x] 11. Run `npm run test && npm run lint && npm run typecheck && npm run build`. — criterion: all four exit 0. (101 files / 848 tests, "All files pass linting", clean `tsc`, bundle written to `dist/gones`.)
- [ ] 12. Manual, with `npm run dev -- --env=demo`: sign in as `organizer@gones.test`, open `/leagues-archive` and `/live-tournaments` so both load. DevTools → Application → IndexedDB shows `gones-cache` → `reads` with rows keyed by that user id. Switch DevTools → Network → Offline and reload both pages: the data still renders and the League page shows its "server unavailable" notice. Log out: `gones-cache` is gone. — criterion: human-only; recorded in `ai-artifacts/manual_test_checklist.md` under `## T13 authenticated-offline-read-cache` rather than claimed here.

## Outputs

- Files added: `src/app/backend/server-read-cache.service.ts`, `src/app/backend/server-read-cache.service.test.ts`.
- Files edited: `src/app/backend/server-authority-boundary.test.ts`, `src/app/data/league-archive-repository.service.ts`, `src/app/data/league-archive-repository.service.test.ts`, `src/app/data/live-tournament-repository.service.ts`, `src/app/auth/session-scope.service.test.ts`.
- Public API change: new `ServerReadCacheService` with `read(resource, load)` and `purge()`; new IndexedDB database `gones-cache` / store `reads`.
- Behaviour change: signed-in server reads are cached and answered from cache when the server is unreachable. No write path changes.
- Migration/config: none. No new dependency. The database is created lazily on the first signed-in read.

## Validation

- [x] `npx vitest run src/app/backend src/app/data src/app/auth` passes. (33 files, 293 tests.)
- [x] `npm run test` passes, including `src/app/backend/server-authority-boundary.test.ts` with its updated allowlist. (848 tests; the boundary file alone: 12 passed with the four-entry allowlist.)
- [x] `npm run lint` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run build` passes.
- [x] `npm run cy:run -- --spec cypress/e2e/offline-public-read.cy.js` passes — the anonymous public cache is unaffected. (Run as `steam-run npx cypress run --spec …` per this host's wrapper: 3/3 passing.)
- [ ] Manual: signed-in offline reload renders League Archives and running tournaments; logout removes `gones-cache`. — criterion: written into the manual checklist (human-only).
- [ ] Manual: signing in as a second account in the same browser does not show the first account's cached leagues. — criterion: written into the manual checklist (human-only); its automated counterpart is the `two users do not share a row` + logout-purge tests.
- [x] App functional — no broken path from this slice. — criterion: `npm run build` green and the full vitest suite green. Additionally observed in a real browser (throwaway spec, not committed): the row is written under `<userId>:leagues`, a dead server still renders the cached league with the unavailable notice, and `gones-cache` is absent from `indexedDB.databases()` after logout.
- [x] Commit msg draft: `feat(offline): cache signed-in server reads and serve them when offline` — criterion: the commit on `feat/feedback-calendar-v1-round-3` carries this subject. (`5836fb4`, pushed to `origin/feat/feedback-calendar-v1-round-3`.)
