const email = 'cypress.user@example.test';
const password = 'Cypress-pass-123!';

const SEED_MARKER = 'gones.e2e.storage-seeded';

// The submit redirects to '/'; seed the first-visit flag so that redirect isn't intercepted
// by firstVisitHomeGuard (T21) — these tests assert on the plain home route, not /about.
function seedStorage(win) {
  win.localStorage.setItem('gones.first-visit.completed', 'true');
  win.localStorage.setItem(SEED_MARKER, 'true');
}

// `onBeforeLoad` alone does not carry that seed on the release topology. The production build
// registers the ngsw service worker, and once that worker controls the page it answers the navigation
// request out of its own cache: the document never travels through the Cypress proxy, so Cypress
// cannot install its hook and `onBeforeLoad` is never called — no error, no seed. Re-apply from the
// loaded window and visit once more when the hook was skipped.
function visit(path, origin = '') {
  const url = `${origin}${path}`;
  cy.visit(url, { onBeforeLoad: seedStorage });
  cy.window({ log: false }).then(win => {
    if (win.localStorage.getItem(SEED_MARKER) === 'true') return;
    seedStorage(win);
    cy.visit(url);
  });
}

function login(origin = '') {
  visit('/login', origin);
  cy.get('[data-cy="auth-email"]').type(email);
  cy.get('[data-cy="auth-password"]').type(password, { log: false });
  cy.get('[data-cy="auth-submit"]').click();
  cy.location('pathname').should('eq', '/');
}

// These three assertions used to name `[data-cy="login-link"]`. `src/app/app.component.ts` stopped
// rendering that value when T3 replaced it, and `login-links`, `register-login-link` and
// `verify-login-link` are different exact values — so the selector matched nothing and every
// `should('not.exist')` held no matter what the toolbar rendered.
//
// The signed-in claim is not "one particular element is absent", it is "the app offers this user no
// route back to sign-in". No single data-cy expresses that, so the selector is the link target
// itself: a signed-in user must see no anchor to /login anywhere on the page, and an anonymous one
// must see at least one.
const SIGN_IN_LINK = 'a[href="/login"], a[href^="/login?"]';

function alternateLoopbackOrigin() {
  const origin = new URL(Cypress.config('baseUrl')).origin;
  const url = new URL(origin);
  url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return url.origin;
}

function assertNoAuthSecretsInStorage() {
  cy.window().then((win) => {
    const storage = `${JSON.stringify(win.localStorage)} ${JSON.stringify(win.sessionStorage)}`.toLowerCase();
    expect(storage).not.to.match(/access.?token|refresh.?token|gones_refresh/);
  });
}

describe('session persistence across a reload', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('keeps the user signed in after a full page reload', () => {
    login();
    cy.get('[data-cy="profile-link"]').should('be.visible');
    cy.get(SIGN_IN_LINK).should('not.exist');

    // The access token only ever lives in memory, so surviving a reload can only come from the
    // refresh cookie being stored by the browser and replayed by the startup bootstrap.
    cy.intercept('POST', '**/api/auth/refresh').as('bootstrapRefresh');
    cy.reload();
    cy.wait('@bootstrapRefresh').its('response.statusCode').should('eq', 200);

    cy.get('[data-cy="profile-link"]').should('be.visible').and('contain.text', 'cypress-user');
    cy.get(SIGN_IN_LINK).should('not.exist');
    assertNoAuthSecretsInStorage();
  });

  it('keeps the user signed in after Ctrl-F5-equivalent forced reload', () => {
    login(alternateLoopbackOrigin());
    cy.get('[data-cy="profile-link"]').should('be.visible').and('contain.text', 'cypress-user');
    cy.getCookie('gones_refresh').should((cookie) => {
      expect(cookie).not.to.be.null;
      expect(cookie).to.include({
        httpOnly: true,
        path: '/api/auth',
        sameSite: 'lax',
        secure: false
      });
      expect(cookie.expiry).to.be.greaterThan(Math.floor(Date.now() / 1000));
    });

    cy.intercept('POST', '**/api/auth/refresh').as('forcedBootstrapRefresh');
    cy.reload(true);
    cy.wait('@forcedBootstrapRefresh').its('response.statusCode').should('eq', 200);

    cy.get('[data-cy="profile-link"]').should('be.visible').and('contain.text', 'cypress-user');
    cy.get(SIGN_IN_LINK).should('not.exist');
    assertNoAuthSecretsInStorage();
  });

  it('leaves anonymous browsing untouched when there is no session cookie', () => {
    visit('/');
    // The mirror of the signed-in case: without a session the route to /login must be on offer.
    cy.get(SIGN_IN_LINK).should('exist');
    // The home menu's login card is gone: the sign-in entry point now lives in the toolbar, and that
    // is the affordance an anonymous visitor must still be offered.
    cy.get('[data-cy="toolbar-sign-in-link"]').should('be.visible');
    cy.get('[data-cy="profile-link"]').should('not.exist');
  });
});
