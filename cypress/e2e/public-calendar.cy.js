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
    cy.intercept('GET', '**/api/tournaments?*', { items: [tournament], page: 1, pageSize: 20, totalCount: 1 }).as('tournaments');
  });

  it('defaults to month view, restores URL filters, persists list view, and exposes past/status state', () => {
    visit('/calendar?month=2026-08&city=Lyon');
    cy.wait('@tournaments').its('request.url').should('contain', 'from=2026-08-01').and('contain', 'city=Lyon');
    cy.get('[data-cy="public-calendar"]').should('be.visible');
    cy.get('[data-cy="calendar-view"]').should('have.attr', 'aria-pressed', 'true');
    cy.contains('.calendar-pill', 'Cancelled').should('be.visible');

    cy.get('[data-cy="list-view"]').click();
    cy.location('search').should('contain', 'view=list');
    cy.wait('@tournaments');
    cy.get('[data-cy="calendar-list"]').should('be.visible');
    visit('/calendar?month=2026-08');
    cy.wait('@tournaments');
    cy.get('[data-cy="list-view"]').should('have.attr', 'aria-pressed', 'true');

    cy.get('select[name="status"]').select('Cancelled');
    cy.get('input[name="past"]').check();
    cy.get('input[name="format"]').type('legacy');
    cy.get('[data-cy="calendar-filters"]').submit();
    cy.location('search').should('contain', 'status=Cancelled').and('contain', 'past=true').and('contain', 'format=legacy');
    cy.wait('@tournaments').its('request.url').should('contain', 'status=Cancelled').and('contain', 'past=true');
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

  it('shows empty and retryable error states', () => {
    cy.intercept('GET', '**/api/tournaments?*', { items: [], page: 1, pageSize: 20, totalCount: 0 }).as('empty');
    visit('/calendar?month=2026-08');
    cy.wait('@empty');
    cy.get('[data-cy="calendar-empty"]').should('be.visible');

    cy.intercept('GET', '**/api/tournaments?*', { statusCode: 503, body: { title: 'Unavailable' } }).as('failed');
    visit('/calendar?month=2026-09');
    cy.wait('@failed');
    cy.get('[data-cy="calendar-error"]').find('button').should('be.visible');
  });
});
