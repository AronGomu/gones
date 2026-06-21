# Running Tournament Full Lifecycle E2E Implementation Specification

## Goal

Implement one Cypress end-to-end test that verifies a complete live running tournament lifecycle:

1. Start on the landing page.
2. Create a running tournament.
3. Configure registration.
4. Add players and verify warnings/round-count behavior.
5. Persist and resume the tournament.
6. Start the tournament.
7. Validate round result UX.
8. Generate standings and additional rounds.
9. Complete all rounds.
10. Archive/finalize into a league.
11. Verify archived tournament data matches live tournament data.

This spec documents the expected test structure, fixtures, selectors, helper functions, and assertions. It assumes the missing product gaps listed in `RUNNING_TOURNAMENT_E2E_GAP_SPEC.md` are implemented or intentionally adapted.

## Test file

Create:

```text
cypress/e2e/running-tournament-lifecycle.cy.js
```

## Required deterministic setup

Use `cy.visit(..., { onBeforeLoad })` to seed local storage before the test starts.

### League store key

```js
const LEAGUE_STORE_KEY = "gones.frontend.backend.v1";
```

### Live tournament store key

```js
const LIVE_TOURNAMENT_STORE_KEY = "gones.live-tournaments.v1";
```

### Seed league fixture

Seed one preexisting league so the league select can be tested.

```js
const presetLeague = {
  id: "preset-league",
  name: "Preset League",
  status: "active",
  documentVersion: 1,
  updatedAt: "2026-06-21T00:00:00.000Z",
  tournaments: []
};
```

### Initial localStorage state

```js
function seedEmptyRunningTournamentState(win) {
  win.localStorage.setItem(LEAGUE_STORE_KEY, JSON.stringify({
    version: 1,
    leagues: [presetLeague]
  }));

  win.localStorage.setItem(LIVE_TOURNAMENT_STORE_KEY, JSON.stringify({
    version: 1,
    tournaments: [],
    deletedTournamentIds: []
  }));
}
```

## Required stable selectors

The test should not depend on Angular Material internals. Add these selectors before implementing the full e2e if they do not exist.

### Landing/list selectors

- `data-cy="menu-running-tournaments-card"` or `data-cy="menu-live-tournament-link"`
- `data-cy="running-tournament-empty-state"`
- `data-cy="create-running-tournament-card"`
- `data-cy="running-tournament-card"`
- `data-cy="resume-running-tournament"`

### Breadcrumb selectors

- `data-cy="breadcrumbs"`
- `data-cy="breadcrumb-current"`

### Registration/setup selectors

- `data-cy="live-warning-not-enough-players"`
- `data-cy="live-warning-unpaid-players"`
- `data-cy="live-warning-bye"`
- `data-cy="live-tournament-name-input"`
- `data-cy="live-tournament-date-input"`
- `data-cy="live-tournament-league-select"`
- `data-cy="live-tournament-round-count-input"`
- `data-cy="live-tournament-custom-round-count-checkbox"`
- `data-cy="live-player-count"`
- `data-cy="live-player-name-input"`
- `data-cy="live-add-player-button"`
- `data-cy="live-player-row"`
- `data-cy="live-player-paid-checkbox"`
- `data-cy="live-player-remove-button"`
- `data-cy="live-start-tournament-button"`

### Round-entry selectors

- `data-cy="live-round-panel"`
- `data-cy="live-match-row"`
- `data-cy="live-bye-row"`
- `data-cy="live-match-player1-score"`
- `data-cy="live-match-player2-score"`
- `data-cy="live-match-error"`
- `data-cy="live-all-draws-warning"`
- `data-cy="live-validate-round-button"`
- `data-cy="live-view-standings-button"` if separate from validate
- `data-cy="live-cancel-standings-button"`
- `data-cy="live-cancel-round-button"`
- `data-cy="live-regenerate-pairings-button"`

### Advanced settings selectors

- `data-cy="live-advanced-settings-panel"`
- `data-cy="live-randomize-seeding-checkbox"`
- `data-cy="live-first-round-preview"`
- `data-cy="live-preview-match-row"`
- `data-cy="live-preview-player1-select"`
- `data-cy="live-preview-player2-select"`

### Standings/archive selectors

- `data-cy="live-standings-table"`
- `data-cy="live-generate-next-round-button"`
- `data-cy="live-archive-tournament-button"`
- `data-cy="tournament-detail-page"`
- `data-cy="ranking-table"`
- `data-cy="round-entry-table"`

## Helper functions

### Date helper

```js
function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
```

### Expected automatic round count

```js
function expectedRoundCount(playerCount) {
  if (playerCount < 2) return 0;
  if (playerCount === 2) return 1;
  if (playerCount <= 15) return 3;
  return Math.ceil(Math.log2(playerCount));
}
```

### Add player helper

```js
function addPlayer(name) {
  cy.get('[data-cy="live-player-name-input"]').clear().type(name);
  cy.get('[data-cy="live-add-player-button"]').click();
  cy.contains('[data-cy="live-player-row"]', name).should("be.visible");
}
```

### Assert registration state helper

```js
function assertRegistrationState({ playerCount }) {
  cy.get('[data-cy="live-player-count"]').should("contain", String(playerCount));
  cy.get('[data-cy="live-tournament-round-count-input"]').should("have.value", String(expectedRoundCount(playerCount)));

  if (playerCount < 2) {
    cy.get('[data-cy="live-warning-not-enough-players"]').should("be.visible");
    cy.get('[data-cy="live-start-tournament-button"]').should("be.disabled");
  } else {
    cy.get('[data-cy="live-warning-not-enough-players"]').should("not.exist");
    cy.get('[data-cy="live-start-tournament-button"]').should("not.be.disabled");
  }

  if (playerCount > 2 && playerCount % 2 === 1) {
    cy.get('[data-cy="live-warning-bye"]').should("be.visible");
  } else {
    cy.get('[data-cy="live-warning-bye"]').should("not.exist");
  }
}
```

### Fill match score helper

```js
function fillMatchScore(table, leftScore, rightScore) {
  cy.contains('[data-cy="live-match-row"]', `Table ${table}`).within(() => {
    cy.get('[data-cy="live-match-player1-score"]').clear().type(String(leftScore));
    cy.get('[data-cy="live-match-player2-score"]').clear().type(String(rightScore));
  });
}
```

If rows do not include `Table ${table}` text, use a `data-table` attribute:

```js
cy.get(`[data-cy="live-match-row"][data-table="${table}"]`)
```

### Capture pairings helper

```js
function capturePairings() {
  return cy.get('[data-cy="live-match-row"]').then(($rows) => {
    return [...$rows].map((row) => row.innerText.replace(/\s+/g, " ").trim());
  });
}
```

### Resume tournament through navigation

```js
function resumeThroughMenu(tournamentName) {
  cy.visit("/");
  cy.get('[data-cy="menu-running-tournaments-card"]').click();
  cy.location("pathname").should("eq", "/live-tournaments");
  cy.contains('[data-cy="running-tournament-card"]', tournamentName).within(() => {
    cy.get('[data-cy="resume-running-tournament"]').click();
  });
  cy.location("pathname").should("match", /^\/live-tournaments\/.+/);
}
```

## Test data

Use deterministic player names:

```js
const players = [
  "Alice", "Bob", "Carol", "Dave", "Eve",
  "Frank", "Grace", "Heidi", "Ivan"
];
```

Nine players produce four matches plus one bye.

Use tournament name:

```js
const tournamentName = "Cypress Live Lifecycle";
```

## Main test outline

```js
describe("Running tournament lifecycle", () => {
  it("creates, completes, archives, and verifies a running tournament", () => {
    cy.visit("/", { onBeforeLoad: seedEmptyRunningTournamentState });

    // 1-3 landing/list/create
    cy.get('[data-cy="menu-running-tournaments-card"]').click();
    cy.location("pathname").should("eq", "/live-tournaments");
    cy.get('[data-cy="running-tournament-empty-state"]').should("be.visible");
    cy.get('[data-cy="create-running-tournament-card"]').click();

    // 4 page assertions
    cy.location("pathname").should("match", /^\/live-tournaments\/.+/);
    cy.get('[data-cy="live-warning-not-enough-players"]').should("be.visible");
    cy.get('[data-cy="breadcrumb-current"]').should("contain", "Live Tournament (live)");

    // 5 rename and breadcrumb
    cy.get('[data-cy="live-tournament-name-input"]').clear().type(tournamentName).blur();
    cy.get('[data-cy="breadcrumb-current"]').should("contain", `${tournamentName} (live)`);

    // 6 date
    cy.get('[data-cy="live-tournament-date-input"]').should("have.value", todayInputValue());

    // 7-9 league assignment
    cy.get('[data-cy="live-tournament-league-select"]').should("contain", "Unassigned");
    selectMatOption('[data-cy="live-tournament-league-select"]', "Preset League");
    selectMatOption('[data-cy="live-tournament-league-select"]', "Unassigned Tournaments");

    // 10-14 custom rounds
    cy.get('[data-cy="live-tournament-round-count-input"]').should("be.disabled").and("have.value", "0");
    cy.get('[data-cy="live-tournament-custom-round-count-checkbox"]').should("not.be.checked").click();
    cy.get('[data-cy="live-tournament-round-count-input"]').should("not.be.disabled").clear().type("10");
    cy.get('[data-cy="live-tournament-custom-round-count-checkbox"]').click();
    cy.get('[data-cy="live-tournament-round-count-input"]').should("be.disabled").and("have.value", "0");

    // 15-22 registration/player warnings
    addPlayer("Alice");
    assertRegistrationState({ playerCount: 1 });
    cy.get('[data-cy="live-warning-unpaid-players"]').should("be.visible");

    addPlayer("Bob");
    assertRegistrationState({ playerCount: 2 });
    cy.get('[data-cy="live-warning-unpaid-players"]').should("be.visible");

    cy.contains('[data-cy="live-player-row"]', "Alice").within(() => {
      cy.get('[data-cy="live-player-remove-button"]').click();
    });
    cy.contains('[data-cy="live-player-row"]', "Alice").should("not.exist");
    assertRegistrationState({ playerCount: 1 });

    for (const name of ["Alice", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi", "Ivan"]) {
      addPlayer(name);
      cy.get('[data-cy="live-player-row"]').its("length").then((count) => {
        assertRegistrationState({ playerCount: count });
      });
    }

    cy.get('[data-cy="live-player-row"]').each(($row) => {
      cy.wrap($row).find('[data-cy="live-player-paid-checkbox"]').check();
    });
    cy.get('[data-cy="live-warning-unpaid-players"]').should("not.exist");

    // 22.1 persistence/resume
    resumeThroughMenu(tournamentName);
    cy.get('[data-cy="live-player-row"]').should("have.length", 9);
    cy.get('[data-cy="breadcrumb-current"]').should("contain", `${tournamentName} (live)`);

    // 23 start tournament
    cy.get('[data-cy="live-start-tournament-button"]').click();

    // 24-33 validation UX
    cy.get('[data-cy="live-match-row"]').should("have.length", 4);
    cy.get('[data-cy="live-bye-row"]').should("have.length", 1);
    cy.get('[data-cy="live-validate-round-button"]').should("be.enabled");
    cy.get('[data-cy="live-all-draws-warning"]').should("be.visible");
    cy.get('[data-cy="live-match-row"]').should("have.class", "is-draw-warning");

    fillMatchScore(1, 3, 0);
    cy.get('[data-cy="live-match-row"][data-table="1"]').should("have.class", "is-invalid").and("contain", "cannot have more than 2 wins");
    cy.get('[data-cy="live-validate-round-button"]').should("be.disabled").and("have.attr", "title").and("include", "table 1");

    fillMatchScore(2, 0, 3);
    cy.get('[data-cy="live-validate-round-button"]').should("have.attr", "title").and("include", "table 1").and("include", "table 2");

    fillMatchScore(3, 3, 0);
    fillMatchScore(4, 0, 3);

    fillMatchScore(1, 2, 1);
    cy.get('[data-cy="live-match-row"][data-table="1"]').should("have.class", "is-valid");
    fillMatchScore(2, 1, 2);
    fillMatchScore(3, 1, 1);
    fillMatchScore(4, 1, 0);
    cy.get('[data-cy="live-validate-round-button"]').should("be.enabled");

    resumeThroughMenu(tournamentName);
    cy.get('[data-cy="live-match-row"]').should("have.length", 4);

    // 34-39 standings and cancellation
    cy.get('[data-cy="live-validate-round-button"]').click();
    cy.get('[data-cy="live-standings-table"]').should("be.visible");
    cy.get('[data-cy="live-cancel-standings-button"]').click();
    cy.get('[data-cy="live-match-row"]').should("have.length", 4);
    cy.get('[data-cy="live-cancel-round-button"]').click();
    cy.get('[data-cy="live-match-row"]').should("not.exist");

    // 40 regeneration randomness
    cy.get('[data-cy="live-start-tournament-button"]').click();
    capturePairings().then((firstPairings) => {
      let attempts = 0;
      function retryUntilDifferent() {
        attempts += 1;
        cy.get('[data-cy="live-regenerate-pairings-button"]').click();
        capturePairings().then((nextPairings) => {
          if (JSON.stringify(nextPairings) !== JSON.stringify(firstPairings)) return;
          if (attempts >= 5) throw new Error("Pairings did not change after 5 regenerations");
          retryUntilDifferent();
        });
      }
      retryUntilDifferent();
    });

    // 41-48 advanced/manual pairing and second validation pass
    // Use advanced settings, disable randomization, inspect preview, change pairings, add player if needed,
    // resume through menu, validate invalid/valid score behavior again.

    // 49-52 complete remaining rounds
    // Generate standings, then generate next rounds until final standings.
    // For each round, enter valid deterministic results and assert standings table updates.

    // 53-55 archive/finalize
    selectMatOption('[data-cy="live-tournament-league-select"]', "Preset League");
    cy.get('[data-cy="live-archive-tournament-button"]').click();
    cy.location("pathname").should("match", /^\/leagues\/preset-league\/tournaments\/.+/);
    cy.get('[data-cy="tournament-detail-page"]').should("contain", tournamentName);
    cy.get('[data-cy="ranking-table"]').should("be.visible");
    cy.get('[data-cy="round-entry-table"]').should("exist");
  });
});
```

## Material select helper

If the app continues to use Angular Material selects, add this helper:

```js
function selectMatOption(selectSelector, optionText) {
  cy.get(selectSelector).click();
  cy.get("mat-option").contains(optionText).click();
}
```

## Assertions for archived data parity

Before clicking archive, capture the live tournament summary from the UI or from localStorage.

Recommended approach: capture from localStorage because it avoids fragile UI text parsing.

```js
function readLiveTournamentFromStorage(tournamentName) {
  return cy.window().then((win) => {
    const store = JSON.parse(win.localStorage.getItem(LIVE_TOURNAMENT_STORE_KEY));
    return store.tournaments.find((item) => item.name === tournamentName);
  });
}
```

After archive, read the league store:

```js
function readArchivedTournament(tournamentName) {
  return cy.window().then((win) => {
    const store = JSON.parse(win.localStorage.getItem(LEAGUE_STORE_KEY));
    const league = store.leagues.find((item) => item.id === "preset-league");
    return league.tournaments.find((item) => item.name === tournamentName);
  });
}
```

Expected parity checks:

- Archived `name` equals live `name`.
- Archived `tournamentDate` equals live `tournamentDate`.
- Archived `leagueId` equals `preset-league`.
- Archived round count equals count of live validated rounds.
- For every archived round:
  - Entry count equals live validated round entry count.
  - Match table numbers match.
  - Match player names match.
  - Match scores match.
  - Bye entries match.
- Archived ranking table contains the same final player order/points expected from live standings.

## Recommended split if the test becomes too large

The user requested a single e2e. However, this flow is very long and can become brittle. If runtime or debugging cost becomes too high, split into these tests while keeping one shared fixture/helper module:

1. Registration warnings and persistence.
2. Round validation UX.
3. Pairing regeneration and advanced/manual pairing.
4. Full multi-round completion and archive parity.

If kept as one test, prefer helper functions and checkpoint assertions to keep the test readable.

## Current expected status

Until the gap spec is implemented, this e2e should be treated as a target specification, not a passing test. It documents exactly what the product must expose and what the Cypress test should verify once the running tournament UX is completed.
