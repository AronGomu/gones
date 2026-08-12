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

- [ ] 1. Create `cypress/e2e/auth-route-guards.cy.js` with the guest redirect spec; run `npx cypress run --spec cypress/e2e/auth-route-guards.cy.js` and paste the observed result into the commit message draft.
- [ ] 2. Create `src/app/auth/auth.guards.test.ts` with the four unit tests, using a fake `AuthService` provided through `TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: fake }] })`.
- [ ] 3. Run `npx vitest run src/app/auth/auth.guards.test.ts` and confirm the waiting test fails.
- [ ] 4. In `src/app/auth/auth.service.ts`, add `whenSessionReady(): Promise<void>` — returns `Promise.resolve()` when `this.bootstrapped()`, otherwise a promise resolved by an `effect` on `bootstrapped` created with `EffectRef` cleanup, or by awaiting the in-flight `bootstrap()` promise stored in a new private field `bootstrapFlight?: Promise<void>` set in `bootstrap()`.
- [ ] 5. Store the in-flight promise: in `bootstrap()`, wrap the existing body so `this.bootstrapFlight` holds it and is cleared in `finally`.
- [ ] 6. In `src/app/auth/auth.guards.ts`, change `userGuard` to `async (_route, state) => { const auth = inject(AuthService); const router = inject(Router); await auth.whenSessionReady(); return auth.profile() ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }); }` — capture `inject()` results BEFORE the first `await`.
- [ ] 7. Apply the same shape to `roleGuard()`, `organizerGuard`, `adminGuard` and `verifiedEmailGuard`, keeping every redirect target byte-identical.
- [ ] 8. Run `npx vitest run src/app/auth` — all green.
- [ ] 9. Run `npm run lint && npm run typecheck`.
- [ ] 10. Re-run the Cypress spec from step 1 — green.

## Outputs

- Files touched: `src/app/auth/auth.guards.ts`, `src/app/auth/auth.service.ts`, `src/app/auth/auth.guards.test.ts` (new), `cypress/e2e/auth-route-guards.cy.js` (new).
- Public API change: `AuthService.whenSessionReady()` added; guards now return `Promise<boolean | UrlTree>`.
- No migration, no config change.

## Validation

- [ ] `npx vitest run src/app/auth` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npx cypress run --spec cypress/e2e/auth-route-guards.cy.js` passes
- [ ] manual check: sign out, hard-reload `/registrations`, land on `/login`, sign in, land back on `/registrations`
- [ ] app functional — signed-in navigation to `/registrations`, `/admin`, `/organizer/tournaments` still works
- [ ] commit msg draft: `fix(auth): decide route guards only after session restore`
