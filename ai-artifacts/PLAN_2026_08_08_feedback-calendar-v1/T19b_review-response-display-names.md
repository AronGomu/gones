# T19b: Resolve organization and format names on the proposal review response

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T17
**Commit outcome:** `GET /api/tournament-proposals/by-token/{token}` returns the organization name and the format names alongside the raw payload, so the anonymous review page can show an approver what they are deciding on instead of raw GUIDs.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket unblocks T19, the approver review page.
- **Why this ticket exists (parent-added, like T6b and T9b).** T17 shipped
  `TournamentProposalReviewResponse.Tournament` typed as `TournamentPayloadRequest` — the raw submitted form. It
  carries `OrganizationId` (a GUID, no name), `FormatIds` (GUIDs, no names), flat
  `StreetAddress/PostalCode/City/Country`, and `StartsAtLocal`/`EndsAtLocal` only. T19's page has to show an approver
  the event they are approving; rendering `Organization: 4de03b78-…` and `Formats: 9f2a…, 1b3c…` is close to useless
  for that decision, and the page is anonymous so it cannot call the organizer-only lookups. The names must come from
  the review endpoint itself.
- This slice: two extra fields on one existing response record, resolved in the existing handler. Nothing else.
- Out of scope here: any frontend, the approve/reject paths, the payload shape itself, a rendered
  `PublicTournamentDetailResponse` projection. T19 renders its own markup from these fields.

## Requirements

- `TournamentProposalReviewResponse` gains `OrganizationName` (string) and `FormatNames` (`IReadOnlyList<string>`).
- `OrganizationName` is the display name of the payload's `OrganizationId`; `FormatNames` are the names of
  `FormatIds`, ordered the same way the publish path orders formats so the list is stable.
- A deleted or missing organization resolves to an empty string rather than failing the request — the approver should
  still be able to decline a proposal whose organization has since gone away.
- A format id with no matching row is simply absent from `FormatNames`; the request still succeeds.
- No email address, user id or any other new personal data is added to this anonymous response.
- The approve and reject endpoints are unchanged.

## Inputs

- `backend/src/Gones.Api/Tournaments/TournamentProposalEndpoints.cs`:
  - `:118-127` — `GetByTokenAsync` resolves the token, throws `ResourceConflictException` when the proposal is not
    pending, and builds the response via `Payload(proposal)` plus two `UsernameAsync(...)` lookups. Add the two
    resolutions here, in the same handler.
  - `:520-526` — `internal sealed record TournamentProposalReviewResponse(Guid Id, TournamentPayloadRequest Tournament, string Status, string SubmittedByUsername, string ApproverUsername, Instant ExpiresAt);`
    Append the two new members; keep the existing ones in their current order so the generated client stays additive.
  - `Payload(proposal)` deserializes `PayloadJson` into `TournamentPayloadRequest`; read `OrganizationId` and
    `FormatIds` from its result rather than re-parsing the JSON.
- `backend/src/Gones.Api/Tournaments/TournamentPublicationEndpoints.cs` — `NormalizeAsync` loads formats with
  `database.TournamentFormats.AsNoTracking().Where(format => formatIds.Contains(format.Id) && format.DeletedAt == null).OrderBy(format => format.Slug)`.
  Use the **same** ordering (`OrderBy(format => format.Slug)`) so the review list matches what publishing will produce.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs` — `Organizations` and `TournamentFormats` DbSets.
  The organization display column is `Name`.
- `backend/tests/Gones.IntegrationTests/TournamentProposalDecisionTests.cs` — T17's suite, with the fixtures that seed
  an organization, formats and a proposal. Extend it; do not start a new file.
- Regeneration: Postgres and the API already run under docker compose — do **not** tear them down or recreate them.
  Run `npm run api:generate`, then `npm run api:check`. Commit both `backend/openapi/gones.json` and
  `src/app/api/generated/gones-api.ts`; `api:check` compares both.
- **Known host flake, do not chase it.** A full `npm run backend:test` intermittently fails 1-3 random test *classes*
  at `InitializeAsync` with `Docker.DotNet.DockerApiException … RootlessKit PortManager.AddPort(): bind: address
  already in use`. Never an assertion failure. Re-run the affected class alone to confirm.
- `DOTNET_ROOT` is empty in a fresh shell — `export DOTNET_ROOT="$(dirname "$(readlink -f "$(which dotnet)")")"`.
- **From Depends (T17):** the three token endpoints exist and are anonymous; `GET by-token` returns `404` for
  unknown/expired and `409` for already-decided proposals.

## TDD

1. **Red** — add the three Test plan rows to `TournamentProposalDecisionTests.cs`; they fail to compile (the members
   do not exist) and then fail on the assertions.
2. **Green** — add the two members and resolve them in `GetByTokenAsync`.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Get_by_token_returns_display_names` | a proposal for a seeded org with two formats | `organizationName` equals the seeded org name; `formatNames` holds both format names, ordered by slug |
| `Get_by_token_tolerates_a_deleted_organization` | soft-delete the organization, then fetch | `200`, `organizationName` is `""`, the rest of the payload intact |
| `Get_by_token_exposes_no_new_personal_data` | response JSON | contains no `@`, and no property named `email`, `userId`, `submittedByUserId` or `tokenHash` |

Run: `npm run backend:test`

## Impl steps

- [x] 1. Append `string OrganizationName` and `IReadOnlyList<string> FormatNames` to `TournamentProposalReviewResponse` (`TournamentProposalEndpoints.cs:520`), after the existing members — validate: the file compiles and the record's earlier members are unchanged.
- [x] 2. In `GetByTokenAsync`, after `Payload(proposal)`, resolve the organization name: query `database.Organizations.AsNoTracking()` for the payload's `OrganizationId`, selecting `Name`, and fall back to `string.Empty` when the row is missing or soft-deleted — validate: `Get_by_token_tolerates_a_deleted_organization` passes.
- [x] 3. In the same handler resolve the format names: `database.TournamentFormats.AsNoTracking().Where(format => payload.FormatIds.Contains(format.Id) && format.DeletedAt == null).OrderBy(format => format.Slug).Select(format => format.Name)` — validate: `Get_by_token_returns_display_names` shows both names in slug order.
- [x] 4. Materialise both lookups before constructing the response; do not put a query inside the record initializer — validate: no `InvalidOperationException` about a second operation on the same context in the test run.
- [x] 5. Add the three Test plan rows to `backend/tests/Gones.IntegrationTests/TournamentProposalDecisionTests.cs` — validate: they appear in the passing list.
- [x] 6. Run `npm run backend:test` — validate: green, with `TournamentProposalDecisionTests` passing in full.
- [x] 7. Run `npm run api:generate`, then `npm run api:check` — validate: no drift, and `TournamentProposalReviewResponse` in `src/app/api/generated/gones-api.ts` now carries `organizationName: string` and `formatNames: string[]`.
- [x] 8. Run `npm run test && npm run lint && npm run typecheck && npm run build` — validate: all four green (the change is additive, so no frontend edit should be needed).

## Outputs

- Files touched: `backend/src/Gones.Api/Tournaments/TournamentProposalEndpoints.cs`, `backend/tests/Gones.IntegrationTests/TournamentProposalDecisionTests.cs`, `backend/openapi/gones.json`, `src/app/api/generated/gones-api.ts`.
- Public API / behavior change: two additive fields on the anonymous review response.
- Migrate / config: none.

## Validation

- [x] `npm run backend:test` passes
- [x] `npm run api:check` reports no drift
- [x] `npm run test && npm run lint && npm run typecheck && npm run build` pass
- [x] app functional — approve and reject behave exactly as before
- [x] commit msg draft: `feat(tournaments): name the organization and formats on the proposal review response`
