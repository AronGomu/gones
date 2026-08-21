# T4: Seed the first-visit flag in the home-card test

**Plan:** `./artifacts/PLAN_2026_08_21_e2e-suite-repair.md`
**Depends:** T1
**Commit outcome:** The Global Rankings home-card case stops depending on leftover state from whichever test ran before it.

## Context (self-contained)

- Failing case: `cypress/e2e/global-stats.cy.js` → `home page shows a Global Rankings card that
  navigates to /global-stats`. It fails with `[data-cy="menu-global-stats-card"]` not found.
- The card itself is **not** gated — it renders unconditionally in
  `src/app/features/menu/home-menu.component.ts:25`. The page never renders at all: `/` is guarded by
  `firstVisitHomeGuard` (`src/app/shared/first-visit.guard.ts:5-9`), which redirects a browser that
  has no `gones.first-visit.completed` key in `localStorage` to the About page.
- The case does `cy.visit('/')` with **no** `onBeforeLoad` and seeds that key nowhere. Cypress
  `testIsolation` (on by default in Cypress 15) clears `localStorage` between tests, so it only ever
  passed when an earlier test in the same browser happened to leave the key behind — a coincidence,
  not a guarantee. That is why it is flaky-by-design on a dev server and consistently red on the
  release stack.
- Note the guard runs at `canActivate` time, **not** at bootstrap. So setting the key on the live
  window after the redirect has already happened does not retroactively fix the navigation — the
  test has to navigate again once the key is in place.
- The release build's ngsw service worker also prevents `onBeforeLoad` from running at all (see T3
  for the full explanation), so a seed placed only in `onBeforeLoad` is not sufficient by itself on
  the release stack.

## Requirements

- The case passes against the **release stack**, and does so deterministically — it must not depend
  on any other test having run first.
- It must still be a real test of the home card: it asserts the card exists and that clicking it
  navigates to `/global-stats`. Do not reduce it to a smoke check.
- Do not disable `testIsolation`, for this spec or globally. That would trade one flaky test for a
  suite-wide source of order dependence.
- Do not change `firstVisitHomeGuard` or the home component. The guard is behaving correctly; the
  test is what is under-specified.
- Use the same SEED_MARKER technique the rest of the suite uses (see `offline-public-read.cy.js` and
  commit `0cfb2be`) rather than inventing a second mechanism — with the extra step that after the key
  lands, the test must navigate again so the guard re-evaluates.

## Inputs

- `cypress/e2e/global-stats.cy.js` — the failing case, and the `mockCatalog()` / `beforeEach` setup
  the rest of the file uses.
- `src/app/shared/first-visit.guard.ts` — the guard and the exact storage key it reads.
- `src/app/features/menu/home-menu.component.ts` — confirms the card is ungated, so the fix belongs
  in the test.
- `cypress/e2e/first-visit.cy.js` — the spec that deliberately asserts the *unvisited* browser
  behaviour. Read it to make sure your change cannot weaken what it proves; it must keep passing.
- `cypress/e2e/offline-public-read.cy.js` (~lines 21-28) — the SEED_MARKER pattern.

## TDD

The test exists and is red. Confirm red against the release stack, fix, confirm green. Then prove it
is order-independent: run `global-stats.cy.js` on its own, in a fresh browser, and confirm it still
passes — that is the property that was missing.

## Impl steps

- [ ] 1. Reproduce the failure on a clean release stack.
- [ ] 2. Seed `gones.first-visit.completed` for this case, using the SEED_MARKER pattern so it works
      whether or not `onBeforeLoad` ran.
- [ ] 3. Re-navigate after the key is in place, since the guard evaluates at `canActivate`.
- [ ] 4. Confirm the case passes, and that it still asserts both the card's presence and the
      navigation to `/global-stats`.
- [ ] 5. Run `cypress/e2e/global-stats.cy.js` alone in a fresh browser — passes with no help from
      other specs.
- [ ] 6. Run `cypress/e2e/first-visit.cy.js` — still passes, still proves the unvisited-browser
      behaviour.

## Outputs

- `cypress/e2e/global-stats.cy.js`
- No app change, no backend change.

## Validation

- [ ] Release stack: `home page shows a Global Rankings card that navigates to /global-stats` passes
- [ ] The spec passes when run alone against a fresh browser
- [ ] `cypress/e2e/first-visit.cy.js` still passes
- [ ] `git diff --stat` shows only `cypress/e2e/global-stats.cy.js`
- [ ] commit msg draft: `test(e2e): seed the first-visit flag before asserting the home card`
