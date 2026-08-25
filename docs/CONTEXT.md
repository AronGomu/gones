# Gones

Gones manages tournament results across leagues so players and organizers can review standings, rounds, and player statistics.

## Language

**Tournament**:
A completed or in-progress event whose standings and rounds can be imported, edited, and reviewed in Gones.
_Avoid_: SpiceRack event

**Tournament Date**:
The optional date associated with a Tournament.
_Avoid_: Creation date

**League**:
A named collection of Tournaments whose results are combined.
_Avoid_: Season when dates are meant

**Active League**:
A League that can still receive tournament source data changes.
_Avoid_: Running league

**Completed League**:
A League whose tournament source data is preserved for review and no longer receives normal tournament source-data edits.
_Avoid_: Finished league

**Archive**:
The stored archive of past results on three tiers — League → LeagueSeason → Tournament. It is served under `/api/archive` and persisted in `archive_leagues`, `archive_league_seasons` and `archive_tournaments`. Browsed at `/archive/league-seasons` and `/archive/tournaments`.
_Formerly_: League Archive, `/api/leagues-archive`, `league_archive_aggregates` (ADR 0022); before that, the Leagues feature and `/api/leagues`
_Avoid_: Calendar, Live Tournament

**League** (archive tier):
The top archive tier. Groups LeagueSeasons. It has no page of its own — it is a column and a filter.
_Avoid_: Season when a single run is meant

**LeagueSeason**:
The middle archive tier: one run of a League, with a mandatory parent League. This is what used to be called a League.
_Formerly_: League (the flat archive record)
_Avoid_: League on its own

**Archive Tournament**:
A historical result Tournament, and a first-class top-level record: it is its own row, served under `/archive/tournaments/:tournamentId`, and `seasonId: null` means it stands alone in no LeagueSeason. It locks to non-Admin writes 365 days after its `tournamentDate`. Distinct from the Event people register for and from a Live Tournament being run.
_Formerly_: Result Tournament, the `/tournaments-archive` path segment (ADR 0022)
_Avoid_: Scheduled Tournament

**Unassigned Tournaments**:
Retired. The fixed `placeholder-league` row that used to hold Tournaments belonging to no League. Replaced by `seasonId: null` on a standalone Tournament; the row, its id and its name are gone.
_Avoid_: as a name for anything new

**Event**:
The Calendar V1 record an organizer publishes and a User registers for: base title, venue, venue-local dates, exactly one active Tournament Format, capacity, and optional Live/Archive Tournament links. It is served under `/api/events`, browsed at `/events`, read at `/events/:slug` and persisted in `events` (ADRs 0035–0036, 0038). An Event is tied to one single-format tournament conceptually, and that tournament has no row of its own. Public responses derive the display title from format plus base title.
_Formerly_: Scheduled Tournament, Calendar Tournament, `/api/tournaments`
_Avoid_: Tournament on its own, Archive Tournament, Live Tournament

**Scheduled Tournament**:
Retired (ADR 0035). The word the Calendar V1 record carried before the rename. It survives only inside identifiers the rename deliberately left alone — `ScheduledTournamentStatus`, the import planner, the `account_owns_records` relation labels — never in product language.
_Avoid_: as a name for anything new

**Organization**:
The association an Event is published under. It owns a roster of members in `organization_members`, each an `Organizer` (one role, no Owner hierarchy), and that roster is the only source of truth for the account-wide Organizer role (ADRs 0034, 0041).
_Avoid_: Club, team, Gones organization data

**Draft Organization**:
An Organization with zero members. Never stored — derived as `memberCount == 0` and surfaced as `isDraft`. It can be created, edited, restored and deleted, but publishing an Event under it is refused with `409 organization_is_draft`, and the Event-create picker does not offer it (ADR 0034).
_Avoid_: Empty organization, inactive organization, Draft as a state of an Event

**Tournament Import**:
The act of bringing externally formatted tournament data into Gones.
_Avoid_: Scrapping, crawl, raw text

**SpiceRack Import**:
A Tournament Import that reads data exported from SpiceRack.
_Avoid_: SpiceRack tournament

**Round Import**:
A Tournament Import that brings Round and Match data into Gones.
_Avoid_: Standings import

**Round Import Format**:
The CSV shape used to paste Round Entry source data into Gones.
_Avoid_: SpiceRack format as the canonical model

**Round Replacement**:
Replacing all Round Entries in one Round with newly entered or imported Round Entries.
_Avoid_: Append import

**Player Name**:
The name recorded on a Match result to identify who played.
_Avoid_: Player entity, account, user

**Player Statistics**:
A derived view that aggregates all Matches with a specific Player Name.
_Avoid_: Player profile, player account

**User**:
A logged-in account that can access Gones.
_Avoid_: Player, Player Name

**Organizer User**:
A User allowed to modify tournament source data.
_Avoid_: Admin when account management is meant

**Admin User**:
A User allowed to manage which Users are Organizer Users.
_Avoid_: Organizer when account management is meant

**Visitor**:
An unauthenticated person who can consult and export public Gones data without modifying source data.
_Avoid_: Viewer User, Player

**Bye Count**:
The number of Byes assigned to a Player Name.
_Avoid_: Bye win

**Played Match Count**:
The number of non-bye Matches played by a Player Name.
_Avoid_: Total match count

**Match Assignment Count**:
The number of played Matches plus Byes assigned to a Player Name.
_Avoid_: Played matches

**Match Winrate**:
The share of played non-bye Matches won by a Player Name, with draws counted as non-wins.
_Avoid_: Winrate when game winrate is meant

**Played Game Count**:
The sum of game wins and game losses in played non-bye Matches. Individual game draws are not recorded.
_Avoid_: Match count

**Game Winrate**:
The share of counted games won by a Player Name in played non-bye Matches.
_Avoid_: Winrate when match winrate is meant

**Most Played Archetype**:
The Deck Archetype used by a selected Player Name in the most Matches, with alphabetical Player Archetype name order breaking ties.
_Avoid_: Favorite deck

**Global Player Statistics**:
Derived Player Statistics rows from valid Matches in **completed Archive Tournaments** (across every non-deleted LeagueSeason plus standalone Tournaments, whatever a Season's own status). Materialized in the `player_statistics` table and rebuilt transactionally on every archive write (ADR 0040). Position is assigned by the API or UI later.
_Avoid_: Stored global ranking

**Nemesis**:
The opposing Player Name with the most Match wins against a selected Player Name.
_Avoid_: Worst matchup

**Rival**:
The opposing Player Name with the most played Matches against a selected Player Name.
_Avoid_: Frequent opponent

**League Result**:
A derived view of tournament results across a League.
_Avoid_: Stored ranking

**Round**:
A set of Round Entries in a Tournament at the same stage.
_Avoid_: Pairing list

**Round Entry**:
An ordered source-data item in a Round.
_Avoid_: Match when the entry may be a Bye or Invalid Round Entry

**Match**:
A played result between two Player Names in a Round.
_Avoid_: Game

**Valid Match**:
A Match with enough information to contribute to calculated results.
_Avoid_: Complete row

**Invalid Round Entry**:
A Round Entry preserved for correction but excluded from calculated results.
_Avoid_: Deleted line

**Match Outcome**:
The win, loss, or draw result of a Match.
_Avoid_: Score

**Game Score**:
The number of games won by each Player Name inside a Match.
_Avoid_: Match score

**Deck Archetype**:
The archetype name recorded for a Player Name on a Match result when available.
_Avoid_: Decklist when full card lists are not meant, Deck as a standalone MVP entity

**Tournament Points**:
Points awarded from Match Outcomes inside a Tournament.
_Avoid_: Game points

**Opponents' Match Win Percentage**:
A tiebreaker based on how well a Player Name's opponents performed in Matches.
_Avoid_: OMW as the only label

**Game Win Percentage**:
A tiebreaker based on a Player Name's Game Scores.
_Avoid_: GW as the only label

**Opponents' Game Win Percentage**:
A tiebreaker based on how well a Player Name's opponents performed in games.
_Avoid_: OGW as the only label

**Bye**:
A Round assignment where a Player Name has no opponent.
_Avoid_: Bye player

**Tournament Result**:
A derived view of a Tournament's Rounds.
_Avoid_: Imported standing, stored standing

**Incomplete Tournament**:
A Tournament with at least one missing Match or Invalid Round Entry.
_Avoid_: Broken tournament

**Provisional Result**:
A derived result calculated from currently valid Matches while some Tournament data remains incomplete.
_Avoid_: Partial ranking

**Pairing Warning**:
A warning that a Tournament has unusual but usable pairing data.
_Avoid_: Pairing error

**Delete**:
Removing a League, Tournament, Round, or Match from Gones' active dataset.
_Avoid_: Archive

**Gones Export**:
Creating a JSON source-data backup for one League or the full Gones dataset.
_Avoid_: Round Import, Report Download

**League Export**:
A Gones Export covering one League and its source data.
_Avoid_: Full Data Export, Report Download

**Full Data Export**:
A Gones Export covering all Leagues and their source data.
_Avoid_: League Export, Report Download

**Gones Restore**:
Importing source data from a Gones Export.
_Avoid_: Merge import, Report Download

**League Restore**:
A Gones Restore that creates a League from a League Export.
_Avoid_: Full Data Restore, overwrite

**Full Data Restore**:
A Gones Restore that imports the full Gones dataset from a Full Data Export.
_Avoid_: League Restore

**Report Download**:
Creating a presentation PDF or image of a Tournament Result, League Result, or Player Statistics.
_Avoid_: Gones Export, backup

**Gones Data Version**:
The version of the Gones data shape used in a Gones Export.
_Avoid_: App version

**Gones App Version**:
The version of the Gones application that created a Gones Export.
_Avoid_: Gones Data Version

**Ranking Table**:
A UI table for presenting Tournament Results or League Results.
_Avoid_: Generic table

**Round Editor**:
A UI component for editing Round Entries in one Round.
_Avoid_: Ranking Table

**Data Authority**:
The single place that owns Gones source data. Always **Server Mode**; declared explicitly, never inferred, and never switched while the app runs. ADR 0020 retired the browser authority, so there is no second value.
_Avoid_: Backend mode, storage mode, fallback

**Server Mode**:
The only deployment (`dataMode: server`): the Gones API database owns every piece of source data. The browser keeps only language, view preference, filters and a public read cache — plus the local Live store below.
_Avoid_: Online mode, hybrid mode

**Live Tournament**:
A Tournament being run in the app: registration, Swiss pairings, score entry, checkpoints and a finalize step. It is the one capability with two authorities (ADR 0021), chosen once by role at injection time: **Organizer** and **Admin** run it against the API; anonymous visitors and the plain **User** role run it against the local Live store.
_Avoid_: Running Tournament as a second name, Draft

**Local Live Store**:
The strictly offline IndexedDB database (`gones-live` / `tournaments`) that holds Live Tournaments for anonymous visitors and the plain **User** role. It never synchronises in either direction, it lives in one browser profile, and finalizing from it produces a JSON download instead of writing a League. Being able to put a Live Tournament on the server is what **Organizer** means.
_Avoid_: Legacy Browser Mode, offline mode, cache

**Legacy Browser Mode**:
Retired (ADR 0020). The former static deployment (`dataMode: legacy-browser`) where the browser store owned League, Live Tournament and Calendar Event source data. Its adapter, pages and migration-bundle export are deleted; the value is now refused at build time, at container start and in the browser.
_Avoid_: Offline mode, local mode

**Migration Bundle**:
A private, per-browser snapshot of every Legacy Browser Mode store, produced in Settings for the offline Migrator and never uploaded from the browser.
_Avoid_: Gones Export, backup

**Live Cutover**:
The future, deferred operation that inventories every legacy origin and browser, imports their Migration Bundles into Server Mode, and retires the Legacy Browser Mode build after a soak.
_Avoid_: Migration, deployment

## UI Conventions

- Create and add actions use the green/success color scheme; ghost create/add actions use green text and a green border.
- Delete, remove, cancel-destructive, and destructive actions use the red/danger color scheme; ghost destructive actions use red text and a red border.
- Warning messages and warning state indicators use the yellow/warning color scheme.

## Relationships

- A **Tournament** may be created through a **Tournament Import**
- A **Tournament** may be created manually without a **Tournament Import**
- A **Tournament** may have a **Tournament Date**
- A **League** may contain zero or more **Tournaments**
- An empty **League** has no **League Result**
- A **Tournament** belongs to exactly one **League**
- A Tournament counts toward a **League Result** when it belongs to that League
- A **LeagueSeason** belongs to exactly one **League**
- An **Archive Tournament** belongs to at most one **LeagueSeason**; with none it is standalone
- A standalone **Archive Tournament** contributes to the global Player Statistics scope only
- Retired archive URLs are not redirected: `/leagues-archive/**` renders the 404 page. ADR 0022 kept redirects for bookmarks; Gones is unreleased with zero users, so that rationale is void. ADR 0022's "no API path aliases" rule still stands and `/api/leagues-archive/**` returns 404
- League dates are descriptive and do not filter which Tournaments count
- A **SpiceRack Import** is one possible kind of **Tournament Import**
- An **Event** belongs to exactly one **Organization**
- An **Event** has exactly one active **Tournament Format**
- An **Event** may link to one **Live Tournament** and one **Archive Tournament**; links are navigation only, not data authority
- An **Organization** may have zero or more members; with zero it is a **Draft Organization**
- A **Draft Organization** may hold existing **Events** but may not publish a new one
- A **User** holding at least one **Organization** membership is an **Organizer User**; losing the last one returns them to **User**, and an **Admin User** is never changed by membership
- A build has exactly one **Data Authority**: either **Legacy Browser Mode** or **Server Mode**
- A build with no satisfiable **Data Authority** refuses to start rather than choosing one
- **Legacy Browser Mode** produces a **Migration Bundle** and never reaches the Gones API
- **Server Mode** exposes **User**, **Organizer User** and **Admin User** capabilities; **Legacy Browser Mode** exposes none of them
- A **Live Cutover** moves data from **Legacy Browser Mode** to **Server Mode** and is deferred
- A **Round Import** is the only supported kind of Tournament Import data
- A **Round Import** performs a **Round Replacement** for its targeted Round
- A **Round Import** removes leading and trailing whitespace from imported fields
- A **Round Import** ignores blank lines
- The current **Round Import Format** is `table,player,result,opponent,player_decklist,opponent_decklist`
- The current **Round Import Format** requires a matching header row before Round Entries
- The current **Round Import Format** supports quoted CSV fields
- Rows with extra columns do not match the current **Round Import Format**
- Rows with missing columns do not match the current **Round Import Format**
- The current **Round Import Format** uses explicit result text such as `Won 2-0`, `Lost 1-2`, or `Draw 1-1`
- The current **Round Import Format** may record Deck Archetypes for both Player Names
- Deck Archetype data from Round Import is preserved in canonical Match source data
- The current **Round Import Format** treats malformed rows as Invalid Round Entries
- Current Angular migration preserves existing Round Import behavior through adapters before redesigning import semantics
- A **Tournament** is not tied to SpiceRack after import
- Gones has no independent Player entity outside recorded Match results
- A **User** is distinct from a **Player Name**
- A **Player Name** is edited only by changing the name recorded on Match results
- Two different **Player Names** represent different statistical identities, even when they look like variants of the same real person
- **Player Name** matching is exact after removing leading and trailing whitespace
- **Player Name** matching is case-sensitive
- `bye` is not allowed as a **Player Name**, ignoring case
- A **Player Name** cannot be empty
- **Player Statistics** aggregate by exact trimmed Player Name across all Leagues
- **Player Statistics** may be filtered by opposing Player Name
- **Player Statistics** may be filtered by League or Tournament
- **Player Statistics** include only active, non-deleted Tournaments and Leagues
- **Player Statistics** include valid Matches from Incomplete Tournaments
- **Leagues** have a status of active or completed
- The persisted League status value for a Completed League is `completed`
- Legacy `finished` League status values are normalized to `completed` during migration
- A Completed League blocks normal tournament source-data edits
- Users can reopen a Completed League by changing it back to active before editing
- **Leagues** are public in the frontend-only MVP
- **Leagues** are not owned by individual **Organizer Users**
- Admin and Organizer remain design concepts for the future backend-backed product
- The frontend-only MVP has no login, authentication, authorized-user list, or role-management behavior
- Any MVP user can consult, export, restore, and modify tournament source data in browser storage
- **Delete** is destructive in the MVP
- A **Delete** removes a Match rather than preserving it as an Invalid Round Entry
- **Gones Export** preserves source data for round-trip restore
- **Gones Export** is distinct from **Round Import**
- **Gones Export** is distinct from **Report Download**
- **Gones Export** is part of the MVP
- **League Export** covers one League, including all Tournaments, Rounds, and Round Entries in that League
- **Full Data Export** covers all Leagues and their source data
- Visitors, Organizer Users, and Admin Users can perform Full Data Export
- **Gones Export** includes descriptive League dates
- **Gones Export** includes Tournament names and Tournament Dates
- **Gones Export** stores source data, not derived results
- **Gones Export** does not store derived warnings
- **Gones Export** preserves **Invalid Round Entries** for later correction
- **Gones Export** includes a **Gones Data Version**
- **Gones Export** includes a **Gones App Version**
- **Gones Restore** imports source data from a Gones Export
- **Gones Restore** modifies canonical source data
- Organizer Users and Admin Users can perform League Restore
- Only Admin Users can perform Full Data Restore
- **League Restore** creates a new League by default
- **League Restore** preserves the exported League name unless it must distinguish a duplicate
- **League Restore** gives the imported League and its Tournaments new identities
- **Full Data Restore** imports restored Leagues alongside existing Leagues by default
- **Full Data Restore** does not overwrite the full active dataset in the MVP
- **Full Data Restore** gives imported Leagues and their Tournaments new identities
- **Gones Restore** rejects malformed or unsupported Gones Exports
- **Gones Restore** preserves **Invalid Round Entries** from valid Gones Exports
- **Report Download** does not create source-data backup files
- **Report Download** can present a Tournament Result, League Result, or Player Statistics
- A **League Result** is recalculated from the League's Tournaments after relevant data changes
- A **Tournament** may contain zero or more **Rounds** while editing
- A **Round** contains zero or more **Round Entries**
- A **Round** may be empty while editing
- An empty **Round** contributes nothing to calculated results
- **Round** order matters for display and recency
- **Round** order does not affect Tournament Points or tiebreaker calculations
- MVP **Round** order comes from creation or import order
- MVP Gones does not support manual Round reordering
- Deleting a **Round** removes it from Round order
- Remaining **Rounds** are displayed by their current order after a Round is deleted
- A **Match** has one **Match Outcome**
- A **Match** may have a **Game Score**
- A **Round Entry** can be a **Match**, **Bye**, or **Invalid Round Entry**
- **Match** source data records neutral Player Name, Game Score, and Deck Archetype fields rather than winner and loser fields
- Canonical Match source data uses `table`, `player1Name`, `player2Name`, `player1Score`, `player2Score`, `player1DeckArchetype`, and `player2DeckArchetype`
- Table is optional source data on Round Entries and does not affect rankings
- Round Import adapters convert source-format fields such as `table`, `player`, `result`, `opponent`, `player_decklist`, and `opponent_decklist` into canonical Match source data
- Legacy import headers named `player_decklist` and `opponent_decklist` contain Deck Archetype data, not full Decklists
- `result` strings are not canonical Match source data after migration
- Round Import adapter tests must preserve Deck Archetype data during conversion
- **Match Outcome** is derived from Match source data
- **Round Entry** source data distinguishes Matches, Byes, and Invalid Round Entries with `kind` values of `match`, `bye`, and `invalid`
- A `kind: "match"` Round Entry is a **Valid Match**
- A malformed Round Entry uses `kind: "invalid"` until corrected
- Canonical Invalid Round Entry source data preserves `rawText` and may include optional editable fields matching Match or Bye correction fields
- MVP **Match** order within a Round comes from creation or import order
- MVP Gones does not support manual Match reordering
- A played **Valid Match** has two different Player Names, a Match Outcome, and a Game Score
- A **Valid Match** may instead assign one Player Name a **Bye**
- Canonical Bye source data uses `table`, `playerName`, and `playerDeckArchetype`
- A **Bye** Round Entry requires a non-empty allowed Player Name
- An empty Player Name makes a Match invalid
- A Match with the same Player Name on both sides is invalid
- A drawn **Valid Match** has equal Game Score values
- A won **Valid Match** has a higher Game Score for the winner than the loser
- A **Game Score** counts game wins only; drawn individual games are ignored
- A **Game Score** uses non-negative integers only
- A **Game Score** can award at most 2 game wins to the Match winner and at most 1 game win to the Match loser
- A drawn **Valid Match** has a Game Score of 0-0 or 1-1
- A 0-0 drawn **Valid Match** awards Tournament Points and match draw records, but adds no counted games
- **Tournament Points** are awarded from Match Outcomes
- A Match win awards 3 **Tournament Points**
- A Match draw awards 1 **Tournament Point** to each Player Name
- A Match loss awards 0 **Tournament Points**
- A **Bye** is not a **Player Name**
- A **Bye** counts as a Match win for Tournament Result and League Result
- A **Bye** does not count toward Player Statistics match win/loss statistics or game statistics
- A **Bye** does not count toward **Game Win Percentage**
- A **Bye** awards Tournament Points to its assigned Player Name
- Bye Tournament Points contribute to **League Result**
- Ranking records display Byes as wins
- Byes contribute to opponent-derived Match Winrate records
- Byes do not contribute to opponent-derived Game Win Percentage records
- A **Bye** contributes to **Bye Count**
- A Player Name with only Byes can appear in Tournament Result and League Result
- Unqualified "winrate" means **Match Winrate**
- **Played Match Count** excludes Byes
- **Match Assignment Count** includes Byes
- **Player Statistics** show Played Match Count and Bye Count as primary counts
- **Player Statistics** record Match wins, losses, and draws separately
- **Played Game Count** equals game wins plus game losses
- **Match Assignment Count** is helper language, not a primary statistic
- **Player Statistics** include both **Match Winrate** and **Game Winrate**
- Draws count as non-wins in **Match Winrate**
- Individual drawn games are ignored in **Played Game Count** and **Game Winrate**
- **Match Winrate** and **Game Winrate** are N/A when they have no denominator
- **Match Winrate** and **Game Winrate** display as percentages with 2 decimal places when defined
- **Player Statistics** use raw percentages without tiebreaker floors
- **Nemesis** excludes Byes and is the opponent with the most wins against the selected Player Name
- **Nemesis** and **Rival** records expose wins and losses from the selected Player Name's perspective
- **Nemesis** ties are broken by opposing Player Name in alphabetical ascending order
- **Rival** excludes Byes and is the opponent with the most played Matches against the selected Player Name
- **Rival** ties are broken by opposing Player Name in alphabetical ascending order
- **Most Played Archetype** counts the selected side's Match Deck Archetype once per Match, falls back to that Tournament's roster when blank, and omits the Match when both are blank
- **Most Played Archetype** ties are broken by Deck Archetype name in alphabetical ascending order
- These alphabetical tie rules are the user-confirmed future-recommendation override and supersede the previous worst-rate and recency recommendations
- **Global Player Statistics** include valid Match participants from completed Archive Tournaments only (league status does not filter; ADR 0040)
- Byes and roster-only Player Names do not create **Global Player Statistics** rows or affect Global performance
- Archive Tournaments whose status is `active` do not contribute to **Global Player Statistics**
- Browser-local archive records never contribute to **Global Player Statistics**; the source is always the server
- **Global Player Statistics** expose 11 columns in fixed order, labelled: `#`, Player, Rating, Tournaments, Matches, Wins, Losses, Draw, M%, Rival, Archetype (matches) — plus a 12th `Decayed` column shown only when `Gones:PlayerStatistics:ExposeDecayedRating` is on. Nemesis stays on the wire and on the Player Statistics page, but has no Global Rankings column
- Position in **Global Player Statistics** is dynamic: it reflects the current sort and search result, not a stored rank
- **Global Player Statistics** identity is case-sensitive exact Player Name; `Alice` and `alice` are different rows
- **Player Rating** is a Glicko-2 rating replayed from all archived tournament results; one integer on the wire per player; server data only. The rating **is stored**, in eight `player_statistics` columns (`rating`, `ratingDeviation`, `ratingVolatility`, `previousRating`, `lastRatingDelta`, `tournamentsPlayed`, `lastPlayedDate`, `decayedRating`) rewritten by the transactional rebuild (ADR 0040/0043); only **provisional** and **inactive** are derived at read time from those columns plus the request clock
- A player is **provisional** when they have fewer than 5 `tournamentsPlayed`; provisional players sort to the bottom of the Global Rankings by `tournamentsPlayed` desc then `playedMatchCount` desc
- A player is **inactive** when they have no completed tournament in the last 12 months; inactive players sort below active ranked players and above provisional players
- **Global Player Statistics** default order: active ranked (rating desc) → inactive ranked (rating desc) → provisional (tournamentsPlayed desc, matches desc); every bucket ties broken by Player Name ascending
- **Global Player Statistics** are browsable at `/global-stats`; the page supports search, sort by numeric column, and pagination (10/25/50/100 per page, default 100)
- **Global Player Statistics** sort: numeric column click sets descending; second click toggles ascending; ties broken by Player Name ascending
- Sorting **Global Player Statistics** by Rating (or by `Decayed`) keeps **provisional** players below every ranked player in both directions, ordered by that same rating among themselves; **inactive** players stay inside the rating order. Every other column sorts on its value alone
- Percentages in **Global Player Statistics** display as whole-number percentages; null values display as `—`
- Rival cells in **Global Player Statistics** display as `Name (W-L)`; Archetype displays as `Name (N matches)`
- **Power User** mode is a browser-local opt-in that reveals advanced mutation controls; it never grants server authority and never hides home cards or browse destinations including **Global Player Statistics**
- Gones is unreleased with no production environment; local data may be reset or reshaped without production migration guarantees until the release-state note in `AGENT.md` is explicitly replaced
- An **Event** has exactly one active Tournament Format; the optional `liveTournamentUrl` and `archiveTournamentUrl` are navigation strings, not data authority links
- A **Tournament Result** is recalculated from the Tournament's Rounds after relevant data changes
- A **League Result** is recalculated from Tournament Results after relevant data changes
- An **Incomplete Tournament** may still produce a **Provisional Result**
- A **Provisional Result** excludes missing Matches and **Invalid Round Entries**
- An empty **Tournament** is an **Incomplete Tournament**
- A **League Result** may be provisional when it includes an **Incomplete Tournament**
- A provisional **League Result** includes valid Matches from Incomplete Tournaments
- A **Tournament Import** preserves invalid imported lines as **Invalid Round Entries** for correction
- Valid imported Round Entries do not preserve raw import text
- **Invalid Round Entries** preserve raw import text until edited
- Manual Match edits can create **Invalid Round Entries**
- Editing an **Invalid Round Entry** makes the edited fields the source data
- Correcting an **Invalid Round Entry** can turn it into a **Match** or **Bye**
- **Invalid Round Entry** reasons are derived from source data
- A repeated Match between the same two Player Names in one Tournament creates a **Pairing Warning** but still counts
- A Player Name appearing in multiple Matches in one Round creates a **Pairing Warning** but still counts
- Multiple Byes in one Round create a **Pairing Warning** but still count
- Each **Tournament** contributes equally to a **League Result**
- Ties in a **Tournament Result** are broken by **Opponents' Match Win Percentage**, then **Game Win Percentage**, then **Opponents' Game Win Percentage**, then Player Name
- Ties in a **League Result** use league-wide **Opponents' Match Win Percentage**, **Game Win Percentage**, and **Opponents' Game Win Percentage** calculated across all Tournaments in that League
- A **Ranking Table** presents calculated Tournament Result or League Result rows
- A **Ranking Table** does not calculate results from Rounds
- Tournament Result and League Result rows are sorted by domain calculation before reaching a **Ranking Table**
- A **Ranking Table** row may navigate to **Player Statistics** for that Player Name
- A **Round Editor** edits Round Entries and does not present ranking rows
- **Round Import** is performed from the **Round Editor** for the targeted Round
- A **Round Editor** can add Match and Bye Round Entries manually
- A **Round Editor** shows Invalid Round Entries inline for correction
- Warning summaries may point to Invalid Round Entries but do not replace inline correction
- A **Round Editor** shows Pairing Warnings inline without excluding the affected Round Entries
- MVP Tournament pages show Round Editors directly for visibility
- MVP Tournament pages show Tournament Result before Round Editors
- MVP League pages show League Result before the Tournament list
- MVP Leagues list shows lightweight League summaries, not full League Results
- MVP includes a **Player Statistics** page
- **Player Statistics** page can be opened from **Ranking Table** rows
- **Player Statistics** page identifies the selected player by encoded Player Name, not a player ID
- **Player Statistics** page defaults to server-origin archive data and can include browser-local Tournaments with a persisted display toggle
- **Player Statistics** page lays its metrics out in three rows: Match Winrate, Matches Played, Match Wins, Match Losses, Match Draws; then Game Winrate, Games Played, Game Wins, Game Losses, Match Draw Percentage; then Most Played Archetype, Nemesis, Rival
- **Player Statistics** Match history is filtered and sorted before client-side paging; page size persists, page index resets after data or view changes
- **Player Statistics** filters are represented in the page URL
- League and Tournament pages identify source entities by internal IDs in the URL
- **Opponents' Match Win Percentage** is treated as 0 for ranking tiebreakers when there are no opponents
- **Opponents' Game Win Percentage** is treated as 0 for ranking tiebreakers when there are no opponents
- **Game Win Percentage** is treated as 0 for ranking tiebreakers when it has no denominator
- **Opponents' Match Win Percentage** applies a 33% floor to each opponent's Match Winrate contribution
- **Opponents' Game Win Percentage** applies a 33% floor to each opponent's Game Win Percentage contribution
- Opponent-derived tiebreaker floors apply even when the opponent contribution has no denominator
- **Opponents' Match Win Percentage** uses **Match Winrate**, where draws are non-wins
- Tiebreaker sorting uses full precision
- Tiebreaker display uses percentages with 2 decimal places
- Opponent-derived tiebreaker contributions use each opponent's full record
- **Tournament Result** opponent-derived tiebreakers use each opponent's full record in that Tournament
- **League Result** opponent-derived tiebreakers use each opponent's full record in the League
- **Game Win Percentage** has no floor when used for a Player Name's own result

## Example dialogue

> **Dev:** "If we import a **Tournament** from SpiceRack, should later edits still depend on SpiceRack?"
> **Domain expert:** "No - SpiceRack is only a source for the **Tournament Import**. After import, the **Tournament** belongs to Gones and can be edited manually."
>
> **Dev:** "Can an organizer enter a paper Tournament without importing?"
> **Domain expert:** "Yes - a **Tournament** can be created manually, and imports are only a convenience."
>
> **Dev:** "Can standings CSV create a Tournament Result?"
> **Domain expert:** "No - imports should bring in **Rounds**, because results are calculated from **Matches**."
>
> **Dev:** "If I paste corrected Round 2 data, should it add to Round 2?"
> **Domain expert:** "No - a **Round Import** replaces the targeted **Round**."
>
> **Dev:** "Should pasted score fields like ` 2 ` be accepted?"
> **Domain expert:** "Yes - a **Round Import** removes leading and trailing whitespace from imported fields."
>
> **Dev:** "Should blank lines become invalid Round Entries?"
> **Domain expert:** "No - **Round Import** ignores blank lines."
>
> **Dev:** "Can a Player Name contain a comma in pasted CSV?"
> **Domain expert:** "Yes - the **Round Import Format** supports quoted CSV fields."
>
> **Dev:** "Should `Alice;Bob;2;1` import as a Match?"
> **Domain expert:** "No - the current **Round Import Format** uses comma-separated fields with the header `table,player,result,opponent,player_decklist,opponent_decklist`."
>
> **Dev:** "Should extra CSV columns be ignored?"
> **Domain expert:** "No - rows with extra columns do not match the current **Round Import Format**."
>
> **Dev:** "Should `Alice,Bob,2` import as a partial Match?"
> **Domain expert:** "It is preserved as an **Invalid Round Entry** because it does not match the current **Round Import Format**."
>
> **Dev:** "Does the current import need explicit result text?"
> **Domain expert:** "Yes - the current **Round Import Format** uses result text such as `Won 2-0`, `Lost 1-2`, or `Draw 1-1`."
>
> **Dev:** "Can pasted Round CSV include deck archetype fields?"
> **Domain expert:** "Yes - the current **Round Import Format** may record a **Deck Archetype** for both Player Names, even though legacy headers say `decklist`."
>
> **Dev:** "Can pasted Round CSV omit the header row?"
> **Domain expert:** "No - the current **Round Import Format** requires its matching header row before Round Entries."
>
> **Dev:** "Should `Alice,BYE,1,0` import as a **Bye**?"
> **Domain expert:** "No - the current **Round Import Format** does not import Byes from a `bye` opponent row."
>
> **Dev:** "Can a real participant use `bye` as their Player Name?"
> **Domain expert:** "No - `bye` is reserved and is not allowed as a **Player Name**."
>
> **Dev:** "Does an empty opponent field mean **Bye**?"
> **Domain expert:** "No - a **Bye** must be explicit. An empty **Player Name** makes the Match invalid."
>
> **Dev:** "Can a Bye have an empty assigned Player Name?"
> **Domain expert:** "No - a **Bye** Round Entry requires a non-empty allowed **Player Name**."
>
> **Dev:** "Can Alice play a valid Match against Alice?"
> **Domain expert:** "No - a Match with the same **Player Name** on both sides is invalid."
>
> **Dev:** "Should `Demo  Player 05 ` and `Demo Player 05` be merged automatically?"
> **Domain expert:** "No - they are different **Player Names**. If a name is wrong, the organizer edits the Match results that contain it."
>
> **Dev:** "Is there a Player record I can rename globally?"
> **Domain expert:** "No - Gones has no independent Player entity. A **Player Name** exists only on Match results."
>
> **Dev:** "Should imported standings be kept as the official outcome?"
> **Domain expert:** "No - the **Tournament Result** is calculated from **Rounds**. Imported standings should not remain as a separate source of truth."
>
> **Dev:** "If Alice beats Bob 2-1, are those tournament points or game counts?"
> **Domain expert:** "The win gives Alice **Tournament Points** from the **Match Outcome**. The 2-1 is the **Game Score** for game statistics and tiebreakers."
>
> **Dev:** "Should a drawn Match store a winner or loser?"
> **Domain expert:** "No - Match source data records neutral Player Name and **Game Score** fields, and **Match Outcome** is derived."
>
> **Dev:** "Should a Bye be stored as an opponent named `bye` or a null opponent?"
> **Domain expert:** "No - **Round Entry** source data uses an explicit kind to distinguish **Matches** from **Byes**."
>
> **Dev:** "Should invalid imported rows live outside the Round?"
> **Domain expert:** "No - a **Round** contains ordered **Round Entries**: **Matches**, **Byes**, and **Invalid Round Entries**."
>
> **Dev:** "Can Alice's win over Bob count if the Game Score is missing?"
> **Domain expert:** "No - a played **Valid Match** needs both a **Match Outcome** and a **Game Score**."
>
> **Dev:** "Can a Match be a draw if the Game Score is 1-0?"
> **Domain expert:** "No - a drawn **Valid Match** must have equal **Game Score** values."
>
> **Dev:** "Can Alice win a Match with a 1-1 Game Score?"
> **Domain expert:** "No - the winner's **Game Score** must be higher than the loser's."
>
> **Dev:** "Can Alice win a Match 1-0?"
> **Domain expert:** "Yes - **Game Score** counts only game wins, and individual drawn games are ignored."
>
> **Dev:** "Can a Game Score be 2.0 or -1?"
> **Domain expert:** "No - **Game Score** uses non-negative integers only."
>
> **Dev:** "Can a drawn Match have a 2-2 Game Score?"
> **Domain expert:** "No - a drawn **Valid Match** can be 0-0 or 1-1."
>
> **Dev:** "Does a 0-0 draw affect **Game Winrate**?"
> **Domain expert:** "No - it awards draw **Tournament Points** and match draw records, but adds no counted games."
>
> **Dev:** "Should a **Bye** behave like an opponent named `bye`?"
> **Domain expert:** "No - a **Bye** is not a **Player Name**. It counts as a ranking win, but not as a Player Statistics match or game."
>
> **Dev:** "Does a **Bye** still help the assigned Player Name's Tournament Result?"
> **Domain expert:** "Yes - a **Bye** awards **Tournament Points** and counts as a Match win for rankings."
>
> **Dev:** "How does a ranking record display two played wins, two losses, one draw, and one Bye?"
> **Domain expert:** "As 3-2-1, because ranking records display Byes as wins."
>
> **Dev:** "Should a **Bye** increase Player Statistics winrate?"
> **Domain expert:** "No - it only increases **Bye Count**."
>
> **Dev:** "Do Byes count as played matches on the player page?"
> **Domain expert:** "No - **Played Match Count** excludes Byes. **Match Assignment Count** includes them."
>
> **Dev:** "Should Match Assignment Count be a primary player stat?"
> **Domain expert:** "No - show **Played Match Count** and **Bye Count** as primary counts."
>
> **Dev:** "Can a Player Name with only Byes appear in standings?"
> **Domain expert:** "Yes - Byes count as ranking wins, even when the Player Name has no played Matches."
>
> **Dev:** "When Gones says winrate, does it mean matches or games?"
> **Domain expert:** "Unqualified winrate means **Match Winrate**. The player page should also show **Game Winrate** separately."
>
> **Dev:** "Does a draw count as half a win for **Match Winrate**?"
> **Domain expert:** "No - draws count as non-wins."
>
> **Dev:** "Do individually drawn games affect **Game Winrate**?"
> **Domain expert:** "No - **Game Winrate** uses only counted game wins and losses."
>
> **Dev:** "Is winrate 0% when there are no played Matches?"
> **Domain expert:** "No - winrate is N/A when it has no denominator."
>
> **Dev:** "How should Player Statistics winrates display?"
> **Domain expert:** "Display **Match Winrate** and **Game Winrate** as percentages with 2 decimal places when defined."
>
> **Dev:** "Should **Player Statistics** apply the 33% tiebreaker floor?"
> **Domain expert:** "No - **Player Statistics** use raw percentages."
>
> **Dev:** "If two opponents beat Alice the same number of times, who is Alice's **Nemesis**?"
> **Domain expert:** "Use the opposing Player Name that sorts first alphabetically."
>
> **Dev:** "If Alice played Bob and Claire the same number of times, who is Alice's **Rival**?"
> **Domain expert:** "Use the opposing Player Name that sorts first alphabetically."
>
> **Dev:** "Can a Tournament have no date?"
> **Domain expert:** "Yes - **Tournament Date** is optional."
>
> **Dev:** "Does a League end date exclude later Tournaments?"
> **Domain expert:** "No - League dates are descriptive. A **Tournament** counts when it belongs to the **League**."
>
> **Dev:** "Can one Tournament count in two Leagues?"
> **Domain expert:** "No - a **Tournament** belongs to exactly one **League**."
>
> **Dev:** "Does Round order change Tournament Points?"
> **Domain expert:** "No - **Round** order matters for display and recency, not scoring."
>
> **Dev:** "What happens to Round order when Round 2 is deleted?"
> **Domain expert:** "The **Round** is removed, and remaining **Rounds** are displayed by their current order."
>
> **Dev:** "Can users manually reorder Rounds in the MVP?"
> **Domain expert:** "No - MVP **Round** order comes from creation or import order."
>
> **Dev:** "Can users manually reorder Matches in a Round?"
> **Domain expert:** "No - MVP **Match** order comes from creation or import order."
>
> **Dev:** "Can a Tournament have an empty Round while being edited?"
> **Domain expert:** "Yes - an empty **Round** is allowed and contributes nothing."
>
> **Dev:** "Can a Tournament exist before any Rounds are added?"
> **Domain expert:** "Yes - it is incomplete and contributes nothing until it has valid Matches."
>
> **Dev:** "If two Player Names have equal **Tournament Points**, what decides the order?"
> **Domain expert:** "Use **Opponents' Match Win Percentage** first, then **Game Win Percentage**, then **Opponents' Game Win Percentage**, then Player Name."
>
> **Dev:** "Should League tiebreakers add together each Tournament's percentages?"
> **Domain expert:** "No - **League Result** tiebreakers are recalculated across all Tournaments in the League."
>
> **Dev:** "Can an opponent contribute 0% to **Opponents' Match Win Percentage**?"
> **Domain expert:** "No - each opponent's Match Winrate contribution has a 33% floor."
>
> **Dev:** "Should Alice's own **Game Win Percentage** be floored?"
> **Domain expert:** "No - only opponent-derived tiebreaker contributions use the 33% floor."
>
> **Dev:** "Should displayed tiebreakers be rounded before sorting?"
> **Domain expert:** "No - sort with full precision and display percentages with 2 decimal places."
>
> **Dev:** "Should Bob's contribution to Alice's OMW exclude Bob's Match against Alice?"
> **Domain expert:** "No - opponent-derived tiebreakers use each opponent's full record."
>
> **Dev:** "Can Bob's later Tournament affect Alice's League OMW?"
> **Domain expert:** "Yes - **League Result** opponent-derived tiebreakers use Bob's full League record."
>
> **Dev:** "Can Bob's later Tournament affect Alice's Tournament OMW?"
> **Domain expert:** "No - **Tournament Result** opponent-derived tiebreakers only use that Tournament."
>
> **Dev:** "Does winning one Tournament award a League bonus?"
> **Domain expert:** "No - each **Tournament** contributes equally through its Matches."
>
> **Dev:** "Should one invalid Round Entry block the whole **Tournament Result**?"
> **Domain expert:** "No - calculate a **Provisional Result** from valid Matches and warn that the **Tournament** is incomplete."
>
> **Dev:** "Should an empty Tournament show as incomplete?"
> **Domain expert:** "Yes - an empty **Tournament** is an **Incomplete Tournament**."
>
> **Dev:** "Should an incomplete Tournament contribute valid Matches to League standings?"
> **Domain expert:** "Yes - the **League Result** may be provisional and still include valid Matches."
>
> **Dev:** "Should a **Tournament Import** discard lines it cannot parse?"
> **Domain expert:** "No - import every line, preserve bad lines as **Invalid Round Entries**, and warn that some lines need correction."
>
> **Dev:** "Should valid imported Matches keep their original CSV line?"
> **Domain expert:** "No - only **Invalid Round Entries** preserve raw import text, and only until edited."
>
> **Dev:** "If a manual edit clears a required Match field, is the Match deleted?"
> **Domain expert:** "No - it becomes an **Invalid Round Entry** until corrected."
>
> **Dev:** "After editing an invalid imported line, should the original raw line remain authoritative?"
> **Domain expert:** "No - editing an **Invalid Round Entry** makes the edited fields the source data."
>
> **Dev:** "Should users delete and recreate bad imported rows?"
> **Domain expert:** "No - correcting an **Invalid Round Entry** can turn it into a **Match** or **Bye**."
>
> **Dev:** "Should an Invalid Round Entry store its warning reason?"
> **Domain expert:** "No - **Invalid Round Entry** reasons are derived from source data."
>
> **Dev:** "Should repeated pairings block results?"
> **Domain expert:** "No - repeated pairings count, but they should create a **Pairing Warning**."
>
> **Dev:** "Should a Player Name appearing twice in one Round block results?"
> **Domain expert:** "No - it counts, but it should create a **Pairing Warning**."
>
> **Dev:** "Does a player page come from a stored Player entity?"
> **Domain expert:** "No - **Player Statistics** aggregate all Match results with the selected **Player Name** across all Leagues."
>
> **Dev:** "Can Alice's stats be narrowed to only Matches against Bob?"
> **Domain expert:** "Yes - **Player Statistics** may be filtered by opposing **Player Name**."
>
> **Dev:** "Do Player Statistics default to one League?"
> **Domain expert:** "No - they default across all Leagues, but may be filtered by **League** or **Tournament**."
>
> **Dev:** "Do deleted Tournaments still affect Player Statistics?"
> **Domain expert:** "No - derived statistics only include active, non-deleted Tournaments and Leagues."
>
> **Dev:** "Do valid Matches from Incomplete Tournaments count in Player Statistics?"
> **Domain expert:** "Yes - **Player Statistics** include valid Matches from Incomplete Tournaments."
>
> **Dev:** "Does deleting a Tournament archive it for later restore?"
> **Domain expert:** "No - **Delete** is destructive in the MVP."
>
> **Dev:** "Is deleting a Match the same as making it invalid?"
> **Domain expert:** "No - **Delete** removes the Match from the Round."
>
> **Dev:** "Is exported Gones data the same thing as **Round Import** data?"
> **Domain expert:** "No - **Gones Export** is for JSON source-data backups, not importing Round rows."
>
> **Dev:** "Can backup export wait until after MVP?"
> **Domain expert:** "No - **Gones Export** is part of the MVP."
>
> **Dev:** "Does **Gones Export** export only one League?"
> **Domain expert:** "No - use **League Export** for one League and **Full Data Export** for all Leagues."
>
> **Dev:** "Should a nice-looking PDF of standings be called an export?"
> **Domain expert:** "No - use **Report Download** for PDF or image presentations of results or player statistics."
>
> **Dev:** "Should descriptive League dates survive export and restore?"
> **Domain expert:** "Yes - **Gones Export** includes descriptive League dates."
>
> **Dev:** "Should restored Tournaments keep their names and dates?"
> **Domain expert:** "Yes - **Gones Export** includes Tournament names and **Tournament Dates**."
>
> **Dev:** "Should exported data include calculated standings?"
> **Domain expert:** "No - **Gones Export** stores source data, and derived results are recalculated after restore."
>
> **Dev:** "Should exported data include warning objects?"
> **Domain expert:** "No - warnings are derived from restored source data."
>
> **Dev:** "Should invalid imported lines survive export and restore?"
> **Domain expert:** "Yes - **Gones Export** preserves invalid imported lines for later correction."
>
> **Dev:** "How should future Gones versions understand old exports?"
> **Domain expert:** "A **Gones Export** includes a **Gones Data Version** so it can be migrated."
>
> **Dev:** "How should we know which app version created an export file?"
> **Domain expert:** "A **Gones Export** includes a **Gones App Version** for provenance and debugging."
>
> **Dev:** "Should restoring an export merge with current data?"
> **Domain expert:** "**League Restore** creates a new League by default; **Full Data Restore** restores a full dataset."
>
> **Dev:** "If I import a League export with the same name as an existing League, should it overwrite?"
> **Domain expert:** "No - **League Restore** creates a new **League** by default."
>
> **Dev:** "What if the imported League has the same name as an existing League?"
> **Domain expert:** "Preserve the name when possible; if it collides, make the imported **League** distinguishable."
>
> **Dev:** "Should restored internal IDs be reused?"
> **Domain expert:** "No - **League Restore** creates a new **League** with new identities."
>
> **Dev:** "Should a malformed export create a partial League?"
> **Domain expert:** "No - **Gones Restore** rejects malformed or unsupported **Gones Exports**."
>
> **Dev:** "Should Gones normalize whitespace or case when matching Player Names?"
> **Domain expert:** "Only leading and trailing whitespace is removed. After that, **Player Name** matching is exact."
>
> **Dev:** "Are `Demo Player 16` and `demo player 16` the same Player Name?"
> **Domain expert:** "No - **Player Name** matching is case-sensitive."
>
> **Dev:** "Should multiple Byes in one Round block results?"
> **Domain expert:** "No - they count, but they should create a **Pairing Warning**."

## Flagged ambiguities

- "scrapping", "crawl", "raw text", and "import CSV" were used for the same workflow - resolved: the canonical term is **Tournament Import**, with **SpiceRack Import** for the SpiceRack-specific format.
- "standings import" was part of the early design - resolved: Gones supports **Round Import**, not standings import.
- Legacy standings are not source data and are ignored during migration.
- "SpiceRack format" could mean the domain model or a source adapter - resolved: the current **Round Import Format** is a headered CSV with table, player, result, opponent, and Deck Archetype fields, and may adapt later to SpiceRack exports.
- "import" could mean append or replace - resolved: **Round Import** performs a **Round Replacement**.
- "export" could mean reporting or backup - resolved: **Gones Export** means JSON source-data backup only, while **Report Download** means a presentation PDF or image.
- "Gones Export" could mean one League or all Leagues - resolved: use **League Export** for one League and **Full Data Export** for all Leagues.
- "who can export" could mean public League backups or full-dataset backups - resolved: Visitors can perform **League Export** and **Full Data Export** because export is read-only public source data.
- "restore" could mean full-app restore or League import - resolved: use **League Restore** for one League and **Full Data Restore** for all Leagues.
- "finished League" and "completed League" referred to the same status - resolved: use **Completed League** and persist the status value as `completed`.
- "version" could mean data compatibility or app release provenance - resolved: use **Gones Data Version** for data shape and **Gones App Version** for the application version that created an export.
- "player" could mean an independent entity or a name recorded in Match results - resolved: Gones has no independent Player entity; use **Player Name** for the recorded value.
- "player page" could imply a stored profile - resolved: **Player Statistics** are derived by aggregating Match results with a selected **Player Name** across all Leagues.
- "user" and "player" could imply the same person - resolved: a **User** is a logged-in account, while a **Player Name** is recorded tournament data.
- "admin" could mean app-wide account management or tournament editing - resolved: use **Admin User** for managing Organizer Users and **Organizer User** for modifying tournament source data.
- "organizer ownership" could mean each Organizer User owns specific Leagues - resolved: Leagues are shared Gones organization data and any Organizer User can modify any League.
- "read-only user" was reconsidered - resolved: use **Visitor** for unauthenticated read/export access instead of a logged-in Viewer User.
- "update tournament result" could mean directly editing rankings - resolved: **Tournament Result** remains derived; Organizer Users modify source data.
- "same player name" could mean exact or normalized matching - resolved: **Player Name** matching is exact after removing leading and trailing whitespace.
- "ranking" could mean stored input data or a derived output - resolved: **Tournament Result** and **League Result** are derived from Rounds after relevant edits.
- "score" could mean match outcome points or games won inside a match - resolved: use **Tournament Points** for ranking points and **Game Score** for games won.
- "winrate" could mean match winrate or game winrate - resolved: unqualified winrate means **Match Winrate**.
- "bye" was considered as a Player-like opponent - resolved: **Bye** is not a **Player Name** and is excluded from player statistics.
- "league OMW/GW/OGW" could mean summed Tournament percentages or League-wide percentages - resolved: League tiebreakers are calculated across all Tournaments in the League.
- "tops" appeared in the code but has no domain meaning - resolved: Gones does not model elimination rounds or top cuts.
- "deck" could mean a standalone deck entity or source text recorded on a Match - resolved: Gones records a **Deck Archetype** on a Match result, but does not model Deck as a standalone MVP entity.
- "decklist" could mean a full card list or an archetype label - resolved: use **Deck Archetype** because Gones records archetype names, not full card lists.
- "incomplete" could mean unusable or partially usable - resolved: an **Incomplete Tournament** can produce a **Provisional Result** from valid Matches.
- "valid match" could mean only a winner is known or the full result is known - resolved: a played **Valid Match** requires both a **Match Outcome** and a **Game Score**.
- "backend mode" could mean a runtime fallback between the browser store and the API - resolved: a build declares one **Data Authority** (**Legacy Browser Mode** or **Server Mode**), there is no fallback, and an unsatisfiable declaration fails the build and then refuses to start (ADR 0019).
- "migration" could mean the database schema migration or moving legacy browser data to the server - resolved: use **Live Cutover** for moving **Migration Bundles** into **Server Mode**; the public domain, CDN, hosting provider and the Live Cutover itself are all deferred.
