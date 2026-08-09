# T26: Scope tournament proposals to a public org list with org-scoped approvers *(parent-added, user-decided)*

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T25
**Commit outcome:** Any verified user can propose a tournament for any organization, and only someone who represents that organization can approve it.

## Why this ticket exists

The post-run reviewer fanout found two blockers that are opposite halves of one decision the plan never made.

- **Correctness:** `organizer-tournament-create.component.ts:265` calls `client.organizationsAll()`, which resolves to
  `GET /api/users/me/organizations` (`gones-api.ts:8802`) — a **member-only** join
  (`OrganizationEndpoints.cs:158-171`). A newly registered verified user belongs to no organization, so the list is
  `[]`, `organizationId` stays `''`, the `<select>` renders zero options, and
  `[data-cy=tournament-submit-for-approval]` — which is **not** disabled on an empty list — returns immediately
  because the form is invalid. **The T15→T19 feature chain cannot be used by the user it was built for.**
  `docs/RELEASE_NOTES_V1.md:90` claims "Anyone can propose a tournament".
- **Security:** the backend accepts **any** `organizationId` (`NormalizeAsync(requireMembership: false)`) and
  `GET /api/tournament-proposals/approvers` returns **every** global Organizer/Admin with no relation to the target
  org. So one unrelated organizer can publish a live public tournament under an organization neither party belongs to,
  carrying that org's name, website and contact email, with registrations opening under it.

Fixing the first by simply switching to the public list would hand every user a front door to the second.

**The user has decided:** the picker uses the public list, and the approver list narrows to Organizers/Admins **of the
target organization**, plus global Admins. "Anyone can propose" is honoured; nothing publishes into an organization
without someone who represents it consenting.

## Requirements

- The creation form's organization picker is populated from the **anonymous** `GET /api/organizations`, so a verified
  user with zero memberships sees every organization and can submit a proposal.
- `GET /api/tournament-proposals/approvers` takes the **target organization** and returns only:
  Organizers **and** Admins holding an `organization_members` row for that organization, **plus** all global Admins.
  Global Admins remain a universal fallback so no organization can become unreachable.
- Submission **rejects** a recipient who is neither an org-scoped Organizer/Admin of the target org nor a global Admin.
  The `RecipientUserIds` list also gains an upper bound.
- **The token re-checks authority at decision time**, not only at submission: an approver demoted to `User`, whose
  profile is closed, or who has lost their membership of the target organization, can no longer publish from a link
  mailed up to 7 days earlier.
- **`ApproveAsync` takes the proposal lock before publishing.** Today it publishes first, so an approve racing a reject
  leaves a live registerable tournament attached to a `Rejected` proposal, the submitter mailed a refusal, and the
  approver shown a 409, with nothing unpublishing it.
- `docs/adr/0024-tournament-proposal-signed-token-approval.md` records the decision and supersedes the
  `requireMembership: false` rationale currently living only in a code comment.
- No regression: `npm run test`, `lint`, `typecheck`, `build`, `backend:test`, `api:check`, `acceptance:matrix`,
  `e2e:ci` all stay green.

## Inputs

- `backend/src/Gones.Api/Tournaments/TournamentProposalEndpoints.cs`
  - `:80-93` `ListApproversAsync` — currently `from user in Users join profile in UserProfiles where
    (GlobalRole == Organizer || GlobalRole == Admin) && profile.ClosedAt == null`, no organization filter at all.
    It must take the target organization and join `OrganizationMembers`. The endpoint's own doc comment promises
    "no email leaves this endpoint" — keep that true.
  - `:166-184` `ApproveAsync` — publishes via `PublishTournamentAsync` **before** `LockAsync`. The inverse order is
    documented at `:144-149`, but that rationale only covers approve-retry idempotency, not approve-vs-reject.
  - `:173-175` the `requireMembership: false` comment — the decision it records is being narrowed, not removed:
    the **submitter** still need not be a member; the **approver** now must represent the org.
  - `:277-296` `ResolveTokenAsync` — resolves by hash and checks proposal expiry only. Add the authority re-check here
    (one join to `Users`/`UserProfiles`/`OrganizationMembers`).
  - `:394-396` `ValidateProposalPayloadAsync` → `NormalizeAsync` — only checks the org exists and is not soft-deleted.
  - `:452-480`, `:528` `RecipientUserIds` — `MinLength(1)`, **no upper bound**.
- `backend/src/Gones.Api/Organizations/OrganizationEndpoints.cs:20-21` — `GET /api/organizations`,
  `ListPublicOrganizationsAsync`, `.AllowAnonymous()`. This is the list the picker must use.
  `:158-171` `ListMyOrganizationsAsync` is the member-only one it uses today.
- `src/app/features/calendar/organizer-tournament-create.component.ts`
  - `:265` `await firstValueFrom(this.client.organizationsAll())` — the defect.
  - `:270` raises `tournamentCreate.noOrganizations` when the list is empty.
  - `:143` `[data-cy=tournament-submit-for-approval]`, not disabled on an empty list.
  - `:305` `submitForApproval()` returns early on `form.invalid`.
  - **Note:** an Organizer who *can* publish directly still needs their own membership list for the direct-publish
    path. Do not break that — the public list is for the proposal path. Read `canPublishDirectly()` before choosing
    whether to swap the call or fetch both.
- `src/app/features/calendar/approver-selection-dialog.component.ts` (T18) — opens the approver checkbox dialog; it
  must pass the chosen organization through to the approvers request.
- `backend/tests/Gones.IntegrationTests/TournamentProposalTests.cs` (14 facts) and
  `TournamentProposalDecisionTests.cs` (18 facts) — the strongest suites in the branch. Extend, do not rewrite.
- Regeneration: `docker compose up -d postgres` then `npm run api:generate`; `npm run api:check` verifies.

## Environment facts

- **`dotnet ef` / migrations:** this ticket should need **no** migration — it is a query and authorization change. If
  you conclude one is needed, stop and report before scaffolding.
- `npm run e2e:ci` is the full gate (bare `npm run cy:run` dies on this NixOS host). It rebuilds the release profile
  and sets `GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT: '1000'`, so the auth rate limit does not constrain it.
- **The ngsw trap:** on the release build `cy.visit`'s `onBeforeLoad` is silently never called, because the service
  worker answers the navigation from its own cache. Seed from the loaded window via `cy.window()` as well.
- **No Angular `TestBed`, no zone.js**, `@angular/common/http/testing` not installed. Services → `Injector.create` +
  `vi.fn()` stubs; components → bare `Injector` + `runInInjectionContext` with `effect()` stubbed.
- Backend suite: 1-3 random test *classes* intermittently fail at `InitializeAsync` with
  `Docker.DotNet … bind: address already in use`. Never an assertion. Re-run the class alone before believing it.
- **`data-cy` is mandatory** on every element you add: unique per file, kebab-case, feature-prefixed. The allowlist is
  empty and `data-cy-coverage.test.ts` enforces it repo-wide — a new untagged element fails the suite.

## TDD

1. **Red** — add the integration facts below and watch them fail: a non-member submitter cannot currently be offered
   a public org; an unrelated organizer is currently accepted as a recipient; a demoted approver currently publishes.
2. **Green** — narrow the approver query, validate recipients, re-check at decision time, reorder approve.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Approvers_are_scoped_to_the_target_organization` | `GET /approvers` for org A | only A's Organizers/Admins + global Admins; an Organizer of org B absent |
| `Global_admins_are_always_offered` | org with no organizer members | global Admins still returned, list non-empty |
| `Submission_rejects_an_unrelated_recipient` | recipient = Organizer of org B, target org A | `400`, no proposal row |
| `Submission_rejects_an_oversized_recipient_list` | recipients above the cap | `400` |
| `Non_member_can_submit_for_a_public_organization` | verified `User`, zero memberships, org A | `201`, proposal stored |
| `Demoted_approver_cannot_publish` | approver demoted to `User` after submission | token decision refused, no tournament published |
| `Approver_who_lost_membership_cannot_publish` | membership removed after submission | refused |
| `Approve_racing_reject_publishes_nothing` | reject commits between approve's checks | no published tournament survives a `Rejected` proposal |
| `Creation_form_lists_public_organizations` | component with zero memberships | picker options non-empty, submit reachable |
| `data-cy coverage` | full suite | green with an empty allowlist |

Run: `npm run backend:test` then `npm run test`

## Impl steps

- [ ] 1. Read `docs/adr/0024-tournament-proposal-signed-token-approval.md` before coding — it is the specification being amended.
- [ ] 2. Add the target organization to `GET /api/tournament-proposals/approvers` and narrow the query to org-scoped Organizers/Admins **plus** global Admins — validate: `Approvers_are_scoped_to_the_target_organization` + `Global_admins_are_always_offered` pass; no email field appears in the response.
- [ ] 3. Validate recipients at submission against that same rule, and add an upper bound to `RecipientUserIds` — validate: the two rejection facts pass.
- [ ] 4. Re-check approver authority in `ResolveTokenAsync` (role, `ClosedAt`, membership of the target org) — validate: `Demoted_approver_cannot_publish` + `Approver_who_lost_membership_cannot_publish` pass.
- [ ] 5. Reorder `ApproveAsync` to take the proposal lock **before** publishing — validate: `Approve_racing_reject_publishes_nothing` passes and the existing `Approve_twice_conflicts` still passes.
- [ ] 6. `npm run api:generate`, commit the regenerated client — validate: `npm run api:check` exit 0.
- [ ] 7. Point the creation form's proposal picker at the anonymous public organization list, keeping the direct-publish path's membership list intact — validate: `Creation_form_lists_public_organizations`; an Organizer can still publish directly.
- [ ] 8. Disable `[data-cy=tournament-submit-for-approval]` while no organization is selected, so the dead-click at `:143`/`:305` cannot recur — validate: a component test asserts the disabled state.
- [ ] 9. Pass the chosen organization from the approver-selection dialog through to the approvers request — validate: the dialog shows only org-scoped approvers.
- [ ] 10. Amend `docs/adr/0024-…md`: record the org-scoped approver rule, and replace the `requireMembership: false` rationale that currently lives only in a code comment. State plainly that the **submitter** still need not be a member and the **approver** now must represent the organization.
- [ ] 11. Update `docs/RELEASE_NOTES_V1.md` if its proposal wording is now inaccurate.
- [ ] 12. Run `npm run backend:test && npm run test && npm run lint && npm run typecheck && npm run build && npm run api:check && npm run acceptance:matrix`.
- [ ] 13. Run `npm run e2e:ci`.

## Outputs

- Files touched: `backend/src/Gones.Api/Tournaments/TournamentProposalEndpoints.cs`, its tests,
  `src/app/features/calendar/organizer-tournament-create.component.ts`, `approver-selection-dialog.component.ts`,
  `src/app/api/generated/gones-api.ts`, `backend/openapi/gones.json`, `docs/adr/0024-…md`, possibly
  `docs/RELEASE_NOTES_V1.md` and `src/app/i18n/messages.ts`.
- Public API / behavior change: `/approvers` gains a required organization scope and returns fewer people; submission
  rejects unrelated recipients; stale tokens stop working.
- Migrate / config: none expected.

## Validation

- [ ] `npm run backend:test` passes (re-run a flaky class alone before believing a red)
- [ ] `npm run test && npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run api:check` reports no drift
- [ ] `npm run acceptance:matrix` passes
- [ ] `npm run e2e:ci` passes in full
- [ ] manual: a verified user with **zero** memberships reaches `/tournaments/new`, sees organizations, and submits a proposal
- [ ] manual: the approver list for org A contains no Organizer whose only membership is org B
- [ ] app functional — direct publishing by an Organizer is unchanged
- [ ] commit msg draft: `fix(proposals): let any verified user propose and require an approver who represents the org`
