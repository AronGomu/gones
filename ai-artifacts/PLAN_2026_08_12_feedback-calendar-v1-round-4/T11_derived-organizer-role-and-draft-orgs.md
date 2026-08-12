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

## Repair

The role derivation shipped in `bde7b3a` only ran on two of the five paths that write organization
memberships, so the system kept minting fresh violations of the very invariant the ticket
established: `OrganizationService.CreateAsync` left the new owner a plain `User`,
`OrganizationService.TransferOwnershipAsync` left an incoming owner who was not a member yet a plain
`User`, and `AdminAccountService.CloseAsync` handed organizations to a successor without deriving
their role. Review also found the two services locking the same two rows in opposite orders.

**Lock order chosen: `organizations` → `organization_members` → `asp_net_users` → the rows that hang
off a user (`user_profiles`, `refresh_sessions`, `external_identities`), several rows of one table in
ascending id order.** The derived role is a *consequence* of the membership rows, so the subject's
user row can only be locked after the rows that decide it — that fixes the order, and every
organization write path already followed it. Only `AdminAccountService.CloseAsync` locked the other
way (`AdminAccountService.cs:76`, user before organization), so it is the one that moved: its
pre-checks now read the subject unlocked, the user locks are taken after the organization work, and
every check that guards the write is re-run under those locks. The single exception is
`CreateAsync`, which locks the owner before inserting the organization — the only other rows it
touches are ones it creates itself and no other transaction can see, so it cannot be part of a wait
cycle. The order is written down on `OrganizationMembershipRoleService`, next to the reason for it.

Losing a lock race no longer leaves as a 500 either. `ApiExceptionHandler` maps Postgres `40P01`
(deadlock detected) and `40001` (serialization failure) anywhere in the exception chain to the usual
409 `conflict`. That is deliberately in the handler and not a `DbUpdateException` catch in
`RemoveMemberAsync`: Postgres raises those from a locking `SELECT ... FOR UPDATE` too, which no
`SaveChangesAsync` catch would ever see.

- [x] R1. `OrganizationService.CreateAsync` derives the owner's role.
      *evidence:* `OrganizationService.cs:74` — sync between `SaveChangesAsync` and `CommitAsync`.
      Live, against the Docker stack:
      ```
      owner … global_role before = User
      owner token before create, GET /api/users/me/organizations -> 200
      POST /api/admin/organizations -> 201
      owner global_role after create = Organizer   audit organization.role.derived = 1
      same owner token, GET /api/users/me/organizations -> 401
      admin-owned org create -> 201; admin owner global_role = Admin; derived=0 unchanged=1
      admin owner token still works, GET /api/admin/organizations -> 200
      ```
      Integration: `OrganizationApiTests.Creating_an_organization_derives_the_owner_role`.
      *criterion:* an owner who is `User` at creation ends `Organizer`, their in-flight token is
      refused on the next request, and an `Admin` owner stays `Admin`.
- [x] R2. `OrganizationService.TransferOwnershipAsync` derives both sides.
      *evidence:* `OrganizationService.cs:438` — both user ids handed to the sync in ascending id
      order. Live:
      ```
      heir … global_role before = User
      POST /api/organizations/{id}/transfer-ownership -> 204
      heir global_role after transfer = Organizer   derived = 1
      outgoing owner global_role = Organizer (still a member)
      heir token from before, GET /api/users/me/organizations -> 401
      DELETE outgoing owner membership -> 204; their global_role = User
      transfer to an Admin -> 204; admin heir global_role = Admin; derived=0
      ```
      Integration: `OrganizationApiTests.Transferring_ownership_derives_both_roles`.
      *criterion:* both users end at the role their memberships imply and an `Admin` is not moved.
- [x] R3. `AdminAccountService.CloseAsync` derives the incoming owners' roles.
      *evidence:* `AdminAccountService.cs:199` — the transfer targets are synced inside the closure
      transaction. Live:
      ```
      closing account global_role = Organizer; successor global_role = User
      POST /api/admin/users/{id}/disable -> 204
      successor global_role after closure = Organizer   derived = 1
      successor token from before, GET /api/users/me/organizations -> 401
      closed account global_role = User; memberships left = 0
      closure with an Admin successor -> 204; admin successor global_role = Admin; derived=0 unchanged=1
      ```
      Integration: `AdminAuditAndClosureTests.Closing_an_account_derives_the_incoming_owner_roles`.
      *criterion:* the account that inherits an organization comes out an `Organizer`, an `Admin`
      successor stays `Admin`, and the closed account keeps neither membership nor role.
- [x] R4. A closure that empties an organization returns it to Draft with no stale `Organizer`.
      *evidence:* a closure only empties an organization that is soft-deleted — a live organization
      the subject solely owns demands an ownership transfer first (`missing_owner_transfer`), so it
      always keeps its new owner. Live:
      ```
      lone owner global_role = Organizer
      soft delete the organization -> 204
      close the only member -> 204; their global_role = User
      restore the organization -> 204
      organization member count = 0 (Draft)
      ```
      Integration: `AdminAuditAndClosureTests.Closing_the_only_member_of_a_deleted_organization_returns_it_to_draft`.
      *criterion:* the organization comes back as a 0-member Draft and the closed account is `User`.
- [x] R5. One lock order in both services, and a lost race that answers cleanly.
      *evidence:* the order at the database level, on the live stack — the two old orders deadlock,
      the one new order does not:
      ```
      === BEFORE: OrganizationService (organization -> user) vs the old AdminAccountService (user -> organization) ===
        [org->user] ERROR:  deadlock detected
        [org->user] DETAIL:  Process 11763 waits for ShareLock on transaction 1947; blocked by process 11770.
        [org->user] Process 11770 waits for ShareLock on transaction 1946; blocked by process 11763.
        [org->user] CONTEXT:  while locking tuple (0,9) in relation "asp_net_users"
        [org->user] ROLLBACK
      === AFTER: both services take the organization first ===
        [A org->user] COMMIT
        [B org->user] COMMIT
      ```
      And head-on through the API, 6 rounds of closure versus member removal on the same account:
      ```
      round 0: disable=204 removeMember=409(conflict) -> victim=User memberships=0 mate=Organizer org=1
      … rounds 1-5 identical …
      5xx answers: 0
      deadlock aborts in the API log: 0
      internal_error answers: 0
      ```
      Integration: `AdminAuditAndClosureTests.Closure_racing_a_membership_change_answers_cleanly`
      (8 rounds) and `ApiBoundaryTests.Lost_lock_races_are_mapped_to_a_conflict` (`40P01` and `40001`
      both map to 409 `conflict`, never 500).
      *criterion:* both services take the organization row before the user row, and two overlapping
      operations on one account end in two mapped answers — no 500, no raw deadlock abort.

### Repair validation

- [x] `dotnet build backend/Gones.sln` — `Build succeeded. 0 Warning(s) 0 Error(s)`
- [x] targeted integration runs — `OrganizationApiTests` 13 passed, `AdminAuditAndClosureTests`
      7 passed, `ApiBoundaryTests` 44 passed, `TournamentPublicationApiTests`+`TournamentProposalTests`
      36 passed, `TournamentProposalDecisionTests` 22 passed,
      `TournamentRegistrationApiTests`+`TournamentLifecycleApiTests`+`MigrationImportServiceTests`
      25 passed; 0 failed in each
- [x] `dotnet test backend/tests/Gones.UnitTests` 198 passed, `backend/tests/Gones.ArchitectureTests`
      17 passed, 0 failed
- [x] `npm run test` (109 files / 1000 tests passed), `npm run lint` (`All files pass linting.`),
      `npm run typecheck` (clean), `npm run api:check` (exit 0 — the API surface did not move)
- [x] `Admin` is never moved by any of the three paths — see R1, R2 and R3 evidence
      (`derived=0`, `unchanged=1` on each, admin token still answering 200 afterwards)
