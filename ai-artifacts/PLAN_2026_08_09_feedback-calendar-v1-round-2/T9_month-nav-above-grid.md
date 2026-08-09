# T9: Month nav above the grid

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T8
**Commit outcome:** On the calendar view, Previous sits at the far left and Next at the far right of a full-width row directly above the month grid, with the month label centred between them.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, Signals, zoneless, Angular Material, single global stylesheet `src/styles.css`).
- This slice: feedback line 8 — "On the calendar view of the calendar page, the previous and next buttons for changing the month must be positioned above the calendar itself, at the left and right, rather than currently above the list of tournaments."
- Out of scope here: the sync row (T7), the search row (T8), the day cells (T10), pagination (T11), month arithmetic, any backend change.
- Assumptions in force: none specific to this ticket.

### Current state — read before editing

`src/app/features/calendar/public-calendar.component.ts`, lines 72–76 (inside `@if (query().view === 'calendar')`):

```html
<nav class="calendar-month-controls" [attr.aria-label]="i18n.t('calendar.navAria')" data-cy="calendar-month-controls">
  <button mat-stroked-button type="button" data-cy="calendar-month-prev" (click)="moveMonth(-1)">{{ i18n.t('common.previous') }}</button><h2 data-cy="calendar-month-label">{{ monthLabel() }}</h2><button mat-stroked-button type="button" data-cy="calendar-month-next" (click)="moveMonth(1)">{{ i18n.t('common.next') }}</button>
</nav>
<section class="public-month-grid" role="grid" …>
```

The document order is already correct — the nav is the element immediately before `.public-month-grid`. **The defect is purely in the stylesheet.**

`src/styles.css`:
- line 287: `.calendar-month-controls { grid-column: 2; display: inline-flex; align-items: center; justify-content: center; gap: .75rem; }`
- line 288: `.calendar-month-controls h2 { min-width: min(52vw, 18rem); text-align: center; }`
- line 458 (inside a narrow-viewport media query): `.calendar-month-controls, .calendar-download-button { grid-column: 1; justify-self: center; }`

`display: inline-flex` plus `justify-content: center` collapses the nav to its content width and centres the three children as one clump, so Previous and Next end up adjacent to the label rather than at the row's edges. `grid-column: 2` and `justify-self` are leftovers from a removed component that used a `.calendar-toolbar` three-column grid — `grep -rn "calendar-toolbar" src --include=*.ts` returns nothing, so those declarations apply to no ancestor grid and are dead weight that fights the fix.

`.calendar-download-button` is in the same dead-rule family; check it with `grep -rn "calendar-download-button" src --include=*.ts` before touching it. If it is also unreferenced, leave it alone — removing it is out of scope; only split the shared selector so the month-controls half can change.

Repo rules: every rendered element needs a unique `data-cy` (`src/AGENT.md`, enforced by `src/app/shared/data-cy-coverage.test.ts`).

- **From Depends (T8):** the template now renders, in order, `calendar-top-actions` → `<header>` with the `<h1>` → `<form data-cy="calendar-search-row">` → `<div data-cy="calendar-view-tabs">` → banners → the `@if (query().view === 'calendar')` block containing this nav and the month grid. `.calendar-view-tabs` has its own stylesheet rule.

## Requirements

- The nav spans the full content width.
- Previous is flush to the left edge, Next flush to the right edge, the `<h2>` month label centred and taking the remaining space.
- The nav stays immediately above `.public-month-grid` in document order and only renders in calendar view.
- The dead `grid-column` / `justify-self` declarations no longer apply to `.calendar-month-controls`.
- On a narrow viewport the row keeps the same left / centre / right arrangement; it does not stack.

## Inputs

- `src/app/features/calendar/public-calendar.component.ts` — template lines 72–76 (document order only; no structural change needed).
- `src/styles.css` — lines 287, 288 and 458.
- `src/app/features/calendar/public-calendar.component.test.ts` — the suite to extend.
- `cypress/e2e/public-calendar.cy.js` — browser spec that clicks `[data-cy="calendar-month-prev"]` / `[data-cy="calendar-month-next"]`.
- **From Depends:** see above.

## TDD

1. **Red** — add the layout-contract cases to `public-calendar.component.test.ts`. They fail on the current stylesheet.
2. **Green** — rewrite the three stylesheet rules.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the month nav is the element immediately above the grid` | component source | the index of `data-cy="calendar-month-controls"` is less than the index of `class="public-month-grid"`, and no other `data-cy` value appears between the nav's closing `</nav>` and the grid's opening `<section` |
| `the month nav spans the row` | `src/styles.css` text | the `.calendar-month-controls {` block contains `display: flex` and `width: 100%` |
| `previous and next are pushed to the edges` | `src/styles.css` text | the same block contains `justify-content: space-between` |
| `the month label takes the middle` | `src/styles.css` text | the `.calendar-month-controls h2 {` block contains `flex: 1` and `text-align: center` |
| `the dead grid placement is gone` | `src/styles.css` text | no rule whose selector includes `.calendar-month-controls` declares `grid-column` or `justify-self` |
| `moving month keeps the view` | component test with the existing `setup()` helper | `component.moveMonth(1)` navigates with query params whose `month` is the next month **and** whose `view` is still `'calendar'` |
| `moving month backwards crosses the year boundary` | `shiftMonth('2026-01', -1)` from `public-calendar.ts` | `'2025-12'` — pins the arithmetic the buttons depend on |

## Impl steps

- [ ] 1. Add the seven cases above to `src/app/features/calendar/public-calendar.component.test.ts`. Import `shiftMonth` from `'./public-calendar'` for the last case.
- [ ] 2. Run `npx vitest run src/app/features/calendar/public-calendar.component.test.ts` — the new stylesheet cases must fail.
- [ ] 3. In `src/styles.css`, replace line 287 with:
      ```css
      .calendar-month-controls { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: .75rem; margin: .25rem 0 .5rem; }
      ```
- [ ] 4. Replace line 288 with:
      ```css
      .calendar-month-controls h2 { flex: 1; min-width: 0; margin: 0; text-align: center; }
      ```
- [ ] 5. In the narrow-viewport media query around line 458, split the shared selector so only the other class keeps the dead placement, and drop `.calendar-month-controls` from it entirely:
      ```css
      .calendar-download-button { grid-column: 1; justify-self: center; }
      ```
      If `grep -rn "calendar-download-button" src --include=*.ts` shows no consumer either, still leave this line as written — deleting it is a separate cleanup and out of scope here.
- [ ] 6. Verify the template needs no edit: the nav already carries `data-cy="calendar-month-controls"` and already precedes `.public-month-grid`. Do not restructure it.
- [ ] 7. Run `npx vitest run src/app/features/calendar/public-calendar.component.test.ts src/app/shared/data-cy-coverage.test.ts` — green.

## Outputs

- Changed: `src/styles.css` (three rules), `src/app/features/calendar/public-calendar.component.test.ts`.
- Behaviour: the month navigation reads Previous | month | Next across the full width, directly above the grid.
- Public API: none. No `data-cy` added or removed.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npx cypress run --spec cypress/e2e/public-calendar.cy.js` passes
- [ ] Manual: `npm run dev`, open `/calendar` in calendar view at 1440px — Previous is at the far left, the month name centred, Next at the far right, and the row sits directly on top of the seven-column grid.
- [ ] Manual: click Next then Previous — the month label and grid follow, the URL `month` parameter changes, and `view=calendar` is preserved.
- [ ] Manual: switch to the List tab — the month nav is gone (it is inside the calendar-only block).
- [ ] Manual: at 480px the three items stay on one row, edge to edge, with no overflow.
- [ ] app functional — no broken path from this slice
- [ ] commit msg draft: `fix(calendar): spread the month navigation across the row above the grid`
