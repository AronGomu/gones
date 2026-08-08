const email = 'cypress.user@example.test';
const password = 'Cypress-pass-123!';

function login() {
  cy.visit('/login?returnUrl=%2Fsettings%2Faccount');
  cy.get('[data-cy="auth-email"]').type(email);
  cy.get('[data-cy="auth-password"]').type(password, { log: false });
  cy.get('[data-cy="auth-submit"]').click();
  cy.location('pathname').should('eq', '/settings/account');
}

describe('auth and profile', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('registers behind email verification gate at phone viewport', () => {
    cy.viewport(375, 812);
    const unique = `cypress.${Date.now()}@example.test`;
    cy.visit('/register');
    cy.document().then(doc => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
    cy.get('label[for="register-email"]').should('be.visible');
    cy.get('[data-cy="auth-email"]').focus().should('have.focus').type(unique);
    cy.get('[data-cy="auth-username"]').type(`cy-${Date.now()}`);
    cy.get('#register-first').type('Mobile');
    cy.get('#register-last').type('User');
    cy.get('[data-cy="auth-password"]').type(password, { log: false });
    cy.get('[data-cy="auth-confirm-password"]').type(password, { log: false });
    cy.get('[data-cy="auth-submit"]').click();
    cy.location('pathname').should('eq', '/verify-email');
    cy.get('[data-cy="verify-email-address"]').should('have.value', unique);
    cy.get('[data-cy="resend-verification"]').click();
    cy.get('[data-cy="auth-status"]').should('be.visible');
    cy.get('[data-cy="oauth-google"]').should('not.exist');
  });

  it('associates Problem Details field errors with controls', () => {
    cy.viewport(375, 812);
    cy.intercept('POST', '**/api/auth/register', {
      statusCode: 400,
      headers: { 'content-type': 'application/problem+json' },
      body: { type: 'urn:gones:problem:validation_failed', code: 'validation_failed', message: 'Validation failed.', errors: { Email: ['Email is unavailable.'] } }
    });
    cy.visit('/register');
    cy.get('[data-cy="auth-email"]').type('error@example.test');
    cy.get('[data-cy="auth-username"]').type('error-user');
    cy.get('#register-first').type('Error');
    cy.get('#register-last').type('User');
    cy.get('[data-cy="auth-password"]').type(password, { log: false });
    cy.get('[data-cy="auth-confirm-password"]').type(password, { log: false });
    cy.get('[data-cy="auth-submit"]').click();
    cy.get('#register-email').should('have.attr', 'aria-describedby', 'register-email-error').and('have.attr', 'aria-invalid', 'true');
    cy.get('#register-email-error').should('contain.text', 'Email is unavailable.');
    cy.get('[data-cy="auth-error"]').should('be.visible');
  });

  it('logs in, updates private-by-default profile, changes email, signs out', () => {
    login();
    cy.document().then(doc => expect(doc.documentElement.scrollWidth).to.be.at.most(1280));
    cy.get('[data-cy="account-location-public"]').should('not.be.checked');
    cy.get('[data-cy="account-location-city"]').clear().type('Lyon');
    cy.get('[data-cy="account-birth-date"]').clear().type('1990-04-17');
    cy.get('[data-cy="account-language"]').select('fr');
    cy.get('[data-cy="account-location-public"]').check();
    cy.get('[data-cy="account-save"]').click();
    cy.get('[data-cy="account-status"]').should('be.visible');

    cy.get('[data-cy="account-new-email"]').type('cypress.user+changed@example.test');
    cy.get('#profile-email-password').type(password, { log: false });
    cy.get('[data-cy="account-change-email"]').click();
    cy.get('[data-cy="unverified-banner"]').should('be.visible');

    cy.window().then(win => {
      const storage = `${JSON.stringify(win.localStorage)} ${JSON.stringify(win.sessionStorage)}`;
      expect(storage).not.to.contain('memory-token');
      expect(storage.toLowerCase()).not.to.contain('accesstoken');
    });

    cy.get('[data-cy="logout-button"]').click();
    cy.location('pathname').should('eq', '/');
    cy.get('[data-cy="logout-button"]').should('not.exist');
  });

  it('completes provider profile through the SPA without exposing an access token in the URL', () => {
    const profile = { id: 'oauth-user', email, emailVerified: true, globalRole: 'User', username: 'oauth-user', firstName: 'OAuth', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false };
    cy.intercept('POST', '**/api/auth/oauth/complete', req => {
      expect(req.body.completionTicket).to.eq('opaque-ticket');
      req.reply({ status: 'authenticated', accessToken: 'memory-token', expiresAt: '2026-08-01T14:00:00Z', tokenType: 'Bearer' });
    }).as('completeOAuth');
    cy.intercept('GET', '**/api/users/me', profile);
    cy.intercept('GET', '**/api/users/me/external-identities', []);
    cy.visit('/auth/complete-profile?ticket=opaque-ticket');
    cy.get('#complete-email').focus().should('have.focus').type(email);
    cy.get('#complete-username').type('oauth-user');
    cy.get('#complete-first').type('OAuth');
    cy.get('#complete-last').type('User');
    cy.get('[data-cy="complete-profile-submit"]').click();
    cy.wait('@completeOAuth');
    cy.location('pathname').should('eq', '/settings/account');
    cy.location('search').should('eq', '');
  });

  it('starts explicit provider linking without implicit email merge', () => {
    login();
    cy.intercept('POST', '**/api/users/me/external-identities/google/start', { authorizationUrl: 'http://127.0.0.1:8081/profile?linkStarted=true' }).as('linkStart');
    cy.get('#link-password').type(password, { log: false });
    cy.get('[data-cy="link-google"]').click();
    cy.wait('@linkStart').its('request.body').should('have.property', 'currentPassword');
    cy.location('search').should('eq', '?linkStarted=true');
  });

  it('shows and unlinks an explicitly linked provider', () => {
    cy.intercept('GET', '**/api/users/me/external-identities', [{ provider: 'Google', providerEmail: email, providerEmailVerified: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]).as('linkedIdentities');
    cy.intercept('DELETE', '**/api/users/me/external-identities/google', { statusCode: 204 }).as('unlink');
    login();
    cy.wait('@linkedIdentities');
    cy.get('[data-cy="unlink-google"]').click();
    cy.wait('@unlink');
  });
});
