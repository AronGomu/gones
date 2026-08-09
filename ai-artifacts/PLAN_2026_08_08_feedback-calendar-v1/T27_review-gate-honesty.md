# T27: Make the gates say what they mean *(parent-added)*

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T26
**Commit outcome:** Every gate that reports green is actually constraining the behaviour it names.

## Why this ticket exists

The post-run reviewer fanout found a cluster of tests and gates that pass **regardless of whether the product works**.
Each one is a claim of safety that is not backed. None is a bug in shipped behaviour; all of them are reasons the
next regression will go unnoticed. They are grouped here because they are one kind of work.

The governing rule: **a test that cannot fail is worse than no test**, because it occupies the space where a real one
would go. For each item below, the fix is to make the assertion capable of failing — not to delete it.

## Requirements

- Every Cypress spec in `cypress/e2e/` is executed by a committed gate.
- No assertion listed below passes against a deliberately broken implementation.
- The `data-cy` duplicate escape hatch is used only where the gate's own doc comment sanctions it.
- `ops/acceptance-matrix.json` contains no `proved` row whose claim has no test that can fail.
- Two plan checkboxes that overstate their result are corrected.
- All existing gates stay green: `test`, `lint`, `typecheck`, `build`, `backend:test`, `api:check`,
  `acceptance:matrix`, `e2e:ci`.

## Inputs — each with the failure that proves it is currently vacuous

- **`scripts/full-stack-ci.mjs:63-133`** enumerates **18** specs by hand; `cypress/e2e/` holds **19**.
  `cypress/e2e/first-visit.cy.js` (T21) is run by no committed gate — `.github/workflows/static.yml:47` runs
  `npm run e2e:ci` and nothing runs `npm run cy:run`. Failure: delete `firstVisitHomeGuard` from `app.routes.ts:79`
  and `first-visit.guard.test.ts` still passes (it tests the guard function, not its wiring) while the one spec that
  would catch it never runs. T25b fixed this exact hole for `auth-session-persistence.cy.js` and did not check for
  others. **Also add an assertion that every spec on disk is enumerated**, so this cannot recur a third time.
- **`cypress/e2e/auth-session-persistence.cy.js:41,50,59`** assert three times on `[data-cy="login-link"]`, which
  `src/app/app.component.ts` stopped rendering when T3 (`b909967`) replaced it — written by T2 (`59bcb0b`) *before*
  that. `login-links`, `register-login-link` and `verify-login-link` are different exact values, so the selector
  matches nothing. Failure: re-add a sign-in link to the toolbar for a signed-in user — the spec's entire point — and
  all three `should('not.exist')` still pass. Find the value the toolbar actually renders and assert on that.
- **`cypress/e2e/public-calendar.cy.js:52`** — `cy.get('[data-cy="public-month-grid"]').should('not.exist')` runs
  after lines 43-49 switched to list view, where the grid cannot exist regardless. Failure: break `filterTournaments`
  so a non-matching query returns the whole catalog and line 52 still passes; only line 53 does any work.
- **`src/app/features/calendar/public-calendar.component.test.ts:115`** — "filters without navigating: typing never
  triggers router.navigate" asserts the **opposite of the truth**. `setSearchDraft` (`public-calendar.component.ts:163-167`)
  schedules `navigate` on a 300 ms `setTimeout`; the test checks synchronously, so it passes for any debounce value
  including `0`. Failure: set the debounce to 0 and the test still passes while the URL churns on every keystroke.
  Use fake timers so the test proves *debounced*, which is the real claim.
- **`src/app/features/calendar/public-calendar.component.test.ts:150`** — "month navigation does not refetch" calls
  `moveMonth(1)`, which only touches the **stubbed** Router; the stub route is `queryParamMap: of(initialParams)`,
  which emitted once and completed, so the `ngOnInit` subscription can never re-fire. The assertion holds for **any**
  implementation. This is what makes the matrix row below unbacked.
- **`ops/acceptance-matrix.json` row `doc05-full-catalog-cache`** is `proved`, and its central claim is that month
  navigation never re-queries the API (ADR 0023). Nothing can fail if that breaks: the vitest above is vacuous, and
  `calendar-month-prev` / `calendar-month-next` appear **zero** times in the repo outside
  `public-calendar.component.ts:74`. **Either** make a test that genuinely fails when `public-calendar.component.ts:148`
  loses its guard — a Cypress case clicking month-next behind a request counter is the honest one — **or** downgrade
  the row and say why. Do not leave it `proved` on the current evidence.
- **`src/app/app-breadcrumbs.test.ts:48-49`** asserts `source.toContain("this.showHeaderImport.set(path === '/leagues-archive');")`
  — it fails on any behaviour-preserving refactor and passes if the line is dead. The companion
  `not.toContain("=== '/leagues'")` is whitespace-sensitive (`path==='/leagues'` slips through). Its comment at
  `:38-43` claims the behaviour is also covered end-to-end in `league-server.cy.js`; **that claim is false** —
  `league-server.cy.js:199` only asserts the button **exists** on `/leagues-archive`, never its absence elsewhere.
  Replace with a real assertion on `showHeaderImport()` after `updateRouteState(...)` for both an archive route and a
  non-archive route, and correct the comment.
- **`src/app/features/calendar/organizer-tournament-create.component.ts:133` and `:158`** both render
  `reload-organizations` — `:133` as a literal, `:158` through the `[attr.data-cy]="'reload-organizations'"` escape
  hatch — and they call **different** handlers (`loadReferences()` vs `reloadOrganizationAccess()`).
  `data-cy-coverage.test.ts:76-88` enumerates the sanctioned uses of that hatch and this is **not** among them; it is
  being used purely to silence a duplicate. `organizer-tournament-create.cy.js:179` cannot tell which button it
  matched. Give the second button its own identifier and update any spec that selects it.
  *(Note: T26 has since edited this component — re-read it; the line numbers may have moved.)*
- **Migration safety has no automated guard.** All 40 integration classes call `MigrateAsync()` against an **empty**
  database and no `Down` is ever executed, so the hand-correction recorded in
  `Migrations/20260809122735_RenameLeagueArchiveTables.cs:7-17` — which its own summary says prevents "silently
  drop[ping] every archived League" — is encoded nowhere. Failure: re-scaffold that migration from the model diff, the
  natural move for the next agent that touches the entity name, and production loses every row while `backend:test`
  stays green (`LeagueArchiveRouteTests.cs:67` seeds *after* migration). Two cheap guards close the named failure
  without building a full data-preservation harness: **(a)** assert no committed migration renaming a table contains
  `DropTable`/`CreateTable` for it, and **(b)** assert the model has no pending changes
  (`GetPendingMigrations` / `HasPendingModelChanges`), so a drifted snapshot is caught at test time.
- **`docs/GLOSSARY.md:17`** still names `src/app/data/league-repository.service.ts`, renamed by T24 to
  `league-archive-repository.service.ts`. Sole surviving stale path repo-wide.
- **Two checked boxes overstate their result** now that the 19th spec is known:
  `T25b_inherited-cypress-repairs.md:214` ("every spec green") and `T25_data-cy-sweep-and-matrix.md:188` ("18/18").
  Correct the wording to match what the gate now runs.

## Environment facts

- `npm run e2e:ci` is the full gate (bare `npm run cy:run` dies on this NixOS host with `libglib-2.0.so.0`).
  It rebuilds the release profile and sets `GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: '1000'`, so real-login specs are
  unthrottled. After your change it must run **19** specs.
- **The ngsw trap:** on the release build the service worker answers the navigation from its own cache, so
  `cy.visit`'s `onBeforeLoad` is silently never called — no error, no seed. Seed from the loaded window via
  `cy.window()` as well. This is why `first-visit.cy.js` may need adjustment once it actually runs on 8081.
- **No Angular `TestBed`, no zone.js**; `@angular/common/http/testing` is not installed. Components → bare `Injector`
  + `runInInjectionContext` with `effect()` stubbed. `vi.useFakeTimers()` is available for the debounce test.
- Backend: 1-3 random test *classes* intermittently fail at `InitializeAsync` with `Docker.DotNet … bind: address
  already in use`. Never an assertion. Re-run the class alone before believing a red.
- The `data-cy` allowlist is **empty** and enforced repo-wide; any element you add needs a unique identifier.

## TDD

1. **Red** — for each item, first break the implementation the assertion claims to protect and show the test still
   passes. That is the proof the finding is real.
2. **Green** — rewrite the assertion so the broken implementation fails it, then restore the implementation.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `every spec is enumerated by the gate` | `cypress/e2e/*.cy.js` vs `full-stack-ci.mjs` | equal sets; fails if a spec is added and not wired |
| `first-visit spec runs` | `npm run e2e:ci` | 19 specs executed, all green |
| `toolbar sign-in absence is asserted on a real selector` | remove the guard that hides it | spec fails |
| `list view assertion is not vacuous` | break `filterTournaments` | `public-calendar.cy.js` fails |
| `typing is debounced, not silent` | debounce set to 0 | vitest fails |
| `month navigation does not refetch` | remove the guard at `public-calendar.component.ts:148` | a test fails |
| `header import is archive-only` | make `showHeaderImport` always true | `app-breadcrumbs.test.ts` fails |
| `reload buttons are distinguishable` | swap the two handlers | a test fails |
| `table renames are non-destructive` | reintroduce `DropTable` in a rename migration | backend test fails |
| `model has no pending changes` | edit an entity without a migration | backend test fails |

## Impl steps

- [x] 1. Wire `cypress/e2e/first-visit.cy.js` into `scripts/full-stack-ci.mjs`, and add the spec-enumeration assertion so this cannot recur — validate: `e2e:ci` reports **19** specs; the new test fails when a spec is unwired.
  - Red (worse than the ticket states): with `canActivate: [firstVisitHomeGuard]` deleted from `app.routes.ts:79`,
    `first-visit.guard.test.ts` **and** `data-mode-routes.test.ts` both stayed green (31/31). See "Residual" below —
    `data-mode-routes.test.ts:146` is vacuous for a chai reason, and is *not* fixed here (not an enumerated item).
  - Green: new `ops/e2e-spec-coverage.test.ts` failed on the unwired tree ("expected [ …(18) ] to deeply equal [ …(19) ]",
    diff naming `cypress/e2e/first-visit.cy.js`); passes after the wiring. `e2e:ci` now runs `first-visit.cy.js` first,
    and against the unwired guard that spec fails ("Failing: 1"), so the hole is now covered by a gate that can fail.
- [x] 2. Fix the three `login-link` assertions against the selector the toolbar really renders — validate: re-adding a sign-in link for a signed-in user fails the spec.
  - The toolbar renders **no** sign-in affordance for a signed-in user, so there is no single `data-cy` to name.
    The claim is "no route to /login is offered", asserted as `a[href="/login"], a[href^="/login?"]`.
  - Red: with `<a routerLink="/login" data-cy="toolbar-login-link">` added to the signed-in toolbar arm, the old
    spec passed **2/2**. Green: the new spec fails on that same build — "Expected <a> not to exist in the DOM,
    but it was continuously found." The anonymous case now asserts the mirror (`should('exist')`).
- [x] 3. Fix `public-calendar.cy.js:52` so the assertion does work at that point — validate: breaking `filterTournaments` fails it.
  - Red: with `filterTournaments` returning the whole catalog on a non-match, the old spec failed at **line 53**
    (`calendar-empty` never found) — line 52 passed, exactly as the ticket predicted.
  - Green: line 52 is now `[data-cy="tournament-lyon-legacy"]').should('not.exist')`, and on the same broken build
    the failure moves to that line ("Expected <article.panel.public-tournament-card> not to exist in the DOM").
- [x] 4. Rewrite the debounce test with fake timers to prove *debounced* — validate: debounce 0 fails it.
  - Red: with `SEARCH_DEBOUNCE_MS = 0` the old `:115` test passed (8/8 green). Green: the two new fake-timer
    tests fail against that same break ("expected vi.fn() to not be called at all, but actually been called
    1 times" / "4 times"); restored to 300 → 9/9 green.
- [x] 5. Settle `doc05-full-catalog-cache`: add a test that fails when the guard at `public-calendar.component.ts:148` is removed, **or** downgrade the row with a written reason — validate: whichever you choose, the matrix claim and the evidence agree.
  - **Chose: add the tests, keep the row `proved`.** The row's claim ("month navigation and filtering never
    re-query the API") is true of the shipped code — it was the *evidence* that was missing, not the behaviour,
    and downgrading a true claim would have made the matrix less accurate, not more.
  - Red, vitest: the stub route was `of(initialParams)`, which emits once and completes, so the `ngOnInit`
    subscription could never re-fire. Proof it constrained nothing: with `void this.load();` added to the
    subscription — month navigation refetching, the exact regression — the old test **passed 8/8**.
  - Green, vitest: the router stub now feeds `queryParams` back into a `BehaviorSubject`, closing the loop.
    The rewritten test fails against that same break, and against removing the guard at `:148` it fails with
    `RangeError: Maximum call stack size exceeded` (unguarded canonicalisation navigates forever) — the ticket's
    named break, 3 failures where the old file had 0.
  - Green, cypress: new case `navigates months over the cached catalog without re-querying the API` clicks
    `calendar-month-next` / `-prev` behind the request counter. With `moveMonth` forcing a reload it fails
    `-3 / +1` on the call count. `calendar-month-prev` / `-next` now appear in a spec for the first time.
  - Matrix row evidence updated to name both.
- [x] 6. Replace the `app-breadcrumbs` source-string assertions with behavioural ones and correct the false comment — validate: forcing `showHeaderImport` true fails it.
  - Red (a): a dead `this.showHeaderImport.set(true);` added after the real line → button always on, old test 6/6 green.
    Red (b): `if (path==='/leagues') this.showHeaderImport.set(true);` → old test still 6/6 green (whitespace).
    Green: new `updateRouteState` tests fail on both ("`/`: expected true to be false", "`/leagues`: expected true to be false");
    restored → 7/7 green. Comment corrected: `league-server.cy.js:199` only asserts the button *exists* on `/leagues-archive`.
- [x] 7. Give the second reload button its own `data-cy` and update selectors — validate: the duplicate is gone and `data-cy-coverage` is green. Re-read the component first; T26 edited it.
  - Red: swapping `[attr.data-cy]="'reload-organizations'"` (now line 168) for the literal form made `data-cy-coverage`
    report `duplicate data-cy values reload-organizations` — proof the hatch was silencing it, not sanctioning it.
    Green: the publish-error button is `tournament-publish-error-reload`; no spec selected it, and
    `organizer-tournament-create.cy.js:199` now unambiguously means the form-error button. 8/8 green.
- [x] 8. Add the two migration guards (no destructive op in a rename migration; no pending model changes) — validate: each fails when its condition is violated.
  - New file `backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs`.
  - Red: `20260809122735_RenameLeagueArchiveTables.cs` re-scaffolded to the EF shape (`DropTable` +
    `CreateTable` + `InsertData` + five `CreateIndex`) — production would lose every archived League —
    and `LeagueArchiveRouteTests` still **passed 8/8** (39 s, docker). Both new source guards failed on
    that same tree. Restored → 17/17.
  - Red (pending changes): `HasMaxLength(201)` on `LeagueArchiveAggregate.Name` with no migration →
    `Committed_migrations_fully_describe_the_model` failed. Restored → 17/17.
  - Note: the guard is scoped to the `Up` body. Every migration drops in `Down`, and a rule keyed on a
    surviving `RenameTable` would go quiet on exactly the full re-scaffold it exists to catch.
- [x] 9. Fix `docs/GLOSSARY.md:17` — now `src/app/data/league-archive-repository.service.ts`; `ls` confirms the file exists.
- [x] 10. Correct the two overstated checkboxes in `T25b_inherited-cypress-repairs.md` and `T25_data-cy-sweep-and-matrix.md`
  — both now state 18 *enumerated* specs and name the spec that was missing.
- [x] 11. Run `npm run test && npm run lint && npm run typecheck && npm run build && npm run backend:test && npm run api:check && npm run acceptance:matrix`.
  - `test` 78 files / 518 tests passed. `lint` "All files pass linting." `typecheck` clean on both projects.
    `build` "Application bundle generation complete." `api:check` exit 0. `acceptance:matrix` 98/98 non-deferred
    proved, 24/24 checklist, same 3 pre-existing deferred rows.
  - `backend:test`: ArchitectureTests 17/17, UnitTests 198/198, IntegrationTests 362/366 — the 4 reds are all
    the documented `InitializeAsync` Docker `bind: address already in use` flake, never an assertion; all four
    classes pass alone (`LeagueCommandApiTests` 7/7, `TournamentProposalDecisionTests` 21/21,
    `TournamentProposalTests` 19/19, `TournamentPublicationApiTests` 16/16).
- [x] 12. Run `npm run e2e:ci` — `GATE_EXIT=0`, **19** `✔`, 0 `✖`. `first-visit.cy.js` runs first (1/1);
  `public-calendar.cy.js` is now 6 tests; `auth-session-persistence.cy.js` 2/2.

## Residual — found while executing, not fixed (not an enumerated item)

`data-mode-routes.test.ts` guards route wiring with `expect(route?.canActivate).toContain(someGuard)`. When the
route has no `canActivate` at all the expression is `expect(undefined).toContain(fn)`, and chai **passes** that:
`expect(undefined).toContain('x')` throws "the given combination of arguments (undefined and string) is invalid",
but with a *function* argument it silently succeeds. Verified directly on vitest 4.1.10. So every one of those
assertions is vacuous in exactly the case it exists to catch — deleting `canActivate: [firstVisitHomeGuard]` from
`app.routes.ts:79` left the whole file green (28/28). `first-visit.cy.js`, now wired, does catch that particular
break, but the pattern is repeated across the file for `userGuard`, `verifiedEmailGuard`, `organizerGuard`,
`markVisitedGuard`. The fix is `expect(route?.canActivate ?? []).toContain(...)` or `toEqual(expect.arrayContaining(...))`
on a non-optional read. Dropped as out of ticket scope; worth its own ticket.

## Outputs

- Files touched: `scripts/full-stack-ci.mjs`, up to four `cypress/e2e/*.cy.js`, `public-calendar.component.test.ts`,
  `app-breadcrumbs.test.ts`, `organizer-tournament-create.component.ts`, a backend test file,
  `ops/acceptance-matrix.json`, `docs/GLOSSARY.md`, two plan ticket files.
- Public API / behavior change: none. Identifiers and tests only.
- Migrate / config: none.

## Validation

- [x] `npm run e2e:ci` runs **19** specs, all green — `GATE_EXIT=0`, 19 `✔`, 0 `✖`
- [x] `npm run test && npm run lint && npm run typecheck && npm run build` pass — 78 files / 518 tests;
  "All files pass linting."; `tsc --noEmit` clean on both projects; "Application bundle generation complete."
- [x] `npm run backend:test` passes — 17 + 198 + 362/366; the 4 reds are the documented Docker port-bind flake at
  `InitializeAsync`, and all four classes pass when re-run alone
- [x] `npm run api:check` and `npm run acceptance:matrix` pass — exit 0; 98/98 non-deferred proved, 24/24 checklist
- [x] every rewritten assertion was shown to fail against a deliberately broken implementation, and the report says so per item
  — see the per-step Red/Green notes above; item 1's vacuity turned out to be broader than stated (see Residual)
- [x] app functional — no shipped behaviour changed. The only non-test source edit is one `data-cy` value
  (`reload-organizations` → `tournament-publish-error-reload`); every deliberate break was reverted and
  `git diff` over `src/app` shows no logic change
- [x] commit msg draft: `test: make the gates fail when the behaviour they name breaks`
