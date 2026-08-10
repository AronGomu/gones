const email = 'cypress.user@example.test';
const password = 'Cypress-pass-123!';

// NOTE: cy.session(email, ...) was tried here to collapse this file's three real logins into one
// (cached-cookie reuse) and cut the auth-permit cost. It does not work with this backend: refresh
// tokens are single-use and rotate on every call (`RefreshSessionService.RotateAsync`,
// backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs:180). cy.session() snapshots cookies once,
// at the end of its setup callback; the very next real request from the *live* login() caller (e.g.
// this test's own `cy.reload()`, or the app's own silent refresh) rotates the cookie in the browser,
// so the cached snapshot is already a superseded, rejected token by the time a later test restores
// it. Confirmed reproducible (not a flake) across two consecutive clean, non-rate-limited runs: both
// times, every test that tried to reuse the cached session failed identically — a real
// `POST /api/auth/refresh` fired, was rejected, and the account page never rendered. So this stays a
// real per-test login. It still costs only 4 of 5 login permits per pass (see the delete case and the
// seed script's conditional register for where the other permits were actually saved).
function login() {
  cy.visit('/login?returnUrl=%2Fsettings%2Faccount');
  cy.get('[data-cy="auth-email"]').type(email);
  cy.get('[data-cy="auth-password"]').type(password, { log: false });
  cy.get('[data-cy="auth-submit"]').click();
  cy.location('pathname').should('eq', '/settings/account');
  markFirstVisitCompleted();
}

/**
 * `firstVisitHomeGuard` sends a browser that has never completed a first visit to /about, and only
 * '' and '/about' ever record that visit — a session that deep-links straight to /login never does.
 * The sign-out and account-deletion cases below assert the landing page is '/', which is what every
 * browser that has already been to the app sees, so record the completed visit these flows assume.
 *
 * Written to the live window rather than to `cy.visit`'s `onBeforeLoad`: on the release topology the
 * ngsw service worker answers the navigation request out of its own cache, the document never travels
 * through the Cypress proxy, and `onBeforeLoad` is then never called at all. The guard re-reads
 * localStorage on each navigation, so setting it on the loaded page is enough.
 */
function markFirstVisitCompleted() {
  cy.window({ log: false }).then(win => win.localStorage.setItem('gones.first-visit.completed', 'true'));
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
    cy.get('[data-cy="account-save"]').should('be.disabled');
    cy.get('[data-cy="account-location-country"]').select('France');
    cy.get('[data-cy="account-location-region-select"]').should('be.visible').select('Rhône');
    cy.get('[data-cy="account-location-city-select"]').should('be.visible').select('Lyon');
    cy.get('[data-cy="account-birth-date"]').clear().type('1990-04-17');
    cy.get('[data-cy="account-language"]').select('fr');
    cy.get('[data-cy="account-location-public"]').check();
    cy.get('[data-cy="account-save"]').should('be.enabled').then($btn => {
      const [r, g, b] = getComputedStyle($btn[0]).backgroundColor.match(/\d+/g).map(Number);
      // Warning colour is a warm rust/orange (oklch(72% 0.16 62)): red channel clearly
      // dominant over blue, and not the flat grey of a disabled/unstyled button (r !== g).
      expect(r, 'red channel of warning-action background').to.be.greaterThan(b);
      expect(r, 'red channel of warning-action background').not.to.eq(g);
    }).click();
    cy.contains('mat-dialog-container button', /modifier information du compte|update account information/i).click();
    cy.get('[data-cy="account-status"]').should('be.visible');
    cy.get('[data-cy="account-save"]').should('be.disabled');
    cy.reload();
    cy.get('[data-cy="account-location-country"]').should('have.value', 'France');
    cy.get('[data-cy="account-location-region-select"]').should('have.value', 'Rhône');
    cy.get('[data-cy="account-location-city-select"]').should('have.value', 'Lyon');
    cy.get('[data-cy="account-save"]').should('be.disabled');

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
    cy.intercept('POST', '**/api/users/me/external-identities/google/start', { authorizationUrl: `${Cypress.config('baseUrl')}/profile?linkStarted=true` }).as('linkStart');
    cy.get('[data-cy="link-google"]').click();
    cy.wait('@linkStart').its('request.body').should('not.have.property', 'currentPassword');
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

  it('deletes a freshly registered throwaway account behind the password-confirmation dialog', () => {
    const throwawayEmail = `cypress.delete.${Date.now()}@example.test`;
    const throwawayUsername = `cy-del-${Date.now()}`;
    cy.visit('/register');
    cy.get('[data-cy="auth-email"]').type(throwawayEmail);
    cy.get('[data-cy="auth-username"]').type(throwawayUsername);
    cy.get('#register-first').type('Throwaway');
    cy.get('#register-last').type('User');
    cy.get('[data-cy="auth-password"]').type(password, { log: false });
    cy.get('[data-cy="auth-confirm-password"]').type(password, { log: false });
    cy.get('[data-cy="auth-submit"]').click();
    cy.location('pathname').should('eq', '/verify-email');

    cy.visit('/login?returnUrl=%2Fsettings%2Faccount');
    cy.get('[data-cy="auth-email"]').type(throwawayEmail);
    cy.get('[data-cy="auth-password"]').type(password, { log: false });
    cy.get('[data-cy="auth-submit"]').click();
    cy.location('pathname').should('eq', '/settings/account');
    markFirstVisitCompleted();

    cy.get('[data-cy="account-delete"]').click();
    cy.get('[data-cy="password-confirm-input"]').type(password, { log: false });
    cy.get('[data-cy="password-confirm-submit"]').click();
    cy.location('pathname').should('eq', '/');
    cy.get('[data-cy="profile-link"]').should('not.exist');

    // The session is cleared client-side by AuthService.deleteAccount(); this guard confirms the
    // route guard re-enforces it server-side too, without spending an auth permit on a fresh login
    // attempt. The stronger claim — the account row is gone and its old tokens no longer
    // authenticate — is already covered by the deletion endpoint's backend integration tests.
    cy.visit('/settings/account');
    cy.location('pathname').should('eq', '/login');
  });
});
