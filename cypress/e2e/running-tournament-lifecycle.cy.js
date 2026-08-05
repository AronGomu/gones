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
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings.deckArchetypes', '[]');
}

function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addPlayer(name) {
  cy.get('[data-cy="live-add-player-name-input"]').should("be.visible").clear().type(`${name}{enter}`);
  cy.get('[data-cy="live-add-player-name-input"]').should("be.focused").and("have.value", "");
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

function setInputValue(selector, value) {
  cy.get(selector).then(($input) => {
    const input = $input[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function setNumberInput(selector, value) {
  setInputValue(selector, value);
  cy.get(selector).should("have.value", String(value));
}

function fillMatchScore(table, leftScore, rightScore) {
  cy.get(`[data-cy="live-match-row"][data-table="${table}"]`).within(() => {
    setNumberInput('[data-cy="live-match-player1-score"]', leftScore);
    setNumberInput('[data-cy="live-match-player2-score"]', rightScore);
  });
}

function assertScoreStepperLimits(table) {
  cy.get(`[data-cy="live-match-row"][data-table="${table}"]`).within(() => {
    cy.get('[data-cy="live-match-player1-score"]').should("have.attr", "type", "number");
    cy.get('[data-cy="live-match-player1-decrement"]').should("be.disabled");
    cy.get('[data-cy="live-match-player2-decrement"]').should("be.disabled");
    cy.get('[data-cy="live-match-player1-increment"]').should("be.enabled").click();
    cy.get('[data-cy="live-match-player1-increment"]').should("be.enabled").click();
    cy.get('[data-cy="live-match-player1-score"]').should("have.value", "2");
    cy.get('[data-cy="live-match-player1-increment"]').should("be.disabled");
    cy.get('[data-cy="live-match-player2-increment"]').should("be.enabled").click();
    cy.get('[data-cy="live-match-player2-score"]').should("have.value", "1");
    cy.get('[data-cy="live-match-player2-increment"]').should("be.disabled");
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

/** Editable standings rows render the player name and record as inputs, not text. */
function rowMatchesPlayer(row, name) {
  const matches = (value) => (name instanceof RegExp ? name.test(value) : value === name || value.includes(name));
  return matches(row.innerText) || [...row.querySelectorAll("input")].some((input) => matches(input.value));
}

function standingRow(name) {
  cy.get('[data-cy="live-standings-table"]').last().find("tbody tr").should(($rows) => {
    expect([...$rows].some((tr) => rowMatchesPlayer(tr, name)), `standings row for ${name}`).to.be.true;
  });
  return cy.get('[data-cy="live-standings-table"]').last().find("tbody tr").then(($rows) => {
    return cy.wrap([...$rows].find((tr) => rowMatchesPlayer(tr, name)));
  });
}

function addStandingPlayer(name, { wins = 0, draws = 0, losses = 0 } = {}) {
  cy.get('[data-cy="live-standing-actions-button"]').filter(":enabled").last().click();
  // Menu fade-in animation can stall under throttled rAF in headless runs; force past opacity.
  cy.get('[data-cy="live-standing-add-player-button"]').should("exist").click({ force: true });
  cy.get(".cdk-overlay-backdrop").should("not.exist");
  // Rename with a single input event: per-keystroke renames re-sort the standings and detach the row.
  standingRow(/^New Player \d+$/).within(() => {
    setInputValue('[data-cy="live-standing-player-name-input"]', name);
  });
  // Each record edit re-sorts the standings, so re-query the row before every field.
  for (const [field, value] of [["wins", wins], ["draws", draws], ["losses", losses]]) {
    standingRow(name).within(() => {
      setInputValue(`[data-cy="live-standing-player-${field}-input"]`, value);
    });
  }
  standingRow(name).should("exist");
}

/**
 * Headless Electron throttles requestAnimationFrame, so the app's smooth scroll can stall
 * mid-animation. Click the button (it must be present and clickable), then normalize the scroll
 * position deterministically so the rest of the flow does not depend on animation timing.
 */
function scrollToTopViaButton() {
  cy.get('[data-cy="live-scroll-top-button"]').click();
  cy.window().then((win) => win.scrollTo(0, 0));
  cy.window().should((win) => expect(win.scrollY).to.eq(0));
}

function confirmDialogAction(label) {
  cy.contains("mat-dialog-container", label).should("be.visible");
  cy.contains("mat-dialog-container button", label).click();
  cy.get("mat-dialog-container").should("not.exist");
}

function dropStandingPlayer(name, actionLabel = "Drop Player") {
  cy.get('[data-cy="live-standing-drop-player-button"]').then(($buttons) => {
    const row = [...$buttons].map((button) => button.closest("tr")).find((candidate) => candidate && rowMatchesPlayer(candidate, name));
    expect(row, `editable standings row for ${name}`).to.exist;
    cy.wrap(row).within(() => cy.get('[data-cy="live-standing-drop-player-button"]').should("be.enabled").click());
  });
  confirmDialogAction(actionLabel);
}

/**
 * Read-only steps auto-collapse when the active step moves on, but the collapse can land late
 * under the throttled headless renderer. If it has not landed yet, collapse via the header (a
 * user always can) and assert that a read-only step then stays collapsed.
 */
function ensureStepCollapsed(selector) {
  cy.get(selector).then(($panel) => {
    if ($panel.hasClass("mat-expanded")) cy.get(selector).find("mat-expansion-panel-header").first().click({ force: true });
  });
  cy.get(selector).should("not.have.class", "mat-expanded");
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
    standingRow(playerName).within(() => {
      cy.get("td").eq(2).should("have.text", String(record.points));
      cy.get("td").eq(3).then(($cell) => {
        const inputs = $cell.find("input");
        if (inputs.length) {
          expect(Number(inputs.filter('[data-cy="live-standing-player-wins-input"]').val()), "wins").to.eq(record.matchWins);
          expect(Number(inputs.filter('[data-cy="live-standing-player-draws-input"]').val()), "draws").to.eq(record.matchDraws);
          expect(Number(inputs.filter('[data-cy="live-standing-player-losses-input"]').val()), "losses").to.eq(record.matchLosses);
        } else {
          expect($cell.text().replace(/\s+/g, "").trim()).to.eq(expectedRecordText(record).replace(/\s+/g, ""));
        }
      });
      if (expectedStatus === "Dropped") cy.root().should("have.class", "is-dropped");
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

function assertPreviousStepsAreCollapsedAndDisabled() {
  cy.window().then((win) => {
    const live = storedLiveTournament(win);
    const previousPairingRounds = live.rounds.filter((round) => round.roundNumber < live.currentRoundNumber || live.stage !== "round" || round.validated);
    const previousStandingRounds = live.rounds.filter((round) => round.validated && (round.roundNumber < live.currentRoundNumber || live.stage !== "standings"));

    for (const round of previousPairingRounds) {
      const selector = `[data-cy="live-pairing-step"][data-round="${round.roundNumber}"]`;
      ensureStepCollapsed(selector);
      cy.get(selector).within(() => {
        cy.get("mat-expansion-panel-header").click({ force: true });
        cy.get('[data-cy="live-match-player1-score"]').should("be.disabled");
        cy.get('[data-cy="live-match-player2-score"]').should("be.disabled");
      });
    }

    for (const round of previousStandingRounds) {
      const selector = `[data-cy="live-standing-step"][data-round="${round.roundNumber}"]`;
      ensureStepCollapsed(selector);
      cy.get(selector).within(() => {
        cy.get("mat-expansion-panel-header").click({ force: true });
        cy.get('[data-cy="live-standing-actions-button"]').should("be.disabled");
        cy.get('[data-cy="live-standing-drop-player-button"]').should("not.exist");
      });
    }
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

const lifecycleViewports = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "phone", width: 390, height: 844 }
];

describe("Running tournament lifecycle", () => {
  for (const viewport of lifecycleViewports) runLifecycleSpec(viewport);
});

function runLifecycleSpec({ label, width, height }) {
  it(`creates, resumes, scores, completes, archives, and verifies a running tournament (${label})`, () => {
    cy.viewport(width, height);
    cy.visit("/", { onBeforeLoad: seedEmptyRunningTournamentState });
    // Test-isolation cleanup can race the previous page's settings self-heal (which restores the
    // French default); re-seed after boot and reload so this test deterministically starts in English.
    cy.window().then((win) => seedEmptyRunningTournamentState(win));
    cy.reload();

    cy.get('[data-cy="menu-running-tournaments-card"]').click();
    cy.location("pathname").should("eq", "/live-tournaments");
    cy.get('[data-cy="running-tournament-empty-state"]').should("be.visible");
    cy.get('[data-cy="create-running-tournament-card"]').should("contain", "Create a new tournament").click();

    cy.location("pathname").should("match", /^\/live-tournaments\/.+/);
    cy.get('[data-cy="live-warning-not-enough-players"]').should("exist");
    cy.get('[data-cy="breadcrumb-current"]').should("contain", "Live Tournament (live)");
    cy.get('[data-cy="live-tournament-name-input"]').should("be.focused").clear().type(tournamentName).blur();
    cy.get('[data-cy="breadcrumb-current"]').should("contain", `${tournamentName} (live)`);
    cy.get('[data-cy="live-tournament-date-input"]').should("have.value", todayInputValue());
    cy.get('[data-cy="live-tournament-league-select"]').should("contain", "Unassigned");
    selectMatOption('[data-cy="live-tournament-league-select"]', "Preset League");
    selectMatOption('[data-cy="live-tournament-league-select"]', "Unassigned Tournaments");
    openAdvancedSettings();
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
    confirmDialogAction("Remove Player");
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
    confirmDialogAction("Start Tournament");
    cy.get('[data-cy="live-scroll-top-button"]').should("be.visible");
    scrollToTopViaButton();
    cy.get('[data-cy="live-match-row"]').should("have.length", 4);
    cy.get('[data-cy="live-bye-row"]').should("have.length", 1);
    cy.get('[data-cy="live-all-draws-warning"]').should("be.visible");
    cy.get('[data-cy="live-match-row"]').should("have.class", "is-draw-warning");
    cy.get('[data-cy="live-validate-round-button"]').should("be.enabled").click();
    confirmDialogAction("Validate Round");
    cy.get('[data-cy="live-standings-table"]').should("be.visible");
    cy.get('[data-cy="live-standing-actions-button"]').click();
    cy.get('[data-cy="live-cancel-standings-button"]').click();
    assertScoreStepperLimits(1);

    fillMatchScore(1, 3, 0);
    cy.get('[data-cy="live-match-row"][data-table="1"]').should("have.class", "is-invalid");
    cy.get('[data-cy="live-validate-round-button"]').should("be.disabled");
    fillMatchScore(2, 2, 2);
    cy.get('[data-cy="live-match-row"][data-table="2"]').should("have.class", "is-invalid");
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
    cy.get('[data-cy="live-standing-actions-button"]').click();
    cy.get('[data-cy="live-cancel-standings-button"]').click();
    cy.get('[data-cy="live-match-row"]').should("have.length", 4);
    cy.get('[data-cy="live-pairing-actions-button"]').click();
    cy.get('[data-cy="live-cancel-round-button"]').click();
    cy.get('[data-cy="live-match-row"]').should("not.exist");

    cy.get('[data-cy="live-start-tournament-button"]').click();
    confirmDialogAction("Start Tournament");
    cy.get('[data-cy="live-regenerate-pairings-button"]').should("not.exist");

    assertCurrentRoundAssignments({ expectBye: true });
    scoreCurrentRound(0);
    assertPreviousStepsAreCollapsedAndDisabled();
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
    confirmDialogAction("Generate Round"); // Judy and Mallory are unpaid, so the warning dialog confirms first
    assertPreviousStepsAreCollapsedAndDisabled();
    assertCurrentRoundAssignments({ expectBye: true });
    scoreCurrentRound(1);
    assertPreviousStepsAreCollapsedAndDisabled();
    assertValidatedRoundByeCount(2, 1);

    dropStandingPlayer("Alice");
    assertCurrentStandingMatchesStorage("Alice", "Dropped");

    cy.get('[data-cy="live-generate-next-round-button"]').click();
    confirmDialogAction("Generate Round");
    assertPreviousStepsAreCollapsedAndDisabled();
    assertCurrentRoundAssignments({ expectBye: false, absentPlayers: ["Alice"] });
    scoreCurrentRound(2);
    assertPreviousStepsAreCollapsedAndDisabled();
    assertValidatedRoundByeCount(3, 0);
    assertCurrentStandingMatchesStorage("Alice", "Dropped");

    dropStandingPlayer("Bob");
    assertCurrentStandingMatchesStorage("Bob", "Dropped");

    selectMatOption('[data-cy="live-tournament-league-select"]', "Preset League");
    readLiveTournamentFromStorage().as("liveBeforeArchive");
    cy.get('[data-cy="live-archive-tournament-button"]').should("be.enabled").click();
    confirmDialogAction("Archive Tournament"); // unpaid players warning confirms before archiving
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
}
