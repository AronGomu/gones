# T3: Temporary Event images

**Plan:** `./artifacts/PLAN_2026_08_31_event_editor_images_markdown.md`
**Depends:** T1
**Commit outcome:** Authenticated users upload 0–5 safe temporary Event imgs, preview/reorder/retry/remove them, read state-authorized variants, and rely on 24h cleanup.

## Context (self-contained)

- C1. Goal: imgs are separate Event data, never embedded in description.
- C2. This slice: `event_images` state model, migration, S3 variant pipeline, temp API/read authz, reusable Angular drag/drop module, worker temp cleanup.
- C3. Out of scope here: Event attachment, public detail layout, proposal promotion/token reads.
- C4. Assumptions: JPEG/PNG/WebP only; max 5 MiB, 25 MP; 320/960/1600 WebP; no upscale; originals discarded.

## Requirements

- R1. Add `EventImage` domain state + `event_images` table/constraints/indexes.
- R2. `POST /api/event-images`: authenticated verified user; multipart field exactly `file`; process synchronously; upload variants before DB row commit; compensate uploaded variants if DB commit fails.
- R3. Validate declared + decoded MIME; reject animation; auto-orient; strip metadata; preserve ratio; output only widths ≤ source width, at least one output at source width when source <320.
- R4. `DELETE /api/event-images/{id}` only caller-owned `Temporary`; DB delete first, object deletion post-commit with bounded retry record/log. Missing→404; wrong owner/state→409.
- R5. Base variant route: `Temporary` requires uploader auth + `no-store`; `EventOwned` anonymous + immutable cache; `ProposalOwned` rejected until T7 token route.
- R6. Worker sweeps `Temporary` rows with `expires_at <= now` every 15m; object failures stay observable/retryable, not swallowed.
- R7. Angular reusable uploader: drag/drop + file picker; max 5; per-img progress/error/retry/remove; valid peers survive failed file; Publish-facing state says blocked while pending/failed; drag + Move left/right keyboard actions.
- R8. Every rendered element gets unique feature-prefixed `data-cy`; EN/FR copy.
- R9. OpenAPI/client/migration/fixtures used by this slice land now, not T8.

## Inputs

- I1. `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs:40-45` Event DbSets.
- I2. `backend/src/Gones.Infrastructure/Persistence/EventRecordConfigurations.cs:11-51` Event persistence conventions.
- I3. `backend/src/Gones.Worker/Program.cs:31-39` hosted worker composition.
- I4. `src/AGENT.md` data-cy/i18n/standalone component contract.
- I5. **From Depends:** T1 contract copied below and in Interface contract; do not redesign.
- I6. T1 provides this binding contract:

```csharp
public interface IEventImageObjectStore
{
    Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken);
    Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken);
    Task DeleteAsync(string key, CancellationToken cancellationToken);
}
public interface IEventImageProcessor
{
    Task<ProcessedEventImage> ProcessAsync(Stream source, string contentType, CancellationToken cancellationToken);
}
public sealed record ProcessedEventImage(int Width, int Height, IReadOnlyList<ProcessedEventImageVariant> Variants);
public sealed record ProcessedEventImageVariant(int Width, int Height, ReadOnlyMemory<byte> WebP);
```

Config: `GONES_EVENT_IMAGES_S3_ENDPOINT`, `_BUCKET`, `_REGION`, `_ACCESS_KEY_FILE`, `_SECRET_KEY_FILE`; storage failure maps RFC 7807 `503 image_storage_unavailable`; local MinIO bucket readiness is green.

## Interface contract (level 5)

- **Produces:**

```csharp
public enum EventImageState { Temporary, ProposalOwned, EventOwned }
public sealed class EventImage
{
    public Guid Id { get; }
    public Guid UploadedByUserId { get; }
    public EventImageState State { get; }
    public Guid? EventId { get; }
    public Guid? ProposalId { get; }
    public int? SortOrder { get; }
    public string? AltText { get; }
    public int Width { get; }
    public int Height { get; }
    public Instant CreatedAt { get; }
    public Instant? ExpiresAt { get; }
}
```

```sql
state IN ('Temporary','ProposalOwned','EventOwned');
alt_text IS NULL OR length(alt_text) <= 300;
(state='Temporary' AND event_id IS NULL AND proposal_id IS NULL AND sort_order IS NULL AND expires_at IS NOT NULL)
OR (state='ProposalOwned' AND event_id IS NULL AND proposal_id IS NOT NULL AND sort_order IS NOT NULL AND expires_at IS NOT NULL)
OR (state='EventOwned' AND event_id IS NOT NULL AND proposal_id IS NULL AND sort_order IS NOT NULL AND expires_at IS NULL);
```

```http
POST /api/event-images
Content-Type: multipart/form-data; boundary=...
Authorization: Bearer <token>
field: file
```

```ts
interface EventImageVariantResponse { width: number; height: number; url: string; }
interface EventImageUploadResponse {
  id: string;
  state: 'Temporary';
  width: number;
  height: number;
  expiresAt: string;
  variants: EventImageVariantResponse[];
}
```

```http
DELETE /api/event-images/{imageId} -> 204
GET /api/event-images/{id}/variants/{width} -> image/webp
```

- **Consumes:** T1 media ports; multipart `file`; authenticated user ID.
- **Errors:** `413 image_too_large`; `415 image_type_unsupported`; `400 image_invalid`; `400 image_too_many_pixels`; `400 image_animated`; `503 image_storage_unavailable`; absent row/variant `404`; foreign/expired/non-Temporary delete `409 image_state_conflict`.
- **Invariants:** upload+DB yields all variants or no row; S3 key `event-images/{id}/{width}.webp`; variants ordered ascending width; max 5 enforced in component now + Event payload later; no original retained; no fire-and-forget delete without retry evidence.
- **Integration links:** uploader component → `POST /api/event-images` → processor → object store → `event_images`; preview URL → base variant endpoint → state authz → S3 stream; worker timer → expired rows → post-commit object deletion.

## TDD

1. **Red** — domain/DB constraints, endpoint formats/limits/authz, object compensation, sweep, Angular uploader state tests.
2. **Green** — minimal state/API/processor/component.
3. **Refactor** — share post-commit deletion queue only if both delete/sweep use it.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Valid upload | 5 MiB-or-less JPEG EXIF rotation | oriented metadata-free WebP variants + `201` |
| Tiny image | width 200 | one 200-wide variant; no upscale |
| Bomb | >25 MP decode | `400 image_too_many_pixels`; no objects/row |
| Animated WebP | animation | `400 image_animated` |
| Partial batch UI | 2 valid + 1 invalid | valid imgs remain; failed card retryable; publishBlocked true |
| Temp auth | owner/other/anon | owner 200; other/anon denied; `no-store` |
| Delete state | foreign or attached | `409 image_state_conflict`; objects intact |
| Sweep | expired + live temp | expired removed; live retained; failure logged/retried |

## Impl steps

- [ ] 1. Add failing domain/migration/integration tests.
- [ ] 2. Add failing processor/object-store compensation tests.
- [ ] 3. Add failing uploader DOM/state/a11y tests.
- [ ] 4. Implement table/domain/API/processor/base read route.
- [ ] 5. Implement worker sweep + observable retry-safe object deletion.
- [ ] 6. Implement reusable uploader/reorder component + i18n/data-cy.
- [ ] 7. Regenerate API client; run gates.

## Validation

- [ ] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventImage"`
- [ ] `npm run test -- --run src/app/features/events/event-image-uploader.component.test.ts`
- [ ] `npm run api:generate && npm run api:check`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] manual check: upload valid/invalid peers, reorder by drag + keyboard, retry/remove, inspect `srcset` variants
- [ ] no silent-failure swallow on added path — list object-delete retry site + durable/observable retry reason
- [ ] app functional — expired temps cleaned; valid temp remains previewable only to owner
- [ ] commit msg draft: `feat(events): stage safe ordered media before Event ownership`
