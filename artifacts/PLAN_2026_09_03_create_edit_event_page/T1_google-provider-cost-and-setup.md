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
- R3 Add public timezone catalog endpoint returning sorted `DateTimeZoneProviders.Tzdb.Ids`; write validation consumes same source.
- R4 Direct publish, proposal submit/approve, and lifecycle edit use manual location value without token validation or expiry.
- R5 Preserve local-time→UTC behavior, DST-gap rejection, Event reads, ICS timezone, cache/ETag semantics except removed geodata.
- R6 Remove autocomplete/resolve endpoints, `IEventLocationProvider`, `IEventLocationTokenService`, Google Maps options/DI/handler/errors, and orphaned tests.
- R7 Add EF migration dropping `provider_place_id`, `latitude`, `longitude`; remove corresponding domain members. Never retain stale or sentinel geodata.
- R8 Remove Maps keys from `.env.example`, Compose API/Worker env, readiness/runtime contracts, and provider runbook. Leave Google OAuth config untouched.
- R9 Supersede ADR-0051 through ADR-0057; update ADR-0055 location draft clauses, `AGENT.md`, `docs/CONTEXT.md`, `docs/GLOSSARY.md` only where contract changed.
- R10 Regenerate OpenAPI client. Remove `/api/event-locations/autocomplete`, `/resolve`, suggestion/resolution DTOs, token fields/expiry. Add timezone catalog + `timeZoneId` write field.

## Interface contract

- P1 `EventLocationInput { streetAddress, postalCode, city, country, region, timeZoneId }`.
- P2 Timezone catalog returns sorted unique IANA IDs from NodaTime TZDB.
- P3 Invalid ID such as `Europe/Nope` → field validation error; `Europe/Paris` accepted.
- P4 Event DB retains address + `time_zone_id`; provider ID/lat/lon columns disappear.
- P5 Proposal envelope/hash includes normalized manual location and timezone.

## TDD

1. **Red** — rewrite backend tests for manual trim/required/max/IANA/DST/create/edit/proposal and migration column removal.
2. **Green** — implement contract vertically and regenerate API.
3. **Refactor** — delete only orphaned provider/token/config code after green.

## Impl steps

- [ ] 1. Add failing API/domain/migration tests with explicit expected status/body.
- [ ] 2. Replace token location contract with manual location + TZDB validation.
- [ ] 3. Update publish, proposal, lifecycle, read, hash paths.
- [ ] 4. Add sorted timezone catalog endpoint.
- [ ] 5. Add migration dropping provider geodata columns + domain members.
- [ ] 6. Delete orphaned Maps provider/token endpoints, DI, config, tests.
- [ ] 7. Regenerate OpenAPI client; update docs/ADRs/runtime contracts.
- [ ] 8. Scan diff for accidental Google OAuth removal or fake coordinates.

## Validation

- [ ] V1 backend location/event tests: `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventLocation|FullyQualifiedName~EventPublication|FullyQualifiedName~EventProposal|FullyQualifiedName~EventLifecycle"`
- [ ] V2 API contract: `npm run api:check`
- [ ] V3 runtime contract: `npm run test -- ops/runtime-config.test.ts`
- [ ] V4 config: `docker compose config --quiet`
- [ ] V5 app compile: `npm run typecheck`
- [ ] V6 source scan proves no Maps location config/endpoints while OAuth remains.
- [ ] V7 commit msg draft: `feat(events): replace provider locations with manual timezone entry`
