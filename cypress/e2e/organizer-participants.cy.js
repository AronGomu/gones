const eventId = '11111111-1111-1111-1111-111111111111';
const otherEventId = '99999999-9999-9999-9999-999999999999';
const orgId = '22222222-2222-2222-2222-222222222222';
const userId = '33333333-3333-3333-3333-333333333333';
const registrationId = '44444444-4444-4444-4444-444444444444';
const profile = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'organizer@example.test', emailVerified: true, globalRole: 'Organizer',
  username: 'organizer-user', firstName: 'Organizer', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false,
  isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false
};
const event = {
  id: eventId, organizationId: orgId, organizationName: 'Owned Club', title: 'Lyon Legacy Open', slug: 'lyon-legacy-open',
  venueStartDate: '2030-08-01', venueStartTime: '10:00:00', startsAtUtc: '2030-08-01T08:00:00Z', city: 'Lyon',
  status: 'Published', version: 3, eTag: '"3"'
};
const participant = {
  attemptId: registrationId, userId, username: 'alice-user', firstName: 'Alice', lastName: 'Martin', email: 'alice@example.test',
  registeredAt: '2030-01-02T10:00:00Z', registeredByUserId: profile.id
};

function mockSession() {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', profile);
}

function visit(path = `/organizer/tournaments/${eventId}/participants`, language = 'en') {
  cy.visit(path, { onBeforeLoad(win) {
    win.localStorage.setItem('gones.settings.language', language);
    win.localStorage.setItem('gones.settings', JSON.stringify({ language, deckArchetypes: [] }));
  } });
}

function mockPage(items = [participant]) {
  cy.intercept('GET', '**/api/organizer/events?*', { items: [event], page: 1, pageSize: 100, totalCount: 1 }).as('event');
  cy.intercept('GET', `**/api/events/${eventId}/registrations?*`, { items, page: 1, pageSize: 20, totalCount: items.length }).as('participants');
  cy.intercept('GET', `**/api/organizations/${orgId}/blocked-users?*`, { items: [], page: 1, pageSize: 20, totalCount: 0 }).as('blocks');
  cy.intercept('GET', `**/api/organizations/${orgId}/notification-settings`, { organizationId: orgId, notifyOnRegistration: true, notifyOnUnregistration: false, updatedAt: '2030-01-01T00:00:00Z' }).as('prefs');
}

describe('Organizer participant management', () => {
  beforeEach(() => { cy.viewport(1280, 800); mockSession(); });

  it('shows private paged fields, selects verified User lookup, locks add, then explains capacity race', () => {
    mockPage();
    cy.intercept('GET', `**/api/organizations/${orgId}/users/lookup?*`, req => {
      expect(req.query).to.deep.include({ username: 'new-user' });
      expect(req.query.email).to.be.undefined;
      req.reply({ userId: 'new-user-id', username: 'new-user', firstName: 'New', lastName: 'User', email: 'new@example.test' });
    }).as('lookup');
    let addCalls = 0;
    cy.intercept('POST', `**/api/events/${eventId}/registrations/by-organizer`, req => {
      addCalls += 1;
      expect(req.body).to.deep.equal({ userId: 'new-user-id' });
      expect(req.body).not.to.have.keys('email', 'firstName', 'lastName', 'username');
      req.reply({ delay: 200, statusCode: 409, headers: { 'content-type': 'application/problem+json' }, body: { code: 'event_full', title: 'Conflict' } });
    }).as('add');

    visit();
    cy.wait(['@participants', '@blocks', '@prefs']);
    cy.get('[data-cy="participant-row"]').should('contain.text', 'alice-user').and('contain.text', 'Alice Martin').and('contain.text', 'alice@example.test').and('contain.text', 'Active');
    cy.get('[data-cy="participant-lookup-input"]').type('new-user{enter}');
    cy.wait('@lookup');
    cy.get('[data-cy="participant-selection"]').should('contain.text', 'new@example.test');
    cy.get('[data-cy="participant-add"]').dblclick().should('be.disabled');
    cy.wait('@add');
    cy.wrap(null).should(() => expect(addCalls).to.eq(1));
    cy.get('[data-cy="participant-error"]').should('contain.text', 'filled');
  });

  it('uses explicit remove, block, remove-and-block, unblock commands with org scope and expiry', () => {
    mockPage();
    let removeCalls = 0;
    let blockCalls = 0;
    cy.intercept('DELETE', `**/api/events/${eventId}/registrations/${registrationId}`, req => {
      removeCalls += 1;
      req.reply({ attemptId: registrationId, eventId, userId, status: 'RemovedByOrganizer', registeredAt: participant.registeredAt, statusChangedAt: '2030-01-03T00:00:00Z' });
    }).as('remove');
    cy.intercept('POST', `**/api/organizations/${orgId}/blocked-users`, req => {
      blockCalls += 1;
      expect(req.body.userId).to.eq(userId);
      expect(req.body.reason).to.eq('Repeated abuse');
      expect(req.body.expiresAt).to.match(/^2031-01-02T/);
      req.reply({ blockId: 'block-1', organizationId: orgId, userId, username: 'alice-user', reason: req.body.reason, blockedAt: '2030-01-03T00:00:00Z', expiresAt: req.body.expiresAt });
    }).as('block');

    visit();
    cy.get('[data-cy="participant-block"]:visible').click();
    cy.get('mat-dialog-container').should('contain.text', 'Owned Club').invoke('text').should('match', /does not remove|ne retire pas/i);
    cy.wait(200);
    cy.get('[data-cy="block-reason"]').type('Repeated abuse').should('have.value', 'Repeated abuse');
    cy.get('[data-cy="block-expiry"]').type('2031-01-02T10:30');
    cy.get('[data-cy="block-confirm"]').click();
    cy.wait('@block');
    cy.wrap(null).should(() => { expect(blockCalls).to.eq(1); expect(removeCalls).to.eq(0); });

    cy.get('[data-cy="participant-remove-block"]:visible').click();
    cy.get('mat-dialog-container').invoke('text').should('match', /two explicit actions|deux actions explicites/i);
    cy.wait(200);
    cy.get('[data-cy="block-reason"]').type('Repeated abuse').should('have.value', 'Repeated abuse');
    cy.get('[data-cy="block-expiry"]').type('2031-01-02T10:30');
    cy.get('[data-cy="block-confirm"]').click();
    cy.wait('@remove');
    cy.wait('@block');
    cy.wrap(null).should(() => { expect(removeCalls).to.eq(1); expect(blockCalls).to.eq(2); });

    cy.intercept('GET', `**/api/organizations/${orgId}/blocked-users?*`, { items: [{ blockId: 'block-1', organizationId: orgId, userId, username: 'alice-user', reason: 'Repeated abuse', blockedAt: '2030-01-03T00:00:00Z', expiresAt: '2031-01-02T09:30:00Z' }], page: 1, pageSize: 20, totalCount: 1 });
    cy.intercept('DELETE', `**/api/organizations/${orgId}/blocked-users/${userId}`, { statusCode: 204 }).as('unblock');
    cy.get('[data-cy="blocked-refresh"]').click();
    cy.get('[data-cy="blocked-user"]').should('contain.text', '2031').find('[data-cy="participant-unblock"]').click();
    cy.get('mat-dialog-container').should('contain.text', 'Owned Club');
    cy.contains('mat-dialog-container button', /unblock|débloquer/i).click();
    cy.wait('@unblock');
  });

  it('downloads authenticated CSV only after response and saves org notice preferences', () => {
    mockPage();
    cy.intercept('GET', `**/api/events/${eventId}/registrations/export`, req => {
      expect(req.headers.authorization).to.eq('Bearer memory-token');
      req.reply({ delay: 250, statusCode: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="lyon-legacy-open-participants.csv"', 'access-control-expose-headers': 'Content-Disposition' }, body: 'Username,Email\r\nalice-user,alice@example.test\r\n' });
    }).as('csv');
    cy.intercept('PUT', `**/api/organizations/${orgId}/notification-settings`, req => {
      expect(req.body).to.deep.equal({ notifyOnRegistration: false, notifyOnUnregistration: true });
      req.reply({ delay: 200, body: { organizationId: orgId, ...req.body, updatedAt: '2030-01-02T00:00:00Z' } });
    }).as('savePrefs');

    visit();
    cy.get('[data-cy="participant-export"]').click().should('be.disabled');
    cy.get('[data-cy="participant-status"]').should('not.exist');
    cy.wait('@csv');
    cy.get('[data-cy="participant-status"]').should('contain.text', 'lyon-legacy-open-participants.csv').and('contain.text', 'text/csv');
    cy.readFile('cypress/downloads/lyon-legacy-open-participants.csv').should('contain', 'alice@example.test');

    cy.get('[data-cy="notify-registration"]').uncheck();
    cy.get('[data-cy="notify-unregistration"]').check();
    cy.get('[data-cy="notification-save"]').click().should('be.disabled');
    cy.wait('@savePrefs');
    cy.get('[data-cy="participant-status"]').invoke('text').should('match', /saved|enregistrées/i);
  });

  it('denies cross-org URLs, retries errors, supports keyboard dialog focus, French, mobile cards', () => {
    cy.intercept('GET', '**/api/organizer/events?*', { items: [event], page: 1, pageSize: 100, totalCount: 1 });
    cy.intercept('GET', `**/api/events/${otherEventId}/registrations?*`, { statusCode: 404, headers: { 'content-type': 'application/problem+json' }, body: { code: 'not_found' } }).as('denied');
    visit(`/organizer/tournaments/${otherEventId}/participants`);
    cy.get('[data-cy="participant-error"]').should('be.visible').and('not.contain.text', 'alice@example.test');

    cy.viewport(375, 812);
    mockPage();
    let participantCalls = 0;
    cy.intercept('GET', `**/api/events/${eventId}/registrations?*`, req => {
      participantCalls += 1;
      if (participantCalls === 1) req.reply({ statusCode: 503 });
      else req.reply({ items: [participant], page: 1, pageSize: 20, totalCount: 1 });
    });
    visit(undefined, 'fr');
    cy.get('[data-cy="participant-error"] button').click();
    cy.get('[data-cy="participant-card"]').should('be.visible').and('contain.text', 'Alice Martin');
    cy.get('[data-cy="participant-table"]').should('not.be.visible');
    cy.get('[data-cy="participant-remove"]:visible').focus().type('{enter}');
    cy.get('mat-dialog-container').should('be.visible');
    cy.contains('mat-dialog-container button', /retirer/i).should('have.focus');
    cy.get('body').type('{esc}');
    cy.get('[data-cy="participant-remove"]:visible').should('have.focus');
    cy.document().then(doc => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
  });
});
