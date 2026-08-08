# T21: First-visit About redirect

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T1
**Commit outcome:** The very first visit to the application lands on `/about`; every later visit from the same browser lands on the home menu.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is General §5: "On first visit of application: open about page first. Cache in browser so that next visits go to menu / home page afterward."
- This slice: one guard, one storage flag, tests.
- Out of scope here: the About page content, the home menu cards.
- Assumptions in force:
  - The flag is per-browser, stored in `localStorage`; a private window is a fresh first visit, which is the intended behaviour.
  - The redirect applies only to the root path `/`. A deep link (a shared tournament URL, a mail link, a token review page) is never intercepted.
  - Visiting `/about` directly also marks the flag, so the user is not bounced there again on their next visit to `/`.

## Requirements

- On the first navigation to `/`, the router redirects to `/about` and sets the flag.
- On any later navigation to `/`, the home menu renders and no redirect happens.
- Visiting `/about` directly sets the flag too.
- Any other route is untouched, first visit or not.
- A browser that refuses `localStorage` (private mode, disabled storage) always renders the home menu and never loops.
- `src/app/backend/server-authority-boundary.test.ts`'s `localStorage` allowlist is extended with the new file plus a justifying comment.

## Inputs

- `src/app/app.routes.ts:58-59` — the two routes involved:
  ```
  { path: '', loadComponent: () => import('./features/menu/home-menu.component').then((m) => m.HomeMenuComponent) },
  { path: 'about', loadComponent: () => import('./features/menu/about.component').then((m) => m.AboutComponent) },
  ```
  Both are unconditional, outside every capability flag.
- `src/app/auth/auth.guards.ts` — the file's guard idiom: `export const userGuard: CanActivateFn = (_route, state) => { … return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }); };`
- `src/app/backend/server-authority-boundary.test.ts` — `it('keeps global browser storage access inside the documented browser-only allowlist')` asserts `filesMatching(/localStorage\??\.(get|set|remove)Item/)` equals exactly:
  ```
  'src/app/features/calendar/public-calendar.component.ts',
  'src/app/features/calendar/public-tournament.service.ts',
  'src/app/shared/deck-archetype-settings.service.ts'
  ```
  (T13 may already have added `all-tournaments-cache.service.ts`.) A new `localStorage` caller **fails this test** until it is listed with a comment. Mandatory.
- `src/app/shared/deck-archetype-settings.service.ts` — the existing pattern for guarded `localStorage` access with a `try/catch` around every call.
- `src/app/data-mode-routes.test.ts` — the routing test file to extend.
- `src/app/features/menu/about.component.ts` — 246 lines; the About page itself needs no change beyond marking the flag, which the guard does.
- **From Depends (T1):** the `data-cy` rule exists; this ticket adds no template markup.

## TDD

1. **Red** — write `src/app/shared/first-visit.service.test.ts` and `src/app/shared/first-visit.guard.test.ts` against modules that do not exist.
2. **Green** — add the service, the two guards, the route wiring and the allowlist entry.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `is a first visit with no flag` | empty storage | `isFirstVisit()` is `true` |
| `is not a first visit once marked` | `markVisited()` then `isFirstVisit()` | `false` |
| `survives a new service instance` | mark, construct a fresh service | `isFirstVisit()` is `false` |
| `treats unavailable storage as visited` | `localStorage.getItem` throwing | `isFirstVisit()` is `false` |
| `never throws when marking fails` | `localStorage.setItem` throwing | `markVisited()` resolves silently |
| `home guard redirects on the first visit` | empty storage | returns a `UrlTree` for `/about` and the flag is set |
| `home guard passes afterwards` | flag set | returns `true` |
| `about guard always passes and marks` | empty storage | returns `true`; `isFirstVisit()` becomes `false` |
| `deep links are untouched` | navigate to `/calendar` on a first visit | no redirect (the guard is not attached to that route) |

Run: `npm run test -- first-visit data-mode-routes server-authority-boundary`

## Impl steps

- [ ] 1. Create `src/app/shared/first-visit.service.ts` with `export const FIRST_VISIT_KEY = 'gones.first-visit.completed';` and `@Injectable({ providedIn: 'root' }) export class FirstVisitService`.
- [ ] 2. Implement `isFirstVisit(): boolean { try { return globalThis.localStorage?.getItem(FIRST_VISIT_KEY) !== 'true'; } catch { return false; } }` — a storage failure must mean "not a first visit", so a browser without storage never loops through `/about`.
- [ ] 3. Implement `markVisited(): void { try { globalThis.localStorage?.setItem(FIRST_VISIT_KEY, 'true'); } catch { /* Preference is optional. */ } }`.
- [ ] 4. Create `src/app/shared/first-visit.guard.ts` with:
  ```
  export const firstVisitHomeGuard: CanActivateFn = () => {
    const service = inject(FirstVisitService);
    if (!service.isFirstVisit()) return true;
    service.markVisited();
    return inject(Router).createUrlTree(['/about']);
  };

  export const markVisitedGuard: CanActivateFn = () => {
    inject(FirstVisitService).markVisited();
    return true;
  };
  ```
- [ ] 5. In `src/app/app.routes.ts`, attach them:
  ```
  { path: '', canActivate: [firstVisitHomeGuard], loadComponent: () => import('./features/menu/home-menu.component').then((m) => m.HomeMenuComponent) },
  { path: 'about', canActivate: [markVisitedGuard], loadComponent: () => import('./features/menu/about.component').then((m) => m.AboutComponent) },
  ```
- [ ] 6. Add the import of both guards at the top of `src/app/app.routes.ts`.
- [ ] 7. In `src/app/backend/server-authority-boundary.test.ts`, add to the `localStorage` allowlist array, keeping it sorted:
  ```
  // First-visit flag — routes the very first load to /about, never a data source.
  'src/app/shared/first-visit.service.ts',
  ```
- [ ] 8. Create `src/app/shared/first-visit.service.test.ts` with Test plan rows 1-5, installing a fake `localStorage` on `globalThis` and, for the throwing cases, one whose methods throw.
- [ ] 9. Create `src/app/shared/first-visit.guard.test.ts` with Test plan rows 6-8, and a `Router` stub whose `createUrlTree` records its argument. **There is no `TestBed` in this repo** — `@angular/core/testing` and zone.js are not installed. Use `Injector.create({ providers: [...] })` plus `runInInjectionContext(injector, () => firstVisitHomeGuard(routeStub, stateStub))`, both imported from `@angular/core`; see `src/app/features/settings/account-settings.component.test.ts` for the established shape.
- [ ] 10. Add to `src/app/data-mode-routes.test.ts`: the `''` route's `canActivate` contains `firstVisitHomeGuard`, the `about` route's contains `markVisitedGuard`, and the `calendar` route has no `canActivate` (Test plan row 9).
- [ ] 11. Add a Cypress case to `cypress/e2e/public-calendar.cy.js` or a new `cypress/e2e/first-visit.cy.js`: `cy.clearLocalStorage()`, `cy.visit('/')`, assert `cy.location('pathname')` is `/about`; then `cy.visit('/')` again and assert it stays on `/` with `[data-cy=menu-about-link]` visible.
- [ ] 12. Fix the specs that land on `/`. The sweep is already done: `grep -rn "cy.visit('/')\|cy.visit(\"/\")" cypress/e2e/` matches **exactly one** line across all 17 specs — `cypress/e2e/auth-session-persistence.cy.js:35`. Seed the flag there before the visit (`cy.window().then(win => win.localStorage.setItem('gones.first-visit.completed', 'true'))`) so the reload assertion still lands on the menu. Re-run the grep after your change to confirm nothing else regressed — validate: the grep output is limited to that spec and it passes.
- [ ] 13. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 14. Run the affected specs — **not** the whole suite. `npm run cy:run` would launch all 17 specs, most of which only pass under the release Docker topology on 8081 (`scripts/full-stack-ci.mjs` drives those), so running them under `ng serve` produces failures unrelated to this ticket. Step 12 established that exactly one existing spec is affected. Run: your new `cypress/e2e/first-visit.cy.js`, `cypress/e2e/auth-session-persistence.cy.js` and `cypress/e2e/public-calendar.cy.js`. **`auth-session-persistence.cy.js` performs a real login**, costing one of only 5 auth permits per 15 minutes per IP on this host — run it once, and do not loop on it. — validate: all three specs green in a single pass.

## Outputs

- Files created: `src/app/shared/first-visit.service.ts`, `src/app/shared/first-visit.service.test.ts`, `src/app/shared/first-visit.guard.ts`, `src/app/shared/first-visit.guard.test.ts`, possibly `cypress/e2e/first-visit.cy.js`.
- Files touched: `src/app/app.routes.ts`, `src/app/data-mode-routes.test.ts`, `src/app/backend/server-authority-boundary.test.ts`, several `cypress/e2e/*.cy.js`.
- Public API / behavior change: a brand-new browser lands on `/about` once.
- Migrate / config: a new `localStorage` key `gones.first-visit.completed`.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] `first-visit.cy.js`, `auth-session-persistence.cy.js` and `public-calendar.cy.js` pass (see step 14 — the full 17-spec suite needs the release Docker topology and is not this ticket's gate)
- [ ] manual check: open a private window on `http://127.0.0.1:4200/` and land on `/about`; navigate home, reload, and stay on the menu
- [ ] manual check: in a private window, open `/calendar/tournaments/<slug>` directly and confirm no redirect
- [ ] app functional — every other route unchanged
- [ ] commit msg draft: `feat(navigation): send the first ever visit to the About page`
