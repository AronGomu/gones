const PII_EMAIL = 'pii-probe@example.com';
const PII_TOKEN = 'fake-refresh-token-123';
const PII_PASSWORD = 'Sup3rSecretPassword!';

function seedLegacyStores(win) {
  win.localStorage.clear();
  win.localStorage.setItem('gones.frontend.backend.v1', JSON.stringify({
    version: 1,
    leagues: [{
      id: 'migration-league', name: 'Migration League', status: 'active', documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z',
      tournaments: [{ id: 'migration-t1', leagueId: 'migration-league', name: 'Weekly', tournamentDate: '2026-07-01', playerArchetypes: [], rounds: [] }]
    }],
    calendarEvents: [{ id: 'migration-event', slug: 'modern-night', title: 'Modern Night', eventDate: '2026-08-10', startTime: '19:00', endTime: '22:00', location: 'Store', country: 'France', city: 'Lyon', address: '1 rue', description: '', richDescriptionHtml: '', externalLink: '' }]
  }));
  win.localStorage.setItem('gones.live-tournaments.v1', JSON.stringify({
    version: 1,
    tournaments: [{ id: 'migration-live', name: 'Draft Friday', leagueId: '', tournamentDate: '2026-08-07', type: 'swiss', roundCount: 3, stage: 'setup', currentRoundNumber: 0, players: [], rounds: [], checkpoints: [], documentVersion: 1, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }],
    deletedTournamentIds: []
  }));
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: ['Control', 'Aggro'] }));
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings.deckArchetypes', JSON.stringify(['Control', 'Aggro']));
  // Secrets/PII that must never appear in any downloaded artifact.
  win.localStorage.setItem('gones.auth.session.v1', JSON.stringify({ email: PII_EMAIL, refreshToken: PII_TOKEN, password: PII_PASSWORD }));
}

// The cutover export is a legacy-authority capability: it reads the browser stores and must never
// reach the server, in either direction (C42, ADR 0019).
function expectNoApiTraffic(win) {
  const apiRequests = win.performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => new URL(url).pathname.startsWith('/api/'));
  expect(apiRequests, 'migration export must not call the API').to.deep.equal([]);
}

function expectNoSecrets(text) {
  expect(text).to.not.contain(PII_EMAIL);
  expect(text).to.not.contain(PII_TOKEN);
  expect(text).to.not.contain(PII_PASSWORD);
  expect(text).to.not.contain('gones.auth');
}

// Test-isolation cleanup can race the previous page's settings self-heal (French default);
// re-seed after boot and reload so every test deterministically starts from the fixture.
function visitSeeded(path) {
  cy.visit(path, { onBeforeLoad: seedLegacyStores });
  cy.window().then((win) => seedLegacyStores(win));
  cy.reload();
}

describe('Export v4 and private migration bundle downloads', () => {
  it('downloads the private migration bundle with warning, hash, source instance, counts and versions', () => {
    visitSeeded('/settings');

    cy.get('[data-cy="settings-migration-warning"]').should('be.visible').and('contain', 'never upload');
    cy.get('[data-cy="settings-migration-export-button"]').click();

    cy.get('[data-cy="settings-migration-hash"]').invoke('text').should('match', /^sha256:[0-9a-f]{64}$/);
    cy.get('[data-cy="settings-migration-instance"]').invoke('text').should('match', /^[0-9a-f-]{36}$/);
    cy.get('[data-cy="settings-migration-versions"]').should('contain', 'Data v4');
    cy.get('[data-cy="settings-migration-counts"]').should('contain', '1 Leagues').and('contain', '1 Live drafts');

    cy.window().then((win) => {
      expectNoApiTraffic(win);
      const sourceInstanceId = win.localStorage.getItem('gones.migration.source-instance.v1');
      expect(sourceInstanceId).to.match(/^[0-9a-f-]{36}$/);
      const fileName = `${new Date().toISOString().slice(0, 10)} gones-migration-${sourceInstanceId.slice(0, 8)}.private.json`;
      cy.readFile(`cypress/downloads/${fileName}`).then((bundle) => {
        expect(bundle.kind).to.equal('gones.private-migration-bundle');
        expect(bundle.bundleFormatVersion).to.equal(1);
        expect(bundle.gonesDataVersion).to.equal(4);
        expect(bundle.sourceInstanceId).to.equal(sourceInstanceId);
        expect(bundle.counts).to.deep.equal({ leagues: 1, tournaments: 1, calendarEvents: 1, liveTournaments: 1, deckArchetypes: 51 });
        expect(bundle.liveTournaments[0].id).to.equal('migration-live');
        expect(bundle.deckArchetypes).to.include('Aggro');
        expect(bundle.storeHashes['gones.frontend.backend.v1']).to.match(/^[0-9a-f]{64}$/);
        expect(bundle).to.not.have.property('language');
        expectNoSecrets(JSON.stringify(bundle));
      });
    });
  });

  it('downloads the public v4 Full Data Export with checksum and without Live drafts or secrets', () => {
    visitSeeded('/leagues');

    const exportPath = 'cypress/downloads/gones-full-data.gones.json';
    cy.exec(`node -e "require('fs').rmSync('${exportPath}', { force: true })"`);
    cy.contains('button', 'Export all leagues').click();
    cy.readFile(exportPath).then((exported) => {
      expect(exported.kind).to.equal('fullData');
      expect(exported.gonesDataVersion).to.equal(4);
      expect(exported.checksum).to.match(/^sha256:[0-9a-f]{64}$/);
      expect(exported.leagues.map((league) => league.name)).to.include('Migration League');
      expect(Object.keys(exported.leagues[0]).sort()).to.deep.equal(['id', 'name', 'status', 'tournaments']);
      expect(exported.calendarEvents[0].title).to.equal('Modern Night');
      const artifact = JSON.stringify(exported);
      expect(artifact).to.not.contain('liveTournaments');
      expect(artifact).to.not.contain('migration-live');
      expectNoSecrets(artifact);
    });
    cy.window().then(expectNoApiTraffic);
  });

  it('keeps the cutover exporter available only under the legacy browser authority', () => {
    visitSeeded('/settings');

    cy.get('[data-cy="settings-migration-export-button"]').should('be.visible');
    // The frozen legacy build exposes no auth/admin capability that could upload the bundle.
    cy.get('[data-cy="settings-profile-link"]').should('not.exist');
    cy.visit('/login', { failOnStatusCode: false });
    cy.get('[data-cy="not-found"]').should('exist');
  });
});
