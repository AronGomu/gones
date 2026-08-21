# Feedback

## General

1. On small page 760px or less : sign in, Login, logout buttons, account redirection are not justified right in the header. Fix it.

### Synchronized Data

### Back button

Remove the back button from every page that starts the breadcrumb. For example : the menu page.

### Logging Out

## Test Data

## Home page

1. Rename french translation : "Classement Mondial" => "Classement Global"

2. Rename card "Calendar" to "Events".

## About page

## Global Rankings Page

1. Move global rankings title and the synchronize button with the latest synchronization. Move them on the same row on a large enough screen size. If not enough space, keep current behavior.

2. Remove from the table the number of games, the game win rates, the game loss, and the game percentage columns. The stat still exists for determining which player is first on a tie, but it is not shown on the table anymore.

3. Rename de column header MW to Wins, ML to Losses, MD to Draw.

4. Add to Archetype header => Archetype (match number). Remove the number of match from each parenthesis section.
   Formatting : {archetype} ({number_of_matches_played_with_the_archetype})

5. Add a new column: Number of tournaments played.

## Player Stats Page

## Events Page

### Calendar View

### List View

Whenever a tournament is past date, meaning that the starting hour and day were before the current date and hour, you currently remove the register button, but also remove the add‑to‑calendar button. It's not possible to add a tournament to your calendar that is already running or done.

## Events/{id} page

1. The font size from h1 is too big for the title. Removing "clamp(2rem, 12vw, 4rem)" fixed using web console.

2. Remove full timestamp with date, time and GTM. Leave only adress

3. Max Player Number and Starting hour should not be on the same row as tournament name.

4. New order for "event-detail-hero" :
   {title of tournament} (bigger font thatn others)
   {description of the event} {keep current color and size}
   {date in natural language} - Start Hour : {Starting hour}
   {location}

5. Move the number of player on the same row as "event-detail-kicker-link" but justified right : "X players"

6. Keep list of organizers at the bottom

## Sign in Page

## Admin Page

### Users Page

### Organizations

## Settings Page

1. When updating the language, make sure that the breadcrumb updates also.

## Leagues Archive

1. "1.44 MB uncompressed for the 201-league catalog. Gzips to 103 KB, but no response compression is configured anywhere (ResponseCompression absent from the API, nothing in deploy/, compose.yaml, Dockerfile). Enabling it is a separate, app-wide change — I did not touch it."
   => I see two solutions for this. The first is implementing compression to zip all the leagues and do it continuously. I don't know the technical cost of that, or how much time it takes if you have only a few leagues compared to not doing it. The second option is to generate diffs and only fetch the new tournaments and leagues. Basically, the front end sends its current state for all leagues and tournaments, includes a hash for each, and the back end returns only the new or updated data. Because I don't mind loading all the league at once, even if it's a big size. There is also maybe a third solution, which is to simply paginate the leaks and load only the 10 latest at all times, and maybe all its own leaks. Now that I think about it, probably the best solution is doing the diffs and loading only the leagues ten at a time. Maybe combining all 3.

   **Settled.** The payload is fat for one reason: `/api/leagues-archive/all` ships whole League
   documents — every Tournament, Round and Match — so the list cards can print two numbers,
   `league.tournaments.length` and `calculateLeagueResult(league).rows.length`. 201 Leagues x ~7.2 KB
   of document = 1.44 MB. None of the three options above touch that; they compress, diff or paginate
   a body that should never have been that size.

   1. **Slim the catalog.** Denormalize `TournamentCount` and `PlayerCount` onto
      `LeagueArchiveAggregate`, written in `Create` and `Apply` from
      `LeagueRules.CalculateLeagueResult(...).Rows.Count` — the backend already computes the same
      number the frontend does. Migration plus backfill. `/api/leagues-archive/all` then returns
      summary rows (id, name, status, updatedAt, version, tournamentCount, playerCount), roughly
      150 bytes each: ~30 KB for 201 Leagues, ~150 KB at the `MaximumCatalogSize` ceiling of 1000.
      Estimate, to be measured on the 100x stress environment once built.

   2. **Enable response compression** (brotli + gzip) app-wide. Cheap, helps every endpoint, no
      precomputed blob needed — ASP.NET compresses per response and the catalog is already ETagged
      with `public, max-age=3600`, so most repeat reads are 304s that compress nothing.

   3. **Paginate the list page in the browser, not over the wire.** The slim catalog arrives whole,
      so the page slices it for display. Server-side paging is refused: it would break the
      client-side name filter and the union with the browser-local Leagues (ADR 0028), and the paged
      summary rows carry no counts anyway.

   4. **No diff protocol.** It buys nothing the existing machinery does not already give: the
      catalog has an ETag and a 304, and the browser holds it for 24h in `localStorage` (ADR 0039),
      so a repeat visit costs zero bytes. A diff only helps the first load, where a diff is a full
      load. Any single write bumps `UpdatedAt` and invalidates the whole-catalog ETag regardless.
      Cost side: a request body kills HTTP caching and it needs a client-side merge store.

   Side effect worth having: 1.44 MB of JSON is ~2.9 MB as UTF-16 in `localStorage`, against a ~5 MB
   quota. The slim catalog removes that risk.

   Known breakage to handle in the same change:

   - The Settings export path (`LeagueArchiveRepository.listLeagues()`) genuinely needs full
     documents. It needs its own route or an explicit `?documents=true`, and it is where compression
     actually pays.
   - `PublicLeagueCatalogApiTests` asserts a catalog item is byte-identical to the detail item. That
     assertion changes.
   - Browser-local Leagues compute their counts client-side with the existing
     `calculateLeagueResult`.
   - The list component's server half moves from `PersistedLeague[]` to a summary type.

2. "GET /api/leagues-archive (paged) now has zero frontend callers. Left in place: public API surface with its own tests and pagination/search/status filters. Yourcall whether to retire it."
   => remove it. Consistent with item 1.3: pagination lives in the browser, so no endpoint has to
   serve it.

3.

## Player Rating (Glicko-2)

Settled design, from the grill session in `artifacts/GRILL_2026_08_19_player-rating/` (round-1.html,
round-2.html, ANSWERS.md). Needs its own ADR because it changes what the ADR 0040 read model holds.

1. Goal : one rating number per player, computed from every match in the server archive, used as the
   default ordering of the Global Rankings page.

2. Algorithm : Glicko-2 with the published defaults — rating 1500, deviation 350, volatility 0.06,
   tau 0.5. Rating, deviation and volatility are all stored. Chosen over plain Elo because it carries
   confidence, which answers the new-player problem and the inactive-player problem without inventing
   rules.

3. Rating period = one calendar date. Every completed Tournament on that date folds into a single
   period, so match order inside a period never matters and two same-day Tournaments need no
   tiebreak. Periods replay in date order. This is the only reason the missing timestamp on
   `tournamentDate` is not a problem.

4. One update per Match, win / draw / loss, multiplied by a margin-of-victory factor : a 2-0 counts
   x1.25, a 2-1 counts x1.0. The Glicko score term stays 1 / 0.5 / 0 so the deviation maths stays
   valid.

5. Byes are ignored entirely — a bye is pairing luck, not skill. Swiss standings keep awarding their
   3 points, unchanged.

6. Draws score 0.5. 1-1 and 2-2 are draws. **0-0 is excluded from the rating** : validation accepts
   it, but it is byte-identical to a Match nobody scored, and guessing would invent results. It still
   counts in the existing statistics.

7. Scope : completed Tournaments only, identical to the ADR 0040 statistics scope, and server data
   only. Browser-local League Archives (ADR 0028) never contribute. With `Online only` off, the
   player page shows the server rating unchanged plus a note that local Matches never affect it.

8. Provisional players : fewer than 5 Tournaments played. Rating and stats display normally, flagged
   as not rankable yet, sorted to the bottom of the Global Rankings by tournaments played, then
   matches played. Their Matches still move ranked players' ratings by standard Glicko-2 — their high
   deviation already damps the update, which is exactly why Glicko-2 was chosen.

9. Inactive players : no completed Tournament in 12 months. The rating is frozen, the deviation keeps
   growing, and the player is listed below active ranked players with a badge — never hidden.

10. A second `decayedRating` column (the number itself drifting toward the mean while idle) is always
    computed during the rebuild but never shown by default. It is exposed by a config key following
    the `Gones:PlayerStatistics:RebuildOnStartup` precedent, plus an optional sort column, so it can
    be switched on later or given its own page without a rebuild. Decay rate still to pick.

11. Storage : new columns on `player_statistics`, no history table. `rating`, `ratingDeviation`,
    `ratingVolatility`, `previousRating`, `lastRatingDelta`, `tournamentsPlayed`, `lastPlayedDate`,
    `decayedRating`. Note `tournamentsPlayed` does not exist anywhere today and the 5-Tournament gate
    needs it as a real counted field — it also answers the Global Rankings request for a
    number-of-tournaments column.

12. Computation : a full deterministic replay inside the existing ADR 0040 rebuild transaction, so an
    edit to an old Tournament self-heals. `PlayerStatisticsFormula.Version` must be bumped in the same
    commit, and the 100x dataset rebuild cost re-measured. The rating is derived, never exported :
    `PUBLIC_EXPORT_V4_LEAGUE_FIELDS` is unchanged and a restore recomputes it.

13. Display : integer rating plus the change across the player's own most recent rating period (+N /
    -N), on both the Global Rankings row and the player page. Rating becomes the default sort of the
    Global Rankings.

14. League standings keep Swiss points as their order and gain an **informational, non-sorting**
    rating column. A single Tournament's result table is unchanged.

15. Out of scope : rating-driven pairing, archetype-level ratings, player identity unification, and a
    rating-over-time chart (that one needs the history table this design deliberately skipped).
