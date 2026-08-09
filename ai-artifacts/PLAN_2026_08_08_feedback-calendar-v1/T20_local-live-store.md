# T20: Role-scoped local Live store

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T1
**Commit outcome:** Anonymous visitors and plain users run Live tournaments entirely in the browser against an IndexedDB store, while organizers and admins keep the server-backed adapter — recorded in a new ADR that narrows ADR 0020.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket covers General §4 ("anonymous and logged user have access to live-tournaments and ligue") and Live Tournaments §1 ("update backend to allow user (anonymous, user, …) to start and manage live tournaments"), resolved as: non-privileged users get a strictly offline local store, synchronisation stays an Organizer/Admin privilege.
- This slice: the local adapter, the role-based port selection, the ADR and the boundary-test amendment. No backend change at all.
- Out of scope here: the archive rename (T23/T24), any change to the server Live endpoints.
- Assumptions in force:
  - **A2** — Anonymous + `User` → local IndexedDB, no sync ever. `Organizer` + `Admin` → the existing ASP.NET adapter. This reintroduces a browser store and **narrows ADR 0020**, so a new ADR is mandatory, not optional.
  - **No migration** (user answer): server Live tournaments are not pulled into the local store.
  - **Finalize, locally**: `finalizeLiveTournament` cannot write a League server-side for a non-privileged user. Locally it produces the `TournamentDocument` and hands it to the caller as a JSON download; it does not create or modify any League. The runner must surface that difference in its copy.
  - The port is resolved **once at injection time** from the profile that `AuthService.bootstrap()` already loaded before the first route renders (`src/main.ts:69`). A role change mid-session requires a reload; that is acceptable and must be stated in the ADR.

## Requirements

- New `LocalLiveBackend` implementing the full `LiveBackendPort`, persisting `LiveTournamentDocument`s in IndexedDB database `gones-live`, object store `tournaments`, key `id`.
- Every mutation goes through the existing pure domain functions in `src/app/domain/live-tournament.ts` and bumps `documentVersion`; a stale `expectedVersion` rejects with the same error shape the API adapter produces, so the runner's conflict handling is unchanged.
- `LIVE_BACKEND` resolves to `LocalLiveBackend` when the signed-in role is absent, `User`, or the profile is null; to `AspNetApiBackend` when it is `Organizer` or `Admin`.
- `/live-tournaments` and `/live-tournaments/new` remain anonymous routes (they already are) and work end to end with no network.
- `src/app/backend/server-authority-boundary.test.ts` is amended: `indexedDB` usage is allowed **only** in the new adapter file, asserted by name, and the amendment carries a comment pointing at the new ADR.
- `docs/adr/0021-role-scoped-browser-live-store.md` records the decision, its scope, and exactly which parts of ADR 0020 it narrows.

## Inputs

- `src/app/backend/application-backend.ts`:
  - `:76-95` — `export interface LiveBackendPort` with `listLiveTournaments()`, `getLiveTournament(id)`, `createLiveTournament(tournamentDate, idempotencyKey?)`, `deleteLiveTournament(id, expectedVersion)`, `updateLiveSettings`, `addLivePlayer`, `editLivePlayer`, `setLivePlayerPaid`, `dropLivePlayer`, `removeLivePlayer`, `startLiveRound`, `regenerateLiveRound`, `cancelLiveRound`, `validateLiveRound`, `scoreLiveRoundEntry`, `restoreLiveCheckpoint`, `finalizeLiveTournament`. Command shapes: `LiveSettingsCommand { name, leagueId, tournamentDate, roundCount, customRoundCount, paidTrackingEnabled }`, `LivePlayerCommand { name, initialWins, initialDraws, initialLosses, archetype }`, `LiveScoreCommand { player1Score, player2Score }`, `LiveFinalizeResult { liveTournamentId, leagueId, finalizedTournamentId, liveDocumentVersion }`.
  - `:97-107` — `export type BackendMode = 'aspnet-api';` and `export function resolveBackendMode(authority: DataAuthority): BackendMode { if (!authority.serverAuthority) throw new Error('serverAuthorityRequired'); return 'aspnet-api'; }`
  - `:117-123` — `export const LIVE_BACKEND = new InjectionToken<LiveBackendPort>('Gones Live Tournament backend bridge', { providedIn: 'root', factory: () => { resolveBackendMode(dataAuthority()); return inject(AspNetApiBackend); } });`
- `src/app/domain/live-tournament.ts` — pure, already exhaustive: `createLiveTournament(...)`, `createLiveTournamentPlayer(...)`, `normalizeLiveTournament(source)`, `generateNextSwissRound(...)`, `regenerateCurrentSwissRound(...)`, `cancelCurrentSwissRound(t)`, `validateCurrentSwissRound(t)`, `updateLiveRoundEntryResult(t, roundId, entryId, score)`, `restoreLiveTournamentCheckpoint(t, checkpointId)`, `finalizeLiveTournament(t, { idFactory })`, `calculateLiveStandings(t)`, `liveTournamentFinished(t)`, `seededShuffle(items, seed)`. The local adapter composes these; it must not reimplement any rule.
- `src/app/domain/live-tournament.ts:41` — `LiveTournamentDocument` carries `documentVersion` among its fields; the runner reads it for If-Match style guarding.
- `src/app/data/live-tournament-repository.service.ts` — the facade every component uses; it must not change. `create()` calls `backend.createLiveTournament(todayDateInputValue())`; `delete(id)` reads the document first for its version.
- `src/app/features/live-tournaments/live-tournament-runner.component.ts` — 999 lines, drives every command through `LiveTournamentRepository`; `live-tournament-list.component.ts` — 141 lines.
- `src/app/data/live-command-ux.ts` + `.test.ts` — maps command failures to user messages; the local adapter's errors must fall into the existing branches (check what it keys on: HTTP status via `ApiProblemError`, or an error message). Match whichever it uses for the stale-version branch.
- `src/app/backend/server-authority-boundary.test.ts`:
  - `it('never touches browser storage')` asserts `aspnet-api-backend.service.ts` contains no `localStorage|sessionStorage|indexedDB` — the new file is a different file, so that test is unaffected.
  - `it('ships no browser store adapter to import')` asserts `filesMatching(/from '.*local-frontend-backend\.service'/)` is empty — name the new file `local-live-backend.service.ts`, **not** `local-frontend-backend.service.ts`, or that test fails.
  - `it('names no canonical browser store key anywhere in the application')` asserts nothing matches `/gones\.frontend\.backend\.v1|gones\.live-tournaments\.v1/` — do **not** reuse either key. Use the IndexedDB database name `gones-live`.
  - `it('binds every League and Live port to the API')` asserts `resolveBackendMode(serverAuthority) === 'aspnet-api'` — this must be reworked, since Live now has two adapters. Keep `resolveBackendMode` as the **League** authority check and add a separate `resolveLiveBackendMode(authority, role)`.
- `src/app/auth/auth.service.ts` — `readonly profile = signal<UserProfileResponse | null>(null)` with `globalRole: string`; `readonly enabled`; `bootstrap()` is an `provideAppInitializer` in `src/main.ts:69`, so a profile is loaded before the first route renders.
- `docs/adr/` — lowercase, latest is `0020-retire-the-legacy-browser-data-authority.md`. Follow its heading structure exactly.
- `AGENT.md` — "There is exactly one data authority and every build declares it (ADR 0020): `dataMode: server`… The browser keeps only language, view preference, filters and the anonymous public read cache." That paragraph must be updated to name the Live exception.
- **Test harness — there is no Angular `TestBed`, no zone.js, and `@angular/common/http/testing` is not installed**, so
  `HttpTestingController` does not exist here. Test plan row `no network call is made` must be satisfied differently:
  construct the adapter through `Injector.create` with `{ provide: HttpClient, useValue: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } }` and assert every spy has zero calls after driving a full
  command sequence. Better still, the adapter should not inject `HttpClient` at all — if it does not, say so and
  assert that structurally instead. Copy the injector pattern from
  `src/app/features/calendar/public-tournament.service.test.ts`.
- **`fake-indexeddb` is NOT a dependency** (verified — it is absent from `package.json`) and A10 does not authorise a
  new one. Take step 16's second branch: write an in-memory `IDBFactory` stub installed on `globalThis.indexedDB`
  inside the test file. Do not `npm install` anything.
- `cypress/e2e/live-server.cy.js:18` already fakes its session with
  `cy.intercept('POST', '**/api/auth/refresh', …)`, so it costs **zero** auth permits — and your new
  `cypress/e2e/live-local.cy.js` is signed out, so it costs none either. Both may be re-run freely. Do not add a spec
  that performs a real login: this host allows only 5 auth permits per 15 minutes per IP, shared with other tickets.
- `docs/adr/0021-role-scoped-browser-live-store.md` **already exists** (63 lines). Read it before coding — it is the
  specification for steps 1-14 — and change it only if implementation forces a different decision.
- **From Depends (T1):** the `data-cy` rule and the coverage test exist; this ticket adds template markup in steps 13-14, so those two elements need `data-cy` values, but the runner and list components remain in `PENDING_DATA_CY_RETROFIT` and stay there — T25 owns emptying it.

## TDD

1. **Red** — write `src/app/backend/local-live-backend.service.test.ts` and `src/app/backend/live-backend-selection.test.ts` first; both modules are missing.
2. **Green** — add the adapter, the selection function, the token factory, the ADR and the boundary-test amendment.
3. **Refactor** — none; keep every rule in the domain module.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `selects the local adapter for anonymous` | `resolveLiveBackendMode(serverAuthority, undefined)` | `'browser-local'` |
| `selects the local adapter for a plain user` | `…, 'User'` | `'browser-local'` |
| `selects the api adapter for an organizer` | `…, 'Organizer'` | `'aspnet-api'` |
| `selects the api adapter for an admin` | `…, 'Admin'` | `'aspnet-api'` |
| `still refuses a non-server authority` | `resolveLiveBackendMode({...serverAuthority, serverAuthority:false}, 'Admin')` | throws `serverAuthorityRequired` |
| `create then list round-trips` | `createLiveTournament('2026-08-08')` then `listLiveTournaments()` | one document with `documentVersion === 1` |
| `survives a new service instance` | write, construct a fresh adapter, read | same document |
| `a mutation bumps the version` | `addLivePlayer(id, 1, player)` | returned `documentVersion === 2` |
| `a stale version is rejected` | `addLivePlayer(id, 1, player)` twice | second rejects with the same error kind `live-command-ux` maps to "stale" |
| `delete removes the document` | `deleteLiveTournament(id, version)` then `getLiveTournament(id)` | `null` |
| `rounds go through the domain rules` | four players, `startLiveRound` | two pairings, matching `generateNextSwissRound` output |
| `restore rolls back to a checkpoint` | score, then `restoreLiveCheckpoint` | document equals the checkpoint state, version bumped |
| `finalize returns a tournament document` | completed tournament | resolves with a `LiveFinalizeResult` whose `leagueId` is empty and whose document is downloadable |
| `no network call is made` | any local command | `HttpTestingController.verify()` reports no outstanding or issued request |
| `boundary test` | `server-authority-boundary.test.ts` | green with the amended assertions |

Run: `npm run test -- local-live-backend live-backend-selection server-authority-boundary`

## Impl steps

- [x] 1. In `src/app/backend/application-backend.ts`, add `export type LiveBackendMode = 'aspnet-api' | 'browser-local';`
- [x] 2. Add `export function resolveLiveBackendMode(authority: DataAuthority, globalRole: string | undefined): LiveBackendMode { if (!authority.serverAuthority) throw new Error('serverAuthorityRequired'); return globalRole === 'Organizer' || globalRole === 'Admin' ? 'aspnet-api' : 'browser-local'; }`
- [x] 3. Leave `resolveBackendMode` and `LEAGUE_BACKEND` exactly as they are — Leagues stay server-only.
- [x] 4. Change the `LIVE_BACKEND` factory to:
  ```
  factory: () => {
    const role = inject(AuthService).profile()?.globalRole;
    return resolveLiveBackendMode(dataAuthority(), role) === 'aspnet-api'
      ? inject(AspNetApiBackend)
      : inject(LocalLiveBackend);
  }
  ```
  Watch the import cycle: `AuthService` imports from `api-boundary`, not from `application-backend`, so this is safe; verify with `npm run build`.
- [x] 5. Create `src/app/backend/indexed-db.ts` with a tiny promise wrapper: `openDatabase(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase>`, `getAll<T>(db, store)`, `get<T>(db, store, key)`, `put(db, store, value)`, `remove(db, store, key)`. No third-party dependency.
- [x] 6. Create `src/app/backend/local-live-backend.service.ts` with `export const LOCAL_LIVE_DB_NAME = 'gones-live';`, `export const LOCAL_LIVE_STORE = 'tournaments';` and `@Injectable({ providedIn: 'root' }) export class LocalLiveBackend implements LiveBackendPort`.
- [x] 7. Implement `listLiveTournaments()` as `getAll` mapped through `normalizeLiveTournament` and sorted by `tournamentDate` descending, then `name`.
- [x] 8. Implement `createLiveTournament(tournamentDate)` with the domain's `createLiveTournament(...)`, assigning `documentVersion: 1` and a `crypto.randomUUID()` id.
- [x] 9. Implement a private `mutate(id, expectedVersion, change: (document) => LiveTournamentDocument)` that loads the document, throws `new LiveConcurrencyError()` when `document.documentVersion !== expectedVersion`, applies `change`, increments `documentVersion`, persists and returns it.
- [x] 10. Define `LiveConcurrencyError` so `src/app/data/live-command-ux.ts` classifies it as stale. Read `live-command-ux.ts` first: if it keys on `ApiProblemError.status === 412`, make the local error carry `status = 412` through the same type; if it keys on a message, use that message. Do **not** change `live-command-ux.ts` unless a new branch is genuinely required — and if it is, extend its test file too.
- [x] 11. Implement every remaining port method on top of `mutate` and the domain functions: settings, players (add/edit/paid/drop/remove), rounds (start/regenerate/cancel/validate), scoring, checkpoint restore.
- [x] 12. Implement `finalizeLiveTournament(id, expectedVersion)` calling the domain `finalizeLiveTournament(document)` to build the `TournamentDocument`, marking the live document completed, and returning `{ liveTournamentId: id, leagueId: '', finalizedTournamentId: tournament.id, liveDocumentVersion: nextVersion }`.
- [x] 13. In `src/app/features/live-tournaments/live-tournament-runner.component.ts`, branch the post-finalize behaviour: when `result.leagueId` is empty, save the produced tournament with the existing `saveJsonFile(...)` helper (`src/app/shared/save-json-file.ts`) and show a message instead of navigating to a League. Add the i18n keys `live.localFinalizeTitle` / `live.localFinalizeBody` to BOTH maps.
- [x] 14. Add a banner on `/live-tournaments` for non-privileged users: `live.localModeNotice` — en `'Your running tournaments are stored in this browser only. They are never sent to the server.'`, fr `'Vos tournois en cours sont stockés uniquement dans ce navigateur. Ils ne sont jamais envoyés au serveur.'` — rendered with `data-cy="live-local-mode-notice"`.
- [x] 15. Create `src/app/backend/live-backend-selection.test.ts` with Test plan rows 1-5.
- [x] 16. Create `src/app/backend/local-live-backend.service.test.ts` with Test plan rows 6-14, using `fake-indexeddb` if it is already a dev dependency; if it is not, write the tests against an in-memory `IDBFactory` stub installed on `globalThis.indexedDB` inside the test file, so no new dependency is added.
- [x] 17. Amend `src/app/backend/server-authority-boundary.test.ts`:
  - replace `it('binds every League and Live port to the API')` with two tests: `resolveBackendMode(serverAuthority) === 'aspnet-api'` for Leagues, and the Live matrix from rows 1-4.
  - add a new test `it('confines IndexedDB to the Live local adapter')` asserting `filesMatching(/indexedDB/)` equals exactly `['src/app/backend/indexed-db.ts', 'src/app/backend/local-live-backend.service.ts']`, with a comment naming ADR 0021.
  - leave the `localStorage` allowlist test untouched.
- [x] 18. `docs/adr/0021-role-scoped-browser-live-store.md` is **already written** as part of this plan. Read it before coding — it is the specification for steps 1-14 — and update it only if implementation forces a different decision (say so in the commit body if it does).
- [x] 19. Update the `AGENT.md` paragraph "There is exactly one data authority…" to name the Live exception and link ADR 0021.
- [x] 20. Update `docs/CONTEXT.md`'s Live Tournament vocabulary entry with the two-authority rule, and add `local Live store` to `docs/GLOSSARY.md`.
- [x] 21. Update `cypress/e2e/live-server.cy.js` so its organizer path still passes, and add `cypress/e2e/live-local.cy.js`: **signed out**, create a live tournament, add four players, start a round, score it, reload the page, assert the state survived, and assert with `cy.intercept('/api/live-tournaments/**')` that no request was made.
- [x] 22. Run `npm run test && npm run lint && npm run typecheck && npm run build`. — all four green (490 tests, "All files pass linting", clean tsc, bundle built).
- [x] 23. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/live-local.cy.js,cypress/e2e/live-server.cy.js`. — 5/5 passing against `ng serve` on 127.0.0.1:4200.
- [x] 24. Add an `ops/acceptance-matrix.json` row for the local Live capability pointing at `cypress/e2e/live-local.cy.js` and `src/app/backend/local-live-backend.service.test.ts`, then run `npm run acceptance:matrix`.

## Outputs

- Files created: `src/app/backend/indexed-db.ts`, `src/app/backend/local-live-backend.service.ts`, `src/app/backend/local-live-backend.service.test.ts`, `src/app/backend/live-backend-selection.test.ts`, `docs/adr/0021-role-scoped-browser-live-store.md`, `cypress/e2e/live-local.cy.js`.
- Files touched: `src/app/backend/application-backend.ts`, `src/app/backend/server-authority-boundary.test.ts`, `src/app/features/live-tournaments/live-tournament-runner.component.ts`, `src/app/features/live-tournaments/live-tournament-list.component.ts`, `src/app/i18n/messages.ts`, `AGENT.md`, `docs/CONTEXT.md`, `docs/GLOSSARY.md`, `ops/acceptance-matrix.json`.
- Public API / behavior change: Live tournaments created by non-privileged users never reach the server.
- Migrate / config: a new IndexedDB database `gones-live`; no server migration.

## Validation

- [x] `npm run test` passes — 75 files, 490 tests.
- [x] `npm run lint && npm run typecheck && npm run build` pass
- [x] `npm run cy:run -- --spec cypress/e2e/live-local.cy.js,cypress/e2e/live-server.cy.js` passes — 5/5.
- [x] `npm run acceptance:matrix` passes — 91/91 non-deferred rows proved.
- [x] manual check: signed out, run a full four-player Swiss tournament offline (DevTools -> Network -> Offline) and reload mid-round; state survives — automated instead: `cypress/e2e/live-local.cy.js` forces `navigator.onLine === false` before every write, then reloads and asserts the standings survived.
- [x] manual check: signed in as an Organizer, the same page still talks to `/api/live-tournaments` — `cypress/e2e/live-server.cy.js` organizer lifecycle waits on `@createLive`, `@startRound`, `@validateRound`, `@finalizeLive`.
- [x] app functional — Leagues, Calendar, auth and admin remain server-authoritative — `league-server.cy.js` (2/2) and `server-data-authority.cy.js` (4/4) still green, and the boundary test still asserts `resolveBackendMode(serverAuthority) === 'aspnet-api'` for Leagues.
- [x] commit msg draft: `feat(live): give anonymous and plain users an offline browser-local Live store`
