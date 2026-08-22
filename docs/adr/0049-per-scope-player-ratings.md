# Per-Scope Glicko-2 Player Ratings

## Status

Accepted. Not yet implemented. **Amends ADR 0040** (materialized player statistics read model): the
`player_statistics` table is re-keyed and holds one row per scope per player instead of one row per
player. **Amends ADR 0043** (Glicko-2 player rating): the deterministic replay runs once per scope
rather than once over the whole archive. Neither ADR's mechanism changes — the wholesale rewrite
inside the archive write transaction and the formula-version repair are what make this affordable.

## Context

Global Rankings shows one number per player. That number is a Glicko-2 rating replayed
deterministically from every completed Tournament in the server archive (ADR 0043) and materialized
on `player_statistics`, a table keyed by the player's name alone. The key is
`builder.HasKey(row => row.PlayerName)`, at
`backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModelConfigurations.cs:14`. Every
column of `PlayerStatisticsRow` is derived: matches, games, winrates, nemesis, rival, most-played
archetype, and the eight ADR 0043 rating columns.

The product owner asked the rankings page for a scope filter — pick a League, pick a Season, see the
ranking for it. The underlying question is a fair one: "who is the best player" is not a global
question in a game played in leagues. A player who dominates one Season and is ordinary elsewhere is
described badly by a single career number, and today there is no way to ask the smaller question at
all.

One rating per player cannot answer it, so something has to give. Three shapes were considered.

**Compute the scoped rating on demand.** Take the selected scope, load its completed Tournaments,
replay Glicko-2 over them per request. It needs no schema change and it is the obvious first idea.
It is also exactly the design ADR 0040 was written to delete: the old route
`/api/leagues-archive/global-player-statistics` loaded every completed archive document into memory
and walked every round on every request, O(all data) per view with no index and no cache. The
replay itself is not slow — ADR 0043 measured a full replay of the 100× dataset at 196 ms, 1183
rows from 201 Leagues — but that is a **write-time** cost paid a few times a week, and moving it to
read time pays it per page view, per sort click, per page turn, against an archive that ADR 0048's
sizing work expects to grow by orders of magnitude. Rejected.

**Multi-select scopes with an on-the-fly union.** On-demand replay makes a multi-select filter look
free, and that is the trap: a user could tick any subset of Seasons, and the number of subsets of
*n* Seasons is 2ⁿ. No stored row can serve an arbitrary subset, so multi-select and stored ratings
are mutually exclusive, and multi-select over replay is the previous rejected option with a worse
worst case. Rejected.

**Store per-scope ratings but merge them for multi-select.** This fails on the maths, not the
performance. A Glicko-2 rating is the endpoint of a sequential replay over rating periods, not a
quantity with a meaningful average; two scoped ratings cannot be combined into the rating the
combined replay would have produced. Rejected.

A fourth idea deserves recording because it is the tempting shortcut: **store the scoped rating but
keep the other columns global**, filtering the list of players down and leaving their career totals
in place. A row reading "rating 1712 in Season 4, 412 matches played" where 412 is the career figure
is a lie shaped like a fact, and nothing on the page would tell the reader which columns changed
meaning. Rejected.

## Decision

**Re-key the read model by scope, and store one full statistics row per (scope, player).**

1. **Re-key `player_statistics`.** It gains `scope_kind text NOT NULL DEFAULT 'global'` and
   `scope_id text NOT NULL DEFAULT ''`. Its primary key becomes
   `(scope_kind, scope_id, player_name)`, and a check constraint restricts `scope_kind` to
   `'global'`, `'league'` and `'season'`. `scope_id` is the empty string **exactly** when
   `scope_kind = 'global'`; empty for a league or season scope is not a wildcard, it is invalid.
   `PlayerStatisticsRow` gains `ScopeKind` and `ScopeId`; every other column is unchanged.
2. **The rebuild writes one row per (scope, player).** `PlayerStatisticsRebuildService` emits the
   global scope, one scope per League, and one scope per LeagueSeason. It stays a wholesale rewrite
   inside the transaction of the archive write that changed the data, exactly as ADR 0040 specifies,
   so the read model still cannot disagree with the archive it summarises and a rolled-back write
   rolls the statistics back with it. `PlayerStatisticsFormula.Version` is bumped in the same
   commit, which is what makes `PlayerStatisticsStartupRebuild` repair every stored row.
3. **The filter is single-select at both levels.** All, or exactly one League, or exactly one
   Season. This is not a UI simplification, it is the direct consequence of point 2: single-select
   means every scope the user can select is a scope that has a stored row, so the query is a
   primary-key lookup and there is no subset arithmetic anywhere in the system. Widening the control
   to multi-select would reopen the 2ⁿ problem, so it is a schema decision, not a widget decision.
4. **Every number is recomputed within the scope.** Rating, deviation, volatility, previous rating
   and last delta, matches, games, winrates, tournaments played, nemesis, rival and most-played
   archetype are all computed from that scope's completed Tournaments alone. A scoped row is a
   player's record **in that Season**, not their global record filtered down. The Glicko-2 replay
   starts from the published defaults — 1500 / 350 / 0.06 — inside the scope, so a scoped rating is
   a self-contained answer and never a slice of the global one.
5. **A visible scope badge states the active scope.** Because point 4 changes what every column
   means, a scoped number must never be readable as the global one. The badge is on the page
   whenever the scope is not All, and it names the League or Season, not just the fact that a filter
   is on.
6. **A standalone Tournament feeds the global scope only.** A Tournament with `seasonId: null`
   belongs to no Season and therefore, since the League is derived by joining through the Season, to
   no League. There is no league or season row for it to contribute to. The visible consequence: a
   player whose only results are standalone Tournaments appears in **All** and in **no** League or
   Season scope. That is correct, and it is stated here so nobody later files it as a missing row.
7. **An unknown scope is an empty page, not an error.** `scopeKind=league` or `scopeKind=season`
   with a `scopeId` that has no rows returns `200` with an empty page, never `404`. A deleted
   Season, a stale bookmark and a Season nobody has played in are indistinguishable from the read
   model's point of view, and all three want the same answer: this ranking is empty. `404` would
   make the rankings page render an error for a legitimately empty scope.
8. **The wire carries the scope, not the shape.** The paged route becomes
   `GET /api/archive/global-player-statistics` taking
   `?scopeKind=&scopeId=&page=&pageSize=&sort=&direction=&search=`, keeping the existing paged
   response's field names, with `scopeKind` defaulting to `global` and `scopeId` ignored when
   global; an invalid `scopeKind` is a `400`. The catalog twin
   `GET /api/archive/global-player-statistics/all?scopeKind=&scopeId=` mirrors the existing
   `/global-player-statistics/all` route
   (`backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs:52`) and keeps its
   `Gones:GlobalStats:MaximumCatalogSize` ceiling of 5000 (`PublicLeagueEndpoints.cs:35-36`). Both
   rankings routes are cached `public, max-age=60`, not the catalog hour, so an edit does not stay
   invisible in an HTTP cache for an hour.

## Consequences

- The table stops being one row per player. Its size becomes the sum over scopes of the distinct
  players in each scope: one global row per player, plus one row for every (League, player) pair
  with a result, plus one for every (Season, player) pair. A player who has played in one Season of
  one League costs three rows, not one. Storage scales with participation rather than with the
  player count, which is the honest cost of point 4.
- Rebuild time rises with it. Each completed Tournament is now replayed into at most three scopes —
  global, its League, its Season — so the upper bound is roughly three times ADR 0043's measured 196
  ms on the 100× dataset. That is a projection from the structure, not a measurement; the real
  figure is unknown until this is implemented and must be measured against the same stress dataset
  before the startup-rebuild budget in ADR 0040 is assumed to still hold.
- ADR 0043's two indexes on `rating` and `tournaments_played` no longer serve the ranking query on
  their own, because every query is now scope-first. They become scope-leading composite indexes or
  the scoped rankings scan the whole table.
- The rating delta shown next to a player becomes a **scoped** delta: the change across that
  player's most recent rating period *within the selected scope*. The same player can show a
  different delta under All and under a Season, and both are right.
- ADR 0043 derives *provisional* (fewer than 5 Tournaments) and *inactive* (no completed Tournament
  in 12 months) at read time from the stored `tournamentsPlayed` and `lastPlayedDate`. Those are now
  per-scope values, so a player who is comfortably ranked globally can be provisional inside a short
  Season. Most rows in a young Season scope will be provisional. This is a real degradation of how
  useful a fresh Season's ranking looks, and it is accepted rather than special-cased, because
  lowering the gate per scope would make a 2-tournament rating look authoritative.
- Because the rebuild is a wholesale rewrite, a deleted League or Season cannot leave orphan scope
  rows behind: the next rebuild simply does not emit them. No cleanup job is needed and none is
  written.
- `GET /api/players/{playerName}` (`backend/src/Gones.Api/Leagues/PlayerEndpoints.cs:30`, ADR 0040)
  keeps reading the global row and is unchanged by this ADR. Adding a scope selector to the player
  page is a later decision, and the rows it would need already exist.
- Browser-local archives (ADR 0028) still never reach the server, so they contribute to no scope,
  global included. ADR 0043's rule is unchanged, and the player page's `Online only` toggle keeps
  computing the local half in the browser.
