# Glossary

[x] Activated
[x] Project scanned

## Frontend

| word | short description | ref in code |
| ---- | ----------------- | ----------- |
| shell | Root app layout: toolbar, breadcrumbs, export menu | `src/app/app.component.ts` |
| routes | Lazy route table, guarded by role and authority | `src/app/app.routes.ts` |
| authority | Startup data-authority decision, server-only, fails closed | `src/app/config/data-authority.ts` |
| bridge | Injection-token ports the app calls instead of HTTP | `src/app/backend/application-backend.ts` |
| adapter | ASP.NET implementation of those ports, intent commands only | `src/app/backend/aspnet-api-backend.service.ts` |
| boundary | HTTP headers, ETag, idempotency, problem-details errors | `src/app/api/api-boundary.ts` |
| client | Generated typed client from the committed OpenAPI contract | `src/app/api/generated/gones-api.ts` |
| repository | Angular signal store fronting one backend port | `src/app/data/league-archive-repository.service.ts` |
| runner | Live tournament pairing and result-entry screen | `src/app/features/live-tournaments/live-tournament-runner.component.ts` |
| local Live store | Offline IndexedDB Live authority for anonymous and `User`, never synced (ADR 0021) | `src/app/backend/local-live-backend.service.ts` |
| calendar | Public Event calendar feature and its detail page | `src/app/features/calendar/public-calendar.component.ts` |
| guards | Route guards for User, Organizer and Admin | `src/app/auth/auth.guards.ts` |
| power user | Browser-only opt-in (`gones.settings.power-user`) for advanced Event, League and Live mutation UI; never grants server authority, never hides home cards or browse destinations (ADR 0037) | `src/app/shared/power-user-settings.service.ts` |
| global stats | Public server-derived ranking over all completed League Archives; 14 columns, search/sort/page; browsable at `/global-stats`; local League records excluded | `src/app/features/players/global-stats.component.ts` |
| event link | Optional `liveTournamentUrl` or `archiveTournamentUrl` on an Event; navigation string only, no data-authority coupling, broken links are valid (ADR 0036) | `backend/src/Gones.Domain/Calendar/Event.cs` |
| staged edit | Power-User opt-in that keeps Archive Tournament mutations in a memory draft until explicit Save Changes; one atomic batch per save (ADR 0037) | `src/app/features/tournaments-archive/tournament-archive-detail.component.ts` |
| session | Access-token scope and cache purge on sign-out | `src/app/auth/session-scope.service.ts` |
| i18n | French/English message catalogue and language signal | `src/app/i18n/i18n.service.ts` |
| ics | Calendar export to an .ics subscription file | `src/app/domain/calendar-ics.ts` |

## Backend

| word | short description | ref in code |
| ---- | ----------------- | ----------- |
| api | ASP.NET minimal-API host wiring every endpoint group | `backend/src/Gones.Api/Program.cs` |
| endpoints | One minimal-API group per domain capability | `backend/src/Gones.Api/Events/EventLifecycleEndpoints.cs` |
| commands | Server-side intent transforms mirroring the Angular runner | `backend/src/Gones.Domain/Live/LiveCommands.cs` |
| dbcontext | EF Core context, snake_case, all aggregates | `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs` |
| migrations | Committed EF migration set, applied before serving | `backend/src/Gones.Infrastructure/Persistence/Migrations/` |
| migrator | Standalone container that applies migrations idempotently | `backend/src/Gones.Migrator/Program.cs` |
| versioned | Base entity carrying the optimistic-concurrency version | `backend/src/Gones.Domain/Persistence/SharedRecords.cs` |
| outbox | Durable notification rows awaiting send or retry | `backend/src/Gones.Domain/Notifications/NotificationOutboxRecord.cs` |
| processor | Drains the outbox, applies the retry ladder | `backend/src/Gones.Infrastructure/Notifications/NotificationProcessor.cs` |
| transport | Email provider adapter: Brevo, or local file sink | `backend/src/Gones.Infrastructure/Notifications/BrevoEmailTransport.cs` |
| worker | Background service: heartbeat, scheduling, notifications, cleanup | `backend/src/Gones.Worker/Worker.cs` |
| reconciler | Replans event reminders on date or roster change | `backend/src/Gones.Infrastructure/Calendar/EventScheduler.cs` |
| event | Calendar record for one single-format tournament concept; may link to Live/Archive Tournaments (ADRs 0035–0036) | `backend/src/Gones.Domain/Calendar/Event.cs` |
| scheduled tournament | **Retired term** for an event (ADR 0035). Left only in identifiers the rename kept on purpose | `docs/adr/0035-calendar-event-vocabulary.md` |
| membership | The (organization, user) roster row that derives the global `Organizer` role (ADR 0034) | `backend/src/Gones.Api/Organizations/OrganizationMembershipRoleService.cs` |
| draft organization | An organization with zero members: derived `isDraft`, cannot publish an event | `backend/src/Gones.Api/Organizations/OrganizationEndpoints.cs` |
| identity | Local sign-up, email verification, refresh sessions | `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs` |
| registration | Participant sign-up and unregistration on an event | `backend/src/Gones.Api/Events/EventRegistrationEndpoints.cs` |
| league archive | Archived Leagues and their result Tournaments, `/api/leagues-archive` (formerly `/api/leagues`, ADR 0022) | `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs` |
| archive tournament | A result Tournament inside the League Archive, `/tournaments-archive` (formerly Result Tournament) | `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs` |

## Other

| word | short description | ref in code |
| ---- | ----------------- | ----------- |
| adr | Numbered architecture decision records, the binding rules | `docs/adr/` |
| matrix | Executable V1 acceptance rows with per-gate evidence | `ops/acceptance-matrix.json` |
| contract | Vendor-neutral runtime contract every host must satisfy | `docs/RUNTIME_CONTRACT.md` |
| compose | Release-mode stack definition for candidate and test | `compose.release-candidate.yaml` |
| candidate | Builds and assembles the release candidate artifacts | `scripts/release-candidate.mjs` |
| preflight | Nine mismatch gates deciding if a candidate ships | `scripts/release-preflight.mjs` |
| rehearsal | Full stack dress run with fake providers, TLS | `scripts/release-rehearsal.mjs` |
| smoke | Short post-deploy checks per subsystem | `scripts/smoke-full-stack.mjs` |
| cypress | Browser end-to-end journeys, one file per flow | `cypress/e2e/` |
| runbook | Operator procedures for the online deployment | `docs/online-website-runbook.md` |
