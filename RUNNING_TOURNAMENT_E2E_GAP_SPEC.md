# Running Tournament End-to-End Gap Specification

## Source scenario

A single Cypress end-to-end test should create a running tournament from the landing page, exercise registration, validation, Swiss round generation, persistence/resume, completion, archival into a league tournament, and verify the archived tournament matches the live tournament data.

## Current implementation snapshot

Relevant code:

- Routes: `src/app/app.routes.ts`
  - `/live-tournaments`
  - `/live-tournaments/new`
  - `/live-tournaments/:liveTournamentId`
  - `/leagues/:leagueId/tournaments/:tournamentId`
- Running tournament list: `src/app/features/live-tournaments/live-tournament-list.component.ts`
- Running tournament runner: `src/app/features/live-tournaments/live-tournament-runner.component.ts`
- Live tournament domain logic: `src/app/domain/live-tournament.ts`
- Local live tournament persistence: `src/app/data/live-tournament-repository.service.ts`
- Archived league/tournament persistence: `src/app/data/league-repository.service.ts`

## Expected existing behavior that should pass now

These parts are already mostly supported by the current codebase:

- Landing page has navigation to **Running Tournaments**.
- `/live-tournaments` lists non-completed live tournaments.
- A new running tournament can be created and navigates to `/live-tournaments/:id`.
- Tournament name can be edited and persisted.
- Tournament date defaults to today.
- League assignment exists with an unassigned option and preexisting league options.
- Players can be added, removed before round generation, and marked paid.
- Start button is disabled until at least two active players exist.
- Starting a tournament generates round 1 pairings.
- Odd player counts generate one bye.
- Round results can be entered.
- Validating a completed round shows standings.
- Current round can be cancelled/regenerated.
- State persists to `localStorage` and can be resumed through the running tournament list.
- Finalizing creates a regular archived tournament inside the selected or placeholder league.
- Finalized live tournament is deleted from the running tournament store.

## Missing features and expected failures

### 1. Empty running tournament list state

**Expected by e2e:**

- When no tournament is running, the page explicitly says there are no running tournaments.
- User clicks **Create a new tournament**.

**Current code:**

- The list renders only the create card when empty.
- The create card text is **Start Tournament**, not **Create a new tournament**.

**Expected failure:**

- Assertions looking for an empty-state message or exact create label will fail.

### 2. Breadcrumb for live tournament detail

**Expected by e2e:**

- Breadcrumb current page shows `[name of the tournament] (live)`.
- Breadcrumb updates when the tournament name changes.

**Current code:**

- `/live-tournaments/:id` breadcrumb is generic: `Running Tournaments > Live Tournament`.
- It does not read the live tournament document and cannot update to the live tournament name.

**Expected failure:**

- Breadcrumb name assertions fail after creation and after rename.

### 3. Registration warning banner for not enough players

**Expected by e2e:**

- Top warning banner says **not enough player to start tournament** while fewer than two active players exist.

**Current code:**

- There is a muted helper below the start button: `Add at least two active players before starting.`
- It is not a top warning banner.

**Expected failure:**

- Banner assertion fails.

### 4. Paid warning copy and behavior

**Expected by e2e:**

- Warning says **all player has not payed yet** until all active players are paid.

**Current code:**

- Warning says `<N> active player(s) not marked as paid: <names>.`
- It appears before and after enough players exist, which is functionally close.

**Expected failure:**

- Exact text assertions fail unless test uses semantic/partial matching.

### 5. Automatic Swiss round count and custom round checkbox

**Expected by e2e:**

- Number of rounds input is disabled by default.
- Default displayed value is `0` until at least two players exist.
- A checkbox labelled **custom round number** is unchecked by default.
- Checking it enables number of rounds.
- Setting 10 works.
- Unchecking resets/disables and recalculates automatic round count.
- Automatic round count expectations:
  - 0-1 players: 0 rounds
  - 2 players: 1 round
  - 3-15 players: 3 rounds
  - 16-31 players: 4 rounds
  - Then continue increasing by one for each power-of-two range.

**Current code:**

- `roundCount` defaults to `3` in `createLiveTournament()`.
- The field is editable during registration.
- There is no custom-round-number checkbox.
- There is no automatic round-count calculation based on player count.

**Expected failure:**

- All custom round number assertions fail.
- Automatic value assertions fail.

### 6. Player count information

**Expected by e2e:**

- UI displays total number of players and updates after every add/remove.

**Current code:**

- Running tournament list shows player count.
- Runner registration panel does not have an explicit total player summary.

**Expected failure:**

- Assertions for total player information on the runner fail.

### 7. Odd-player bye warning during registration

**Expected by e2e:**

- Every odd active player count above 2 shows a warning that a bye will be generated.
- Every even count does not show the warning.

**Current code:**

- Bye is generated during pairing, but registration does not show a bye warning.

**Expected failure:**

- Bye warning assertions fail.

### 8. Settings disabled during round entry

**Expected by e2e:**

- Player/settings editing is disabled during round-entry steps and enabled outside round-entry steps.

**Current code:**

- Some fields become read-only after rounds exist, for example player name.
- Player paid/dropped/starting record controls remain editable during rounds.
- Add Player button remains available after rounds exist.
- Setup fields are partially editable depending on stage; round count is readonly when not registration.

**Expected failure:**

- Assertions that adding/settings are disabled during round entry fail.

### 9. Round result validation rules

**Expected by e2e:**

- Invalid result with 3 wins for either player is rejected.
- Red border appears on invalid row/input.
- Message explains a player cannot have more than 2 wins.
- Validate button is disabled.
- Disabled validate button has tooltip naming invalid table(s).
- Valid rows get green border.
- Draw rows show warning border.
- Warning appears when all matches are draws.

**Current code:**

- Scores are non-negative integers only.
- No max score validation exists.
- `currentRoundComplete()` only checks whether a result was entered.
- A score like `3-0` is considered complete and valid.
- There are no row border states, validation messages, draw warnings, all-draw warning, or disabled-button tooltip.

**Expected failure:**

- All validation, border, warning, and tooltip assertions fail.
- Validate may become enabled for invalid scores.

### 10. Standing generation cancellation UX

**Expected by e2e:**

- After validating round results, standings are generated.
- User can cancel the generation of standings and return to round result entry.
- User can cancel again and remove round entries.

**Current code:**

- Validating a round immediately marks it validated and shows standings.
- Restore checkpoints exist for `Pairing N` and `Standing N`, but there is no explicit “cancel standing generation” flow.
- `Cancel Round` only exists while the current round is unvalidated.

**Expected failure:**

- Assertions for cancel-standing and second cancel flow fail unless mapped to checkpoint restore UI, which currently has different text/behavior.

### 11. Randomized first-round generation

**Expected by e2e:**

- Regenerating the first round should produce different pairings.
- Test should retry up to 5 times and fail if pairings never change.

**Current code:**

- Pairings are deterministic from standings/player order.
- `regenerateCurrentSwissRound()` calls the same deterministic generator.
- No random seeding is implemented.

**Expected failure:**

- Regeneration will produce the same pairings every time.

### 12. Advanced setting: disable random player seeding

**Expected by e2e:**

- Advanced settings contain a checkbox to not randomize player seeding.
- When enabled, a first-round pairing preview appears.
- Pairings can be manually changed before the round starts.

**Current code:**

- No advanced settings panel exists.
- No randomize/non-randomize flag exists in the live tournament document.
- No pre-start pairing preview exists.
- No manual pairing editor exists.

**Expected failure:**

- All advanced settings, preview, and manual pairing assertions fail.

### 13. Adding players after round/standings have started

**Expected by e2e:**

- During standings/outside round-entry, adding a new player is enabled.
- New player can be assigned to one loss.
- New player triggers paid warning until marked paid.
- Standings update with new player.
- Adding a player in manual pairing preview automatically assigns bye when needed.

**Current code:**

- Add Player button is always available, including during rounds.
- Starting record fields exist for every player and can be edited.
- There is no explicit “assign to 1 loss” UI; it is represented by starting record inputs.
- No manual pairing preview exists.
- Standings include starting records, so they can update after adding a player.

**Expected failure:**

- Some behavior may pass through starting-record inputs, but exact workflow and disabled/enabled states fail.

### 14. Last standing and archive button wording

**Expected by e2e:**

- Last standings page has a button labelled **archive tournament**.

**Current code:**

- Button text is **Finalize Tournament**.
- Warning says finalizing unassigned tournaments attaches to Unassigned Tournaments.

**Expected failure:**

- Exact archive button assertion fails.

### 15. Updating league assignment at final standings

**Expected by e2e:**

- User can update the league to a preset existing league at the final standings before archiving.

**Current code:**

- League select is still present in setup panel.
- It is not disabled outside registration, so this likely works.

**Expected failure risk:**

- If the e2e expects this control in a finalization-specific area or exact copy, it fails.

### 16. Archived tournament identity and data parity

**Expected by e2e:**

- After archive/finalize, user navigates to the archived tournament detail page.
- Archived tournament has identical standings and all round entries from the running tournament.

**Current code:**

- `finalizeLiveTournament()` copies validated rounds into a `TournamentDocument`.
- Player paid/drop status, starting records, checkpoints, and live-only metadata are not archived because regular tournaments only store rounds and tournament metadata.
- Standings may match for match results and byes, but live standings include initial records while archived tournament standings may not preserve those records unless represented as round entries.

**Expected failure risk:**

- Round entries likely archive correctly for validated rounds.
- Standings parity can fail when starting records or late-added players are involved.
- Assertions for live-only information will fail on the archived tournament page.

### 17. Selectors and testability

**Expected by e2e:**

- A long single e2e needs stable selectors for page state, warnings, fields, rows, match rows, standings, and actions.

**Current code:**

- Some selectors exist on running list create/resume buttons.
- Runner mostly relies on text, Material internals, table positions, and aria labels.
- There are not enough `data-cy` hooks for a stable full workflow.

**Expected failure:**

- Test will be brittle and may fail due to selector ambiguity or DOM shape changes.

## Recommended implementation order before writing the final passing e2e

1. Add stable `data-cy` selectors to live tournament pages.
2. Add missing registration-state UI: empty state, warnings, player count, automatic rounds, custom round checkbox.
3. Make live tournament breadcrumb data-driven by the live tournament name.
4. Add result validation model and UI states.
5. Add explicit cancel/restore UX matching the desired flow.
6. Decide whether first-round pairings should be randomized by default; implement random seed/state so regeneration can produce different pairings deterministically enough for tests.
7. Add advanced settings for randomization/manual first-round pairing preview.
8. Enforce correct disabled/enabled states for setup/player controls by stage.
9. Rename or alias finalization button as Archive Tournament.
10. Ensure archived tournament standings preserve expected live-state effects, especially starting records and late entrants, or revise the e2e expectation.

## Conclusion

A single complete e2e exactly matching the supplied scenario is expected to fail today. The current live tournament feature supports a smaller happy path: create, add players, start, enter simple non-negative scores, validate standings, generate rounds, finalize/archive. The proposed e2e requires several product features and validation states that are not currently implemented.
