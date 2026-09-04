# T1: Manual Event location backend contract

**Plan:** `./artifacts/PLAN_2026_09_03_create_edit_event_page.md`
**Depends:** none
**Commit outcome:** Event writes accept manual worldwide address + server-validated IANA timezone without paid provider, signed location token, provider identity, or coordinates.

## Context

- C1 Goal: remove Google Places/Time Zone cost and runtime dependency.
- C2 This slice: backend/API/domain/DB/config/docs contract. T2 owns Angular editor UX.
- C3 Out: geocoding, autocomplete, geographic consistency checks, Google OAuth.
- C4 Assumption: valid IANA timezone is user-selected and may geographically mismatch address.

## Requirements

- R1 `EventLocationInput` carries required street, postal code, city, country, region, `timeZoneId`; no `locationToken`.
- R2 Trim address values; preserve current max lengths; reject unknown timezone through existing RFC 7807 validation shape.
- R3 Add anonymous `GET /api/event-locations/time-zones` (`ListEventTimeZones`) returning `{ ids: string[] }`, sorted ordinal and unique from `DateTimeZoneProviders.Tzdb.Ids`; write validation consumes same source.
- R4 Direct publish, proposal submit/approve, and lifecycle edit use manual location value without token validation or expiry.
- R5 Preserve local-time→UTC behavior, DST-gap rejection, Event reads, ICS timezone, cache/ETag semantics except removed geodata.
- R6 Remove autocomplete/resolve endpoints, `IEventLocationProvider`, `IEventLocationTokenService`, Google Maps options/DI/handler/errors, and orphaned tests.
- R7 Add EF migration dropping `provider_place_id`, `latitude`, `longitude`; remove corresponding domain members. Never retain stale or sentinel geodata.
- R8 Remove Maps keys from `.env.example`, Compose API/Worker env, readiness/runtime contracts, and provider runbook. Leave Google OAuth config untouched.
- R9 Supersede ADR-0051 through ADR-0057; update ADR-0055 location draft clauses, `AGENT.md`, `docs/CONTEXT.md`, `docs/GLOSSARY.md` only where contract changed.
- R10 Regenerate OpenAPI client. Remove `/api/event-locations/autocomplete`, `/resolve`, suggestion/resolution DTOs, token fields/expiry. Add timezone catalog + `timeZoneId` write field.

## Inputs

- I1 `backend/src/Gones.Application/Events/EventProviderContracts.cs`
- I2 `backend/src/Gones.Api/Events/EventLocationEndpoints.cs`
- I3 `backend/src/Gones.Api/Events/EventLocationTokenService.cs`
- I4 `backend/src/Gones.Api/Events/EventPublicationEndpoints.cs`
- I5 `backend/src/Gones.Api/Events/EventLifecycleEndpoints.cs`
- I6 `backend/src/Gones.Api/Events/EventProposalEndpoints.cs`
- I7 `backend/src/Gones.Domain/Calendar/Event.cs`
- I8 `backend/src/Gones.Infrastructure/Persistence/EventRecordConfigurations.cs`
- I9 `backend/src/Gones.Infrastructure/Persistence/Migrations/`
- I10 `backend/src/Gones.Infrastructure/EventProviders/`
- I11 `backend/tests/Gones.IntegrationTests/EventLocationApiTests.cs`
- I12 `backend/tests/Gones.IntegrationTests/EventPublicationApiTests.cs`
- I13 `backend/tests/Gones.IntegrationTests/EventLifecycleApiTests.cs`
- I14 `backend/tests/Gones.IntegrationTests/EventProposalTests.cs`, `backend/tests/Gones.IntegrationTests/EventProposalDecisionTests.cs`
- I15 `backend/openapi/gones.json`
- I16 `src/app/api/generated/gones-api.ts`
- I17 `backend/openapi/README.md`
- I18 `.env.example`
- I19 `compose.yaml`
- I20 `ops/runtime-config.test.ts`
- I21 `backend/tests/Gones.IntegrationTests/RuntimeContractTests.cs`
- I22 `docs/EVENT_EDITOR_PROVIDERS.md`
- I23 `docs/adr/0051-google-resolved-event-locations.md`
- I24 `docs/adr/0055-account-scoped-event-create-drafts.md`
- I25 `docs/adr/0057-manual-worldwide-event-locations.md`
- I26 `docs/CONTEXT.md`
- I27 `docs/GLOSSARY.md`
- I28 `AGENT.md`
- I29 `scripts/generate-api.mjs`
- I30 `backend/src/Gones.Api/Program.cs`
- I31 `backend/src/Gones.Api/Errors/ApiExceptions.cs`
- I32 `backend/src/Gones.Api/Errors/ApiExceptionHandler.cs`
- I33 `backend/src/Gones.Infrastructure/Configuration/GonesHostRuntime.cs`
- I34 `backend/tests/Gones.IntegrationTests/EventProviderFoundationTests.cs`
- I35 `backend/tests/Gones.UnitTests/ScheduledTournamentDomainTests.cs`
- I36 `src/app/features/events/event-management.ts`
- I37 `src/app/features/events/organizer-event-create.component.ts`
- I38 `src/app/features/events/organizer-event-create.ts`
- I39 `ops/generated-api-contract.test.ts`
- I40 `ops/release-journeys.test.ts`
- I41 `src/app/features/events/event-management.test.ts`
- I42 `src/app/features/events/organizer-event-create.test.ts`
- I43 `src/app/i18n/messages.ts`
- I44 `deploy/release-test/journeys.mjs`
- I45 `compose.release-test.yaml`
- I46 `backend/tests/Gones.IntegrationTests/AccountDeletionTests.cs`
- I47 `backend/tests/Gones.IntegrationTests/AdminBootstrapAndCatalogTests.cs`
- I48 `backend/tests/Gones.IntegrationTests/AllEventsEndpointTests.cs`
- I49 `backend/tests/Gones.IntegrationTests/EventRegistrationApiTests.cs`
- I50 `backend/tests/Gones.IntegrationTests/MigrationImportServiceTests.cs`
- I51 `backend/tests/Gones.IntegrationTests/OrganizationApiTests.cs`
- I52 `backend/tests/Gones.IntegrationTests/PerformanceBudgetTests.cs`
- I53 `backend/tests/Gones.IntegrationTests/PersistenceKernelTests.cs`
- I54 `backend/tests/Gones.IntegrationTests/ScheduledTournamentPersistenceTests.cs`
- I55 `backend/tests/Gones.IntegrationTests/TournamentSchedulerTests.cs`
- I56 `backend/tests/Gones.UnitTests/NotificationTemplateRendererTests.cs`
- I57 `backend/src/Gones.Application/Migration/MigrationMapping.cs`
- I58 `backend/src/Gones.Application/Migration/MigrationPlanner.cs`
- I59 `backend/tests/Gones.UnitTests/MigrationPlannerTests.cs`
- I60 `scripts/seed-dev-environment.mjs`
- I61 `scripts/bulk-load-stress.mjs`
- I62 `ops/dev-environments.test.ts`

## Interface contract

- P1 `EventLocationInput { streetAddress, postalCode, city, country, region, timeZoneId }`.
- P2 Anonymous `GET /api/event-locations/time-zones` (`ListEventTimeZones`) returns `{ ids: string[] }`, sorted ordinal and unique from NodaTime TZDB.
- P3 Invalid ID such as `Europe/Nope` → field validation error; `Europe/Paris` accepted.
- P4 Event DB retains address + `time_zone_id`; provider ID/lat/lon columns disappear.
- P5 Proposal envelope/hash includes normalized manual location and timezone.

## TDD

1. **Red** — rewrite backend tests for manual trim/required/max/IANA/DST/create/edit/proposal and migration column removal.
2. **Green** — implement contract vertically and regenerate API.
3. **Refactor** — delete only orphaned provider/token/config code after green.

## Impl steps

- [x] 1. Add failing API/domain/migration tests with explicit expected status/body. Verify: targeted `dotnet test` fails for new manual-location assertions before production changes.
- [x] 2. Replace token location contract with manual location + TZDB validation. Verify: targeted backend location/event tests pass.
- [x] 3. Update publish, proposal, lifecycle, read, hash paths. Verify: targeted publication/proposal/lifecycle tests pass.
- [x] 4. Add sorted timezone catalog endpoint. Verify: integration test proves sorted unique TZDB IDs.
- [x] 5. Add migration dropping provider geodata columns + domain members. Verify: migration tests prove columns absent and `dotnet test` passes.
- [x] 6. Delete orphaned Maps provider/token endpoints, DI, config, tests. Verify: source scan finds no Maps location endpoints/config/provider symbols.
- [x] 7. Regenerate OpenAPI client; update docs/ADRs/runtime contracts. Verify: `npm run api:check`, runtime contract test, Compose config, and app typecheck pass.
- [x] 8. Scan diff for accidental Google OAuth removal or fake coordinates. Verify: source/diff scan confirms OAuth remains and no sentinel coordinates exist.

## Repair loop 3

- [x] R3.1 Replace stale frontend provider/token/geodata assertions and release journey data. Verify: focused Vitest files pass.
- [x] R3.2 Update current failing backend manual-location fixtures, raw SQL, migration expectation, and notification timezone fixture. Verify: focused xUnit classes pass.
- [x] R3.3 Run full frontend and backend suites. Verify: `npm run test` and `npm run backend:test` exit 0.
- [x] R3.4 Re-run T1 V1-V6 plus lint/build gates. Verify: every listed command exits 0 and source scan stays clean.
- [x] R3.5 Run `/ship` production headless final feasible gates. Verify: Ship terminal is `locally-verified` with no blocker.
- [x] R3.6 Commit all T1 paths locally. Verify: commit `feat(events): replace provider locations with manual timezone entry` exists and worktree has no staged files.

## Repair loop 4

- [x] R4.1 Update stale migration planner location fixtures for required region. Verify: `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~MigrationPlannerTests"` exits 0.

## Repair loop 5

- [x] R5.1 Add stale runtime-consumer contract tests. Verify: `npm run test -- ops/dev-environments.test.ts` fails for provider resolve/token and dropped geodata SQL before script changes.
- [x] R5.2 Update dev seeder and stress bulk loader for manual location/timezone. Verify: `npm run test -- ops/dev-environments.test.ts` exits 0 and source scan finds no stale endpoint/columns in either script.
- [x] R5.3 Re-run full T1 and repository gates. Verify: T1 V1-V6, `npm run test`, `npm run backend:test`, lint, and build all exit 0.
- [x] R5.4 Run `/ship` production headless final review. Verify: Ship terminal is `locally-verified` with no blocker.
- [x] R5.5 Commit all T1 candidate paths locally. Verify: commit `feat(events): replace provider locations with manual timezone entry` exists and worktree has no staged files.

## Validation

- [x] V1 backend location/event tests: `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventLocation|FullyQualifiedName~EventPublication|FullyQualifiedName~EventProposal|FullyQualifiedName~EventLifecycle"`
- [x] V2 API contract: `npm run api:check`
- [x] V3 runtime contract: `npm run test -- ops/runtime-config.test.ts`
- [x] V4 config: `docker compose config --quiet`
- [x] V5 app compile: `npm run typecheck`
- [x] V6 source scan proves no Maps location config/endpoints while OAuth remains.
- [x] V7 commit msg draft: `feat(events): replace provider locations with manual timezone entry`
