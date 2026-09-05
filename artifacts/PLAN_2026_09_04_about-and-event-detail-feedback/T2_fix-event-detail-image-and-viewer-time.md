# T2: Fix Event Detail Image and Viewer Time

**Plan:** `./artifacts/PLAN_2026_09_04_about-and-event-detail-feedback.md`  
**Depends:** none  
**Commit outcome:** Public Event detail and Event create/edit preview load API-relative media from configured API origin; viewer-time row is absent.

## Context (self-contained)

- C1. Goal: fix manually observed Event img failure and remove `event-detail-fact-date-viewer` line.
- C2. This slice: normalize native `<img>` URLs inside shared `EventDetailViewComponent`; remove one conditional viewer-time paragraph.
- C3. Out of scope here: backend media wire/storage redesign, reverse proxy, CSP expansion, Event date semantics, other Event UI.
- C4. Assumptions in force: source-proven dev failure path is root-relative image URL resolving at SPA `127.0.0.1:4200` while API is `127.0.0.1:5080`; runtime diagnosis must verify status before code change.

## Requirements

- R1. Capture failing browser/request evidence before repair: resolved img URL + HTTP status.
- R2. Resolve only root-relative `/api/**` image URLs against `dataAuthority().apiBaseUrl`.
- R3. Preserve empty, `blob:`, `data:`, absolute `http://`, and absolute `https://` URLs unchanged.
- R4. Apply resolution to largest fallback `src` and every variant in `srcset`, for hero + lightbox.
- R5. Preserve variant width descriptors and existing largest-width selection.
- R6. Remove entire conditional `<p data-cy="event-detail-fact-date-viewer">…</p>` row.
- R7. Preserve `eventDatePresentation()` use where still needed by other Event views; remove only imports/computed state orphaned by R6.
- R8. Preserve ADR 0052/0056 private-object/API-streaming behavior.

## Inputs

- I1. `src/app/features/events/event-detail-view.component.ts` — `imageSource`, `imageSourceSet`, shared public/preview template.
- I2. `src/app/api/api-boundary.ts` — `joinApiUrl(baseUrl, path)`.
- I3. `src/app/config/data-authority.ts` — `dataAuthority().apiBaseUrl`.
- I4. `backend/src/Gones.Api/Events/PublicEventEndpoints.cs` — relative Event image variant URLs.
- I5. `src/app/features/events/event-detail-view.component.test.ts` — existing URL/viewer-time assertions.
- I6. `cypress/e2e/event-proposal.cy.js` and `cypress/e2e/organizer-event-create.cy.js` — browser media flows.
- I7. **From Depends:** none.

## Interface contract (level 5)

- P1. **Produces:** `export function resolveApiAssetUrl(url: string, apiBaseUrl: string): string` in `src/app/features/events/event-detail-view.component.ts`.
- P2. **Consumes:** `url` from `EventDetailImage.variants[number].url`; `apiBaseUrl` from `dataAuthority().apiBaseUrl`.
- P3. **Transform:** `url.startsWith('/api/')` → `joinApiUrl(apiBaseUrl, url)`; all other values → unchanged.
- P4. **Produces:** `imageSource(image)` returns resolved largest variant URL or `''`.
- P5. **Produces:** `imageSourceSet(image)` returns resolved `${url} ${width}w` entries joined by `, ` in input order.
- P6. **Errors:** helper throws no custom error; malformed non-`/api/` value remains unchanged so browser exposes native load failure.
- P7. **Invariants:** no auth token in URL; no object-store URL; no variant reorder; `blob:` preview remains valid; hero/lightbox share same resolver.
- P8. **Integration links:** API detail `GET /api/events/{slug}` → `image.variants[].url` → `EventDetailViewComponent` resolver → browser `GET {apiBaseUrl}/api/event-images/{imageId}/variants/{width}` → observe `200`, `Content-Type: image/webp`, `naturalWidth > 0`.

## TDD

1. **Red** — update focused unit/browser tests to expect API-origin URLs, preserved preview URLs, and absent viewer-time row; verify failure.
2. **Green** — add resolver, wire `src`/`srcset`, remove viewer row with min code.
3. **Refactor** — reuse existing `joinApiUrl`; remove only newly orphaned date-view code while green.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| API-relative URL | `/api/event-images/i/variants/320`, `http://127.0.0.1:5080` | `http://127.0.0.1:5080/api/event-images/i/variants/320` |
| Base slash normalization | same path, base ending `/` | one slash at join |
| Preview URL | `blob:https://app.test/id` | unchanged |
| Embedded URL | `data:image/webp;base64,x` | unchanged |
| Absolute URL | `https://cdn.test/i.webp` | unchanged |
| Source set | 320/640 relative variants | both resolved; widths/order retained |
| Viewer-time row | Event viewed outside venue timezone | no `[data-cy="event-detail-fact-date-viewer"]` |
| Browser img | real API variant | visible img; `naturalWidth > 0`; no `error` event |

## Impl steps

- [ ] 1. Reproduce failure against dev stack.
  - [ ] 1.1 Capture detail payload `image.variants[].url`.
  - [ ] 1.2 Compare SPA-origin + API-origin image request statuses.
- [ ] 2. Write failing unit tests.
  - [ ] 2.1 Cover resolver matrix from Test plan.
  - [ ] 2.2 Update hero/lightbox `src` + `srcset` assertions.
  - [ ] 2.3 Replace viewer-time-presence assertion with absence assertion.
- [ ] 3. Implement min frontend fix.
  - [ ] 3.1 Import `dataAuthority` + `joinApiUrl`.
  - [ ] 3.2 Resolve `imageSource()` and `imageSourceSet()` outputs.
  - [ ] 3.3 Remove viewer-time paragraph + only orphaned code.
- [ ] 4. Add/adjust browser regression.
  - [ ] 4.1 Assert API-origin request is reached.
  - [ ] 4.2 Assert rendered img has non-zero `naturalWidth`.

## Validation

- [ ] V1. focused unit tests pass: `npm test -- --run src/app/features/events/event-detail-view.component.test.ts`
- [ ] V2. Event image contract passes: `npm test -- --run src/app/api/event-image-contract.test.ts`
- [ ] V3. backend media contract remains green: `dotnet test backend/Gones.sln --filter FullyQualifiedName~EventImageApiTests`
- [ ] V4. full Cypress wrapper passes, including `cypress/e2e/event-proposal.cy.js`: `npm run cy:run`
- [ ] V5. typecheck + lint pass: `npm run typecheck && npm run lint`
- [ ] V6. manual check: open image-bearing `/events/:slug`; hero + lightbox load; viewer-time row absent
- [ ] V7. no silent-failure swallow on path this slice adds — `none`
- [ ] V8. app functional — public detail + create/edit `blob:` preview remain usable
- [ ] V9. commit msg draft: `fix(events): resolve streamed media against API origin`
