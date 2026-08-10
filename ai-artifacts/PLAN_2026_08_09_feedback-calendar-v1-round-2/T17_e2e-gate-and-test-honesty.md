# T17: Restore the e2e gate and close the mutation-proven test gaps

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T16
**Commit outcome:** `npm run cy:run` and `npm run e2e:ci` are green again, and four assertions that passed while their behaviour was broken now fail when it breaks

## Context (self-contained)

The parent orchestrator ran an independent `deep` reviewer fanout (correctness, security, scope-drift,
tests — read-only) over the whole plan diff. Two reviewers independently found that three committed Cypress
specs are red, and that earlier tickets misreported those failures as "pre-existing". They are not
pre-existing: each was introduced inside this plan's own commit range. The parent re-verified every claim
below against the source. Treat them as facts, not hypotheses.

This repo has a standing rule — a capability is not proved without executable evidence, and
`ops/acceptance-matrix.json` maps capabilities to specs that actually run. Right now three matrix rows cite
specs that are red, so the matrix claims "proved" from a failing gate. Closing that is the point of this ticket.

The `tests` reviewer ran mutation testing in a throwaway copy: it edited the implementation to be wrong and
watched the suite stay green. Every gap in the second half of this ticket is mutation-proven, not suspected.

Out of scope: any new product behaviour, any `backend/**` C# change, and re-opening the T16 fixes.

## Requirements

1. `npm run cy:run` passes.
2. `npm run e2e:ci` passes.
3. No spec asserts a locale-dependent string that the release topology renders in French.
4. The four mutation-proven vacuous assertions fail when their behaviour is broken.
5. `ops/dev-accounts.test.ts`'s release-compose guard cannot be defeated by a different spelling.

## Inputs

- `cypress/e2e/public-calendar.cy.js` — the month-navigation case, around lines 65-85.
- `cypress/e2e/auth-session-persistence.cy.js` — line 72.
- `cypress/e2e/live-local.cy.js` — the T4 delete case, around line 136.
- `cypress/e2e/league-local.cy.js` — lines 239-277, and its own comment at line 245 documenting the
  `indexedDB.deleteDatabase` race and how it handles it. **That file is the worked example for fixing
  `live-local.cy.js`.**
- `src/app/features/calendar/public-calendar.component.ts` — the month grid renders
  `<time [attr.datetime]="day.date" data-cy="calendar-month-day-date">{{ day.day }}</time>`. The `datetime`
  attribute is an ISO `YYYY-MM-DD` string and is the locale-independent witness the spec needs.
- `src/app/app.component.ts` — the toolbar sign-in entry that replaced the deleted home-menu login card.
- `src/app/auth/auth-entry.component.ts` (around lines 140-142), `src/app/auth/login-validation.ts`,
  `src/app/auth/login-validation.test.ts`, `src/app/auth/auth-entry.register.test.ts` — the latter already
  instantiates the component without TestBed via `runInInjectionContext`; copy that pattern.
- `src/app/features/calendar/public-calendar.component.ts` (around line 110) — the
  `@if (pageCount() > 1)` pagination guard.
- `src/app/features/leagues-archive/league-archive-list.component.test.ts` line 31.
- `src/app/features/calendar/public-calendar.ts` (around lines 71-77) — `sortTournamentsForList`.
- `ops/dev-accounts.test.ts` line 65.
- `scripts/full-stack-ci.mjs` — the spec list the `e2e:ci` gate runs; it aborts on the first failing spec.
- **From Depends (T16, `c2dabb5`):** local restore is now additive and always mints a fresh id, and mirrors
  the server's name-uniquifying, so a duplicate import shows as `X (restored)`. A full export refuses to
  write only when the server read failed **and** the visitor is signed in.

### The three red specs — already diagnosed, do not re-investigate

**R1 — `public-calendar.cy.js`, locale-dependent assertion (introduced by commit `ccffb6e`).**
Before this plan the spec asserted `cy.get('[data-cy="calendar-pill-lyon-legacy"]')`, with a comment stating
that the tournament's own pill is *"the locale-independent witness that the grid moved: the month label is
translated, and on the release build the ngsw worker can answer the navigation from cache so
`onBeforeLoad`'s language seed never runs."* That ticket emptied the day cells, deleting the pill — correct —
but replaced the witness with `should('contain.text', 'August')` on `[data-cy="calendar-month-label"]`, which
is precisely what the deleted comment warned against. The release run reads `août 2026` and fails. The
day cell's `datetime` attribute is the replacement witness: it is machine-readable and never translated.

**R2 — `auth-session-persistence.cy.js:72` asserts a deleted element (introduced by commit `f4e7cab`).**
`cy.get('[data-cy="menu-login-card"]').should('be.visible')` in `leaves anonymous browsing untouched when
there is no session cookie`. That ticket moved the sign-in entry point into the toolbar and deleted
`menu-login-card`; `grep -rn "menu-login-card" src/` now returns nothing but a vitest assertion that the
deletion happened. A reviewer confirmed against a worktree at the pre-plan commit that this spec passed
before the range, and confirmed the live failure: `Expected to find element: [data-cy="menu-login-card"],
but never found it`. The ticket that deleted the card had no "grep cypress/ for the retired selector" step;
a sibling ticket did, which is why only this one slipped.

**R3 — `live-local.cy.js` delete case is order-dependent (introduced by commit `ce3614e`).**
The new case asserts `[data-cy="running-tournament-empty-state"]` after deleting its tournament. It fails in
the gate: an instrumented DOM dump at that point shows the *previous* test's tournament still listed
(`Local Cup … 3 Swiss rounds … Resume`), because `indexedDB.deleteDatabase` in `onBeforeLoad` was blocked by
the still-open live connection — exactly the race `league-local.cy.js:245` documents and works around. Run
the same case with `it.only` and it passes, so the delete feature itself is correct; only the assertion's
assumption about a clean store is wrong.

### The four mutation-proven test gaps

**G1 — the login validation gate has no behavioural coverage.** `login-validation.test.ts` tests only the pure
predicate plus template/stylesheet string matches. Rewriting `auth-entry.component.ts:140-142` to
`loginValid = computed(() => isValidLoginEmail(this.email()))` and dropping both `.length > 0` pristine guards
leaves the whole vitest suite green — shipping a submit button enabled with an empty password and both
validity messages rendered on a pristine empty form. `auth-profile.cy.js` fills both fields before clicking,
so it does not catch it either.

**G2 — the pagination guard's absence is untested.** The test asserts `pageCount() === 1` but never that the
nav is gone. Deleting the `@if (pageCount() > 1)` guard ships a dead pagination bar with two disabled buttons
on every single-page list, and nothing fails.

**G3 — `local rows are badged` does not prove the badge is inside the guard.** It asserts that
`@if (isLocal(league)) {` exists and that the badge's `data-cy` exists, independently. Hoisting the badge out
of the guard and leaving a dummy element inside keeps it green — every server row would then show a "local"
badge. (`league-local.cy.js` does catch this, so this is defence in depth.)

**G4 — `sortTournamentsForList` only exercises the title comparator.** Deleting the `venueStartTime` and `id`
comparators keeps all 158 calendar tests green. Two same-date same-title tournaments could then reorder
between page loads, which duplicates or drops a row across the 20-per-page boundary.

## TDD

For G1–G4 the red step is the point: **first** make the assertion strong enough to fail against a deliberately
broken implementation, prove it fails, restore the implementation, prove it passes. Capture both outputs.
For R1–R3 the red state already exists — run the spec, capture the failure, fix, re-run.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| month navigation moves the grid | click Next from `2026-08` | a day cell with `datetime="2026-09-15"` exists and none with `datetime="2026-08-15"`; reverse after Prev. No translated month name asserted anywhere |
| anonymous browsing is untouched | no session cookie, visit `/` | the toolbar sign-in entry is visible; no assertion on any deleted home-menu element |
| deleting a local tournament empties the list | delete the only tournament | empty state shown, and the case passes both standalone and in file order |
| submit stays disabled on a pristine empty form | fresh component, no input | `loginValid()` false, no validity message rendered |
| submit stays disabled with a valid email and a 2-char password | `admin@gones.test` + `ab` | `loginValid()` false |
| submit enables with a valid email and a 3-char password | `admin@gones.test` + `abc` | `loginValid()` true |
| pagination is absent for a single page | 5 tournaments | no `calendar-pagination` element in the rendered output |
| the local badge only renders for local rows | one server league, one local league | badge present on the local row, absent on the server row |
| sorting falls through to time then id | equal date and title, differing `venueStartTime`; then equal both, differing `id` | order follows `venueStartTime`, then `id` |
| release compose never defaults the cookie insecure | both release compose files | a spelling-tolerant pattern, not one literal substring |

## Impl steps

- [x] 1. Run the three red specs and capture the real failure output for each.
      Evidence: `auth-session-persistence.cy.js` → ``Expected to find element: `[data-cy="menu-login-card"]`, but never found it``;
      `public-calendar.cy.js` (release baseUrl 8081) → `-'août 2026' +'August'` at line 81;
      `live-local.cy.js` (release baseUrl 8081) → ``Expected to find element: `[data-cy="running-tournament-empty-state"]`, but never found it`` at line 136.
- [x] 2. R1: in `public-calendar.cy.js`, replace both `calendar-month-label` text assertions with
      `[data-cy="calendar-month-day-date"][datetime="…"]` existence checks on a mid-month date (a mid-month
      day is always in-month, never a muted leading/trailing cell). Restore a comment saying why the witness
      must be locale-independent — keep the substance of the one commit `ccffb6e` deleted.
- [x] 3. R2: in `auth-session-persistence.cy.js:72`, assert the toolbar sign-in entry that replaced the card.
      Use the `data-cy` the toolbar actually ships; read `src/app/app.component.ts` to get it right. The
      case's intent — anonymous browsing still works with no session cookie — must survive unchanged.
- [x] 4. R3: make the `live-local.cy.js` delete case independent of the previous test's store, using the same
      technique `league-local.cy.js` already uses for the blocked-`deleteDatabase` race. Prove it passes both
      with `it.only` and in full file order.
      Evidence (release topology, baseUrl 8081): with `it.only` → `1 passing`, `All specs passed!`;
      in full file order → `2 passing`, `All specs passed!`. Also green inside `npm run e2e:ci`.
- [x] 5. Check `league-local.cy.js:276-277`: T16 made restore additive with name uniquifying, so the
      leftover-league path its comment at line 245 describes can now yield 3-4 rows where the assertion
      expects exactly 2. Make the assertion express the intent rather than a count that depends on leftovers.
- [x] 6. `grep -rn "data-cy=" cypress/ | ...` — sweep every `data-cy` selector any spec asserts against
      `src/`, and report any other retired selector. This is the step that would have caught R2. Fix what it
      finds inside `cypress/**`; anything it finds elsewhere goes in the report, not the diff.
      Evidence: swept all 246 exact + 2 partial `[data-cy="…"]` selectors in `cypress/**` against every
      static `data-cy="…"` and every `[attr.data-cy]` literal fragment in `src/**`. Three unmatched:
      `login-link` (prose inside an explanatory comment, not a selector), and
      `settings-migration-export-button` / `settings-migration-warning`, both asserted
      `should('not.exist')` in `server-data-authority.cy.js:76-77` — deliberately-retired ADR 0020
      surfaces whose absence is the assertion. No positive assertion on a retired selector remains.
      Nothing found outside `cypress/**`.
- [x] 7. G1: add behavioural tests for the login gate by instantiating the component the way
      `auth-entry.register.test.ts` does with `runInInjectionContext`. Prove them red first by making the
      component's `loginValid` the broken version from the diagnosis, then restore it.
      Evidence: new `src/app/auth/auth-entry.login-gate.test.ts`. With `loginValid` rewritten to
      `computed(() => isValidLoginEmail(this.email()))` and both `.length > 0` pristine guards dropped:
      `Tests  3 failed | 21 passed (24)` — all three failures in the new file, `login-validation.test.ts`
      stayed green. Implementation restored (`git diff` on the component is empty): `Tests  24 passed (24)`.
- [x] 8. G2: assert the pagination nav is absent for a single page, not just that `pageCount()` is 1.
      Evidence: `pagination is hidden for a single page` now also pins the nav inside `@if (pageCount() > 1) {`.
      Guard deleted from the component → `Tests  1 failed | 50 passed (51)`; restored → `51 passed`.
- [x] 9. G3: assert the badge renders for a local row and does not for a server row.
      Evidence: badge hoisted out of `@if (isLocal(league)) {` with a dummy element left inside →
      `Tests  1 failed | 5 passed (6)`; restored → `6 passed`.
- [x] 10. G4: cover the `venueStartTime` and `id` comparator fall-through.
      Evidence: `venueStartTime` and `id` comparators deleted from `sortTournamentsForList` →
      `Tests  2 failed | 160 passed (162)` across `src/app/features/calendar/`; restored → `162 passed`.
- [x] 11. `ops/dev-accounts.test.ts:65`: replace the single-substring guard with a pattern that also rejects
      `: "false"`, `: false` and a `${…:-False}` default in the release compose files. Both files are clean
      today, so this must stay green.
      Evidence: clean files → `Tests  9 passed (9)`. Injecting each of `: false`, `: "false"`,
      `${…:-False}` and `:-false` into `compose.release-test.yaml` failed the assertion every time
      (1 failing assertion per spelling); the file was restored afterwards.
- [x] 12. Run `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`.
      Evidence: `Test Files  93 passed (93)` / `Tests  774 passed (774)`; `All files pass linting.`;
      typecheck silent (both projects); `Application bundle generation complete.`
- [x] 13. Run `npm run cy:run` — green.
      Evidence: `✔  All specs passed!   01:38   85   85` across 20 specs.
- [x] 14. Run `npm run e2e:ci` — green. It aborts on the first failing spec, so iterate until it completes.
      Evidence: `EXIT=0`, all 20 release specs reported `✔  All specs passed!`; no iteration needed.
- [x] 15. `npm run acceptance:matrix` — still proved, now from green specs.
      Evidence: `99/99 non-deferred capability rows proved (3 deferred).` /
      `24/24 final acceptance checklist rows proved.` / `Acceptance matrix passed`.

## Outputs

- Changed: `cypress/e2e/public-calendar.cy.js`, `cypress/e2e/auth-session-persistence.cy.js`,
  `cypress/e2e/live-local.cy.js`, `cypress/e2e/league-local.cy.js`, `src/app/auth/login-validation.test.ts`
  (or a new sibling), `src/app/features/calendar/public-calendar.component.test.ts`,
  `src/app/features/calendar/public-calendar.test.ts`,
  `src/app/features/leagues-archive/league-archive-list.component.test.ts`, `ops/dev-accounts.test.ts`.
- No production behaviour changes. If you find yourself editing a component to make a spec pass, stop and
  report it — that would mean a real defect, not a test defect.

## Validation

- [x] `npm run test` passes — `Test Files  93 passed (93)` / `Tests  774 passed (774)`
- [x] `npm run lint` passes — `All files pass linting.`
- [x] `npm run typecheck` passes — `tsc --noEmit` clean on `tsconfig.app.json` and `tsconfig.spec.json`
- [x] `npm run build` passes — `Application bundle generation complete.`
- [x] `npm run cy:run` passes — `✔  All specs passed!   01:38   85   85`
- [x] `npm run e2e:ci` passes — `EXIT=0`, 20/20 release specs `All specs passed!`
- [x] `npm run acceptance:matrix` passes — `99/99 non-deferred capability rows proved (3 deferred)`
- [x] each of G1-G4 has a captured red-then-green pair proving the assertion is not vacuous — see the
      evidence lines on Impl steps 7-10; step 11's guard additionally proved red against four spellings
- [x] app functional — no broken path from this slice: no product file changed
      (`git diff --stat src/app/**/*.component.ts` empty), local stack restored and reseeded after the
      `e2e:ci` volume wipe (`admin@gones.test` / `test@gones.test` seeded, all containers healthy)
- [x] commit msg draft: `test: restore the e2e gate and make four assertions fail when their behaviour breaks`
