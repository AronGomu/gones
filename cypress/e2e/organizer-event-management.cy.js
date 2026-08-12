const eventId = '11111111-1111-1111-1111-111111111111';
const orgId = '22222222-2222-2222-2222-222222222222';
const formatId = '33333333-3333-3333-3333-333333333333';
const profile = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'organizer@example.test', emailVerified: true, globalRole: 'Organizer',
  username: 'organizer-user', firstName: 'Organizer', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false,
  isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false
};
const event = {
  id: eventId, organizationId: orgId, organizationName: 'Owned Club', title: 'Lyon Legacy Open', slug: 'lyon-legacy-open',
  summary: 'Summary', bodyHtml: '<p>Body</p>', streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France',
  timeZoneId: 'Europe/Paris', venueStartDate: '2027-08-01', venueStartTime: '10:00:00', venueEndDate: '2027-08-01',
  venueEndTime: '18:00:00', startsAtUtc: '2027-08-01T08:00:00Z', endsAtUtc: '2027-08-01T16:00:00Z', capacity: 32,
  status: 'Published', formatIds: [formatId], version: 3, eTag: '"3"'
};
const pastEvent = { ...event, id: '44444444-4444-4444-4444-444444444444', title: 'Started Open', startsAtUtc: '2025-01-01T09:00:00Z', status: 'InProgress', eTag: '"5"', version: 5 };

function mockSession(globalRole = 'Organizer') {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2027-08-01T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', { ...profile, globalRole });
}

function mockFormats() {
  cy.intercept('GET', '**/api/formats', [{ id: formatId, name: 'Legacy', slug: 'legacy', sortOrder: 1 }]).as('formats');
}

function visit(path, language = 'en') {
  cy.visit(path, { onBeforeLoad(win) {
    win.localStorage.setItem('gones.settings.language', language);
    win.localStorage.setItem('gones.settings', JSON.stringify({ language, deckArchetypes: [] }));
  } });
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
    visit('/organizer/tournaments');
    cy.wait('@list');
    cy.get(`[data-cy="event-row-${eventId}"]`).within(() => {
      cy.get('[data-cy="event-edit"]').should('be.visible');
      cy.get('[data-cy="event-cancel"]').click();
    });
    cy.get('mat-dialog-container').should('contain.text', 'participant').invoke('text').should('match', /reminder|rappel/i);
    cy.get('mat-dialog-container button').contains(/cancel tournament|annuler le tournoi/i).click();
    cy.get(`[data-cy="event-row-${eventId}"] [data-cy="event-cancel"]`).should('be.disabled');
    cy.wait('@cancel');
    cy.get('[data-cy="event-management-status"]').should('be.visible');

    cy.get(`[data-cy="event-row-${pastEvent.id}"]`).within(() => {
      cy.get('[data-cy="event-edit"]').should('not.exist');
      cy.get('[data-cy="event-delete"]').should('not.exist');
    });
  });

  it('hydrates canonical edit DTO, confirms listed major changes, and recovers stale ETag without losing draft', () => {
    mockSession();
    mockFormats();
    let listCall = 0;
    const latest = { ...event, title: 'Server title', streetAddress: '9 Server Street', version: 4, eTag: '"4"' };
    cy.intercept('GET', '**/api/organizer/events?*', req => {
      listCall += 1;
      req.reply({ items: [listCall === 1 ? event : latest], page: 1, pageSize: 100, totalCount: 1 });
    }).as('management');
    cy.intercept('PATCH', `**/api/events/${eventId}/details`, req => {
      expect(req.headers['if-match']).to.eq('"3"');
      req.reply({ statusCode: 412, headers: { 'content-type': 'application/problem+json' }, body: { code: 'stale_etag', title: 'Precondition Failed' } });
    }).as('stale');

    visit(`/organizer/tournaments/${eventId}/edit`);
    cy.wait(['@management', '@formats']);
    cy.get('[data-cy="event-title"]').should('have.value', event.title);
    cy.get('[data-cy="event-street"]').clear().type('2 New Street');
    cy.get('[data-cy="event-start"]').clear().type('2027-08-02T11:00');
    cy.get('[data-cy="event-save"]').click();
    cy.get('mat-dialog-container').invoke('text').should('match', /start date\/time|date\/heure de début/i).and('match', /street address|adresse/i);
    cy.get('mat-dialog-container button').contains(/save changes|enregistrer les modifications/i).click();
    cy.wait('@stale');
    cy.wait('@management');
    cy.get('[data-cy="event-stale"]').should('contain.text', 'Server title').invoke('text').should('match', /street address|adresse/i);
    cy.get('[data-cy="event-street"]').should('have.value', '2 New Street');
    cy.get('[data-cy="event-reload-latest"]').click();
    cy.get('[data-cy="event-title"]').should('have.value', 'Server title');
    cy.get('[data-cy="event-street"]').should('have.value', '9 Server Street').and('have.focus');
  });

  it('confirms delete impact, restores as Admin, handles server rejection, and remains usable in French on mobile', () => {
    mockSession();
    cy.intercept('GET', '**/api/organizer/events?*', { items: [event], page: 1, pageSize: 20, totalCount: 1 }).as('list');
    cy.intercept('DELETE', `**/api/events/${eventId}`, { statusCode: 409, headers: { 'content-type': 'application/problem+json' }, body: { code: 'lifecycle_conflict', title: 'Conflict' } }).as('deleteRejected');
    cy.viewport(375, 812);
    visit('/organizer/tournaments', 'fr');
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
    visit('/admin/tournaments/deleted');
    cy.wait('@deleted');
    cy.get('[data-cy="event-restore"]').click();
    cy.wait('@restore');
    cy.get('[data-cy="deleted-events-status"]').should('be.visible');
  });
});
