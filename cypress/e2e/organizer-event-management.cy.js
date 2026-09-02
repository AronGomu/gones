const eventId = '11111111-1111-1111-1111-111111111111';
const orgId = '22222222-2222-2222-2222-222222222222';
const formatId = '33333333-3333-3333-3333-333333333333';
const firstImageId = '55555555-5555-5555-5555-555555555555';
const secondImageId = '66666666-6666-6666-6666-666666666666';
const latestImageId = '77777777-7777-7777-7777-777777777777';
const profile = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'organizer@example.test', emailVerified: true, globalRole: 'Organizer',
  username: 'organizer-user', firstName: 'Organizer', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false,
  isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false
};
const event = {
  id: eventId, organizationId: orgId, organizationName: 'Owned Club', title: 'Lyon Legacy Open', displayTitle: 'Legacy — Lyon Legacy Open', slug: 'lyon-legacy-open',
  summary: 'Summary', bodyMarkdown: 'Body', liveTournamentUrl: '/live/keep-exact', archiveTournamentUrl: '/archive/keep-exact',
  location: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France', region: 'Auvergne-Rhône-Alpes', locationToken: 'editor-location-token' },
  streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France', region: 'Auvergne-Rhône-Alpes',
  eventType: 'weekly', timeZoneId: 'Europe/Paris', startsAtLocal: '2027-08-01T10:00', venueStartDate: '2027-08-01', venueStartTime: '10:00:00', venueEndDate: '2027-08-01',
  venueEndTime: '23:59:59', startsAtUtc: '2027-08-01T08:00:00Z', endsAtUtc: '2027-08-01T21:59:59Z', capacity: 32,
  status: 'Published', formatIds: [formatId], images: [
    { id: firstImageId, altText: 'First image', variants: [{ width: 320, height: 180, url: `/api/event-images/${firstImageId}/variants/320` }] },
    { id: secondImageId, altText: 'Second image', variants: [{ width: 320, height: 180, url: `/api/event-images/${secondImageId}/variants/320` }] }
  ], version: 3, eTag: '"3"'
};
const pastEvent = { ...event, id: '44444444-4444-4444-4444-444444444444', title: 'Started Open', startsAtUtc: '2025-01-01T09:00:00Z', status: 'InProgress', eTag: '"5"', version: 5 };

function mockSession(globalRole = 'Organizer') {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2027-08-01T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', { ...profile, globalRole });
}

function mockFormats() {
  cy.intercept('GET', '**/api/formats', [{ id: formatId, name: 'Legacy', slug: 'legacy', sortOrder: 1 }]).as('formats');
}

const SEED_MARKER = 'gones.e2e.storage-seeded';

function seedLanguage(win, language) {
  win.localStorage.setItem('gones.settings.language', language);
  win.localStorage.setItem('gones.settings', JSON.stringify({ language, deckArchetypes: [] }));
  win.localStorage.setItem('gones.settings.power-user', 'true');
  win.localStorage.setItem(SEED_MARKER, 'true');
}

// Breadcrumbs and dialog copy are translated, so the language has to be in localStorage before the
// bundle runs. `onBeforeLoad` is Cypress' only pre-boot hook and on the release profile it stops
// firing once `ngsw-worker.js` has registered: the worker answers the navigation from Cache Storage,
// that response never passes through the Cypress proxy, and Cypress cannot inject the script that
// calls `onBeforeLoad`. The app then boots on its default `fr` and an English assertion reads French.
// Seeding again from the loaded page and raising the `storage` event the app already listens for to
// follow settings changed in another tab pins it — a same-window write never fires that event on its
// own. The wait on `gones.settings` is what makes the branch honest: the app persists that key while
// it boots, so reaching it means the language read below is the one the app actually booted on.
//
// The seed carries the same two settings the gated UI needs, so a marker now has to be there too
// before the seed counts as landed: a skipped hook leaves the app on its default `fr`, which it then
// persists itself, so a French `visit` used to read its own default back as proof of a seed that
// never happened and silently left the Power User key unset — with every Power-User-gated control
// missing. The language still has to match as well, because the marker outlives the visit that wrote
// it and a later `visit` in the same test may ask for another language. Both keys are announced,
// because each settings service only listens for its own.
function visit(path, language = 'en') {
  cy.visit(path, { onBeforeLoad: (win) => seedLanguage(win, language) });
  cy.window().its('localStorage').invoke('getItem', 'gones.settings').should('be.a', 'string');
  cy.window().then((win) => {
    if (win.localStorage.getItem(SEED_MARKER) === 'true' && win.localStorage.getItem('gones.settings.language') === language) return;
    seedLanguage(win, language);
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings.language', newValue: language }));
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings.power-user', newValue: 'true' }));
  });
  cy.document().its('documentElement.lang').should('eq', language);
}

describe('Organizer Event management', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('lists my-org events, hides cutoff actions, explains cancel/delete, sends If-Match, and locks pending actions', () => {
    mockSession();
    cy.intercept('GET', '**/api/organizer/events?*', { items: [event, pastEvent], page: 1, pageSize: 20, totalCount: 2 }).as('list');
    cy.intercept('POST', `**/api/events/${eventId}/cancel`, req => {
      expect(req.headers['if-match']).to.eq('"3"');
      expect(req.headers['idempotency-key']).to.be.a('string').and.not.be.empty;
      req.reply({ delay: 250, body: { id: eventId, status: 'Cancelled', isDeleted: false, version: 4, eTag: '"4"' } });
    }).as('cancel');
    visit('/organizer/events');
    cy.wait('@list');
    cy.get(`[data-cy="event-row-${eventId}"]`).within(() => {
      cy.get('[data-cy="event-edit"]').should('be.visible');
      cy.get('[data-cy="event-cancel"]').click();
    });
    cy.get('mat-dialog-container').should('contain.text', 'participant').invoke('text').should('match', /reminder|rappel/i);
    cy.get('mat-dialog-container button').contains(/cancel event|annuler l’événement/i).click();
    cy.get(`[data-cy="event-row-${eventId}"] [data-cy="event-cancel"]`).should('be.disabled');
    cy.wait('@cancel');
    cy.get('[data-cy="event-management-status"]').should('be.visible');

    cy.get(`[data-cy="event-row-${pastEvent.id}"]`).within(() => {
      cy.get('[data-cy="event-edit"]').should('not.exist');
      cy.get('[data-cy="event-delete"]').should('not.exist');
    });
  });

  it('hydrates nested media edit DTO, confirms major start change, and reloads stale canonical state without losing draft first', () => {
    mockSession();
    mockFormats();
    let listCall = 0;
    const latest = {
      ...event,
      title: 'Server title',
      location: { ...event.location, streetAddress: '9 Server Street', locationToken: 'latest-location-token' },
      streetAddress: '9 Server Street',
      images: [{ id: latestImageId, altText: 'Server image', variants: [{ width: 320, height: 180, url: `/api/event-images/${latestImageId}/variants/320` }] }],
      version: 4,
      eTag: '"4"'
    };
    cy.intercept('GET', '**/api/event-images/*/variants/*', { statusCode: 200, headers: { 'content-type': 'image/webp' }, body: '' });
    cy.intercept('GET', '**/api/organizer/events?*', req => {
      listCall += 1;
      req.reply({ items: [listCall === 1 ? event : latest], page: 1, pageSize: 100, totalCount: 1 });
    }).as('management');
    cy.intercept('PATCH', `**/api/organizer/events/${eventId}/details`, req => {
      expect(req.headers['if-match']).to.eq('"3"');
      expect(req.body).to.deep.equal({
        title: event.title,
        summary: event.summary,
        bodyMarkdown: 'Local Markdown draft',
        location: event.location,
        eventType: 'weekly',
        startsAtLocal: '2027-08-02T11:00',
        capacity: 32,
        formatIds: [formatId],
        images: [{ imageId: secondImageId, altText: 'Local second alt' }]
      });
      expect(req.body).not.to.have.keys('liveTournamentUrl', 'archiveTournamentUrl', 'endsAtLocal');
      req.reply({ statusCode: 412, headers: { 'content-type': 'application/problem+json' }, body: { code: 'stale_etag', title: 'Precondition Failed' } });
    }).as('stale');

    visit(`/organizer/events/${eventId}/edit`);
    cy.wait(['@management', '@formats']);
    cy.get('[data-cy="event-title"]').should('have.value', event.title);
    cy.get('[data-cy="event-end"]').should('not.exist');
    cy.get('[data-cy="event-live-tournament-url"]').should('not.exist');
    cy.get('[data-cy="event-archive-tournament-url"]').should('not.exist');
    cy.get(`[data-cy="event-image-card-existing-${firstImageId}"]`).should('be.visible');
    cy.get(`[data-cy="event-image-card-existing-${secondImageId}"]`).should('be.visible');
    cy.get(`[data-cy="event-image-move-left-existing-${secondImageId}"]`).click();
    cy.get(`[data-cy="event-image-alt-existing-${secondImageId}"]`).clear().type('Local second alt');
    cy.get(`[data-cy="event-image-remove-existing-${firstImageId}"]`).click();
    cy.get('[data-cy="event-body"]').clear().type('Local Markdown draft');
    cy.get('[data-cy="event-start-date"]').clear().type('2027-08-02');
    cy.get('[data-cy="event-start-time"]').clear().type('11:00');
    cy.get('[data-cy="event-save"]').click();
    cy.get('mat-dialog-container').invoke('text').should('match', /start date\/time|date\/heure de début/i);
    cy.get('mat-dialog-container button').contains(/save changes|enregistrer les modifications/i).click();
    cy.wait('@stale');
    cy.wait('@management');
    cy.get('[data-cy="event-stale"]').should('contain.text', 'Server title').invoke('text').should('match', /images/i);
    cy.get('[data-cy="event-body"]').should('have.value', 'Local Markdown draft');
    cy.get(`[data-cy="event-image-card-existing-${secondImageId}"]`).should('be.visible');
    cy.get(`[data-cy="event-image-card-existing-${firstImageId}"]`).should('not.exist');
    cy.get('[data-cy="event-reload-latest"]').click();
    cy.get('[data-cy="event-title"]').should('have.value', 'Server title');
    cy.get('[data-cy="event-street"]').should('have.value', '9 Server Street').and('have.focus');
    cy.get('[data-cy="event-location-token"]').should('have.value', 'latest-location-token');
    cy.get(`[data-cy="event-image-card-existing-${latestImageId}"]`).should('be.visible');
    cy.get(`[data-cy="event-image-card-existing-${secondImageId}"]`).should('not.exist');
  });

  it('confirms delete impact, restores as Admin, handles server rejection, and remains usable in French on mobile', () => {
    mockSession();
    cy.intercept('GET', '**/api/organizer/events?*', { items: [event], page: 1, pageSize: 20, totalCount: 1 }).as('list');
    cy.intercept('DELETE', `**/api/events/${eventId}`, { statusCode: 409, headers: { 'content-type': 'application/problem+json' }, body: { code: 'lifecycle_conflict', title: 'Conflict' } }).as('deleteRejected');
    cy.viewport(375, 812);
    visit('/organizer/events', 'fr');
    cy.wait('@list');
    cy.get('[data-cy="event-delete"]').click();
    cy.get('mat-dialog-container').invoke('text').should('match', /participant/i).and('match', /rappel/i);
    cy.get('mat-dialog-container button').contains(/supprimer/i).click();
    cy.wait('@deleteRejected');
    cy.get('[data-cy="event-management-error"]').should('be.visible');
    cy.document().then(doc => expect(doc.documentElement.scrollWidth).to.be.at.most(375));

    mockSession('Admin');
    const deleted = { ...event, deletedAt: '2026-07-01T10:00:00Z', deletedReason: 'Duplicate', version: 6, eTag: '"6"' };
    cy.intercept('GET', '**/api/admin/events/deleted?*', { items: [deleted], page: 1, pageSize: 20, totalCount: 1 }).as('deleted');
    cy.intercept('POST', `**/api/admin/events/${eventId}/restore`, req => {
      expect(req.headers['if-match']).to.eq('"6"');
      req.reply({ id: eventId, status: 'Published', isDeleted: false, version: 7, eTag: '"7"' });
    }).as('restore');
    visit('/admin/events/deleted');
    cy.wait('@deleted');
    cy.get('[data-cy="event-restore"]').click();
    cy.wait('@restore');
    cy.get('[data-cy="deleted-events-status"]').should('be.visible');
  });

  it('redirects the retired organizer and admin paths onto the canonical Event paths', () => {
    mockSession();
    mockFormats();
    cy.intercept('GET', '**/api/organizer/events?*', { items: [event], page: 1, pageSize: 20, totalCount: 1 }).as('list');
    visit('/organizer/tournaments');
    cy.location('pathname').should('eq', '/organizer/events');
    cy.wait('@list');
    cy.get(`[data-cy="event-row-${eventId}"]`).should('be.visible');
    cy.get('[data-cy="breadcrumb-current"]').should('have.text', 'My Events');

    visit(`/organizer/tournaments/${eventId}/edit`);
    cy.location('pathname').should('eq', `/organizer/events/${eventId}/edit`);
    cy.wait(['@list', '@formats']);
    cy.get('[data-cy="event-title"]').should('have.value', event.title);

    mockSession('Admin');
    cy.intercept('GET', '**/api/admin/events/deleted?*', { items: [], page: 1, pageSize: 20, totalCount: 0 }).as('deletedEmpty');
    visit('/admin/tournaments/deleted');
    cy.location('pathname').should('eq', '/admin/events/deleted');
    cy.wait('@deletedEmpty');
    cy.get('[data-cy="breadcrumb-current"]').should('have.text', 'Deleted Events');
  });
});
