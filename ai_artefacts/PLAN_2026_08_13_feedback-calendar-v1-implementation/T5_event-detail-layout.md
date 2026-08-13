# T5: Event Detail Layout + Tournament Links

**Plan:** `./ai_artefacts/PLAN_2026_08_13_feedback-calendar-v1-implementation.md`  
**Depends:** T4  
**Commit outcome:** Event detail shows `Format — Title`, player count, no status/registration block, top-right org/Tournament links, participant-header registration/calendar actions.

## Context (self-contained)

- Goal: simplify `/events/:slug`; put all registration/calendar actions beside Participants.
- This slice: detail UI only. Calendar list Register comes T6.
- Out of scope here: changing registration API; Calendar list cards; Event edit form.
- Assumptions in force: T3 detail DTO carries exactly one format + optional links. Stored title is base title. URL syntax already trusted by backend. Internal links same tab; absolute HTTP(S) new tab.

## Requirements

- Heading renders backend `event.displayTitle` (`{format.name} — {base title}`). No frontend reconstruction/brackets/dup format.
- Add localized player count beside heading: `N player(s)`; capacity null uses existing unlimited semantics.
- Remove Event status row/content.
- Exact label `Organization Website` in EN; full FR equivalent.
- Top-right Event info action row: Live Tournament, Archive Tournament, Organization Website.
- Remove standalone registration section.
- Participants header row: title left; Add to Calendar + login/Register/Cancel registration right.
- Capability/offline/error/reason text remains inside Participants section.

## Inputs

- `src/app/features/calendar/event-detail-view.component.ts`, `.test.ts`.
- `src/app/features/calendar/public-event-detail.component.ts`, `.test.ts`.
- `src/app/features/calendar/event-registration.service.ts`.
- `src/styles.css`; `src/app/i18n/messages.ts`.
- `cypress/e2e/event-registration.cy.js`, `public-calendar.cy.js`.
- **From Depends:** T4 seeds base titles + one format; T3 generated `liveTournamentUrl`, `archiveTournamentUrl` detail fields.

## TDD

1. **Red** — detail view tests assert format-dash-title, player count, no status, exact action order/targets.
2. **Red** — public detail tests assert no `registration-section`; Participants header owns ICS + auth/register/unregister actions.
3. **Green** — reflow templates + CSS + i18n.
4. **Refactor** — one URL-target helper; no duplicate absolute/relative logic.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| title | Modern + AURA Open | `Modern — AURA Open` |
| capacity | 1/32/null | localized player count/unlimited |
| status | Published | absent from detail DOM |
| internal link | `/live-tournaments/x` | same tab |
| external link | `https://x` | `_blank`, noopener noreferrer |
| registration state | anon/eligible/registered | Sign in/Register/Cancel in Participants header |
| ICS | auth enabled/disabled | always in Participants header when URL exists |

## Impl steps

- [x] 1. Update `event-detail-view.component.test.ts` with exact title/count/no-status/top-right link contracts.
- [x] 2. In `event-detail-view.component.ts`, render `event().displayTitle`; remove status; render one heading + count. Do not rebuild display title client-side.
- [x] 3. Add optional `data-cy="event-detail-live-tournament"` + `event-detail-archive-tournament` beside `event-detail-organization-website`.
- [x] 4. Add helper returning external attrs only for absolute HTTP(S); app-relative uses same-tab navigation.
- [x] 5. Update `public-event-detail.component.test.ts`: remove standalone registration section; assert header action ownership/order.
- [x] 6. In `public-event-detail.component.ts`, move ICS + Sign in/Register/Cancel into `.public-participants__header-actions`; keep mutation status/reasons under header.
- [x] 7. Keep Register green (`create-action-button`/existing green class); Cancel registration danger ghost.
- [x] 8. Update `src/styles.css`: top-right info actions; Participants flex row `justify-content:space-between`; wrap narrow screens.
- [x] 9. Update EN/FR i18n: Organization Website capitalization, Live/Archive Tournament, player plural.
- [x] 10. Update Cypress selectors/assertions; preserve success dialog behavior.

## Outputs

- 2 Event detail components + tests changed.
- Shared CSS/i18n changed.
- No API/schema change.

## Validation

- [x] `npx vitest run src/app/features/calendar/event-detail-view.component.test.ts src/app/features/calendar/public-event-detail.component.test.ts` → exit 0.
- [x] `npm run typecheck && npm run build` → exit 0.
- [x] `npx cypress run --spec cypress/e2e/event-registration.cy.js,cypress/e2e/public-calendar.cy.js` → exit 0.
- [x] manual check: detail action rows at desktop + phone width; internal/external links behave.
- [x] app functional — Register/Cancel/ICS still execute.
- [x] commit msg draft: `feat(events): consolidate detail actions around participants`
