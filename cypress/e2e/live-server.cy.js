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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mockSession(globalRole = 'Organizer') {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' }).as('refresh');
  cy.intercept('GET', '**/api/users/me', { ...profile, globalRole }).as('profile');
}

function autoRoundCount(players) {
  const count = players.filter((player) => player.name && !player.dropped).length;
  if (count < 2) return 0;
  if (count === 2) return 1;
  if (count <= 15) return 3;
  return Math.ceil(Math.log2(count));
}

function newLiveDocument(id) {
  return {
    id, name: 'Live Tournament', leagueId: '', tournamentDate: '2026-08-05', type: 'swiss',
    roundCount: 3, customRoundCount: false, paidTrackingEnabled: true, pairingSeed: 1,
    firstRoundPlayerOrder: [], stage: 'registration', currentRoundNumber: 0,
    players: [], rounds: [], checkpoints: [], finalizedTournamentId: undefined,
    documentVersion: 1, createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z'
  };
}

/** Minimal but stateful Live intent server: version bumps, If-Match checks, swiss-in-order pairing. */
function mockLiveServer() {
  let next = 1;
  const state = {
    lives: [],
    league: { id: 'league-1', name: 'Preset League', status: 'active', tournaments: [], documentVersion: 1 },
    finalized: null
  };
  const find = (id) => state.lives.find((live) => live.id === id);
  const expectIfMatch = (req, live) => expect(req.headers['if-match'], 'If-Match header').to.eq(etag(live.documentVersion));
  const command = (live) => {
    live.documentVersion += 1;
    live.updatedAt = '2026-08-05T01:00:00.000Z';
    return { document: clone(live), documentVersion: live.documentVersion, serverUpdatedAt: live.updatedAt, eTag: etag(live.documentVersion) };
  };
  const applyAutoRoundCount = (live) => {
    if (!live.customRoundCount && live.stage === 'registration') live.roundCount = autoRoundCount(live.players);
  };

  cy.intercept('GET', /\/api\/leagues\?.*/, (req) => req.reply({
    items: [{ id: state.league.id, name: state.league.name, status: state.league.status, documentVersion: state.league.documentVersion, updatedAt: '2026-08-05T00:00:00Z' }],
    page: 1, pageSize: 100, totalCount: 1
  })).as('leagueList');
  cy.intercept('GET', /\/api\/leagues\/[^/?]+$/, (req) => req.reply({ ...clone(state.league), updatedAt: '2026-08-05T00:00:00Z', eTag: etag(state.league.documentVersion) })).as('leagueDetail');

  cy.intercept('GET', /\/api\/live-tournaments\?.*/, (req) => req.reply({
    items: state.lives.filter((live) => live.stage !== 'completed').map((live) => ({ id: live.id, name: live.name, tournamentDate: live.tournamentDate, stage: live.stage, updatedAt: live.updatedAt, documentVersion: live.documentVersion })),
    page: 1, pageSize: 100, totalCount: state.lives.filter((live) => live.stage !== 'completed').length
  })).as('liveList');

  cy.intercept('GET', /\/api\/live-tournaments\/[^/?]+$/, (req) => {
    const live = find(decodeURIComponent(req.url.split('/').pop()));
    if (!live) return req.reply({ statusCode: 404, body: { code: 'not_found', message: 'Missing.' }, headers: { 'content-type': 'application/problem+json' } });
    const publicView = { ...clone(live), pairingSeed: undefined, firstRoundPlayerOrder: undefined, checkpoints: undefined, serverUpdatedAt: live.updatedAt };
    return req.reply(publicView);
  }).as('livePublicDetail');

  cy.intercept('GET', /\/api\/live-tournaments\/[^/]+\/document$/, (req) => {
    const live = find(new URL(req.url).pathname.split('/')[3]);
    if (!live) return req.reply({ statusCode: 404, body: { code: 'not_found', message: 'Missing.' }, headers: { 'content-type': 'application/problem+json' } });
    return req.reply({ document: clone(live), documentVersion: live.documentVersion, serverUpdatedAt: live.updatedAt });
  }).as('liveDocument');

  cy.intercept('POST', /\/api\/live-tournaments$/, (req) => {
    expect(req.headers['idempotency-key'], 'Idempotency-Key header').to.be.a('string').and.not.be.empty;
    const live = newLiveDocument(`live-${next++}`);
    if (req.body.tournamentDate) live.tournamentDate = req.body.tournamentDate;
    state.lives.push(live);
    req.reply({ statusCode: 201, body: { document: clone(live), documentVersion: live.documentVersion, serverUpdatedAt: live.updatedAt, eTag: etag(live.documentVersion) } });
  }).as('createLive');

  cy.intercept('PATCH', /\/api\/live-tournaments\/[^/]+\/settings$/, (req) => {
    const live = find(new URL(req.url).pathname.split('/')[3]);
    expectIfMatch(req, live);
    for (const key of ['name', 'leagueId', 'tournamentDate', 'roundCount', 'customRoundCount', 'paidTrackingEnabled']) {
      if (req.body[key] !== undefined && req.body[key] !== null) live[key] = req.body[key];
    }
    applyAutoRoundCount(live);
    req.reply(command(live));
  }).as('updateSettings');

  cy.intercept('POST', /\/api\/live-tournaments\/[^/]+\/players$/, (req) => {
    const live = find(new URL(req.url).pathname.split('/')[3]);
    expectIfMatch(req, live);
    const player = { id: `player-${next++}`, name: req.body.name, paid: false, dropped: false, initialWins: req.body.initialWins || 0, initialDraws: req.body.initialDraws || 0, initialLosses: req.body.initialLosses || 0, archetype: req.body.archetype || '' };
    if (live.stage === 'registration') live.players.unshift(player);
    else live.players.push(player);
    applyAutoRoundCount(live);
    req.reply(command(live));
  }).as('addPlayer');

  cy.intercept('PATCH', /\/api\/live-tournaments\/[^/]+\/players\/[^/]+$/, (req) => {
    const segments = new URL(req.url).pathname.split('/');
    const live = find(segments[3]);
    expectIfMatch(req, live);
    const player = live.players.find((item) => item.id === segments[5]);
    Object.assign(player, req.body);
    req.reply(command(live));
  }).as('editPlayer');

  cy.intercept('PATCH', /\/api\/live-tournaments\/[^/]+\/players\/[^/]+\/paid$/, (req) => {
    const segments = new URL(req.url).pathname.split('/');
    const live = find(segments[3]);
    expectIfMatch(req, live);
    live.players.find((item) => item.id === segments[5]).paid = req.body.paid;
    req.reply(command(live));
  }).as('setPaid');

  cy.intercept('POST', /\/api\/live-tournaments\/[^/]+\/players\/[^/]+\/drop$/, (req) => {
    const segments = new URL(req.url).pathname.split('/');
    const live = find(segments[3]);
    expectIfMatch(req, live);
    live.players.find((item) => item.id === segments[5]).dropped = true;
    req.reply(command(live));
  }).as('dropPlayer');

  cy.intercept('DELETE', /\/api\/live-tournaments\/[^/]+\/players\/[^/]+$/, (req) => {
    const segments = new URL(req.url).pathname.split('/');
    const live = find(segments[3]);
    expectIfMatch(req, live);
    live.players = live.players.filter((item) => item.id !== segments[5]);
    applyAutoRoundCount(live);
    req.reply(command(live));
  }).as('removePlayer');

  const buildRound = (live) => {
    const active = live.players.filter((player) => player.name && !player.dropped);
    const roundNumber = live.rounds.filter((round) => round.validated).length + 1;
    const entries = [];
    let table = 1;
    for (let index = 0; index + 1 < active.length; index += 2) {
      entries.push({ entry: { kind: 'match', id: `entry-${next++}`, table: String(table++), player1Name: active[index].name, player2Name: active[index + 1].name, player1Score: 0, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }, resultEntered: false });
    }
    if (active.length % 2 === 1) {
      entries.push({ entry: { kind: 'bye', id: `entry-${next++}`, table: String(table), playerName: active[active.length - 1].name, deckArchetype: '' }, resultEntered: true });
    }
    return { id: `round-${next++}`, roundNumber, entries, validated: false };
  };

  cy.intercept('POST', /\/api\/live-tournaments\/[^/]+\/rounds\/start$/, (req) => {
    const live = find(new URL(req.url).pathname.split('/')[3]);
    expectIfMatch(req, live);
    const round = buildRound(live);
    live.stage = 'round';
    live.currentRoundNumber = round.roundNumber;
    live.rounds = [...live.rounds.filter((item) => item.validated), round];
    req.reply(command(live));
  }).as('startRound');

  cy.intercept('POST', /\/api\/live-tournaments\/[^/]+\/rounds\/cancel$/, (req) => {
    const live = find(new URL(req.url).pathname.split('/')[3]);
    expectIfMatch(req, live);
    const validated = live.rounds.filter((item) => item.validated);
    live.stage = validated.length ? 'standings' : 'registration';
    live.currentRoundNumber = validated.length ? validated[validated.length - 1].roundNumber : 0;
    live.rounds = validated;
    req.reply(command(live));
  }).as('cancelRound');

  cy.intercept('POST', /\/api\/live-tournaments\/[^/]+\/rounds\/validate$/, (req) => {
    const live = find(new URL(req.url).pathname.split('/')[3]);
    expectIfMatch(req, live);
    const round = live.rounds.find((item) => item.roundNumber === live.currentRoundNumber);
    live.checkpoints.push({ id: `checkpoint-${next++}`, label: `Pairing ${round.roundNumber}`, createdAt: live.updatedAt, stage: 'round', currentRoundNumber: round.roundNumber, roundCount: live.roundCount, paidTrackingEnabled: live.paidTrackingEnabled, players: clone(live.players), rounds: clone(live.rounds) });
    round.validated = true;
    round.entries = round.entries.map((item) => ({ ...item, resultEntered: true }));
    live.stage = 'standings';
    req.reply(command(live));
  }).as('validateRound');

  cy.intercept('POST', /\/api\/live-tournaments\/[^/]+\/rounds\/[^/]+\/entries\/[^/]+\/score$/, (req) => {
    const segments = new URL(req.url).pathname.split('/');
    const live = find(segments[3]);
    expectIfMatch(req, live);
    const round = live.rounds.find((item) => item.id === segments[5]);
    const entry = round.entries.find((item) => item.entry.id === segments[7]);
    entry.entry.player1Score = req.body.player1Score;
    entry.entry.player2Score = req.body.player2Score;
    entry.resultEntered = true;
    req.reply(command(live));
  }).as('scoreEntry');

  cy.intercept('POST', /\/api\/live-tournaments\/[^/]+\/checkpoints\/[^/]+\/restore$/, (req) => {
    const segments = new URL(req.url).pathname.split('/');
    const live = find(segments[3]);
    expectIfMatch(req, live);
    const index = live.checkpoints.findIndex((item) => item.id === segments[5]);
    const checkpoint = live.checkpoints[index];
    live.stage = checkpoint.stage;
    live.currentRoundNumber = checkpoint.currentRoundNumber;
    live.roundCount = checkpoint.roundCount;
    live.paidTrackingEnabled = checkpoint.paidTrackingEnabled;
    live.players = clone(checkpoint.players);
    live.rounds = clone(checkpoint.rounds);
    live.checkpoints = live.checkpoints.slice(0, index + 1);
    req.reply(command(live));
  }).as('restoreCheckpoint');

  cy.intercept('POST', /\/api\/live-tournaments\/[^/]+\/finalize$/, (req) => {
    const live = find(new URL(req.url).pathname.split('/')[3]);
    expectIfMatch(req, live);
    expect(req.headers['idempotency-key'], 'finalize Idempotency-Key').to.be.a('string').and.not.be.empty;
    const leagueId = live.leagueId || 'placeholder-league';
    const finalizedTournamentId = `final-${live.id}`;
    live.stage = 'completed';
    live.documentVersion += 1;
    live.finalizedTournamentId = finalizedTournamentId;
    state.league.tournaments.push({
      id: finalizedTournamentId,
      leagueId: state.league.id,
      name: live.name,
      tournamentDate: live.tournamentDate,
      rounds: live.rounds.filter((round) => round.validated).map((round) => ({ id: `final-${round.id}`, entries: round.entries.map((item) => ({ ...item.entry, id: `final-${item.entry.id}` })) })),
      playerArchetypes: []
    });
    state.league.documentVersion += 1;
    state.finalized = { liveId: live.id, leagueId };
    req.reply({
      id: live.id, stage: 'completed', leagueId: state.league.id, finalizedTournamentId,
      liveDocumentVersion: live.documentVersion, liveETag: etag(live.documentVersion),
      leagueDocumentVersion: state.league.documentVersion, leagueETag: etag(state.league.documentVersion)
    });
  }).as('finalizeLive');

  return state;
}

function seedSettings(win) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
}

function visit(path, { clearLocalStore = false } = {}) {
  cy.visit(path, {
    onBeforeLoad: (win) => {
      seedSettings(win);
      // ADR 0021 gave anonymous and `User` a browser-local Live store; clear it so a leftover
      // tournament from another spec cannot be mistaken for the server list.
      if (clearLocalStore) win.indexedDB.deleteDatabase('gones-live');
    }
  });
  // Test-isolation cleanup can race the previous page's settings self-heal (French default);
  // re-seed after boot and reload so every test deterministically runs in English.
  cy.window().then((win) => seedSettings(win));
  cy.reload();
}

function setInputValue(selector, value) {
  cy.get(selector).then(($input) => {
    const input = $input[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function runServerLifecycle({ label, width, height }) {
  it(`runs the Live lifecycle through server intent commands (${label})`, () => {
    cy.viewport(width, height);
    mockSession('Organizer');
    const state = mockLiveServer();

    visit('/live-tournaments');
    cy.get('[data-cy="running-tournament-empty-state"]').should('be.visible');
    cy.get('[data-cy="create-running-tournament-card"]').click();
    cy.wait('@createLive');
    cy.location('pathname').should('match', /^\/live-tournaments\/live-\d+$/);

    cy.get('[data-cy="live-tournament-name-input"]').clear().type('Server Live Cup').blur();
    cy.wait('@updateSettings').its('request.body.name').should('eq', 'Server Live Cup');

    for (const name of ['Alice', 'Bob', 'Carol', 'Dave']) {
      cy.get('[data-cy="live-add-player-name-input"]').clear().type(`${name}{enter}`);
      cy.wait('@addPlayer').its('request.body.name').should('eq', name);
    }
    cy.get('[data-cy="live-player-row"]').should('have.length', 4);

    cy.contains('[data-cy="live-player-row"]', 'Alice').find('[data-cy="live-player-paid-checkbox"]').check({ force: true });
    cy.wait('@setPaid').its('request.body.paid').should('eq', true);

    cy.get('[data-cy="live-tournament-custom-round-count-checkbox"]').click();
    cy.wait('@updateSettings');
    setInputValue('[data-cy="live-tournament-round-count-input"]', 1);
    cy.wait('@updateSettings').its('request.body.roundCount').should('eq', 1);

    cy.get('[data-cy="live-start-tournament-button"]').click();
    cy.contains('mat-dialog-container button', 'Start Tournament').click();
    cy.wait('@startRound');
    cy.get('[data-cy="live-match-row"]').should('have.length', 2);

    cy.get('[data-cy="live-pairing-actions-button"]').click();
    cy.get('[data-cy="live-cancel-round-button"]').should('exist').click({ force: true });
    cy.wait('@cancelRound');
    cy.get('[data-cy="live-match-row"]').should('not.exist');

    cy.get('[data-cy="live-start-tournament-button"]').click();
    cy.contains('mat-dialog-container button', 'Start Tournament').click();
    cy.wait('@startRound');
    cy.get('[data-cy="live-match-row"]').should('have.length', 2);

    cy.get('[data-cy="live-match-row"]').each(($row) => {
      cy.wrap($row).within(() => {
        setInputValue('[data-cy="live-match-player1-score"]', 2);
        setInputValue('[data-cy="live-match-player2-score"]', 0);
      });
      cy.wait('@scoreEntry');
    });

    cy.get('[data-cy="live-validate-round-button"]').should('be.enabled').click();
    cy.wait('@validateRound');
    cy.get('[data-cy="live-standings-table"]').should('be.visible');

    // Checkpoint UX: cancel the standings back to the open round, then validate again.
    cy.get('[data-cy="live-standing-actions-button"]').click();
    cy.get('[data-cy="live-cancel-standings-button"]').should('exist').click({ force: true });
    cy.wait('@restoreCheckpoint');
    cy.get('[data-cy="live-validate-round-button"]').should('be.enabled').click();
    cy.wait('@validateRound');

    cy.get('[data-cy="live-archive-tournament-button"]').should('be.enabled').click();
    cy.contains('mat-dialog-container button', 'Archive Tournament').click();
    cy.wait('@finalizeLive');
    cy.location('pathname').should('eq', `/leagues/league-1/tournaments/final-live-1`);
    cy.get('[data-cy="tournament-detail-page"]').should('contain', 'Server Live Cup');
    cy.then(() => expect(state.finalized).to.not.eq(null));
  });
}

describe('Live Tournament server command flows', () => {
  for (const viewport of [{ label: 'desktop', width: 1280, height: 800 }, { label: 'phone', width: 390, height: 844 }]) {
    runServerLifecycle(viewport);
  }

  /**
   * ADR 0021 replaced the old read-only-for-`User` surface: a plain user no longer reads the server
   * Live list at all, they get their own browser-local store. Synchronisation is what `Organizer`
   * buys. This asserts the split at the boundary — the server tournament is invisible and the API
   * is never asked for it.
   */
  it('routes the User role to the browser-local store instead of the server list', () => {
    cy.viewport(1280, 800);
    mockSession('User');
    const state = mockLiveServer();
    cy.then(() => {
      const live = newLiveDocument('live-role');
      live.name = 'Role Live';
      live.players.push({ id: 'player-role', name: 'Alice', paid: false, dropped: false, initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' });
      state.lives.push(live);
    });

    visit('/live-tournaments', { clearLocalStore: true });

    cy.get('[data-cy="live-local-mode-notice"]').should('be.visible');
    cy.get('[data-cy="running-tournament-empty-state"]').should('be.visible');
    cy.contains('Role Live').should('not.exist');
    // A plain user manages their own local tournaments, so the create card is theirs to use.
    cy.get('[data-cy="create-running-tournament-card"]').should('exist');
    cy.get('[data-cy="live-list-read-only"]').should('not.exist');
    cy.get('@liveList.all').should('have.length', 0);
  });

  it('recovers from a 412 stale write through reload-and-reapply and blocks offline writes', () => {
    cy.viewport(1280, 800);
    mockSession('Organizer');
    const state = mockLiveServer();
    cy.then(() => {
      const live = newLiveDocument('live-stale');
      live.name = 'Stale Live';
      state.lives.push(live);
    });

    let rejectOnce = true;
    cy.intercept('PATCH', /\/api\/live-tournaments\/live-stale\/settings$/, (req) => {
      if (rejectOnce) {
        rejectOnce = false;
        const live = state.lives.find((item) => item.id === 'live-stale');
        live.documentVersion += 2; // concurrent writer moved the document forward
        return req.reply({
          statusCode: 412,
          headers: { 'content-type': 'application/problem+json' },
          body: { code: 'stale_etag', message: 'Stale.', currentETag: etag(live.documentVersion), currentDocumentVersion: live.documentVersion }
        });
      }
      const live = state.lives.find((item) => item.id === 'live-stale');
      expect(req.headers['if-match'], 'reapplied If-Match').to.eq(etag(live.documentVersion));
      live.name = req.body.name;
      live.documentVersion += 1;
      return req.reply({ document: clone(live), documentVersion: live.documentVersion, serverUpdatedAt: live.updatedAt, eTag: etag(live.documentVersion) });
    }).as('staleSettings');

    visit('/live-tournaments/live-stale');
    cy.wait('@liveDocument');
    cy.get('[data-cy="live-tournament-name-input"]').clear().type('Renamed Once').blur();
    cy.wait('@staleSettings');
    cy.get('[role="alert"]').should('be.visible');
    cy.get('[data-cy="live-reload"]').should('be.visible').click();
    cy.wait('@liveDocument');
    cy.get('[data-cy="live-reload"]').should('not.exist');

    cy.get('[data-cy="live-tournament-name-input"]').clear().type('Renamed After Reload').blur();
    cy.wait('@staleSettings').its('response.statusCode').should('eq', 200);
    cy.contains('h1', 'Renamed After Reload').should('be.visible');

    // Offline: server-mode writes fail fast and are never queued.
    cy.window().then((win) => Object.defineProperty(win.navigator, 'onLine', { get: () => false }));
    cy.get('[data-cy="live-tournament-name-input"]').clear().type('Offline Name').blur();
    cy.get('[role="alert"]').should('be.visible').invoke('text').should('match', /offline|hors ligne/i);
  });
});
