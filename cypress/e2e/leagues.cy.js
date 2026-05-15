describe("Leagues", () => {
  beforeEach(() => {
    cy.clearLocalStorage();
  });

  it("creates a League from the Leagues page", () => {
    cy.visit("/page/leagues.html");

    cy.get("[data-cy='create-league']").click();

    cy.location("pathname").should("include", "/page/edit_league.html");
    cy.location("search").should("include", "id=");
    cy.get("[data-cy='league-title']").should("contain", "New League");
  });
});
