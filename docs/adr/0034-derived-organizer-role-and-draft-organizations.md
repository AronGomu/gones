# Derived Organizer Role and Draft Organizations

## Status

Accepted. Extends the organization model behind ADR 0024 (tournament proposal approval, the flow now
named event proposal by ADR 0035); does not amend ADR 0020's server authority.

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
revokes refresh sessions, exactly like an admin-driven role change. Because
`ValidateSecurityStampAndRoleAsync` compares the stamp and the baked-in role claim on every
authenticated call, a demotion takes effect on the subject's next request, not at their next token
refresh.

**One lock order for everyone.** Every transaction that writes memberships takes its row locks as
`organizations` → `organization_members` → `asp_net_users` → the rows hanging off a user, and locks
several rows of one table in ascending id order. A deadlock that escapes anyway surfaces as a 409
rather than a 500.

## Consequences

- One screen, `/admin/organizations`, manages both sides of the graph, and it is the only place the
  Organizer role is meant to come from.
- `POST /api/admin/users/{id}/roles/Organizer/grant` and its `revoke` twin were **not** removed, and
  `/admin/users` still renders the buttons that call them. A hand-granted Organizer therefore exists
  until the next membership write on that account, at which point the derived sync overwrites it
  from the roster. Membership is the source of truth for every path that writes memberships; the
  admin grant is a manual override that survives only until one of those paths runs. Retiring the
  two endpoints and their buttons is deliberately left as a follow-up, because they are also the
  only way to grant `Admin`.
- The Draft state must be visible wherever an organization is chosen: the admin list badges it, and
  the event-create picker filters it out.
- The invariant "an organization always has an organizer" is deliberately weaker than stated: it
  holds for publishing, not for existence.
- Healed organizations are recoverable through the existing restore endpoint.
