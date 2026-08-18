# Materialized Player Statistics Read Model

## Status

Accepted. Planned by T20–T26 in `ai_artefacts/PLAN_2026_08_15_feedback-app-wide-round-5.md`. Answers
the product owner's own question: "assuming hundreds of players, what is the most cost-efficient way
to store and load player statistics?"

## Context

Two surfaces show player statistics, and both recomputed everything on every view.

`GET /api/leagues-archive/global-player-statistics` loaded **every** completed
`LeagueArchiveAggregate` document into memory, walked every round of every tournament, then filtered,
sorted and paged the result in process — per request, with no cache and no index.

`/players/:name` was worse in a different direction: it called `repo.listLeagues()`, downloaded the
whole corpus to the browser, and ran `calculatePlayerStatistics` there.

Both are O(all data) per view. Neither survives the hundredfold dataset the product wants for design
stress testing. Meanwhile the write side is nearly free: tournaments land a few times a week.

The two surfaces also disagreed on scope. Rankings counted **completed leagues**; the player page
counted **all** leagues. One computation cannot honour both.

Asked to settle the scope, the product owner chose "only completed Tournaments" — a granularity the
domain did not express. `TournamentDocument` carried `id`, `leagueId`, `name`, `tournamentDate`,
`rounds` and `playerArchetypes`, and nothing else; `status` existed only on `LeagueDocument`. Deriving
completion from the data is not safe either: match scores are plain integers, so an unscored match and
a genuine 0–0 are the same bytes. Guessing would silently drop a whole tournament from every
statistic, with no error anywhere.

## Decision

**Give an Archive Tournament an explicit completion status**, and **materialize the statistics**.

- `TournamentDocument` gains `status: 'active' | 'completed'`, mirroring `LeagueStatus`, set by an
  organizer, carried through export, restore, import and the fixtures. It is reversible.
- A **new** tournament is created `active`. A document that **lacks** the field normalises to
  `completed` — the same rule as the one-time backfill, so no export written before this ADR loses
  its statistics. Note this is the opposite default to `normalizeLeagueStatus`, on purpose: an
  archive is history, and history is finished.
- Completing a League does **not** cascade to its tournaments. The two flags are independent.
- `LeagueRules.CalculateGlobalPlayerStatistics` filters on **tournament** status, replacing the
  league-level filter.
- Table `player_statistics` holds one row per player with every `GlobalPlayerStatistics` field, and
  `player_statistics_meta` holds the formula version and the last rebuild instant.
- The table is **rebuilt synchronously inside the same transaction** as every archive commit, import,
  restore and delete. A failed write rolls the statistics back with it, so the table can never
  disagree with the archive it summarises.
- `PlayerStatisticsFormula.Version` is a code constant. On startup, when the stored version differs
  (or no meta row exists), an `IHostedService` rebuilds before the API serves traffic, behind
  `Gones:PlayerStatistics:RebuildOnStartup` (default `true`).
- Both readers read the table: rankings become an indexed SQL query, and a new anonymous
  `GET /api/players/{playerName}` returns one player's statistics plus a **flat** match history —
  ids and names, never nested documents.
- The browser caches both responses under the ADR 0039 contract and keeps doing filter, sort and
  paging locally, so every existing filter-token and highlight feature survives.

## Consequences

- Reads become indexed and bounded. The cost moves to a write that happens a few times a week.
- Rankings and the player page can no longer disagree: they read the same row.
- **Numbers change on first deploy.** The scope moves from league-level to tournament-level
  completion. That is the decision, not a regression.
- **Bump `PlayerStatisticsFormula.Version` in the same commit as any change to the statistics
  maths.** Forgetting it leaves every untouched player computed by the old formula, with nothing to
  trigger a repair.
- Any path that writes archives **outside** a domain transaction — the bulk-SQL stress seeder is the
  only one — must trigger a rebuild explicitly and assert a non-zero row count.
- Browser-local League Archives (ADR 0028) never reach the server, so the read model cannot see them.
  The player page keeps its `Online only` toggle: off, it computes the local half in the browser and
  merges it into the totals and the history, marking local matches.
- **Measured startup rebuild against the 100× dataset (T29): 1183 rows from 201 Leagues in 177 ms.**
  The API answered `/health/ready` again 2.3 s after `docker compose restart api`, rebuild included,
  against the demo-scale baseline of 35 rows from 3 Leagues in ~88 ms. Two orders of magnitude more
  archive costs roughly twice the rebuild, because the fixed startup cost dominates and the work
  itself is a linear pass over 1.3 MB of documents. That is inside any container start budget, so the
  rebuild **stays in the API** and the `migrator` fallback is not taken. Revisit if the measurement
  ever approaches the readiness deadline: the move is one hosted-service registration and the code
  path is identical.
  <br>Dataset: `npm run dev:stress:generate -- --seed=1` then `npm run dev -- --env=stress` — 200
  League Archives, 400 Archive Tournaments, 4800 round entries over a pool of ~1200 player names.
