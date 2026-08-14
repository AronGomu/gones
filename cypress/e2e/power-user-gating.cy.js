const POWER_KEY = 'gones.settings.power-user';
const eventId = '11111111-1111-1111-1111-111111111111';
const profile = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'organizer@example.test', emailVerified: true, globalRole: 'Organizer',
  username: 'organizer-user', firstName: 'Organizer', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false,
  isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false
};
const managedEvent = {
  id: eventId, organizationId: '22222222-2222-2222-2222-222222222222', organizationName: 'Owned Club', title: 'Power Gate Event', slug: 'power-gate-event',
  summary: 'Summary', bodyHtml: '<p>Body</p>', streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France',
  timeZoneId: 'Europe/Paris', venueStartDate: '2030-08-01', venueStartTime: '10:00:00', venueEndDate: '2030-08-01',
  venueEndTime: '18:00:00', startsAtUtc: '2030-08-01T08:00:00Z', endsAtUtc: '2030-08-01T16:00:00Z', capacity: 32,
  status: 'Published', formatIds: ['33333333-3333-3333-3333-333333333333'], version: 3, eTag: '"3"'
};
const publicEvent = {
  ...managedEvent,
  displayTitle: 'Legacy — Power Gate Event',
  venue: { streetAddress: managedEvent.streetAddress, postalCode: managedEvent.postalCode, city: managedEvent.city, country: managedEvent.country },
  organization: { id: managedEvent.organizationId, name: managedEvent.organizationName, description: '', website: '', contactEmail: '' },
  formats: [{ id: managedEvent.formatIds[0], name: 'Legacy', slug: 'legacy', sortOrder: 1 }],
  playerCount: 0
};
const serverLeague = { id: 'server-league-1', name: 'Server League', status: 'active', tournaments: [], documentVersion: 1, updatedAt: '2026-08-09T10:00:00Z' };
const serverLive = {
  id: 'live-power', name: 'Server Power Cup', leagueId: '', tournamentDate: '2026-08-13', type: 'swiss',
  roundCount: 3, customRoundCount: false, paidTrackingEnabled: true, pairingSeed: 1, firstRoundPlayerOrder: [],
  stage: 'registration', currentRoundNumber: 0, players: [{ id: 'player-1', name: 'Alice', paid: false, dropped: false, initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' }],
  rounds: [], checkpoints: [], documentVersion: 1, createdAt: '2026-08-13T10:00:00Z', updatedAt: '2026-08-13T10:00:00Z'
};

function seed(win, enabled) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  win.localStorage.setItem(POWER_KEY, String(enabled));
}

function signedOut() {
  cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } });
}

function organizer() {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', profile);
}

function visit(path, enabled) {
  cy.visit(path, { onBeforeLoad: (win) => seed(win, enabled) });
}

function stubPublicEvents(items = []) {
  cy.intercept('GET', '**/api/events/all*', { items, page: 1, pageSize: 100, totalCount: items.length }).as('publicEvents');
}

describe('Power User Event, League and Live gates', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('persists signed-out opt-in, keeps Archive reads/exports visible, and gates local mutations', () => {
    signedOut();
    cy.intercept(/\/api\/leagues-archive/, { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } });
    visit('/leagues-archive', false);

    cy.get('[data-cy="leagues-archive-list-grid"]').should('exist');
    cy.get('[data-cy="leagues-archive-list-create-card"]').should('not.exist');
    cy.get('[data-cy="app-leagues-import-button"]').should('not.exist');
    cy.get('[data-cy="app-full-data-export-button"]').should('be.visible');

    cy.visit('/settings');
    cy.get('[data-cy="settings-power-user-card"]').should('be.visible');
    cy.get('[data-cy="settings-power-user-checkbox"]').click();
    cy.window().then((win) => expect(win.localStorage.getItem(POWER_KEY)).to.eq('true'));

    cy.visit('/leagues-archive');
    cy.get('[data-cy="leagues-archive-list-create-card"]').should('exist');
    cy.get('[data-cy="app-leagues-import-button"]').should('exist');
    cy.get('[data-cy="app-full-data-export-button"]').should('exist');
  });

  it('keeps Organizer server/Event surfaces read-only off, redirects direct mutation URLs, then restores controls on', () => {
    organizer();
    stubPublicEvents();
    cy.intercept('GET', '**/api/organizer/events?*', { items: [managedEvent], page: 1, pageSize: 20, totalCount: 1 }).as('managedEvents');
    cy.intercept('GET', /\/api\/leagues-archive\?.*/, { items: [serverLeague], page: 1, pageSize: 100, totalCount: 1 });
    cy.intercept('GET', /\/api\/leagues-archive\/[^/?]+$/, serverLeague);

    visit('/organizer/events', false);
    cy.wait('@managedEvents');
    cy.get('[data-cy="event-edit"]').should('not.exist');
    cy.get('[data-cy="event-cancel"]').should('not.exist');
    cy.get('[data-cy="event-delete"]').should('not.exist');
    cy.get('[data-cy="event-participants"]').should('exist');
    cy.get(`[data-cy="event-row-public-view-${eventId}"]`).should('exist');

    cy.visit('/events/new');
    cy.location('pathname').should('eq', '/calendar');
    cy.visit(`/organizer/events/${eventId}/edit`);
    cy.location('pathname').should('eq', '/organizer/events');

    cy.visit('/leagues-archive');
    cy.contains('[data-cy="leagues-archive-list-item"]', 'Server League').should('exist');
    cy.get('[data-cy="leagues-archive-list-create-card"]').should('not.exist');
    cy.window().then((win) => win.localStorage.setItem(POWER_KEY, 'true'));
    cy.reload();
    cy.get('[data-cy="leagues-archive-list-create-card"]').should('exist');

    cy.visit('/organizer/events');
    cy.wait('@managedEvents');
    cy.get('[data-cy="event-edit"]').should('exist');
    cy.get('[data-cy="event-cancel"]').should('exist');
    cy.get('[data-cy="event-delete"]').should('exist');
  });

  it('keeps Calendar Register available while Power mode is off', () => {
    signedOut();
    stubPublicEvents([publicEvent]);
    visit('/calendar?view=list&month=2030-08', false);

    cy.wait('@publicEvents');
    cy.get('[data-cy="calendar-card-register"]').should('be.visible');
    cy.get('[data-cy="calendar-create-event"]').should('not.exist');
  });

  it('keeps an anonymous local Live detail readable while mutations are off', () => {
    signedOut();
    visit('/live-tournaments', true);
    cy.get('[data-cy="create-running-tournament-card"]').click();
    cy.location('pathname').should('match', /^\/live-tournaments\/.+$/);
    cy.get('[data-cy="live-tournament-name-input"]').clear().type('Local Power Cup').blur();
    cy.contains('h1', 'Local Power Cup').should('be.visible');
    cy.wait(600);

    cy.window().then((win) => win.localStorage.setItem(POWER_KEY, 'false'));
    cy.reload();
    cy.contains('h1', 'Local Power Cup').should('be.visible');
    cy.get('[data-cy="live-read-only"]').should('be.visible');
    cy.get('[data-cy="live-tournament-advanced-settings-button"]').should('not.exist');
    cy.get('[data-cy="live-runner-meta-fields"]').should('not.exist');
    cy.get('[data-cy="live-add-player-card"]').should('not.exist');
    cy.get('[data-cy="live-start-tournament-button"]').should('not.exist');

    cy.visit('/live-tournaments/new');
    cy.location('pathname').should('eq', '/live-tournaments');
    cy.contains('[data-cy="running-tournament-card"]', 'Local Power Cup').should('exist');
    cy.get('[data-cy="create-running-tournament-card"]').should('not.exist');

    cy.window().then((win) => win.localStorage.setItem(POWER_KEY, 'true'));
    cy.reload();
    cy.get('[data-cy="create-running-tournament-card"]').should('exist');
  });

  it('keeps Organizer server Live reads available without allowing a mutation', () => {
    organizer();
    const mutationCalls = [];
    cy.intercept('GET', /\/api\/leagues-archive\?.*/, { items: [], page: 1, pageSize: 100, totalCount: 0 });
    cy.intercept('GET', /\/api\/live-tournaments\?.*/, {
      items: [{ id: serverLive.id, name: serverLive.name, tournamentDate: serverLive.tournamentDate, stage: serverLive.stage, updatedAt: serverLive.updatedAt, documentVersion: serverLive.documentVersion }],
      page: 1, pageSize: 100, totalCount: 1
    });
    cy.intercept('GET', '**/api/live-tournaments/live-power/document', { document: serverLive, documentVersion: 1, serverUpdatedAt: serverLive.updatedAt });
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      cy.intercept(method, /\/api\/live-tournaments(?:\/|$)/, (req) => {
        mutationCalls.push(`${req.method} ${req.url}`);
        req.reply({ statusCode: 500, body: { code: 'must_not_happen', message: 'Power gate failed.' } });
      });
    }

    visit('/live-tournaments/live-power', false);
    cy.contains('h1', 'Server Power Cup').should('be.visible');
    cy.get('[data-cy="live-read-only"]').should('be.visible');
    cy.get('[data-cy="live-player-name-read-only"]').should('contain', 'Alice');
    cy.get('[data-cy="live-player-paid-read-only"]').should('be.visible');
    cy.get('[data-cy="live-tournament-advanced-settings-button"]').should('not.exist');
    cy.get('[data-cy="live-add-player-card"]').should('not.exist');
    cy.get('[data-cy="live-player-name-input"]').should('not.exist');
    cy.get('[data-cy="live-player-paid-checkbox"]').should('not.exist');
    cy.get('[data-cy="live-player-remove-button"]').should('not.exist');

    cy.visit('/live-tournaments/new');
    cy.location('pathname').should('eq', '/live-tournaments');
    cy.get('[data-cy="live-list-heading"]').should('be.visible');
    cy.get('[data-cy="create-running-tournament-card"]').should('not.exist');
    cy.then(() => expect(mutationCalls, 'Live mutation requests').to.deep.equal([]));

    cy.window().then((win) => win.localStorage.setItem(POWER_KEY, 'true'));
    cy.reload();
    cy.get('[data-cy="create-running-tournament-card"]').should('exist');
    cy.visit('/live-tournaments/live-power');
    cy.get('[data-cy="live-tournament-advanced-settings-button"]').should('exist');
    cy.get('[data-cy="live-add-player-card"]').should('exist');
  });
});
