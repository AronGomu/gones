# T8: Calendar search row

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T7
**Commit outcome:** The calendar page shows one chrome-less search input on its own full-width row, sitting between the page title and the Calendar / List view buttons.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, Signals, zoneless, Angular Material, single global stylesheet `src/styles.css`).
- This slice: feedback line 6 — "The Fuzzy Finder search filter should be just under the title of the page, on a single row, and between the title and the two buttons that select either the calendar or the list. […] Also, make it have less height by removing the label. Remove the label for the input. Remove the border and the background for the input. Just keep a normal margin."
- Out of scope here: the sync row (done in T7), the month navigation (T9), the day cells (T10), pagination (T11), the fuzzy matching algorithm itself, any backend change.
- Assumptions in force: **A6** — feedback line 9 (T10) empties the calendar day cells, so the filter's visible effect on the calendar tab is limited to the empty state; it filters the list tab. The filter pipeline itself is not changed here and stays wired to both views, so behaviour is correct if pills ever return.

### Current state — read before editing

The filtering behaviour the feedback describes **already works**. `src/app/features/calendar/public-calendar.component.ts`:

```ts
readonly items = computed(() => filterTournaments(this.allItems(), this.searchDraft()));
readonly groups = computed(() => groupTournamentsByVenueDate(this.items()));
readonly monthDays = computed(() => buildMonthDays(this.query().month, this.groups()));
```

Both views read from `items()`, so a non-matching tournament is already removed from the month grid and from the list. `filterTournaments` lives in `src/app/features/calendar/tournament-fuzzy-search.ts` and is covered by `tournament-fuzzy-search.test.ts`. **Do not rewrite the matching.** This ticket is layout plus a regression test that pins the shared-filter behaviour.

The markup to replace, lines 58–63:

```html
<form class="panel calendar-filter-form" data-cy="calendar-filters" (ngSubmit)="$event.preventDefault()">
  <label class="calendar-search-label" for="calendar-search" data-cy="calendar-search-label">{{ i18n.t('common.search') }}</label>
  <input id="calendar-search" name="q" type="search" class="calendar-search-input" data-cy="calendar-search"
         [attr.placeholder]="i18n.t('calendar.searchPlaceholder')"
         [ngModel]="searchDraft()" (ngModelChange)="setSearchDraft($event)">
</form>
```

The view tabs live inside `.calendar-header-actions` in the page `<header>` (see the block quoted in T7) and must move **below** the search row.

`src/styles.css` today:
- line 1110: `.calendar-filter-form { display: grid; grid-template-columns: 1fr; gap: .35rem; padding: 1rem; width: 100%; }`
- line 1111: `.calendar-filter-form label { display: grid; gap: .35rem; color: var(--dim-ash); font-size: .85rem; font-weight: 800; }`
- line 1112: `.calendar-search-input { width: 100%; min-height: 48px; padding: .6rem .75rem; border: 1px solid var(--steel); background: var(--black-metal); color: var(--ash); font: inherit; }`
- line 1113: `.calendar-filter-form input:focus-visible { outline: 2px solid var(--hot-blood); outline-offset: 2px; }`
- line 1114: `.calendar-header-actions { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }`

The `panel` class supplies the boxed background and border the feedback wants gone.

Accessibility: removing the visible `<label>` removes the input's accessible name. It must be replaced by `[attr.aria-label]="i18n.t('common.search')"` on the input — `common.search` already exists in both catalogs (`en` line 69, `fr` line 1105). The placeholder alone is not an accessible name.

Repo rules: every rendered element needs a unique `data-cy` (`src/AGENT.md`, enforced by `src/app/shared/data-cy-coverage.test.ts`).

- **From Depends (T7):** the template now opens with a `<div class="calendar-top-actions" data-cy="calendar-top-actions">` wrapper holding `gones-back-button` plus a `data-cy="calendar-sync-group"` containing `calendar-synced-at` and the `calendar-sync` button. `.calendar-header-actions` no longer holds the sync button or the stamp; it holds `calendar-view-tabs` and, conditionally, `calendar-create-tournament`.

## Requirements

- Document order on the page becomes: top action row (back + sync) → page header with the `<h1>` and the Create tournament action → **search row** → **view tabs row** → banners → content.
- The search form is one row spanning the full content width, with no `panel` class, no border, no background.
- The `<label>` element is deleted; the input carries `[attr.aria-label]="i18n.t('common.search')"`.
- The input keeps `id="calendar-search"`, `name="q"`, `type="search"`, `data-cy="calendar-search"`, its placeholder binding and its `[ngModel]` / `(ngModelChange)` wiring.
- Input height is reduced from `48px` to a compact single line; a focus ring is still visible.
- The view tabs keep `role="group"`, their aria-label, and both `data-cy="calendar-view"` and `data-cy="list-view"`.

## Inputs

- `src/app/features/calendar/public-calendar.component.ts` — template and `setSearchDraft`, `items`, `groups`.
- `src/app/features/calendar/tournament-fuzzy-search.ts` — `filterTournaments`; read only.
- `src/styles.css` — lines 1110–1114.
- `src/app/features/calendar/public-calendar.component.test.ts` — the suite to extend.
- `cypress/e2e/public-calendar.cy.js` — browser spec that types into `[data-cy="calendar-search"]`.
- **From Depends:** see above.

## TDD

1. **Red** — add the layout-contract cases and the shared-filter behavioural case to `public-calendar.component.test.ts`. They fail on the current template.
2. **Green** — restructure the template and rewrite the four stylesheet rules.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the search row sits between the title and the view tabs` | component source | the index of `data-cy="calendar-title"` < index of `data-cy="calendar-search-row"` < index of `data-cy="calendar-view-tabs"` |
| `the search input has no visible label` | component source | does not contain `calendar-search-label` |
| `the search input names itself for assistive tech` | component source | the `data-cy="calendar-search"` element carries `[attr.aria-label]="i18n.t('common.search')"` |
| `the search row is not a panel` | component source | the `data-cy="calendar-search-row"` element's class list contains neither `panel` nor `calendar-filter-form` |
| `the input is chrome-less` | `src/styles.css` text | the `.calendar-search-input {` block contains `border: 0` (or `border: none`) and `background: transparent` |
| `the input is shorter than before` | `src/styles.css` text | the `.calendar-search-input {` block does **not** contain `min-height: 48px` |
| `focus is still visible` | `src/styles.css` text | a rule targeting `.calendar-search-input:focus-visible` sets an `outline` |
| `the view tabs are on their own row` | component source | `data-cy="calendar-view-tabs"` is **not** inside the `data-cy="calendar-header-actions"` block |
| `filtering removes non-matching tournaments from both views` | component test using the existing `setup()` helper, with two catalogue items whose titles differ | after `component.setSearchDraft('<title of item A>')`, `component.items()` has length 1 and `component.groups()` holds only item A — proving the same filter drives the calendar-side model and the list |
| `an empty query keeps every tournament` | same setup | `component.setSearchDraft('')` restores `items().length === 2` |

## Impl steps

- [x] 1. Add the ten cases above to `src/app/features/calendar/public-calendar.component.test.ts`. For the two behavioural cases, extend the file's existing `setup()` helper to accept a second catalogue item (clone the module-level `tournament` constant and change `id`, `slug` and `title`).
- [x] 2. Run `npx vitest run src/app/features/calendar/public-calendar.component.test.ts` — the new cases must fail.
- [x] 3. In `src/app/features/calendar/public-calendar.component.ts`, remove `calendar-view-tabs` from `.calendar-header-actions`. The header block becomes:
      ```html
      <header class="section-header" data-cy="calendar-header">
        <div data-cy="calendar-header-text"><h1 id="public-calendar-title" data-cy="calendar-title">{{ i18n.t('calendar.publicTitle') }}</h1></div>
        <div class="calendar-header-actions" data-cy="calendar-header-actions">
          @if (canCreateTournament()) {
            <a mat-flat-button class="home-primary-action" routerLink="/tournaments/new" data-cy="calendar-create-tournament">{{ i18n.t('calendar.createTournament') }}</a>
          }
        </div>
      </header>
      ```
- [x] 4. Directly after the `</header>`, replace the old filter form with the search row followed by the tabs row:
      ```html
      <form class="calendar-search-row" data-cy="calendar-search-row" (ngSubmit)="$event.preventDefault()">
        <input id="calendar-search" name="q" type="search" class="calendar-search-input" data-cy="calendar-search"
               [attr.aria-label]="i18n.t('common.search')"
               [attr.placeholder]="i18n.t('calendar.searchPlaceholder')"
               [ngModel]="searchDraft()" (ngModelChange)="setSearchDraft($event)">
      </form>

      <div class="calendar-view-tabs" role="group" [attr.aria-label]="i18n.t('calendar.viewAria')" data-cy="calendar-view-tabs">
        <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'calendar'" data-cy="calendar-view" (click)="setView('calendar')">{{ i18n.t('calendar.tabCalendar') }}</button>
        <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'list'" data-cy="list-view" (click)="setView('list')">{{ i18n.t('calendar.listView') }}</button>
      </div>
      ```
      The old `data-cy="calendar-filters"` value disappears. Grep for it across `cypress/` and `src/` first; if any spec selects it, update that selector to `calendar-search-row` in the same commit.
- [x] 5. In `src/styles.css`, delete the `.calendar-filter-form` rule (line 1110) and the `.calendar-filter-form label` rule (line 1111), and replace the `.calendar-search-input` rule (line 1112) and the focus rule (line 1113) with:
      ```css
      .calendar-search-row { display: flex; width: 100%; margin: .35rem 0 .5rem; }
      .calendar-search-input { width: 100%; min-height: 2.25rem; padding: .3rem 0; border: 0; background: transparent; color: var(--ash); font: inherit; }
      .calendar-search-input::placeholder { color: var(--dim-ash); }
      .calendar-search-input:focus-visible { outline: 2px solid var(--hot-blood); outline-offset: 2px; }
      ```
- [x] 6. In `src/styles.css`, add a rule so the tabs row is a normal row of its own now that it has left the header flex container (extended the existing `.calendar-view-tabs` rule with `align-items: center; margin-bottom: .5rem;` instead of adding a second block, per the ticket's own fallback):
      ```css
      .calendar-view-tabs { display: inline-flex; align-items: center; gap: .5rem; flex-wrap: wrap; margin-bottom: .5rem; }
      ```
      Check first with `grep -n "calendar-view-tabs" src/styles.css` — if a rule already exists, extend it instead of adding a second.
- [x] 7. Run `npx vitest run src/app/features/calendar/public-calendar.component.test.ts src/app/shared/data-cy-coverage.test.ts` — green.

## Outputs

- Changed: `src/app/features/calendar/public-calendar.component.ts`, `src/app/features/calendar/public-calendar.component.test.ts`, `src/styles.css`, possibly `cypress/e2e/public-calendar.cy.js` (selector rename only).
- Behaviour: unchanged filtering, new layout. The `calendar-filters` and `calendar-search-label` `data-cy` values are retired; `calendar-search-row` replaces the first.
- Public API: none.

## Validation

- [x] `npm run test` passes — 592/592, 0 failed (`Test Files 84 passed (84)`)
- [x] `npm run lint` passes — `All files pass linting.`
- [x] `npm run typecheck` passes — clean, no output/errors
- [x] `npm run build` passes — `Application bundle generation complete.`
- [x] `npx cypress run --spec cypress/e2e/public-calendar.cy.js` passes — 6/6 passing (steam-run wrapped, LD_LIBRARY_PATH=nspr+nss)
- [x] `npx cypress run --spec cypress/e2e/accessibility.cy.js` passes — this is the gate that would catch an input left without an accessible name. 11/11 passing, including `every calendar filter control has a programmatic name` against the renamed `[data-cy="calendar-search-row"]` selector.
- [ ] Manual: `npm run dev`, open `/calendar` — the search input is directly under the title, full width, with no box or border, and the Calendar / List buttons are on the row below it. Not run with a human browser this session; equivalent automated proof: `the search row sits between the title and the view tabs` + `the search row is not a panel` + `the view tabs are on their own row` (component source tests, all green) plus the passing `accessibility.cy.js`/`public-calendar.cy.js` browser runs. Left unchecked per the manual-validation rule; logged to `ai-artifacts/manual_test_checklist.md`.
- [ ] Manual: type a venue city — the list tab drops non-matching tournaments; the URL gains `?q=…` after the 300 ms debounce. Not run manually; automated proof: `filters on the keystroke but debounces the URL write by 300 ms` (existing, still green) plus the new `filtering removes non-matching tournaments from both views` case. Left unchecked, logged to the manual checklist.
- [ ] Manual: tab to the input — a red focus ring is visible. Not run manually; automated proof: `focus is still visible` (stylesheet-text test, green) confirms the `:focus-visible` rule exists with an outline, but a human still needs to eyeball the actual rendered ring colour/visibility. Left unchecked, logged to the manual checklist.
- [ ] Manual: at 480px the search row still spans the width and the tabs wrap under it. Not run manually; no automated viewport-rendering proof was produced for this slice specifically (the `accessibility.cy.js` 375px checks cover overflow/axe, not this row's wrap behaviour). Left unchecked, logged to the manual checklist.
- [x] app functional — no broken path from this slice: full `npm run test` suite (592 tests), `lint`, `typecheck`, `build`, and both named cypress specs all pass end to end.
- [x] commit msg draft: `refactor(calendar): put the search filter on its own chrome-less row` — used verbatim as the commit message.
