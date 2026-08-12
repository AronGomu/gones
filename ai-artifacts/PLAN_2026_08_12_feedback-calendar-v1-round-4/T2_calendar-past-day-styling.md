# T2: Calendar past-day styling

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T1
**Commit outcome:** in the calendar view of `/calendar`, every day cell strictly before today renders dimmed and visually distinct from today and future days.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md` — calendar/detail polish, an admin organization workbench, a guard fix, generated demo docs, and a Tournament → Event rename.
- This slice: feedback item 1. "Show on the calendar all the dates that are passed (starting from yesterday) as different from days to come." Design decided here: reduced opacity plus a muted day number. No strikethrough, no colour change on the event chips beyond the inherited opacity.
- Out of scope here: the list view, any filtering of past events, the month-navigation scroll behaviour (T5).
- Assumptions in force: past = venue date strictly before today's local date. Today is NOT past. Cells outside the displayed month keep their existing `public-month-day--muted` class and may carry both classes.

## Requirements

- Add a pure helper `isPastCalendarDay(date: string, today: string): boolean` to `src/app/features/calendar/public-calendar.ts` (exported). `date` and `today` are `YYYY-MM-DD`; returns `date < today` by string compare.
- `PublicCalendarComponent` exposes `isPast(date: string): boolean` using a `todayValue()` computed from `new Date()` formatted as `YYYY-MM-DD` in local time.
- The `<article class="public-month-day">` element gains `[class.public-month-day--past]="isPast(day.date)"`.
- CSS in `src/styles.css`: `.public-month-day--past { opacity: .5; }` and `.public-month-day--past > time { color: var(--steel); font-weight: 700; }`.
- No new data-cy value is required (the element already has `data-cy="calendar-month-day"`), but add `[attr.data-cy]="isPast(day.date) ? 'calendar-month-day-past' : 'calendar-month-day'"` so Cypress can assert the state.

## Inputs

- `src/app/features/calendar/public-calendar.ts` — pure calendar helpers (`readCalendarQuery`, `tournamentsByDate`, `shiftMonth`, …), plus `MAX_DAY_CELL_EVENTS`.
- `src/app/features/calendar/public-calendar.component.ts` — the month grid loop is `@for (day of week; track day.date) { <article class="public-month-day" role="gridcell" [class.public-month-day--muted]="!day.inMonth" data-cy="calendar-month-day"> … }`; `buildMonthDays()` at the bottom of the file produces `{ date, day, inMonth }`.
- `src/app/features/calendar/public-calendar.test.ts` — vitest suite for the pure helpers.
- `src/styles.css` — `.public-month-day` rules live around line 1138; `--steel`, `--iron`, `--forge`, `--soot` are existing theme tokens.
- **From Depends:** T1 made guards async (`AuthService.whenSessionReady()`); nothing in this ticket depends on it beyond a green build.

## TDD

- [x] 1. **Red** — add helper tests to `src/app/features/calendar/public-calendar.test.ts`. → verify: the new tests fail before the helper exists. Evidence: `npx vitest run …public-calendar.test.ts …component.test.ts` → `Tests 7 failed | 89 passed (96)`, `TypeError: isPastCalendarDay is not a function`.
- [x] 2. **Green** — implement `isPastCalendarDay` and wire the class. → verify: same suites pass. Evidence: `npx vitest run src/app/features/calendar` → `Test Files 16 passed (16) / Tests 177 passed (177)`.
- [x] 3. **Refactor** — none. → verify: no extra refactor in the diff beyond extracting `localDateValue` out of `buildMonthDays`, which step 4 requires.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `isPastCalendarDay marks yesterday as past` | `('2026-08-11', '2026-08-12')` | `true` |
| `isPastCalendarDay does not mark today as past` | `('2026-08-12', '2026-08-12')` | `false` |
| `isPastCalendarDay does not mark tomorrow as past` | `('2026-08-13', '2026-08-12')` | `false` |
| `isPastCalendarDay compares across month and year boundaries` | `('2025-12-31', '2026-01-01')` | `true` |
| component test `past day cells carry the past marker` | render with a frozen date, read `[data-cy=calendar-month-day-past]` | at least one element, and none of them equals today's cell |

## Impl steps

- [x] 1. Add `export function isPastCalendarDay(date: string, today: string): boolean { return date < today; }` to `src/app/features/calendar/public-calendar.ts` with a one-line doc comment saying both inputs are `YYYY-MM-DD` and today is deliberately excluded. → verify: exported at `public-calendar.ts:92-95` with the doc comment; the four helper tests pass.
- [x] 2. Add the four helper tests to `src/app/features/calendar/public-calendar.test.ts`; run `npx vitest run src/app/features/calendar/public-calendar.test.ts` and see them fail then pass. → verify: red run `TypeError: isPastCalendarDay is not a function` (4 helper failures), green run `Tests 177 passed`.
- [x] 3. In `public-calendar.component.ts`, import `isPastCalendarDay` and add `readonly today = signal(localDateValue(new Date()));` plus `isPast(date: string): boolean { return isPastCalendarDay(date, this.today()); }`. → verify: both present in the diff (`public-calendar.component.ts:154`, `:216`); `npm run typecheck` clean.
- [x] 4. Add module-level `function localDateValue(date: Date): string` next to `buildMonthDays` returning `${year}-${MM}-${DD}` from local getters (reuse the exact formatting already inside `buildMonthDays`). → verify: `buildMonthDays` now calls `localDateValue(date)`; existing test `in-month flags survive the change` still passes, so the date values are unchanged.
- [x] 5. In the month-grid template, add `[class.public-month-day--past]="isPast(day.date)"` and replace the static `data-cy` with `[attr.data-cy]="isPast(day.date) ? 'calendar-month-day-past' : 'calendar-month-day'"`. → verify: test `the day cell binds the past class and the past marker` passes; `data-cy-coverage.test.ts` still green (the `[attr.data-cy]` form is accepted).
- [x] 6. Add the CSS rules to `src/styles.css` immediately after the `.public-month-day--muted` rule. → verify: `styles.css:1141-1142`; test `the past cell is dimmed with a muted day number` passes; browser-computed `opacity` of a past cell is `0.5`.
- [x] 7. Add the component test to `src/app/features/calendar/public-calendar.component.test.ts` using the file's existing render helper and `vi.setSystemTime`. → verify: `past day cells carry the past marker, and today does not` passes. NOTE: this suite has no TestBed/DOM render helper (only `setup()` + source-text assertions), so the DOM read was done in a throwaway browser run instead — see the Validation block.
- [x] 8. Run `npx vitest run src/app/features/calendar`, `npm run lint`, `npm run typecheck`. → verify: `16 files / 177 tests passed`, `All files pass linting`, `tsc --noEmit` silent.

## Outputs

- Files touched: `src/app/features/calendar/public-calendar.ts`, `public-calendar.test.ts`, `public-calendar.component.ts`, `public-calendar.component.test.ts`, `src/styles.css`.
- Behaviour change: past day cells dimmed; new exported helper `isPastCalendarDay`.

## Validation

- [x] `npx vitest run src/app/features/calendar` passes → `Test Files 16 passed (16) / Tests 177 passed (177)`. Full suite too: `npm run test` → `Test Files 105 passed (105) / Tests 947 passed (947)`.
- [x] `npm run lint && npm run typecheck` pass → `All files pass linting`; `tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.spec.json` exited silent.
- [x] manual check: open `/calendar`, confirm days before today are dimmed and today is not → done in a real browser (Electron 138, dev server :4200) with a throwaway spec, since the vitest suite has no DOM. On the real system date 2026-08-12: the `2026-08-11` cell has `data-cy="calendar-month-day-past"`, class `public-month-day--past` and computed `opacity: 0.5`; the `2026-08-12` cell has `data-cy="calendar-month-day"`, no past class and computed `opacity: 1`; `2026-08-13` is not past. Navigating to September shows zero past cells, navigating back restores them. Spec deleted after the run — human-facing steps are in `ai-artifacts/manual_test_checklist.md`.
- [x] app functional — month navigation, day events and the "+N more" marker unchanged → `npx cypress run --spec cypress/e2e/public-calendar.cy.js` against :4200 → `8 passing`, including the `+1` more-marker assertion and the month prev/next assertions.
- [x] commit msg draft: `feat(calendar): dim past days in the month grid`
