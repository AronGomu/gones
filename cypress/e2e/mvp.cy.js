describe("Gones MVP", () => {
  beforeEach(() => {
    cy.clearLocalStorage();
  });

  it("opens the new Leagues page and navigates to a new League", () => {
    cy.visit("/app/pages/leagues.html");

    cy.get("[data-cy='league-name-input']").type("Spring League");
    cy.get("[data-cy='create-league']").click();

    cy.location("pathname").should("include", "/app/pages/league.html");
    cy.get("[data-cy='league-title']").should("contain", "Spring League");
    cy.get("[data-cy='empty-ranking']").should("contain", "Empty League");
  });

  it("creates a Tournament, imports a Round, shows results, and opens Player Statistics", () => {
    cy.visit("/app/pages/leagues.html");
    cy.get("[data-cy='league-name-input']").type("Spring League");
    cy.get("[data-cy='create-league']").click();

    cy.get("[data-cy='league-start-date']").type("2026-01-01");
    cy.get("[data-cy='league-end-date']").type("2026-06-30").blur();
    cy.get("[data-cy='tournament-name-input']").type("Week One");
    cy.get("[data-cy='create-tournament']").click();

    cy.location("pathname").should("include", "/app/pages/tournament.html");
    cy.get("[data-cy='tournament-state']").should("contain", "Incomplete");
    cy.get("[data-cy='add-round']").click();
    cy.get("[data-cy='round-import']").type("player_1,player_2,player_1_score,player_2_score\nAlice,Bob,2,0\nCara,bye,0,0", {
      parseSpecialCharSequences: false
    });
    cy.get("[data-cy='import-round']").click();

    cy.get("[data-cy='ranking-row']").first().should("contain", "Alice");
    cy.get("[data-cy='ranking-row']").should("contain", "Cara");
    cy.get("[data-cy='ranking-player']").contains("Alice").click();

    cy.location("pathname").should("include", "/app/pages/player.html");
    cy.location("search").should("include", "playerName=Alice");
    cy.get("[data-cy='player-title']").should("contain", "Alice");
    cy.get("[data-cy='player-match-list']").should("contain", "Bob");
  });

  it("supports manual entry editing, invalid rows, warnings, and deletion", () => {
    cy.visit("/app/pages/leagues.html");
    cy.get("[data-cy='league-name-input']").type("Manual League");
    cy.get("[data-cy='create-league']").click();
    cy.get("[data-cy='tournament-name-input']").type("Manual Event");
    cy.get("[data-cy='create-tournament']").click();

    cy.get("[data-cy='add-round']").click();
    cy.get("[data-cy='add-match']").click();
    cy.get("[data-cy='round-entry']").within(() => {
      cy.get("[data-field='player1Name']").type("Alice");
      cy.get("[data-field='player2Name']").type("Alice");
      cy.get("[data-field='player1Score']").clear().type("2");
      cy.get("[data-field='player2Score']").clear().type("2");
    });
    cy.reload();
    cy.get("[data-cy='entry-status']").should("contain", "same Player Name").and("contain", "draw must");
    cy.get("[data-cy='empty-ranking']").should("contain", "No valid");

    cy.get("[data-cy='delete-entry']").click();
    cy.get("[data-cy='round-entry']").should("not.exist");
    cy.get("[data-cy='delete-round']").click();
    cy.get("[data-cy='round']").should("not.exist");
  });
});
