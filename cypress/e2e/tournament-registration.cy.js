const tournament = {
  id: '11111111-1111-1111-1111-111111111111', title: 'Lyon Legacy', slug: 'lyon-legacy', summary: 'Legacy tournament',
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris', venueStartDate: '2035-03-04', venueStartTime: '10:00:00', venueEndDate: '2035-03-04', venueEndTime: '18:00:00',
  startsAtUtc: '2035-03-04T09:00:00Z', endsAtUtc: '2035-03-04T17:00:00Z', capacity: 2, status: 'Published', bodyHtml: undefined,
  organization: { id: '22222222-2222-2222-2222-222222222222', name: 'Gones', description: '', website: undefined, contactEmail: undefined },
  formats: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]
};
const profile = { id: 'user', email: 'user@example.test', emailVerified: true, globalRole: 'User', username: 'CurrentUser', firstName: 'Current', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false };
const participants = { items: [{ userId: 'other', username: 'PublicUser', firstName: 'Visible', lastName: undefined, location: undefined, birthYear: undefined, preferredLanguage: undefined }] };

function common() {
  cy.intercept('GET', '**/api/tournaments/lyon-legacy', tournament).as('detail');
  cy.intercept('GET', '**/api/tournaments/lyon-legacy/participants', participants).as('participants');
}

function authenticated(overrides = {}) {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2030-01-01T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', { ...profile, ...overrides });
}

function visit(path) {
  cy.visit(path, { onBeforeLoad(win) {
    win.localStorage.setItem('gones.settings.language', 'en');
    win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  } });
}

describe('public participant registration', () => {
  beforeEach(() => { cy.viewport(1280, 800); common(); });

  it('prompts Visitors to sign in and exposes only public participant fields', () => {
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401 });
    visit('/calendar/tournaments/lyon-legacy');
    cy.get('[data-cy="registration-login"]').should('be.visible');
    cy.get('[data-cy="public-participant"]').should('contain.text', 'PublicUser').and('contain.text', 'Visible').and('not.contain.text', 'user@example.test');
    cy.get('[data-cy="public-tournament-detail"]').should('not.contain.text', '@example.test');
  });

  it('shows server-derived unverified, blocked, full, and started reasons', () => {
    authenticated({ emailVerified: false });
    cy.intercept('GET', '**/api/tournaments/*/registration-capability', { canRegister: false, canUnregister: false, reason: 'email_verification_required', activeParticipantCount: 1, capacity: 2 });
    visit('/calendar/tournaments/lyon-legacy');
    cy.get('[data-cy="unverified-banner"]').should('be.visible');
    cy.get('[data-cy="registration-reason"]').should('contain.text', 'Vérifiez votre e-mail');

    for (const [reason, copy] of [['registration_blocked', 'bloqué'], ['tournament_full', 'complet'], ['registration_closed', 'commencé']]) {
      cy.intercept('GET', '**/api/tournaments/*/registration-capability', { canRegister: false, canUnregister: false, reason, activeParticipantCount: 2, capacity: 2 });
      visit('/calendar/tournaments/lyon-legacy');
      cy.get('[data-cy="registration-reason"]').should('contain.text', copy);
    }
  });

  it('locks double clicks, sends idempotency keys, confirms unregister, then allows re-register', () => {
    authenticated();
    let state = 'available';
    const keys = [];
    let registerCalls = 0;
    cy.intercept('GET', '**/api/tournaments/*/registration-capability', req => req.reply({
      canRegister: state === 'available', canUnregister: state === 'registered', reason: state, activeParticipantCount: state === 'registered' ? 1 : 0, capacity: 2
    }));
    cy.intercept('POST', '**/api/tournaments/*/registrations', req => {
      registerCalls += 1;
      keys.push(req.headers['idempotency-key']);
      state = 'registered';
      req.reply({ statusCode: 201, delay: 150, body: { attemptId: `attempt-${registerCalls}`, tournamentId: tournament.id, userId: 'user', status: 'Confirmed', registeredAt: '2030-01-01T00:00:00Z' } });
    }).as('register');
    cy.intercept('DELETE', '**/api/tournaments/*/registrations', req => {
      state = 'available';
      req.reply({ attemptId: 'attempt', tournamentId: tournament.id, userId: 'user', status: 'CancelledByUser', registeredAt: '2030-01-01T00:00:00Z', statusChangedAt: '2030-01-02T00:00:00Z' });
    }).as('unregister');

    visit('/calendar/tournaments/lyon-legacy');
    cy.get('[data-cy="registration-register"]').dblclick();
    cy.wait('@register');
    cy.wrap(null).should(() => expect(registerCalls).to.eq(1));
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

  it('rejects offline writes without request or optimistic capacity change at 375px', () => {
    cy.viewport(375, 812);
    authenticated();
    cy.intercept('GET', '**/api/tournaments/*/registration-capability', { canRegister: true, canUnregister: false, reason: 'available', activeParticipantCount: 0, capacity: 2 });
    cy.intercept('POST', '**/api/tournaments/*/registrations').as('register');
    visit('/calendar/tournaments/lyon-legacy');
    cy.window().then(win => cy.stub(win.navigator, 'onLine').value(false));
    cy.get('[data-cy="registration-register"]').click();
    cy.get('[data-cy="registration-status"]').should('contain.text', 'Rien n’a été mis en file ni modifié');
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
        { attemptId: 'active', tournamentId: tournament.id, tournamentSlug: tournament.slug, tournamentTitle: tournament.title, organizationName: 'Gones', startsAtUtc: tournament.startsAtUtc, timeZoneId: tournament.timeZoneId, status: 'Confirmed', isCurrent: true, registeredByUserId: 'user', registeredAt: '2030-01-01T00:00:00Z' },
        { attemptId: 'old', tournamentId: tournament.id, tournamentSlug: tournament.slug, tournamentTitle: tournament.title, organizationName: 'Gones', startsAtUtc: tournament.startsAtUtc, timeZoneId: tournament.timeZoneId, status: 'CancelledByUser', isCurrent: false, registeredByUserId: 'user', registeredAt: '2029-01-01T00:00:00Z', statusChangedAt: '2029-01-02T00:00:00Z' }
      ], page: 1, pageSize: 100, totalCount: 2 });
    }).as('registrations');
    visit('/registrations');
    cy.get('[data-cy="registrations-error"]').find('button').click();
    cy.get('[data-cy="registration-attempt"]').should('have.length', 2).and('contain.text', 'Europe/Paris').and('contain.text', 'Annulée par vous');
    cy.document().then(doc => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
  });
});
