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

function visit(path = '/tournaments/new') {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('gones.settings.language', 'en');
      win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
    }
  });
}

function fillValidForm() {
  cy.get('[data-cy="tournament-title"]').type('Lyon Legacy Open');
  cy.get('[data-cy="tournament-summary"]').type('Raw summary');
  cy.get('[data-cy="tournament-body"]').type('<p><strong>Server-clean</strong> body.</p>');
  cy.get('[data-cy="tournament-street"]').type('1 Rue Test');
  cy.get('[data-cy="tournament-postal-code"]').type('69001');
  cy.get('[data-cy="tournament-city"]').type('Lyon');
  cy.get('[data-cy="tournament-country"]').type('France');
  cy.get('[data-cy="tournament-start"]').type('2027-08-01T10:00');
  cy.get('[data-cy="tournament-zone"]').clear().type('Europe/Paris');
  cy.get('[data-cy="tournament-capacity"]').type('32');
  cy.get('[data-cy="tournament-formats"]').select('Legacy');
}

function openValidPreview() {
  cy.wait(['@myOrganizations', '@formats']);
  cy.intercept('POST', '**/api/tournaments/preview', req => {
    expect(req.body.organizationId).to.eq(ownOrgId);
    expect(req.body.timeZoneId).to.eq('Europe/Paris');
    req.reply({ render, previewTicket: 'opaque-preview-ticket', expiresAt: '2027-08-01T00:10:00Z' });
  }).as('preview');
  fillValidForm();
  cy.get('[data-cy="tournament-preview-submit"]').click();
  cy.wait('@preview');
}

describe('Organizer Tournament create, preview, publish', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('lets a verified non-organizer reach the form with submission disabled behind an approval notice', () => {
    mockSession('User');
    mockReferences();
    visit();
    cy.location('pathname').should('eq', '/tournaments/new');
    cy.wait(['@myOrganizations', '@formats']);
    cy.get('[data-cy="tournament-preview-submit"]').should('not.exist');
    cy.get('[data-cy="tournament-approval-notice"]').should('be.visible');
    cy.get('[data-cy="tournament-submit-for-approval"]').should('be.visible').and('be.enabled');
  });

  it('lets a verified non-organizer request approval from chosen approvers', () => {
    mockSession('User');
    mockReferences();
    cy.intercept('GET', '**/api/tournament-proposals/approvers', [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', username: 'admin-one', globalRole: 'Admin' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', username: 'organizer-two', globalRole: 'Organizer' }
    ]).as('approvers');
    cy.intercept('POST', '**/api/tournament-proposals', {
      statusCode: 201,
      body: { id: 'pppppppp-0000-0000-0000-000000000001', status: 'Pending', expiresAt: '2027-08-08T00:00:00Z', recipientCount: 1 }
    }).as('submitProposal');
    visit();
    cy.wait(['@myOrganizations', '@formats']);
    fillValidForm();
    cy.get('[data-cy="tournament-submit-for-approval"]').click();
    cy.wait('@approvers');
    cy.get('[data-cy^="approver-option-"]').first().check({ force: true });
    cy.get('[data-cy="approver-dialog-submit"]').click();
    cy.wait('@submitProposal');
    cy.get('[data-cy="tournament-proposal-sent"]').should('be.visible');
  });

  it('redirects the legacy organizer path, scopes organization picker, requires explicit start/zone, focuses title, and stays usable on mobile', () => {
    mockSession('Organizer');
    mockReferences();
    cy.viewport(375, 812);
    visit('/organizer/tournaments/new');
    cy.location('pathname').should('eq', '/tournaments/new');
    cy.wait(['@myOrganizations', '@formats']);
    cy.get('[data-cy="tournament-title"]').should('have.focus');
    cy.get('[data-cy="tournament-organization"] option').should('have.length', 1).and('contain.text', 'Owned Club');
    cy.get('[data-cy="tournament-organization"] option').should('not.have.value', otherOrgId);
    cy.get('[data-cy="tournament-zone"]').invoke('val').should('be.a', 'string').and('not.be.empty');
    cy.get('[data-cy="tournament-zone"]').clear().type('America/Toronto').should('have.value', 'America/Toronto').clear();
    cy.get('[data-cy="tournament-preview-submit"]').click();
    cy.get('#tournament-start').should('have.attr', 'aria-describedby', 'tournament-start-error').and('have.attr', 'aria-invalid', 'true');
    cy.get('#tournament-zone').should('have.attr', 'aria-describedby').and('contain', 'tournament-zone-error');
    cy.get('#tournament-zone').should('have.attr', 'aria-invalid', 'true');
    cy.document().then(doc => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
  });

  it('renders server preview through public detail view, preserves form on Back, and invalidates ticket after edit', () => {
    mockSession();
    mockReferences();
    visit();
    openValidPreview();
    cy.get('[data-cy="tournament-detail-view"]').should('contain.text', render.summary).and('contain.text', 'Europe/Paris');
    cy.get('gones-server-sanitized-html strong').should('contain.text', 'Server-clean');
    cy.get('[data-cy="tournament-publish"]').should('be.enabled');

    cy.get('[data-cy="tournament-back-edit"]').click();
    cy.get('[data-cy="tournament-title"]').should('have.value', 'Lyon Legacy Open').type(' Updated');
    cy.get('[data-cy="tournament-publish"]').should('not.exist');
    cy.get('[data-cy="tournament-preview-submit"]').should('be.visible');
  });

  it('associates server validation errors and gives actionable forbidden recovery', () => {
    mockSession();
    mockReferences();
    cy.intercept('POST', '**/api/tournaments/preview', {
      statusCode: 400,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'validation_failed', message: 'Validation failed.', errors: { startsAtLocal: ['Start falls in a daylight-saving gap.'] } }
    }).as('invalidPreview');
    visit();
    cy.wait(['@myOrganizations', '@formats']);
    fillValidForm();
    cy.get('[data-cy="tournament-preview-submit"]').click();
    cy.wait('@invalidPreview');
    cy.get('#tournament-start').should('have.attr', 'aria-describedby', 'tournament-start-error').and('have.attr', 'aria-invalid', 'true');
    cy.get('#tournament-start-error').should('contain.text', 'daylight-saving gap');

    cy.intercept('POST', '**/api/tournaments/preview', {
      statusCode: 403,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'forbidden', message: 'Forbidden.' }
    }).as('forbiddenPreview');
    cy.get('[data-cy="tournament-preview-submit"]').click();
    cy.wait('@forbiddenPreview');
    cy.get('[data-cy="tournament-submit-error"]').invoke('text').should('match', /organi[sz]ation/i);
    cy.get('[data-cy="reload-organizations"]').should('be.visible');
  });

  it('keeps one idempotency key across network retry, locks double-submit, and routes successful publish to public detail', () => {
    mockSession();
    mockReferences();
    visit();
    openValidPreview();

    const keys = [];
    let attempt = 0;
    cy.intercept('POST', '**/api/tournaments', req => {
      keys.push(req.headers['idempotency-key']);
      attempt += 1;
      if (attempt === 1) {
        req.reply({ statusCode: 503, delay: 500, body: { title: 'Connection unavailable' } });
        return;
      }
      req.reply({ statusCode: 201, body: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', slug: render.slug, status: 'Published' } });
    }).as('publish');
    cy.intercept('GET', `**/api/tournaments/${render.slug}`, { ...render, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }).as('detail');

    cy.get('[data-cy="tournament-publish"]').click();
    cy.get('[data-cy="tournament-publish"]').should('be.disabled').click({ force: true });
    cy.wait('@publish');
    cy.get('[data-cy="tournament-publish-error"]').invoke('text').should('match', /connex|connection/i);
    cy.get('[data-cy="tournament-publish"]').click();
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
    cy.intercept('POST', '**/api/tournaments', {
      statusCode: 401,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'unauthorized', message: 'Unauthorized.' }
    }).as('unauthorizedPublish');
    cy.get('[data-cy="tournament-publish"]').click();
    cy.wait('@unauthorizedPublish');
    cy.get('[data-cy="tournament-publish-error"] a[href^="/login"]').should('be.visible').and('have.attr', 'target', '_blank').and('have.attr', 'rel', 'noopener noreferrer');

    cy.intercept('POST', '**/api/tournaments', {
      statusCode: 409,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'preview_ticket_replayed', message: 'Preview ticket was already published.' }
    }).as('conflictPublish');
    cy.get('[data-cy="tournament-publish"]').click();
    cy.wait('@conflictPublish');
    cy.get('[data-cy="tournament-review-calendar"]').should('have.attr', 'href', '/calendar');
    cy.get('[data-cy="tournament-back-edit"]').click();
    cy.get('[data-cy="tournament-title"]').should('have.value', 'Lyon Legacy Open');
  });
});
