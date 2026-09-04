# ADR-0054: Direct Event publication with live local preview

> Status: accepted; planned
> Decided: 2026-08-31
> Owners: Calendar Event API and editor
> Relates: ADR-0024 (proposal approval publishes stored payload), ADR-0034 (organization publication authority), ADR-0036 (single-format Event)

## Status

Accepted. Not yet implemented.

> Amended by [ADR-0056](0056-singular-event-image-contract.md): Event writes carry nullable `imageId`, not ordered `images`.

## Context

Current organizer flow submits payload to `POST /api/events/preview`, receives short-lived preview ticket plus server render, replaces form with preview page, then submits ticket and same payload to `POST /api/events`. Any form change invalidates ticket. Product now requires live preview beside form, no Preview button, and one Publish action.

Keeping ticket req hidden behind Publish would preserve two network failure points and duplicate validation without showing user intermediate result. Local preview can use actual Event detail component plus canonical local Markdown renderer; server remains final validator on Publish.

Proposal approval still needs internal publication of stored payload under existing row-lock transaction. Removing public preview ceremony must not remove internal publication service or proposal idempotency.

## Decision

1. `POST /api/events/preview`, preview-ticket service, consumed-ticket table and corresponding generated client/UI state are deleted.
2. `POST /api/events` accepts `EventPayloadRequest` directly with required `Idempotency-Key`; it validates and publishes once, returning `201`, Location and ETag.
3. Internal publication method remains callable by proposal approval inside caller-owned transaction without membership requirement or preview token. Existing proposal row-lock/idempotency rules remain.
4. Browser renders draft instantly with actual Event detail component. No server correction/preview stage exists.
5. Desktop at 1024px and wider uses 50/50 editor/sticky preview. Session-scoped collapse hides preview and expands form. Below 1024px preview follows form.
6. Publish is disabled while form unresolved/invalid or img upload pending/failed, but server validation remains authoritative.
7. Event write shape nests resolved `location` and ordered `images`; omitted end derives start-day 23:59:59. Timezone and removed Live/Archive URL controls are absent. Edit preserves stored URL columns explicitly.

## Consequences

1. One click creates one publication request instead of preview+publish pair.
2. Preview can differ only if paired Markdown/detail parity regresses; golden/DOM tests replace ticket-issued render comparison.
3. Server field validation may appear only after Publish. There is no preview correction page; errors map back into live form.
4. Public preview endpoint callers get 404. Gones is unreleased with repository frontend as only client, so no compatibility alias remains.
5. Proposal internal publisher becomes more important as separate trusted entry point and needs direct tests whenever publication changes.
6. Preview-ticket replay protection disappears because no preview capability exists. Idempotency-key conflict/replay remains publication retry boundary.

## Alternatives rejected

1. Hidden preview then publish lost because it preserves obsolete ticket ceremony and two failure points without user value.
2. Optional preview endpoint lost because repository has no external client needing it; extra API would be unowned surface.
3. Server-render on every edit lost because typing would depend on network/provider latency and availability.
4. Client-only validation lost because server still owns organization authority, location token, img ownership, idempotency and domain rules.
5. Separate preview component lost because fidelity requirement is best enforced by reusing actual Event detail component.
