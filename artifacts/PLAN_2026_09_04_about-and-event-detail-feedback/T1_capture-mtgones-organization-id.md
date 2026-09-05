# T1: Defer MTGones Organization Filter

**Plan:** `./artifacts/PLAN_2026_09_04_about-and-event-detail-feedback.md`  
**Depends:** T4  
**Commit outcome:** When resumed later, About Upcoming Events filters exact confirmed MTGones Organization ID without display-name fallback.

## Context (self-contained)

- C1. Goal: eventually make About Upcoming Events show only next 3 Events published under MTGones.
- C2. This slice: deferred follow-up. User explicitly removed it from current implementation critical path.
- C3. Out of scope here: current About redesign, duplicate Next Up rendering, Event detail fix.
- C4. Assumptions in force: until this ticket resumes, About keeps existing all-Organization future Event selection.
- C5. State: `DEFERRED`. Do not execute until user supplies exact MTGones Organization ID and reactivates ticket.

## Requirements

- R1. Obtain exact MTGones Organization ID from user when ticket resumes.
- R2. Verify `GET /api/organizations/{organizationId}` returns same `id` and `name: "MTGones"`.
- R3. Store one exact ID literal; no display-name/config fallback.
- R4. Filter `PublicEventView.organization.id` before existing future/order/cap pipeline.
- R5. Preserve current valid-start rule, `sortEventsForList()` order, cap 3, and input immutability.

## Inputs

- I1. User-owned exact MTGones Organization ID, supplied later.
- I2. `src/app/features/menu/about-upcoming-events.ts` after T4.
- I3. `src/app/features/menu/about-upcoming-events.test.ts` after T4.
- I4. `src/app/features/menu/about.component.ts` after T4.
- I5. **From Depends:** T4 leaves dual Next Up variants using `selectUpcomingEvents(items, now)` with current all-org behavior.

## Interface contract (level 5)

- P1. **Produces:** `export const MTGONES_ORGANIZATION_ID = '<USER_CONFIRMED_ID>' as const;` in `src/app/features/menu/about-organization.ts`.
- P2. **Produces:** `selectUpcomingEvents(items: readonly PublicEventView[], now: Date, organizationId: string): PublicEventView[]`.
- P3. **Filter:** `item.organization?.id === organizationId` plus existing finite parsed `startsAtUtc > now.getTime()`.
- P4. **Order/cap:** `sortEventsForList(filtered).slice(0, 3)`.
- P5. **Consumes:** About passes `MTGONES_ORGANIZATION_ID` as third selector arg.
- P6. **Errors:** missing/unconfirmed ID keeps ticket deferred; no placeholder enters source.
- P7. **Invariants:** exact stable ID only; same display name with different ID is excluded; missing org excluded; one catalog req still feeds both variants.
- P8. **Integration links:** `EventCatalogCacheService.load()` → selector with exact ID → shared Upcoming signal → both variants → observe only matching rows.

## TDD

1. **Red** — add exact/missing/wrong Organization selector tests and component wiring assertion.
2. **Green** — add confirmed constant, selector arg/filter, component call.
3. **Refactor** — none unless duplicate identity values exist.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Authoritative identity | `GET /api/organizations/{confirmedId}` | HTTP 200; exact ID; name `MTGones` |
| Exact org | matching + other-org future Events | matching only |
| Missing org | future Event without org | excluded |
| Same name/wrong ID | future Event | excluded |
| Order/cap | 4 matching future Events | existing stable order; first 3 |
| Shared UI state | matching catalog | both variants show same rows; one load |

## Impl steps

- [ ] 1. User reactivates ticket + supplies exact ID.
  - [ ] 1.1 Verify authoritative API response without retaining auth headers.
  - [ ] 1.2 Confirm exact value with user.
- [ ] 2. Add failing selector/component tests.
  - [ ] 2.1 Cover exact/missing/wrong Organization.
  - [ ] 2.2 Preserve future/order/cap/immutability tests.
- [ ] 3. Add identity constant + filter.
  - [ ] 3.1 Export confirmed literal.
  - [ ] 3.2 Add selector arg + exact comparison.
  - [ ] 3.3 Pass constant from About component.

## Validation

- [ ] V1. authoritative lookup: `curl -fsS http://127.0.0.1:5080/api/organizations/<CONFIRMED_ID>`
- [ ] V2. selector tests pass: `npm test -- --run src/app/features/menu/about-upcoming-events.test.ts`
- [ ] V3. About tests pass: `npm test -- --run src/app/features/menu/about.component.test.ts`
- [ ] V4. typecheck + lint pass: `npm run typecheck && npm run lint`
- [ ] V5. manual check: both variants show same next 3 MTGones Events and no other org
- [ ] V6. no silent-failure swallow on path this slice adds — `none`
- [ ] V7. app functional — sync/error/empty behavior remains intact
- [ ] V8. commit msg draft: `feat(about): bind upcoming events to confirmed MTGones identity`
