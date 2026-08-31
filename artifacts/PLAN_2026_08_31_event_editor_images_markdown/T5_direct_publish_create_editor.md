# T5: Direct publish and create editor

**Plan:** `./artifacts/PLAN_2026_08_31_event_editor_images_markdown.md`
**Depends:** T2, T3, T4
**Commit outcome:** Organizer creates Event through exact wrapped rows, instant actual-layout preview, resolved location, Markdown, ordered imgs, and one direct idempotent Publish command; preview tickets are gone.

## Context (self-contained)

- C1. Goal: remove Preview button/interstitial; render live detail preview; publish directly.
- C2. This slice: exact nested create payload, requiredness/schema cut, preview-ticket deletion, direct create, form rows, split/retract behavior, create attachment transaction.
- C3. Out of scope here: edit semantics (T6); proposal image promotion (T7). Proposal img module stays hidden/disabled until T7 while non-img proposal behavior remains green.
- C4. Assumptions: summary/description/imgs optional; every other listed field required; end = start day 23:59:59; TZ derives token; organization first in title row.

## Requirements

- R1. Delete `POST /api/events/preview`, `EventPreviewTicketService`, consumed-ticket entity/table/DI/tests, preview request/response wrappers, generated client methods, frontend Preview state/interstitial/button.
- R2. `POST /api/events` accepts `EventPayloadRequest` directly + required `Idempotency-Key`; preserve current idempotent replay/mismatch behavior and proposal internal publish entry point.
- R3. Reset schema makes `postal_code`, `region`, `capacity` required; adds Google provider place ID, lat/lon, retains derived `time_zone_id`; fixture updates land now.
- R4. Verify signed location token user/signature/expiry + exact visible-field match; persist coords/TZ/provider place identity; never trust client coords/TZ.
- R5. Atomically attach 0–5 caller-owned unexpired Temporary imgs to EventOwned in supplied order + alt; reject duplicate/foreign/expired/attached IDs.
- R6. Exact rows, each flex-wrap gap 16px: `[organization][title]` (basis 18rem); `[summary]`; `[format][event type][capacity]`; `[country][region][street address][postal code][city]`; `[start date][start time]`; `[Markdown description]`; `[img drag/drop]`. Markdown/img rows full width; other fields basis 12rem.
- R7. UI has separate date/time controls but payload combines `startsAtLocal = YYYY-MM-DDTHH:mm`.
- R8. Live preview updates instantly client-side using T4 configured `marked` + actual `EventDetailViewComponent`; missing required fields use muted draft placeholders; no server correction stage.
- R9. ≥1024px 50/50 editor/preview; preview sticky; collapse hides panel + expands form. `<1024px` preview follows form. `sessionStorage['gones.event-editor.preview-collapsed']` persists tab session.
- R10. Collapse button exact labels EN `Hide preview|Show preview`, corresponding FR keys; `aria-expanded`, `aria-controls`; all template elements `data-cy`.
- R11. Publish disabled if invalid/unresolved/location token expired/upload pending/failed; server field errors map camelCase nested paths.
- R12. Existing approval/proposal non-img submission remains usable; img controls gated with no false claim until T7.
- R13. Update OpenAPI/generated client/Cypress/fixtures in this ticket.

## Inputs

- I1. `src/app/features/events/organizer-event-create.component.ts:61-200,263-294,405-499` current form/preview/publish flow.
- I2. `src/app/features/events/organizer-event-create.ts:3-47` current flat draft/payload.
- I3. `backend/src/Gones.Api/Events/EventPublicationEndpoints.cs:31-45,112-168,527-577` preview/publish contracts.
- I4. `backend/src/Gones.Domain/Calendar/Event.cs:305-318` current optional fields/end/TZ normalization.
- I5. **From Depends:** T2/T3/T4 contracts copied below; do not redesign.
- I6. T2 provides:

```ts
interface EventLocationInput {
  streetAddress: string; postalCode: string; city: string; country: string; region: string; locationToken: string;
}
```

```csharp
public sealed record ValidatedEventLocation(
    string PlaceId, string StreetAddress, string PostalCode, string City, string Country, string Region,
    decimal Latitude, decimal Longitude, string TimeZoneId, Instant ExpiresAt);
public interface IEventLocationTokenService
{
    string Issue(Guid userId, ResolvedEventLocation location, Instant now);
    ValidatedEventLocation Validate(Guid userId, EventLocationInput input, Instant now);
}
```

Errors: `400 location_unresolved|location_token_invalid|location_token_expired`; `503 location_provider_unavailable`.
- I7. T3 provides:

```ts
interface EventImageVariantResponse { width: number; height: number; url: string; }
interface EventImageUploadResponse {
  id: string; state: 'Temporary'; width: number; height: number; expiresAt: string;
  variants: EventImageVariantResponse[];
}
```

`EventImage` exposes `Id`, `UploadedByUserId`, `State`, `EventId`, `ProposalId`, `SortOrder`, `AltText`, `ExpiresAt`. Upload/delete/read routes: `POST /api/event-images`, `DELETE /api/event-images/{id}`, `GET /api/event-images/{id}/variants/{width}`. Uploader exposes ordered successful IDs/alts plus `pending`/`failed` states. T5—not T3—owns `EventImageInput`, max-five Event attachment validation, Temporary→EventOwned promotion.
- I8. T4 provides: authoring DTOs use nullable `bodyMarkdown` max 20,000; persisted source is `Event.BodyMarkdown`; derived render uses `bodyHtml`. `EventDetailViewComponent` accepts explicit draft-placeholder mode. Public detail img shape:

```ts
interface EventImageResponse { id: string; altText: string|null; variants: EventImageVariantResponse[]; }
```

Configured client Markdown output matches backend golden fixtures; raw HTML/img nodes disabled.

## Interface contract (level 5)

- **Produces:**

```ts
interface EventImageInput { imageId: string; altText: string | null; }
interface EventPayloadRequest {
  organizationId: string;
  title: string;
  summary?: string;
  bodyMarkdown?: string;
  location: {
    streetAddress: string;
    postalCode: string;
    city: string;
    country: string;
    region: string;
    locationToken: string;
  };
  eventType: 'weekly' | 'monthly' | 'major';
  startsAtLocal: string; // YYYY-MM-DDTHH:mm
  capacity: number;
  formatIds: [string];
  images: EventImageInput[];
}
interface EventPublishResponse { id: string; slug: string; status: string; }
```

```http
POST /api/events
Authorization: Bearer <Organizer/Admin>
Idempotency-Key: <1..200 chars>
Content-Type: application/json
Body: EventPayloadRequest
-> 201 EventPublishResponse
Location: /api/events/{slug}
ETag: "<version>"
```

- **Consumes:** exact T2/T3/T4 outputs above.
- **Errors:** field errors nested camelCase; `400 location_token_invalid|location_token_expired`; missing img `404`; state conflict `409 image_state_conflict`; idempotency mismatch `409 idempotency_conflict`; draft org `409 organization_is_draft`; storage/provider outage `503`; auth current 401/403/404 policy.
- **Invariants:** no `/preview` route/ticket table/client method; one Publish click → one Event POST; T5 owns `EventImageInput` + max-five/duplicate/owner/state validation + atomic Temporary→EventOwned attachment; Event row + img ownership/order commit together; URLs omitted on create; end derived; exactly one format; required nonnullable fields; no Publish while client knows state invalid.
- **Integration links:** form controls → local draft adapter/marked → actual detail component; Publish → `POST /api/events` → token validation + Event domain + img promotion → Event row/images → navigate `/events/{slug}`.

## TDD

1. **Red** — direct API contract/deletion/idempotency/attachment tests + exact DOM/layout/live-preview/session/a11y tests.
2. **Green** — direct command + editor shell.
3. **Refactor** — remove only orphaned preview code/imports; no adjacent Event refactor.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Route removal | POST `/api/events/preview` | 404 |
| Direct publish | valid nested payload + temp imgs | 201; one Event; ordered EventOwned imgs |
| Invalid location | expired/mismatch | exact 400 code/field; no Event/img promotion |
| Img conflict | foreign/duplicate | 409; no Event; temp ownership unchanged |
| Requiredness | missing capacity/postal/region | nested field errors |
| Live preview | type Markdown/title | instant actual component update; no HTTP |
| Layout | 1023/1024 px | below-flow vs 50/50 sticky split |
| Collapse | click/reload tab | ARIA/label correct; session key restores |
| Publish block | failed upload | disabled + inline reason |
| Proposal interim | plain User | existing non-img proposal path green; img controls absent/gated |

## Impl steps

- [ ] 1. Add failing backend direct-publication/schema/attachment tests.
- [ ] 2. Add failing Angular exact-row/live-preview/responsive/session/a11y tests.
- [ ] 3. Remove preview subsystem + make direct endpoint preserve internal proposal publisher.
- [ ] 4. Implement reset schema/location persistence/img attachment + fixture updates.
- [ ] 5. Implement exact create form rows, local preview, split/collapse, publish mapping.
- [ ] 6. Regenerate OpenAPI/client + update Cypress create flow.
- [ ] 7. Run gates.

## Validation

- [ ] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventPublication|FullyQualifiedName~EventProposal|FullyQualifiedName~EventProposalDecision"`
- [ ] `npm run test -- --run src/app/features/events/organizer-event-create.test.ts src/app/features/events/organizer-event-create.component.test.ts`
- [ ] `npm run api:generate && npm run api:check`
- [ ] `npm run test -- --run src/app/features/events/event-proposal-submit.test.ts`
- [ ] `npm run cy:run -- --spec cypress/e2e/organizer-event-create.cy.js,cypress/e2e/event-proposal.cy.js`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] manual check: 1023/1024px, collapse restore, Markdown preview, 5 imgs reorder, failed-upload block
- [ ] no silent-failure swallow on added path — `none`
- [ ] app functional — direct create navigates to faithful public Event; proposal non-img path remains green
- [ ] commit msg draft: `feat(events): publish directly from faithful responsive editor`
