# T7: Proposal image ownership

**Plan:** `./artifacts/PLAN_2026_08_31_event_editor_images_markdown.md`
**Depends:** T3, T5
**Commit outcome:** Proposal submissions include imgs that remain private/reviewable for 7 days, promote atomically on approval, and delete retry-safely on reject/expiry.

## Context (self-contained)

- C1. Goal: redesign applies to proposal submission, not only direct Organizer publication.
- C2. This slice: proposal uploader enablement, payload persistence, Temporary→ProposalOwned→EventOwned, token-scoped variant reads, reject/expiry cleanup/races.
- C3. Out of scope here: changing approver selection, proposal lifetime, email provider.
- C4. Assumptions: current proposal lifetime 7d (`backend/src/Gones.Domain/Calendar/EventProposal.cs:26,60`); temp lifetime 24h; submitter cannot reuse promoted imgs.

## Requirements

- R1. Enable T3 uploader in proposal editor after backend support exists; proposal request uses exact T5 `EventPayloadRequest` with ordered imgs/alts.
- R2. Proposal submit validates same location/Markdown/img rules; DB tx creates proposal + atomically promotes caller-owned Temporary imgs to ProposalOwned with proposal ID/order/alt/expiry = proposal expiry.
- R3. Submit storage objects already exist; no object move/copy. DB state is ownership authority.
- R4. Review response includes ordered `images`; token-scoped variant route serves only imgs owned by resolved matching pending proposal; headers `Cache-Control: no-store`.
- R5. Approval row-lock tx atomically publishes Event + promotes ProposalOwned imgs to EventOwned. Existing internal publication path remains no-preview-ticket.
- R6. Reject marks proposal then commits; rows/objects delete post-commit through retry-safe cleanup. Expiry sweep does same every 15m. Failed object deletion remains observable/retryable.
- R7. Approve-vs-reject/expire races remain serial under existing proposal row lock; loser publishes/deletes nothing inconsistent.
- R8. Promoted ProposalOwned imgs cannot be deleted/reused by submitter via temp endpoint: exact `409 image_state_conflict`.
- R9. Review token route must not permit image ID enumeration across proposals; unknown/mismatch returns 404.
- R10. Update notification/review tests, OpenAPI/client/Cypress/fixtures now.

## Inputs

- I1. `backend/src/Gones.Api/Events/EventProposalEndpoints.cs:127-250,448-524,609-626` submit/review/approval + DTOs.
- I2. `backend/src/Gones.Domain/Calendar/EventProposal.cs:26-77` proposal lifecycle/expiry.
- I3. `src/app/features/events/event-proposal.service.ts:6-32` proposal client.
- I4. `src/app/features/events/event-request.component.ts` review UI.
- I5. **From Depends:** T3/T5 contracts copied below; do not redesign.
- I6. T3 provides: `EventImage` fields: `Id`, `UploadedByUserId`, `State: Temporary|ProposalOwned|EventOwned`, nullable `EventId`/`ProposalId`/`SortOrder`/`AltText`, source dimensions, `CreatedAt`, `ExpiresAt`. Temp API: `POST /api/event-images` multipart `file` → `201 EventImageUploadResponse`; `DELETE /api/event-images/{id}` → 204 owner Temporary only; `GET /api/event-images/{id}/variants/{width}`. S3 key `event-images/{id}/{width}.webp`. Object deletion runs post-commit with observable retry.
- I7. T5 provides:

```ts
interface EventImageInput { imageId: string; altText: string|null; }
interface EventPayloadRequest {
  organizationId: string; title: string; summary?: string; bodyMarkdown?: string;
  location: { streetAddress: string; postalCode: string; city: string; country: string; region: string; locationToken: string };
  eventType: 'weekly'|'monthly'|'major'; startsAtLocal: string; capacity: number;
  formatIds: [string]; images: EventImageInput[];
}
interface EventImageResponse {
  id: string; altText: string|null;
  variants: Array<{width:number;height:number;url:string}>;
}
```

Direct `POST /api/events` removed preview tickets but preserves internal `PublishEventAsync(EventPayloadRequest, actingUserId, isAdmin, idempotencyKey, cancellationToken, requireMembership)` entry for approval. T5 validates max-five/duplicate/owner/state and atomic attachment. Proposal img controls remain gated until this ticket.

## Interface contract (level 5)

- **Produces:**

```http
POST /api/event-proposals
Authorization: Bearer <verified User>
Body: { "event": EventPayloadRequest, "recipientUserIds": ["uuid"] }
-> 201 EventProposalResponse
```

```ts
interface EventProposalReviewResponse {
  // existing fields
  event: EventPayloadRequest;
  images: EventImageResponse[];
}
```

```http
GET /api/event-requests/{token}/images/{imageId}/variants/{width}
-> 200 image/webp
Cache-Control: no-store
```

```text
Submit: Temporary(user) -> ProposalOwned(proposal), same DB tx as proposal.
Approve: ProposalOwned(proposal) -> EventOwned(event), same DB tx as Event publish + decision.
Reject/expire: decision/expiry commits -> row/object deletion job; retry until complete.
```

- **Consumes:** exact T3/T5 contracts.
- **Errors:** invalid/foreign/expired/duplicate/attached img → `409 image_state_conflict`; missing img/token mismatch → 404; storage read fail → `503 image_storage_unavailable`; existing proposal auth/recipient/conflict errors unchanged.
- **Invariants:** one owner by state; no reuse after submit; review img never public/base-readable; approval Event + imgs + proposal decision atomic; reject/expiry cannot delete EventOwned imgs; object cleanup failure cannot revert decision.
- **Integration links:** proposal editor uploader → submit payload → proposal tx/promote → review token response/img route → row lock approve → internal Event publisher/promote → public Event detail; reject/worker expiry → cleanup queue/S3.

## TDD

1. **Red** — submit/approval/reject/expiry ownership + authz/race/object-failure integration tests; proposal editor/review DOM tests.
2. **Green** — promotion/token route/cleanup/UI.
3. **Refactor** — reuse media transition guards, never generalize arbitrary state transitions.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Submit | 2 caller temps | ProposalOwned, ordered, expiry=proposal expiry; temp delete/reuse 409 |
| Submit rollback | invalid approver | proposal absent; imgs remain Temporary |
| Review read | correct token/id | 200 no-store |
| Cross-proposal read | token A, img B | 404 |
| Approve | pending proposal | Event + EventOwned imgs + Approved atomic |
| Reject | pending | Rejected commits; rows/objects cleanup |
| Expire | now>=7d | no approval; rows/objects cleanup |
| Race | approve vs reject | exactly one terminal decision; no orphan/public leak |
| Storage outage | reject cleanup | decision remains; retry/log until delete |
| UI | plain User proposal | uploader visible; preview faithful; submit blocked pending/failed |

## Impl steps

- [ ] 1. Add failing backend state/race/token-route/cleanup tests.
- [ ] 2. Add failing proposal editor/review DOM tests.
- [ ] 3. Implement submit/approve transitions under existing tx/locks.
- [ ] 4. Implement token-scoped variant read + post-commit reject/expiry cleanup.
- [ ] 5. Enable uploader in proposal UI + review gallery.
- [ ] 6. Regenerate API/client + update proposal Cypress/fixtures.
- [ ] 7. Run gates.

## Validation

- [ ] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventProposal"`
- [ ] `npm run test -- --run src/app/features/events/event-proposal-submit.test.ts src/app/features/events/event-request.component.test.ts`
- [ ] `npm run api:generate && npm run api:check`
- [ ] `npm run cy:run -- --spec cypress/e2e/event-proposal.cy.js`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] manual check: submit imgs as plain User; token review; approve; public gallery
- [ ] no silent-failure swallow on added path — list retry-safe reject/expiry object cleanup sites + logs
- [ ] app functional — proposal img private until approval; reject/expiry leaves no durable media
- [ ] commit msg draft: `feat(events): carry private media through proposal consent`
