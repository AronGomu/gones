const REFRESH_OK = {
  accessToken: 'test-token',
  expiresAt: '2099-12-31T23:59:59Z',
  tokenType: 'Bearer'
};

const PROFILE = {
  id: 'user-1',
  email: 'test@example.com',
  emailVerified: true,
  globalRole: 'User',
  username: 'testuser',
  firstName: 'Test',
  lastName: 'User'
};

function stubSignedOut() {
  cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } });
}

function stubSignedIn() {
  cy.intercept('POST', '**/api/auth/refresh', REFRESH_OK);
  cy.intercept('GET', '**/api/users/me', PROFILE);
}

function assertHuggingRight(selector) {
  cy.get('[data-cy="app-toolbar"]').then($bar => {
    const bar = $bar[0].getBoundingClientRect();
    const padding = parseFloat(getComputedStyle($bar[0]).paddingRight);
    cy.get(selector).then($el => {
      expect($el[0].getBoundingClientRect().right).to.be.closeTo(bar.right - padding, 2);
    });
  });
}

describe('Header session-actions alignment', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
  });

  it('signed out, 700px, page without header actions', () => {
    cy.viewport(700, 800);
    stubSignedOut();
    cy.visit('/');
    assertHuggingRight('[data-cy="auth-toolbar-actions"]');
  });

  it('signed out, 375px', () => {
    cy.viewport(375, 812);
    stubSignedOut();
    cy.visit('/');
    assertHuggingRight('[data-cy="auth-toolbar-actions"]');
  });

  it('signed out, 1280px', () => {
    cy.viewport(1280, 800);
    stubSignedOut();
    cy.visit('/');
    assertHuggingRight('[data-cy="auth-toolbar-actions"]');
  });

  it('signed in, 700px', () => {
    cy.viewport(700, 800);
    stubSignedIn();
    cy.visit('/');
    cy.get('[data-cy="logout-button"]').should('exist');
    assertHuggingRight('[data-cy="auth-toolbar-actions"]');
  });

  it('signed out, 700px, page with header actions', () => {
    cy.viewport(700, 800);
    stubSignedOut();
    cy.visit('/settings');
    cy.get('[data-cy="app-settings-header-actions"]').should('exist');
    assertHuggingRight('[data-cy="auth-toolbar-actions"]');
  });
});
