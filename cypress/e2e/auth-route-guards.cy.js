// Feedback item 18: `/registrations` was reported reachable while signed out. The route carries
// `userGuard`, so the guard is the only thing standing between a signed-out visitor and the page —
// and it used to decide synchronously on `AuthService.profile()`, whatever the startup session
// restore had settled to by then. These two cases pin both ends of that: the plain anonymous load,
// and the load where the restore is still in flight when routing runs.
const SEED_MARKER = 'gones.e2e.storage-seeded';

function seedStorage(win) {
  win.localStorage.setItem('gones.first-visit.completed', 'true');
  win.localStorage.setItem(SEED_MARKER, 'true');
}

// `onBeforeLoad` alone is not reliable on the release topology: once the ngsw worker controls the
// page it answers the navigation out of its own cache, the document never travels through the
// Cypress proxy and the hook is never installed. Re-apply from the loaded window and visit again.
function visit(path) {
  cy.visit(path, { onBeforeLoad: seedStorage });
  cy.window({ log: false }).then(win => {
    if (win.localStorage.getItem(SEED_MARKER) === 'true') return;
    seedStorage(win);
    cy.visit(path);
  });
}

const profile = {
  id: 'user', email: 'user@example.test', emailVerified: true, globalRole: 'User', username: 'CurrentUser',
  firstName: 'Current', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false,
  isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false
};

describe('route guards for a signed-out visitor', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('guest visiting /registrations is redirected to login with a return url', () => {
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401 }).as('bootstrapRefresh');
    visit('/registrations');

    cy.location('pathname').should('eq', '/login');
    cy.location('search').should('eq', '?returnUrl=%2Fregistrations');
    cy.get('[data-cy="auth-email"]').should('be.visible');
    cy.get('[data-cy="registrations-page"]').should('not.exist');
  });

  it('guest visiting /registrations while the session restore is still in flight never sees the page', () => {
    cy.intercept('POST', '**/api/auth/refresh', request => request.reply({ statusCode: 401, delay: 1500 })).as('slowRefresh');
    visit('/registrations');

    cy.location('pathname').should('eq', '/login');
    cy.location('search').should('eq', '?returnUrl=%2Fregistrations');
    cy.get('[data-cy="registrations-page"]').should('not.exist');
  });
});

describe('route guards for a signed-in user', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('lets a restored session through to /registrations', () => {
    cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' });
    cy.intercept('GET', '**/api/users/me', profile);
    cy.intercept('GET', '**/api/users/me/registrations*', { items: [], totalCount: 0, page: 1, pageSize: 20 });
    visit('/registrations');

    cy.location('pathname').should('eq', '/registrations');
    cy.get('[data-cy="registrations-page"]').should('be.visible');
  });
});
