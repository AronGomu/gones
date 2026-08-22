# T9: Three-tier dev fixtures, seeding and stress generator

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T4, T8
**Commit outcome:** `npm run dev:env -- --env=demo` and `npm run dev:stress:generate` produce three-tier archive data — Leagues, LeagueSeasons and Tournaments — through the new `/api/archive/**` surface.

## Context (self-contained)

- Goal: the Archive is being rebuilt on three tiers — **League → LeagueSeason → Tournament**. A Tournament becomes a first-class top-level record that may stand alone (`seasonId: null`). Today's flat `League` becomes `LeagueSeason`; a new `League` tier groups Seasons. `leagues-archive` → `archive` everywhere.
- This slice: **the data half**. Every local development environment under `fixtures/dev-environments/` gains three-tier archive fixtures; the seeder loads them through `POST /api/archive/restore-full`; the `stress` generator emits three-tier data instead of one flat tier; the stress bulk loader writes the three new tables; and a frozen golden bundle lands at `fixtures/archive-domain/v5/`. Nothing renders any of it yet — the archive UI arrives at T13/T14. What this ticket buys is that a developer running `npm run dev -- --env=demo` sees a populated three-tier archive in the API, and that the shapes the later tickets render against are already exercised by the fixture gate inside `npm run test`.
- Out of scope here — do **not** touch:
  - **No frontend.** Not one file under `src/app/**`, not one Cypress spec, not one i18n key. The Vitest cases this ticket adds live under `ops/**`, which `vitest.config.ts` already includes (`include: ['src/**/*.test.ts', 'ops/**/*.test.ts']`).
  - **No endpoint changes.** No file under `backend/**` is edited. `/api/archive/restore-full` and the three tables are consumed exactly as they were built; if one of them does not behave as this ticket states, fix the ticket's caller, never the server.
  - **No `docs/local-dev-environments.html` edit.** The architecture HTML docs belong to the docs ticket that retires the legacy surface. Read it for the existing format (it is the HTML twin of `fixtures/dev-environments/README.md`), leave it alone, and note the drift in your commit body.
  - **Do not delete the legacy seeding path.** `scripts/seed-dev-environment.mjs → seedLeagues()` and the `leagues.json` fixture file stay, because `live-tournaments.json` depends on them — see *Assumptions in force*.
  - No `ops/acceptance-matrix.json`, no `README.md` at the repo root, no ADR.
- Assumptions in force:
  - **Gones is unreleased. There is no production environment and there are no users.** Local data may be reset freely. `fixtures/` ships in no image and no release path reads it.
  - **Expand → migrate → contract.** The new `/api/archive/**` surface exists *beside* `/api/leagues-archive/**`. The legacy aggregate, endpoints, components and specs are deleted only by the final retire-legacy ticket. Every commit compiles and the app runs.
  - **The legacy `leagues.json` path is load-bearing and stays.** `POST /api/live-tournaments` validates its `leagueId` against the *legacy* table: `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs:358-364`

    ```csharp
    public async Task RequireLeagueReferenceAsync(string? leagueId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(leagueId)) return;
        var exists = await database.LeagueArchiveAggregates.AsNoTracking()
            .AnyAsync(item => item.DocumentId == leagueId && item.DeletedAt == null, cancellationToken);
        if (!exists) throw Validation("leagueId", "League was not found.");
    }
    ```

    `live-tournaments.json` points at a `leagues.json` `id` through its `leagueKey`, so removing the legacy restore would break every fixture running tournament that names a League. Live is explicitly outside this plan's scope. The legacy path therefore stays exactly as it is for the committed environments, and is reduced to *reference stubs* only for the generated `stress` environment, where it costs 44 MB — see *Decisions taken inside this ticket*, D3.
  - **The archive rebuild's `global` player-statistics scope reads both the new `archive_tournaments` table and the legacy `league_archive_aggregates` table** until the legacy surface is retired. A fixture that carries the same Tournament in both tiers therefore double-counts in the global rankings. This is why `stress` moves its whole archive to the new tier and keeps only empty legacy stubs, and it is a documented, accepted, dev-only artifact for `demo` — see D3 and *Outputs → Known gaps*.
  - **Archive dates are absolute literals, never relative offsets** (ADR 0030). "An archive is history, and a rolling history would be a lie." Only Calendar Events and running tournaments use `offsetDays`. The lock window is therefore measured against a *declared* anchor date inside the fixtures, not against the clock — see D2.
  - The stress generator is **clock-free and seeded**: `mulberry32` only, so `--seed=1` produces byte-identical files on any machine. Nothing added by this ticket may read `Date.now()` inside the generator.
  - The archive command endpoints emit snake_case wire codes for the shared failures (`stale_version`, `not_found`, `validation_failed`) and a new code for a locked Tournament. The two predecessor tickets spell that lock code `archiveTournamentLocked` while the arbitration ruling spells it `archive_tournament_locked`. **This ticket never asserts a wire `code` string** — it asserts HTTP status codes only, so the discrepancy cannot reach it. Report it, do not fix it here.

## Requirements

1. A development environment may carry three new optional fixture files: `archive-leagues.json`, `archive-league-seasons.json`, `archive-tournaments.json`. Each is a JSON array. A missing file means an empty list, exactly like every other fixture file.
2. `validateEnvironment` refuses every three-tier fixture shape the server would refuse: a dangling `leagueId`, a dangling `seasonId`, a bad `status`, a non-ISO or future `tournamentDate`, a round entry that is neither `match` nor `bye`, a Tournament document over the server's 1 MiB ceiling, a duplicate id at any tier, a League missing its `"sourceSeriesId": null` provenance marker, and a bundle over the restore endpoint's row caps.
3. `scripts/seed-dev-environment.mjs` loads the three-tier archive of a committed environment with exactly **one** call to `POST /api/archive/restore-full`, as the environment's verified `Admin`, carrying an `Idempotency-Key`, and reports the ids the server minted.
4. The `demo` environment carries a three-tier archive that exercises, visibly, every case the research below found in real public MTG archives — free-string Season labels, a cross-year Season, a wildly varying tournaments-per-Season spread, a child series whose name embeds its parent's, degenerate names as standalone Tournaments, non-ASCII names, `sourceSeriesId: null` on every League, an empty Season, and both locked and unlocked Tournaments.
5. `scripts/generate-stress-environment.mjs` emits three-tier archive data: Leagues, LeagueSeasons with **free-string** labels drawn from the observed label styles, and Tournaments whose per-Season count is drawn from the observed size classes — `1`, `3-4`, `5-13`, `6`, `8-11`, `50-60` and `7+` weekly legs — plus standalone Tournaments with `seasonId: null`.
6. The stress generator's legacy `leagues.json` shrinks to **reference stubs**: one League per `live-tournaments.json` `leagueKey`, each with `tournaments: []`. Nothing else legacy is generated.
7. `scripts/bulk-load-stress.mjs` writes `archive_leagues`, `archive_league_seasons` and `archive_tournaments` in the same transaction as the rest of the bulk load, with the projected columns already carrying the values the domain would have computed, and with a `document` JSON the table's check constraints accept.
8. `fixtures/archive-domain/v5/` holds a frozen golden v5 archive bundle plus a manifest stamping its SHA-256 and its case counts. It is assembled from the `demo` environment, so there is exactly one authored source of archive truth in the repository.
9. `npm run test` is green, `npm run typecheck` is green, `npm run lint` is green. No backend file changes, so `npm run backend:build` and `npm run backend:test` stay green untouched.

## Inputs

Read these before writing code. Paths and line refs are current as of this ticket, taken from the working tree (several of these files carry uncommitted modifications — read the on-disk content, not `git show HEAD`).

- `fixtures/dev-environments/README.md` — the fixture format, the `demo` and `stress` descriptions, the "Archive dates are absolute on purpose" rule, and the "Editing it" / "Adding one" sections you will extend.
- `docs/local-dev-environments.html:88-121` — the HTML twin of the above. **Read only.** Its `Layout on disk` block (line 90-97) and its step 9 (`leagues (POST /api/leagues-archive/restore) → running tournaments`) go stale with this commit; leave them to the docs ticket.
- `scripts/dev-environments.mjs` — the only reader of the fixture format:
  - `:20` `export const DATA_FILES = ['accounts', 'organizations', 'formats', 'tournaments', 'registrations', 'leagues', 'liveTournaments'];`
  - `:22-24` `GLOBAL_ROLES`, `LEAGUE_STATUSES = ['active', 'completed']`, `ROUND_ENTRY_KINDS = ['match', 'bye']`
  - `:37-39` `fileNameFor(key)` — `liveTournaments` → `live-tournaments.json`, i.e. camelCase becomes kebab-case
  - `:56-77` `readEnvironment(name, root)` — reads `environment.json`, then one file per `DATA_FILES` key, defaulting to `[]`
  - `:80-231` `validateEnvironment(environment)` — returns `[]` or one human-readable string per problem, every message prefixed `` `${label}: ` ``
  - `:239-244` `localDateTime(offsetDays, time, today)`
  - `:252-260` `expectedEventSlug(title, formatSlug)`
- `scripts/seed-dev-environment.mjs` — the loader:
  - `:26` imports `bulkLoadStress`; `:29` `const API_ORIGIN = 'http://127.0.0.1:5080';`
  - `:36` `const { environment: name } = parseDevArgs(process.argv.slice(2));`; `:38` `const bulk = name === STRESS_ENVIRONMENT;`
  - `:155-163` `api(method, path, { token, body, idempotencyKey, ifMatch })`
  - `:166-170` `requireResponse(response, step, key, tolerated = [])`
  - `:172-174` `verifiedAccountForRole(environment, role)`
  - `:181-188` `bulkTokenEmails(environment)` — the emails a bulk-loaded environment logs in
  - `:190-198` `tokenForRole(environment, tokens, role, step)`
  - `:355-375` `seedLeagues(environment, tokens)` — the legacy restore, **kept**
  - `:385-436` `seedLiveTournaments(environment, tokens, leagueIds)` — consumes the ids `seedLeagues` returned
  - `:475-489` `rebuildPlayerStatistics()` — `DELETE FROM player_statistics_meta;`, restart the API, assert `count(*) > 0`
  - `:527-547` the `bulk` branch that calls `bulkLoadStress(...)` then `rebuildPlayerStatistics()`
  - `:549` `await seedLiveTournaments(environment, tokens, leagueIds);`
  - `:562-571` the seeded-volumes console summary
- `scripts/generate-stress-environment.mjs` — the generator:
  - `:49-53` `STRESS_ENVIRONMENT`, `STRESS_DIRECTORY`, `AUDIT_FILE`, `DEFAULT_SEED`
  - `:61-77` `STRESS_VOLUMES`
  - `:80-92` `PAST_DAYS`, `FUTURE_DAYS`, `NATIONAL_YEAR_DAYS`, `ARCHIVE_EPOCH = Date.UTC(2023, 0, 2)`, `ARCHIVE_WEEKS = 170`, `ARCHIVE_SEASON_WEEKS = 17`
  - `:94-98` `MAXIMUM_LEAGUE_BYTES = 1_048_576`, `LEAGUE_BYTE_BUDGET = Math.floor(MAXIMUM_LEAGUE_BYTES * 0.9)`
  - `:239-249` `mulberry32(seed)`; `:251-253` `pad`, `pick`, `between`; `:256-265` `weighted`; `:267-271` `slugify`
  - `:296-304` `drawField(random, candidates, size)`; `:307-310` `fieldSize`; `:312-315` `roundsFor`; `:318-321` `archiveDate(days)`
  - `:389-707` `generateEvents(...)` and its four tiers
  - `:747-796` `playTournament(random, {...})` — the Swiss replay that produces `rounds` and `playerArchetypes`
  - `:799-816` `standings(tournament)`
  - `:818-828` `candidatePool(clubs)`; `:830-840` `decksFor(...)`
  - `:849-988` `generateLeagues(random, volumes, clubs, archetypesFor)` — **the function this ticket replaces**
  - `:995-1003` `assertLeagueBudget(leagues)` — **the function this ticket replaces**
  - `:1006-1035` `generateLiveTournaments(random, volumes, clubs, leagues)`
  - `:1042-1060` `generateAuditRecords(...)`
  - `:1063-1090` `generateStressEnvironment({ seed, scale, root })`
  - `:1098-1117` `writeStressEnvironment(data, directory)` — the file list and the per-file `indented` flag
  - `:1120-1122` `readStressAuditRecords`; `:1124-1132` `parseSeed`; `:1135-1139` `countByTier`
  - `:1141-1170` the CLI block and its console summary
- `scripts/bulk-load-stress.mjs`:
  - `:29` `const CHUNK_SIZE = 500;`; `:35` `const LEAGUE_CHUNK_SIZE = 20;`
  - `:52-70` `requireLocalComposePostgres()` — the Unix-socket + running-`postgres` guard
  - `:73-75` `literal`, `nullable`, `json` SQL helpers
  - `:77-88` `psql(sql, { capture })`
  - `:91-98` `insertStatements(table, columns, rows, chunkSize)`
  - `:126-133` `readUserIds()`
  - `:140-263` `bulkLoadStress({ environment, auditRecords, organizationIds, formatIds, formatSlugs, now })` — the `leagueRows` block at `:196-205` and the `insertStatements('league_archive_aggregates', ...)` call at `:236-238`
- `ops/dev-environments.test.ts` — the fixture gate: `:1-8` imports, `:74-79` `DevEnvironmentLeague`, `:81-93` `DevEnvironment`, `:110-123` `generatedEnvironments` / `shippedNames` / `read`, `:125-131` `validEnvironment()`, `:133-…` the `shipped development environments` describe, `:196-203` `the demo archive carries two leagues…`, `:205-212` `every archive round entry is a match or a bye`.
- `ops/stress-generator.test.ts` — the generator gate: `:20-30` `StressLeague`, `:44-56` `StressDataset`, `:58-59` `REDUCED_SCALE = 0.05` and `generate`, `:61-72` `writeInto` / `readAll`, `:74-88` `playerNames`, `:91-97` `seatsPerPlayer`, and the fifteen cases from `:104` onward.
- `vitest.config.ts` — `include: ['src/**/*.test.ts', 'ops/**/*.test.ts']`, `environment: 'jsdom'`, `globals: true`.
- `.gitignore:17-20` — `/fixtures/dev-environments/stress/*.json` with `!…/environment.json`. The three new stress files are covered by that pattern automatically; do not add a line.
- `package.json` scripts, verbatim: `"dev:env": "node scripts/seed-dev-environment.mjs"`, `"dev:stress:generate": "node scripts/generate-stress-environment.mjs"`, `"test": "vitest run"`, `"lint": "ng lint"`, `"typecheck": "tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.spec.json"`.
- `fixtures/league-domain/v1/manifest.json` — the golden-fixture manifest idiom this ticket copies: `fixtureSet`, `fixtureVersion`, `source`, `serialization: "JSON.stringify(value, null, 2) + LF"`, `paritySha256`, `caseCounts`.
- `fixtures/dev-environments/demo/leagues.json` — the legacy archive fixture: two Leagues (`demo-league-6` completed with three Tournaments, `demo-league-7` active with one), players named `Demo Player NN`, empty `player1DeckArchetype` / `player2DeckArchetype` strings, archetypes carried on `playerArchetypes`. **Left byte-for-byte unchanged by this ticket.**
- `fixtures/dev-environments/demo/live-tournaments.json` — `leagueKey` values `demo-league-6` / `demo-league-7` / `null`, the reason the legacy path stays.

**From Depends (T4) — spell it out, do not go read T4:**

- `POST /api/archive/restore-full` exists, is `.RequireAuthorization(AuthorizationPolicies.Organizer)` **plus** `.RequireAuthorization(AuthorizationPolicies.Admin)`, requires a non-blank `Idempotency-Key` header of at most 200 characters, answers `201` and is **exempt from the 365-day lock** — it is the historical-import path, it mints brand-new ids in one shot and rewrites no protected row.
- Its request body, camelCase on the wire (`ConfigureHttpJsonOptions`, `PropertyNamingPolicy = JsonNamingPolicy.CamelCase`), from the C# record

  ```csharp
  internal sealed record ArchiveRestoreRequest(
      string Kind,
      int Version,
      IReadOnlyList<ArchiveLeagueDocument> Leagues,
      IReadOnlyList<ArchiveLeagueSeasonDocument> LeagueSeasons,
      IReadOnlyList<ArchiveTournamentDocument> Tournaments);
  ```

  is exactly:

  ```json
  {
    "kind": "fullArchive",
    "version": 5,
    "leagues":       [ { "id": "…", "name": "…", "createdAt": "2024-01-08T09:00:00Z" } ],
    "leagueSeasons": [ { "id": "…", "name": "…", "leagueId": "…", "status": "completed" } ],
    "tournaments":   [ { "id": "…", "name": "…", "seasonId": null, "tournamentDate": "2026-04-11",
                         "status": "completed", "rounds": [], "playerArchetypes": [] } ]
  }
  ```

  There is **no** `calendarEvents` key on the restore request and **no** `sourceSeriesId` key on a League. Both are fixture-side only.
- Its response body:

  ```csharp
  internal sealed record ArchiveRestoredId(string SourceId, string Id, string Name, long DocumentVersion, string ETag);
  internal sealed record ArchiveRestoreResponse(
      IReadOnlyList<ArchiveRestoredId> Leagues,
      IReadOnlyList<ArchiveRestoredId> LeagueSeasons,
      IReadOnlyList<ArchiveRestoredId> Tournaments);
  ```

  i.e. `{ "leagues": [{ "sourceId", "id", "name", "documentVersion", "eTag" }], "leagueSeasons": [...], "tournaments": [...] }`. **Restore mints new ids**, so a fixture `id` is a key and never reaches the database; `sourceId` is how you map back to it.
- Validation the restore performs, each answering `400` with wire code `validation_failed`: `kind` must equal the route's expected kind; `version` must be `5`; a `leagueSeasons[].leagueId` absent from the bundle's own Leagues is refused; a non-null `tournaments[].seasonId` absent from the bundle's own Seasons is refused; and each of the three collections has a row cap. The League cap on `/api/archive/restore-full` is **100** — 101 Leagues is refused.
- Re-running the same `Idempotency-Key` with an identical body replays the stored `201` payload and writes nothing; the same key with a different body answers `409`.
- A restored League or Season whose name collides with a stored one is uniquified to `"<name> (restored)"`, then `"<name> (restored) {n}"`.
- The derived lock rule, binding on both stacks: a Tournament locks **365 whole UTC calendar days after the day it was played**. Exactly 365 days old is *not* locked; 366 days old *is*. `POST /api/archive/tournaments` and `PATCH /api/archive/tournaments/{id}` are refused with `409` for a non-Admin when the date is inside the locked window — which is precisely why fixtures go in through restore and never through the interactive create path.
- The three tables the restore writes:

  ```sql
  CREATE TABLE archive_leagues (
    document_id      text PRIMARY KEY,
    name             text NOT NULL,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    version          integer NOT NULL,
    deleted_at       timestamptz NULL
  );

  CREATE TABLE archive_league_seasons (
    document_id            text PRIMARY KEY,
    league_id              text NOT NULL REFERENCES archive_leagues(document_id),
    name                   text NOT NULL,
    status                 text NOT NULL,
    updated_at             timestamptz NOT NULL,
    version                integer NOT NULL,
    deleted_at             timestamptz NULL,
    tournament_count       integer NOT NULL,
    player_count           integer NOT NULL,
    first_tournament_date  date NULL,
    last_tournament_date   date NULL,
    counts_version         integer NOT NULL
  );

  CREATE TABLE archive_tournaments (
    document_id      text PRIMARY KEY,
    season_id        text NULL REFERENCES archive_league_seasons(document_id),
    name             text NOT NULL,
    tournament_date  date NOT NULL,
    status           text NOT NULL,
    document         jsonb NOT NULL,
    updated_at       timestamptz NOT NULL,
    version          integer NOT NULL,
    deleted_at       timestamptz NULL,
    player_count     integer NOT NULL,
    counts_version   integer NOT NULL
  );
  ```

  Check constraints the bulk loader must satisfy, verbatim:

  | Table | Constraint | Expression |
  | --- | --- | --- |
  | `archive_leagues` | `ck_archive_league_version_positive` | `version > 0` |
  | `archive_league_seasons` | `ck_archive_league_season_version_positive` | `version > 0` |
  | `archive_league_seasons` | `ck_archive_league_season_status` | `status IN ('active', 'completed')` |
  | `archive_league_seasons` | `ck_archive_league_season_counts_non_negative` | `tournament_count >= 0 AND player_count >= 0` |
  | `archive_league_seasons` | `ck_archive_league_season_count_dates` | `(first_tournament_date IS NULL) = (last_tournament_date IS NULL) AND (first_tournament_date IS NULL OR first_tournament_date <= last_tournament_date)` |
  | `archive_tournaments` | `ck_archive_tournament_version_positive` | `version > 0` |
  | `archive_tournaments` | `ck_archive_tournament_status` | `status IN ('active', 'completed')` |
  | `archive_tournaments` | `ck_archive_tournament_player_count_non_negative` | `player_count >= 0` |
  | `archive_tournaments` | `ck_archive_tournament_document_object` | `jsonb_typeof(document) = 'object'` |
  | `archive_tournaments` | `ck_archive_tournament_document_size` | `octet_length(document::text) <= 1048576` |
  | `archive_tournaments` | `ck_archive_tournament_document_metadata` | `document ->> 'id' = document_id AND document ->> 'name' = name AND document ->> 'status' = status AND document ->> 'seasonId' IS NOT DISTINCT FROM season_id` |

  `document ->> 'seasonId' IS NOT DISTINCT FROM season_id` holds for a standalone Tournament because the server's JSON options set `DefaultIgnoreCondition = WhenWritingNull`: a null `seasonId` is **omitted** from the JSON, and `->>` on an absent key yields SQL `NULL`. **The bulk loader must omit the key too, never write `"seasonId": null` into `document`.**
- The domain ceilings on one Tournament: `MaximumDocumentBytes = 1_048_576`, `MaximumRounds = 1_000`, `MaximumEntries = 100_000`, `MaximumNameLength = 200`, `MaximumDocumentIdLength = 200`. The megabyte is now **per Tournament**, not per League — that is a change from the legacy archive, where a whole League document shared one megabyte.
- The denormalized counter formula version is `1`, so every bulk-written row carries `counts_version = 1`. A freshly restored row carries `version = 1`.
- The Season counters the server computes: `tournament_count` is the Season's live Tournament count; `player_count` is the standings row count over **all** the Season's Tournaments taken together; `first_tournament_date` / `last_tournament_date` are the minimum and maximum `tournament_date` of those Tournaments, both `NULL` when the Season has none.
- A Tournament's `player_count` is its standings row count. The standings rule, from `backend/src/Gones.Domain/Leagues/LeagueRules.cs:512-542` and `:7-31`: one row per distinct **trimmed** player name appearing in a **valid** entry. A `bye` entry is valid when its `playerName` trims to a non-empty string that is not `"bye"` case-insensitively; a `match` entry is valid when both names trim non-empty, differ, are not `"bye"`, and both scores are in `0..2`. An `invalid` entry never counts.

**From Depends (T8) — spell it out, do not go read T8:**

- `player_statistics` is keyed `(scope_kind, scope_id, player_name)` with `scope_kind IN ('global','league','season')` and `scope_id = ''` exactly when `scope_kind = 'global'`.
- The rebuild reads the **new** archive tables — `SELECT document_id, season_id, name, tournament_date::text, status, document::text FROM archive_tournaments WHERE deleted_at IS NULL`, joined to `archive_league_seasons` for the League link. **Only `status = 'completed'` Tournaments contribute** to any scope; `active` and soft-deleted ones contribute nothing.
- A standalone Tournament (`season_id IS NULL`) feeds the `global` scope **only**.
- The `global` scope **also** folds in the legacy `league_archive_aggregates` rows, until the legacy surface is retired. That legacy half is deleted by the retire-legacy ticket, not by this one.
- The rebuild is triggered on startup when `player_statistics_meta` does not match the current formula version, which is what `scripts/seed-dev-environment.mjs:475-489` already exploits: `DELETE FROM player_statistics_meta;` then `docker compose restart api`. **That mechanism is unchanged and keeps working** — after this ticket it recomputes from `archive_tournaments` instead of only from `league_archive_aggregates`.

## Interface contract (level 5)

### Produces — fixture file format

Three new **optional** files per environment directory, each a JSON array, each missing-means-empty:

```
fixtures/dev-environments/<name>/
  archive-leagues.json         optional   [ ArchiveLeagueFixture ]
  archive-league-seasons.json  optional   [ ArchiveLeagueSeasonFixture ]
  archive-tournaments.json     optional   [ ArchiveTournamentFixture ]
```

```jsonc
// ArchiveLeagueFixture
{
  "id": "demo-archive-league-gones",          // string, 1..200 chars, unique across the file
  "name": "Gones League",                     // string, 1..200 chars, free string
  "createdAt": "2024-01-08T09:00:00Z",        // ISO 8601 UTC instant
  "sourceSeriesId": null                      // REQUIRED and always null — see the invariant below
}

// ArchiveLeagueSeasonFixture
{
  "id": "demo-archive-season-gones-3",        // string, 1..200 chars, unique across the file
  "name": "Season 3",                         // FREE STRING, 1..200 chars — never parsed as a year
  "leagueId": "demo-archive-league-gones",    // must name an ArchiveLeagueFixture id in the same environment
  "status": "completed"                       // "active" | "completed"
}

// ArchiveTournamentFixture
{
  "id": "demo-arch-t-gones3-01",              // string, 1..200 chars, unique across the file
  "name": "Manche 1",                         // string, 1..200 chars
  "seasonId": "demo-archive-season-gones-3",  // string naming an ArchiveLeagueSeasonFixture id, or null for standalone
  "tournamentDate": "2024-09-05",             // ISO YYYY-MM-DD, absolute, never in the future
  "status": "completed",                      // "active" | "completed"
  "rounds": [                                 // RoundDocument[]
    { "id": "demo-arch-t-gones3-01-r1", "entries": [ /* RoundEntry[] */ ] }
  ],
  "playerArchetypes": [                       // PlayerArchetypeDocument[]
    { "playerName": "Demo Archive Player 01", "archetype": "Boros Energy" }
  ]
}
```

`RoundEntry` is the existing polymorphic shape, `kind` first, unchanged from `leagues.json`:

```jsonc
{ "kind": "match", "id": "…", "table": "1", "player1Name": "…", "player2Name": "…",
  "player1Score": 2, "player2Score": 0, "player1DeckArchetype": "", "player2DeckArchetype": "" }
{ "kind": "bye",   "id": "…", "table": "3", "playerName": "…", "deckArchetype": "" }
```

`sourceSeriesId` is a **fixture-only provenance marker and is stripped before the wire**. It is required, and required to be `null`, because public MTG archives expose no series and no season field at all — verified on a real mtgtop8 event record, which carries a title, a venue, a format, a star rating, a player count, a date and decklists, and nothing else. The League tier is this project's own construct, and the fixture states that in a machine-checkable way rather than in a comment.

### Produces — `scripts/dev-environments.mjs`

```js
export const DATA_FILES = [
  'accounts', 'organizations', 'formats', 'tournaments', 'registrations',
  'leagues', 'liveTournaments',
  'archiveLeagues', 'archiveLeagueSeasons', 'archiveTournaments'
];

/** The archive fixture keys, in bundle order. Every one of them is also a DATA_FILES key. */
export const ARCHIVE_DATA_FILES = ['archiveLeagues', 'archiveLeagueSeasons', 'archiveTournaments'];

/** Export bundle version the three-tier archive speaks. */
export const ARCHIVE_DATA_VERSION = 5;
/** `kind` discriminator POST /api/archive/restore-full expects. */
export const ARCHIVE_RESTORE_KIND = 'fullArchive';
/** The one route a whole-bundle fixture restore goes through. */
export const ARCHIVE_RESTORE_PATH = '/api/archive/restore-full';
/** A Tournament locks this many whole UTC calendar days after the day it was played. */
export const ARCHIVE_LOCK_WINDOW_DAYS = 365;
/** The server's per-Tournament document ceiling. */
export const ARCHIVE_MAXIMUM_TOURNAMENT_BYTES = 1_048_576;
/** Row caps the restore endpoint enforces; a fixture over them would be refused mid-reset. */
export const ARCHIVE_RESTORE_CAPS = { leagues: 100, leagueSeasons: 500, tournaments: 2000 };

/**
 * The `ArchiveRestoreRequest` body for one environment: the three fixture arrays, with the
 * fixture-only `sourceSeriesId` provenance marker stripped off every League.
 */
export function buildArchiveBundle(environment) {
  return {
    kind: ARCHIVE_RESTORE_KIND,
    version: ARCHIVE_DATA_VERSION,
    leagues: (environment.archiveLeagues ?? []).map(({ sourceSeriesId, ...league }) => league),
    leagueSeasons: [...(environment.archiveLeagueSeasons ?? [])],
    tournaments: [...(environment.archiveTournaments ?? [])]
  };
}

/** True when a fixture round entry is one the server's standings pass counts. */
export function isCountedArchiveEntry(entry) { /* … */ }

/** The distinct trimmed player names one Tournament's valid entries name. */
export function archiveTournamentPlayers(tournament) { /* … returns Set<string> */ }

/** `player_count` for one Tournament: its standings row count. */
export function countArchiveTournamentPlayers(tournament) { /* … returns number */ }

/** `player_count` for a Season: the standings row count over all its Tournaments together. */
export function countArchiveSeasonPlayers(tournaments) { /* … returns number */ }

/**
 * The derived lock rule, mirrored from the domain: locked ⇔ more than 365 whole UTC calendar days
 * have passed since the day it was played. Exactly 365 is not locked; 366 is.
 */
export function isArchiveTournamentLocked(tournamentDate, today = new Date()) { /* … returns boolean */ }

/** [] when valid; one human-readable string per problem otherwise. */
export function validateEnvironment(environment, { today = new Date() } = {}) { /* … */ }
```

Exact bodies, binding — these are not paraphrases:

```js
export function isCountedArchiveEntry(entry) {
  if (entry === null || typeof entry !== 'object') return false;
  const reserved = (value) => String(value ?? '').trim().toLowerCase() === 'bye';
  if (entry.kind === 'bye') {
    const player = String(entry.playerName ?? '').trim();
    return player.length > 0 && !reserved(player);
  }
  if (entry.kind !== 'match') return false;
  const player1 = String(entry.player1Name ?? '').trim();
  const player2 = String(entry.player2Name ?? '').trim();
  if (player1.length === 0 || player2.length === 0 || player1 === player2) return false;
  if (reserved(player1) || reserved(player2)) return false;
  return [entry.player1Score, entry.player2Score].every((score) => Number.isInteger(score) && score >= 0 && score <= 2);
}

export function archiveTournamentPlayers(tournament) {
  const players = new Set();
  for (const round of tournament.rounds ?? []) {
    for (const entry of round.entries ?? []) {
      if (!isCountedArchiveEntry(entry)) continue;
      if (entry.kind === 'bye') players.add(String(entry.playerName).trim());
      else {
        players.add(String(entry.player1Name).trim());
        players.add(String(entry.player2Name).trim());
      }
    }
  }
  return players;
}

export const countArchiveTournamentPlayers = (tournament) => archiveTournamentPlayers(tournament).size;

export function countArchiveSeasonPlayers(tournaments) {
  const players = new Set();
  for (const tournament of tournaments) for (const player of archiveTournamentPlayers(tournament)) players.add(player);
  return players.size;
}

export function isArchiveTournamentLocked(tournamentDate, today = new Date()) {
  const played = Date.parse(`${tournamentDate}T00:00:00Z`);
  if (Number.isNaN(played)) return false;
  const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((day - played) / 86_400_000) > ARCHIVE_LOCK_WINDOW_DAYS;
}
```

### Produces — `validateEnvironment` archive rules

Appended after the existing legacy-`leagues` block and before the `liveTournaments` block. Every message keeps the existing `` `${label}: ` `` prefix. `ISO_DATE = /^\d{4}-\d{2}-\d{2}$/`.

| # | Condition | Exact message |
| --- | --- | --- |
| 1 | League `id` or `name` blank | `${label}: archive League "${league.id ?? '(no id)'}" needs a non-empty id and name` |
| 2 | League `id` seen twice | `${label}: duplicate archive League id ${league.id}` |
| 3 | `'sourceSeriesId' in league === false` or `league.sourceSeriesId !== null` | `${label}: archive League ${league.id} must declare "sourceSeriesId": null — public archives expose no series field` |
| 4 | Season `id` or `name` blank | `${label}: archive League Season "${season.id ?? '(no id)'}" needs a non-empty id and name` |
| 5 | Season `id` seen twice | `${label}: duplicate archive League Season id ${season.id}` |
| 6 | `season.leagueId` names no fixture League | `${label}: archive League Season ${season.id} references unknown archive League ${season.leagueId}` |
| 7 | `season.status` not in `['active','completed']` | `${label}: archive League Season ${season.id} has status "${season.status}", expected one of active, completed` |
| 8 | Tournament `id` or `name` blank | `${label}: archive Tournament "${tournament.id ?? '(no id)'}" needs a non-empty id and name` |
| 9 | Tournament `id` seen twice | `${label}: duplicate archive Tournament id ${tournament.id}` |
| 10 | `seasonId` is neither `null` nor a fixture Season id | `${label}: archive Tournament ${tournament.id} references unknown archive League Season ${tournament.seasonId}` |
| 11 | `tournament.status` not in `['active','completed']` | `${label}: archive Tournament ${tournament.id} has status "${tournament.status}", expected one of active, completed` |
| 12 | `tournamentDate` fails `ISO_DATE` or `Number.isNaN(Date.parse(…))` | `${label}: archive Tournament ${tournament.id} has tournamentDate "${tournament.tournamentDate}", expected an ISO YYYY-MM-DD date` |
| 13 | `tournamentDate` is after `today` in UTC | `${label}: archive Tournament ${tournament.id} is dated in the future (${tournament.tournamentDate}) — an archive is history (ADR 0030)` |
| 14 | a round entry `kind` not in `['match','bye']` | `${label}: archive Tournament ${tournament.id} has a round entry of kind "${entry.kind}", expected one of match, bye` |
| 15 | `Buffer.byteLength(JSON.stringify(tournament), 'utf8') > ARCHIVE_MAXIMUM_TOURNAMENT_BYTES` | `${label}: archive Tournament ${tournament.id} is ${bytes} bytes, over the ${ARCHIVE_MAXIMUM_TOURNAMENT_BYTES} byte document limit the server refuses` |
| 16 | a collection exceeds its cap | `${label}: the archive carries ${n} ${collection}, over the ${cap} the restore endpoint accepts` where `collection` is one of `Leagues`, `League Seasons`, `Tournaments` |
| 17 | `resetDatabase === false` while any archive array is non-empty | *(already covered by the existing `carriesData` rule, because `DATA_FILES` now names the three keys — no new message)* |

Rules 1-16 run for every environment, generated ones included. Rule 13 is the only clock-dependent rule; `today` is injectable so the gate stays deterministic.

### Produces — `scripts/seed-dev-environment.mjs`

```js
/**
 * The whole three-tier archive of an environment in one `POST /api/archive/restore-full`.
 *
 * Restore is the only path a fixture archive can take: its dates are absolute history, and the
 * interactive create route refuses a non-Admin a Tournament older than 365 days with `409`. Restore is
 * exempt from that lock by design — it mints new ids and rewrites no protected row.
 *
 * Restore mints new identities, so a fixture `id` is only a key; the server's `sourceId` is what maps
 * back to it. Returns `{ leagues, leagueSeasons, tournaments }`, three `Map<fixtureId, serverId>`.
 */
async function seedArchive(environment, tokens) { /* … */ }
```

Behaviour, binding:

- Returns three empty `Map`s immediately when all three arrays are empty. It must spend no token and make no call for an environment with no archive.
- Token: `tokenForRole(environment, tokens, 'Admin', 'archive')` — `restore-full` is Admin-gated.
- One call: `api('POST', ARCHIVE_RESTORE_PATH, { token, body: buildArchiveBundle(environment), idempotencyKey: `${environment.name}-archive-restore-full` })`.
- Failure goes through the existing `requireResponse(response, 'archive', 'restore-full')`, which prints `Seeding archive failed for restore-full: <status> <body>` and exits `1`.
- Success maps the response: `new Map(body.leagues.map(({ sourceId, id }) => [sourceId, id]))`, and likewise for `leagueSeasons` and `tournaments`.

Call sites:

- Non-bulk branch: after `leagueIds = await seedLeagues(environment, tokens);`, add `archiveIds = await seedArchive(environment, tokens);`.
- Bulk branch: `bulkLoadStress` returns `archiveIds` alongside `eventIds` / `leagueIds`; the branch assigns it and the existing console line gains the three archive counts.
- `seedLiveTournaments(environment, tokens, leagueIds)` keeps taking the **legacy** `leagueIds` map. It is unchanged.
- The seeded-volumes summary at `:562-571` gains three rows, placed after `league archives`:

  ```js
  [archiveIds.leagues.size, 'archive Leagues'],
  [archiveIds.leagueSeasons.size, 'archive League Seasons'],
  [archiveIds.tournaments.size, 'archive Tournaments'],
  ```

### Produces — `scripts/generate-stress-environment.mjs`

```js
/** Tournaments a Season really runs, as the public archives report it. Weights sum to 94. */
export const SEASON_SIZE_CLASSES = [
  { key: 'championship',   minimum: 1,  maximum: 1,  weight: 4 },   // a World Championship is one event
  { key: 'proTour',        minimum: 3,  maximum: 4,  weight: 10 },  // the modern Pro Tour
  { key: 'regional',       minimum: 6,  maximum: 6,  weight: 8 },   // Regional Championships
  { key: 'spotlight',      minimum: 8,  maximum: 11, weight: 12 },  // Spotlight Series
  { key: 'earlyGrandPrix', minimum: 5,  maximum: 13, weight: 18 },  // Grand Prix, early seasons
  { key: 'weekly',         minimum: 7,  maximum: 20, weight: 40 },  // a store league's weekly legs
  { key: 'lateGrandPrix',  minimum: 50, maximum: 60, weight: 2 }    // Grand Prix, late seasons
];

/** How a real Season labels itself. A Season name is a FREE STRING; none of these is a year column. */
export const SEASON_LABEL_STYLES = [
  { key: 'year',        weight: 34 },  // "2025"
  { key: 'crossYear',   weight: 14 },  // "2025-26" — autumn-to-spring, or August-to-August
  { key: 'numbered',    weight: 18 },  // "Season 3"
  { key: 'numberedLeg', weight: 10 },  // "Season 5 - Round 2"
  { key: 'yearSlash',   weight: 12 },  // "2026/2"
  { key: 'ordinalLeg',  weight: 8 },   // "3ª Etapa Regular - 2026/2"
  { key: 'namedLeg',    weight: 4 }    // "<League name> - Primeira Etapa"
];

/** Names carrying no series signal at all. These must become standalone Tournaments, never Leagues. */
export const DEGENERATE_TOURNAMENT_NAMES = ['Series', '1K', 'FNM', 'Weekly'];

/** The one date every generated archive date is measured against. Absolute, declared, clock-free. */
export const ARCHIVE_ANCHOR_DATE = '2026-08-22';

/** 90% of the server's per-Tournament ceiling. The bulk loader writes rows the domain never validated. */
export const MAXIMUM_TOURNAMENT_BYTES = 1_048_576;

/** Throws on the first Tournament over budget. Never trims — a silently shortened event is a lie. */
export function assertTournamentBudget(tournaments) { /* … returns tournaments */ }

/** The three-tier archive: `{ leagues, leagueSeasons, tournaments }`. */
function generateArchive(random, volumes, clubs, archetypesFor) { /* … */ }

/** One legacy `league_archive_aggregates` stub per Live tournament that names a League. */
function generateLiveReferenceLeagues(liveTournaments, clubs) { /* … */ }

/** `{ championship: n, proTour: n, … }` for the console summary and the tests that gate the spread. */
export function countBySeasonSizeClass(leagueSeasons) { /* … */ }
```

`STRESS_VOLUMES` gains one key and keeps every existing one:

```js
export const STRESS_VOLUMES = {
  /* …every current key, unchanged… */
  /** Tournaments that belong to no Season. The archive is full of one-off events with no series. */
  standaloneTournaments: 120
};
```

`writeStressEnvironment`'s file list gains three entries, all compact (`indented: false`), inserted immediately after `['leagues.json', data.leagues, false]`:

```js
['archive-leagues.json', data.archiveLeagues, true],
['archive-league-seasons.json', data.archiveLeagueSeasons, true],
['archive-tournaments.json', data.archiveTournaments, false],
```

`generateStressEnvironment` returns three more keys — `archiveLeagues`, `archiveLeagueSeasons`, `archiveTournaments` — alongside everything it returns today. `leagues` stays in the return, now holding only the reference stubs.

Generated-shape invariants, binding:

| Field | Value |
| --- | --- |
| League `id` | `stress-archive-league-<slug>` |
| League `sourceSeriesId` | **always `null`** |
| League `createdAt` | `${archiveDate(firstDay)}T09:00:00Z` of its earliest Season's first Tournament |
| Season `id` | `stress-archive-season-<leagueSlug>-s<NN>` |
| Season `name` | drawn from `SEASON_LABEL_STYLES`, a free string, never re-derivable from the id |
| Tournament `id` | `stress-archive-tournament-<seasonSlug>-<NN>`, or `stress-archive-tournament-standalone-<NNN>` |
| Tournament `seasonId` | the Season id, or `null` for a standalone |
| Tournament `tournamentDate` | absolute `YYYY-MM-DD`, `archiveDate(...)` off the fixed epoch, never after `ARCHIVE_ANCHOR_DATE` |
| Tournament `status` | `'completed'`, except the last Tournament of an `active` Season, which is `'active'` |

### Produces — `scripts/bulk-load-stress.mjs`

```js
/** A Tournament row carries a whole document; twenty per statement, like the legacy League rows. */
const TOURNAMENT_CHUNK_SIZE = 20;

/**
 * The stored `document` jsonb, byte-compatible with what the server writes: camelCase keys, and
 * `seasonId` OMITTED when null so `document ->> 'seasonId' IS NOT DISTINCT FROM season_id` holds.
 */
function archiveTournamentDocument(tournament) {
  const document = {
    id: tournament.id,
    name: tournament.name,
    tournamentDate: tournament.tournamentDate,
    status: tournament.status,
    rounds: tournament.rounds,
    playerArchetypes: tournament.playerArchetypes
  };
  return tournament.seasonId === null || tournament.seasonId === undefined
    ? document
    : { ...document, seasonId: tournament.seasonId };
}
```

`bulkLoadStress` gains three row builders and three `insertStatements` calls, emitted **in this order** — `archive_leagues`, then `archive_league_seasons`, then `archive_tournaments` — because the foreign keys are checked immediately, not deferred:

```js
...insertStatements('archive_leagues', [
  'document_id', 'name', 'created_at', 'updated_at', 'version', 'deleted_at'
], archiveLeagueRows),
...insertStatements('archive_league_seasons', [
  'document_id', 'league_id', 'name', 'status', 'updated_at', 'version', 'deleted_at',
  'tournament_count', 'player_count', 'first_tournament_date', 'last_tournament_date', 'counts_version'
], archiveSeasonRows),
...insertStatements('archive_tournaments', [
  'document_id', 'season_id', 'name', 'tournament_date', 'status', 'document', 'updated_at',
  'version', 'deleted_at', 'player_count', 'counts_version'
], archiveTournamentRows, TOURNAMENT_CHUNK_SIZE),
```

Column values, binding:

| Column | Value |
| --- | --- |
| every `version` | `'1'` |
| every `counts_version` | `'1'` |
| every `deleted_at` | `'NULL'` |
| `archive_leagues.created_at` | `literal(league.createdAt)` |
| every `updated_at` | `literal(new Date(now.getTime() - index * 61_000).toISOString())`, `index` being the row's position in its own collection |
| `archive_league_seasons.tournament_count` | the Season's Tournament count |
| `archive_league_seasons.player_count` | `countArchiveSeasonPlayers(seasonTournaments)` |
| `archive_league_seasons.first/last_tournament_date` | `nullable(min/max tournamentDate)`, both `NULL` when the Season is empty |
| `archive_tournaments.player_count` | `countArchiveTournamentPlayers(tournament)` |
| `archive_tournaments.document` | `json(archiveTournamentDocument(tournament))` |

`bulkLoadStress` returns one more key:

```js
return {
  eventIds,
  leagueIds: new Map(environment.leagues.map((league) => [league.id, league.id])),
  archiveIds: {
    leagues: new Map(environment.archiveLeagues.map((league) => [league.id, league.id])),
    leagueSeasons: new Map(environment.archiveLeagueSeasons.map((season) => [season.id, season.id])),
    tournaments: new Map(environment.archiveTournaments.map((tournament) => [tournament.id, tournament.id]))
  },
  counts: { events, registrations, leagues, auditRecords, archiveLeagues, archiveLeagueSeasons, archiveTournaments }
};
```

A bulk-inserted row keeps its fixture id — `document_id` **is** the primary key and nothing mints a new one, unlike the HTTP restore path.

The `updated_at` spread is deliberate and documented in the file: the catalog reads order by `updated_at DESC, document_id ASC`, and a bulk load that stamped one identical instant on two thousand rows would collapse that ordering onto the id and hide every ordering bug the environment exists to surface. 61 seconds per row is a synthetic, seed-independent, strictly descending spread.

### Produces — `fixtures/archive-domain/v5/`

```
fixtures/archive-domain/v5/
  bundle.json     the frozen v5 archive bundle, exactly buildArchiveBundle(readEnvironment('demo'))
  manifest.json   metadata, the bundle's SHA-256, and the case counts
```

`bundle.json` serialization, binding: `JSON.stringify(bundle, null, 2) + '\n'`.

`manifest.json`, binding shape:

```json
{
  "fixtureSet": "gones-archive-domain-v5",
  "fixtureVersion": 5,
  "archiveDataVersion": 5,
  "source": {
    "environment": "fixtures/dev-environments/demo",
    "files": ["archive-leagues.json", "archive-league-seasons.json", "archive-tournaments.json"],
    "assembler": "buildArchiveBundle (scripts/dev-environments.mjs)"
  },
  "serialization": "JSON.stringify(bundle, null, 2) + LF",
  "bundleSha256": "<64 lowercase hex characters>",
  "anchorDate": "2026-08-22",
  "provenance": {
    "sourceSeriesId": null,
    "note": "Public MTG archives expose no series and no season field. A real mtgtop8 event record carries a title, a venue, a format, a star rating, a player count, a date and decklists, and nothing else. The League tier is this project's own construct."
  },
  "caseCounts": {
    "leagues": 8,
    "leagueSeasons": 12,
    "tournaments": 48,
    "standaloneTournaments": 5,
    "emptySeasons": 1,
    "crossYearSeasons": 2,
    "lockedTournaments": 24,
    "unlockedTournaments": 24,
    "leaguesEmbeddingAnotherLeagueName": 1,
    "seasonsEmbeddingTheirLeagueName": 1,
    "degenerateStandaloneNames": 4,
    "nonAsciiNames": 5,
    "distinctSeasonSizes": 8
  }
}
```

`lockedTournaments` / `unlockedTournaments` are measured against `anchorDate`, never against the clock, so the count is stable forever.

### Consumes

- `POST /api/archive/restore-full` — request, response, caps, idempotency, lock exemption and uniquification exactly as written under *Inputs → From Depends (T4)*. Binding; do not redesign.
- `archive_leagues` / `archive_league_seasons` / `archive_tournaments` — the DDL and the eleven check constraints above. Binding.
- `POST /api/live-tournaments` — unchanged, still resolving `leagueId` against `league_archive_aggregates`.
- `POST /api/leagues-archive/restore` — unchanged, still the legacy `seedLeagues` path.
- The startup `player_statistics` rebuild trigger — `DELETE FROM player_statistics_meta;` then `docker compose restart api`. Unchanged.

### Errors

| Path | Failure | Behaviour |
| --- | --- | --- |
| `validateEnvironment` | any rule 1-16 | one string per problem, `[]` when clean. Never throws. |
| `seed-dev-environment.mjs` | `validateEnvironment` non-empty | prints each problem, `process.exit(2)` — the existing behaviour, before any Docker reset |
| `seedArchive` | environment declares no verified `Admin` | `tokenForRole` prints `Seeding archive failed: the environment declares no verified Admin account.` and exits `1` |
| `seedArchive` | restore answers a non-2xx | `requireResponse` prints `Seeding archive failed for restore-full: <status> <body>` and exits `1` |
| `seedArchive` | restore answers `400` with `errors.kind` | same message. **The body will name the expected kind.** If it does, the fix is the one-line `ARCHIVE_RESTORE_KIND` constant — see D1. |
| `assertTournamentBudget` | a generated Tournament over 90% of 1 MiB | `throw new Error(`Archive Tournament ${id} is ${bytes} bytes, over the ${budget} byte budget the domain reads back.`)`. Throws, never trims. |
| `bulkLoadStress` | Docker not a local Unix socket, or `postgres` not up | the existing `requireLocalComposePostgres()` guard, `process.exit(2)` |
| `bulkLoadStress` | psql refuses the SQL | the existing `Bulk load failed: psql refused the generated SQL.` and the psql exit code |

### Invariants

- **One authored source of archive truth.** `fixtures/dev-environments/demo/archive-*.json` are authored; `fixtures/archive-domain/v5/bundle.json` is assembled from them and gated by a test. Nothing else in the repository hand-writes a v5 bundle.
- **`sourceSeriesId` never reaches the wire or the database.** It exists on the fixture row, is asserted `null` by `validateEnvironment`, and is stripped by `buildArchiveBundle`. The bulk loader's `archive_leagues` row builder must not name it either.
- **`seasonId: null` is omitted from the stored `document`, never written as JSON null.** The `ck_archive_tournament_document_metadata` constraint depends on it.
- **Archive dates are absolute and never in the future.** Rule 13 enforces it. Calendar Events and running tournaments keep their relative offsets; nothing in this ticket changes them.
- **The lock window is measured against a declared anchor in the tests, against the real clock at runtime.** `ARCHIVE_ANCHOR_DATE` / `manifest.anchorDate` is `2026-08-22`; the newest fixture Tournament is `2026-07-11`, so roughly ten months of runway separate the fixtures from the day the last unlocked row locks. Past that date every fixture Tournament is locked and the unlocked path stops being reachable in dev until the fixtures are re-dated. Documented in the README; see D2.
- **Determinism.** The generator reads no clock and draws only through `mulberry32`. `--seed=1` twice produces byte-identical `archive-*.json`. The `is deterministic` case gates it.
- **Season names are free strings.** No code path in this ticket parses a Season name into a year, sorts by a parsed year, or derives a Season from a Tournament name. `SEASON_LABEL_STYLES` exists to make that structurally impossible to forget.
- **Standalone Tournaments contribute to the `global` player-statistics scope only.** They name no Season and therefore no League. Nothing in the fixtures may give one a `leagueId`; the tier does not have that field.
- **`status = 'active'` Tournaments contribute to no scope.** Every generated Season keeps at least one `completed` Tournament, so no Season is statistically empty.
- **Ordering.** `buildArchiveBundle` preserves fixture file order in all three collections. The bulk loader inserts leagues → seasons → tournaments. Both are load-bearing: the first for the golden bundle's byte stability, the second for the foreign keys.
- **Idempotency.** Re-running `npm run dev:env -- --env=demo` against a stack that already carries the dataset replays the stored restore response through the `Idempotency-Key` and writes nothing.
- **Units.** `tournamentDate` is a calendar date, no time and no zone. `createdAt` and `updatedAt` are UTC instants. `documentVersion` and `version` start at `1`.

## Decisions taken inside this ticket

- **D1 — the restore `kind` is `"fullArchive"` and the route is `/api/archive/restore-full`.** Both restore routes share one `ArchiveRestoreRequest`; the predecessor ticket pins only that `kind: "fullArchive"` is *wrong* on `/api/archive/restore`, which makes it the kind `/restore-full` expects, mirroring the legacy pairing `"league"` ↔ `/restore` and `"fullData"` ↔ `/restore-full`. `/restore-full` is also the route with a *stated* row cap (100 Leagues) and the seeder already holds an Admin token, so it is the one route whose contract is fully known. The value is a single exported constant, `ARCHIVE_RESTORE_KIND`, so a one-line edit corrects it if the implementation chose otherwise. Reported.
- **D2 — the fixture archive is dated against a declared anchor, and it ages.** ADR 0030 forbids relative archive dates and the generator forbids reading the clock, so "a Tournament that is always inside the 365-day window" is not expressible. The fixtures are therefore dated so that the newest Tournament sits about six weeks before `ARCHIVE_ANCHOR_DATE = 2026-08-22`, giving ten months before the last unlocked row locks; the tests measure the lock against that anchor and are stable forever; and the README documents the refresh. The alternative — a clock-reading generator — would break byte-for-byte determinism, which is the property the whole stress environment rests on.
- **D3 — `demo` keeps its legacy `leagues.json` in full; `stress` reduces its to reference stubs.** `live-tournaments.json` needs a legacy League row to point at in both, so neither may drop the path. `demo`'s legacy archive is 22 KB and four Tournaments — cheap, and it keeps the legacy pages, the manual test checklist and `ops/dev-environments.test.ts:196-212` working untouched, at the cost of a dev-only double count in the `global` rankings scope until the legacy surface is retired. `stress`'s legacy archive is **44 MB and 1,800 Tournaments** — keeping it beside a full three-tier archive would double the dataset, double the seed time and double every global-scope number, so it becomes one empty stub per referenced `leagueKey`. The asymmetry is a size decision, and it is documented in the README.
- **D4 — three fixture arrays, not one bundle object.** `readEnvironment` gives every `DATA_FILES` key an array default and both the seeder and `validateEnvironment` call `.length` on it; a single `archive.json` holding a bundle object would need a special case at four call sites. `fileNameFor` already turns `archiveLeagues` into `archive-leagues.json`, so three array files need no new machinery at all.
- **D5 — `scripts/dev-environments.mjs` and `ops/dev-environments.test.ts` are edited even though the fence lists neither.** They are the loader and the gate for exactly the fixture files the fence puts in scope; a new fixture file type is unreachable without them. No other file outside the fence is touched. Reported.
- **D6 — `fixtures/archive-domain/v5/` is a golden *bundle*, not a golden *parity* set.** The existing `fixtures/league-domain/v1/` is a TypeScript↔C# domain parity corpus emitted by `src/app/domain/league-parity-fixtures.test.ts` — a frontend test, which this fence forbids. What T9 can own, and what the export/import and retire-legacy tickets actually need, is the frozen v5 bundle contract sample. It is assembled from `demo`, hash-stamped, and gated. `fixtures/league-domain/v1/` is **not** deleted here: `backend/tests/Gones.UnitTests/LeagueParityTests.cs` and `backend/tests/Gones.IntegrationTests/LeagueArchiveRouteTests.cs:165-170` still read it, and deleting legacy is the retire-legacy ticket's job. Reported.
- **D7 — the demo fixture exercises the structural cases; the stress generator exercises the volume cases.** A 50-to-60-Tournament Season belongs in generated data, not in a hand-authored 48-Tournament fixture. `demo` carries Season sizes `0, 1, 1, 1, 2, 2, 3, 3, 4, 7, 8, 11` — eight distinct sizes, a 0-to-11 spread — plus five standalone Tournaments; `stress` carries the full `SEASON_SIZE_CLASSES` spread including the 50-60 class.

## TDD

1. **Red** — write every test below first and watch it fail. Order: the loader cases (they fail on a missing export), then the fixture cases (they fail on a missing file), then the generator cases, then the golden-set cases.
2. **Green** — the minimum code that passes each: the loader constants and helpers, then the fixtures, then the seeder, then the generator, then the bulk loader.
3. **Refactor** — only the console summaries and the README. Keep green.

## Test plan

Run everything with `npx vitest run ops/dev-environments.test.ts ops/stress-generator.test.ts ops/archive-domain-fixtures.test.ts`, and the whole suite with `npm run test`.

### `ops/dev-environments.test.ts` — new `describe('three-tier archive fixtures', …)`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `every shipped environment still validates with an archive` | `read(name)` for each of `shippedNames` | `validateEnvironment(environment, { today: ANCHOR })` is `[]` |
| `the demo archive carries eight Leagues, twelve Seasons and forty-eight Tournaments` | `read('demo')` | `archiveLeagues` length `8`, `archiveLeagueSeasons` length `12`, `archiveTournaments` length `48` |
| `every demo archive League declares a null sourceSeriesId` | `read('demo').archiveLeagues` | every entry has the own property `sourceSeriesId` and its value is `null` |
| `every demo archive Season names a League that exists` | `read('demo')` | the set of `leagueId` values is a subset of the League ids, and every League has at least one Season |
| `every demo archive Tournament is standalone or names a Season that exists` | `read('demo')` | each `seasonId` is `null` or a known Season id; exactly `5` are `null` |
| `the demo archive keeps Season names as free strings` | `read('demo').archiveLeagueSeasons` | the name set contains `'Season 3'`, `'2026'`, `'2025-26'`, `'1996-97'`, `'Season 5 - Round 2'`, `'3ª Etapa Regular - 2026/2'`, `'Liga Sword - Primeira Etapa'`; and `Number.isNaN(Number(name))` holds for at least four of them |
| `the demo archive runs one Season across a calendar year boundary` | the Season named `'2025-26'` | its Tournaments' `tournamentDate` years are exactly `{2025, 2026}`, and it holds at least one locked and at least one unlocked Tournament against `ANCHOR` |
| `the demo archive spreads Tournaments per Season wildly` | Tournament counts grouped by `seasonId`, the empty Season included | the sorted counts are `[0, 1, 1, 1, 2, 2, 3, 3, 4, 7, 8, 11]`; `new Set(counts).size === 8`; `Math.max(...counts) === 11` |
| `the demo archive ships an empty Season` | `read('demo')` | exactly one Season has zero Tournaments |
| `the demo archive ships a child series whose name embeds its parent's` | `read('demo').archiveLeagues` | exactly one League name is a strict prefix of another League name, and the pair is `'Pro Tour Aetherdrift'` / `'Pro Tour Aetherdrift - 2nd Chance PTQ'` |
| `the demo archive keeps degenerate names as standalone Tournaments` | standalone Tournaments | their names include `'Series'`, `'1K'`, `'FNM'`, `'Weekly'`, and no League or Season carries any of those names |
| `the demo archive carries non-ASCII names` | every League, Season, Tournament and `playerArchetypes[].playerName` | the distinct strings failing `/^[\x20-\x7e]*$/` are exactly `'3ª Etapa Regular - 2026/2'`, `'Gdańsk'`, `'Montréal'`, `'Zoé Rambaud'`, `'Łukasz Wiśniewski'` |
| `the demo archive reaches both sides of the lock window` | `isArchiveTournamentLocked(date, ANCHOR)` over every Tournament | `24` locked and `24` unlocked |
| `the demo archive keeps every Tournament in the past` | every `tournamentDate` | `Date.parse(date) <= Date.parse(ANCHOR_ISO)` |
| `every demo archive round entry is a match or a bye` | every entry | `kind` is `'match'` or `'bye'` |
| `every demo archive Season keeps a completed Tournament` | each non-empty Season | at least one Tournament with `status === 'completed'` |
| `a dangling archive Season league reference is reported` | `validEnvironment()` + one Season with `leagueId: 'nope'` | problems contain `demo: archive League Season s1 references unknown archive League nope` |
| `a dangling archive Tournament season reference is reported` | one Tournament with `seasonId: 'nope'` | problems contain `demo: archive Tournament t1 references unknown archive League Season nope` |
| `a standalone archive Tournament is accepted` | one Tournament with `seasonId: null`, no Seasons at all | `validateEnvironment(...)` is `[]` |
| `an archive League without the sourceSeriesId marker is reported` | a League with the key absent, and a second run with `sourceSeriesId: 'series-9'` | both report `demo: archive League l1 must declare "sourceSeriesId": null — public archives expose no series field` |
| `a future archive Tournament date is reported` | `tournamentDate: '2999-01-01'` | problems contain `demo: archive Tournament t1 is dated in the future (2999-01-01) — an archive is history (ADR 0030)` |
| `a non-ISO archive Tournament date is reported` | `tournamentDate: '05/09/2024'` | problems contain `demo: archive Tournament t1 has tournamentDate "05/09/2024", expected an ISO YYYY-MM-DD date` |
| `a bad archive status is reported` | Season `status: 'finished'` and Tournament `status: 'draft'` | both messages present, each naming `active, completed` |
| `a duplicate archive id is reported at every tier` | the same id twice in each of the three arrays | three messages: `duplicate archive League id`, `duplicate archive League Season id`, `duplicate archive Tournament id` |
| `an oversized archive Tournament document is reported` | one Tournament padded past `1_048_576` bytes | problems contain `over the 1048576 byte document limit the server refuses` |
| `an archive over the restore cap is reported` | `101` Leagues | problems contain `demo: the archive carries 101 Leagues, over the 100 the restore endpoint accepts` |
| `the lock rule matches the domain at both boundaries` | `isArchiveTournamentLocked` at exactly `365` and `366` days | `false` then `true` |
| `the seeder restores the archive through restore-full as an Admin` | source of `scripts/seed-dev-environment.mjs`, sliced from `async function seedArchive` to the next `async function` | contains `ARCHIVE_RESTORE_PATH`, `tokenForRole(environment, tokens, 'Admin', 'archive')`, `buildArchiveBundle(environment)` and `-archive-restore-full`; does **not** contain `/api/archive/tournaments'` |
| `the seeder keeps the legacy League path for running tournaments` | the same source | still contains `'/api/leagues-archive/restore'` and `seedLiveTournaments(environment, tokens, leagueIds)` |
| `buildArchiveBundle strips the fixture-only provenance marker` | `buildArchiveBundle(read('demo'))` | `kind === 'fullArchive'`, `version === 5`, and no League in `leagues` has a `sourceSeriesId` key |
| `countArchiveTournamentPlayers counts the standings rows` | a Tournament with one match, one bye, one self-paired match, one `bye`-named player and one out-of-range score | `3` |

`ANCHOR` is `new Date('2026-08-22T00:00:00Z')` and `ANCHOR_ISO` is `'2026-08-22'`, declared once at the top of the file.

### `ops/stress-generator.test.ts` — changed and new cases

Changed — these currently read `data.leagues` and must read the archive collections instead:

| Test | Change |
| ---- | ------ |
| `differs by seed` | assert `archive-tournaments.json` differs instead of `leagues.json` |
| `hits the target volumes` | replace the `leagues` assertion with: `archiveLeagues` within 10% of `65`, `archiveLeagueSeasons` within 10% of `190`, `archiveTournaments` within 10% of `2200` |
| `fields the tiers at the sizes the real circuit reports` | read `archiveTournaments[].playerArchetypes.length` |
| `keeps every League document under the size the domain reads back` | rename to `keeps every Tournament document under the size the domain reads back`; assert per Tournament against `MAXIMUM_TOURNAMENT_BYTES` |
| `seats the same core week after week, with a tail of one-off entrants` | group by `seasonId` of the first weekly-class Season instead of by League |
| `gives every league at least one completed tournament` | rename to `gives every Season at least one completed Tournament`; group Tournaments by `seasonId` |
| `keeps every archive tournament inside its own league` | rename to `keeps every archive Tournament pointed at a Season that exists`; assert `seasonId === null || seasonIds.has(seasonId)` |
| `keeps player names in a bounded pool` | walk `archiveTournaments[].rounds` |

New:

| Test | Input | Expect |
| ---- | ----- | ------ |
| `gives every generated League a null sourceSeriesId` | `generate(1).archiveLeagues` | every entry's `sourceSeriesId` is `null` |
| `points every generated Season at a League that exists` | `generate(1)` | every `leagueId` is a known League id |
| `runs the full spread of Season sizes the public archives report` | `countBySeasonSizeClass(generate(1).archiveLeagueSeasons)` | every key of `SEASON_SIZE_CLASSES` is present with a count `>= 1`; the Tournament counts per Season include at least one `=== 1`, at least one in `3..4`, at least one in `8..11`, and at least one `>= 50` |
| `labels Seasons with free strings, not years` | `generate(1).archiveLeagueSeasons` | at least one name matches `/^\d{4}$/`, at least one `/^\d{4}-\d{2}$/`, at least one `/^Season \d+$/`, at least one `/^Season \d+ - Round \d+$/`, at least one `/^\d{4}\/\d$/`; and at least a quarter of the names are not a bare year |
| `runs at least one Season across a calendar year boundary` | the Seasons whose Tournaments span two years | count `>= 1`, and every one of those Seasons' first and last Tournament are in different calendar years |
| `emits standalone Tournaments with no Season` | `generate(1).archiveTournaments` | the count with `seasonId === null` equals `STRESS_VOLUMES.standaloneTournaments`, and every degenerate name in `DEGENERATE_TOURNAMENT_NAMES` is used by at least one of them |
| `never turns a degenerate name into a League or a Season` | `generate(1)` | no League name and no Season name is in `DEGENERATE_TOURNAMENT_NAMES` |
| `ships a child series whose name embeds its parent's` | `generate(1).archiveLeagues` | at least one League name is a strict prefix of another League name |
| `carries non-ASCII names at every tier` | `generate(1)` | at least one League name, one Season name and one Tournament name fail `/^[\x20-\x7e]*$/` |
| `reaches both sides of the lock window against the declared anchor` | `isArchiveTournamentLocked(date, new Date(`${ARCHIVE_ANCHOR_DATE}T00:00:00Z`))` | at least one locked and at least one unlocked Tournament |
| `never dates an archive Tournament after the anchor` | every `tournamentDate` | `<= ARCHIVE_ANCHOR_DATE` |
| `keeps the legacy League fixtures to Live references only` | `generate(1).leagues` | every entry has `tournaments: []`; the set of ids equals the set of non-null `liveTournaments[].leagueKey` values |
| `still validates as a whole environment` | `validateEnvironment({ …manifest, ...generate(1) }, { today: ANCHOR })` | `[]` |

Keep `is deterministic`, `caps Live tournaments at ten`, `spreads events across past, today and future`, `repeats a club local on the same weekday…`, `gives every event a unique title…`, `runs the whole circuit in France`, `caps audit rows`, `crosses its name lists into a pool with no duplicate`, `mulberry32 is a pure function of its seed` and `runs the four tiers of the French circuit at their own cadence` as they are.

### `ops/archive-domain-fixtures.test.ts` — new file

| Test | Input | Expect |
| ---- | ----- | ------ |
| `the golden bundle is the demo environment assembled` | `bundle.json` | deep-equals `buildArchiveBundle(readEnvironment('demo'))` |
| `the golden bundle is serialized the way the manifest says` | the raw file text | equals `` `${JSON.stringify(JSON.parse(text), null, 2)}\n` `` |
| `the manifest stamps the bundle it ships` | `manifest.bundleSha256` | equals `createHash('sha256').update(text).digest('hex')` |
| `the manifest declares version 5 everywhere` | `manifest` | `fixtureVersion === 5`, `archiveDataVersion === 5`, `bundle.version === 5`, `bundle.kind === 'fullArchive'` |
| `the manifest records that public archives expose no series field` | `manifest.provenance` | `sourceSeriesId` is `null` and `note` is a non-empty string |
| `the manifest case counts match the bundle` | every key of `manifest.caseCounts` | recomputed from `bundle.json` against `manifest.anchorDate`, each equal |
| `the bundle carries no fixture-only field` | every League in `bundle.leagues` | keys are exactly `['id', 'name', 'createdAt']` |
| `the golden bundle is a body the restore endpoint would accept` | `bundle` | `leagues.length <= 100`, `leagueSeasons.length <= 500`, `tournaments.length <= 2000`; every `leagueSeasons[].leagueId` resolves inside the bundle; every non-null `tournaments[].seasonId` resolves inside the bundle |

## Impl steps

- [ ] 1. **Red** — write the failing tests
  - [ ] 1.1 In `ops/dev-environments.test.ts`, extend the imports on line 8 to `import { ARCHIVE_DATA_FILES, ARCHIVE_DATA_VERSION, ARCHIVE_MAXIMUM_TOURNAMENT_BYTES, ARCHIVE_RESTORE_CAPS, ARCHIVE_RESTORE_KIND, buildArchiveBundle, countArchiveTournamentPlayers, DATA_FILES, DEV_ENVIRONMENTS_DIR, isArchiveTournamentLocked, isLocalDockerEndpoint, listEnvironmentNames, localDateTime, normalizeFixtureEmail, parseDevArgs, readEnvironment, validateEnvironment } from '../scripts/dev-environments.mjs';`
  - [ ] 1.2 In the same file, after the `DevEnvironmentLeague` interface at `:74-79`, add the three fixture interfaces `DevArchiveLeague { id: string; name: string; createdAt: string; sourceSeriesId: null }`, `DevArchiveLeagueSeason { id: string; name: string; leagueId: string; status: string }`, `DevArchiveTournament { id: string; name: string; seasonId: string | null; tournamentDate: string; status: string; rounds: { id: string; entries: DevEnvironmentRoundEntry[] }[]; playerArchetypes: { playerName: string; archetype: string }[] }`, and add the three matching arrays to `DevEnvironment`.
  - [ ] 1.3 In the same file, immediately below `const slugify = …` at `:101-106`, add `const ANCHOR_ISO = '2026-08-22';` and `const ANCHOR = new Date(`${ANCHOR_ISO}T00:00:00Z`);`
  - [ ] 1.4 In the same file, extend `validEnvironment()` at `:125-131` with `archiveLeagues: [], archiveLeagueSeasons: [], archiveTournaments: []`.
  - [ ] 1.5 In the same file, append the whole `describe('three-tier archive fixtures', …)` block from *Test plan*, every case, at the end of the file.
  - [ ] 1.6 Create `ops/archive-domain-fixtures.test.ts` with the eight cases from *Test plan*, importing `createHash` from `node:crypto`, `readFileSync` from `node:fs`, `join` from `node:path`, and `buildArchiveBundle` / `isArchiveTournamentLocked` / `readEnvironment` from `../scripts/dev-environments.mjs` behind the same `// @ts-expect-error` comment the sibling tests use.
  - [ ] 1.7 In `ops/stress-generator.test.ts`, extend the import on line 9 to also pull `ARCHIVE_ANCHOR_DATE, countBySeasonSizeClass, DEGENERATE_TOURNAMENT_NAMES, MAXIMUM_TOURNAMENT_BYTES, SEASON_SIZE_CLASSES` and drop `MAXIMUM_LEAGUE_BYTES`; add `isArchiveTournamentLocked` from `../scripts/dev-environments.mjs` to the existing loader import on line 7.
  - [ ] 1.8 In the same file, replace the `StressLeague` interface at `:20-30` with `StressArchiveLeague`, `StressArchiveLeagueSeason` and `StressArchiveTournament`, keeping a slim `StressLegacyLeague { id: string; name: string; status: string; tournaments: unknown[] }` for the reference stubs, and update `StressDataset` at `:44-56` accordingly.
  - [ ] 1.9 In the same file, rewrite `playerNames` at `:74-88` and `seatsPerPlayer` at `:91-97` to walk `archiveTournaments` instead of `leagues[].tournaments`.
  - [ ] 1.10 In the same file, apply every row of the *Test plan* "changed" table and append every row of its "new" table.
  - [ ] 1.11 Run `npx vitest run ops/` and confirm the new cases fail for the right reason — missing exports and missing files, not syntax errors.

- [ ] 2. **The loader** — `scripts/dev-environments.mjs`
  - [ ] 2.1 Replace line 20 with the ten-key `DATA_FILES` from *Interface contract → Produces — `scripts/dev-environments.mjs`*, and add `export const ARCHIVE_DATA_FILES = ['archiveLeagues', 'archiveLeagueSeasons', 'archiveTournaments'];` directly under it.
  - [ ] 2.2 Below line 24 (`const API_ORIGIN = …`), add the six archive constants verbatim: `ARCHIVE_DATA_VERSION`, `ARCHIVE_RESTORE_KIND`, `ARCHIVE_RESTORE_PATH`, `ARCHIVE_LOCK_WINDOW_DAYS`, `ARCHIVE_MAXIMUM_TOURNAMENT_BYTES`, `ARCHIVE_RESTORE_CAPS`, each with its doc comment as written.
  - [ ] 2.3 Add `const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;` beside the existing `ROUND_ENTRY_KINDS` on line 24.
  - [ ] 2.4 After `export function normalizeFixtureEmail(…)` at `:33-35`, add `isCountedArchiveEntry`, `archiveTournamentPlayers`, `countArchiveTournamentPlayers`, `countArchiveSeasonPlayers` and `isArchiveTournamentLocked`, bodies verbatim from the contract.
  - [ ] 2.5 After `readEnvironment` at `:77`, add `buildArchiveBundle(environment)`, body verbatim from the contract.
  - [ ] 2.6 Change `validateEnvironment(environment)` on line 80 to `validateEnvironment(environment, { today = new Date() } = {})`.
  - [ ] 2.7 In `validateEnvironment`, immediately after the existing `leagues` block ends (the `for (const league of leagues)` loop closing before `for (const live of environment.liveTournaments ?? [])` at `:214`), insert the archive block implementing rules 1-16 in that order, with the messages exactly as tabulated. Build `archiveLeagueIds` and `archiveSeasonIds` as `Set`s in the same pass so rules 6 and 10 can resolve. Rule 13 compares `Date.parse(`${tournament.tournamentDate}T00:00:00Z`) > Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())`.
  - [ ] 2.8 Update the module doc comment at `:1-10` to name the three archive files as part of the format.
  - [ ] 2.9 Run `npx vitest run ops/dev-environments.test.ts` — the loader-only cases go green, the fixture cases still fail on missing files.

- [ ] 3. **The demo fixtures and the golden set**
  - [ ] 3.1 Create `/tmp/build-demo-archive.mjs` with the script below verbatim. It is a one-shot authoring aid: run it, commit its output, delete it. It reads no clock and draws no randomness.

    ```js
    import { mkdirSync, writeFileSync } from 'node:fs';

    const CAST = [
      'Demo Archive Player 01', 'Demo Archive Player 02', 'Demo Archive Player 03', 'Demo Archive Player 04',
      'Demo Archive Player 05', 'Demo Archive Player 06', 'Demo Archive Player 07', 'Demo Archive Player 08',
      'Demo Archive Player 09', 'Demo Archive Player 10', 'Demo Archive Player 11', 'Demo Archive Player 12',
      'Demo Archive Player 13', 'Demo Archive Player 14', 'Demo Archive Player 15', 'Demo Archive Player 16',
      'Demo Archive Player 17', 'Demo Archive Player 18', 'Demo Archive Player 19', 'Demo Archive Player 20',
      'Demo Archive Player 21', 'Demo Archive Player 22', 'Demo Archive Player 23', 'Demo Archive Player 24',
      'Demo Archive Player 25', 'Demo Archive Player 26', 'Demo Archive Player 27', 'Demo Archive Player 28',
      'Demo Archive Player 29', 'Demo Archive Player 30', 'Demo Archive Player 31', 'Demo Archive Player 32',
      'Demo Archive Player 33', 'Demo Archive Player 34', 'Demo Archive Player 35', 'Demo Archive Player 36',
      'Demo Archive Player 37', 'Demo Archive Player 38', 'Zoé Rambaud', 'Łukasz Wiśniewski'
    ];
    const ARCHETYPES = ['Boros Energy', 'Izzet Prowess', 'Domain Zoo', 'Dimir Control', 'Amulet Titan', 'Elves'];
    const SCORES = [[2, 0], [2, 1], [1, 1], [0, 2], [1, 2]];
    const pad = (value, width) => String(value).padStart(width, '0');

    const leagues = [
      ['demo-archive-league-gones', 'Gones League', '2024-08-29T09:00:00Z'],
      ['demo-archive-league-f2f', 'Face to Face Tour', '2025-08-09T09:00:00Z'],
      ['demo-archive-league-pro-tour', 'Pro Tour Aetherdrift', '2026-02-14T09:00:00Z'],
      ['demo-archive-league-pro-tour-ptq', 'Pro Tour Aetherdrift - 2nd Chance PTQ', '2026-02-15T09:00:00Z'],
      ['demo-archive-league-worlds', 'World Championship', '2025-09-19T09:00:00Z'],
      ['demo-archive-league-liga-sword', 'Liga Sword', '2025-03-01T09:00:00Z'],
      ['demo-archive-league-grand-prix', 'Grand Prix', '1996-09-07T09:00:00Z'],
      ['demo-archive-league-spotlight', 'Spotlight Series', '2025-08-30T09:00:00Z']
    ].map(([id, name, createdAt]) => ({ id, name, createdAt, sourceSeriesId: null }));

    const seasons = [
      ['demo-archive-season-gones-3', 'Season 3', 'demo-archive-league-gones', 'completed'],
      ['demo-archive-season-gones-2026', '2026', 'demo-archive-league-gones', 'active'],
      ['demo-archive-season-gones-2027', '2027', 'demo-archive-league-gones', 'active'],
      ['demo-archive-season-f2f-2025-26', '2025-26', 'demo-archive-league-f2f', 'completed'],
      ['demo-archive-season-gp-1996-97', '1996-97', 'demo-archive-league-grand-prix', 'completed'],
      ['demo-archive-season-gp-s5r2', 'Season 5 - Round 2', 'demo-archive-league-grand-prix', 'completed'],
      ['demo-archive-season-pt-aetherdrift', '2026', 'demo-archive-league-pro-tour', 'completed'],
      ['demo-archive-season-pt-ptq', '2026', 'demo-archive-league-pro-tour-ptq', 'completed'],
      ['demo-archive-season-worlds-2025', '2025', 'demo-archive-league-worlds', 'completed'],
      ['demo-archive-season-liga-sword-2026-2', '3ª Etapa Regular - 2026/2', 'demo-archive-league-liga-sword', 'active'],
      ['demo-archive-season-liga-sword-primeira', 'Liga Sword - Primeira Etapa', 'demo-archive-league-liga-sword', 'completed'],
      ['demo-archive-season-spotlight-3', 'Season 3', 'demo-archive-league-spotlight', 'active']
    ].map(([id, name, leagueId, status]) => ({ id, name, leagueId, status }));

    // [ id, seasonId, name, tournamentDate, status, players ]
    const headers = [
      ['demo-arch-t-gones3-01', 'demo-archive-season-gones-3', 'Manche 1', '2024-09-05', 'completed', 8],
      ['demo-arch-t-gones3-02', 'demo-archive-season-gones-3', 'Manche 2', '2024-09-12', 'completed', 6],
      ['demo-arch-t-gones3-03', 'demo-archive-season-gones-3', 'Manche 3', '2024-09-19', 'completed', 10],
      ['demo-arch-t-gones3-04', 'demo-archive-season-gones-3', 'Manche 4', '2024-09-26', 'completed', 8],
      ['demo-arch-t-gones3-05', 'demo-archive-season-gones-3', 'Manche 5', '2024-10-03', 'completed', 12],
      ['demo-arch-t-gones3-06', 'demo-archive-season-gones-3', 'Manche 6', '2024-10-10', 'completed', 6],
      ['demo-arch-t-gones3-07', 'demo-archive-season-gones-3', 'Manche 7', '2024-10-17', 'completed', 8],
      ['demo-arch-t-gones2026-01', 'demo-archive-season-gones-2026', 'Manche 1', '2026-02-05', 'completed', 10],
      ['demo-arch-t-gones2026-02', 'demo-archive-season-gones-2026', 'Manche 2', '2026-03-05', 'completed', 8],
      ['demo-arch-t-gones2026-03', 'demo-archive-season-gones-2026', 'Manche 3', '2026-04-02', 'active', 6],
      ['demo-arch-t-f2f-01', 'demo-archive-season-f2f-2025-26', 'Toronto', '2025-08-16', 'completed', 12],
      ['demo-arch-t-f2f-02', 'demo-archive-season-f2f-2025-26', 'Montréal', '2025-10-18', 'completed', 10],
      ['demo-arch-t-f2f-03', 'demo-archive-season-f2f-2025-26', 'Vancouver', '2026-01-17', 'completed', 8],
      ['demo-arch-t-f2f-04', 'demo-archive-season-f2f-2025-26', 'Calgary', '2026-04-11', 'completed', 12],
      ['demo-arch-t-gp9697-01', 'demo-archive-season-gp-1996-97', 'Grand Prix Amsterdam', '1996-09-14', 'completed', 8],
      ['demo-arch-t-gp9697-02', 'demo-archive-season-gp-1996-97', 'Grand Prix Atlanta', '1996-10-12', 'completed', 6],
      ['demo-arch-t-gp9697-03', 'demo-archive-season-gp-1996-97', 'Grand Prix Barcelona', '1996-11-09', 'completed', 10],
      ['demo-arch-t-gp9697-04', 'demo-archive-season-gp-1996-97', 'Grand Prix Copenhagen', '1996-12-07', 'completed', 8],
      ['demo-arch-t-gp9697-05', 'demo-archive-season-gp-1996-97', 'Grand Prix Dallas', '1997-01-11', 'completed', 12],
      ['demo-arch-t-gp9697-06', 'demo-archive-season-gp-1996-97', 'Grand Prix Edinburgh', '1997-02-08', 'completed', 6],
      ['demo-arch-t-gp9697-07', 'demo-archive-season-gp-1996-97', 'Grand Prix Florence', '1997-03-08', 'completed', 8],
      ['demo-arch-t-gp9697-08', 'demo-archive-season-gp-1996-97', 'Gdańsk', '1997-04-12', 'completed', 10],
      ['demo-arch-t-gp9697-09', 'demo-archive-season-gp-1996-97', 'Grand Prix Hamburg', '1997-05-10', 'completed', 8],
      ['demo-arch-t-gp9697-10', 'demo-archive-season-gp-1996-97', 'Grand Prix Istanbul', '1997-06-14', 'completed', 12],
      ['demo-arch-t-gp9697-11', 'demo-archive-season-gp-1996-97', 'Grand Prix Jakarta', '1997-07-12', 'completed', 6],
      ['demo-arch-t-gps5r2-01', 'demo-archive-season-gp-s5r2', 'Leg 1', '2025-05-10', 'completed', 8],
      ['demo-arch-t-gps5r2-02', 'demo-archive-season-gp-s5r2', 'Leg 2', '2025-06-14', 'completed', 10],
      ['demo-arch-t-ptad-01', 'demo-archive-season-pt-aetherdrift', 'Pro Tour Aetherdrift', '2026-02-21', 'completed', 12],
      ['demo-arch-t-ptadptq-01', 'demo-archive-season-pt-ptq', '2nd Chance PTQ', '2026-02-22', 'completed', 8],
      ['demo-arch-t-worlds-01', 'demo-archive-season-worlds-2025', 'World Championship 2025', '2025-09-26', 'completed', 5],
      ['demo-arch-t-ligasword-2026-2-01', 'demo-archive-season-liga-sword-2026-2', 'Etapa 1', '2026-05-09', 'completed', 8],
      ['demo-arch-t-ligasword-2026-2-02', 'demo-archive-season-liga-sword-2026-2', 'Etapa 2', '2026-06-13', 'completed', 10],
      ['demo-arch-t-ligasword-2026-2-03', 'demo-archive-season-liga-sword-2026-2', 'Etapa 3', '2026-07-11', 'active', 6],
      ['demo-arch-t-ligasword-primeira-01', 'demo-archive-season-liga-sword-primeira', 'Etapa 1', '2025-03-08', 'completed', 8],
      ['demo-arch-t-ligasword-primeira-02', 'demo-archive-season-liga-sword-primeira', 'Etapa 2', '2025-04-12', 'completed', 12],
      ['demo-arch-t-spotlight-01', 'demo-archive-season-spotlight-3', 'Spotlight 1', '2025-09-06', 'completed', 8],
      ['demo-arch-t-spotlight-02', 'demo-archive-season-spotlight-3', 'Spotlight 2', '2025-10-04', 'completed', 6],
      ['demo-arch-t-spotlight-03', 'demo-archive-season-spotlight-3', 'Spotlight 3', '2025-11-01', 'completed', 10],
      ['demo-arch-t-spotlight-04', 'demo-archive-season-spotlight-3', 'Spotlight 4', '2025-12-06', 'completed', 8],
      ['demo-arch-t-spotlight-05', 'demo-archive-season-spotlight-3', 'Spotlight 5', '2026-01-10', 'completed', 12],
      ['demo-arch-t-spotlight-06', 'demo-archive-season-spotlight-3', 'Spotlight 6', '2026-02-07', 'completed', 6],
      ['demo-arch-t-spotlight-07', 'demo-archive-season-spotlight-3', 'Spotlight 7', '2026-03-07', 'completed', 8],
      ['demo-arch-t-spotlight-08', 'demo-archive-season-spotlight-3', 'Spotlight 8', '2026-04-04', 'active', 10],
      ['demo-arch-t-standalone-series', null, 'Series', '2026-06-06', 'completed', 8],
      ['demo-arch-t-standalone-1k', null, '1K', '2026-05-16', 'completed', 12],
      ['demo-arch-t-standalone-fnm', null, 'FNM', '2026-07-03', 'completed', 6],
      ['demo-arch-t-standalone-weekly', null, 'Weekly', '2025-07-11', 'completed', 10],
      ['demo-arch-t-standalone-gdansk', null, 'Gdańsk', '2026-04-25', 'completed', 8]
    ];

    /** Circle-method round robin: seat 0 is fixed, the rest rotate, so no pairing ever repeats. */
    function pairings(size, round) {
      const pairs = [];
      for (let index = 0; index < size / 2; index += 1) {
        const left = index === 0 ? 0 : ((index + round - 1) % (size - 1)) + 1;
        const right = ((size - 2 - index + round) % (size - 1)) + 1;
        pairs.push([left, right]);
      }
      return pairs;
    }

    const tournaments = headers.map(([id, seasonId, name, tournamentDate, status, players], order) => {
      const roster = Array.from({ length: players }, (_, seat) => CAST[(order * 3 + seat) % CAST.length]);
      const roundCount = players <= 6 ? 2 : 3;
      const even = players % 2 === 0 ? players : players - 1;
      const rounds = [];
      for (let round = 0; round < roundCount; round += 1) {
        const entries = pairings(even, round).map(([left, right], table) => {
          const [player1Score, player2Score] = SCORES[(order + round * 2 + table) % SCORES.length];
          return {
            kind: 'match',
            id: `${id}-r${round + 1}-m${table + 1}`,
            table: String(table + 1),
            player1Name: roster[left],
            player2Name: roster[right],
            player1Score,
            player2Score,
            player1DeckArchetype: '',
            player2DeckArchetype: ''
          };
        });
        if (even !== players) {
          entries.push({
            kind: 'bye',
            id: `${id}-r${round + 1}-b${entries.length + 1}`,
            table: String(entries.length + 1),
            playerName: roster[players - 1],
            deckArchetype: ''
          });
        }
        rounds.push({ id: `${id}-r${round + 1}`, entries });
      }
      return {
        id,
        name,
        seasonId,
        tournamentDate,
        status,
        rounds,
        playerArchetypes: roster.map((playerName, seat) => ({ playerName, archetype: ARCHETYPES[(order + seat) % ARCHETYPES.length] }))
      };
    });

    const directory = 'fixtures/dev-environments/demo';
    mkdirSync(directory, { recursive: true });
    const write = (file, rows) => writeFileSync(`${directory}/${file}`, `${JSON.stringify(rows, null, 2)}\n`);
    write('archive-leagues.json', leagues);
    write('archive-league-seasons.json', seasons);
    write('archive-tournaments.json', tournaments);
    console.log(`${leagues.length} Leagues, ${seasons.length} Seasons, ${tournaments.length} Tournaments`);
    void pad;
    ```

  - [ ] 3.2 Run `node /tmp/build-demo-archive.mjs`. It must print `8 Leagues, 12 Seasons, 48 Tournaments`. Delete `/tmp/build-demo-archive.mjs` afterwards — the three JSON files are hand-editable from here on, exactly like every other fixture.
  - [ ] 3.3 Run `npx vitest run ops/dev-environments.test.ts`. Every `demo archive` case must now pass. If `the demo archive spreads Tournaments per Season wildly` fails, the header table was mistyped — compare the counts against the sorted expectation `[0, 1, 1, 1, 2, 2, 3, 3, 4, 7, 8, 11]`.
  - [ ] 3.4 Write the golden bundle:

    ```bash
    mkdir -p fixtures/archive-domain/v5
    node --input-type=module -e "
      import { writeFileSync } from 'node:fs';
      const { buildArchiveBundle, readEnvironment } = await import('./scripts/dev-environments.mjs');
      const bundle = buildArchiveBundle(readEnvironment('demo'));
      writeFileSync('fixtures/archive-domain/v5/bundle.json', JSON.stringify(bundle, null, 2) + '\n');
    "
    ```

  - [ ] 3.5 Create `fixtures/archive-domain/v5/manifest.json` with the shape from *Interface contract → Produces — `fixtures/archive-domain/v5/`*, leaving `bundleSha256` as the empty string for now.
  - [ ] 3.6 Fill the hash: `node -e "const{createHash}=require('node:crypto');const{readFileSync}=require('node:fs');console.log(createHash('sha256').update(readFileSync('fixtures/archive-domain/v5/bundle.json','utf8')).digest('hex'))"` and paste the 64 hex characters into `bundleSha256`.
  - [ ] 3.7 Run `npx vitest run ops/archive-domain-fixtures.test.ts` — all eight cases green. The case-count case is the one that catches a mistyped `caseCounts`; correct the manifest, never the assertion.

- [ ] 4. **The seeder** — `scripts/seed-dev-environment.mjs`
  - [ ] 4.1 Extend the import on line 25 to also pull `ARCHIVE_RESTORE_PATH` and `buildArchiveBundle` from `./dev-environments.mjs`.
  - [ ] 4.2 Immediately after `seedLeagues` ends (line 375) insert `seedArchive(environment, tokens)` with the doc comment and the behaviour from *Interface contract → Produces — `scripts/seed-dev-environment.mjs`*:

    ```js
    async function seedArchive(environment, tokens) {
      const empty = { leagues: new Map(), leagueSeasons: new Map(), tournaments: new Map() };
      if (!environment.archiveLeagues.length && !environment.archiveLeagueSeasons.length && !environment.archiveTournaments.length) return empty;

      // restore-full is Admin-gated, and Admin owns no archive row, so ownership never blocks a re-seed.
      const token = tokenForRole(environment, tokens, 'Admin', 'archive');
      const restored = await requireResponse(await api('POST', ARCHIVE_RESTORE_PATH, {
        token,
        body: buildArchiveBundle(environment),
        idempotencyKey: `${environment.name}-archive-restore-full`
      }), 'archive', 'restore-full');

      const body = await restored.json();
      const map = (rows) => new Map(rows.map(({ sourceId, id }) => [sourceId, id]));
      return { leagues: map(body.leagues), leagueSeasons: map(body.leagueSeasons), tournaments: map(body.tournaments) };
    }
    ```

  - [ ] 4.3 In the bulk branch at `:530-546`, destructure the new return: `archiveIds = loaded.archiveIds;` and extend the console line to `` `\nBulk-loaded ${loaded.counts.events} Events, ${loaded.counts.registrations} registrations, ${loaded.counts.leagues} legacy League references, ${loaded.counts.archiveLeagues} archive Leagues, ${loaded.counts.archiveLeagueSeasons} League Seasons, ${loaded.counts.archiveTournaments} archive Tournaments and ${loaded.counts.auditRecords} audit rows.` ``
  - [ ] 4.4 In the non-bulk branch at `:544-546`, after `leagueIds = await seedLeagues(environment, tokens);` add `archiveIds = await seedArchive(environment, tokens);`, and declare `let archiveIds;` beside `let eventIds;` / `let leagueIds;` at `:526-527`.
  - [ ] 4.5 In the seeded-volumes array at `:562-571`, insert the three archive rows immediately after `[leagueIds.size, 'league archives'],`, exactly as the contract lists them.
  - [ ] 4.6 Update the module doc comment at `:1-21` — the second paragraph now reads that the three-tier archive of a committed environment goes in through one `POST /api/archive/restore-full`, that the legacy `POST /api/leagues-archive/restore` stays because `live-tournaments.json` resolves its `leagueKey` against the legacy table, and that restore is used rather than the interactive create route because a fixture archive is history and the create route refuses a non-Admin a Tournament older than 365 days.
  - [ ] 4.7 Run `npx vitest run ops/dev-environments.test.ts` — the two seeder-source cases go green.

- [ ] 5. **The stress generator** — `scripts/generate-stress-environment.mjs`
  - [ ] 5.1 Replace the `MAXIMUM_LEAGUE_BYTES` / `LEAGUE_BYTE_BUDGET` pair at `:94-98` with `export const MAXIMUM_TOURNAMENT_BYTES = 1_048_576;` and `const TOURNAMENT_BYTE_BUDGET = Math.floor(MAXIMUM_TOURNAMENT_BYTES * 0.9);`, keeping the doc comment but re-pointing it at the per-Tournament ceiling.
  - [ ] 5.2 Below `ARCHIVE_SEASON_WEEKS` at `:92`, add `export const ARCHIVE_ANCHOR_DATE = '2026-08-22';` with the comment `/** The declared "today" every generated archive date is measured against. Absolute and clock-free: the generator must stay byte-deterministic, so the lock window cannot be read off the wall clock. */`
  - [ ] 5.3 Add `standaloneTournaments: 120` to `STRESS_VOLUMES` at `:61-77`, with its doc comment, and add `standaloneTournaments: scaled(STRESS_VOLUMES.standaloneTournaments)` to `scaledVolumes` at `:323-343`.
  - [ ] 5.4 After the `NATIONAL_SATELLITES` constant at `:190`, add `SEASON_SIZE_CLASSES`, `SEASON_LABEL_STYLES` and `DEGENERATE_TOURNAMENT_NAMES` verbatim from the contract, plus:

    ```js
    /** Series names the generated archive borrows from the public record, diacritics included. */
    const ARCHIVE_SERIES_WORDS = ['Ligue', 'Circuit', 'Championnat', 'Tournoi', 'Étape', 'Liga Sword', 'Spotlight Series'];
    /** The one child series whose name embeds its parent's, so prefix-grouping heuristics visibly break. */
    const EMBEDDED_CHILD_SUFFIX = ' - 2nd Chance PTQ';
    ```

  - [ ] 5.5 Add `seasonLabel(random, style, league, index, startYear)` returning the free string for one `SEASON_LABEL_STYLES` key: `year` → `String(startYear)`; `crossYear` → `` `${startYear}-${pad((startYear + 1) % 100, 2)}` ``; `numbered` → `` `Season ${index + 1}` ``; `numberedLeg` → `` `Season ${index + 1} - Round ${1 + (index % 3)}` ``; `yearSlash` → `` `${startYear}/${1 + (index % 2)}` ``; `ordinalLeg` → `` `${index + 1}ª Etapa Regular - ${startYear}/${1 + (index % 2)}` ``; `namedLeg` → `` `${league.name} - Primeira Etapa` ``.
  - [ ] 5.6 Replace `generateLeagues` at `:849-988` with `generateArchive(random, volumes, clubs, archetypesFor)`. It returns `{ leagues, leagueSeasons, tournaments }` and works like this, in order:
    - one League per archiving club (`club.activity !== 'occasional'`), id `stress-archive-league-${slugify(club.name)}`, name `` `${club.name} ${pick(random, ARCHIVE_SERIES_WORDS)}` ``, uniquified with the club index the way `generateClubs` already uniquifies at `:377-380`;
    - one League per région, id `stress-archive-league-cr-${slugify(region)}`, name `` `Championnat Régional ${region}` ``;
    - one League `stress-archive-league-cdf`, name `Championnat de France`;
    - one child League `stress-archive-league-cdf-ptq`, name `` `Championnat de France${EMBEDDED_CHILD_SUFFIX}` `` — the embedded-parent-name case;
    - every League carries `sourceSeriesId: null` and a `createdAt` derived from its earliest Tournament date, never from a clock;
    - per League, `volumes.archiveSeasons` Seasons: draw a size class with `weighted(random, SEASON_SIZE_CLASSES.map((entry) => [entry, entry.weight]))`, a label style with `weighted(random, SEASON_LABEL_STYLES.map((entry) => [entry, entry.weight]))`, then `between(random, class.minimum, class.maximum)` Tournaments;
    - a `crossYear` Season lays its Tournaments from August of `startYear` to August of `startYear + 1`; every other style keeps them inside one calendar year;
    - Tournament dates come from `archiveDate(...)` off the fixed epoch and are clamped never to exceed `ARCHIVE_ANCHOR_DATE`;
    - each Tournament is built with the **existing** `playTournament(random, {...})` at `:747-796`, with `leagueId` dropped from its argument object and `seasonId` set instead; keep `recordMatchArchetypes: true` except for fields over 300 players, where it is `false`;
    - the newest Tournament of an `active` Season gets `status: 'active'`; every other Tournament is `'completed'`, so no Season is statistically empty;
    - finally `volumes.standaloneTournaments` Tournaments with `seasonId: null`, ids `stress-archive-tournament-standalone-${pad(index, 3)}`, names cycling `DEGENERATE_TOURNAMENT_NAMES` for the first four out of every five and a city name for the fifth, so the degenerate case is dense and the non-ASCII case is present.
  - [ ] 5.7 Adapt `playTournament` at `:747-796`: replace its `leagueId` parameter and its `leagueId` output field with `seasonId`, and add `seasonId` to the returned object. Nothing else in it changes — the Swiss replay, the bucketed pairing and the bye are untouched.
  - [ ] 5.8 Replace `assertLeagueBudget` at `:995-1003` with:

    ```js
    export function assertTournamentBudget(tournaments) {
      for (const tournament of tournaments) {
        const bytes = Buffer.byteLength(JSON.stringify(tournament), 'utf8');
        if (bytes > TOURNAMENT_BYTE_BUDGET) {
          throw new Error(`Archive Tournament ${tournament.id} is ${bytes} bytes, over the ${TOURNAMENT_BYTE_BUDGET} byte budget the domain reads back.`);
        }
      }
      return tournaments;
    }
    ```

  - [ ] 5.9 Rewrite `generateLiveTournaments` at `:1006-1035` to take `(random, volumes, clubs)` and mint its own `leagueKey`: `index % 3 === 0 ? null : `stress-legacy-league-${club.key.slice(-3)}``. Then add `generateLiveReferenceLeagues(liveTournaments, clubs)` returning one legacy stub per distinct non-null `leagueKey`: `{ id, name: `${club.name} — Live`, status: 'active', tournaments: [] }`, ordered by id so the file stays deterministic.
  - [ ] 5.10 Add `export function countBySeasonSizeClass(leagueSeasons)`: `{}` keyed by `season.sizeClass`, counting occurrences. Stamp `sizeClass` onto each generated Season inside `generateArchive`, and strip it in `generateStressEnvironment` the way `events` is stripped at `:1084-1086` — the fixture format knows no `sizeClass`, and the restore endpoint would carry it to the API.
  - [ ] 5.11 In `generateStressEnvironment` at `:1063-1090`, replace the `leagues` line with:

    ```js
    const archive = generateArchive(random, volumes, clubs, archetypesFor);
    assertTournamentBudget(archive.tournaments);
    const liveTournaments = generateLiveTournaments(random, volumes, clubs);
    const leagues = generateLiveReferenceLeagues(liveTournaments, clubs);
    ```

    and return `{ accounts, organizations, formats, tournaments, registrations, leagues, archiveLeagues: archive.leagues, archiveLeagueSeasons: archive.leagueSeasons.map(({ sizeClass, ...season }) => season), archiveTournaments: archive.tournaments, liveTournaments, auditRecords, events: labelled, leagueSeasonsBySizeClass: archive.leagueSeasons }`. Keep `leagueSeasonsBySizeClass` out of `writeStressEnvironment`; it exists only so `countBySeasonSizeClass` has something to count in the tests.
  - [ ] 5.12 Add the three files to `writeStressEnvironment` at `:1099-1108`, exactly as the contract lists them and in that position.
  - [ ] 5.13 Update the CLI summary at `:1152-1166`: replace the League Archive line with `` `  ${data.archiveLeagues.length} archive Leagues, ${data.archiveLeagueSeasons.length} League Seasons, ${data.archiveTournaments.length} Tournaments (${standalone} standalone, ${entries} Round Entries)` `` and add `` `  ${data.leagues.length} legacy League references for the running tournaments` ``. Compute `entries` over `data.archiveTournaments` instead of `data.leagues`.
  - [ ] 5.14 Update the module doc comment at `:1-46`: the archive is three-tier; a Season name is a free string and never a year column; the tournaments-per-Season spread comes from the observed size classes; the legacy `leagues.json` is now Live references only; and archive dates are measured against `ARCHIVE_ANCHOR_DATE`, which is why the dataset ages and how to refresh it.
  - [ ] 5.15 Run `npx vitest run ops/stress-generator.test.ts`. Fix the generator until green. If `hits the target volumes` misses, the knob is `STRESS_VOLUMES.archiveSeasons` for Seasons and the `weekly` / `lateGrandPrix` weights for Tournaments — adjust the weights, never the assertion.
  - [ ] 5.16 Run `npm run dev:stress:generate -- --seed=1` and confirm the three files land under `fixtures/dev-environments/stress/`, that `archive-tournaments.json` is the large one, and that `git status` shows none of them (the `.gitignore` pattern already covers them).

- [ ] 6. **The bulk loader** — `scripts/bulk-load-stress.mjs`
  - [ ] 6.1 Extend the import on line 26 to also pull `countArchiveSeasonPlayers` and `countArchiveTournamentPlayers` from `./dev-environments.mjs`.
  - [ ] 6.2 Below `LEAGUE_CHUNK_SIZE` at `:35`, add `const TOURNAMENT_CHUNK_SIZE = 20;` with the doc comment from the contract.
  - [ ] 6.3 After `searchText` at `:117-124`, add `archiveTournamentDocument(tournament)` verbatim from the contract, with its doc comment — the omitted-when-null `seasonId` is the load-bearing part and the comment must say why.
  - [ ] 6.4 In `bulkLoadStress`, after the `leagueRows` block at `:196-205`, add the three archive row builders. Group Tournaments by `seasonId` once: `const tournamentsBySeason = new Map(); for (const tournament of environment.archiveTournaments) { if (tournament.seasonId === null) continue; … }`. `updated_at` uses `new Date(now.getTime() - index * 61_000).toISOString()` with `index` the row's position in its own collection.
  - [ ] 6.5 In the `script` array at `:225-243`, insert the three `insertStatements` calls from the contract immediately after the `league_archive_aggregates` one, in the order leagues → seasons → tournaments.
  - [ ] 6.6 Extend the return at `:245-262` with the `archiveIds` object and the three `counts` keys, exactly as the contract lists them.
  - [ ] 6.7 Update the module doc comment at `:1-24`: the four largest slices become five, the three archive tables are named, and the "what this bypasses" list gains a line saying the archive tables' denormalized counters are written here rather than computed by the domain, which is why `countArchiveTournamentPlayers` mirrors the standings rule byte for byte.
  - [ ] 6.8 Run `npx vitest run ops/` — everything green.

- [ ] 7. **Documentation** — `fixtures/dev-environments/README.md`
  - [ ] 7.1 In the layout block near line 6, add the three files after `leagues.json`, and add their rows to the `| file | what it holds |` table: `archive-leagues.json` → "the archive Leagues to restore (top tier)", `archive-league-seasons.json` → "the archive League Seasons to restore (middle tier)", `archive-tournaments.json` → "the archive Tournaments to restore (bottom tier, standalone ones included)".
  - [ ] 7.2 Rewrite the second paragraph of "The `demo` environment" (lines 42-45) to describe both archives: the legacy two-League `leagues.json`, kept because `live-tournaments.json` resolves its `leagueKey` against the legacy table, and the new three-tier archive — eight Leagues, twelve League Seasons, forty-eight Tournaments, five of them standalone.
  - [ ] 7.3 Add a `### Three-tier archive fixtures` subsection under "Fixture fields" documenting the three shapes field by field; state that a Season **name is a free string** and that real archives label seasons `2026-27`, `Season 5 - Round 2`, `2026/2`, `1996-97` and `Season 3`, so an integer-year column would be wrong; state that `sourceSeriesId` is required and always `null` because public archives expose no series field at all, and that it is stripped before the wire; state that a Tournament with `seasonId: null` is standalone and that degenerate names like `Series`, `1K`, `FNM` and `Weekly` must stay standalone rather than becoming garbage Leagues.
  - [ ] 7.4 Extend the "Archive dates are absolute on purpose" paragraph (lines 147-149): the whole fixture archive is dated against the declared anchor `2026-08-22`; a Tournament locks 365 whole days after it was played; the demo carries 24 locked and 24 unlocked Tournaments at that anchor; and past roughly mid-2027 every one of them is locked, at which point the dates are bumped forward and `fixtures/archive-domain/v5/` regenerated.
  - [ ] 7.5 In "The `stress` environment", update the volume line: the archive is now about 65 Leagues, 190 League Seasons and 2,200 Tournaments, 120 of them standalone; `leagues.json` holds only the legacy Live references; and the byte limit the generator enforces is now **per Tournament**, which is why the Championnat de France no longer needs splitting across two documents.
  - [ ] 7.6 Add a short paragraph to "The `stress` environment → How it is built and loaded" naming the three archive tables the bulk loader writes and stating that the loader computes the denormalized `player_count` / `tournament_count` / date-bound columns itself because it bypasses the domain that would otherwise compute them.
  - [ ] 7.7 Add a `## The golden v5 archive bundle` section: `fixtures/archive-domain/v5/bundle.json` is the frozen v5 bundle assembled from `demo`, `manifest.json` stamps its SHA-256 and its case counts, `ops/archive-domain-fixtures.test.ts` is the gate, and the regeneration command is the `node --input-type=module -e` snippet from step 3.4 followed by the hash command from step 3.6.

- [ ] 8. **Validate and commit**
  - [ ] 8.1 `npm run test` — green.
  - [ ] 8.2 `npm run typecheck` — green.
  - [ ] 8.3 `npm run lint` — green.
  - [ ] 8.4 `npm run dev:stress:generate -- --seed=1` twice; `sha256sum fixtures/dev-environments/stress/archive-tournaments.json` matches across both runs.
  - [ ] 8.5 `npm run dev:env -- --env=demo` against a stack that is already up, then the three `psql` counts from *Validation*.
  - [ ] 8.6 `git status --porcelain` lists no file under `src/app/`, `backend/`, `cypress/` or `docs/`.
  - [ ] 8.7 Commit: `feat(fixtures): seed and generate three-tier archive data`.

## Outputs

Files added:

- `fixtures/dev-environments/demo/archive-leagues.json`
- `fixtures/dev-environments/demo/archive-league-seasons.json`
- `fixtures/dev-environments/demo/archive-tournaments.json`
- `fixtures/archive-domain/v5/bundle.json`
- `fixtures/archive-domain/v5/manifest.json`
- `ops/archive-domain-fixtures.test.ts`

Files edited:

- `scripts/dev-environments.mjs` — `DATA_FILES`, six constants, five helpers, `buildArchiveBundle`, the archive validation block, the injectable `today`
- `scripts/seed-dev-environment.mjs` — `seedArchive`, the two call sites, the console summary, the module doc
- `scripts/generate-stress-environment.mjs` — `generateArchive`, `assertTournamentBudget`, `generateLiveReferenceLeagues`, `countBySeasonSizeClass`, `SEASON_SIZE_CLASSES`, `SEASON_LABEL_STYLES`, `DEGENERATE_TOURNAMENT_NAMES`, `ARCHIVE_ANCHOR_DATE`, `STRESS_VOLUMES.standaloneTournaments`, `writeStressEnvironment`, the CLI summary, the module doc
- `scripts/bulk-load-stress.mjs` — `archiveTournamentDocument`, three row builders, three inserts, the return shape, the module doc
- `ops/dev-environments.test.ts` — the new archive describe and the widened fixtures
- `ops/stress-generator.test.ts` — eight changed cases, thirteen new ones
- `fixtures/dev-environments/README.md` — the three files, the demo description, the archive-fixture fields, the anchor-date rule, the stress volumes, the golden bundle section
- `fixtures/dev-environments/stress/*.json` — regenerated, gitignored, not committed

Public API / behaviour change:

- No HTTP surface changes. `npm run dev:env -- --env=demo` now makes one extra call, `POST /api/archive/restore-full`.
- The fixture format gains three optional files and one required per-League field, `sourceSeriesId: null`.
- `validateEnvironment` gains a second optional parameter, `{ today }`. Every existing caller passes one argument and keeps working.

Migrate / config:

- No migration, no configuration key, no environment variable. `fixtures/` ships in no image and no release path reads it.

Known gaps handed on, deliberately:

- **`docs/local-dev-environments.html` is stale after this commit.** Its layout block still lists seven fixture files and its step 9 still names `POST /api/leagues-archive/restore`. The architecture HTML docs belong to the retire-legacy ticket.
- **`fixtures/league-domain/v1/` is not deleted.** `backend/tests/Gones.UnitTests/LeagueParityTests.cs` and `backend/tests/Gones.IntegrationTests/LeagueArchiveRouteTests.cs:165-170` still read it. Deleting legacy is the retire-legacy ticket's job, and a TypeScript↔C# parity corpus for the three-tier domain would need a frontend exporter this fence forbids.
- **`demo` double-counts in the `global` player-statistics scope** until the legacy surface is retired, because the global scope folds in both `archive_tournaments` and `league_archive_aggregates` and `demo` carries four Tournaments in the legacy tier. Dev-only, documented, and it disappears with the legacy half.
- **`live-tournaments.json` still resolves its `leagueKey` against the legacy table.** When that table goes, `RequireLeagueReferenceAsync` needs re-pointing at `archive_league_seasons` and every fixture `leagueKey` needs re-pointing at a Season id. Not in this fence; flagged for the retire-legacy ticket.
- **The fixture archive ages.** See D2 and README step 7.4.

## Validation

- [ ] `npm run test` — green, including the three `ops/` suites.
- [ ] `npm run typecheck` — exit `0`.
- [ ] `npm run lint` — exit `0`.
- [ ] `npx vitest run ops/dev-environments.test.ts ops/stress-generator.test.ts ops/archive-domain-fixtures.test.ts` — every case green, no `.skip`.
- [ ] Determinism:

  ```bash
  npm run dev:stress:generate -- --seed=1 && sha256sum fixtures/dev-environments/stress/archive-*.json > /tmp/a
  npm run dev:stress:generate -- --seed=1 && sha256sum fixtures/dev-environments/stress/archive-*.json > /tmp/b
  diff /tmp/a /tmp/b && echo DETERMINISTIC
  ```

  Expected: `DETERMINISTIC`, exit `0`.
- [ ] Golden bundle round-trip:

  ```bash
  node -e "const{createHash}=require('node:crypto');const{readFileSync}=require('node:fs');const t=readFileSync('fixtures/archive-domain/v5/bundle.json','utf8');const m=JSON.parse(readFileSync('fixtures/archive-domain/v5/manifest.json','utf8'));console.log(createHash('sha256').update(t).digest('hex')===m.bundleSha256?'STAMPED':'DRIFT')"
  ```

  Expected: `STAMPED`.
- [ ] Manual, against a running local stack (`docker compose up -d --wait postgres migrator api worker`):

  ```bash
  npm run dev:env -- --env=demo
  ```

  Expected in the summary: `8 archive Leagues, 12 archive League Seasons, 48 archive Tournaments`.

  ```bash
  docker compose exec -T postgres psql -U gones_migration -d gones -tAc \
    "SELECT (SELECT count(*) FROM archive_leagues WHERE deleted_at IS NULL),
            (SELECT count(*) FROM archive_league_seasons WHERE deleted_at IS NULL),
            (SELECT count(*) FROM archive_tournaments WHERE deleted_at IS NULL),
            (SELECT count(*) FROM archive_tournaments WHERE season_id IS NULL AND deleted_at IS NULL),
            (SELECT count(*) FROM archive_league_seasons WHERE tournament_count = 0)"
  ```

  Expected: `8|12|48|5|1`.

  ```bash
  docker compose exec -T postgres psql -U gones_migration -d gones -tAc \
    "SELECT name, tournament_count, player_count, first_tournament_date, last_tournament_date
     FROM archive_league_seasons ORDER BY tournament_count DESC LIMIT 3"
  ```

  Expected: the `1996-97` Season first with `tournament_count = 11` and dates `1996-09-14` / `1997-07-12`; no `NULL` date on a Season whose `tournament_count > 0`.

  ```bash
  docker compose exec -T postgres psql -U gones_migration -d gones -tAc \
    "SELECT count(*) FROM archive_tournaments WHERE document ? 'seasonId' AND season_id IS NULL"
  ```

  Expected: `0` — a standalone Tournament never carries a `seasonId` key in its document.

  ```bash
  docker compose exec -T postgres psql -U gones_migration -d gones -tAc \
    "SELECT count(DISTINCT scope_kind || ':' || scope_id) FROM player_statistics"
  ```

  Expected: greater than `1` — the global scope plus one scope per League and per Season that has a completed Tournament.
- [ ] Re-run `npm run dev:env -- --env=demo` against the same stack. It must succeed, the archive counts must be unchanged, and no `(restored)` name may appear:

  ```bash
  docker compose exec -T postgres psql -U gones_migration -d gones -tAc \
    "SELECT count(*) FROM archive_leagues WHERE name LIKE '%(restored)%'"
  ```

  Expected: `0`.
- [ ] App functional — no broken path from this slice. `/live-tournaments` still lists the demo running tournaments, which proves the legacy `leagueKey` path survived.
- [ ] `git status --porcelain` shows nothing under `src/app/`, `backend/`, `cypress/` or `docs/`, and nothing under `fixtures/dev-environments/stress/` beyond `environment.json`.
- [ ] commit msg draft: `feat(fixtures): seed and generate three-tier archive data`
