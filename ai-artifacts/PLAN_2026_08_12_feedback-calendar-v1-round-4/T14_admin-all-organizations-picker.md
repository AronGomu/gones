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

- [x] 1. Add the five component tests; run `npx vitest run src/app/features/calendar/organizer-tournament-create.component.test.ts` — red.
      Evidence: 3 failed | 10 passed — `expected [] to deeply equal [ 'org-a', 'org-b' ]`, `expected "vi.fn()" to be called 2 times, but got 0 times`.
- [x] 2. Add `isAdmin` computed and an `private async loadAdminOrganizations(): Promise<TournamentOrganizationOption[]>` paging the admin endpoint up to `MaximumPublicOrganizationPages`.
      Evidence: `organizer-tournament-create.component.ts` — `isAdmin` computed, `loadAdminOrganizations()` pages `organizationsGET3(undefined, false, page, 100)`, filters `isDraft !== true && deletedAt == null`, sorts by name.
- [x] 3. Branch `loadReferences()` on `isAdmin()` first, then `canPublishDirectly()`, then the public path; wrap the admin call in its own try/catch for the fallback.
      Evidence: `loadOrganizationOptions()`; `npx vitest run src/app/features/calendar/organizer-tournament-create.component.test.ts` → 13 passed.
- [x] 4. Add the backend integration test to `backend/tests/Gones.IntegrationTests/PublicTournamentApiTests.cs` (or the publication test file it lives in) and confirm 201.
      Evidence: `Admin_publishes_for_a_non_member_organization_and_an_organizer_still_cannot` in `TournamentPublicationApiTests.cs`; `dotnet test --filter FullyQualifiedName~TournamentPublicationApiTests` → `Failed: 0, Passed: 18`.
- [x] 5. Run `npx vitest run src/app/features/calendar`, `dotnet test backend/tests/Gones.IntegrationTests`, `npm run lint`, `npm run typecheck`.
      Evidence: vitest calendar → `18 passed (18) / 225 passed (225)`; `dotnet test --filter TournamentPublicationApiTests` → `Failed: 0, Passed: 18`; `npm run lint` → `All files pass linting.`; `npm run typecheck` → clean.
- [x] 6. Update `cypress/e2e/organizer-tournament-create.cy.js` with an admin-picker assertion.
      Evidence: `offers an admin every active organization and none of the ones publishing would refuse` — spec now `8 passing`.

## Outputs

- Files touched: `src/app/features/calendar/organizer-tournament-create.component.ts` (+ test), possibly `backend/src/Gones.Api/Organizations/OrganizationAccess.cs`, backend tests, `cypress/e2e/organizer-tournament-create.cy.js`.
- Behaviour change: admins get the full organization list in the event create form.

## Validation

- [x] `npx vitest run src/app/features/calendar` passes — `Test Files 18 passed (18) / Tests 225 passed (225)`
- [x] `dotnet test backend/tests/Gones.IntegrationTests` passes — targeted: `Failed: 0, Passed: 18` (`FullyQualifiedName~TournamentPublicationApiTests`). Full `npm run backend:test` on this host: `Failed: 4, Passed: 386` — all four are `Docker.DotNet.DockerApiException … RootlessKit PortManager.AddPort() … bind: address already in use` (`LiveCommandApiTests.Live_delete_requires_if_match_and_hides_document_from_reads`, `TournamentProposalTests.Submission_rejects_an_oversized_recipient_list`, `TournamentProposalTests.Submit_stores_the_proposal`, `LocalIdentityApiTests.Forgot_response_is_generic_and_reset_is_single_use_and_revokes_sessions`), zero assertion failures.
- [x] `npx cypress run --spec cypress/e2e/organizer-tournament-create.cy.js` passes — `8 passing`, `All specs passed!`
- [x] `npx cypress run --spec cypress/e2e/admin-orgs.cy.js` passes (5) — T13 surface not regressed — `5 passing`
- [x] `npx cypress run --spec cypress/e2e/accessibility.cy.js` passes (11) — no a11y regression — `11 passing`
- [x] `npm run test` passes (vitest + acceptance matrix + e2e spec coverage) — `Test Files 110 passed (110) / Tests 1012 passed (1012)`
- [x] `npm run lint` and `npm run typecheck` pass — `All files pass linting.` / no `tsc` output
- [x] server-side proof against the running stack: an `Organizer` publishing for a non-member organization is refused, an `Admin` publishing for the same organization is `201`, and a member-less organization still answers `organization_is_draft`
      Evidence (http://127.0.0.1:5080, demo accounts):
      - `GET /api/admin/organizations` — admin `200` (18 organizations), `organizer@gones.test` `403 forbidden`, anonymous `401`. The picker's source cannot be enumerated by a non-admin.
      - `POST /api/tournaments/preview` for `Ligue AURA` (organizer is not a member) — organizer `404 not_found`, admin `200`.
      - `POST /api/tournaments` for `Ligue AURA` with the admin's preview ticket and that organization id — organizer `404 not_found`, admin `201 {"slug":"t14-cross-org-1786551794"}`. The server decides, not the client's payload.
      - Draft organization (created, then emptied to `memberCount= 0 isDraft= True`): admin preview `200`, admin publish `409 organization_is_draft`. The admin path does not bypass the T11 gate.
- [x] `npm run api:check` — no drift; the API surface did not move (no `backend/src` change)
- [x] manual check: sign in as `admin@gones.test`, open the create page, confirm both demo organizations are offered and publishing works — recorded as human-only steps in `ai-artifacts/manual_test_checklist.md`
      Evidence: `## T14 admin-all-organizations-picker` section appended (8 human-only steps). Machine-side equivalent already proven: the admin list served 18 organizations to the admin token and the admin published for a non-member organization (`201`).
- [x] app functional — organizer and plain-user flows unchanged (covered by the organizer and non-organizer Cypress cases in `organizer-tournament-create.cy.js`)
      Evidence: the organizer case still asserts `option` length 1 = `Owned Club`; the non-organizer case still reads the public catalogue; component tests pin that neither role calls `organizationsGET3`.
- [x] commit msg draft: `feat(events): let admins create events for any organization`
