# T3: List card click, hover, local time

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T2
**Commit outcome:** on `/calendar?view=list`, the whole card navigates to the event page, the "Add to calendar" button still downloads the ICS without navigating, the card lifts on hover like the rest of the app, and the card time no longer prints a GMT/zone suffix.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md` — calendar/detail polish, an admin organization workbench, a guard fix, generated demo docs, and a Tournament → Event rename.
- This slice: feedback items 2, 3 and 11. Remove the "View Page" button, make the card itself clickable, keep the ICS button interactive, add a hover effect, drop the timezone suffix from the card date because the location already carries that information.
- Out of scope here: the calendar (month grid) view, the detail page, search highlighting (T4).
- Assumptions in force: the detail route is still `/calendar/tournaments/:slug` at this point — T18 renames it later. Do not anticipate the rename.

## Requirements

- Delete the `calendar-card-view` anchor from the list card action row in `src/app/features/calendar/public-calendar.component.ts`.
- The `<article class="panel public-tournament-card">` becomes clickable: `(click)="openTournament(item)"`, `(keydown.enter)="openTournament(item)"`, `(keydown.space)="openTournament(item, $event)"`, `role="link"`, `tabindex="0"`, `[attr.aria-label]="item.title"`.
- The ICS anchor keeps working: add `(click)="$event.stopPropagation()"` to `[data-cy=calendar-card-ics]`.
- The inner title anchor `[data-cy=calendar-card-link]` stays (screen-reader affordance) and also stops propagation.
- Add `export function tournamentCardDatePresentation(item: Omit<PublicTournamentView, 'id'>, locale: string): string` to `src/app/features/calendar/public-calendar.ts`: returns `` `${formatWallDate(item.venueStartDate, locale)}, ${formatWallTime(item.venueStartTime, locale)}` `` — reusing the existing private `formatWallDate` / `formatWallTime` helpers, and printing no zone short name and no IANA id.
- The card date line uses the new function; the detail page keeps `tournamentDatePresentation` untouched.
- Keep the viewer-time secondary line `[data-cy=calendar-card-viewer-date]` as is.
- Hover effect in `src/styles.css`: `.public-tournament-card { cursor: pointer; transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease; }` and `.public-tournament-card:hover, .public-tournament-card:focus-visible { transform: translateY(-2px); box-shadow: 0 12px 28px rgb(0 0 0 / .35); }` — match the accent/border token already used by other hover rules in that file rather than inventing one.

## Inputs

- `src/app/features/calendar/public-calendar.component.ts` — the `#tournamentCard` `ng-template` holds the card markup; actions live in `<div class="calendar-event__actions" data-cy="calendar-card-actions">` with `calendar-card-view` and `calendar-card-ics`; `private readonly router = inject(Router)` already exists.
- `src/app/features/calendar/public-calendar.ts` — `tournamentDatePresentation(tournament, locale, viewerTimeZone)` returns `{ primary, secondary? }` where `primary` is `` `${venueDate}, ${venueTime} (${venueShortZone}, ${timeZoneId})` ``; private helpers `formatWallDate`, `formatWallTime`, `zoneName`, `dateTimeParts`.
- `PublicTournamentService.icsUrl(slug)` supplies the ICS href.
- **From Depends:** T2 added `isPastCalendarDay` to `public-calendar.ts` and `isPast()` + `today` to the component; keep both.

## TDD

1. **Red** — unit tests for `tournamentCardDatePresentation`, component tests for click and stop-propagation.
2. **Green** — implement.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `tournamentCardDatePresentation omits the timezone suffix` | item `venueStartDate '2026-08-12'`, `venueStartTime '19:30:00'`, `timeZoneId 'Europe/Paris'`, locale `'en'` | result contains the time, contains neither `(` nor `Europe/Paris` |
| `tournamentCardDatePresentation keeps the date part` | same | contains the localized day and month |
| component `clicking the card navigates to the event page` | click `[data-cy=tournament-<slug>]` | `router.navigate` called with `['/calendar/tournaments', slug]` |
| component `clicking add to calendar does not navigate` | click `[data-cy=calendar-card-ics]` | `router.navigate` not called |
| component `the view page button is gone` | render list view | `[data-cy=calendar-card-view]` does not exist |

## Impl steps

- [x] 1. Add `tournamentCardDatePresentation` to `src/app/features/calendar/public-calendar.ts`. — `public-calendar.ts:143`, exported, reuses `formatWallDate` / `formatWallTime`.
- [x] 2. Add the two pure tests to `src/app/features/calendar/public-calendar.test.ts`; run `npx vitest run src/app/features/calendar/public-calendar.test.ts`. — red first (`TypeError: tournamentCardDatePresentation is not a function`, 2 failed), then `Test Files 1 passed (1) / Tests 39 passed (39)`.
- [x] 3. In the component class add `openTournament(item: PublicTournamentView, event?: Event): void { event?.preventDefault(); void this.router.navigate(['/calendar/tournaments', item.slug]); }` and `cardDate(item: PublicTournamentView): string { return tournamentCardDatePresentation(item, this.i18n.locale()); }`.
- [x] 4. In the `#tournamentCard` template add the click/keydown/role/tabindex/aria-label attributes to the `<article>`; swap `{{ date(item).primary }}` for `{{ cardDate(item) }}` on `[data-cy=calendar-card-date]`. — `public-calendar.component.ts:133-134`; asserted by `the card is the click target, and reads as a link to assistive tech` and `the card date line drops the zone and the viewer-time line stays`.
- [x] 5. Delete the `calendar-card-view` anchor; add `(click)="$event.stopPropagation()"` to `calendar-card-ics` and `calendar-card-link`. — `grep -c 'calendar-card-view' src/` → 0; asserted by `the view page button is gone`, `clicking add to calendar does not navigate`, `the title link stays and stops the card handler firing twice`.
- [x] 6. Add the hover CSS to `src/styles.css` beside the existing `.public-tournament-card` rules (around line 1150). — `styles.css:1152-1153`, `border-color: var(--hot-blood)` reuses the token `.home-destination:hover` already uses; asserted by `the card lifts on hover and on keyboard focus`.
- [x] 7. Add the three component tests to `src/app/features/calendar/public-calendar.component.test.ts`. — 9 tests added under `describe('PublicCalendarComponent list card')`, red first (`Tests 9 failed | 59 passed`).
- [x] 8. Run `npx vitest run src/app/features/calendar`, `npm run lint`, `npm run typecheck`. — `Test Files 16 passed (16) / Tests 188 passed (188)`; `All files pass linting.`; `tsc --noEmit` clean on both projects.
- [x] 9. Update `cypress/e2e/public-calendar.cy.js` if it asserts `calendar-card-view`; replace with a card-click assertion. — the spec never asserted it; added `the list card navigates on click while Add to calendar stays on the list`, which clicks the ICS anchor (stays on `/calendar`) and then the card body (lands on `/calendar/tournaments/lyon-legacy`).

## Outputs

- Files touched: `src/app/features/calendar/public-calendar.ts`, `public-calendar.test.ts`, `public-calendar.component.ts`, `public-calendar.component.test.ts`, `src/styles.css`, possibly `cypress/e2e/public-calendar.cy.js`.
- Behaviour change: card-level navigation, no "View Page" button, no zone suffix on the card date line.

## Validation

- [x] `npx vitest run src/app/features/calendar` passes — `Test Files 16 passed (16) / Tests 188 passed (188)`; whole suite `npm run test` → `Test Files 105 passed (105) / Tests 959 passed (959)`.
- [x] `npm run lint && npm run typecheck` pass — `All files pass linting.` and `tsc --noEmit` clean on `tsconfig.app.json` + `tsconfig.spec.json`.
- [x] `npx cypress run --spec cypress/e2e/public-calendar.cy.js` passes — `9 passing (5s)`, including `the list card navigates on click while Add to calendar stays on the list`. Run needs the `LD_LIBRARY_PATH` `scripts/full-stack-ci.mjs` computes (lines 28-36) on this NixOS host.
- [x] browser proof of the nested-interactive risk — in the same spec: click `[data-cy=calendar-card-ics]` → ICS request served, `location.pathname` stays `/calendar`; then click `[data-cy=calendar-card-venue]` (card body) → `/calendar/tournaments/lyon-legacy` and the detail panel renders. Negative control: with the ICS keydown guard removed the spec fails (`Expected to find element: [data-cy="calendar-card-venue"], but never found it`), so the assertion constrains the implementation.
- [x] axe gate on the new click target — list view scanned with the accessibility spec's `checkA11y` helper at WCAG 2 A/AA: `1 passing`, no `nested-interactive` and no other violation on `role="link"` card. (The month-view `color-contrast` failures in `cypress/e2e/accessibility.cy.js` reproduce unchanged on `git stash`ed base `00783cb` — inherited from T2, not this slice.)
- [x] app functional — pagination, grouping and the empty state unchanged: `pages the list at twenty tournaments and drops the page on search`, `shows an empty state below the grid when nothing matches the catalog` and the grouping assertions all pass in the same cypress run; `groupTournamentsByVenueDate` / `paginateTournaments` untouched.
- [x] commit msg draft: `feat(calendar): make list cards clickable and drop the zone suffix`

## Deviation from the ticket (in-scope correctness fix)

- [x] `calendar-card-ics` also stops `keydown.enter` / `keydown.space`, not only `click`. The ticket asks for the click guard alone; with only that guard, Enter on "Add to calendar" bubbles to the card's `(keydown.enter)` **before** the anchor's synthetic click, so a keyboard reader was navigated off the list while the download started. Proven by the negative control above.
