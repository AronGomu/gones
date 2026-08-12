# T1: Session-ready auth guards

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** none
**Commit outcome:** every auth guard decides only after the session restore has settled, and a signed-out visitor opening `/registrations` is redirected to `/login?returnUrl=%2Fregistrations` with no flash of the page.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md` — calendar/detail polish, an admin organization workbench, this guard fix, generated demo docs, and a Tournament → Event rename.
- This slice: feedback item 18. `/registrations` was reported reachable while signed out. The route already carries `userGuard`, but the guard reads `AuthService.profile()` synchronously, so any path where routing runs before the startup refresh resolves decides on a null profile — or, worse, decides `true` on a stale profile. This ticket makes the decision await session readiness for all four guards.
- Out of scope here: any visual change to the registrations page, backend auth changes, the Event rename.
- Assumptions in force: `AuthService.bootstrap()` is invoked from `provideAppInitializer` in `src/main.ts` and sets `bootstrapped` to true in its `finally` block, including on failure.

## Requirements

- `userGuard`, `organizerGuard`, `adminGuard`, `verifiedEmailGuard` in `src/app/auth/auth.guards.ts` must all await session readiness before returning.
- Add `AuthService.whenSessionReady(): Promise<void>` in `src/app/auth/auth.service.ts` that resolves immediately when `bootstrapped()` is already true, otherwise resolves when it flips.
- Redirect targets stay exactly as they are today: `userGuard` → `/login` with `queryParams: { returnUrl: state.url }`; `organizerGuard`/`adminGuard` → `/` with `queryParams: { denied: state.url }`; `verifiedEmailGuard` → `/verify-email` with `queryParams: { email }`.
- The Cypress repro must be written and run BEFORE the fix, and its observed behaviour recorded in the commit message — if it already passes, keep it as the regression test and say so plainly.

## Inputs

- `src/app/auth/auth.guards.ts` — current guards, 23 lines, all synchronous `CanActivateFn`.
- `src/app/auth/auth.service.ts` — `readonly bootstrapped = signal(!this.enabled)`, `readonly profile = signal<UserProfileResponse | null>(null)`, `async bootstrap()`.
- `src/app/app.routes.ts` — `{ path: 'registrations', canActivate: [userGuard], … }`.
- `src/main.ts` — `provideAppInitializer(() => { inject(ServerReadCacheService); return inject(AuthService).bootstrap(); })`.
- Existing guard test file to extend: `src/app/shared/first-visit.guard.test.ts` shows the project's guard-testing style (TestBed + `runInInjectionContext`).
- **From Depends:** none.

## TDD

1. **Red** — write `cypress/e2e/auth-route-guards.cy.js` with `guest visiting /registrations is redirected to login with a return url`, and `src/app/auth/auth.guards.test.ts` with the four unit tests below. Run both; record actual results.
2. **Green** — add `whenSessionReady()` and make the four guards async.
3. **Refactor** — none expected; keep guards one-expression where possible.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| `userGuard waits for bootstrap before deciding` | `bootstrapped()` false, profile null, flip `bootstrapped` to true with a profile after 10 ms | resolves `true`, never a `UrlTree` |
| `userGuard redirects an anonymous visitor to login with returnUrl` | bootstrapped true, profile null, `state.url = '/registrations'` | `UrlTree` for `/login` with `returnUrl=/registrations` |
| `adminGuard refuses a plain user after bootstrap` | bootstrapped true, profile `globalRole: 'User'`, `state.url='/admin'` | `UrlTree` for `/` with `denied=/admin` |
| `verifiedEmailGuard redirects an unverified user` | bootstrapped true, profile `emailVerified: false, email: 'a@b.test'` | `UrlTree` for `/verify-email` with `email=a@b.test` |
| `cypress: guest visiting /registrations` | `cy.visit('/registrations')` with no session | URL becomes `/login?returnUrl=%2Fregistrations`; `[data-cy=my-registrations]` never exists |

## Impl steps

- [x] 1. Create `cypress/e2e/auth-route-guards.cy.js` with the guest redirect spec; run `npx cypress run --spec cypress/e2e/auth-route-guards.cy.js` and paste the observed result into the commit message draft. — pre-fix run: `2 passing (2s)`, both guest cases already green (the browser topology awaits `provideAppInitializer`, so the race does not reproduce end-to-end); kept as the regression test.
- [x] 2. Create `src/app/auth/auth.guards.test.ts` with the four unit tests, using a fake `AuthService` provided through `TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: fake }] })`. — written into the existing, matrix-pinned `src/app/auth/auth-guards.test.ts` (`ops/acceptance-matrix.json` targets that path twice) instead of a dot-named twin, with the repo's `Injector.create` guard-test style.
- [x] 3. Run `npx vitest run src/app/auth/auth.guards.test.ts` and confirm the waiting test fails. — `npx vitest run src/app/auth/auth-guards.test.ts` → `Tests 5 failed (5)`, waiting test: `TypeError: You must provide a Promise to expect() when using .resolves, not 'object'`.
- [x] 4. In `src/app/auth/auth.service.ts`, add `whenSessionReady(): Promise<void>` — returns `Promise.resolve()` when `this.bootstrapped()`, otherwise a promise resolved by an `effect` on `bootstrapped` created with `EffectRef` cleanup, or by awaiting the in-flight `bootstrap()` promise stored in a new private field `bootstrapFlight?: Promise<void>` set in `bootstrap()`.
- [x] 5. Store the in-flight promise: in `bootstrap()`, wrap the existing body so `this.bootstrapFlight` holds it and is cleared in `finally`. — body moved to `private restoreSession()`; `bootstrap()` awaits `this.bootstrapFlight` and clears it in `finally`.
- [x] 6. In `src/app/auth/auth.guards.ts`, change `userGuard` to `async (_route, state) => { const auth = inject(AuthService); const router = inject(Router); await auth.whenSessionReady(); return auth.profile() ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }); }` — capture `inject()` results BEFORE the first `await`.
- [x] 7. Apply the same shape to `roleGuard()`, `organizerGuard`, `adminGuard` and `verifiedEmailGuard`, keeping every redirect target byte-identical.
- [x] 8. Run `npx vitest run src/app/auth` — all green. — `Test Files 20 passed (20)`, `Tests 127 passed (127)`.
- [x] 9. Run `npm run lint && npm run typecheck`. — `All files pass linting.`; typecheck exits clean with no output.
- [x] 10. Re-run the Cypress spec from step 1 — green. — `3 passing (4s)` (two guest cases + the signed-in pass-through).
- [x] 11. Wire the new spec into `scripts/full-stack-ci.mjs` so `ops/e2e-spec-coverage.test.ts` stays green. — `npm run test` → `Test Files 105 passed (105)`, `Tests 940 passed (940)`.

## Outputs

- Files touched: `src/app/auth/auth.guards.ts`, `src/app/auth/auth.service.ts`, `src/app/auth/auth.guards.test.ts` (new), `cypress/e2e/auth-route-guards.cy.js` (new).
- Public API change: `AuthService.whenSessionReady()` added; guards now return `Promise<boolean | UrlTree>`.
- No migration, no config change.

## Validation

- [x] `npx vitest run src/app/auth` passes — `Test Files 20 passed (20)`, `Tests 127 passed (127)`
- [x] `npm run lint` passes — `All files pass linting.`
- [x] `npm run typecheck` passes — clean exit, no diagnostics
- [x] `npx cypress run --spec cypress/e2e/auth-route-guards.cy.js` passes — `3 passing`, `All specs passed!`
- [ ] manual check: sign out, hard-reload `/registrations`, land on `/login`, sign in, land back on `/registrations` — handed to a human in `ai-artifacts/manual_test_checklist.md` (`## T1 session-ready-auth-guards`); not agent-verifiable
- [x] app functional — signed-in navigation to `/registrations`, `/admin`, `/organizer/tournaments` still works — `auth-route-guards.cy.js` signed-in case + `admin-orgs.cy.js` (4 passing), `organizer-tournament-management.cy.js` (3 passing), `tournament-registration.cy.js` (5 passing); `npm run build` completes
- [x] commit msg draft: `fix(auth): decide route guards only after session restore`
