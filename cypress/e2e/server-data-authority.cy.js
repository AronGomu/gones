const STORE_KEY = 'gones.frontend.backend.v1';
const LIVE_STORE_KEY = 'gones.live-tournaments.v1';

const profile = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'organizer@example.test', emailVerified: true, globalRole: 'Organizer',
  username: 'organizer-user', firstName: 'Organizer', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false,
  isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false
};

function etag(version) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(version));
  return `"${btoa(String.fromCharCode(...bytes))}"`;
}

// A canonical browser store that a server-mode build must neither read nor keep alive.
function seedGhostStores(win) {
  win.localStorage.setItem(STORE_KEY, JSON.stringify({
    version: 1,
    leagues: [{ id: 'ghost-league', name: 'Ghost Browser League', status: 'active', documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z', tournaments: [] }],
    calendarEvents: [{ id: 'ghost-event', slug: 'ghost-event', title: 'Ghost Browser Event', eventDate: '2026-09-01', startTime: '19:00', endTime: '22:00', location: 'Nowhere', country: 'France', city: 'Lyon', address: '', description: '', richDescriptionHtml: '', externalLink: '' }]
  }));
  win.localStorage.setItem(LIVE_STORE_KEY, JSON.stringify({
    version: 1,
    tournaments: [{ id: 'ghost-live', name: 'Ghost Browser Draft', leagueId: '', tournamentDate: '2026-09-01', type: 'swiss', roundCount: 3, stage: 'setup', currentRoundNumber: 0, players: [], rounds: [], checkpoints: [], documentVersion: 1, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }],
    deletedTournamentIds: []
  }));
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
}

// Test-isolation cleanup can race the previous page's settings self-heal (French default);
// re-seed after boot and reload so every test deterministically starts in English.
function visitWithGhostStores(path) {
  cy.visit(path, { onBeforeLoad: seedGhostStores });
  cy.window().then((win) => seedGhostStores(win));
  cy.reload();
}

function expectCanonicalStoresUntouched(win, seeded) {
  // Server mode must not write the canonical stores; the seeded values stay byte-identical.
  expect(win.localStorage.getItem(STORE_KEY)).to.equal(seeded.frontend);
  expect(win.localStorage.getItem(LIVE_STORE_KEY)).to.equal(seeded.live);
}

describe('server data authority', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('reads League, Live and Calendar from the API and ignores a canonical browser store', () => {
    visitWithGhostStores('/leagues');
    cy.get('[data-cy="create-league-card"], [data-cy="league-list-item"], [data-cy="league-read-only"]', { timeout: 15000 }).should('exist');
    cy.contains('Ghost Browser League').should('not.exist');

    cy.visit('/live-tournaments');
    cy.contains('Ghost Browser Draft').should('not.exist');

    cy.visit('/calendar');
    cy.get('[data-cy="public-calendar"]', { timeout: 15000 }).should('exist');
    cy.contains('Ghost Browser Event').should('not.exist');

    cy.window().then((win) => {
      const apiRequests = win.performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => new URL(url).pathname.startsWith('/api/'));
      expect(apiRequests.length, 'server mode reads through the API').to.be.greaterThan(0);
    });
  });

  it('redirects the legacy Event detail path into the server Calendar', () => {
    cy.visit('/events/ghost-event', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/calendar/tournaments/ghost-event');
  });

  it('hides every browser-authority Settings section', () => {
    visitWithGhostStores('/settings');
    cy.get('[data-cy="settings-migration-export-button"]').should('not.exist');
    cy.get('[data-cy="settings-migration-warning"]').should('not.exist');
  });

  it('writes an Organizer League mutation to the server only, never to the canonical stores', () => {
    const leagues = [];
    let next = 1;
    cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' });
    cy.intercept('GET', '**/api/users/me', profile);
    cy.intercept('GET', /\/api\/leagues\?.*/, (req) => req.reply({
      items: leagues.map(({ id, name, status, documentVersion }) => ({ id, name, status, documentVersion, updatedAt: '2026-08-02T00:00:00Z' })),
      page: 1, pageSize: 100, totalCount: leagues.length
    }));
    cy.intercept('GET', /\/api\/leagues\/[^/?]+$/, (req) => {
      const league = leagues.find((item) => item.id === decodeURIComponent(req.url.split('/').pop()));
      req.reply(league
        ? { ...league, updatedAt: '2026-08-02T00:00:00Z', eTag: etag(league.documentVersion) }
        : { statusCode: 404, body: { code: 'not_found', message: 'Missing.' } });
    });
    cy.intercept('POST', /\/api\/leagues$/, (req) => {
      const league = { id: `league-${next++}`, name: req.body.name, status: 'active', tournaments: [], documentVersion: 1 };
      leagues.push(league);
      req.reply({ statusCode: 201, body: { ...league, updatedAt: '2026-08-02T00:00:00Z', eTag: etag(1) } });
    }).as('createLeague');

    visitWithGhostStores('/leagues');
    cy.window().then((win) => {
      const seeded = { frontend: win.localStorage.getItem(STORE_KEY), live: win.localStorage.getItem(LIVE_STORE_KEY) };

      cy.get('[data-cy="create-league-card"]').click();
      cy.contains('mat-dialog-container', 'New League').within(() => {
        cy.get('input').type('Server Authority League');
        cy.contains('button', 'Create League').click();
      });
      cy.wait('@createLeague');
      cy.contains('[data-cy="league-list-item"], h1 button', 'Server Authority League').should('exist');

      cy.window().then((after) => expectCanonicalStoresUntouched(after, seeded));
    });
  });
});
