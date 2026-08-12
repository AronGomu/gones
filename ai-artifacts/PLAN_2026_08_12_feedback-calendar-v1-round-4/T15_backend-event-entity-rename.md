# T15: Backend Event entity rename

**Plan:** `./ai-artifacts/PLAN_2026_08_12_feedback-calendar-v1-round-4.md`
**Depends:** T14
**Commit outcome:** the calendar domain's CLR types and PostgreSQL tables are named after Event instead of Tournament, with a hand-corrected, data-preserving EF migration; the API surface still answers on the old `/api/tournaments/*` paths (renamed in T16).

## Context (self-contained)

- Goal: ship round 4 of `feedback.md`. This block renames the calendar domain from Tournament to Event, back and front.
- This slice: persistence and domain only. Splitting the rename from the HTTP surface keeps each commit reviewable and each build green.
- Out of scope here: endpoint paths, DTO names, OpenAPI, any frontend file, the archive (`leagues-archive`, `tournaments-archive`) and live domains, and the shared `TournamentFormat` lookup — all four keep their names.
- Assumptions in force: an Event is exactly today's record renamed. No child-tournament entity is introduced. Every row must survive the migration.

## Requirements

- Rename map, CLR types (all under `backend/src/Gones.Domain/Calendar/`):
  | old | new |
  | --- | --- |
  | `ScheduledTournament` | `Event` |
  | `ScheduledTournamentFormat` | `EventFormat` |
  | `TournamentProposal` | `EventProposal` |
  | `TournamentProposalRecipient` | `EventProposalRecipient` |
  | `TournamentLifecycleEvent` | `EventLifecycleEntry` |
  | `TournamentRegistrationAttempt` | `EventRegistrationAttempt` |
  | `ConsumedTournamentPreviewTicket` | `ConsumedEventPreviewTicket` |
- File renames: `ScheduledTournament.cs` → `Event.cs`, `TournamentProposal.cs` → `EventProposal.cs`, `TournamentRegistration.cs` → `EventRegistration.cs`, `TournamentScheduling.cs` → `EventScheduling.cs`; `backend/src/Gones.Infrastructure/Persistence/ScheduledTournamentRecordConfigurations.cs` → `EventRecordConfigurations.cs`; `TournamentProposalConfigurations.cs` → `EventProposalConfigurations.cs`; `backend/src/Gones.Infrastructure/Calendar/TournamentScheduler.cs` → `EventScheduler.cs` (class `TournamentScheduler` → `EventScheduler`).
- `GonesDbContext` DbSet properties: `ScheduledTournaments` → `Events`, `ScheduledTournamentFormats` → `EventFormats`, `TournamentProposals` → `EventProposals`, `TournamentProposalRecipients` → `EventProposalRecipients`, `TournamentLifecycleEvents` → `EventLifecycleEntries`, `TournamentRegistrationAttempts` → `EventRegistrationAttempts`, `ConsumedTournamentPreviewTickets` → `ConsumedEventPreviewTickets`.
- Table map (`ToTable(...)` in the configuration files):
  | old table | new table |
  | --- | --- |
  | `scheduled_tournaments` | `events` |
  | `scheduled_tournament_formats` | `event_formats` |
  | `tournament_registration_attempts` | `event_registration_attempts` |
  | `tournament_lifecycle_events` | `event_lifecycle_entries` |
  | `tournament_proposals` | `event_proposals` |
  | `tournament_proposal_recipients` | `event_proposal_recipients` |
  | consumed preview ticket table (read the current name from its configuration) | `consumed_event_preview_tickets` |
- Column map: every `tournament_id` / `scheduled_tournament_id` FK that points at the calendar entity becomes `event_id`, including inside `scheduled_notifications` and `notification_history` (those two TABLES keep their names — they belong to the notification domain). The CLR properties `TournamentId` / `ScheduledTournamentId` become `EventId`.
- `TournamentFormat` (table `tournament_formats`) is NOT renamed. `LeagueArchiveAggregate`, `LiveAggregate` are NOT renamed.
- Migration `<timestamp>_RenameCalendarTournamentToEvent`, generated with `dotnet ef migrations add RenameCalendarTournamentToEvent --project backend/src/Gones.Infrastructure --startup-project backend/src/Gones.Api`, then HAND-CORRECTED exactly like `20260809122735_RenameLeagueArchiveTables.cs`: EF will scaffold `DropTable`/`CreateTable` pairs because it cannot see an entity rename — replace them with `RenameTable`, `RenameColumn`, `RenameIndex` and `ALTER TABLE … RENAME CONSTRAINT …` SQL so every row survives. Add a summary comment saying exactly that.
- Public HTTP behaviour must not change in this ticket: DTO record names, endpoint paths, JSON property names and the OpenAPI document stay as they are. Where a renamed CLR property would change a serialized name, keep the wire name explicitly until T16.

## Inputs

- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs` lines 33-49 — the DbSet list.
- `backend/src/Gones.Infrastructure/Persistence/ScheduledTournamentRecordConfigurations.cs` — `ToTable("scheduled_tournaments")` (16), `tournament_registration_attempts` (59), `scheduled_tournament_formats` (89), `tournament_lifecycle_events` (100), `scheduled_notifications` (120), `notification_history` (145).
- `backend/src/Gones.Infrastructure/Persistence/TournamentProposalConfigurations.cs` — `tournament_proposals` (14), `tournament_proposal_recipients` (49).
- `backend/src/Gones.Domain/Calendar/` — `ScheduledTournament.cs` (holds `ScheduledTournament`, `ScheduledTournamentFormat`), `TournamentProposal.cs`, `TournamentRegistration.cs`, `TournamentScheduling.cs`.
- 49 non-generated `.cs` files reference `ScheduledTournament`; enumerate them with
  `grep -rl "ScheduledTournament" backend/src backend/tests --include=*.cs | grep -v "/obj/\|/bin/"`.
  Existing migration files and their `.Designer.cs` snapshots must NOT be edited — only the new migration and `GonesDbContextModelSnapshot.cs` (regenerated by EF) change.
- `backend/src/Gones.Infrastructure/Persistence/Migrations/20260809122735_RenameLeagueArchiveTables.cs` — the hand-corrected rename precedent.
- **From Depends:** T14 changed the frontend picker only.

## TDD

1. **Red** — add `backend/tests/Gones.IntegrationTests/EventTableRenameTests.cs` asserting the new table names and that pre-existing rows survive the migration.
2. **Green** — rename types, tables, columns; hand-correct the migration.
3. **Refactor** — keep namespaces as they are (`Gones.Domain.Calendar`); do not move files between projects.

## Test plan

| Test | Input | Expect |
| ---- | ---- | ------ |
| `events table exists after migration` | applied migrations | `SELECT to_regclass('public.events')` not null |
| `old tables are gone` | applied migrations | `to_regclass('public.scheduled_tournaments')` is null |
| `rows survive the rename` | seed 2 rows before the migration, apply it | both rows readable through `database.Events` |
| `foreign keys still enforce` | insert a registration attempt with an unknown `event_id` | insert fails |
| `existing API responses are unchanged` | `GET /api/tournaments` before/after | identical JSON shape |
| full suite | `dotnet test backend/Gones.sln` | green |

## Impl steps

- [ ] 1. Write `EventTableRenameTests.cs`; run `dotnet test backend/tests/Gones.IntegrationTests --filter EventTableRename` — red.
- [ ] 2. Rename the CLR types and files per the map; let the IDE/`dotnet build` drive the call-site fixes across the 49 files.
- [ ] 3. Update `GonesDbContext` DbSet names.
- [ ] 4. Update `ToTable`/column names in the two configuration files (and the consumed-preview-ticket configuration).
- [ ] 5. `dotnet build backend/Gones.sln` until clean.
- [ ] 6. Generate the migration, then hand-correct it into rename operations; verify no `DropTable` or `CreateTable` remains: `grep -n "DropTable\|CreateTable" backend/src/Gones.Infrastructure/Persistence/Migrations/*RenameCalendarTournamentToEvent.cs` must print nothing.
- [ ] 7. Run `dotnet test backend/Gones.sln` — green.
- [ ] 8. Run `node scripts/smoke-migration.mjs`.
- [ ] 9. Confirm the OpenAPI document is byte-identical: `npm run generate:api && git diff --stat backend/openapi src/app/api/generated` must be empty.

## Outputs

- Files touched: `backend/src/Gones.Domain/Calendar/*`, `backend/src/Gones.Infrastructure/Persistence/*`, `backend/src/Gones.Infrastructure/Calendar/EventScheduler.cs`, `backend/src/Gones.Api/Tournaments/*` (call sites only), the new migration + designer, `GonesDbContextModelSnapshot.cs`, backend tests.
- Data change: tables and columns renamed in place.

## Validation

- [ ] `dotnet build backend/Gones.sln` passes
- [ ] `dotnet test backend/Gones.sln` passes
- [ ] `node scripts/smoke-migration.mjs` passes
- [ ] `git diff --stat backend/openapi src/app/api/generated` is empty
- [ ] app functional — the frontend, untouched, still loads the calendar against the local API
- [ ] commit msg draft: `refactor(calendar): rename the scheduled tournament entity to Event`
