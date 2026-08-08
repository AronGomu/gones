# T6b: `DELETE /api/users/me` must refuse cleanly when the account owns restricted rows

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T6
**Commit outcome:** An account that still owns organizer-side rows gets a deterministic `409` naming what blocks the deletion, never a `500`.

## Context (self-contained)

- Goal of the wider plan: land the whole `feedback.md` list on Gones Calendar V1. This slice hardens one endpoint.
- T6 shipped `DELETE /api/users/me` (commit `7edfd9b`) per ADR 0025: password-confirmed hard delete. It deletes, in dependency order, the caller's `scheduled_notifications`, `notification_history`, `tournament_registration_attempts` and `user_profiles` rows, sets `audit_records.actor_id` to `NULL` via a new `ON DELETE SET NULL` foreign key, revokes refresh tokens, clears the `gones_refresh` cookie and returns `204`.
- **The defect this ticket fixes.** ADR 0025 and T6 only considered rows a plain `User` owns. Several columns still reference `asp_net_users` with `DeleteBehavior.Restrict`, so an `Organizer` or `Admin` who ever created a tournament, acted on a registration, recorded a lifecycle event or blocked a member hits a raw PostgreSQL foreign-key violation. That surfaces to the caller as an unhandled `500`, after the endpoint has already revoked their refresh tokens.
- T11 puts a "Supprimer Compte" button on the account page for every signed-in role, so this path becomes reachable through the UI. It must not be a 500.
- Out of scope here: changing any of these foreign keys to cascade or set-null, reassigning ownership of tournaments, and any UI. Choosing a data-retention policy for organizer-authored records is a product decision that belongs in its own ADR. This ticket only makes the refusal explicit and safe.

## Requirements

- Before mutating anything, `DELETE /api/users/me` runs a pre-flight query for rows that would violate a `Restrict` foreign key.
- Blocking relations to check, all referencing `asp_net_users`:
  - `scheduled_tournaments.created_by_user_id`
  - `scheduled_tournaments.deleted_by_user_id`
  - `tournament_registration_attempts.registered_by_user_id`
  - `tournament_registration_attempts.status_changed_by_user_id`
  - `tournament_lifecycle_events.actor_user_id`
  - `organization_blocked_users.blocked_by_user_id`
  - `organization_blocked_users.unblocked_by_user_id`
- Any hit → respond `409` with error code `account_owns_records` and a machine-readable list of the offending relation names. No user row, profile row, registration row, notification row, refresh token or cookie is touched on this path — the caller stays signed in and fully intact.
- No hit → the existing T6 behavior is unchanged, byte for byte.
- Password verification still happens **before** the pre-flight, so the endpoint never discloses ownership information to someone who cannot authenticate. Order: authenticate → verify password → pre-flight → delete.
- The pre-flight runs inside the same transaction as the delete, so a row created between the check and the delete cannot slip through. If the delete still raises a foreign-key violation, it is translated into the same `409` rather than a `500`.

## Inputs

- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs` — holds the `DELETE /api/users/me` handler and `DeleteUserGraphAsync`, both added by T6.
- `backend/src/Gones.Api/Errors/ApiExceptions.cs` — T6 extended this; follow the exception type and error-code style already there. Error payload keys are PascalCase on the wire (`ApiBoundaryTests` asserts this).
- `backend/src/Gones.Infrastructure/Persistence/ScheduledTournamentRecordConfigurations.cs:40,41,71,72,107` — the `Restrict` foreign keys on `scheduled_tournaments` and `tournament_registration_attempts` and `tournament_lifecycle_events`.
- `backend/src/Gones.Infrastructure/Persistence/OrganizationRecordConfigurations.cs:60,61` — the two `organization_blocked_users` foreign keys.
- `backend/tests/Gones.IntegrationTests/AccountDeletionTests.cs` — T6's suite, 8 tests, currently all green. Extend it; do not rewrite it.
- **From Depends (T6, commit `7edfd9b`):** the endpoint exists and returns `204` on success and `400` with an `errors.CurrentPassword` key on a wrong password. Migration `20260808164636_AllowAccountHardDelete` added the audit `ON DELETE SET NULL` foreign key, narrowed the `reject_audit_mutation` trigger to tolerate exactly one mutation (`actor_id` non-null → NULL on an otherwise identical row), and added a column-scoped `GRANT UPDATE (actor_id)` for `gones_app` in the migration, `compose.yaml` and `compose.release-test.yaml`. You need no new migration.

## TDD

1. **Red** — add `Delete_is_refused_when_the_account_created_a_tournament` to `AccountDeletionTests.cs`: seed an organizer with one `scheduled_tournaments` row they created, call the endpoint with the correct password, assert `409`. It currently fails with a `500`.
2. **Green** — add the pre-flight, return `409`.
3. **Refactor** — express the relation list once as a table of (relation name, `IQueryable` count) so adding a future `Restrict` column is a one-line change; the suite stays green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Delete_is_refused_when_the_account_created_a_tournament` | organizer owning one `scheduled_tournaments` row | `409`, body names `scheduled_tournaments.created_by_user_id`, user still exists |
| `Delete_is_refused_when_the_account_changed_a_registration_status` | organizer who set `status_changed_by_user_id` on someone else's attempt | `409`, user still exists |
| `Delete_is_refused_when_the_account_blocked_a_member` | admin owning an `organization_blocked_users.blocked_by_user_id` row | `409`, user still exists |
| `Refused_deletion_leaves_the_session_usable` | same organizer | after the `409`, the caller's existing access token still returns `200` on `GET /api/users/me`, and no `Set-Cookie` clearing `gones_refresh` was sent |
| `Wrong_password_is_rejected_before_the_ownership_check` | organizer owning a tournament, wrong password | `400` with `errors.CurrentPassword`, NOT `409` — ownership is not disclosed |
| `Plain_user_deletion_still_succeeds` | the existing T6 happy path | `204`, unchanged |

Run: `dotnet test backend/tests/Gones.IntegrationTests --filter AccountDeletion`

## Impl steps

- [x] 1. Read `docs/adr/0025-hard-account-deletion.md` for the deletion semantics T6 implemented — validate: you can state why `audit_records` is set-null rather than cascade.
- [x] 2. Add the failing test `Delete_is_refused_when_the_account_created_a_tournament` to `backend/tests/Gones.IntegrationTests/AccountDeletionTests.cs` — validate: `dotnet test backend/tests/Gones.IntegrationTests --filter AccountDeletion` shows it failing with a `500`, and capture that output.
- [x] 3. In `backend/src/Gones.Api/Errors/ApiExceptions.cs`, add the `409` exception carrying an error code `account_owns_records` and a `IReadOnlyList<string> Relations` payload, matching the existing style — validate: file compiles, `dotnet build backend/Gones.sln` clean.
- [x] 4. In `LocalIdentityEndpoints.cs`, add `private static async Task<IReadOnlyList<string>> FindBlockingRelationsAsync(...)` returning the names of every non-empty relation from the Requirements list — validate: unit-visible via the tests below.
- [x] 5. Call it in the `DELETE /api/users/me` handler AFTER the password check and INSIDE the delete transaction, throwing the new exception when the list is non-empty — validate: `Wrong_password_is_rejected_before_the_ownership_check` passes.
- [x] 6. Wrap the `SaveChanges`/`DeleteAsync` path so a `DbUpdateException` whose inner exception is a PostgreSQL foreign-key violation (SQLSTATE `23503`) is rethrown as the same `409` — validate: no code path can return a `500` for this cause.
- [x] 7. Confirm the refusal path performs no writes: the transaction is rolled back and `RevokeAllAsync` / the cookie clear are NOT reached — validate: `Refused_deletion_leaves_the_session_usable` passes.
- [x] 8. Add the remaining four tests from the Test plan — validate: `dotnet test backend/tests/Gones.IntegrationTests --filter AccountDeletion` all green.
- [x] 9. Refactor the relation list into a single table-driven declaration — validate: suite still green after the refactor.
- [x] 10. Regenerate the API surface if the error contract changed — validate: `npm run api:check` exits 0 with no drift.
- [x] 11. Update `docs/adr/0025-hard-account-deletion.md` with a short "Restricted relations" subsection recording that organizer-owned rows block deletion with a `409` and that reassignment is deliberately deferred — validate: the section exists and names the seven columns.

## Outputs

- Files touched: `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, `backend/src/Gones.Api/Errors/ApiExceptions.cs`, `backend/tests/Gones.IntegrationTests/AccountDeletionTests.cs`, `docs/adr/0025-hard-account-deletion.md`, possibly `backend/openapi/gones.json` + `src/app/api/generated/gones-api.ts`.
- Public API / behavior change: `DELETE /api/users/me` gains a `409 account_owns_records` response. The `204` and `400` paths are unchanged.
- Migrate / config: none. No new migration.

## Validation

- [x] `dotnet test backend/tests/Gones.IntegrationTests --filter AccountDeletion` green, with the new tests named in the output
- [x] `npm run backend:test` green
- [x] `npm run api:check` exits 0
- [x] `npm run test` / `npm run lint` / `npm run typecheck` / `npm run build` green
- [x] manual check against the running stack: register a throwaway organizer, give them a tournament, call `DELETE /api/users/me` with the right password, observe `409` and confirm the account still exists and still authenticates
- [x] app functional — a plain user can still delete their account and receives `204`
- [x] commit msg draft: `fix(account): refuse self-deletion with 409 when the account owns organizer records`
