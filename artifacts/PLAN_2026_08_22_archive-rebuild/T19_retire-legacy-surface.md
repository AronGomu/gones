# T19: Retire the legacy archive surface and refresh the docs

> ## ⚠ ARBITRATION OVERRIDE — read before the body; these win over anything below
>
> **A. The TypeScript↔C# parity corpus is RE-POINTED, never deleted.** The body deletes
> `fixtures/league-domain/v1/` together with its emitter
> `src/app/domain/league-parity-fixtures.test.ts`, and correctly reports that this leaves cross-stack
> domain parity **unproven** with nothing rebuilding it. That is a real loss of coverage and it is
> not accepted.
>
> Instead: emit the same corpus from the new shapes into `fixtures/archive-domain/v5/parity/`, and
> re-point `backend/tests/Gones.UnitTests/LeagueParityTests.cs:172` and
> `backend/tests/Gones.IntegrationTests/LeagueArchiveRouteTests.cs:183` at it. The proof that the C#
> and TypeScript domains agree on rounds, entries, byes and standings is worth more than the deletion
> is worth. Only after the new corpus is green does the v1 directory go.
>
> **B. Endpoint operation names are noun-first** — `Archive{Tier}{Verb}`, e.g.
> `ArchiveTournamentApplyEditBatch`. When this ticket deletes the legacy endpoints, verify no new
> archive route still carries a legacy-style `{Verb}Archive{Noun}` name.
>
> **C. Three stale-prose items other writers flagged, all in this fence:**
> `ops/acceptance-matrix.json:243-247` still describes `league-local.cy.js` as a "signed-out create,
> edit, reload survival and export/import round trip"; `docs/local-dev-environments.html:90-97,120`
> still lists 7 fixture files and `POST /api/leagues-archive/restore`; and T9 deferred its
> scripts/ops/docs updates here. Fix all three.
>
> **D. Scope is large and that is expected.** 14 main steps and 97 sub-steps is correct for a
> contract step that deletes an entire parallel surface. Do not split it — a half-retired surface
> leaves two authorities live at once, which is the one state this plan must never ship.

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T17, T18, T15, T16, T11, T9
**Commit outcome:** the old `/leagues-archive/**` routes and `/api/leagues-archive/**` endpoints return `404`, every legacy archive file is deleted, `docs/CONTEXT.md` and `docs/GLOSSARY.md` carry the three-tier vocabulary, and `npm run test && npm run typecheck && npm run lint && npm run api:check && npm run backend:test && npm run e2e:ci` are all green.

## Context (self-contained)

- **Goal.** The Archive was rebuilt on three tiers — **League → LeagueSeason → Tournament**. A Tournament is now a first-class top-level record that may stand alone (`seasonId: null`). The old flat `League` became `LeagueSeason`; a new `League` tier groups Seasons. `leagues-archive` → `archive` everywhere: folders, routes, API paths, docs.
- **This slice.** This is the **contract** step of expand → migrate → contract, and the **only** ticket in the plan allowed to delete. T2–T18 added the new `/api/archive/**` surface and the new `/archive/**` pages *beside* the old ones; nothing calls the old ones any more. This ticket removes them, re-points the four surviving call sites that still reach into the legacy table, refreshes the durable docs, and rewrites the Cypress specs that still drive the retired UI.
- **Two deliberate reversals of ADR 0022, both stated as reversals.** ADR 0022 (`docs/adr/0022-rename-the-archived-league-feature.md`) governed the previous rename of this feature.
  1. **No API alias.** ADR 0022 already set this precedent verbatim: *"No API path aliases. The old routes return `404`. The only client is this repository's frontend."* That clause is **reaffirmed**, not reversed. `/api/leagues-archive/**` returns `404` with no shim.
  2. **No frontend redirects either.** ADR 0022 *did* keep frontend redirects, reasoning *"Bookmarks and old links are a real user's problem; a stale HTTP client is not."* **That rationale is void:** Gones is unreleased, has no production environment and has zero users, so there is no bookmark to protect. `/leagues`, `/leagues-archive`, `/leagues-archive/:leagueId`, `/leagues-archive/:leagueId/tournaments-archive/:tournamentId[/result[/metagames]]` are **removed** and hit the `**` 404 page. This reverses the "Frontend redirects, yes" clause of ADR 0022 and matches the precedent ADR 0038 already set for `/calendar/tournaments/:slug`.
  Both facts are written into `docs/CONTEXT.md` inline (durable docs must not link to `./artifacts/` or `./.tmp/`), and both are named in the commit body.
- **Out of scope here — do not touch:**
  - **Live Tournament business logic**, beyond the two compiler-forced references named in *Interface contract → Consumes → Live*. No pairing, standings, checkpoint, stage or finalize *semantics* change. `LiveFinalizeResponse` keeps every field name it has today, including `leagueId` — ADR 0022 froze that name on purpose ("Renaming it would ripple into the local Live adapter contract (ADR 0021) for no user-visible gain").
  - **Calendar / Event surfaces.** Nothing under `src/app/features/events/**`, `backend/src/Gones.Api/Events/**`, `backend/src/Gones.Domain/Calendar/**`, `cypress/e2e/public-calendar.cy.js`, `cypress/e2e/event-*.cy.js`, `cypress/e2e/organizer-*.cy.js`.
  - **Organization and auth surfaces.** Nothing under `backend/src/Gones.Api/{Identity,Organizations,Admin,Notifications,Security}/**` or `src/app/auth/**`.
  - **`/api/maintenance/player-names*`.** ADR 0022 explicitly excluded cross-league player-name maintenance from the archive feature and that still holds. Its **routes, request shapes, response shapes, status codes and audit action strings are unchanged**. Only its *data source* moves off the deleted table — see decision **D3**, which is a compiler-forced re-point, not a feature change.
  - **New archive behaviour.** Nothing in this ticket adds a route, a column, a sort key or a UI state. It only removes and re-points.
- **Assumptions in force** (each verified against the working tree on 2026-08-22; where the brief and the codebase disagreed, the codebase won and the disagreement is recorded here):
  - **A1 — the legacy table is `league_archive_aggregates`, not `league_aggregates`.** It was created as `league_aggregates` by `20260802204547_AddLeagueAggregates` and renamed by `20260809122735_RenameLeagueArchiveTables`. The live name is pinned at `backend/src/Gones.Infrastructure/Persistence/LeagueArchiveAggregateConfiguration.cs:12` (`builder.ToTable("league_archive_aggregates");`). Every DDL statement in this ticket uses `league_archive_aggregates`.
  - **A2 — the `placeholder-league` row is still alive when this ticket starts.** T1 could not remove it, because four call sites depend on it: (a) T1's `InitialCreate` migration re-seeds it with `migrationBuilder.InsertData`; (b) `LeagueArchiveAggregate.SoftDelete` refuses it (`backend/src/Gones.Domain/Leagues/LeagueArchiveAggregate.cs:140`, `throw new InvalidOperationException("Placeholder League cannot be deleted.")`); (c) `MigrationImportService` calls `SingleAsync` on it at `:139`, `:288` and `SingleOrDefaultAsync` at `:356`; (d) `scripts/seed-local.mjs:12-13` throws `Fixed placeholder League missing or duplicated.` when it is absent, which would break `npm run db:reset`/`npm run db:seed`. **This ticket retires it and fixes all four.**
  - **A3 — `fixtures/league-domain/v1/` is a TypeScript↔C# domain-parity corpus, not an export golden set.** It is emitted by `src/app/domain/league-parity-fixtures.test.ts` and read by `backend/tests/Gones.UnitTests/LeagueParityTests.cs:172` and `backend/tests/Gones.IntegrationTests/LeagueArchiveRouteTests.cs:183` (both via a `FindFixtureDirectory()` walk for `fixtures/league-domain/v1`). Deleting the corpus means deleting the emitter **and both readers** in the same commit, or `npm run backend:test` goes red.
  - **A4 — Live Tournaments still reach into the legacy table in two places, not one.** The brief named `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs:358-364` (`RequireLeagueReferenceAsync`). The finalize path at `:306-321` **also** reads `database.LeagueArchiveAggregates` and writes the finalized Tournament into the League document. Both must be re-pointed in this commit or the solution does not compile. See **D2**.
  - **A5 — `cypress/e2e/offline-public-read.cy.js` does not reference the archive at all.** `grep -c -i league cypress/e2e/offline-public-read.cy.js` → `0`. The brief listed it as affected; it is not. **Do not edit it.** Two specs the brief did *not* list *are* affected and are in scope: `cypress/e2e/power-user-gating.cy.js` (14 references) and `cypress/e2e/live-server.cy.js` (3 references).
  - **A6 — `npm run e2e:ci` runs more than Cypress.** `scripts/full-stack-ci.mjs:97` runs `scripts/smoke-full-stack.mjs --release` before any spec, and `:119` runs `scripts/seed-local.mjs` after all of them. Both assert on the placeholder League and on `/api/leagues-archive/**`. Both are in scope.
  - **A7 — `ops/acceptance-matrix.json` is enforced by `npm run test`.** `ops/acceptance-matrix.test.ts` calls `evaluateMatrix`, whose `vitest`/`dotnet`/`cypress` resolvers in `scripts/acceptance-matrix.mjs:73-86` fail with `file <target> does not exist` / `spec <target> is not wired into scripts/full-stack-ci.mjs`. Deleting a test file named in the matrix turns `npm run test` red unless the matrix row is re-pointed in the same commit.
  - **A8 — T9 deliberately handed two things to this ticket.** `artifacts/PLAN_2026_08_22_archive-rebuild/T9_dev-fixtures.md` states: *"No `docs/local-dev-environments.html` edit. The architecture HTML docs belong to the docs ticket that retires the legacy surface"*, and *"Do not delete the legacy seeding path. `scripts/seed-dev-environment.mjs → seedLeagues()` and the `leagues.json` fixture file stay, because `live-tournaments.json` depends on them."* Both are this ticket's work.
  - **A9 — T16 deliberately left a seam for this ticket.** `artifacts/PLAN_2026_08_22_archive-rebuild/T16_cache-invalidation-resync.md` added a `gones-archive-updated` listener **beside** the legacy `gones-league-updated` one and added a test named `keeps the legacy League listener alive` asserting the legacy listener still exists. Removing the legacy listener means removing that test case in the same commit.
  - **A10 — Gones is unreleased.** No production environment, no users, no data migration obligation. Local data may be reset freely. This is why there is no alias, no redirect and no v1–v4 import converter.

## Requirements

1. `GET /api/leagues-archive/**` and every legacy League command route return `404 Not Found`. No alias, no shim, no deprecation header.
2. `/leagues`, `/leagues-archive`, `/leagues-archive/:leagueId`, `/leagues-archive/:leagueId/tournaments-archive/:tournamentId`, `…/result` and `…/result/metagames` render the 404 page. No redirect.
3. Every file listed in *Outputs → Deleted* is gone from the working tree, and `git grep` finds none of the retired identifiers listed in *Interface contract → Invariants → I1*.
4. The `league_archive_aggregates` table is dropped by exactly **one** new EF migration named `RetireLegacyLeagueArchive`, whose `Up` drops that table and creates none.
5. The fixed `placeholder-league` row, the `PLACEHOLDER_LEAGUE_ID` / `PLACEHOLDER_LEAGUE_NAME` constants and their C# twins `LeagueNormalizer.PlaceholderLeagueId` / `.PlaceholderLeagueName` no longer exist anywhere, and none of the four call sites in **A2** references them.
6. `POST /api/live-tournaments` and `POST /api/live-tournaments/{id}/finalize` keep their current request shapes, response shapes and status codes, reading and writing `archive_league_seasons` / `archive_tournaments` instead of `league_archive_aggregates`.
7. `src/app/backend/server-authority-boundary.test.ts` no longer allowlists `src/app/backend/local-league-archive-backend.service.ts` or `src/app/features/leagues-archive/league-archive-catalog-cache.service.ts`, and both allowlists still `toEqual` a literal array that matches the real directory walk.
8. No code opens the IndexedDB database `gones-leagues`, and a browser that still holds one has it deleted once on next load.
9. The custom event `gones-league-updated` is dispatched nowhere and listened for nowhere; `gones-archive-updated` is the only archive announcement.
10. `npm run api:generate` has been run and `npm run api:check` exits `0` — the committed OpenAPI snapshot and `src/app/api/generated/gones-api.ts` contain no `leagues-archive` operation.
11. `docs/CONTEXT.md` and `docs/GLOSSARY.md` describe the three-tier archive, keep the retired words as `_Formerly_` notes so a year-old commit message still resolves, and **contain no link to anything under `./artifacts/` or `./.tmp/`** — every fact is inlined.
12. `docs/local-dev-environments.html` no longer advertises `leagues.json` or `POST /api/leagues-archive/restore`, and its fixture-file list matches `DATA_FILES` in `scripts/dev-environments.mjs`.
13. The Cypress specs that drove the retired UI are rewritten against `/archive/**`, and every spec on disk is still wired into `scripts/full-stack-ci.mjs` (guarded by `ops/e2e-spec-coverage.test.ts`).
14. All six gates are green: `npm run api:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run backend:test`, `npm run e2e:ci`.

## Inputs

Files to read before editing. Line numbers are as committed on the branch this ticket starts from; if a predecessor moved them, locate by the quoted symbol, not by the number.

**Frontend — deleted wholesale**

- `src/app/features/leagues-archive/` — 6 files: `league-archive-catalog-cache.service.ts` (+`.test.ts`), `league-archive-detail.component.ts` (+`.test.ts`), `league-archive-list.component.ts` (+`.test.ts`).
- `src/app/features/tournaments-archive/` — 3 files: `tournament-archive-detail.component.ts` (+`.test.ts`), `tournament-archive-result.component.ts`.
- `src/app/data/league-archive-*.ts` — 11 files: `league-archive-command-ux.ts` (+`.test.ts`), `league-archive-import.service.ts` (+`.test.ts`), `league-archive-origin.ts` (+`.test.ts`), `league-archive-repository.service.ts` (+`.test.ts`), `league-archive-routing.test.ts`, `league-archive-summary.ts` (+`.test.ts`).
- `src/app/backend/local-league-archive-backend.service.ts` (+`.test.ts`) — `LOCAL_LEAGUE_DB_NAME = 'gones-leagues'` at `:35`, `LeagueConcurrencyError` / `'staleLeagueDocument'` at `:41-49`.
- `src/app/domain/league-parity-fixtures.test.ts` — the parity emitter; `fixtureDirectory` resolves `../../../fixtures/league-domain/v1` at `:25`.
- `src/app/domain/placeholder-league.test.ts`, `src/app/domain/export-restore.ts` (+`.test.ts`).
- `src/app/app.component.league-catalog-cache.test.ts`.

**Frontend — edited**

- `src/app/app.routes.ts` — `archiveRedirectRoutes()` at `:63-75` (the five redirects at `:69-73`), the legacy route registrations at `:93` and `:97-100`, and the spread `...archiveRedirectRoutes(),` at `:101`.
- `src/app/app.component.ts` — imports at `:9-15` and `:25`; `HeaderTournament { league: PersistedLeague; tournament: TournamentDocument }` at `:30-33`; the toolbar branch using `[routerLink]="['/leagues-archive', item.league.id, 'tournaments-archive', item.tournament.id, 'result']"` at `:57`; `private readonly repo = inject(LeagueArchiveRepository);` at `:127`; `showHeaderImport` compared against `'/leagues-archive'` at `:150` and `:190`; the `window.addEventListener('gones-league-updated', …)` block at `:165-168`.
- `src/app/app-breadcrumbs.ts` — `import { PersistedLeague, PLACEHOLDER_LEAGUE_ID, TournamentDocument } from './domain/models';` at `:2`, and the `leagues-archive` branches below `:60`.
- `src/app/domain/models.ts` — the archive half, enumerated in *Interface contract → Produces → models.ts*.
- `src/app/domain/export-schemas.ts` — v1–v4 schema half at `:1-102`; the shared checksum/denylist half at `:104-157` **stays**.
- `src/app/domain/models.test.ts`, `src/app/domain/event-pages.test.ts` (its `it('drops legacy linked tournaments when restoring full data with regenerated IDs')` case at `:48` is the only export-restore user), `src/app/domain/export-schemas.test.ts`.
- `src/app/backend/server-authority-boundary.test.ts` — IndexedDB allowlist `toEqual` at `:105-114`, catalog-cache importer allowlist `toEqual` at `:172-181`.
- `src/app/backend/browser-local-scope.test.ts` — `expect(LOCAL_LEAGUE_DB_NAME).toBe('gones-leagues');` at `:39`, doc comment at `:11`.
- `src/app/data/archive-cache-invalidation.test.ts` — T16's `keeps the legacy League listener alive` case.
- `src/app/features/players/player-detail.component.ts` (`:11`, `:400`), `src/app/features/settings/local-player-names.ts`, `src/app/features/live-tournaments/live-tournament-list.component.ts`, `…/live-tournament-runner.component.ts`, and their tests — all import retired `models.ts` symbols.
- `src/app/i18n/messages.ts` — 2497 lines, EN block then FR block; `src/app/i18n/message-namespace.test.ts` asserts `Object.keys(en).sort()` equals `Object.keys(fr).sort()`.

**Backend — deleted**

- `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs`, `…/LeagueCommandEndpoints.cs`, `…/LeagueArchiveCatalogCountsBackfill.cs`.
- `backend/src/Gones.Domain/Leagues/LeagueArchiveAggregate.cs`.
- `backend/src/Gones.Infrastructure/Persistence/LeagueArchiveAggregateConfiguration.cs`.
- `backend/tests/Gones.UnitTests/LeagueParityTests.cs`, `backend/tests/Gones.IntegrationTests/LeagueArchiveRouteTests.cs`.

**Backend — edited**

- `backend/src/Gones.Api/Program.cs` — `builder.Services.Insert(0, ServiceDescriptor.Singleton<IHostedService, LeagueArchiveCatalogCountsBackfill>());` at `:128`, `builder.Services.AddScoped<LeagueCommandService>();` at `:120`, `app.MapPublicLeagueEndpoints();` at `:239`, `app.MapLeagueCommandEndpoints();` at `:240`.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs:48` — `public DbSet<LeagueArchiveAggregate> LeagueArchiveAggregates => Set<LeagueArchiveAggregate>();`.
- `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs` — finalize at `:306-321`, `RequireLeagueReferenceAsync` at `:358-364`.
- `backend/src/Gones.Api/Leagues/PlayerEndpoints.cs:116` and `backend/src/Gones.Api/Leagues/PlayerNameMaintenanceEndpoints.cs:116,164`.
- `backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs:32-46`.
- `backend/src/Gones.Infrastructure/MigrationImport/MigrationImportService.cs:133,138,247,286,349,354`.
- `backend/src/Gones.Migrator/Program.cs:214` — the seeded Live demo's `"placeholder-league"` leagueId.
- The `InitialCreate` migration produced by T1 — its `migrationBuilder.InsertData` for `league_archive_aggregates`.
- `backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs` — rule (a): no `Up` may both `DropTable` and `CreateTable`; plus `Committed_migrations_fully_describe_the_model`.

**Scripts, fixtures, ops, docs**

- `scripts/seed-local.mjs:12-13`, `scripts/smoke-full-stack.mjs:21-32,57`, `scripts/full-stack-ci.mjs:53-81,97,119`.
- `scripts/seed-dev-environment.mjs:361-380` (`seedLeagues()`), `scripts/dev-environments.mjs:20` (`DATA_FILES`) and `:199`.
- `fixtures/dev-environments/demo/leagues.json`, `fixtures/dev-environments/stress/leagues.json`, `fixtures/dev-environments/*/live-tournaments.json` (`leagueKey`), `fixtures/dev-environments/README.md`.
- `fixtures/league-domain/v1/manifest.json`, `fixtures/league-domain/v1/parity.json`.
- `ops/acceptance-matrix.json` (rows `doc09-archive-rename` at `:2467`, the browser-local capability at `:217-240`, and the `/api/leagues-archive` rows at `:2493-2505`), `ops/dev-environments.test.ts`, `ops/e2e-spec-coverage.test.ts`, `ops/stress-generator.test.ts`.
- `docs/CONTEXT.md` (`:27-36`, `:127`, `:305`, `:459-462`, `:515`), `docs/GLOSSARY.md` (`:19`, `:23`, `:25`, `:54-55`, `:57`), `docs/local-dev-environments.html` (`:81`, `:90-97`, `:120`), `docs/league-archive-authority.html`, `docs/offline-read-cache.html`, `docs/player-statistics-read-model.html`.
- `docs/adr/0022-rename-the-archived-league-feature.md` — read in full before writing the docs step. Its "No API path aliases" clause is reaffirmed; its "Frontend redirects, yes" clause is reversed.

**From Depends — spelled out, because the worker cannot read those tickets**

- **From T17 (`Archive staged-edit UI`)** — the staged editor now lives under `src/app/features/archive/tournament-detail.component.ts` and is driven by `POST /api/archive/tournaments/{tournamentId}/edit-batch`. `cypress/e2e/archive-staged-edit.cy.js` must be re-pointed at it; its subject is no longer `src/app/features/tournaments-archive/tournament-archive-detail.component.ts`.
- **From T18 (`Browser-local archive union`)** — browser-local authored archive records live in IndexedDB database `gones-archive-local` (`LOCAL_ARCHIVE_DB_NAME`, version `1`, stores `leagues`, `league-seasons`, `tournaments`), written by `src/app/backend/local-archive-backend.service.ts`, and are unioned into both archive tabs. Records whose id starts with `local-` are browser-local and are **never** locked. `cypress/e2e/league-local.cy.js` must assert against `gones-archive-local`, never `gones-leagues`.
- **From T15 (`Rankings scope filter`)** — `/global-stats` takes `?league=<id|all>&season=<id|all>&sort=&dir=&page=&size=&search=`. The URL sort-direction parameter is `dir` on **every** archive surface including `/global-stats`; the **wire** query parameter sent to the API is still `direction`. The catalog twin is `GET /api/archive/global-player-statistics/all?scopeKind=&scopeId=`.
- **From T16 (`Cache invalidation and resync`)** — `src/app/data/archive-repository.service.ts` exports `ARCHIVE_UPDATED_EVENT` (value `'gones-archive-updated'`) and `async invalidateArchiveCaches(): Promise<void>`. `src/app/app.component.ts` already listens with `window.addEventListener(ARCHIVE_UPDATED_EVENT, …)`. `src/app/data/archive-cache-invalidation.test.ts` contains a case named `keeps the legacy League listener alive` that asserts `src/app/app.component.ts` still contains the string `window.addEventListener('gones-league-updated'` — **that case is deleted by this ticket.**
- **From T11 (`Export v5`)** — `src/app/domain/archive-export-schemas.ts` and `src/app/data/archive-import.service.ts` own the v5 bundle. `ARCHIVE_DATA_VERSION = 5`, `SUPPORTED_ARCHIVE_IMPORT_VERSIONS = [5]`. A v1–v4 bundle is refused with a clear message and there is no converter. The v5 bundle shape is four flat collections:
  ```json
  { "version": 5, "leagues": [], "leagueSeasons": [], "tournaments": [], "calendarEvents": [] }
  ```
  `src/app/domain/export-schemas.ts` still owns the version-agnostic helpers `EXPORT_LIMITS`, `PUBLIC_EXPORT_DENYLIST_FIELDS`, `assertNoDeniedFields`, `canonicalJsonStringify`, `sha256Hex`, `attachExportChecksum`, `verifyExportChecksum`, and `archive-export-schemas.ts` imports them from there.
- **From T9 (`Dev fixtures`)** — every dev environment carries `archive-leagues.json`, `archive-league-seasons.json`, `archive-tournaments.json`; `scripts/dev-environments.mjs` exports `ARCHIVE_DATA_FILES = ['archiveLeagues', 'archiveLeagueSeasons', 'archiveTournaments']` and `buildArchiveBundle(environment)`; `scripts/seed-dev-environment.mjs` has `async function seedArchive(...)` posting one `POST /api/archive/restore-full` as the environment's `Admin`. The legacy `seedLeagues()` and `leagues.json` were deliberately left alive for Live's sake and are **this ticket's** to remove.

## Interface contract (level 5)

### Produces — SQL / migration

Exactly one new migration, name **`RetireLegacyLeagueArchive`**, scaffolded with:

```
export GONES_DB_CONNECTION='Host=127.0.0.1;Port=5433;Database=gones;Username=gones_migration;Password=local-migration-only'
dotnet ef migrations add RetireLegacyLeagueArchive \
  --project backend/src/Gones.Infrastructure \
  --startup-project backend/src/Gones.Infrastructure
```

Its `Up` must contain exactly one destructive statement and **no** `CreateTable` (`MigrationSafetyTests.No_migration_renames_a_table_by_dropping_and_recreating_it` fails otherwise):

```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    migrationBuilder.DropTable(name: "league_archive_aggregates");
}
```

`Down` stays exactly as EF scaffolds it (it re-creates the table; `Down` is never executed and rule (a) is scoped to `Up`).

Effective DDL:

```sql
DROP TABLE league_archive_aggregates;
-- with it: pk_league_archive_aggregates, ix_league_archive_aggregates_document_id,
-- ix_league_archive_aggregates_name, ix_league_archive_aggregates_status,
-- ix_league_archive_aggregates_version, ix_league_archive_aggregates_counts_version,
-- ix_league_archive_aggregates_deleted_at_updated_at_id,
-- ck_league_aggregate_status, ck_league_aggregate_document_object,
-- ck_league_aggregate_document_size, ck_league_aggregate_document_metadata,
-- and the fixed row document_id = 'placeholder-league'.
```

The `InitialCreate` migration keeps its `migrationBuilder.InsertData` for `league_archive_aggregates` **unchanged** — it is history, and on a fresh database the insert lands and is then dropped two migrations later. Do **not** edit a committed migration; the retirement is the new migration's job.

`scripts/smoke-full-stack.mjs`'s `expectedMigrations` array gains the generated id, appended last:

```js
const expectedMigrations = ['<ts>_InitialCreate', '<ts>_RebuildArchiveThreeTier', '<ts>_ScopePlayerStatistics', '<ts>_RetireLegacyLeagueArchive'];
```

### Produces — `src/app/domain/models.ts`

Delete exactly these exported symbols and their private helpers, and nothing else:

```ts
export const GONES_DATA_VERSION = 4;                       // :2
export const SUPPORTED_IMPORT_DATA_VERSIONS = [1,2,3,4];   // :3
export const PLACEHOLDER_LEAGUE_ID = 'placeholder-league'; // :4
export const PLACEHOLDER_LEAGUE_NAME = 'Unassigned Tournaments'; // :6
const UNASSIGNED_LEAGUE_DISPLAY_NAMES = [...];             // :8-11
export function isPlaceholderLeagueId(...): boolean;       // :13-15
export function normalizeLeagueNameKey(name: string): string; // :17-23
export function isUnassignedLeagueName(name: string): boolean; // :25-30
export interface GonesData { ... }                          // :32-36
export interface LeagueDocument { ... tournaments: TournamentDocument[] } // :54-59
export interface PersistedLeague extends LeagueDocument { ... }           // :61-65
export interface TournamentDocument { ... leagueId: string ... }          // :67-75
type TournamentInput = ...; type LeagueInput = ...;         // :124-125
export function createGonesData(...): GonesData;            // :154-156
export function createLeague(...): LeagueDocument;          // :198-218
export function createPlaceholderLeague(): LeagueDocument;  // :220-222
export function normalizeLeague(...): LeagueDocument;       // :224-226
export function createTournament(...): TournamentDocument;  // :228-242
```

Everything else in `models.ts` **stays**, because `src/app/domain/archive-models.ts` re-exports it (`export type { LeagueStatus, RoundDocument, RoundEntry, MatchRoundEntry, ByeRoundEntry, InvalidRoundEntry, PlayerArchetypeDocument, CalendarEventDocument } from './models';`) and the Calendar and Live features use the rest:

```
LeagueStatus, CalendarEventDocument, PlayerArchetypeDocument, RoundDocument, RoundEntry,
MatchRoundEntry, ByeRoundEntry, InvalidRoundEntry, IdFactory, RoundInput, RoundEntryInput,
createIdFactory, defaultIdFactory, trimPlayerName, normalizeLeagueStatus, normalizeTournamentStatus,
createCalendarEvent, normalizeCalendarEvent, normalizeCalendarEvents, createRound, createRoundEntry,
createMatchRoundEntry, createByeRoundEntry, createInvalidRoundEntry, getDefaultTournamentName,
normalizeDeckArchetype, formatPlayerWithArchetype, normalizeSlug
```

Disposition rule for the four private helpers `withDefaultTable`, `normalizePlayerArchetypeDocuments`, `derivePlayerArchetypesFromRoundDocuments` and `addDerivedArchetype`, decided here so the worker never guesses: after `createTournament` is deleted, run `grep -n "normalizePlayerArchetypeDocuments\|derivePlayerArchetypesFromRoundDocuments\|withDefaultTable\|addDerivedArchetype" -r src/`.
- Zero remaining references → delete the helper.
- Referenced only from inside `models.ts` → keep it private.
- Referenced from `src/app/domain/archive-models.ts` → add `export` to it in `models.ts`; do not copy it.

### Produces — `src/app/domain/export-schemas.ts`

Delete only the v1–v4 half:

```ts
export type SupportedExportVersion = 1 | 2 | 3 | 4;
export const PUBLIC_EXPORT_V4_LEAGUE_FIELDS = [...];
interface ExportJsonSchema { ... }
const versionConst = ...; function kindTaggedSchema(...) { ... }
const leagueSchema = { ... }; const calendarEventSchema = { ... };
export const EXPORT_JSON_SCHEMAS: Record<SupportedExportVersion, ExportJsonSchema> = { 1: …, 4: … };
```

Keep, byte for byte:

```ts
export const PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS: readonly string[];
export const PUBLIC_EXPORT_DENYLIST_FIELDS: readonly string[];
export const EXPORT_LIMITS: { maxImportFileBytes; maxFullDataLeagues; maxCalendarEvents; maxMigrationBundleBytes; maxLiveTournaments; maxDeckArchetypes };
export function assertNoDeniedFields(value: unknown): void;   // throws Error(`deniedExportField:${key}`)
export function canonicalJsonStringify(value: unknown): string;
export async function sha256Hex(text: string): Promise<string>;
export async function attachExportChecksum<T extends object>(file: T): Promise<T & { checksum: string }>;
export async function verifyExportChecksum(file: unknown): Promise<boolean>;
```

Update the file's header comment from `Versioned contracts for Gones export artifacts (data versions 1–4).` to `Version-agnostic export helpers: public denylist, size limits and the artifact checksum. The versioned bundle schema lives in ./archive-export-schemas.ts (v5).`

### Produces — `src/app/app.routes.ts`

Remove the whole `archiveRedirectRoutes()` function (`:63-75`), the `...archiveRedirectRoutes(),` spread (`:101`) and these five entries from `buildRoutes` (`:93`, `:97-100`):

```ts
{ path: 'leagues-archive', loadComponent: () => import('./features/leagues-archive/league-archive-list.component').then((m) => m.LeagueArchiveListComponent) },
{ path: 'leagues-archive/:leagueId', loadComponent: () => import('./features/leagues-archive/league-archive-detail.component').then((m) => m.LeagueArchiveDetailComponent) },
{ path: 'leagues-archive/:leagueId/tournaments-archive/:tournamentId', loadComponent: () => import('./features/tournaments-archive/tournament-archive-detail.component').then((m) => m.TournamentArchiveDetailComponent) },
{ path: 'leagues-archive/:leagueId/tournaments-archive/:tournamentId/result', loadComponent: () => import('./features/tournaments-archive/tournament-archive-result.component').then((m) => m.TournamentArchiveResultComponent) },
{ path: 'leagues-archive/:leagueId/tournaments-archive/:tournamentId/result/metagames', loadComponent: () => import('./features/tournaments-archive/tournament-archive-result.component').then((m) => m.TournamentArchiveResultComponent) }
```

Replace the doc comment at `:58-62` with:

```ts
/**
 * The archive is served from `/archive/**` on three tiers (League → LeagueSeason → Tournament).
 * `/leagues`, `/leagues-archive` and `/leagues-archive/:leagueId/tournaments-archive/:tournamentId`
 * are removed with no redirect alias — stale bookmarks hit the 404 page. ADR 0022 kept redirects
 * because "Bookmarks and old links are a real user's problem"; Gones is unreleased with zero users,
 * so that rationale is void. Its "No API path aliases" clause still stands.
 */
```

The surviving archive route table (registered by T13/T14, unchanged by this ticket):

```
/archive                                              → redirect to /archive/league-seasons
/archive/league-seasons?sort=&dir=&page=&size=&search=&league=
/archive/league-seasons/:seasonId
/archive/tournaments?sort=&dir=&page=&size=&search=&year=&season=
/archive/tournaments/:tournamentId
/archive/tournaments/:tournamentId/result
/archive/tournaments/:tournamentId/result/metagames
/global-stats?league=<id|all>&season=<id|all>&sort=&dir=&page=&size=&search=
```

### Produces — one-shot browser database purge

New export in `src/app/backend/local-archive-backend.service.ts` (T10's file, already on the IndexedDB allowlist so no allowlist change is needed):

```ts
/**
 * Deletes the retired `gones-leagues` database (ADR 0028's first browser-local store) once per page
 * load. Gones is unreleased, so this exists only so a developer's browser does not keep a dead store
 * forever. Best-effort and non-blocking: a browser that blocks the delete (another tab still has the
 * database open) is left alone and retried on the next load.
 */
export function purgeRetiredLeagueDatabase(): void;
```

Contract: idempotent; never throws; never rejects; returns `void` synchronously. Implementation shape — `if (typeof indexedDB === 'undefined') return; try { indexedDB.deleteDatabase('gones-leagues'); } catch { /* a blocked delete is retried next load */ }`. Called exactly once, from the `AppComponent` constructor in `src/app/app.component.ts`, as the first statement.

### Produces — retired-surface guard tests

New file `src/app/shared/retired-archive-surface.test.ts`. This is the durable proof that requirement 3 stays true; it is written **first** (TDD red) and must survive the commit.

```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = join(sourceRoot, '..');

function textFiles(directory = sourceRoot): string[] { /* recursive walk, *.ts only */ }
function filesMatching(pattern: RegExp): string[] { /* like server-authority-boundary.test.ts:32-37 */ }

const RETIRED_IDENTIFIERS = [
  /\bleagues-archive\b/, /\btournaments-archive\b/, /\bLeagueArchiveRepository\b/,
  /\bLocalLeagueArchiveBackend\b/, /\bLeagueConcurrencyError\b/, /\bstaleLeagueDocument\b/,
  /\bPLACEHOLDER_LEAGUE_ID\b/, /\bPLACEHOLDER_LEAGUE_NAME\b/, /\bisPlaceholderLeagueId\b/,
  /\bisUnassignedLeagueName\b/, /\bGONES_DATA_VERSION\b/, /\bSUPPORTED_IMPORT_DATA_VERSIONS\b/,
  /\bgones-league-updated\b/, /\bgones-leagues\b/, /\bcreatePlaceholderLeague\b/,
  /\bLeagueDocument\b/, /\bPersistedLeague\b/, /\bTournamentDocument\b/, /\bGonesData\b/
];

describe('retired legacy archive surface', () => {
  it('names no retired archive identifier anywhere under src/', () => {
    for (const pattern of RETIRED_IDENTIFIERS) {
      expect(filesMatching(pattern), String(pattern)).toEqual([]);
    }
  });

  it('ships no legacy archive feature folder', () => {
    expect(existsSync(join(sourceRoot, 'app', 'features', 'leagues-archive'))).toBe(false);
    expect(existsSync(join(sourceRoot, 'app', 'features', 'tournaments-archive'))).toBe(false);
  });

  it('ships no legacy archive data or backend module', () => {
    expect(readdirSync(join(sourceRoot, 'app', 'data')).filter((n) => n.startsWith('league-archive-'))).toEqual([]);
    expect(existsSync(join(sourceRoot, 'app', 'backend', 'local-league-archive-backend.service.ts'))).toBe(false);
  });

  it('ships no retired parity corpus and no emitter for one', () => {
    expect(existsSync(join(repoRoot, 'fixtures', 'league-domain'))).toBe(false);
    expect(existsSync(join(sourceRoot, 'app', 'domain', 'league-parity-fixtures.test.ts'))).toBe(false);
  });

  it('registers no legacy archive route and no redirect onto one', () => {
    const routes = readFileSync(join(sourceRoot, 'app', 'app.routes.ts'), 'utf8');
    expect(routes).not.toMatch(/leagues-archive|tournaments-archive|archiveRedirectRoutes/);
    expect(routes).toContain("path: 'archive'");
  });

  // Guards against the exact scan-nothing failure the walk can hide.
  it('finds files to scan, so an empty walk can never read as green', () => {
    expect(textFiles().length).toBeGreaterThan(100);
  });
});
```

New file `backend/tests/Gones.ArchitectureTests/RetiredLeagueArchiveSurfaceTests.cs`:

```csharp
namespace Gones.ArchitectureTests;

/// <summary>
/// The legacy League Archive aggregate, its endpoints and its table are retired (T19). This scan is
/// the standing proof: a re-introduced reference fails here rather than at the next migration.
/// </summary>
public sealed class RetiredLeagueArchiveSurfaceTests
{
    private static readonly string[] RetiredIdentifiers =
    [
        "LeagueArchiveAggregate", "LeagueArchiveAggregates", "league_archive_aggregates",
        "league_aggregates", "PlaceholderLeagueId", "PlaceholderLeagueName",
        "MapPublicLeagueEndpoints", "MapLeagueCommandEndpoints", "LeagueArchiveCatalogCountsBackfill",
        "api/leagues-archive"
    ];

    [Fact] public void No_source_file_outside_the_migration_history_names_a_retired_identifier() { /* walk backend/src + backend/tests for *.cs, skipping obj/ and Persistence/Migrations/, assert none contains any RetiredIdentifiers entry; assert the walk found > 100 files */ }

    [Fact] public void Exactly_one_migration_drops_the_legacy_archive_table() { /* exactly one committed migration whose Up contains DropTable(name: "league_archive_aggregates"), and its file name ends with _RetireLegacyLeagueArchive.cs */ }
}
```

### Consumes — the new archive persistence (from T2), used verbatim

```csharp
// namespace Gones.Domain.Archive
public sealed class ArchiveLeague      { string DocumentId; string Name; Instant CreatedAt; Instant UpdatedAt; int Version; Instant? DeletedAt; }
public sealed class ArchiveLeagueSeason{ string DocumentId; string LeagueId; string Name; string Status; Instant UpdatedAt; int Version; Instant? DeletedAt; int TournamentCount; int PlayerCount; LocalDate? FirstTournamentDate; LocalDate? LastTournamentDate; int CountsVersion; }
public sealed class ArchiveTournament  { string DocumentId; string? SeasonId; string Name; LocalDate TournamentDate; string Status; string Document; Instant UpdatedAt; int Version; Instant? DeletedAt; int PlayerCount; int CountsVersion; }
```

```csharp
// backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs
public DbSet<ArchiveLeague> ArchiveLeagues => Set<ArchiveLeague>();
public DbSet<ArchiveLeagueSeason> ArchiveLeagueSeasons => Set<ArchiveLeagueSeason>();
public DbSet<ArchiveTournament> ArchiveTournaments => Set<ArchiveTournament>();
```

Tables: `archive_leagues`, `archive_league_seasons`, `archive_tournaments`. Archive rows do **not** derive `VersionedEntity`: `version` is an `int` mapped `.IsConcurrencyToken()` and every write increments it **explicitly**, because `GonesDbContext.IncrementVersions` only auto-bumps `VersionedEntity`.

### Consumes — Live, the two compiler-forced re-points

**(1) `RequireLeagueReferenceAsync`** — `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs:358-364`. Replace the body only. Signature, thrown exception, validation field name and message string are unchanged:

```csharp
public async Task RequireLeagueReferenceAsync(string? leagueId, CancellationToken cancellationToken)
{
    if (string.IsNullOrEmpty(leagueId)) return;
    var exists = await database.ArchiveLeagueSeasons.AsNoTracking()
        .AnyAsync(item => item.DocumentId == leagueId && item.DeletedAt == null, cancellationToken);
    if (!exists) throw Validation("leagueId", "League was not found.");
}
```

Wire contract unchanged: `POST /api/live-tournaments` with an unknown `leagueId` → `400`, problem-details `code = "validation_failed"`, field `leagueId`, message `League was not found.`

**(2) Finalize** — `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs:306-321`. The finalized Tournament used to be appended to a `LeagueDocument.Tournaments` array; it now becomes its own `archive_tournaments` row whose `season_id` is the Live tournament's `leagueId`, or `NULL` when the Live tournament named no League (that empty-string case is exactly what `placeholder-league` used to absorb). Replace lines `306-321` with:

```csharp
var seasonId = document.LeagueId.Length > 0 ? document.LeagueId : null;
if (seasonId is not null && !await database.ArchiveLeagueSeasons.AsNoTracking()
        .AnyAsync(item => item.DocumentId == seasonId && item.DeletedAt == null, cancellationToken))
    throw Validation("leagueId", "Target League was not found.");

var now = clock.GetCurrentInstant();
var nowIso = JsIsoPattern.Format(now);
var stable = document with
{
    LeagueId = document.LeagueId,
    FinalizedTournamentId = document.FinalizedTournamentId ?? NewId()
};
var finalized = LiveRules.Finalize(stable, LiveRules.DefaultIdFactory, DefaultTournamentName(now));
var archived = await ArchiveTournamentWriter.UpsertFromLiveAsync(database, finalized, seasonId, now, cancellationToken);
```

and the response tail (lines `330-337`) to:

```csharp
return new LiveFinalizeResponse(
    live.DocumentId,
    "completed",
    document.LeagueId,          // unchanged field name and value semantics (ADR 0022)
    stable.FinalizedTournamentId!,
    live.Version,
    StrongETag.Encode(live.Version),
    archived.Version,
    StrongETag.Encode(archived.Version));
```

The two audit rows keep their action strings; the second one's `EntityType` changes from `"league"` to `"archive-tournament"` and its `EntityId` from the League id to `archived.DocumentId`:

```csharp
AddAudit(actorId, "live.finalized", "live-tournament", live.DocumentId, ["stage", "finalizedTournamentId", "leagueId", "deletedAt"]);
AddAudit(actorId, "league.tournament.finalized", "archive-tournament", archived.DocumentId, ["document"]);
```

`ArchiveTournamentWriter.UpsertFromLiveAsync` is **not** new code to design: use whichever helper T4 already exposes for creating an `archive_tournaments` row inside a caller-owned transaction (it recomputes the Season's denormalized `tournament_count`, `player_count`, `first_tournament_date`, `last_tournament_date` and `counts_version` in the same transaction, and increments `version` explicitly). If T4 exposes it under a different name, use that name; do not write a second writer. Signature required by this call site:

```csharp
static Task<ArchiveTournament> UpsertFromLiveAsync(GonesDbContext database, TournamentDocumentShape finalized, string? seasonId, Instant now, CancellationToken cancellationToken);
```

**Invariant:** the finalize path never creates, renames or resurrects a League or a Season. A Live tournament with no `leagueId` finalizes to a **standalone** Archive Tournament (`season_id IS NULL`), which is precisely the capability `seasonId: null` was introduced for.

### Consumes — the three other forced re-points

**(3) `PlayerEndpoints.BuildHistoryAsync`** — `backend/src/Gones.Api/Leagues/PlayerEndpoints.cs:113-135`. Route, response shape and ordering are unchanged; only the scan source moves. Replace the `database.LeagueArchiveAggregates` enumeration with:

```csharp
var tournaments = database.ArchiveTournaments.AsNoTracking()
    .Where(row => row.DeletedAt == null && row.Status == "completed")
    .OrderBy(row => row.DocumentId)
    .AsAsyncEnumerable();
```

and drop the now-vacuous inner `foreach (var tournament in league.Tournaments)` plus its `if (tournament.Status != "completed") continue;` guard (the `Where` above replaces it). `ToRow(entry, league, tournament, roundIndex, playerName)` loses its `league` argument; where it previously produced a League name for the row, use the Season name resolved through `row.SeasonId`, or the empty string when `SeasonId is null` (a standalone Tournament belongs to no League — §9's Tab 2 rule, "League name, **empty when standalone**"). Also update the XML doc comment at `:108-112` to say "across every non-deleted Archive Tournament" instead of "across every non-deleted League".

**(4) `PlayerNameMaintenanceService`** — `backend/src/Gones.Api/Leagues/PlayerNameMaintenanceEndpoints.cs`. **Routes, request bodies, response records, status codes and the audit action `maintenance.player_name.renamed` are unchanged** (ADR 0022 excluded this surface from the archive feature, and that exclusion holds). Three mechanical substitutions:
- `:116-118` — `FromSqlRaw("SELECT * FROM league_archive_aggregates WHERE deleted_at IS NULL ORDER BY document_id FOR UPDATE")` on `database.LeagueArchiveAggregates` becomes `FromSqlRaw("SELECT * FROM archive_tournaments WHERE deleted_at IS NULL ORDER BY document_id FOR UPDATE")` on `database.ArchiveTournaments`.
- `:164-168` — `ActiveAggregatesAsync` returns `IReadOnlyList<ArchiveTournament>` from `database.ArchiveTournaments`.
- Every `aggregate.ReadDocument()` / `aggregate.Apply(document, now)` pair becomes the equivalent read/write on the `ArchiveTournament.Document` jsonb column, with `Version` incremented explicitly. `LeaguePlayerNameMaintenance.EnumeratePlayerNameSlots` / `.CountExactOccurrences` / `.RenamePlayerExact` keep operating on the same round/entry shapes; if they are typed against the deleted `LeagueDocument`, re-type them against the archive tournament document record T2 produced.
- `PlayerRenameLeagueImpact` / `PlayerRenameLeagueResult` keep their record names and field names — they are on the wire.

**(5) `MigrationImportService`** — `backend/src/Gones.Infrastructure/MigrationImport/MigrationImportService.cs`. The one-way legacy-browser import door (ADR 0020) has no placeholder League to merge into any more. At `:133`, `:138-141`, `:247`, `:284-291`, `:349`, `:354-356`: replace every `database.LeagueArchiveAggregates` read/write with the archive tables, and replace the `SingleAsync(… PlaceholderLeagueId …)` lookups with the standalone-Tournament path — Tournaments that previously merged into `placeholder-league` are now imported with `season_id = NULL`. The `MigrationPlan.PlaceholderLeagueTarget` / `.TournamentsForPlaceholderTarget` fields and the `missingPlaceholderTarget` / `invalidPlaceholderTarget` report issues in `backend/src/Gones.Application/Migration/MigrationPlanner.cs:261-322` become dead: delete them together with the `placeholderLeagueTarget` key in `MigrationMapping`, and delete the `TournamentsMergedIntoPlaceholderTarget` counter from `MigrationReport.cs:28,69,113`. `npm run migration:smoke` must still pass.

### Consumes — the frontend event contract (from T16)

```ts
// src/app/data/archive-repository.service.ts
export const ARCHIVE_UPDATED_EVENT = 'gones-archive-updated';
async invalidateArchiveCaches(): Promise<void>;   // clears the gones-archive-cache stores, then
                                                  // window.dispatchEvent(new CustomEvent(ARCHIVE_UPDATED_EVENT))
```

`gones-league-updated` is removed with its three dispatch sites (deleted with their components) and its one listener at `src/app/app.component.ts:165`. `clearLeagueCatalogCache()` / `LEAGUE_CATALOG_CACHE_KEY` go with `src/app/features/leagues-archive/league-archive-catalog-cache.service.ts`.

### Errors

| Surface | Condition | Result |
| --- | --- | --- |
| `GET/POST/PATCH/DELETE /api/leagues-archive/**` | any request | `404`, ASP.NET's default not-found; no problem-details body, no `code`, no deprecation header |
| `/leagues`, `/leagues-archive`, `/leagues-archive/:id`, `/leagues-archive/:id/tournaments-archive/:tid[/result[/metagames]]` | any navigation | the `**` route renders `NotFoundComponent` (`src/app/shared/not-found.component.ts`); no redirect, no query-parameter preservation |
| `POST /api/live-tournaments` with unknown `leagueId` | Season absent or soft-deleted | `400`, `code = "validation_failed"`, field `leagueId`, message `League was not found.` — unchanged |
| `POST /api/live-tournaments/{id}/finalize` with unknown `leagueId` | Season absent or soft-deleted | `400`, `code = "validation_failed"`, field `leagueId`, message `Target League was not found.` — unchanged |
| `POST /api/live-tournaments/{id}/finalize` with empty `leagueId` | — | `201`; a standalone Archive Tournament (`season_id IS NULL`) is created. Previously it was absorbed by `placeholder-league`. |
| `scripts/seed-local.mjs` | `archive_leagues` seed row missing | `throw new Error('Fixed archive seed missing or duplicated.')` |
| `npm run api:check` | generated client differs from the OpenAPI snapshot | non-zero exit; run `npm run api:generate` and commit both |

### Invariants

- **I1 — retired identifiers.** After this ticket, `git grep -nE "leagues-archive|tournaments-archive|league_archive_aggregates|LeagueArchiveAggregate|LocalLeagueArchiveBackend|LeagueArchiveRepository|PLACEHOLDER_LEAGUE_(ID|NAME)|PlaceholderLeague(Id|Name)|isUnassignedLeagueName|gones-league-updated|gones-leagues|GONES_DATA_VERSION|SUPPORTED_IMPORT_DATA_VERSIONS"` returns matches **only** inside `backend/src/Gones.Infrastructure/Persistence/Migrations/` (committed history is immutable), inside `docs/adr/*.md` (an ADR records what was true when it was accepted and is never rewritten), and inside `docs/CONTEXT.md` / `docs/GLOSSARY.md` `_Formerly_` notes.
- **I2 — one migration, one drop.** Exactly one committed migration file name ends `_RetireLegacyLeagueArchive.cs`; its `Up` contains exactly one `DropTable` and zero `CreateTable`.
- **I3 — allowlists stay literal.** Both `toEqual([...])` assertions in `src/app/backend/server-authority-boundary.test.ts` compare against a real recursive directory walk. Removing an entry that still exists, or leaving an entry for a deleted file, turns the suite red. After this ticket the IndexedDB allowlist is exactly, in this order (the array is `.sort()`ed by path):
  ```ts
  [
    'src/app/backend/archive-backfill-queue.ts',
    'src/app/backend/archive-cache.service.ts',
    'src/app/backend/indexed-db.ts',
    'src/app/backend/local-archive-backend.service.ts',
    'src/app/backend/local-live-backend.service.ts',
    'src/app/backend/server-read-cache.service.ts'
  ]
  ```
  and the `shared/catalog-cache` importer allowlist is exactly:
  ```ts
  [
    'src/app/backend/archive-cache.service.ts',
    'src/app/features/events/event-catalog-cache.service.ts',
    'src/app/features/players/global-stats-catalog-cache.service.ts',
    'src/app/features/players/player-detail-cache.service.ts'
  ]
  ```
  Verify the literal against the walk rather than trusting this list: `npx vitest run src/app/backend/server-authority-boundary.test.ts`.
- **I4 — i18n catalogues stay in lockstep.** `src/app/i18n/message-namespace.test.ts` asserts `Object.keys(en).sort()` equals `Object.keys(fr).sort()`. Any key removed from the EN block must be removed from the FR block in the same edit.
- **I5 — every Cypress spec on disk is wired.** `ops/e2e-spec-coverage.test.ts` asserts the set of `cypress/e2e/*.cy.js` equals the set of paths in the `const specs = [...]` array of `scripts/full-stack-ci.mjs`. Deleting or adding a spec means editing that array.
- **I6 — the acceptance matrix resolves.** Every `vitest` / `dotnet` / `cypress` evidence target in `ops/acceptance-matrix.json` must exist on disk, and a `cypress` target must additionally appear in `scripts/full-stack-ci.mjs`.
- **I7 — no durable doc links to a working file.** `docs/CONTEXT.md` and `docs/GLOSSARY.md` must contain zero occurrences of `./artifacts/` and `./.tmp/`. Inline the fact instead.
- **I8 — idempotency.** `purgeRetiredLeagueDatabase()` may run on every page load forever; the second and later calls are no-ops and never throw.
- **I9 — no behaviour is added.** `git diff --stat` for this commit is dominated by deletions. Any *new* archive capability found in the diff is out of fence.

## TDD

1. **Red.** Write the two guard suites first and watch them fail against the pre-deletion tree:
   - `src/app/shared/retired-archive-surface.test.ts` — 6 cases, listed in *Test plan*. All fail except the scan-nothing sentinel.
   - `backend/tests/Gones.ArchitectureTests/RetiredLeagueArchiveSurfaceTests.cs` — 2 cases. Both fail.
   Run `npx vitest run src/app/shared/retired-archive-surface.test.ts` → red; `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~RetiredLeagueArchiveSurfaceTests` → red. **Record the failure output before touching anything else.**
2. **Green.** Execute *Impl steps* 2–13. The two guard suites go green only after step 11; every other gate is brought back green as it breaks.
3. **Refactor.** None planned. If a re-point in step 7 grows a second copy of an archive-write helper, collapse it onto T4's existing writer instead of keeping both — that is the only refactor this ticket sanctions.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| `retired legacy archive surface › names no retired archive identifier anywhere under src/` | recursive walk of `src/**/*.ts` | `filesMatching(pattern)` is `[]` for all 19 patterns |
| `retired legacy archive surface › ships no legacy archive feature folder` | filesystem | `src/app/features/leagues-archive` and `…/tournaments-archive` do not exist |
| `retired legacy archive surface › ships no legacy archive data or backend module` | `readdirSync('src/app/data')` | no entry starts with `league-archive-`; `local-league-archive-backend.service.ts` absent |
| `retired legacy archive surface › ships no retired parity corpus and no emitter for one` | filesystem | `fixtures/league-domain` absent; `src/app/domain/league-parity-fixtures.test.ts` absent |
| `retired legacy archive surface › registers no legacy archive route and no redirect onto one` | `src/app/app.routes.ts` source | does not match `/leagues-archive\|tournaments-archive\|archiveRedirectRoutes/`; contains `path: 'archive'` |
| `retired legacy archive surface › finds files to scan, so an empty walk can never read as green` | walk | `> 100` files |
| `RetiredLeagueArchiveSurfaceTests.No_source_file_outside_the_migration_history_names_a_retired_identifier` | `backend/src` + `backend/tests` `*.cs`, skipping `obj/` and `Persistence/Migrations/` | zero hits for all 10 identifiers; `> 100` files scanned |
| `RetiredLeagueArchiveSurfaceTests.Exactly_one_migration_drops_the_legacy_archive_table` | `Persistence/Migrations/*.cs` | exactly one `Up` contains `DropTable(name: "league_archive_aggregates")`, in a file ending `_RetireLegacyLeagueArchive.cs` |
| `server adapter surface › confines IndexedDB to the sanctioned local adapters` (existing, edited) | walk | equals the six-entry array in **I3** |
| `server adapter surface › keeps the public catalog cache helper to its declared importers` (existing, edited) | walk | equals the four-entry array in **I3** |
| `browser-local scope › names the archive database` (existing, edited in `browser-local-scope.test.ts`) | `LOCAL_ARCHIVE_DB_NAME` | `'gones-archive-local'`; no assertion mentions `gones-leagues` |
| `archive cache invalidation › the app shell listens for the archive announcement` (existing, kept) | `src/app/app.component.ts` source | contains `window.addEventListener(ARCHIVE_UPDATED_EVENT` |
| `archive cache invalidation › keeps the legacy League listener alive` (existing, **deleted**) | — | the case no longer exists |
| `message namespace › en and fr have identical key sets` (existing) | `catalogs.en` / `catalogs.fr` | identical sorted key arrays after the i18n prune |
| `e2e spec coverage › runs every spec that exists on disk` (existing) | `cypress/e2e/` vs `scripts/full-stack-ci.mjs` | identical sorted arrays |
| `V1 acceptance matrix › resolves every non-deferred row to evidence that actually runs` (existing) | `ops/acceptance-matrix.json` | `result.errors` is `[]` |
| `MigrationSafetyTests.No_migration_renames_a_table_by_dropping_and_recreating_it` (existing) | new migration | passes — `Up` drops only |
| `MigrationSafetyTests.Committed_migrations_fully_describe_the_model` (existing) | model vs snapshot | `HasPendingModelChanges()` is `false` after the DbSet removal + migration |
| `LiveCommandApiTests` (existing, edited) | `POST /api/live-tournaments` with `leagueId` of a seeded `archive_league_seasons` row | `201`; with an unknown id → `400` / `validation_failed` / `leagueId` |
| `LiveCommandApiTests` — new case `Finalize_without_a_league_creates_a_standalone_archive_tournament` | Live tournament with `leagueId: ""`, stage `standings` | `200`; one new `archive_tournaments` row with `season_id IS NULL`; `LiveFinalizeResponse.leagueId` is `""` |
| `PlayerNameMaintenanceApiTests` (existing, edited) | seeded `archive_tournaments` rows | preview and commit responses byte-identical in shape to today's |
| `cypress/e2e/server-data-authority.cy.js › serves the 404 page for every retired archive path` (new case) | visit `/leagues`, `/leagues-archive`, `/leagues-archive/x`, `/leagues-archive/x/tournaments-archive/y`, `…/result`, `…/result/metagames` | each shows `[data-cy="not-found-title"]`; `cy.location('pathname')` is unchanged (proves no redirect fired) |
| `cypress/e2e/league-server.cy.js › redirects every retired league URL onto the archive surface` (existing, **replaced**) | — | replaced by the 404 case above; the redirect assertions are deleted |
| `cypress/e2e/league-local.cy.js` (rewritten) | browser-local archive flows | drives `/archive/**`, asserts against IndexedDB `gones-archive-local`, never `gones-leagues` |
| `cypress/e2e/archive-staged-edit.cy.js` (rewritten) | `/archive/tournaments/:tournamentId` | stages, commits once through `POST /api/archive/tournaments/{id}/edit-batch`, survives reload |
| `cypress/e2e/global-stats.cy.js` (edited) | `**/api/archive/global-player-statistics/all` | the two `/api/leagues-archive/global-player-statistics/all` intercepts at `:38` and `:238` are re-pointed |
| `cypress/e2e/power-user-gating.cy.js` (edited) | `/archive/league-seasons` | the 14 `leagues-archive` references at `:87-182` are re-pointed to `/archive/**` and `[data-cy="archive-*"]` |
| `cypress/e2e/live-server.cy.js` (edited) | `:59`, `:63`, `:377` | intercepts hit `/api/archive/league-seasons/**`; the post-finalize assertion expects `/archive/tournaments/final-live-1` |
| `npm run migration:smoke` | a legacy-browser bundle with unassigned Tournaments | imports them as standalone Archive Tournaments; exit `0` |
| `scripts/smoke-full-stack.mjs` | released stack | `/api/archive/leagues/all` `200` with an `ETag`; migration list equals the four-entry `expectedMigrations` |

Run commands:

```
npx vitest run src/app/shared/retired-archive-surface.test.ts
npx vitest run src/app/backend/server-authority-boundary.test.ts
npm run test
npm run typecheck
npm run lint
npm run api:check
dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~RetiredLeagueArchiveSurfaceTests
npm run backend:test
npm run e2e:ci
```

## Impl steps

- [ ] 1. **Red — write the two guard suites before deleting anything.**
  - [ ] 1.1 Create `src/app/shared/retired-archive-surface.test.ts` with the six cases and the 19 `RETIRED_IDENTIFIERS` patterns from *Interface contract → Produces → retired-surface guard tests*. Copy `sourceFiles` / `filesMatching` verbatim from `src/app/backend/server-authority-boundary.test.ts:24-37`, renaming `sourceFiles` to `textFiles`.
  - [ ] 1.2 `npx vitest run src/app/shared/retired-archive-surface.test.ts` → red, 5 failing cases. Save the output.
  - [ ] 1.3 Create `backend/tests/Gones.ArchitectureTests/RetiredLeagueArchiveSurfaceTests.cs` with the two `[Fact]`s.
  - [ ] 1.4 `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~RetiredLeagueArchiveSurfaceTests` → red, 2 failing facts. Save the output.

- [ ] 2. **Delete the legacy frontend feature, data and backend modules.**
  - [ ] 2.1 `git rm -r --quiet src/app/features/leagues-archive src/app/features/tournaments-archive`
  - [ ] 2.2 `git rm --quiet src/app/data/league-archive-command-ux.ts src/app/data/league-archive-command-ux.test.ts src/app/data/league-archive-import.service.ts src/app/data/league-archive-import.service.test.ts src/app/data/league-archive-origin.ts src/app/data/league-archive-origin.test.ts src/app/data/league-archive-repository.service.ts src/app/data/league-archive-repository.service.test.ts src/app/data/league-archive-routing.test.ts src/app/data/league-archive-summary.ts src/app/data/league-archive-summary.test.ts`
  - [ ] 2.3 `git rm --quiet src/app/backend/local-league-archive-backend.service.ts src/app/backend/local-league-archive-backend.service.test.ts`
  - [ ] 2.4 `git rm --quiet src/app/app.component.league-catalog-cache.test.ts src/app/domain/placeholder-league.test.ts src/app/domain/export-restore.ts src/app/domain/export-restore.test.ts src/app/domain/league-parity-fixtures.test.ts`
  - [ ] 2.5 `git rm -r --quiet fixtures/league-domain`
  - [ ] 2.6 `ls src/app/data/ | grep -c league-archive` → `0`.

- [ ] 3. **Contract the shared domain modules.**
  - [ ] 3.1 In `src/app/domain/models.ts`, delete every symbol in the *Produces → models.ts* list, top to bottom. Keep the surviving list intact.
  - [ ] 3.2 Apply the four-helper disposition rule from *Produces → models.ts*: `grep -n "normalizePlayerArchetypeDocuments\|derivePlayerArchetypesFromRoundDocuments\|withDefaultTable\|addDerivedArchetype" -r src/` and delete / keep-private / export accordingly.
  - [ ] 3.3 In `src/app/domain/export-schemas.ts`, delete the v1–v4 half (`SupportedExportVersion`, `PUBLIC_EXPORT_V4_LEAGUE_FIELDS`, `ExportJsonSchema`, `versionConst`, `kindTaggedSchema`, `leagueSchema`, `calendarEventSchema`, `EXPORT_JSON_SCHEMAS`) and replace the file header comment with the two-line text from *Produces → export-schemas.ts*.
  - [ ] 3.4 In `src/app/domain/export-schemas.test.ts`, delete the two cases `defines a JSON Schema for every supported data version up to v4` and `locks the v4 public allowlist to League/Result source and public Scheduled fields`, and remove the imports of `EXPORT_JSON_SCHEMAS`, `PUBLIC_EXPORT_V4_LEAGUE_FIELDS`, `GONES_DATA_VERSION`, `SUPPORTED_IMPORT_DATA_VERSIONS`, `createLeague`, `exportFullData`, `exportLeague`. Keep the denylist, limits and checksum cases.
  - [ ] 3.5 In `src/app/domain/event-pages.test.ts`, delete the single case `it('drops legacy linked tournaments when restoring full data with regenerated IDs')` at `:48` and drop `createLeague`, `createTournament` from the `./models` import on `:2` and the whole `./export-restore` import on `:3`. The three surviving cases touch only calendar-event normalization.
  - [ ] 3.6 In `src/app/domain/models.test.ts`, remove every assertion that names a deleted symbol; keep the file if at least one case survives, `git rm` it if none does.
  - [ ] 3.7 `npx vitest run src/app/domain/` → green.

- [ ] 4. **Remove the legacy routes and redirects.**
  - [ ] 4.1 In `src/app/app.routes.ts`, delete the whole `function archiveRedirectRoutes(): Routes { … }` block including its doc comment (`:58-75`).
  - [ ] 4.2 Delete the five legacy route objects at `:93` and `:97-100`, and the `...archiveRedirectRoutes(),` spread at `:101`.
  - [ ] 4.3 Insert the replacement doc comment from *Produces → app.routes.ts* immediately above `export function buildRoutes(`.
  - [ ] 4.4 `grep -c "leagues-archive\|tournaments-archive\|archiveRedirectRoutes" src/app/app.routes.ts` → `0`.

- [ ] 5. **Re-point the app shell, breadcrumbs and the remaining `models.ts` consumers.**
  - [ ] 5.1 In `src/app/app.component.ts`, delete the imports on `:9` (`canManageLeague, leagueCommandError`), `:10` (`isAnyPlaceholderLeagueId`), `:11` (`LeagueArchiveRepository`), `:13` (`exportFullData, exportLeague, leagueExportFilename`), `:15` (`PersistedLeague, TournamentDocument`) and `:25` (`clearLeagueCatalogCache`). Re-point each to its archive twin: `ArchiveRepository` from `./data/archive-repository.service`, the command classifier from `./data/archive-command-ux`, the export helpers from `./domain/archive-export-schemas`, and the document types from `./domain/archive-models`.
  - [ ] 5.2 Retype `interface HeaderTournament` at `:30-33` to `{ season: PersistedLeagueSeason | null; tournament: PersistedArchiveTournament }` and update `buildHeaderTournament` / `buildHeaderLeague` accordingly. A standalone Tournament has `season: null` and renders no League line.
  - [ ] 5.3 Change the header result link at `:57` from `['/leagues-archive', item.league.id, 'tournaments-archive', item.tournament.id, 'result']` to `['/archive', 'tournaments', item.tournament.id, 'result']`.
  - [ ] 5.4 Change the two `'/leagues-archive'` path comparisons for `showHeaderImport` at `:150` and `:190` to `'/archive/league-seasons'`, and update the comment at `:146-148` to name `/archive`.
  - [ ] 5.5 Delete the whole `window.addEventListener('gones-league-updated', () => { clearLeagueCatalogCache(); void this.updateRouteState(this.router.url); });` block at `:165-168`, together with the four-line comment above it at `:161-164`. The `ARCHIVE_UPDATED_EVENT` listener T16 added stays.
  - [ ] 5.6 Add `import { purgeRetiredLeagueDatabase } from './backend/local-archive-backend.service';` and call `purgeRetiredLeagueDatabase();` as the first statement of the `constructor()`.
  - [ ] 5.7 In `src/app/backend/local-archive-backend.service.ts`, add the exported `purgeRetiredLeagueDatabase(): void` from *Produces → one-shot browser database purge*, with its doc comment verbatim.
  - [ ] 5.8 In `src/app/app-breadcrumbs.ts`, change the `./domain/models` import on `:2` to `import { PersistedArchiveTournament, PersistedLeagueSeason } from './domain/archive-models';`, delete the `PLACEHOLDER_LEAGUE_ID` usage, and rewrite the `leagues-archive` branch to build `/archive/league-seasons` → `/archive/tournaments/:id` crumbs. Update `src/app/app-breadcrumbs.test.ts` to match.
  - [ ] 5.9 Re-point the remaining `models.ts` consumers to `./domain/archive-models`, one file at a time, running `npm run typecheck` after each: `src/app/features/players/player-detail.component.ts` (`:11`, `:400`), `src/app/features/settings/local-player-names.ts`, `src/app/features/live-tournaments/live-tournament-list.component.ts`, `src/app/features/live-tournaments/live-tournament-runner.component.ts`, `src/app/domain/{player-stats,results,rename-player,tournament-summary,tournament-archetypes,warnings,live-tournament,archive-tournament-edit-batch}.ts`, `src/app/backend/{application-backend,aspnet-api-backend.service,local-live-backend.service}.ts`, plus each of their `*.test.ts` siblings.
  - [ ] 5.10 `npm run typecheck` → exit `0`.

- [ ] 6. **Update the boundary allowlists and the browser-store tests.**
  - [ ] 6.1 In `src/app/backend/server-authority-boundary.test.ts`, remove `'src/app/backend/local-league-archive-backend.service.ts'` and its comment from the IndexedDB `toEqual` array at `:105-114`.
  - [ ] 6.2 In the same file, remove `'src/app/features/leagues-archive/league-archive-catalog-cache.service.ts'` and its comment from the catalog-cache importer `toEqual` array at `:172-181`.
  - [ ] 6.3 Update the file's header comment at `:10-19` and the inline comment at `:101-104` to name the archive local adapter (ADR 0028, `gones-archive-local`) and the archive cache instead of the League ones.
  - [ ] 6.4 In `src/app/backend/browser-local-scope.test.ts`, replace `expect(LOCAL_LEAGUE_DB_NAME).toBe('gones-leagues');` at `:39` with `expect(LOCAL_ARCHIVE_DB_NAME).toBe('gones-archive-local');`, fix the import, and update the `gones-leagues` mention in the doc comment at `:11`.
  - [ ] 6.5 In `src/app/data/archive-cache-invalidation.test.ts`, delete the case `it('keeps the legacy League listener alive', …)`.
  - [ ] 6.6 `npx vitest run src/app/backend/server-authority-boundary.test.ts src/app/backend/browser-local-scope.test.ts src/app/data/archive-cache-invalidation.test.ts` → green.

- [ ] 7. **Delete the legacy backend surface and re-point the five forced call sites.**
  - [ ] 7.1 `git rm --quiet backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs backend/src/Gones.Api/Leagues/LeagueArchiveCatalogCountsBackfill.cs backend/src/Gones.Domain/Leagues/LeagueArchiveAggregate.cs backend/src/Gones.Infrastructure/Persistence/LeagueArchiveAggregateConfiguration.cs`
  - [ ] 7.2 In `backend/src/Gones.Api/Program.cs`, delete `:120` (`AddScoped<LeagueCommandService>()`), `:128` (the `LeagueArchiveCatalogCountsBackfill` hosted-service insert), `:239` (`app.MapPublicLeagueEndpoints();`) and `:240` (`app.MapLeagueCommandEndpoints();`). Update the comment at `:169` to name the archive catalog.
  - [ ] 7.3 In `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs`, delete `:48` (`public DbSet<LeagueArchiveAggregate> LeagueArchiveAggregates …`) and the now-unused `using Gones.Domain.Leagues;` on `:4` if nothing else in the file needs it.
  - [ ] 7.4 Apply Live re-point **(1)** — `RequireLeagueReferenceAsync`, `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs:358-364` — exactly as written in *Consumes → Live*.
  - [ ] 7.5 Apply Live re-point **(2)** — finalize, `:306-321` and the response tail `:330-337` and the two `AddAudit` calls — exactly as written in *Consumes → Live*. Do not change any other line of this file.
  - [ ] 7.6 Apply re-point **(3)** — `backend/src/Gones.Api/Leagues/PlayerEndpoints.cs:108-135`.
  - [ ] 7.7 Apply re-point **(4)** — `backend/src/Gones.Api/Leagues/PlayerNameMaintenanceEndpoints.cs`, three substitutions, wire contract untouched.
  - [ ] 7.8 Apply re-point **(5)** — `backend/src/Gones.Infrastructure/MigrationImport/MigrationImportService.cs` and the `PlaceholderLeagueTarget` removals in `backend/src/Gones.Application/Migration/{MigrationMapping,MigrationPlan,MigrationPlanner,MigrationReport}.cs`.
  - [ ] 7.9 In `backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs:32-46`, delete any remaining `LeagueArchiveAggregates` read and the `GonesData` construction; T8 already reads the archive tables, so this is a residue removal, not a rewrite. If the file still compiles unchanged, leave it.
  - [ ] 7.10 In `backend/src/Gones.Migrator/Program.cs:214`, change the seeded Live demo's League id from `"placeholder-league"` to `""` so the demo finalizes standalone.
  - [ ] 7.11 `npm run backend:build`. For each `CS0246` / `CS0117` error naming a `Gones.Domain.Leagues` type, apply this fixed rule and re-run: **never** delete `Glicko2.cs`, `Glicko2Decay.cs`, `MarginOfVictory.cs`, `PlayerStatisticsFormula.cs`, `RoundCsvAdapter.cs`, `LeagueJson.cs` or `LeagueRules.cs`; for `LeagueArchiveAggregate`, `LeagueCatalogCounts`, `LeagueCommands`, `LeagueNormalizer`, `LeagueDocuments`, `LeaguePlayerNameMaintenance` — if `git grep -l "<TypeName>" backend/src` returns only files this ticket deletes, `git rm` the defining file; if a surviving file still needs it, keep the file and delete only the members that reference `LeagueDocument` / `TournamentDocument` / the placeholder constants. Repeat until `Build succeeded`, 0 errors, 0 warnings.
  - [ ] 7.12 Delete the backend test files whose subject is gone: `git rm --quiet backend/tests/Gones.IntegrationTests/{LeagueArchiveAggregatePersistenceTests,LeagueArchiveCatalogCountsBackfillTests,LeagueArchiveRouteTests,LeagueCommandApiTests,PublicLeagueApiTests,PublicLeagueCatalogApiTests,PublicLeagueDocumentCatalogApiTests,ArchiveTournamentStatusBackfillTests}.cs backend/tests/Gones.UnitTests/{LeagueArchiveAggregateReadTests,LeagueCatalogCountsTests,LeagueCommandsTests,LeagueNormalizerTests,LeagueParityTests}.cs`
  - [ ] 7.13 Re-point the backend tests whose subject survives — `LiveCommandApiTests.cs`, `PlayerApiTests.cs`, `PlayerNameMaintenanceApiTests.cs`, `PlayerStatisticsRebuildTests.cs`, `PlayerStatisticsRatingRebuildTests.cs`, `PlayerStatisticsStartupTests.cs`, `GlobalStatsApiTests.cs`, `GlobalStatsCatalogApiTests.cs`, `ResponseCompressionTests.cs`, `MigrationImportServiceTests.cs`, `PlayerRatingReplayTests.cs`, `LeaguePlayerNameMaintenanceTests.cs`, `LeagueRulesTests.cs` — seeding `ArchiveLeagues` / `ArchiveLeagueSeasons` / `ArchiveTournaments` rows instead of `LeagueArchiveAggregates`. Keep every assertion's expected value; only the seed changes.
  - [ ] 7.14 Add the new case `Finalize_without_a_league_creates_a_standalone_archive_tournament` to `backend/tests/Gones.IntegrationTests/LiveCommandApiTests.cs`, and delete its `:359` placeholder-league assertion.
  - [ ] 7.15 Delete T1's `Initial_create_seeds_the_fixed_placeholder_league` test wherever T1 placed it (`git grep -ln Initial_create_seeds_the_fixed_placeholder_league backend/tests`).

- [ ] 8. **Drop the table with exactly one migration.**
  - [ ] 8.1 `export GONES_DB_CONNECTION='Host=127.0.0.1;Port=5433;Database=gones;Username=gones_migration;Password=local-migration-only'`
  - [ ] 8.2 `dotnet ef migrations add RetireLegacyLeagueArchive --project backend/src/Gones.Infrastructure --startup-project backend/src/Gones.Infrastructure` → tail `Done. To undo this action, use 'ef migrations remove'`.
  - [ ] 8.3 Open the generated `<ts>_RetireLegacyLeagueArchive.cs` and confirm `Up` contains exactly `migrationBuilder.DropTable(name: "league_archive_aggregates");` and **no** `CreateTable`. Delete any extra scaffolded statement in `Up`; leave `Down` as scaffolded.
  - [ ] 8.4 `MIGRATION_ID=$(ls backend/src/Gones.Infrastructure/Persistence/Migrations/*_RetireLegacyLeagueArchive.cs | xargs -n1 basename | sed 's/\.cs$//'); echo "$MIGRATION_ID"`
  - [ ] 8.5 Append `"$MIGRATION_ID"` as the last element of `expectedMigrations` in `scripts/smoke-full-stack.mjs:57`.
  - [ ] 8.6 `dotnet test backend/Gones.sln --configuration Release --filter FullyQualifiedName~MigrationSafetyTests` → 3 passing facts, including `Committed_migrations_fully_describe_the_model`.
  - [ ] 8.7 Prove it applies on a fresh database: `docker compose down --volumes --remove-orphans && docker compose up -d --wait postgres && docker compose build migrator && docker compose run --rm migrator database update` → exit `0`.
  - [ ] 8.8 `docker compose exec -T postgres psql -U gones_migration -d gones -Atc "select to_regclass('league_archive_aggregates');"` → empty line (the table is gone).

- [ ] 9. **Fix the scripts and dev fixtures that still name the legacy surface.**
  - [ ] 9.1 In `scripts/seed-local.mjs`, replace lines `12-13` with an archive-tier seed check:
    ```js
    const archiveCount = run(['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', "select count(*) from archive_leagues where deleted_at is null;"]);
    if (Number(archiveCount.trim()) < 0) throw new Error('Fixed archive seed missing or duplicated.');
    ```
    If T1's `InitialCreate` seeds no archive row, drop the check entirely rather than inventing a seed row — do not add seed data in this ticket.
  - [ ] 9.2 In `scripts/smoke-full-stack.mjs`, replace `:21-32` with the archive equivalents: `GET /api/archive/leagues/all` must be `200` and carry an `ETag`; delete the `placeholder-league` filter at `:25-26` and the `/api/leagues-archive/placeholder-league` detail block at `:28-32`. Update the comment at `:21`.
  - [ ] 9.3 In `scripts/seed-dev-environment.mjs`, delete `async function seedLeagues(...)` at `:361-380` and its call site; `seedArchive(...)` (T9) is the only archive seeding path left.
  - [ ] 9.4 In `scripts/dev-environments.mjs`, remove the `leagues` entry from `DATA_FILES` at `:20` and the `LeagueDocument` comment at `:199`.
  - [ ] 9.5 `git rm --quiet fixtures/dev-environments/demo/leagues.json fixtures/dev-environments/stress/leagues.json`
  - [ ] 9.6 In every `fixtures/dev-environments/*/live-tournaments.json`, re-point each `leagueKey` at a key from that environment's `archive-league-seasons.json`, or remove the field to make the running tournament unattached.
  - [ ] 9.7 In `scripts/generate-stress-environment.mjs`, remove the `['leagues.json', data.leagues, false]` emitter entry at `:1111` and the code that builds `data.leagues`.
  - [ ] 9.8 Update `ops/dev-environments.test.ts` and `ops/stress-generator.test.ts` for the shortened `DATA_FILES` and the removed `leagues.json`.
  - [ ] 9.9 Update `fixtures/dev-environments/README.md`'s fixture-file list to match the new `DATA_FILES`.
  - [ ] 9.10 `node scripts/generate-stress-environment.mjs --seed=1` → exit `0`; `npx vitest run ops/` → green.

- [ ] 10. **Regenerate the API client.**
  - [ ] 10.1 `npm run api:generate`
  - [ ] 10.2 `grep -c "leagues-archive" src/app/api/generated/gones-api.ts` → `0`.
  - [ ] 10.3 `npm run api:check` → exit `0`. Commit both the OpenAPI snapshot and the generated client.

- [ ] 11. **Prune the orphaned i18n keys — zero-reference keys only.**
  - [ ] 11.1 Build the candidate list without guessing:
    ```
    node -e "const s=require('fs').readFileSync('src/app/i18n/messages.ts','utf8');const k=[...new Set([...s.matchAll(/^\s*'([a-zA-Z][\w.]*)':/gm)].map(m=>m[1]))];console.log(k.join('\n'))" > /tmp/gones-t19-keys.txt
    while read -r key; do n=$(git grep -c -F "'$key'" -- 'src' ':!src/app/i18n/messages.ts' | wc -l); [ "$n" = "0" ] && echo "$key"; done < /tmp/gones-t19-keys.txt
    ```
  - [ ] 11.2 Delete each listed key from **both** the EN block and the FR block of `src/app/i18n/messages.ts`. Delete nothing that the command did not list — a key T13–T18 reuses must survive.
  - [ ] 11.3 `npx vitest run src/app/i18n/` → green, including `en and fr have identical key sets`.

- [ ] 12. **Rewrite the Cypress specs and re-point the acceptance matrix.**
  - [ ] 12.1 Rewrite `cypress/e2e/league-local.cy.js` against `/archive/league-seasons` and `/archive/tournaments`, replacing `const LOCAL_LEAGUE_DB_NAME = 'gones-leagues';` at `:9` with `const LOCAL_ARCHIVE_DB_NAME = 'gones-archive-local';` and the IndexedDB assertions at `:202-205` and `:330` with reads of the `tournaments` store of that database. Keep all six `it(...)` titles and their intent.
  - [ ] 12.2 Rewrite `cypress/e2e/league-server.cy.js` against `/api/archive/**`. **Delete** the case `redirects every retired league URL onto the archive surface, parameters intact` at `:276` — there are no redirects any more.
  - [ ] 12.3 Rewrite `cypress/e2e/archive-staged-edit.cy.js` against `/archive/tournaments/:tournamentId` and T17's editor; replace `const LOCAL_DB = 'gones-leagues';` at `:2` with `'gones-archive-local'`.
  - [ ] 12.4 In `cypress/e2e/server-data-authority.cy.js`, re-point the eight `leagues-archive` references at `:51-113`, and add the new case `serves the 404 page for every retired archive path` from *Test plan* beside the existing `/calendar/tournaments/:slug` 404 case at `:70`.
  - [ ] 12.5 In `cypress/e2e/global-stats.cy.js`, re-point the two intercepts at `:38` and `:238` to `**/api/archive/global-player-statistics/all`.
  - [ ] 12.6 In `cypress/e2e/power-user-gating.cy.js`, re-point the 14 references at `:87-182` to `/archive/league-seasons`, `/api/archive/**` and the `[data-cy="archive-*"]` selectors T13/T14 ship.
  - [ ] 12.7 In `cypress/e2e/live-server.cy.js`, re-point the intercepts at `:59` and `:63` to `/api/archive/league-seasons/**` and the post-finalize assertion at `:377` to `/archive/tournaments/final-live-1`.
  - [ ] 12.8 In `cypress/e2e/settings-local.cy.js`, replace `const LOCAL_LEAGUE_DB_NAME = 'gones-leagues';` at `:1` with the archive database name.
  - [ ] 12.9 Reconcile `scripts/full-stack-ci.mjs`'s `const specs = [...]` with `ls cypress/e2e/*.cy.js`; `npx vitest run ops/e2e-spec-coverage.test.ts` → green.
  - [ ] 12.10 In `ops/acceptance-matrix.json`, re-point every evidence `target` that names a deleted file — at least `:225` (`local-league-archive-backend.service.test.ts`), `:230` (`league-archive-repository.service.test.ts`), `:240` (`league-archive-import.service.test.ts`) — to the archive twin, and rewrite the `doc09-archive-rename` row's `capability` at `:2469` and the `/api/leagues-archive` details at `:2493-2505` for the three-tier surface.
  - [ ] 12.11 `npx vitest run ops/acceptance-matrix.test.ts` → green.

- [ ] 13. **Refresh the durable docs. No link to `./artifacts/` or `./.tmp/` — inline every fact.**
  - [ ] 13.1 In `docs/CONTEXT.md`, replace the **League Archive** entry (`:27-30`) with:
    ```
    **Archive**:
    The stored archive of past results on three tiers — League → LeagueSeason → Tournament. It is served under `/api/archive` and persisted in `archive_leagues`, `archive_league_seasons` and `archive_tournaments`. Browsed at `/archive/league-seasons` and `/archive/tournaments`.
    _Formerly_: League Archive, `/api/leagues-archive`, `league_archive_aggregates` (ADR 0022); before that, the Leagues feature and `/api/leagues`
    _Avoid_: Calendar, Live Tournament
    ```
  - [ ] 13.2 Add the two new tier entries directly under it:
    ```
    **League** (archive tier):
    The top archive tier. Groups LeagueSeasons. It has no page of its own — it is a column and a filter.
    _Avoid_: Season when a single run is meant

    **LeagueSeason**:
    The middle archive tier: one run of a League, with a mandatory parent League. This is what used to be called a League.
    _Formerly_: League (the flat archive record)
    _Avoid_: League on its own
    ```
  - [ ] 13.3 Replace the **Archive Tournament** entry (`:32-35`) with one that says a Tournament is a first-class top-level record served under `/archive/tournaments/:tournamentId`, that `seasonId: null` means standalone, and that it locks to non-Admin writes 365 days after `tournamentDate`. Keep `_Formerly_: Result Tournament, the `/tournaments-archive` path segment (ADR 0022)`.
  - [ ] 13.4 Add a **Retired term** entry for the placeholder League:
    ```
    **Unassigned Tournaments**:
    Retired. The fixed `placeholder-league` row that used to hold Tournaments belonging to no League. Replaced by `seasonId: null` on a standalone Tournament; the row, its id and its name are gone.
    _Avoid_: as a name for anything new
    ```
  - [ ] 13.5 Update `docs/CONTEXT.md:127` (Global Player Statistics: "across all non-deleted Leagues" → "across every non-deleted LeagueSeason plus standalone Tournaments"), `:305` (the Relationships bullet), `:459-462` and `:515`. Add these four Relationships bullets after `:305`:
    ```
    - A **LeagueSeason** belongs to exactly one **League**
    - An **Archive Tournament** belongs to at most one **LeagueSeason**; with none it is standalone
    - A standalone **Archive Tournament** contributes to the global Player Statistics scope only
    - Retired archive URLs are not redirected: `/leagues-archive/**` renders the 404 page. ADR 0022 kept redirects for bookmarks; Gones is unreleased with zero users, so that rationale is void. ADR 0022's "no API path aliases" rule still stands and `/api/leagues-archive/**` returns 404
    ```
  - [ ] 13.6 In `docs/GLOSSARY.md`, update the six stale rows: `:19` (`repository` → `src/app/data/archive-repository.service.ts`), `:23` (`global stats` → scope filter, `dir` URL parameter), `:25` (`staged edit` → `src/app/features/archive/tournament-detail.component.ts`), `:54` (`league archive` → `archive`, `/api/archive`, ref `backend/src/Gones.Api/Archive/ArchiveResponses.cs`), `:55` (`archive tournament` → first-class row, `seasonId: null`, 365-day lock), `:57` (`rating` ref unchanged, description gains the per-scope wording). Add two rows: `league season` and `archive cache` (`src/app/backend/archive-cache.service.ts`).
  - [ ] 13.7 `grep -c "artifacts/\|\.tmp/" docs/CONTEXT.md docs/GLOSSARY.md` → `0` for both.
  - [ ] 13.8 In `docs/local-dev-environments.html`, replace the `leagues.json optional [ LeagueDocument ]` line at `:96` with the three T9 files (`archive-leagues.json`, `archive-league-seasons.json`, `archive-tournaments.json`), fix the `2 League Archives` phrasing at `:81`, and change step 9 at `:120` from `leagues (POST /api/leagues-archive/restore)` to `archive (POST /api/archive/restore-full)`.
  - [ ] 13.9 In `docs/league-archive-authority.html` (`:70`, `:111`), `docs/offline-read-cache.html` (`:74`, `:154`) and `docs/player-statistics-read-model.html`, replace `gones-leagues` with `gones-archive-local`, `LocalLeagueArchiveBackend` with `LocalArchiveBackend`, and `league_archive_aggregates` with `archive_tournaments`. **Do not delete these files** — `ops/acceptance-matrix.test.ts` asserts every document under `docs/` has a matrix row.
  - [ ] 13.10 Update `README.md`'s archive paragraph if it names `/leagues-archive`: `grep -n "leagues-archive" README.md`.

- [ ] 14. **Prove it.** Run every gate in *Validation*, in order, and fix forward. Do not skip `npm run e2e:ci` — it is the only gate that exercises the 404 behaviour, the seed scripts and the migration list together.

## Outputs

**Deleted (files)**

```
src/app/features/leagues-archive/                    (6 files)
src/app/features/tournaments-archive/                (3 files)
src/app/data/league-archive-*.ts                     (11 files)
src/app/backend/local-league-archive-backend.service.ts(+.test.ts)
src/app/app.component.league-catalog-cache.test.ts
src/app/domain/placeholder-league.test.ts
src/app/domain/export-restore.ts(+.test.ts)
src/app/domain/league-parity-fixtures.test.ts
fixtures/league-domain/                              (manifest.json, parity.json)
fixtures/dev-environments/{demo,stress}/leagues.json
backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs
backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs
backend/src/Gones.Api/Leagues/LeagueArchiveCatalogCountsBackfill.cs
backend/src/Gones.Domain/Leagues/LeagueArchiveAggregate.cs
backend/src/Gones.Infrastructure/Persistence/LeagueArchiveAggregateConfiguration.cs
backend/tests/Gones.UnitTests/{LeagueArchiveAggregateReadTests,LeagueCatalogCountsTests,LeagueCommandsTests,LeagueNormalizerTests,LeagueParityTests}.cs
backend/tests/Gones.IntegrationTests/{LeagueArchiveAggregatePersistenceTests,LeagueArchiveCatalogCountsBackfillTests,LeagueArchiveRouteTests,LeagueCommandApiTests,PublicLeagueApiTests,PublicLeagueCatalogApiTests,PublicLeagueDocumentCatalogApiTests,ArchiveTournamentStatusBackfillTests}.cs
plus whichever Gones.Domain/Leagues/*.cs files step 7.11's rule proves unreferenced
```

**Added (files)**

```
src/app/shared/retired-archive-surface.test.ts
backend/tests/Gones.ArchitectureTests/RetiredLeagueArchiveSurfaceTests.cs
backend/src/Gones.Infrastructure/Persistence/Migrations/<ts>_RetireLegacyLeagueArchive.cs (+ .Designer.cs)
```

**Edited (files)** — `src/app/app.routes.ts`, `src/app/app.component.ts`, `src/app/app-breadcrumbs.ts` (+test), `src/app/domain/{models.ts,models.test.ts,export-schemas.ts,export-schemas.test.ts,event-pages.test.ts}`, `src/app/backend/{local-archive-backend.service.ts,server-authority-boundary.test.ts,browser-local-scope.test.ts}`, `src/app/data/archive-cache-invalidation.test.ts`, `src/app/i18n/messages.ts`, the `models.ts` consumers listed in step 5.9, `src/app/api/generated/gones-api.ts` + the OpenAPI snapshot, `backend/src/Gones.Api/Program.cs`, `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs`, `backend/src/Gones.Api/Leagues/{PlayerEndpoints,PlayerNameMaintenanceEndpoints,PlayerStatisticsRebuildService}.cs`, `backend/src/Gones.Application/Migration/{MigrationMapping,MigrationPlan,MigrationPlanner,MigrationReport}.cs`, `backend/src/Gones.Infrastructure/{Persistence/GonesDbContext.cs,MigrationImport/MigrationImportService.cs}`, `backend/src/Gones.Migrator/Program.cs`, the backend tests in step 7.13, `scripts/{seed-local,smoke-full-stack,seed-dev-environment,dev-environments,generate-stress-environment,full-stack-ci}.mjs`, `ops/{acceptance-matrix.json,dev-environments.test.ts,stress-generator.test.ts}`, `fixtures/dev-environments/README.md` + the `live-tournaments.json` files, `cypress/e2e/{league-local,league-server,archive-staged-edit,server-data-authority,global-stats,power-user-gating,live-server,settings-local}.cy.js`, `docs/{CONTEXT.md,GLOSSARY.md,local-dev-environments.html,league-archive-authority.html,offline-read-cache.html,player-statistics-read-model.html}`, `README.md`.

**Public API / behaviour change**

- `/api/leagues-archive/**` → `404`. `/leagues-archive/**` and `/leagues` → the 404 page, no redirect.
- `POST /api/live-tournaments/{id}/finalize` on a Live tournament with no `leagueId` now creates a **standalone** Archive Tournament instead of appending to `placeholder-league`. Response shape unchanged.
- `/api/maintenance/player-names*` — routes, shapes and status codes unchanged; data source moved to `archive_tournaments`.
- A v1–v4 export bundle can no longer be imported anywhere in the app (T11 closed that door; this ticket removes the last reader).

**Migrate / config**

- One EF migration `RetireLegacyLeagueArchive` drops `league_archive_aggregates`. No data is preserved and none needs to be: T1 already emptied the archive and Gones is unreleased.
- No configuration key is added or removed.

## Validation

- [ ] `npm run api:check` → exit `0`, no diff against the committed OpenAPI snapshot.
- [ ] `npm run lint` → exit `0`, `All files pass linting.`
- [ ] `npm run typecheck` → exit `0` (both `tsconfig.app.json` and `tsconfig.spec.json`).
- [ ] `npm run test` → exit `0`. Must include `src/app/shared/retired-archive-surface.test.ts` (6 passing), `src/app/backend/server-authority-boundary.test.ts`, `src/app/i18n/message-namespace.test.ts`, `ops/e2e-spec-coverage.test.ts` and `ops/acceptance-matrix.test.ts`.
- [ ] `npm run backend:build` → `Build succeeded`, 0 errors, 0 warnings.
- [ ] `npm run backend:test` → exit `0`, including `RetiredLeagueArchiveSurfaceTests` (2 passing) and `MigrationSafetyTests` (3 passing).
- [ ] `npm run migration:smoke` → exit `0`.
- [ ] `npm run db:reset && npm run db:seed` → `Deterministic V1 seed complete.`, exit `0`.
- [ ] `npm run e2e:ci` → exit `0`; the tail prints `=== e2e specs: N/N passed ===` with no `FAIL` line.
- [ ] Manual check — `npm run dev`, then visit `/leagues-archive`, `/leagues`, `/leagues-archive/x/tournaments-archive/y/result`: each shows the 404 page and the address bar still shows the typed path (no redirect). Visit `/archive/league-seasons` and `/archive/tournaments`: both render. Open DevTools → Application → IndexedDB: `gones-leagues` is absent; `gones-archive-local` and `gones-archive-cache` are present.
- [ ] Fence check — `git diff --name-only` lists nothing under `src/app/features/events/`, `backend/src/Gones.Api/Events/`, `backend/src/Gones.Domain/Calendar/`, `backend/src/Gones.Api/{Identity,Organizations,Admin,Notifications,Security}/`, or `cypress/e2e/{public-calendar,event-registration,event-proposal,organizer-*}.cy.js`.
- [ ] Invariant check — `git grep -nE "leagues-archive|league_archive_aggregates|LeagueArchiveAggregate|gones-leagues|gones-league-updated|PLACEHOLDER_LEAGUE_ID" -- ':!backend/src/Gones.Infrastructure/Persistence/Migrations' ':!docs/adr'` returns only `_Formerly_` lines in `docs/CONTEXT.md` / `docs/GLOSSARY.md`.
- [ ] `git status --porcelain` shows no staged-but-uncommitted leftovers and no untracked build output.
- [ ] Commit msg draft:
  ```
  refactor(archive): retire the legacy League Archive surface

  Contract step of expand → migrate → contract. Deletes the leagues-archive
  and tournaments-archive features, their data and backend adapters, the
  LeagueArchiveAggregate and its endpoints, and the league_archive_aggregates
  table, and retires the fixed placeholder-league row with the four call sites
  that kept it alive.

  Two ADR 0022 clauses are settled here. Its "No API path aliases" rule is
  reaffirmed: /api/leagues-archive/** returns 404. Its "Frontend redirects,
  yes" rule is reversed: Gones is unreleased with zero users, so "bookmarks
  and old links are a real user's problem" describes no one, and the retired
  routes hit the 404 page like /calendar/tournaments/:slug already does.

  Live keeps its wire contract: an unattached Live tournament now finalizes to
  a standalone Archive Tournament (seasonId: null) instead of the placeholder
  League. /api/maintenance/player-names* keeps its routes and shapes and only
  changes the table it reads, which ADR 0022's exclusion of that surface from
  the archive feature does not forbid.
  ```

---

## Ticket writer: T19

- State: done
- Ticket: `/home/aron/projects/gones/artifacts/PLAN_2026_08_22_archive-rebuild/T19_retire-legacy-surface.md`
- Main steps: 14 · sub-steps: 97
- Contracts produced:
  - `migrationBuilder.DropTable(name: "league_archive_aggregates");` in migration `RetireLegacyLeagueArchive` — `Up` drops one table, creates none
  - `export function purgeRetiredLeagueDatabase(): void;` in `src/app/backend/local-archive-backend.service.ts` — idempotent, never throws, called once from the `AppComponent` constructor
  - `src/app/shared/retired-archive-surface.test.ts` — 6 cases, 19 retired-identifier patterns
  - `backend/tests/Gones.ArchitectureTests/RetiredLeagueArchiveSurfaceTests.cs` — 2 facts
  - IndexedDB allowlist after this ticket: `['src/app/backend/archive-backfill-queue.ts','src/app/backend/archive-cache.service.ts','src/app/backend/indexed-db.ts','src/app/backend/local-archive-backend.service.ts','src/app/backend/local-live-backend.service.ts','src/app/backend/server-read-cache.service.ts']`
  - catalog-cache importer allowlist after this ticket: `['src/app/backend/archive-cache.service.ts','src/app/features/events/event-catalog-cache.service.ts','src/app/features/players/global-stats-catalog-cache.service.ts','src/app/features/players/player-detail-cache.service.ts']`
  - `static Task<ArchiveTournament> UpsertFromLiveAsync(GonesDbContext database, TournamentDocumentShape finalized, string? seasonId, Instant now, CancellationToken cancellationToken);` — the finalize call site's required signature against T4's existing writer
- Contracts consumed: T2 (`ArchiveLeague`/`ArchiveLeagueSeason`/`ArchiveTournament` entities, three DbSets, three tables), T4 (the archive-tournament writer used by Live finalize), T9 (`ARCHIVE_DATA_FILES`, `buildArchiveBundle`, `seedArchive`, `POST /api/archive/restore-full`), T11 (`ARCHIVE_DATA_VERSION = 5`, `archive-export-schemas.ts` importing the shared helpers from `export-schemas.ts`), T15 (`dir` URL parameter / `direction` wire parameter, `/api/archive/global-player-statistics/all`), T16 (`ARCHIVE_UPDATED_EVENT = 'gones-archive-updated'`, `invalidateArchiveCaches()`, and the `keeps the legacy League listener alive` case this ticket deletes), T17 (`src/app/features/archive/tournament-detail.component.ts` as the staged-edit subject), T18 (`gones-archive-local` IndexedDB database)
- Decisions added:
  - **D1** migration named `RetireLegacyLeagueArchive`; `Up` drops only, `Down` stays as EF scaffolds it (`MigrationSafetyTests` rule (a) is scoped to `Up`)
  - **D2** Live *finalize* re-pointed as well as `RequireLeagueReferenceAsync`; an unattached Live tournament finalizes to a standalone Archive Tournament (`season_id IS NULL`); `LiveFinalizeResponse` field names unchanged per ADR 0022
  - **D3** `/api/maintenance/player-names*` keeps every route, shape, status code and audit string; only its table changes
  - **D4** `PlayerEndpoints.BuildHistoryAsync` scans `archive_tournaments`; a standalone Tournament renders an empty League name
  - **D5** `gones-leagues` is deleted at runtime by a one-shot `purgeRetiredLeagueDatabase()` in T10's already-allowlisted file, so no new file joins the IndexedDB allowlist
  - **D6** two durable guard suites are added so requirement 3 cannot silently regress
  - **D7** `src/app/domain/export-restore.ts` (+test) is deleted whole and `export-schemas.ts` keeps only its version-agnostic half; `event-pages.test.ts` loses exactly one League-bundle case
  - **D8** i18n keys are pruned by a zero-reference script, never by hand — a key T13–T18 reuses survives
  - **D9** the four `docs/*.html` architecture pages get identifier-level corrections but are **not** deleted, because `ops/acceptance-matrix.test.ts` requires a matrix row per document
  - **D10** `models.ts`'s four private archetype helpers get an explicit delete / keep-private / export rule instead of a guess
  - **D11** the residual `Gones.Domain/Leagues/*.cs` sweep is driven by the compiler plus a fixed never-delete list, since T2–T9's exact reuse of those types is not knowable from the brief
- Conflicts vs brief:
  - Brief §7 and §0.2 name **T17** as the retire ticket; ruling R19 renumbered it to **T19**. Written as T19. (Consistent with the assigned ticket row.)
  - Brief §7 says the deleted table is `league_aggregates`; R1 and `LeagueArchiveAggregateConfiguration.cs:12` say `league_archive_aggregates`. Codebase wins.
  - R20 named one Live reference (`LiveCommandEndpoints.cs:358-364`); the finalize path at `:306-321` reads the same DbSet and will not compile without a re-point. Extended, and flagged in the ticket as compiler-forced.
  - The fence says "do NOT touch `/api/maintenance/player-names*`", but `PlayerNameMaintenanceEndpoints.cs:116,164` reads the deleted DbSet. Resolved as D3: contract frozen, data source moved. Reported.
  - The brief lists `cypress/e2e/offline-public-read.cy.js` as affected; it contains zero archive references (`grep -c -i league` → `0`). Excluded. Two unlisted specs — `power-user-gating.cy.js` (14 refs) and `live-server.cy.js` (3 refs) — are affected and were added.
  - The fence does not mention `scripts/seed-dev-environment.mjs`, `dev-environments.mjs`, `generate-stress-environment.mjs`, `smoke-full-stack.mjs`, `ops/acceptance-matrix.json` or `docs/*.html` beyond CONTEXT/GLOSSARY. All are pulled in: T9's ticket explicitly deferred the dev-fixture and HTML-doc work to this one, and `npm run test` / `npm run e2e:ci` go red without the rest.
  - R17 retires the TS↔C# parity corpus with no replacement. Residual risk recorded in the ticket: domain parity between `src/app/domain/**` and `Gones.Domain` is no longer proven by any test after this commit, and no ticket in the plan rebuilds it.
- TODO(user): none
- Codebase facts inlined: `src/app/app.routes.ts:58-101`, `src/app/app.component.ts:9-25,30-33,57,127,150,161-168,190`, `src/app/app-breadcrumbs.ts:2`, `src/app/domain/models.ts:2-4,6-11,13-30,32-36,54-75,124-125,154-156,198-242`, `src/app/domain/export-schemas.ts:1-102,104-157`, `src/app/domain/event-pages.test.ts:2-3,48`, `src/app/domain/league-parity-fixtures.test.ts:1-25`, `src/app/backend/server-authority-boundary.test.ts:24-37,100-114,164-181`, `src/app/backend/browser-local-scope.test.ts:11,39`, `src/app/backend/local-league-archive-backend.service.ts:35,41-49`, `src/app/i18n/messages.ts:519-538`, `src/app/i18n/message-namespace.test.ts:17-19`, `backend/src/Gones.Api/Program.cs:120,128,169,239-240`, `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs:293-337,358-364`, `backend/src/Gones.Api/Leagues/PlayerEndpoints.cs:108-135`, `backend/src/Gones.Api/Leagues/PlayerNameMaintenanceEndpoints.cs:112-168`, `backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs:23-60`, `backend/src/Gones.Domain/Leagues/LeagueArchiveAggregate.cs:8-16,39-54,109-166`, `backend/src/Gones.Domain/Leagues/LeagueNormalizer.cs:11-33`, `backend/src/Gones.Infrastructure/Persistence/LeagueArchiveAggregateConfiguration.cs:7-36`, `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs:4,48`, `backend/src/Gones.Infrastructure/MigrationImport/MigrationImportService.cs:133-141,247,284-291,349-356`, `backend/src/Gones.Infrastructure/Persistence/Migrations/20260802204547_AddLeagueAggregates.cs:38-51`, `backend/src/Gones.Migrator/Program.cs:108-117,207-255`, `backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs:34-127`, `backend/tests/Gones.UnitTests/LeagueParityTests.cs:168-176`, `backend/tests/Gones.IntegrationTests/LeagueArchiveRouteTests.cs:170-187`, `scripts/seed-local.mjs:9-16`, `scripts/smoke-full-stack.mjs:21-32,57-61`, `scripts/full-stack-ci.mjs:53-81,97,119`, `scripts/seed-dev-environment.mjs:361-380`, `scripts/dev-environments.mjs:20,199`, `scripts/acceptance-matrix.mjs:56-105,174`, `ops/e2e-spec-coverage.test.ts:15-45`, `ops/acceptance-matrix.test.ts:11-26`, `ops/acceptance-matrix.json:217-240,2467-2505`, `docs/CONTEXT.md:27-36,127,305,459-462,515`, `docs/GLOSSARY.md:19,23,25,54-57`, `docs/local-dev-environments.html:81,90-97,120`, `docs/adr/0022-rename-the-archived-league-feature.md` (whole file), `package.json` scripts block, `cypress/e2e/` (28 specs, grep counts per spec), `artifacts/PLAN_2026_08_22_archive-rebuild/T9_dev-fixtures.md:15,42`, `artifacts/PLAN_2026_08_22_archive-rebuild/T16_cache-invalidation-resync.md:16,37,236,273`, `artifacts/PLAN_2026_08_22_archive-rebuild/T1_reset-and-squash.md:107-113,167-168,205-222,296-297`
