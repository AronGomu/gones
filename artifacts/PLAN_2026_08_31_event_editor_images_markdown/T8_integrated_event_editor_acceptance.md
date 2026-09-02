# T8: Integrated Event editor acceptance

**Plan:** `./artifacts/PLAN_2026_08_31_event_editor_images_markdown.md`
**Depends:** T6, T7
**Commit outcome:** Cross-ticket Event editor journeys, reset fixtures, acceptance matrix, runtime rehearsal, and full gates prove create/edit/proposal/detail behavior without deferring unit TDD from earlier tickets.

## Context (self-contained)

- C1. Goal: executable evidence that all slices compose.
- C2. This slice: integration-only red tests, complete browser journeys, acceptance-matrix mapping, reset/reseed proof, provider outage/media cleanup observability, full gates.
- C3. Out of scope here: feature impl, schema/API fixes that belong predecessor tickets, new UX.
- C4. Assumptions: every predecessor landed own unit/integration tests, migration/fixture/OpenAPI/client updates; this ticket detects composition gaps only.

## Requirements

- R1. Add end-to-end Organizer create journey: Google fake resolution, optional summary/Markdown, 5 imgs/reorder/alt, 1024 split/collapse, direct Publish, faithful public detail.
- R2. Add end-to-end edit journey: hidden URLs preserved, resolved location update, Markdown/img reorder/remove/add, stale ETag no-op, post-commit delete eventually observed.
- R3. Add end-to-end proposal journey: plain verified User temp uploads, submission, token review, approval, public imgs; separate reject/expiry cleanup proof.
- R4. Add negative journeys: missing Google key `503` only on location endpoints; MinIO/S3 outage upload `503`; invalid MIME/size/pixels/animation statuses; cross-user/cross-proposal media denied.
- R5. Update `ops/acceptance-matrix.json` Event publication capability with executable test targets; no capability points only at docs.
- R6. Prove reset-required path from clean volumes: migration, fixture seed, API startup, Event browse/create/edit/proposal.
- R7. Prove generated client clean: `api:generate` creates no diff after `api:check`.
- R8. Run full frontend/backend/Cypress/acceptance gates. Do not hide unrelated/pre-existing failures; report exact output.
- R9. Update durable docs/glossary/context only for new shared words: Event Image, resolved Event location, Markdown description. Keep AGENT newest ADR list current.

## Inputs

- I1. `ops/acceptance-matrix.json:87-105` current Event publication capability.
- I2. `cypress/e2e/organizer-event-create.cy.js`, `organizer-event-management.cy.js`, `event-proposal.cy.js`.
- I3. `fixtures/dev-environments/`, `scripts/reset-local-stack.mjs`, seed scripts.
- I4. **From Depends:** T6/T7 contracts copied below; do not redesign.
- I5. T6 provides: `PATCH /api/organizer/events/{eventId}/details` consumes nested `location` + ordered `images: [{imageId,altText}]` under required `If-Match`; success 200 + new ETag; stale 412 mutates neither DB nor S3; omitted Live/Archive URLs remain byte-for-byte; removed img objects delete only post-commit through observable retry.
- I6. T7 provides: `POST /api/event-proposals` consumes same `EventPayloadRequest`; submit Temporary→ProposalOwned; approval ProposalOwned→EventOwned atomically with Event; reject/expiry post-commit cleanup. `GET /api/event-requests/{token}/images/{imageId}/variants/{width}` → 200 `image/webp`, `Cache-Control: no-store`; cross-proposal/missing→404.
- I7. Transitive exact routes: `GET /api/event-locations/autocomplete`, `POST /api/event-locations/resolve`, `POST/DELETE /api/event-images`, `GET /api/event-images/{id}/variants/{width}`, direct `POST /api/events`; `/api/events/preview`→404. Exact feature errors: `413 image_too_large`; `415 image_type_unsupported`; `400 image_invalid|image_too_many_pixels|image_animated|location_unresolved|location_token_invalid|location_token_expired`; `503 image_storage_unavailable|location_provider_unavailable`; `409 image_state_conflict|idempotency_conflict`; missing img 404; stale edit 412.

## Interface contract (level 5)

- **Produces:** acceptance evidence only; no new runtime interface.

```text
acceptance capability: product-event-lifecycle (existing ID if present; do not rename)
required targets:
- backend/tests/Gones.IntegrationTests/EventPublicationApiTests.cs
- backend/tests/Gones.IntegrationTests/EventLifecycleApiTests.cs
- backend/tests/Gones.IntegrationTests/EventProposalTests.cs
- backend/tests/Gones.IntegrationTests/EventProposalDecisionTests.cs
- cypress/e2e/organizer-event-create.cy.js
- cypress/e2e/organizer-event-management.cy.js
- cypress/e2e/event-proposal.cy.js
```

- **Consumes:** all predecessor runtime contracts unchanged.
- **Errors:** assert exact route/status/code matrix copied in I4-I6; nested field keys include `images[0].altText` + `location.locationToken`; test harness failure quotes exact cmd output.
- **Invariants:** clean reset reproducible; no external Google/S3 req in tests; public catalog remains image-free; Event detail faithful; no temp/proposal orphan after cleanup; no preview route.
- **Integration links:** Cypress UI → generated client → API → Postgres/MinIO/fakes → public detail; acceptance matrix → executable tests; reset script → migration/fixtures → app readiness.

## TDD

1. **Red** — add cross-ticket Cypress/rehearsal/acceptance rows that fail on one observable composition gap.
2. **Green** — fix only test harness/fixture/composition wiring owned here; runtime defect routes back to owning ticket, not patched speculatively.
3. **Refactor** — dedupe test helpers after all journeys green.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Create journey | valid Google fake + 5 imgs | direct publish; exact order/alt/Markdown/detail |
| Optional content | no summary/body/img | valid Event |
| Required fields | missing postal/region/capacity | blocked client + exact server fields |
| Edit stale media | two sessions | stale 412; no DB/S3 loss |
| Proposal approval | temp imgs + token | private review then public EventOwned |
| Reject/expiry | pending proposal | eventual rows/objects absent |
| Provider outage | no Google / stopped MinIO | exact isolated 503 behavior |
| Reset | clean volumes | migrate+seed+serve passes |
| Catalog budget | Event with imgs | list/all responses contain no imgs |
| Accessibility | axe + keyboard flows | no violations in editor/lightbox/reorder |

## Impl steps

- [x] 1. Add failing integrated browser/API/rehearsal cases. — verify: scoped Cypress/API/rehearsal targets expose at least one pre-fix composition failure, then pass.
- [x] 2. Update acceptance matrix + fixture/reset harness only. — verify: `npm run acceptance:matrix` passes after clean `npm run db:reset`.
- [x] 3. Update durable vocabulary/docs + AGENT ADR list. — verify: `docs/GLOSSARY.md`, `docs/CONTEXT.md`, and `AGENT.md` contain required T8 vocabulary/ADR references or inspection proves no update needed.
- [x] 4. Run scoped journeys, then full gates. — verify: every command and manual check under Validation records passing evidence.
- [x] 5. Record exact failures; repair until green; stop only on a hard blocker. — verify: ticket report records `none` after all gates pass.

## Final review repair

- [x] 6. Run clean-volume real Event media lifecycle through API, PostgreSQL, and MinIO. — verify: `npm run release:rehearsal` uploads fixture bytes, directly creates then edits an Event, submits then token-approves a User proposal, and reads public variants with exact cache/ETag/order/alt assertions.
- [x] 7. Cover editor and gallery browser acceptance gaps. — verify: scoped Cypress proves axe on editor/uploader/reorder controls and open lightbox, 375px axe/overflow, one failed image does not break remaining gallery, and no-summary/no-body/no-image publication succeeds.
- [x] 8. Emit deterministic Event-owned variant ETags. — verify: `EventImageApiTests.Temporary_variant_is_owner_only_no_store_while_EventOwned_is_anonymous_immutable` proves stable ETag on repeated public reads.
- [ ] 9. Harden release evidence. — verify: release journey checks publication `Location` origin plus path; `npm run images:build && npm run images:verify` proves every image revision label equals current `HEAD`; stale-revision unit test passes.
- [x] 10. Bind T8 matrix evidence to exact executable assertions. — verify: `npm run acceptance:matrix` plus `ops/acceptance-matrix.test.ts` prove each integrated Event target names an assertion present in target source.
- [ ] 11. Run final gates and commit exact paths without push/merge. — verify: every command under Validation passes on final source; `git diff --check` passes; commit exists on `ticket/event-editor-T8`.

## Validation

- [x] `npm run db:reset`
- [x] `npm run api:check`
- [x] `npm run test`
- [x] `npm run backend:test`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run cy:run`
- [x] `npm run acceptance:matrix`
- [x] `npm run e2e:ci`
- [ ] `npm run images:build`
- [ ] `npm run images:verify`
- [x] `npm run build`
- [x] `npm run api:generate` leaves generated API paths unchanged
- [x] `npm run release:rehearsal`
- [x] residue/secrets: `git diff --check`; no `.orig`/`.rej`/backup residue; added-line high-confidence secret scan clean
- [x] manual check: desktop split/retract + mobile preview ordering + keyboard lightbox/reorder
- [x] no silent-failure swallow on added path — `none`
- [x] app functional — clean reset supports create/edit/proposal/public detail with fake providers
- [ ] commit msg draft: `test(events): prove editor media and location contracts compose end to end`
