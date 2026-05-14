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
The MVP CSV shape used to paste Round Match data into Gones.
_Avoid_: SpiceRack format as the canonical model

**Round Replacement**:
Replacing all Matches in one Round with newly entered or imported Matches.
_Avoid_: Append import

**Player Name**:
The name recorded on a Match result to identify who played.
_Avoid_: Player entity, account, user

**Player Statistics**:
A derived view that aggregates all Matches with a specific Player Name.
_Avoid_: Player profile, player account

**Bye Count**:
The number of Byes assigned to a Player Name.
_Avoid_: Bye win

**Match Winrate**:
The share of played non-bye Matches won by a Player Name, with draws counted as non-wins.
_Avoid_: Winrate when game winrate is meant

**Game Winrate**:
The share of counted games won by a Player Name in played non-bye Matches.
_Avoid_: Winrate when match winrate is meant

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
A set of Matches played in a Tournament at the same stage.
_Avoid_: Pairing list

**Match**:
A recorded result between two Player Names in a Round.
_Avoid_: Game

**Valid Match**:
A Match with enough information to contribute to calculated results.
_Avoid_: Complete row

**Invalid Match**:
A Match entry preserved for correction but excluded from calculated results.
_Avoid_: Deleted line

**Match Outcome**:
The win, loss, or draw result of a Match.
_Avoid_: Score

**Game Score**:
The number of games won by each Player Name inside a Match.
_Avoid_: Match score

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
A Tournament with at least one missing Match or Invalid Match.
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
Exporting one League's source data so it can be preserved or restored without losing meaning.
_Avoid_: Round Import, report

**Gones Restore**:
Importing one League dataset from a Gones Export.
_Avoid_: Merge import

**Gones Data Version**:
The version of the Gones data shape used in a Gones Export.
_Avoid_: App version

## Relationships

- A **Tournament** may be created through a **Tournament Import**
- A **Tournament** may be created manually without a **Tournament Import**
- A **Tournament** may have a **Tournament Date**
- A **League** may contain zero or more **Tournaments**
- An empty **League** has no **League Result**
- A **Tournament** belongs to exactly one **League**
- A Tournament counts toward a **League Result** when it belongs to that League
- League dates are descriptive and do not filter which Tournaments count
- A **SpiceRack Import** is one possible kind of **Tournament Import**
- A **Round Import** is the only supported kind of Tournament Import data
- A **Round Import** performs a **Round Replacement** for its targeted Round
- A **Round Import** removes leading and trailing whitespace from imported fields
- A **Round Import** ignores blank lines
- The MVP **Round Import Format** is `player_1,player_2,player_1_score,player_2_score`
- The MVP **Round Import Format** supports quoted CSV fields
- The MVP **Round Import Format** supports comma-separated and semicolon-separated rows
- Rows with extra columns do not match the MVP **Round Import Format**
- Rows with missing columns do not match the MVP **Round Import Format**
- The MVP **Round Import Format** derives Match Outcome from Game Score
- The MVP **Round Import Format** does not use explicit outcome text
- In the MVP **Round Import Format**, `0,0` scores between two Player Names import as a drawn Match
- The MVP **Round Import Format** may include a matching header row
- In the MVP **Round Import Format**, `bye` in `player_2` represents a **Bye** after trimming and ignoring case
- **Bye** scores in a **Round Import** are ignored
- A **Tournament** is not tied to SpiceRack after import
- Gones has no independent Player entity outside recorded Match results
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
- **Delete** is destructive in the MVP
- A **Delete** removes a Match rather than preserving it as an Invalid Match
- **Gones Export** preserves one League dataset for round-trip restore
- **Gones Export** is distinct from **Round Import**
- **Gones Export** is part of the MVP
- **Gones Export** covers one League, including all Tournaments, Rounds, and Matches in that League
- **Gones Export** includes descriptive League dates
- **Gones Export** includes Tournament names and Tournament Dates
- **Gones Export** stores source data, not derived results
- **Gones Export** does not store derived warnings
- **Gones Export** preserves **Invalid Matches** for later correction
- **Gones Export** includes a **Gones Data Version**
- **Gones Restore** imports one League dataset
- **Gones Restore** creates a new League by default
- **Gones Restore** preserves the exported League name unless it must distinguish a duplicate
- **Gones Restore** gives the imported League and its Tournaments new identities
- **Gones Restore** rejects malformed or unsupported Gones Exports
- **Gones Restore** preserves **Invalid Matches** from valid Gones Exports
- A **League Result** is recalculated from the League's Tournaments after relevant data changes
- A **Tournament** may contain zero or more **Rounds** while editing
- A **Round** contains one or more **Matches**
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
- MVP **Match** order within a Round comes from creation or import order
- MVP Gones does not support manual Match reordering
- A played **Valid Match** has two different Player Names, a Match Outcome, and a Game Score
- A **Valid Match** may instead assign one Player Name a **Bye**
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
- A **Bye** does not count toward game statistics or match win/loss statistics
- A **Bye** awards Tournament Points to its assigned Player Name
- Bye Tournament Points contribute to **League Result**
- A **Bye** contributes to **Bye Count**
- A Player Name with only Byes can appear in Tournament Result and League Result
- Unqualified "winrate" means **Match Winrate**
- **Player Statistics** include both **Match Winrate** and **Game Winrate**
- Draws count as non-wins in **Match Winrate**
- Individual drawn games are ignored in **Game Winrate**
- **Match Winrate** and **Game Winrate** are N/A when they have no denominator
- **Player Statistics** use raw percentages without tiebreaker floors
- **Nemesis** excludes Byes
- **Nemesis** ties are broken by the selected Player Name's worst Match Winrate against the tied opponents, then opposing Player Name
- **Rival** excludes Byes
- **Rival** ties are broken by most recent Match, then opposing Player Name
- Most recent Match is determined by Tournament date, then Round order, then Match order
- Dated Tournaments are more recent than undated Tournaments for recency comparisons
- A **Tournament Result** is recalculated from the Tournament's Rounds after relevant data changes
- A **League Result** is recalculated from Tournament Results after relevant data changes
- An **Incomplete Tournament** may still produce a **Provisional Result**
- A **Provisional Result** excludes missing Matches and **Invalid Matches**
- An empty **Tournament** is an **Incomplete Tournament**
- A **League Result** may be provisional when it includes an **Incomplete Tournament**
- A provisional **League Result** includes valid Matches from Incomplete Tournaments
- A **Tournament Import** preserves invalid imported lines as **Invalid Matches** for correction
- Manual Match edits can create **Invalid Matches**
- Editing an **Invalid Match** makes the edited fields the source data
- A repeated Match between the same two Player Names in one Tournament creates a **Pairing Warning** but still counts
- A Player Name appearing in multiple Matches in one Round creates a **Pairing Warning** but still counts
- Multiple Byes in one Round create a **Pairing Warning** but still count
- Each **Tournament** contributes equally to a **League Result**
- Ties in a **Tournament Result** are broken by **Opponents' Match Win Percentage**, then **Game Win Percentage**, then **Opponents' Game Win Percentage**, then Player Name
- Ties in a **League Result** use league-wide **Opponents' Match Win Percentage**, **Game Win Percentage**, and **Opponents' Game Win Percentage** calculated across all Tournaments in that League
- **Game Win Percentage** is treated as 0 for ranking tiebreakers when it has no denominator
- **Opponents' Match Win Percentage** applies a 33% floor to each opponent's Match Winrate contribution
- **Opponents' Game Win Percentage** applies a 33% floor to each opponent's Game Win Percentage contribution
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
> **Dev:** "Should blank lines become invalid Matches?"
> **Domain expert:** "No - **Round Import** ignores blank lines."
>
> **Dev:** "Can a Player Name contain a comma in pasted CSV?"
> **Domain expert:** "Yes - the **Round Import Format** supports quoted CSV fields."
>
> **Dev:** "Should `Alice;Bob;2;1` import as a Match?"
> **Domain expert:** "Yes - the **Round Import Format** supports comma-separated and semicolon-separated rows."
>
> **Dev:** "Should extra CSV columns be ignored?"
> **Domain expert:** "No - rows with extra columns do not match the MVP **Round Import Format**."
>
> **Dev:** "Should `Alice,Bob,2` import as a partial Match?"
> **Domain expert:** "It is preserved as an **Invalid Match** because it does not match the MVP **Round Import Format**."
>
> **Dev:** "Does the MVP import need a separate winner column?"
> **Domain expert:** "No - the **Round Import Format** derives the **Match Outcome** from the **Game Score**."
>
> **Dev:** "Can a pasted row use `draw` instead of scores?"
> **Domain expert:** "No - the MVP **Round Import Format** derives outcome from **Game Score** only."
>
> **Dev:** "Does `Alice,Bob,0,0` import as a draw?"
> **Domain expert:** "Yes - `0,0` scores between two **Player Names** import as a drawn **Match**."
>
> **Dev:** "Can pasted Round CSV include a header row?"
> **Domain expert:** "Yes - a matching **Round Import Format** header row is ignored."
>
> **Dev:** "Should `Alice,BYE,1,0` import as a **Bye**?"
> **Domain expert:** "Yes - `bye` in the second Player Name field means **Bye**, and its scores are ignored."
>
> **Dev:** "Can a real participant use `bye` as their Player Name?"
> **Domain expert:** "No - `bye` is reserved and is not allowed as a **Player Name**."
>
> **Dev:** "Does an empty opponent field mean **Bye**?"
> **Domain expert:** "No - a **Bye** must be explicit. An empty **Player Name** makes the Match invalid."
>
> **Dev:** "Can Alice play a valid Match against Alice?"
> **Domain expert:** "No - a Match with the same **Player Name** on both sides is invalid."
>
> **Dev:** "Should `Eric  Confortini ` and `Eric Confortini` be merged automatically?"
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
> **Domain expert:** "No - a **Bye** is not a **Player Name** and does not count toward game statistics or match win/loss statistics."
>
> **Dev:** "Does a **Bye** still help the assigned Player Name's Tournament Result?"
> **Domain expert:** "Yes - a **Bye** awards **Tournament Points**, but it is not counted as a played match."
>
> **Dev:** "Should a **Bye** increase Player Statistics winrate?"
> **Domain expert:** "No - it only increases **Bye Count**."
>
> **Dev:** "Can a Player Name with only Byes appear in standings?"
> **Domain expert:** "Yes - Byes award **Tournament Points**, even when the Player Name has no played Matches."
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
> **Dev:** "Should **Player Statistics** apply the 33% tiebreaker floor?"
> **Domain expert:** "No - **Player Statistics** use raw percentages."
>
> **Dev:** "If two opponents beat Alice the same number of times, who is Alice's **Nemesis**?"
> **Domain expert:** "The opponent Alice has the worse **Match Winrate** against; if still tied, use Player Name order."
>
> **Dev:** "If Alice played Bob and Claire the same number of times, who is Alice's **Rival**?"
> **Domain expert:** "The opponent from the most recent Match; if still tied, use Player Name order."
>
> **Dev:** "How does Gones decide which tied Rival is more recent?"
> **Domain expert:** "Use Tournament date first, then **Round** order, then Match order."
>
> **Dev:** "Can a Tournament have no date?"
> **Domain expert:** "Yes - **Tournament Date** is optional, but dated Tournaments sort as more recent than undated ones."
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
> **Dev:** "Should one invalid Match block the whole **Tournament Result**?"
> **Domain expert:** "No - calculate a **Provisional Result** from valid Matches and warn that the **Tournament** is incomplete."
>
> **Dev:** "Should an empty Tournament show as incomplete?"
> **Domain expert:** "Yes - an empty **Tournament** is an **Incomplete Tournament**."
>
> **Dev:** "Should an incomplete Tournament contribute valid Matches to League standings?"
> **Domain expert:** "Yes - the **League Result** may be provisional and still include valid Matches."
>
> **Dev:** "Should a **Tournament Import** discard lines it cannot parse?"
> **Domain expert:** "No - import every line, preserve bad lines as **Invalid Matches**, and warn that some lines need correction."
>
> **Dev:** "If a manual edit clears a required Match field, is the Match deleted?"
> **Domain expert:** "No - it becomes an **Invalid Match** until corrected."
>
> **Dev:** "After editing an invalid imported line, should the original raw line remain authoritative?"
> **Domain expert:** "No - editing an **Invalid Match** makes the edited fields the source data."
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
> **Domain expert:** "No - **Gones Export** is for preserving and restoring one League dataset exactly."
>
> **Dev:** "Can backup export wait until after MVP?"
> **Domain expert:** "No - **Gones Export** is part of the MVP."
>
> **Dev:** "Does **Gones Export** export only one League?"
> **Domain expert:** "Yes - MVP **Gones Export** covers one League and all Tournaments, Rounds, and Matches in that League."
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
> **Dev:** "Should restoring an export merge with current data?"
> **Domain expert:** "**Gones Restore** imports one League dataset; it does not restore the full Gones dataset."
>
> **Dev:** "If I import a League export with the same name as an existing League, should it overwrite?"
> **Domain expert:** "No - **Gones Restore** creates a new **League** by default."
>
> **Dev:** "What if the imported League has the same name as an existing League?"
> **Domain expert:** "Preserve the name when possible; if it collides, make the imported **League** distinguishable."
>
> **Dev:** "Should restored internal IDs be reused?"
> **Domain expert:** "No - **Gones Restore** creates a new **League** with new identities."
>
> **Dev:** "Should a malformed export create a partial League?"
> **Domain expert:** "No - **Gones Restore** rejects malformed or unsupported **Gones Exports**."
>
> **Dev:** "Should Gones normalize whitespace or case when matching Player Names?"
> **Domain expert:** "Only leading and trailing whitespace is removed. After that, **Player Name** matching is exact."
>
> **Dev:** "Are `Yo Plz` and `yo plz` the same Player Name?"
> **Domain expert:** "No - **Player Name** matching is case-sensitive."
>
> **Dev:** "Should multiple Byes in one Round block results?"
> **Domain expert:** "No - they count, but they should create a **Pairing Warning**."

## Flagged ambiguities

- "scrapping", "crawl", "raw text", and "import CSV" were used for the same workflow - resolved: the canonical term is **Tournament Import**, with **SpiceRack Import** for the SpiceRack-specific format.
- "standings import" was part of the early design - resolved: Gones supports **Round Import**, not standings import.
- "SpiceRack format" could mean the domain model or a source adapter - resolved: the MVP **Round Import Format** is simple CSV and may adapt later to SpiceRack exports.
- "import" could mean append or replace - resolved: **Round Import** performs a **Round Replacement**.
- "export" could mean reporting or backup - resolved: **Gones Export** preserves one League dataset for round-trip restore.
- "restore" could mean full-app restore or League import - resolved: **Gones Restore** imports one League dataset.
- "player" could mean an independent entity or a name recorded in Match results - resolved: Gones has no independent Player entity; use **Player Name** for the recorded value.
- "player page" could imply a stored profile - resolved: **Player Statistics** are derived by aggregating Match results with a selected **Player Name** across all Leagues.
- "same player name" could mean exact or normalized matching - resolved: **Player Name** matching is exact after removing leading and trailing whitespace.
- "ranking" could mean stored input data or a derived output - resolved: **Tournament Result** and **League Result** are derived from Rounds after relevant edits.
- "score" could mean match outcome points or games won inside a match - resolved: use **Tournament Points** for ranking points and **Game Score** for games won.
- "winrate" could mean match winrate or game winrate - resolved: unqualified winrate means **Match Winrate**.
- "bye" was considered as a Player-like opponent - resolved: **Bye** is not a **Player Name** and is excluded from player statistics.
- "league OMW/GW/OGW" could mean summed Tournament percentages or League-wide percentages - resolved: League tiebreakers are calculated across all Tournaments in the League.
- "tops" appeared in the code but has no domain meaning - resolved: Gones does not model elimination rounds or top cuts.
- "deck" appears in the early architecture notes but is not part of the MVP domain.
- "incomplete" could mean unusable or partially usable - resolved: an **Incomplete Tournament** can produce a **Provisional Result** from valid Matches.
- "valid match" could mean only a winner is known or the full result is known - resolved: a played **Valid Match** requires both a **Match Outcome** and a **Game Score**.
