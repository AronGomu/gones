# T16: Tournament proposal entity, submit endpoint, approver mail

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T15
**Commit outcome:** A verified non-organizer can POST a tournament proposal; it is stored with a signed single-use token per chosen approver, and every selected Admin/Organizer receives an email linking to the review page.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is the backend half of Tournament Event Creation §2 steps 1-4: the approver list, the stored proposal, and the mail carrying every field the submitter typed.
- This slice: entity, migration, two endpoints (list approvers, submit proposal), one notification template. The approve/deny endpoints are T17, the UI is T18/T19.
- Out of scope here: approving, denying, cancellation reasons, any frontend.
- Assumptions in force:
  - **A8** — the review link carries a **signed single-use token**, 7-day expiry, no login required. Each recipient gets a distinct token so the approver identity is provable from the token alone.
  - A proposal stores the tournament payload as JSON, not as a draft `ScheduledTournament`, so an unapproved proposal can never leak into the public calendar.
  - Organizers and Admins keep publishing directly through `POST /api/tournaments/`; they never create proposals.

## Requirements

- New entity `TournamentProposal` with `Id`, `SubmittedByUserId`, `PayloadJson`, `Status` (`Pending` | `Approved` | `Rejected`), `CreatedAt`, `ExpiresAt`, `DecidedAt`, `DecidedByUserId`, `RejectionReason`, and a child `TournamentProposalRecipient` with `Id`, `ProposalId`, `UserId`, `TokenHash`, `SentAt`.
- `GET /api/tournament-proposals/approvers` requires `AuthorizationPolicies.User` and returns every non-disabled user whose `GlobalRole` is `Organizer` or `Admin`, projected as `{ id, username, globalRole }` — never their email.
- `POST /api/tournament-proposals` requires `AuthorizationPolicies.User`, a verified email, a non-empty `recipientUserIds` array, and the same payload shape `POST /api/tournaments/preview` accepts.
- Each recipient row stores only a SHA-256 hash of its token; the plaintext token exists only inside the email link.
- Every recipient receives one email through the existing outbox, containing every submitted field and a link to `{PublicAppOrigin}/tournament-requests/{token}`.
- Tokens expire 7 days after creation.
- A user with `GlobalRole` `Organizer` or `Admin` calling `POST /api/tournament-proposals` gets `403` — they must publish directly.
- Rate-limited per account so a single user cannot spam every approver.

## Inputs

- `backend/src/Gones.Api/Tournaments/TournamentPublicationEndpoints.cs`:
  - `:28-39` — `var group = app.MapGroup("/api/tournaments").RequireAuthorization(AuthorizationPolicies.Organizer);` then `group.MapPost("/preview", PreviewAsync)` and `group.MapPost("/", PublishAsync)`.
  - The publish request record and its validation live in this file; **reuse that record type** for the proposal payload rather than defining a parallel shape.
  - `:83` — `httpResponse.Headers.Location = outcome.Location;` and `:440` `internal sealed record TournamentPublishOutcome(TournamentPublishResponse Response, string Location, string ETag);` — T17 will need the publish path, so keep the publish logic reachable from a method, not inlined in the endpoint lambda.
- `backend/src/Gones.Application/Notifications/NotificationContracts.cs`:
  - `NotificationTemplateKeys` — string constants `VerifyEmail`, `ResetPassword`, `Registration`, `Unregistration`, `MajorUpdate`, `Cancellation`, `Reminder`, `OrganizerNotice`.
  - `public abstract record NotificationTemplateModel;` and one `sealed record` per template, e.g. `OrganizerNoticeTemplateModel(string OrganizerName, string ParticipantName, string TournamentName, string Notice, Uri TournamentUrl)`.
  - `NotificationRequest(string Recipient, string Locale, string DedupeKey, NotificationTemplateModel Model, Guid? UserId = null, Guid? TournamentId = null)` and `INotificationOutbox.Enqueue(NotificationRequest)`.
- `backend/src/Gones.Application/Notifications/NotificationTemplateRenderer.cs`:
  - `:17-28` — the `Subjects` dictionary maps every template key to a `(French, English)` subject; a new key **must** be added there or `Render` throws on lookup.
  - Templates are loaded as embedded resources per locale and file type: `LoadTemplate(locale, templateKey, "html"|"txt")`.
  - Placeholders are `{{PascalCaseName}}`, substituted from the model's properties.
- `backend/src/Gones.Application/Notifications/Templates/en/` and `.../fr/` — one `.html` and one `.txt` per template key (`organizer-notice.html`, `organizer-notice.txt`, …). Both locales are required.
- `NotificationModelSerializer.TemplateKey(model)` (same namespace) maps a model type to its template key; a new model must be registered there too.
- `backend/src/Gones.Api/Tournaments/TournamentRegistrationEndpoints.cs:544-640` — the canonical `outbox.Enqueue(new NotificationRequest(...))` call sites, including how `DedupeKey` is built. Copy that idiom.
- `backend/src/Gones.Api/Identity/AccountLifecycleService.cs:82` — the pattern for issuing a hashed, expiring token and mailing its plaintext; reuse its hashing helper rather than writing a new one.
- Public app origin: configuration key surfaced as `GONES_PUBLIC_APP_ORIGIN` (see `scripts/generate-api.mjs`); resolve it the same way `AccountLifecycleService` does when building verification links.
- `backend/src/Gones.Api/Security/AuthorizationPolicies.cs` — `User`, `Organizer`, `Admin`; `AuthRateLimiting.IpPolicy` and the account rate-limit filter `AuthAccountRateLimitFilter` live in `backend/src/Gones.Api/Security/`.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs` — add the two `DbSet`s here; `SnakeCaseModelBuilderExtensions` names the columns.
- Verified present: `npm run notification:smoke` → `node scripts/smoke-notification.mjs` (`package.json:21`), and the
  migrations live in `backend/src/Gones.Infrastructure/Persistence/Migrations/` alongside
  `GonesDbContextModelSnapshot.cs`. The two most recent are `20260808161811_SplitProfileLocationAndBirthDate` and
  `20260808164636_AllowAccountHardDelete` — follow their file shape.
- **Known host flake, do not chase it.** A full `npm run backend:test` intermittently fails 1-3 random test *classes*
  at `InitializeAsync` with `Docker.DotNet.DockerApiException … RootlessKit PortManager.AddPort(): bind: address
  already in use`. Never an assertion failure, different classes each run, predates this plan. Re-run the affected
  class alone (`dotnet test … --filter <ClassName>`) to confirm; a class that passes in isolation is green.
- Postgres and the API are already running under docker compose (`gones-postgres-1`, `gones-api-1` on 5080). Do not
  tear them down or recreate them — step 27 needs Postgres, and it is already up.
- **From Depends (T15):** `/tournaments/new` exists client-side for every verified account, and the submit button for non-organizers is disabled with `data-cy="tournament-submit-pending-approval"`. Nothing in the frontend calls this ticket's endpoints yet.

## TDD

1. **Red** — add `backend/tests/Gones.IntegrationTests/TournamentProposalTests.cs` with every row below; the routes 404.
2. **Green** — entity, configuration, migration, endpoints, template, outbox wiring.
3. **Refactor** — extract `PublishTournamentAsync(payload, actingUserId, …)` out of `PublishAsync` so T17 can call it without going through HTTP.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Approvers_requires_authentication` | no token | `401` |
| `Approvers_lists_organizers_and_admins` | seeded roles | contains the Organizer and Admin, excludes plain Users |
| `Approvers_never_returns_emails` | response JSON | no `email` property on any item |
| `Submit_requires_a_verified_email` | unverified user | `403` |
| `Submit_rejects_an_organizer` | `GlobalRole = Organizer` | `403` |
| `Submit_requires_at_least_one_recipient` | `recipientUserIds: []` | `400` naming `recipientUserIds` |
| `Submit_rejects_a_non_approver_recipient` | a plain user's id | `400` naming `recipientUserIds` |
| `Submit_stores_the_proposal` | valid payload, 2 recipients | `201`; one `tournament_proposals` row `Status = Pending`; two recipient rows |
| `Submit_stores_only_token_hashes` | same | `token_hash` is 64 hex chars; no column contains the plaintext |
| `Submit_enqueues_one_mail_per_recipient` | same | two outbox rows, template key `tournament-proposal`, distinct dedupe keys |
| `Submit_mail_contains_every_field` | payload with title, venue, dates, formats | the rendered text body contains each value |
| `Submit_sets_a_seven_day_expiry` | same | `expires_at == created_at + 7 days` |
| `Submit_creates_no_public_tournament` | same | `GET /api/tournaments/all` count unchanged |
| `Submit_is_rate_limited` | 11 submissions in a row | at least one `429` |

Run: `npm run backend:test`

## Impl steps

- [x] 1. Ensure the EF CLI exists: `dotnet ef --version`; install with `dotnet tool install --global dotnet-ef` if missing.
- [x] 2. Create `backend/src/Gones.Domain/Calendar/TournamentProposal.cs` with `public sealed class TournamentProposal` (private ctor, `Create(...)` factory, `Approve(Guid decidedBy, Instant now)`, `Reject(Guid? decidedBy, string reason, Instant now)`), the `TournamentProposalStatus` enum, and `public sealed class TournamentProposalRecipient`.
- [x] 3. Add `public DbSet<TournamentProposal> TournamentProposals` and `public DbSet<TournamentProposalRecipient> TournamentProposalRecipients` to `GonesDbContext`.
- [x] 4. Create `backend/src/Gones.Infrastructure/Persistence/TournamentProposalConfigurations.cs`: `PayloadJson` as `jsonb`, `TokenHash` `char(64)` with a unique index, `Status` stored as a string, cascade from proposal to recipients, and an index on `(Status, ExpiresAt)`.
- [x] 5. Run the migration with **both** project flags pointing at `Gones.Infrastructure` — `Gones.Api` does not reference `Microsoft.EntityFrameworkCore.Design`, so the `--startup-project backend/src/Gones.Api` form fails on this repo (verified: the package reference exists only in `backend/src/Gones.Infrastructure/Gones.Infrastructure.csproj:12`). Export `DOTNET_ROOT` first:
  ```
  export DOTNET_ROOT="$(dirname "$(readlink -f "$(which dotnet)")")"
  dotnet ef migrations add AddTournamentProposals \
    --project backend/src/Gones.Infrastructure \
    --startup-project backend/src/Gones.Infrastructure \
    --output-dir Persistence/Migrations
  ```
  Review the generated SQL before moving on — validate: the new file appears in `backend/src/Gones.Infrastructure/Persistence/Migrations/` and `GonesDbContextModelSnapshot.cs` is updated.
- [x] 6. Create `backend/src/Gones.Api/Tournaments/TournamentProposalEndpoints.cs` with `public static void MapTournamentProposalEndpoints(this WebApplication app)` and register it from `Program.cs` next to the other `Map*Endpoints` calls.
- [x] 7. Register `var proposals = app.MapGroup("/api/tournament-proposals").RequireAuthorization(AuthorizationPolicies.User);` then `proposals.MapGet("/approvers", ListApproversAsync).Produces<IReadOnlyList<ProposalApproverResponse>>();`
- [x] 8. Implement `ListApproversAsync` querying `database.Users.AsNoTracking().Where(user => user.GlobalRole == "Organizer" || user.GlobalRole == "Admin")` joined to `UserProfiles` for the username, ordered by username, projected to `internal sealed record ProposalApproverResponse(Guid Id, string Username, string GlobalRole);`.
- [x] 9. Register the submit route:
  ```
  proposals.MapPost(string.Empty, SubmitAsync)
      .RequireRateLimiting(AuthRateLimiting.IpPolicy)
      .AddEndpointFilter<DataAnnotationsValidationFilter>()
      .Produces<TournamentProposalResponse>(StatusCodes.Status201Created)
      .ProducesProblem(StatusCodes.Status400BadRequest)
      .ProducesProblem(StatusCodes.Status403Forbidden)
      .ProducesProblem(StatusCodes.Status429TooManyRequests);
  ```
- [x] 10. Define `internal sealed record TournamentProposalRequest([property: Required] TournamentPublishRequest Tournament, [property: Required, MinLength(1)] IReadOnlyList<Guid> RecipientUserIds);` reusing the publish request record's exact type name from `TournamentPublicationEndpoints.cs`.
- [x] 11. In `SubmitAsync`: resolve the caller, reject with `403` when `!user.EmailConfirmed` or when `GlobalRole` is `Organizer`/`Admin`.
- [x] 12. Validate the recipients: load them, and throw `ApiValidationException` naming `recipientUserIds` when any id is unknown or is not an Organizer/Admin.
- [x] 13. Validate the tournament payload with the same validator `PreviewAsync` uses, so a proposal can never carry a payload that publishing would reject.
- [x] 14. Create the proposal with `PayloadJson = JsonSerializer.Serialize(request.Tournament, jsonOptions)` and `ExpiresAt = now.Plus(Duration.FromDays(7))`.
- [x] 15. For each recipient: generate 32 random bytes with `RandomNumberGenerator.GetBytes(32)`, base64url-encode them as the plaintext token, store `Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant()` as `TokenHash`.
- [x] 16. Add `public const string TournamentProposal = "tournament-proposal";` to `NotificationTemplateKeys`.
- [x] 17. Add `public sealed record TournamentProposalTemplateModel(string ApproverName, string SubmitterName, string TournamentName, string TournamentSummary, string VenueAddress, string StartsAt, string EndsAt, string TimeZoneId, string Formats, string Capacity, Uri ReviewUrl) : NotificationTemplateModel;` to `NotificationContracts.cs`.
- [x] 18. Register the model in `NotificationModelSerializer.TemplateKey(...)` and add the subject pair to `NotificationTemplateRenderer.Subjects`: `("Demande de validation de tournoi", "Tournament approval request")`.
- [x] 19. Create `backend/src/Gones.Application/Notifications/Templates/fr/tournament-proposal.html`, `.../fr/tournament-proposal.txt`, `.../en/tournament-proposal.html`, `.../en/tournament-proposal.txt`, each rendering every `{{Placeholder}}` of the model and the `{{ReviewUrl}}` link. Confirm the `.csproj` includes them as embedded resources — the folder is already globbed, so a new file is picked up automatically; verify with `dotnet build` and a render test.
- [x] 20. Enqueue one `NotificationRequest` per recipient with `Recipient = recipientEmail`, `Locale = recipientProfile.PreferredLanguage`, `DedupeKey = $"tournament-proposal:{proposalId}:{recipientUserId}"`, `UserId = recipientUserId`.
- [x] 21. Build the review URL as `new Uri($"{publicAppOrigin}/tournament-requests/{token}")` using the same origin resolution `AccountLifecycleService` uses.
- [x] 22. Save everything inside one transaction; enqueue only after `SaveChangesAsync` succeeds.
- [x] 23. Return `Results.Created($"/api/tournament-proposals/{proposal.Id}", new TournamentProposalResponse(proposal.Id, "Pending", proposal.ExpiresAt, request.RecipientUserIds.Count))`.
- [x] 24. Extract `internal static Task<TournamentPublishOutcome> PublishTournamentAsync(TournamentPublishRequest request, Guid actingUserId, …)` from `PublishAsync` in `TournamentPublicationEndpoints.cs`, leaving `PublishAsync` a thin wrapper. T17 depends on this.
- [x] 25. Write `backend/tests/Gones.IntegrationTests/TournamentProposalTests.cs` with all fourteen Test plan rows.
- [x] 26. Run `npm run backend:test`. — 196 unit + 14 architecture + 332 integration pass. The documented
  RootlessKit port flake hit a different class on each full run (`LocalIdentityApiTests`, `OAuthApiTests`,
  `DeckArchetypeCatalogApiTests`, `NotificationOutboxTests`, `TournamentRegistrationApiTests`), always at
  `InitializeAsync` and never as an assertion; every one of them passes re-run alone.
- [x] 27. Postgres was already up (`gones-postgres-1`), so it was reused rather than recreated;
  `npm run api:generate` regenerated `src/app/api/generated/gones-api.ts` **and** `backend/openapi/gones.json`
  (`api:check` compares both) — 355 insertions, 0 deletions, i.e. purely additive.
- [x] 28. Run `npm run api:check && npm run test && npm run lint && npm run typecheck && npm run build`. —
  api:check clean; vitest 439/439; lint "All files pass linting"; typecheck clean; build produced `dist/gones`.
- [x] 29. `npm run notification:smoke` passes ("one fake delivery, terminal payload scrubbed") against the
  compose worker, whose transport is `GONES_EMAIL_TRANSPORT=File` writing to `/tmp/gones-email-sink` — no real
  provider anywhere in the loop. That smoke enqueues `verify-email` only, and teaching it `tournament-proposal`
  would mean rebuilding and recreating `gones-worker-1`, which this job forbids. The new template's both-locale
  render is proven instead by `NotificationTemplateRendererTests.Tournament_proposal_renders_every_submitted_field_in_both_locales`
  and `TournamentProposalTests.Submit_mail_contains_every_field`.

## Outputs

- Files created: `backend/src/Gones.Domain/Calendar/TournamentProposal.cs`, `backend/src/Gones.Infrastructure/Persistence/TournamentProposalConfigurations.cs`, `backend/src/Gones.Infrastructure/Persistence/Migrations/*_AddTournamentProposals.cs` (+ Designer), `backend/src/Gones.Api/Tournaments/TournamentProposalEndpoints.cs`, four notification template files, `backend/tests/Gones.IntegrationTests/TournamentProposalTests.cs`.
- Files touched: `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs`, `backend/src/Gones.Infrastructure/Persistence/GonesDbContextModelSnapshot.cs`, `backend/src/Gones.Api/Program.cs`, `backend/src/Gones.Api/Tournaments/TournamentPublicationEndpoints.cs`, `backend/src/Gones.Application/Notifications/NotificationContracts.cs`, `backend/src/Gones.Application/Notifications/NotificationTemplateRenderer.cs`, `src/app/api/generated/gones-api.ts`.
- Public API / behavior change: two new endpoints under `/api/tournament-proposals`.
- Migrate / config: one EF migration adding two tables.

## Validation

- [x] `npm run backend:test` passes (see step 26 on the host's port-bind flake)
- [x] `npm run api:check` reports no drift
- [x] `npm run test && npm run lint && npm run typecheck && npm run build` pass
- [x] `tournament-proposal` renders in both locales — subjects "Demande de validation de tournoi" / "Tournament
  approval request", every submitted field present in each body, and the stored safe preview redacts the review
  token. `npm run notification:smoke` passes and confirms the File sink transport; see step 29 for why the smoke
  itself still carries `verify-email`.
- [ ] manual check: submit a proposal with curl as a verified plain user; inspect the local mail sink and confirm
  the link and every submitted field are present — **not performed.** It needs an auth call against the local API
  on 5080, which this job forbids (tight shared rate limit), and `gones-api-1` still runs a pre-change image that
  has no such route. `TournamentProposalTests.Submit_mail_contains_every_field` covers the same ground: it renders
  the real enqueued outbox row and asserts the review link plus every submitted field.
- [x] app functional — direct publishing by organizers unchanged (`TournamentPublicationApiTests` 16/16 green,
  untouched) and the public calendar shows no proposal (`Submit_creates_no_public_tournament`: `GET /api/tournaments/all`
  count identical before and after a submit, `scheduled_tournaments` still empty).
- [x] commit msg draft: `feat(tournaments): store tournament proposals and mail their approvers a signed review link`
