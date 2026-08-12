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

## Impl steps

- [ ] 1. Update every route string in `backend/tests/Gones.IntegrationTests`; run `dotnet test backend/tests/Gones.IntegrationTests` — red.
- [ ] 2. Create `backend/src/Gones.Api/Events/`, move and rename the endpoint files, change the namespace.
- [ ] 3. Rename the route templates per the path map.
- [ ] 4. Rename the DTO records and their usages; keep JSON casing conventions untouched.
- [ ] 5. Rename `tournament_*` error codes to `event_*`.
- [ ] 6. Update `Program.cs` registrations.
- [ ] 7. `dotnet build backend/Gones.sln` until clean; `dotnet test backend/Gones.sln` green.
- [ ] 8. Run `npm run generate:api`; commit the regenerated `backend/openapi/*` and `src/app/api/generated/gones-api.ts`.
- [ ] 9. Rename the backend test files to their Event names.
- [ ] 10. Run `npx vitest run ops/acceptance-matrix.test.ts` and fix any evidence path that names a moved file.

## Outputs

- Files touched: everything under `backend/src/Gones.Api/Events/` (moved from `Tournaments/`), `Program.cs`, backend tests, `backend/openapi/*`, `src/app/api/generated/gones-api.ts`, `ops/acceptance-matrix.json`.
- API change: hard break — `/api/tournaments/*` removed, `/api/events/*` added.

## Validation

- [ ] `dotnet test backend/Gones.sln` passes
- [ ] `npm run generate:api` produces no uncommitted diff afterwards
- [ ] `grep -rn "api/tournaments" backend/src --include=*.cs` prints nothing
- [ ] manual check: `curl http://127.0.0.1:5080/api/events` returns the calendar; `curl -i .../api/tournaments` returns 404
- [ ] app functional — backend green; the Angular app is knowingly mid-rename until T17 lands
- [ ] commit msg draft: `refactor(api): serve the calendar under /api/events`
