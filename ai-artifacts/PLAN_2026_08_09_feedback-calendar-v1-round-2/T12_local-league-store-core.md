# T12: Local League store — core commands

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T1
**Commit outcome:** A `LocalLeagueArchiveBackend` service persists leagues in IndexedDB with version-guarded commands for the league-level half of `LeagueArchiveBackendPort`, and the authority boundary test accepts it as a sanctioned browser store.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 SPA, Signals, zoneless; ASP.NET API + PostgreSQL is the data authority for everything except the two browser-local stores).
- This slice: the first quarter of feedback line 4 — "When I am not connected and go to the leagues page, the archive league page, I don't see any option to create a new league or manage my archived league. Make sure it works exactly like the live tournament feature. When I don't have an account or am not an admin or organizer, I am allowed to use the feature, but none of the data will be synchronized or saved in the backend. Everything is saved locally in the local DB."
- Out of scope here: the remaining 14 port methods (T13), the repository merge and the UI (T14), export/import (T15). **Do not touch `LeagueArchiveRepository`, `league-archive-list.component.ts` or `app.component.ts` in this ticket.** After this commit the new service exists, is fully tested, and has no caller — that is the intended, compiling end state.
- Assumptions in force: **A2** full port parity is the destination (this ticket is the first half of it); **A4** origin is encoded in the id, `local-<uuid>`; **A5** the store's return value is the truth the caller adopts.

### Read this first

`docs/adr/0028-dual-source-league-archive.md` — written with this plan. It is the specification for the id-prefix rule, for why the League port diverges from ADR 0021's one-adapter-by-role model, and for what "the database always prevails" means here. Read it before writing code.

### The pattern to copy, almost line for line

`src/app/backend/local-live-backend.service.ts` (239 lines) is the sanctioned browser store for Live Tournaments (ADR 0021). It is the template:

- `LOCAL_LIVE_DB_NAME = 'gones-live'`, `LOCAL_LIVE_STORE = 'tournaments'`, `LOCAL_LIVE_DB_VERSION = 1`.
- `class LiveConcurrencyError extends Error { readonly status = 412; constructor() { super('staleLiveTournamentDocument'); this.name = 'LiveConcurrencyError'; } }` — the shape `live-command-ux.ts` classifies as `stale`.
- `@Injectable({ providedIn: 'root' })`, a memoised `private open(): Promise<IDBDatabase>` that clears `this.database` on a failed open so a later call retries.
- One `private async mutate(id, expectedVersion, change)` through which **every** write passes: load, guard the version, apply one pure domain transform, bump `documentVersion`, stamp `updatedAt`, `put`, return.

`src/app/backend/indexed-db.ts` is the promise wrapper: `openDatabase(name, version, upgrade)`, `getAll<T>(db, store)`, `get<T>(db, store, key)`, `put(db, store, value)`, `remove(db, store, key)`. It resolves on transaction `complete`, not on the request, so a write is durable when the promise settles. Use it; do not touch `indexedDB` directly.

### The port half this ticket implements

From `src/app/backend/application-backend.ts`, interface `LeagueArchiveBackendPort`:

```ts
listLeagueArchives(): Promise<PersistedLeague[]>;
getLeagueArchive(id: string): Promise<PersistedLeague | null>;
createLeagueArchive(name: string, idempotencyKey?: string): Promise<PersistedLeague>;
renameLeagueArchive(id: string, expectedVersion: number, name: string): Promise<PersistedLeague>;
changeLeagueArchiveStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeague>;
deleteLeagueArchive(id: string, expectedVersion: number): Promise<void>;
restoreLeagueArchive(command: LeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague>;
restoreFullLeagueArchiveData(command: FullLeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague[]>;
```

`LeagueRestoreCommand = { kind: 'league'; gonesDataVersion: number; league: LeagueDocument }`.
`FullLeagueRestoreCommand = { kind: 'fullData'; gonesDataVersion: number; leagues: LeagueDocument[] }`.

### The domain functions to compose — invent no rules

From `src/app/domain/models.ts`:

- `PersistedLeague extends LeagueDocument { documentVersion: number; updatedAt?: string; eTag?: string }`
- `LeagueDocument { id: string; name: string; status: LeagueStatus; tournaments: TournamentDocument[] }`
- `LeagueStatus = 'active' | 'completed'`
- `createLeague({ id, name, status, tournaments }, { idFactory })` — trims the name, defaults it to `'New League'`, normalises the status, and rebuilds every tournament. **It special-cases `PLACEHOLDER_LEAGUE_ID`**, forcing the canonical English name.
- `normalizeLeague(league, options)` — an alias for `createLeague`.
- `createPlaceholderLeague()` — `createLeague({ id: PLACEHOLDER_LEAGUE_ID, name: PLACEHOLDER_LEAGUE_NAME, status: 'active', tournaments: [] })`
- `PLACEHOLDER_LEAGUE_ID = 'placeholder-league'`, `PLACEHOLDER_LEAGUE_NAME = 'Unassigned Tournaments'`, `isPlaceholderLeagueId(id)`
- `normalizeLeagueStatus(status)`, `isUnassignedLeagueName(name)`, `defaultIdFactory()`

**The placeholder collision to handle:** `createLeague` keys its special case on the exact string `placeholder-league`. The local store's placeholder id is `local-placeholder-league` (assumption A4), which does **not** match, so `createLeague` will treat it as an ordinary league and will not force the canonical name. That is what we want — the local placeholder is a distinct row from the server's — but it means the local adapter must set the placeholder's name itself. Do that once, in `ensurePlaceholder()`.

### Guardrail that will fail until you update it

`src/app/backend/server-authority-boundary.test.ts`, the `confines IndexedDB to the Live local adapter` case:

```ts
expect(filesMatching(/\bindexedDB\b|\bIDB[A-Z]\w*/)).toEqual([
  'src/app/backend/indexed-db.ts',
  'src/app/backend/local-live-backend.service.ts'
]);
```

Adding a third file here is explicitly "an ADR decision" per its own comment — ADR 0028 is that decision. Update the list **and** its comment; do not weaken the regex.

- **From Depends (T1):** a working local login (`admin@gones.test` / `test@gones.test`, password `Gones-dev-pass-123!`, seeded by `npm run dev`). Not used by this ticket's tests, which run entirely in vitest against a fake IndexedDB; needed only from T14 onward.

## Requirements

- New module `src/app/data/league-archive-origin.ts` holding the routing rule, with no Angular and no IndexedDB import.
- New service `src/app/backend/local-league-archive-backend.service.ts`, `@Injectable({ providedIn: 'root' })`, implementing the eight methods above.
- Store: database `gones-leagues`, object store `leagues`, `keyPath: 'id'`, version `1`.
- Every write goes through one `mutate` helper that guards `documentVersion` and throws `LeagueConcurrencyError` (status `412`, message `staleLeagueDocument`) on mismatch — the exact shape `leagueCommandError` in `src/app/data/league-archive-command-ux.ts` already classifies as `'stale'`.
- `listLeagueArchives()` seeds the local placeholder on first call and returns it alongside everything else, sorted by name with the placeholder first.
- Ids are `local-<crypto.randomUUID()>`. Nothing in the store may carry a non-`local-` id.
- `restoreLeagueArchive` / `restoreFullLeagueArchiveData` rewrite incoming league ids into the local namespace so a bundle exported from the server can be restored locally without colliding.
- Nothing in this file makes a network request. There is no HTTP dependency to inject.

## Inputs

- `docs/adr/0028-dual-source-league-archive.md` — the specification.
- `src/app/backend/local-live-backend.service.ts` — the pattern.
- `src/app/backend/local-live-backend.service.test.ts` — the test pattern, including how it fakes IndexedDB.
- `src/app/backend/indexed-db.ts` — the promise wrapper.
- `src/app/backend/application-backend.ts` — the port interface and the restore command shapes.
- `src/app/domain/models.ts` — the factories listed above.
- `src/app/data/league-archive-command-ux.ts` — `leagueCommandError`, `canManageLeagues`.
- `src/app/backend/server-authority-boundary.test.ts` — the allowlist to extend.
- **From Depends:** see above.

## TDD

1. **Red** — write `src/app/data/league-archive-origin.test.ts` and `src/app/backend/local-league-archive-backend.service.test.ts` first. Both fail to resolve their modules.
2. **Green** — add the origin module, then the service, then extend the boundary allowlist.
3. **Refactor** — only if needed. Keep green.

## Test plan

New module `src/app/data/league-archive-origin.ts`:

```ts
import { PLACEHOLDER_LEAGUE_ID } from '../domain/models';

/** A league stored in this browser carries this prefix; it is the whole routing rule (ADR 0028). */
export const LOCAL_LEAGUE_ID_PREFIX = 'local-';
export const LOCAL_PLACEHOLDER_LEAGUE_ID = `${LOCAL_LEAGUE_ID_PREFIX}${PLACEHOLDER_LEAGUE_ID}`;

export function isLocalLeagueId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_LEAGUE_ID_PREFIX);
}

export function newLocalLeagueId(uuid = crypto.randomUUID()): string {
  return `${LOCAL_LEAGUE_ID_PREFIX}${uuid}`;
}

/** Any placeholder, from either store. Both are "Unassigned Tournaments" to the user. */
export function isAnyPlaceholderLeagueId(id: string | null | undefined): boolean {
  return id === PLACEHOLDER_LEAGUE_ID || id === LOCAL_PLACEHOLDER_LEAGUE_ID;
}
```

| Test | Input | Expect |
| --- | --- | --- |
| `a prefixed id is local` | `isLocalLeagueId('local-abc')` | `true` |
| `a server id is not local` | `isLocalLeagueId('7f3a…')`, `isLocalLeagueId('placeholder-league')` | `false` for both |
| `nullish ids are not local` | `isLocalLeagueId(null)`, `isLocalLeagueId(undefined)`, `isLocalLeagueId('')` | `false` for each |
| `a generated id is local` | `isLocalLeagueId(newLocalLeagueId())` | `true` |
| `generated ids are unique` | 100 calls to `newLocalLeagueId()` | a `Set` of them has size 100 |
| `the local placeholder is local` | `isLocalLeagueId(LOCAL_PLACEHOLDER_LEAGUE_ID)` | `true` |
| `both placeholders are recognised` | `isAnyPlaceholderLeagueId('placeholder-league')`, `isAnyPlaceholderLeagueId('local-placeholder-league')`, `isAnyPlaceholderLeagueId('local-other')` | `true`, `true`, `false` |

Service tests (`local-league-archive-backend.service.test.ts`) — copy the IndexedDB fake setup from `local-live-backend.service.test.ts`:

| Test | Input | Expect |
| --- | --- | --- |
| `listing an empty store seeds the placeholder` | fresh store, `listLeagueArchives()` | length `1`; the single row has `id === LOCAL_PLACEHOLDER_LEAGUE_ID`, `name === 'Unassigned Tournaments'`, `status === 'active'`, `tournaments` empty |
| `creating a league gives it a local id` | `createLeagueArchive('Summer')` | `isLocalLeagueId(result.id)`, `result.name === 'Summer'`, `result.documentVersion === 1` |
| `a created league is readable back` | create then `getLeagueArchive(id)` | deep-equals the created document |
| `an unknown id reads as null` | `getLeagueArchive('local-nope')` | `null` |
| `creating trims and defaults the name` | `createLeagueArchive('   ')` | `name === 'New League'` |
| `renaming bumps the version` | create, then `renameLeagueArchive(id, 1, 'Winter')` | `name === 'Winter'`, `documentVersion === 2` |
| `renaming with a stale version is refused` | create, then `renameLeagueArchive(id, 99, 'Winter')` | rejects; the error has `status === 412` and `message === 'staleLeagueDocument'` |
| `a refused write leaves the document untouched` | as above, then `getLeagueArchive(id)` | `name` is still the original, `documentVersion` still `1` |
| `changing status bumps the version` | `changeLeagueArchiveStatus(id, 1, 'completed')` | `status === 'completed'`, `documentVersion === 2` |
| `an unknown status normalises` | `changeLeagueArchiveStatus(id, 1, 'nonsense' as LeagueStatus)` | `status === 'active'` |
| `deleting removes the row` | create, `deleteLeagueArchive(id, 1)`, `getLeagueArchive(id)` | `null` |
| `deleting with a stale version is refused` | `deleteLeagueArchive(id, 99)` | rejects with `status === 412`; the row still exists |
| `deleting an unknown id rejects` | `deleteLeagueArchive('local-nope', 1)` | rejects with message `leagueNotFound` |
| `every write stamps updatedAt` | create then rename | `updatedAt` is an ISO-8601 string and differs from, or is not before, the creation stamp |
| `listing sorts the placeholder first then by name` | create `'Zulu'`, `'alpha'`, then list | order is placeholder, `'alpha'`, `'Zulu'` (case-insensitive compare) |
| `restoring a single league lands in the local namespace` | `restoreLeagueArchive({ kind: 'league', gonesDataVersion: 4, league: { id: 'server-uuid', name: 'Imported', status: 'active', tournaments: [] } })` | result id satisfies `isLocalLeagueId`, `name === 'Imported'`, `documentVersion === 1`, and it is readable back |
| `restoring full data lands every league locally` | `restoreFullLeagueArchiveData({ kind: 'fullData', gonesDataVersion: 4, leagues: [a, b] })` | 2 results, both local ids, both readable back; a following `listLeagueArchives()` returns 3 rows (placeholder + 2) |
| `a restored server placeholder becomes the local placeholder` | restore full data containing a league with `id: 'placeholder-league'` | the stored row is `LOCAL_PLACEHOLDER_LEAGUE_ID`, not a new random local id, and it is not duplicated |
| `the adapter never talks to the network` | service source text | contains no `fetch`, no `HttpClient`, no `firstValueFrom` |
| `IndexedDB stays confined to the sanctioned files` | `server-authority-boundary.test.ts` | its allowlist is exactly the three files and the suite is green |

## Impl steps

- [x] 1. Create `src/app/data/league-archive-origin.ts` exactly as written in the Test plan.
- [x] 2. Create `src/app/data/league-archive-origin.test.ts` with the seven origin cases. Run `npx vitest run src/app/data/league-archive-origin.test.ts` — green (this module is small enough to land test-first-and-green in one step; the service below is the real red/green cycle).
- [x] 3. Create `src/app/backend/local-league-archive-backend.service.test.ts`. Copy the IndexedDB fake and the `beforeEach` teardown from `src/app/backend/local-live-backend.service.test.ts` verbatim, then write every service case above against `new LocalLeagueArchiveBackend()`.
- [x] 4. Run `npx vitest run src/app/backend/local-league-archive-backend.service.test.ts` — it must fail to resolve the service.
- [x] 5. Create `src/app/backend/local-league-archive-backend.service.ts`. Header comment: name ADR 0028, state that this is the League half of the browser-local authority, that it never synchronises, and that every rule lives in `src/app/domain/models.ts`. Then:
      a. `export const LOCAL_LEAGUE_DB_NAME = 'gones-leagues';`, `export const LOCAL_LEAGUE_STORE = 'leagues';`, `const LOCAL_LEAGUE_DB_VERSION = 1;`
      b. `export class LeagueConcurrencyError extends Error { readonly status = 412; constructor() { super('staleLeagueDocument'); this.name = 'LeagueConcurrencyError'; } }`
      c. `@Injectable({ providedIn: 'root' }) export class LocalLeagueArchiveBackend implements Partial<LeagueArchiveBackendPort>` — `Partial` for this commit only; T13 completes it and drops `Partial`.
      d. `private open()` — identical in shape to `LocalLiveBackend.open()`, creating the store with `{ keyPath: 'id' }` and clearing the memo on failure.
      e. `private async ensurePlaceholder(database: IDBDatabase): Promise<void>` — if `get(database, LOCAL_LEAGUE_STORE, LOCAL_PLACEHOLDER_LEAGUE_ID)` is null, `put` `{ ...createLeague({ id: LOCAL_PLACEHOLDER_LEAGUE_ID, name: PLACEHOLDER_LEAGUE_NAME, status: 'active', tournaments: [] }), documentVersion: 1, updatedAt: new Date().toISOString() }`. Setting the name explicitly is required — `createLeague` only forces the canonical name for the bare `placeholder-league` id.
      f. `listLeagueArchives()` — open, `ensurePlaceholder`, `getAll`, map through `this.persist(row)` (a private normaliser: `{ ...normalizeLeague(row), documentVersion: row.documentVersion ?? 1, updatedAt: row.updatedAt }`), then sort placeholder-first and by `name.localeCompare(other.name, undefined, { sensitivity: 'base' })`.
      g. `getLeagueArchive(id)` — open, `get`, return `null` or the normalised document.
      h. `createLeagueArchive(name)` — build `createLeague({ id: newLocalLeagueId(), name })`, attach `documentVersion: 1` and `updatedAt`, `put`, return.
      i. `deleteLeagueArchive(id, expectedVersion)` — load via a `require` helper that throws `new Error('leagueNotFound')` when absent, guard the version, `remove`.
      j. `private async mutate(id, expectedVersion, change: (league: PersistedLeague) => LeagueDocument): Promise<PersistedLeague>` — load, guard, `normalizeLeague(change(current))`, force `id: current.id`, `documentVersion: current.documentVersion + 1`, `updatedAt: new Date().toISOString()`, `put`, return.
      k. `renameLeagueArchive` and `changeLeagueArchiveStatus` — one-line `mutate` calls.
      l. `restoreLeagueArchive(command)` — `this.putRestored(command.league)`; `restoreFullLeagueArchiveData(command)` — map the array through the same helper, sequentially.
      m. `private async putRestored(league: LeagueDocument): Promise<PersistedLeague>` — compute the target id: `isPlaceholderLeagueId(league.id) || league.id === LOCAL_PLACEHOLDER_LEAGUE_ID ? LOCAL_PLACEHOLDER_LEAGUE_ID : isLocalLeagueId(league.id) ? league.id : newLocalLeagueId()`; rebuild with `createLeague({ ...league, id: targetId })`; carry `documentVersion: 1`; `put`; return.
- [x] 6. Run step 4's command — green.
- [x] 7. In `src/app/backend/server-authority-boundary.test.ts`, extend the IndexedDB allowlist to:
      ```ts
      expect(filesMatching(/\bindexedDB\b|\bIDB[A-Z]\w*/)).toEqual([
        // Promise wrapper over the raw request/transaction API. No data rules.
        'src/app/backend/indexed-db.ts',
        // The League browser-local adapter (ADR 0028), composing the pure domain.
        'src/app/backend/local-league-archive-backend.service.ts',
        // The Live browser-local adapter itself (anonymous + `User`), composing the pure domain.
        'src/app/backend/local-live-backend.service.ts'
      ]);
      ```
      Keep the array sorted — `filesMatching` sorts its result, and `local-league-…` sorts before `local-live-…`.
- [x] 8. Update the file's header comment so it names ADR 0028 alongside ADR 0021 as the reason a browser store exists.
- [x] 9. Run `npx vitest run src/app/backend src/app/data` — green.

## Outputs

- New: `src/app/data/league-archive-origin.ts`, `src/app/data/league-archive-origin.test.ts`, `src/app/backend/local-league-archive-backend.service.ts`, `src/app/backend/local-league-archive-backend.service.test.ts`.
- Changed: `src/app/backend/server-authority-boundary.test.ts`.
- Public API for T13 to consume verbatim:
  - `LOCAL_LEAGUE_ID_PREFIX`, `LOCAL_PLACEHOLDER_LEAGUE_ID`, `isLocalLeagueId(id)`, `newLocalLeagueId(uuid?)`, `isAnyPlaceholderLeagueId(id)` from `src/app/data/league-archive-origin.ts`.
  - `LOCAL_LEAGUE_DB_NAME = 'gones-leagues'`, `LOCAL_LEAGUE_STORE = 'leagues'`, `LeagueConcurrencyError`, `LocalLeagueArchiveBackend` from `src/app/backend/local-league-archive-backend.service.ts`.
  - `LocalLeagueArchiveBackend` currently declares `implements Partial<LeagueArchiveBackendPort>` and has a `private mutate(id, expectedVersion, change)` helper that every write must go through.
- Behaviour: none yet, user-visible. Nothing injects the service.

## Validation

- [x] `npm run test` passes — 86 files / 662 tests passed (baseline before this slice: 84 / 635)
- [x] `npm run lint` passes — "All files pass linting."
- [x] `npm run typecheck` passes — both `tsconfig.app.json` and `tsconfig.spec.json`, no output
- [x] `npm run build` passes — "Application bundle generation complete. [3.353 seconds]"
- [x] `npx vitest run src/app/backend/server-authority-boundary.test.ts` passes with the three-file allowlist — 1 file / 12 tests passed
- [x] Manual: `npm run dev` and browse the app — nothing changed, because nothing injects the new service yet. Confirm no `gones-leagues` database appears in DevTools → Application → IndexedDB.
      *Automated equivalent (no human browser used):* after `npm run build`, `grep -rl "gones-leagues" dist/gones` and `grep -rl "LocalLeagueArchiveBackend" dist/gones` both return nothing, while the control `grep -rl "gones-live" dist/gones` matches three chunks — the new adapter is tree-shaken out of the shipped bundle, so no `gones-leagues` database can be opened at runtime. Source-side, the only reference to the service outside its own file and test is the boundary-test allowlist. The human step is still recorded in `ai-artifacts/manual_test_checklist.md`.
- [x] app functional — no broken path from this slice: full vitest suite and `ng build` green, and the production bundle is byte-for-byte free of the new module (nothing injects it).
- [x] commit msg draft: `feat(leagues): add the browser-local league store and its core commands`
