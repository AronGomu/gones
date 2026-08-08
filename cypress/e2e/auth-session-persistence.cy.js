const email = 'cypress.user@example.test';
const password = 'Cypress-pass-123!';

function login() {
  cy.visit('/login');
  cy.get('[data-cy="auth-email"]').type(email);
  cy.get('[data-cy="auth-password"]').type(password, { log: false });
  cy.get('[data-cy="auth-submit"]').click();
  cy.location('pathname').should('eq', '/profile');
}

describe('session persistence across a reload', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('keeps the user signed in after a full page reload', () => {
    login();
    cy.get('[data-cy="profile-link"]').should('be.visible');
    cy.get('[data-cy="login-link"]').should('not.exist');

    // The access token only ever lives in memory, so surviving a reload can only come from the
    // refresh cookie being stored by the browser and replayed by the startup bootstrap.
    cy.intercept('POST', '**/api/auth/refresh').as('bootstrapRefresh');
    cy.reload();
    cy.wait('@bootstrapRefresh').its('response.statusCode').should('eq', 200);

    cy.get('[data-cy="profile-link"]').should('be.visible').and('contain.text', 'cypress-user');
    cy.get('[data-cy="login-link"]').should('not.exist');
    cy.window().then((win) => {
      const storage = `${JSON.stringify(win.localStorage)} ${JSON.stringify(win.sessionStorage)}`;
      expect(storage.toLowerCase()).not.to.contain('accesstoken');
    });
  });

  it('leaves anonymous browsing untouched when there is no session cookie', () => {
    cy.visit('/');
    cy.get('[data-cy="login-link"]').should('be.visible');
    cy.get('[data-cy="profile-link"]').should('not.exist');
  });
});
