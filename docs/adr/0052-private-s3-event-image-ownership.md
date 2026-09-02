# ADR-0052: Private S3 Event-image ownership

> Status: accepted; planned
> Decided: 2026-08-31
> Owners: Calendar Event API, Worker, runtime
> Relates: ADR-0018 (platform-agnostic OCI runtime), ADR-0024 (7-day Event proposals), ADR-0039 (public Event cache boundary)

## Status

Accepted. Not yet implemented.

## Context

Event editor accepts zero to five JPEG, PNG or WebP files before an Event exists. Direct publication may attach them immediately; proposal submission must keep them private and reviewable for seven days before approval. API and Worker containers are read-only, so container filesystem is not durable storage. PostgreSQL remains metadata authority, but multi-megabyte image variants would bloat DB backups and query I/O.

Object storage and PostgreSQL cannot share one transaction. Ownership therefore needs explicit states, deterministic object keys and retry-safe post-commit cleanup rather than pretending cross-system atomicity exists.

## Decision

1. Image bytes live in a private S3-compatible bucket. Local compose runs MinIO and an idempotent private bucket bootstrap. PostgreSQL stores image identity, ownership state, order, alt text, dimensions and expiry.
2. `event_images` has exactly three states: `Temporary`, `ProposalOwned`, `EventOwned`. DB constraints enforce owner columns for each state.
3. Upload is immediate. API validates/decode-processes synchronously, auto-orients, strips metadata, rejects animation, enforces 5 MiB and 25 megapixels, then emits non-upscaled WebP variants at widths 320, 960 and 1600. Original bytes are discarded after variants succeed.
4. Object keys are deterministic: `event-images/{imageId}/{width}.webp`.
5. Direct Publish atomically changes caller-owned Temporary rows to EventOwned in Event transaction. Proposal submit changes them to ProposalOwned; approval changes them to EventOwned in proposal decision/Event transaction.
6. Temporary rows expire after 24 hours. ProposalOwned rows expire with seven-day proposal. Worker sweeps every 15 minutes.
7. DB ownership change/delete commits before object deletion. Failed deletes are logged and retried; they never roll back committed Event/proposal state and are never swallowed.
8. Temporary variants require uploader auth and `no-store`; ProposalOwned variants require matching review token and `no-store`; EventOwned variants are anonymous with immutable one-year cache headers and ETag. API streams bytes; bucket remains private.

## Consequences

1. Runtime gains MinIO locally plus S3 endpoint/bucket/region/secret-file config in deployed envs.
2. DB state is authoritative while object cleanup is eventually consistent. Orphan bytes may remain during outage; observable retry is accepted.
3. API carries public image bandwidth because bucket is private. Stable API URLs avoid expiring URLs in cached Event detail responses.
4. Image processing adds CPU/memory cost at upload time and package/licence maintenance.
5. Proposal image privacy follows existing token capability: leaked review token can read proposal imgs until decision/expiry, no broader media.
6. Public Event catalog remains image-free; only detail responses carry variants, protecting full-catalog cache size.

## Alternatives rejected

1. PostgreSQL `bytea` lost because media bytes inflate DB, backups and serving load.
2. Host filesystem volume lost because it weakens platform-neutral OCI runtime and multi-instance portability.
3. Public bucket lost because temporary/proposal imgs would need separate stores or fragile object ACL transitions.
4. Presigned URLs for all reads lost because expiring URLs conflict with cached public Event detail data.
5. One multipart Event Publish lost because immediate preview/retry and seven-day proposal ownership require imgs before Event creation.
6. Immediate object delete inside DB transaction lost because S3 failure cannot participate in rollback and can destroy media for a stale/rolled-back edit.
