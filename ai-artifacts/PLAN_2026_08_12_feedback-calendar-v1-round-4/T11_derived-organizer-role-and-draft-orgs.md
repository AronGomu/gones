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

## Review repair

The round's final review found a privilege-escalation blocker and four correctness gaps in what this
ticket shipped. Deriving `global_role` from membership made *creating a membership* an act of granting
a global role — and `POST /api/organizations/{id}/members` / `POST .../transfer-ownership` authorize
with `access.RequireOwnerAsync(...)`, so a plain organization Owner, not just an Admin, could mint an
account into global `Organizer`. That role gates surfaces with **no** organization scoping
(`LeagueCommandEndpoints.cs:23`, including `DELETE /api/leagues-archive/{id}`, `LiveCommandEndpoints.cs:30`,
`PlayerNameMaintenanceEndpoints.cs:23`). Before this round only `AdminRoleService.ChangeRoleAsync`
(admin-only) could grant it, so the round widened granting authority from `{Admin}` to
`{Admin, every org Owner}`.

**Decision (parent, after the premise check below): the two endpoints that *mint* a membership are
admin-only; the two that do not stay Owner-callable.** `POST /members` and `POST /transfer-ownership`
create a membership — a transfer can hand the organization to someone who is not a member yet — and
that is what promotes an account. `DELETE /members/{id}` grants nothing: it can only strip privilege
from a member of the Owner's own organization, which is exactly what the derivation model says should
happen. `PUT /members/{id}/role` flips Owner/Organizer and leaves the membership, so the derived
global role is untouched. Restricting those two would have cost real capability and bought no
security. This matches `feedback.md` item 7 ("allow **admin only** to create organization and those
organization can be assigned to user"). It is deliberately *not* solved by requiring `Admin` on the
league/live/maintenance surfaces — organizers legitimately use those (ADR 0021, ADR 0028).

**Premise check, on the record.** The brief said the only callers were admin screens. That was wrong
and was corrected before any code was written: `src/app/app.routes.ts:34` maps `organizations/:id`
with **no `canActivate`** while every `admin/*` sibling carries `adminGuard`, and
`organizer-organizations.component.ts:26` links a plain Owner straight into it. The owner-tools panel
there is a genuine non-admin surface. The route guard is deliberately left alone — the server is the
boundary and Owners are supposed to reach that page — so the fix is server-side plus hiding the two
controls that would now always fail.

- [x] RR1. The two membership *grants* require `Admin`; removal and role-change stay Owner-callable.
      *evidence:* `.RequireAuthorization(AuthorizationPolicies.Admin)` on `OrganizationEndpoints.cs`
      `POST /members` and `POST /transfer-ownership`, plus `if (!actorIsAdmin) throw new
      AdminMembershipGrantRequiredException();` at the head of `OrganizationService.AddMemberAsync`
      and `TransferOwnershipAsync` as defence in depth. Live, against the Docker stack:
      ```
      admin creates the organization -> 201; owner global_role = Organizer
      [as plain org Owner] POST   /members            -> 403 {"code":"forbidden",...}
      [as plain org Owner] POST   /transfer-ownership -> 403 {"code":"forbidden",...}
        nothing moved: candidate global_role = User, memberships = 0
      [as Admin]           POST   /members            -> 201; candidate global_role = Organizer
      [as plain org Owner] PUT    /members/{id}/role  -> 204  (kept: a role flip grants nothing)
      [as plain org Owner] DELETE /members/{id}       -> 204  (kept: a removal only strips)
                                                       -> candidate global_role = User
      [as Admin]           POST   /transfer-ownership -> 204; candidate global_role = Organizer
      ```
      Integration: `OrganizationApiTests.Only_an_admin_can_grant_a_membership_or_transfer_ownership`.
      *criterion:* a plain Owner is refused on both grant endpoints with nothing written, an Admin
      succeeds on both, and the Owner still passes on removal and role-change.
- [x] RR2. The UI shows no control the server will refuse.
      *evidence:* `organization-detail.component.ts` renders the add-member form only for an Admin
      (`org.addMemberAdminOnly` copy in its place, en + fr) and drops the `Owner` option from a
      member's role select unless the viewer is an Admin or that member already *is* the Owner — the
      Owner option is the ownership transfer. `admin-orgs.cy.js` owner flow now asserts
      `org-add-member-form` absent, `org-add-member-admin-only` visible,
      `org-member-role-owner-{mate}` absent and `org-member-role-organizer-{mate}` present; its
      stubbed `last_owner` removal case passes unchanged. `npx cypress run --spec
      cypress/e2e/admin-orgs.cy.js` → `5 passing`.
      *criterion:* an Owner keeps the member list, the remove buttons, the role select and the
      notification settings, and is shown the reason instead of a form that 403s.
- [x] RR3. Archiving or restoring an organization re-derives its members' roles.
      *evidence:* `OrganizationService.SoftDeleteAsync` and `RestoreAsync` now lock the membership
      rows (`LockMemberUserIdsAsync`, taken between the organization lock and the user locks the sync
      takes — the global order) and call `SyncAfterMembershipChangeAsync` between `SaveChangesAsync`
      and `CommitAsync`. Live:
      ```
      admin creates the organization -> 201; sole member global_role = Organizer
      their token before the archive, GET /api/users/me/organizations -> 200
      archive the organization -> 204; global_role = User
      the SAME token, GET /api/users/me/organizations -> 401  (stamp rotated with the role)
      restore the organization -> 204; global_role = Organizer
      audit organization.role.derived rows for them = 3
      ```
      Integration: `OrganizationApiTests.Archiving_and_restoring_an_organization_re_derives_the_member_roles`
      (also asserts an `Admin` member is not moved in either direction, 0 derivations).
      *criterion:* archiving a member's only organization demotes them and kills their in-flight
      token; restoring promotes them back; `Admin` is untouched.
- [x] RR4. A follow-up migration heals the case the first heal missed.
      *evidence:* `20260812210000_HealOrganizerRolesWithoutLiveMembership` — the already-applied
      `20260812154508` is not edited. Its predicate is `NOT EXISTS (membership joined to a live
      organization)`, a superset of the first's `id NOT IN (SELECT user_id FROM organization_members)`,
      so the pair is order-independent and a healed database selects nothing. Against the dev database,
      seeded with the exact missed shape:
      ```
      before: heal-archived-only  Organizer  has_membership_row=t  has_live_membership=f   <- first heal skipped it
              heal-live-member    Organizer  has_membership_row=t  has_live_membership=t
              heal-admin-archived Admin      has_membership_row=t  has_live_membership=f
      after the migrator ran:
              heal-archived-only  | User      | stamp_rotated=t
              heal-live-member    | Organizer | stamp_rotated=f
              heal-admin-archived | Admin     | stamp_rotated=f
      audit: organization.healed.demoted | user | 22222222-…-0001 |
             {"after": "User", "before": "Organizer", "reason": "no_live_membership"} | actor_id NULL
      replaying the migration's own Up statements verbatim: INSERT 0 0 / UPDATE 0,
             users_digest and orgs_digest identical before and after
      ```
      Registered in the smoke allowlist (`scripts/smoke-full-stack.mjs:56`). Integration:
      `OrganizationMembershipHealTests.Organizers_whose_only_membership_is_in_an_archived_organization_are_demoted`.
      *criterion:* the archived-only Organizer is demoted with its own audit row, `Admin` and a live
      member are untouched, and a second execution changes nothing.
- [x] RR5. The closure sync saves inside the mapped catch.
      *evidence:* `AdminAccountService.cs` — `SyncAfterMembershipChangeAsync` moved inside the
      `try { … } catch (DbUpdateException)`, above `SaveChangesAsync`, so a concurrent write leaves as
      the mapped 409 instead of an unhandled 500. `AdminAuditAndClosureTests` → `Passed: 8`.
      *criterion:* every save in the closure transaction is covered by the conflict catch.
- [x] RR6. Highlighting and filtering use one tokenizer.
      *evidence:* `splitSearchTerms` (whitespace / `,` / `;`, backslash escapes) now lives in
      `src/app/shared/search-highlight.ts` and is what `searchWords` and `event-fuzzy-search.ts` both
      call; `player-detail.component.ts` groups an exact-match filter with the new `escapeSearchTerm`
      instead of quotes, so its one-term behaviour is unchanged. New tests in
      `search-highlight.test.ts` pin `lyon,legacy` → both words highlighted and an escaped separator
      staying one term.
      *criterion:* a query that filters the calendar to a card highlights inside that card.
- [x] RR7. Approval mail links the canonical review path.
      *evidence:* `EventProposalEndpoints.cs:488` → `$"/event-requests/{Uri.EscapeDataString(token)}"`.
      `EventProposalTests` asserts `/event-requests/` present **and** `/tournament-requests/` absent;
      `NotificationTemplateRendererTests` fixtures updated. The retired route keeps its redirect
      (`app.routes.ts:92`, pinned by `data-mode-routes.test.ts:242`); `event-proposal.cy.js` → `3 passing`.
      *criterion:* the mail points at `/event-requests/{token}` and the old path still redirects.
- [x] RR8. Dead `.event-facts` rules deleted.
      *evidence:* `src/styles.css` — the four rules removed; `grep -rn event-facts src cypress` prints
      only the negative assertion in `event-detail-view.component.test.ts:118`, which still passes.
      *criterion:* no `.event-facts` rule ships and the T6 hero assertions stay green.
- [x] RR9. The ICS ordering assertion cannot pass on an absent element.
      *evidence:* `event-detail-view.component.test.ts` asserts `actions` contains
      `data-cy="event-ics"` before comparing `indexOf` (which returns -1 for an absent element).
      *criterion:* the presence assertion precedes the ordering one.
- [x] RR10. `whenSessionReady()` is driven for real.
      *evidence:* two tests in `auth.service.test.ts` start `bootstrap()` on a pending refresh
      subject, assert the promise has not settled, then settle it — once with a value, once with an
      error — and assert it resolves (never rejects) in both. Mutation-checked: replacing the body
      with `Promise.resolve()` fails both (`expect(await settledOrPending(ready)).toBe('pending')` →
      `Received: undefined`), where the guard tests stay green.
      *criterion:* the tests fail when the real implementation is stubbed out.
- [x] RR11. The hard API break is pinned.
      *evidence:* `ApiBoundaryTests.Retired_tournament_collection_paths_have_no_api_alias` — 404 on
      `/api/tournaments` and `/api/tournaments/all`, plus `/api/events` and `/api/events/all` asserted
      present in the same endpoint table so the 404 is the rename and not a disabled feature.
      Mutation-checked: re-adding `app.MapGet("/api/tournaments", ListAsync)` fails it
      (`Assert.DoesNotContain() Failure: Item found in set`).
      *criterion:* a re-added API alias fails a gate.
- [x] RR12. The heal's SQL idempotency is pinned, not EF's bookkeeping.
      *evidence:* `OrganizationMembershipHealTests.Re_running_the_heal_changes_nothing` still calls
      `MigrateAsync()` (a no-op via `__EFMigrationsHistory`) and then replays both migrations'
      `UpOperations` `SqlOperation`s straight down the connection inside a transaction, asserting at
      least five statements ran and that the snapshot is unchanged.
      *criterion:* the statements themselves are re-executed and compared, not just the history table.
- [x] RR13. The soft-deleted-organization comment matches its test.
      *evidence:* `OrganizationApiTests.cs` — the tail of `Membership_changes_derive_the_global_organizer_role`
      now says what it does (re-granting promotes again) and points at
      `Archiving_and_restoring_an_organization_re_derives_the_member_roles`, which exercises the
      soft-deleted case the old comment claimed.
      *criterion:* no comment claims coverage the assertions do not provide.

### Review repair validation

- [x] `dotnet build backend/Gones.sln` — `Build succeeded. 0 Warning(s) 0 Error(s)`
- [x] targeted integration runs — `OrganizationApiTests` 15 passed,
      `AdminAuditAndClosureTests|ApiBoundaryTests` 52 passed, `OrganizationMembershipHealTests`
      9 passed, `EventProposalTests|EventPublicationApiTests` 37 passed,
      `EventProposalDecisionTests` 22 passed; 0 failed in each
- [x] `dotnet test backend/tests/Gones.UnitTests` 198 passed, `backend/tests/Gones.ArchitectureTests`
      17 passed, 0 failed
- [ ] full `dotnet test backend/Gones.sln` — **left unchecked, unchanged host defect**: Testcontainers
      loses the port race on random classes (`RootlessKit … bind: address already in use`). Observed
      once here as `Failed: 2, Passed: 57` on `EventProposalTests|EventPublicationApiTests|EventProposalDecisionTests`,
      with both failures inside `InitializeAsync` (`DockerContainer.StartAsync`) and zero assertion
      failures; the same filter re-run immediately passed 37/37. Gated on the targeted runs above.
- [x] `npm run test` (110 files / 1026 tests passed), `npm run lint` (`All files pass linting.`),
      `npm run typecheck` (clean), `npm run api:check` (exit 0 — the API surface did not move: a 403
      from a policy is not a declared response)
- [x] Cypress — `admin-orgs.cy.js` 5 passing, `public-calendar.cy.js` 12 passing,
      `accessibility.cy.js` 11 passing, `event-proposal.cy.js` 3 passing
- [x] the dev stack is left running and intact — no `docker compose down`, no volume drop, no DB
      reset. The API image was rebuilt with the V1 feature flags from `scripts/dev-environments.mjs`
      (`devComposeEnv`) and answers on `http://127.0.0.1:5080`; the parent-owned dev server on :4200
      was not touched.
