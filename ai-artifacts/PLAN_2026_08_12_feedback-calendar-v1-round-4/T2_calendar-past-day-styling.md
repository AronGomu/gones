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

1. **Red** — add helper tests to `src/app/features/calendar/public-calendar.test.ts`.
2. **Green** — implement `isPastCalendarDay` and wire the class.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `isPastCalendarDay marks yesterday as past` | `('2026-08-11', '2026-08-12')` | `true` |
| `isPastCalendarDay does not mark today as past` | `('2026-08-12', '2026-08-12')` | `false` |
| `isPastCalendarDay does not mark tomorrow as past` | `('2026-08-13', '2026-08-12')` | `false` |
| `isPastCalendarDay compares across month and year boundaries` | `('2025-12-31', '2026-01-01')` | `true` |
| component test `past day cells carry the past marker` | render with a frozen date, read `[data-cy=calendar-month-day-past]` | at least one element, and none of them equals today's cell |

## Impl steps

- [ ] 1. Add `export function isPastCalendarDay(date: string, today: string): boolean { return date < today; }` to `src/app/features/calendar/public-calendar.ts` with a one-line doc comment saying both inputs are `YYYY-MM-DD` and today is deliberately excluded.
- [ ] 2. Add the four helper tests to `src/app/features/calendar/public-calendar.test.ts`; run `npx vitest run src/app/features/calendar/public-calendar.test.ts` and see them fail then pass.
- [ ] 3. In `public-calendar.component.ts`, import `isPastCalendarDay` and add `readonly today = signal(localDateValue(new Date()));` plus `isPast(date: string): boolean { return isPastCalendarDay(date, this.today()); }`.
- [ ] 4. Add module-level `function localDateValue(date: Date): string` next to `buildMonthDays` returning `${year}-${MM}-${DD}` from local getters (reuse the exact formatting already inside `buildMonthDays`).
- [ ] 5. In the month-grid template, add `[class.public-month-day--past]="isPast(day.date)"` and replace the static `data-cy` with `[attr.data-cy]="isPast(day.date) ? 'calendar-month-day-past' : 'calendar-month-day'"`.
- [ ] 6. Add the CSS rules to `src/styles.css` immediately after the `.public-month-day--muted` rule.
- [ ] 7. Add the component test to `src/app/features/calendar/public-calendar.component.test.ts` using the file's existing render helper and `vi.setSystemTime`.
- [ ] 8. Run `npx vitest run src/app/features/calendar`, `npm run lint`, `npm run typecheck`.

## Outputs

- Files touched: `src/app/features/calendar/public-calendar.ts`, `public-calendar.test.ts`, `public-calendar.component.ts`, `public-calendar.component.test.ts`, `src/styles.css`.
- Behaviour change: past day cells dimmed; new exported helper `isPastCalendarDay`.

## Validation

- [ ] `npx vitest run src/app/features/calendar` passes
- [ ] `npm run lint && npm run typecheck` pass
- [ ] manual check: open `/calendar`, confirm days before today are dimmed and today is not
- [ ] app functional — month navigation, day events and the "+N more" marker unchanged
- [ ] commit msg draft: `feat(calendar): dim past days in the month grid`
