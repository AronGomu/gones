# Derived Organizer Role and Draft Organizations

## Status

Proposed. Extends the organization model behind ADR 0024 (tournament proposal approval); does not
amend ADR 0020's server authority.

## Context

Organizations and organizers are many-to-many: an organization has several organizers, an organizer
belongs to several organizations. Until now `globalRole` was set by an admin through
`POST /api/admin/users/{id}/roles/{role}/grant`, entirely independently of `organization_members`.
Two sources of truth for the same fact drift: an `Organizer` with no organization sees empty
organizer pages, and an organization with no organizer cannot be administered by anyone but an
admin.

The product rule asked for is: an organizer without an organization does not exist, and an
organization needs an organizer to act. The literal reading — refuse to ever reach zero on either
side — collides with how organizations are actually created, where the roster is filled after the
record exists.

## Decision

**Membership is the single source of truth for the Organizer role.** Adding a user's first
membership promotes `User` → `Organizer`; removing their last membership demotes `Organizer` →
`User`. `Admin` is never changed by membership, so an admin may hold organizations as an ordinary
member without losing administration rights.

**Zero-member organizations are legal and called Draft.** Draft is derived from the member count,
not stored. A Draft organization can be created, edited, restored and deleted, but it cannot publish
an event: the publish path answers `409 organization_is_draft`. Removing the last member is allowed
and returns the organization to Draft — no conflict response, no forced hand-over, no cascade.

**Legacy rows are healed once.** A one-shot EF migration soft-deletes member-less organizations that
predate this decision and demotes `Organizer` accounts holding no membership, writing an audit
record per change. Nothing runs on a schedule afterwards, because a recurring enforcement job would
eventually archive a Draft organization someone deliberately created minutes earlier.

**Role changes revoke sessions.** A derived promotion or demotion rotates the security stamp and
revokes refresh sessions, exactly like an admin-driven role change.

## Consequences

- One screen, `/admin/organizations`, manages both sides of the graph; the users screen no longer
  grants the Organizer role by hand.
- The Draft state must be visible wherever an organization is chosen: the admin list badges it, and
  the event-create picker filters it out.
- The invariant "an organization always has an organizer" is deliberately weaker than stated: it
  holds for publishing, not for existence.
- Healed organizations are recoverable through the existing restore endpoint.
