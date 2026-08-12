# T7: Venue maps link

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T6
**Commit outcome:** on the event detail page the location text is a link that opens Google Maps for that address in a new tab, prefixed by a small map-pin icon.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md` — calendar/detail polish, an admin organization workbench, a guard fix, generated demo docs, and a Tournament → Event rename.
- This slice: feedback item 12.
- Out of scope here: the list-view cards, the registration row (T8), any map embedding.
- Assumptions in force: no API key, no embedded map — a plain `https://www.google.com/maps/search/?api=1&query=<encoded address>` link. Icon is an inline SVG (project has no icon font); inline SVG shape elements are exempt from the data-cy rule, the wrapping anchor is not.

## Requirements

- Add to `src/app/features/calendar/public-calendar.ts`:
  `export function venueMapsUrl(venue: { streetAddress?: string; postalCode?: string; city?: string; country?: string }): string | null` — joins the present parts with `, `, returns `null` when every part is empty, otherwise `` `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(joined)}` ``.
- In `src/app/features/calendar/tournament-detail-view.component.ts`, `[data-cy=tournament-detail-where]` becomes an `<a>` when `venueMapsUrl()` is non-null: `[href]="mapsUrl()"`, `target="_blank"`, `rel="noopener noreferrer"`, `data-cy="tournament-detail-where-link"`, containing the inline SVG pin (`class="maps-icon"`, `aria-hidden="true"`) and the venue text. When null, keep a plain `<span data-cy="tournament-detail-where">`.
- Add `readonly mapsUrl = computed(() => venueMapsUrl(this.tournament().venue))`.
- CSS in `src/styles.css`: `.maps-icon { width: 1em; height: 1em; margin-right: .3rem; vertical-align: -0.125em; }`.
- The link must carry an accessible name: add `[attr.aria-label]="i18n.t('calendar.openInMaps', { address: venue() })"`; add the key `calendar.openInMaps` to BOTH `en` and `fr` maps in `src/app/i18n/messages.ts` (`en`: `Open {address} in Google Maps`; `fr`: `Ouvrir {address} dans Google Maps`).

## Inputs

- `src/app/features/calendar/tournament-detail-view.component.ts` — after T6 the location lives in the `event-when-where` row as `[data-cy=tournament-detail-where]`; `venue()` returns `[streetAddress, postalCode, city, country].filter(Boolean).join(', ')`.
- `src/app/features/calendar/public-calendar.ts` — pure helper module, already exports `isPastCalendarDay` (T2) and `tournamentCardDatePresentation` (T3).
- `src/app/i18n/messages.ts` — two maps, `en` and `fr`; every key must exist in both.
- **From Depends:** T6 created the `event-when-where` row and the `tournament-detail-view.component.test.ts` file; extend that test file.

## TDD

1. **Red** — pure tests for `venueMapsUrl`, component tests for the anchor.
2. **Green** — implement.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `venueMapsUrl encodes the full address` | `{streetAddress:'1 rue de la Ré', postalCode:'69001', city:'Lyon', country:'France'}` | `https://www.google.com/maps/search/?api=1&query=1%20rue%20de%20la%20R%C3%A9%2C%2069001%2C%20Lyon%2C%20France` |
| `venueMapsUrl skips missing parts` | `{city:'Lyon'}` | query is exactly `Lyon` |
| `venueMapsUrl returns null for an empty venue` | `{}` | `null` |
| component `location renders as a maps link` | venue with a city | `[data-cy=tournament-detail-where-link]` has `target="_blank"`, `rel` containing `noopener`, href starting with `https://www.google.com/maps/` |
| component `location stays plain text without an address` | empty venue | `[data-cy=tournament-detail-where-link]` absent, `[data-cy=tournament-detail-where]` present |

## Impl steps

- [x] 1. Add `venueMapsUrl` to `src/app/features/calendar/public-calendar.ts`.
- [x] 2. Add the three pure tests to `src/app/features/calendar/public-calendar.test.ts`; run vitest — red then green.
- [x] 3. Add `calendar.openInMaps` to the `en` and `fr` maps in `src/app/i18n/messages.ts`.
- [x] 4. Add `mapsUrl` computed to `tournament-detail-view.component.ts` and the `@if (mapsUrl(); as url) { … } @else { … }` branch in the when-where row.
- [x] 5. Inline the SVG pin: `<svg class="maps-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`.
- [x] 6. Add the `.maps-icon` CSS to `src/styles.css`.
- [x] 7. Add the two component tests to `tournament-detail-view.component.test.ts`.
- [x] 8. Run `npx vitest run src/app/features/calendar`, `npm run lint`, `npm run typecheck`, `npx vitest run src/app/shared/data-cy-coverage.test.ts`.
- [x] 9. Run `npx vitest run src/app/i18n` (message-parity test) if one exists; otherwise grep both maps for the new key.
- [x] 10. (added — adjacent contract) Update `cypress/e2e/public-calendar.cy.js`: the detail case reads `[data-cy=tournament-detail-where]` for the shared-row geometry, but with a venue present that element is now `[data-cy=tournament-detail-where-link]`. Point the geometry assertion at the link and assert `target`/`rel`/`href`. Criterion: `npx cypress run --spec cypress/e2e/public-calendar.cy.js` green.
- [x] 11. (added — security) Prove URL encoding with a venue containing `&`, spaces and a quote; assert the host stays `https://www.google.com/maps/search/` and the payload is fully percent-encoded. Criterion: the pure test passes in `npx vitest run src/app/features/calendar`.

## Outputs

- Files touched: `src/app/features/calendar/public-calendar.ts`, `public-calendar.test.ts`, `tournament-detail-view.component.ts`, `tournament-detail-view.component.test.ts`, `src/app/i18n/messages.ts`, `src/styles.css`.
- Behaviour change: location is an external link with an icon.

## Evidence

| Box | Evidence |
| --- | --- |
| 1, 2, 11 | `npx vitest run src/app/features/calendar/public-calendar.test.ts` — red first (`TypeError: venueMapsUrl is not a function`, 4 failed), green after impl (43 passed) |
| 3, 9 | `grep -n openInMaps src/app/i18n/messages.ts` → `542: 'calendar.openInMaps': 'Open {address} in Google Maps'` and `1593: 'calendar.openInMaps': 'Ouvrir {address} dans Google Maps'`. No en/fr parity spec exists (`src/app/i18n` holds only `import-label.test.ts`, 1 passed), so the grep is the fallback the step names |
| 4, 5, 6, 7 | `npx vitest run src/app/features/calendar src/app/shared/data-cy-coverage.test.ts src/app/i18n` → 19 files / 220 tests passed, including the two new component tests and the data-cy coverage gate |
| 8 | `npm run lint` → "All files pass linting."; `npm run typecheck` → clean |
| 10 | `npx cypress run --spec cypress/e2e/public-calendar.cy.js` → 12 passing / 0 failing |
| a11y gate | `npx cypress run --spec cypress/e2e/accessibility.cy.js` → 11 passing / 0 failing |
| full suite | `npm run test` → 107 files / 986 tests passed |

## Validation

- [x] `npx vitest run src/app/features/calendar` passes
- [x] `npm run lint && npm run typecheck` pass
- [x] manual check — browser-asserted in `public-calendar.cy.js`: the location anchor carries `href="https://www.google.com/maps/search/?api=1&query=1%20Rue%20Test%2C%2069001%2C%20Lyon%2C%20France"`, `target="_blank"`, `rel="noopener noreferrer"`. The final human click-through to google.com is listed in `ai-artifacts/manual_test_checklist.md`.
- [x] app functional — events without an address still render the location line
- [x] (added) `npm run test` passes
- [x] (added) `npx cypress run --spec cypress/e2e/accessibility.cy.js` stays at 11 passing / 0 failing
- [x] (added) `npx cypress run --spec cypress/e2e/public-calendar.cy.js` passes
- [x] commit msg draft: `feat(calendar): link the event location to Google Maps`

## Repair

`npm run e2e:ci` (release profile, frontend on `http://127.0.0.1:8081`) failed the box-10 assertion that
the same spec passes on the dev server: the `aria-label` rendered `Ouvrir … dans Google Maps` where
the spec expects `Open … in Google Maps`.

- [x] **Diagnosis** — root cause proven, not guessed. Criterion: an instrumented run reports whether
  `onBeforeLoad` ran on each visit. A throwaway `cypress/e2e/tmp-diag.cy.js` counted the invocations
  and read `navigator.serviceWorker.controller` on the release build:

  ```
  [{"label":"a-first","beforeLoadRuns":1,"swAtBeforeLoad":false,"htmlLang":"en","lsLang":"en","swController":false},
   {"label":"b-second","beforeLoadRuns":0,"htmlLang":"fr","lsLang":"fr","swController":true},
   {"label":"c-pre",   "beforeLoadRuns":0,"htmlLang":"fr","lsLang":"fr","swController":true},
   {"label":"c-post",  "beforeLoadRuns":0,"htmlLang":"fr","lsLang":"fr","swController":true}]
  ```

  `onBeforeLoad` fires on the first visit of a spec and never again: `ngsw-worker.js` registers during
  that first boot and from then on answers the navigation from Cache Storage, so the document never
  passes through the Cypress proxy and Cypress cannot inject the script that calls `onBeforeLoad`. The
  language seed is silently skipped and the app boots on its default `fr`
  (`deck-archetype-settings.service.ts:23`, `loadSettingsLanguage()` falling through to `'fr'`). The dev
  server registers no worker — `provideServiceWorker(..., { enabled: environment.production })`,
  `src/main.ts:84` — which is exactly why the spec is green on :4200 and red on :8081. Nothing is
  wrong with the T7 code: the `aria-label` is correct in both catalogs.
- [x] **Fix** — the `visit()` helper seeds pre-boot as before, then waits for the app to persist
  `gones.settings` and, when the language it booted on is not the requested one, writes the seed and
  raises the `storage` event the app already listens for to follow settings changed in another tab
  (`deck-archetype-settings.service.ts:29` → `refreshFromStorage()`); a same-window write never fires
  that event on its own. A closing `documentElement.lang` assertion makes the helper wait for the
  language to have settled. The `aria-label` assertion is kept verbatim as the accessibility evidence.
  The stale comment in the month-navigation test (which described the seed as permanently broken on
  the release build) is re-stated: the ISO `datetime` witness stays, because the claim under test is
  that the grid moved, not that the month label is translated.

  A reload was tried first and rejected: on `public-calendar.cy.js` the second boot re-ran the catalog
  fetch before the read cache had been persisted, so the ADR 0023 request counter flaked —
  `navigates months over the cached catalog without re-querying the API` failed `expected 2, actual 1`
  at `:132` in one gate run and passed in another. The `storage` event issues no navigation and no
  request, so the counters are untouched.

  The gate then surfaced the same defect in two specs this round added — both green on :4200, both red
  on :8081, neither present at the branch point `ff6e9e6` (`git show ff6e9e6:cypress/e2e/organizer-tournament-create.cy.js`
  and `…-management.cy.js` have no breadcrumb case and no `language` argument), so both are this
  round's fallout rather than pre-existing:
  - `organizer-event-create.cy.js:302` — `serves /events/new with a Create Event breadcrumb in both languages`, `-'Créer un événement' +'Create Event'` (second `visit()` of the test kept the first one's `en`).
  - `organizer-event-management.cy.js:130` — `redirects the retired organizer and admin paths onto the canonical Event paths`, `-'Mes événements' +'My Events'` (seed skipped, app booted on the default `fr`).

  Criterion: all three specs green against both origins.
  - `baseUrl=http://127.0.0.1:8081` → `public-calendar` 12/12, `organizer-event-create` 9/9, `organizer-event-management` 4/4, `All specs passed!`
  - `baseUrl=http://127.0.0.1:4200` → same three, 12/12, 9/9, 4/4, `All specs passed!`
- [x] **Green gate** — `npm run e2e:ci` ran to completion with `EXIT=0`, 22 specs / 100 tests, zero
  failures; `Full-stack release smoke passed.` and `Deterministic V1 seed complete.` in the same log.
  `npm run test` 110 files / 1026 tests passed, `npm run lint` “All files pass linting.”,
  `npm run typecheck` clean.
