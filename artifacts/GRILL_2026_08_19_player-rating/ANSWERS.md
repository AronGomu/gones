# Grill: Player rating metric (Elo-style default ranking)

Goal (verbatim): implement an Elo / ranking system — a ranking stat taking every match played
(possibly games) into account, giving a player a rating used as the default metric on any global
ranking. Primary surface: global ranking across all leagues ever played. Secondary: leagues
themselves.

## Round 1 — Rating model & scope

Doc: `round-1.html` (12 questions). **Answered.**

| #   | Question                                      | Answer                                                                                        | Precision                                                                                                                                             |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Rating input: match result vs game score      | Match result, with the game score as a margin-of-victory multiplier                             | —                                                                                                                                                        |
| 2   | Algorithm family                              | Glicko-2 (rating + deviation + volatility, per rating period)                                   | —                                                                                                                                                        |
| 3   | Match ordering without timestamps             | Tournament **is** the rating period; all its matches use the ratings held before it started     | —                                                                                                                                                        |
| 4   | League rating: same number or separate replay | Leagues keep existing Swiss points standings; rating stays global-only                          | —                                                                                                                                                        |
| 5   | Byes and draws                                | Byes ignored entirely; draws = 0.5 against that opponent                                        | —                                                                                                                                                        |
| 6   | Minimum activity / provisional gate           | Provisional until N: rating shown, flagged, excluded from default ranking                       | **N = 5 tournaments** (not matches). Provisional players go to the bottom of the global rankings, flagged not-rankable-yet; stats + rating display normally. |
| 7   | Eligible archive data                         | Completed tournaments only — identical to ADR 0040 scope                                        | —                                                                                                                                                        |
| 8   | Browser-local archives (ADR 0028)             | Server data only; local leagues never contribute, UI says so                                    | —                                                                                                                                                        |
| 9   | Storage and recompute strategy                | Extend ADR 0040 read model: full deterministic replay in existing rebuild, new columns, version bump | —                                                                                                                                                   |
| 10  | Default sort + displaced metrics              | Rating = default sort on global rankings; league standings keep Swiss points, rating extra column | Ranked players sort by rating. Provisional players sort by tournaments played, then matches played.                                                     |
| 11  | Inactivity                                    | (a) Frozen rating + decaying confidence + inactive drop off default board **and** (b) true decay | Compute **both**. Default display = (a). (b) must be easy to enable later or show on another page.                                                       |
| 12  | Presentation shape                            | Integer plus change since the player's last tournament (±N)                                     | —                                                                                                                                                        |

### Contradiction found in Round 1 answers

Q4 ("rating stays global-only") vs Q10 ("league standings … with rating as an extra column").
Re-asked as Round 2 Q9.

### Round 1 consequences

- ±N delta (Q12) requires at least a stored `previousRating` — Round 2 Q7.
- The 5-tournament gate (Q6) requires a new `tournamentsPlayed` count; no such field exists anywhere today.
- Q11 requires two stored numbers plus a switch, not one.

## Round 2 — Constants, edge cases & surfaces

Doc: `round-2.html` (11 questions). **Answered — user chose every Recommended option and ended the grill.**

| #   | Question                                            | Answer                                                                                          | Precision |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------- |
| 1   | Glicko-2 seed constants + τ                         | Published defaults: rating 1500, RD 350, volatility 0.06, τ 0.5                                     | —         |
| 2   | Rating-period order for same-date tournaments       | Every tournament sharing a date forms **one combined rating period**                                | —         |
| 3   | Margin-of-victory multiplier shape                  | Fixed factor on the rating change: 2–0 ×1.25, 2–1 ×1.0                                              | —         |
| 4   | Equal scores / 0–0 handling                         | 1–1 and 2–2 are draws; **0–0 excluded from the rating** as unscored                                 | —         |
| 5   | Inactivity cutoff + leaderboard treatment           | Inactive = no completed tournament in 12 months → still listed, below active ranked players, badged | —         |
| 6   | True-decay variant: computation + exposure          | Second stored column, always computed in the rebuild, exposed by a config key + optional sort column | —         |
| 7   | Columns only vs rating history table                | **Columns only** — rating, deviation, volatility, previousRating, lastDelta, tournamentsPlayed, lastPlayedDate, decayedRating | — |
| 8   | Provisional players' influence on ranked ratings    | Yes, standard Glicko-2 — opponent deviation already damps the update                                | —         |
| 9   | Rating column in league standings (Q4/Q10 conflict) | Yes — **informational, non-sorting** column; Swiss order untouched                                  | Resolves the Q4/Q10 contradiction. |
| 10  | Player page with `Online only` off                  | Server rating unchanged, with a note that local matches never affect it                             | —         |
| 11  | ±N delta baseline + placement                       | Change across the player's own most recent rating period; shown on rankings row **and** player page | —         |

## Facts (scouted)

- A match is `MatchRoundEntry`: `player1Name`/`player2Name`, integer `player1Score`/`player2Score`
  (games won), archetypes. Draws representable and counted. — source: `src/app/domain/models.ts:89`
- Byes are a separate `ByeRoundEntry`, no opponent. — source: `src/app/domain/models.ts:101`
- Player identity is a trimmed name string. No player entity, no account link, no rating field.
  — source: `src/app/domain/player-stats.ts`, `backend/src/Gones.Api/Leagues/PlayerEndpoints.cs`
- Only time signal: `tournament.tournamentDate` (date, no clock) + round array index. Matches inside
  a round are unordered. — source: `src/app/domain/models.ts:67`, `src/app/domain/results.ts`
- Global statistics scope = tournaments with `status === 'completed'`. — source: ADR 0040,
  `src/app/domain/player-stats.ts:78`
- `player_statistics` / `player_statistics_meta` materialized, fully rebuilt synchronously inside
  every archive write transaction, guarded by `PlayerStatisticsFormula.Version`; startup rebuild via
  `IHostedService`. Measured 1183 rows from 201 leagues in 177 ms on the 100× dataset. — source: ADR
  0040, `backend/src/Gones.Api/Leagues/PlayerStatisticsRebuildService.cs`
- Browser-local leagues (`local-` id prefix) never reach the server; player page merges them
  client-side behind an `Online only` toggle. — source: ADR 0028, ADR 0040 consequences
- Existing standings are Swiss: 3/1/0 points, bye = 3 points and counts as a match win but not a
  played match, tiebreaks OMW% / OGW%. — source: `src/app/domain/results.ts:60`
- Global stats list sorts by name asc by default, then `matchWins` desc; filter/sort/page happen in
  the browser over a TTL-cached full catalog (ADR 0039). — source:
  `src/app/features/players/global-stats-query.ts`

### Scouted for Round 2

- `validateMatch` caps each score at 0–2 and rejects nothing else: **0–0, 1–1, 2–2 are all valid**,
  and 0–0 is byte-identical to an unscored match. Real margins: 2–0, 2–1, 1–0. — source:
  `src/app/domain/validation.ts:22`
- **No tournaments-played count exists** for a player anywhere in the code. The 5-tournament gate
  needs a new counted field. — source: repo-wide grep for `tournamentCount|tournamentsPlayed`
- `player_statistics` carries one index per statistic (8 today) and `GLOBAL_STATS_SORTABLE_COLS`
  mirrors them one-for-one. — source: `Migrations/GonesDbContextModelSnapshot.cs:2396`,
  `src/app/features/players/global-stats-query.ts:7`
- Exports carry league documents only: `PUBLIC_EXPORT_V4_LEAGUE_FIELDS = ['id','name','status','tournaments']`.
  No statistic is exported; all derived data is rebuilt on restore. — source:
  `src/app/domain/export-schemas.ts:12`
- Optional-behaviour config precedent: `PlayerStatisticsStartupRebuild.EnabledKey =
  "Gones:PlayerStatistics:RebuildOnStartup"`, const key + default. — source:
  `backend/src/Gones.Api/Leagues/PlayerStatisticsStartupRebuild.cs:25`
- `Online only` is a persisted preference (`player-online-only-toggle`) that merges local leagues
  into displayed statistics. — source: `src/app/features/players/player-detail.component.ts:66`

## Deferred to Round 3 (blocked on Round 2)

- API/DTO shape, cache keys, TTL wiring, OpenAPI regeneration (blocked on R2 Q7)
- Migration + formula-version bump mechanics, rebuild cost re-measurement on the 100× dataset
  (blocked on R2 Q1, Q7)
- Exact table columns, sort keys, i18n keys, `data-cy` hooks, empty/provisional/inactive copy
  (blocked on R2 Q5, Q9, Q11)
- Rating-over-time chart (blocked on R2 Q7)
- Decay rate constants (blocked on R2 Q6)
- Duplicate / renamed player identity and anti-abuse; interaction with `rename-player.ts`
- Whether the rating needs an ADR of its own (likely yes: it changes the ADR 0040 scope)

## Assumptions (unasked, recorded)

- The rating ranks individual players only. Team/multiplayer formats are not in the archive shape.
- Live Tournaments (ADR 0021) are out of scope until they land in the archive.
- The rating is **derived, never exported**: `PUBLIC_EXPORT_V4_LEAGUE_FIELDS` is unchanged and a
  restore recomputes it.
- Default leaderboard order is a three-bucket partition, in this order: **active ranked** (rating
  desc) → **inactive ranked** (rating desc, badged) → **provisional** (tournaments played desc, then
  matches played desc). Only the ranked/provisional split was stated explicitly; placing inactive
  between them follows from R1 Q10 + R2 Q5.
- Player identity stays the trimmed name string. A rename changes the key and the deterministic
  replay simply produces the renamed player's rating; no merge logic is added.
- A single tournament's own result table is unchanged (R2 Q9 covers league standings only).
- Decay rate for the `decayedRating` column is unspecified; pick it at implementation time and
  document it with the formula version.

## Out of scope (logged, not asked)

- Matchmaking / pairing changes driven by rating.
- Archetype- or deck-level ratings.
- Player accounts or identity unification, and anti-abuse beyond what deviation already damps.
- Rating-over-time chart (needs a history table; R2 Q7 deliberately deferred it).

## Shared understanding

**Goal.** One rating number per player, computed from every match in the server archive, used as the
default ordering of the global rankings.

**Settled.**

- **Algorithm** — Glicko-2 with published defaults (1500 / RD 350 / vol 0.06 / τ 0.5). Rating,
  deviation and volatility are all stored.
- **Rating period** — one calendar date. Every completed tournament on that date is folded into a
  single period, so no match order inside a period matters and same-date tournaments need no
  tiebreak. Periods replay in date order.
- **Input** — one update per match, win/draw/loss, multiplied by a margin factor: a 2–0 sweep counts
  ×1.25, a 2–1 counts ×1.0. Byes are ignored. 1–1 and 2–2 are draws worth 0.5; **0–0 is excluded**
  because it is indistinguishable from an unscored match.
- **Eligibility** — completed tournaments only (ADR 0040 scope), server data only. Browser-local
  archives (ADR 0028) never contribute; the player page states this when `Online only` is off.
- **Provisional** — fewer than 5 tournaments played. The rating and all statistics still display,
  flagged as not rankable, sorted to the bottom by tournaments played then matches played. Their
  matches still move ranked players' ratings by standard Glicko-2.
- **Inactivity** — no completed tournament in 12 months. Rating is frozen, deviation keeps growing,
  and the player sits below active ranked players with a badge. A second `decayedRating` column is
  always computed but hidden behind a config key, ready to enable later.
- **Storage** — new columns on `player_statistics`, filled by a full deterministic replay inside the
  existing ADR 0040 rebuild transaction, with `PlayerStatisticsFormula.Version` bumped. No history
  table. New counted field `tournamentsPlayed`; new `lastPlayedDate`; `previousRating` powers the ±N.
- **Surfaces** — rating is the default sort of the global rankings and appears with its ±N change
  since the player's last rating period, on both the rankings row and the player page. League
  standings keep Swiss points as their order and gain a non-sorting informational rating column.

**Confirmed by:** user, 2026-08-19 — "Go with all recommended options. End grill."
