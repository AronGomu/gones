describe("Gones Angular MVP", () => {
  it("opens the Angular League collection in demo mode", () => {
    cy.visit("/leagues");
    cy.contains("h1", "Leagues");
    cy.contains("Demo mode: configure Supabase");
    cy.contains("Demo League").click();
    cy.location("pathname").should("eq", "/leagues/demo-league");
    cy.contains("League Ranking");
    cy.contains("Empty League has no League Result");
  });

  it("shows Visitor permissions without edit controls", () => {
    cy.visit("/leagues/demo-league");
    cy.contains("Edit source data").should("not.exist");
    cy.contains("League Export").should("exist");
  });

  it("shows Player Statistics route", () => {
    cy.visit("/players/Alice");
    cy.contains("h1", "Alice");
    cy.contains("Played Matches");
    cy.contains("No Matches.");
  });
});
