const STORE_KEY = "gones.frontend.backend.v1";
const LIVE_TOURNAMENT_STORE_KEY = "gones.live-tournaments.v1";

const emptyStore = { version: 1, leagues: [] };
const players = [
  "Alice", "Bob", "Chloe", "Diego", "Emma", "Finn", "Grace", "Hugo", "Iris", "Jules", "Kai",
  "Lena", "Maya", "Noah", "Omar", "Priya", "Quinn", "Rosa", "Sam", "Talia", "Uma"
];
const archetypes = new Map(players.map((player, index) => [player, `Deck ${index + 1}`]));

function resetAppStorage(win) {
  win.localStorage.setItem(STORE_KEY, JSON.stringify(emptyStore));
  win.localStorage.setItem(LIVE_TOURNAMENT_STORE_KEY, JSON.stringify({ version: 1, tournaments: [], deletedTournamentIds: [] }));
  win.localStorage.setItem("gones.settings", JSON.stringify({ language: "en", deckArchetypes: [] }));
  win.localStorage.setItem("gones.settings.language", "en");
  win.localStorage.setItem("gones.settings.deckArchetypes", "[]");
}

function visitMenuWithNoLeagues() {
  cy.visit("/", { onBeforeLoad: resetAppStorage });
}

function goToLeaguesFromMenu() {
  cy.contains('a', 'Create leagues, open tournaments').click();
  cy.location("pathname").should("eq", "/leagues");
}

function returnToMenuFromLeagueList() {
  cy.contains("a.back-button", "Return to Menu").first().click();
  cy.location("pathname").should("eq", "/");
}

function returnToLeagueListFromLeague() {
  cy.contains("a.back-button", "Back to Leagues").first().click();
  cy.location("pathname").should("eq", "/leagues");
}

function returnToLeagueFromTournament() {
  cy.contains("a.back-button", "Back to League").first().click();
  cy.location("pathname").should("match", /^\/leagues\/[^/]+$/);
}

function createLeague(name) {
  cy.get('[data-cy="create-league-card"]').click();
  cy.contains("mat-dialog-container", "New League").within(() => {
    cy.get("input").clear().type(name);
    cy.contains("button", "Create League").click();
  });
  cy.location("pathname").should("match", /^\/leagues\/[^/]+$/);
  cy.contains("h1 button", name).should("be.visible");
}

function cancelCreateLeagueDialog() {
  cy.get('[data-cy="create-league-card"]').click();
  cy.contains("mat-dialog-container", "New League").within(() => cy.contains("button", "Cancel Esc").click());
  cy.get("mat-dialog-container").should("not.exist");
}

function renameLeague(fromName, toName) {
  cy.contains("h1 button", fromName).click();
  cy.get('[data-cy="league-name-input"]').should("be.focused").clear().type(`${toName}{enter}`);
  cy.contains("h1 button", toName).should("be.visible");
}

function createTournamentFromLeague() {
  cy.get('[data-cy="create-tournament-card"]').click();
  cy.location("pathname").should("match", /^\/leagues\/[^/]+\/tournaments\/[^/]+$/);
  cy.get('[data-cy="tournament-detail-page"]').should("be.visible");
}

function renameTournament(toName) {
  cy.get("h1 button.editable-title").click();
  cy.get('[data-cy="tournament-name-input"]').should("be.focused").clear().type(`${toName}{enter}`);
  cy.contains("h1 button", toName).should("be.visible");
}

function setTournamentDate(date) {
  cy.get('input[type="date"]').clear().type(date).blur();
}

function saveTournamentDraft(expectedRoundCount = 4) {
  cy.document().trigger("keydown", { key: "s", code: "KeyS", ctrlKey: true, force: true });
  cy.location("pathname").then((pathname) => {
    const tournamentId = pathname.split("/").pop();
    cy.window().should((win) => {
      const store = JSON.parse(win.localStorage.getItem(STORE_KEY));
      const tournament = store.leagues.flatMap((league) => league.tournaments).find((item) => item.id === tournamentId);
      expect(tournament?.rounds, "saved tournament rounds").to.have.length(expectedRoundCount);
    });
  });
  cy.get("h1 button.editable-title").should("be.visible");
}

let expectedRoundCount = 0;
function addRound() {
  expectedRoundCount += 1;
  cy.contains("button", "Add Round").click();
  cy.contains("mat-panel-description", `${expectedRoundCount} round`).should("exist");
  cy.contains("button", "Add Round").should("not.be.disabled");
  cy.contains("mat-expansion-panel-header", "Rounds").should("have.attr", "aria-expanded", "true");
}

function roundPanel(roundName) {
  return cy.contains("mat-expansion-panel", roundName);
}

function expandRound(roundName) {
  cy.contains("mat-expansion-panel-header", "Rounds").then(($header) => {
    if ($header.attr("aria-expanded") !== "true") cy.wrap($header).click();
  });
  roundPanel(roundName).find("mat-expansion-panel-header").then(($header) => {
    if ($header.attr("aria-expanded") !== "true") cy.wrap($header).click();
  });
  roundPanel(roundName).find(".mat-expansion-panel-body").should("be.visible");
}

function inputFor(roundNumber, entryNumber, field) {
  return cy.get(`input[aria-label="Round ${roundNumber}, entry ${entryNumber}: ${field}"]`);
}

function setNativeInputValue($input, value) {
  const input = $input[0];
  const view = input.ownerDocument.defaultView;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value").set;
  setter.call(input, String(value));
  input.dispatchEvent(new view.Event("input", { bubbles: true }));
  input.dispatchEvent(new view.Event("change", { bubbles: true }));
}

function fillInput(roundNumber, entryNumber, field, value) {
  inputFor(roundNumber, entryNumber, field).clear().type(String(value), { delay: 0 });
  inputFor(roundNumber, entryNumber, field).should("have.value", String(value));
}

function addMatchWithForm(roundName, roundNumber, entryNumber, match) {
  expandRound(roundName);
  roundPanel(roundName).within(() => cy.contains("button", "Add Match").click());
  inputFor(roundNumber, entryNumber, "player 1").should("exist");
  fillMatch(roundNumber, entryNumber, match);
}

function addByeWithForm(roundName, roundNumber, entryNumber, table, playerName) {
  expandRound(roundName);
  roundPanel(roundName).within(() => cy.contains("button", "Add Bye").click());
  inputFor(roundNumber, entryNumber, "table").clear().type(String(table), { delay: 20 });
  inputFor(roundNumber, entryNumber, "bye player").clear().type(`${playerName}${playerName.at(-1)}{backspace}`, { delay: 20 }).blur();
}

function fillMatch(roundNumber, entryNumber, match) {
  fillInput(roundNumber, entryNumber, "table", match.table);
  fillInput(roundNumber, entryNumber, "player 1", match.player1);
  fillInput(roundNumber, entryNumber, "player 1 wins", match.score1);
  fillInput(roundNumber, entryNumber, "player 1 losses", match.score2);
  fillInput(roundNumber, entryNumber, "player 2", match.player2);
}

function importRound(roundName, csv) {
  expandRound(roundName);
  roundPanel(roundName).within(() => {
    cy.get('[data-cy="round-import-input"]').invoke("val", csv).trigger("input");
    cy.contains("button", "Import Round Data").should("be.visible").click();
    cy.get('[data-cy="round-entry-table"] tbody tr').should("have.length", csv.trim().split("\n").length);
  });
}

function expectRankingRow(player, { points, record }) {
  cy.contains('[data-cy="ranking-table"] tbody tr', player).within(() => {
    cy.get("td").eq(1).should("contain", player);
    cy.get("td").eq(2).should("have.text", String(points));
    cy.get("td").eq(3).invoke("text").then((text) => expect(text.replace(/\s+/g, " ").trim()).to.eq(record));
  });
}

function fillAllArchetypes() {
  cy.get('[data-cy="player-archetype-panel"] mat-expansion-panel-header').click();
  for (const [player, archetype] of archetypes.entries()) {
    cy.get(`input[aria-label="Deck archetype for ${player}"]`).then(($input) => setNativeInputValue($input, archetype));
    cy.get(`input[aria-label="Deck archetype for ${player}"]`).should("have.value", archetype);
  }
  cy.contains("Warnings:").should("not.exist");
}

function leagueCard(name) {
  return cy.contains('[data-cy="league-list-item"]', name);
}

describe("League and archived tournament navigation", () => {
  it("creates, navigates, edits, validates, persists, and reopens league tournaments", () => {
    visitMenuWithNoLeagues();
    goToLeaguesFromMenu();
    cy.contains("h1", "Leagues").should("be.visible");
    cy.contains("No public Leagues match this view.").should("be.visible");

    cancelCreateLeagueDialog();
    createLeague("Local League");
    cy.contains(".muted", "0 Tournaments · No start date — No end date").should("be.visible");
    cy.get('[data-cy="empty-ranking"]').should("contain", "Empty League has no League Result");
    cy.contains("No Tournaments yet.").should("be.visible");
    cy.get('[data-cy="create-tournament-card"]').should("be.visible");

    returnToLeagueListFromLeague();
    leagueCard("Local League").should("contain", "0 Tournaments").and("contain", "0 Players").click();
    renameLeague("Local League", "Renamed Local League");
    returnToLeagueListFromLeague();
    returnToMenuFromLeagueList();
    goToLeaguesFromMenu();
    leagueCard("Renamed Local League").click();
    cy.contains("h1 button", "Renamed Local League").should("be.visible");

    createTournamentFromLeague();
    cy.contains(".kicker", "Tournament").should("be.visible");
    cy.get('[data-cy="empty-ranking"]').should("contain", "No valid Round Entries yet");
    cy.contains("mat-expansion-panel", "Rounds").should("contain", "0 rounds");
    cy.get('[data-cy="player-archetype-panel"]').should("contain", "0 players");
    renameTournament("Spring Archived Tournament");
    setTournamentDate("2026-06-20");

    addRound();
    const roundOneMatches = [
      ["1", "Alice", 2, 0, "Bob"], ["2", "Chloe", 2, 1, "Diego"], ["3", "Emma", 0, 2, "Finn"],
      ["4", "Grace", 1, 2, "Hugo"], ["5", "Iris", 2, 0, "Jules"], ["6", "Kai", 2, 1, "Lena"],
      ["7", "Maya", 1, 1, "Noah"], ["8", "Omar", 0, 2, "Priya"], ["9", "Quinn", 2, 0, "Rosa"],
      ["10", "Sam", 2, 1, "Talia"]
    ];
    roundOneMatches.forEach(([table, player1, score1, score2, player2], index) => {
      addMatchWithForm("Round 1", 1, index + 1, { table, player1, score1, score2, player2 });
    });
    addByeWithForm("Round 1", 1, 11, "11", "Uma");
    cy.get('[data-cy="ranking-table"] tbody tr').should("have.length", 21);
    expectRankingRow("Alice", { points: 3, record: "1-0-0" });
    expectRankingRow("Uma", { points: 3, record: "1-0-0(1 bye)" });
    cy.contains("Warnings:").should("be.visible");
    cy.contains("No deck archetype for:").should("be.visible").and("contain", "Alice");

    addRound();
    importRound("Round 2", [
      "1,Alice,Won 2-1,Chloe,,",
      "2,Bob,Lost 1-2,Diego,,",
      "3,Emma,Won 2-0,Grace,,",
      "4,Finn,Won 2-1,Hugo,,",
      "5,Iris,Lost 1-2,Kai,,",
      "6,Jules,Won 2-0,Lena,,",
      "7,Maya,Draw 1-1,Omar,,",
      "8,Noah,Lost 0-2,Priya,,",
      "9,Quinn,Won 2-0,Sam,,",
      "10,Rosa,Won 2-1,Talia,,"
    ].join("\n"));
    addByeWithForm("Round 2", 2, 11, "11", "Uma");
    fillAllArchetypes();

    addRound();
    importRound("Round 3", [
      "1,Alice,Won 3-0,Bob,Combo,Control",
      "2,Alice,Won 2-0,Chloe,Combo,Deck 3",
      "3,Zara,Won 2-0,Alice,Rogue,Combo",
      "4,Emma,Lost 1-2,Grace,Deck 5,Deck 7"
    ].join("\n"));
    cy.get('[data-cy="round-import-archetype-conflict"]').should("be.visible").and("contain", "Alice").and("contain", "Combo");
    cy.contains("game wins cannot be over 2").should("be.visible");
    cy.contains("Round 3: Alice appears more than once").should("be.visible");
    cy.contains("Round 3: Zara was not present in previous rounds").should("be.visible");
    cy.contains("A player pairing appears more than once").should("be.visible");
    roundPanel("Round 3").find("tbody tr").eq(0).should("have.class", "invalid").find("input").first().should("have.css", "border-color").and("not.eq", "rgb(0, 0, 0)");
    roundPanel("Round 3").find("tbody tr").eq(1).should("have.class", "is-warning");

    fillMatch(3, 1, { table: "1", player1: "Alice", score1: 2, score2: 0, player2: "Uma" });
    fillMatch(3, 2, { table: "2", player1: "Bob", score1: 2, score2: 0, player2: "Chloe" });
    fillMatch(3, 3, { table: "3", player1: "Hugo", score1: 2, score2: 0, player2: "Diego" });
    fillMatch(3, 4, { table: "4", player1: "Emma", score1: 1, score2: 2, player2: "Kai" });
    cy.get('[data-cy="dismiss-round-import-archetype-conflict"]').click();
    cy.get('[data-cy="round-import-archetype-conflict"]').should("not.exist");
    cy.contains("game wins cannot be over 2").should("not.exist");
    cy.contains("Warnings:").should("not.exist");

    addRound();
    addMatchWithForm("Round 4", 4, 1, { table: "1", player1: "Alice", score1: 2, score2: 0, player2: "Priya" });
    addMatchWithForm("Round 4", 4, 2, { table: "2", player1: "Bob", score1: 2, score2: 1, player2: "Rosa" });
    addMatchWithForm("Round 4", 4, 3, { table: "3", player1: "Diego", score1: 0, score2: 2, player2: "Sam" });
    cy.contains("Warnings:").should("not.exist");
    cy.get('[data-cy="ranking-table"] tbody tr').should("have.length", 21);
    expectRankingRow("Alice", { points: 12, record: "4-0-0" });
    saveTournamentDraft();

    returnToLeagueFromTournament();
    cy.contains("h1 button", "Renamed Local League").should("be.visible");
    expectRankingRow("Alice", { points: 12, record: "4-0-0" });
    cy.contains("a", "Spring Archived Tournament").should("be.visible").click();
    cy.contains("h1 button", "Spring Archived Tournament").should("be.visible");
    cy.get('input[type="date"]').should("have.value", "2026-06-20");
    cy.get('[data-cy="round-entry-table"] tbody tr').should("have.length.at.least", 4);
    expectRankingRow("Alice", { points: 12, record: "4-0-0" });

    returnToLeagueFromTournament();
    createTournamentFromLeague();
    returnToLeagueFromTournament();
    cy.get('[data-cy="tournament-card-grid"] a').should("have.length", 2);
    cy.contains('[data-cy="tournament-card-grid"] a', "Spring Archived Tournament").should("be.visible");

    returnToLeagueListFromLeague();
    createLeague("Second Local League");
    returnToLeagueListFromLeague();
    createLeague("Third Local League");
    returnToLeagueListFromLeague();
    leagueCard("Renamed Local League").should("be.visible");
    leagueCard("Second Local League").should("be.visible");
    leagueCard("Third Local League").should("be.visible");
  });
});
