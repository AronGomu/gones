# Three-Tier Archive: League, LeagueSeason, Tournament

## Status

Accepted. Not yet implemented. Supersedes ADR 0022's archive vocabulary — `leagues-archive` becomes
`archive` and the flat `League` becomes `LeagueSeason`. Amends ADR 0028 (dual-source League Archive)
and ADR 0042 (slim League Archive catalog); both survive, applied to the new shapes.

## Context

The archive is one tier wearing three hats. `LeagueDocument` in `src/app/domain/models.ts:54-59`
holds `tournaments: TournamentDocument[]`, and each `TournamentDocument` carries a `leagueId` back at
line 69. On the server that whole tree is a single row: `LeagueArchiveAggregate` serializes the
League and every Tournament inside it into one `canonical_document` jsonb column, capped at
`MaximumDocumentBytes = 1_048_576` bytes and `MaximumTournaments = 1_000` entries.

That shape has four problems, and only the first is cosmetic.

**A Tournament has no identity of its own.** It cannot be listed, fetched, cached or linked without
its League. `GET /api/leagues-archive/{id}` is the only way to reach one.

**Concurrency is League-wide.** `LeagueArchiveAggregate` derives `VersionedEntity`, so editing round
three of one Tournament rewrites the enclosing document and bumps the one shared `version`. Two
organizers correcting two different Tournaments of the same League conflict on a `412` that has
nothing to do with either edit.

**A Tournament cannot exist without a League, so a magic row exists instead.** Migration
`20260802204547_AddLeagueAggregates.cs:38-51` seeds a fixed row `placeholder-league` named
`Unassigned Tournaments`. It is guarded everywhere: `LeagueArchiveAggregate.SoftDelete` throws
`Placeholder League cannot be deleted.`, `Validate` refuses to let any other League take that name in
any language, `src/app/domain/models.ts:8-11` keeps a list of translated display names purely to stop
duplicates, and ADR 0028 had to mint a *second* one, `local-placeholder-league`, for the browser
store. Every one of those guards exists because the model has no null.

**There is no tier above a League.** A recurring event that ran in 2024, 2025 and 2026 is three
unrelated rows whose only link is that a human named them similarly.

Four shapes were considered.

1. **Keep the flat League, add a `seriesId` string column.** Cheapest. It gives the grouping and
   nothing else: the Tournament is still trapped inside a document, concurrency is still League-wide,
   and `placeholder-league` still has to exist. Rejected — it answers the least urgent problem.
2. **Three tiers with a League detail page**, navigated League → Season → Tournament. Rejected: a
   League owns a name and a list of Seasons, and that list is already the Seasons tab filtered by one
   value. A third route, a third breadcrumb level and a third empty state to maintain, for a page
   whose entire content is a filter that exists anyway.
3. **Give a Tournament both `seasonId` and `leagueId`.** Fast reads, no join. Rejected: two writable
   pointers to the same fact will disagree, and moving a Season to another League would become a
   fan-out rewrite of every child Tournament — which is exactly the League-wide write this ADR is
   trying to delete.
4. **Keep `tournaments[]` on the Season document and add Tournament rows as a read projection.**
   Rejected: two authorities for one fact, and a projection that can lag behind an edit is worse than
   a join that cannot.

## Decision

**Three tiers, one row per Tournament, and the League derived by a join.**

1. **The tiers.** `ArchiveLeagueDocument` is the new top tier — `id`, `name`, `createdAt` — and it
   groups Seasons. `LeagueSeasonDocument` is what used to be called a League — `id`, `name`,
   `leagueId`, `status`. `ArchiveTournamentDocument` is the bottom tier — `id`, `name`, `seasonId`,
   `tournamentDate`, `status`, `rounds`, `playerArchetypes`. They live in a new file
   `src/app/domain/archive-models.ts`, and in C# as `ArchiveLeague`, `ArchiveLeagueSeason` and
   `ArchiveTournament` in namespace `Gones.Domain.Archive`. The `Archive` prefix is deliberate: a
   bare `Tournament` would collide with the Live Tournament and with the Calendar Event that ADR 0035
   renamed. The TypeScript side keeps `LeagueSeasonDocument` unprefixed because it lives in a module
   where nothing collides.

2. **Every Tournament is its own row**, in table `archive_tournaments`, keyed by `document_id`, with
   `rounds` and `playerArchetypes` in a `document` jsonb column and `name`, `season_id`,
   `tournament_date`, `status` and `player_count` projected into real columns.
   `ArchiveLeagueDocument` carries no `tournaments[]`, and neither does `LeagueSeasonDocument`. The
   old `LeagueDocument.tournaments` array has no successor.

3. **A Tournament carries no `leagueId`.** Its League is derived by joining through `seasonId`.
   `seasonId` is `string | null`; a Season is optional for a Tournament, a League is mandatory for a
   Season. This is the one-pointer rule that makes option 3 above unnecessary: re-parenting a Season
   to another League is a single column write and every Tournament under it follows without being
   touched. `PATCH /api/archive/tournaments/{id}/season` with body `{ "seasonId": string | null }` is
   both the move operation and the way a Tournament is detached to standalone.

4. **Two tabs, and deliberately no League page.** `/archive/league-seasons` lists one row per Season
   and expands one level into its Tournaments. `/archive/tournaments` lists every Tournament,
   standalone ones included. League appears as the second line of the name cell and as the `?league=`
   filter on both tabs. There is no `/archive/leagues/:id` route and none is planned.

5. **`placeholder-league` is retired, replaced by `seasonId: null`.** `PLACEHOLDER_LEAGUE_ID`,
   `PLACEHOLDER_LEAGUE_NAME`, `isUnassignedLeagueName`, `LOCAL_PLACEHOLDER_LEAGUE_ID` and
   `LeagueNormalizer.PlaceholderLeagueId` all go, together with the aggregate guards that protect
   them. A standalone Tournament renders an empty League line in the Tournaments tab; it is not
   labelled "Unassigned", because there is no longer anything it failed to be assigned to.

6. **Concurrency is per Tournament.** Each row guards itself with its own `documentVersion`, mapped
   with `.IsConcurrencyToken()` over an `integer version` column, and a stale write is refused with
   the existing `412 stale_version` from `backend/src/Gones.Api/Errors/ApiExceptions.cs`. **A
   Tournament write never bumps its Season's or its League's version.** The two organizers of the
   third problem above no longer collide.

7. **Season counters are denormalized and recomputed in the same transaction as the Tournament
   write** — ADR 0042's pattern, extended one tier down. `archive_league_seasons` carries
   `tournament_count`, `player_count`, `first_tournament_date`, `last_tournament_date` and
   `counts_version`, exactly as `LeagueArchiveAggregate` carries `TournamentCount`, `PlayerCount` and
   `CountsVersion` today. A catalog query never deserializes a document, which is the whole point of
   ADR 0042 and is preserved here.

8. **Archive rows do not derive `VersionedEntity`**, following the precedent of
   `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModel.cs`, whose
   `PlayerStatisticsRow` does not either. `GonesDbContext.IncrementVersions` only auto-bumps
   `VersionedEntity`, so every archive write increments `version` explicitly. On the wire
   `documentVersion` is an `int`, not the `long` the League aggregate uses.

9. **Deletes respect the tiers.** `DELETE /api/archive/leagues/{id}` is refused with
   `409 archive_league_not_empty` while any Season still references it — a League is a grouping, and
   cascading it would silently destroy history. `DELETE /api/archive/league-seasons/{id}` **detaches**
   its Tournaments by setting `seasonId = null`; it never cascades a delete of tournament data.

10. **ADR 0028's dual-source rule survives, applied to three stores.** Browser-authored records live
    in a new IndexedDB database `gones-archive-local` with stores for Leagues, Seasons and
    Tournaments, and the `local-` id prefix stays the entire routing rule. Both tabs union the local
    and server lists at read time. The IndexedDB allowlist in
    `src/app/backend/server-authority-boundary.test.ts` — which today names exactly `indexed-db.ts`,
    `local-league-archive-backend.service.ts`, `local-live-backend.service.ts` and
    `server-read-cache.service.ts`, and whose comment says adding a file to it is an ADR decision —
    gains the new adapter. This ADR is that decision.

11. **The vocabulary rename supersedes ADR 0022's.** `leagues-archive` becomes `archive` in folders,
    routes and API paths; the flat `League` becomes `LeagueSeason` in every symbol, route, i18n key
    and document.

## Consequences

- **A Season's counters can disagree with its Tournaments.** The same three guards as ADR 0042 apply
  — they are written inside the transaction that writes the Tournament, they are never editable on
  their own, and `counts_version` lets a startup backfill re-derive exactly the stale rows — but the
  window is wider than before, because the Tournament write and the counter recompute now touch two
  tables instead of one.
- **Reading a Tournament's League is a two-hop join**, and a standalone Tournament has no League at
  all, so the Tournaments tab renders a blank second line for it. Indexes
  `ix_archive_tournaments_season_id` and `ix_archive_league_seasons_league_id` keep the hop cheap;
  the blank line is a real, visible asymmetry between attached and standalone rows, and it is the
  price of not storing a second pointer.
- **One row per Tournament means the Tournament catalog is unbounded**, where the League catalog was
  bounded by the number of Leagues. That is why the Tournament catalog is partitioned by year and
  `year` is a required query parameter, and why its row cap is 25,000 rather than ADR 0042's 1,000.
- **A League with no Seasons is invisible** except in the filter dropdown, because it has no page.
  Accepted: a League exists to group, and a group of nothing has nothing to show.
- **Three tiers means three command surfaces.** Creating a Season now needs a League to exist first,
  which is one more step than creating a League used to be. The alternative was inventing a default
  League, and a default nobody chose is the `placeholder-league` mistake again.
- **Retiring `placeholder-league` reaches well outside the archive.**
  `backend/src/Gones.Api/Live/LiveCommandEndpoints.cs:358-364` validates a live tournament's
  `leagueId` against `LeagueArchiveAggregates`, and it must be re-pointed at `archive_league_seasons`
  in the same commit that drops the legacy table or live seeding breaks. The migrator, the local seed
  script and the full-stack smoke script all assert the row exists.
- **ADR 0042's `LeagueArchiveSummary` and its `gones.leagues-archive.catalog.v2` `localStorage` key
  retire with the flat League.** The slim-row decision itself is kept and extended; only its concrete
  types and its storage medium change, the latter because catalogs move to IndexedDB.
- **The old and new surfaces coexist for the length of the rebuild.** New `/api/archive/**` routes
  are added beside the existing `/api/leagues-archive/**` ones and no compatibility shim is written;
  the legacy surface is deleted only when nothing calls it. Between the schema change and the new UI
  the archive is empty and the legacy pages render an empty list. That is expected, not a bug.
- **No API path aliases and no frontend redirects.** ADR 0022 kept `/leagues/:id` redirects because
  "Bookmarks and old links are a real user's problem"; Gones is unreleased and has no users, so that
  rationale is void and the old routes hit the 404 page.
