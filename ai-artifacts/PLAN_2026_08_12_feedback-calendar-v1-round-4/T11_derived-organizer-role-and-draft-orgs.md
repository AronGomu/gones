# T11: Derived Organizer role + draft orgs

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T10
**Commit outcome:** adding a user to an organization promotes `User` → `Organizer`, removing their last membership demotes `Organizer` → `User`, `Admin` is never changed, removing the last member of an organization is allowed and returns it to Draft, and a Draft organization cannot publish an event.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md`. This block builds the admin organization workbench and the membership rules behind it.
- This slice: the write rules. Today `globalRole` is only ever changed by an admin through `POST /api/admin/users/{id}/roles/{role}/grant|revoke`, entirely independently of membership.
- Out of scope here: the heal migration for legacy rows (T12), the UI (T13), the event-create picker (T14).
- Assumptions in force: Draft = zero members, derived, never stored. No 409 on removing the last member. `Admin` accounts keep `Admin` regardless of membership. An organization that is Draft may still be edited and restored; it may not publish.

## Requirements

- New service `backend/src/Gones.Api/Organizations/OrganizationMembershipRoleService.cs` with
  `internal sealed class OrganizationMembershipRoleService(GonesDbContext database, RefreshSessionService sessionService, IClock clock)` exposing
  `Task SyncAfterMembershipChangeAsync(Guid actorUserId, Guid subjectUserId, CancellationToken cancellationToken)`.
  Behaviour: load the subject `FOR UPDATE`; count their `OrganizationMembers` rows joined to non-deleted organizations; if the subject is `Admin`, write an audit record `organization.role.unchanged` and return; else if count > 0 and role != `Organizer`, assign `Organizer`; else if count == 0 and role == `Organizer`, assign `User`; else audit `organization.role.unchanged`. On an actual change: `subject.AssignGlobalRole(next)`, rotate `SecurityStamp`, `await sessionService.RevokeAllForRoleChangeAsync(subjectUserId, ct)`, and add an audit record with action `organization.role.derived` and diff `{ before, after, membershipCount, fields: ["globalRole","securityStamp"] }`.
  Copy the transaction and audit shape from `backend/src/Gones.Api/Admin/AdminRoleService.cs` (`ChangeRoleAsync`).
- `OrganizationService.AddMemberAsync` calls the sync inside its existing transaction, after `SaveChangesAsync` and before `CommitAsync`.
- `OrganizationService.RemoveMemberAsync` calls the sync for the removed user in the same way.
- `OrganizationService.RemoveMemberAsync` must NOT throw when the removed member is the last one. Locate the current owner/last-member guard (the `ownerCount` check around line 265) and change it so removing the last Owner is allowed; keep any guard that protects a non-owner actor from removing an Owner.
- Registration of the service in DI: add it where `AdminRoleService` is registered (`grep -rn "AdminRoleService" backend/src/Gones.Api/Program.cs`).
- Publish gate: in `backend/src/Gones.Api/Tournaments/TournamentPublicationEndpoints.cs`, after the organization is resolved (`access.RequireMemberAsync(...)` around line 287), refuse publication when the organization has zero members with a new `ApiException` code `organization_is_draft` (409). Add
  `public sealed class OrganizationIsDraftException() : ApiException("organization_is_draft", "Organization has no organizer and cannot publish.", StatusCodes.Status409Conflict);`
  to `backend/src/Gones.Api/Errors/ApiExceptions.cs`.
- The same gate applies to the proposal-approval publish path if it publishes without going through the endpoint — check `backend/src/Gones.Api/Tournaments/TournamentProposalEndpoints.cs` for a call into `PublishTournamentAsync` and cover it with a test.

## Inputs

- `backend/src/Gones.Api/Organizations/OrganizationService.cs` — `AddMemberAsync(Guid actorUserId, Guid organizationId, Guid memberUserId, string role, bool actorIsAdmin, CancellationToken)` (line ~190, transaction + `access.RequireOwnerAsync` + `LockOrganizationAsync` + verified-email check + duplicate check + audit `organization.member.added`); `RemoveMemberAsync(Guid actorUserId, Guid organizationId, Guid memberUserId, bool actorIsAdmin, CancellationToken)` (line ~245, `FOR UPDATE` row lock, `ownerCount` check).
- `backend/src/Gones.Api/Admin/AdminRoleService.cs` — the full pattern to copy: `FromSqlInterpolated($"SELECT * FROM asp_net_users WHERE id = {subjectUserId} FOR UPDATE")`, `subject.AssignGlobalRole(nextRole)`, `subject.SecurityStamp = Guid.NewGuid().ToString("N")`, `sessionService.RevokeAllForRoleChangeAsync`, `NewAudit(...)`.
- `backend/src/Gones.Domain/Identity/GlobalRoles.cs` — `GlobalRoles.User`, `GlobalRoles.Organizer`, `GlobalRoles.Admin`.
- `backend/src/Gones.Api/Tournaments/TournamentPublicationEndpoints.cs` — `PublishTournamentAsync` resolves the org at line ~287.
- **From Depends:** T10 added `GET /api/admin/organizations/{id}/members` and `AdminOrganizationResponse.MemberCount` / `.IsDraft` — the UI reads them later; this ticket does not change them.

## TDD

1. **Red** — integration tests in `backend/tests/Gones.IntegrationTests/OrganizationApiTests.cs` and `PublicTournamentApiTests.cs`.
2. **Green** — service + call sites + publish gate.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `adding a first membership promotes the user` | plain `User` added to an org | user `globalRole == "Organizer"`, audit `organization.role.derived` present |
| `adding a second membership keeps Organizer` | organizer added to a second org | role unchanged, audit `organization.role.unchanged` |
| `removing the last membership demotes to User` | organizer with 1 org, member removed | `globalRole == "User"` |
| `removing one of two memberships keeps Organizer` | organizer with 2 orgs | `globalRole == "Organizer"` |
| `admin keeps the Admin role on both operations` | admin added then removed | `globalRole == "Admin"` throughout |
| `removing the last member of an organization succeeds` | org with 1 member, admin removes them | 204, org still exists, `memberCount == 0`, `isDraft == true` |
| `a draft organization cannot publish` | admin publishes for a member-less org | 409 with code `organization_is_draft` |
| `a draft organization can still be edited and restored` | update + restore calls | 200/204 as before |
| `role change revokes refresh sessions` | promoted user's old refresh token | refresh returns 401 |

## Impl steps

- [x] 1. Add the nine integration tests; run `dotnet test backend/tests/Gones.IntegrationTests` — red.
      *evidence:* `--filter FullyQualifiedName~OrganizationApiTests` → `Failed! - Failed: 5, Passed: 6, Total: 11`; the two publish-gate facts → `Failed! - Failed: 2, Passed: 0, Total: 2` (`Expected: Conflict / Actual: Created` and `Expected: Conflict / Actual: OK`).
      *criterion:* every new `[Fact]` exists in the named file and the targeted run reports failures caused by the missing behaviour (not by compile errors in unrelated code).
- [x] 2. Add `OrganizationIsDraftException` to `backend/src/Gones.Api/Errors/ApiExceptions.cs`.
      *evidence:* `ApiExceptions.cs:63` — `public sealed class OrganizationIsDraftException() : ApiException("organization_is_draft", …, StatusCodes.Status409Conflict);`
      *criterion:* `grep -n organization_is_draft backend/src/Gones.Api/Errors/ApiExceptions.cs` prints the new type.
- [x] 3. Create `OrganizationMembershipRoleService.cs` per the requirements.
      *evidence:* `backend/src/Gones.Api/Organizations/OrganizationMembershipRoleService.cs` exists (86 lines); `dotnet build backend/Gones.sln` → `Build succeeded. 0 Warning(s) 0 Error(s)`
      *criterion:* file exists at `backend/src/Gones.Api/Organizations/OrganizationMembershipRoleService.cs` and `dotnet build backend/Gones.sln` succeeds.
- [x] 4. Register it in DI next to `AdminRoleService`.
      *evidence:* `Program.cs:114` — `builder.Services.AddScoped<OrganizationMembershipRoleService>();` directly under the `AdminRoleService` line
      *criterion:* `grep -n OrganizationMembershipRoleService backend/src/Gones.Api/Program.cs` prints the `AddScoped` line.
- [x] 5. Inject it into `OrganizationService` (primary constructor parameter) and call it at the end of `AddMemberAsync` and `RemoveMemberAsync`, inside the transaction.
      *evidence:* `OrganizationService.cs:17` ctor param; calls at `:232` and `:295`, both between `SaveChangesAsync` and `CommitAsync`. `Membership_changes_derive_the_global_organizer_role` and `Admin_keeps_the_admin_role_on_both_membership_operations` pass.
      *criterion:* both call sites sit between `SaveChangesAsync` and `CommitAsync`; the promote/demote integration tests go green.
- [x] 6. Relax the last-member/owner guard in `RemoveMemberAsync`; keep the authorization guard.
      *evidence:* `EnsureCanRemove(target, ownerCount, memberCount)` now only refuses when the sole Owner would leave other members behind. `Sole_owner_cannot_be_demoted_without_transfer_and_db_enforces_one_owner` proves 409 with a peer present and 204 once alone; `RequireOwnerAsync` untouched, cross-org IDOR facts still green.
      *criterion:* removing the only member returns 204; `RequireOwnerAsync` still refuses a non-owner actor (existing IDOR tests stay green).
- [x] 7. Add the draft gate in `TournamentPublicationEndpoints.PublishTournamentAsync` and in the proposal-approval publish path.
      *evidence:* one gate inside `PublishTournamentAsync`'s transaction covers both callers. `Draft_organization_cannot_publish_but_a_staffed_one_still_can` → 409 `organization_is_draft` then 201 once staffed; `Approving_a_proposal_for_a_draft_organization_is_refused` → 409 `organization_is_draft`, proposal stays `Pending`, 0 tournaments.
      *criterion:* publishing for a member-less org returns 409 `organization_is_draft` on both the HTTP publish and the proposal-approval path.
- [x] 8. Run `dotnet test backend/tests/Gones.IntegrationTests` and `dotnet test backend/tests/Gones.UnitTests` — green.
      *evidence:* `OrganizationApiTests` → `Passed! - Failed: 0, Passed: 11`; `TournamentPublicationApiTests` → `Passed: 17`; `TournamentProposalDecisionTests` → `Passed: 22`; `AdminAuditAndClosureTests|PublicTournamentApiTests` → `Passed: 7`; `Gones.UnitTests` → `Passed: 198`.
      *criterion:* targeted `--filter` runs for the touched classes pass; `Gones.UnitTests` passes whole (see the host-defect note under Validation for the full integration run).
- [x] 9. Run `dotnet test backend/tests/Gones.ArchitectureTests` (namespace/dependency rules).
      *evidence:* `Passed! - Failed: 0, Passed: 17, Skipped: 0, Total: 17`
      *criterion:* the run reports 0 failed.
- [x] 10. Update the tests that asserted the old "sole owner cannot be removed" behaviour.
      *evidence:* `OrganizationApiTests.Sole_owner_cannot_be_demoted_without_transfer_and_db_enforces_one_owner` (renamed, still asserts the demote 409 + the DB one-owner index) and `OrganizationDomainTests.Sole_owner_cannot_be_removed_or_demoted_without_transfer` (new `memberCount: 1` case) both pass.
      *criterion:* `OrganizationApiTests` and `OrganizationDomainTests` compile and pass with the relaxed rule, and still assert the demote guard and the DB one-owner index.

## Outputs

- Files touched: `backend/src/Gones.Api/Organizations/OrganizationMembershipRoleService.cs` (new), `OrganizationService.cs`, `backend/src/Gones.Api/Errors/ApiExceptions.cs`, `backend/src/Gones.Api/Program.cs`, `backend/src/Gones.Api/Tournaments/TournamentPublicationEndpoints.cs`, `TournamentProposalEndpoints.cs` (if it publishes), integration tests.
- API change: new 409 `organization_is_draft`; removing the last member no longer conflicts.

## Validation

- [ ] `dotnet test backend/Gones.sln` passes — **left unchecked on purpose**: this host cannot run the full suite (Testcontainers `RootlessKit PortManager.AddPort(): bind: address already in use` on random classes; clean-tree control 6 failed / 366 passed). Gated instead on `dotnet build` + targeted `--filter` runs below.
- [x] `dotnet build backend/Gones.sln` succeeds with 0 errors — `Build succeeded. 0 Warning(s) 0 Error(s)`
- [x] targeted `dotnet test backend/tests/Gones.IntegrationTests --filter` runs for `OrganizationApiTests`, `TournamentPublicationApiTests`, `TournamentProposalDecisionTests` pass — 11 / 17 / 22 passed, 0 failed
- [x] `dotnet test backend/tests/Gones.UnitTests` and `dotnet test backend/tests/Gones.ArchitectureTests` pass — 198 and 17 passed, 0 failed
- [x] manual check: add a member to an org through the API, confirm the user's role flips to Organizer and their session must re-authenticate
      *evidence:* live sequence against the Docker stack on `127.0.0.1:5080` (API image rebuilt with `docker compose up -d --build --wait migrator permissions api`):
      ```
        userId=a6bcc9db-…  global_role=User      role claim in JWT = User
        POST /api/organizations/{id}/members -> 201
        global_role after add = Organizer      audit: organization.role.derived
        same old access token, GET /api/users/me/organizations -> 401
        same old refresh cookie, POST /api/auth/refresh   -> 401
        role claim in the new JWT = Organizer
        DELETE /api/organizations/{id}/members/{user} -> 204
        global_role after remove = User
        stale Organizer token, GET /api/users/me/organizations -> 401
        stale Organizer token, POST /api/tournaments/preview -> 401
        its refresh cookie, POST /api/auth/refresh -> 401
      ```
      **When it takes effect: immediately, on the very next request — not at the next token refresh.**
      `ValidateSecurityStampAndRoleAsync` (`AuthorizationPolicies.cs:110`) re-checks the security stamp
      *and* the baked-in `role` claim against the stored row on every authenticated call, so rotating the
      stamp kills the token in flight; revoking the refresh sessions closes the re-issue path too.
- [x] `Admin` is never moved by membership, in either direction
      *evidence:* same run — `admin global_role now = Admin` → `DELETE admin (the last member) -> 204` →
      `admin global_role after losing their last membership = Admin` → `admin token still works, GET /api/admin/organizations -> 200`
      → `re-add admin -> 201` → `admin global_role after being added = Admin`. Integration cover:
      `Admin_keeps_the_admin_role_on_both_membership_operations` (0 `organization.role.derived`, 2 `organization.role.unchanged`).
- [x] removing the last member returns the org to Draft and does not 409
      *evidence:* same run — `DELETE …/members/{admin} -> 204` then `name=T11 Club 1786542936 memberCount=0 isDraft=True`.
- [x] app functional — publishing from a staffed organization is unchanged
      *evidence:* same run, same payload and same preview ticket — draft org:
      `POST /api/tournaments -> {"code":"organization_is_draft",…} 409`; after `POST members -> 201`:
      `POST /api/tournaments -> {"id":"0438e508-…","slug":"t11-draft-cup-1786542936","status":"Published"} 201`.
      Previewing for a draft org still returns a ticket, so the gate is on publish alone.
- [x] `npm run test`, `npm run lint`, `npm run typecheck` pass
      *evidence:* `Test Files 109 passed (109) / Tests 1000 passed (1000)`; `All files pass linting.`; `tsc --noEmit` clean on both projects.
- [x] `npm run api:check` reports the generated client is up to date — exit 0, no output (no OpenAPI drift: the new 409 reuses the already-declared `Status409Conflict` on `POST /api/tournaments`).
- [ ] commit msg draft: `feat(orgs): derive the Organizer role from membership and gate draft orgs`
