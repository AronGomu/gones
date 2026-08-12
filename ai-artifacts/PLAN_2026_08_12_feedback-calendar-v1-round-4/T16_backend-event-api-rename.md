# T16: Backend Event API rename

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T15
**Commit outcome:** the API serves the calendar under `/api/events/*` with Event-named DTOs; the old `/api/tournaments/*` paths are gone (hard break, no aliases), and the OpenAPI document plus the generated frontend client are regenerated.

## Context (self-contained)

- Goal: ship round 4 of `feedback.md`. This block renames the calendar domain from Tournament to Event, back and front.
- This slice: HTTP surface and DTOs. T15 already renamed entities and tables.
- Out of scope here: Angular components and routes (T17, T18), the archive/live domains, `/api/formats` (shared lookup), `/api/organizations/*`.
- Assumptions in force: hard break, matching the ADR 0022 precedent that the API gets no compatibility aliases. The frontend will be broken between this ticket and T17 at the source level; the build gate for THIS ticket is the backend plus the regenerated client compiling, and the frontend rewire lands in T17. Keep the two commits adjacent.

## Requirements

- Path map (files under `backend/src/Gones.Api/Tournaments/`):
  | old | new |
  | --- | --- |
  | `GET /api/tournaments` | `GET /api/events` |
  | `GET /api/tournaments/all` | `GET /api/events/all` |
  | `GET /api/tournaments/{slug}` | `GET /api/events/{slug}` |
  | `GET /api/tournaments/{slug}/participants` | `GET /api/events/{slug}/participants` |
  | `GET /api/tournaments/{slug}.ics` | `GET /api/events/{slug}.ics` |
  | `POST /api/tournaments` (publish) | `POST /api/events` |
  | `POST /api/tournaments/preview` | `POST /api/events/preview` |
  | `POST /api/tournaments/{id}/registrations` | `POST /api/events/{id}/registrations` |
  | every remaining `/api/tournaments/...` route in the group | same path with `events` |
  Enumerate them exactly with `grep -rn "api/tournaments" backend/src --include=*.cs`.
- File renames in `backend/src/Gones.Api/Tournaments/` → new directory `backend/src/Gones.Api/Events/`: `PublicTournamentEndpoints.cs` → `PublicEventEndpoints.cs`, `TournamentPublicationEndpoints.cs` → `EventPublicationEndpoints.cs`, `TournamentRegistrationEndpoints.cs` → `EventRegistrationEndpoints.cs`, `TournamentLifecycleEndpoints.cs` → `EventLifecycleEndpoints.cs`, `TournamentProposalEndpoints.cs` → `EventProposalEndpoints.cs`, `OrganizerParticipantEndpoints.cs` (keep the name), `TournamentPreviewTicketService.cs` → `EventPreviewTicketService.cs`. Namespace `Gones.Api.Tournaments` → `Gones.Api.Events`.
- DTO record renames (prefix swap `Tournament` → `Event`), e.g. `PublicTournamentSummaryResponse` → `PublicEventSummaryResponse`, `PublicTournamentDetailResponse` → `PublicEventDetailResponse`, `PublicTournamentParticipantResponse` → `PublicEventParticipantResponse`, `TournamentRegistrationCapabilityResponse` → `EventRegistrationCapabilityResponse`, `PublishTournamentRequest` → `PublishEventRequest`, `TournamentPublishResponse` → `EventPublishResponse`, `TournamentPreviewRenderResponse` → `EventPreviewRenderResponse`, `TournamentProposal*Request/Response` → `EventProposal*`. Enumerate with `grep -rn "record .*Tournament.*Response\|record .*Tournament.*Request" backend/src --include=*.cs`.
- JSON property names follow the DTO rename where the property itself carries the word (e.g. `tournamentId` → `eventId`). Search the frontend afterwards in T17 for every renamed field.
- Error codes containing `tournament` are renamed to `event_*` — enumerate with `grep -rn "\"tournament_" backend/src --include=*.cs` — and the frontend mapping in `src/app/features/calendar/tournament-registration.service.ts` is updated in T17.
- `backend/src/Gones.Api/Program.cs` endpoint registrations updated to the new class names.
- Regenerate OpenAPI + client: `npm run generate:api` (implementation `scripts/generate-api.mjs`), producing `backend/openapi/*` and `src/app/api/generated/gones-api.ts`.
- Update backend test files' route strings; rename the test files themselves to match (`PublicTournamentApiTests.cs` → `PublicEventApiTests.cs`, etc.).
- Update `ops/acceptance-matrix.json` evidence targets that name renamed files (T19 does the final sweep, but keep the matrix test green here).

## Inputs

- `backend/src/Gones.Api/Tournaments/PublicTournamentEndpoints.cs` — routes at lines 29-52.
- `backend/src/Gones.Api/Tournaments/TournamentPublicationEndpoints.cs` — `MapGroup("/api/tournaments")` at line 28, `PublishAsync`, the `organization_is_draft` gate added by T11 at ~line 287.
- `backend/src/Gones.Api/Tournaments/OrganizerParticipantEndpoints.cs` — builds `Results.Created($"/api/tournaments/{tournamentId:D}/registrations/…")` at line 173.
- `scripts/generate-api.mjs`, `package.json` scripts.
- `backend/tests/Gones.IntegrationTests/*Tournament*Tests.cs` — every route string.
- **From Depends:** T15 renamed the entities (`Event`, `EventFormat`, `EventProposal`, `EventProposalRecipient`, `EventLifecycleEntry`, `EventRegistrationAttempt`, `ConsumedEventPreviewTicket`), the DbSets (`Events`, `EventFormats`, …) and the tables (`events`, `event_formats`, `event_registration_attempts`, `event_lifecycle_entries`, `event_proposals`, `event_proposal_recipients`), and deliberately left the HTTP surface untouched.

## TDD

1. **Red** — update the integration tests to the new paths first; they fail against the old routes.
2. **Green** — rename endpoints, DTOs, namespaces; regenerate the client.
3. **Refactor** — delete any now-unused compatibility shim.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `GET /api/events returns the calendar` | seeded events | 200 with the same JSON shape as the old `/api/tournaments` |
| `GET /api/tournaments is gone` | old path | 404 |
| `GET /api/events/{slug}.ics` | published event | 200, `text/calendar` |
| `POST /api/events` publishes | organizer token, valid payload | 201 |
| `POST /api/events/{id}/registrations` registers | user token | 201 and `Location` header pointing at `/api/events/…` |
| `error codes are event-scoped` | trigger the draft-org publish refusal | problem `code` is `organization_is_draft`; no problem code contains `tournament_` |
| `openapi has no tournament path` | `backend/openapi/*.json` | no `/api/tournaments` key |

Results:

- [x] `GET /api/events` returns the calendar — 200, same JSON shape (`items[].venue/organization/formats`, `page/pageSize/totalCount`).
- [x] `GET /api/tournaments` is gone — 404 `not_found`.
- [x] `GET /api/events/{slug}.ics` — 200, `text/calendar; charset=utf-8`, body starts `BEGIN:VCALENDAR`.
- [x] `POST /api/events` publishes — 201 for an Organizer token with a valid preview ticket.
- [x] `POST /api/events/{id}/registrations` registers — 201 for a User token. The self-service route keeps its pre-existing `Location: /api/users/me/registrations`; the organizer route returns `Location: /api/events/{id}/registrations/{attemptId}`.
- [x] error codes are event-scoped — the draft-org publish refusal is `organization_is_draft` 409, and no problem `code` on the calendar surface contains `tournament_` (`tournament_full` → `event_full`, `tournament_not_open` → `event_not_open`).
- [x] `backend/openapi/gones.json` has no `/api/tournaments` key — the only remaining `tournament` paths are `/api/live-tournaments*` and `/api/leagues-archive/*/tournaments-archive*`, both out of scope.

## Impl steps

- [x] 1. Update every route string in `backend/tests/Gones.IntegrationTests`; run `dotnet test backend/tests/Gones.IntegrationTests` — red.
      Evidence: `dotnet test --filter FullyQualifiedName~PublicTournamentApiTests` → `Failed: 2, Passed: 1` with `Assert.Equal() Failure … Expected: OK / Actual: NotFound`.
- [x] 2. Create `backend/src/Gones.Api/Events/`, move and rename the endpoint files, change the namespace.
      Evidence: `ls backend/src/Gones.Api/Events/` → the 7 Event-named files; `backend/src/Gones.Api/Tournaments/` no longer exists; `namespace Gones.Api.Events;` in all 7.
- [x] 3. Rename the route templates per the path map.
      Evidence: `grep -rn "api/tournaments" backend/src --include=*.cs` prints nothing; route dump shows `/api/events*`, `/api/organizer/events`, `/api/admin/events`, `/api/event-proposals`.
- [x] 4. Rename the DTO records and their usages; keep JSON casing conventions untouched.
      Evidence: no `record .*Tournament.*Response|Request` left under `backend/src/Gones.Api/Events` except `PublicTournamentFormatResponse` (projects the out-of-scope shared `TournamentFormat` lookup).
- [x] 5. Rename `tournament_*` error codes to `event_*`.
      Evidence: `ApiExceptions.cs` now declares `EventFullException("event_full")` and `EventNotOpenException("event_not_open")`; the capability `reason` values follow.
- [x] 6. Update `Program.cs` registrations.
      Evidence: `using Gones.Api.Events;` plus `MapPublicEventEndpoints/MapEventPublicationEndpoints/MapEventProposalEndpoints/MapEventLifecycleEndpoints/MapEventRegistrationEndpoints`.
- [x] 7. `dotnet build backend/Gones.sln` until clean; `dotnet test backend/Gones.sln` green.
      Evidence: `dotnet build backend/Gones.sln` → `Build succeeded.` with 0 errors / 0 warnings. Per-suite `dotnet test` results are under Validation below; the *single* full-solution run cannot pass on this host (see the `dotnet test backend/Gones.sln` line).
- [x] 8. Run `npm run api:generate`; commit the regenerated `backend/openapi/*` and `src/app/api/generated/gones-api.ts`.
      Evidence: `npm run api:generate` rewrote both files; `npm run api:check` exits 0 afterwards. `backend/openapi/gones.json` has no `/api/tournaments*` key; the client exposes `eventsGET/eventsPOST/listOrganizerEvents/listDeletedEvents/registerForEvent/…`.
- [x] 9. Rename the backend test files to their Event names.
      Evidence: `PublicEventApiTests.cs`, `AllEventsEndpointTests.cs`, `EventLifecycleApiTests.cs`, `EventPublicationApiTests.cs`, `EventRegistrationApiTests.cs`, `EventProposalTests.cs`, `EventProposalDecisionTests.cs`.
- [x] 10. Run `npx vitest run ops/acceptance-matrix.test.ts` and fix any evidence path that names a moved file.
      Evidence: `Test Files 1 passed (1) / Tests 7 passed (7)` after remapping the 26 renamed test-file targets in `ops/acceptance-matrix.json`.

## Decisions taken during implementation

Deliberately **not** renamed, because the ticket scopes this slice to the calendar HTTP surface:

- `PublicTournamentFormatResponse` — it projects the shared `TournamentFormat` lookup, which the ticket lists as out of scope. Its JSON member on an event stays `formats`.
- `TournamentProposalTemplateModel` / `TournamentProposalRejectedTemplateModel` and `NotificationTemplateKeys.TournamentProposal` — notification templates, out of scope.
- Persisted audit values: the `scheduled_tournament` / `tournament_proposal` / `tournament_registration` `EntityType`s and the `tournament.*` audit actions. Renaming them would orphan existing audit rows and needs a data migration, which is not in this slice.
- The account-deletion relation labels in `LocalIdentityEndpoints.cs` (`scheduled_tournaments.created_by_user_id`, …). They are wire shape pinned by a frontend test and T15 kept them; this ticket does not ask for them.
- `nonterminal_tournament`, the organization-delete blocker code — `/api/organizations/*` is out of scope and the code does not match the ticket's `"tournament_` enumeration.
- The `Gones.Domain/Calendar` enums T15 left alone (`ScheduledTournamentStatus`, `TournamentChangeSeverity`, `TournamentLifecycleEventType`, `TournamentReminderPlanAction`, `TournamentRegistrationStatus`) and `TournamentSlug`.
- The English `detail` prose on the calendar `ApiException`s still says "Tournament", as do its unrenamed siblings (`registration_closed`, `registration_already_active`, …). Renaming only two of the block would make it *less* consistent; that copy pass belongs to T19.
- Local variable names and comments inside the moved files still read `tournament`. No wire impact; T19 sweeps them.
- `TournamentSchedulerTests.cs` / `ScheduledTournamentPersistenceTests.cs` keep their names — they test T15's persistence surface, not the HTTP one.

Renamed beyond the literal path map, for coherence with the ticket's own DTO and file renames:

- `/api/organizer/tournaments` → `/api/organizer/events`, `/api/admin/tournaments/*` → `/api/admin/events/*`, `/api/tournament-proposals*` → `/api/event-proposals*`. Leaving them would have paired `EventManagementResponse` / `EventProposalRequest` with tournament-named paths.
- Route parameter `{tournamentId:guid}` → `{eventId:guid}`, and the `.WithName(…)` operation ids, since both surface in the OpenAPI document and therefore in the generated client.
- The proposal request/response member `tournament` → `event` (and its validation-error key prefix `tournament.` → `event.`).
- The API-layer service classes that live in the moved files (`EventPublicationService`, `EventRegistrationService`, …) and the slug fallback `"tournament"` → `"event"` in `EventSlugGenerator`.

## Outputs

- Files touched: everything under `backend/src/Gones.Api/Events/` (moved from `Tournaments/`), `Program.cs`, backend tests, `backend/openapi/*`, `src/app/api/generated/gones-api.ts`, `ops/acceptance-matrix.json`.
- API change: hard break — `/api/tournaments/*` removed, `/api/events/*` added.

## Validation

- [ ] `dotnet test backend/Gones.sln` passes — **left unchecked**: the single full-solution run cannot pass on this host. `Failed: 5, Passed: 389` and every one of the 5 is the Testcontainers/RootlessKit defect (`PortManager.AddPort(): … bind: address already in use`), zero assertion failures; all 5 classes pass when run alone (see the per-suite lines below).
- [x] `dotnet build backend/Gones.sln` clean — `Build succeeded.`, 0 errors, 0 warnings.
- [x] targeted suites green (each run alone, per the host defect):
      `PublicEventApiTests|AllEventsEndpointTests|EventPublicationApiTests` → `Passed: 31`;
      `EventLifecycleApiTests|EventRegistrationApiTests` → `Passed: 18`;
      `EventProposalTests` → `Passed: 19`; `EventProposalDecisionTests` → `Passed: 22`;
      `OrganizationApiTests` → `Passed: 13`; `PerformanceBudgetTests` → `Passed: 5`;
      `AccountDeletionTests` → `Passed: 14`; `EventTableRenameTests` → `Passed: 4`;
      `TournamentSchedulerTests` → `Passed: 5`; `ApiBoundaryTests` → `Passed: 44`;
      `RuntimeContractTests` → `Passed: 18`; `Gones.UnitTests` → `Passed: 198`; `Gones.ArchitectureTests` → `Passed: 17`.
- [x] `npm run api:generate` produces no uncommitted diff afterwards — `npm run api:check` exits 0. (The ticket wrote `npm run generate:api`; the script in `package.json` is `api:generate` / `api:check`.)
- [x] `grep -rn "api/tournaments" backend/src --include=*.cs` prints nothing — exit 1, no output.
- [x] manual check: `curl http://127.0.0.1:5080/api/events` returns the calendar; `curl -i .../api/tournaments` returns 404.
      Old paths, all `404 not_found`: `GET /api/tournaments`, `/all`, `/{slug}`, `/{slug}/participants`, `/{slug}.ics`, `POST /api/tournaments`, `POST /api/tournaments/preview`, `POST /api/tournaments/{id}/registrations`, `GET /api/organizer/tournaments`, `GET /api/admin/tournaments/deleted`, `GET /api/tournament-proposals/approvers`.
      New paths: `GET /api/events` 200, `/all` 200, `/{slug}` 200, `/{slug}/participants` 200, `/{slug}.ics` 200 `text/calendar; charset=utf-8` starting `BEGIN:VCALENDAR`.
- [x] authorization survives the rename (anon | User | Organizer | Admin against the running Docker API):
      `POST /api/events/preview` → 401 / 403 / 200 / 200;
      `POST /api/events` → 401 / 403 / 201 (`Location: /api/events/{slug}`);
      `GET /api/organizer/events` → 401 / 403 / 200;
      `GET /api/admin/events/deleted` → 401 / 403 / 403 (Organizer) / 200 (Admin);
      `POST /api/events/{id}/registrations` → 401 anon, 201 User;
      `POST /api/events/{id}/registrations/by-organizer` → 201 with `Location: /api/events/{id}/registrations/{attemptId}`;
      `GET /api/events/{id}/registrations/export` → 200 `text/csv`.
- [x] the T11 draft-organization gate still refuses: `POST /api/events` for a member-less organization → `409 organization_is_draft`.
- [x] service-worker offline surface follows the rename — `src/app/api/service-worker-cache.ts`, `ngsw-config.json` and `src/app/api/service-worker-cache.test.ts` all moved to `/api/events`; `npm run test` → `110 files / 1012 tests passed`.
- [x] `npm run lint` → `All files pass linting.`
- [x] `npm run typecheck` — **knowingly red at this commit, green once T17 landed** (parent bookkeeping, verified at `7cec810`: `npm run typecheck` exit 0 on both projects). At `507b9b2` it was 71 errors in `tsconfig.app.json` and 80 in `tsconfig.spec.json`, all inside `src/app/features/calendar/**`, all of the form "no exported member named `Tournament…`" / "Property `…Tournament…` does not exist on type `Client`". Zero errors in `src/app/api/generated/gones-api.ts`. T17 rewires the Angular app; this is the ticket's stated hard break.
- [x] app functional — backend green; the Angular app is knowingly mid-rename until T17 lands.
- [x] Cypress specs that speak the old API are knowingly red until T17 and were **not** repaired by reintroducing old routes: `abuse-surface`, `accessibility`, `offline-public-read`, `organizer-participants`, `organizer-tournament-create`, `organizer-tournament-management`, `public-calendar`, `tournament-proposal`, `tournament-registration`. In practice every spec fails earlier than its intercepts, because `ng build` runs the same typecheck that is red above.
- [x] `scripts/seed-dev-environment.mjs` (the only script with hardcoded calendar API paths) moved to `/api/events*`; `ops/acceptance-matrix.json` evidence targets remapped.
- [x] commit msg draft: `refactor(api)!: serve the calendar under /api/events`
