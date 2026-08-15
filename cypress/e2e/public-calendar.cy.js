const orgId = '22222222-2222-2222-2222-222222222222';
const event = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Lyon Legacy',
  displayTitle: 'Legacy — Lyon Legacy',
  slug: 'lyon-legacy',
  summary: 'Legacy event',
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
  liveTournamentUrl: '/live-tournaments/lyon-legacy',
  archiveTournamentUrl: 'https://archive.example.test/lyon-legacy',
  organization: { id: orgId, name: 'Gones', description: '', website: 'https://example.test', contactEmail: '' },
  formats: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]
};

// Four events on every day of August and September 2026: each cell renders three links plus the
// overflow line, which makes both grids far taller than the viewport used by the scroll-anchor test.
const busyMonthItems = ['2026-08', '2026-09'].flatMap(month =>
  Array.from({ length: 28 }, (_, dayIndex) =>
    Array.from({ length: 4 }, (_, eventIndex) => {
      const date = `${month}-${String(dayIndex + 1).padStart(2, '0')}`;
      return {
        ...event,
        id: `${date}-${eventIndex}`,
        slug: `busy-${date}-${eventIndex}`,
        title: `Busy ${date} #${eventIndex}`,
        venueStartDate: date,
        venueEndDate: date
      };
    })
  ).flat()
);

function seedLanguage(win) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
}

// Every translated assertion below reads whatever language the app booted on, and the default is
// `fr` (`deck-archetype-settings.service.ts`), so the seed has to be in localStorage *before* the
// bundle runs. `onBeforeLoad` is Cypress' only pre-boot hook and on the release profile it does not
// always fire: `ngsw-worker.js` registers on the first page a spec loads, and from then on it
// answers the navigation out of Cache Storage. That response never passes through the Cypress
// proxy, so Cypress cannot inject the script that calls `onBeforeLoad`, and the seed is silently
// skipped. The dev server registers no worker at all (`provideServiceWorker` is gated on
// `environment.production`), which is why the same spec is green on :4200 and red on :8081.
//
// So: seed pre-boot when Cypress can, and when it could not, write the seed from the loaded page and
// raise the `storage` event the app already listens for to follow settings changed in another tab — a
// same-window write never fires it on its own. That re-reads localStorage and flips the language
// signal in place. Reloading instead would work too, but a second boot re-runs the catalog fetch and
// breaks the request counters this spec asserts on. The wait on `gones.settings` is what makes the
// branch honest: the app persists that key while it boots, so reaching it means the language below is
// the one the app actually booted on rather than a value read before it had written anything.
function visit(path) {
  cy.visit(path, { onBeforeLoad: seedLanguage });
  cy.window().its('localStorage').invoke('getItem', 'gones.settings').should('be.a', 'string');
  cy.window().then((win) => {
    if (win.localStorage.getItem('gones.settings.language') === 'en') return;
    seedLanguage(win);
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings.language', newValue: 'en' }));
  });
  cy.document().its('documentElement.lang').should('eq', 'en');
}

describe('public Calendar V1', () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.intercept('GET', '**/api/events/all*', { items: [event], generatedAt: '2026-08-08T10:00:00Z', count: 1, truncated: false }).as('allEvents');
  });

  it('defaults to month view, restores URL filters, persists list view, and filters locally without a network call', () => {
    visit('/events?month=2026-08&q=Lyon');
    cy.wait('@allEvents');
    cy.get('[data-cy="public-calendar"]').should('be.visible');
    cy.get('[data-cy="event-list-view"]').should('have.attr', 'aria-pressed', 'true');
    cy.get('[data-cy="event-list-month-day-date"][datetime="2026-08-01"]').parents('[data-cy^="event-list-month-day"]').within(() => {
      cy.get('[data-cy="event-list-month-day-event-lyon-legacy"]')
        .should('contain.text', '23:30')
        .and('contain.text', 'Lyon Legacy')
        .and('have.attr', 'href', '/events/lyon-legacy');
    });
    cy.get('[data-cy="event-list-search"]').clear().type('does-not-match');
    cy.get('[data-cy="event-list-month-day-event-lyon-legacy"]').should('not.exist');
    cy.get('[data-cy="event-list-search"]').clear().type('Lyon');
    cy.get('[data-cy="event-list-month-day-event-lyon-legacy"]').should('exist');

    cy.get('[data-cy="list-view"]').click();
    cy.location('search').should('contain', 'view=list');
    cy.get('[data-cy="event-list-list"]').should('be.visible');
    cy.get('[data-cy="event-list-card-status"]').should('contain.text', 'Cancelled');
    // A reload within the 24h cache TTL must not refetch: the alias stays at one call.
    visit('/events?month=2026-08');
    cy.get('[data-cy="list-view"]').should('have.attr', 'aria-pressed', 'true');
    cy.get('@allEvents.all').should('have.length', 1);

    cy.get('[data-cy="event-list-search"]').type('zzzzzz-does-not-match');
    // This line used to assert `public-month-grid` did not exist. The view was switched to list four
    // lines earlier, where the grid cannot exist however the filter behaves, so the assertion held for
    // any implementation. What the filter is actually responsible for is the card going away.
    cy.get('[data-cy="event-lyon-legacy"]').should('not.exist');
    cy.get('[data-cy="event-list-empty"]').should('be.visible');
    cy.get('@allEvents.all').should('have.length', 1);
  });

  // ADR 0023 / acceptance row `doc05-full-catalog-cache`: the catalog is fetched once and month
  // navigation re-slices it in the browser. The request counter is the whole point — assert it here
  // and the row has a gate that fails when month navigation starts hitting the API again.
  it('navigates months over the cached catalog without re-querying the API', () => {
    visit('/events?month=2026-08&view=calendar');
    cy.wait('@allEvents');
    cy.get('[data-cy="event-list-month-day-event-lyon-legacy"]').should('be.visible');

    // The witness that the grid moved is locale-independent by construction: the day cell's
    // `datetime` attribute is the machine-readable ISO date and is never translated, where the month
    // label is. `visit()` pins the language, so asserting 'August' would work too — but the grid
    // moving is not a claim about translation, and this way the test cannot break when it does not.
    // A mid-month day is picked because it is always in-month, never a muted leading/trailing cell
    // borrowed from a neighbouring month.
    cy.get('[data-cy="event-list-month-next"]').click();
    cy.location('search').should('contain', 'month=2026-09');
    cy.get('[data-cy="event-list-month-day-date"][datetime="2026-09-15"]').should('exist');
    cy.get('[data-cy="event-list-month-day-date"][datetime="2026-08-15"]').should('not.exist');

    cy.get('[data-cy="event-list-month-prev"]').click();
    cy.location('search').should('contain', 'month=2026-08');
    cy.get('[data-cy="event-list-month-day-date"][datetime="2026-08-15"]').should('exist');
    cy.get('[data-cy="event-list-month-day-date"][datetime="2026-09-15"]').should('not.exist');

    cy.get('@allEvents.all').should('have.length', 1);
  });

  // Month navigation is a query-param navigation, so the router's scroll restoration puts the reader
  // back at the top of the page. Only a real browser can settle this: jsdom has no layout, no
  // document height and no scroller, so a component-level assertion proves nothing about the
  // observable jump. Both months are seeded so the grid stays tall on either side of the click — a
  // scroll position past the end of the shorter document could not survive any implementation.
  it('keeps the window scroll position when changing month in a content-heavy month', () => {
    cy.intercept('GET', '**/api/events/all*', { items: busyMonthItems, generatedAt: '2026-08-08T10:00:00Z', count: busyMonthItems.length, truncated: false }).as('busyMonths');
    cy.viewport(1024, 500);
    visit('/events?month=2026-08&view=calendar');
    cy.wait('@busyMonths');
    cy.get('[data-cy="public-month-grid"]').should('be.visible');

    // Scrolled as deep as a reader can be and still see the control they are about to click; the
    // offset keeps the control clear of the sticky app toolbar.
    cy.get('[data-cy="event-list-month-next"]').scrollIntoView({ offset: { top: -180, left: 0 } });
    cy.window().its('scrollY').should('be.greaterThan', 100);
    cy.window().then(win => {
      const before = win.scrollY;
      // `scrollBehavior: false` keeps Cypress from scrolling the button into view itself, which would
      // move the page between the reading of `before` and the click that is under test.
      cy.get('[data-cy="event-list-month-next"]').click({ scrollBehavior: false });
      cy.get('[data-cy="event-list-month-day-date"][datetime="2026-09-15"]').should('exist');
      // A retrying assertion would pass on the frame before the router scrolls to the top; the wait
      // makes the check read the settled position instead.
      cy.wait(500);
      cy.window().then(w => expect(w.scrollY).to.be.closeTo(before, 10));

      cy.get('[data-cy="event-list-month-prev"]').click({ scrollBehavior: false });
      cy.get('[data-cy="event-list-month-day-date"][datetime="2026-08-15"]').should('exist');
      cy.wait(500);
      cy.window().then(w => expect(w.scrollY).to.be.closeTo(before, 10));
    });
  });

  it('keeps the window scroll position when changing month in an empty month', () => {
    cy.intercept('GET', '**/api/events/all*', { items: [], generatedAt: '2026-08-08T10:00:00Z', count: 0, truncated: false }).as('emptyCatalog');
    cy.viewport(1024, 500);
    visit('/events?month=2026-08&view=calendar');
    cy.wait('@emptyCatalog');
    cy.get('[data-cy="public-month-grid"]').should('be.visible');

    cy.get('[data-cy="event-list-month-prev"]').scrollIntoView({ offset: { top: -180, left: 0 } });
    cy.window().its('scrollY').should('be.greaterThan', 100);
    cy.window().then(win => {
      const before = win.scrollY;
      cy.get('[data-cy="event-list-month-prev"]').click({ scrollBehavior: false });
      cy.get('[data-cy="event-list-month-day-date"][datetime="2026-07-15"]').should('exist');
      cy.wait(500);
      cy.window().then(w => expect(w.scrollY).to.be.closeTo(before, 10));

      cy.get('[data-cy="event-list-month-next"]').click({ scrollBehavior: false });
      cy.get('[data-cy="event-list-month-day-date"][datetime="2026-08-15"]').should('exist');
      cy.wait(500);
      cy.window().then(w => expect(w.scrollY).to.be.closeTo(before, 10));
    });
  });

  it('caps same-day events at three and reports overflow', () => {
    const sameDay = Array.from({ length: 4 }, (_, index) => ({
      ...event,
      id: `${index + 1}1111111-1111-1111-1111-111111111111`,
      slug: `same-day-${index + 1}`,
      title: `Same Day ${index + 1}`
    }));
    cy.intercept('GET', '**/api/events/all*', { items: sameDay, generatedAt: '2026-08-08T10:00:00Z', count: 4, truncated: false }).as('sameDay');

    visit('/events?month=2026-08&view=calendar');
    cy.wait('@sameDay');
    cy.get('[data-cy="event-list-month-day-date"][datetime="2026-08-01"]').parents('[data-cy^="event-list-month-day"]').within(() => {
      cy.get('a.public-month-event').should('have.length', 3);
      cy.get('[data-cy="event-list-month-day-more"]').should('contain.text', '+1');
    });
  });

  it('renders detail, server body links, ICS action, and mobile layout', () => {
    cy.intercept('GET', '**/api/events/lyon-legacy', {
      ...event,
      bodyHtml: '<p>Register at <a href="https://tickets.example.test">tickets</a>.</p>'
    }).as('detail');
    visit('/events/lyon-legacy');
    cy.location('pathname').should('eq', '/events/lyon-legacy');
    cy.wait('@detail');
    cy.get('[data-cy="public-event-detail"]').should('contain.text', 'Europe/Paris').and('not.contain.text', 'Cancelled');
    cy.get('gones-server-sanitized-html a').should('have.attr', 'target', '_blank').and('have.attr', 'rel', 'noopener noreferrer');
    // The hero no longer owns the ICS action: it sits in the Participants header (T5).
    cy.get('[data-cy="event-ics"]').should('not.exist');
    cy.get('[data-cy="registration-ics"]').should('have.attr', 'href').and('contain', '/api/events/lyon-legacy.ics');

    // The hero is a layout claim, so read the rendered text and geometry rather than the template.
    cy.get('[data-cy="event-detail-title"]').should('contain.text', 'Legacy — Lyon Legacy').and('contain.text', '32 players');
    cy.get('[data-cy="event-detail-status"]').should('not.exist');
    cy.get('[data-cy="event-detail-fact-organization"]').should('not.exist');
    cy.get('[data-cy="event-detail-when-where"]').should('contain.text', 'Europe/Paris').and('contain.text', '1 Rue Test, 69001, Lyon, France');
    cy.get('[data-cy="event-detail-hero"] > :last-child').should('have.attr', 'data-cy', 'event-detail-actions');
    cy.get('[data-cy="event-detail-where-link"]')
      .should('have.attr', 'target', '_blank')
      .and('have.attr', 'rel', 'noopener noreferrer')
      .and('have.attr', 'href', 'https://www.google.com/maps/search/?api=1&query=1%20Rue%20Test%2C%2069001%2C%20Lyon%2C%20France')
      .and('have.attr', 'aria-label', 'Open 1 Rue Test, 69001, Lyon, France in Google Maps');
    cy.get('[data-cy="event-detail-where-link"] svg.maps-icon').should('exist');
    cy.get('[data-cy="event-detail-when"]').then(($when) => {
      cy.get('[data-cy="event-detail-where-link"]').then(($where) => {
        expect($where[0].getBoundingClientRect().top, 'date and location share one row')
          .to.be.closeTo($when[0].getBoundingClientRect().top, 2);
      });
    });
    cy.get('[data-cy="event-detail-actions"]').then(($actions) => {
      cy.get('[data-cy="event-detail-live-tournament"]')
        .should('have.attr', 'href', '/live-tournaments/lyon-legacy')
        .and('not.have.attr', 'target');
      cy.get('[data-cy="event-detail-archive-tournament"]')
        .should('have.attr', 'target', '_blank')
        .and('have.attr', 'rel', 'noopener noreferrer');
      cy.get('[data-cy="event-detail-organization-website"]').then(($website) => {
        expect($website[0].getBoundingClientRect().right, 'website button hugs the right edge')
          .to.be.closeTo($actions[0].getBoundingClientRect().right, 2);
      });
    });

    cy.viewport(375, 812);
    cy.document().then(document => expect(document.documentElement.scrollWidth).to.be.at.most(375));
  });

  // The card handler sits on an ancestor of the ICS anchor, so "the button still downloads without
  // navigating" is a claim only a real browser can settle: in jsdom nothing bubbles through Angular's
  // template bindings at all.
  it('the list card navigates on click while Add to calendar stays on the list', () => {
    cy.intercept('GET', '**/api/events/lyon-legacy', { ...event, bodyHtml: '<p>Detail</p>' }).as('detail');
    cy.intercept('GET', '**/api/events/lyon-legacy.ics', {
      statusCode: 200,
      headers: { 'content-type': 'text/calendar' },
      body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'
    }).as('ics');

    visit('/events?month=2026-08&view=list');
    cy.wait('@allEvents');
    cy.get('[data-cy="event-list-card-view"]').should('not.exist');
    cy.get('[data-cy="event-list-card-date"]').should('not.contain.text', 'Europe/Paris').and('not.contain.text', '(');

    cy.get('[data-cy="event-list-card-ics"]').click();
    cy.wait('@ics');
    cy.location('pathname').should('eq', '/events');
    cy.get('[data-cy="event-list-list"]').should('be.visible');

    // Enter on the button reaches the card as a keydown before the click it synthesises.
    cy.get('[data-cy="event-list-card-ics"]').focus().trigger('keydown', { key: 'Enter' });
    cy.location('pathname').should('eq', '/events');

    cy.get('[data-cy="event-list-card-venue"]').click();
    cy.location('pathname').should('eq', '/events/lyon-legacy');
    cy.wait('@detail');
    cy.get('[data-cy="public-event-detail"]').should('be.visible');
  });

  it('shows an empty state below the grid when nothing matches the catalog', () => {
    cy.intercept('GET', '**/api/events/all*', { items: [], generatedAt: '2026-08-08T10:00:00Z', count: 0, truncated: false }).as('empty');
    visit('/events?month=2026-08');
    cy.wait('@empty');
    cy.get('[data-cy="public-month-grid"]').should('be.visible');
    cy.get('[data-cy="event-list-empty"]').should('be.visible');
  });

  it('shows a retryable error panel when the catalog fetch fails', () => {
    cy.intercept('GET', '**/api/events/all*', { statusCode: 503, body: { title: 'Unavailable' } }).as('failed');
    visit('/events?month=2026-09');
    cy.wait('@failed');
    cy.get('[data-cy="event-list-error"]').find('button').should('be.visible');
  });

  it('Synchroniser forces a refetch', () => {
    visit('/events?month=2026-08');
    cy.wait('@allEvents');
    cy.get('[data-cy="event-list-sync"]').click();
    cy.wait('@allEvents');
    cy.get('@allEvents.all').should('have.length', 2);
    cy.get('[data-cy="event-list-synced-at"]').should('be.visible');
  });

  // The search query and the event title both reach the DOM as interpolated text nodes: the
  // highlight binds a parts array, never HTML. A markup-shaped query and a markup-shaped title must
  // therefore stay literal text and create no element.
  it('highlights matches in both views and never interprets markup as HTML', () => {
    const markupTitle = 'Lyon <img src=x onerror=alert(1)> Legacy';
    cy.intercept('GET', '**/api/events/all*', {
      items: [{ ...event, title: markupTitle }],
      generatedAt: '2026-08-08T10:00:00Z',
      count: 1,
      truncated: false
    }).as('markupEvent');

    visit('/events?month=2026-08&view=calendar');
    cy.wait('@markupEvent');
    cy.get('[data-cy="event-list-search"]').type('Lyon');
    cy.get('[data-cy^="event-list-month-day-event-title-part-lyon-legacy-"].match-highlight').should('contain.text', 'Lyon');

    // The list view is entered through the URL rather than the tab: the tab click navigates with the
    // query the debounce has committed so far, which would drop a query typed under 300ms ago.
    visit('/events?month=2026-08&view=list&q=Lyon');
    cy.get('[data-cy="event-list-card-title"]').should('have.text', markupTitle);
    cy.get('[data-cy="event-list-card-title"] img').should('not.exist');
    cy.get('[data-cy^="event-list-card-title-part-lyon-legacy-"].match-highlight').should('contain.text', 'Lyon');
    cy.get('[data-cy^="event-list-card-venue-part-lyon-legacy-"].match-highlight').should('exist');

    cy.get('[data-cy="event-list-search"]').clear().type('<img src=x onerror=alert(1)>');
    cy.get('[data-cy="event-list-card-title"]').should('have.text', markupTitle);
    cy.get('[data-cy="event-list-card-title"] img').should('not.exist');
    cy.get('[data-cy="public-calendar"] img').should('not.exist');
  });

  it('pages the list at twenty events and drops the page on search', () => {
    const manyEvents = Array.from({ length: 25 }, (_, index) => ({
      ...event,
      id: `${String(index).padStart(8, '0')}-1111-1111-1111-111111111111`,
      slug: `item-${String(index).padStart(3, '0')}`,
      title: `Event ${String(index).padStart(3, '0')}`,
      venueStartDate: '2026-08-01'
    }));
    cy.intercept('GET', '**/api/events/all*', { items: manyEvents, generatedAt: '2026-08-08T10:00:00Z', count: 25, truncated: false }).as('manyEvents');

    visit('/events?month=2026-08&view=list');
    cy.wait('@manyEvents');
    cy.get('[data-cy^="event-item-"]').should('have.length', 20);
    cy.get('[data-cy="event-list-pagination"]').should('be.visible');

    cy.get('[data-cy="event-list-page-next"]').click();
    cy.location('search').should('contain', 'page=2');
    cy.get('[data-cy^="event-item-"]').should('have.length', 5);

    cy.get('[data-cy="event-list-search"]').type('Event');
    cy.location('search', { timeout: 5000 }).should('not.contain', 'page=');
  });
});
