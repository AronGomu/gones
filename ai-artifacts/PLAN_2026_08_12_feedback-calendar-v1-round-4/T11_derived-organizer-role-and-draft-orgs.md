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

- [ ] 1. Add the nine integration tests; run `dotnet test backend/tests/Gones.IntegrationTests` — red.
- [ ] 2. Add `OrganizationIsDraftException` to `backend/src/Gones.Api/Errors/ApiExceptions.cs`.
- [ ] 3. Create `OrganizationMembershipRoleService.cs` per the requirements.
- [ ] 4. Register it in DI next to `AdminRoleService`.
- [ ] 5. Inject it into `OrganizationService` (primary constructor parameter) and call it at the end of `AddMemberAsync` and `RemoveMemberAsync`, inside the transaction.
- [ ] 6. Relax the last-member/owner guard in `RemoveMemberAsync`; keep the authorization guard.
- [ ] 7. Add the draft gate in `TournamentPublicationEndpoints.PublishTournamentAsync` and in the proposal-approval publish path.
- [ ] 8. Run `dotnet test backend/tests/Gones.IntegrationTests` and `dotnet test backend/tests/Gones.UnitTests` — green.
- [ ] 9. Run `dotnet test backend/tests/Gones.ArchitectureTests` (namespace/dependency rules).

## Outputs

- Files touched: `backend/src/Gones.Api/Organizations/OrganizationMembershipRoleService.cs` (new), `OrganizationService.cs`, `backend/src/Gones.Api/Errors/ApiExceptions.cs`, `backend/src/Gones.Api/Program.cs`, `backend/src/Gones.Api/Tournaments/TournamentPublicationEndpoints.cs`, `TournamentProposalEndpoints.cs` (if it publishes), integration tests.
- API change: new 409 `organization_is_draft`; removing the last member no longer conflicts.

## Validation

- [ ] `dotnet test backend/Gones.sln` passes
- [ ] manual check: add a member to an org through the API, confirm the user's role flips to Organizer and their session must re-authenticate
- [ ] app functional — publishing from a staffed organization is unchanged
- [ ] commit msg draft: `feat(orgs): derive the Organizer role from membership and gate draft orgs`
