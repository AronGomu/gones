# T2: Refresh the stale event fixtures and selectors

**Plan:** `./artifacts/PLAN_2026_08_21_e2e-suite-repair.md`
**Depends:** T1
**Commit outcome:** The eight event-facing e2e cases assert against the card and detail views the app actually renders.

## Context (self-contained)

- Eight cases fail against the release stack. All eight stub their data with `cy.intercept` — **none
  of them read seeded database rows**, and no event seeder exists (`scripts/seed-auth-e2e.mjs` seeds
  accounts only; no `events.json` in any `fixtures/dev-environments/*`; `GET /api/events/all` on a
  freshly seeded stack returns `{"items":[],"count":0}`). Keep them stub-driven.
- They fail because the **stubs went stale against a UI redesign**, in three distinct ways:
  1. **`displayTitle` missing.** The list card and the detail view now render `displayTitle`
     exclusively — `event-detail-view.component.ts:18` prints `{{ event().displayTitle }}`, and
     `public-event-list.component.ts:138` uses it for both the visible title and the card
     `aria-label`. `public-event-list.ts:20` declares it required. A fixture without it renders an
     empty heading and `aria-label="undefined"` — which is also why the axe run reports violations.
  2. **Selectors renamed/removed.** The card redesign dropped `event-list-card-status` and renamed
     `event-list-card-date`. `public-event-list.component.test.ts` (~lines 985-986) pins their
     absence, so the component tests already encode the new truth while the e2e specs do not.
  3. **A timezone assertion for text the template no longer prints.** The detail hero now renders
     `naturalDate()` plus a starting hour, with no timezone id.
- This is a **test-only** slice. If you find yourself editing anything under `src/`, stop — that means
  the diagnosis is wrong and you should report it rather than change the app to fit the tests.

## The eight cases and their cause

| Spec | Case | Cause |
| --- | --- | --- |
| `abuse-surface.cy.js` | `never executes or renders hostile HTML delivered by the API` | fixture missing `displayTitle` |
| `accessibility.cy.js` | `public calendar list and calendar views have no WCAG A/AA violations` | missing `displayTitle` → `aria-label="undefined"` |
| `accessibility.cy.js` | `public event detail has no WCAG A/AA violations` | missing `displayTitle` |
| `offline-public-read.cy.js` | `replays cached public Calendar data offline behind a stale banner` | missing `displayTitle` |
| `public-calendar.cy.js` | `defaults to month view, restores URL filters, persists list view, and filters locally without a network call` | asserts `event-list-card-status`, which the redesign removed |
| `public-calendar.cy.js` | `the list card navigates on click while Add to calendar stays on the list` | asserts `event-list-card-date`, renamed |
| `public-calendar.cy.js` | `highlights matches in both views and never interprets markup as HTML` | override stub spreads the base fixture and changes `title`, but the card renders the inherited `displayTitle` |
| `organizer-event-create.cy.js` | `renders server preview through public detail view, preserves form on Back, and invalidates ticket after edit` | preview fixture missing `displayTitle`, **and** a stale `Europe/Paris` assertion |

## Requirements

- Each of the eight passes against the **release stack**.
- Fixtures gain `displayTitle` with the value the case actually asserts on. For the markup-injection
  case, the override must set `displayTitle` to the hostile string too — otherwise the case silently
  stops testing what it claims to test, which would be worse than leaving it red.
- Renamed selectors are updated to the current `data-cy`; the removed one is dropped, not renamed to
  something that happens to exist.
- Do **not** delete an assertion to make a case pass unless the thing it asserted genuinely no longer
  exists — and when you do, say so explicitly in your report.
- The two accessibility cases must pass because the `aria-label` is now real, not because the axe
  rule was suppressed. If a genuine WCAG violation remains once the fixture is correct, stop and
  report it: that is out of scope and worth its own ticket.
- Read the current template before changing a selector. `public-event-list.component.test.ts` is the
  fastest source of truth for which `data-cy` hooks exist now.

## Inputs

- `cypress/e2e/abuse-surface.cy.js`, `accessibility.cy.js`, `offline-public-read.cy.js`,
  `public-calendar.cy.js`, `organizer-event-create.cy.js`
- `src/app/features/events/public-event-list.component.ts` — card template, `data-cy` hooks
- `src/app/features/events/public-event-list.ts` — the `PublicEventView` shape, `displayTitle`
- `src/app/features/events/event-detail-view.component.ts` — detail title and the date/hour row
- `src/app/features/events/public-event-list.component.test.ts` — pins which hooks exist
- `public-calendar.cy.js` already has `displayTitle: 'Legacy — Lyon Legacy'` on its base fixture, so
  its two selector failures are unrelated to `displayTitle` — do not "fix" them by touching fixtures.

## TDD

Not classic red/green: the tests already exist and are already red. For each case, confirm it is red
against the release stack, apply the fix, confirm green. Then confirm the case still *means*
something — for the markup-injection case especially, verify it fails if the app were to render the
hostile string as HTML.

## Impl steps

- [ ] 1. Bring up a clean release stack (see the plan's Assumptions) and reproduce all eight failures.
- [ ] 2. Add `displayTitle` to the fixtures in `abuse-surface.cy.js`, `accessibility.cy.js`,
      `offline-public-read.cy.js` and the preview fixture in `organizer-event-create.cy.js`.
- [ ] 3. `public-calendar.cy.js`: drop the `event-list-card-status` assertion (the badge is gone),
      and update `event-list-card-date` to the current hook.
- [ ] 4. `public-calendar.cy.js`: set `displayTitle` on the hostile-markup override stub.
- [ ] 5. `organizer-event-create.cy.js`: remove the `Europe/Paris` assertion, having first confirmed
      by reading the template that the timezone id is genuinely no longer rendered anywhere in that view.
- [ ] 6. Re-run all five specs against the release stack.
- [ ] 7. Confirm `git diff --stat` touches only files under `cypress/`.

## Outputs

- `cypress/e2e/abuse-surface.cy.js`, `accessibility.cy.js`, `offline-public-read.cy.js`,
  `public-calendar.cy.js`, `organizer-event-create.cy.js`
- No app change, no backend change.

## Validation

- [ ] Release stack: all five specs run, and the eight named cases pass
- [ ] `git diff --stat` shows only `cypress/` files
- [ ] The markup-injection case still fails if the hostile string were rendered as HTML (reason about
      it or prove it by temporarily weakening the app, then reverting)
- [ ] commit msg draft: `test(e2e): refresh the event fixtures against the card redesign`
