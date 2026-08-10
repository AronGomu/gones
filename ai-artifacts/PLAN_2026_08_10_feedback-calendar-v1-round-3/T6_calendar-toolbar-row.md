# T6: Calendar toolbar row

**Plan:** `./ai-artifacts/PLAN_2026_08_10_feedback-calendar-v1-round-3.md`
**Depends:** none
**Commit outcome:** On `/calendar`, the search box looks like a normal bordered input again, and "Create tournament" sits on the same row as the Calendar / List toggles, pushed right, in the success green.

## Context (self-contained)

- Goal: land 15-line round-3 feedback on Gones. This slice covers two lines:
  - #7 — "On the calendar view and list view of the calendar page, the border of the input to search an event disappeared. Make it a normal input. Just don't add a background and borders for the container of that input."
  - #8 — "On the calendar view, the Create Tournament button should be on the same row as the buttons that toggle between calendar and list view. Keep it justified right and update its color to the green success color."
- This slice: the calendar page's toolbar chrome only. T7 changes what the month grid renders.
- Out of scope here: the month grid cells, the list view cards, pagination, the sync row, the offline banner.
- Assumptions in force: this repo has no TestBed — component tests assert on the template source string, and stylesheet rules are asserted by reading `src/styles.css` (precedent: `src/app/features/menu/home-grid-rule.test.ts`). Every element carries `data-cy`.

## Inputs

- `src/app/features/calendar/public-calendar.component.ts` — the page. Relevant template fragments, in order:
  - `<header class="section-header" data-cy="calendar-header">` containing `<div data-cy="calendar-header-text">` with the `<h1 id="public-calendar-title" data-cy="calendar-title">`, then `<div class="calendar-header-actions" data-cy="calendar-header-actions">` which holds only:
    ```html
    @if (canCreateTournament()) {
      <a mat-flat-button class="home-primary-action" routerLink="/tournaments/new" data-cy="calendar-create-tournament">{{ i18n.t('calendar.createTournament') }}</a>
    }
    ```
  - `<form class="calendar-search-row" data-cy="calendar-search-row" (ngSubmit)="$event.preventDefault()">` holding `<input id="calendar-search" name="q" type="search" class="calendar-search-input" data-cy="calendar-search" …>`.
  - `<div class="calendar-view-tabs" role="group" [attr.aria-label]="i18n.t('calendar.viewAria')" data-cy="calendar-view-tabs">` holding `data-cy="calendar-view"` and `data-cy="list-view"` buttons.
  - `readonly canCreateTournament = computed(() => this.auth.enabled && this.auth.profile()?.emailVerified === true);`
- `src/styles.css`, current rules:
  - line ~1115 `.calendar-view-tabs { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; margin-bottom: .5rem; }`
  - line ~1118 `.calendar-search-row { display: flex; width: 100%; margin: .35rem 0 .5rem; }`
  - line ~1119 `.calendar-search-input { width: 100%; min-height: 2.25rem; padding: .3rem 0; border: 0; background: transparent; color: var(--ash); font: inherit; }`
  - line ~1122 `.calendar-header-actions { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }` — used **only** by this page.
  - line ~1172, inside a narrow-viewport media query: `.calendar-view-tabs, .calendar-view-tabs button { width: 100%; }`
  - line ~683 `.create-action-button { … background-color: var(--create-green) !important; color: var(--forge) !important; font-weight: 900; … }` — the existing success-green filled button, already used elsewhere. Reuse it; do **not** invent a new green.
  - The app's normal input shape, for reference: `.auth-form input:not([type='checkbox']) { width: 100%; min-height: 48px; padding: .7rem .8rem; border: 1px solid var(--steel); border-radius: 0; background: var(--black-metal); color: var(--ash); font: inherit; }`.
- `src/app/features/calendar/public-calendar.component.test.ts` — existing source-assertion tests for this page. Add to it.
- **From Depends:** none.

## Requirements

- `.calendar-search-input` becomes a normal input: `border: 1px solid var(--steel)`, `background: var(--black-metal)`, `border-radius: 0`, `padding: .7rem .8rem`, `min-height: 44px`, keeping `width: 100%`, `color: var(--ash)`, `font: inherit`.
- `.calendar-search-row` keeps **no** border and **no** background — it is the container the feedback explicitly wants bare.
- The `data-cy="calendar-create-tournament"` anchor moves out of `calendar-header-actions` and into `calendar-view-tabs`, after the two toggle buttons, still wrapped in `@if (canCreateTournament())`.
- Its class becomes `create-action-button calendar-create-tournament`; `home-primary-action` is dropped.
- New rule `.calendar-create-tournament { margin-left: auto; }` pushes it to the right of the flex row.
- The now-empty `<div class="calendar-header-actions" data-cy="calendar-header-actions">` is deleted, and so is the `.calendar-header-actions` rule — both become dead as a direct result of this change.
- In the narrow-viewport media query, `.calendar-view-tabs button { width: 100% }` must not stretch the anchor into a third full-width row awkwardly: add `.calendar-view-tabs .calendar-create-tournament { margin-left: 0; width: 100%; }` inside that same media query.

## TDD

1. **Red** — add the four tests below to `src/app/features/calendar/public-calendar.component.test.ts`. They fail today.
2. **Green** — edit the template, then the stylesheet.
3. **Refactor** — none needed.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the create button lives on the view-tab row` | the `calendar-view-tabs` `<div>` slice of the component source (from `data-cy="calendar-view-tabs"` to the matching `</div>`) | contains `data-cy="calendar-create-tournament"` |
| `the create button is not in the page header any more` | full component source | does **not** contain `data-cy="calendar-header-actions"`; the single occurrence of `data-cy="calendar-create-tournament"` sits after the index of `data-cy="calendar-view-tabs"` |
| `the create button wears the success green` | full component source | the `calendar-create-tournament` anchor's `class` attribute contains `create-action-button` and does not contain `home-primary-action` |
| `the search input is a normal bordered input and its row is bare` | `src/styles.css` | the `.calendar-search-input { … }` block contains `border: 1px solid var(--steel)` and `background: var(--black-metal)` and does not contain `border: 0`; the `.calendar-search-row { … }` block contains neither `border` nor `background` |

Match the stylesheet blocks the same way `src/app/features/menu/home-grid-rule.test.ts` does:
`stylesheet.match(/\.calendar-search-input\s*\{[^}]*\}/)?.[0] ?? ''`.

Run: `npx vitest run src/app/features/calendar/public-calendar.component.test.ts`

## Impl steps

- [ ] 1. Add the four tests above to `src/app/features/calendar/public-calendar.component.test.ts`.
- [ ] 2. Run `npx vitest run src/app/features/calendar/public-calendar.component.test.ts` — confirm red.
- [ ] 3. In `src/app/features/calendar/public-calendar.component.ts`, delete the `<div class="calendar-header-actions" data-cy="calendar-header-actions"> … </div>` wrapper, moving its `@if (canCreateTournament()) { <a …> }` block into `<div class="calendar-view-tabs" …>` after the `data-cy="list-view"` button.
- [ ] 4. In that moved anchor, replace `class="home-primary-action"` with `class="create-action-button calendar-create-tournament"`. Leave `mat-flat-button`, `routerLink="/tournaments/new"`, `data-cy` and the i18n key untouched.
- [ ] 5. In `src/styles.css`, rewrite `.calendar-search-input` to `width: 100%; min-height: 44px; padding: .7rem .8rem; border: 1px solid var(--steel); border-radius: 0; background: var(--black-metal); color: var(--ash); font: inherit;`.
- [ ] 6. Leave `.calendar-search-row` as `display: flex; width: 100%; margin: .35rem 0 .5rem;` — confirm it declares no `border` and no `background`.
- [ ] 7. Delete the `.calendar-header-actions { … }` rule.
- [ ] 8. Add `.calendar-create-tournament { margin-left: auto; }` next to the `.calendar-view-tabs` rules.
- [ ] 9. In the narrow-viewport media query that already holds `.calendar-view-tabs, .calendar-view-tabs button { width: 100%; }`, add `.calendar-view-tabs .calendar-create-tournament { margin-left: 0; width: 100%; }`.
- [ ] 10. Run `npx vitest run src/app/features/calendar/public-calendar.component.test.ts` — green.
- [ ] 11. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 12. Manual: signed in with a verified email, `/calendar` shows one row `[Calendar] [List] ————— [Create tournament]`, the button is green and navigates to `/tournaments/new`. Signed out, that row shows only the two toggles. The search box has a visible border in both tabs; the strip around it has none. Narrow the window: the three controls stack full width.

## Outputs

- Files edited: `src/app/features/calendar/public-calendar.component.ts`, `src/styles.css`, `src/app/features/calendar/public-calendar.component.test.ts`.
- Behaviour change: calendar toolbar layout and search-input styling. No data or route change.
- Migration/config: none.

## Validation

- [ ] `npx vitest run src/app/features/calendar/public-calendar.component.test.ts` passes.
- [ ] `npm run test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm run cy:run -- --spec cypress/e2e/public-calendar.cy.js` passes.
- [ ] Manual: create button green, right-aligned, on the toggle row; hidden when signed out or unverified.
- [ ] Manual: search input bordered in both calendar and list tabs; its container has no border and no background.
- [ ] App functional — no broken path from this slice.
- [ ] Commit msg draft: `fix(calendar): restore the search input border and move create onto the view row`
