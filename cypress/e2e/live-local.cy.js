/**
 * Browser-local Live authority (ADR 0021).
 *
 * Signed out, so it costs zero auth permits: the refresh call is stubbed 401 and never leaves the
 * browser. The point of the spec is the negative assertion at the end — an anonymous visitor runs a
 * whole Swiss round with no `/api/live-tournaments` request at all, and the state survives a reload
 * because it lives in IndexedDB.
 */
const LOCAL_LIVE_DB_NAME = 'gones-live';

function seedSettings(win) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
}

function visit(path, { clearLocalStore = false } = {}) {
  cy.visit(path, {
    onBeforeLoad: (win) => {
      seedSettings(win);
      // Deterministic start: a previous spec in the same browser may have left a local tournament.
      // Never on a re-visit — that is the store whose survival this spec asserts.
      if (clearLocalStore) win.indexedDB.deleteDatabase(LOCAL_LIVE_DB_NAME);
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

describe('Live Tournament browser-local flows', () => {
  it('runs a signed-out tournament entirely in the browser and survives a reload', () => {
    cy.viewport(1280, 800);

    const liveApiCalls = [];
    // Signed out: no session, and the startup refresh never reaches the auth endpoint.
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('refresh');
    cy.intercept(/\/api\/live-tournaments/, (req) => {
      liveApiCalls.push(req.url);
      req.reply({ statusCode: 500, body: { code: 'must_not_happen', message: 'Local mode must not call the Live API.' } });
    }).as('liveApi');

    visit('/live-tournaments', { clearLocalStore: true });

    cy.get('[data-cy="live-local-mode-notice"]').should('be.visible');
    cy.get('[data-cy="running-tournament-empty-state"]').should('be.visible');
    cy.get('[data-cy="create-running-tournament-card"]').click();
    cy.location('pathname').should('match', /^\/live-tournaments\/.+$/);
    // No League is offered: the local store cannot archive into one.
    cy.get('[data-cy="live-tournament-league-select"]').should('not.exist');

    // Everything below runs with the browser reporting itself offline — the local authority never
    // consults the network, so no write is blocked and nothing is queued for later.
    cy.window().then((win) => Object.defineProperty(win.navigator, 'onLine', { get: () => false }));

    cy.get('[data-cy="live-tournament-name-input"]').clear().type('Local Cup').blur();
    cy.contains('h1', 'Local Cup').should('be.visible');

    for (const name of ['Alice', 'Bob', 'Carol', 'Dave']) {
      cy.get('[data-cy="live-add-player-name-input"]').clear().type(`${name}{enter}`);
      cy.contains('[data-cy="live-player-row"]', name).should('exist');
    }
    cy.get('[data-cy="live-player-row"]').should('have.length', 4);

    cy.get('[data-cy="live-start-tournament-button"]').click();
    cy.contains('mat-dialog-container button', 'Start Tournament').click();
    cy.get('[data-cy="live-match-row"]').should('have.length', 2);

    cy.get('[data-cy="live-match-row"]').each(($row) => {
      cy.wrap($row).within(() => {
        setInputValue('[data-cy="live-match-player1-score"]', 2);
        setInputValue('[data-cy="live-match-player2-score"]', 0);
      });
    });

    // Validating flushes every pending local write before it commits, so the standings table is a
    // deterministic signal that everything above is already persisted in IndexedDB.
    cy.get('[data-cy="live-validate-round-button"]').should('be.enabled').click();
    cy.get('[data-cy="live-standings-table"]').should('be.visible');
    cy.get('[data-cy="live-standings-table"] tbody tr').should('have.length', 4);

    cy.reload();

    cy.contains('h1', 'Local Cup').should('be.visible');
    cy.get('[data-cy="live-standings-table"]').should('be.visible');
    cy.get('[data-cy="live-standings-table"] tbody tr').should('have.length', 4);
    cy.get('[data-cy="live-validated-match-row"]').should('have.length', 2);

    // Back on the list, the tournament is there and still local-only.
    visit('/live-tournaments');
    cy.get('[data-cy="live-local-mode-notice"]').should('be.visible');
    cy.contains('[data-cy="running-tournament-card"]', 'Local Cup').should('exist');

    cy.then(() => expect(liveApiCalls, 'requests to the Live API').to.deep.equal([]));
  });

  it('deletes a local tournament from the advanced settings and keeps it deleted after a reload', () => {
    cy.viewport(1280, 800);

    // Signed out: no session, and the startup refresh never reaches the auth endpoint.
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } }).as('refresh');

    visit('/live-tournaments', { clearLocalStore: true });

    cy.get('[data-cy="create-running-tournament-card"]').click();
    cy.location('pathname').should('match', /^\/live-tournaments\/.+$/);
    cy.get('[data-cy="live-tournament-name-input"]').clear().type('Doomed Cup').blur();
    cy.contains('h1', 'Doomed Cup').should('be.visible');

    // Dialog contents are asserted with `exist`, not `be.visible`: Material's open animation leaves
    // the container at opacity 0 under headless Electron, which Cypress reads as hidden while still
    // allowing the click. The same is true of every other dialog this suite drives.
    // Cancelling the confirmation leaves the tournament alone.
    cy.get('[data-cy="live-tournament-advanced-settings-button"]').click();
    cy.get('[data-cy="live-advanced-danger-zone"]').should('exist');
    cy.get('[data-cy="live-advanced-delete"]').click();
    cy.get('[data-cy="confirm-dialog-cancel"]').click();
    cy.get('[data-cy="confirm-dialog-confirm"]').should('not.exist');
    cy.contains('h1', 'Doomed Cup').should('be.visible');

    cy.get('[data-cy="live-tournament-advanced-settings-button"]').click();
    cy.get('[data-cy="live-advanced-delete"]').click();
    cy.get('[data-cy="confirm-dialog-confirm"]').click();

    cy.location('pathname').should('eq', '/live-tournaments');
    cy.get('[data-cy="running-tournament-empty-state"]').should('be.visible');

    // The IndexedDB row is gone, not just the in-memory signal.
    cy.reload();
    cy.get('[data-cy="running-tournament-empty-state"]').should('be.visible');
    cy.contains('[data-cy="running-tournament-card"]', 'Doomed Cup').should('not.exist');
  });
});
