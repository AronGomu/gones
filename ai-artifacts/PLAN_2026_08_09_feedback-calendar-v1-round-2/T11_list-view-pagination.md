# T11: List view pagination

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T8
**Commit outcome:** The calendar page's List tab pages at 20 tournaments, shows Previous / page N of M / Next only when there is more than one page, and keeps the page in the URL.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, Signals, zoneless, Angular Material, router query parameters as view state).
- This slice: feedback line 7 — "For the list of results of the tournaments on the List tab of the calendar page, add pagination that activates when there are more than 20 tournaments shown."
- Out of scope here: the calendar view's grid (T9, T10), the sync row (T7), the search row (T8), server-side paging (the catalogue is fetched whole and cached — see `all-tournaments-cache.service.ts`), any backend change.
- Assumptions in force: **A11** — 20 tournaments per page, 1-based `page` query parameter, emitted only when greater than 1, reset to 1 whenever the search text, the month or the view changes.

### Current state — read before editing

`src/app/features/calendar/public-calendar.ts` owns the query model:

```ts
export interface CalendarQuery { month: string; view: CalendarView; q: string; past: boolean; }

export function readCalendarQuery(params: ParamMap, preferredView: CalendarView, now = new Date()): CalendarQuery {
  const rawView = params.get('view');
  return {
    month: validMonth(params.get('month')) ?? monthValue(now),
    view: rawView === 'list' || rawView === 'calendar' ? rawView : preferredView,
    past: params.get('past') === 'true',
    q: clean(params.get('q'))
  };
}

export function buildCalendarQueryParams(query: CalendarQuery): Record<string, string> {
  const result: Record<string, string> = { month: query.month };
  if (query.q) result['q'] = query.q;
  if (query.past) result['past'] = 'true';
  result['view'] = query.view;
  return result;
}

export function groupTournamentsByVenueDate(items: PublicTournamentView[]): VenueDateGroup[] { … }
```

`groupTournamentsByVenueDate` already sorts groups by date ascending and, within a group, by `venueStartTime` then `title`. It does **not** give a stable flat order across groups, which pagination needs. Add an explicit flat sort.

`src/app/features/calendar/public-calendar.component.ts`:

```ts
readonly query = signal<CalendarQuery>(readCalendarQuery(this.route.snapshot.queryParamMap, this.preferredView()));
readonly items = computed(() => filterTournaments(this.allItems(), this.searchDraft()));
readonly groups = computed(() => groupTournamentsByVenueDate(this.items()));

setSearchDraft(value: string): void {
  this.searchDraft.set(value);
  if (this.searchDebounce) clearTimeout(this.searchDebounce);
  this.searchDebounce = setTimeout(() => { void this.navigate({ ...this.query(), q: this.searchDraft() }); }, SEARCH_DEBOUNCE_MS);
}
sync(): void { void this.load({ force: true }); }
moveMonth(amount: number): void { void this.navigate({ ...this.query(), month: shiftMonth(this.query().month, amount) }); }
setView(view: CalendarView): void { try { localStorage.setItem(VIEW_KEY, view); } catch { } void this.navigate({ ...this.query(), view }); }
private navigate(query: CalendarQuery): Promise<boolean> { return this.router.navigate([], { relativeTo: this.route, queryParams: buildCalendarQueryParams(query) }); }
```

`ngOnInit` subscribes to `route.queryParamMap` and re-reads the query on every change, including its own navigations — so adding `page` to `readCalendarQuery` / `buildCalendarQueryParams` is enough to make the URL the single source of truth. Note the existing guard:

```ts
if (params.get('month') !== query.month || params.get('view') !== query.view) { … replaceUrl navigation … return; }
```

It normalises a URL missing `month` or `view`. **Do not add `page` to that condition** — `page` is legitimately absent on page 1, and adding it would cause a redirect loop.

The list markup, lines 94–104:

```html
@if (groups().length) {
  <section class="public-calendar-list" data-cy="calendar-list">
    @for (group of groups(); track group.date) {
      <section class="venue-date-group" [attr.data-venue-date]="group.date" [attr.data-cy]="'calendar-venue-date-' + group.date"><h2 data-cy="calendar-venue-date-label">{{ formatGroupDate(group) }}</h2>
        @for (item of group.items; track item.id) { <ng-container *ngTemplateOutlet="tournamentCard; context: { $implicit: item }" /> }
      </section>
    }
  </section>
} @else { <ng-container *ngTemplateOutlet="emptyState" /> }
```

`i18n.t(key, params)` interpolates `{name}` placeholders — see `calendar.syncedAt` (`'Synchronised {instant}'`) for the pattern.

Repo rules: every rendered element needs a unique `data-cy` (`src/AGENT.md`, enforced by `src/app/shared/data-cy-coverage.test.ts`); every new i18n key goes in **both** the `en` and `fr` maps of `src/app/i18n/messages.ts`.

- **From Depends (T8):** the template renders `calendar-top-actions` → `<header>` → `<form data-cy="calendar-search-row">` → `<div data-cy="calendar-view-tabs">` → banners → the view blocks. `setSearchDraft` is unchanged so far; this ticket edits it.

## Requirements

- `PAGE_SIZE = 20`, exported from `public-calendar.ts`.
- Pure, tested helpers in `public-calendar.ts`: `sortTournamentsForList`, `calendarPageCount`, `clampCalendarPage`, `paginateTournaments`.
- `CalendarQuery` gains `page: number`, always ≥ 1.
- `readCalendarQuery` parses `page`, treating a missing / non-numeric / < 1 value as `1`.
- `buildCalendarQueryParams` emits `page` only when it is greater than 1.
- The list view renders only the current page's 20 tournaments, grouped by venue date within that page.
- The pagination nav renders only when `calendarPageCount(...) > 1`; Previous is disabled on page 1 and Next on the last page.
- Changing the search text, the month or the view resets `page` to 1.
- A `page` beyond the last page clamps to the last page rather than showing nothing.
- The calendar view is unaffected: it neither paginates nor reads `page`.

## Inputs

- `src/app/features/calendar/public-calendar.ts` — the query model and grouping helpers.
- `src/app/features/calendar/public-calendar.component.ts` — the component.
- `src/app/features/calendar/public-calendar.test.ts` — the existing pure-module suite; extend it.
- `src/app/features/calendar/public-calendar.component.test.ts` — the existing component suite; extend it.
- `src/app/i18n/messages.ts` — `en` map from line 5, `fr` map from line 1042.
- `cypress/e2e/public-calendar.cy.js` — browser spec for the list view.
- **From Depends:** see above.

## TDD

1. **Red** — write the pure helper tests in `public-calendar.test.ts` and the query-model tests for `page`, then the component tests. All fail.
2. **Green** — add the helpers, widen the query model, wire the component and the template.
3. **Refactor** — only if needed. Keep green.

## Test plan

New exports in `src/app/features/calendar/public-calendar.ts`:

```ts
export const PAGE_SIZE = 20;

/** Stable flat order for paging: venue date, then venue start time, then title, then id. */
export function sortTournamentsForList(items: PublicTournamentView[]): PublicTournamentView[] {
  return [...items].sort((left, right) =>
    left.venueStartDate.localeCompare(right.venueStartDate)
    || left.venueStartTime.localeCompare(right.venueStartTime)
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id));
}

export function calendarPageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampCalendarPage(page: number, total: number, pageSize = PAGE_SIZE): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), calendarPageCount(total, pageSize));
}

export function paginateTournaments(items: PublicTournamentView[], page: number, pageSize = PAGE_SIZE): PublicTournamentView[] {
  const safePage = clampCalendarPage(page, items.length, pageSize);
  return items.slice((safePage - 1) * pageSize, safePage * pageSize);
}
```

| Test | Input | Expect |
| --- | --- | --- |
| `an empty catalogue is still one page` | `calendarPageCount(0)` | `1` |
| `exactly twenty is one page` | `calendarPageCount(20)` | `1` |
| `twenty-one is two pages` | `calendarPageCount(21)` | `2` |
| `forty is two pages` | `calendarPageCount(40)` | `2` |
| `page zero clamps up` | `clampCalendarPage(0, 45)` | `1` |
| `a page past the end clamps down` | `clampCalendarPage(99, 45)` | `3` |
| `a fractional page truncates` | `clampCalendarPage(2.7, 45)` | `2` |
| `NaN falls back to page one` | `clampCalendarPage(Number.NaN, 45)` | `1` |
| `the first page holds the first twenty` | `paginateTournaments(make(45), 1)` | length `20`, first element is item `0` |
| `the last page holds the remainder` | `paginateTournaments(make(45), 3)` | length `5`, first element is item `40` |
| `an out-of-range page returns the last one` | `paginateTournaments(make(45), 9)` | identical to page `3` |
| `sorting is stable across equal dates and times` | two items same date+time, titles `'B'` then `'A'` | `sortTournamentsForList` yields `'A'` first |
| `a missing page parameter reads as one` | `readCalendarQuery(paramMap({ month: '2026-08', view: 'list' }), 'list').page` | `1` |
| `a page parameter is parsed` | `readCalendarQuery(paramMap({ page: '3', … }), 'list').page` | `3` |
| `a junk page parameter reads as one` | `page: 'abc'`, `page: '0'`, `page: '-2'` | `1` for each |
| `page one is not written to the url` | `buildCalendarQueryParams({ …, page: 1 })` | has no `page` key |
| `a later page is written to the url` | `buildCalendarQueryParams({ …, page: 4 })` | `page === '4'` |
| `the list renders only one page of tournaments` | component `setup()` with 45 catalogue items, `view: 'list'` | `component.pagedItems().length === 20` and `component.groups()` contains 20 items in total |
| `pagination is hidden for a single page` | `setup()` with 20 items | `component.pageCount() === 1` |
| `pagination appears past twenty` | `setup()` with 21 items | `component.pageCount() === 2` |
| `moving page navigates with the page parameter` | `component.movePage(1)` from page 1 with 45 items | router `navigate` called with query params containing `page: '2'` |
| `searching resets to page one` | page 3, then `component.setSearchDraft('x')` and flush the 300 ms debounce | navigate called with no `page` key |
| `changing month resets to page one` | page 3, then `component.moveMonth(1)` | navigate called with no `page` key |
| `changing view resets to page one` | page 3, then `component.setView('calendar')` | navigate called with no `page` key |
| `the pagination nav exists in the list block only` | component source | `data-cy="calendar-pagination"` appears after `data-cy="calendar-list"` and is **not** inside the `@if (query().view === 'calendar')` block |

## Impl steps

- [x] 1. Add the pure-helper and query-model cases to `src/app/features/calendar/public-calendar.test.ts`, importing the four new symbols plus `PAGE_SIZE`. Add a local `make(n)` factory that clones a minimal `PublicTournamentView` with an incrementing `id`, `venueStartDate` and `title`.
- [x] 2. Run `npx vitest run src/app/features/calendar/public-calendar.test.ts` — must fail to resolve the new exports.
- [x] 3. Add `PAGE_SIZE`, `sortTournamentsForList`, `calendarPageCount`, `clampCalendarPage` and `paginateTournaments` to `src/app/features/calendar/public-calendar.ts`, exactly as written in the Test plan.
- [x] 4. Add `page: number` to `CalendarQuery`. In `readCalendarQuery`, add `page: readPage(params.get('page'))` with a module-private helper:
      ```ts
      function readPage(value: string | null): number {
        const parsed = Number.parseInt(value ?? '', 10);
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
      }
      ```
- [x] 5. In `buildCalendarQueryParams`, after the `view` assignment add: `if (query.page > 1) result['page'] = String(query.page);`
- [x] 6. Re-run step 2's command — the pure tests pass.
- [x] 7. In `src/app/i18n/messages.ts`, add to `en`:
      ```
      'calendar.paginationAria': 'Tournament list pages',
      'calendar.pageStatus': 'Page {page} of {total}',
      ```
      and to `fr`:
      ```
      'calendar.paginationAria': 'Pages de la liste des tournois',
      'calendar.pageStatus': 'Page {page} sur {total}',
      ```
- [x] 8. In `src/app/features/calendar/public-calendar.component.ts`, import the new symbols and add these computeds next to `items`:
      ```ts
      readonly sortedItems = computed(() => sortTournamentsForList(this.items()));
      readonly pageCount = computed(() => calendarPageCount(this.sortedItems().length));
      readonly currentPage = computed(() => clampCalendarPage(this.query().page, this.sortedItems().length));
      readonly pagedItems = computed(() => paginateTournaments(this.sortedItems(), this.query().page));
      ```
      Change `groups` to read the page: `readonly groups = computed(() => groupTournamentsByVenueDate(this.pagedItems()));`
      **Leave `items()` as it is** — the empty state and T10's calendar-side signal both read it.
- [x] 9. Add the handler:
      ```ts
      movePage(amount: number): void {
        const next = clampCalendarPage(this.currentPage() + amount, this.sortedItems().length);
        if (next === this.currentPage()) return;
        void this.navigate({ ...this.query(), page: next });
      }
      ```
- [x] 10. Reset the page in the three places that change what is being listed:
      - `setSearchDraft` → `void this.navigate({ ...this.query(), q: this.searchDraft(), page: 1 });`
      - `moveMonth` → `void this.navigate({ ...this.query(), month: shiftMonth(this.query().month, amount), page: 1 });`
      - `setView` → `void this.navigate({ ...this.query(), view, page: 1 });`
- [x] 11. In the template, inside the `@if (groups().length) { … }` branch and directly after `</section>` closing `.public-calendar-list`, add:
      ```html
      @if (pageCount() > 1) {
        <nav class="calendar-pagination" [attr.aria-label]="i18n.t('calendar.paginationAria')" data-cy="calendar-pagination">
          <button mat-stroked-button type="button" data-cy="calendar-page-prev" [disabled]="currentPage() <= 1" (click)="movePage(-1)">{{ i18n.t('common.previous') }}</button>
          <span class="muted" role="status" aria-live="polite" data-cy="calendar-page-status">{{ i18n.t('calendar.pageStatus', { page: currentPage(), total: pageCount() }) }}</span>
          <button mat-stroked-button type="button" data-cy="calendar-page-next" [disabled]="currentPage() >= pageCount()" (click)="movePage(1)">{{ i18n.t('common.next') }}</button>
        </nav>
      }
      ```
- [x] 12. In `src/styles.css`, next to the other `public-calendar-*` rules, add:
      ```css
      .calendar-pagination { display: flex; align-items: center; justify-content: space-between; gap: .75rem; width: 100%; margin: 1rem 0 .25rem; }
      ```
- [x] 13. Add the component cases from the Test plan to `src/app/features/calendar/public-calendar.component.test.ts`, extending its `setup()` helper to accept an item count and to expose the router `navigate` spy's last call.
- [x] 14. Run `npx vitest run src/app/features/calendar/public-calendar.test.ts src/app/features/calendar/public-calendar.component.test.ts src/app/shared/data-cy-coverage.test.ts` — green.
- [x] 15. Extend `cypress/e2e/public-calendar.cy.js`: with a stubbed catalogue of 25 tournaments, assert the List tab shows 20 cards and `[data-cy="calendar-pagination"]`, that Next lands on `?page=2` showing 5 cards, and that typing in the search box drops `page` from the URL.

## Outputs

- Changed: `src/app/features/calendar/public-calendar.ts` (+5 exports, `CalendarQuery.page`), `src/app/features/calendar/public-calendar.component.ts`, both calendar test files, `src/styles.css`, `src/app/i18n/messages.ts`, `cypress/e2e/public-calendar.cy.js`.
- Public API: `CalendarQuery` gains a required `page: number`. Every construction site is inside these two files plus their tests — `npm run typecheck` will list any that were missed.
- New `data-cy` values: `calendar-pagination`, `calendar-page-prev`, `calendar-page-status`, `calendar-page-next`. New i18n keys: `calendar.paginationAria`, `calendar.pageStatus` (en + fr).

## Validation

- [x] `npm run test` passes — 84 files, 635 tests passed
- [x] `npm run lint` passes — "All files pass linting."
- [x] `npm run typecheck` passes — no errors
- [x] `npm run build` passes — bundle generated
- [x] `npx cypress run --spec cypress/e2e/public-calendar.cy.js` passes — 7/7 passing (rerun after dev-server rebuild-race settled, per known local quirk)
- [ ] Manual: `npm run dev` with more than 20 published tournaments in the catalogue, open `/calendar?view=list` — 20 cards and a pagination row; Next goes to `?page=2`. Automated equivalent: Cypress test `pages the list at twenty tournaments and drops the page on search` (25-item stub) + component test `the list renders only one page of tournaments`. Left unchecked — no human browser session run; see manual checklist.
- [ ] Manual: with 20 or fewer tournaments there is no pagination row at all. Automated equivalent: component test `pagination is hidden for a single page`. Left unchecked — no human browser session run; see manual checklist.
- [ ] Manual: on page 2, type in the search box — the URL loses `page` and the list restarts at the first result. Automated equivalent: Cypress assertion `cy.location('search').should('not.contain', 'page=')` after typing, + component test `searching resets to page one`. Left unchecked — no human browser session run; see manual checklist.
- [ ] Manual: hand-edit the URL to `?view=list&page=99` — the last page renders, not an empty list. Automated equivalent: component test `a page beyond the last page clamps rather than showing nothing`. Left unchecked — no human browser session run; see manual checklist.
- [ ] Manual: switch to the Calendar tab — no pagination row, and `page` is not in the URL. Automated equivalent: component test `changing view resets to page one` + source-position test `the pagination nav exists in the list block only`. Left unchecked — no human browser session run; see manual checklist.
- [x] app functional — no broken path from this slice (full `npm run test` + build + cypress spec green)
- [x] commit msg draft: `feat(calendar): page the tournament list at twenty per page`
