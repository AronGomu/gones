const LEAGUE_STORE_KEY = "gones.frontend.backend.v1";
const LIVE_TOURNAMENT_STORE_KEY = "gones.live-tournaments.v1";

const presetLeague = {
  id: "preset-league",
  name: "Preset League",
  status: "active",
  documentVersion: 1,
  updatedAt: "2026-06-21T00:00:00.000Z",
  tournaments: []
};

const players = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi", "Ivan"];
const tournamentName = "Cypress Live Lifecycle";

function seedEmptyRunningTournamentState(win) {
  win.localStorage.setItem(LEAGUE_STORE_KEY, JSON.stringify({ version: 1, leagues: [presetLeague] }));
  win.localStorage.setItem(LIVE_TOURNAMENT_STORE_KEY, JSON.stringify({ version: 1, tournaments: [], deletedTournamentIds: [] }));
}

function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function expectedRoundCount(playerCount) {
  if (playerCount < 2) return 0;
  if (playerCount === 2) return 1;
  if (playerCount <= 15) return 3;
  return Math.ceil(Math.log2(playerCount));
}

function addPlayer(name) {
  cy.get('[data-cy="live-player-name-input"]').clear().type(name);
  cy.get('[data-cy="live-add-player-button"]').click();
  cy.contains('[data-cy="live-player-row"]', name).should("be.visible");
}

function assertRegistrationState(playerCount) {
  cy.get('[data-cy="live-player-count"]').should("contain", String(playerCount));
  cy.get('[data-cy="live-tournament-round-count-input"]').should("have.value", String(expectedRoundCount(playerCount)));

  if (playerCount < 2) {
    cy.get('[data-cy="live-warning-not-enough-players"]').should("exist");
    cy.get('[data-cy="live-start-tournament-button"]').should("be.disabled");
  } else {
    cy.get('[data-cy="live-warning-not-enough-players"]').should("not.exist");
    cy.get('[data-cy="live-start-tournament-button"]').should("not.be.disabled");
  }

  if (playerCount > 2 && playerCount % 2 === 1) cy.get('[data-cy="live-warning-bye"]').should("exist");
  else cy.get('[data-cy="live-warning-bye"]').should("not.exist");
}

function selectMatOption(selectSelector, optionText) {
  cy.get(selectSelector).should("be.visible").click({ force: true });
  cy.contains("mat-option", optionText).click({ force: true });
  cy.get(selectSelector).should("contain", optionText);
}

function setNumberInput(selector, value) {
  cy.get(selector).then(($input) => {
    const input = $input[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  cy.get(selector).should("have.value", String(value));
}

function fillMatchScore(table, leftScore, rightScore) {
  cy.get(`[data-cy="live-match-row"][data-table="${table}"]`).within(() => {
    setNumberInput('[data-cy="live-match-player1-score"]', leftScore);
    setNumberInput('[data-cy="live-match-player2-score"]', rightScore);
  });
}

function capturePairings() {
  return cy.get('[data-cy="live-match-row"]').then(($rows) => [...$rows].map((row) => row.innerText.replace(/\s+/g, " ").trim()));
}

function resumeThroughMenu() {
  cy.visit("/");
  cy.get('[data-cy="menu-running-tournaments-card"]').click();
  cy.location("pathname").should("eq", "/live-tournaments");
  cy.contains('[data-cy="running-tournament-card"]', tournamentName).within(() => {
    cy.get('[data-cy="resume-running-tournament"]').click();
  });
  cy.location("pathname").should("match", /^\/live-tournaments\/.+/);
}

function scoreCurrentRound(offset = 0) {
  cy.get('[data-cy="live-match-row"]').each(($row, index) => {
    const table = $row.attr("data-table");
    const leftWins = (index + offset) % 3 === 0 ? 2 : 1;
    const rightWins = leftWins === 2 ? 0 : 2;
    fillMatchScore(table, leftWins, rightWins);
  });
  cy.get('[data-cy="live-validate-round-button"]').should("be.enabled").click();
  cy.get('[data-cy="live-standings-table"]').should("be.visible");
}

function readLiveTournamentFromStorage() {
  return cy.window().then((win) => {
    const store = JSON.parse(win.localStorage.getItem(LIVE_TOURNAMENT_STORE_KEY));
    return store.tournaments.find((item) => item.name === tournamentName);
  });
}

function readArchivedTournament() {
  return cy.window().then((win) => {
    const store = JSON.parse(win.localStorage.getItem(LEAGUE_STORE_KEY));
    const league = store.leagues.find((item) => item.id === "preset-league");
    return league.tournaments.find((item) => item.name === tournamentName);
  });
}

describe("Running tournament lifecycle", () => {
  it("creates, resumes, scores, completes, archives, and verifies a running tournament", () => {
    cy.visit("/", { onBeforeLoad: seedEmptyRunningTournamentState });

    cy.get('[data-cy="menu-running-tournaments-card"]').click();
    cy.location("pathname").should("eq", "/live-tournaments");
    cy.get('[data-cy="running-tournament-empty-state"]').should("be.visible");
    cy.get('[data-cy="create-running-tournament-card"]').should("contain", "Create a new tournament").click();

    cy.location("pathname").should("match", /^\/live-tournaments\/.+/);
    cy.get('[data-cy="live-warning-not-enough-players"]').should("exist");
    cy.get('[data-cy="breadcrumb-current"]').should("contain", "Live Tournament (live)");
    cy.get('[data-cy="live-tournament-name-input"]').clear().type(tournamentName).blur();
    cy.get('[data-cy="breadcrumb-current"]').should("contain", `${tournamentName} (live)`);
    cy.get('[data-cy="live-tournament-date-input"]').should("have.value", todayInputValue());
    cy.get('[data-cy="live-tournament-league-select"]').should("contain", "Unassigned");
    selectMatOption('[data-cy="live-tournament-league-select"]', "Preset League");
    selectMatOption('[data-cy="live-tournament-league-select"]', "Unassigned Tournaments");

    cy.get('[data-cy="live-tournament-round-count-input"]').should("be.disabled").and("have.value", "0");
    cy.get('[data-cy="live-tournament-custom-round-count-checkbox"]').should("not.be.checked").click();
    cy.get('[data-cy="live-tournament-round-count-input"]').should("not.be.disabled").clear().type("10");
    cy.get('[data-cy="live-tournament-custom-round-count-checkbox"]').click();
    cy.get('[data-cy="live-tournament-round-count-input"]').should("be.disabled").and("have.value", "0");

    addPlayer("Alice");
    assertRegistrationState(1);
    cy.get('[data-cy="live-warning-unpaid-players"]').should("exist");
    addPlayer("Bob");
    assertRegistrationState(2);
    cy.contains('[data-cy="live-player-row"]', "Alice").within(() => cy.get('[data-cy="live-player-remove-button"]').click());
    cy.contains('[data-cy="live-player-row"]', "Alice").should("not.exist");
    assertRegistrationState(1);

    for (const name of players.filter((name) => name !== "Bob")) addPlayer(name);
    cy.get('[data-cy="live-player-row"]').should("have.length", 9);
    assertRegistrationState(9);
    cy.get('[data-cy="live-player-row"]').each(($row) => cy.wrap($row).find('[data-cy="live-player-paid-checkbox"]').check());
    cy.get('[data-cy="live-warning-unpaid-players"]').should("not.exist");

    resumeThroughMenu();
    cy.get('[data-cy="live-player-row"]').should("have.length", 9);
    cy.get('[data-cy="breadcrumb-current"]').should("contain", `${tournamentName} (live)`);

    cy.get('[data-cy="live-start-tournament-button"]').click();
    cy.get('[data-cy="live-match-row"]').should("have.length", 4);
    cy.get('[data-cy="live-bye-row"]').should("have.length", 1);
    cy.get('[data-cy="live-all-draws-warning"]').should("be.visible");
    cy.get('[data-cy="live-match-row"]').should("have.class", "is-draw-warning");

    fillMatchScore(1, 3, 0);
    cy.get('[data-cy="live-match-row"][data-table="1"]').should("have.class", "is-invalid").and("contain", "cannot have more than 2 wins");
    cy.get('[data-cy="live-validate-round-button"]').should("be.disabled").and("have.attr", "title").and("include", "table 1");
    fillMatchScore(2, 0, 3);
    cy.get('[data-cy="live-validate-round-button"]').should("have.attr", "title").and("include", "table 1").and("include", "table 2");
    fillMatchScore(1, 2, 1);
    fillMatchScore(2, 1, 2);
    fillMatchScore(3, 1, 1);
    fillMatchScore(4, 1, 0);
    cy.get('[data-cy="live-match-row"][data-table="1"]').should("have.class", "is-valid");
    cy.get('[data-cy="live-validate-round-button"]').should("be.enabled");

    resumeThroughMenu();
    cy.get('[data-cy="live-match-row"]').should("have.length", 4);
    cy.get('[data-cy="live-validate-round-button"]').click();
    cy.get('[data-cy="live-standings-table"]').should("be.visible");
    cy.get('[data-cy="live-cancel-standings-button"]').click();
    cy.get('[data-cy="live-match-row"]').should("have.length", 4);
    cy.get('[data-cy="live-cancel-round-button"]').click();
    cy.get('[data-cy="live-match-row"]').should("not.exist");

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

    scoreCurrentRound(0);
    cy.get('[data-cy="live-generate-next-round-button"]').click();
    scoreCurrentRound(1);
    cy.get('[data-cy="live-generate-next-round-button"]').click();
    scoreCurrentRound(2);

    selectMatOption('[data-cy="live-tournament-league-select"]', "Preset League");
    readLiveTournamentFromStorage().as("liveBeforeArchive");
    cy.get('[data-cy="live-archive-tournament-button"]').click();
    cy.location("pathname").should("match", /^\/leagues\/preset-league\/tournaments\/.+/);
    cy.get('[data-cy="tournament-detail-page"]').should("contain", tournamentName);
    cy.get('[data-cy="ranking-table"]').should("be.visible");
    cy.get('[data-cy="round-entry-table"]').should("exist");

    cy.get("@liveBeforeArchive").then((live) => {
      readArchivedTournament().then((archived) => {
        expect(archived.name).to.eq(live.name);
        expect(archived.tournamentDate).to.eq(live.tournamentDate);
        expect(archived.leagueId).to.eq("preset-league");
        expect(archived.rounds).to.have.length(live.rounds.filter((round) => round.validated).length);
      });
    });
  });
});
