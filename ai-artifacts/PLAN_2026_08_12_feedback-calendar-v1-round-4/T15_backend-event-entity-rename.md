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

- [x] 1. Write `EventTableRenameTests.cs`; run `dotnet test backend/tests/Gones.IntegrationTests --filter EventTableRename` — red. Evidence: `error CS1061: 'GonesDbContext' does not contain a definition for 'Events'` (+7 more) — the suite cannot even build before the rename. *Criterion: the filtered run fails (build error or assertion) before the rename lands.*
- [x] 2. Rename the CLR types and files per the map; let the IDE/`dotnet build` drive the call-site fixes across the 49 files. Evidence: 7 `git mv` renames recorded as `R` in `git status`; `grep -rn "\bScheduledTournament\b|\bTournamentProposal\b|\bTournamentLifecycleEvent\b|\bTournamentRegistrationAttempt\b|\bConsumedTournamentPreviewTicket\b" backend/src backend/tests --include=*.cs` outside `Migrations/` prints nothing.
- [x] 3. Update `GonesDbContext` DbSet names. Evidence: `GonesDbContext.cs:21,40-45` now read `ConsumedEventPreviewTickets`, `Events`, `EventFormats`, `EventProposals`, `EventProposalRecipients`, `EventLifecycleEntries`, `EventRegistrationAttempts`.
- [x] 4. Update `ToTable`/column names in the two configuration files (and the consumed-preview-ticket configuration). Evidence: `ToTable("events"|"event_registration_attempts"|"event_formats"|"event_lifecycle_entries"|"event_proposals"|"event_proposal_recipients")`; the consumed-ticket table follows its DbSet name via `UseSnakeCaseNames` → `consumed_event_preview_tickets` (verified in the DB below). `scheduled_notifications` / `notification_history` keep their `ToTable` names.
- [x] 5. `dotnet build backend/Gones.sln` until clean. Evidence: `Build succeeded.` / `0 Error(s)` / `0 Warning(s)`.
- [x] 6. Generate the migration, then hand-correct it into rename operations. Evidence: `20260812164333_RenameCalendarTournamentToEvent.cs` contains only `RenameTable` ×7, `RenameColumn` ×5, `ALTER TABLE … RENAME CONSTRAINT` ×25 and `RenameIndex` ×30; `grep -n "migrationBuilder.DropTable\|migrationBuilder.CreateTable"` prints nothing (the bare `grep DropTable|CreateTable` in the plan still matches the mandated summary comment, which the same requirement asks for).
  - [x] 6a. Capture the pre-migration DB snapshot. Evidence: `ai-artifacts/T15-evidence/before.txt` (475 lines: 37 tables, 57 constraints, 60 indexes, 7 inbound FKs, 146 `gones_app` grants, 1 sequence).
  - [x] 6b. Apply the migration to the real dev database. Evidence: `docker compose up -d --build --wait migrator permissions api`; `docker inspect gones-migrator-1 --format '{{.State.ExitCode}}'` → `0`; `Gones database migrations complete.`
  - [x] 6c. Capture the post-migration snapshot and diff it against `before`. Evidence: all 37 tables row-count-identical (only `__EFMigrationsHistory` 27→28, the new migration row); 57→57 constraints and 7→7 inbound FKs identical after applying the rename map; all 60 index structures identical with exactly 37 renamed and 23 untouched; 146→146 `gones_app` grants identical; 1→1 sequence with unchanged ownership.
  - [x] 6d. Spot-check a full row round-trip. Evidence: the 27-column dump of `events` row `t14-cross-org-1786551794`, plus `rows-up1.txt` / `rows-down1.txt` / `rows-up2.txt` — full content of all nine calendar tables — all three md5 `630b86cc449df0654f9c02bdb4503640`.
  - [x] 6e. `Down` **is** implemented (exact mirror of `Up`). Proof: `dotnet ef database update 20260812154508_HealOrganizationMembershipInvariants` reverted cleanly and `diff before.txt downstate.txt` is empty — the down state is byte-identical to the pre-migration schema; re-applying `Up` gives `diff after.txt after2.txt` empty and identical row dumps.
  - [x] 6f. `gones_app` read+write re-check. Evidence: `psql -U gones_app` SELECTed all 7 renamed tables (13/20/12/0/0/0/11 rows) and, in a rolled-back transaction, `INSERT 0 1` / `UPDATE 1` / `INSERT 0 1` / `INSERT 0 1` / `DELETE 1`; a bad `event_id` still raises `violates foreign key constraint "fk_event_registration_attempts_events_event_id"`.
- [ ] 7. Run `dotnet test backend/Gones.sln` — green. *Not achievable on this host; superseded by 7a. See the host defect in Validation.*
  - [x] 7a. Targeted integration runs across every suite this rename touches. Evidence: 18 targeted runs, **0 failures** — `EventTableRenameTests` 4, `ScheduledTournamentPersistenceTests` 3, `PublicTournamentApiTests` 3, `AllTournamentsEndpointTests` 10, `TournamentPublicationApiTests` 18, `TournamentRegistrationApiTests` 12, `TournamentLifecycleApiTests` 6, `TournamentSchedulerTests` 5, `TournamentProposalTests` 19, `TournamentProposalDecisionTests` 22, `AccountDeletionTests` 14, `MigrationImportServiceTests` 7, `PerformanceBudgetTests` 5, `OrganizationApiTests` 13, `LocalIdentityApiTests` 34, `NotificationOutboxTests` 16, `PersistenceKernelTests` 9, `ApiBoundaryTests` 44, `RuntimeContractTests` 18, `OrganizationMembershipHealTests` 8, `AdminAuditAndClosureTests` 7; plus `Gones.UnitTests` 198/198 and `Gones.ArchitectureTests` 17/17.
  - [ ] 7b. Full `npm run backend:test`. **Left unchecked — known host defect**, not a code failure: `Failed: 3, Passed: 391, Total: 394`, all three in `InitializeAsync` with `Docker API responded with status code=InternalServerError … error while calling RootlessKit PortManager.AddPort(): listen tcp4 0.0.0.0:36384: bind: address already in use`. Zero assertion failures; all three classes pass when run alone (see 7a).
- [x] 8. Run `node scripts/smoke-migration.mjs`. Evidence: `C38 migration smoke passed over 2 browser origins: dry run wrote nothing, unaccepted import refused, forced failure left zero partial rows, accepted import verified with C#/TypeScript canonical-hash parity, rerun idempotent, changed bundle rejected.` Run against the isolated `compose.release-test.yaml` stack (`GONES_COMPOSE_FILE=compose.release-test.yaml`) because the script asserts a zero census that the dev DB cannot satisfy — it already holds `migration.import` residue from a run at 15:50, ~53 min before this migration. That stack was built from scratch, so it also proves the whole migration chain applies cleanly to a brand-new database: `to_regclass('public.events')='events'`, `to_regclass('public.scheduled_tournaments')=NULL`.
- [x] 9. Confirm the OpenAPI document is byte-identical. Evidence: `npm run api:generate` then `git diff --name-only backend/openapi src/app/api/generated` → empty; `node scripts/generate-api.mjs --check` exits 0.

## Outputs

- Files touched: `backend/src/Gones.Domain/Calendar/*`, `backend/src/Gones.Infrastructure/Persistence/*`, `backend/src/Gones.Infrastructure/Calendar/EventScheduler.cs`, `backend/src/Gones.Api/Tournaments/*` (call sites only), the new migration + designer, `GonesDbContextModelSnapshot.cs`, backend tests.
- Data change: tables and columns renamed in place.

## Validation

- [x] `dotnet build backend/Gones.sln` passes — `Build succeeded.` / `0 Error(s)` / `0 Warning(s)`
- [ ] `dotnet test backend/Gones.sln` passes — **left unchecked on this host**: the full run cannot pass here, Testcontainers hits `RootlessKit PortManager.AddPort(): … bind: address already in use` on random classes with zero assertion failures. Gated instead on the targeted runs in 7a.
- [x] targeted `dotnet test backend/tests/Gones.IntegrationTests --filter <Tests>` runs across every suite this rename touches pass — 21 classes, 0 failures (listed in 7a)
- [x] `dotnet test backend/tests/Gones.UnitTests` passes — `Failed: 0, Passed: 198`
- [x] `dotnet test backend/tests/Gones.ArchitectureTests` passes — `Failed: 0, Passed: 17`
- [x] `node scripts/smoke-migration.mjs` passes — see step 8 for the stack it ran against and why
- [x] `git diff --stat backend/openapi src/app/api/generated` is empty
- [x] `npm run test` passes — `Test Files 110 passed (110) / Tests 1012 passed (1012)`
- [x] `npm run lint` passes — `All files pass linting.`
- [x] `npm run typecheck` passes — exit 0
- [x] `npm run api:check` — exits 0; the HTTP surface is unchanged in this ticket (T16 moves it), so this is the byte-identity result, not a surface move
- [x] data preserved — all 37 tables row-count-identical before/after (only `__EFMigrationsHistory` 27→28 for the new migration row); full-row spot check on `events`/`t14-cross-org-1786551794` plus identical md5 `630b86cc449df0654f9c02bdb4503640` across up→down→up dumps of all nine calendar tables
- [x] constraints, indexes, foreign keys and sequence ownership equivalent before and after — 57→57 constraints, 60→60 index structures (37 renamed, 23 untouched), 7→7 inbound FKs, 1→1 sequence, all identical after applying the rename map
- [x] `gones_app` can still read AND write every renamed table — 146→146 grants unchanged; `psql -U gones_app` SELECT on all 7 tables plus `INSERT`/`UPDATE`/`DELETE` accepted, and a bad `event_id` still trips `fk_event_registration_attempts_events_event_id`
- [x] T11/T12/T13/T14 residue rows survived — all 13 events present including `t14-cross-org-1786551794` and `t11-draft-cup-1786542936`; 21 organizations, 20 memberships, 12 registrations, 11 preview tickets, 50 notification-history rows, 5 archived leagues, 5 live aggregates
- [x] out-of-scope names untouched — `tournament_formats` still 4 rows under its own name; `league_archive_aggregates` and `live_aggregates` unchanged; `notification_outbox.tournament_id` and `ix_notification_outbox_tournament_id` deliberately untouched; `/api/tournaments` still answers `HTTP 200`
- [x] export/import bundle wire shape unchanged — `MigrationPlan.ScheduledTournaments`, `MigrationReport.PlannedCounts.ScheduledTournaments`, `ScheduledTournamentsVerified` and the `scheduledTournamentsCreated` / `plannedScheduledTournaments` JSON keys all kept; `MigrationImportServiceTests` 7/7 and the migration smoke pass
- [x] app functional — `GET /api/tournaments?pageSize=50` returns `HTTP 200` with 8 published events read out of the renamed `events` table; `/health/ready` `HTTP 200`; the untouched dev frontend on :4200 serves `HTTP 200`
- [x] `## T15 backend-event-entity-rename` section appended to `ai-artifacts/manual_test_checklist.md` — 14 human-only steps including the operator's pre/post row-count check; no other ticket's section touched
- [x] commit msg draft: `refactor(calendar): rename the scheduled tournament entity to Event` — committed as `c763f8d`
- [x] `git push origin HEAD` — `ce06927..c763f8d  HEAD -> feat/feedback-calendar-v1-round-4`
