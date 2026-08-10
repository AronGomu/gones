# T14: Remote prevails on sign-in

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** T12, T13
**Commit outcome:** Signing in replaces this browser's local deck-archetype catalog with the server's — remote wins, local is erased, never merged and never uploaded. The browser-local stores stay readable by anyone using the browser, and a test proves none of them is namespaced by user.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice covers the first and second clauses of feedback #14 — "Make sure that when a user is not logged in and all the data is saved only locally, this data is accessible to anyone who opens the website in the same browser. If there are any conflicts when someone is logged in and the locally saved data differs from the remote data, the remote data always prevails and erases the local data."
- This slice: apply the conflict rule where a conflict can actually happen (the deck-archetype catalog), and lock the browser-wide property of the local stores with an executable assertion.
- Out of scope here: uploading anything local to the server — there is no sync path in either direction (ADR 0021, ADR 0028) and this ticket does not create one. The browser-local League and Live *documents* are a separate authority with `local-` ids that can never collide with a server id, so they have no conflict to resolve and are **not** erased on sign-in.
- Assumptions in force:
  - "Remote prevails" has exactly two surfaces. The read cache (done in T13: every successful server read overwrites its row). The deck-archetype catalog (this ticket).
  - Read `docs/adr/0031-authenticated-offline-read-cache.md` and `docs/adr/0032-signed-out-local-settings-catalogs.md` before coding.
  - No TestBed — services are constructed directly with fakes.

## Inputs

- **From T12 (spell out — do not read T12):**
  - `src/app/features/settings/settings-capabilities.ts` now exports `SettingsCapabilities` with six fields: `adminCatalog`, `organizerMaintenance`, `profileLink`, `orgNotifications`, `localCatalog`, `localMaintenance`. `localCatalog = !(flags.adminV1 && role === 'Admin')`; `localMaintenance = !(role === 'Organizer' || role === 'Admin')`.
  - `src/app/features/settings/settings.component.ts` renders a browser-local archetype card behind `@if (capabilities().localCatalog)` and a browser-local player card behind `@if (capabilities().localMaintenance)`, both writing browser storage only.
  - `src/app/features/settings/local-player-names.ts` exports `LocalPlayerSummary` and `localPlayerNames(leagues)`.
  - T12 renamed the component's pre-existing dead local-archetype methods to `addLocalArchetype` / `startLocalEdit` / `saveLocalArchetypeEdit` / `removeLocalArchetype` (and friends) and added the i18n keys `settings.removeArchetypeTitle` / `settings.removeArchetypeMessage` in both `en` and `fr`. `normalizeArchetypeName` is exposed as a class field so the template can call it.
- **From T13 (spell out — do not read T13):**
  - `src/app/backend/server-read-cache.service.ts` exports `SERVER_READ_CACHE_DB_NAME = 'gones-cache'`, `SERVER_READ_CACHE_STORE = 'reads'`, `CachedRead<T>`, `ServerReadResult<T>`, `ServerReadCacheStore` and `@Injectable({ providedIn: 'root' }) class ServerReadCacheService` with `read<T>(resource, load): Promise<ServerReadResult<T>>` and `purge(): Promise<void>`. Rows are keyed `<userId>:<resource>`; the constructor registers `purge` with `SessionScopeService`.
  - `src/app/backend/server-authority-boundary.test.ts`'s IndexedDB allowlist now also names `src/app/backend/server-read-cache.service.ts`.
  - `LeagueArchiveRepository.listLeagues()` / `getLeague(id)` and `LiveTournamentRepository.list()` / `get(id)` read through that cache for server data.
  - The store seam is an `InjectionToken` named `SERVER_READ_CACHE_STORE_PORT`, not a constructor override parameter (an interface ctor param is not AOT-injectable and would break `npm run build`). Override it that way in any test that needs a fake store.
  - Cache resource names in use: `leagues`, `league:<id>`, `live-tournaments`, `live-tournament:<id>`.
  - `ServerReadCacheService.read` re-reads the session after `load()` resolves, so a response landing after sign-out or after the next sign-in is answered but written nowhere. Do not undo that guard.
- `src/app/shared/deck-archetype-settings.service.ts` — `DeckArchetypeSettingsService`. Storage keys `gones.settings`, `gones.settings.language`, `gones.settings.deckArchetypes` in `localStorage`, none of them namespaced by user. Public: `archetypes` (computed `string[]`), `language`, `add`, `update`, `remove`, `has`, `suggestions`, `exportSettings(): { language, deckArchetypes }`, `replaceSettings(value): Promise<boolean>` (authoritative replace, re-merges `PRESET_LEGACY_ARCHETYPES`), `mergeArchetypes(value)`, `setLanguage(value)`, `bootstrapFromStorage()`. Writes are serialised through `navigator.locks` under `gones.settings.deckArchetypes`.
- `src/app/auth/auth.service.ts` — `login(request)` calls `this.acceptToken(...)` then `return this.loadProfile();`. `loadProfile()` sets `this.profile`. `clear()` resets tokens, profile and `SessionScopeService`.
- `src/app/api/generated/gones-api.ts` — `Client` exposes the public deck-archetype catalog read used by the app. The public route is `GET /api/deck-archetypes`; use the generated method for it (the same one the Settings component already uses to populate the Admin catalog list is the admin route `GET /api/admin/deck-archetypes` returning `AdminDeckArchetypeResponse[]` with `{ id, name, deletedAt }`). Prefer the **public** `GET /api/deck-archetypes` — it works for every signed-in role, not just Admin.
- `src/app/backend/server-authority-boundary.test.ts` — its `keeps global browser storage access inside the documented browser-only allowlist` test pins the exact set of files calling `localStorage.getItem/setItem/removeItem`. This ticket must not add a new one; put the reconciliation inside `deck-archetype-settings.service.ts`, which is already on the list.
- **From Depends:** T12, T13.

## Requirements

### Remote catalog replaces the local one on sign-in

- New method on `DeckArchetypeSettingsService`:
  ```ts
  /**
   * The server catalog is authoritative the moment a session exists (ADR 0031): the browser list is
   * replaced, not merged, and nothing local is ever uploaded. A failed fetch changes nothing — an
   * offline sign-in keeps whatever this browser already had.
   */
  async adoptServerCatalog(names: string[]): Promise<boolean>
  ```
  Implemented on top of the existing exclusive-write path: `writeSettings(uniqueArchetypes([...PRESET_LEGACY_ARCHETYPES, ...names]), this.languageSignal())` and set `archetypesSignal`. The bundled presets stay because `loadDeckArchetypes()` re-merges them on every read anyway — dropping them here would make the next read disagree with this write.
- New service `src/app/auth/session-catalog-sync.service.ts`:
  ```ts
  /** Pulls the server deck-archetype catalog once per session and lets it overwrite the local one. */
  @Injectable({ providedIn: 'root' })
  export class SessionCatalogSyncService {
    async adopt(): Promise<void>;  // GET /api/deck-archetypes -> settings.adoptServerCatalog(names)
  }
  ```
  Failures are swallowed with `logBoundaryError('session-catalog-sync.adopt', error)`.
- `AuthService.login()` calls it after the profile loads:
  ```ts
  async login(request: LoginRequest): Promise<UserProfileResponse> {
    this.acceptToken(await firstValueFrom(this.client.login(request)));
    const profile = await this.loadProfile();
    await this.catalogSync.adopt();
    return profile;
  }
  ```
  Also call it at the end of a successful `bootstrap()` so a page reload with a live session reconciles too. Do **not** call it from `clear()` or `logout()` — signing out keeps whatever the browser holds; that is the anonymous local catalog again.
- Guard against an injection cycle: `SessionCatalogSyncService` must not inject `AuthService`. It takes `Client` and `DeckArchetypeSettingsService` only.

### Browser-wide local storage, proved

- New test file `src/app/backend/browser-local-scope.test.ts` asserting that no browser store key is namespaced by user:
  - `LOCAL_LEAGUE_DB_NAME` is exactly `'gones-leagues'` and `LOCAL_LIVE_DB_NAME` is exactly `'gones-live'` — constants, not template strings.
  - the sources of `local-league-archive-backend.service.ts`, `local-live-backend.service.ts` and `deck-archetype-settings.service.ts` contain no `profile()`, no `userId`, no `AuthService` import.
  - `SERVER_READ_CACHE_DB_NAME` **is** the one browser store that is user-scoped, and its service source **does** reference the profile — the inverse assertion, so the distinction stays deliberate rather than accidental.

## TDD

1. **Red** — write the five tests below. They fail today.
2. **Green** — `adoptServerCatalog`, then `SessionCatalogSyncService`, then the `AuthService` wiring.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the server catalog replaces the local one` (`src/app/shared/deck-archetype-settings.service.test.ts`) | seed `localStorage` `gones.settings` with `{ language: 'fr', deckArchetypes: ['Local Only'] }`, then `adoptServerCatalog(['Server A', 'Server B'])` | `service.archetypes()` contains `Server A` and `Server B` and does **not** contain `Local Only`; the bundled presets are still present; `gones.settings` in `localStorage` matches |
| `adopting the server catalog keeps the language` (same file) | language `fr` before the call | `service.currentLanguage()` is still `'fr'` |
| `adopting an empty server catalog still erases the local additions` (same file) | local `['Local Only']`, `adoptServerCatalog([])` | `Local Only` is gone; only the presets remain |
| `sign-in adopts the server catalog` (`src/app/auth/auth.service.test.ts`) | fake `Client.login` + `loadProfile`, fake `SessionCatalogSyncService` recording calls | `adopt()` called exactly once, **after** the profile is set |
| `a failed catalog fetch leaves the local catalog alone` (`src/app/auth/session-catalog-sync.service.test.ts`) | `Client` throwing, spy `DeckArchetypeSettingsService` | `adoptServerCatalog` is never called and `adopt()` resolves without throwing |
| `no browser store is namespaced by user except the read cache` (`src/app/backend/browser-local-scope.test.ts`) | the four sources named above | the three local-store sources match none of `/profile\(\)/`, `/userId/`, `/auth\.service/`; the read-cache source matches all of the profile lookup |

Run: `npx vitest run src/app/shared src/app/auth src/app/backend`

## Impl steps

- [x] 1. Read `docs/adr/0031-authenticated-offline-read-cache.md` and `docs/adr/0032-signed-out-local-settings-catalogs.md`. → verify: both files read end to end; their "remote prevails, replace not merge, nothing uploaded" rule is the one implemented below.
- [x] 2. Add the three `adoptServerCatalog` tests to `src/app/shared/deck-archetype-settings.service.test.ts`. Confirm red.
- [x] 3. Implement `adoptServerCatalog(names)` on `DeckArchetypeSettingsService`, reusing `runExclusive` and `writeSettings`. → verify: the three step-2 tests go green (step 4 command).
- [x] 4. Re-run `npx vitest run src/app/shared` — green.
- [x] 5. Create `src/app/auth/session-catalog-sync.service.test.ts` with the failure test. Confirm red.
- [x] 6. Create `src/app/auth/session-catalog-sync.service.ts` with `adopt()`, injecting `Client` and `DeckArchetypeSettingsService` only, calling the public `GET /api/deck-archetypes` generated method and mapping its rows to `name` strings. → verify: file exists, `npx vitest run src/app/auth/session-catalog-sync.service.test.ts` green, and the source names no `AuthService`.
- [x] 7. Add the sign-in test to `src/app/auth/auth.service.test.ts`. Confirm red.
- [x] 8. Inject `SessionCatalogSyncService` into `AuthService` and call `adopt()` at the end of `login()` and at the end of a successful `bootstrap()`. → verify: `npx vitest run src/app/auth` green, including the step-7 ordering test.
- [x] 9. Create `src/app/backend/browser-local-scope.test.ts` with the scoping assertions. → verify: `npx vitest run src/app/backend/browser-local-scope.test.ts` green.
- [x] 10. Run `npx vitest run src/app/shared src/app/auth src/app/backend` — green.
- [x] 11. Run `npm run test && npm run lint && npm run typecheck && npm run build`. `server-authority-boundary.test.ts` must stay green — no new file calls `localStorage` directly. — 862/862 tests, lint clean, typecheck clean, bundle built; `git diff --stat src/app/backend/server-authority-boundary.test.ts` is empty, so both allowlists are unchanged.
- [x] 12. Manual, with `npm run dev -- --env=demo`: signed out, add the archetype `Local Only` in `/settings`. Sign in as `admin@gones.test`. Sign out again and reopen `/settings` — `Local Only` is gone and the server names are there. Remote prevailed and erased the local list. → verify: recorded as a step in the `## T14 remote-prevails-on-sign-in` section of `ai-artifacts/manual_test_checklist.md`.
- [x] 13. Manual: open the site in a private window while signed out, add an archetype, then open a second tab of the same private session — the archetype is there. That is the browser-wide property. → verify: recorded in the same checklist section.
- [x] 14. Manual: go offline, then sign in with a live refresh cookie (reload the app) — the local catalog is unchanged and nothing throws. → verify: recorded in the same checklist section.

## Outputs

- Files added: `src/app/auth/session-catalog-sync.service.ts`, `src/app/auth/session-catalog-sync.service.test.ts`, `src/app/backend/browser-local-scope.test.ts`.
- Files edited: `src/app/shared/deck-archetype-settings.service.ts`, `src/app/shared/deck-archetype-settings.service.test.ts`, `src/app/auth/auth.service.ts`, `src/app/auth/auth.service.test.ts`.
- Public API change: `DeckArchetypeSettingsService.adoptServerCatalog(names)`; new `SessionCatalogSyncService.adopt()`.
- Behaviour change: signing in (or reloading with a live session) replaces the browser deck-archetype catalog with the server's. Nothing local is uploaded.
- Migration/config: none. No new dependency.

## Validation

- [x] `npx vitest run src/app/shared src/app/auth src/app/backend` passes. — 37 files / 248 tests passed.
- [x] `npm run test` passes, including `src/app/backend/server-authority-boundary.test.ts`. — 103 files / 862 tests; the boundary spec alone 12/12.
- [x] `npm run lint` passes. — "All files pass linting."
- [x] `npm run typecheck` passes. — both `tsconfig.app.json` and `tsconfig.spec.json` clean.
- [x] `npm run build` passes. — "Application bundle generation complete."
- [x] `npm run cy:run -- --spec cypress/e2e/settings-server.cy.js` passes. — run through this host's `steam-run` wrapper (env only, no repo config touched): 4/4 passing. `auth-profile.cy.js` 4/7 and `auth-session-persistence.cy.js` 1/2 are unchanged from the stashed-tree baseline, so this slice adds no failure.
- [ ] Manual: a local-only archetype is erased by signing in; the server names replace it. — queued in `ai-artifacts/manual_test_checklist.md` § T14, unchecked until a human runs it.
- [ ] Manual: signing in offline changes nothing and throws nothing. — queued in the same section.
- [ ] Manual: two tabs of the same anonymous browser session see the same local data. — queued in the same section.
- [x] App functional — no broken path from this slice. → verify: `npm run build` green and the named Cypress spec green on the running stack.
- [x] Commit msg draft: `feat(settings): let the server catalog replace the local one on sign-in` — commit `a9e9cf1` on `feat/feedback-calendar-v1-round-3`, pushed to `origin`.
