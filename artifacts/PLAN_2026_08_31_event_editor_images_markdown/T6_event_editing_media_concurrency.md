# T6: Event editing with media concurrency

**Plan:** `./artifacts/PLAN_2026_08_31_event_editor_images_markdown.md`
**Depends:** T3, T5
**Commit outcome:** Edit uses same nested resolved-location/Markdown/media editor while ETag protects reorder/removal and hidden legacy URL values survive.

## Context (self-contained)

- C1. Goal: redesign applies to edit too; hidden fields must not clear data.
- C2. This slice: nested PATCH, canonical draft loading, ETag media concurrency, safe detach/delete, stale reload, hidden URL preservation.
- C3. Out of scope here: proposal image ownership; new public detail design.
- C4. Assumptions: Live/Archive URL controls removed but columns remain; end control removed + end derives start-day 23:59:59 on each accepted edit.

## Requirements

- R1. `PATCH /api/organizer/events/{eventId}/details` consumes same nested location/Markdown/img shape as T5 under required `If-Match`.
- R2. Management response includes nested location with fresh editor-usable resolution token or a server-issued equivalent trusted token, Markdown source, ordered imgs, ETag. Loading an existing Event must not call Google merely to become editable.
- R3. Hidden `liveTournamentUrl`/`archiveTournamentUrl` are absent from update request; service preserves stored values exactly.
- R4. Every edit applies end = edited start date 23:59:59, derives TZ/coords from validated token.
- R5. Existing EventOwned imgs for same Event + caller-owned Temporary imgs are valid. Any other state/owner/Event → `409 image_state_conflict`.
- R6. ETag covers Event fields + img order/alt membership. Stale reorder/removal/new attachment returns 412, changes nothing, deletes no objects.
- R7. Successful tx promotes new imgs, updates order/alt, removes omitted imgs. Only after DB commit enqueue/delete removed variant objects. Failure is logged/retried; no empty catch/fire-and-forget.
- R8. Stale reload replaces canonical Event + imgs/location/Markdown and preserves local draft until user chooses existing Reload Latest behavior.
- R9. Major-change confirmation still triggers for location/start/type/capacity/format changes; Markdown/summary/img alt/order are minor; img membership change is minor unless product rule already classifies otherwise—pin chosen rule in domain tests as minor.
- R10. Update generated client/tests/fixtures in this ticket.

## Inputs

- I1. `backend/src/Gones.Api/Events/EventLifecycleEndpoints.cs:32-39,642-709` current PATCH/DTO.
- I2. `src/app/features/events/organizer-event-create.component.ts:500-566` current edit/ETag/stale flow.
- I3. `src/app/features/events/event-management.ts` current draft/update/change classification.
- I4. `backend/src/Gones.Domain/Calendar/Event.cs:175-213,305-318` change severity + update normalization.
- I5. **From Depends:** T3/T5 contracts copied below; do not redesign.
- I6. T3 provides: `EventImage` state row fields are `Id`, `UploadedByUserId`, `State`, `EventId`, `ProposalId`, `SortOrder`, `AltText`, `ExpiresAt`; S3 keys are `event-images/{id}/{width}.webp`; generated widths are variant rows/metadata ordered ascending. Base read route is `GET /api/event-images/{id}/variants/{width}`. Object removal must occur after DB commit; failure is logged and retried by shared media cleanup, never swallowed.
- I7. T5 provides:

```ts
interface EventImageInput { imageId: string; altText: string|null; }
interface EventPayloadRequest {
  organizationId: string; title: string; summary?: string; bodyMarkdown?: string;
  location: { streetAddress: string; postalCode: string; city: string; country: string; region: string; locationToken: string };
  eventType: 'weekly'|'monthly'|'major'; startsAtLocal: string; capacity: number;
  formatIds: [string]; images: EventImageInput[];
}
```

`POST /api/events` already validates signed location claims, max-five/duplicate/owner/state imgs, then atomically promotes Temporary→EventOwned. Errors: location 400 codes; img missing 404/state 409; stale edit remains 412. Persisted source is `bodyMarkdown`; rendered response is `bodyHtml`.

## Interface contract (level 5)

- **Produces:**

```http
PATCH /api/organizer/events/{eventId}/details
Authorization: Bearer <Organizer/Admin>
If-Match: "<strong ETag>"
Content-Type: application/json
Body: UpdateEventDetailsRequest
-> 200 EventManagementResponse
ETag: "<new version>"
```

```ts
interface UpdateEventDetailsRequest {
  title: string;
  summary?: string;
  bodyMarkdown?: string;
  location: EventLocationInput;
  eventType: 'weekly'|'monthly'|'major';
  startsAtLocal: string;
  capacity: number;
  formatIds: [string];
  images: Array<{ imageId: string; altText: string|null }>;
}
interface EventManagementResponse {
  // existing id/org/status/version fields
  title: string;
  summary?: string;
  bodyMarkdown?: string;
  location: EventLocationInput;
  startsAtLocal: string;
  capacity: number;
  formatIds: [string];
  images: EventImageResponse[];
  eTag: string;
}
```

- **Consumes:** T5 payload/domain; T3 object store/deletion mechanism.
- **Errors:** missing/bad `If-Match` existing boundary behavior; stale `412`; missing img `404`; wrong state/owner/Event `409 image_state_conflict`; token errors exact 400; storage cleanup failure does not roll back committed edit but is logged/retried.
- **Invariants:** hidden URLs byte-for-byte preserved; DB tx precedes object delete; stale req is no-op across DB/S3; order contiguous 0..n-1; max 5; location token trusted without Google call; reload canonical response fully reconstructs editor.
- **Integration links:** organizer list management response → draft adapter → editor → PATCH + If-Match → Event+img tx → response/ETag → post-commit object deletion queue.

## TDD

1. **Red** — nested DTO/URL preservation/change severity/ETag reorder-removal/post-commit failure + Angular stale-reload tests.
2. **Green** — update endpoint/domain/draft adapter.
3. **Refactor** — reuse create/edit payload mapper only if identical contract stays obvious.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Hidden URLs | Event has both URLs; edit other fields | URLs unchanged |
| Fresh reorder | valid ETag, same imgs reordered | 200; contiguous order; new ETag |
| Stale removal | stale ETag omits img | 412; row/object retained |
| Successful removal | fresh ETag omits img | DB detach/delete committed; objects removed after commit |
| Object delete outage | committed removal + S3 fail | 200 remains; retry/log exists |
| Add temp | same caller temp | promoted+ordered atomically |
| Foreign attached | another Event img | 409; no mutation |
| Reload latest | conflict | local draft warning then explicit canonical reload |
| Severity | Markdown/img order/location | minor/minor/major as R9 |

## Impl steps

- [x] 1. Add failing backend concurrency/domain/API tests. Verify: targeted backend test command fails on new T6 assertions before production changes.
- [x] 2. Add failing Angular draft/stale/edit tests. Verify: targeted Angular test command fails on new T6 assertions before production changes.
- [x] 3. Implement nested management DTO/read model + trusted token issuance. Verify: targeted backend API tests pass for nested location/Markdown/img response without Google calls.
- [x] 4. Implement tx media diff + post-commit retry-safe deletes + URL preservation. Verify: targeted backend concurrency/domain/API tests pass for reorder, stale no-op, attachment, removal, retry/log, severity, hidden URLs.
- [x] 5. Wire editor save/reload/field errors; remove orphan legacy controls/mappers. Verify: targeted Angular draft/stale/edit tests pass with shared media editor, canonical reload, nested payload, hidden URL omission.
- [x] 6. Regenerate API/client + update management Cypress spec. Verify: `npm run api:generate && npm run api:check` passes; Cypress spec contains edit-media coverage.
- [x] 7. Run gates. Verify: every command/check under Validation has recorded passing evidence or explicit manual limitation.

## Validation

- [x] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventLifecycle|FullyQualifiedName~EventImage"`
- [x] `npm run test -- --run src/app/features/events/event-management.test.ts src/app/features/events/organizer-event-create.component.test.ts`
- [x] `npm run api:generate && npm run api:check`
- [x] `npm run cy:run -- --spec cypress/e2e/organizer-event-management.cy.js`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] manual check: stale two-tab reorder/removal; hidden URL remains on public detail
- [x] no silent-failure swallow on added path — list durable post-commit object-delete retry + log site
- [x] app functional — create/edit share editor; stale changes cannot delete media
- [x] commit msg draft: `feat(events): protect media edits with Event concurrency boundary`
