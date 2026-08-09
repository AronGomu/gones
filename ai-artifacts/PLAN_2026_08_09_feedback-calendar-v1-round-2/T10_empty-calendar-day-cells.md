# T10: Empty calendar day cells

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T9
**Commit outcome:** The calendar view renders a month grid of day numbers only — no tournament entries inside any cell — while the list view keeps its grouped tournament cards unchanged.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, Signals, zoneless, single global stylesheet `src/styles.css`).
- This slice: feedback line 9 — "Remove the tournament section list from the calendar view page. This list is specific to the list view of the calendar page."
- Out of scope here: the list view's venue-date groups, pagination (T11), the sync row (T7), the search row (T8), the month nav (T9), the fuzzy matching itself, any backend change.
- Assumptions in force: **A6** — this was raised as a conflict with feedback line 6 ("on the calendar it will remove from the calendar the event directly … if they do not match the filter"), and the user reconfirmed: the day cells hold nothing. The fuzzy filter therefore has no per-event visual effect on the calendar tab; its only calendar-side effect is driving the empty state. That is a deliberate, accepted trade. **Do not "restore" the pills as a fix.**

### Current state — read before editing

`src/app/features/calendar/public-calendar.component.ts`.

Template, lines 83–88 — the block to delete is the inner `@for`:

```html
<article class="public-month-day" role="gridcell" [class.public-month-day--muted]="!day.inMonth" data-cy="calendar-month-day">
  <time [attr.datetime]="day.date" data-cy="calendar-month-day-date">{{ day.day }}</time>
  @for (item of day.items; track item.id) {
    <a class="calendar-pill" [class.calendar-pill--cancelled]="status(item).className === 'cancelled'" [routerLink]="['/calendar/tournaments', item.slug]" [attr.data-cy]="'calendar-pill-' + item.slug"><span data-cy="calendar-pill-time">{{ item.venueStartTime.slice(0, 5) }}</span> {{ item.title }} @if (status(item).className === 'cancelled' || status(item).className === 'completed') { <strong class="calendar-pill__status" data-cy="calendar-pill-status">{{ status(item).label }}</strong> }</a>
  }
</article>
```

Model, lines 27–32 and 212–223:

```ts
interface MonthDay { date: string; day: number; inMonth: boolean; items: PublicTournamentView[]; }
```

```ts
readonly monthDays = computed(() => buildMonthDays(this.query().month, this.groups()));

function buildMonthDays(month: string, groups: VenueDateGroup[]): MonthDay[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const start = new Date(year, monthNumber - 1, 1 - first.getDay());
  const byDate = new Map(groups.map(group => [group.date, group.items]));
  return Array.from({ length: 42 }, (_, index) => { … return { date: dateValue, day: …, inMonth: …, items: byDate.get(dateValue) ?? [] }; });
}
```

Once the `@for` is gone, `MonthDay.items` has no reader, `buildMonthDays`'s `groups` parameter is unused, and `status(item)` loses its only calendar-view caller (it is still used by the list view's card template — verify with `grep -n "status(item)" src/app/features/calendar/public-calendar.component.ts` before assuming otherwise). Leaving a field nobody reads is dead code; remove it in the same commit.

The empty state stays. Lines 93 and 107:

```html
@if (!items().length) { <ng-container *ngTemplateOutlet="emptyState" /> }
```

```html
<ng-template #emptyState><section class="panel calendar-state" data-cy="calendar-empty">…</section></ng-template>
```

This is what still reports "your filter matched nothing" on the calendar tab, so it is the one filter-driven signal the view keeps.

`src/styles.css` holds `.calendar-pill`, `.calendar-pill--cancelled` and `.calendar-pill__status` rules. After this change nothing renders them. Remove them.

`.public-month-day` currently sizes itself around its pill content; check whether it declares a `min-height` and keep the cells from collapsing to a bare line of text.

Repo rules: every rendered element needs a unique `data-cy` (`src/AGENT.md`, enforced by `src/app/shared/data-cy-coverage.test.ts`).

- **From Depends (T9):** `.calendar-month-controls` is now a full-width `display: flex; justify-content: space-between` row, and the nav sits immediately above `.public-month-grid`. The grid markup itself was not changed by T9.

## Requirements

- No tournament title, time, status or link renders inside `.public-month-day`.
- `<time [attr.datetime]="day.date" data-cy="calendar-month-day-date">` stays — it is the day number and the grid's only content.
- `MonthDay` loses `items`; `buildMonthDays(month)` takes one argument.
- `monthDays` no longer depends on `groups()`, so the calendar grid stops recomputing when the filter changes; `items()` still drives the empty state.
- The list view is byte-for-byte unchanged in behaviour: `groups()` still feeds `.public-calendar-list`.
- The three `.calendar-pill*` stylesheet rules are deleted.
- Day cells keep a usable height so the grid still reads as a calendar.

## Inputs

- `src/app/features/calendar/public-calendar.component.ts` — template lines 76–93, `MonthDay`, `monthDays`, `buildMonthDays`.
- `src/app/features/calendar/public-calendar.ts` — `VenueDateGroup`, `groupTournamentsByVenueDate`; read only.
- `src/styles.css` — `.public-month-day` and the `.calendar-pill*` rules.
- `src/app/features/calendar/public-calendar.component.test.ts` — the suite to extend; it already asserts on `monthDays()`/`monthWeeks()` in places, so those assertions need updating.
- `cypress/e2e/public-calendar.cy.js` — **check for `calendar-pill` selectors and rewrite those steps**; a spec asserting a pill exists will fail after this change and must assert the list view instead.
- `cypress/e2e/accessibility.cy.js` — the grid keeps its `role="grid"` / `role="row"` / `role="gridcell"` structure; do not disturb it.
- **From Depends:** see above.

## TDD

1. **Red** — add the contract cases below to `public-calendar.component.test.ts`. They fail on the current template and model.
2. **Green** — delete the pill block, narrow `MonthDay` and `buildMonthDays`, remove the stylesheet rules.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `no tournament entry renders inside a day cell` | component source | does not contain `calendar-pill` anywhere |
| `the day cell still renders its date` | component source | the `data-cy="calendar-month-day"` block still contains `data-cy="calendar-month-day-date"` |
| `the month model carries no tournaments` | component source | the `interface MonthDay` declaration does not contain `items` |
| `building a month needs only the month` | component source | matches `/function buildMonthDays\(month: string\)/` |
| `the grid is still 42 cells over six rows` | `component.monthDays()` / `component.monthWeeks()` via the existing `setup()` helper | length `42`; `monthWeeks()` length `6` and every row length `7` |
| `in-month flags survive the change` | `component.monthDays()` for `month: '2026-08'` | exactly 31 entries with `inMonth === true`, and the first is `{ date: '2026-08-01', day: 1 }` |
| `the empty state still answers the filter` | `setup()` with one catalogue item, then `component.setSearchDraft('zzzz-no-match')` | `component.items()` is empty — the calendar tab's empty state is the filter's remaining calendar-side signal |
| `the list view still groups tournaments` | `setup()` with two items on different dates | `component.groups()` has length 2 and is ordered by date ascending |
| `no pill styling is left behind` | `src/styles.css` text | does not contain `calendar-pill` |

## Impl steps

- [ ] 1. Add the nine cases above to `src/app/features/calendar/public-calendar.component.test.ts`. Read the component and the stylesheet with `readFileSync`; use the existing `setup()` helper for the behavioural rows.
- [ ] 2. Run `npx vitest run src/app/features/calendar/public-calendar.component.test.ts` — the new cases must fail. Existing cases that assert on `day.items` will also fail; update them to the new shape rather than deleting them.
- [ ] 3. In `src/app/features/calendar/public-calendar.component.ts`, replace the day-cell markup with:
      ```html
      <article class="public-month-day" role="gridcell" [class.public-month-day--muted]="!day.inMonth" data-cy="calendar-month-day">
        <time [attr.datetime]="day.date" data-cy="calendar-month-day-date">{{ day.day }}</time>
      </article>
      ```
- [ ] 4. Narrow the model: `interface MonthDay { date: string; day: number; inMonth: boolean; }`
- [ ] 5. Change the computed to `readonly monthDays = computed(() => buildMonthDays(this.query().month));`
- [ ] 6. Rewrite the builder, dropping the `groups` parameter and the `byDate` map:
      ```ts
      function buildMonthDays(month: string): MonthDay[] {
        const [year, monthNumber] = month.split('-').map(Number);
        const first = new Date(year, monthNumber - 1, 1);
        const start = new Date(year, monthNumber - 1, 1 - first.getDay());
        return Array.from({ length: 42 }, (_, index) => {
          const date = new Date(start);
          date.setDate(start.getDate() + index);
          const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          return { date: dateValue, day: date.getDate(), inMonth: date.getMonth() === monthNumber - 1 };
        });
      }
      ```
- [ ] 7. Run `npm run typecheck`. Fix every error it reports about now-unused imports or members in this file — likely candidates are `VenueDateGroup` (still used by `formatGroupDate`, so check before removing) and `status` (still used by the list card template, so check before removing). Remove only what the compiler proves unused.
- [ ] 8. In `src/styles.css`, delete the `.calendar-pill`, `.calendar-pill--cancelled` and `.calendar-pill__status` rules. Confirm with `grep -rn "calendar-pill" src cypress` that nothing references them; update any Cypress step that did.
- [ ] 9. In `src/styles.css`, confirm `.public-month-day` still gives a cell a sensible height with only a `<time>` inside. If it relied on pill content, add `min-height: 5.5rem;` to that rule.
- [ ] 10. Run `npx vitest run src/app/features/calendar/public-calendar.component.test.ts src/app/shared/data-cy-coverage.test.ts` — green.

## Outputs

- Changed: `src/app/features/calendar/public-calendar.component.ts`, `src/app/features/calendar/public-calendar.component.test.ts`, `src/styles.css`, possibly `cypress/e2e/public-calendar.cy.js`.
- Public API: `MonthDay` no longer carries `items`; `buildMonthDays` takes one argument. Both are module-private to `public-calendar.component.ts`, so no other file changes.
- Retired `data-cy` values: `calendar-pill-<slug>`, `calendar-pill-time`, `calendar-pill-status`.
- Behaviour: the calendar tab shows a plain month grid. Tournament discovery on that page now happens through the List tab.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npx cypress run --spec cypress/e2e/public-calendar.cy.js` passes
- [ ] `npx cypress run --spec cypress/e2e/accessibility.cy.js` passes
- [ ] Manual: `npm run dev`, open `/calendar` in calendar view with tournaments in the current month — every cell shows only its day number; no titles, times or links anywhere in the grid.
- [ ] Manual: switch to the List tab — the grouped tournament cards are all still there and still link to their detail pages.
- [ ] Manual: type a nonsense query — the calendar tab shows the empty-state panel under the grid.
- [ ] Manual: navigate months — the grid re-renders with the right day numbers and the right muted leading/trailing days.
- [ ] app functional — no broken path from this slice
- [ ] commit msg draft: `refactor(calendar): keep tournament entries out of the month grid`
