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

## Impl steps

- [ ] 1. Add the six integration tests to `backend/tests/Gones.IntegrationTests/OrganizationApiTests.cs`; run `dotnet test backend/tests/Gones.IntegrationTests --filter OrganizationApiTests` — red.
- [ ] 2. Add `AdminOrganizationMemberResponse` to `OrganizationEndpoints.cs`.
- [ ] 3. Add `ListAdminOrganizationMembersAsync(Guid organizationId, GonesDbContext database, CancellationToken cancellationToken)` implementing the join, ordering and 404 rule.
- [ ] 4. Register the route in the `admin` group.
- [ ] 5. Extend `AdminOrganizationResponse` with `int MemberCount` and `bool IsDraft`, and update every construction site (`grep -n "new AdminOrganizationResponse" backend/src`).
- [ ] 6. Update `ListAdminOrganizationsAsync` projection to compute the count in one query.
- [ ] 7. Run `dotnet test backend/tests/Gones.IntegrationTests --filter OrganizationApiTests` — green.
- [ ] 8. Regenerate the API client and check `src/app/api/generated/gones-api.ts` compiles: `npm run generate:api && npm run typecheck`.
- [ ] 9. Fix any frontend compile break caused by the new `AdminOrganizationResponse` fields (`src/app/features/admin/admin-organizations.component.ts` reads it).

## Outputs

- Files touched: `backend/src/Gones.Api/Organizations/OrganizationEndpoints.cs`, `backend/tests/Gones.IntegrationTests/OrganizationApiTests.cs`, `src/app/api/generated/gones-api.ts` (regenerated), `backend/openapi/*` (regenerated).
- API change: new `GET /api/admin/organizations/{organizationId}/members`; `AdminOrganizationResponse` gains `memberCount` and `isDraft`.

## Validation

- [ ] `dotnet test backend/tests/Gones.IntegrationTests --filter OrganizationApiTests` passes
- [ ] `dotnet build backend/Gones.sln` passes
- [ ] `npm run typecheck` passes
- [ ] manual check: `curl -H "Authorization: Bearer <admin>" http://127.0.0.1:5080/api/admin/organizations/<id>/members`
- [ ] app functional — the existing `/admin/organizations` page still lists and edits organizations
- [ ] commit msg draft: `feat(admin): expose organization rosters and member counts`
