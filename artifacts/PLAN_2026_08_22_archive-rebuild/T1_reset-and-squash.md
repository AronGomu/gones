# T1: Reset the archive and squash the migration history

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** none
**Commit outcome:** The local archive is empty, `backend/src/Gones.Infrastructure/Persistence/Migrations/` holds exactly one migration named `InitialCreate` that produces a byte-identical schema to the 35 it replaces, and `npm run migration:smoke` exits `0`.

## Context (self-contained)

- Goal: the Archive is being rebuilt on three tiers — League → LeagueSeason → Tournament — where a
  Tournament becomes a first-class top-level record that may stand alone. That rebuild adds three new
  tables and re-keys `player_statistics` in later tickets. This ticket clears the runway: it collapses
  35 accumulated EF migrations into one `InitialCreate` against the **current, unchanged** model, and
  it empties every local store that holds archive data.
- This slice: the first ticket of the plan. Nothing depends on a predecessor. Every ticket after this
  one adds migrations on top of the single `InitialCreate` this ticket produces (T2 adds
  `RebuildArchiveThreeTier`, T8 adds `ScopePlayerStatistics`).
- Out of scope here — the fence, do not cross it:
  - **No schema change.** Not one new table, not one new column, not one new index, not one changed
    constraint. The EF model is byte-identical before and after this ticket.
  - **No endpoint change.** `backend/src/Gones.Api/**` is not edited.
  - **No domain change.** `backend/src/Gones.Domain/**` is not edited.
  - **No frontend change.** `src/**` and `cypress/**` are not edited.
  - The only production directory that changes is
    `backend/src/Gones.Infrastructure/Persistence/Migrations/`. Everything else you touch is a test,
    a script gate or a doc that *names a migration id this ticket deletes*, and is listed explicitly
    in `## Impl steps`.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** This is the
    entire justification for rewriting migration history, which would otherwise be forbidden: an
    append-only migration ledger only matters when some environment has already run it. No
    environment has. `AGENT.md` states this release position; do not re-litigate it.
  - There is no data migration and no backwards compatibility requirement for local data.
  - EF Core runtime is `10.0.4` (`backend/Directory.Packages.props:11`), the Npgsql provider is
    `10.0.3` (line 23), target framework `net10.0`.
  - `dotnet-ef` is installed as a **global** tool at version `10.0.11`. It is *not* in
    `backend/.config/dotnet-tools.json`, which contains only `nswag.consolecore`. The last migration
    (`20260820160349_AddPlayerRatingColumns`) was scaffolded by this tool and stamped
    `ProductVersion "10.0.4"` — the snapshot's `ProductVersion` comes from the runtime package, not
    the tool, so regenerating with the same tool must reproduce the same bytes.
  - Migrations are generated with `Gones.Infrastructure` as **both** `--project` and
    `--startup-project`. `Gones.Api` does **not** reference `Microsoft.EntityFrameworkCore.Design`
    (verified: no `Design` line in `backend/src/Gones.Api/Gones.Api.csproj`); `Gones.Infrastructure`
    does, and owns `GonesDbContextFactory : IDesignTimeDbContextFactory<GonesDbContext>`.
  - `GonesDbContextFactory` throws unless the environment variable `GONES_DB_CONNECTION` is set. It is
    required even for `migrations add`, which opens no connection.

### Manual and destructive actions frontloaded here (whole plan)

**This ticket is the only place in the plan that asks a human to destroy data. Read this block
before running anything.**

Every command below is **irreversible**. `npm run db:reset` runs
`docker compose --profile development down --volumes`, which deletes the `postgres-data` Docker
volume outright — every row in the local database is gone and cannot be recovered. Deleting the
migrations folder rewrites history that an append-only ledger normally forbids. Clearing
`localStorage` signs you out and drops browser-authored archive Leagues that exist nowhere else.

**This is safe only because Gones is unreleased: there is no production environment, there are no
users, and no environment has ever applied these migrations except local development machines.** If
that ever stops being true, none of this is repeatable.

There is no backup step here on purpose — there is nothing worth backing up. If you personally have
a local archive League you want to keep, export it from the UI **before** you start; nothing in this
ticket will recover it afterwards.

1. **EF tooling** (needed by step 5 — run first, it is not destructive):

   ```bash
   dotnet ef --version
   # If that fails with "Could not execute because the specified command or file was not found":
   dotnet tool install --global dotnet-ef --version 10.0.11
   export PATH="$PATH:$HOME/.dotnet/tools"
   dotnet ef --version
   ```

   Expected final output:

   ```
   Entity Framework Core .NET Command-line Tools
   10.0.11
   ```

2. **Drop and recreate the local PostgreSQL database** (destructive; run at step 9, after the
   migration files are in place, so the fresh volume is built by the new `InitialCreate`):

   ```bash
   cd /home/aron/projects/gones
   npm run db:reset
   ```

   `scripts/reset-local-stack.mjs` runs, in order:
   `docker compose --profile development down --volumes --remove-orphans`,
   `docker compose --profile development up --build -d --wait`, then `node scripts/seed-local.mjs`.
   The `up --build` step rebuilds the `migrator` image so it carries the new migration.
   Expected last line: `Local stack reset to deterministic seeded state.`

   Known failure mode, not your bug: the `frontend-development` service binds `127.0.0.1:4200`. If a
   stray `ng serve` holds that port, `up --wait` fails. Kill the dev server first
   (`pkill -f "ng serve"`), then re-run.

3. **Empty the archive of authored rows** (destructive; step 9, after `npm run migration:smoke`,
   because the smoke deliberately imports two archive Leagues and asserts they land):

   ```bash
   cd /home/aron/projects/gones
   docker compose exec -T postgres psql -U gones_migration -d gones -v ON_ERROR_STOP=1 <<'SQL'
   DELETE FROM league_archive_aggregates WHERE document_id <> 'placeholder-league';
   DELETE FROM player_statistics;
   DELETE FROM player_statistics_meta;
   SQL
   ```

   The fixed `placeholder-league` row is **kept**: it is seed data that `InitialCreate` itself
   inserts, `LeagueArchiveAggregate.Delete` refuses to delete it, `scripts/seed-local.mjs` asserts it
   exists, and `MigrationImportService` calls `SingleAsync` on it. It is retired at T17, not here.
   `player_statistics` is rebuilt from the (now empty) archive by `PlayerStatisticsStartupRebuild` on
   the next API start, so emptying it is consistent, not a hole.

   `audit_records` is **not** cleared and must not be: it is append-only at the database level and
   every `DELETE`/`TRUNCATE` raises SQLSTATE `55000`.

4. **Clear the browser** (destructive; step 9). Open `http://127.0.0.1:4200`, open DevTools console,
   run:

   ```js
   localStorage.clear();
   indexedDB.deleteDatabase('gones-leagues');
   ```

   Then hard-reload (Ctrl+Shift+R). `localStorage.clear()` also drops the auth coordination keys, so
   you will be signed out — that is expected. `gones-leagues` is the browser-local archive authority
   (`src/app/backend/local-league-archive-backend.service.ts:35`,
   `export const LOCAL_LEAGUE_DB_NAME = 'gones-leagues'`); deleting it destroys every browser-authored
   League permanently.

   The IndexedDB database `gones-live` is **deliberately left alone** — it holds Live Tournament data,
   which this plan does not touch.

   Targeted alternative, if you would rather keep your session (the two archive catalog cache keys,
   from `src/app/features/leagues-archive/league-archive-catalog-cache.service.ts:11-12`):

   ```js
   localStorage.removeItem('gones.leagues-archive.catalog.v2');
   localStorage.removeItem('gones.leagues-archive.catalog');
   indexedDB.deleteDatabase('gones-leagues');
   ```

## Requirements

1. `backend/src/Gones.Infrastructure/Persistence/Migrations/` contains exactly **three** files after
   this ticket: `<timestamp>_InitialCreate.cs`, `<timestamp>_InitialCreate.Designer.cs`, and
   `GonesDbContextModelSnapshot.cs`. It contains **71** files before.
2. The migration is named exactly `InitialCreate`. Not `Initial`, not `InitialPersistence`, not
   `InitialSchema`.
3. The regenerated `GonesDbContextModelSnapshot.cs` is **byte-identical** to the one it replaces.
   Any difference at all is a signal that the model was touched, and is a stop-and-report condition.
4. A database migrated by the single `InitialCreate` has a schema that is byte-identical, under
   `pg_dump --schema-only`, to a database migrated by the 35 migrations it replaces.
5. Four classes of artifact that EF's model diff **cannot** regenerate are carried into
   `InitialCreate` verbatim, because they live in `migrationBuilder.Sql` / `migrationBuilder.InsertData`
   calls rather than in the model, and each one is load-bearing for a named passing test:
   - the `reject_audit_mutation()` PL/pgSQL function in its **final, narrowed** form, its two triggers
     on `audit_records`, and the `REVOKE UPDATE, DELETE, TRUNCATE ON audit_records FROM PUBLIC`;
   - the conditional `GRANT UPDATE (actor_id) ON audit_records TO gones_app`;
   - the `tournament_formats` `Legacy` seed row;
   - the 49 `deck_archetypes` preset seed rows;
   - the fixed `league_archive_aggregates` `placeholder-league` seed row.
6. `scripts/smoke-full-stack.mjs`'s hardcoded `expectedMigrations` allowlist lists exactly the one new
   migration id. `scripts/release-preflight.mjs` parses that same array and compares it to the
   directory listing, so a stale allowlist fails `npm run release:preflight` as well as
   `npm run e2e:ci`.
7. Every test that pins a deleted migration id is removed, and `MigrationSafetyTests`' rename guard
   stops asserting the existence of a rename migration that no longer exists.
8. The local PostgreSQL database, `localStorage` and the IndexedDB database `gones-leagues` hold no
   archive data when the ticket is done.
9. `npm run migration:smoke` exits `0`.
10. `npm run backend:build`, `npm run backend:test`, `npm run typecheck` and `npm run test` are green.
    `npm run typecheck` and `npm run test` cannot be affected by this ticket — run them anyway, they
    are the proof that the fence held.

## Inputs

Files to read before editing. Line references are as of this ticket being written; re-check them,
the codebase wins over this document if they have drifted.

- `backend/src/Gones.Infrastructure/Persistence/Migrations/` — 71 files: 35 migrations × (`.cs` +
  `.Designer.cs`) plus `GonesDbContextModelSnapshot.cs` (2937 lines, 38 `ToTable` calls, 59
  `HasCheckConstraint` calls, `ProductVersion "10.0.4"` at line 21).
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContextFactory.cs` — the design-time factory.
  Reads `PersistenceServiceCollectionExtensions.ConnectionStringKey`, which is the literal
  `"GONES_DB_CONNECTION"` (`PersistenceServiceCollectionExtensions.cs:9`), and throws
  `InvalidOperationException` when it is unset.
- `backend/Gones.sln` — 9 projects: `Gones.Domain`, `Gones.Application`, `Gones.Infrastructure`,
  `Gones.Api`, `Gones.Worker`, `Gones.Migrator`, `Gones.UnitTests`, `Gones.IntegrationTests`,
  `Gones.ArchitectureTests`.
- The five migrations whose non-model content must survive:
  - `Migrations/20260724112436_AppendOnlyAuditGuard.cs` — creates `reject_audit_mutation()`, the two
    triggers, and the `REVOKE ... FROM PUBLIC`.
  - `Migrations/20260808164636_AllowAccountHardDelete.cs` — replaces `reject_audit_mutation()` with
    the narrowed form that tolerates exactly one change (`actor_id` set to NULL with every other
    column identical), and adds the conditional `GRANT UPDATE (actor_id) ... TO gones_app`.
  - `Migrations/20260801152724_AddAdminBootstrapAndFormats.cs` — the `tournament_formats` Legacy seed.
  - `Migrations/20260805105726_AddDeckArchetypeCatalog.cs` — the 49 `deck_archetypes` preset seeds.
  - `Migrations/20260802204547_AddLeagueAggregates.cs:38-51` — `migrationBuilder.InsertData` for the
    `placeholder-league` row. Note this is `InsertData`, not `Sql`; grepping only for
    `migrationBuilder.Sql` misses it.
- `scripts/smoke-full-stack.mjs:51-61` — the migration allowlist gate. Line 57 is the
  `const expectedMigrations = [...]` array of 35 ids; line 59-61 throws
  `PostgreSQL migrations differ. Expected …; got …`.
- `scripts/release-preflight.mjs:317-325` — `readMigrations(root)` lists
  `backend/src/Gones.Infrastructure/Persistence/Migrations` for files matching `/^\d{14}_/` that end
  `.cs` but not `.Designer.cs`, and extracts the allowlist from `smoke-full-stack.mjs` with
  `/const expectedMigrations = \[[^\]]*\]/s` + `/'(\d{14}_[^']+)'/g`. Mismatch → a `migration` class
  failure.
- `scripts/smoke-migration.mjs` — what `npm run migration:smoke` runs. Six-phase C38 smoke against the
  running Compose stack; talks to the `postgres` service as role `gones_migration`, database `gones`,
  and runs the `migrator` service image. Its `mapping.json` fixture uses `formatSlugs: ['legacy']`
  (line 231), so the Legacy `tournament_formats` seed row is a hard dependency of this command.
- `scripts/reset-local-stack.mjs` and `scripts/seed-local.mjs` — what `npm run db:reset` runs.
  `seed-local.mjs` throws `Fixed placeholder League missing or duplicated.` unless exactly one
  `league_archive_aggregates` row has `document_id = 'placeholder-league'`,
  `name = 'Unassigned Tournaments'` and `canonical_document ->> 'id' = 'placeholder-league'`.
- `compose.yaml` — `postgres` (postgres:17-alpine, `127.0.0.1:5433:5432`, db `gones`, user
  `gones_migration`, password `local-migration-only`); `migrator` (`command: ["database", "update"]`,
  which calls `database.Database.MigrateAsync()` at `backend/src/Gones.Migrator/Program.cs:106`);
  `permissions`; `api`; `worker`; `frontend-development` on `127.0.0.1:4200`.
- `deploy/postgres/init-roles.sql` — creates the `gones_app` role and its default privileges. This is
  **not** a migration and is unaffected by the squash.
- Tests that pin a deleted migration id, all of which this ticket must repair:
  - `backend/tests/Gones.IntegrationTests/EventTableRenameTests.cs:23` —
    `private const string BeforeRename = "20260812154508_HealOrganizationMembershipInvariants";`
  - `backend/tests/Gones.IntegrationTests/OrganizationMembershipHealTests.cs:27` —
    `private const string BeforeHeal = "20260809122735_RenameLeagueArchiveTables";`
  - `backend/tests/Gones.IntegrationTests/ArchiveTournamentStatusBackfillTests.cs:21` —
    `private const string BeforeBackfill = "20260816105213_RemoveOrganizationOwnership";`
- `backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs` — three facts plus a class-level
  XML doc that names `20260809122735_RenameLeagueArchiveTables.cs`.
- Characterization tests that already lock the artifacts of Requirement 5 and must stay green — read
  them, do not edit them:
  - `backend/tests/Gones.IntegrationTests/PersistenceKernelTests.cs:70-133`
    `Audit_records_reject_ef_and_raw_sql_mutation` — asserts `"Audit records are append-only."` from
    EF and SQLSTATE `55000` from raw `UPDATE` / `DELETE` / `TRUNCATE`, on a container that only ran
    `MigrateAsync()`.
  - `backend/tests/Gones.IntegrationTests/AccountDeletionTests.cs:359-377`
    `Audit_records_stay_append_only_apart_from_the_actor_reference` — asserts `55000` for a content
    change, for an actor swap combined with a content change, and for a delete, and asserts that the
    lone `UPDATE audit_records SET actor_id = NULL` affects exactly 1 row. This is the narrowed
    trigger form; the original strict form fails it.
  - `backend/tests/Gones.IntegrationTests/AdminBootstrapAndCatalogTests.cs:42-53`
    `Public_formats_lists_seeded_legacy_only_active` — `GET /api/formats` returns exactly one entry,
    `slug == "legacy"`, `name == "Legacy"`, on a migrate-only container.
  - `backend/tests/Gones.IntegrationTests/DeckArchetypeCatalogApiTests.cs:48-56`
    `Public_deck_archetypes_lists_seeded_legacy_presets` — asserts
    `DeckArchetypePresets.LegacyNames.Count` (49) names and `Contains("Reanimator (Rakdos)")`.
- `docs/OPERATIONS.md:197-215` — a "Membership heal migration" subsection whose whole subject is
  `20260812154508_HealOrganizationMembershipInvariants`.
- **From Depends:** none. This is the first ticket.

## Interface contract (level 5)

### Produces

**Migration name — binding, exact:**

```
InitialCreate
```

Generated file names, where `<ts>` is the 14-digit UTC timestamp EF stamps at scaffold time
(`yyyyMMddHHmmss`, e.g. `20260822143015`):

```
backend/src/Gones.Infrastructure/Persistence/Migrations/<ts>_InitialCreate.cs
backend/src/Gones.Infrastructure/Persistence/Migrations/<ts>_InitialCreate.Designer.cs
backend/src/Gones.Infrastructure/Persistence/Migrations/GonesDbContextModelSnapshot.cs
```

Generated C# shape (EF scaffold, do not rename):

```csharp
namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder) { /* generated + appended block */ }
        protected override void Down(MigrationBuilder migrationBuilder) { /* prepended block + generated */ }
    }
}
```

**Migration id contract consumed by two gates.** After scaffolding, the literal
`<ts>_InitialCreate` must appear in exactly one place outside the migrations directory:

```js
// scripts/smoke-full-stack.mjs:57
const expectedMigrations = ['<ts>_InitialCreate'];
```

**The appended `Up` block — verbatim, copy-pasteable, appended after every generated
`CreateTable` / `CreateIndex` / `AddForeignKey` call, in exactly this order.** Order matters: the
triggers need `audit_records` to exist, and the two `ON CONFLICT` seeds need their unique indexes to
exist.

```csharp
            // ---- Carried from 20260724112436_AppendOnlyAuditGuard and 20260808164636_AllowAccountHardDelete.
            // audit_records is append-only at the database level. The guard is narrowed to tolerate
            // exactly one change — a hard account deletion nulling actor_id and changing nothing else —
            // so the audit row outlives the account. Every other update, delete and truncate raises 55000.
            // EF's model diff cannot express a function, a trigger or a grant, so this is hand-written.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                DECLARE
                    without_actor audit_records%ROWTYPE;
                BEGIN
                    IF TG_OP = 'UPDATE' THEN
                        IF OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL THEN
                            without_actor := OLD;
                            without_actor.actor_id := NULL;
                            IF NEW IS NOT DISTINCT FROM without_actor THEN
                                RETURN NEW;
                            END IF;
                        END IF;
                    END IF;

                    RAISE EXCEPTION 'audit_records is append-only' USING ERRCODE = '55000';
                END;
                $$;

                CREATE TRIGGER audit_records_append_only
                BEFORE UPDATE OR DELETE ON audit_records
                FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

                CREATE TRIGGER audit_records_no_truncate
                BEFORE TRUNCATE ON audit_records
                FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

                REVOKE UPDATE, DELETE, TRUNCATE ON audit_records FROM PUBLIC;
                """);

            // The application role may only write audit rows; nulling the actor is the single column
            // it is allowed to update. The role is absent from throwaway test databases.
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'gones_app') THEN
                        EXECUTE 'GRANT UPDATE (actor_id) ON audit_records TO gones_app';
                    END IF;
                END $$;
                """);

            // ---- Carried from 20260801152724_AddAdminBootstrapAndFormats.
            migrationBuilder.Sql("""
                INSERT INTO tournament_formats (id, name, slug, sort_order, created_at, updated_at, deleted_at, version)
                VALUES ('00000000-0000-0000-0000-0000000000f1', 'Legacy', 'legacy', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1)
                ON CONFLICT (slug) DO NOTHING;
                """);

            // ---- Carried from 20260805105726_AddDeckArchetypeCatalog. 49 rows; the count is asserted by
            // DeckArchetypeCatalogApiTests.Public_deck_archetypes_lists_seeded_legacy_presets against
            // DeckArchetypePresets.LegacyNames.Count.
            migrationBuilder.Sql("""
                INSERT INTO deck_archetypes (id, name, normalized_name, created_at, updated_at, deleted_at, version)
                VALUES
                ('00000000-0000-0000-00c3-000000000001', 'Reanimator (Rakdos)', 'reanimator (rakdos)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1),
                -- … 47 further rows, extracted mechanically by step 6.5, never retyped …
                ('00000000-0000-0000-00c3-000000000049', 'Beanstalk Control (Bant)', 'beanstalk control (bant)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 1)
                ON CONFLICT (normalized_name) DO NOTHING;
                """);

            // ---- Carried from 20260802204547_AddLeagueAggregates, retargeted at the table's final name.
            // The fixed placeholder League. LeagueArchiveAggregate.Delete refuses to delete it,
            // MigrationImportService calls SingleAsync on it, and scripts/seed-local.mjs asserts it.
            // Retired at T17 with the rest of the legacy archive, not here.
            migrationBuilder.InsertData(
                table: "league_archive_aggregates",
                columns: new[] { "id", "document_id", "name", "status", "updated_at", "deleted_at", "canonical_document", "version" },
                values: new object[]
                {
                    new Guid("00000000-0000-0000-0000-000000000030"),
                    "placeholder-league",
                    "Unassigned Tournaments",
                    "active",
                    Instant.FromUtc(2026, 8, 3, 0, 0),
                    null,
                    "{\"id\":\"placeholder-league\",\"name\":\"Unassigned Tournaments\",\"status\":\"active\",\"tournaments\":[]}",
                    1L
                });
```

The `InsertData` call needs two usings at the top of `<ts>_InitialCreate.cs`; EF's scaffold may
already emit `using System;`. Ensure both are present:

```csharp
using System;
using NodaTime;
```

`counts_version`, `player_count` and `tournament_count` are deliberately **omitted** from the
`InsertData` column list: they are `NOT NULL DEFAULT 0` in the model, which reproduces exactly the
state the historical chain left them in (`20260820113606_AddLeagueArchiveCatalogCounts` added them
with `defaultValue: 0` and backfilled nothing).

**The prepended `Down` block — verbatim, placed as the first statements of `Down`, before every
generated `DropTable`.** `DROP TABLE audit_records` does not drop the function, so it must be
dropped explicitly.

```csharp
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS audit_records_no_truncate ON audit_records;
                DROP TRIGGER IF EXISTS audit_records_append_only ON audit_records;
                DROP FUNCTION IF EXISTS reject_audit_mutation();
                """);
```

**New architecture test — exact signature and assertion:**

```csharp
// backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs
[Fact]
public void The_migration_history_is_a_single_initial_create()
{
    var migrations = MigrationSources().Select(Path.GetFileNameWithoutExtension).ToArray();

    var single = Assert.Single(migrations);
    Assert.Matches(@"^\d{14}_InitialCreate$", single);
}
```

**New integration test — exact file, class and assertion:**

```csharp
// backend/tests/Gones.IntegrationTests/InitialCreateSeedTests.cs
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Gones.IntegrationTests;

/// <summary>
/// T1 squashed 35 migrations into one <c>InitialCreate</c>. EF's model diff regenerates tables,
/// columns, indexes and constraints, but never a seeded row: the fixed placeholder League lived in a
/// hand-written <c>InsertData</c> call and had to be carried across by hand. Nothing else asserted it
/// from a test — only <c>scripts/seed-local.mjs</c> did, and a script is not a gate the backend suite
/// runs. This test is that gate.
/// </summary>
public sealed class InitialCreateSeedTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
    }

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Initial_create_seeds_the_fixed_placeholder_league()
    {
        await using var database = CreateContext();

        var count = await database.Database.SqlQueryRaw<int>("""
            SELECT count(*)::int AS "Value"
            FROM league_archive_aggregates
            WHERE document_id = 'placeholder-league'
              AND name = 'Unassigned Tournaments'
              AND status = 'active'
              AND deleted_at IS NULL
              AND version = 1
              AND canonical_document ->> 'id' = 'placeholder-league'
              AND canonical_document -> 'tournaments' = '[]'::jsonb
            """).SingleAsync();

        Assert.Equal(1, count);
    }

    private GonesDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(postgres.GetConnectionString())
            .Options);
}
```

**Edited architecture test — the rename guard's sentinel. Replace exactly this:**

```csharp
    // The rule is only meaningful while a rename migration exists to be checked.
    Assert.True(renameMigrations > 0, "No committed migration renames a table; this guard is scanning nothing.");
    Assert.Empty(violations);
```

**with exactly this:**

```csharp
    // T1 squashed the history into a single InitialCreate, so no committed migration renames a table
    // any more and `renameMigrations` is legitimately 0. The scan-count sentinel keeps the guard from
    // passing because it read no files, which is the failure the old sentinel was really guarding.
    Assert.True(scanned > 0, "No migration sources found; this guard is scanning nothing.");
    Assert.Empty(violations);
```

which requires a `scanned` counter in that method, mirroring
`No_migration_renames_a_table_by_dropping_and_recreating_it`:

```csharp
    var violations = new List<string>();
    var renameMigrations = 0;
    var scanned = 0;

    foreach (var path in MigrationSources())
    {
        scanned++;
        var source = File.ReadAllText(path);
```

### Consumes

Nothing. `Depends: none`.

### Errors

| Where | Trigger | Exact message / code |
| --- | --- | --- |
| `dotnet ef migrations add` | `GONES_DB_CONNECTION` unset | `InvalidOperationException: GONES_DB_CONNECTION is required for EF tooling.` |
| `dotnet ef` | tool not installed | `Could not execute because the specified command or file was not found.` |
| `npm run e2e:ci` / `scripts/smoke-full-stack.mjs:60` | allowlist ≠ applied set | `PostgreSQL migrations differ. Expected <list>; got <list>` |
| `npm run release:preflight` | allowlist ≠ directory listing | `migration: the smoke allowlist does not match the shipped migrations (missing …; stale …)` |
| `npm run db:reset` / `scripts/seed-local.mjs` | placeholder row absent or duplicated | `Error: Fixed placeholder League missing or duplicated.` |
| `MigrationSafetyTests.Committed_migrations_fully_describe_the_model` | model ≠ snapshot | `The model has changes no migration carries. Run \`dotnet ef migrations add <Name>\` — and if the change renames an entity or a table, hand-correct the scaffold to a rename instead of a drop-and-create.` |
| any `MigrateAsync("<deleted id>")` | migration id no longer on disk | `InvalidOperationException` from `IMigrator` — the target migration is not found |
| `audit_records` raw `UPDATE`/`DELETE`/`TRUNCATE` | append-only guard | `PostgresException`, `SqlState == "55000"`, message `audit_records is append-only` |
| EF `SaveChanges` on a modified/deleted `AuditRecord` | `GonesDbContext.cs:82` | `InvalidOperationException: Audit records are append-only.` |

### Invariants

- **The model is not touched.** Pre-condition and post-condition: `GonesDbContext`,
  every `*Configuration.cs` under `backend/src/Gones.Infrastructure/Persistence/`, and every entity
  type under `backend/src/Gones.Domain/` are byte-identical before and after. `git diff --stat` must
  show zero lines changed under `backend/src/Gones.Domain/`, `backend/src/Gones.Api/` and `src/`.
- **Snapshot identity.** `GonesDbContextModelSnapshot.cs` after == before, byte for byte, including
  the UTF-8 BOM (`ef bb bf`) and `ProductVersion "10.0.4"`. Not "semantically equal" — identical.
- **Schema identity.** `pg_dump --schema-only --no-owner --no-privileges` of a database built by the
  old 35 == the same dump of a database built by `InitialCreate`, after both are stripped of
  `__EFMigrationsHistory` *rows* (the table itself is in both dumps and must match).
- **Idempotency.** Running `docker compose run --rm migrator database update` twice leaves
  `__EFMigrationsHistory` at exactly 1 row. Both hand-written `INSERT`s carry `ON CONFLICT … DO
  NOTHING`, and `InsertData` runs once because the migration runs once.
- **Ordering inside `Up`.** All generated DDL first, then the appended block in the order given
  above. The trigger DDL requires `audit_records`; `ON CONFLICT (slug)` requires
  `ix_tournament_formats_slug`; `ON CONFLICT (normalized_name)` requires
  `ix_deck_archetypes_normalized_name`; `InsertData` on `league_archive_aggregates` requires that
  table and its check constraints.
- **`Down` is never executed** by any code path in this repo. It is written for correctness, not
  because anything runs it.
- **Nullability.** `deleted_at` on the placeholder row is `null`; `canonical_document` is `NOT NULL`
  and must satisfy `ck_league_aggregate_document_metadata`
  (`canonical_document ->> 'id' = document_id AND … 'name' = name AND … 'status' = status`).
- **Units.** `Instant.FromUtc(2026, 8, 3, 0, 0)` is UTC; `updated_at` is `timestamptz`.
- **Test count delta is exactly −13**: `−10` (`OrganizationMembershipHealTests`, 10 facts) `−4`
  (`ArchiveTournamentStatusBackfillTests`, 4 facts) `−1`
  (`EventTableRenameTests.Rows_written_before_the_rename_survive_it`) `+1`
  (`MigrationSafetyTests.The_migration_history_is_a_single_initial_create`) `+1`
  (`InitialCreateSeedTests.Initial_create_seeds_the_fixed_placeholder_league`). Any other delta means
  something broke.

## TDD

1. **Red** — before deleting anything:
   - `MigrationSafetyTests.The_migration_history_is_a_single_initial_create` — genuinely red. With 35
     migrations on disk, `Assert.Single` throws
     `Assert.Single() Failure: The collection contained 35 items`.
   - `InitialCreateSeedTests.Initial_create_seeds_the_fixed_placeholder_league` — **green** on the old
     history, by design. This is a refactor, so this one is a *characterization* test: it is written
     first precisely so the squash cannot silently drop the seeded row. Capture its green run on the
     old history before touching the migrations; that recording is what makes it evidence.
   - The four existing tests named under `## Inputs` (`PersistenceKernelTests`, `AccountDeletionTests`,
     `AdminBootstrapAndCatalogTests`, `DeckArchetypeCatalogApiTests`) are the other characterization
     locks. Record them green on the old history, then require them green afterwards. Do not edit them.
2. **Green** — delete the 71 files, scaffold the one `InitialCreate`, re-attach the four non-model
   artifacts, repair the gates. The single-`InitialCreate` test turns green; all five characterization
   locks stay green.
3. **Refactor** — none. Any tidy-up you are tempted by is a fence breach.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| `MigrationSafetyTests.The_migration_history_is_a_single_initial_create` | the migrations directory listing | red before: `Assert.Single() Failure: The collection contained 35 items`. Green after: one entry matching `^\d{14}_InitialCreate$` |
| `MigrationSafetyTests.Committed_migrations_fully_describe_the_model` | compiled model vs compiled snapshot, no DB connection | `HasPendingModelChanges() == false`. Green before **and** after — this is the model-untouched proof |
| `MigrationSafetyTests.No_migration_renames_a_table_by_dropping_and_recreating_it` | `<ts>_InitialCreate.cs` `Up` body | green: `Up` contains `CreateTable` and no `DropTable`, `scanned == 1` |
| `MigrationSafetyTests.Rename_migrations_never_drop_or_recreate_the_table_they_rename` | all migration sources | green with `renameMigrations == 0` and `scanned == 1` after the sentinel swap. Fails with `No committed migration renames a table; this guard is scanning nothing.` if the sentinel is left alone |
| `InitialCreateSeedTests.Initial_create_seeds_the_fixed_placeholder_league` | fresh Testcontainers PG 17, `MigrateAsync()` | exactly 1 row: `document_id='placeholder-league'`, `name='Unassigned Tournaments'`, `status='active'`, `deleted_at IS NULL`, `version=1`, `canonical_document->>'id'='placeholder-league'`, `canonical_document->'tournaments' = '[]'::jsonb` |
| `PersistenceKernelTests.Audit_records_reject_ef_and_raw_sql_mutation` | fresh container, `MigrateAsync()` | EF update/delete → `InvalidOperationException("Audit records are append-only.")`; raw `UPDATE`, `DELETE`, `TRUNCATE` → `PostgresException.SqlState == "55000"`; `gones_app_test` role denied with `InsufficientPrivilege` |
| `AccountDeletionTests.Audit_records_stay_append_only_apart_from_the_actor_reference` | registered account, raw SQL | content change / actor swap + content change / delete → `55000`; lone `UPDATE … SET actor_id = NULL` affects exactly `1` row. Proves the **narrowed** trigger survived, not the original strict one |
| `AdminBootstrapAndCatalogTests.Public_formats_lists_seeded_legacy_only_active` | `GET /api/formats` on a migrate-only container | array of length 1, `slug == "legacy"`, `name == "Legacy"` |
| `DeckArchetypeCatalogApiTests.Public_deck_archetypes_lists_seeded_legacy_presets` | `GET /api/deck-archetypes` on a migrate-only container | `names.Length == DeckArchetypePresets.LegacyNames.Count` (49); contains `"Reanimator (Rakdos)"` |
| `EventTableRenameTests.Rename_migration_replaces_the_old_calendar_tables` | fresh container, `MigrateAsync()` | `events`, `event_formats`, `event_registration_attempts`, `event_lifecycle_entries`, `event_proposals`, `event_proposal_recipients`, `consumed_event_preview_tickets` exist; the 7 retired `*tournament*` names do not |
| `EventTableRenameTests.Out_of_scope_tables_keep_their_names` | fresh container, `MigrateAsync()` | `tournament_formats`, `league_archive_aggregates`, `live_aggregates` exist; `scheduled_notifications.event_id` and `notification_history.event_id` exist, `tournament_id` does not |
| `EventTableRenameTests.Renamed_registration_attempts_still_enforce_the_event_foreign_key` | insert with an unknown `event_id` | `PostgresException.SqlState == PostgresErrorCodes.ForeignKeyViolation` |
| Snapshot diff | `diff /tmp/gones-t1/snapshot-before.cs <new snapshot>` | exit `0`, no output |
| Schema diff | `diff /tmp/gones-t1/schema-before.sql /tmp/gones-t1/schema-after.sql` | exit `0`, no output |
| Allowlist consistency | `scripts/smoke-full-stack.mjs` `expectedMigrations` vs directory listing | identical single-element arrays |

Run commands:

```bash
# whole backend suite (unit + architecture + integration); the integration assembly needs Docker and
# takes several minutes — allow 2400s
npm run backend:test

# just the architecture guards, fast
dotnet test backend/tests/Gones.ArchitectureTests/Gones.ArchitectureTests.csproj --configuration Release

# a single fact
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~InitialCreateSeedTests"
```

## Impl steps

- [ ] 1. Capture the pre-squash baseline. Nothing here is destructive; all of it is evidence you cannot recreate once the files are gone.
  - [ ] 1.1 `mkdir -p /tmp/gones-t1`
  - [ ] 1.2 Verify the count the plan claims: `ls backend/src/Gones.Infrastructure/Persistence/Migrations/ | wc -l` → must print `71`. If it prints anything else, stop and report; the plan's premise has drifted.
  - [ ] 1.3 Verify the migration count: `ls backend/src/Gones.Infrastructure/Persistence/Migrations/*.cs | grep -v Designer | grep -v ModelSnapshot | wc -l` → must print `35`.
  - [ ] 1.4 `cp backend/src/Gones.Infrastructure/Persistence/Migrations/GonesDbContextModelSnapshot.cs /tmp/gones-t1/snapshot-before.cs`
  - [ ] 1.5 `ls backend/src/Gones.Infrastructure/Persistence/Migrations/ > /tmp/gones-t1/files-before.txt`
  - [ ] 1.6 Build a database from the old chain and dump its schema. Requires Docker: `docker compose down --volumes --remove-orphans && docker compose up -d --wait postgres && docker compose run --rm migrator database update`
  - [ ] 1.7 `docker compose exec -T postgres pg_dump -U gones_migration -d gones --schema-only --no-owner --no-privileges > /tmp/gones-t1/schema-before.sql`
  - [ ] 1.8 `docker compose exec -T postgres psql -U gones_migration -d gones -Atc 'select "MigrationId" from "__EFMigrationsHistory" order by "MigrationId";' > /tmp/gones-t1/migrations-before.txt` → 35 lines, first `20260724111457_InitialPersistence`, last `20260820160349_AddPlayerRatingColumns`
  - [ ] 1.9 Record the current backend test baseline: `npm run backend:test 2>&1 | tee /tmp/gones-t1/backend-test-before.log | tail -20`. Note the passed/failed/skipped totals per assembly; the post-change run must be that number minus 13, with zero failures.
- [ ] 2. Write the red architecture test.
  - [ ] 2.1 In `backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs`, add the `The_migration_history_is_a_single_initial_create` fact exactly as written in `## Interface contract (level 5)`, placed after `Committed_migrations_fully_describe_the_model` and before the `private static string UpBody` helper.
  - [ ] 2.2 `dotnet test backend/tests/Gones.ArchitectureTests/Gones.ArchitectureTests.csproj --configuration Release --filter "FullyQualifiedName~The_migration_history_is_a_single_initial_create"` → must FAIL with `Assert.Single() Failure: The collection contained 35 items`. Paste that line into your evidence.
- [ ] 3. Write the characterization test for the one artifact nothing else pins, and prove it green on the old history.
  - [ ] 3.1 Create `backend/tests/Gones.IntegrationTests/InitialCreateSeedTests.cs` with the exact content given in `## Interface contract (level 5)`.
  - [ ] 3.2 `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~InitialCreateSeedTests"` → must PASS against the **old** 35 migrations. It is a characterization lock, not a red test. If it fails here, the placeholder row is not where this ticket says it is — stop and report.
  - [ ] 3.3 Prove the other four locks green on the old history: `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~Audit_records_reject_ef_and_raw_sql_mutation|FullyQualifiedName~Audit_records_stay_append_only_apart_from_the_actor_reference|FullyQualifiedName~Public_formats_lists_seeded_legacy_only_active|FullyQualifiedName~Public_deck_archetypes_lists_seeded_legacy_presets"` → 4 passed.
- [ ] 4. Delete the migration history.
  - [ ] 4.1 `git rm -r --quiet backend/src/Gones.Infrastructure/Persistence/Migrations/`
  - [ ] 4.2 `ls backend/src/Gones.Infrastructure/Persistence/Migrations/ 2>/dev/null | wc -l` → `0` (the directory itself may be gone; that is fine, `dotnet ef` recreates it).
- [ ] 5. Scaffold exactly one migration named `InitialCreate`.
  - [ ] 5.1 Confirm the tool: `dotnet ef --version` → `10.0.11`. If it is missing, run the install from the frontloaded block above.
  - [ ] 5.2 Export the design-time connection string (no connection is opened, but the factory demands it): `export GONES_DB_CONNECTION='Host=127.0.0.1;Port=5433;Database=gones;Username=gones_migration;Password=local-migration-only'`
  - [ ] 5.3 `dotnet ef migrations add InitialCreate --project backend/src/Gones.Infrastructure --startup-project backend/src/Gones.Infrastructure` → expected tail `Done. To undo this action, use 'ef migrations remove'`
  - [ ] 5.4 Capture the generated id into a variable you will reuse: `MIGRATION_ID=$(ls backend/src/Gones.Infrastructure/Persistence/Migrations/*_InitialCreate.cs | xargs -n1 basename | sed 's/\.cs$//'); echo "$MIGRATION_ID"` → e.g. `20260822143015_InitialCreate`
  - [ ] 5.5 `ls backend/src/Gones.Infrastructure/Persistence/Migrations/ | wc -l` → `3`
- [ ] 6. Re-attach the four artifacts EF's model diff cannot regenerate.
  - [ ] 6.1 In `backend/src/Gones.Infrastructure/Persistence/Migrations/<ts>_InitialCreate.cs`, ensure the file's using block contains both `using System;` and `using NodaTime;` (add whichever the scaffold omitted, keeping EF's existing ordering).
  - [ ] 6.2 Append the audit-guard block (`CREATE OR REPLACE FUNCTION reject_audit_mutation` + two `CREATE TRIGGER`s + `REVOKE … FROM PUBLIC`) as the first appended statement in `Up`, after the last generated call. Copy it verbatim from `## Interface contract (level 5)`; do **not** re-derive it from `20260724112436_AppendOnlyAuditGuard.cs`, which holds the superseded strict form.
  - [ ] 6.3 Append the conditional `DO $$ … GRANT UPDATE (actor_id) ON audit_records TO gones_app … $$;` block immediately after it.
  - [ ] 6.4 Append the `tournament_formats` Legacy `INSERT … ON CONFLICT (slug) DO NOTHING;` block, copied byte-for-byte from `git show HEAD:backend/src/Gones.Infrastructure/Persistence/Migrations/20260801152724_AddAdminBootstrapAndFormats.cs`.
  - [ ] 6.5 Append the `deck_archetypes` 49-row `INSERT … ON CONFLICT (normalized_name) DO NOTHING;` block. Do not retype the 49 rows — extract them mechanically from the deleted migration, which is still in `HEAD`: `git show HEAD:backend/src/Gones.Infrastructure/Persistence/Migrations/20260805105726_AddDeckArchetypeCatalog.cs | sed -n '/migrationBuilder.Sql/,/""");/p' > /tmp/gones-t1/archetype-seed.txt`, then paste that block verbatim. Verify it: `grep -c '00000000-0000-0000-00c3' /tmp/gones-t1/archetype-seed.txt` → `49`; the first value row is `'Reanimator (Rakdos)'` and the last is `'Beanstalk Control (Bant)'`, which is the only row with no trailing comma.
  - [ ] 6.6 Append the `migrationBuilder.InsertData` call for `league_archive_aggregates` exactly as written in `## Interface contract (level 5)`. Note the table name is the **final** `league_archive_aggregates`, not the original `league_aggregates`.
  - [ ] 6.7 Prepend the `DROP TRIGGER … DROP FUNCTION` block as the first statement of `Down`, before the first generated `DropTable`.
  - [ ] 6.8 `npm run backend:build` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] 7. Prove the squash is faithful. Both diffs must be empty; a non-empty diff is a stop-and-report condition, not something to normalize away.
  - [ ] 7.1 `diff /tmp/gones-t1/snapshot-before.cs backend/src/Gones.Infrastructure/Persistence/Migrations/GonesDbContextModelSnapshot.cs && echo "SNAPSHOT IDENTICAL"` → prints `SNAPSHOT IDENTICAL`, exit `0`. If the only difference is the `ProductVersion` annotation, record it and continue. **Any other difference means the model moved — stop and report.**
  - [ ] 7.2 Build a fresh database from the new migration: `docker compose down --volumes --remove-orphans && docker compose up -d --wait postgres && docker compose build migrator && docker compose run --rm migrator database update`
  - [ ] 7.3 `docker compose exec -T postgres psql -U gones_migration -d gones -Atc 'select "MigrationId" from "__EFMigrationsHistory";'` → exactly one line, equal to `$MIGRATION_ID`.
  - [ ] 7.4 `docker compose exec -T postgres pg_dump -U gones_migration -d gones --schema-only --no-owner --no-privileges > /tmp/gones-t1/schema-after.sql`
  - [ ] 7.5 `diff /tmp/gones-t1/schema-before.sql /tmp/gones-t1/schema-after.sql && echo "SCHEMA IDENTICAL"` → prints `SCHEMA IDENTICAL`, exit `0`.
  - [ ] 7.6 Prove the seeds and the guard landed on this real database: `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select (select count(*) from pg_trigger where tgrelid='audit_records'::regclass and not tgisinternal) || '|' || (select count(*) from pg_proc where proname='reject_audit_mutation') || '|' || (select count(*) from tournament_formats where slug='legacy') || '|' || (select count(*) from deck_archetypes) || '|' || (select count(*) from league_archive_aggregates where document_id='placeholder-league');"` → `2|1|1|49|1`
  - [ ] 7.7 Prove idempotency: `docker compose run --rm migrator database update` a second time, then re-run 7.3 → still exactly one line.
- [ ] 8. Repair every gate, test and doc that pinned a deleted migration id.
  - [ ] 8.1 In `scripts/smoke-full-stack.mjs`, replace the whole of line 57 with `const expectedMigrations = ['<ts>_InitialCreate'];`, substituting the real `$MIGRATION_ID`.
  - [ ] 8.2 Verify the two gates now agree: `node -e "const fs=require('node:fs');const disk=fs.readdirSync('backend/src/Gones.Infrastructure/Persistence/Migrations').filter(f=>f.endsWith('.cs')&&!f.endsWith('.Designer.cs')&&/^\d{14}_/.test(f)).map(f=>f.replace(/\.cs$/,'')).sort();const smoke=fs.readFileSync('scripts/smoke-full-stack.mjs','utf8');const allow=[...(smoke.match(/const expectedMigrations = \[[^\]]*\]/s)?.[0]??'').matchAll(/'(\d{14}_[^']+)'/g)].map(m=>m[1]).sort();console.log(JSON.stringify(disk)===JSON.stringify(allow)?'ALLOWLIST OK '+disk[0]:'MISMATCH '+JSON.stringify({disk,allow}));"` → `ALLOWLIST OK <ts>_InitialCreate`
  - [ ] 8.3 In `backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs`, apply the `scanned` counter + sentinel swap in `Rename_migrations_never_drop_or_recreate_the_table_they_rename`, exactly as written in `## Interface contract (level 5)`.
  - [ ] 8.4 In the same file, update the class-level XML doc: it names `20260809122735_RenameLeagueArchiveTables.cs`, which no longer exists. Replace that sentence's reference with a statement that the hand-correction it describes was folded into `InitialCreate` by the T1 squash, and that rules (a) and (b) stay armed for the next migration that renames a table. Do not delete the rules.
  - [ ] 8.5 `git rm backend/tests/Gones.IntegrationTests/OrganizationMembershipHealTests.cs` — all 10 of its facts migrate to `20260809122735_RenameLeagueArchiveTables`, seed legacy violations, then apply the heal. Neither the target revision nor the heal SQL exists after the squash, and there is no revision to migrate "to just before". The invariants it protected are enforced on every runtime write path, which is what its own class doc says.
  - [ ] 8.6 `git rm backend/tests/Gones.IntegrationTests/ArchiveTournamentStatusBackfillTests.cs` — same reason: all 4 facts migrate to `20260816105213_RemoveOrganizationOwnership` and then apply a backfill that no longer exists as a separate step.
  - [ ] 8.7 In `backend/tests/Gones.IntegrationTests/EventTableRenameTests.cs`, delete **only** the `Rows_written_before_the_rename_survive_it` fact and the members that become unreachable with it: `BeforeRename`, `CountLegacyRowsAsync`, `ScalarAsync`, `InsertLegacyTournamentAsync`, `InsertLegacyRegistrationAsync`, `InsertLegacyLifecycleEventAsync`, the `LegacyCounts` record, and the now-unused `using Microsoft.EntityFrameworkCore.Infrastructure;` / `using Microsoft.EntityFrameworkCore.Migrations;` imports. **Keep** `Rename_migration_replaces_the_old_calendar_tables`, `Out_of_scope_tables_keep_their_names`, `Renamed_registration_attempts_still_enforce_the_event_foreign_key`, `TableExistsAsync`, `ColumnExistsAsync`, `SeedPrincipalsAsync`, `SeedRows`, `Now` and `CreateContext` — those three facts assert the **final** schema and stay meaningful.
  - [ ] 8.8 In the same file, update the class XML doc: it says the tests "migrate to the revision just before the rename". Replace that with a note that the rename was squashed into `InitialCreate` by T1, so what survives asserts the resulting schema — the renamed tables exist, the retired names do not, the out-of-scope tables kept their names, and the foreign key still bites.
  - [ ] 8.9 `npm run backend:build` → `Build succeeded`, 0 errors.
  - [ ] 8.10 In `docs/OPERATIONS.md`, replace the body of the `### Membership heal migration` subsection (which is entirely about `20260812154508_HealOrganizationMembershipInvariants`) with a short paragraph stating that the heal was a one-shot data migration, that it was squashed into `InitialCreate` when the history was collapsed before release, and that the two invariants it healed — an organization with no members is a Draft, and the global `Organizer` role is derived from live membership — are enforced on every runtime write path. Keep the surrounding §8 numbered steps, including step 5's rule that a new EF migration must be added to the `scripts/smoke-full-stack.mjs` allowlist.
  - [ ] 8.11 Leave `docs/adr/0035-calendar-event-vocabulary.md:47` alone. An ADR is a dated historical record of a decision, not a description of the current tree; rewriting one to match a later refactor destroys the record. Note it in your report instead.
- [ ] 9. Run the frontloaded destructive actions.
  - [ ] 9.1 `npm run db:reset` → last line `Local stack reset to deterministic seeded state.` This drops the Docker volume, rebuilds the images, applies the single `InitialCreate` and re-seeds. If `up --wait` fails on the `127.0.0.1:4200` bind, kill the stray `ng serve` and re-run.
  - [ ] 9.2 `npm run migration:smoke` → exit `0`, last line exactly `C38 migration smoke passed over 2 browser origins: dry run wrote nothing, unaccepted import refused, forced failure left zero partial rows, accepted import verified with C#/TypeScript canonical-hash parity, rerun idempotent, changed bundle rejected.`
  - [ ] 9.3 Empty the archive. The smoke deliberately imported 2 archive Leagues, so this must run after it: `docker compose exec -T postgres psql -U gones_migration -d gones -v ON_ERROR_STOP=1 -c "DELETE FROM league_archive_aggregates WHERE document_id <> 'placeholder-league'; DELETE FROM player_statistics; DELETE FROM player_statistics_meta;"`
  - [ ] 9.4 Confirm: `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select count(*) from league_archive_aggregates;"` → `1` (the placeholder only).
  - [ ] 9.5 Clear the browser: load `http://127.0.0.1:4200`, DevTools console, run `localStorage.clear(); indexedDB.deleteDatabase('gones-leagues');`, then Ctrl+Shift+R.
  - [ ] 9.6 Confirm in the console: `indexedDB.databases().then(d => console.log(d.map(x => x.name)))` → `gones-leagues` absent. `Object.keys(localStorage).filter(k => k.includes('archive'))` → `[]`.
- [ ] 10. Validate and commit. See `## Validation`.

## Outputs

**Files touched**

| Path | Change |
| --- | --- |
| `backend/src/Gones.Infrastructure/Persistence/Migrations/` (70 files) | deleted — 35 migrations × `.cs` + `.Designer.cs` |
| `backend/src/Gones.Infrastructure/Persistence/Migrations/<ts>_InitialCreate.cs` | new, generated then hand-extended with the four carried artifacts |
| `backend/src/Gones.Infrastructure/Persistence/Migrations/<ts>_InitialCreate.Designer.cs` | new, generated, untouched by hand |
| `backend/src/Gones.Infrastructure/Persistence/Migrations/GonesDbContextModelSnapshot.cs` | regenerated, byte-identical to the deleted one |
| `backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs` | `+1` fact, sentinel swap in the rename guard, XML doc corrected |
| `backend/tests/Gones.IntegrationTests/InitialCreateSeedTests.cs` | new, 1 fact |
| `backend/tests/Gones.IntegrationTests/OrganizationMembershipHealTests.cs` | deleted (10 facts) |
| `backend/tests/Gones.IntegrationTests/ArchiveTournamentStatusBackfillTests.cs` | deleted (4 facts) |
| `backend/tests/Gones.IntegrationTests/EventTableRenameTests.cs` | `−1` fact + its dead helpers, XML doc corrected |
| `scripts/smoke-full-stack.mjs` | line 57 allowlist → one id |
| `docs/OPERATIONS.md` | `### Membership heal migration` subsection rewritten |

**Public API / behavior change**

None. No route, no request or response shape, no status code, no domain rule, no UI. The database
schema is identical. The only observable difference is the contents of `__EFMigrationsHistory`: one
row instead of 35.

**Migrate / config**

- Migration `InitialCreate`, applied by `docker compose run --rm migrator database update`
  (`backend/src/Gones.Migrator/Program.cs:106`, `MigrateAsync()`).
- No new config key, no new environment variable, no `.env.example` change.
- Existing environment variable used by tooling only: `GONES_DB_CONNECTION` (required by
  `GonesDbContextFactory`; no default).
- Local data reset: PostgreSQL volume `postgres-data`, browser `localStorage`, IndexedDB
  `gones-leagues`. Irreversible; see the frontloaded block in `## Context`.

## Validation

- [ ] `ls backend/src/Gones.Infrastructure/Persistence/Migrations/ | wc -l` → `3`
- [ ] `ls backend/src/Gones.Infrastructure/Persistence/Migrations/` → exactly `<ts>_InitialCreate.cs`, `<ts>_InitialCreate.Designer.cs`, `GonesDbContextModelSnapshot.cs`
- [ ] `diff /tmp/gones-t1/snapshot-before.cs backend/src/Gones.Infrastructure/Persistence/Migrations/GonesDbContextModelSnapshot.cs` → exit `0`, no output
- [ ] `diff /tmp/gones-t1/schema-before.sql /tmp/gones-t1/schema-after.sql` → exit `0`, no output
- [ ] `docker compose exec -T postgres psql -U gones_migration -d gones -Atc 'select count(*) from "__EFMigrationsHistory";'` → `1`
- [ ] `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select (select count(*) from pg_trigger where tgrelid='audit_records'::regclass and not tgisinternal) || '|' || (select count(*) from pg_proc where proname='reject_audit_mutation') || '|' || (select count(*) from tournament_formats where slug='legacy') || '|' || (select count(*) from deck_archetypes) || '|' || (select count(*) from league_archive_aggregates where document_id='placeholder-league');"` → `2|1|1|49|1`
- [ ] `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select count(*) from league_archive_aggregates;"` → `1`
- [ ] `npm run backend:build` → `Build succeeded.` / `0 Error(s)`
- [ ] `npm run backend:test` → 0 failures; total = the step 1.9 baseline minus 13
- [ ] `npm run migration:smoke` → exit `0`, last line `C38 migration smoke passed over 2 browser origins: dry run wrote nothing, unaccepted import refused, forced failure left zero partial rows, accepted import verified with C#/TypeScript canonical-hash parity, rerun idempotent, changed bundle rejected.`
- [ ] `npm run db:reset` → exit `0`, last line `Local stack reset to deterministic seeded state.`
- [ ] `npm run typecheck` → exit `0`, no output (proof the fence held: this ticket cannot touch `src/`)
- [ ] `npm run test` → exit `0`, 0 failed (same proof)
- [ ] `npm run lint` → exit `0`
- [ ] Fence audit: `git diff --stat HEAD -- backend/src/Gones.Domain backend/src/Gones.Api backend/src/Gones.Application backend/src/Gones.Worker src cypress` → **empty output**. Any line here is a fence breach.
- [ ] Fence audit: `git diff --stat HEAD -- backend/src/Gones.Infrastructure | grep -v Migrations/` → **empty output**. The only Infrastructure change is the migrations folder.
- [ ] Manual check (browser): `http://127.0.0.1:4200/leagues-archive` renders the empty-list state without a console error, and the placeholder League is the only server row. An empty archive between now and T13 is expected and correct, not a bug to fix.
- [ ] Manual check (browser console): `indexedDB.databases().then(d => console.log(d.map(x => x.name)))` → no `gones-leagues`
- [ ] App functional — no broken path from this slice: sign in, load `/events`, load `/global-stats`, load `/leagues-archive`. All render. `docker compose ps` shows `api` healthy.
- [ ] commit msg draft: `chore(persistence): squash the migration history into one InitialCreate and empty the local archive`
