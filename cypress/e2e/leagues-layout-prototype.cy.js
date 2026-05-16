describe("Leagues layout prototype", () => {
  it("prioritizes the last active league above the regular card grid", () => {
    cy.visit("/app/pages/leagues-layout-prototype.html");

    cy.contains("Last consulted league").should("be.visible");
    cy.get("[data-cy='featured-league-card']").should("contain", "Tuesday Legacy");
    cy.get("[data-cy='featured-league-card']").should("contain", "18");
    cy.get("[data-cy='featured-league-card']").should("contain", "74");
    cy.get("[data-cy='league-card']").should("have.length", 4);
  });

  it("uses three regular league cards per row on full HD width", () => {
    cy.viewport(1920, 1080);
    cy.visit("/app/pages/leagues-layout-prototype.html");

    cy.get("[data-cy='league-card']").then((cards) => {
      const firstTop = cards[0].getBoundingClientRect().top;
      const cardsInFirstRow = [...cards].filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2);

      expect(cardsInFirstRow).to.have.length(3);
    });
  });

  it("collapses the regular league cards to one column on mobile", () => {
    cy.viewport(390, 844);
    cy.visit("/app/pages/leagues-layout-prototype.html");

    cy.get("[data-cy='league-card']").then((cards) => {
      const first = cards[0].getBoundingClientRect();
      const second = cards[1].getBoundingClientRect();

      expect(second.top).to.be.greaterThan(first.bottom);
      expect(Math.abs(second.left - first.left)).to.be.lessThan(2);
    });
  });
});
