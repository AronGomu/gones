const orgId = '22222222-2222-2222-2222-222222222222';
const event = {
  id: '11111111-1111-1111-1111-111111111111', title: 'Lyon Legacy', displayTitle: 'Lyon Legacy', slug: 'lyon-legacy', summary: 'Legacy event',
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris', venueStartDate: '2035-03-04', venueStartTime: '10:00:00', venueEndDate: '2035-03-04', venueEndTime: '18:00:00',
  startsAtUtc: '2035-03-04T09:00:00Z', endsAtUtc: '2035-03-04T17:00:00Z', capacity: 8, status: 'Published',
  organization: { id: orgId, name: 'Gones', description: '', website: undefined, contactEmail: undefined },
  formats: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]
};
const profile = { id: 'user', email: 'user@example.test', emailVerified: true, globalRole: 'User', username: 'CurrentUser', firstName: 'Current', lastName: 'User', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthYearPublic: false, isPreferredLanguagePublic: false };
const participants = { items: [{ userId: 'other', username: 'PublicUser' }] };

const SEED_MARKER = 'gones.e2e.storage-seeded';

function seedStorage(win) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  win.localStorage.setItem(SEED_MARKER, 'true');
}

// `onBeforeLoad` is not dependable on the release topology. The production build registers the ngsw
// service worker, and once that worker controls the page it answers the navigation request out of its
// own cache: the document never travels through the Cypress proxy, so Cypress cannot install its hook
// and `onBeforeLoad` is simply never called — no error, no seed, no forced offline flag. That is why
// this spec passed under `ng serve` (worker disabled) and lost its banner on 8081. Proved by
// unregistering the worker, after which the hook fires again and a page booted with
// `navigator.onLine === false` does render `.calendar-offline-banner`, so the offline affordance is
// intact for users. The boot-offline path below is kept for whenever the hook is available (under
// `ng serve`, and on the first visit of a spec).
//
// When the hook was skipped the page has already booted online, so drop the connection now and
// announce it exactly as a browser does when connectivity is lost mid-session. Either way the page
// under test is offline before anything is asserted.
function visit(path, options = {}) {
  cy.visit(path, {
    onBeforeLoad(win) {
      seedStorage(win);
      if (options.offline) forceOffline(win);
    }
  });
  cy.window({ log: false }).then(win => {
    if (win.localStorage.getItem(SEED_MARKER) !== 'true') seedStorage(win);
    if (options.offline && win.navigator.onLine) {
      forceOffline(win);
      win.dispatchEvent(new win.Event('offline'));
    }
  });
}

function forceOffline(win) {
  Object.defineProperty(win.navigator, 'onLine', { value: false, configurable: true });
}

describe('offline public reads and rejected writes', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('replays cached public Calendar data offline behind a stale banner', () => {
    cy.intercept('GET', '**/api/events/all*', { items: [event], generatedAt: '2035-03-01T00:00:00Z', count: 1, truncated: false }).as('events');
    visit('/events?month=2035-03&view=list');
    cy.wait('@events');
    cy.get('[data-cy="event-lyon-legacy"]').should('contain.text', 'Lyon Legacy');
    cy.get('.calendar-offline-banner').should('not.exist');

    cy.intercept('GET', '**/api/events/all*', { forceNetworkError: true }).as('disconnected');
    visit('/events?month=2035-03&view=list', { offline: true });
    cy.get('[data-cy="event-lyon-legacy"]').should('contain.text', 'Lyon Legacy');
    cy.get('.calendar-offline-banner').should('be.visible').invoke('text').should('match', /offline|hors ligne/i);
  });

  it('refuses registration writes offline, queues nothing, and keeps the online-required UI', () => {
    let registerCalls = 0;
    cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2035-01-01T01:00:00Z', tokenType: 'Bearer' });
    cy.intercept('GET', '**/api/users/me', profile);
    cy.intercept('GET', '**/api/events/lyon-legacy', event).as('detail');
    cy.intercept('GET', '**/api/events/lyon-legacy/participants', participants);
    cy.intercept('GET', '**/api/events/*/registration-capability', { canRegister: true, canUnregister: false, reason: 'available', activeParticipantCount: 0, capacity: 8 });
    cy.intercept('POST', '**/api/events/*/registrations', req => {
      registerCalls += 1;
      req.reply({ statusCode: 201, body: { attemptId: 'attempt', eventId: event.id, userId: 'user', status: 'Confirmed', registeredAt: '2035-01-01T00:00:00Z' } });
    }).as('register');

    visit('/events/lyon-legacy');
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
    cy.intercept('GET', '**/api/events/all*', { items: [event], generatedAt: '2035-03-01T00:00:00Z', count: 1, truncated: false }).as('events');
    cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2035-01-01T01:00:00Z', tokenType: 'Bearer' });
    cy.intercept('GET', '**/api/users/me', profile);
    visit('/events?month=2035-03&view=list');
    cy.wait('@events');

    cy.window().then(win => {
      const keys = Object.keys(win.localStorage);
      const authKeys = keys.filter(key => key.startsWith('gones.auth.')).sort();
      expect(authKeys, 'auth storage contains coordination metadata only').to.deep.eq(['gones.auth.sessionGeneration']);
      expect(win.localStorage.getItem('gones.auth.sessionGeneration')).to.match(/^\d+$/);
      const privateKeys = keys.filter(key => /users|admin|registration-capability|participants/.test(key));
      expect(privateKeys, 'private responses in local cache').to.deep.eq([]);
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
