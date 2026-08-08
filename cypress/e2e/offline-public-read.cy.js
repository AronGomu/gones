const orgId = '22222222-2222-2222-2222-222222222222';
const tournament = {
  id: '11111111-1111-1111-1111-111111111111', title: 'Lyon Legacy', slug: 'lyon-legacy', summary: 'Legacy tournament',
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris', venueStartDate: '2035-03-04', venueStartTime: '10:00:00', venueEndDate: '2035-03-04', venueEndTime: '18:00:00',
  startsAtUtc: '2035-03-04T09:00:00Z', endsAtUtc: '2035-03-04T17:00:00Z', capacity: 8, status: 'Published',
  organization: { id: orgId, name: 'Gones', description: '', website: undefined, contactEmail: undefined },
  formats: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]
};
const profile = { id: 'user', email: 'user@example.test', emailVerified: true, globalRole: 'User', username: 'CurrentUser', firstName: 'Current', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false };
const participants = { items: [{ userId: 'other', username: 'PublicUser' }] };

function visit(path, options = {}) {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('gones.settings.language', 'en');
      win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
      if (options.offline) forceOffline(win);
    }
  });
}

function forceOffline(win) {
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
}

describe('offline public reads and rejected writes', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('replays cached public Calendar data offline behind a stale banner', () => {
    cy.intercept('GET', '**/api/tournaments/all*', { items: [tournament], generatedAt: '2035-03-01T00:00:00Z', count: 1, truncated: false }).as('tournaments');
    visit('/calendar?month=2035-03&view=list');
    cy.wait('@tournaments');
    cy.get('[data-cy="tournament-lyon-legacy"]').should('contain.text', 'Lyon Legacy');
    cy.get('.calendar-offline-banner').should('not.exist');

    cy.intercept('GET', '**/api/tournaments/all*', { forceNetworkError: true }).as('disconnected');
    visit('/calendar?month=2035-03&view=list', { offline: true });
    cy.get('[data-cy="tournament-lyon-legacy"]').should('contain.text', 'Lyon Legacy');
    cy.get('.calendar-offline-banner').should('be.visible').invoke('text').should('match', /offline|hors ligne/i);
  });

  it('refuses registration writes offline, queues nothing, and keeps the online-required UI', () => {
    let registerCalls = 0;
    cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2035-01-01T01:00:00Z', tokenType: 'Bearer' });
    cy.intercept('GET', '**/api/users/me', profile);
    cy.intercept('GET', '**/api/tournaments/lyon-legacy', tournament).as('detail');
    cy.intercept('GET', '**/api/tournaments/lyon-legacy/participants', participants);
    cy.intercept('GET', '**/api/tournaments/*/registration-capability', { canRegister: true, canUnregister: false, reason: 'available', activeParticipantCount: 0, capacity: 8 });
    cy.intercept('POST', '**/api/tournaments/*/registrations', req => {
      registerCalls += 1;
      req.reply({ statusCode: 201, body: { attemptId: 'attempt', tournamentId: tournament.id, userId: 'user', status: 'Confirmed', registeredAt: '2035-01-01T00:00:00Z' } });
    }).as('register');

    visit('/calendar/tournaments/lyon-legacy');
    cy.wait('@detail');
    cy.get('[data-cy="registration-register"]').should('be.enabled');

    cy.window().then(forceOffline);
    cy.get('[data-cy="registration-register"]').click();

    cy.get('[data-cy="registration-status"]').invoke('text').should('match', /Nothing was queued or changed|Rien n’a été mis en file ni modifié/);
    cy.get('[data-cy="registration-offline"]').should('be.visible');
    cy.get('[data-cy="registration-register"]').should('be.disabled');
    cy.wrap(null).should(() => expect(registerCalls).to.eq(0));
  });

  it('keeps auth, profile, and Admin responses out of every offline cache', () => {
    cy.intercept('GET', '**/api/tournaments/all*', { items: [tournament], generatedAt: '2035-03-01T00:00:00Z', count: 1, truncated: false }).as('tournaments');
    cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2035-01-01T01:00:00Z', tokenType: 'Bearer' });
    cy.intercept('GET', '**/api/users/me', profile);
    visit('/calendar?month=2035-03&view=list');
    cy.wait('@tournaments');

    cy.window().then(win => {
      const localKeys = Object.keys(win.localStorage).filter(key => /users|auth|admin|registration-capability|participants/.test(key));
      expect(localKeys, 'private responses in local cache').to.deep.eq([]);
      if (!win.caches) return undefined;
      return win.caches.keys()
        .then(names => Promise.all(names.map(name => win.caches.open(name).then(cache => cache.keys()))))
        .then(entries => {
          const cached = entries.flat().map(request => request.url);
          expect(cached.filter(url => /\/api\/(users|auth|admin|maintenance|organizer)\b/.test(url)), 'private responses in service worker cache').to.deep.eq([]);
          expect(cached.filter(url => /\/participants|\/registrations|\/registration-capability/.test(url)), 'participant responses in service worker cache').to.deep.eq([]);
        });
    });
  });
});
