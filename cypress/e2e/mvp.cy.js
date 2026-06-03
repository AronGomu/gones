describe("Gones Angular MVP", () => {
  it("opens the Angular League collection in demo mode", () => {
    cy.visit("/leagues");
    cy.contains("h1", "Leagues");
    cy.contains(".app-toolbar", "Import").should("exist");
    cy.contains(".back-button", "Back").should("not.exist");
    cy.contains("Frontend-only mode");
    cy.contains("Demo League").click({ force: true });
    cy.location("pathname").should("eq", "/leagues/demo-league");
    cy.get(".back-button").should("have.length", 2);
    cy.contains("League Ranking");
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
    cy.contains("h1 button", "Title Tournament").click();
    cy.contains("Unsaved tournament draft").should("not.exist");
    cy.get('[data-cy="tournament-name-input"]').should("be.focused").clear().type("Updated Tournament{enter}");
    cy.contains("h1 button", "Updated Tournament");

    cy.visit("/leagues/completed-title-league/tournaments/completed-title-tournament");
    cy.contains("button", "Edit source data").should("be.disabled");
    cy.contains("h1 button", "Completed Tournament").click();
    cy.get('[data-cy="tournament-name-input"]').should("be.focused").clear().type("Renamed Completed Tournament").blur();
    cy.contains("Add Round").should("not.exist");
    cy.contains("h1 button", "Renamed Completed Tournament");

    cy.visit("/leagues/title-league");
    cy.contains("h1 button", "Title League").click();
    cy.contains("Unsaved draft").should("not.exist");
    cy.get('[data-cy="league-name-input"]').should("be.focused").clear().type("Updated League").blur();
    cy.contains("h1 button", "Updated League");
  });

  it("shows frontend-only edit controls without login", () => {
    cy.visit("/leagues/demo-league");
    cy.contains("Edit source data").should("exist");
    cy.contains("League Export").should("exist");
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
