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

- [ ] 1. Ensure the EF CLI exists: `dotnet ef --version`; install with `dotnet tool install --global dotnet-ef` if missing.
- [ ] 2. In `backend/src/Gones.Infrastructure/Persistence/IdentityRecordConfigurations.cs`, configure the `AuditRecord.ActorId` relationship with `.OnDelete(DeleteBehavior.SetNull)` and make the FK column nullable if it is not already.
- [ ] 3. Confirm the remaining user-owned relationships (`UserProfile`, refresh sessions, external identities, account action tokens, tournament registrations, organization memberships) are configured `DeleteBehavior.Cascade`; set any that are not.
- [ ] 4. Run `dotnet ef migrations add AllowAccountHardDelete --project backend/src/Gones.Infrastructure --startup-project backend/src/Gones.Api --output-dir Persistence/Migrations` and review the generated FK changes.
- [ ] 5. In `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, add to `MapLocalIdentityEndpoints`, immediately after the `users.MapPatch("/me", …)` registration:
  ```
  users.MapDelete("/me", DeleteAccountAsync)
      .RequireRateLimiting(AuthRateLimiting.IpPolicy)
      .AddEndpointFilter<DataAnnotationsValidationFilter>()
      .Produces(StatusCodes.Status204NoContent)
      .ProducesProblem(StatusCodes.Status400BadRequest)
      .ProducesProblem(StatusCodes.Status409Conflict);
  ```
- [ ] 6. Add `internal sealed record DeleteAccountRequest([property: Required, StringLength(128)] string CurrentPassword);` next to the other request records at the bottom of the file.
- [ ] 7. Implement `private static async Task<IResult> DeleteAccountAsync(DeleteAccountRequest request, ClaimsPrincipal principal, HttpContext httpContext, UserManager<ApplicationUser> userManager, GonesDbContext database, RefreshSessionService sessionService, IClock clock, OperationalMetrics metrics, CancellationToken cancellationToken)`.
- [ ] 8. In it: resolve `userId = CurrentUserId(principal)`, load the user via `userManager.FindByIdAsync`, throw `AuthenticationFailedException` when null.
- [ ] 9. Re-authenticate: `if (string.IsNullOrEmpty(request.CurrentPassword) || !await userManager.CheckPasswordAsync(user, request.CurrentPassword)) { metrics.RecordAuthRejection("account_delete"); throw Validation(nameof(request.CurrentPassword), "Current password is required and must be valid to delete the account."); }`
- [ ] 10. Guard the last admin: when `user.GlobalRole == "Admin"` and `await database.Users.CountAsync(u => u.GlobalRole == "Admin", cancellationToken) <= 1`, throw `new ResourceConflictException("lastAdmin")` (add that constructor overload if the type has none).
- [ ] 11. Open a transaction. Write the audit row first: `database.AuditRecords.Add(NewAudit(null, "account.deleted", "user", userId.ToString("D"), "{\"outcome\":\"hardDeleted\"}", clock));` then `await database.SaveChangesAsync(cancellationToken);`.
- [ ] 12. Null the historical actor: `await database.AuditRecords.Where(record => record.ActorId == userId).ExecuteUpdateAsync(setters => setters.SetProperty(record => record.ActorId, (Guid?)null), cancellationToken);`
- [ ] 13. Revoke sessions: `await sessionService.RevokeAllAsync(userId, cancellationToken);`
- [ ] 14. Delete the graph: remove the `UserProfile` row, then `var result = await userManager.DeleteAsync(user); if (!result.Succeeded) throw IdentityValidation(result.Errors);`. Commit the transaction.
- [ ] 15. Clear the cookie (`RefreshCookie.Clear(httpContext.Response)` or `cookie.Clear(...)` per the file's current shape), record `metrics.RecordAuthSuccess("account_delete")`, return `Results.NoContent()`.
- [ ] 16. Add `backend/tests/Gones.IntegrationTests/AccountDeletionTests.cs` with all seven Test plan rows.
- [ ] 17. Run `npm run backend:test`.
- [ ] 18. Start Postgres (`docker compose up -d postgres`) and run `npm run api:generate`; commit the regenerated `src/app/api/generated/gones-api.ts`.
- [ ] 19. Add `deleteAccount(currentPassword: string): Promise<void>` to `src/app/auth/auth.service.ts` delegating to the generated client method for `DELETE /api/users/me` (check the generated name after regeneration — NSwag derives it from the route, expect `meDELETE`).
- [ ] 20. Add `src/app/auth/auth.service.delete-account.test.ts` asserting the service calls the client method once with the password and clears local state on success (`profile()` becomes null via `clear()`).
- [ ] 21. Run `npm run test && npm run lint && npm run typecheck && npm run build && npm run api:check`.

## Outputs

- Files created: `backend/src/Gones.Infrastructure/Persistence/Migrations/*_AllowAccountHardDelete.cs` (+ Designer), `backend/tests/Gones.IntegrationTests/AccountDeletionTests.cs`, `src/app/auth/auth.service.delete-account.test.ts`.
- Files touched: `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, `backend/src/Gones.Infrastructure/Persistence/IdentityRecordConfigurations.cs`, `backend/src/Gones.Infrastructure/Persistence/GonesDbContextModelSnapshot.cs`, `src/app/api/generated/gones-api.ts`, `src/app/auth/auth.service.ts`.
- Public API / behavior change: new `DELETE /api/users/me`; `audit_records.actor_id` becomes `ON DELETE SET NULL`.
- Migrate / config: one EF migration.

## Validation

- [ ] `npm run backend:test` passes
- [ ] `npm run test && npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run api:check` reports no drift
- [ ] manual check: `curl -X DELETE -H "Authorization: Bearer …" -d '{"currentPassword":"…"}' http://127.0.0.1:5080/api/users/me` returns 204 and a second `GET /api/users/me` returns 401
- [ ] app functional — no UI calls the endpoint yet; every other auth flow unchanged
- [ ] commit msg draft: `feat(account): allow a user to permanently delete their own account`
