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

function mockSession(globalRole = 'Organizer') {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' }).as('refresh');
  cy.intercept('GET', '**/api/users/me', { ...profile, globalRole }).as('profile');
}

function mockLeagueServer() {
  let next = 1;
  const leagues = [];
  const bump = league => { league.documentVersion += 1; return commandResponse(league); };
  const find = id => leagues.find(league => league.id === id);

  cy.intercept('GET', /\/api\/leagues-archive\?.*/, req => req.reply({
    items: leagues.map(({ id, name, status, documentVersion }) => ({ id, name, status, documentVersion, updatedAt: '2026-08-02T00:00:00Z' })),
    page: 1, pageSize: 100, totalCount: leagues.length
  })).as('leagueList');
  cy.intercept('GET', /\/api\/leagues-archive\/[^/?]+$/, req => {
    const league = find(decodeURIComponent(req.url.split('/').pop()));
    req.reply(league ? commandResponse(league) : { statusCode: 404, body: { code: 'not_found', message: 'Missing.' } });
  }).as('leagueDetail');
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

function visit(path) {
  cy.visit(path, { onBeforeLoad(win) {
    win.localStorage.setItem('gones.settings.language', 'en');
    win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  } });
}

describe('League server command flows', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('runs create → round import → edit → result/stats → export/restore → delete with server responses', () => {
    mockSession();
    mockLeagueServer();
    visit('/leagues-archive');

    cy.get('[data-cy="leagues-archive-list-create-card"]').click();
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
    cy.get('h1 button.editable-title').click();
    cy.get('[data-cy="tournament-archive-detail-name-input"]').clear().type('Server Result{enter}');
    cy.wait('@editTournament');
    cy.contains('button', 'Add Round').click();
    cy.wait('@addRound');
    cy.contains('mat-expansion-panel', 'Round 1').find('mat-expansion-panel-header').click();
    cy.get('[data-cy="tournament-archive-detail-round-import-input"]').type('1,Alice,Won 2-0,Bob,Control,Tempo', { parseSpecialCharSequences: false });
    cy.contains('button', 'Import Round Data').click();
    cy.wait('@importRound');
    cy.get('input[aria-label="Round 1, entry 1: player 1"]').clear().type('Alicia');
    cy.document().trigger('keydown', { key: 's', code: 'KeyS', ctrlKey: true, force: true });
    cy.wait('@editEntry');
    cy.get('[data-cy="ranking-table"]').should('contain', 'Alicia').and('contain', 'Bob');

    cy.get('[data-cy="tournament-result-link"]').click();
    cy.get('[data-cy="tournament-archive-result-page"]').should('contain', 'Server Result').and('contain', '2').and('contain', '1');
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
