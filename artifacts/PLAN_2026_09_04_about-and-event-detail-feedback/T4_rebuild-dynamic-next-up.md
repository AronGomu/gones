# T4: Rebuild Dynamic Next Up

**Plan:** `./artifacts/PLAN_2026_09_04_about-and-event-detail-feedback.md`  
**Depends:** T3  
**Commit outcome:** About renders borderless + bordered live Upcoming Events variants, each showing current all-org next 3 Events with sync, promo image, and stable Calendar CTA.

## Context (self-contained)

- C1. Goal: compare two temporary Next Up treatments while keeping content live, cached, and capped at 3.
- C2. This slice: two variant renderings, shared state, title/sync row, promo img, CTA.
- C3. Out of scope here: MTGones Organization filtering (deferred T1), deleting either variant, changing catalog TTL, adding About-specific endpoint, changing Event order.
- C4. Assumptions in force: duplicate interactive content is intentional; both variants share one `EventCatalogCacheService` load and same signals; current all-Organization selection remains until deferred T1.

## Requirements

- R1. Preserve current all-Organization selection until deferred T1 resumes.
- R2. Preserve current valid-start rule: parsed start finite + strictly greater than `now`.
- R3. Preserve `sortEventsForList()` ordering and cap at 3; do not mutate input.
- R4. Render variants in order: borderless then bordered.
- R5. Use one loop/template source so states cannot drift; variant IDs must make every heading/`data-cy` unique.
- R6. Both variants show `Upcoming Events` title and `gones-sync-bar` on same row; remove `Next Up` kicker.
- R7. Both variants show promo img directly below heading: `assets/images/2025-01-damnation-fest-pisa-mtgones-bougnat-01.jpeg`, dimensions `2048x1366`. T5 moves it into `in-use/`.
- R8. Both variants show same loading/error/empty/top-3 data state.
- R9. Both variants expose functional sync/retry controls that call same force-load path; stale-request race guard remains.
- R10. After dynamic list, both variants show `Find all Events` CTA to `/events`. Existing error/empty recovery links remain.
- R11. Borderless variant has no outer section border; bordered variant retains current outer border. Event row `.panel` borders remain in both.

## Inputs

- I1. `src/app/features/menu/about-upcoming-events.ts` — current selector.
- I2. `src/app/features/menu/about-upcoming-events.test.ts` — current future/order/cap tests.
- I3. `src/app/features/menu/about.component.ts` — catalog state/load/race guard + Next Up DOM.
- I4. `src/app/features/menu/about.component.test.ts` — cache/state/DOM/reveal tests.
- I5. `src/styles.css` — Next Up section/list/header styles.
- I6. `src/app/i18n/messages.ts` — `about.nextUp.*` catalogs.
- I7. **From Depends:** T3 leaves About chrome outside route component and hero as first route section.
- I8. **Deferred follow-up:** T1 later adds exact MTGones Organization filtering without blocking this ticket.

## Interface contract (level 5)

- P1. **Consumes:** existing `selectUpcomingEvents(items: readonly PublicEventView[], now: Date): PublicEventView[]` unchanged.
- P2. **Filter:** finite parsed `startsAtUtc > now.getTime()` across all Organizations.
- P3. **Order/cap:** `sortEventsForList(filtered).slice(0, 3)`.
- P4. **Produces:** `readonly nextUpVariants = [{ id: 'borderless', bordered: false }, { id: 'bordered', bordered: true }] as const`.
- P5. **Variant DOM:** section `data-cy="about-next-up-{id}"`; heading ID `about-next-up-{id}-title`; sync prefix `about-next-up-{id}`; promo `data-cy="about-next-up-{id}-image"` using current flat asset path; list/state/row/control IDs include variant ID.
- P6. **CTA:** `<a routerLink="/events" ...>Find all Events</a>` from new `about.nextUp.findAllEvents` key in both locale maps.
- P7. **Errors:** catalog failure logs existing `about.load-upcoming-events`, clears data, sets error state; retry forces reload. No new swallowed error.
- P8. **Invariants:** one catalog req per initial load, regardless of 2 variants; either sync control may trigger one forced req; latest req wins; both variants render same snapshot.
- P9. **Integration links:** `AboutComponent.ngOnInit` → `EventCatalogCacheService.load()` → existing `selectUpcomingEvents(items, now)` → shared signal → both variant loops → observe 0-3 rows + synced-at UI.

## TDD

1. **Red** — extend component tests for dual unique variants, shared loading/sync, promo, CTA, and border classes.
2. **Green** — add shared variant loop/min CSS/messages; leave selector unchanged.
3. **Refactor** — remove obsolete Next Up kicker key only if no remaining ref; retain simple variant data constant.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| All Organizations | future Events from several Organizations | all remain eligible |
| Future rule | equal/past/invalid/future start | future only |
| Order/cap | 4 matching future Events | existing stable order; first 3 |
| Immutability | frozen input | no mutation |
| Initial load | both variants mounted | catalog `load()` called once |
| Variant DOM | loaded state | borderless then bordered; unique IDs; same 3 rows |
| Sync | click either sync btn | `load({ force: true })`; both update |
| Promo/CTA | loaded state | img below heading; CTA after list → `/events` |
| Error/empty | failure/no matches | both state panels; recovery controls work |

## Impl steps

- [ ] 1. Preserve selector tests.
  - [ ] 1.1 Keep current all-Organization behavior.
  - [ ] 1.2 Keep future/order/cap/immutability checks.
- [ ] 2. Extend component tests red.
  - [ ] 2.1 Require 2 variants + unique IDs/order.
  - [ ] 2.2 Require shared state, independent controls, one initial load.
  - [ ] 2.3 Require title/sync row, current flat promo path/dims, CTA position/route.
- [ ] 3. Render shared variant loop.
  - [ ] 3.1 Add `nextUpVariants` readonly tuple.
  - [ ] 3.2 Parameterize every ID/`data-cy`/`cyPrefix`.
  - [ ] 3.3 Add border modifier, promo img, CTA.
- [ ] 4. Update styles/messages.
  - [ ] 4.1 Align title + sync in one responsive row.
  - [ ] 4.2 Remove border only for borderless modifier.
  - [ ] 4.3 Add `Find all Events` in `en` + `fr` as same English string.

## Validation

- [ ] V1. selector tests pass: `npm test -- --run src/app/features/menu/about-upcoming-events.test.ts`
- [ ] V2. About component tests pass: `npm test -- --run src/app/features/menu/about.component.test.ts`
- [ ] V3. cache contract remains green: `npm test -- --run src/app/features/events/event-catalog-cache.service.test.ts`
- [ ] V4. typecheck + lint pass: `npm run typecheck && npm run lint`
- [ ] V5. manual desktop/narrow check: both variants show same current all-org top 3 Events; either sync updates both
- [ ] V6. manual state check: loading/error/empty render twice without duplicate DOM IDs
- [ ] V7. no silent-failure swallow on path this slice adds — existing `try/catch` retained because it logs `about.load-upcoming-events` and exposes error/retry UI
- [ ] V8. app functional — `/events` CTA/recovery links and Event row links navigate
- [ ] V9. commit msg draft: `feat(about): compare live upcoming Event treatments`
