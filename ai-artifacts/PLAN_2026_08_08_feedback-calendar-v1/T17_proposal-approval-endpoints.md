# T17: Proposal approve/deny + cancellation mail

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T16
**Commit outcome:** Presenting a proposal token returns the submitted event for review; approving publishes it as a public tournament; refusing records a reason and mails it to the submitter.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is the second backend half of Tournament Event Creation §2: the "Validate" and "Cancel" actions behind the mailed link, and the "Envoyer Email Raisons Annulation" mail.
- This slice: three token endpoints and one notification template. The pages that call them are T19.
- Out of scope here: any frontend.
- Assumptions in force:
  - **A8** — the token is the credential. No login required. It is single-use: the first decision consumes the whole proposal, and every sibling recipient's token stops working.
  - Approval publishes with the **submitter** as the acting user, so ownership and audit reflect who proposed it, with the approver recorded in the audit diff.

## Requirements

- `GET /api/tournament-proposals/by-token/{token}` is anonymous and returns the proposal payload plus `status`, `submittedByUsername`, `expiresAt` and the approver's own username.
- An unknown, expired or already-decided token returns `404` (unknown/expired) or `409` (already decided) — never a payload.
- `POST /api/tournament-proposals/by-token/{token}/approve` publishes the tournament and marks the proposal `Approved`; the response carries the public slug so the page can link to it.
- `POST /api/tournament-proposals/by-token/{token}/reject` takes `{ "reason": string }` (1..2000 characters), marks the proposal `Rejected`, stores the reason, and mails the submitter.
- Both decisions are idempotent-safe: a second call with any sibling token returns `409`, never a double publish.
- Token comparison is constant-time against the stored SHA-256 hash; the plaintext is never logged.
- Both routes are rate-limited by IP.
- An audit record is written for each decision.

## Inputs

- From T16 — `backend/src/Gones.Api/Tournaments/TournamentProposalEndpoints.cs` with `MapTournamentProposalEndpoints(this WebApplication app)`, the group `app.MapGroup("/api/tournament-proposals").RequireAuthorization(AuthorizationPolicies.User)`, `ListApproversAsync`, `SubmitAsync`, and the records `TournamentProposalRequest`, `TournamentProposalResponse`, `ProposalApproverResponse`.
- From T16 — the entities: `TournamentProposal { Id, SubmittedByUserId, PayloadJson, Status, CreatedAt, ExpiresAt, DecidedAt, DecidedByUserId, RejectionReason }` with methods `Approve(Guid decidedBy, Instant now)` and `Reject(Guid? decidedBy, string reason, Instant now)`; `TournamentProposalRecipient { Id, ProposalId, UserId, TokenHash, SentAt }` where `TokenHash` is the lowercase hex SHA-256 of the plaintext token, unique-indexed.
- From T16 — the publish path, **as actually landed** (the plan's earlier wording named types that do not exist; these are the real ones, verified in the file):
  - `TournamentPublicationService` (`TournamentPublicationEndpoints.cs:92`) is the owning class, and the method is an
    **instance** method, not `internal static`:
    ```csharp
    // TournamentPublicationEndpoints.cs:136
    internal async Task<TournamentPublishOutcome> PublishTournamentAsync(
        TournamentPayloadRequest request, Guid actingUserId, bool isAdmin,
        string idempotencyKey, string? previewTicket, CancellationToken cancellationToken)
    ```
    Inject the service and call it; `previewTicket: null` skips ticket validation (T16 made it nullable for exactly this).
  - The payload record is **`TournamentPayloadRequest`** (`:440`). There is no `TournamentPublishRequest` — the other
    record is `PublishTournamentRequest` (`:455`), which wraps payload + preview ticket and is not what you want.
    Use `TournamentPayloadRequest` everywhere this ticket says `TournamentPublishRequest`, including in
    `TournamentProposalReviewResponse` at step 7.
  - `TournamentPublishOutcome` (`:483`) is `(TournamentPublishResponse Response, string Location, string ETag)`;
    `TournamentPublishResponse` (`:482`) is `(Guid Id, string Slug, string Status)`, so the slug comes from
    `outcome.Response.Slug`.
- **Membership trap — read before writing step 8.** `PublishTournamentAsync` calls
  `NormalizeAsync(actingUserId, isAdmin, request, ct)` with the default `requireMembership: true` (`:253-258`), which
  routes through `access.RequireMemberAsync(...)`. Publishing as `proposal.SubmittedByUserId` — a plain user who is by
  definition **not** a member of the target organization — therefore throws instead of publishing, and approval would
  never work. The file already solves this exact problem at `:250`, where T16's
  `ValidateProposalPayloadAsync` calls `NormalizeAsync(submitterUserId, isAdmin: false, request, ct, requireMembership: false)`.
  Mirror it: thread a `bool requireMembership = true` parameter through `PublishTournamentAsync` to `NormalizeAsync`,
  and pass `requireMembership: false` from the approve path only. `PublishAsync` keeps the default, so direct
  organizer publishing is untouched — prove that with `TournamentPublicationApiTests` still passing unchanged.
- Idempotency: `PublishTournamentAsync` takes an `idempotencyKey`. Derive it deterministically from the proposal
  (`$"tournament-proposal:{proposal.Id:D}"`) so a retried approve cannot create a second tournament even if the
  concurrency guard in step 9 is somehow bypassed.
- From T16 — `NotificationTemplateKeys.TournamentProposal`, `TournamentProposalTemplateModel`, and the four template files under `backend/src/Gones.Application/Notifications/Templates/{fr,en}/tournament-proposal.*`.
- `backend/src/Gones.Application/Notifications/NotificationTemplateRenderer.cs:17-28` — the `Subjects` dictionary; a new template key must be registered there or rendering throws.
- `NotificationModelSerializer.TemplateKey(model)` — must learn the new model type.
- `backend/src/Gones.Api/Tournaments/TournamentRegistrationEndpoints.cs:544-640` — the `outbox.Enqueue(new NotificationRequest(...))` idiom including `DedupeKey` construction.
- `backend/src/Gones.Api/Errors/` — `ResourceNotFoundException`, `ResourceConflictException`, `ApiValidationException`.
- `backend/src/Gones.Api/Security/AuthRateLimiting.cs` — `AuthRateLimiting.IpPolicy`.
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:380-401` — `NewAudit(actorId, action, entityType, entityId, diff, clock)` and `WriteAuditAsync(...)`; mirror the shape for proposal audits.
- Public app origin resolution: the same helper `AccountLifecycleService` uses for verification links (configuration surfaced as `GONES_PUBLIC_APP_ORIGIN`).
- Regeneration: Postgres and the API already run under docker compose — do **not** tear them down or recreate them. Run `npm run api:generate`, then verify with `npm run api:check`. Commit `backend/openapi/gones.json` alongside the generated TS client; `api:check` compares both.
- **Known host flake, do not chase it.** A full `npm run backend:test` intermittently fails 1-3 random test *classes*
  at `InitializeAsync` with `Docker.DotNet.DockerApiException … RootlessKit PortManager.AddPort(): bind: address
  already in use`. Never an assertion failure, different classes each run. Re-run the affected class alone
  (`dotnet test … --filter <ClassName>`); a class that passes in isolation is green.
- `DOTNET_ROOT` is empty in a fresh shell — export it with
  `export DOTNET_ROOT="$(dirname "$(readlink -f "$(which dotnet)")")"` if a `dotnet` command complains.
- Mail transport on this host is the **file sink** (`GONES_EMAIL_TRANSPORT=File`), never a real provider. Confirm that
  before anything is enqueued, and do not configure or call a real provider.
- T16 residual risk that also touches this ticket: the compose `permissions` service granted privileges on all tables
  at setup time, so the proposal tables have no grants for the local `gones_app` role yet. Integration tests are
  unaffected (they use the container superuser) — but do not conclude from a live-API failure on 5080 that your code
  is wrong.
- **From Depends (T16):** the proposal tables exist, the submit endpoint works, and one mail per recipient is enqueued with a plaintext token embedded in `{PublicAppOrigin}/tournament-requests/{token}`.

## TDD

1. **Red** — add `backend/tests/Gones.IntegrationTests/TournamentProposalDecisionTests.cs` with every row below; the routes 404.
2. **Green** — add the three endpoints, the rejection template and the audit records.
3. **Refactor** — extract `private static async Task<(TournamentProposal Proposal, TournamentProposalRecipient Recipient)> ResolveTokenAsync(string token, …)` used by all three endpoints.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Get_by_token_returns_the_payload` | a fresh token | `200` with the submitted title, venue, dates and formats |
| `Get_by_token_is_anonymous` | no auth header | `200` |
| `Get_by_token_rejects_an_unknown_token` | random string | `404` |
| `Get_by_token_rejects_an_expired_token` | proposal aged past `ExpiresAt` | `404` |
| `Approve_publishes_the_tournament` | valid token | `200` with a `slug`; `GET /api/tournaments/{slug}` returns `200` |
| `Approve_marks_the_proposal_decided` | same | `Status = Approved`, `DecidedByUserId` = the recipient's user |
| `Approve_records_an_audit_row` | same | one `tournament-proposal.approved` audit row naming the proposal id |
| `Approve_twice_conflicts` | replay with a sibling recipient's token | `409`; exactly one public tournament exists |
| `Reject_requires_a_reason` | `{"reason":""}` | `400` naming `reason` |
| `Reject_caps_the_reason_length` | 2001 characters | `400` naming `reason` |
| `Reject_marks_the_proposal_rejected` | valid reason | `Status = Rejected`, `RejectionReason` stored |
| `Reject_mails_the_submitter` | same | one outbox row to the submitter, template `tournament-proposal-rejected`, body contains the reason |
| `Reject_publishes_nothing` | same | `GET /api/tournaments/all` count unchanged |
| `Reject_after_approve_conflicts` | approve then reject | `409` |
| `Decision_is_rate_limited` | 21 attempts from one IP | at least one `429` |

Run: `npm run backend:test`

## Impl steps

- [ ] 1. In `backend/src/Gones.Api/Tournaments/TournamentProposalEndpoints.cs`, add an anonymous group: `var tokens = app.MapGroup("/api/tournament-proposals/by-token").AllowAnonymous().RequireRateLimiting(AuthRateLimiting.IpPolicy);`
- [ ] 2. Register `tokens.MapGet("/{token}", GetByTokenAsync).Produces<TournamentProposalReviewResponse>().ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);`
- [ ] 3. Register `tokens.MapPost("/{token}/approve", ApproveAsync).Produces<TournamentProposalDecisionResponse>().ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);`
- [ ] 4. Register `tokens.MapPost("/{token}/reject", RejectAsync).AddEndpointFilter<DataAnnotationsValidationFilter>().Produces(StatusCodes.Status204NoContent).ProducesProblem(StatusCodes.Status400BadRequest).ProducesProblem(StatusCodes.Status404NotFound).ProducesProblem(StatusCodes.Status409Conflict);`
- [ ] 5. Implement `private static async Task<(TournamentProposal, TournamentProposalRecipient)> ResolveTokenAsync(string token, GonesDbContext database, IClock clock, CancellationToken cancellationToken)`: hash the token, look the recipient up by `TokenHash`, throw `ResourceNotFoundException` when missing or when `proposal.ExpiresAt <= clock.GetCurrentInstant()`.
- [ ] 6. Compare with `CryptographicOperations.FixedTimeEquals` on the raw hash bytes after the index lookup, so a partial-hash timing signal cannot leak.
- [ ] 7. Implement `GetByTokenAsync`: resolve, throw `ResourceConflictException` when `Status != Pending`, deserialize `PayloadJson`, and return `internal sealed record TournamentProposalReviewResponse(Guid Id, TournamentPublishRequest Tournament, string Status, string SubmittedByUsername, string ApproverUsername, Instant ExpiresAt);`
- [ ] 8. Implement `ApproveAsync`: resolve, conflict when not `Pending`, open a transaction, call `PublishTournamentAsync(payload, proposal.SubmittedByUserId, …)`, then `proposal.Approve(recipient.UserId, now)`, write an audit row `tournament-proposal.approved` with a diff naming the approver and the created tournament id, commit, and return `internal sealed record TournamentProposalDecisionResponse(Guid ProposalId, string Status, string? Slug);`
- [ ] 9. Guard the double-decision race with the proposal's optimistic-concurrency version: reload with `FOR UPDATE` semantics (`database.TournamentProposals.FromSql(...)` or an `xmin` check) and translate a `DbUpdateConcurrencyException` into `ResourceConflictException`.
- [ ] 10. Implement `RejectAsync` taking `internal sealed record TournamentProposalRejectRequest([property: Required, StringLength(2000, MinimumLength = 1)] string Reason);` — resolve, conflict when not `Pending`, `proposal.Reject(recipient.UserId, request.Reason, now)`, write audit `tournament-proposal.rejected`, save, then enqueue the mail, then return `Results.NoContent()`.
- [ ] 11. Add `public const string TournamentProposalRejected = "tournament-proposal-rejected";` to `NotificationTemplateKeys`.
- [ ] 12. Add `public sealed record TournamentProposalRejectedTemplateModel(string SubmitterName, string TournamentName, string ApproverName, string Reason, Uri CalendarUrl) : NotificationTemplateModel;` to `NotificationContracts.cs`.
- [ ] 13. Register the model in `NotificationModelSerializer.TemplateKey(...)` and add the subject pair to `NotificationTemplateRenderer.Subjects`: `("Demande de tournoi refusée", "Tournament request declined")`.
- [ ] 14. Create the four template files `backend/src/Gones.Application/Notifications/Templates/{fr,en}/tournament-proposal-rejected.{html,txt}` rendering every placeholder including `{{Reason}}`.
- [ ] 15. Enqueue with `Recipient = submitterEmail`, `Locale = submitterProfile.PreferredLanguage`, `DedupeKey = $"tournament-proposal-rejected:{proposal.Id}"`, `UserId = proposal.SubmittedByUserId`.
- [ ] 16. Write `backend/tests/Gones.IntegrationTests/TournamentProposalDecisionTests.cs` with all fifteen Test plan rows.
- [ ] 17. Run `npm run backend:test`.
- [ ] 18. Start Postgres (`docker compose up -d postgres`) and run `npm run api:generate`; commit `src/app/api/generated/gones-api.ts`.
- [ ] 19. Run `npm run api:check && npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 20. Run `npm run notification:smoke` and confirm `tournament-proposal-rejected` renders in both locales.
- [ ] 21. Add an `ops/acceptance-matrix.json` row for the proposal capability pointing at both integration test files, then run `npm run acceptance:matrix`.

## Outputs

- Files created: four notification templates, `backend/tests/Gones.IntegrationTests/TournamentProposalDecisionTests.cs`.
- Files touched: `backend/src/Gones.Api/Tournaments/TournamentProposalEndpoints.cs`, `backend/src/Gones.Application/Notifications/NotificationContracts.cs`, `backend/src/Gones.Application/Notifications/NotificationTemplateRenderer.cs`, `src/app/api/generated/gones-api.ts`, `ops/acceptance-matrix.json`.
- Public API / behavior change: three new anonymous token endpoints.
- Migrate / config: none — T16's migration already covers the columns.

## Validation

- [ ] `npm run backend:test` passes
- [ ] `npm run api:check` reports no drift
- [ ] `npm run test && npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run acceptance:matrix` passes
- [ ] `npm run notification:smoke` renders both new templates
- [ ] manual check: submit a proposal, take the token from the mail sink, `GET` it, approve it, and confirm the tournament appears in `/api/tournaments/all`; repeat with a second proposal and reject it, confirming the reason lands in the submitter's mail
- [ ] app functional — no frontend calls these yet; every other tournament flow unchanged
- [ ] commit msg draft: `feat(tournaments): approve or decline a proposal from its signed mail link`
