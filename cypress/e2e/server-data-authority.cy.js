const STORE_KEY = 'gones.frontend.backend.v1';
const LIVE_STORE_KEY = 'gones.live-tournaments.v1';

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
  win.localStorage.setItem('gones.settings.power-user', 'true');
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

  it('reads the archive, Live and Calendar from the API and ignores a canonical browser store', () => {
    visitWithGhostStores('/archive/league-seasons');
    cy.get('[data-cy="archive-seasons-table"]', { timeout: 15000 }).should('exist');
    cy.contains('Ghost Browser League').should('not.exist');

    cy.visit('/live-tournaments');
    cy.contains('Ghost Browser Draft').should('not.exist');

    cy.visit('/events');
    cy.get('[data-cy="public-calendar"]', { timeout: 15000 }).should('exist');
    cy.contains('Ghost Browser Event').should('not.exist');

    cy.window().then((win) => {
      const apiRequests = win.performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => new URL(url).pathname.startsWith('/api/'));
      expect(apiRequests.length, 'server mode reads through the API').to.be.greaterThan(0);
    });
  });

  it('serves the 404 page for the retired /calendar/tournaments/:slug path', () => {
    cy.visit('/calendar/tournaments/ghost-event', { failOnStatusCode: false });
    cy.location('pathname').should('eq', '/calendar/tournaments/ghost-event');
    cy.get('[data-cy="not-found"]').should('exist');
  });

  /**
   * ADR 0022 kept parameter-preserving redirects for the retired archive paths. T19 reversed that
   * clause — Gones is unreleased with zero users, so there is no bookmark to protect — and every one
   * of them now falls through to the `**` route. The pathname assertion is the point: a redirect
   * would rewrite it, so an unchanged path proves no alias fired.
   */
  it('serves the 404 page for every retired archive path', () => {
    for (const path of [
      '/leagues',
      '/leagues-archive',
      '/leagues-archive/x',
      '/leagues-archive/x/tournaments-archive/y',
      '/leagues-archive/x/tournaments-archive/y/result',
      '/leagues-archive/x/tournaments-archive/y/result/metagames'
    ]) {
      cy.visit(path, { failOnStatusCode: false });
      cy.location('pathname').should('eq', path);
      cy.get('[data-cy="not-found"]').should('exist');
    }
  });

  it('hides every browser-authority Settings section', () => {
    visitWithGhostStores('/settings');
    cy.get('[data-cy="settings-migration-export-button"]').should('not.exist');
    cy.get('[data-cy="settings-migration-warning"]').should('not.exist');
  });
});
