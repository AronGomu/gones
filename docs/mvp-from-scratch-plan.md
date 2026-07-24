# MVP From-Scratch Implementation Plan

Build the new Gones application from scratch under `app/`. Existing code outside `app/` is reference material only. The final MVP cleanup removes the old implementation once the new app is complete.

## Principles

- Build vertical slices with TDD.
- Use Cypress E2E for user-visible workflows.
- Use Jest only for pure domain functions under `app/domain/`.
- Keep domain code pure and UI-agnostic.
- Store source data only; calculate all results and statistics from source data.
- Use plain JavaScript objects, builder functions, and JSDoc typedefs.
- Use `.js` ES modules and directory boundaries, not `.mjs`, to express architecture.
- Keep UI-specific mappers near the UI that uses them.
- Use old files only to understand existing behavior or copy useful UI fragments.

## Target Structure

```txt
app/
  index.html
  pages/
    leagues.html
    leagues.js
    league.html
    league.js
    tournament.html
    tournament.js
    player.html
    player.js
  components/
    ranking-table.js
    round-editor.js
  domain/
    models.js
    round-import.js
    validation.js
    warnings.js
    results.js
    player-stats.js
    export-restore.js
    migration.js
  storage/
    league-store.js
  styles/
    global.css
```

## Step-by-Step Plan

### 1. Fresh App Shell

- Create `app/` with new HTML entry pages.
- Add shared global CSS.
- Wire navigation between Leagues, League, Tournament, and Player pages.
- Keep current `page/`, `class/`, `component/`, and `function/` folders untouched for now.

TDD:
- Cypress: user can open the new Leagues page.
- Cypress: user can navigate from Leagues page to a new League page.

### 2. Domain Source Model

- Create `app/domain/models.js`.
- Add JSDoc typedefs and builders for:
  - `GonesData`
  - `League`
  - `Tournament`
  - `Round`
  - `RoundEntry`
  - `MatchRoundEntry`
  - `ByeRoundEntry`
  - `InvalidRoundEntry`
- Use `kind: "match" | "bye" | "invalid"` for Round Entries.
- Use camelCase source fields.
- Give Leagues, Tournaments, Rounds, and Round Entries IDs.
- Derive displayed round numbers from order.

TDD:
- Jest: builders create valid default source objects.
- Jest: builders trim leading/trailing Player Name whitespace.
- Jest: builders accept injected ID factories.

### 3. Versioned Storage

- Create `app/storage/league-store.js`.
- Centralize all `localStorage` access.
- Store a versioned data shape.
- Keep browser storage outside domain.

TDD:
- Cypress: created League persists after reload.
- Jest: storage-adjacent pure helpers create versioned data shape if separated from browser API.

### 4. Legacy Data Migration

- Create `app/domain/migration.js`.
- Detect old `league_list` data.
- Migrate old Leagues and Tournaments best-effort.
- Ignore legacy standings.
- Convert old winner/loser round rows into neutral Round Entries where consistent.
- Convert inconsistent old rows into Invalid Round Entries.

TDD:
- Jest: old bye row migrates to `kind: "bye"`.
- Jest: old winner/loser row migrates to neutral `kind: "match"`.
- Jest: old standings do not become source data.

### 5. League Creation Flow

- Implement Leagues page.
- Create League with name and optional descriptive dates.
- Empty League is allowed and has no League Result.

TDD:
- Cypress: user creates an empty League.
- Cypress: empty League appears in Leagues list.
- Cypress: League dates are editable and descriptive.

### 6. Tournament Creation Flow

- Implement League page.
- Show League Result before Tournament list.
- Add Tournament with name and optional Tournament Date.
- Tournament belongs to exactly one League.
- Empty Tournament is allowed but incomplete.

TDD:
- Cypress: user creates Tournament inside a League.
- Cypress: empty Tournament appears as incomplete.
- Cypress: Tournament page opens from League page.

### 7. Round and Round Editor

- Implement `app/components/round-editor.js`.
- Add/delete Rounds.
- Add/delete Round Entries.
- Add Match manually.
- Add Bye manually.
- Invalid Round Entries are editable inline.
- Pairing Warnings display inline but do not block results.

TDD:
- Cypress: user adds a Round.
- Cypress: user adds a Match Round Entry.
- Cypress: user adds a Bye Round Entry.
- Cypress: user deletes a Round Entry.
- Cypress: user deletes a Round.

### 8. Round Import

- Create `app/domain/round-import.js`.
- Support MVP CSV:
  - `player_1,player_2,player_1_score,player_2_score`
  - comma or semicolon delimiter
  - quoted fields
  - optional matching header
  - blank lines ignored
- `bye` in `player_2` means Bye, case-insensitive.
- Scores for Bye rows are ignored.
- Rows with missing or extra columns become Invalid Round Entries.
- Round Import performs Round Replacement for the targeted Round.

TDD:
- Jest: valid match CSV imports to `kind: "match"`.
- Jest: `0,0` imports as draw.
- Jest: `bye` imports to `kind: "bye"`.
- Jest: blank lines are ignored.
- Jest: quoted commas are supported.
- Jest: malformed rows become Invalid Round Entries.
- Cypress: user pastes CSV into Round Editor and replaces the Round.

### 9. Validation

- Create `app/domain/validation.js`.
- Validate Round Entries:
  - Player Name cannot be empty.
  - `bye` is reserved and cannot be a Player Name.
  - Match cannot have same Player Name on both sides.
  - Game Score uses non-negative integers only.
  - Winner score must be higher for wins.
  - Draw score must be `0-0` or `1-1`.
  - `kind: "match"` means valid played Match.
  - malformed entries use `kind: "invalid"` until corrected.
- Return validation codes, not UI text.

TDD:
- Jest: empty Player Name invalid.
- Jest: reserved `bye` Player Name invalid.
- Jest: same Player Name invalid.
- Jest: decimal and negative scores invalid.
- Jest: `2-2` draw invalid.
- Cypress: invalid row is shown inline and excluded from result.

### 10. Warnings

- Create `app/domain/warnings.js`.
- Detect Pairing Warnings:
  - repeated pairing in a Tournament
  - Player Name appears multiple times in one Round
  - multiple Byes in one Round
- Warnings do not exclude entries from results.

TDD:
- Jest: repeated pairing returns warning.
- Jest: duplicate same-round Player Name returns warning.
- Jest: multiple Byes returns warning.
- Cypress: warned rows still count in rankings.

### 11. Tournament Result

- Create `app/domain/results.js`.
- Calculate Tournament Result from Round Entries.
- Use only valid Matches and Byes.
- Empty or invalid-only Tournament is incomplete.
- Incomplete Tournament may produce Provisional Result.
- Ranking rules:
  - win = 3
  - draw = 1
  - loss = 0
  - bye = ranking win + 3 points
  - ranking records display Byes as wins
  - Byes do not count toward Game Win Percentage
  - sort by Tournament Points, OMW, GW, OGW, Player Name
  - OMW and OGW use 33% opponent floors
  - no-opponent OMW/OGW = 0
  - no-denominator GW = 0 for ranking tiebreakers

TDD:
- Jest: match win awards 3 points.
- Jest: draw awards 1 point each.
- Jest: bye awards 3 points and ranking win.
- Jest: bye does not create game wins.
- Jest: rankings sort by points then OMW/GW/OGW/name.
- Cypress: Tournament Result updates after adding Match and Bye.

### 12. Ranking Table

- Implement `app/components/ranking-table.js`.
- Accept already-calculated Tournament Result or League Result rows.
- Do not calculate results inside the component.
- Display ranking rows with formatted percentages.
- Row click can navigate to Player Statistics.

TDD:
- Cypress: Ranking Table shows sorted Tournament Result.
- Cypress: clicking a row opens Player Statistics for that Player Name.

### 13. League Result

- Extend `app/domain/results.js`.
- Calculate League Result across all Tournaments in one League.
- Every Tournament contributes equally.
- Include valid Matches and Byes from Incomplete Tournaments.
- Mark League Result provisional when any included Tournament is incomplete.
- League tiebreakers use opponent full record across the League.

TDD:
- Jest: League Result sums Tournament Points across Tournaments.
- Jest: League OMW/GW/OGW calculated across the League, not summed from Tournament percentages.
- Jest: incomplete Tournament valid entries contribute to provisional League Result.
- Cypress: League page shows League Result before Tournament list.

### 14. Player Statistics

- Create `app/domain/player-stats.js`.
- Aggregate by exact trimmed case-sensitive Player Name across all Leagues.
- No independent Player entity.
- Support filters:
  - League
  - Tournament
  - opponent Player Name
- Include:
  - Played Match Count
  - Bye Count
  - Match Winrate
  - Game Winrate
  - Nemesis
  - Rival
  - Match list
- Byes are standalone stats only for Player Statistics.
- Winrates display as N/A when denominator is empty.

TDD:
- Jest: exact case-sensitive Player Name aggregation.
- Jest: byes excluded from Match Winrate and Game Winrate.
- Jest: Bye Count increments.
- Jest: Nemesis tie-breaks correctly.
- Jest: Rival tie-breaks by recency.
- Cypress: Player Statistics page opens from Ranking Table row.
- Cypress: filters are represented in URL.

### 15. League Export and Restore

- Create `app/domain/export-restore.js`.
- Export one League dataset.
- Include:
  - Gones Data Version
  - League name and descriptive dates
  - Tournaments
  - Tournament Dates
  - Rounds
  - Round Entries
  - Invalid Round Entries
- Exclude:
  - calculated standings
  - Player Statistics
  - derived warnings
- Restore imports one League dataset.
- Restore creates a new League by default.
- Restore remaps IDs.
- Restore rejects malformed or unsupported exports.
- Browser upload/download lives outside domain.

TDD:
- Jest: export stores source data only.
- Jest: restore creates a new League with remapped IDs.
- Jest: invalid Round Entries survive restore.
- Cypress: user exports a League.
- Cypress: user restores a League as a new League.

### 16. UI Cleanup and Old Code Removal

- Stop using old files outside `app/`.
- Delete old implementation once MVP works:
  - `class/`
  - `component/`
  - `function/`
  - `mock/` if no longer needed
  - `page/`
  - old styles if replaced
  - old `architecture.md` if superseded by `CONTEXT.md` and ADRs
- Keep:
  - `CONTEXT.md`
  - `docs/`
  - `app/`
  - `cypress/`
  - `package.json`
  - `jest.config.js`

TDD:
- Run all Jest domain tests.
- Run Cypress MVP suite.
- Manually check local app with `npm run dev`.

## MVP Feature Checklist

- [ ] User can create an empty League.
- [ ] Empty League is allowed and has no League Result.
- [ ] User can edit League name and descriptive dates.
- [ ] User can create a Tournament inside a League.
- [ ] Tournament belongs to exactly one League.
- [ ] Tournament Date is optional.
- [ ] Empty Tournament is allowed and marked incomplete.
- [ ] User can add and delete Rounds.
- [ ] Round order comes from creation/import order.
- [ ] User can add and delete Match Round Entries.
- [ ] User can add and delete Bye Round Entries.
- [ ] User can edit Invalid Round Entries inline.
- [ ] Round Import replaces one targeted Round.
- [ ] Round Import supports comma CSV.
- [ ] Round Import supports semicolon CSV.
- [ ] Round Import supports quoted fields.
- [ ] Round Import ignores blank lines.
- [ ] Round Import supports optional matching header.
- [ ] Round Import preserves malformed rows as Invalid Round Entries.
- [ ] Player Names match exactly after trimming leading/trailing whitespace.
- [ ] Player Name matching is case-sensitive.
- [ ] `bye` is reserved and cannot be a Player Name.
- [ ] Match score validation follows MVP rules.
- [ ] Draws are valid only as `0-0` or `1-1`.
- [ ] Tournament Result is calculated from Rounds.
- [ ] Imported standings do not exist in MVP.
- [ ] Bye counts as ranking win and 3 points.
- [ ] Ranking record displays Byes as wins.
- [ ] Bye does not count toward Player Statistics winrate or game stats.
- [ ] OMW/GW/OGW tiebreakers work for Tournament Result.
- [ ] League Result is calculated across all Tournaments in the League.
- [ ] League OMW/GW/OGW are calculated across the League.
- [ ] Incomplete Tournaments can produce Provisional Results.
- [ ] Provisional League Result includes valid entries from Incomplete Tournaments.
- [ ] Pairing Warnings are shown but do not block calculations.
- [ ] Ranking Table displays calculated Tournament Result rows.
- [ ] Ranking Table displays calculated League Result rows.
- [ ] Ranking Table does not calculate results.
- [ ] League page shows League Result before Tournament list.
- [ ] Tournament page shows Tournament Result before Round Editors.
- [ ] Leagues list shows lightweight League summaries.
- [ ] Player Statistics page exists.
- [ ] Player Statistics page identifies selected player by encoded Player Name.
- [ ] Player Statistics filters are represented in URL.
- [ ] Player Statistics aggregate across all Leagues by default.
- [ ] Player Statistics can filter by League.
- [ ] Player Statistics can filter by Tournament.
- [ ] Player Statistics can filter by opponent Player Name.
- [ ] Player Statistics show Played Match Count.
- [ ] Player Statistics show Bye Count.
- [ ] Player Statistics show Match Winrate.
- [ ] Player Statistics show Game Winrate.
- [ ] Player Statistics show Nemesis.
- [ ] Player Statistics show Rival.
- [ ] League Export exports one League dataset.
- [ ] League Export includes versioned source data only.
- [ ] League Restore imports one League dataset.
- [ ] League Restore creates a new League by default.
- [ ] League Restore remaps IDs.
- [ ] League Restore rejects malformed exports.
- [ ] Legacy `league_list` data migrates best-effort.
- [ ] Legacy standings are ignored during migration.
- [ ] Old implementation folders are deleted after new MVP passes tests.
