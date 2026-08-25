const LOCAL_ARCHIVE_DB_NAME = 'gones-archive-local';
const LOCAL_TOURNAMENT_STORE = 'tournaments';

function seedSettings(win) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  win.localStorage.setItem('gones.settings.power-user', 'true');
}

function visitSettings() {
  cy.visit('/settings', { onBeforeLoad: seedSettings });
}

/** A browser-local Archive Tournament: the record that holds Rounds since the three-tier rebuild. */
function putLocalTournament(win) {
  const tournament = {
    id: 'local-settings-proof', name: 'Local Day', seasonId: null, tournamentDate: '2026-08-10', status: 'active',
    documentVersion: 1, updatedAt: '2026-08-10T00:00:00.000Z', playerArchetypes: [],
    rounds: [{ id: 'local-settings-round', entries: [{ id: 'local-settings-entry', kind: 'match', table: '1', player1Name: 'Local Alice', player2Name: 'Local Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }]
  };
  return new Cypress.Promise((resolve, reject) => {
    const open = win.indexedDB.open(LOCAL_ARCHIVE_DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(LOCAL_TOURNAMENT_STORE)) open.result.createObjectStore(LOCAL_TOURNAMENT_STORE, { keyPath: 'id' });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const transaction = open.result.transaction(LOCAL_TOURNAMENT_STORE, 'readwrite');
      transaction.objectStore(LOCAL_TOURNAMENT_STORE).put(tournament);
      transaction.oncomplete = () => { open.result.close(); resolve(); };
      transaction.onerror = () => { open.result.close(); reject(transaction.error); };
    };
  });
}

function readLocalTournament(win) {
  return new Cypress.Promise((resolve, reject) => {
    const open = win.indexedDB.open(LOCAL_ARCHIVE_DB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction(LOCAL_TOURNAMENT_STORE, 'readonly').objectStore(LOCAL_TOURNAMENT_STORE).get('local-settings-proof');
      request.onsuccess = () => { open.result.close(); resolve(request.result); };
      request.onerror = () => { open.result.close(); reject(request.error); };
    };
  });
}

describe('signed-out local Settings', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('persists local archetypes and player renames without any mutation API call', () => {
    const unexpectedApiCalls = [];
    cy.intercept(/\/api\//, (req) => {
      unexpectedApiCalls.push(`${req.method} ${req.url}`);
      req.reply({ statusCode: 503, body: { title: 'Unexpected API call' } });
    });
    // Startup refresh is the only allowed API request for a signed-out route; later intercept wins.
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('refresh');

    visitSettings();
    cy.get('[data-cy="settings-local-archetype-card"]').should('be.visible');
    cy.get('[data-cy="settings-local-players-card"]').should('be.visible');

    cy.get('[data-cy="settings-local-archetype-panel-header"]').click();
    cy.get('[data-cy="settings-new-local-archetype-input"]').type('Cypress Local');
    cy.get('[data-cy="settings-add-local-archetype-button"]').click();
    cy.get('[data-cy="settings-local-archetype-row"][data-archetype="Cypress Local"]').should('exist');
    cy.reload();
    cy.get('[data-cy="settings-local-archetype-panel-header"]').click();
    cy.get('[data-cy="settings-local-archetype-row"][data-archetype="Cypress Local"]').should('exist');

    cy.window().then((win) => putLocalTournament(win));
    cy.reload();
    cy.get('[data-cy="settings-local-players-panel-header"]').click();
    cy.get('[data-cy="settings-local-player-row"][data-player="Local Alice"]').within(() => {
      cy.get('[data-cy="settings-update-local-player-button"]').click();
      cy.get('[data-cy="settings-local-player-input"]').clear().type('Local Alicia');
      cy.get('[data-cy="settings-save-local-player-button"]').click();
    });
    cy.get('[data-cy="settings-local-player-row"][data-player="Local Alicia"]').should('exist');
    cy.window().then((win) => readLocalTournament(win)).then((tournament) => {
      expect(tournament.rounds[0].entries[0].player1Name).to.equal('Local Alicia');
    });
    cy.then(() => expect(unexpectedApiCalls, 'unexpected signed-out API calls').to.deep.equal([]));
  });

  it('hides local catalog cards from Admin', () => {
    const profile = {
      id: 'admin-settings', email: 'admin-settings@example.test', emailVerified: true, globalRole: 'Admin', username: 'admin-settings',
      firstName: 'Admin', lastName: 'Settings', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false,
      isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false
    };
    cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' });
    cy.intercept('GET', '**/api/users/me', profile);
    cy.intercept('GET', '**/api/deck-archetypes', []);
    cy.intercept('GET', '**/api/admin/deck-archetypes', []);
    cy.intercept('GET', /\/api\/maintenance\/player-names(\?.*)?$/, { items: [] });
    cy.intercept('GET', '**/api/users/me/organizations', []);

    visitSettings();

    cy.get('[data-cy="settings-local-archetype-card"]').should('not.exist');
    cy.get('[data-cy="settings-local-players-card"]').should('not.exist');
  });
});
