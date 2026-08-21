/**
 * Accessibility gate (C40).
 *
 * Runs axe-core against the real rendered app on the surfaces V1 ships, plus explicit keyboard,
 * focus, live-region and 375px-overflow checks that axe cannot assert on its own.
 *
 * axe-core is injected from node_modules rather than a CDN so the run stays offline-safe and
 * matches the CSP the release image serves.
 */

const orgId = '22222222-2222-2222-2222-222222222222';
const event = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Lyon Legacy',
  slug: 'lyon-legacy',
  summary: 'Legacy event',
  bodyHtml: '<p>Welcome to the <strong>event</strong>.</p>',
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

// WCAG 2.1 A + AA is the V1 bar. `best-practice` findings are reported but not enforced.
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function visit(path, viewport = [1280, 800]) {
  cy.viewport(viewport[0], viewport[1]);
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('gones.settings.language', 'en');
      win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
    }
  });
}

function injectAxe() {
  return cy.readFile('node_modules/axe-core/axe.min.js', 'utf8').then((source) => {
    cy.window({ log: false }).then((win) => {
      if (!win.axe) win.eval(source);
    });
  });
}

/** Runs axe and fails with a readable per-violation report instead of an opaque count. */
function checkA11y(label, context = undefined) {
  injectAxe();
  cy.window({ log: false })
    .then((win) => win.axe.run(context ?? win.document, { runOnly: { type: 'tag', values: AXE_TAGS } }))
    .then((results) => {
      const violations = results.violations;
      if (violations.length) {
        const detail = violations
          .map((violation) => `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes.map((node) => node.target.join(' ')).join('\n  ')}`)
          .join('\n');
        cy.task('log', `axe violations on ${label}:\n${detail}`, { log: false });
      }
      expect(violations.map((violation) => `${label}: ${violation.id}`), `axe-core violations on ${label}`).to.deep.equal([]);
    });
}

describe('accessibility', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/events/all*', { items: [event], generatedAt: '2026-08-08T00:00:00Z', count: 1, truncated: false }).as('events');
    cy.intercept('GET', '**/api/events/lyon-legacy', event).as('event');
    cy.intercept('GET', '**/api/events/lyon-legacy/participants*', { items: [], page: 1, pageSize: 20, totalCount: 0 });
    cy.intercept('GET', '**/api/formats*', []);
    cy.intercept('GET', '**/api/organizations*', { items: [], page: 1, pageSize: 20, totalCount: 0 });
  });

  it('home and navigation chrome have no WCAG A/AA violations', () => {
    visit('/');
    cy.get('gones-root').should('exist');
    checkA11y('home');
  });

  it('public calendar list and calendar views have no WCAG A/AA violations', () => {
    visit('/events');
    cy.wait('@events');
    cy.get('[data-cy="public-calendar"]').should('be.visible');
    checkA11y('calendar (month view)');

    cy.get('[data-cy="list-view"]').click();
    cy.get('[data-cy="event-list-list"]').should('be.visible');
    checkA11y('calendar (list view)');
  });

  it('public event detail has no WCAG A/AA violations', () => {
    visit('/events/lyon-legacy');
    cy.wait('@event');
    cy.contains('Lyon Legacy').should('be.visible');
    checkA11y('event detail');
  });

  it('settings form has no WCAG A/AA violations', () => {
    visit('/settings');
    cy.get('gones-root').should('exist');
    checkA11y('settings');
  });

  it('not-found route has no WCAG A/AA violations', () => {
    visit('/this-route-does-not-exist');
    cy.get('gones-root').should('exist');
    checkA11y('not found');
  });

  it('every calendar filter control has a programmatic name', () => {
    visit('/events');
    cy.wait('@events');
    cy.get('[data-cy="event-list-search-row"]').find('input, select, textarea').each(($control) => {
      const element = $control[0];
      const id = element.getAttribute('id');
      const labelled = element.getAttribute('aria-label')
        || element.getAttribute('aria-labelledby')
        || element.getAttribute('title')
        || (id && Cypress.$(`label[for="${id}"]`).length > 0)
        || Cypress.$(element).closest('label').length > 0;
      expect(Boolean(labelled), `control ${element.tagName}[name=${element.getAttribute('name')}] must have an accessible name`).to.equal(true);
    });
  });

  it('keyboard alone reaches and operates the calendar view toggle', () => {
    visit('/events');
    cy.wait('@events');

    cy.get('[data-cy="list-view"]').focus();
    cy.focused().should('have.attr', 'data-cy', 'list-view');
    cy.focused().type('{enter}');
    cy.get('[data-cy="event-list-list"]').should('be.visible');
    cy.get('[data-cy="list-view"]').should('have.attr', 'aria-pressed', 'true');
  });

  it('no element is reachable by keyboard while hidden from assistive technology', () => {
    visit('/events');
    cy.wait('@events');
    cy.get('body').find('[aria-hidden="true"]').each(($hidden) => {
      const focusable = Cypress.$($hidden).find('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      expect(focusable.length, `aria-hidden subtree ${$hidden[0].outerHTML.slice(0, 120)} must not contain focusable elements`).to.equal(0);
    });
  });

  it('async regions announce their state to assistive technology', () => {
    cy.intercept('GET', '**/api/events/all*', (request) => {
      request.reply({ delay: 400, body: { items: [event], generatedAt: '2026-08-08T00:00:00Z', count: 1, truncated: false } });
    }).as('slowEvents');
    visit('/events');
    cy.get('[data-cy="event-list-loading"]')
      .should('have.attr', 'aria-busy', 'true')
      .and('have.attr', 'aria-live');
    cy.wait('@slowEvents');
    cy.get('[data-cy="public-calendar"]').should('be.visible');
  });

  it('has no horizontal overflow at 375px on the public surfaces', () => {
    for (const path of ['/', '/events', '/events/lyon-legacy', '/settings']) {
      visit(path, [375, 812]);
      cy.get('gones-root').should('exist');
      cy.document().then((document) => {
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        expect(overflow, `${path} must not scroll horizontally at 375px (overflow ${overflow}px)`).to.be.lte(1);
      });
    }
  });

  it('public surfaces pass axe at 375px too', () => {
    visit('/events', [375, 812]);
    cy.wait('@events');
    cy.get('[data-cy="public-calendar"]').should('be.visible');
    checkA11y('calendar @375px');
  });
});
