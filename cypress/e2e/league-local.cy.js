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
  win.localStorage.setItem('gones.settings.power-user', 'true');
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

/** The list reads the whole archive in one catalog request (ADR 0039); a detail page still reads one. */
function stubServerLeagueReads() {
  cy.intercept('GET', /\/api\/leagues-archive\/[^/?]+$/, serverLeague).as('leagueDetail');
  cy.intercept('GET', /\/api\/leagues-archive\/all(?:\/documents)?$/, { items: [serverLeague], totalCount: 1, truncated: false }).as('leagueList');
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

/**
 * The player page reads `GET /api/players/{playerName}` (ADR 0039 read model) and never downloads a
 * League document. Browser-local leagues can only ever reach it through the client-side merge, so
 * the server half is stubbed with one match nobody in this browser has.
 */
const serverPlayerPayload = {
  statistics: {
    position: 1, playerName: 'Alice', playedMatchCount: 1, matchWins: 1, matchLosses: 0, matchDraws: 0,
    matchWinrate: 1, playedGameCount: 2, gameWins: 2, gameLosses: 0, gameWinrate: 1,
    nemesis: null, rival: { name: 'Server Opponent', wins: 1, losses: 0 }, mostPlayedArchetype: null
  },
  matches: [{
    kind: 'match', leagueId: 'server-league-1', leagueName: 'Server League',
    tournamentId: 'server-tournament-1', tournamentName: 'Server Day 1', tournamentDate: '2026-03-05',
    roundIndex: 0, opponentName: 'Server Opponent', ownScore: 2, opponentScore: 0,
    ownArchetype: '', opponentArchetype: ''
  }],
  totalMatchCount: 1,
  truncated: false
};

function stubSignedOut(leagueApiCalls) {
  cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('refresh');
  cy.intercept(/\/api\/leagues-archive/, (req) => {
    leagueApiCalls.push(req.url);
    req.reply({ statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } });
  }).as('leagueApi');
}

/**
 * Capture what `saveJsonFile` hands to the browser. The export builds a Blob and clicks an anchor,
 * so stubbing `URL.createObjectURL` reads the artifact without waiting on a real download.
 */
function captureDownloads() {
  cy.window().then((win) => {
    win.__gonesDownloads = [];
    const original = win.URL.createObjectURL.bind(win.URL);
    cy.stub(win.URL, 'createObjectURL').callsFake((blob) => {
      win.__gonesDownloads.push(blob);
      return original(blob);
    });
  });
}

/** The text of the first captured download, as a Cypress subject. */
function readCapturedDownload() {
  return cy.window().its('__gonesDownloads.0').then((blob) => new Cypress.Promise((resolve, reject) => blob.text().then(resolve, reject)));
}

/** Delete one league through the header menu, the only delete affordance a local league has. */
function deleteLeague(name) {
  visit('/leagues-archive');
  cy.contains('[data-cy="leagues-archive-list-item"]', name).click();
  cy.get('[data-cy="app-league-actions-trigger"]').click();
  cy.get('[data-cy="app-delete-league-button"]').click();
  cy.get('[data-cy="confirm-dialog-confirm"]').click();
  cy.location('pathname').should('eq', '/leagues-archive');
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

    cy.get('[data-cy="tournament-archive-detail-edit"]').click();
    cy.get('[data-cy="tournament-archive-detail-add-round"]').click();
    cy.contains('mat-expansion-panel', 'Round 1').find('mat-expansion-panel-header').click();
    cy.get('[data-cy="tournament-archive-detail-add-match"]').click();
    cy.get('[data-cy="tournament-archive-detail-round-entry-row"]').should('have.length', 1);

    cy.get('[data-cy="tournament-archive-detail-match-player1-input"]').clear().type('Alice');
    cy.get('[data-cy="tournament-archive-detail-match-player1-score-input"]').clear().type('2');
    cy.get('[data-cy="tournament-archive-detail-match-player2-input"]').clear().type('Bob');
    cy.get('[data-cy="tournament-archive-detail-match-player2-score-input"]').clear().type('0');
    cy.document().trigger('keydown', { key: 's', code: 'KeyS', ctrlKey: true, force: true });
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.get('[data-cy="tournament-archive-detail-edit"]').should('exist');
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

    cy.get('[data-cy="tournament-archive-detail-edit"]').click();
    cy.get('[data-cy="tournament-archive-detail-league-select"]').click();
    cy.contains('mat-option', 'Server League').should('not.exist');
    cy.get('body').type('{esc}');

    // No cross-authority target can be staged; the tournament stays in its browser League.
    cy.location('pathname').should('match', /^\/leagues-archive\/local-[^/]+\/tournaments-archive\/[^/]+$/);
    cy.get('[data-cy="tournament-archive-detail-cancel-edit"]').click();
  });

  it('exports both browser leagues and imports them back into an emptied browser', () => {
    cy.viewport(1280, 800);

    const leagueApiCalls = [];
    stubSignedOut(leagueApiCalls);

    visit('/leagues-archive', { clearLocalStore: true });

    for (const name of ['Export League A', 'Export League B']) {
      createLocalLeague(name);
      cy.get('[data-cy="leagues-archive-detail-create-tournament-card"]').click();
      cy.location('pathname').should('match', /^\/leagues-archive\/local-[^/]+\/tournaments-archive\/[^/]+$/);
      visit('/leagues-archive');
    }

    // The import affordance is offered to a visitor with no account at all (ADR 0028).
    cy.get('[data-cy="app-leagues-import-button"]').should('exist');

    captureDownloads();
    cy.get('[data-cy="app-full-data-export-button"]').click();
    readCapturedDownload().then((text) => {
      const bundle = JSON.parse(text);
      expect(bundle.kind, 'export kind').to.eq('fullData');
      // Both browser leagues are in the file, and neither placeholder is: the bucket is not a league.
      // Scoped by name rather than by count: Cypress keeps the previous test's page alive, so its
      // `deleteDatabase` can be blocked and leave that test's league in this browser.
      const names = bundle.leagues.map((league) => league.name);
      expect(names, 'exported league names').to.include('Export League A').and.to.include('Export League B');
      expect(bundle.leagues.every((league) => league.id.startsWith('local-')), 'every exported id is browser-local').to.eq(true);
      expect(text, 'no placeholder league in the bundle').not.to.contain('placeholder-league');
      cy.wrap(text).as('exportedBundle');
    });

    deleteLeague('Export League A');
    deleteLeague('Export League B');
    cy.contains('[data-cy="leagues-archive-list-item"]', 'Export League').should('not.exist');

    cy.get('@exportedBundle').then((text) => {
      cy.get('[data-cy="header-import-input"]').selectFile(
        { contents: Cypress.Buffer.from(text), fileName: 'gones-full-data.gones.json', mimeType: 'application/json' },
        { force: true }
      );
    });
    // The import lands in the browser store, so it navigates to a `local-` league, not a server one.
    cy.location('pathname').should('match', /^\/leagues-archive\/local-.+$/);
    assertNoErrorBanner();

    visit('/leagues-archive');
    for (const name of ['Export League A', 'Export League B']) {
      cy.contains('[data-cy="leagues-archive-list-item"]', name).should('exist')
        .find('[data-cy="leagues-archive-list-item-local-badge"]').should('exist');
    }

    // The tournaments came back with them, in the browser store and nowhere else. Restore is
    // additive and uniquifies names, so a leftover league from a blocked `deleteDatabase` (see the
    // comment above) turns into an extra `X (restored)` row: a fixed row count would assert the
    // leftovers, not the restore. The intent is that both exported leagues are back, browser-local,
    // and each carries its one tournament.
    readLocalLeagueRows().then((rows) => {
      const restored = rows.filter((row) => row.name.startsWith('Export League'));
      const restoredNames = restored.map((row) => row.name);
      for (const name of ['Export League A', 'Export League B']) {
        expect(restoredNames, 'restored gones-leagues rows').to.include(name);
      }
      for (const row of restored) {
        expect(row.id, 'restored league id').to.match(/^local-/);
        expect(row.tournaments, `tournaments of ${row.name}`).to.have.length(1);
      }
    });

    cy.get('@leagueApi.all').then((calls) => {
      for (const call of calls) expect(call.response.statusCode, `response to ${call.request.url}`).to.eq(401);
    });
  });

  it('folds this browser\u2019s matches into the player page only while Online-only is off', () => {
    cy.viewport(1280, 800);

    const leagueApiCalls = [];
    stubSignedOut(leagueApiCalls);
    cy.intercept('GET', /\/api\/players\//, serverPlayerPayload).as('playerDetail');

    visit('/leagues-archive', { clearLocalStore: true });
    createLocalLeague('Badge League');

    cy.get('[data-cy="leagues-archive-detail-create-tournament-card"]').click();
    cy.get('[data-cy="tournament-archive-detail-edit"]').click();
    cy.get('[data-cy="tournament-archive-detail-add-round"]').click();
    cy.contains('mat-expansion-panel', 'Round 1').find('mat-expansion-panel-header').click();
    cy.get('[data-cy="tournament-archive-detail-add-match"]').click();
    cy.get('[data-cy="tournament-archive-detail-match-player1-input"]').clear().type('Alice');
    cy.get('[data-cy="tournament-archive-detail-match-player1-score-input"]').clear().type('2');
    cy.get('[data-cy="tournament-archive-detail-match-player2-input"]').clear().type('Browser Opponent');
    cy.get('[data-cy="tournament-archive-detail-match-player2-score-input"]').clear().type('1');
    cy.document().trigger('keydown', { key: 's', code: 'KeyS', ctrlKey: true, force: true });
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.get('[data-cy="tournament-archive-detail-edit"]').should('exist');

    // Statistics count completed Archive Tournaments only — the server read model excludes an active
    // one, and the browser half now obeys the same rule — so this browser-local Tournament is marked
    // complete before it may fold into the player page.
    cy.get('[data-cy="archive-tournament-complete-toggle"]').click();
    cy.get('[data-cy="confirm-dialog-confirm"]').should('have.length', 1).click();
    cy.get('[data-cy="archive-tournament-status-badge"]').should('have.class', 'completed');

    // Everything the League Archive pages asked for is history; what matters is what the player
    // page asks for, so the count is snapshotted here and re-read at the end.
    cy.then(() => cy.wrap(leagueApiCalls.length).as('leagueCallsBeforePlayerPage'));
    visit('/players/Alice');

    // Online-only is the default: exactly the server's row, and no League download at all.
    cy.wait('@playerDetail');
    cy.get('[data-cy="player-stat-value-played-matches"]').should('have.text', '1');
    cy.get('[data-cy="match-card"]').should('have.length', 1);
    cy.get('[data-cy="player-match-local"]').should('not.exist');
    cy.contains('[data-cy="match-card"]', 'Browser Opponent').should('not.exist');
    cy.get('[data-cy="player-sync-button"]').should('exist');
    cy.get('[data-cy="match-own-archetype"]').should('exist');
    cy.get('[data-cy="match-own-archetype"]').click();
    cy.get('[data-cy="match-filter-input"]').should('not.have.value', '');
    cy.get('[data-cy="match-card"]').should('have.length', 1);
    cy.get('[data-cy="match-filter-clear"]').click();

    // Off: this browser's league is added to the totals and to the history, and marked.
    cy.get('[data-cy="player-online-only-toggle"]').click();
    cy.get('[data-cy="player-stat-value-played-matches"]').should('have.text', '2');
    cy.get('[data-cy="match-card"]').should('have.length', 2);
    cy.get('[data-cy="player-match-local"]').should('have.length', 1);
    cy.contains('[data-cy="match-card"]', 'Browser Opponent').find('[data-cy="player-match-local"]').should('exist');
    cy.contains('[data-cy="match-card"]', 'Server Opponent').find('[data-cy="player-match-local"]').should('not.exist');

    // Back on: the local half disappears and the totals are the server's again — never doubled.
    cy.get('[data-cy="player-online-only-toggle"]').click();
    cy.get('[data-cy="player-stat-value-played-matches"]').should('have.text', '1');
    cy.get('[data-cy="match-card"]').should('have.length', 1);
    cy.get('[data-cy="player-match-local"]').should('not.exist');

    // The page never asked for a League document; the whole server half came from one player call.
    cy.get('@leagueCallsBeforePlayerPage').then((before) => {
      expect(leagueApiCalls.length, 'League Archive requests made from the player page').to.eq(before);
    });
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
