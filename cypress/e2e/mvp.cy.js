describe("Gones Angular MVP", () => {
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
    cy.get('[data-cy="tournament-name-input"]').clear().type("Updated Tournament");
    cy.contains("button", "Save").click();
    cy.get('[data-cy="tournament-name-input"]').should("have.value", "Updated Tournament");

    cy.visit("/leagues/completed-title-league/tournaments/completed-title-tournament");
    cy.contains("button", "Edit source data").should("not.exist");
    cy.get('[data-cy="tournament-name-input"]').clear().type("Renamed Completed Tournament");
    cy.contains("Add Round").should("exist").click();
    cy.contains("button", "Save").click();
    cy.get('[data-cy="tournament-name-input"]').should("have.value", "Renamed Completed Tournament");

    cy.visit("/leagues/title-league");
    cy.contains("h1 button", "Title League").click();
    cy.contains("Unsaved draft").should("not.exist");
    cy.get('[data-cy="league-name-input"]').should("be.focused").clear().type("Updated League").blur();
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

    cy.visit("/leagues/ranking-toggle-league/tournaments/ranking-toggle-tournament");
    cy.get('[data-cy="ranking-table-toggle"]').should("be.visible").and("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking").click();
    cy.get('[data-cy="ranking-table-toggle"]').should("contain", "▸").and("have.attr", "aria-label", "Expand Ranking").and("have.attr", "aria-expanded", "false");
    cy.get('[data-cy="ranking-table-toggle"]').click().should("contain", "▾").and("have.attr", "aria-label", "Collapse Ranking");
    cy.get('[data-cy="ranking-table"]').should("be.visible");
  });

  it("shows frontend-only edit controls without login", () => {
    cy.visit("/leagues/demo-league");
    cy.contains("Edit source data").should("exist");
    cy.contains("League Export").should("exist");
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
    cy.contains("Round Import").should("exist");
    cy.get('textarea[placeholder="Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist"]').type("7,Alice,Won 2-1,Bob,Fire,Ice", { force: true });
    cy.contains("button", "Import").click();
    cy.get('input[aria-label="Player 1"]').should("have.value", "Alice").clear().type("Alicia");
    cy.contains("button", "Save").click();
    cy.get('input[aria-label="Player 1"]').should("have.value", "Alicia");
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
