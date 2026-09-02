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
const resolvedLocation = {
  streetAddress: '1 Rue Test',
  postalCode: '69001',
  city: 'Lyon',
  country: 'France',
  region: 'Auvergne-Rhône-Alpes',
  latitude: 45.764,
  longitude: 4.8357,
  timeZoneId: 'Europe/Paris',
  locationToken: 'signed-location-token',
  expiresAt: '2030-08-01T00:30:00Z'
};
const detail = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  title: 'Lyon Legacy Open',
  displayTitle: 'Legacy — Lyon Legacy Open',
  slug: 'lyon-legacy-open-legacy',
  summary: 'Raw summary',
  bodyHtml: '<p><strong>Live</strong> body.</p>',
  liveTournamentUrl: null,
  archiveTournamentUrl: null,
  images: [],
  venue: resolvedLocation,
  timeZoneId: 'Europe/Paris',
  venueStartDate: '2027-08-01',
  venueStartTime: '10:00:00',
  venueEndDate: '2027-08-01',
  venueEndTime: '23:59:59',
  startsAtUtc: '2027-08-01T08:00:00Z',
  endsAtUtc: '2027-08-01T21:59:59Z',
  capacity: 32,
  status: 'Published',
  eventType: 'weekly',
  organization: { id: ownOrgId, name: 'Owned Club', description: '', website: 'https://example.test', contactEmail: '', organizers: [] },
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

function mockPublicOrganizations() {
  cy.intercept('GET', '**/api/organizations?*', {
    items: [{ id: ownOrgId, name: 'Owned Club', description: '', website: '', contactEmail: '' }],
    page: 1,
    pageSize: 100,
    totalCount: 1
  }).as('publicOrganizations');
  cy.intercept('GET', '**/api/formats', [{ id: formatId, name: 'Legacy', slug: 'legacy', sortOrder: 1 }]).as('formats');
}

function mockAdminOrganizations() {
  cy.intercept('GET', '**/api/admin/organizations*', {
    items: [
      { id: otherOrgId, name: 'Zebra Club', deletedAt: null, memberCount: 2, isDraft: false },
      { id: '44444444-4444-4444-4444-444444444444', name: 'Draft Club', deletedAt: null, memberCount: 0, isDraft: true },
      { id: ownOrgId, name: 'Owned Club', deletedAt: null, memberCount: 1, isDraft: false }
    ],
    page: 1,
    pageSize: 100,
    totalCount: 3
  }).as('adminOrganizations');
}

function mockLocation() {
  cy.intercept('GET', '**/api/event-locations/autocomplete?*', {
    suggestions: [{ placeId: 'google-place', primaryText: '1 Rue Test', secondaryText: '69001 Lyon, France' }]
  }).as('locationAutocomplete');
  cy.intercept('POST', '**/api/event-locations/resolve', req => {
    expect(req.body.placeId).to.eq('google-place');
    req.reply(resolvedLocation);
  }).as('locationResolve');
}

const SEED_MARKER = 'gones.e2e.storage-seeded';

function seedLanguage(win, language) {
  win.localStorage.setItem('gones.settings.language', language);
  win.localStorage.setItem('gones.settings', JSON.stringify({ language, deckArchetypes: [] }));
  win.localStorage.setItem('gones.settings.power-user', 'true');
  win.localStorage.setItem(SEED_MARKER, 'true');
}

// `onBeforeLoad` can be skipped after `ngsw-worker.js` controls release-profile navigation. Re-seed
// from loaded page, then announce both settings so same-window services observe deterministic state.
function visit(path = '/events/new', language = 'en') {
  cy.visit(path, { onBeforeLoad: win => seedLanguage(win, language) });
  cy.window().its('localStorage').invoke('getItem', 'gones.settings').should('be.a', 'string');
  cy.window().then(win => {
    if (win.localStorage.getItem(SEED_MARKER) === 'true'
      && win.localStorage.getItem('gones.settings.language') === language) return;
    seedLanguage(win, language);
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings.language', newValue: language }));
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings.power-user', newValue: 'true' }));
  });
  cy.document().its('documentElement.lang').should('eq', language);
}

function fillValidForm() {
  cy.wait(['@myOrganizations', '@formats']);
  cy.get('[data-cy="event-title"]').type('Lyon Legacy Open');
  cy.get('[data-cy="event-summary"]').type('Raw summary');
  cy.get('[data-cy="event-body"]').type('**Live** body.');
  cy.get('[data-cy="event-format"]').select('Legacy');
  cy.get('[data-cy="event-capacity"]').type('32');
  cy.get('[data-cy="event-start-date"]').type('2027-08-01');
  cy.get('[data-cy="event-start-time"]').type('10:00');
  cy.get('[data-cy="event-street"]').type('1 Rue');
  cy.wait('@locationAutocomplete');
  cy.get('[data-cy="event-location-suggestion-0"]').click();
  cy.wait('@locationResolve');
}

describe('Organizer Event direct create editor', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('renders instant actual-layout Markdown preview without preview HTTP', () => {
    mockSession();
    mockReferences();
    mockLocation();
    cy.intercept('POST', '**/api/events/preview').as('removedPreview');
    visit();
    fillValidForm();

    cy.get('[data-cy="event-live-preview-detail"]').should('contain.text', 'Legacy — Lyon Legacy Open');
    cy.get('[data-cy="event-live-preview-detail"] gones-server-sanitized-html strong').should('contain.text', 'Live');
    cy.get('@removedPreview.all').should('have.length', 0);
    cy.get('[data-cy="event-publish"]').should('be.enabled');
  });

  it('publishes one exact nested payload directly and navigates to public detail', () => {
    mockSession();
    mockReferences();
    mockLocation();
    visit();
    fillValidForm();

    cy.intercept('POST', '**/api/events', req => {
      expect(req.body).not.to.have.property('payload');
      expect(req.body).not.to.have.property('previewTicket');
      expect(req.body.location).to.deep.eq({
        streetAddress: resolvedLocation.streetAddress,
        postalCode: resolvedLocation.postalCode,
        city: resolvedLocation.city,
        country: resolvedLocation.country,
        region: resolvedLocation.region,
        locationToken: resolvedLocation.locationToken
      });
      expect(req.body).not.to.have.property('timeZoneId');
      expect(req.body).not.to.have.property('latitude');
      expect(req.body).not.to.have.property('longitude');
      expect(req.body.startsAtLocal).to.eq('2027-08-01T10:00');
      expect(req.body.formatIds).to.deep.eq([formatId]);
      expect(req.body.images).to.deep.eq([]);
      expect(req.headers['idempotency-key']).to.be.a('string').and.not.be.empty;
      req.reply({ statusCode: 201, body: { id: detail.id, slug: detail.slug, status: 'Published' } });
    }).as('publish');
    cy.intercept('GET', `**/api/events/${detail.slug}`, detail).as('detail');

    cy.get('[data-cy="event-publish"]').click();
    cy.wait('@publish');
    cy.location('pathname').should('eq', `/events/${detail.slug}`);
    cy.wait('@detail');
  });

  it('blocks unresolved and failed-upload states before publication', () => {
    mockSession();
    mockReferences();
    visit();
    cy.wait(['@myOrganizations', '@formats']);
    cy.get('[data-cy="event-title"]').type('Blocked Cup');
    cy.get('[data-cy="event-format"]').select('Legacy');
    cy.get('[data-cy="event-capacity"]').type('32');
    cy.get('[data-cy="event-start-date"]').type('2027-08-01');
    cy.get('[data-cy="event-start-time"]').type('10:00');
    cy.get('[data-cy="event-publish"]').should('be.disabled');

    cy.get('[data-cy="event-image-editor"] input[type=file]').selectFile({
      contents: Cypress.Buffer.from('not-an-image'),
      fileName: 'bad.gif',
      mimeType: 'image/gif'
    });
    cy.get('[data-cy="event-image-publish-blocked"]').should('be.visible');
    cy.get('[data-cy="event-publish"]').should('be.disabled');
  });

  it('uses below-flow at 1023px, exact split at 1024px, and restores collapse in tab session', () => {
    mockSession();
    mockReferences();
    cy.viewport(1023, 800);
    visit();
    cy.wait(['@myOrganizations', '@formats']);
    cy.get('[data-cy="event-create-form"]').then($form => {
      cy.get('[data-cy="event-live-preview"]').then($preview => {
        expect($preview[0].getBoundingClientRect().top).to.be.at.least($form[0].getBoundingClientRect().bottom);
      });
    });

    cy.viewport(1024, 800);
    cy.get('[data-cy="event-editor-shell"]').should('have.css', 'grid-template-columns').and('match', /px .*px/);
    cy.get('[data-cy="event-live-preview"]').should('have.css', 'position', 'sticky');
    cy.get('[data-cy="event-preview-collapse"]').should('have.attr', 'aria-expanded', 'true').and('contain.text', 'Hide preview').click();
    cy.get('[data-cy="event-live-preview"]').should('exist').and('not.be.visible').and('have.attr', 'hidden');
    cy.get('[data-cy="event-preview-collapse"]').should('have.attr', 'aria-expanded', 'false').and('contain.text', 'Show preview');
    cy.reload();
    cy.wait(['@myOrganizations', '@formats']);
    cy.get('[data-cy="event-live-preview"]').should('exist').and('not.be.visible').and('have.attr', 'hidden');
    cy.get('[data-cy="event-preview-collapse"]').should('have.attr', 'aria-controls', 'event-live-preview').and('have.attr', 'aria-expanded', 'false');
  });

  it('keeps plain User proposal submission usable while gating proposal images', () => {
    mockSession('User');
    mockPublicOrganizations();
    visit();
    cy.wait(['@publicOrganizations', '@formats']);
    cy.location('pathname').should('eq', '/events/new');
    cy.get('[data-cy="event-submit-for-approval"]').should('be.visible');
    cy.get('[data-cy="event-image-editor"]').should('not.exist');
    cy.get('[data-cy="event-publish"]').should('not.exist');
  });

  it('offers an admin every active non-draft organization', () => {
    mockSession('Admin');
    mockReferences();
    mockAdminOrganizations();
    visit();
    cy.wait(['@adminOrganizations', '@formats']);
    cy.get('[data-cy="event-organization"] option').should('have.length', 2);
    cy.get(`[data-cy="event-organization-option-${otherOrgId}"]`).should('exist');
    cy.get('@myOrganizations.all').should('have.length', 0);
  });

  it('keeps bilingual create breadcrumb and retired route redirect', () => {
    mockSession();
    mockReferences();
    visit('/organizer/tournaments/new');
    cy.location('pathname').should('eq', '/events/new');
    cy.get('[data-cy="breadcrumb-current"]').should('have.text', 'Create Event');

    visit('/events/new', 'fr');
    cy.get('[data-cy="breadcrumb-current"]').should('have.text', 'Créer un événement');
  });
});
