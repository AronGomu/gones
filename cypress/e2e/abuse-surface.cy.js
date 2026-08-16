/**
 * Browser-side abuse gate (C40).
 *
 * Covers the abuse cases that only exist in the browser: open redirects through `returnUrl`,
 * hostile server HTML reaching `innerHTML`, and duplicate submits. Server-side abuse (IDOR,
 * mass assignment, stale writes, idempotency, webhook/refresh replay, CSV injection, oversized
 * bodies, rate limits) is covered by the ASP.NET integration suites.
 */

const orgId = '22222222-2222-2222-2222-222222222222';
const hostileBody = [
  '<p>Legit copy</p>',
  '<script>window.__pwned = true;<\/script>',
  '<img src=x onerror="window.__pwned = true">',
  '<iframe src="https://evil.test"></iframe>',
  '<a href="javascript:window.__pwned = true">bad link</a>'
].join('');

const event = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Lyon Legacy',
  slug: 'lyon-legacy',
  summary: 'Legacy event',
  bodyHtml: hostileBody,
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris',
  venueStartDate: '2026-08-01',
  venueStartTime: '10:00:00',
  venueEndDate: '2026-08-01',
  venueEndTime: '18:00:00',
  startsAtUtc: '2026-08-01T08:00:00Z',
  endsAtUtc: '2026-08-01T16:00:00Z',
  capacity: 32,
  status: 'Published',
  organization: { id: orgId, name: 'Gones', description: 'Lyon club', website: 'https://example.test', contactEmail: '' },
  formats: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]
};

function visit(path) {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('gones.settings.language', 'en');
      win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
    }
  });
}

describe('abuse surface', () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
  });

  it('never executes or renders hostile HTML delivered by the API', () => {
    cy.intercept('GET', '**/api/events/lyon-legacy', event).as('event');
    cy.intercept('GET', '**/api/events/lyon-legacy/participants*', { items: [], page: 1, pageSize: 20, totalCount: 0 });
    visit('/events/lyon-legacy');
    cy.wait('@event');

    cy.contains('Lyon Legacy').should('be.visible');
    cy.contains('Legit copy').should('be.visible');
    cy.get('.rich-content').then(($content) => {
      const html = $content.html().toLowerCase();
      expect(html, 'no script element').to.not.contain('<script');
      expect(html, 'no iframe').to.not.contain('<iframe');
      expect(html, 'no inline event handler').to.not.contain('onerror');
      expect(html, 'no javascript: url').to.not.contain('javascript:');
    });
    cy.window().its('__pwned').should('be.undefined');
    cy.get('.rich-content img, .rich-content iframe, .rich-content script').should('not.exist');
  });

  it('marks the external organization link noopener noreferrer', () => {
    cy.intercept('GET', '**/api/events/lyon-legacy', event).as('event');
    cy.intercept('GET', '**/api/events/lyon-legacy/participants*', { items: [], page: 1, pageSize: 20, totalCount: 0 });
    visit('/events/lyon-legacy');
    cy.wait('@event');

    cy.get('a[target="_blank"]').each(($link) => {
      const rel = ($link.attr('rel') ?? '').toLowerCase();
      expect(rel, `${$link.attr('href')} must be noopener noreferrer`).to.contain('noopener');
      expect(rel, `${$link.attr('href')} must be noopener noreferrer`).to.contain('noreferrer');
    });
  });

  it('never loads a remote image or remote script on a public page', () => {
    // The Calendar no longer pages through `GET /api/events?…`; it reads the whole catalog once
    // from `GET /api/events/all` and caches it (`AllEventsCacheService`). The wait is
    // retargeted at the request the page actually issues, and the response carries the catalog shape
    // (`PublicEventCatalogResponse`) so the page renders instead of erroring — the claim below
    // only means something on a Calendar that actually rendered.
    cy.intercept('GET', '**/api/events/all*', { items: [event], generatedAt: '2026-07-01T00:00:00Z', count: 1, truncated: false }).as('events');
    visit('/events');
    cy.wait('@events');
    cy.get('[data-cy="public-calendar"]').should('be.visible');
    cy.get('[data-cy="event-list-error"]').should('not.exist');

    cy.get('img').each(($image) => {
      const source = $image.attr('src') ?? '';
      expect(/^https?:\/\//i.test(source) && !source.startsWith(Cypress.config('baseUrl')), `remote image ${source}`).to.equal(false);
    });
    cy.get('script[src]').each(($script) => {
      const source = $script.attr('src') ?? '';
      expect(/^https?:\/\//i.test(source) && !source.startsWith(Cypress.config('baseUrl')), `remote script ${source}`).to.equal(false);
    });
  });

  it('refuses to redirect off-origin after a login carrying a hostile returnUrl', () => {
    cy.intercept('POST', '**/api/auth/login', { statusCode: 200, body: { accessToken: 'token', expiresAt: '2999-01-01T00:00:00Z', tokenType: 'Bearer' } }).as('login');
    cy.intercept('GET', '**/api/users/me', {
      id: '44444444-4444-4444-4444-444444444444',
      username: 'abuse-tester',
      email: 'abuse@example.test',
      firstName: 'Abuse',
      lastName: 'Tester',
      emailVerified: true,
      globalRole: 'User',
      preferredLanguage: 'en',
      isClosed: false
    }).as('profile');
    cy.intercept('GET', '**/api/users/me/**', { statusCode: 200, body: [] });

    visit('/login?returnUrl=https%3A%2F%2Fevil.test%2Fsteal');
    cy.get('input[name="email"]').type('abuse@example.test');
    cy.get('input[name="password"]').type('Sup3r-Secret-Passphrase!');
    cy.get('form').submit();
    cy.wait('@login');

    cy.location('origin').should('eq', Cypress.config('baseUrl').replace(/\/$/, ''));
    cy.location('pathname').should('not.contain', 'evil.test');
  });
});
