# T3: Singular Event image

**Plan:** `./artifacts/PLAN_2026_09_03_create_edit_event_page.md`
**Depends:** T2
**Commit outcome:** Publish, proposal, edit, DB, uploader, and public detail enforce zero-or-one Event image without alt/position metadata.

## Context (self-contained)

- C1 Goal: allow one image only; remove alternative-text + positioning controls; replace Remove text with red trash icon.
- C2 This slice: complete vertical media contract from Angular → OpenAPI → API/domain/DB → proposal/public reads → UI.
- C3 Out of scope here: S3 object/variant architecture, upload limits/types, public catalog image addition, unrelated Event layout.
- C4 Assumptions in force: ADR-0056 amends ADR-0052/0054 plural-image clauses; existing first image by `sort_order` survives migration; generated display-title alt remains accessibility behavior.

## Requirements

- R1 Replace request `images: EventImageInput[]` with optional nullable `imageId` on direct publish, proposal envelope, update details.
- R2 Replace response `images: EventImageResponse[]` with optional nullable `image` on Event management, proposal review, public detail. Catalog stays image-free.
- R3 `EventImageResponse` becomes `{ id, variants }`; remove `altText`. Keep upload response expiry + variants.
- R4 DB retains `event_images` ownership/state/object metadata; drops `alt_text` + `sort_order`.
- R5 Enforce max one owned image with partial unique indexes on non-null `event_id` and non-null `proposal_id`.
- R6 Migration chooses lowest old `sort_order`, then UUID as deterministic tie-break. For every extra image, insert deterministic variant keys into `event_image_object_deletions`, then delete extra `event_images` rows inside migration transaction before dropping columns. Worker later deletes object bytes through existing retry/log path.
- R7 Rewrite pending proposal JSON envelope v2 `event.images` to v3 `event.imageId` using first array entry. Reject malformed payload as existing conflict; no dual v2/v3 runtime reader.
- R8 Increment `EventProposalEnvelope.CurrentVersion` from 2 to 3; migration rewrites pending proposal JSON + recomputes payload/envelope hashes so first image remains reviewable. No runtime v2 compatibility reader.
- R9 Event publish/edit/proposal lock one `Guid?`; null removes/no-ops; wrong owner/state/expired ID returns existing `409 image_state_conflict`; missing ID returns existing `404 image_not_found` where lifecycle currently does.
- R10 Uploader removes CDK drag/drop ordering, `multiple`, alt input, move controls, arrays. Keep drag file drop itself for one file.
- R11 Adding second file while one card exists does not upload/replace; show translated max-one error. Removing first permits another.
- R12 Remove button is icon-only red danger action with inline Material/SVG trash icon + localized `aria-label`; pending removal remains disabled + announced.
- R13 Public detail renders at most one hero image. Keep click-to-lightbox, close/Escape/focus trap; remove gallery + prev/next navigation.
- R14 Preview uses uploaded blob URL for same one image. Generated alt is `${displayTitle()} — ${i18n.t('event.image')}` or empty decorative alt if existing accessibility tests choose; no user-controlled alt.
- R15 Update cache/ETag identity from ordered IDs+alt to singular image ID+dimensions.
- R16 Regenerate committed OpenAPI client using `npm run api:generate`; `npm run api:check` must pass. Assert `imageId` absent from OpenAPI `required` lists + generated as optional.
- R17 Add dedicated migration integration test: migrate to `20260902070415_DirectEventPublication`, seed duplicate Event/proposal images + v2 envelope, migrate latest, verify first preservation, queued deletion keys, v3 payload/hash, unique indexes.

## Inputs

- I1 `src/app/features/events/event-image-uploader.component.ts`
- I2 `src/app/features/events/event-image-uploader.component.test.ts`
- I3 `src/app/features/events/event-detail-view.component.ts`
- I4 `src/app/features/events/event-detail-view.component.test.ts`
- I5 `src/app/features/events/organizer-event-create.ts`
- I6 `src/app/features/events/event-management.ts`
- I7 `src/app/features/events/event-proposal.service.ts`
- I8 `backend/openapi/gones.json` + generated `src/app/api/generated/gones-api.ts`
- I9 `backend/src/Gones.Api/Events/EventPublicationEndpoints.cs`
- I10 `backend/src/Gones.Api/Events/EventLifecycleEndpoints.cs`
- I11 `backend/src/Gones.Api/Events/EventProposalEndpoints.cs`
- I12 `backend/src/Gones.Api/Events/PublicEventEndpoints.cs`
- I13 `backend/src/Gones.Domain/Calendar/EventImage.cs`
- I14 `backend/src/Gones.Infrastructure/Persistence/EventRecordConfigurations.cs`
- I15 `backend/src/Gones.Infrastructure/EventProviders/EventImageCleanupService.cs`
- I16 `backend/src/Gones.Infrastructure/Persistence/Migrations/`
- I17 `docs/adr/0056-singular-event-image-contract.md`
- I18 new `backend/tests/Gones.IntegrationTests/EventImageMigrationTests.cs`
- I19 **From Depends T2:** finalized manual address + IANA timezone component/tests/i18n shape; T3 edits same hotspots only after T2 completes.

## Interface contract (level 5)

- P1 **Produces:** `EventPayloadRequest.imageId?: string`; JSON absent/null means no image.
- P2 **Produces:** `EventUpdateDetailsRequest.imageId?: string`; null/absent removes current Event image.
- P3 **Produces:** `PublicEventDetailResponse.image?: EventImageResponse`; `EventManagementResponse.image?: EventImageResponse`; `EventProposalReviewResponse.image?: EventImageResponse`.
- P4 **Produces:** `EventImageResponse { id: string; variants: EventImageVariantResponse[] }`.
- P5 **Produces:** C# records:

```csharp
internal sealed record EventPayloadRequest(
    Guid OrganizationId,
    string Title,
    EventLocationInput Location,
    CalendarEventType EventType,
    string StartsAtLocal,
    int Capacity,
    IReadOnlyList<Guid> FormatIds,
    string? Summary = null,
    string? BodyMarkdown = null,
    Guid? ImageId = null);

internal sealed record EventImageResponse(
    Guid Id,
    IReadOnlyList<EventImageVariantResponse> Variants);
```

- P6 **Consumes:** unchanged `POST /api/event-images` → `EventImageUploadResponse { id, state, width, height, expiresAt, variants }`; unchanged DELETE + variant routes.
- P7 **Errors:** second/non-owned/expired/conflicting ID → RFC 7807 `409 image_state_conflict`; unknown lifecycle image → `404 image_not_found`; upload validation/storage errors unchanged.
- P8 **Invariants:** owner cardinality Event 0..1, Proposal 0..1; Temporary owner none; Event/Proposal attach + publish happen in DB tx; object cleanup remains post-commit + retry-visible.
- P9 **DB:** enqueue extras in `event_image_object_deletions(object_key,image_id,attempts,next_attempt_at,last_error,created_at)` for each `EventImage.VariantWidthsFor(width)` key, delete extras, drop `alt_text` + `sort_order`; create unique partial indexes `ux_event_images_event_id` WHERE `event_id IS NOT NULL`, `ux_event_images_proposal_id` WHERE `proposal_id IS NOT NULL`.
- P10 **Integration links:** uploader `src/app/features/events/event-image-uploader.component.ts:57` → `POST /api/event-images` current `:287` → `EventPayloadRequest.imageId` `backend/src/Gones.Api/Events/EventPublicationEndpoints.cs:626` → ownership attach current `:376` → `event_images` → public projection `backend/src/Gones.Api/Events/PublicEventEndpoints.cs:275` → `EventDetailViewComponent` media current `src/app/features/events/event-detail-view.component.ts:44`.

## TDD

1. **Red** — backend unit/integration + frontend tests assert singular wire/card/DB cardinality/migration/public DOM before impl.
2. **Green** — migrate contract vertically, regenerate client, minimize uploader/detail code.
3. **Refactor** — delete orphaned array/order/alt/gallery code + imports only after green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| Publish none | `imageId: null` | 201; no owned image |
| Publish one | valid Temporary UUID | 201; one EventOwned row |
| Publish invalid | other/expired UUID | exact 409 conflict |
| Edit remove/replace | null/new temp ID | old object cleanup queued; one/no image response |
| Proposal review/approve | one temp ID | singular review image; promoted on approval |
| Migration multiple | previous migration + seeded ordered Event/proposal rows/v2 JSON | first survives; deletion rows queued; extras deleted; v3 hashes valid; unique indexes hold |
| OpenAPI | generated TS | no `EventImageInput`, no Event `images`, singular nullable fields |
| Uploader | 2 dropped files | one upload only + max-one error |
| Uploader controls | one image | no alt/move/reorder; red trash icon has accessible name |
| Detail | one image | hero/lightbox; no gallery/next/previous |
| ETag | image replace | public detail ETag changes |

## Impl steps

- [x] 1. Add red backend tests. Evidence: red compile captured; green focused backend run passes 109 integration + 12 unit tests.
  - [x] 1.1 Pin nullable publish/proposal/edit shape + exact errors. Evidence: `dotnet test backend/tests/Gones.UnitTests/Gones.UnitTests.csproj --configuration Release --filter FullyQualifiedName~EventImageTests --no-restore` failed red at `EventImageTests.cs(47,15)` because singular `AttachToEvent` signature was not implemented.
  - [x] 1.2 Pin owner cardinality + cleanup. Evidence: `EventLifecycleApiTests` replacement/removal cases + migration unique-index assertion pass.
  - [x] 1.3 Pin migration first-image policy + proposal v3 rewrite. Evidence: `EventImageMigrationTests` previous→latest test passes.
- [x] 2. Add migration + domain/config changes. Evidence: focused backend suite passes.
  - [x] 2.1 Queue every extra variant in object-deletion table; delete extra image rows. Evidence: migration test asserts four exact deterministic keys + two retained rows.
  - [x] 2.2 Rewrite pending proposal JSON/hash/version. Evidence: migration test deserializes v3, asserts `imageId`, absent `images`, `HasValidIntegrity()`.
  - [x] 2.3 Drop metadata columns + add partial unique indexes. Evidence: schema test asserts absent columns; migration test observes `23505` on second Event owner.
  - [x] 2.4 Remove domain alt/sort members + methods. Evidence: solution builds; updated unit contract passes.
- [x] 3. Change API services/projections to singular nullable image. Evidence: 109 focused integration tests pass.
  - [x] 3.1 Publish + payload hash. Evidence: none/one/conflict/missing focused publication tests pass.
  - [x] 3.2 Proposal submit/review/decision. Evidence: proposal focused tests pass with singular response/promotion.
  - [x] 3.3 Lifecycle edit/list. Evidence: replace/remove/list/concurrency lifecycle tests pass.
  - [x] 3.4 Public detail + ETag. Evidence: public detail test passes with singular image; ETag identity includes ID/dimensions.
- [x] 4. Regenerate OpenAPI client; update Angular mapping/services. Evidence: `npm run api:generate`; TS typecheck passes.
- [x] 5. Simplify uploader to one card. Evidence: focused Angular suite 80/80 passes.
  - [x] 5.1 Remove CDK ordering + alt UI/state. Evidence: uploader DOM test asserts no `multiple`, alt, move controls.
  - [x] 5.2 Reject second file without upload. Evidence: uploader test asserts one POST + unchanged first image.
  - [x] 5.3 Add red trash icon + accessible pending state. Evidence: uploader DOM/axe test asserts SVG accessible name; pending removal status retained.
- [x] 6. Simplify public/preview media to one hero + one-image lightbox. Evidence: detail tests assert generated alt, hero/lightbox, no gallery/nav.
- [x] 7. Remove only newly orphaned imports, keys, funcs, tests. Evidence: `git diff --check`, lint, residue greps, full test suites pass; gallery CSS/i18n and CDK imports removed.

## Validation

- [x] V1 tests pass: `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventImage|FullyQualifiedName~EventPublication|FullyQualifiedName~EventProposal|FullyQualifiedName~EventLifecycle|FullyQualifiedName~PublicEvent"` → 109 integration + 12 unit passed.
- [x] V2 tests pass: `npm run test -- src/app/features/events/event-image-uploader.component.test.ts src/app/features/events/event-detail-view.component.test.ts src/app/features/events/organizer-event-create.test.ts src/app/features/events/organizer-event-create.component.test.ts src/app/features/events/event-proposal-submit.test.ts` → 80 passed.
- [x] V3 API contract: `npm run api:check` passed; `src/app/api/event-image-contract.test.ts` asserts optional nullable `imageId`, singular responses, absent `EventImageInput`/`altText`.
- [x] V4 migration transform: `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventImageMigrationTests"` → 1 passed; test migrates previous→latest with seeded duplicate Event/proposal images + v2 proposal.
- [x] V5 headless browser: targeted release-stack Cypress (`organizer-event-create`, `organizer-event-management`, `event-proposal`) → 16 passed; covers first upload, second rejection, red trash removal, publish, public lightbox, edit replace. DOM/Vitest covers remove + Escape/focus lightbox.
- [x] V6 no silent-failure swallow: backend post-commit warnings remain at `EventLifecycleEndpoints.cs:570-579` + `EventProposalEndpoints.cs:414-425`; worker retry/log at `EventImageCleanupService.cs:157-185`; uploader visible delete/upload/preview failures at `event-image-uploader.component.ts:182-184`, `:214`, `:232`.
- [x] V7 app functional: `npm run typecheck && npm run lint && npm run build` passed; build emitted only two pre-existing unused `RouterLink` warnings in admin components.
- [x] V8 commit msg: `feat(events): enforce singular owned Event image`

## Cumulative review closure (2026-09-04)

- [x] R1 Migration reads exact predecessor v2 envelope shape, validates original payload/envelope hashes before conversion, derives manual `timeZoneId` from outer validated location, preserves empty-image cleanup + survivor reconciliation, leaves tampered rows at v2. Evidence: `dotnet test backend/tests/Gones.IntegrationTests/Gones.IntegrationTests.csproj --configuration Release --filter FullyQualifiedName~EventImageMigrationTests --no-restore` → 4/4 passed.
- [x] R2 Release/dev contracts use nullable `imageId` + singular `image`; proposal review residue + plural UI copy removed. Evidence: `npm run test` → 2272/2272 passed; `npm run release:rehearsal` passed full clean-volume Postgres/MinIO lifecycle.
