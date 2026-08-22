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

function commandResponse(league) {
  return { ...league, updatedAt: '2026-08-02T00:00:00Z', eTag: etag(league.documentVersion) };
}

/**
 * One row of the slim catalog (ADR 0042). The real server denormalizes both counts onto the
 * aggregate; this stub derives them from its own state so a Tournament created mid-spec shows up in
 * the numbers the card prints.
 */
function catalogItem(league) {
  const players = new Set();
  for (const tournament of league.tournaments) {
    for (const round of tournament.rounds ?? []) {
      for (const entry of round.entries ?? []) {
        if (entry.player1Name) players.add(entry.player1Name);
        if (entry.player2Name) players.add(entry.player2Name);
      }
    }
  }
  return {
    id: league.id,
    name: league.name,
    status: league.status,
    updatedAt: '2026-08-02T00:00:00Z',
    documentVersion: league.documentVersion,
    tournamentCount: league.tournaments.length,
    playerCount: players.size
  };
}

function mockSession(globalRole = 'Organizer') {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' }).as('refresh');
  cy.intercept('GET', '**/api/users/me', { ...profile, globalRole }).as('profile');
}

function mockLeagueServer() {
  let next = 1;
  const leagues = [];
  const bump = league => { league.documentVersion += 1; return commandResponse(league); };
  const find = id => leagues.find(league => league.id === id);

  cy.intercept('GET', /\/api\/leagues-archive\/[^/?]+$/, req => {
    const league = find(decodeURIComponent(req.url.split('/').pop()));
    req.reply(league ? commandResponse(league) : { statusCode: 404, body: { code: 'not_found', message: 'Missing.' } });
  }).as('leagueDetail');
  // The list page reads the whole archive in one catalog request (ADR 0039), not a summary page plus
  // a detail per League. Registered after the detail route because that pattern also matches `/all`
  // and Cypress gives precedence to the intercept declared last.
  //
  // Two routes, two bodies (ADR 0042): `/all` answers slim summary rows for the list page, and
  // `/all/documents` answers whole documents for the Settings export. One widened stub would let the
  // list read a document body and silently pass with no counts in it.
  cy.intercept('GET', /\/api\/leagues-archive\/all\/documents$/, req => req.reply({
    items: leagues.map(commandResponse),
    totalCount: leagues.length,
    truncated: false
  })).as('leagueDocuments');
  cy.intercept('GET', /\/api\/leagues-archive\/all$/, req => req.reply({
    items: leagues.map(catalogItem),
    totalCount: leagues.length,
    truncated: false
  })).as('leagueList');
  cy.intercept('POST', /\/api\/leagues-archive$/, req => {
    expect(req.headers['idempotency-key']).to.be.a('string').and.not.be.empty;
    const league = { id: `league-${next++}`, name: req.body.name, status: 'active', tournaments: [], documentVersion: 1 };
    leagues.push(league);
    req.reply({ statusCode: 201, body: commandResponse(league) });
  }).as('createLeague');
  cy.intercept('PATCH', /\/api\/leagues-archive\/[^/]+\/name$/, req => {
    const league = find(req.url.split('/').at(-2));
    expect(req.headers['if-match']).to.eq(etag(league.documentVersion));
    league.name = req.body.name;
    req.reply(bump(league));
  }).as('renameLeague');
  cy.intercept('POST', /\/api\/leagues-archive\/[^/]+\/tournaments-archive$/, req => {
    const league = find(req.url.split('/').at(-2));
    expect(req.headers['if-match']).to.eq(etag(league.documentVersion));
    league.tournaments.push({ id: `tournament-${next++}`, leagueId: league.id, name: req.body.name, tournamentDate: req.body.tournamentDate, rounds: [], playerArchetypes: [] });
    req.reply(bump(league));
  }).as('createTournament');
  cy.intercept('POST', /\/api\/leagues-archive\/[^/]+\/tournaments-archive\/[^/]+\/edit-batch$/, req => {
    const segments = new URL(req.url).pathname.split('/');
    const league = find(segments[3]);
    expect(req.headers['if-match']).to.eq(etag(league.documentVersion));
    const tournament = league.tournaments.find(item => item.id === segments[5]);
    if (req.body.editTournament) Object.assign(tournament, req.body.editTournament);
    const deleteIds = new Set(req.body.deleteRoundIds);
    const replacements = new Map(req.body.replaceRounds.map(intent => [intent.roundId, intent.entries]));
    tournament.rounds = tournament.rounds
      .filter(round => !deleteIds.has(round.id))
      .map(round => replacements.has(round.id) ? { ...round, entries: replacements.get(round.id) } : round)
      .concat(req.body.addRounds.map(intent => ({ id: intent.roundId, entries: intent.entries })));
    for (const intent of req.body.updateArchetypes) {
      const existing = tournament.playerArchetypes.find(row => row.playerName === intent.playerName);
      if (existing) existing.archetype = intent.archetype;
      else tournament.playerArchetypes.push({ playerName: intent.playerName, archetype: intent.archetype });
    }
    req.reply({ sourceLeague: bump(league), destinationLeague: null });
  }).as('editBatch');
  cy.intercept('PATCH', /\/api\/leagues-archive\/[^/]+\/tournaments-archive\/[^/]+$/, req => {
    const segments = new URL(req.url).pathname.split('/');
    const league = find(segments[3]);
    expect(req.headers['if-match']).to.eq(etag(league.documentVersion));
    const tournament = league.tournaments.find(item => item.id === segments[5]);
    Object.assign(tournament, req.body);
    req.reply(bump(league));
  }).as('editTournament');
  cy.intercept('POST', /\/api\/leagues-archive\/[^/]+\/tournaments-archive\/[^/]+\/rounds$/, req => {
    const segments = new URL(req.url).pathname.split('/');
    const league = find(segments[3]);
    expect(req.headers['if-match']).to.eq(etag(league.documentVersion));
    league.tournaments.find(item => item.id === segments[5]).rounds.push({ id: `round-${next++}`, entries: [] });
    req.reply(bump(league));
  }).as('addRound');
  cy.intercept('POST', /\/api\/leagues-archive\/[^/]+\/tournaments-archive\/[^/]+\/rounds\/[^/]+\/import$/, req => {
    const segments = new URL(req.url).pathname.split('/');
    const league = find(segments[3]);
    expect(req.headers['if-match']).to.eq(etag(league.documentVersion));
    const tournament = league.tournaments.find(item => item.id === segments[5]);
    const round = tournament.rounds.find(item => item.id === segments[7]);
    round.entries = req.body.text.trim().split('\n').map((line, index) => {
      const [table, player1Name, result, player2Name, player1DeckArchetype = '', player2DeckArchetype = ''] = line.split(',');
      const scores = result.match(/(\d+)-(\d+)/);
      return { kind: 'match', id: `entry-${next++}`, table, player1Name, player2Name, player1Score: Number(scores[1]), player2Score: Number(scores[2]), player1DeckArchetype, player2DeckArchetype };
    });
    tournament.playerArchetypes = round.entries.flatMap(entry => [
      { playerName: entry.player1Name, archetype: entry.player1DeckArchetype },
      { playerName: entry.player2Name, archetype: entry.player2DeckArchetype }
    ]).sort((a, b) => a.playerName.localeCompare(b.playerName));
    req.reply(bump(league));
  }).as('importRound');
  cy.intercept('PATCH', /\/api\/leagues-archive\/[^/]+\/tournaments-archive\/[^/]+\/rounds\/[^/]+\/entries\/[^/]+$/, req => {
    const segments = new URL(req.url).pathname.split('/');
    const league = find(segments[3]);
    expect(req.headers['if-match']).to.eq(etag(league.documentVersion));
    const round = league.tournaments.find(item => item.id === segments[5]).rounds.find(item => item.id === segments[7]);
    round.entries = round.entries.map(entry => entry.id === segments[9] ? { ...req.body, id: entry.id } : entry);
    req.reply(bump(league));
  }).as('editEntry');
  cy.intercept('PATCH', /\/api\/leagues-archive\/[^/]+\/tournaments-archive\/[^/]+\/archetypes\/.+$/, req => {
    const segments = new URL(req.url).pathname.split('/');
    const league = find(segments[3]);
    const playerName = decodeURIComponent(segments[7]);
    const tournament = league.tournaments.find(item => item.id === segments[5]);
    tournament.playerArchetypes = tournament.playerArchetypes.map(row => row.playerName === playerName ? { ...row, archetype: req.body.archetype } : row);
    req.reply(bump(league));
  }).as('archetype');
  cy.intercept('POST', '**/api/leagues-archive/restore', req => {
    expect(req.headers['idempotency-key']).to.be.a('string').and.not.be.empty;
    const league = { ...req.body.league, id: `league-${next++}`, name: `${req.body.league.name} (restored)`, tournaments: [], documentVersion: 1 };
    leagues.push(league);
    req.reply({ statusCode: 201, body: commandResponse(league) });
  }).as('restoreLeague');
  cy.intercept('DELETE', /\/api\/leagues-archive\/[^/]+\/tournaments-archive\/[^/]+$/, req => {
    const segments = new URL(req.url).pathname.split('/');
    const league = find(segments[3]);
    league.tournaments = league.tournaments.filter(item => item.id !== segments[5]);
    req.reply(bump(league));
  }).as('deleteTournament');
  cy.intercept('DELETE', /\/api\/leagues-archive\/[^/]+$/, req => {
    const id = new URL(req.url).pathname.split('/').pop();
    const index = leagues.findIndex(item => item.id === id);
    const league = leagues[index];
    expect(req.headers['if-match']).to.eq(etag(league.documentVersion));
    leagues.splice(index, 1);
    req.reply({ id, deleted: true, documentVersion: league.documentVersion + 1, eTag: etag(league.documentVersion + 1) });
  }).as('deleteLeague');

  return { leagues, find };
}

const SEED_MARKER = 'gones.e2e.storage-seeded';

function seed(win) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  win.localStorage.setItem('gones.settings.power-user', 'true');
  win.localStorage.setItem(SEED_MARKER, 'true');
}

// `onBeforeLoad` is not dependable on the release topology: once `ngsw-worker.js` controls the page it
// answers the navigation out of Cache Storage, that response never passes through the Cypress proxy,
// and Cypress cannot inject the script that calls the hook — no error, no seed, so the Power User
// gates below stay shut. The marker is how the skip is detected; re-seeding from the loaded page and
// raising `storage` the way a browser does for a change made in another tab then covers it. Same
// technique as `offline-public-read.cy.js`. Every visit here seeds the same two values, so the marker
// alone settles whether they landed.
function visit(path) {
  cy.visit(path, { onBeforeLoad(win) { seed(win); } });
  cy.window({ log: false }).then(win => {
    if (win.localStorage.getItem(SEED_MARKER) === 'true') return;
    seed(win);
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings', newValue: win.localStorage.getItem('gones.settings') }));
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings.power-user', newValue: 'true' }));
  });
}

describe('League server command flows', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('runs create → round import → edit → result/stats → export/restore → delete with server responses', () => {
    mockSession();
    mockLeagueServer();
    visit('/leagues-archive');

    cy.get('[data-cy="leagues-archive-list-create-button"]').click();
    cy.contains('mat-dialog-container', 'New League').within(() => {
      cy.get('input').type('Server League');
      cy.contains('button', 'Create League').click();
    });
    cy.wait('@createLeague');
    cy.contains('h1 button', 'Server League').click();
    cy.get('[data-cy="leagues-archive-detail-name-input"]').clear().type('Server League Renamed{enter}');
    cy.wait('@renameLeague');

    cy.get('[data-cy="leagues-archive-detail-create-tournament-card"]').click();
    cy.wait('@createTournament');
    cy.location('pathname').should('match', /^\/leagues-archive\/[^/]+\/tournaments-archive\/[^/]+$/);
    cy.get('[data-cy="tournament-archive-detail-edit"]').click();
    cy.get('[data-cy="tournament-archive-detail-name-input"]').clear().type('Server Result');
    cy.contains('button', 'Add Round').click();
    cy.contains('mat-expansion-panel', 'Round 1').find('mat-expansion-panel-header').click();
    cy.get('[data-cy="tournament-archive-detail-round-import-input"]').type('1,Alice,Won 2-0,Bob,Control,Tempo', { parseSpecialCharSequences: false });
    cy.contains('button', 'Import Round Data').click();
    cy.get('input[aria-label="Round 1, entry 1: player 1"]').clear().type('Alicia');
    cy.document().trigger('keydown', { key: 's', code: 'KeyS', ctrlKey: true, force: true });
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.wait('@editBatch');
    cy.get('[data-cy="ranking-table"]').should('contain', 'Alicia').and('contain', 'Bob');

    cy.get('[data-cy="tournament-result-link"]').click();
    cy.get('[data-cy="tournament-archive-result-page"]').should('contain', 'Server Result').and('contain', '2').and('contain', '1');
    // The result page does not scroll, so anything fixed to the bottom of the viewport sits on top of
    // its own footer links for good: no scroll can move them apart. Assert the link owns its own
    // centre point before clicking it, so a bar re-covering it fails here instead of surfacing as an
    // unexplained `cy.click()` timeout.
    cy.get('[data-cy="tournament-archive-result-back-to-tournament"]').should($link => {
      const box = $link[0].getBoundingClientRect();
      const atCentre = $link[0].ownerDocument.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      expect($link[0].contains(atCentre), `Back to Tournament must own its centre point, but ${atCentre && atCentre.outerHTML.slice(0, 120)} covers it`).to.equal(true);
    });
    cy.contains('a', 'Back to Tournament').click();
    cy.contains('a.back-button', 'Back to League').first().click();
    cy.contains('button', 'Export League').click();
    cy.contains('[data-cy="leagues-archive-detail-tournament-grid"] a', 'Server Result').click();
    cy.get('button[aria-label="Tournament actions"]').click();
    cy.contains('button', 'Delete Tournament').click();
    cy.contains('mat-dialog-container', 'Delete Tournament').within(() => cy.contains('button', 'Delete Tournament').click());
    cy.wait('@deleteTournament');
    cy.location('pathname').should('match', /^\/leagues-archive\/[^/]+$/);

    cy.contains('a.back-button', 'Back to Leagues').first().click();
    const restore = { kind: 'league', gonesDataVersion: 3, gonesAppVersion: 'test', exportedAt: '2026-08-02T00:00:00Z', league: { id: 'old', name: 'Imported', status: 'active', tournaments: [] } };
    cy.get('[data-cy="header-import-input"]').selectFile({ contents: Cypress.Buffer.from(JSON.stringify(restore)), fileName: 'restore.json', mimeType: 'application/json' }, { force: true });
    cy.wait('@restoreLeague');
    cy.contains('h1 button', 'Imported (restored)').should('be.visible');
    cy.get('button[aria-label="League actions"]').click();
    cy.contains('button', 'Delete League').click();
    cy.contains('mat-dialog-container', 'Delete League').within(() => cy.contains('button', 'Delete League').click());
    cy.wait('@deleteLeague');
    cy.location('pathname').should('eq', '/leagues-archive');
  });

  it('redirects every retired league URL onto the archive surface, parameters intact', () => {
    mockLeagueServer();
    mockSession();

    visit('/leagues');
    cy.location('pathname').should('eq', '/leagues-archive');
    // The header import button belongs to the archive list and survives the rename.
    cy.get('[data-cy="header-import-input"]').should('exist');

    // Each redirect must also land on the renamed *component*, not on the catch-all 404 route.
    // The mock server knows no league 'abc', so each archive page renders its own not-found panel.
    visit('/leagues/abc');
    cy.location('pathname').should('eq', '/leagues-archive/abc');
    cy.get('[data-cy="leagues-archive-detail-not-found"]').should('exist');

    visit('/leagues/abc/tournaments/def');
    cy.location('pathname').should('eq', '/leagues-archive/abc/tournaments-archive/def');
    cy.get('[data-cy="tournament-archive-detail-not-found"]').should('exist');

    visit('/leagues/abc/tournaments/def/result');
    cy.location('pathname').should('eq', '/leagues-archive/abc/tournaments-archive/def/result');
    cy.get('[data-cy="tournament-archive-result-not-found"]').should('exist');

    visit('/leagues/abc/tournaments/def/result/metagames');
    cy.location('pathname').should('eq', '/leagues-archive/abc/tournaments-archive/def/result/metagames');
    cy.get('[data-cy="tournament-archive-result-not-found"]').should('exist');
  });

  it('shows the sync bar, serves from cache on reload, and refetches on sync click', () => {
    mockSession();
    mockLeagueServer();
    visit('/leagues-archive');
    cy.wait('@leagueList');
    cy.get('[data-cy="leagues-archive-list-sync-button"]').should('be.visible');
    cy.reload();
    cy.get('[data-cy="leagues-archive-list-grid"]').should('exist');
    cy.get('[data-cy="leagues-archive-list-sync-button"]').click();
    cy.wait('@leagueList');
  });

  /**
   * ADR 0042: the card prints the two numbers the catalog carries, and the list never asks for the
   * documents route at all — that payload is the 1.44 MB this slice exists to stop downloading.
   */
  it('prints the catalog counts on the list card and never fetches the documents', () => {
    const state = mockLeagueServer();
    state.leagues.push({
      id: 'league-counted', name: 'Counted League', status: 'active', documentVersion: 1,
      tournaments: [
        { id: 'tournament-a', leagueId: 'league-counted', name: 'Day One', tournamentDate: '2026-08-01', status: 'active', playerArchetypes: [], rounds: [{ id: 'round-a', entries: [
          { kind: 'match', id: 'entry-a', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0 },
          { kind: 'match', id: 'entry-b', table: '2', player1Name: 'Carol', player2Name: 'Alice', player1Score: 2, player2Score: 1 }
        ] }] },
        { id: 'tournament-b', leagueId: 'league-counted', name: 'Day Two', tournamentDate: '2026-08-02', status: 'active', playerArchetypes: [], rounds: [] }
      ]
    });
    mockSession();
    visit('/leagues-archive');
    cy.wait('@leagueList');
    // The production build's service worker may reset the language to French via a storage event
    // triggered during page load. Dispatching here forces the app to re-read 'en' after it has
    // settled, so the assertion sees English text.
    cy.window().then(win => {
      win.localStorage.setItem('gones.settings.language', 'en');
      win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
      win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings', newValue: win.localStorage.getItem('gones.settings') }));
    });

    cy.contains('[data-cy="leagues-archive-list-item"]', 'Counted League')
      .find('[data-cy="leagues-archive-list-item-meta"]')
      .should('have.text', '2 Tournaments · 3 Players');
    cy.get('@leagueDocuments.all').should('have.length', 0);
  });

  it('paginates the archive list in the browser and issues the catalog request exactly once', () => {
    const state = mockLeagueServer();
    for (let i = 0; i < 30; i++) {
      state.leagues.push({ id: `paginated-league-${i}`, name: `Paginated League ${i}`, status: 'active', tournaments: [], documentVersion: 1 });
    }
    mockSession();
    visit('/leagues-archive');
    cy.wait('@leagueList');

    // The paginator is visible because 30 leagues exceed the default page size.
    cy.get('[data-cy="leagues-archive-list-pagination"]').should('be.visible');
    cy.get('[data-cy="leagues-archive-list-page-previous"]').should('be.disabled');
    cy.get('[data-cy="leagues-archive-list-page-next"]').should('not.be.disabled');

    // Clicking next shows a different slice without issuing a second /all request.
    cy.get('[data-cy="leagues-archive-list-page-next"]').click();
    cy.get('[data-cy="leagues-archive-list-page-previous"]').should('not.be.disabled');
    cy.get('[data-cy="leagues-archive-list-page-next"]').should('be.disabled');

    // The entire flow used exactly one catalog request.
    cy.get('@leagueList.all').should('have.length', 1);
  });

  it('shows a Rating column on the league standings table when the catalog loads', () => {
    const state = mockLeagueServer();
    state.leagues.push({
      id: 'league-ratings', name: 'Ratings League', status: 'active', documentVersion: 1,
      tournaments: [{
        id: 't-ratings', leagueId: 'league-ratings', name: 'Cup', tournamentDate: '2026-08-01',
        status: 'completed', playerArchetypes: [], rounds: [{ id: 'r-1', entries: [
          { kind: 'match', id: 'e-1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0 }
        ] }]
      }]
    });
    mockSession();
    // Seed the catalog cache directly in localStorage so the rating column is always rendered
    // regardless of the real API state. A fresh fetchedAt makes the cache hit the non-stale path,
    // so no network request is needed and the test is deterministic.
    const seedCatalog = [
      { position: 1, playerName: 'Alice', rating: 1524, lastRatingDelta: 0, tournamentsPlayed: 5, provisional: false, inactive: false, ratingDeviation: 45, previousRating: 1524, lastPlayedDate: '2026-08-01', decayedRating: null, playedMatchCount: 10, matchWins: 7, matchLosses: 2, matchDraws: 1, matchWinrate: 0.7, playedGameCount: 20, gameWins: 14, gameLosses: 6, gameWinrate: 0.7, nemesis: null, rival: null, mostPlayedArchetype: null },
      { position: 2, playerName: 'Bob', rating: 1480, lastRatingDelta: 0, tournamentsPlayed: 5, provisional: false, inactive: false, ratingDeviation: 45, previousRating: 1480, lastPlayedDate: '2026-08-01', decayedRating: null, playedMatchCount: 10, matchWins: 5, matchLosses: 4, matchDraws: 1, matchWinrate: 0.5, playedGameCount: 20, gameWins: 10, gameLosses: 10, gameWinrate: 0.5, nemesis: null, rival: null, mostPlayedArchetype: null },
    ];
    // Mock the catalog API so the rating values are always available, regardless of whether the
    // localStorage seed is used (fresh cache) or bypassed (the app falls through to the network).
    cy.intercept('GET', '**/api/leagues-archive/global-player-statistics/all', { items: seedCatalog, totalCount: seedCatalog.length, truncated: false }).as('globalStatsCatalog');
    const seedRatings = win => {
      win.localStorage.setItem('gones.settings.language', 'en');
      win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
      win.localStorage.setItem('gones.settings.power-user', 'true');
      // Fresh fetchedAt keeps the app out of the network path entirely, so the production service
      // worker cannot intercept the catalog request before Cypress's cy.intercept can.
      win.localStorage.setItem('gones.global-stats.catalog', JSON.stringify({
        items: seedCatalog, fetchedAt: new Date().toISOString(), truncated: false
      }));
      win.localStorage.setItem('gones.e2e.ratings-seeded', 'true');
    };
    cy.visit('/leagues-archive/league-ratings', { onBeforeLoad(win) { seedRatings(win); } });
    // onBeforeLoad is not called when the service worker serves the navigation from its own cache
    // (the document never travels through the Cypress proxy). Mirror the pattern from
    // offline-public-read.cy.js: detect the skip and re-seed post-load, then dispatch a storage
    // event so Angular picks up the catalog without a page reload.
    cy.window({ log: false }).then(win => {
      if (win.localStorage.getItem('gones.e2e.ratings-seeded') !== 'true') {
        seedRatings(win);
        win.dispatchEvent(new win.StorageEvent('storage', {
          key: 'gones.global-stats.catalog',
          newValue: win.localStorage.getItem('gones.global-stats.catalog')
        }));
      }
    });
    cy.wait('@leagueDetail');
    cy.get('[data-cy="leagues-archive-detail-ranking-table"]').within(() => {
      cy.get('[data-cy="ranking-header-rating"]').should('exist');
      cy.get('[data-cy="ranking-cell-rating-1"]').should('have.text', '1524');
    });
  });

  it('shows User read-only controls plus explicit 403 and 412 reload recovery', () => {
    const state = mockLeagueServer();
    state.leagues.push({ id: 'league-role', name: 'Role League', status: 'active', tournaments: [], documentVersion: 1 });
    mockSession('User');
    visit('/leagues-archive/league-role');
    cy.get('[data-cy="leagues-archive-detail-read-only"]').should('be.visible');
    cy.get('h1 button.editable-title').should('not.exist');
    cy.get('[data-cy="leagues-archive-detail-create-tournament-card"]').should('not.exist');

    mockSession('Organizer');
    let stale = true;
    cy.intercept('PATCH', '**/api/leagues-archive/league-role/name', req => {
      if (stale) {
        stale = false;
        req.reply({ statusCode: 412, body: { code: 'stale_etag', message: 'Stale.' }, headers: { 'content-type': 'application/problem+json' } });
      } else {
        req.reply({ statusCode: 403, body: { code: 'forbidden', message: 'Forbidden.' }, headers: { 'content-type': 'application/problem+json' } });
      }
    }).as('rejectedRename');
    visit('/leagues-archive/league-role');
    cy.contains('h1 button', 'Role League').click();
    cy.get('[data-cy="leagues-archive-detail-name-input"]').clear().type('Stale Name{enter}');
    cy.wait('@rejectedRename');
    cy.get('[data-cy="leagues-archive-detail-reload"]').should('be.visible').click();
    cy.get('[data-cy="leagues-archive-detail-reload"]').should('not.exist');
    cy.contains('h1 button', 'Role League').click();
    cy.get('[data-cy="leagues-archive-detail-name-input"]').clear().type('Forbidden Name{enter}');
    cy.wait('@rejectedRename');
    cy.get('[role="alert"]').should('be.visible').invoke('text').should('match', /not allowed|n’est pas autorisé/);
  });
});
