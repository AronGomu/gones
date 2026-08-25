/**
 * The browser-local half of the Archive (ADR 0028), on the new `/archive/**` routes.
 *
 * What this spec proves: a record authored in this browser is unioned into Tab 1 and Tab 2 beside
 * the server's rows, is badged `Local only`, is never locked whatever its date, is bucketed into its
 * own calendar year, stays listed when the whole archive API answers 401 — and never, ever reaches
 * the public catalog cache `gones-archive-cache`, which a purge is allowed to delete.
 *
 * Signed out throughout, so it costs zero auth permits: the refresh call is stubbed 401 and never
 * leaves the browser.
 */
const LOCAL_ARCHIVE_DB_NAME = 'gones-archive-local';
const ARCHIVE_CACHE_DB_NAME = 'gones-archive-cache';
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

/** Write the three browser-local stores directly. Seeding the authority is what this spec is about —
 *  not how a record got there, which is the editing UI's own coverage. */
function seedLocalArchive(win, { leagues = [], leagueSeasons = [], tournaments = [] }) {
  return new Cypress.Promise((resolve, reject) => {
    const open = win.indexedDB.open(LOCAL_ARCHIVE_DB_NAME, 1);
    open.onupgradeneeded = () => {
      for (const store of ['leagues', 'league-seasons', 'tournaments']) {
        if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store, { keyPath: 'id' });
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(['leagues', 'league-seasons', 'tournaments'], 'readwrite');
      for (const row of leagues) transaction.objectStore('leagues').put(row);
      for (const row of leagueSeasons) transaction.objectStore('league-seasons').put(row);
      for (const row of tournaments) transaction.objectStore('tournaments').put(row);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  });
}

/** Both archive databases dropped, whatever their current state. A blocked delete resolves too: the
 *  next `open` recreates the stores anyway, and a hung promise here would fail every test. */
function dropArchiveDatabases(win) {
  const names = [LOCAL_ARCHIVE_DB_NAME, ARCHIVE_CACHE_DB_NAME];
  return Cypress.Promise.all(names.map((name) => new Cypress.Promise((resolve) => {
    const request = win.indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  })));
}

/** Every row of every `gones-archive-cache` store, for the purity assertion. Resolves `[]` when the
 *  database was never created — a browser that cached nothing has cached nothing local either. */
function readArchiveCacheRows(win) {
  return new Cypress.Promise((resolve, reject) => {
    const open = win.indexedDB.open(ARCHIVE_CACHE_DB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const stores = [...database.objectStoreNames];
      if (!stores.length) { database.close(); resolve([]); return; }
      const rows = [];
      const transaction = database.transaction(stores, 'readonly');
      for (const store of stores) {
        const request = transaction.objectStore(store).getAll();
        request.onsuccess = () => rows.push(...request.result);
      }
      transaction.oncomplete = () => { database.close(); resolve(rows); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  });
}

/** A deterministic start: both archive databases dropped, then the browser-local authority seeded. */
function visitArchive(path, { seed = {} } = {}) {
  cy.visit(path, {
    onBeforeLoad: (win) => {
      seedSettings(win);
      return dropArchiveDatabases(win).then(() => seedLocalArchive(win, seed));
    }
  });
  cy.window().then((win) => seedSettings(win));
  cy.reload();
}

const localLeague = {
  id: 'local-league-1', name: 'Browser League', createdAt: '2026-08-01T00:00:00Z',
  documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z'
};

const localSeason = {
  id: 'local-season-1', name: 'Browser Season', leagueId: 'local-league-1', status: 'active',
  documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z'
};

const localTournament = (id, name, tournamentDate) => ({
  id, name, seasonId: 'local-season-1', tournamentDate, status: 'completed',
  rounds: [], playerArchetypes: [], documentVersion: 1, updatedAt: '2026-08-01T00:00:00Z'
});

const LOCAL_SEED = {
  leagues: [localLeague],
  leagueSeasons: [localSeason],
  tournaments: [
    localTournament('local-t-1', 'Kitchen Table 2025', '2025-02-02'),
    localTournament('local-t-2', 'Kitchen Table 2019', '2019-05-04'),
    localTournament('local-t-old', 'Kitchen Table 1990', '1990-01-01')
  ]
};

const serverLeagueRow = {
  id: 'srv-league-1', name: 'Server League', createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z', documentVersion: 1
};

const serverSeasonRow = {
  id: 'srv-season-1', name: 'Server Season', leagueId: 'srv-league-1', status: 'active',
  updatedAt: '2026-01-02T00:00:00Z', documentVersion: 1, tournamentCount: 1, playerCount: 4,
  firstTournamentDate: '2025-03-03', lastTournamentDate: '2025-03-03'
};

const serverTournamentRow = (id, name, tournamentDate) => ({
  id, name, seasonId: 'srv-season-1', tournamentDate, status: 'completed',
  updatedAt: '2026-01-02T00:00:00Z', documentVersion: 1, playerCount: 4
});

const catalog = (items) => ({ items, totalCount: items.length, truncated: false });

/**
 * Every archive read the two tabs make, answered from a fixture and recorded. `years` knows only the
 * server's rows — 2019 and 1990 are reachable only because this browser holds a Tournament in them.
 */
function stubArchiveApi(recorded, { years = [{ year: 2025, locked: false, tournamentCount: 1 }] } = {}) {
  cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('refresh');
  const record = (req) => recorded.push(req.url);
  cy.intercept('GET', '**/api/archive/leagues/all', (req) => { record(req); req.reply(catalog([serverLeagueRow])); }).as('leagueCatalog');
  cy.intercept('GET', '**/api/archive/league-seasons/all', (req) => { record(req); req.reply(catalog([serverSeasonRow])); }).as('seasonCatalog');
  cy.intercept('GET', '**/api/archive/years', (req) => { record(req); req.reply({ years }); }).as('years');
  cy.intercept('GET', '**/api/archive/tournaments/all*', (req) => {
    record(req);
    const year = new URL(req.url).searchParams.get('year');
    const rows = year === '1990'
      ? [serverTournamentRow('srv-t-old', 'Server Day 1990', '1990-01-01')]
      : [serverTournamentRow('srv-t-1', 'Server Day 2025', '2025-03-03')];
    req.reply(catalog(year === '2025' || year === '1990' ? rows : []));
  }).as('yearCatalog');
  cy.intercept('GET', /\/api\/archive\/league-seasons\/[^/]+\/tournaments/, (req) => {
    record(req);
    req.reply(catalog([serverTournamentRow('srv-t-1', 'Server Day 2025', '2025-03-03')]));
  }).as('seasonTournaments');
}

/** Every archive read refused, recorded, so "the local half still renders" is a real assertion. */
function stubArchiveApiUnavailable(recorded) {
  cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('refresh');
  cy.intercept(/\/api\/archive\//, (req) => {
    recorded.push(req.url);
    req.reply({ statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } });
  }).as('archiveApi');
}

describe('Archive browser-local union (ADR 0028)', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('lists browser-local Seasons and Tournaments beside server ones in both tabs', () => {
    const recorded = [];
    stubArchiveApi(recorded);

    visitArchive('/archive/league-seasons', { seed: LOCAL_SEED });

    // Tab 1: two Seasons, one grid, different write rules — and only the browser one is badged.
    cy.get('[data-cy="archive-seasons-row-local-season-1"]').should('exist')
      .find('[data-cy="archive-seasons-local-badge-local-season-1"]').should('contain.text', 'Local only');
    cy.get('[data-cy="archive-seasons-row-srv-season-1"]').should('exist');
    cy.get('[data-cy="archive-seasons-local-badge-srv-season-1"]').should('not.exist');
    cy.get('[data-cy="archive-seasons-local-notice"]').should('contain.text', 'this browser only');
    cy.get('[data-cy="archive-seasons-error"]').should('not.exist');
    // The browser League is offered as a filter beside the server one: it is a catalog row too.
    cy.get('[data-cy="archive-seasons-league-option-local-league-1"]').should('exist');

    visitArchive('/archive/tournaments', { seed: LOCAL_SEED });

    // Tab 2 resolves the newest indexed year, which the union puts at 2025.
    cy.get('[data-cy="archive-tournaments-row-local-t-1"]').should('exist')
      .find('[data-cy="archive-tournaments-local-badge-local-t-1"]').should('contain.text', 'Local only');
    cy.get('[data-cy="archive-tournaments-row-srv-t-1"]').should('exist');
    cy.get('[data-cy="archive-tournaments-local-badge-srv-t-1"]').should('not.exist');
    cy.get('[data-cy="archive-tournaments-local-notice"]').should('contain.text', 'this browser only');
    cy.get('[data-cy="archive-tournaments-error"]').should('not.exist');
  });

  it('never locks a browser-local record however old it is', () => {
    const recorded = [];
    stubArchiveApi(recorded, {
      years: [{ year: 1990, locked: true, tournamentCount: 1 }, { year: 2025, locked: false, tournamentCount: 1 }]
    });

    visitArchive('/archive/tournaments?year=1990', { seed: LOCAL_SEED });

    // Same date, same table, opposite verdicts: the lock keys on the `local-` id prefix.
    cy.get('[data-cy="archive-tournaments-row-srv-t-old"]').should('exist');
    cy.get('[data-cy="archive-tournaments-lock-srv-t-old"]').should('exist');
    cy.get('[data-cy="archive-tournaments-row-local-t-old"]').should('exist');
    cy.get('[data-cy="archive-tournaments-lock-local-t-old"]').should('not.exist');
  });

  it('keeps browser-local records out of the public catalog cache', () => {
    const recorded = [];
    stubArchiveApi(recorded);

    visitArchive('/archive/league-seasons', { seed: LOCAL_SEED });
    cy.get('[data-cy="archive-seasons-expand-local-season-1"]').click();
    cy.get('[data-cy="archive-seasons-child-local-t-1"]').should('exist');
    cy.visit('/archive/tournaments');
    cy.get('[data-cy="archive-tournaments-row-local-t-1"]').should('exist');

    // The load-bearing invariant: the cache is a cache and may be purged; the local store is an
    // authority and may not. Nothing browser-authored is ever written into the former.
    cy.window().then((win) => readArchiveCacheRows(win)).then((rows) => {
      expect(rows.length, 'the public catalog cache was populated').to.be.greaterThan(0);
      const serialised = JSON.stringify(rows);
      expect(serialised, 'no browser-local id in gones-archive-cache').not.to.contain('local-');
      expect(serialised, 'no isLocal field in gones-archive-cache').not.to.contain('isLocal');
    });
  });

  it('buckets a browser-local Tournament under its own year', () => {
    const recorded = [];
    stubArchiveApi(recorded);

    visitArchive('/archive/tournaments?year=2025', { seed: LOCAL_SEED });

    // 2019 is in the index only because this browser holds a Tournament played in it.
    cy.get('[data-cy="archive-tournaments-year-option-2019"]').should('exist');
    cy.get('[data-cy="archive-tournaments-row-local-t-1"]').should('exist');
    cy.get('[data-cy="archive-tournaments-row-local-t-2"]').should('not.exist');

    cy.visit('/archive/tournaments?year=2019');
    cy.get('[data-cy="archive-tournaments-row-local-t-2"]').should('exist');
    cy.get('[data-cy="archive-tournaments-row-local-t-1"]').should('not.exist');
    // A local-only year has no server partition to fetch, so it costs no request.
    cy.then(() => {
      expect(recorded.filter((url) => url.includes('year=2019')), 'requests for the local-only year').to.have.length(0);
    });
  });

  it('survives a fully unavailable archive API', () => {
    const recorded = [];
    stubArchiveApiUnavailable(recorded);

    visitArchive('/archive/league-seasons', { seed: LOCAL_SEED });

    cy.get('[data-cy="archive-seasons-row-local-season-1"]').should('exist');
    cy.get('[data-cy="archive-seasons-error"]').should('not.exist');

    cy.visit('/archive/tournaments');
    cy.get('[data-cy="archive-tournaments-row-local-t-1"]').should('exist');
    cy.get('[data-cy="archive-tournaments-error"]').should('not.exist');

    cy.get('@archiveApi.all').then((calls) => {
      expect(calls.length, 'archive requests made').to.be.greaterThan(0);
      for (const call of calls) expect(call.response.statusCode, `response to ${call.request.url}`).to.eq(401);
    });
  });

  it('expands a browser-local Season without making a request', () => {
    const recorded = [];
    stubArchiveApi(recorded);

    visitArchive('/archive/league-seasons', { seed: LOCAL_SEED });
    cy.get('[data-cy="archive-seasons-expand-local-season-1"]').click();

    // Its own store answers: a `local-` Season has no server half, and asking would 404 forever.
    cy.get('[data-cy="archive-seasons-child-local-t-1"]').should('exist')
      .find('[data-cy="archive-seasons-child-local-local-t-1"]').should('contain.text', 'Local only');
    cy.get('[data-cy="archive-seasons-child-local-t-2"]').should('exist');
    cy.then(() => {
      const asked = recorded.filter((url) => /\/api\/archive\/league-seasons\/local-[^/]+\/tournaments/.test(url));
      expect(asked, 'read-through requests for a browser-local Season').to.have.length(0);
    });
  });
});

/**
 * The legacy browser-local League Archive — retires with the legacy pages.
 *
 * This one exercises `gones-leagues` and the `/leagues-archive` pages, not `gones-archive-local` and
 * `/archive/**`. No ticket in this plan has re-pointed the player page at the new store, so deleting
 * this coverage now would drop a proved capability with nothing replacing it.
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
 * Create one browser-local league, signed out — the only way one can be born (ADR 0028). Dialog
 * contents are asserted with `exist`, not `be.visible`: Material's open animation leaves the
 * container at opacity 0 under headless Electron, which Cypress reads as hidden while still allowing
 * the click.
 */
function createLocalLeague(name) {
  cy.get('[data-cy="leagues-archive-list-create-button"]').click();
  cy.contains('mat-dialog-container', 'New League').should('exist').within(() => {
    cy.get('input').type(name);
    cy.contains('button', 'Create League').click();
  });
  cy.location('pathname').should('match', /^\/leagues-archive\/local-.+$/);
}

describe('Legacy browser-local League Archive — retires with the legacy pages', () => {
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
});
