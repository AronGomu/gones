# T10: Org membership read model

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T9
**Commit outcome:** an admin can read any organization's roster — including soft-deleted organizations — through `GET /api/admin/organizations/{organizationId}/members`, with each member's username, email and global role, and the roster count is exposed on the admin organization list so a Draft (member-less) organization is identifiable.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md`. This block builds the single admin screen that manages the many-to-many organization ↔ organizer graph.
- This slice: the read side only. The workbench UI (T13) needs one call per selected organization plus a member count in the list; today the only roster endpoint is `GET /api/organizations/{id}/members`, which requires the caller to pass the org access check and returns only `userId`, `username`, `role`, `createdAt`.
- Out of scope here: writing memberships, the derived global role (T11), the heal migration (T12), any UI (T13).
- Assumptions in force: Draft = zero members, derived from the member count, never stored. Admin may inspect any organization, including soft-deleted ones.

## Requirements

- New endpoint in `backend/src/Gones.Api/Organizations/OrganizationEndpoints.cs`, inside the existing `var admin = app.MapGroup("/api/admin/organizations").RequireAuthorization(AuthorizationPolicies.Admin);` group:
  `admin.MapGet("/{organizationId:guid}/members", ListAdminOrganizationMembersAsync).Produces<IReadOnlyList<AdminOrganizationMemberResponse>>().ProducesProblem(StatusCodes.Status404NotFound);`
- New record in the same file:
  `internal sealed record AdminOrganizationMemberResponse(Guid UserId, string Username, string Email, string GlobalRole, string Role, Instant CreatedAt);`
  `Role` is the organization role (`Owner`/`Organizer`); `GlobalRole` is the account-wide role.
- The handler joins `OrganizationMembers` → `Users` → `UserProfiles` (same join shape as `AdminEndpoints.ListUsersAsync`), ordered by `Role` descending (Owner first) then `Username` ascending. 404 when the organization row does not exist at all; a soft-deleted organization still returns its roster.
- `AdminOrganizationResponse` gains a trailing `int MemberCount` property, filled by the existing `ListAdminOrganizationsAsync` query with a single grouped count (no N+1: use a `GroupJoin`/sub-select in the projection).
- `AdminOrganizationResponse` gains a trailing `bool IsDraft` computed as `MemberCount == 0`.
- Regenerate the frontend client so `Client` exposes the new call: `npm run generate:api` (check `package.json` for the exact script name; `scripts/generate-api.mjs` is the implementation).

## Inputs

- `backend/src/Gones.Api/Organizations/OrganizationEndpoints.cs` — group wiring at lines ~20-95; response records at ~420-470: `OrganizationMemberResponse(Guid UserId, string Username, string Role, Instant CreatedAt)`, `AdminOrganizationListResponse(Items, Page, PageSize, TotalCount)`, `AdminOrganizationResponse(Id, Name, Description, Website, ContactEmail, DeletedAt, CreatedAt, UpdatedAt, Version)`.
- `backend/src/Gones.Api/Admin/AdminEndpoints.cs` — `ListUsersAsync` shows the `from user in database.Users.AsNoTracking() join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId` pattern; `AdminUserSummaryResponse(Id, Email, EmailVerified, GlobalRole, Username, FirstName, LastName, IsClosed, CreatedAt)`; `DefaultPageSize = 20`, `MaximumPageSize = 100`.
- `backend/src/Gones.Api/Security/AuthorizationPolicies.cs` — `AuthorizationPolicies.Admin`.
- `backend/tests/Gones.IntegrationTests/OrganizationApiTests.cs` — the integration-test harness and conventions for org endpoints.
- **From Depends:** T9 added only docs tooling.

## TDD

1. **Red** — integration tests in `backend/tests/Gones.IntegrationTests/OrganizationApiTests.cs`.
2. **Green** — endpoint + records + projection.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `admin lists members of any organization` | admin token, org with 2 members | 200, 2 items, each with `username`, `email`, `globalRole`, `role` |
| `roster is ordered owner first` | org with an Owner and an Organizer | first item `role == "Owner"` |
| `non-admin is refused` | organizer token, own org | 403 |
| `unknown organization returns 404` | random Guid | 404 |
| `soft-deleted organization still returns its roster` | deleted org with 1 member | 200, 1 item |
| `admin organization list reports member count and draft state` | one org with 2 members, one with none | items carry `memberCount` 2 and 0, `isDraft` false and true |

Per-case criteria (each asserted inside the two new xUnit facts):

- [x] admin lists members of any organization — 200 with 2 items (`Admin_reads_any_roster_with_identities_and_non_admins_are_refused`)
- [x] response body carries exactly `userId`, `username`, `email`, `globalRole`, `role`, `createdAt` — no hash/token/verification field
- [x] roster is ordered owner first (owner username sorts *after* the organizer's, so the order proves the rule)
- [x] anonymous caller refused 401, plain `User` refused 403, global `Organizer` who is a member of that very org refused 403
- [x] unknown organization returns 404
- [x] soft-deleted organization still returns its roster (200, 1 item)
- [x] admin organization list reports `memberCount` 2 / 0 and `isDraft` false / true

## Impl steps

- [x] 1. Add the six integration tests to `backend/tests/Gones.IntegrationTests/OrganizationApiTests.cs`; run `dotnet test backend/tests/Gones.IntegrationTests --filter OrganizationApiTests` — red. → `Failed! - Failed: 2, Passed: 5, Total: 7` (roster 200 vs `NotFound`; `memberCount` key absent)
- [x] 2. Add `AdminOrganizationMemberResponse` to `OrganizationEndpoints.cs`. → record at `OrganizationEndpoints.cs:499`
- [x] 3. Add `ListAdminOrganizationMembersAsync(Guid organizationId, GonesDbContext database, CancellationToken cancellationToken)` implementing the join, ordering and 404 rule. → `OrganizationEndpoints.cs:350`
- [x] 4. Register the route in the `admin` group. → `admin.MapGet("/{organizationId:guid}/members", …)` at `OrganizationEndpoints.cs:96`
- [x] 5. Extend `AdminOrganizationResponse` with `int MemberCount` and `bool IsDraft`, and update every construction site (`grep -n "new AdminOrganizationResponse" backend/src`). → 1 projection + `ToAdminResponse` (create/update handlers)
- [x] 6. Update `ListAdminOrganizationsAsync` projection to compute the count in one query. → correlated `database.OrganizationMembers.Count(...)` inside the single `Select`
- [x] 7. Run `dotnet test backend/tests/Gones.IntegrationTests --filter OrganizationApiTests` — green. → `Passed! - Failed: 0, Passed: 7, Total: 7, Duration: 38 s`
- [x] 8. Regenerate the API client and check `src/app/api/generated/gones-api.ts` compiles: `npm run generate:api && npm run typecheck`. → script is `npm run api:generate` (package.json); regen added `membersAll2()` + `AdminOrganizationMemberResponse` + `memberCount`/`isDraft`; `npm run typecheck` clean; `npm run api:check` clean
- [x] 9. Fix any frontend compile break caused by the new `AdminOrganizationResponse` fields (`src/app/features/admin/admin-organizations.component.ts` reads it). → none needed: the component only reads the interface, both new fields are additive (`npm run typecheck` + `npm run lint` green)
- [x] 10. Keep the new admin roster URL out of the service-worker cache (identity payload) → `src/app/api/service-worker-cache.test.ts` PRIVATE_GET_URLS entry, `npm run test` 1000 passed

## Outputs

- Files touched: `backend/src/Gones.Api/Organizations/OrganizationEndpoints.cs`, `backend/tests/Gones.IntegrationTests/OrganizationApiTests.cs`, `src/app/api/generated/gones-api.ts` (regenerated), `backend/openapi/*` (regenerated).
- API change: new `GET /api/admin/organizations/{organizationId}/members`; `AdminOrganizationResponse` gains `memberCount` and `isDraft`.

## Validation

- [x] `dotnet test backend/tests/Gones.IntegrationTests --filter OrganizationApiTests` passes → `Passed! - Failed: 0, Passed: 7, Skipped: 0, Total: 7, Duration: 38 s`
- [x] `dotnet build backend/Gones.sln` passes → `Build succeeded. 0 Warning(s) 0 Error(s)`
- [x] `npm run typecheck` passes → no output, exit 0 (`tsconfig.app.json` + `tsconfig.spec.json`)
- [x] manual check: `curl -H "Authorization: Bearer <admin>" http://127.0.0.1:5080/api/admin/organizations/<id>/members` → `HTTP 200` `[{"userId":"5f66e295-…","username":"gones-organizer","email":"organizer@gones.test","globalRole":"Organizer","role":"Owner","createdAt":"2026-08-11T23:12:05.864333Z"}]`
- [x] authorization proved on the running API, not only in tests → anonymous `HTTP 401`, plain `User` `HTTP 403`, global `Organizer` (owner of that very org) `HTTP 403`, admin `HTTP 200`, unknown org as admin `HTTP 404`
- [x] no N+1 → Postgres `log_statement` capture: the org list emits ONE statement carrying `(SELECT count(*)… FROM organization_members AS o0 WHERE o0.organization_id = o.id)`; the roster emits ONE joined statement (`organization_members` ⨝ `asp_net_users` ⨝ `user_profiles`), no per-member query. Setting reset afterwards (`ALTER ROLE gones_app RESET log_statement`)
- [x] app functional — the existing `/admin/organizations` page still lists and edits organizations → `npx cypress run --spec cypress/e2e/admin-orgs.cy.js` → `All specs passed! 4 4 - - -`
- [x] `npm run test` → `Test Files 109 passed (109) / Tests 1000 passed (1000)`
- [x] `npm run lint` → `All files pass linting.`
- [x] `npm run api:check` → exit 0, generated contract in sync
- [ ] `npm run backend:test` — unchecked: the run did not earn it. Every failure is a Testcontainers startup error, never an assertion — see `## Known environment defect` below.
- [x] commit msg draft: `feat(admin): expose organization rosters and member counts`

## Known environment defect — `npm run backend:test` on this host

`npm run backend:test` (`dotnet test backend/Gones.sln --configuration Release`) cannot go green on this
machine, for reasons unrelated to this slice.

- Exact error, once per failing test class:
  `Docker.DotNet.DockerApiException : Docker API responded with status code=InternalServerError, response={"message":"failed to set up container networking: driver failed programming external connectivity on endpoint <name> (<id>): error while calling RootlessKit PortManager.AddPort(): listen tcp4 0.0.0.0:34294: bind: address already in use"}`
- It always fires in `InitializeAsync` while Testcontainers starts the per-class Postgres, never in an
  assertion. The affected classes are different on every run (`LeagueCommandApiTests`,
  `PersistenceKernelTests`, `LocalIdentityApiTests`, `PublicTournamentApiTests`,
  `TelemetryAndHealthTests`, `AllTournamentsEndpointTests`, `LiveCommandApiTests`, `OAuthApiTests`, …).
- Host cause: `sysctl net.ipv4.ip_local_port_range` = `32768	60999`, which overlaps the range rootless
  docker publishes container ports from, so an ephemeral socket can already hold the port RootlessKit
  is asked to bind. Fixing it means host/sysctl work, outside this repository and this ticket.
- Serialising the suite does not help: `dotnet test backend/Gones.sln --configuration Release -- xUnit.MaxParallelThreads=1`
  → `Failed! - Failed: 4, Passed: 364, Total: 368, Duration: 20 m 19 s`.
- Clean-tree control: with this ticket's changes stashed (`git stash push -- backend src ai-artifacts/…`),
  `npm run backend:test` → `Failed! - Failed: 6, Passed: 360, Skipped: 0, Total: 366, Duration: 3 m 23 s`,
  same RootlessKit error. Pre-existing, and worse without the change than with it.
- Runs observed with the change: `Failed: 2 / 366 passed`, `Failed: 3 / 365 passed`, `Failed: 2 / 366 passed`,
  final run `Failed: 3, Passed: 365, Total: 368` (`AllTournamentsEndpointTests`, `LiveCommandApiTests`,
  `OAuthApiTests` — all three the RootlessKit bind error). `Gones.UnitTests` 198/198 and
  `Gones.ArchitectureTests` 17/17 pass in every run.
- The suite that actually covers this slice is green and repeatable:
  `dotnet test backend/tests/Gones.IntegrationTests --filter OrganizationApiTests` →
  `Passed! - Failed: 0, Passed: 7, Skipped: 0, Total: 7, Duration: 40 s`.
