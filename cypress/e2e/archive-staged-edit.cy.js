const POWER_KEY = 'gones.settings.power-user';
const LOCAL_DB = 'gones-leagues';
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

function persisted(league) {
  return { ...league, updatedAt: '2026-08-13T10:00:00Z', eTag: etag(league.documentVersion) };
}

function seed(win, clearLocal = false) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  win.localStorage.setItem(POWER_KEY, 'true');
  if (clearLocal) win.indexedDB.deleteDatabase(LOCAL_DB);
}

function visit(path, clearLocal = false) {
  cy.visit(path, { onBeforeLoad: win => seed(win, clearLocal) });
}

function signedOut(calls) {
  cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } });
  cy.intercept(/\/api\/leagues-archive/, req => {
    calls.push(`${req.method} ${req.url}`);
    req.reply({ statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } });
  });
}

function organizer() {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', profile);
}

describe('Archive Tournament explicit staged editor', () => {
  beforeEach(() => cy.viewport(1280, 900));

  it('stages local changes without persistence, commits once, then survives reload', () => {
    const apiCalls = [];
    signedOut(apiCalls);
    visit('/leagues-archive', true);

    cy.get('[data-cy="leagues-archive-list-create-card"]').click();
    cy.contains('mat-dialog-container', 'New League').within(() => {
      cy.get('input').type('Local Staged League');
      cy.contains('button', 'Create League').click();
    });
    cy.get('[data-cy="leagues-archive-detail-create-tournament-card"]').click();
    cy.get('[data-cy="tournament-archive-detail-read-only"]').should('be.visible');
    cy.get('[data-cy="tournament-archive-detail-add-round"]').should('not.exist');

    cy.get('[data-cy="tournament-archive-detail-edit"]').click();
    cy.get('[data-cy="tournament-archive-detail-name-input"]').clear().type('Local Draft Cup');
    cy.get('[data-cy="tournament-archive-detail-add-round"]').click();
    cy.contains('mat-expansion-panel', 'Round 1').find('mat-expansion-panel-header').click();
    cy.get('[data-cy="tournament-archive-detail-add-match"]').click();
    cy.get('[data-cy="tournament-archive-detail-match-player1-input"]').type('Alice');
    cy.get('[data-cy="tournament-archive-detail-match-player2-input"]').type('Bob');

    cy.reload();
    cy.contains('h1', 'Local Draft Cup').should('not.exist');
    cy.get('[data-cy="tournament-archive-detail-round-entry-row"]').should('not.exist');

    cy.get('[data-cy="tournament-archive-detail-edit"]').click();
    cy.get('[data-cy="tournament-archive-detail-name-input"]').clear().type('Local Committed Cup');
    cy.get('[data-cy="tournament-archive-detail-add-round"]').click();
    cy.contains('mat-expansion-panel', 'Round 1').find('mat-expansion-panel-header').click();
    cy.get('[data-cy="tournament-archive-detail-add-match"]').click();
    cy.get('[data-cy="tournament-archive-detail-match-player1-input"]').type('Alice');
    cy.get('[data-cy="tournament-archive-detail-match-player2-input"]').type('Bob');
    cy.get('[data-cy="tournament-archive-detail-save-changes"]').click();
    cy.get('[data-cy="confirm-dialog-message"]').should('contain', 'Deleted rounds: 0').and('contain', 'Deleted entries: 0');
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.contains('h1', 'Local Committed Cup').should('be.visible');
    cy.get('[data-cy="tournament-archive-detail-edit"]').should('exist');

    cy.reload();
    cy.contains('h1', 'Local Committed Cup').should('be.visible');
    cy.get('[data-cy="tournament-archive-detail-round-entry-row"]').should('have.length', 1);
    cy.then(() => expect(apiCalls.filter(call => !call.startsWith('GET ')), 'server mutation calls').to.deep.equal([]));
  });

  it('keeps server draft on 412, cancels Reload Latest without loss, then discards after confirmation', () => {
    organizer();
    const source = {
      id: 'server-source', name: 'Server League', status: 'active', documentVersion: 4,
      tournaments: [{
        id: 't1', leagueId: 'server-source', name: 'Server Cup', tournamentDate: '2026-08-13', playerArchetypes: [],
        rounds: [{ id: 'r1', entries: [{ kind: 'match', id: 'e1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }]
      }]
    };
    let batchCalls = 0;
    cy.intercept('GET', /\/api\/leagues-archive\?.*/, { items: [{ id: source.id, name: source.name, status: source.status, documentVersion: source.documentVersion }], page: 1, pageSize: 100, totalCount: 1 });
    cy.intercept('GET', /\/api\/leagues-archive\/server-source$/, persisted(source)).as('sourceDetail');
    cy.intercept('POST', /\/api\/leagues-archive\/server-source\/tournaments-archive\/t1\/edit-batch$/, req => {
      batchCalls += 1;
      expect(req.headers['if-match']).to.eq(etag(4));
      expect(req.body.editTournament.name).to.eq('Unsaved Server Draft');
      req.reply({ statusCode: 412, body: { code: 'stale_league_document', message: 'Stale.' } });
    }).as('editBatch');

    visit('/leagues-archive/server-source/tournaments-archive/t1');
    cy.get('[data-cy="tournament-archive-detail-read-only"]').should('be.visible');
    cy.get('[data-cy="tournament-archive-detail-edit"]').click();
    cy.get('[data-cy="tournament-archive-detail-name-input"]').clear().type('Unsaved Server Draft');
    cy.get('[data-cy="tournament-archive-detail-match-delete"]').click({ force: true });
    cy.get('[data-cy="tournament-archive-detail-save-changes"]').click();
    cy.get('[data-cy="confirm-dialog-message"]').should('contain', 'Deleted entries: 1');
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.wait('@editBatch');
    cy.get('[data-cy="tournament-archive-detail-name-input"]').should('have.value', 'Unsaved Server Draft');
    cy.get('[data-cy="tournament-archive-detail-reload"]').should('exist').click();
    cy.get('[data-cy="confirm-dialog-cancel"]').click();
    cy.get('[data-cy="tournament-archive-detail-name-input"]').should('have.value', 'Unsaved Server Draft');
    cy.then(() => expect(batchCalls).to.eq(1));

    cy.get('[data-cy="tournament-archive-detail-reload"]').should('not.be.disabled').click();
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.contains('h1', 'Server Cup').should('be.visible');
    cy.get('[data-cy="tournament-archive-detail-edit"]').should('exist');
  });
});
