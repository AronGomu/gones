# T13: Admin organization workbench

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T12
**Commit outcome:** `/admin/organizations` becomes a single two-pane screen: organizations (with create) on the left, the selected organization's roster on the right with member chips and a user picker that adds a member in one click, promotion/demotion happening automatically.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md`. This block builds the admin organization workbench.
- This slice: the UI for feedback item 7, including "an admin can assign organizations to itself as a normal user".
- Out of scope here: server-side user search (deferred — a 500-user cap with a warning is the agreed guardrail), the event-create picker (T14), the Event rename.
- Assumptions in force: the Organizer role is derived server-side (T11), so this screen never sets a global role directly. Draft organizations (zero members) are legal and shown with a badge. The user picker fetches all users once, client-side filtered.

## Requirements

- Rewrite `src/app/features/admin/admin-organizations.component.ts` as a two-pane layout inside the existing `/admin/organizations` route:
  - Left pane `[data-cy=admin-org-list-pane]`: the search field, the "include deleted" toggle, the create form (collapsed behind a "New organization" button, `[data-cy=admin-org-create-toggle]`), and the paginated organization list. Each row is a button (`[attr.data-cy]="'admin-org-select-' + org.id"`) that selects the organization; the selected row carries `aria-current="true"`.
  - Each row shows the name, the member count, and a Draft badge (`[attr.data-cy]="'admin-org-draft-' + org.id"`) when `org.isDraft`.
  - Right pane `[data-cy=admin-org-detail-pane]`: the selected organization's name, its edit form (existing fields), its roster as chips (`[attr.data-cy]="'admin-org-member-' + member.userId"`, each with a remove button `[attr.data-cy]="'admin-org-member-remove-' + member.userId"`), and the add-member picker.
  - Empty state when nothing is selected: `[data-cy=admin-org-detail-empty]`.
- User picker: `<input [data-cy=admin-org-member-search]>` filtering an in-memory list, results rendered as buttons `[attr.data-cy]="'admin-org-member-option-' + user.id"` showing `username` + `email` + current `globalRole`; clicking adds the member with organization role `Organizer`.
- User list loading: page through `GET /api/admin/users` (`Client.usersGET`-family call, `pageSize` 100 — the server caps at 100) until either exhausted or 500 users are loaded. On hitting the cap set `userCapReached` and render a warning `[data-cy=admin-org-member-cap-warning]` with the i18n key `admin.userPickerCapped`.
- Removing the last member is allowed; after any roster mutation, reload both the roster and the organization list so the Draft badge and the member count stay truthful.
- Every mutation goes through the existing `mutate()` pending/status wrapper; failures show `[data-cy=admin-orgs-error]`.
- New i18n keys in BOTH `en` and `fr` maps: `admin.organizationRoster`, `admin.addMember`, `admin.removeMember`, `admin.draftOrganization`, `admin.selectOrganization`, `admin.userPickerCapped`, `admin.memberCount`.
- CSS in `src/styles.css`: `.admin-org-workbench { display: grid; grid-template-columns: minmax(0, 22rem) minmax(0, 1fr); gap: 1rem; align-items: start; }` and a `@media (max-width: 900px) { .admin-org-workbench { grid-template-columns: 1fr; } }` collapse.
- Route `/admin/organizations` keeps `canActivate: [adminGuard]`; the selected organization id is mirrored in the query string as `?organization=<id>` so a reload keeps the selection.

## Inputs

- `src/app/features/admin/admin-organizations.component.ts` — current single-column screen: filters, create form (`draft = { name, ownerUserId, description, website, contactEmail }`), list rows with edit/delete/restore, pager, `mutate()` helper, calls `client.organizationsGET3(search, includeDeleted, page, pageSize)`, `client.organizationsPOST`, `client.organizationsPUT`, `client.organizationsDELETE`, `client.restore`.
- `src/app/features/admin/admin-query.ts` — `pagedQueryParams`, `readPagedQuery`, `totalPages`.
- `src/app/features/admin/admin-users.component.ts` — the admin user list call shape to copy.
- **From Depends:** T10 added `GET /api/admin/organizations/{organizationId}/members` returning `AdminOrganizationMemberResponse(userId, username, email, globalRole, role, createdAt)`, and added `memberCount` + `isDraft` to `AdminOrganizationResponse`. T11 made membership drive the global role and allowed removing the last member. T12 healed legacy rows.

## TDD

1. **Red** — component tests in a new `src/app/features/admin/admin-organizations.component.test.ts`, plus Cypress in `cypress/e2e/admin-orgs.cy.js`.
2. **Green** — build the two panes.
3. **Refactor** — extract the user-picker into `src/app/features/admin/user-picker.component.ts` only if the component file exceeds ~350 lines.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `selecting an organization loads its roster` | click `[data-cy=admin-org-select-<id>]` | roster endpoint called once with that id; chips rendered |
| `draft organizations are badged` | org with `isDraft: true` | `[data-cy=admin-org-draft-<id>]` exists |
| `adding a member calls the members endpoint and reloads` | pick a user, click add | POST `/api/organizations/{id}/members` called, roster reloaded, list reloaded |
| `removing the last member is allowed` | one member, click remove | DELETE called, no error banner, org now badged Draft |
| `user picker filters client side` | type `organizer` | only matching options rendered |
| `user cap warning appears at 500` | stub 500 users returned | `[data-cy=admin-org-member-cap-warning]` visible |
| `selection survives a reload` | select org, re-create the component with `?organization=<id>` | that organization is selected |
| cypress `admin assigns an organization to a plain user` | full flow against the demo env | the user's role becomes Organizer in `/admin/users` |

## Impl steps

- [x] 1. Write `src/app/features/admin/admin-organizations.component.test.ts` with the seven component tests; run `npx vitest run src/app/features/admin` — red. — criterion: the seven tests exist and fail before the component changes. Evidence: `Tests 7 failed | 3 passed (10)`, `TypeError: component.select is not a function`.
- [x] 2. Add the seven i18n keys to both maps in `src/app/i18n/messages.ts`. — criterion: each key present in `en` and `fr`; `npm run test` i18n parity green. Evidence: `admin.organizationRoster/addMember/removeMember/draftOrganization/selectOrganization/userPickerCapped/memberCount` (+ `admin.newOrganization`, `admin.confirmRemoveMember`, `admin.actionFailedCode`) in both maps; 1007 vitest tests pass.
- [x] 3. Restructure the template into `.admin-org-workbench` with the two panes, keeping every existing control reachable. — criterion: `admin-org-list-pane` / `admin-org-detail-pane` / `admin-org-detail-empty` render and search, include-deleted, create, edit, delete, restore, pager stay present. Evidence: component template + Cypress `assigns an organization to a plain user …` passing.
- [x] 4. Add roster state: `readonly selectedId = signal<string>('')`, `readonly members = signal<AdminOrganizationMemberResponse[]>([])`, `loadMembers()`, `addMember(userId)`, `removeMember(userId)`. — criterion: roster tests green. Evidence: `selecting an organization loads its roster`, `adding a member calls the members endpoint and reloads roster and list`, `removing the last member is allowed …` pass.
- [x] 5. Add user-list state: `readonly users = signal<AdminUserSummaryResponse[]>([])`, `readonly userCapReached = signal(false)`, `loadUsers()` paging at `pageSize: 100` up to `MAX_PICKER_USERS = 500`. — criterion: cap test green with every call at `pageSize` 100. Evidence: `warns when the user picker hits its cap` passes.
- [x] 6. Mirror the selection into the query string alongside the existing paged params. — criterion: `?organization=<id>` written on select and read on construction. Evidence: `restores the selection from the organization query parameter` passes; Cypress asserts `cy.location('search')` contains `organization=<id>`.
- [x] 7. Add the CSS to `src/styles.css`. — criterion: `.admin-org-workbench` grid + `@media (max-width: 900px)` collapse present. Evidence: `src/styles.css` lines added after `.admin-row-grid`.
- [x] 8. Update `cypress/e2e/admin-orgs.cy.js` for the new selectors and add the assignment flow. — criterion: spec passes with the added flow. Evidence: `5 passing (4s)`, previously 4.
- [x] 9. Run `npx vitest run src/app`, `npm run lint`, `npm run typecheck`, `npx vitest run src/app/shared/data-cy-coverage.test.ts`, `npx cypress run --spec cypress/e2e/admin-orgs.cy.js`. — criterion: all green. Evidence: `Test Files 110 passed (110) / Tests 1007 passed (1007)`, `All files pass linting.`, typecheck silent, `5 passing`.

## Outputs

- Files touched: `src/app/features/admin/admin-organizations.component.ts` (+ new test), `src/app/i18n/messages.ts`, `src/styles.css`, `cypress/e2e/admin-orgs.cy.js`.
- Behaviour change: `/admin/organizations` is now the single organization ↔ organizer management screen.

## Validation

- [x] `npx vitest run src/app/features/admin` passes — `Test Files 2 passed (2) / Tests 10 passed (10)`
- [x] `npx cypress run --spec cypress/e2e/admin-orgs.cy.js` passes — `5 passing (4s)`, 0 failing
- [x] `npm run lint && npm run typecheck` pass — `All files pass linting.`; `tsc --noEmit` on app + spec projects silent
- [ ] manual check: as admin, create an org, add two users, remove one, remove the last one, confirm the Draft badge and the role changes on `/admin/users` — browser half is human-only, moved to `ai-artifacts/manual_test_checklist.md`. The data half was verified against the live dev API (create → `memberCount 1`, add `gones-player-1` → `globalRole Organizer`, remove → back to `User`, remove last member → `memberCount 0, isDraft true`).
- [x] app functional — organization edit, delete, restore and paging still work — live API run against `http://127.0.0.1:5080`: `PUT 200`, `DELETE 204`, `restore 204`, `?page=1&pageSize=2` → `page 1 size 2 total 19`
- [x] commit msg draft: `feat(admin): manage organizations and their organizers on one screen`
- [x] hard gate: `npx cypress run --spec cypress/e2e/accessibility.cy.js` still `11 passing`, 0 failing (route not added to the axe sweep by this ticket)
- [x] full suite: `npm run test` — `Test Files 110 passed (110) / Tests 1007 passed (1007)`
