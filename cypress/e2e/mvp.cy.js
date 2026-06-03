describe("Gones Angular MVP", () => {
  it("opens the Angular League collection in demo mode", () => {
    cy.visit("/leagues");
    cy.contains("h1", "Leagues");
    cy.contains(".app-toolbar", "Import").should("exist");
    cy.contains("Frontend-only mode");
    cy.contains("Demo League").click({ force: true });
    cy.location("pathname").should("eq", "/leagues/demo-league");
    cy.contains("League Ranking");
    cy.contains("Empty League has no League Result");
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

  it("shows frontend-only edit controls without login", () => {
    cy.visit("/leagues/demo-league");
    cy.contains("Edit source data").should("exist");
    cy.contains("League Export").should("exist");
  });

  it("shows Player Statistics route", () => {
    cy.visit("/players/Alice");
    cy.contains("h1", "Alice");
    cy.contains("Played Matches");
    cy.contains("No Matches.");
  });
});
