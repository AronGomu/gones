/**
 * Browser-local League Archive (ADR 0028).
 *
 * Signed out, so it costs zero auth permits: the refresh call is stubbed 401 and never leaves the
 * browser. Every League Archive API call is stubbed 401 too and recorded, so the whole flow below —
 * create a league, a tournament, a round and an entry — proves the local path depends on the server
 * for nothing at all. The reload at the end is the IndexedDB proof.
 */
const LOCAL_LEAGUE_DB_NAME = 'gones-leagues';

function seedSettings(win) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
}

function visit(path, { clearLocalStore = false } = {}) {
  cy.visit(path, {
    onBeforeLoad: (win) => {
      seedSettings(win);
      // Deterministic start: a previous run in the same browser may have left a local league.
      // Never on a re-visit — that is the store whose survival this spec asserts.
      if (clearLocalStore) win.indexedDB.deleteDatabase(LOCAL_LEAGUE_DB_NAME);
    }
  });
  // Test-isolation cleanup can race the previous page's settings self-heal (French default);
  // re-seed after boot and reload so every test deterministically runs in English.
  cy.window().then((win) => seedSettings(win));
  cy.reload();
}

const profile = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'organizer@example.test', emailVerified: true, globalRole: 'Organizer',
  username: 'organizer-user', firstName: 'Organizer', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false,
  isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false
};

const serverLeague = { id: 'server-league-1', name: 'Server League', status: 'active', tournaments: [], documentVersion: 1, updatedAt: '2026-08-09T10:00:00Z' };

/** The list reads a summary page and then each league document, so both GETs are stubbed. */
function stubServerLeagueReads() {
  cy.intercept('GET', /\/api\/leagues-archive\?.*/, { items: [serverLeague], page: 1, pageSize: 100, totalCount: 1 }).as('leagueList');
  cy.intercept('GET', /\/api\/leagues-archive\/[^/?]+$/, serverLeague).as('leagueDetail');
}

function stubSignedIn(globalRole) {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' }).as('refresh');
  cy.intercept('GET', '**/api/users/me', { ...profile, globalRole }).as('profile');
}

/**
 * Create one browser-local league, signed out — the only way one can be born (ADR 0028). Dialog
 * contents are asserted with `exist`, not `be.visible`: Material's open animation leaves the
 * container at opacity 0 under headless Electron, which Cypress reads as hidden while still allowing
 * the click.
 */
function createLocalLeague(name) {
  cy.get('[data-cy="leagues-archive-list-create-card"]').click();
  cy.contains('mat-dialog-container', 'New League').should('exist').within(() => {
    cy.get('input').type(name);
    cy.contains('button', 'Create League').click();
  });
  cy.location('pathname').should('match', /^\/leagues-archive\/local-.+$/);
}

/** Read the browser store directly — the spec's stand-in for DevTools → Application → IndexedDB. */
function readLocalLeagueRows() {
  return cy.window().then((win) => new Cypress.Promise((resolve, reject) => {
    const open = win.indexedDB.open(LOCAL_LEAGUE_DB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const rows = open.result.transaction('leagues', 'readonly').objectStore('leagues').getAll();
      rows.onsuccess = () => { open.result.close(); resolve(rows.result); };
      rows.onerror = () => { open.result.close(); reject(rows.error); };
    };
  }));
}

function stubSignedOut(leagueApiCalls) {
  cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('refresh');
  cy.intercept(/\/api\/leagues-archive/, (req) => {
    leagueApiCalls.push(req.url);
    req.reply({ statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } });
  }).as('leagueApi');
}

/** No error banner from any surface — the local path must never look like a failure to the user. */
function assertNoErrorBanner() {
  cy.get('[data-cy="leagues-archive-list-error"]').should('not.exist');
  cy.get('[data-cy="leagues-archive-detail-error"]').should('not.exist');
  cy.get('[data-cy="app-import-error-banner"]').should('not.exist');
}

describe('League Archive browser-local flows', () => {
  it('creates and fills a league entirely in the browser and survives a reload', () => {
    cy.viewport(1280, 800);

    const leagueApiCalls = [];
    stubSignedOut(leagueApiCalls);

    visit('/leagues-archive', { clearLocalStore: true });

    // The notice explains the store, and the create affordance is offered even though the visitor
    // has no account at all.
    cy.get('[data-cy="leagues-archive-local-notice"]').should('be.visible');
    cy.get('[data-cy="leagues-archive-list-create-card"]').should('exist');
    // A rejected server read is raised, not swallowed, and never shown as a failure.
    cy.get('[data-cy="leagues-archive-server-unavailable"]').should('be.visible');
    assertNoErrorBanner();

    createLocalLeague('Local League');
    cy.contains('h1', 'Local League').should('be.visible');
    assertNoErrorBanner();

    cy.get('[data-cy="leagues-archive-detail-create-tournament-card"]').click();
    cy.location('pathname').should('match', /^\/leagues-archive\/local-[^/]+\/tournaments-archive\/[^/]+$/);

    cy.get('[data-cy="tournament-archive-detail-add-round"]').click();
    cy.contains('mat-expansion-panel', 'Round 1').find('mat-expansion-panel-header').click();
    cy.get('[data-cy="tournament-archive-detail-add-match"]').click();
    cy.get('[data-cy="tournament-archive-detail-round-entry-row"]').should('have.length', 1);

    cy.get('[data-cy="tournament-archive-detail-match-player1-input"]').clear().type('Alice');
    cy.get('[data-cy="tournament-archive-detail-match-player1-score-input"]').clear().type('2');
    cy.get('[data-cy="tournament-archive-detail-match-player2-input"]').clear().type('Bob');
    cy.get('[data-cy="tournament-archive-detail-match-player2-score-input"]').clear().type('0');
    cy.document().trigger('keydown', { key: 's', code: 'KeyS', ctrlKey: true, force: true });
    cy.get('[data-cy="ranking-table"]').should('contain', 'Alice').and('contain', 'Bob');

    // Everything above is in IndexedDB, not in a signal: a full reload brings it all back.
    cy.reload();
    cy.get('[data-cy="tournament-archive-detail-round-entry-row"]').should('have.length', 1);
    cy.get('[data-cy="tournament-archive-detail-match-player1-input"]').should('have.value', 'Alice');
    cy.get('[data-cy="ranking-table"]').should('contain', 'Alice').and('contain', 'Bob');

    // The literal store check: a `gones-leagues` database exists and holds the whole document.
    readLocalLeagueRows().then((rows) => {
      const stored = rows.filter((row) => row.name === 'Local League');
      expect(stored, 'gones-leagues rows named Local League').to.have.length(1);
      expect(stored[0].id, 'stored league id').to.match(/^local-/);
      expect(stored[0].tournaments[0].rounds[0].entries[0].player1Name).to.eq('Alice');
    });

    // Back on the list, the league is there and badged as living in this browser only.
    visit('/leagues-archive');
    cy.contains('[data-cy="leagues-archive-list-item"]', 'Local League').should('exist')
      .find('[data-cy="leagues-archive-list-item-local-badge"]').should('exist');
    assertNoErrorBanner();

    // The negative assertion the whole spec exists for: every League Archive request the app made
    // was answered 401, and none of them was needed.
    cy.then(() => {
      for (const url of leagueApiCalls) expect(url, 'stubbed League Archive request').to.match(/\/api\/leagues-archive/);
    });
    cy.get('@leagueApi.all').then((calls) => {
      for (const call of calls) expect(call.response.statusCode, `response to ${call.request.url}`).to.eq(401);
    });
  });

  it('merges a readable server league into the list and refuses to move a tournament across the boundary', () => {
    cy.viewport(1280, 800);

    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('refresh');
    // Catch-all first, the two reads after it: later intercepts win in Cypress, so every *write* to
    // the server is still refused while the merged list has something server-side to show.
    cy.intercept(/\/api\/leagues-archive/, { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('leagueApi');
    stubServerLeagueReads();

    visit('/leagues-archive', { clearLocalStore: true });

    // Two leagues, one grid, different write rules — and only the browser one is badged.
    cy.get('[data-cy="leagues-archive-server-unavailable"]').should('not.exist');
    cy.contains('[data-cy="leagues-archive-list-item"]', 'Server League').should('exist')
      .find('[data-cy="leagues-archive-list-item-local-badge"]').should('not.exist');
    // A server league nobody signed in can manage is what the read-only notice is about.
    cy.get('[data-cy="leagues-archive-list-read-only"]').should('exist');

    createLocalLeague('Browser League');
    cy.get('[data-cy="leagues-archive-detail-create-tournament-card"]').click();
    cy.location('pathname').should('match', /^\/leagues-archive\/local-[^/]+\/tournaments-archive\/[^/]+$/);

    cy.get('[data-cy="tournament-archive-detail-league-select"]').click();
    cy.contains('mat-option', 'Server League').click({ force: true });

    cy.get('[data-cy="tournament-archive-detail-error"]').should('contain', 'cannot be moved between');
    // Neither store changed: the tournament is still in the browser league it was created in.
    cy.location('pathname').should('match', /^\/leagues-archive\/local-[^/]+\/tournaments-archive\/[^/]+$/);
    cy.reload();
    cy.get('[data-cy="tournament-archive-detail-error"]').should('not.exist');
  });

  it('shows an Admin both stores in one list, each still writable', () => {
    cy.viewport(1280, 800);

    // The browser league has to be born signed out — an Admin creating one writes the server.
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('refresh');
    cy.intercept(/\/api\/leagues-archive/, { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('leagueApi');
    visit('/leagues-archive', { clearLocalStore: true });
    createLocalLeague('Browser League');
    cy.location().then((location) => cy.wrap(location.pathname).as('localLeaguePath'));

    stubSignedIn('Admin');
    stubServerLeagueReads();
    visit('/leagues-archive');

    // One heterogeneous grid: the server's league and this browser's, and only the local one badged.
    cy.contains('[data-cy="leagues-archive-list-item"]', 'Server League').find('[data-cy="leagues-archive-list-item-local-badge"]').should('not.exist');
    cy.contains('[data-cy="leagues-archive-list-item"]', 'Browser League').find('[data-cy="leagues-archive-list-item-local-badge"]').should('exist');
    // Nothing in the list is read-only for an Admin.
    cy.get('[data-cy="leagues-archive-list-read-only"]').should('not.exist');

    cy.contains('[data-cy="leagues-archive-list-item"]', 'Server League').click();
    cy.get('[data-cy="leagues-archive-detail-editable-title"]').should('exist');
    cy.get('[data-cy="leagues-archive-detail-read-only"]').should('not.exist');

    cy.get('@localLeaguePath').then((path) => visit(path));
    cy.get('[data-cy="leagues-archive-detail-editable-title"]').should('exist');
    cy.get('[data-cy="leagues-archive-detail-read-only"]').should('not.exist');
  });

  it('keeps server leagues read-only for a plain user while their own browser leagues stay editable', () => {
    cy.viewport(1280, 800);

    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('refresh');
    cy.intercept(/\/api\/leagues-archive/, { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('leagueApi');
    visit('/leagues-archive', { clearLocalStore: true });
    createLocalLeague('Browser League');
    cy.location().then((location) => cy.wrap(location.pathname).as('localLeaguePath'));

    stubSignedIn('User');
    stubServerLeagueReads();
    visit('/leagues-archive');

    // The read-only notice is about the server rows only — the create card is still offered.
    cy.get('[data-cy="leagues-archive-list-read-only"]').should('exist');
    cy.get('[data-cy="leagues-archive-list-create-card"]').should('exist');

    cy.contains('[data-cy="leagues-archive-list-item"]', 'Server League').click();
    cy.get('[data-cy="leagues-archive-detail-read-only"]').should('exist');
    cy.get('[data-cy="leagues-archive-detail-editable-title"]').should('not.exist');
    cy.get('[data-cy="leagues-archive-detail-create-tournament-card"]').should('not.exist');

    cy.get('@localLeaguePath').then((path) => visit(path));
    cy.get('[data-cy="leagues-archive-detail-editable-title"]').should('exist');
    cy.get('[data-cy="leagues-archive-detail-read-only"]').should('not.exist');
    cy.get('[data-cy="leagues-archive-detail-create-tournament-card"]').should('exist');
  });
});
