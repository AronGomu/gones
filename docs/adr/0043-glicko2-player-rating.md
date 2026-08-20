# Glicko-2 Player Rating

## Status

Accepted, implemented by T13–T19. Extends ADR 0040 (player statistics read model) — it changes what that read model holds and bumps its formula
version to 2. Settled by the grill in `artifacts/GRILL_2026_08_19_player-rating/` (round-1.html,
round-2.html, ANSWERS.md), confirmed by the product owner on 2026-08-19.

## Context

The Global Rankings page sorted by name, then match wins. That answers "who won the most matches",
not "who is the best player": it rewards volume, ignores opposition strength, and has no way to say
how confident it is about anyone.

Player identity in Gones is a trimmed name string. There is no player entity and no account link. The
only time signal on an archived Tournament is `tournamentDate` — a date with no clock — and Matches
inside a Round are unordered. So any rating had to work without a total order over matches.

## Decision

**Glicko-2, replayed deterministically from the server archive, stored on `player_statistics`.**

### Algorithm

Published defaults: rating 1500, deviation 350, volatility 0.06, τ 0.5. All three numbers are stored.
Glicko-2 over plain Elo because it carries confidence, which answers the new-player problem and the
inactive-player problem without inventing rules.

### Rating period

**One calendar date.** Every completed Tournament on that date folds into a single period, so match
order inside a period never matters and two same-day Tournaments need no tiebreak. Periods replay in
date order. This is the only reason the missing timestamp on `tournamentDate` is not a problem. A
Tournament with an empty date contributes to the statistics and not to the rating.

### Input

One update per Match, score 1 / 0.5 / 0, multiplied by a margin-of-victory factor: a 2-0 counts
×1.25, a 2-1 counts ×1.0. The factor multiplies each Match's term in `Δ` and in the `μ'` sum only —
`v`, and therefore the new deviation, is computed from the unweighted terms, because `v` depends on
the opponents' deviations and the expected scores and never on the outcomes. That is what "the Glicko
score term stays 1 / 0.5 / 0 so the deviation maths stays valid" means in the formula.

- **Byes are ignored entirely.** A bye is pairing luck, not skill. Swiss standings keep awarding their
  3 points, unchanged.
- **1-1 and 2-2 are draws** worth 0.5.
- **0-0 is excluded from the rating.** Validation accepts it, but it is byte-identical to a Match
  nobody scored, and guessing would invent results. It still counts in the existing statistics.

### Scope

Completed Tournaments only — identical to the ADR 0040 statistics scope — and **server data only**.
Browser-local League Archives (ADR 0028) never contribute. With `Online only` off, the player page
shows the server rating unchanged plus a note saying local Matches never affect it.

### Provisional and inactive

- **Provisional:** fewer than 5 Tournaments played. Rating and statistics display normally, flagged as
  not rankable yet, sorted to the bottom of the Global Rankings by tournaments played, then matches
  played. Their Matches still move ranked players' ratings by standard Glicko-2 — their high deviation
  already damps the update, which is exactly why Glicko-2 was chosen.
- **Inactive:** no completed Tournament in 12 months. The rating is frozen, the deviation keeps
  growing, and the player is listed below active ranked players with a badge — never hidden.

Both are **derived at read time** from the stored `tournamentsPlayed` and `lastPlayedDate` plus the
request clock, never stored: otherwise a player would go inactive at the next rebuild rather than on
the day. The rankings ETag therefore carries the request date.

Default rankings order, three buckets: **active ranked** (rating desc) → **inactive ranked** (rating
desc, badged) → **provisional** (tournaments played desc, then matches played desc). Every tie breaks
on the ordinal player name, ascending.

### Decay

A second `decayedRating` — the number itself drifting toward the mean while idle — is **always**
computed during the rebuild and never shown by default:

    decayed = 1500 + (rating - 1500) × 0.5 ^ (idleMonths / 24)

One constant, `Glicko2Decay.HalfLifeMonths = 24`. It is exposed by
`Gones:PlayerStatistics:ExposeDecayedRating` (default `false`), following the
`Gones:PlayerStatistics:RebuildOnStartup` precedent, plus an optional sort column. The column is
already stored, so flipping the key needs no rebuild.

### Storage

New columns on `player_statistics`, **no history table**: `rating`, `ratingDeviation`,
`ratingVolatility`, `previousRating`, `lastRatingDelta`, `tournamentsPlayed`, `lastPlayedDate`,
`decayedRating`. `tournamentsPlayed` did not exist anywhere before this ADR; the 5-Tournament gate
needs it as a real counted field, and it also answers the Global Rankings request for a
number-of-tournaments column. It counts distinct completed Tournaments in which the player has at
least one valid Match — the same denominator as `playedMatchCount`, so a bye-only appearance does not
count.

### Computation

A full deterministic replay inside the existing ADR 0040 rebuild transaction, so an edit to an old
Tournament self-heals. `PlayerStatisticsFormula.Version` goes to **2** in the same commit, which is
what makes `PlayerStatisticsStartupRebuild` repair every stored row.

**Measured cost.** Same 100× dataset, same shape as ADR 0040 — 1183 rows from 201 Leagues — rebuilt in
**196 ms** at formula version 2, against ADR 0040's **177 ms** at version 1. Median of three startup
rebuilds against the running stack (272.11 / 194.78 / 195.62 ms; the first is a cold start straight
after the seed). So the whole replay — every completed Tournament regrouped into rating periods and
folded through Glicko-2 — costs about **19 ms**, roughly 11% on top of the counting pass, on a write
that happens a few times a week. That is why the replay is total rather than incremental: nothing here
justifies the complexity of working out which players an edit could have moved.

The replay reads one clock, the rebuild's, and only for idle deviation growth and the decayed rating.
It is a **date** and the idle span is counted in whole months, so rebuilding twice on the same day
produces byte-identical rows.

The rating is **derived, never exported**: `PUBLIC_EXPORT_V4_LEAGUE_FIELDS` is unchanged and a restore
recomputes it.

### Surfaces

- Global Rankings: integer rating plus the change across the player's own most recent rating period
  (+N / -N), a Tournaments column, provisional and inactive badges. Rating is the default sort.
- Player page: the same rating and delta, tournaments played, and the rating's state.
- League standings keep Swiss points as their order and gain an **informational, non-sorting** rating
  column. A single Tournament's result table is unchanged.

## Consequences

- ADR 0040's read model is no longer only "materialized statistics"; it also holds a replayed rating.
  Its formula version is the single mechanism that keeps both correct.
- A rename changes the identity key, so the replay simply produces the renamed player's rating. No
  merge logic is added; `rename-player.ts` is unchanged.
- Two new indexes on `player_statistics` (`rating`, `tournaments_played`) for the ranking order.
- Without a history table there is no rating-over-time chart. That was deliberately deferred; adding
  it later means adding the table, not changing this design.
- Out of scope and staying out: rating-driven pairing, archetype-level ratings, player identity
  unification, anti-abuse beyond what the deviation already damps, and Live Tournaments until they
  land in the archive.
