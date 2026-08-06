const STORE_KEY = 'gones.frontend.backend.v1';
const LIVE_STORE_KEY = 'gones.live-tournaments.v1';

// Every route that only ever exists under the server authority. A legacy static build must render
// the Not Found page for each of them, not a working auth/organizer/admin surface (C42, ADR 0019).
const SERVER_ONLY_ROUTES = [
  '/login',
  '/register',
  '/profile',
  '/registrations',
  '/organizer/tournaments',
  '/organizer/tournaments/new',
  '/organizer/organizations',
  '/admin',
  '/admin/users',
  '/admin/tournaments/deleted'
];

function seedBrowserPreferences(win) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
}

// Test-isolation cleanup can race the previous page's settings self-heal (French default);
// re-seed after boot and reload so every test deterministically starts in English.
function visitSeeded(path, seed = seedBrowserPreferences) {
  cy.visit(path, { onBeforeLoad: seed });
  cy.window().then((win) => seed(win));
  cy.reload();
}

function apiRequests(win) {
  return win.performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => new URL(url).pathname.startsWith('/api/'));
}

describe('legacy browser data authority', () => {
  it('exposes no auth, organizer or admin route and issues no API request', () => {
    for (const route of SERVER_ONLY_ROUTES) {
      cy.visit(route, { failOnStatusCode: false });
      cy.get('[data-cy="not-found"]', { timeout: 10000 }).should('exist');
      cy.window().then((win) => expect(apiRequests(win), `API traffic from ${route}`).to.deep.equal([]));
    }
  });

  it('keeps the frozen legacy Calendar and Event pages instead of the Calendar V1 surface', () => {
    cy.visit('/calendar');
    cy.get('[data-cy="public-calendar"]').should('not.exist');
    cy.visit('/calendar/tournaments/anything', { failOnStatusCode: false });
    cy.get('[data-cy="not-found"]').should('exist');
  });

  it('writes League and Live source data to the canonical browser stores only', () => {
    visitSeeded('/leagues', (win) => {
      seedBrowserPreferences(win);
      win.localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, leagues: [] }));
    });

    cy.get('[data-cy="create-league-card"]').click();
    cy.contains('mat-dialog-container', 'New League').within(() => {
      cy.get('input').type('Authority League');
      cy.contains('button', 'Create League').click();
    });
    cy.contains('h1 button', 'Authority League').should('be.visible');

    cy.window().then((win) => {
      expect(win.localStorage.getItem(STORE_KEY)).to.contain('Authority League');
      expect(apiRequests(win)).to.deep.equal([]);
    });

    // Live drafts also live in the browser here, and creating one issues no API request.
    visitSeeded('/live-tournaments');
    cy.get('[data-cy="create-running-tournament-card"]').click();
    cy.location('pathname').should('match', /^\/live-tournaments\/.+/);
    cy.window().then((win) => {
      expect(win.localStorage.getItem(LIVE_STORE_KEY)).to.be.a('string');
      expect(apiRequests(win)).to.deep.equal([]);
    });
  });
});
