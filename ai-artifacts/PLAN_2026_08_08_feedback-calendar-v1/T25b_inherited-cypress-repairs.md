# T25b: Repair the five inherited Cypress failures *(parent-added)*

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T24
**Commit outcome:** `npm run e2e:ci` runs every spec green, so T25's release gate is reachable.

## Why this ticket exists

T24 was the first ticket in this plan to run the **full** suite under the release topology
(`npm run e2e:ci`, Docker on 8081). It found **12 specs + smoke green and 5 red**, and reproduced all five
byte-identically against a stashed unmodified `HEAD` on the same stack — so none is T24 fallout.

Every earlier ticket validated only the one or two specs it touched, under `ng serve` on 4200, because the
standing guidance was "never run all 17 specs under `ng serve`". That guidance was right, but it meant nobody
ran the release gate for the length of the plan. This ticket pays that debt in one place.

T25's Validation requires `npm run e2e:ci` to pass. It cannot while these five are red, so this ticket runs
**before** T25.

## The five failures

| Spec | Owning commit | Verbatim failure |
| --- | --- | --- |
| `cypress/e2e/tournament-registration.cy.js` (› My Registrations) | T22 `f0cedbe` | ``AssertionError: Timed out retrying after 4000ms: Expected to find element: `[data-cy="menu-registrations-card"]`, but never found it.`` |
| `cypress/e2e/offline-public-read.cy.js` | T14 `9dab0a2` | ``AssertionError: Timed out retrying after 4000ms: Expected to find element: `.calendar-offline-banner`, but never found it.`` |
| `cypress/e2e/abuse-surface.cy.js` | `80cc6ed` (predates this branch) | ``CypressError: Timed out retrying after 5000ms: `cy.wait()` timed out waiting `5000ms` for the 1st request to the route: `tournaments`. No request ever occurred.`` |
| `cypress/e2e/auth-profile.cy.js` | T11 `ad701dd` | not captured verbatim — capture it first |
| `cypress/e2e/admin-orgs.cy.js` | `bc7c361` (predates this branch) | not captured verbatim — capture it first |

## Requirements

- `npm run e2e:ci` exits 0 with every spec green.
- **For each of the five, the report states explicitly whether the defect was in the application or in the spec**,
  with the evidence that settled it. A spec is only edited once the application has been cleared.
- No behaviour is changed to make a test pass. If an application fix is warranted, it fixes the real defect.
- `npm run test && npm run lint && npm run typecheck && npm run build` stay green.

## The rule that governs this whole ticket

**A failing assertion is a claim that the product is broken. Prove it wrong before you touch it.**
The cheap move — relax the assertion until it goes green — destroys the only signal these specs carry. For each
failure: reproduce it, find the mechanism, decide whether the *product* or the *test* states the wrong thing, and
only then edit. Say which one you concluded and why.

## Inputs

- **`tournament-registration.cy.js` is the one that most likely hides a real bug, and it must be settled first.**
  It passes **5/5 under `ng serve` on 4200** (the parent verified this at T22) and fails on 8081. The card renders
  behind `@if (auth.profile())` in `src/app/features/menu/home-menu.component.ts`. On 8081 the app calls a
  **cross-origin** API on `http://127.0.0.1:5080` (`GONES_FRONTEND_API_BASE_URL`, `scripts/full-stack-ci.mjs:15`)
  and the release build registers the **ngsw service worker**, neither of which is true under `ng serve`.
  The spec fakes its session with `cy.intercept('POST', '**/api/auth/refresh', …)` + `cy.intercept('GET', '**/api/users/me', …)`.
  Candidate mechanisms, in the order worth testing:
  1. the service worker serves or bypasses those requests so `cy.intercept` never applies → `auth.profile()` stays
     null → the card legitimately does not render **in the test**, and the product is fine;
  2. bootstrap genuinely fails cross-origin in the release build → **the product is broken for real users** and the
     card is missing for everyone;
  3. a race: the menu renders before `profile()` resolves and never re-renders.
  (1) and (3) are test/timing defects. **(2) is a release blocker.** Distinguish them by observing what the browser
  actually requests — log requests from the spec, or check whether *other* authenticated assertions in the same spec
  still hold on 8081.
- `offline-public-read.cy.js` expects `.calendar-offline-banner`. T14 (`9dab0a2`) rewrote the calendar page around a
  24h-cached full catalog and a single fuzzy input; the offline banner may have been removed, renamed, or made
  conditional on state the spec no longer produces. Check `src/app/features/calendar/public-calendar.component.ts`
  and `src/app/shared/offline-banner.component.ts` before assuming the spec is stale — **if the banner really is gone,
  users lost an offline affordance and that is a product regression to restore, not a spec to delete.**
- `abuse-surface.cy.js` waits on a `tournaments` route that never fires. T12/T13/T14 replaced per-view calendar
  fetches with one cached `GET /api/tournaments/all`, so the request the spec waits for may no longer exist by that
  name — retarget it at the request the app actually makes, and confirm the abuse assertion still means what it meant.
- `auth-profile.cy.js` and `admin-orgs.cy.js` — capture the verbatim failures first; neither was recorded. Note
  `auth-profile.cy.js` has a **documented pre-existing baseline failure** under `ng serve`: its "starts explicit
  provider linking" case hard-codes a redirect to `127.0.0.1:8081`. Under `e2e:ci` the base URL *is* 8081, so that
  particular case should now pass — whatever fails here is something else.
- `scripts/full-stack-ci.mjs` — the gate. `runCypress(spec)` at `:41`, spec list from `:63`.

## Environment facts

- **Run the gate with `npm run e2e:ci`.** A bare `npm run cy:run` dies on this NixOS host with
  `libglib-2.0.so.0: cannot open shared object file`, and most specs only pass under the release topology on 8081.
  `e2e:ci` rebuilds the release profile, resolves the NixOS `LD_LIBRARY_PATH` itself and seeds the auth fixture.
- **The auth rate limit does not constrain `e2e:ci`.** `scripts/full-stack-ci.mjs:14` sets
  `GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: '1000'` in the release compose env. The 5-per-15-minute limit that throttled
  T9/T10/T11 only applies to hand-run specs against the dev API on 5080. Run the full gate as often as you need.
- **`cy.session()` does not work against this backend** — refresh tokens are single-use and rotate
  (`RefreshSessionService.RotateAsync`), while `cy.session()` snapshots cookies once. Proved dead twice. Do not retry.
- To iterate on one spec without a full rebuild, the release stack is already up; drive a single spec with
  `node node_modules/cypress/bin/cypress run --spec <spec> --config baseUrl=http://127.0.0.1:8081,screenshotOnRunFailure=false`
  after exporting the `LD_LIBRARY_PATH` that `full-stack-ci.mjs:28-36` computes.
- **There is no Angular `TestBed` and no zone.js**, and `@angular/common/http/testing` is not installed. If a fix
  needs a unit test: services → `Injector.create` + `vi.fn()` stubs; components → bare `Injector` +
  `runInInjectionContext` with `effect()` stubbed; template shape → `readFileSync` on the source.

## TDD

1. **Red** — capture all five verbatim failures from one `npm run e2e:ci` run. That output is the work list.
2. **Green** — settle them one at a time, application-first, re-running the single spec after each.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `registrations card resolves on the release topology` | `tournament-registration.cy.js` on 8081 | 5/5, and the report says whether the product or the spec was wrong |
| `offline banner claim is settled` | `offline-public-read.cy.js` on 8081 | green, with a statement of whether the banner still exists for users |
| `abuse surface waits on a request the app makes` | `abuse-surface.cy.js` on 8081 | green, assertion still meaningful |
| `auth profile passes on 8081` | `auth-profile.cy.js` | green including the provider-linking case that needs 8081 |
| `admin orgs passes on 8081` | `admin-orgs.cy.js` | green |
| `full release gate` | `npm run e2e:ci` | exit 0, every spec green |

## Impl steps

- [ ] 1. Run `npm run e2e:ci` and capture the verbatim failure for all five specs — validate: five failure blocks saved, including the two never recorded.
- [ ] 2. Settle `tournament-registration.cy.js` **first**, application-first per the Inputs. Validate: spec 5/5 **and** a written verdict — product defect or test defect — with the observation that settled it.
  - [ ] 2a. If it is mechanism (2), a genuine cross-origin bootstrap failure, **stop and report it as a release blocker** before writing any fix; it affects far more than this spec.
- [ ] 3. Settle `offline-public-read.cy.js`. Validate: spec green + a statement of whether the offline banner still reaches users; if it was lost in T14, restore it rather than deleting the assertion.
- [ ] 4. Settle `abuse-surface.cy.js` by retargeting the wait at the request the app actually issues. Validate: spec green and the abuse assertion still asserts abuse.
- [ ] 5. Settle `auth-profile.cy.js`. Validate: spec green on 8081.
- [ ] 6. Settle `admin-orgs.cy.js`. Validate: spec green on 8081.
- [ ] 7. Add a `runCypress('cypress/e2e/auth-session-persistence.cy.js')` block to `scripts/full-stack-ci.mjs` after the `auth-profile.cy.js` block — T2 shipped that spec but never enumerated it, so `e2e:ci` has been skipping it. Validate: the spec appears in the run output and passes.
- [ ] 8. Run `npm run test && npm run lint && npm run typecheck && npm run build`. Validate: all green.
- [ ] 9. Run `npm run e2e:ci` end to end. Validate: exit 0, every spec green including the newly enumerated one.

## Outputs

- Files touched: up to five `cypress/e2e/*.cy.js`, `scripts/full-stack-ci.mjs`, and any `src/` file a **real** product defect requires.
- Public API / behavior change: none intended. Any application change must be a genuine defect fix, named as such.
- Migrate / config: none.

## Validation

- [ ] `npm run e2e:ci` passes in full, every spec green
- [ ] `npm run test && npm run lint && npm run typecheck && npm run build` pass
- [ ] each of the five failures has a written product-or-test verdict backed by evidence
- [ ] `auth-session-persistence.cy.js` now runs inside `e2e:ci`
- [ ] app functional — no behaviour changed except a named defect fix
- [ ] commit msg draft: `test(e2e): repair the inherited Cypress failures and enumerate the session spec`
