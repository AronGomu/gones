describe("Gones Angular MVP", () => {
  it("opens the main menu from the home page", () => {
    cy.visit("/");
    cy.contains("h1", "Magic nights, recorded like they matter.");
    cy.contains("button", "Login").should("be.disabled");
    cy.get('[data-cy="menu-leagues-link"]').should("have.attr", "href", "/leagues").click();
    cy.location("pathname").should("eq", "/leagues");
    cy.contains("h1", "Leagues");
    cy.visit("/");
    cy.get('[data-cy="menu-settings-link"]').should("have.attr", "href", "/settings").click();
    cy.location("pathname").should("eq", "/settings");
    cy.contains("h1", "Set the app language.");
  });

  it("opens the Angular League collection in demo mode", () => {
    cy.visit("/leagues");
    cy.contains("h1", "Leagues");
    cy.contains(".app-toolbar", "Import").should("exist");
    cy.contains(".back-button", "Back").should("not.exist");
    cy.contains("Demo League").click({ force: true });
    cy.location("pathname").should("eq", "/leagues/demo-league");
    cy.get(".back-button").should("have.length", 2);
    cy.contains("League Ranking");
    cy.get('[data-cy="ranking-table-toggle"]').should("be.visible").and("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking").click();
    cy.get('[data-cy="empty-ranking"]').should("not.be.visible");
    cy.get('[data-cy="ranking-table-toggle"]').should("contain", "▸").and("have.attr", "aria-label", "Expand Ranking").click();
    cy.contains("Empty League has no League Result");
    cy.get(".back-button").first().click();
    cy.location("pathname").should("eq", "/leagues");
  });

  it("imports a League from the header", () => {
    cy.visit("/leagues");
    cy.contains("button", "Sign in locally").should("not.exist");
    cy.contains(".app-toolbar", "Import").should("exist");
    cy.get('[data-cy="header-import-input"]').selectFile({
      contents: Cypress.Buffer.from(JSON.stringify({
        kind: "league",
        gonesDataVersion: 2,
        gonesAppVersion: "test",
        exportedAt: "2026-05-29T00:00:00.000Z",
        league: { id: "source-league", name: "Imported League", status: "active", tournaments: [] }
      })),
      fileName: "imported-league.gones.json",
      mimeType: "application/json"
    }, { force: true });
    cy.location("pathname").should("match", /\/leagues\/.+/);
    cy.contains("h1", "Imported League");
  });

  it("turns League and Tournament titles into live name inputs", () => {
    cy.visit("/leagues/title-league/tournaments/title-tournament", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({
          version: 1,
          leagues: [{
            id: "title-league",
            name: "Title League",
            status: "active",
            documentVersion: 1,
            updatedAt: "2026-06-03T00:00:00.000Z",
            tournaments: [{ id: "title-tournament", leagueId: "title-league", name: "Title Tournament", tournamentDate: "", rounds: [] }]
          }, {
            id: "completed-title-league",
            name: "Completed Title League",
            status: "completed",
            documentVersion: 1,
            updatedAt: "2026-06-03T00:00:00.000Z",
            tournaments: [{ id: "completed-title-tournament", leagueId: "completed-title-league", name: "Completed Tournament", tournamentDate: "", rounds: [] }]
          }]
        }));
      }
    });
    cy.contains("button", "Edit source data").should("not.exist");
    cy.contains("h1 button", "Title Tournament").click();
    cy.get('[data-cy="tournament-name-input"]').should("be.focused").clear();
    cy.get('[data-cy="tournament-name-input"]').type("Updated Tournament{enter}");
    cy.contains("h1 button", "Updated Tournament");

    cy.visit("/leagues/completed-title-league/tournaments/completed-title-tournament");
    cy.contains("button", "Edit source data").should("not.exist");
    cy.contains("h1 button", "Completed Tournament").click();
    cy.get('[data-cy="tournament-name-input"]').should("be.focused").clear();
    cy.get('[data-cy="tournament-name-input"]').type("Renamed Completed Tournament{enter}");
    cy.contains("h1 button", "Renamed Completed Tournament");
    cy.contains("Add Round").should("exist").click();
    cy.document().trigger("keydown", { key: "s", ctrlKey: true });
    cy.contains("h1 button", "Renamed Completed Tournament");

    cy.visit("/leagues/title-league");
    cy.contains("h1 button", "Title League").click();
    cy.get('[data-cy="league-name-input"]').should("be.focused").clear().type("Updated League{enter}");
    cy.contains("h1 button", "Updated League");
    cy.get('[data-cy="league-name-input"]').should("not.exist");
    cy.reload();
    cy.contains("h1 button", "Updated League");
  });

  it("always shows a Ranking toggle for League and Tournament standings", () => {
    const league = {
      id: "ranking-toggle-league",
      name: "Ranking Toggle League",
      status: "active",
      documentVersion: 1,
      updatedAt: "2026-06-03T00:00:00.000Z",
      tournaments: [{
        id: "ranking-toggle-tournament",
        leagueId: "ranking-toggle-league",
        name: "Ranking Toggle Tournament",
        tournamentDate: "2026-06-03",
        rounds: [{
          id: "round-1",
          entries: [{
            kind: "match",
            id: "match-1",
            table: "1",
            player1Name: "Alice",
            player2Name: "Bob",
            player1Score: 2,
            player2Score: 0,
            player1DeckArchetype: "Fire",
            player2DeckArchetype: "Ice"
          }]
        }]
      }]
    };

    cy.visit("/leagues/ranking-toggle-league", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({ version: 1, leagues: [league] }));
      }
    });
    cy.get('[data-cy="ranking-table-toggle"]').should("be.visible").and("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking").click();
    cy.get('[data-cy="ranking-table-toggle"]').should("contain", "▸").and("have.attr", "aria-label", "Expand Ranking").and("have.attr", "aria-expanded", "false");
    cy.get('[data-cy="ranking-table"]').should("not.be.visible");
    cy.get('[data-cy="ranking-table-toggle"]').click().should("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking");
    cy.get('[data-cy="ranking-table"]').should("be.visible");
    cy.contains('[data-cy="ranking-table"] tr', "Alice").should("have.attr", "role", "link").click();
    cy.location("pathname").should("eq", "/players/Alice");

    cy.visit("/leagues/ranking-toggle-league/tournaments/ranking-toggle-tournament");
    cy.get('[data-cy="ranking-table-toggle"]').should("be.visible").and("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking").click();
    cy.get('[data-cy="ranking-table-toggle"]').should("contain", "▸").and("have.attr", "aria-label", "Expand Ranking").and("have.attr", "aria-expanded", "false");
    cy.get('[data-cy="ranking-table-toggle"]').click().should("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking");
    cy.get('[data-cy="ranking-table"]').should("be.visible");
  });

  it("shows Tournaments as clickable responsive cards", () => {
    cy.visit("/leagues/table-league", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({
          version: 1,
          leagues: [{
            id: "table-league",
            name: "Table League",
            status: "active",
            documentVersion: 1,
            updatedAt: "2026-06-03T00:00:00.000Z",
            tournaments: [
              { id: "table-tournament-1", leagueId: "table-league", name: "First Table Tournament", tournamentDate: "2026-06-01", rounds: [] },
              { id: "table-tournament-2", leagueId: "table-league", name: "Second Table Tournament", tournamentDate: "2026-06-02", rounds: [] }
            ]
          }]
        }));
      }
    });
    cy.get('[data-cy="tournament-card-grid"]').within(() => {
      cy.contains("a", "Second Table Tournament").should("contain", "2026").and("have.attr", "href", "/leagues/table-league/tournaments/table-tournament-2").click();
    });
    cy.location("pathname").should("eq", "/leagues/table-league/tournaments/table-tournament-2");
  });

  it("shows read-only League controls without login", () => {
    cy.visit("/leagues/demo-league");
    cy.contains("Edit source data").should("not.exist");
    cy.get('[data-cy="league-name-input"]').should("not.exist");
    cy.contains("Export League").should("exist");
  });

  it("opens Tournament source data as editable and imports headerless CSV rows", () => {
    cy.visit("/leagues/editable-tournament-league/tournaments/editable-tournament", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({
          version: 1,
          leagues: [{
            id: "editable-tournament-league",
            name: "Editable Tournament League",
            status: "completed",
            documentVersion: 1,
            updatedAt: "2026-06-03T00:00:00.000Z",
            tournaments: [{ id: "editable-tournament", leagueId: "editable-tournament-league", name: "Editable Tournament", tournamentDate: "", rounds: [{ id: "round-1", entries: [] }] }]
          }]
        }));
      }
    });
    cy.contains("button", "Edit source data").should("not.exist");
    cy.contains("mat-expansion-panel", "Round 1").find("mat-expansion-panel-header").click();
    cy.contains("Round Import").should("exist");
    cy.get('[data-cy="round-import-input"]').should("have.attr", "placeholder", "table number, player name, result, opponent name, player deck archetype, opponent deck archetype\n7,Alice,Won 2-1,Bob,Fire,Ice\n8,Charlie,Lost 1-2,Dana,Water,Earth\n9,Eve,Draw 1-1,Frank,Air,Metal").type("7,Alice,Won 2-1,Bob,Fire,Ice", { force: true });
    cy.contains("button", "Import").click();
    cy.get('input[aria-label="Round 1, entry 1: player 1"]').should("have.value", "Alice").clear().type("Alicia");
    cy.document().trigger("keydown", { key: "s", ctrlKey: true });
    cy.get('input[aria-label="Round 1, entry 1: player 1"]').should("have.value", "Alicia");
  });

  it("shows editable Player Archetype inputs tied to players while Round panels stay collapsed", () => {
    cy.visit("/leagues/archetype-panel-league/tournaments/archetype-panel-tournament", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({
          version: 1,
          leagues: [{
            id: "archetype-panel-league",
            name: "Archetype Panel League",
            status: "completed",
            documentVersion: 1,
            updatedAt: "2026-06-03T00:00:00.000Z",
            tournaments: [{
              id: "archetype-panel-tournament",
              leagueId: "archetype-panel-league",
              name: "Archetype Panel Tournament",
              tournamentDate: "",
              playerArchetypes: [],
              rounds: [{
                id: "round-1",
                entries: [{ kind: "match", id: "match-1", table: "7", player1Name: "Alice", player2Name: "Bob", player1Score: 2, player2Score: 1, player1DeckArchetype: "Fire", player2DeckArchetype: "Ice" }]
              }]
            }]
          }]
        }));
      }
    });

    cy.contains("mat-expansion-panel", "Round 1").should("contain", "1 entries");
    cy.get('[data-cy="player-archetype-panel"]').should("contain", "2 players").find("mat-expansion-panel-header").click();
    cy.contains('[data-cy="player-archetype-row"]', "Alice").within(() => {
      cy.get('input[aria-label="Deck archetype for Alice"]').should("be.visible").and("have.value", "Fire").clear().type("Phoenix");
    });
    cy.contains('[data-cy="player-archetype-row"]', "Bob").within(() => {
      cy.get('input[aria-label="Deck archetype for Bob"]').should("be.visible").and("have.value", "Ice");
    });
    cy.document().trigger("keydown", { key: "s", ctrlKey: true });
    cy.reload();
    cy.get('[data-cy="player-archetype-panel"]').find("mat-expansion-panel-header").click();
    cy.get('input[aria-label="Deck archetype for Alice"]').should("have.value", "Phoenix");
  });

  it("opens a Tournament Result page that fits in one full-HD viewport", () => {
    cy.viewport(1920, 1080);
    cy.visit("/leagues/result-page-league/tournaments/result-page-tournament", {
      onBeforeLoad(win) {
        win.localStorage.setItem("gones.frontend.backend.v1", JSON.stringify({
          version: 1,
          leagues: [{
            id: "result-page-league",
            name: "Result Page League",
            status: "completed",
            documentVersion: 1,
            updatedAt: "2026-06-03T00:00:00.000Z",
            tournaments: [{
              id: "result-page-tournament",
              leagueId: "result-page-league",
              name: "Result Page Tournament",
              tournamentDate: "2026-06-10",
              rounds: [{
                id: "round-1",
                entries: [
                  { kind: "match", id: "match-1", table: "1", player1Name: "Alice", player2Name: "Bob", player1Score: 2, player2Score: 0, player1DeckArchetype: "Fire", player2DeckArchetype: "Ice" },
                  { kind: "match", id: "match-2", table: "2", player1Name: "Charlie", player2Name: "Dana", player1Score: 2, player2Score: 1, player1DeckArchetype: "Fire", player2DeckArchetype: "Earth" },
                  { kind: "match", id: "match-3", table: "3", player1Name: "Eve", player2Name: "Frank", player1Score: 2, player2Score: 0, player1DeckArchetype: "Ice", player2DeckArchetype: "Water" },
                  { kind: "match", id: "match-4", table: "4", player1Name: "Grace", player2Name: "Heidi", player1Score: 1, player2Score: 2, player1DeckArchetype: "Air", player2DeckArchetype: "Fire" }
                ]
              }]
            }]
          }]
        }));
      }
    });

    cy.contains("a", "View Result").should("have.attr", "href", "/leagues/result-page-league/tournaments/result-page-tournament/result").click();
    cy.location("pathname").should("eq", "/leagues/result-page-league/tournaments/result-page-tournament/result");
    cy.get('[data-cy="tournament-result-page"]').should("contain", "Result Page League").and("contain", "Result Page Tournament").and("contain", "Rounds").and("contain", "Matches").and("contain", "Alice").and("not.contain", "Final Results");
    cy.contains("a", "See Archetype Share").click();
    cy.location("pathname").should("eq", "/leagues/result-page-league/tournaments/result-page-tournament/result/metagames");
    cy.get('[data-cy="tournament-result-page"]').should("contain", "Metagame").and("contain", "Fire");
    cy.document().should((doc) => {
      expect(doc.documentElement.scrollHeight, "page height").to.be.at.most(doc.defaultView.innerHeight);
    });
  });

  it("shows Player Statistics route with history back buttons", () => {
    cy.visit("/leagues");
    cy.visit("/players/Alice");
    cy.contains("h1", "Alice");
    cy.get("button.back-button").should("have.length", 2);
    cy.contains("Played Matches");
    cy.contains("No Matches.");
    cy.get("button.back-button").first().click();
    cy.location("pathname").should("eq", "/leagues");
  });
});
