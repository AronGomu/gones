# Organizations Without Owners

## Status

Accepted. Builds on ADR 0034 (derived Organizer role and Draft organizations). Planned by T16–T17 in
`artifacts/PLAN_2026_08_15_feedback-app-wide-round-5.md`.

## Context

An organization had two membership roles, `Owner` and `Organizer`, and exactly one owner. Ownership
gated the organization's own management surface (`OrganizationAccess.IsOwner`), and it forced a whole
second flow at account closure: closing an account that solely owned an organization was **refused**
unless an admin named a successor, so `AdminAccountService` carried a transfer map, a suggested
successor in the closure-impact response, and a `TransferSoleOwnershipAsync` path duplicated in
`OrganizationService`.

The product rule is simpler than the model: nobody owns an organization. An organization has many
organizers; an organizer belongs to many organizations. The admin create form even asked for an
"Owner User ID" as free text — a GUID typed by hand, for a concept that should not exist.

ADR 0034 had already moved the important part of the model in this direction: the global `Organizer`
role is **derived** from membership, and an organization with no members is Draft and cannot publish.
Ownership was the last piece still asserting a hierarchy among members.

## Decision

**Remove `Owner` from the domain.** `OrganizationRoles` has one role, `Organizer`, and every member
holds it with equal rights.

- `POST /api/organizations` no longer accepts `ownerUserId`. The creating actor becomes the first
  member, as an `Organizer`.
- `OrganizationAccess.IsOwner` becomes `IsMember` — membership, or the global `Admin` role.
- `POST /api/organizations/{id}/transfer-ownership` is deleted, along with
  `TransferOwnershipAsync` and `TransferSoleOwnershipAsync`.
- Closing an account simply removes its memberships. It is never refused for ownership reasons, and
  the closure API drops `suggestedNewOwnerUserId` and the `ownershipTransfers` payload. The
  `self_close` and `last_admin` block reasons are unrelated and stay.
- An organization left with **zero** members becomes Draft and cannot publish — the state ADR 0034
  already models and enforces.
- The migration `RemoveOrganizationOwnership` rewrites every stored `Owner` membership row to
  `Organizer`. The legacy bundle importer maps an imported `Owner` to `Organizer` too.
- The admin create form loses the owner field entirely; only `name` is required, and `description`,
  `website` and `contactEmail` are optional with inline validation.

## Consequences

- Every member can edit the organization and manage its roster. There is no protected member and no
  last-owner guard: an organization's members can remove each other, and an admin can remove them
  all, leaving it Draft.
- That is the accepted trade. The alternative — refusing to close the last member's account — was
  considered and declined: it reintroduces exactly the blocking flow this ADR removes, and ADR 0034
  already gives a member-less organization a safe, non-publishing state.
- The frontend `role === 'Owner'` test that decided between "Manage" and "View" is dead; every member
  sees Manage.
- Demo fixtures replace `ownerEmail` with a `memberEmails` array, and `DEMO_ACCOUNTS.md` is
  regenerated.
- Ownership cannot be reconstructed, so the migration's `Down` is a deliberate no-op. Gones is
  unreleased and has no production environment (see `AGENT.md`), so no real history is lost.
