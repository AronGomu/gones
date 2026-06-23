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

function addPlayer(name) {
  cy.get('[data-cy="live-add-player-button"]').click();
  cy.get('[data-cy="live-player-row"]').last().within(() => {
    cy.get('[data-cy="live-player-name-input"]').clear().type(name);
  });
  cy.contains('[data-cy="live-player-row"]', name).should("be.visible");
}

function assertRegistrationState(playerCount) {
  cy.get('[data-cy="live-player-count"]').should("contain", String(playerCount));

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

function openAdvancedSettings() {
  cy.get('[data-cy="live-tournament-advanced-settings-button"]').click();
  cy.contains("mat-dialog-container", "Advanced settings").should("be.visible");
}

function applyAdvancedSettings() {
  cy.contains("button", "Apply settings").click();
  cy.get("mat-dialog-container").should("not.exist");
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
  cy.contains('[data-cy="running-tournament-card"]', tournamentName).click();
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

function addStandingPlayer(name, { wins = 0, draws = 0, losses = 0 } = {}) {
  cy.get('[data-cy="live-standing-add-player-form"]').last().within(() => {
    cy.get('[data-cy="live-standing-player-name-input"]').clear().type(name);
    setNumberInput('[data-cy="live-standing-player-wins-input"]', wins);
    setNumberInput('[data-cy="live-standing-player-draws-input"]', draws);
    setNumberInput('[data-cy="live-standing-player-losses-input"]', losses);
    cy.get('[data-cy="live-standing-add-player-button"]').should("be.enabled").click();
  });
  cy.get('[data-cy="live-standings-table"]').last().should("contain", name);
}

function confirmDialogAction(label) {
  cy.contains("mat-dialog-container", label).should("be.visible");
  cy.contains("mat-dialog-container button", label).click();
  cy.get("mat-dialog-container").should("not.exist");
}

function dropStandingPlayer(name, actionLabel = "Drop Player") {
  cy.get('[data-cy="live-standing-drop-player-button"]').then(($buttons) => {
    const row = [...$buttons].map((button) => button.closest("tr")).find((candidate) => candidate?.innerText.includes(name));
    expect(row, `editable standings row for ${name}`).to.exist;
    cy.wrap(row).within(() => cy.get('[data-cy="live-standing-drop-player-button"]').should("be.enabled").click());
  });
  confirmDialogAction(actionLabel);
}

function playerNamesInEntry(entry) {
  if (entry.kind === "bye") return [entry.playerName];
  if (entry.kind === "match") return [entry.player1Name, entry.player2Name];
  return [];
}

function calculateExpectedRecord(live, playerName) {
  const player = live.players.find((item) => item.name === playerName);
  expect(player, `stored player ${playerName}`).to.exist;
  const record = {
    points: player.initialWins * 3 + player.initialDraws,
    matchWins: player.initialWins,
    matchDraws: player.initialDraws,
    matchLosses: player.initialLosses,
    byes: 0
  };

  for (const round of live.rounds.filter((item) => item.validated)) {
    for (const { entry } of round.entries) {
      if (entry.kind === "bye" && entry.playerName === playerName) {
        record.points += 3;
        record.matchWins += 1;
        record.byes += 1;
        continue;
      }
      if (entry.kind !== "match") continue;
      const isPlayer1 = entry.player1Name === playerName;
      const isPlayer2 = entry.player2Name === playerName;
      if (!isPlayer1 && !isPlayer2) continue;
      const ownScore = isPlayer1 ? entry.player1Score : entry.player2Score;
      const opponentScore = isPlayer1 ? entry.player2Score : entry.player1Score;
      if (ownScore > opponentScore) {
        record.points += 3;
        record.matchWins += 1;
      } else if (ownScore < opponentScore) {
        record.matchLosses += 1;
      } else {
        record.points += 1;
        record.matchDraws += 1;
      }
    }
  }

  return record;
}

function expectedRecordText(record) {
  const byeText = record.byes ? ` (${record.byes} bye)` : "";
  return `${record.matchWins}-${record.matchLosses}-${record.matchDraws}${byeText}`;
}

function assertCurrentStandingMatchesStorage(playerName, expectedStatus) {
  cy.window().should((win) => {
    const live = storedLiveTournament(win);
    const player = live.players.find((item) => item.name === playerName);
    expect(player, `stored player ${playerName}`).to.exist;
    if (expectedStatus === "Dropped") expect(player.dropped, `${playerName} dropped flag`).to.eq(true);
  }).then((win) => {
    const live = storedLiveTournament(win);
    const record = calculateExpectedRecord(live, playerName);
    cy.get('[data-cy="live-standings-table"]').last().contains("tr", playerName).within(() => {
      cy.get("td").eq(2).should("have.text", String(record.points));
      cy.get("td").eq(3).invoke("text").then((text) => expect(text.replace(/\s+/g, "").trim()).to.eq(expectedRecordText(record).replace(/\s+/g, "")));
      cy.get("td").eq(7).should("have.text", expectedStatus);
    });
  });
}

function assertLivePlayerAbsent(playerName) {
  cy.window().should((win) => {
    const live = storedLiveTournament(win);
    expect(live.players.map((player) => player.name)).not.to.include(playerName);
  });
}

function assertValidatedRoundByeCount(roundNumber, expectedCount) {
  cy.window().should((win) => {
    const live = storedLiveTournament(win);
    const round = live.rounds.find((item) => item.roundNumber === roundNumber);
    expect(round, `round ${roundNumber}`).to.exist;
    expect(round.validated, `round ${roundNumber} validated`).to.eq(true);
    expect(round.entries.filter(({ entry }) => entry.kind === "bye"), `round ${roundNumber} byes`).to.have.length(expectedCount);
  });
}

function assertCurrentRoundAssignments({ expectBye, absentPlayers = [] }) {
  cy.window().should((win) => {
    const live = storedLiveTournament(win);
    const round = live.rounds.find((item) => item.roundNumber === live.currentRoundNumber);
    const activeCount = live.players.filter((player) => player.name && !player.dropped).length;
    const expectedMatchCount = (activeCount - (expectBye ? 1 : 0)) / 2;
    expect(round, `current round ${live.currentRoundNumber}`).to.exist;
    expect(round.entries.filter(({ entry }) => entry.kind === "bye"), `current round ${live.currentRoundNumber} byes`).to.have.length(expectBye ? 1 : 0);
    expect(round.entries.filter(({ entry }) => entry.kind === "match"), `current round ${live.currentRoundNumber} matches`).to.have.length(expectedMatchCount);
    const assignedNames = round.entries.flatMap(({ entry }) => playerNamesInEntry(entry));
    for (const playerName of absentPlayers) expect(assignedNames, `${playerName} current round assignment`).not.to.include(playerName);
  });

  cy.get('[data-cy="live-round-panel"]').last().within(() => {
    if (expectBye) cy.get('[data-cy="live-bye-row"]').should("have.length", 1);
    else cy.get('[data-cy="live-bye-row"]').should("not.exist");
    for (const playerName of absentPlayers) cy.root().should("not.contain", playerName);
  });
}

function storedLiveTournament(win) {
  const store = JSON.parse(win.localStorage.getItem(LIVE_TOURNAMENT_STORE_KEY));
  return store.tournaments.find((item) => item.name === tournamentName);
}

function readLiveTournamentFromStorage() {
  return cy.window().then((win) => storedLiveTournament(win));
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
    cy.get('[data-cy="live-tournament-title-button"]').click();
    cy.get('[data-cy="live-tournament-name-input"]').clear().type(tournamentName).blur();
    cy.get('[data-cy="breadcrumb-current"]').should("contain", `${tournamentName} (live)`);
    openAdvancedSettings();
    cy.get('[data-cy="live-tournament-date-input"]').should("have.value", todayInputValue());
    cy.get('[data-cy="live-tournament-league-select"]').should("contain", "Unassigned");
    selectMatOption('[data-cy="live-tournament-league-select"]', "Preset League");
    selectMatOption('[data-cy="live-tournament-league-select"]', "Unassigned Tournaments");
    cy.get('[data-cy="live-tournament-paid-tracking-checkbox"] input').should("be.checked");
    applyAdvancedSettings();

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
    openAdvancedSettings();
    cy.get('[data-cy="live-tournament-paid-tracking-checkbox"] input').uncheck({ force: true });
    applyAdvancedSettings();
    cy.get('[data-cy="live-warning-unpaid-players"]').should("not.exist");
    cy.get('[data-cy="live-player-paid-checkbox"]').should("not.exist");
    openAdvancedSettings();
    cy.get('[data-cy="live-tournament-paid-tracking-checkbox"] input').check({ force: true });
    applyAdvancedSettings();
    cy.get('[data-cy="live-warning-unpaid-players"]').should("exist");
    cy.contains('[data-cy="live-player-row"]', "Alice").within(() => cy.get('[data-cy="live-player-remove-button"]').click());
    cy.contains('[data-cy="live-player-row"]', "Alice").should("not.exist");
    assertRegistrationState(1);

    for (const name of players.filter((name) => name !== "Bob")) addPlayer(name);
    cy.get('[data-cy="live-player-row"]').should("have.length", 9);
    assertRegistrationState(9);
    cy.get('[data-cy="live-player-paid-checkbox"]').check({ force: true });
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
    cy.get('[data-cy="live-match-row"][data-table="1"]').should("have.class", "is-valid");
    cy.get('[data-cy="live-validate-round-button"]').should("be.disabled");
    fillMatchScore(2, 0, 3);
    cy.get('[data-cy="live-match-row"][data-table="2"]').should("have.class", "is-valid");
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

    assertCurrentRoundAssignments({ expectBye: true });
    scoreCurrentRound(0);
    assertValidatedRoundByeCount(1, 1);

    addStandingPlayer("Temporary Drop", { losses: 1 });
    dropStandingPlayer("Temporary Drop", "Remove Player");
    cy.get('[data-cy="live-standings-table"]').last().should("not.contain", "Temporary Drop");
    assertLivePlayerAbsent("Temporary Drop");

    addStandingPlayer("Judy", { wins: 1 });
    assertCurrentStandingMatchesStorage("Judy", "Unpaid");
    addStandingPlayer("Mallory", { draws: 1 });
    assertCurrentStandingMatchesStorage("Mallory", "Unpaid");

    cy.get('[data-cy="live-generate-next-round-button"]').click();
    assertCurrentRoundAssignments({ expectBye: true });
    scoreCurrentRound(1);
    assertValidatedRoundByeCount(2, 1);

    dropStandingPlayer("Alice");
    assertCurrentStandingMatchesStorage("Alice", "Dropped");

    cy.get('[data-cy="live-generate-next-round-button"]').click();
    assertCurrentRoundAssignments({ expectBye: false, absentPlayers: ["Alice"] });
    scoreCurrentRound(2);
    assertValidatedRoundByeCount(3, 0);
    assertCurrentStandingMatchesStorage("Alice", "Dropped");

    dropStandingPlayer("Bob");
    assertCurrentStandingMatchesStorage("Bob", "Dropped");

    openAdvancedSettings();
    selectMatOption('[data-cy="live-tournament-league-select"]', "Preset League");
    applyAdvancedSettings();
    readLiveTournamentFromStorage().as("liveBeforeArchive");
    cy.get('[data-cy="live-archive-tournament-button"]').should("be.enabled").click();
    cy.location("pathname", { timeout: 15000 }).should("match", /^\/leagues\/preset-league\/tournaments\/.+/);
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
