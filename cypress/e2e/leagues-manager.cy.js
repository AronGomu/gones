const STORE_KEY = "gones.frontend.backend.v1";

const emptyStore = { version: 1, leagues: [] };

function visitEmptyLeagues() {
  cy.visit("/leagues", {
    onBeforeLoad(win) {
      win.localStorage.setItem(STORE_KEY, JSON.stringify(emptyStore));
    }
  });
}

function createLeague(name) {
  cy.get('[data-cy="create-league-card"]').click();
  cy.get("mat-dialog-container input").type(name);
  cy.contains("mat-dialog-container button", "Create League").click();
  cy.contains("h1 button", name).should("be.visible");
}

function renameLeague(fromName, toName) {
  cy.contains("h1 button", fromName).click();
  cy.get('[data-cy="league-name-input"]').should("be.focused").clear().type(`${toName}{enter}`);
  cy.contains("h1 button", toName).should("be.visible");
}

function renameTournament(toName) {
  cy.get('[data-cy="tournament-name-input"]').should("not.exist");
  cy.get("h1 button.editable-title").click();
  cy.get('[data-cy="tournament-name-input"]').should("be.focused").clear().type(`${toName}{enter}`);
  cy.contains("h1 button", toName).should("be.visible");
}

function saveTournamentDraft() {
  cy.get("body").trigger("keydown", { key: "s", code: "KeyS", ctrlKey: true, force: true });
  cy.get("h1 button.editable-title").should("be.visible");
}

function addRound() {
  cy.contains("button", "Add Round").click();
}

function roundPanel(roundName) {
  return cy.contains("mat-expansion-panel", roundName);
}

function expandRound(roundName) {
  roundPanel(roundName).find("mat-expansion-panel-header").then(($header) => {
    if ($header.attr("aria-expanded") !== "true") cy.wrap($header).click();
  });
  roundPanel(roundName).find(".mat-expansion-panel-body").should("be.visible");
}

function addMatchWithForm(roundName, roundNumber, entryNumber, match) {
  expandRound(roundName);
  roundPanel(roundName).within(() => {
    cy.contains("button", "Add Match").click();
    cy.get(`input[aria-label="Round ${roundNumber}, entry ${entryNumber}: table"]`).clear().type(match.table);
    cy.get(`input[aria-label="Round ${roundNumber}, entry ${entryNumber}: player 1"]`).clear().type(match.player1);
    cy.get(`input[aria-label="Round ${roundNumber}, entry ${entryNumber}: player 1 wins"]`).clear().type(String(match.score1));
    cy.get(`input[aria-label="Round ${roundNumber}, entry ${entryNumber}: player 1 losses"]`).clear().type(String(match.score2));
    cy.get(`input[aria-label="Round ${roundNumber}, entry ${entryNumber}: player 2"]`).clear().type(match.player2);
  });
}

function importRound(roundName, csv) {
  expandRound(roundName);
  roundPanel(roundName).within(() => {
    cy.get('[data-cy="round-import-input"]').clear().type(csv, { force: true, delay: 0 });
    cy.contains("button", "Import").click();
    cy.get(".round-entry-table tbody tr").should("have.length", csv.trim().split("\n").length);
  });
}

function expectRankingRow(index, { rank, player, points, record, omw, gw, ogw }) {
  cy.get('[data-cy="ranking-table"] tbody tr').eq(index).within(() => {
    cy.get("td").eq(0).should("have.text", String(rank));
    cy.get("td").eq(1).should("contain", player);
    cy.get("td").eq(2).should("have.text", String(points));
    cy.get("td").eq(3).invoke("text").then((text) => expect(text.replace(/\s+/g, " ").trim()).to.eq(record));
    cy.get("td").eq(4).should("have.text", omw);
    cy.get("td").eq(5).should("have.text", gw);
    cy.get("td").eq(6).should("have.text", ogw);
  });
}

function deleteVisibleRound(roundName) {
  roundPanel(roundName).within(() => {
    cy.get('button[aria-label="Round actions"]').click();
  });
  cy.contains("button", "Delete Round").click({ force: true });
  cy.contains("mat-dialog-container button", "Delete Round").click();
  cy.contains("mat-expansion-panel", roundName).should("not.exist");
}

describe("League and Tournament lifecycle", () => {
  it.skip("creates, renames, scores, imports, verifies standings, clears rounds, and deletes the Tournament", () => {
    visitEmptyLeagues();
    cy.contains("h1", "Leagues");
    cy.contains("No public Leagues match this view.").should("be.visible");

    createLeague("Lifecycle League");
    renameLeague("Lifecycle League", "Renamed Lifecycle League");

    cy.get('[data-cy="create-tournament-card"]').click();
    cy.location("pathname").should("match", /\/leagues\/[^/]+\/tournaments\/[^/]+$/);
    renameTournament("Renamed Lifecycle Tournament");

    addRound();
    addMatchWithForm("Round 1", 1, 1, { table: "1", player1: "Alice", score1: 2, score2: 0, player2: "Bob" });
    addMatchWithForm("Round 1", 1, 2, { table: "2", player1: "Carol", score1: 2, score2: 1, player2: "Dave" });

    addRound();
    importRound("Round 2", "1,Alice,Won 2-1,Carol,Fire,Earth\n2,Bob,Won 2-0,Dave,Water,Air");

    addRound();
    importRound("Round 3", "1,Alice,Lost 1-2,Dave,Fire,Air\n2,Bob,Won 2-1,Carol,Water,Earth");

    addRound();
    importRound("Round 4", "1,Alice,Draw 1-1,Bob,Fire,Water\n2,Carol,Won 2-0,Dave,Earth,Air");

    cy.get('[data-cy="ranking-table"] tbody tr').should("have.length", 4);
    expectRankingRow(0, { rank: 1, player: "Alice", points: 7, record: "2-1-1", omw: "50%", gw: "60%", ogw: "50%" });
    expectRankingRow(1, { rank: 2, player: "Bob", points: 7, record: "2-1-1", omw: "50%", gw: "56%", ogw: "52%" });
    expectRankingRow(2, { rank: 3, player: "Carol", points: 6, record: "2-2-0", omw: "46%", gw: "55%", ogw: "46%" });
    expectRankingRow(3, { rank: 4, player: "Dave", points: 3, record: "1-3-0", omw: "54%", gw: "30%", ogw: "56%" });
    saveTournamentDraft();

    deleteVisibleRound("Round 4");
    deleteVisibleRound("Round 3");
    deleteVisibleRound("Round 2");
    deleteVisibleRound("Round 1");
    cy.contains("mat-expansion-panel", /^Round /).should("not.exist");
    cy.get('[data-cy="empty-ranking"]').should("contain", "No valid Round Entries yet");
    saveTournamentDraft();

    cy.contains(".back-button", "Back to League").first().click();
    cy.location("pathname").should("match", /\/leagues\/[^/]+$/);
    cy.contains("h1 button", "Renamed Lifecycle League").should("be.visible");
    cy.contains("a", "Renamed Lifecycle Tournament").click();
    cy.location("pathname").should("match", /\/leagues\/[^/]+\/tournaments\/[^/]+$/);
    cy.get('button[aria-label="Tournament actions"]').click();
    cy.contains("button", "Delete Tournament").click({ force: true });
    cy.contains("mat-dialog-container button", "Delete Tournament").click();
    cy.location("pathname").should("match", /\/leagues\/[^/]+$/);
    cy.contains("h1 button", "Renamed Lifecycle League").should("be.visible");
    cy.contains("No Tournaments yet.").should("be.visible");
    cy.contains("Renamed Lifecycle Tournament").should("not.exist");
  });
});
