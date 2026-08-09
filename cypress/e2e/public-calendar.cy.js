const orgId = '22222222-2222-2222-2222-222222222222';
const tournament = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Lyon Legacy',
  slug: 'lyon-legacy',
  summary: 'Legacy tournament',
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris',
  venueStartDate: '2026-08-01',
  venueStartTime: '23:30:00',
  venueEndDate: '2026-08-02',
  venueEndTime: '01:30:00',
  startsAtUtc: '2026-08-01T21:30:00Z',
  endsAtUtc: '2026-08-01T23:30:00Z',
  capacity: 32,
  status: 'Cancelled',
  organization: { id: orgId, name: 'Gones', description: '', website: 'https://example.test', contactEmail: '' },
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

describe('public Calendar V1', () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.intercept('GET', '**/api/tournaments/all*', { items: [tournament], generatedAt: '2026-08-08T10:00:00Z', count: 1, truncated: false }).as('allTournaments');
  });

  it('defaults to month view, restores URL filters, persists list view, and filters locally without a network call', () => {
    visit('/calendar?month=2026-08&q=Lyon');
    cy.wait('@allTournaments');
    cy.get('[data-cy="public-calendar"]').should('be.visible');
    cy.get('[data-cy="calendar-view"]').should('have.attr', 'aria-pressed', 'true');
    cy.contains('.calendar-pill', 'Cancelled').should('be.visible');

    cy.get('[data-cy="list-view"]').click();
    cy.location('search').should('contain', 'view=list');
    cy.get('[data-cy="calendar-list"]').should('be.visible');
    // A reload within the 24h cache TTL must not refetch: the alias stays at one call.
    visit('/calendar?month=2026-08');
    cy.get('[data-cy="list-view"]').should('have.attr', 'aria-pressed', 'true');
    cy.get('@allTournaments.all').should('have.length', 1);

    cy.get('[data-cy="calendar-search"]').type('zzzzzz-does-not-match');
    // This line used to assert `public-month-grid` did not exist. The view was switched to list four
    // lines earlier, where the grid cannot exist however the filter behaves, so the assertion held for
    // any implementation. What the filter is actually responsible for is the card going away.
    cy.get('[data-cy="tournament-lyon-legacy"]').should('not.exist');
    cy.get('[data-cy="calendar-empty"]').should('be.visible');
    cy.get('@allTournaments.all').should('have.length', 1);
  });

  // ADR 0023 / acceptance row `doc05-full-catalog-cache`: the catalog is fetched once and month
  // navigation re-slices it in the browser. The request counter is the whole point — assert it here
  // and the row has a gate that fails when month navigation starts hitting the API again.
  it('navigates months over the cached catalog without re-querying the API', () => {
    visit('/calendar?month=2026-08&view=calendar');
    cy.wait('@allTournaments');
    // The August tournament's own pill is the locale-independent witness that the grid moved: the
    // month label is translated, and on the release build the ngsw worker can answer the navigation
    // from cache so `onBeforeLoad`'s language seed never runs.
    cy.get('[data-cy="calendar-pill-lyon-legacy"]').should('be.visible');

    cy.get('[data-cy="calendar-month-next"]').click();
    cy.location('search').should('contain', 'month=2026-09');
    cy.get('[data-cy="calendar-pill-lyon-legacy"]').should('not.exist');

    cy.get('[data-cy="calendar-month-prev"]').click();
    cy.location('search').should('contain', 'month=2026-08');
    cy.get('[data-cy="calendar-pill-lyon-legacy"]').should('be.visible');

    cy.get('@allTournaments.all').should('have.length', 1);
  });

  it('renders detail, server body links, ICS action, redirect, and mobile layout', () => {
    cy.intercept('GET', '**/api/tournaments/lyon-legacy', {
      ...tournament,
      bodyHtml: '<p>Register at <a href="https://tickets.example.test">tickets</a>.</p>'
    }).as('detail');
    visit('/events/lyon-legacy');
    cy.location('pathname').should('eq', '/calendar/tournaments/lyon-legacy');
    cy.wait('@detail');
    cy.get('[data-cy="public-tournament-detail"]').should('contain.text', 'Europe/Paris').and('contain.text', 'Cancelled');
    cy.get('gones-server-sanitized-html a').should('have.attr', 'target', '_blank').and('have.attr', 'rel', 'noopener noreferrer');
    cy.get('[data-cy="tournament-ics"]').should('have.attr', 'href').and('contain', '/api/tournaments/lyon-legacy.ics');

    cy.viewport(375, 812);
    cy.document().then(document => expect(document.documentElement.scrollWidth).to.be.at.most(375));
  });

  it('shows an empty state below the grid when nothing matches the catalog', () => {
    cy.intercept('GET', '**/api/tournaments/all*', { items: [], generatedAt: '2026-08-08T10:00:00Z', count: 0, truncated: false }).as('empty');
    visit('/calendar?month=2026-08');
    cy.wait('@empty');
    cy.get('[data-cy="public-month-grid"]').should('be.visible');
    cy.get('[data-cy="calendar-empty"]').should('be.visible');
  });

  it('shows a retryable error panel when the catalog fetch fails', () => {
    cy.intercept('GET', '**/api/tournaments/all*', { statusCode: 503, body: { title: 'Unavailable' } }).as('failed');
    visit('/calendar?month=2026-09');
    cy.wait('@failed');
    cy.get('[data-cy="calendar-error"]').find('button').should('be.visible');
  });

  it('Synchroniser forces a refetch', () => {
    visit('/calendar?month=2026-08');
    cy.wait('@allTournaments');
    cy.get('[data-cy="calendar-sync"]').click();
    cy.wait('@allTournaments');
    cy.get('@allTournaments.all').should('have.length', 2);
    cy.get('[data-cy="calendar-synced-at"]').should('be.visible');
  });
});
