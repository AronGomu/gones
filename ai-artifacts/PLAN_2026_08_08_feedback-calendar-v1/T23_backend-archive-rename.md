# T23: Backend archive rename

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T20
**Commit outcome:** The API and the database call the archived feature `leagues-archive` and `tournaments-archive`; the export bundle format is unchanged so the one-way import door still works.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is the backend half of "(archived) Leagues feature §1: Rename the feature to store (archive) leagues and tournaments within leagues to `leagues-archive` and `tournament-archive`."
- This slice: API routes, domain and EF type names, table names, one migration, the regenerated client. The frontend rename is T24 and consumes the regenerated client.
- Out of scope here: any frontend file, the export/import bundle **schema**.
- Assumptions in force:
  - **A9** — full stack including API paths and EF table renames, but the export bundle's `kind` values (`league`, `fullData`) and its JSON field names stay exactly as they are. ADR 0020's one-way door only applies bundles exported before it; renaming the wire format would break restoring an existing backup, which is not what the feedback asked for.
  - Old API paths are **not** kept as aliases. The only client is this repository's frontend, renamed in T24, and the OpenAPI snapshot is regenerated in the same series. State this in the ADR.

## Requirements

- Public routes become `/api/leagues-archive`, `/api/leagues-archive/{id}`, `/api/leagues-archive/{id}/result`, `/api/leagues-archive/{id}/tournaments-archive/{tournamentId}`, `/api/leagues-archive/{id}/tournaments-archive/{tournamentId}/result`, `/api/leagues-archive/{id}/players/{playerName}/statistics`, `/api/leagues-archive/{id}/export`.
- Command routes move under `/api/leagues-archive` with every `/tournaments` segment becoming `/tournaments-archive`.
- Domain and EF types are renamed: `LeagueAggregate` → `LeagueArchiveAggregate`, `DbSet<LeagueAggregate> LeagueAggregates` → `DbSet<LeagueArchiveAggregate> LeagueArchiveAggregates`.
- The table `league_aggregates` is renamed to `league_archive_aggregates` with its indexes and constraints carried over.
- Endpoint `WithName(...)` identifiers gain the `Archive` word (`CreateLeague` → `CreateLeagueArchive`, `CreateResultTournament` → `CreateArchiveTournament`, …) so the generated client method names change coherently.
- `npm run backend:test`, `npm run api:generate` and `npm run migration:smoke` all pass.
- A new ADR records the rename and its blast radius.

## Inputs

- `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs:24-56` — seven `app.MapGet` registrations, exactly:
  ```
  /api/leagues
  /api/leagues/{id}
  /api/leagues/{id}/result
  /api/leagues/{id}/tournaments/{tournamentId}
  /api/leagues/{id}/tournaments/{tournamentId}/result
  /api/leagues/{id}/players/{playerName}/statistics
  /api/leagues/{id}/export
  ```
- `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs:23-43` — `var organizer = app.MapGroup("/api/leagues").RequireAuthorization(AuthorizationPolicies.Organizer);` then, with their `WithName` identifiers: `MapPost("")` `CreateLeague`, `MapPatch("/{id}/name")` `RenameLeague`, `MapPatch("/{id}/status")` `ChangeLeagueStatus`, `MapDelete("/{id}")` `DeleteLeague`, `MapPost("/{id}/tournaments")` `CreateResultTournament`, `MapPatch("/{id}/tournaments/{tournamentId}")` `EditResultTournament`, `MapDelete("/{id}/tournaments/{tournamentId}")` `DeleteResultTournament`, `MapPost("/{id}/tournaments/{tournamentId}/move")` `MoveResultTournament`, `MapPost("/{id}/tournaments/{tournamentId}/rounds")` `AddResultRound`, `MapDelete(".../rounds/{roundId}")` `DeleteResultRound`, `MapPost(".../rounds/{roundId}/import")` `ImportResultRound`, `MapPost(".../rounds/{roundId}/replace")` `ReplaceResultRound`, `MapPost(".../rounds/{roundId}/entries")` `AddResultEntry`, `MapPatch(".../entries/{entryId}")` `EditResultEntry`, `MapDelete(".../entries/{entryId}")` `DeleteResultEntry`, `MapPatch("/{id}/tournaments/{tournamentId}/archetypes/{playerName}")` `UpdateResultPlayerArchetype`, `MapPost("/{id}/players/rename")` `RenameLeaguePlayerName`, `MapPost("/restore")` `RestoreLeague`, `MapPost("/restore-full")` `RestoreFull…`.
- `backend/src/Gones.Api/Leagues/PlayerNameMaintenanceEndpoints.cs:23-32` — `/api/maintenance/player-names*`. These are **not** renamed; they are cross-league maintenance, not the archive feature.
- `backend/src/Gones.Infrastructure/Persistence/LeagueAggregateConfiguration.cs:12` — `builder.ToTable("league_aggregates");` plus `HasIndex` on `DocumentId` (unique), `Name`, `Status`, `Version`, and a composite `(DeletedAt, UpdatedAt, Id)`, and a `ToTable(table => …)` check-constraint block.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs:46` — `public DbSet<LeagueAggregate> LeagueAggregates => Set<LeagueAggregate>();`
- `backend/src/Gones.Domain/Leagues/` — the `LeagueAggregate` entity and its siblings.
- `backend/src/Gones.Application/Migration/MigrationPlanner.cs` — reads legacy bundles; its **input format** must not change. Only rename the types it references.
- `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs` — `LiveFinalizeResponse` produces a `leagueId`; the Live finalize path writes into a league archive. Rename the referenced types but keep the JSON property name `leagueId` so T20's local adapter contract and the runner keep working.
- `backend/src/Gones.Migrator/` — applies migrations at deploy; no code change expected, but `npm run migration:smoke` must pass.
- `fixtures/league-domain/v1/` — golden parity fixtures; their **content** is the export format and must not change. `src/app/domain/league-parity-fixtures.test.ts` reads them.
- `ops/acceptance-matrix.json` — several rows point at league targets; update any `detail` text that names the old routes.
- Regeneration: start Postgres (`docker compose up -d postgres`) then `npm run api:generate`; `npm run api:check` verifies.
- **From Depends (T20):** `LIVE_BACKEND` now selects between `AspNetApiBackend` and `LocalLiveBackend`; the local adapter returns an empty `leagueId` from finalize. Nothing in this ticket changes that contract.

### Environment facts inlined by the parent — verified against the repo, do not rediscover

- **Step 6's `dotnet ef` command as written will fail.** `--startup-project backend/src/Gones.Api` is wrong:
  `Gones.Api` does **not** reference `Microsoft.EntityFrameworkCore.Design` — only
  `backend/src/Gones.Infrastructure/Gones.Infrastructure.csproj:12` does. **Both** `--project` and
  `--startup-project` must point at `backend/src/Gones.Infrastructure`. `dotnet ef` is also **not on the default
  PATH** (a bare `dotnet ef --version` prints "dotnet-ef does not exist"). Export both of these first — with them it
  reports `10.0.10`:
  ```sh
  export DOTNET_ROOT="$(dirname "$(readlink -f "$(which dotnet)")")"
  export PATH="$PATH:$HOME/.dotnet/tools"
  dotnet ef migrations add RenameLeagueArchiveTables \
    --project backend/src/Gones.Infrastructure \
    --startup-project backend/src/Gones.Infrastructure \
    --output-dir Persistence/Migrations
  ```
  Step 1 ("install with `dotnet tool install --global dotnet-ef`") is therefore a **no-op — it is already installed.**
  Do not install anything.
- **The blanket `sed` in step 2 would rewrite migration history.** `grep -rl "LeagueAggregate" backend/src backend/tests
  --include=*.cs` matches **23** files, and **8 of them live under
  `backend/src/Gones.Infrastructure/Persistence/Migrations/`** — historical migration bodies, their `.Designer.cs`
  snapshots, and `GonesDbContextModelSnapshot.cs`. Rewriting applied migrations is not a rename, it is falsifying
  history. **Exclude that directory from the sed** (e.g. pipe through `grep -v '/Persistence/Migrations/'`) and let
  `dotnet ef migrations add` regenerate `GonesDbContextModelSnapshot.cs` on its own.
- **Expect EF to emit a destructive migration, and expect it.** Because the snapshot still carries the old CLR name at
  diff time, EF **cannot** recognise an entity-type rename and will emit `DropTable` + `CreateTable`, which silently
  drops every archived league. That is exactly what step 7 is defending against. Hand-edit the migration down to
  `RenameTable` + `RenameIndex` calls and assert `Up` contains **no** `DropTable` before running anything.
- **Prove the migration Up → Down → Up on a throwaway Postgres container.** T5, T6 and T16 each did this and each
  caught a real problem that the unit tests missed. **Never** run an unproven migration against the user's running
  `gones-postgres-1` — start a scratch container, seed a `league_aggregates` row before migrating, and prove the row is
  still readable from `league_archive_aggregates` after `Up` and back again after `Down` (Test plan row
  `Table_rename_preserves_rows`).
- **`GonesDbContext.cs` — the `DbSet` is on line 48**, not 46: `public DbSet<LeagueAggregate> LeagueAggregates => Set<LeagueAggregate>();`
- **`ops/acceptance-matrix.json` contains no `/api/leagues` route strings** — `grep -n "/api/leagues"` returns **zero**
  hits. Step 21 has no route text to update. The only league references are prose in the `doc09-league-live` row
  (lines ~2176-2202) and the `product-league-live-parity` checklist entry (~2348), plus file `target` paths that this
  ticket does not move. Adjust prose only if it names a renamed route; then still run `npm run acceptance:matrix`.
- **Backend test flake — do not chase it.** A full `npm run backend:test` intermittently fails 1-3 random test
  *classes* at `InitializeAsync` with `Docker.DotNet.DockerApiException … RootlessKit PortManager.AddPort(): bind:
  address already in use`. Never an assertion, different classes each run, predates this plan. Re-run the failing
  class alone to confirm before treating a full-suite red as real.
- **`npm run api:generate` needs Postgres up** (`docker compose up -d postgres`). `npm run api:check` is the same
  script with `--check`.

## TDD

1. **Red** — update the existing league integration tests to the new routes; they fail with 404.
2. **Green** — rename routes, types, table and migration until they pass.
3. **Refactor** — none; this is a rename, so resist behavioural edits.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Archive_list_responds_on_the_new_path` | `GET /api/leagues-archive` | `200` |
| `Old_league_path_is_gone` | `GET /api/leagues` | `404` |
| `Archive_tournament_path_uses_the_new_segment` | `GET /api/leagues-archive/{id}/tournaments-archive/{tid}` | `200` |
| `Old_tournament_segment_is_gone` | `.../tournaments/{tid}` | `404` |
| `Commands_respond_on_the_new_group` | `POST /api/leagues-archive` as Organizer | `201` |
| `Maintenance_paths_are_untouched` | `GET /api/maintenance/player-names` | `200` |
| `Table_rename_preserves_rows` | seed a league, migrate, query | the row is readable from `league_archive_aggregates` |
| `Export_bundle_format_is_unchanged` | `GET /api/leagues-archive/{id}/export` | the JSON matches the committed fixture byte for byte apart from timestamps |
| `Restore_still_accepts_an_old_bundle` | `POST /api/leagues-archive/restore` with a `fixtures/league-domain/v1` bundle | `201` |
| `Live_finalize_still_returns_leagueId` | finalize as Organizer | response has `leagueId` |

Run: `npm run backend:test`

## Impl steps

- [ ] 1. **Already satisfied — verify, do not install.** `dotnet ef` is present at `10.0.10` once
  `DOTNET_ROOT` and `$HOME/.dotnet/tools` are exported (see the environment facts). Validate: `dotnet ef --version`.
- [ ] 2. Rename the domain type: `LeagueAggregate` → `LeagueArchiveAggregate` in `backend/src/Gones.Domain/Leagues/`,
  then across the solution — but **exclude the migrations directory**, which must keep its history:
  ```sh
  grep -rl "LeagueAggregate" backend/src backend/tests --include=*.cs \
    | grep -v '/Persistence/Migrations/' \
    | xargs sed -i 's/LeagueAggregate/LeagueArchiveAggregate/g'
  ```
  then `dotnet build backend/Gones.sln` to catch collisions. Validate: the build succeeds and
  `git status backend/src/Gones.Infrastructure/Persistence/Migrations/` shows **no** modified pre-existing file.
- [ ] 3. Rename `backend/src/Gones.Infrastructure/Persistence/LeagueAggregateConfiguration.cs` to `LeagueArchiveAggregateConfiguration.cs` and its class accordingly.
- [ ] 4. Change `builder.ToTable("league_aggregates")` to `builder.ToTable("league_archive_aggregates")`.
- [ ] 5. Update `GonesDbContext.cs:46` to `public DbSet<LeagueArchiveAggregate> LeagueArchiveAggregates => Set<LeagueArchiveAggregate>();` and fix every usage the build reports.
- [ ] 6. Run the `dotnet ef migrations add RenameLeagueArchiveTables` command **exactly as given in the environment
  facts** (both project flags on `Gones.Infrastructure`; the ticket's original `--startup-project …Gones.Api` fails).
- [ ] 7. Hand-edit the migration so it is a pure `RenameTable` plus `RenameIndex` calls. EF **will** emit a
  drop/create pair here (it cannot see an entity-type rename), which would destroy every archived league.
  - [ ] 7a. Assert `Up` contains no `DropTable` and no `CreateTable` — validate: `grep -n "DropTable\|CreateTable"` on
    the new migration returns nothing.
  - [ ] 7b. Write the mirror-image `Down` so the rename reverses.
  - [ ] 7c. Prove **Up → Down → Up** on a throwaway Postgres container seeded with a `league_aggregates` row before
    migrating (never `gones-postgres-1`) — validate: the row is readable from `league_archive_aggregates` after `Up`
    and from `league_aggregates` again after `Down`. This is Test plan row `Table_rename_preserves_rows`.
- [ ] 8. In `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs`, change all seven route templates to the `leagues-archive` / `tournaments-archive` forms listed in Requirements.
- [ ] 9. In `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs`, change the group to `app.MapGroup("/api/leagues-archive")` and every `/tournaments` segment to `/tournaments-archive`.
- [ ] 10. Rename every `WithName(...)` in that file: `CreateLeague` → `CreateLeagueArchive`, `RenameLeague` → `RenameLeagueArchive`, `ChangeLeagueStatus` → `ChangeLeagueArchiveStatus`, `DeleteLeague` → `DeleteLeagueArchive`, `CreateResultTournament` → `CreateArchiveTournament`, `EditResultTournament` → `EditArchiveTournament`, `DeleteResultTournament` → `DeleteArchiveTournament`, `MoveResultTournament` → `MoveArchiveTournament`, `AddResultRound` → `AddArchiveRound`, `DeleteResultRound` → `DeleteArchiveRound`, `ImportResultRound` → `ImportArchiveRound`, `ReplaceResultRound` → `ReplaceArchiveRound`, `AddResultEntry` → `AddArchiveEntry`, `EditResultEntry` → `EditArchiveEntry`, `DeleteResultEntry` → `DeleteArchiveEntry`, `UpdateResultPlayerArchetype` → `UpdateArchivePlayerArchetype`, `RenameLeaguePlayerName` → `RenameLeagueArchivePlayerName`, `RestoreLeague` → `RestoreLeagueArchive`, and the restore-full name likewise.
- [ ] 11. Rename the API request/response record types in those two files from `League*` to `LeagueArchive*` where the name refers to the archived feature; leave `LeagueStatus` and other domain vocabulary alone if `docs/CONTEXT.md` still uses it — check that file first and update it in the same commit if the vocabulary moves.
- [ ] 12. Leave `PlayerNameMaintenanceEndpoints.cs` untouched.
- [ ] 13. Verify the export/restore payload types are untouched: `git diff backend/src/Gones.Application/Migration/` must show renames only, no field-name changes.
- [ ] 14. Update every backend test referencing the old routes: `grep -rn "/api/leagues" backend/tests --include=*.cs`.
- [ ] 15. Add the ten Test plan rows to the existing league integration test class (or a new `LeagueArchiveRouteTests.cs`).
- [ ] 16. Run `npm run backend:test`.
- [ ] 17. Run `npm run migration:smoke` and confirm the table rename applies cleanly against a seeded database.
- [ ] 18. Start Postgres (`docker compose up -d postgres`) and run `npm run api:generate`; commit `src/app/api/generated/gones-api.ts`. **The frontend will not compile after this step** — that is expected and is T24's job. Verify with `npm run typecheck` and hand the error list to T24; do not fix them here beyond what is needed to make `npm run build` succeed. If the build must be green for this commit, do the minimum mechanical call-site rename in `src/app/backend/aspnet-api-backend.service.ts` only, and leave every feature-level rename to T24.
- [ ] 19. `docs/adr/0022-rename-the-archived-league-feature.md` is **already written** as part of this plan. Read it before coding — it names exactly what is renamed, what is frozen (the export bundle format, `/api/maintenance/player-names*`) and why there are no API path aliases.
- [ ] 20. Update `docs/CONTEXT.md` and `docs/GLOSSARY.md` with the new vocabulary (`League Archive`, `Archive Tournament`), keeping the old words as "formerly" notes.
- [ ] 21. `ops/acceptance-matrix.json` has **zero** `/api/leagues` route strings (parent-verified) — there is nothing
  mechanical to update. Adjust only prose that names a renamed route (`doc09-league-live` ~2176-2202,
  `product-league-live-parity` ~2348); leave file `target` paths alone. Then run `npm run acceptance:matrix`.
- [ ] 22. Run `npm run backend:test && npm run api:check`.

## Outputs

- Files created: `backend/src/Gones.Infrastructure/Persistence/Migrations/*_RenameLeagueArchiveTables.cs` (+ Designer), `docs/adr/0022-rename-the-archived-league-feature.md`, possibly `backend/tests/Gones.IntegrationTests/LeagueArchiveRouteTests.cs`.
- Files touched: `backend/src/Gones.Api/Leagues/*.cs`, `backend/src/Gones.Domain/Leagues/*.cs`, `backend/src/Gones.Infrastructure/Persistence/*.cs`, `backend/tests/**`, `src/app/api/generated/gones-api.ts`, `src/app/backend/aspnet-api-backend.service.ts`, `docs/CONTEXT.md`, `docs/GLOSSARY.md`, `ops/acceptance-matrix.json`.
- Public API / behavior change: every league route changes path; the old paths return `404`.
- Migrate / config: one EF migration renaming a table and its indexes.

## Validation

- [ ] `npm run backend:test` passes
- [ ] `npm run migration:smoke` passes
- [ ] `npm run api:check` reports no drift
- [ ] `npm run acceptance:matrix` passes
- [ ] `npm run build` succeeds (frontend feature renames deferred to T24)
- [ ] manual check: `curl http://127.0.0.1:5080/api/leagues-archive` returns the list and `/api/leagues` returns 404
- [ ] manual check: restore a `fixtures/league-domain/v1` bundle through the new restore route
- [ ] app functional — Live finalize still returns a `leagueId`; Calendar, auth and admin untouched
- [ ] commit msg draft: `refactor(api): rename the archived league feature to leagues-archive end to end`
