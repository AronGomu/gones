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

describe('Power User Event and League gates', () => {
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
});
