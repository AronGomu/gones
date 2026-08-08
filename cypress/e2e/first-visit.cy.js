describe('first-visit About redirect', () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.clearLocalStorage();
  });

  it('sends the very first visit to /about, then keeps later visits on the menu', () => {
    cy.visit('/');
    cy.location('pathname').should('eq', '/about');

    cy.visit('/');
    cy.location('pathname').should('eq', '/');
    cy.get('[data-cy="menu-about-link"]').should('be.visible');
  });
});
