# T6: `DELETE /api/users/me` hard delete

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T1
**Commit outcome:** A signed-in user can permanently delete their own account by supplying their current password; the row and everything owned by it are gone from the database.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is the backend half of Profile §11 ("Supprimer Compte" with a password-confirmation dialog, "make sure to add logic for account deletion in backend if not already existing").
- This slice: the endpoint, the cascade rules and the audit trail. The UI arrives in T11.
- Out of scope here: any UI, the settings page merge, admin-initiated deletion (`POST /api/admin/users/{id}/disable` already exists and stays).
- Assumptions in force: **A7** — deletion is a hard delete (user answer). Audit rows survive with `actor_id` set to `NULL`.

## Requirements

- `DELETE /api/users/me` requires `AuthorizationPolicies.User` and a JSON body `{ "currentPassword": "…" }`.
- A wrong or missing password returns `400` with a validation problem naming `currentPassword`; it never returns `401`, so a caller cannot use the endpoint as a password oracle distinguishing "bad password" from "not signed in".
- On success: the `ApplicationUser`, its `UserProfile`, refresh sessions, external identities, account-action tokens and tournament registrations are removed; `audit_records.actor_id` referencing the user becomes `NULL`; the response is `204` and clears the refresh cookie.
- An audit record `account.deleted` is written **before** the delete, with `actor_id = NULL` and the user id only in `entity_id`.
- The endpoint is rate-limited with the same IP policy the other sensitive auth endpoints use.
- The last remaining `Admin` cannot delete themselves: `409` with problem code `lastAdmin`.

## Inputs

- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:53-64` — the group: `var users = app.MapGroup("/api/users").RequireAuthorization(AuthorizationPolicies.User);` followed by `users.MapGet("/me", …)`, `users.MapPatch("/me", …)`, `users.MapGet("/me/sessions", …)`, `users.MapDelete("/me/sessions/{id:guid}", …)`, then `auth.MapAccountLifecycleEndpoints(users);`.
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:355-359` — `private static Guid CurrentUserId(ClaimsPrincipal principal)` reads claim `sub` then `ClaimTypes.NameIdentifier`, throwing `AuthenticationFailedException` when unparsable.
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:380-401` — `NewAudit(actorId, action, entityType, entityId, diff, clock)` and `WriteAuditAsync(...)` helpers.
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:411-412` — `private static ApiValidationException Validation(string field, string message)`.
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:277-281` — the existing pattern for password re-authentication: `if (… string.IsNullOrEmpty(request.CurrentPassword) || !await userManager.CheckPasswordAsync(user, request.CurrentPassword)) { metrics.RecordAuthRejection("profile_sensitive_change"); throw Validation(nameof(request.CurrentPassword), "…"); }`.
- `backend/src/Gones.Api/Identity/RefreshSessionService.cs` — `RefreshSessionService.RevokeAllAsync(Guid userId, CancellationToken)`; `RefreshCookie` with `Name = "gones_refresh"`, `Path = "/api/auth"`, `Issue`/`Clear`. **If T2 already landed, `RefreshCookie` is an injected singleton, not a static class — use whichever form the file currently has.**
- `backend/src/Gones.Api/Errors/` — `ResourceConflictException`, `ApiValidationException`, `AuthenticationFailedException`, `ResourceNotFoundException`.
- `backend/src/Gones.Api/Security/AuthRateLimiting.cs` — `AuthRateLimiting.IpPolicy` used via `.RequireRateLimiting(AuthRateLimiting.IpPolicy)`.
- `backend/src/Gones.Api/Admin/AdminEndpoints.cs:32` — `admin.MapGet("/users/{userId:guid}/closure-impact", GetClosureImpactAsync)` already computes what a closure touches; reuse its query shape to enumerate dependants, do not duplicate it.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs` — `DbSet` names: `UserProfiles`, `AuditRecords`, plus the Identity, registration and organization sets.
- `backend/src/Gones.Domain/Identity/ApplicationUser.cs` — has `GlobalRole` (`"User" | "Organizer" | "Admin"`).
- Regeneration: `npm run api:generate` (needs Postgres up: `docker compose up -d postgres`); `npm run api:check` verifies drift.
- **From Depends (T1):** nothing on the backend.

## TDD

1. **Red** — add `backend/tests/Gones.IntegrationTests/AccountDeletionTests.cs` with all seven rows below; they fail because the route does not exist (404).
2. **Green** — add the endpoint, the FK rule change and the migration.
3. **Refactor** — extract the dependant-cleanup into a private `DeleteUserGraphAsync` so T17's proposal cleanup can reuse it.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Delete_me_requires_authentication` | no bearer token | `401` |
| `Delete_me_rejects_a_wrong_password` | `{"currentPassword":"wrong"}` | `400`, problem `errors.currentPassword` non-empty, user still exists |
| `Delete_me_rejects_an_empty_password` | `{"currentPassword":""}` | `400` naming `currentPassword` |
| `Delete_me_removes_the_account` | correct password | `204`; `GET /api/users/me` with the old token → `401`; `SELECT count(*) FROM user_profiles WHERE user_id = …` is 0 |
| `Delete_me_clears_the_refresh_cookie` | correct password | response `Set-Cookie: gones_refresh=; expires=` in the past |
| `Delete_me_nulls_the_audit_actor` | user with prior `profile.changed` audit rows | rows still exist, `actor_id IS NULL` |
| `Delete_me_refuses_the_last_admin` | sole `Admin` account | `409`, problem detail contains `lastAdmin`, account still exists |

Run: `npm run backend:test`

## Impl steps

- [x] 1. Ensure the EF CLI exists: `dotnet ef --version`; install with `dotnet tool install --global dotnet-ef` if missing. → `dotnet ef --version` prints `Entity Framework Core .NET Command-line Tools 10.0.10` (tool at `~/.dotnet/tools`, needs `DOTNET_ROOT` exported).
- [x] 2. Configure the `AuditRecord.ActorId` relationship with `.OnDelete(DeleteBehavior.SetNull)`; the FK column was already nullable (`Guid? ActorId`). → done in `SharedRecordConfigurations.cs` (`AuditRecordConfiguration`, where the audit entity is actually configured, not `IdentityRecordConfigurations.cs`); `SELECT confdeltype` on `fk_audit_records_asp_net_users_actor_id` returns `n` (SET NULL).
- [x] 3. Confirmed: `UserProfile`, `RefreshSession`, `ExternalIdentity`, `AccountActionToken`, `UserEmailHistory`, `OAuthAttempt`, `OrganizationMember` were already `Cascade`. `TournamentRegistrationAttempt.UserId` was `Restrict` → set to `Cascade`; `SELECT confdeltype` returns `c`.
- [x] 4. Ran with `--startup-project backend/src/Gones.Infrastructure` (`Gones.Api` has no `EntityFrameworkCore.Design` reference). → `20260808164636_AllowAccountHardDelete.cs`; `dotnet ef database update` then rollback to `SplitProfileLocationAndBirthDate` then update again all succeeded on a scratch database.
- [x] 5. In `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, add to `MapLocalIdentityEndpoints`, immediately after the `users.MapPatch("/me", …)` registration: → registered verbatim; `Delete_me_requires_authentication` now reaches authorization (401) instead of 405.
  ```
  users.MapDelete("/me", DeleteAccountAsync)
      .RequireRateLimiting(AuthRateLimiting.IpPolicy)
      .AddEndpointFilter<DataAnnotationsValidationFilter>()
      .Produces(StatusCodes.Status204NoContent)
      .ProducesProblem(StatusCodes.Status400BadRequest)
      .ProducesProblem(StatusCodes.Status409Conflict);
  ```
- [x] 6. Added `internal sealed record DeleteAccountRequest([property: Required, StringLength(128)] string CurrentPassword);` at the bottom of the file. → `Delete_me_rejects_an_empty_password` passes on the `[Required]` rejection.
- [x] 7. Implement `private static async Task<IResult> DeleteAccountAsync(DeleteAccountRequest request, ClaimsPrincipal principal, HttpContext httpContext, UserManager<ApplicationUser> userManager, GonesDbContext database, RefreshSessionService sessionService, IClock clock, OperationalMetrics metrics, CancellationToken cancellationToken)`. → signature matches the ticket plus the injected `RefreshCookie cookie` (T2 landed, so `RefreshCookie` is no longer static).
- [x] 8. In it: resolve `userId = CurrentUserId(principal)`, load the user via `userManager.FindByIdAsync`, throw `AuthenticationFailedException` when null. → 401 when the principal resolves to no account.
- [x] 9. Re-authenticate: `if (string.IsNullOrEmpty(request.CurrentPassword) || !await userManager.CheckPasswordAsync(user, request.CurrentPassword)) { metrics.RecordAuthRejection("account_delete"); throw Validation(nameof(request.CurrentPassword), "Current password is required and must be valid to delete the account."); }` → `Delete_me_rejects_a_wrong_password` and `Delete_me_rejects_an_empty_password` pass, both 400 naming `currentPassword`.
- [x] 10. Guard the last admin: when `user.GlobalRole == "Admin"` and `await database.Users.CountAsync(u => u.GlobalRole == "Admin", cancellationToken) <= 1`, throw `new ResourceConflictException("lastAdmin")` (add that constructor overload if the type has none). → `ResourceConflictException` gained an optional `code` parameter; `Delete_me_refuses_the_last_admin` passes with 409 and `code = lastAdmin`.
- [x] 11. Open a transaction. Write the audit row first: `database.AuditRecords.Add(NewAudit(null, "account.deleted", "user", userId.ToString("D"), "{\"outcome\":\"hardDeleted\"}", clock));` then `await database.SaveChangesAsync(cancellationToken);`. → `Delete_me_nulls_the_audit_actor` finds exactly one `account.deleted` row with a null actor.
- [x] 12. Null the historical actor: `await database.AuditRecords.Where(record => record.ActorId == userId).ExecuteUpdateAsync(setters => setters.SetProperty(record => record.ActorId, (Guid?)null), cancellationToken);` → required narrowing the `audit_records` append-only trigger to tolerate this single change (see Assumptions); `SELECT count(*) WHERE actor_id = user` is 0 afterwards.
- [x] 13. Revoke sessions: `await sessionService.RevokeAllAsync(userId, cancellationToken);` → called before the transaction is opened, because `RevokeAllAsync` opens its own and EF rejects a nested one.
- [x] 14. Delete the graph: remove the `UserProfile` row, then `var result = await userManager.DeleteAsync(user); if (!result.Succeeded) throw IdentityValidation(result.Errors);`. Commit the transaction. → extracted as `DeleteUserGraphAsync`; `Delete_me_removes_the_account` finds 0 profiles, 0 sessions, 0 action tokens, 0 external identities and no user row.
- [x] 15. Clear the cookie (`RefreshCookie.Clear(httpContext.Response)` or `cookie.Clear(...)` per the file's current shape), record `metrics.RecordAuthSuccess("account_delete")`, return `Results.NoContent()`. → `Delete_me_clears_the_refresh_cookie` asserts `gones_refresh=;` with an expiry in the past.
- [x] 16. Added `backend/tests/Gones.IntegrationTests/AccountDeletionTests.cs` with all seven Test plan rows, plus an eighth guarding the narrowed append-only rule. → red first (7/7 failed, route absent), then `Failed: 0, Passed: 8`.
- [x] 17. Run `npm run backend:test`. → `Gones.UnitTests 194/194`, `Gones.ArchitectureTests 14/14`, `Gones.IntegrationTests 298/301` with the 3 stragglers failing in `InitializeAsync` on this host's rootless-Docker `bind: address already in use`; re-running `TournamentSchedulerTests|LocalIdentityApiTests` gives `Failed: 0, Passed: 39`.
- [x] 18. Ran `npm run api:generate` against the running Postgres. → `backend/openapi/gones.json` +53 lines and `src/app/api/generated/gones-api.ts` +73 lines, both purely additive.
- [x] 19. Added `deleteAccount(currentPassword: string): Promise<void>` to `src/app/auth/auth.service.ts`. → NSwag did generate `meDELETE(body: DeleteAccountRequest)`; the service calls it then `clear()`.
- [x] 20. Added `src/app/auth/auth.service.delete-account.test.ts`. → 2 passing: one asserts a single `meDELETE({ currentPassword })` call plus null `profile()`, cleared token and a fired session-scope reset; one asserts a rejected password leaves the session intact.
- [x] 21. Ran all five. → `Test Files 56 passed (56) / Tests 364 passed (364)`; `All files pass linting.`; typecheck silent; `Application bundle generation complete.`; `api:check` exits 0 with no drift.

## Outputs

- Files created: `backend/src/Gones.Infrastructure/Persistence/Migrations/*_AllowAccountHardDelete.cs` (+ Designer), `backend/tests/Gones.IntegrationTests/AccountDeletionTests.cs`, `src/app/auth/auth.service.delete-account.test.ts`.
- Files touched: `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, `backend/src/Gones.Infrastructure/Persistence/IdentityRecordConfigurations.cs`, `backend/src/Gones.Infrastructure/Persistence/GonesDbContextModelSnapshot.cs`, `src/app/api/generated/gones-api.ts`, `src/app/auth/auth.service.ts`.
- Public API / behavior change: new `DELETE /api/users/me`; `audit_records.actor_id` becomes `ON DELETE SET NULL`.
- Migrate / config: one EF migration.

## Validation

- [x] `npm run backend:test` passes → 194 + 14 + 298/301 (3 Testcontainers port-bind flakes, green on re-run: `Failed: 0, Passed: 39`)
- [x] `npm run test && npm run lint && npm run typecheck && npm run build` pass → 364/364 vitest, lint clean, tsc clean, bundle built
- [x] `npm run api:check` reports no drift → exit 0, no output
- [x] manual check against the rebuilt docker stack (API running as `gones_app`): wrong password → `400` with `errors.CurrentPassword`; correct password → `204` and `Set-Cookie: gones_refresh=; expires=Thu, 01 Jan 1970 00:00:00 GMT`; the follow-up `GET /api/users/me` with the same token → `401`; in the database `users=0`, `profiles=0`, `audit_rows=4 non_null_actor=0`, `account_deleted_actor_is_null=true`
- [x] app functional — no UI calls the endpoint yet. `cypress/e2e/auth-session-persistence.cy.js` 2/2 and `cypress/e2e/auth-profile.cy.js` 5/6, the single failure being the known port-8081 provider-linking case that only passes under the release Docker profile.
- [x] commit msg draft: `feat(account): allow a user to permanently delete their own account`
