# T6: Event detail hero reflow

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T5
**Commit outcome:** on `/calendar/tournaments/:slug` the hero shows `[{format}] {title} ({capacity})` as one title row, date-time and location on a single row, the "Organization Website" button at the bottom right of the hero section, and no organization block anywhere on the page.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md` — calendar/detail polish, an admin organization workbench, a guard fix, generated demo docs, and a Tournament → Event rename.
- This slice: feedback items 13, 14, 15 and 17, all inside the shared detail view component.
- Out of scope here: the maps link on the location (T7), the registration action row (T8), the route rename (T18).
- Assumptions in force: the same component renders both the public detail page and the organizer preview (`TournamentPreviewRenderResponse`), so both must keep working. `formats` is an array — join with `/` when several. `capacity` may be undefined — then the `(capacity)` suffix is omitted. Item 17 removes the *organization id* block and the organization fact row; the organization name stays as the hero kicker.

## Requirements

- In `src/app/features/calendar/tournament-detail-view.component.ts`:
  - Title row: `<h1 id="tournament-title" data-cy="tournament-detail-title">` renders `[{formats()}] {title} ({capacity})` as three spans: `[data-cy=tournament-detail-title-format]`, `[data-cy=tournament-detail-title-text]`, `[data-cy=tournament-detail-title-capacity]`. Format bracket omitted when `formats.length === 0`; capacity parentheses omitted when `capacity` is falsy.
  - Add `readonly titleFormat = computed(() => this.tournament().formats.map(f => f.name).join(' / '))`.
  - Replace the `<dl class="event-facts">` block: a single row `<p class="event-when-where" data-cy="tournament-detail-when-where">` containing `[data-cy=tournament-detail-when]` (value of `date().primary`) then a separator ` - ` (`[data-cy=tournament-detail-when-where-separator]`) then `[data-cy=tournament-detail-where]` (value of `venue()`).
  - Keep the viewer-time line as `[data-cy=tournament-detail-fact-date-viewer]` below the row when `date().secondary` exists.
  - Delete the `tournament-detail-fact-organization` block, the `tournament-detail-fact-formats` block and the `tournament-detail-fact-capacity` block (their content now lives in the title row).
  - Move the actions container to the end of the hero section with `class="info-actions info-actions--end"`, and inside it keep only the organization website anchor (`[data-cy=tournament-detail-organization-website]`). The ICS anchor moves out of this component in T8 — for this ticket keep rendering it here so nothing regresses, but place it before the website anchor.
- CSS in `src/styles.css`: `.info-actions--end { justify-content: flex-end; }` and `.event-when-where { display: flex; flex-wrap: wrap; gap: .35rem; align-items: baseline; }`.
- Search the repo for any remaining organization-id rendering on this page (`grep -rn "organizationId" src/app/features/calendar/*.ts`) and remove only the ones rendered on the public detail page.

## Inputs

- `src/app/features/calendar/tournament-detail-view.component.ts` — full hero markup: kicker `tournament-detail-kicker` (organization name), status pill, `<h1>`, summary, `<dl class="event-facts">` with fact blocks `date`, `venue`, `organization`, `formats`, `capacity`, then `<div class="info-actions">` with `tournament-ics` and `tournament-detail-organization-website`; class exposes `status()`, `date()`, `venue()`, `formats()`.
- `src/app/features/calendar/public-tournament-detail.component.ts` — hosts `<gones-tournament-detail-view [tournament]="item" [icsUrl]="service.icsUrl(item.slug)" />`.
- `src/app/i18n/messages.ts` — existing keys `calendar.venueTime`, `calendar.viewerTime`, `common.location`, `calendar.organization`, `calendar.format`, `calendar.capacity`, `calendar.organizationWebsite`. Remove keys only if no other file uses them (`grep -rn "calendar.capacity" src`).
- **From Depends:** T5 changed only the calendar page; nothing consumed here.

## TDD

- [x] 1. **Red** — component tests in a new `src/app/features/calendar/tournament-detail-view.component.test.ts`. — criterion: vitest reports failures for the new file (`Tests  7 failed (7)`).
- [x] 2. **Green** — reflow the template. — criterion: `npx vitest run src/app/features/calendar` green.
- [x] 3. **Refactor** — drop unused i18n keys and helper methods. — criterion: `formats()` removed; every candidate i18n key still referenced elsewhere (`calendar.organization`/`format`/`capacity`/`venueTime`/`common.location` → kept, still used by tournament-request / organizer-create / my-registrations).

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `title row shows format, title and capacity` | formats `[{name:'Modern'}]`, title `Gones Night`, capacity `32` | `tournament-detail-title` text equals `[Modern] Gones Night (32)` |
| `title row omits capacity when absent` | capacity `undefined` | title text has no `(` |
| `title row omits the bracket when there is no format` | formats `[]` | title text does not start with `[` |
| `title row joins multiple formats` | formats `[{name:'Modern'},{name:'Legacy'}]` | contains `[Modern / Legacy]` |
| `when-where row holds date and location` | any item | `tournament-detail-when-where` text contains both the date value and the venue string, separated by `-` |
| `organization fact block is gone` | any item | `[data-cy=tournament-detail-fact-organization]` does not exist |
| `website button sits in the end-aligned actions row` | organization with website | `[data-cy=tournament-detail-organization-website]` exists inside `.info-actions--end` |

## Impl steps

- [x] 1. Create `src/app/features/calendar/tournament-detail-view.component.test.ts` with the seven tests, using a fixture object typed as `PublicTournamentDetailResponse`. — file exists, 7 `it(...)` blocks matching the Test plan rows.
- [x] 2. Run `npx vitest run src/app/features/calendar/tournament-detail-view.component.test.ts` — red. — output `Tests  7 failed (7)`.
- [x] 3. Add `titleFormat` computed; rewrite the `<h1>` with the three spans. — component line 46 + `<h1>` carries `tournament-detail-title-format` / `-text` / `-capacity`.
- [x] 4. Replace the `<dl class="event-facts">` with the `event-when-where` row plus the viewer-time line. — `grep -rn "event-facts" src` returns styles.css only; `tournament-detail-when-where` row present with the viewer line under it.
- [x] 5. Delete the organization / formats / capacity fact blocks. — `grep -rn "tournament-detail-fact-" src cypress` returns only `tournament-detail-fact-date-viewer`.
- [x] 6. Move `<div class="info-actions info-actions--end">` to the end of the hero `<section>`, keeping ICS then website. — actions `<div>` is the last child of `event-hero`; ICS anchor precedes the website anchor.
- [x] 7. Add the two CSS rules to `src/styles.css`. — `.info-actions--end { justify-content: flex-end; }` (line 115) and `.event-when-where { … }` (line 331).
- [x] 8. `grep -rn "tournament-detail-fact-" src cypress` and update every stale selector. — no cypress spec referenced the removed selectors; only the kept viewer line matches.
- [x] 9. Run `npx vitest run src/app/features/calendar`, `npm run lint`, `npm run typecheck`, `npx vitest run src/app/shared/data-cy-coverage.test.ts`. — see Validation.

## Outputs

- Files touched: `src/app/features/calendar/tournament-detail-view.component.ts`, new `tournament-detail-view.component.test.ts`, `src/styles.css`, possibly `src/app/i18n/messages.ts` and Cypress specs.
- Behaviour change: hero layout; organization fact block removed.

## Validation

- [x] `npx vitest run src/app/features/calendar` passes — `Test Files  17 passed (17)`, `Tests  205 passed (205)`
- [x] `npm run lint && npm run typecheck` pass — `All files pass linting.`; `tsc --noEmit` on app + spec projects silent
- [x] `npx cypress run --spec cypress/e2e/public-calendar.cy.js,cypress/e2e/organizer-tournament-create.cy.js` passes (the preview reuses this component) — `public-calendar.cy.js 12/12`, `organizer-tournament-create.cy.js 7/7`
- [x] `npm run test` — `Test Files  107 passed (107)`, `Tests  980 passed (980)` (includes `data-cy-coverage` and the acceptance matrix)
- [x] `npx cypress run --spec cypress/e2e/accessibility.cy.js` — `11 passing`, 0 failing (hard gate held, `public tournament detail has no WCAG A/AA violations` and the 375px overflow case included)
- [x] browser-read layout evidence (not template source): `public-calendar.cy.js` asserts `tournament-detail-title` `have.text` `[Legacy] Lyon Legacy (32)`, `tournament-detail-when`/`-where` bounding-rect tops equal within 2px, `tournament-detail-hero > :last-child` is `tournament-detail-actions`, and the website button's right edge matches the actions row's
- [x] manual check: open an event page and the organizer preview — both render the new hero — covered by the two cypress specs above (public detail + organizer preview render the same component); human steps appended to `ai-artifacts/manual_test_checklist.md` under `## T6 detail-hero-reflow`
- [x] app functional — description section, participants and registration section untouched — diff touches only the hero block; `tournament-registration.cy.js` selectors unchanged, `npm run test` green
- [x] commit msg draft: `feat(calendar): reflow the event detail hero`
