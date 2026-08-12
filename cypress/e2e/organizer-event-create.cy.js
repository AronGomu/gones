const ownOrgId = '22222222-2222-2222-2222-222222222222';
const otherOrgId = '99999999-9999-9999-9999-999999999999';
const formatId = '33333333-3333-3333-3333-333333333333';
const profile = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'organizer@example.test',
  emailVerified: true,
  globalRole: 'Organizer',
  username: 'organizer-user',
  firstName: 'Organizer',
  lastName: 'User',
  preferredLanguage: 'en',
  isFirstNamePublic: false,
  isLastNamePublic: false,
  isLocationPublic: false,
  isBirthYearPublic: false,
  isPreferredLanguagePublic: false
};
const render = {
  title: 'Lyon Legacy Open',
  slug: 'lyon-legacy-open',
  summary: 'Server-normalized summary',
  bodyHtml: '<p><strong>Server-clean</strong> body.</p>',
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris',
  venueStartDate: '2027-08-01',
  venueStartTime: '10:00:00',
  venueEndDate: '2027-08-01',
  venueEndTime: '23:59:59',
  startsAtUtc: '2027-08-01T08:00:00Z',
  endsAtUtc: '2027-08-01T21:59:59Z',
  capacity: 32,
  status: 'Published',
  organization: { id: ownOrgId, name: 'Owned Club', description: '', website: 'https://example.test', contactEmail: '' },
  formats: [{ id: formatId, name: 'Legacy', slug: 'legacy', sortOrder: 1 }]
};

function mockSession(globalRole = 'Organizer') {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2027-08-01T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', { ...profile, globalRole });
}

function mockReferences() {
  cy.intercept('GET', '**/api/users/me/organizations', [
    { id: ownOrgId, name: 'Owned Club', description: '', website: '', contactEmail: '', role: 'Organizer', createdAt: '2026-08-01T00:00:00Z' }
  ]).as('myOrganizations');
  cy.intercept('GET', '**/api/formats', [{ id: formatId, name: 'Legacy', slug: 'legacy', sortOrder: 1 }]).as('formats');
}

// T26. A verified account that is not an organizer reads the anonymous public catalogue instead of
// its own memberships, because it has none — that is the whole premise of the proposal flow.
function mockPublicOrganizations() {
  cy.intercept('GET', '**/api/organizations?*', {
    items: [{ id: ownOrgId, name: 'Owned Club', description: '', website: '', contactEmail: '', createdAt: '2026-08-01T00:00:00Z' }],
    page: 1,
    pageSize: 100,
    totalCount: 1
  }).as('publicOrganizations');
}

// T14. An admin belongs to no organization in particular, so the picker reads the admin catalogue
// rather than their own memberships. The catalogue carries what publishing would still refuse — a
// Draft organization (nobody staffs it) and a soft-deleted one — so both are answered here to prove
// the picker leaves them out.
function mockAdminOrganizations() {
  cy.intercept('GET', '**/api/admin/organizations*', {
    items: [
      { id: otherOrgId, name: 'Zebra Club', description: '', website: '', contactEmail: '', deletedAt: null, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', version: 1, memberCount: 2, isDraft: false },
      { id: '44444444-4444-4444-4444-444444444444', name: 'Draft Club', description: '', website: '', contactEmail: '', deletedAt: null, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', version: 1, memberCount: 0, isDraft: true },
      { id: '55555555-5555-5555-5555-555555555555', name: 'Gone Club', description: '', website: '', contactEmail: '', deletedAt: '2026-08-02T00:00:00Z', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z', version: 2, memberCount: 1, isDraft: false },
      { id: ownOrgId, name: 'Owned Club', description: '', website: '', contactEmail: '', deletedAt: null, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', version: 1, memberCount: 1, isDraft: false }
    ],
    page: 1,
    pageSize: 100,
    totalCount: 4
  }).as('adminOrganizations');
}

function visit(path = '/tournaments/new') {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('gones.settings.language', 'en');
      win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
    }
  });
}

function fillValidForm() {
  cy.get('[data-cy="event-title"]').type('Lyon Legacy Open');
  cy.get('[data-cy="event-summary"]').type('Raw summary');
  cy.get('[data-cy="event-body"]').type('<p><strong>Server-clean</strong> body.</p>');
  cy.get('[data-cy="event-street"]').type('1 Rue Test');
  cy.get('[data-cy="event-postal-code"]').type('69001');
  cy.get('[data-cy="event-city"]').type('Lyon');
  cy.get('[data-cy="event-country"]').type('France');
  cy.get('[data-cy="event-start"]').type('2027-08-01T10:00');
  cy.get('[data-cy="event-zone"]').clear().type('Europe/Paris');
  cy.get('[data-cy="event-capacity"]').type('32');
  cy.get('[data-cy="event-formats"]').select('Legacy');
}

function openValidPreview() {
  cy.wait(['@myOrganizations', '@formats']);
  cy.intercept('POST', '**/api/events/preview', req => {
    expect(req.body.organizationId).to.eq(ownOrgId);
    expect(req.body.timeZoneId).to.eq('Europe/Paris');
    req.reply({ render, previewTicket: 'opaque-preview-ticket', expiresAt: '2027-08-01T00:10:00Z' });
  }).as('preview');
  fillValidForm();
  cy.get('[data-cy="event-preview-submit"]').click();
  cy.wait('@preview');
}

describe('Organizer Event create, preview, publish', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('lets a verified non-organizer reach the form with submission disabled behind an approval notice', () => {
    mockSession('User');
    mockReferences();
    mockPublicOrganizations();
    visit();
    cy.location('pathname').should('eq', '/tournaments/new');
    cy.wait(['@publicOrganizations', '@formats']);
    cy.get('[data-cy="event-preview-submit"]').should('not.exist');
    cy.get('[data-cy="event-approval-notice"]').should('be.visible');
    // The picker is populated from the public list, so the button is reachable rather than a
    // dead click over an empty `<select>`.
    cy.get('[data-cy="event-organization"] option').should('have.length', 1);
    cy.get('[data-cy="event-submit-for-approval"]').should('be.visible').and('be.enabled');
  });

  it('lets a verified non-organizer request approval from chosen approvers', () => {
    mockSession('User');
    mockReferences();
    mockPublicOrganizations();
    cy.intercept('GET', '**/api/event-proposals/approvers*', req => {
      // T26: the approver list is scoped to the organization the event would go under.
      expect(req.query.organizationId).to.eq(ownOrgId);
      req.reply([
        { id: 'aaaaaaaa-0000-0000-0000-000000000001', username: 'admin-one', globalRole: 'Admin' },
        { id: 'aaaaaaaa-0000-0000-0000-000000000002', username: 'organizer-two', globalRole: 'Organizer' }
      ]);
    }).as('approvers');
    cy.intercept('POST', '**/api/event-proposals', {
      statusCode: 201,
      body: { id: 'pppppppp-0000-0000-0000-000000000001', status: 'Pending', expiresAt: '2027-08-08T00:00:00Z', recipientCount: 1 }
    }).as('submitProposal');
    visit();
    cy.wait(['@publicOrganizations', '@formats']);
    fillValidForm();
    cy.get('[data-cy="event-submit-for-approval"]').click();
    cy.wait('@approvers');
    cy.get('[data-cy^="approver-option-"]').first().check({ force: true });
    cy.get('[data-cy="approver-dialog-submit"]').click();
    cy.wait('@submitProposal');
    cy.get('[data-cy="event-proposal-sent"]').should('be.visible');
  });

  it('redirects the legacy organizer path, scopes organization picker, requires explicit start/zone, focuses title, and stays usable on mobile', () => {
    mockSession('Organizer');
    mockReferences();
    cy.viewport(375, 812);
    visit('/organizer/tournaments/new');
    cy.location('pathname').should('eq', '/tournaments/new');
    cy.wait(['@myOrganizations', '@formats']);
    cy.get('[data-cy="event-title"]').should('have.focus');
    cy.get('[data-cy="event-organization"] option').should('have.length', 1).and('contain.text', 'Owned Club');
    cy.get('[data-cy="event-organization"] option').should('not.have.value', otherOrgId);
    cy.get('[data-cy="event-zone"]').invoke('val').should('be.a', 'string').and('not.be.empty');
    cy.get('[data-cy="event-zone"]').clear().type('America/Toronto').should('have.value', 'America/Toronto').clear();
    cy.get('[data-cy="event-preview-submit"]').click();
    cy.get('#event-start').should('have.attr', 'aria-describedby', 'event-start-error').and('have.attr', 'aria-invalid', 'true');
    cy.get('#event-zone').should('have.attr', 'aria-describedby').and('contain', 'event-zone-error');
    cy.get('#event-zone').should('have.attr', 'aria-invalid', 'true');
    cy.document().then(doc => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
  });

  it('offers an admin every active organization and none of the ones publishing would refuse', () => {
    mockSession('Admin');
    mockReferences();
    mockAdminOrganizations();
    visit();
    cy.wait(['@adminOrganizations', '@formats']);
    // Sorted by name, Draft and soft-deleted left out.
    cy.get('[data-cy="event-organization"] option').should('have.length', 2);
    cy.get('[data-cy="event-organization"] option').eq(0).should('contain.text', 'Owned Club');
    cy.get('[data-cy="event-organization"] option').eq(1).should('contain.text', 'Zebra Club');
    cy.get(`[data-cy="event-organization-option-${otherOrgId}"]`).should('exist');
    // An admin's own memberships are the wrong list, so the picker never asks for them.
    cy.get('@myOrganizations.all').should('have.length', 0);
    cy.get('[data-cy="event-preview-submit"]').should('be.visible').and('be.enabled');
  });

  it('renders server preview through public detail view, preserves form on Back, and invalidates ticket after edit', () => {
    mockSession();
    mockReferences();
    visit();
    openValidPreview();
    cy.get('[data-cy="event-detail-view"]').should('contain.text', render.summary).and('contain.text', 'Europe/Paris');
    cy.get('gones-server-sanitized-html strong').should('contain.text', 'Server-clean');
    cy.get('[data-cy="event-publish"]').should('be.enabled');

    cy.get('[data-cy="event-back-edit"]').click();
    cy.get('[data-cy="event-title"]').should('have.value', 'Lyon Legacy Open').type(' Updated');
    cy.get('[data-cy="event-publish"]').should('not.exist');
    cy.get('[data-cy="event-preview-submit"]').should('be.visible');
  });

  it('associates server validation errors and gives actionable forbidden recovery', () => {
    mockSession();
    mockReferences();
    cy.intercept('POST', '**/api/events/preview', {
      statusCode: 400,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'validation_failed', message: 'Validation failed.', errors: { startsAtLocal: ['Start falls in a daylight-saving gap.'] } }
    }).as('invalidPreview');
    visit();
    cy.wait(['@myOrganizations', '@formats']);
    fillValidForm();
    cy.get('[data-cy="event-preview-submit"]').click();
    cy.wait('@invalidPreview');
    cy.get('#event-start').should('have.attr', 'aria-describedby', 'event-start-error').and('have.attr', 'aria-invalid', 'true');
    cy.get('#event-start-error').should('contain.text', 'daylight-saving gap');

    cy.intercept('POST', '**/api/events/preview', {
      statusCode: 403,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'forbidden', message: 'Forbidden.' }
    }).as('forbiddenPreview');
    cy.get('[data-cy="event-preview-submit"]').click();
    cy.wait('@forbiddenPreview');
    cy.get('[data-cy="event-submit-error"]').invoke('text').should('match', /organi[sz]ation/i);
    cy.get('[data-cy="reload-organizations"]').should('be.visible');
  });

  it('keeps one idempotency key across network retry, locks double-submit, and routes successful publish to public detail', () => {
    mockSession();
    mockReferences();
    visit();
    openValidPreview();

    const keys = [];
    let attempt = 0;
    cy.intercept('POST', '**/api/events', req => {
      keys.push(req.headers['idempotency-key']);
      attempt += 1;
      if (attempt === 1) {
        req.reply({ statusCode: 503, delay: 500, body: { title: 'Connection unavailable' } });
        return;
      }
      req.reply({ statusCode: 201, body: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', slug: render.slug, status: 'Published' } });
    }).as('publish');
    cy.intercept('GET', `**/api/events/${render.slug}`, { ...render, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }).as('detail');

    cy.get('[data-cy="event-publish"]').click();
    cy.get('[data-cy="event-publish"]').should('be.disabled').click({ force: true });
    cy.wait('@publish');
    cy.get('[data-cy="event-publish-error"]').invoke('text').should('match', /connex|connection/i);
    cy.get('[data-cy="event-publish"]').click();
    cy.wait('@publish').then(() => {
      expect(keys).to.have.length(2);
      expect(keys[0]).to.be.a('string').and.not.be.empty;
      expect(keys[1]).to.eq(keys[0]);
    });
    cy.location('pathname').should('eq', `/calendar/tournaments/${render.slug}`);
    cy.wait('@detail');
  });

  it('offers login for 401 and duplicate-safe Calendar review for 409 without losing form data', () => {
    mockSession();
    mockReferences();
    visit();
    openValidPreview();
    cy.intercept('POST', '**/api/events', {
      statusCode: 401,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'unauthorized', message: 'Unauthorized.' }
    }).as('unauthorizedPublish');
    cy.get('[data-cy="event-publish"]').click();
    cy.wait('@unauthorizedPublish');
    cy.get('[data-cy="event-publish-error"] a[href^="/login"]').should('be.visible').and('have.attr', 'target', '_blank').and('have.attr', 'rel', 'noopener noreferrer');

    cy.intercept('POST', '**/api/events', {
      statusCode: 409,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'preview_ticket_replayed', message: 'Preview ticket was already published.' }
    }).as('conflictPublish');
    cy.get('[data-cy="event-publish"]').click();
    cy.wait('@conflictPublish');
    cy.get('[data-cy="event-review-calendar"]').should('have.attr', 'href', '/calendar');
    cy.get('[data-cy="event-back-edit"]').click();
    cy.get('[data-cy="event-title"]').should('have.value', 'Lyon Legacy Open');
  });
});
