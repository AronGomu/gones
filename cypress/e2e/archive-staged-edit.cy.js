const POWER_KEY = 'gones.settings.power-user';
const LOCAL_DB = 'gones-archive-local';
const CACHE_DB = 'gones-archive-cache';
const SEED_MARKER = 'gones.e2e.storage-seeded';
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

/** `days` before today as `YYYY-MM-DD`, so the 365-day lock can be driven from either side. */
function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function tournamentDoc(overrides = {}) {
  return {
    id: 't1', name: 'Server Cup', seasonId: 's1', tournamentDate: '2026-08-13', status: 'active',
    playerArchetypes: [],
    rounds: [{ id: 'r1', entries: [{ kind: 'match', id: 'e1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }],
    documentVersion: 4, updatedAt: '2026-08-13T10:00:00Z',
    ...overrides
  };
}

const seasons = { items: [{ id: 's1', name: 'Spring Season', leagueId: 'l1', status: 'active', updatedAt: '2026-08-13T10:00:00Z', documentVersion: 1, tournamentCount: 1, playerCount: 2, firstTournamentDate: '2026-08-13', lastTournamentDate: '2026-08-13' }], totalCount: 1, truncated: false };

function seed(win, { power = true, clearLocal = false } = {}) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  win.localStorage.setItem(POWER_KEY, String(power));
  win.localStorage.setItem(SEED_MARKER, 'true');
  if (clearLocal) {
    win.indexedDB.deleteDatabase(LOCAL_DB);
    win.indexedDB.deleteDatabase(CACHE_DB);
  }
}

// `onBeforeLoad` is not dependable on the release topology: once `ngsw-worker.js` controls the page it
// answers the navigation out of Cache Storage, that response never passes through the Cypress proxy,
// and Cypress cannot inject the script that calls the hook — no error, no seed, so every Power User
// gate below stays shut. The marker is how the skip is detected; re-seeding from the loaded page and
// raising `storage` the way a browser does for a change made in another tab then covers it. The local
// database is deliberately left alone on that branch: deleting it is pre-boot hygiene, and a delete
// against the connection the running app already holds open blocks instead of completing.
function visit(path, options = {}) {
  const power = options.power ?? true;
  cy.visit(path, { onBeforeLoad: (win) => seed(win, options) });
  cy.window({ log: false }).then((win) => {
    if (win.localStorage.getItem(SEED_MARKER) === 'true') return;
    seed(win, { power });
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings', newValue: win.localStorage.getItem('gones.settings') }));
    win.dispatchEvent(new win.StorageEvent('storage', { key: POWER_KEY, newValue: String(power) }));
  });
}

function organizer() {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', profile);
}

/** Every read the page makes, plus the two counters the invariants are asserted against. */
function archiveReads(counters, doc = tournamentDoc()) {
  cy.intercept('GET', /\/api\/archive\/tournaments\/t1$/, (req) => {
    counters.detail += 1;
    req.reply(doc);
  }).as('detail');
  cy.intercept('GET', /\/api\/archive\/league-seasons\/all$/, seasons);
  cy.intercept('GET', /\/api\/archive\/years$/, { years: [{ year: 2026, locked: false, tournamentCount: 1 }] });
  cy.intercept('GET', /\/api\/archive\/tournaments\/all/, { items: [], totalCount: 0, truncated: false });
}

/** The one write. Counts calls and pins the mandatory `If-Match` to the version that was read. */
function editBatch(counters, reply, assertBody) {
  cy.intercept('POST', /\/api\/archive\/tournaments\/t1\/edit-batch$/, (req) => {
    counters.batch += 1;
    expect(req.headers['if-match'], 'If-Match').to.eq(etag(4));
    if (assertBody) assertBody(req.body);
    req.reply(reply);
  }).as('editBatch');
}

function counters() {
  return { detail: 0, batch: 0 };
}

describe('Archive Tournament explicit staged editor', () => {
  beforeEach(() => cy.viewport(1280, 900));

  it('stages changes without persistence, commits once, and adopts the response without refetching', () => {
    const calls = counters();
    organizer();
    archiveReads(calls);
    editBatch(calls, { statusCode: 200, body: { tournament: { ...tournamentDoc(), name: 'Committed Cup', documentVersion: 5 } } });

    visit('/archive/tournaments/t1', { clearLocal: true });
    cy.get('[data-cy="archive-tournament-read-only"]').should('be.visible');
    cy.get('[data-cy="archive-tournament-edit-name-input"]').should('not.exist');

    cy.get('[data-cy="archive-tournament-edit"]').click();
    cy.get('[data-cy="archive-tournament-edit-name-input"]').clear().type('Draft Cup');
    cy.get('[data-cy="archive-tournament-add-round"]').click();
    // A new round renders collapsed, so its own panel has to be opened before its controls are
    // reachable — and scoping to that panel keeps the assertions off the pre-existing round 1.
    cy.get('[data-cy="archive-tournament-edit-round-2"]').within(() => {
      cy.get('[data-cy="archive-tournament-edit-round-header"]').click();
      cy.get('[data-cy="archive-tournament-add-match"]').click();
      cy.get('[data-cy="archive-tournament-match-player1-input"]').clear().type('Cleo');
      cy.get('[data-cy="archive-tournament-match-player2-input"]').clear().type('Dan');
    });
    cy.get('[data-cy="archive-tournament-edit-round-2"]').find('[data-cy="archive-tournament-round-entry-row"]').should('have.length', 1);

    // Nothing was written: a reload shows the authoritative document and no staged round.
    cy.reload();
    cy.contains('h1', 'Draft Cup').should('not.exist');
    cy.contains('h1', 'Server Cup').should('be.visible');
    cy.then(() => expect(calls.batch, 'writes while drafting').to.eq(0));

    cy.get('[data-cy="archive-tournament-edit"]').click();
    cy.get('[data-cy="archive-tournament-edit-name-input"]').clear().type('Committed Cup');
    cy.get('[data-cy="archive-tournament-save-changes"]').click();
    cy.get('[data-cy="confirm-dialog-message"]').should('contain', 'Deleted rounds: 0').and('contain', 'Deleted entries: 0');
    // From here the authoritative read is refused, so nothing rendered after the save may depend on
    // it. Counting the GETs cannot prove that any more: the app shell rebuilds its header on the
    // `gones-archive-updated` announcement and reads the same Tournament, and it is the same URL as
    // the page's own read. Breaking the read tells the two apart — the header may lose its label,
    // the editor may not lose the document it just saved.
    cy.intercept('GET', /\/api\/archive\/tournaments\/t1$/, {
      statusCode: 500,
      body: { code: 'server_error', message: 'No read after the save.' },
      headers: { 'content-type': 'application/problem+json' }
    }).as('detailAfterSave');
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.wait('@editBatch');
    cy.contains('h1', 'Committed Cup').should('be.visible');
    cy.get('[data-cy="archive-tournament-edit"]').should('exist');
    // One save is one request, and the response body is adopted instead of refetched.
    cy.then(() => expect(calls.batch, 'edit-batch requests').to.eq(1));
  });

  it('keeps the draft on 412, cancels Reload Latest without loss, then discards after confirmation', () => {
    const calls = counters();
    organizer();
    archiveReads(calls);
    editBatch(
      calls,
      { statusCode: 412, headers: { 'content-type': 'application/problem+json' }, body: { code: 'stale_version', message: 'Resource changed since it was read.' } },
      (body) => expect(body.editTournament.name).to.eq('Unsaved Draft')
    );

    visit('/archive/tournaments/t1', { clearLocal: true });
    cy.get('[data-cy="archive-tournament-edit"]').click();
    cy.get('[data-cy="archive-tournament-edit-name-input"]').clear().type('Unsaved Draft');
    cy.get('[data-cy="archive-tournament-save-changes"]').click();
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.wait('@editBatch');

    // A stale write is a real conflict, never a silent retry: the draft survives byte for byte.
    cy.get('[data-cy="archive-tournament-edit-error"]').should('contain', 'changed since you opened it');
    cy.get('[data-cy="archive-tournament-edit-name-input"]').should('have.value', 'Unsaved Draft');

    cy.get('[data-cy="archive-tournament-reload"]').should('exist').click();
    cy.get('[data-cy="confirm-dialog-cancel"]').click();
    cy.get('[data-cy="archive-tournament-edit-name-input"]').should('have.value', 'Unsaved Draft');
    cy.then(() => expect(calls.batch, 'no retry of a stale write').to.eq(1));

    cy.get('[data-cy="archive-tournament-reload"]').should('not.be.disabled').click();
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.contains('h1', 'Server Cup').should('be.visible');
    cy.get('[data-cy="archive-tournament-edit"]').should('exist');
    cy.then(() => expect(calls.batch, 'still exactly one write attempt').to.eq(1));
  });

  it('reports a locked refusal without losing the draft', () => {
    const calls = counters();
    organizer();
    // 300 days old: unlocked to the client, so the control is offered — and the server is still
    // the authority that refuses. The UI must report its `409`, not its own derivation.
    archiveReads(calls, tournamentDoc({ tournamentDate: daysAgo(300) }));
    editBatch(calls, { statusCode: 409, headers: { 'content-type': 'application/problem+json' }, body: { code: 'archive_tournament_locked', message: 'Tournament is older than the archive lock window.' } });

    visit('/archive/tournaments/t1', { clearLocal: true });
    cy.get('[data-cy="archive-tournament-edit"]').click();
    cy.get('[data-cy="archive-tournament-edit-name-input"]').clear().type('Locked Draft');
    cy.get('[data-cy="archive-tournament-save-changes"]').click();
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.wait('@editBatch');

    cy.get('[data-cy="archive-tournament-edit-error"]').should('contain', 'locked');
    cy.get('[data-cy="archive-tournament-edit-name-input"]').should('have.value', 'Locked Draft');
    cy.get('[data-cy="archive-tournament-reload"]').should('not.exist');
    cy.then(() => expect(calls.batch).to.eq(1));
  });

  it('reports a forbidden refusal', () => {
    const calls = counters();
    organizer();
    archiveReads(calls);
    editBatch(calls, { statusCode: 403, headers: { 'content-type': 'application/problem+json' }, body: { code: 'forbidden', message: 'Not allowed.' } });

    visit('/archive/tournaments/t1', { clearLocal: true });
    cy.get('[data-cy="archive-tournament-edit"]').click();
    cy.get('[data-cy="archive-tournament-edit-name-input"]').clear().type('Forbidden Draft');
    cy.get('[data-cy="archive-tournament-save-changes"]').click();
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.wait('@editBatch');

    cy.get('[data-cy="archive-tournament-edit-error"]').should('contain', 'not allowed');
    cy.get('[data-cy="archive-tournament-edit-name-input"]').should('have.value', 'Forbidden Draft');
  });

  it('reports a deleted Tournament', () => {
    const calls = counters();
    organizer();
    archiveReads(calls);
    editBatch(calls, { statusCode: 404, headers: { 'content-type': 'application/problem+json' }, body: { code: 'not_found', message: 'Resource not found.' } });

    visit('/archive/tournaments/t1', { clearLocal: true });
    cy.get('[data-cy="archive-tournament-edit"]').click();
    cy.get('[data-cy="archive-tournament-edit-name-input"]').clear().type('Doomed Draft');
    cy.get('[data-cy="archive-tournament-save-changes"]').click();
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.wait('@editBatch');

    cy.get('[data-cy="archive-tournament-edit-error"]').should('contain', 'no longer exists');
    cy.get('[data-cy="archive-tournament-edit-name-input"]').should('have.value', 'Doomed Draft');
  });

  it('hides every edit control while Power mode is off', () => {
    const calls = counters();
    organizer();
    archiveReads(calls);

    visit('/archive/tournaments/t1', { clearLocal: true, power: false });
    cy.get('[data-cy="archive-tournament-read-only"]').should('be.visible');
    cy.get('[data-cy="archive-tournament-edit"]').should('not.exist');
    cy.get('[data-cy="archive-tournament-edit-name-input"]').should('not.exist');
  });

  it('hides the edit control on a locked Tournament for a non-admin', () => {
    const calls = counters();
    organizer();
    archiveReads(calls, tournamentDoc({ tournamentDate: daysAgo(400) }));

    visit('/archive/tournaments/t1', { clearLocal: true });
    cy.get('[data-cy="archive-tournament-locked-notice"]').should('contain', 'more than 365 days ago');
    cy.get('[data-cy="archive-tournament-edit"]').should('not.exist');
    cy.get('[data-cy="archive-tournament-edit-name-input"]').should('not.exist');
  });
});
