# T14: Calendar page rewire

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T13
**Commit outcome:** The calendar page loads the whole cached catalog once a day, filters it locally through one full-width fuzzy input, drops the "Appliquer" button and the "Tournois publics" kicker, gains a "Synchroniser" button, and always renders the month grid even with zero results.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket covers Calendar §1, §2 (client half), §3, §4, §5, §6, §7 (UI half) and §8.
- This slice: `public-calendar.component.ts` and the query model in `public-calendar.ts`. The "Créer Tournoi" button is T15.
- Out of scope here: the bulk endpoint (T12), the cache and fuzzy modules (T13), tournament creation.
- Assumptions in force: month navigation, the calendar/list view toggle and pagination-free rendering stay; the URL query parameter set shrinks to `month`, `view`, `q` and `past`.

## Requirements

- `.calendar-filter-form` is a single row spanning the page width, containing exactly one text input.
- The input's placeholder is `Recherchez statut, pays, region, ville, nom organiation, format, date` (verbatim from the feedback, typos included).
- Filtering happens as the user types, against the cached catalog; there is no submit button and no navigation round trip for a keystroke.
- A `Synchroniser` button sits at the top right of the page, outside the form, and forces a refetch.
- The `Tournois publics` kicker is gone.
- The month grid renders even when nothing matches; the empty state appears **below** the grid, not instead of it.
- The old `status` / `city` / `country` / `organization` / `format` inputs and the `Appliquer` button are removed, along with their now-unused query parameters.
- The last sync timestamp is visible next to the Synchroniser button.
- Every element carries a unique `data-cy`; the touched files leave the retrofit allowlist.

## Inputs

- `src/app/features/calendar/public-calendar.component.ts` — 209 lines.
  - `:38` `<gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />`, `:110` the bottom twin.
  - `:40-46` `<header class="section-header">` with `<p class="kicker">{{ i18n.t('calendar.publicKicker') }}</p>`, `<h1 id="public-calendar-title">`, and the `calendar-view-tabs` group holding `data-cy="calendar-view"` and `data-cy="list-view"` buttons.
  - `:48-57` the filter `<form class="panel calendar-filter-form" data-cy="calendar-filters" (ngSubmit)="applyFilters()">` with seven labels and the `Appliquer` submit.
  - `:59` `<gones-offline-banner [stale]="stale()" [cachedAt]="cachedAt()" />`.
  - `:60-63` the error panel `data-cy="calendar-error"` and the skeleton `data-cy="calendar-loading"`.
  - `:65-87` the calendar view: month controls, then `@if (items().length) { <section class="public-month-grid" …> } @else { <ng-container *ngTemplateOutlet="emptyState" /> }`.
  - `:88-98` the list view with `data-cy="calendar-list"`.
  - `:99-101` the pagination nav, driven by `totalPages()`.
  - `:104` `<ng-template #emptyState>` and `:105-108` `<ng-template #tournamentCard let-item>`.
  - `:121-136` signals and computeds: `skeletons`, `weekdays`, `query`, `draft`, `result`, `loading`, `stale`, `cachedAt`, `error`, `items`, `groups`, `totalPages`, `monthLabel`, `monthDays`, `monthWeeks`.
  - `:138-149` `ngOnInit` subscribes to `route.queryParamMap`, normalises through `readCalendarQuery`, redirects when `month`/`view` were absent, then `void this.load(query)`.
  - `:153-166` `setDraft`, `setDraftPast`, `applyFilters`, `setPage`, `moveMonth`, `setView`, `reload`, `status`, `date`, `venue`, `formatGroupDate`.
  - `:168-183` `private async load(query)` calls `this.service.list(query)` and sets `result`, `stale`, `cachedAt`.
  - `:186-188` `preferredView()` reads `localStorage.getItem(VIEW_KEY)` with `VIEW_KEY = 'gones.calendar-v1.view'` (`:32`).
  - `:192-209` `chunkIntoWeeks(days)` and `buildMonthDays(month, groups)` — both stay untouched.
- `src/app/features/calendar/public-calendar.ts` — `CalendarQuery { month, view, page, past, status, city, country, organization, format, search }`, `FILTER_KEYS`, `readCalendarQuery(params, preferredView, now)`, `buildCalendarQueryParams(query)`, `groupTournamentsByVenueDate(items)`, `tournamentDatePresentation`, `statusPresentation`, `monthBounds`, `shiftMonth`.
- `src/app/features/calendar/public-calendar.test.ts` — 87 lines covering `readCalendarQuery`, `buildCalendarQueryParams` and grouping; it must be updated to the reduced query shape.
- `src/styles.css:1100-1103` — `.calendar-filter-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr)); gap: .75rem; align-items: end; padding: 1rem; }` plus its label/input rules; `:1151-1152` the mobile override.
- `src/app/i18n/messages.ts` — `calendar.publicKicker`, `calendar.status`, `calendar.city`, `calendar.country`, `calendar.organization`, `calendar.format`, `calendar.allStatuses`, `calendar.includePast`, `common.apply` in BOTH maps. `calendar.city` and `calendar.country` are also used by `organizer-tournament-create.component.ts` — check with `grep` before deleting any key.
- `src/app/shared/offline-banner.component.ts` — `<gones-offline-banner [stale] [cachedAt]>`; keep it, fed from the new cache service.
- **From Depends (T13):** `AllTournamentsCacheService` (`src/app/features/calendar/all-tournaments-cache.service.ts`) with `async load(options?: { force?: boolean }): Promise<AllTournamentsResult>` where `AllTournamentsResult = { items: PublicTournamentView[]; fetchedAt: string; fromCache: boolean; stale: boolean; truncated: boolean }`, plus the `cachedAt` and `truncated` signals; and `filterTournaments(items, query)` / `splitSearchTerms(query)` from `src/app/features/calendar/tournament-fuzzy-search.ts`.

## TDD

1. **Red** — update `src/app/features/calendar/public-calendar.test.ts` to the reduced `CalendarQuery` and add the new component test file; both fail against today's code.
2. **Green** — shrink the query model, rewrite the template and the load path.
3. **Refactor** — delete `PublicTournamentService.list` and the `monthBounds` helper if nothing else calls them (`detail` and `icsUrl` stay).

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `reads the reduced query` | params `month=2026-09&view=list&q=lyon&past=true` | `{ month:'2026-09', view:'list', q:'lyon', past:true }` |
| `drops removed parameters` | params containing `status=Published&city=Lyon&page=3` | those keys absent from `readCalendarQuery` output |
| `builds only the reduced parameters` | `buildCalendarQueryParams({month:'2026-09', view:'calendar', q:'', past:false})` | `{ month:'2026-09', view:'calendar' }` |
| `keeps q when set` | `q:'lyon\\,legacy'` | `{ …, q:'lyon\\,legacy' }` |
| `renders the grid with zero matches` | catalog loaded, `q='zzzzzz'` | `[data-cy=public-month-grid]` exists and `[data-cy=calendar-empty]` exists |
| `filters without navigating` | type into `[data-cy=calendar-search]` | `router.navigate` not called on keystroke |
| `synchronise forces a refetch` | click `[data-cy=calendar-sync]` | `cache.load` called with `{ force: true }` |
| `shows the last sync time` | cache returns `fetchedAt` | `[data-cy=calendar-synced-at]` contains the formatted instant |
| `month navigation does not refetch` | click next month | `cache.load` call count unchanged |
| `data-cy coverage` | allowlist without the component | suite green |

Run: `npm run test -- public-calendar data-cy-coverage`

## Impl steps

- [ ] 1. In `src/app/features/calendar/public-calendar.ts`, reduce `CalendarQuery` to `{ month: string; view: CalendarView; q: string; past: boolean; }` and delete `FILTER_KEYS`.
- [ ] 2. Rewrite `readCalendarQuery(params, preferredView, now = new Date())` to read only `month`, `view`, `q` and `past`.
- [ ] 3. Rewrite `buildCalendarQueryParams(query)` to emit `month`, `view`, `q` when non-empty and `past: 'true'` when set.
- [ ] 4. Delete `monthBounds` from that file if `grep -rn "monthBounds" src/` shows no other caller after step 14.
- [ ] 5. Update `src/app/features/calendar/public-calendar.test.ts` with Test plan rows 1-4 and delete the assertions covering the removed keys.
- [ ] 6. In `public-calendar.component.ts`, replace `readonly service = inject(PublicTournamentService);` usage for listing with `private readonly catalog = inject(AllTournamentsCacheService);`, keeping `service` only for `icsUrl(...)` in the card template.
- [ ] 7. Replace the `result` signal with `readonly allItems = signal<PublicTournamentView[]>([]);` and `readonly syncedAt = signal<string | undefined>(undefined);` and `readonly truncated = signal(false);`.
- [ ] 8. Add `readonly items = computed(() => filterTournaments(this.allItems(), this.query().q));` and keep `groups = computed(() => groupTournamentsByVenueDate(this.items()))` and `monthDays`/`monthWeeks` unchanged.
- [ ] 9. Delete the `draft` signal, `setDraft`, `setDraftPast`, `applyFilters`, `setPage`, `totalPages` and the pagination `<nav>` block.
- [ ] 10. Replace `private async load(query)` with `private async load(options: { force?: boolean } = {}): Promise<void>` calling `this.catalog.load(options)` and setting `allItems`, `syncedAt`, `stale`, `truncated`, `error`, `loading`; keep the `loadId` guard.
- [ ] 11. In `ngOnInit`, keep the `queryParamMap` subscription for `month`/`view`/`q`/`past` but call `void this.load()` **once**, outside the subscription, so a filter or month change never refetches.
- [ ] 12. Add `sync(): void { void this.load({ force: true }); }` and `setSearch(value: string): void { void this.navigate({ ...this.query(), q: value }); }`.
- [ ] 13. Debounce the URL write: keep the input bound to a local `searchDraft` signal for instant filtering, and push it into the URL with a 300 ms timer so back/forward still work. `items()` must read `searchDraft()`, not the URL, so typing never waits on navigation.
- [ ] 14. Delete `list(query)` from `src/app/features/calendar/public-tournament.service.ts`, keeping `detail(slug)`, `icsUrl(slug)` and the private cache helpers; update `src/app/features/calendar/public-tournament.service.test.ts` accordingly.
- [ ] 15. Replace the page header with:
  ```
  <header class="section-header" data-cy="calendar-header">
    <div data-cy="calendar-header-text"><h1 id="public-calendar-title" data-cy="calendar-title">{{ i18n.t('calendar.publicTitle') }}</h1></div>
    <div class="calendar-header-actions" data-cy="calendar-header-actions">
      <div class="calendar-view-tabs" role="group" [attr.aria-label]="i18n.t('calendar.viewAria')" data-cy="calendar-view-tabs">…existing two buttons…</div>
      <button mat-stroked-button type="button" class="secondary-action" data-cy="calendar-sync" [disabled]="loading()" (click)="sync()">{{ i18n.t('calendar.synchronise') }}</button>
      @if (syncedAt(); as instant) { <span class="muted" data-cy="calendar-synced-at">{{ i18n.t('calendar.syncedAt', { instant: i18n.formatDateTime(instant) }) }}</span> }
    </div>
  </header>
  ```
  The kicker paragraph is deleted.
- [ ] 16. Replace the whole filter form with:
  ```
  <form class="panel calendar-filter-form" data-cy="calendar-filters" (ngSubmit)="$event.preventDefault()">
    <label class="calendar-search-label" for="calendar-search" data-cy="calendar-search-label">{{ i18n.t('common.search') }}</label>
    <input id="calendar-search" name="q" type="search" class="calendar-search-input" data-cy="calendar-search"
           [attr.placeholder]="i18n.t('calendar.searchPlaceholder')"
           [ngModel]="searchDraft()" (ngModelChange)="setSearchDraft($event)">
  </form>
  ```
- [ ] 17. Replace `src/styles.css:1100` with `.calendar-filter-form { display: grid; grid-template-columns: 1fr; gap: .35rem; padding: 1rem; width: 100%; }` and add `.calendar-search-input { width: 100%; min-height: 48px; padding: .6rem .75rem; border: 1px solid var(--steel); background: var(--black-metal); color: var(--ash); font: inherit; }`. Delete the `:1151-1152` mobile override that only existed for the multi-column grid, and add `.calendar-header-actions { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }`.
- [ ] 18. Change the calendar view block so the grid always renders:
  ```
  <section class="public-month-grid" role="grid" data-cy="public-month-grid" …>…</section>
  @if (!items().length) { <ng-container *ngTemplateOutlet="emptyState" /> }
  ```
  and keep the list view's `@if (groups().length) { … } @else { emptyState }` as is — a list with no rows has nothing to show.
- [ ] 19. Add keys to BOTH maps in `src/app/i18n/messages.ts`: `calendar.synchronise` (en `'Synchronise'`, fr `'Synchroniser'`), `calendar.syncedAt` (en `'Last sync: {instant}'`, fr `'Dernière synchro : {instant}'`), `calendar.searchPlaceholder` (both maps get the literal French string `'Recherchez statut, pays, region, ville, nom organiation, format, date'`), `calendar.truncatedWarning` (en `'Only the first {count} tournaments are shown.'`, fr `'Seuls les {count} premiers tournois sont affichés.'`).
- [ ] 20. Render the truncation warning as `@if (truncated()) { <p class="warning" role="status" data-cy="calendar-truncated">…</p> }` above the grid.
- [ ] 21. Delete `calendar.publicKicker` from BOTH maps. For `calendar.status`, `calendar.allStatuses`, `calendar.organization`, `calendar.format`, `calendar.includePast` and `common.apply`, run `grep -rn "<key>" src/` first and delete only the ones with no remaining caller. **Do not** delete `calendar.city` or `calendar.country` — `organizer-tournament-create.component.ts` uses them.
- [ ] 22. Give every remaining element in the component template a unique `data-cy` prefixed `calendar-`.
- [ ] 23. Delete `src/app/features/calendar/public-calendar.component.ts` from `PENDING_DATA_CY_RETROFIT` in `src/app/shared/data-cy-coverage.test.ts`.
- [ ] 24. Note: `public-calendar.component.ts` keeps its `localStorage` view-preference access, so it stays in the `server-authority-boundary.test.ts` allowlist. Do not remove it there.
- [ ] 25. Create `src/app/features/calendar/public-calendar.component.test.ts` with Test plan rows 5-9, stubbing `AllTournamentsCacheService` and `Router`.
- [ ] 26. Update `cypress/e2e/public-calendar.cy.js`: drop the per-field filter interactions, type into `[data-cy=calendar-search]`, assert `[data-cy=public-month-grid]` stays visible for a no-match query, and click `[data-cy=calendar-sync]`.
- [ ] 27. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 28. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/public-calendar.cy.js,cypress/e2e/offline-public-read.cy.js,cypress/e2e/accessibility.cy.js`.

## Outputs

- Files created: `src/app/features/calendar/public-calendar.component.test.ts`.
- Files touched: `src/app/features/calendar/public-calendar.component.ts`, `src/app/features/calendar/public-calendar.ts`, `src/app/features/calendar/public-calendar.test.ts`, `src/app/features/calendar/public-tournament.service.ts`, `src/app/features/calendar/public-tournament.service.test.ts`, `src/styles.css`, `src/app/i18n/messages.ts`, `src/app/shared/data-cy-coverage.test.ts`, `cypress/e2e/public-calendar.cy.js`.
- Public API / behavior change: calendar URLs lose `status`/`city`/`country`/`organization`/`format`/`page` and gain `q`. Old links still resolve; the dropped parameters are simply ignored.
- Migrate / config: none.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run cy:run -- --spec cypress/e2e/public-calendar.cy.js,cypress/e2e/offline-public-read.cy.js,cypress/e2e/accessibility.cy.js` passes
- [ ] manual check: open `/calendar`, watch DevTools issue exactly one `/api/tournaments/all` request; reload within the day and see none; click Synchroniser and see one; type `lyon\,legacy` and watch the grid filter without a network call
- [ ] manual check: type nonsense and confirm the month grid still renders with an empty-state panel below it
- [ ] app functional — tournament detail pages and the ICS download still work
- [ ] commit msg draft: `feat(calendar): filter a 24h-cached full catalog through one fuzzy search field`
