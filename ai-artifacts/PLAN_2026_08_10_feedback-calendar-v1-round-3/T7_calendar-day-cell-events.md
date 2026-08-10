# T7: Calendar day-cell events

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** T6
**Commit outcome:** On the calendar tab, each month-grid day cell renders the tournaments that start that day, and nothing below the grid lists tournaments. The list tab is untouched.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice is feedback #3 — "On the calendar view of the calendar page, remove the section at the bottom where tournaments are listed. The only events that should appear on the calendar view should be within the calendar itself. I reserve the absolute right for the list view of the calendar page to show the list of tournaments."
- This slice: put the events **inside** the month grid, and lock in a test that the calendar tab renders no list section, no venue-date group and no pagination below it.
- **This deliberately reverses a round-2 decision.** Round 2 made the month grid render day numbers only. Feedback #3 says the calendar view's events belong "within the calendar itself", so the cells carry their tournaments again. The list tab keeps its cards, its grouping and its pagination — that is explicitly reserved.
- Out of scope here: the list tab, the search box, the view toggles, the create button, the sync row, the month navigation.
- Assumptions in force: no TestBed — assert on template source and on pure functions. Every element carries `data-cy`. Every new string exists in the `en` **and** `fr` maps of `src/app/i18n/messages.ts`.

## Inputs

- **From T6 (spell out — do not read T6):** `src/app/features/calendar/public-calendar.component.ts` now has the `data-cy="calendar-create-tournament"` anchor inside `<div class="calendar-view-tabs" … data-cy="calendar-view-tabs">` with class `create-action-button calendar-create-tournament`, and there is no longer a `data-cy="calendar-header-actions"` element. `.calendar-search-input` is a normal bordered input. Nothing about the month grid changed in T6.
- `src/app/features/calendar/public-calendar.component.ts`, current calendar-tab branch:
  ```html
  @if (query().view === 'calendar') {
    <nav class="calendar-month-controls" … data-cy="calendar-month-controls"> … </nav>
    <section class="public-month-grid" role="grid" … data-cy="public-month-grid">
      <div class="public-month-row public-month-row--head" role="row" data-cy="calendar-month-row-head"> … weekday headers … </div>
      @for (week of monthWeeks(); track week[0].date) {
        <div class="public-month-row" role="row" data-cy="calendar-month-row">
          @for (day of week; track day.date) {
            <article class="public-month-day" role="gridcell" [class.public-month-day--muted]="!day.inMonth" data-cy="calendar-month-day">
              <time [attr.datetime]="day.date" data-cy="calendar-month-day-date">{{ day.day }}</time>
            </article>
          }
        </div>
      }
    </section>
    @if (!items().length) { <ng-container *ngTemplateOutlet="emptyState" /> }
  } @else { … list tab … }
  ```
- Signals already present on the component: `items()` (fuzzy-filtered, unpaged), `sortedItems()`, `pagedItems()`, `groups()`, `monthWeeks()`, `query()`. `MonthDay` is `{ date: string; day: number; inMonth: boolean }` and `date` is `YYYY-MM-DD`.
- `src/app/features/calendar/public-calendar.ts` — pure helpers, already exports `PublicTournamentView` (fields include `id`, `title`, `slug`, `venueStartDate`, `venueStartTime`, `status`), `groupTournamentsByVenueDate`, `sortTournamentsForList`, `statusPresentation`, `PAGE_SIZE`.
- `src/app/features/calendar/public-calendar.test.ts` — pure-function tests for that file. Add there.
- `src/app/features/calendar/public-calendar.component.test.ts` — template source tests. Add there.
- `src/styles.css`, current: `.public-month-day { min-height: 7rem; display: grid; align-content: start; gap: .35rem; padding: .55rem; border-top: 1px solid var(--soot); border-left: 1px solid var(--soot); background: var(--iron); overflow: hidden; }` and `.public-month-day > time { font-weight: 900; }`; narrow-viewport override `.public-month-day { min-height: 3.5rem; border-left: 0; }`.
- `src/app/i18n/messages.ts` — add new keys to both maps.

## Requirements

- New pure helper in `src/app/features/calendar/public-calendar.ts`:
  ```ts
  export const MAX_DAY_CELL_EVENTS = 3;
  /** Tournaments keyed by their venue start date, each list sorted by start time then title. */
  export function tournamentsByDate(items: PublicTournamentView[]): Map<string, PublicTournamentView[]>
  ```
- Component gains:
  ```ts
  readonly eventsByDate = computed(() => tournamentsByDate(this.items()));
  dayEvents(date: string): PublicTournamentView[] { return this.eventsByDate().get(date) ?? []; }
  visibleDayEvents(date: string): PublicTournamentView[] { return this.dayEvents(date).slice(0, MAX_DAY_CELL_EVENTS); }
  hiddenDayEventCount(date: string): number { return Math.max(0, this.dayEvents(date).length - MAX_DAY_CELL_EVENTS); }
  ```
  `tournamentsByDate` and `MAX_DAY_CELL_EVENTS` are imported from `./public-calendar`.
- Each `<article class="public-month-day" …>` renders, after its `<time>`:
  ```html
  @for (event of visibleDayEvents(day.date); track event.id) {
    <a class="public-month-event" [routerLink]="['/calendar/tournaments', event.slug]" [attr.data-cy]="'calendar-month-day-event-' + event.slug" [attr.title]="event.title">
      <span class="public-month-event__time" data-cy="calendar-month-day-event-time">{{ event.venueStartTime.slice(0, 5) }}</span>
      <span class="public-month-event__title" data-cy="calendar-month-day-event-title">{{ event.title }}</span>
    </a>
  }
  @if (hiddenDayEventCount(day.date); as hidden) {
    <span class="public-month-more" data-cy="calendar-month-day-more">{{ i18n.t('calendar.moreEvents', { count: hidden }) }}</span>
  }
  ```
- New i18n key `calendar.moreEvents`: en `'+{count} more'`, fr `'+{count} de plus'`.
- The calendar tab must contain **no** `data-cy="calendar-list"`, no `data-cy="calendar-venue-date-…"`, no `data-cy="calendar-pagination"`. It already does not; the test makes that a guarantee.
- Filtering still works: `items()` is already the fuzzy-filtered set, so typing in the search box thins the day cells.
- New styles:
  - `.public-month-day { min-height: 8.5rem; }` (raise from `7rem`), `overflow: hidden` kept.
  - `.public-month-event { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .3rem; align-items: baseline; padding: .18rem .3rem; border-left: 3px solid var(--hot-blood); background: color-mix(in oklch, var(--blood) 18%, transparent); color: var(--ash); font-size: .78rem; line-height: 1.25; text-decoration: none; }`
  - `.public-month-event:hover, .public-month-event:focus-visible { background: color-mix(in oklch, var(--blood) 32%, transparent); outline: 2px solid var(--hot-blood); outline-offset: 1px; }`
  - `.public-month-event__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`
  - `.public-month-event__time { color: var(--dim-ash); font-variant-numeric: tabular-nums; }`
  - `.public-month-more { color: var(--dim-ash); font-size: .74rem; }`
  - In the narrow-viewport media query, replace `.public-month-day { min-height: 3.5rem; border-left: 0; }` with `.public-month-day { min-height: 3.5rem; border-left: 0; } .public-month-day:has(.public-month-event) { min-height: 5.5rem; }` so a day with events is still readable on one column.

## TDD

1. **Red** — write the three pure-function tests in `public-calendar.test.ts` and the three template tests in `public-calendar.component.test.ts` first. All six fail.
2. **Green** — add `tournamentsByDate` + `MAX_DAY_CELL_EVENTS`, then the component members, then the template, then the i18n keys, then the styles.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `tournamentsByDate keys on the venue start date` (pure) | 3 views with `venueStartDate` `2026-03-01`, `2026-03-01`, `2026-03-04` | map size `2`; `map.get('2026-03-01')` length `2`; `map.get('2026-03-04')` length `1` |
| `tournamentsByDate sorts a day by start time then title` (pure) | same day, times `14:00`/`09:30`/`09:30` with titles `B`/`Z`/`A` | returned order is `09:30 A`, `09:30 Z`, `14:00 B` |
| `tournamentsByDate returns no entry for a day with nothing` (pure) | 1 view on `2026-03-01` | `map.has('2026-03-02')` is `false` |
| `day cells render their events` (template) | the `data-cy="calendar-month-day"` `<article>` slice of the component source | contains `visibleDayEvents(day.date)` and `calendar-month-day-event-` |
| `the calendar tab lists nothing under the grid` (template) | the source slice from `@if (query().view === 'calendar') {` to its balancing `}` | contains none of `data-cy="calendar-list"`, `calendar-venue-date-`, `data-cy="calendar-pagination"` |
| `the list tab keeps its list` (template) | the `@else` slice of the same control-flow block | contains `data-cy="calendar-list"` and `data-cy="calendar-pagination"` |

Match balanced template blocks with the `templateBlock(opening)` brace-counting helper already used in
`src/app/features/leagues-archive/league-archive-list.component.test.ts` — copy it into the calendar
test file rather than exporting it.

Run: `npx vitest run src/app/features/calendar`

## Impl steps

- [ ] 1. Add the three pure tests to `src/app/features/calendar/public-calendar.test.ts` and the three template tests to `src/app/features/calendar/public-calendar.component.test.ts`. Confirm red with `npx vitest run src/app/features/calendar`.
- [ ] 2. In `src/app/features/calendar/public-calendar.ts`, export `MAX_DAY_CELL_EVENTS = 3` and `tournamentsByDate(items)`.
- [ ] 3. In `src/app/features/calendar/public-calendar.component.ts`, import both, add `eventsByDate`, `dayEvents`, `visibleDayEvents`, `hiddenDayEventCount`.
- [ ] 4. Extend the `<article class="public-month-day" …>` body with the `@for` event links and the `@if` overflow count, exactly as specified above.
- [ ] 5. Add `'calendar.moreEvents'` to the `en` map (`'+{count} more'`) and the `fr` map (`'+{count} de plus'`) of `src/app/i18n/messages.ts`.
- [ ] 6. Add the six new rules to `src/styles.css` and raise `.public-month-day` `min-height` to `8.5rem`.
- [ ] 7. Add the `:has(.public-month-event)` override inside the existing narrow-viewport media query.
- [ ] 8. Run `npx vitest run src/app/features/calendar` — green.
- [ ] 9. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 10. Manual (with `npm run dev -- --env=demo` seeded data): `/calendar` on the calendar tab shows tournaments inside their day squares, clicking one opens `/calendar/tournaments/{slug}`, and nothing is listed below the grid. Typing in the search box thins the cells. Switch to the list tab — the cards and the pager are still there.

## Outputs

- Files edited: `src/app/features/calendar/public-calendar.ts`, `src/app/features/calendar/public-calendar.component.ts`, `src/app/features/calendar/public-calendar.test.ts`, `src/app/features/calendar/public-calendar.component.test.ts`, `src/app/i18n/messages.ts`, `src/styles.css`.
- Public API change: `public-calendar.ts` exports `MAX_DAY_CELL_EVENTS` and `tournamentsByDate`.
- Behaviour change: calendar tab day cells carry events; the tab still renders no tournament list below the grid.
- Migration/config: none.

## Validation

- [ ] `npx vitest run src/app/features/calendar` passes.
- [ ] `npm run test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm run cy:run -- --spec cypress/e2e/public-calendar.cy.js` passes.
- [ ] Manual: day cells show events; the calendar tab has no list, no venue-date headings and no pager.
- [ ] Manual: the list tab still shows grouped cards and the pager.
- [ ] App functional — no broken path from this slice.
- [ ] Commit msg draft: `feat(calendar): render tournaments inside the month grid day cells`
