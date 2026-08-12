const event = {
  id: '11111111-1111-1111-1111-111111111111', title: 'Lyon Legacy', slug: 'lyon-legacy', summary: 'Legacy event',
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris', venueStartDate: '2035-03-04', venueStartTime: '10:00:00', venueEndDate: '2035-03-04', venueEndTime: '18:00:00',
  startsAtUtc: '2035-03-04T09:00:00Z', endsAtUtc: '2035-03-04T17:00:00Z', capacity: 2, status: 'Published', bodyHtml: undefined,
  organization: { id: '22222222-2222-2222-2222-222222222222', name: 'Gones', description: '', website: undefined, contactEmail: undefined },
  formats: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]
};
const profile = { id: 'user', email: 'user@example.test', emailVerified: true, globalRole: 'User', username: 'CurrentUser', firstName: 'Current', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false };
const participants = { items: [{ userId: 'other', username: 'PublicUser', firstName: 'Visible', lastName: undefined, location: undefined, birthYear: undefined, preferredLanguage: undefined }] };

function common() {
  cy.intercept('GET', '**/api/events/lyon-legacy', event).as('detail');
  cy.intercept('GET', '**/api/events/lyon-legacy/participants', participants).as('participants');
}

function authenticated(overrides = {}) {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', { ...profile, ...overrides });
}

// Seed 'fr': every text assertion in this spec is French ('Vérifiez votre e-mail', 'complet',
// 'Annulée par vous', …). loadSettingsLanguage() reads the 'gones.settings' JSON first and only falls
// back to 'gones.settings.language', so seeding 'en' renders an English UI and makes those assertions
// unsatisfiable. Both keys must agree.
const SEED_MARKER = 'gones.e2e.storage-seeded';

function seedStorage(win) {
  win.localStorage.setItem('gones.first-visit.completed', 'true');
  win.localStorage.setItem('gones.settings.language', 'fr');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'fr', deckArchetypes: [] }));
  win.localStorage.setItem(SEED_MARKER, 'true');
}

// Seeding only from `onBeforeLoad` is not reliable on the release topology. The production build
// registers the ngsw service worker, and once that worker controls the page it answers the navigation
// request out of its own cache: the document never travels through the Cypress proxy, so Cypress
// cannot install its hook and `onBeforeLoad` is simply never called — no error, no seed. Proved by
// unregistering the worker mid-spec, after which the hook fires again and '/' stops bouncing to
// '/about'. Under `ng serve` the worker is disabled, which is why this spec was green on 4200. So the
// seed is re-applied from the loaded window and the page is visited once more when the hook was
// skipped; the marker keeps that to a single extra load per test.
function visit(path) {
  cy.visit(path, { onBeforeLoad: seedStorage });
  cy.window({ log: false }).then(win => {
    if (win.localStorage.getItem(SEED_MARKER) === 'true') return;
    seedStorage(win);
    cy.visit(path);
  });
}

describe('public participant registration', () => {
  beforeEach(() => { cy.viewport(1280, 800); common(); });

  it('prompts Visitors to sign in and exposes only public participant fields', () => {
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401 });
    visit('/events/lyon-legacy');
    cy.get('[data-cy="registration-login"]').should('be.visible');
    cy.get('[data-cy="public-participant"]').should('contain.text', 'PublicUser').and('contain.text', 'Visible').and('not.contain.text', 'user@example.test');
    cy.get('[data-cy="public-event-detail"]').should('not.contain.text', '@example.test');
  });

  it('shows server-derived unverified, blocked, full, and started reasons', () => {
    authenticated({ emailVerified: false });
    cy.intercept('GET', '**/api/events/*/registration-capability', { canRegister: false, canUnregister: false, reason: 'email_verification_required', activeParticipantCount: 1, capacity: 2 });
    visit('/events/lyon-legacy');
    cy.get('[data-cy="unverified-banner"]').should('be.visible');
    cy.get('[data-cy="registration-reason"]').should('contain.text', 'Vérifiez votre e-mail');

    for (const [reason, copy] of [['registration_blocked', 'bloqué'], ['event_full', 'complet'], ['registration_closed', 'commencé']]) {
      cy.intercept('GET', '**/api/events/*/registration-capability', { canRegister: false, canUnregister: false, reason, activeParticipantCount: 2, capacity: 2 });
      visit('/events/lyon-legacy');
      cy.get('[data-cy="registration-reason"]').should('contain.text', copy);
    }
  });

  it('locks double clicks, sends idempotency keys, confirms unregister, then allows re-register', () => {
    authenticated();
    let state = 'available';
    const keys = [];
    let registerCalls = 0;
    cy.intercept('GET', '**/api/events/*/registration-capability', req => req.reply({
      canRegister: state === 'available', canUnregister: state === 'registered', reason: state, activeParticipantCount: state === 'registered' ? 1 : 0, capacity: 2
    }));
    cy.intercept('POST', '**/api/events/*/registrations', req => {
      registerCalls += 1;
      keys.push(req.headers['idempotency-key']);
      state = 'registered';
      req.reply({ statusCode: 201, delay: 150, body: { attemptId: `attempt-${registerCalls}`, eventId: event.id, userId: 'user', status: 'Confirmed', registeredAt: '2030-01-01T00:00:00Z' } });
    }).as('register');
    cy.intercept('DELETE', '**/api/events/*/registrations', req => {
      state = 'available';
      req.reply({ attemptId: 'attempt', eventId: event.id, userId: 'user', status: 'CancelledByUser', registeredAt: '2030-01-01T00:00:00Z', statusChangedAt: '2030-01-02T00:00:00Z' });
    }).as('unregister');

    visit('/events/lyon-legacy');
    cy.get('[data-cy="registration-actions"]').find('[data-cy="registration-ics"]').should('have.attr', 'href').and('contain', '/api/events/lyon-legacy.ics');
    cy.get('[data-cy="registration-actions"]').find('[data-cy="registration-register"]').should('exist');
    cy.get('[data-cy="my-registrations-link"]').should('not.exist');

    cy.get('[data-cy="registration-register"]').dblclick();
    // The dialog is a receipt, not an optimistic guess: nothing is confirmed while the POST is in
    // flight (the intercept above answers with a 150ms delay).
    cy.get('[data-cy="registration-success-title"]').should('not.exist');
    cy.wait('@register');
    cy.wrap(null).should(() => expect(registerCalls).to.eq(1));

    // One POST, one dialog: the second click of the dblclick must not stack a second confirmation.
    cy.get('mat-dialog-container').should('have.length', 1);
    cy.get('[data-cy="registration-success-message"]').should('contain.text', 'Lyon Legacy');
    cy.focused().should('have.attr', 'data-cy', 'registration-success-close');
    cy.get('mat-dialog-container').invoke('attr', 'aria-labelledby').then(id => {
      cy.get(`#${id}`).should('have.attr', 'data-cy', 'registration-success-title').and('contain.text', 'Vous êtes inscrit');
    });
    cy.get('body').type('{esc}');
    cy.get('mat-dialog-container').should('not.exist');
    cy.get('[data-cy="registration-status"]').should('have.focus').and('contain.text', 'confirmée');

    cy.get('[data-cy="registration-unregister"]').click();
    cy.get('mat-dialog-container').should('contain.text', 'Annuler votre inscription').find('button').contains('Annuler l’inscription').click();
    cy.wait('@unregister');
    cy.get('[data-cy="registration-register"]').should('be.visible').click();
    cy.wait('@register');
    cy.wrap(null).should(() => {
      expect(keys).to.have.length(2);
      expect(keys[0]).to.be.a('string').and.not.be.empty;
      expect(keys[1]).not.to.eq(keys[0]);
    });
  });

  it('confirms only what the server accepted and routes to My Registrations', () => {
    authenticated();
    cy.intercept('GET', '**/api/users/me/registrations?*', { items: [], page: 1, pageSize: 100, totalCount: 0 });
    cy.intercept('GET', '**/api/events/*/registration-capability', { canRegister: true, canUnregister: false, reason: 'available', activeParticipantCount: 0, capacity: 2 });
    cy.intercept('POST', '**/api/events/*/registrations', { statusCode: 500, body: { title: 'boom', status: 500 } }).as('failed');

    visit('/events/lyon-legacy');
    cy.get('[data-cy="registration-register"]').click();
    cy.wait('@failed');
    cy.get('[data-cy="registration-status"]').should('contain.text', 'échoué');
    cy.get('mat-dialog-container').should('not.exist');

    cy.intercept('POST', '**/api/events/*/registrations', { statusCode: 201, body: { attemptId: 'attempt', eventId: event.id, userId: 'user', status: 'Confirmed', registeredAt: '2030-01-01T00:00:00Z' } }).as('register');
    cy.get('[data-cy="registration-register"]').click();
    cy.wait('@register');
    cy.get('[data-cy="registration-success-my-registrations"]').click();
    cy.get('mat-dialog-container').should('not.exist');
    cy.location('pathname').should('eq', '/registrations');
  });

  it('rejects offline writes without request or optimistic capacity change at 375px', () => {
    cy.viewport(375, 812);
    authenticated();
    cy.intercept('GET', '**/api/events/*/registration-capability', { canRegister: true, canUnregister: false, reason: 'available', activeParticipantCount: 0, capacity: 2 });
    cy.intercept('POST', '**/api/events/*/registrations').as('register');
    visit('/events/lyon-legacy');
    cy.get('[data-cy="registration-register"]').should('be.enabled');
    cy.window().then(win => cy.stub(win.navigator, 'onLine').value(false));
    cy.get('[data-cy="registration-register"]').click();
    cy.get('[data-cy="registration-status"]').should('contain.text', 'Rien n’a été mis en file ni modifié');
    cy.get('[data-cy="registration-register"]').should('be.disabled');
    cy.get('[data-cy="registration-reason"]').should('not.exist');
    cy.document().then(doc => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
    cy.get('@register.all').should('have.length', 0);
  });
});

describe('My Registrations', () => {
  it('retries loading and separates upcoming from history with venue times and statuses', () => {
    cy.viewport(375, 812);
    authenticated();
    let calls = 0;
    cy.intercept('GET', '**/api/users/me/registrations?*', req => {
      calls += 1;
      if (calls === 1) { req.reply({ statusCode: 503 }); return; }
      req.reply({ items: [
        { attemptId: 'active', eventId: event.id, eventSlug: event.slug, eventTitle: event.title, organizationName: 'Gones', startsAtUtc: event.startsAtUtc, timeZoneId: event.timeZoneId, status: 'Confirmed', isCurrent: true, registeredByUserId: 'user', registeredAt: '2030-01-01T00:00:00Z' },
        { attemptId: 'old', eventId: event.id, eventSlug: event.slug, eventTitle: event.title, organizationName: 'Gones', startsAtUtc: event.startsAtUtc, timeZoneId: event.timeZoneId, status: 'CancelledByUser', isCurrent: false, registeredByUserId: 'user', registeredAt: '2029-01-01T00:00:00Z', statusChangedAt: '2029-01-02T00:00:00Z' }
      ], page: 1, pageSize: 100, totalCount: 2 });
    }).as('registrations');
    visit('/');
    cy.get('[data-cy="menu-registrations-card"]').click();
    cy.get('[data-cy="registrations-error"]').find('button').click();
    cy.get('[data-cy="registration-attempt"]').should('have.length', 2).and('contain.text', 'Europe/Paris').and('contain.text', 'Annulée par vous');
    cy.document().then(doc => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
  });
});
