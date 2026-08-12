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

- [ ] 1. Add `venueMapsUrl` to `src/app/features/calendar/public-calendar.ts`.
- [ ] 2. Add the three pure tests to `src/app/features/calendar/public-calendar.test.ts`; run vitest — red then green.
- [ ] 3. Add `calendar.openInMaps` to the `en` and `fr` maps in `src/app/i18n/messages.ts`.
- [ ] 4. Add `mapsUrl` computed to `tournament-detail-view.component.ts` and the `@if (mapsUrl(); as url) { … } @else { … }` branch in the when-where row.
- [ ] 5. Inline the SVG pin: `<svg class="maps-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`.
- [ ] 6. Add the `.maps-icon` CSS to `src/styles.css`.
- [ ] 7. Add the two component tests to `tournament-detail-view.component.test.ts`.
- [ ] 8. Run `npx vitest run src/app/features/calendar`, `npm run lint`, `npm run typecheck`, `npx vitest run src/app/shared/data-cy-coverage.test.ts`.
- [ ] 9. Run `npx vitest run src/app/i18n` (message-parity test) if one exists; otherwise grep both maps for the new key.

## Outputs

- Files touched: `src/app/features/calendar/public-calendar.ts`, `public-calendar.test.ts`, `tournament-detail-view.component.ts`, `tournament-detail-view.component.test.ts`, `src/app/i18n/messages.ts`, `src/styles.css`.
- Behaviour change: location is an external link with an icon.

## Validation

- [ ] `npx vitest run src/app/features/calendar` passes
- [ ] `npm run lint && npm run typecheck` pass
- [ ] manual check: click the location on an event page → Google Maps opens in a new tab at that address
- [ ] app functional — events without an address still render the location line
- [ ] commit msg draft: `feat(calendar): link the event location to Google Maps`
