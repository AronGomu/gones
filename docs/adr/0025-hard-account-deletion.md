# Hard Account Deletion

## Status

Accepted. Complements the admin closure path (`POST /api/admin/users/{id}/disable`), which is
unchanged.

## Context

There was no way for a user to delete their own account. The only lifecycle operations were an
admin-initiated disable and a `closure-impact` query. The product owner asked for a "Supprimer
Compte" button, password-confirmed.

Three shapes were on the table: anonymize and keep the row, hard-delete the row, or soft-close with a
grace period and a scheduled purge. Anonymizing preserves participant history on tournaments the user
attended and keeps audit actor references intact. A grace period is the friendliest, and costs a
worker job plus a closed-account login path. A hard delete is the cleanest privacy answer and the
easiest to explain to a user.

The owner chose the hard delete.

## Decision

**`DELETE /api/users/me` removes the account and everything owned by it.**

- The body carries `currentPassword`. A wrong or empty password returns `400` naming
  `currentPassword` — never `401`, so the endpoint cannot be used to distinguish "bad password" from
  "not signed in".
- The `ApplicationUser` and `UserProfile` rows are deleted, cascading to refresh sessions, external
  identities, account-action tokens, tournament registrations and organization memberships.
- `audit_records.actor_id` becomes `ON DELETE SET NULL`. Audit rows survive the person.
- An `account.deleted` audit row is written **before** the delete, with a null actor and the user id
  only in `entity_id`.
- The last remaining `Admin` cannot delete themselves: `409` with `lastAdmin`. An installation
  without an administrator is unrecoverable.
- The refresh cookie is cleared and every session revoked in the same request.

## Consequences

- **Irreversible, and the UI says so.** The confirmation dialog states that the deletion is permanent
  before it asks for the password.
- Participant history on past tournaments disappears with the registrations. Organizers lose the
  record that this person attended. This is the accepted cost of the chosen shape; the anonymize
  variant is the fallback if it turns out to matter.
- Audit remains queryable but loses its actor for the deleted user's past actions. The `entity_id`
  on each row still identifies which account acted.
- No worker job, no scheduled purge, no closed-account state machine. The lifecycle stays as small as
  it was.
