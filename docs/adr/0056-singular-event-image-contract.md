# ADR-0056: Singular Event image contract

> Status: accepted; implemented
> Decided: 2026-09-03
> Owners: Event editor, API, Worker, persistence
> Relates: ADR-0024 (proposal ownership), ADR-0039 (public Event cache)
> Amends: ADR-0052 §§1-2 (ordered alt metadata), ADR-0054 §7 (ordered `images` wire shape)

## Status

Accepted. Implemented by Event API, persistence migration, generated client, editor, proposal review, and public detail.

## Context

Event editor currently accepts zero to five images. Every write/read boundary therefore carries arrays, `sort_order`, user-authored `alt_text`, reorder controls, gallery layout, and proposal/hash logic. Product now allows one Event post image and removes alternative-text and positioning controls.

S3 privacy, immediate upload, ownership states, deterministic variants, expiry, and retry-safe object cleanup remain necessary. Replacing object storage would not follow from reducing owner cardinality.

## Decision

1. Event and Event Proposal own zero or one image. `event_images` retains `Temporary`, `ProposalOwned`, and `EventOwned` states plus dimensions/expiry/object identity.
2. Publish/proposal/edit requests expose nullable `imageId`; public detail, management, and proposal review expose nullable `image`. No Event boundary returns empty image arrays.
3. `EventImageResponse` contains `id` and `variants`. `altText` leaves wire/domain/DB. UI generates non-user-controlled image alt from Event title for accessibility.
4. `event_images.alt_text` and `event_images.sort_order` are removed. Partial unique indexes on non-null `event_id` and `proposal_id` enforce owner cardinality.
5. Migration retains lowest old `sort_order`, UUID tie-break. Each discarded image's variant keys enter `event_image_object_deletions`; extra DB rows leave before metadata columns drop. Worker later deletes bytes with existing retry/log behavior.
6. Pending proposal envelope advances from v2 plural image payload to v3 nullable `imageId`; migration rewrites payload + hashes. Runtime reads current version only.
7. Upload validation, private bucket, 5 MiB/25 MP limits, WebP widths, 24-hour Temporary expiry, seven-day Proposal expiry, auth/cache policy, post-commit object deletion remain unchanged.

## Consequences

1. API + generated client + proposal envelope break shape. Gones is unreleased with repository frontend as only client, so no compatibility alias remains.
2. DB constraints prevent direct callers from bypassing one-image rule.
3. Existing extra images are discarded. Object bytes may remain until Worker succeeds; queued deletion makes this visible/retryable.
4. Authors cannot supply meaningful custom alt text. Generated alt is less descriptive for complex posters; accepted simplification follows removed control.
5. Gallery/reorder code disappears; one hero/lightbox remains.
6. S3 + DB cross-system eventual cleanup remains despite singular ownership.

## Alternatives rejected

1. UI-only one-image cap lost because API callers could still create plural media and DB would preserve obsolete order.
2. One-element arrays lost because they preserve plural semantics and invite gallery behavior back.
3. Nullable nested `{ image: { imageId } }` input lost because one UUID needs no wrapper.
4. Dropping `event_images` for an `events.image_id` column lost because Temporary + Proposal ownership exists before Event and still needs state/expiry/object cleanup.
5. Keeping alt/order columns hidden lost because stale schema would imply unsupported capabilities and complicate hashes/ETags.
