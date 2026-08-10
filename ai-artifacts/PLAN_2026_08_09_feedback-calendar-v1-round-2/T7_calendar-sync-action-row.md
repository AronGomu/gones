# T7: Calendar sync action row

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T1
**Commit outcome:** The calendar page's Synchronise button carries a sync icon and sits at the top right of the back-to-menu row, with the last-synchronised stamp immediately to its left.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, Signals, zoneless, Angular Material, single global stylesheet `src/styles.css`).
- This slice: feedback line 5 — "On the calendar page, the synchronize button should be placed at the top right, on the same row as the back-to-menu button, not under the header or breadcrumb. Also add the classic synchronize icon to the button. Also move the text indicating the last synchro and put it at the left of the button."
- Out of scope here: the search input (T8), the month navigation (T9), the day cells (T10), pagination (T11), the caching service itself, any backend change.
- Assumptions in force: **A10** — the icon is inline SVG, not `<mat-icon>sync</mat-icon>`. `src/index.html` pulls the Material Icons font from `fonts.googleapis.com`; the calendar page must still show its sync affordance for an offline PWA visitor, and `gones-back-button` in the same row already draws its chevron as inline SVG.

### Current state — read before editing

`src/app/features/calendar/public-calendar.component.ts`, lines 41–56:

```html
<gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="calendar-back-top" />
<section class="info-page public-calendar-page" aria-labelledby="public-calendar-title" data-cy="public-calendar">
  <header class="section-header" data-cy="calendar-header">
    <div data-cy="calendar-header-text"><h1 id="public-calendar-title" data-cy="calendar-title">{{ i18n.t('calendar.publicTitle') }}</h1></div>
    <div class="calendar-header-actions" data-cy="calendar-header-actions">
      <div class="calendar-view-tabs" role="group" [attr.aria-label]="i18n.t('calendar.viewAria')" data-cy="calendar-view-tabs">
        <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'calendar'" data-cy="calendar-view" (click)="setView('calendar')">{{ i18n.t('calendar.tabCalendar') }}</button>
        <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'list'" data-cy="list-view" (click)="setView('list')">{{ i18n.t('calendar.listView') }}</button>
      </div>
      <button mat-stroked-button type="button" class="secondary-action" data-cy="calendar-sync" [disabled]="loading()" (click)="sync()">{{ i18n.t('calendar.synchronise') }}</button>
      @if (canCreateTournament()) {
        <a mat-flat-button class="home-primary-action" routerLink="/tournaments/new" data-cy="calendar-create-tournament">{{ i18n.t('calendar.createTournament') }}</a>
      }
      @if (syncedAt(); as instant) { <span class="muted" data-cy="calendar-synced-at">{{ i18n.t('calendar.syncedAt', { instant: i18n.formatDateTime(instant) }) }}</span> }
    </div>
  </header>
```

So today the sync button and the stamp both live inside `.calendar-header-actions`, under the page header, with the stamp **after** the button. The back button sits on a separate row above the whole `<section>`.

`src/app/shared/back-button.component.ts` renders `<div class="back-button-row back-button-row--top" data-cy="back-button-row-top">` wrapping the link. It is a standalone component with `@Input() link | label | position`; it cannot host siblings itself, so the shared row must be a wrapper `div` in the calendar template.

Component members already available (`PublicCalendarComponent`): `loading` (signal), `syncedAt` (signal, `string | undefined`), `sync()` (calls `load({ force: true })`), `i18n.formatDateTime`.

`src/styles.css` today:
- line 1114: `.calendar-header-actions { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }`
- `.back-button-row` / `.back-button-row--top` rules exist near the shared-component styles; find them with `grep -n "back-button-row" src/styles.css` before editing so the new wrapper does not fight their margins.

Repo rules: every rendered element needs a unique `data-cy` (`src/AGENT.md`, enforced by `src/app/shared/data-cy-coverage.test.ts`). **`svg` and `path` are in that test's exemption list** (`EXEMPT_TAGS`), so the icon's shape elements need no attribute. Every new i18n key goes in **both** the `en` and `fr` maps of `src/app/i18n/messages.ts`.

- **From Depends (T1):** a working local login (`admin@gones.test` / `test@gones.test`, password `Gones-dev-pass-123!`, seeded by `npm run dev`). Needed only to see the Create tournament action while validating that it stays in the header.

## Requirements

- One row at the top of the page holds, left to right: the back-to-menu button, then a right-aligned group of `[last-synchronised stamp][Synchronise button]`.
- The stamp is to the **left** of the button and renders only when `syncedAt()` has a value.
- The button contains the sync icon followed by its label, on one baseline.
- The button keeps its existing `data-cy="calendar-sync"`, its `[disabled]="loading()"` binding and its `(click)="sync()"` handler.
- `.calendar-header-actions` keeps the view tabs and the Create tournament action; it loses only the sync button and the stamp.
- Nothing renders under the breadcrumb that used to be the sync affordance.

## Inputs

- `src/app/features/calendar/public-calendar.component.ts` — template lines 41–56 and the class members listed above.
- `src/app/shared/back-button.component.ts` — for the markup it emits; **do not edit it**.
- `src/styles.css` — `.calendar-header-actions` (line 1114) and the `.back-button-row*` rules.
- `src/app/features/calendar/public-calendar.component.test.ts` — 240-line existing suite using a bare `Injector` and stubbed services; extend it, do not replace it.
- `cypress/e2e/public-calendar.cy.js` — browser spec that already exercises `[data-cy="calendar-sync"]`.
- **From Depends:** see above.

## TDD

1. **Red** — add the layout-contract cases to `public-calendar.component.test.ts` first (source-text assertions in the style already used elsewhere in the repo). They fail on the current template.
2. **Green** — restructure the template and add the stylesheet rules.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `the sync button shares the back-button row` | component source | `data-cy="calendar-top-actions"` exists, and both `data-cy="calendar-back-top"` and `data-cy="calendar-sync"` appear between its opening tag and its closing `</div>` |
| `the last-sync stamp is to the left of the button` | component source | inside the `data-cy="calendar-sync-group"` block, the index of `calendar-synced-at` is **less** than the index of `calendar-sync` |
| `the sync button carries an icon` | component source | the `data-cy="calendar-sync"` block contains `<svg` and `class="calendar-sync-icon"` |
| `the icon is decorative` | component source | the `calendar-sync-icon` element carries `aria-hidden="true"` |
| `the header no longer holds the sync affordance` | component source | the `data-cy="calendar-header-actions"` block contains neither `calendar-sync"` nor `calendar-synced-at` |
| `the header keeps the view tabs and the create action` | component source | the `data-cy="calendar-header-actions"` block still contains `calendar-view-tabs` and `calendar-create-tournament` |
| `the top row is laid out as a justified row` | `src/styles.css` text | a `.calendar-top-actions` block exists containing `display: flex` and `justify-content: space-between` |
| `sync still forces a reload` | existing behavioural test | `component.sync()` calls `catalog.load` with `{ force: true }` — keep or add this assertion so the move cannot silently break the action |

## Impl steps

- [x] 1. Add the eight cases above to `src/app/features/calendar/public-calendar.component.test.ts`. Read the component source with `readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8')` and the stylesheet with `readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8')`. For the last row, reuse the file's existing `setup()` helper and its `catalog` stub.
- [x] 2. Run `npx vitest run src/app/features/calendar/public-calendar.component.test.ts` — the new layout cases must fail.
- [x] 3. In `src/app/features/calendar/public-calendar.component.ts`, replace the standalone `<gones-back-button … position="top" …/>` line with:
      ```html
      <div class="calendar-top-actions" data-cy="calendar-top-actions">
        <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="calendar-back-top" />
        <div class="calendar-sync-group" data-cy="calendar-sync-group">
          @if (syncedAt(); as instant) { <span class="muted calendar-synced-at" data-cy="calendar-synced-at">{{ i18n.t('calendar.syncedAt', { instant: i18n.formatDateTime(instant) }) }}</span> }
          <button mat-stroked-button type="button" class="secondary-action calendar-sync-button" data-cy="calendar-sync" [disabled]="loading()" (click)="sync()" [attr.aria-label]="i18n.t('calendar.synchroniseAria')">
            <svg class="calendar-sync-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.9-3" /><path d="M4 5v5h5" /><path d="M4 13a8 8 0 0 0 14.9 3" /><path d="M20 19v-5h-5" /></svg>
            <span data-cy="calendar-sync-label">{{ i18n.t('calendar.synchronise') }}</span>
          </button>
        </div>
      </div>
      ```
- [x] 4. In the same template, delete these two lines from inside `.calendar-header-actions`:
      - the old `<button … data-cy="calendar-sync" …>{{ i18n.t('calendar.synchronise') }}</button>`
      - the old `@if (syncedAt(); as instant) { <span class="muted" data-cy="calendar-synced-at">…</span> }`
      Leave `calendar-view-tabs` and the `canCreateTournament()` block where they are.
- [x] 5. In `src/app/i18n/messages.ts`, add `'calendar.synchroniseAria': 'Synchronise the tournament catalogue',` to the `en` map beside `calendar.synchronise` (line 508), and `'calendar.synchroniseAria': 'Synchroniser le catalogue des tournois',` to the `fr` map beside its own (line 1535).
- [x] 6. In `src/styles.css`, next to the other `public-calendar-*` rules (around line 1105), add:
      ```css
      .calendar-top-actions { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
      .calendar-top-actions .back-button-row--top { margin: 0; }
      .calendar-sync-group { display: inline-flex; align-items: center; gap: .6rem; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
      .calendar-synced-at { font-size: .82rem; white-space: nowrap; }
      .calendar-sync-button { display: inline-flex; align-items: center; gap: .45rem; }
      .calendar-sync-icon { width: 18px; height: 18px; flex: 0 0 18px; }
      ```
      First run `grep -n "back-button-row" src/styles.css` and confirm the existing `--top` rule's margin is what the override above must neutralise; adjust the override to match the real property if it is not `margin`.
- [x] 7. Run `npx vitest run src/app/features/calendar/public-calendar.component.test.ts src/app/shared/data-cy-coverage.test.ts` — green.

## Outputs

- Changed: `src/app/features/calendar/public-calendar.component.ts`, `src/app/features/calendar/public-calendar.component.test.ts`, `src/styles.css`, `src/app/i18n/messages.ts`.
- Behaviour: the sync affordance moves from under the header to the top action row; the stamp precedes the button.
- New `data-cy` values: `calendar-top-actions`, `calendar-sync-group`, `calendar-sync-label`. Preserved: `calendar-sync`, `calendar-synced-at`, `calendar-back-top`. New i18n key: `calendar.synchroniseAria` (en + fr).

## Validation

- [x] `npm run test` passes
- [x] `npm run lint` passes
- [x] `npm run typecheck` passes
- [x] `npm run build` passes
- [x] `npx cypress run --spec cypress/e2e/public-calendar.cy.js` passes
- [ ] Manual: `npm run dev`, open `http://127.0.0.1:4200/calendar` — the back-to-menu button is on the left of the top row, the Synchronise button with its circular-arrows icon is on the right, and the "last synchronised" text sits immediately to its left. (needs human browser; layout-contract test `the sync button shares the back-button row` + `the last-sync stamp is to the left of the button` cover the DOM order automatically — see manual checklist)
- [x] Manual: click Synchronise — the button disables while loading, the stamp updates on completion. (automated: cypress `Synchroniser forces a refetch` in `public-calendar.cy.js` exercises `[data-cy="calendar-sync"]` click and asserts `calendar-synced-at` becomes visible)
- [ ] Manual: clear the cached catalogue (`localStorage` key used by `all-tournaments-cache.service.ts`) and reload — with no `syncedAt` the stamp is absent and the button is still flush right. (needs human browser; no automated equivalent added — see manual checklist)
- [ ] Manual: at 480px the group wraps under the back button without horizontal overflow. (needs human browser; no automated equivalent added — see manual checklist)
- [ ] Manual: with the network throttled to offline the icon still renders (it is inline SVG, not a webfont glyph). (needs human browser; no automated equivalent added — see manual checklist)
- [x] app functional — no broken path from this slice (`npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`, cypress spec all pass)
- [x] commit msg draft: `feat(calendar): move the sync action and its stamp onto the top row`
