# T14: Admin all-organizations picker

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T13
**Commit outcome:** an admin opening the event creation page can pick any active organization — not only the ones they belong to — and publish directly for it.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md`.
- This slice: feedback item 8. Today the create page offers `client.organizationsAll()` (the caller's own memberships) when the user can publish directly, and the anonymous public catalogue when they can only propose. An admin with no memberships therefore sees an empty picker.
- Out of scope here: the organization workbench (T13), the route rename (T18), any change to the proposal flow for non-admins.
- Assumptions in force: admins may publish for any organization (`OrganizationAccess` already treats `actorIsAdmin` as an override). Draft organizations (zero members) must be excluded from the picker because publishing for them is refused with `organization_is_draft` (T11).

## Requirements

- In `src/app/features/calendar/organizer-tournament-create.component.ts`, `loadReferences()` picks the organization source by role:
  - `Admin` → all active, non-draft organizations from the admin list endpoint, paged until exhausted (`pageSize` 100), mapped to `{ id, name }` and sorted by name.
  - `Organizer` (not admin) → unchanged: `client.organizationsAll()`.
  - anyone else → unchanged: `loadPublicOrganizations()`.
- Add `private readonly isAdmin = computed(() => this.auth.profile()?.globalRole === 'Admin')` and use it, not a string comparison inline.
- The admin source filters out `isDraft === true` and `deletedAt != null` entries.
- When the admin list call fails, fall back to the existing behaviour rather than an empty picker, and surface the existing `tournamentCreate.referencesFailed` error.
- No backend change is expected. Verify with a test that publishing as admin for a non-member organization returns 201 — if it does not, fix the authorization path in `backend/src/Gones.Api/Organizations/OrganizationAccess.cs` and cover it.

## Inputs

- `src/app/features/calendar/organizer-tournament-create.component.ts` — `loadReferences()` around line 265: `const organizations = this.canPublishDirectly() ? (await firstValueFrom(this.client.organizationsAll())).map(item => ({ id: item.id, name: item.name })) : await this.loadPublicOrganizations();`; `TournamentOrganizationOption { id: string; name: string }`; `PublicOrganizationPageSize = 100`; `MaximumPublicOrganizationPages = 20`; `canPublishDirectly()`; `organizations` signal; `syncSelectedOrganization()`.
- `src/app/api/generated/gones-api.ts` — `Client.organizationsGET3(search, includeDeleted, page, pageSize)` returns `AdminOrganizationListResponse` with `items`, `totalCount`, `pageSize` and (since T10) `memberCount` / `isDraft` per item.
- `backend/src/Gones.Api/Organizations/OrganizationAccess.cs` — `RequireMemberAsync(organizationId, userId, isAdmin, ct)`.
- **From Depends:** T13 rebuilt `/admin/organizations`; T11 added the `organization_is_draft` publish gate; T10 added `isDraft` to the admin organization response.

## TDD

1. **Red** — component tests in `src/app/features/calendar/organizer-tournament-create.component.test.ts`; one backend integration test.
2. **Green** — implement the role-based source.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `admin sees every active organization` | profile `globalRole: 'Admin'`, admin endpoint returns 3 orgs | picker holds 3 options, admin endpoint called, `organizationsAll` not called |
| `admin picker hides draft organizations` | one of the 3 has `isDraft: true` | picker holds 2 options |
| `organizer still sees only their organizations` | profile `globalRole: 'Organizer'` | `organizationsAll` called, admin endpoint not called |
| `plain user still sees the public catalogue` | profile `globalRole: 'User'` | `loadPublicOrganizations` path used |
| `admin endpoint failure falls back` | admin endpoint rejects | `organizationsAll` used, no crash, error message shown when both fail |
| backend `admin publishes for a non-member organization` | admin token, org they do not belong to, staffed | 201 |

## Impl steps

- [ ] 1. Add the five component tests; run `npx vitest run src/app/features/calendar/organizer-tournament-create.component.test.ts` — red.
- [ ] 2. Add `isAdmin` computed and an `private async loadAdminOrganizations(): Promise<TournamentOrganizationOption[]>` paging the admin endpoint up to `MaximumPublicOrganizationPages`.
- [ ] 3. Branch `loadReferences()` on `isAdmin()` first, then `canPublishDirectly()`, then the public path; wrap the admin call in its own try/catch for the fallback.
- [ ] 4. Add the backend integration test to `backend/tests/Gones.IntegrationTests/PublicTournamentApiTests.cs` (or the publication test file it lives in) and confirm 201.
- [ ] 5. Run `npx vitest run src/app/features/calendar`, `dotnet test backend/tests/Gones.IntegrationTests`, `npm run lint`, `npm run typecheck`.
- [ ] 6. Update `cypress/e2e/organizer-tournament-create.cy.js` with an admin-picker assertion.

## Outputs

- Files touched: `src/app/features/calendar/organizer-tournament-create.component.ts` (+ test), possibly `backend/src/Gones.Api/Organizations/OrganizationAccess.cs`, backend tests, `cypress/e2e/organizer-tournament-create.cy.js`.
- Behaviour change: admins get the full organization list in the event create form.

## Validation

- [ ] `npx vitest run src/app/features/calendar` passes
- [ ] `dotnet test backend/tests/Gones.IntegrationTests` passes
- [ ] `npx cypress run --spec cypress/e2e/organizer-tournament-create.cy.js` passes
- [ ] manual check: sign in as `admin@gones.test`, open the create page, confirm both demo organizations are offered and publishing works
- [ ] app functional — organizer and plain-user flows unchanged
- [ ] commit msg draft: `feat(events): let admins create events for any organization`
