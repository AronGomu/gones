const review = {
  id: 'proposal-1',
  event: {
    organizationId: 'org-1',
    title: 'Modern Cup',
    summary: 'A fun cup',
    bodyMarkdown: 'Plain description body',
    location: {
      streetAddress: '1 Rue Test',
      postalCode: '69001',
      city: 'Lyon',
      country: 'France',
      region: 'Auvergne-Rhône-Alpes',
      locationToken: 'proposal-location-token'
    },
    eventType: 'weekly',
    startsAtLocal: '2035-08-01T10:00',
    capacity: 32,
    formatIds: ['fmt-1'],
    images: []
  },
  bodyHtml: '<p>Plain description body</p>',
  timeZoneId: 'Europe/Paris',
  endsAtLocal: '2035-08-01T23:59:59',
  status: 'Pending',
  submittedByUsername: 'alice',
  approverUsername: 'bob',
  expiresAt: '2035-08-08T00:00:00Z',
  organizationName: 'Gones',
  formatNames: ['Legacy'],
  images: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      altText: 'Modern Cup poster',
      variants: [
        {
          width: 320,
          height: 180,
          url: '/api/event-requests/faketoken/images/11111111-1111-1111-1111-111111111111/variants/320'
        }
      ]
    }
  ]
};

const SEED_MARKER = 'gones.e2e.storage-seeded';

function seedLanguage(win) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  win.localStorage.setItem(SEED_MARKER, 'true');
}

/**
 * `AuthService.bootstrap()` always attempts one `POST /api/auth/refresh` on app start when the
 * build has `authV1` on (the default), regardless of route. This ticket's page is signed-out and
 * anonymous — it never calls `/api/auth/*` itself — but that startup refresh still fires. Stubbing
 * it here keeps every run of this spec off the real, IP-rate-limited auth endpoint (5 permits per
 * 15 minutes, shared with every other ticket on this host) while asserting the review page itself
 * makes none of its own auth calls. `ngsw-worker.js` can skip `onBeforeLoad` in release profile, so
 * loaded-page reseeding announces language through same storage event app uses across tabs.
 */
function visitAnonymous(path) {
  cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { title: 'Unauthorized' } }).as('authRefresh');
  cy.visit(path, { onBeforeLoad: seedLanguage });
  cy.window().its('localStorage').invoke('getItem', 'gones.settings').should('be.a', 'string');
  cy.window().then(win => {
    if (win.localStorage.getItem(SEED_MARKER) === 'true'
      && win.localStorage.getItem('gones.settings.language') === 'en') return;
    seedLanguage(win);
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings.language', newValue: 'en' }));
  });
  cy.document().its('documentElement.lang').should('eq', 'en');
}

describe('event request review page (signed out, intercept-based)', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('renders the proposal with private images, then validates it and shows the published link', () => {
    cy.intercept('GET', '**/api/event-proposals/by-token/*', review).as('byToken');
    cy.intercept('GET', '/api/event-requests/faketoken/images/11111111-1111-1111-1111-111111111111/variants/320', {
      statusCode: 200,
      headers: { 'content-type': 'image/webp', 'cache-control': 'no-store' },
      fixture: 'event-proposal-private.webp,null'
    }).as('proposalImage');
    cy.intercept('POST', '**/api/event-proposals/by-token/*/approve', { proposalId: 'proposal-1', status: 'Approved', slug: 'x' }).as('approve');

    visitAnonymous('/event-requests/faketoken');
    cy.wait('@byToken');

    cy.get('[data-cy="event-request-title"]').should('contain.text', 'Modern Cup');
    cy.get('[data-cy="event-request-fact-organization"]').should('contain.text', 'Gones');
    cy.get('[data-cy="event-request-fact-formats"]').should('contain.text', 'Legacy');
    cy.wait('@proposalImage').then(({ request, response }) => {
      expect(new URL(request.url).pathname).to.eq('/api/event-requests/faketoken/images/11111111-1111-1111-1111-111111111111/variants/320');
      expect(response.statusCode).to.eq(200);
      expect(response.headers['cache-control']).to.eq('no-store');
    });
    cy.get('[data-cy="event-request-image-11111111-1111-1111-1111-111111111111"]')
      .should($image => {
        expect($image).to.be.visible;
        expect($image).to.have.attr('loading', 'eager');
        expect($image).to.have.attr('src').and.include('/api/event-requests/faketoken/images/11111111-1111-1111-1111-111111111111/variants/320');
        expect($image[0].complete).to.eq(true);
        expect($image[0].naturalWidth).to.eq(320);
      });

    cy.get('[data-cy="event-request-validate"]').click();
    cy.wait('@approve');
    cy.get('[data-cy="event-request-approved"]').should('be.visible');
    cy.get('[data-cy="event-request-approved-link"]').should('have.attr', 'href').and('include', '/events/x');
  });

  it('refuses with a reason and shows the confirmation', () => {
    cy.intercept('GET', '**/api/event-proposals/by-token/*', review).as('byToken');
    cy.intercept('POST', '**/api/event-proposals/by-token/*/reject', { statusCode: 204, body: '' }).as('reject');

    visitAnonymous('/event-requests/faketoken');
    cy.wait('@byToken');

    cy.get('[data-cy="event-request-refuse"]').click();
    cy.get('[data-cy="event-request-reason"]').should('be.visible');
    cy.get('[data-cy="event-request-send-reason"]').should('be.disabled');

    cy.get('[data-cy="event-request-reason"]').type('Not a fit for our calendar');
    cy.get('[data-cy="event-request-send-reason"]').should('be.enabled').click();
    cy.wait('@reject').its('request.body').should('deep.equal', { reason: 'Not a fit for our calendar' });
    cy.get('[data-cy="event-request-refused"]').should('be.visible');
  });

  it('shows the expired panel for an unknown or expired token', () => {
    cy.intercept('GET', '**/api/event-proposals/by-token/*', { statusCode: 404, body: { title: 'Not Found', status: 404 } }).as('byToken');

    visitAnonymous('/event-requests/faketoken');
    cy.wait('@byToken');

    cy.get('[data-cy="event-request-expired"]').should('be.visible');
    cy.get('[data-cy="event-request-title"]').should('not.exist');
  });
});
