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
const manualLocation = {
  streetAddress: '1 Rue Test',
  postalCode: '69001',
  city: 'Lyon',
  country: 'France',
  region: 'Auvergne-Rhône-Alpes',
  timeZoneId: 'Europe/Paris'
};
const imageIds = ['55555555-5555-5555-5555-555555555551'];
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const detail = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  title: 'Lyon Legacy Open',
  displayTitle: 'Legacy — Lyon Legacy Open',
  slug: 'lyon-legacy-open-legacy',
  summary: 'Raw summary',
  bodyHtml: '<p><strong>Live</strong> body.</p>',
  liveTournamentUrl: null,
  archiveTournamentUrl: null,
  image: null,
  venue: manualLocation,
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
  cy.intercept('GET', '**/api/event-locations/time-zones', { ids: ['Europe/London', 'Europe/Paris'] }).as('timeZones');
}

function mockPublicOrganizations() {
  cy.intercept('GET', '**/api/organizations?*', {
    items: [{ id: ownOrgId, name: 'Owned Club', description: '', website: '', contactEmail: '' }],
    page: 1,
    pageSize: 100,
    totalCount: 1
  }).as('publicOrganizations');
  cy.intercept('GET', '**/api/formats', [{ id: formatId, name: 'Legacy', slug: 'legacy', sortOrder: 1 }]).as('formats');
  cy.intercept('GET', '**/api/event-locations/time-zones', { ids: ['Europe/London', 'Europe/Paris'] }).as('timeZones');
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

function seedLanguage(win, language) {
  win.localStorage.setItem('gones.settings.language', language);
  win.localStorage.setItem('gones.settings', JSON.stringify({ language, deckArchetypes: [] }));
  win.localStorage.setItem('gones.settings.power-user', 'true');
}

// `onBeforeLoad` can be skipped after `ngsw-worker.js` controls release-profile navigation. Re-seed
// from loaded page, then announce both settings so same-window services observe deterministic state.
function visit(path = '/events/new', language = 'en') {
  cy.visit(path, { onBeforeLoad: win => seedLanguage(win, language) });
  cy.window().its('localStorage').invoke('getItem', 'gones.settings').should('be.a', 'string');
  cy.window().then(win => {
    seedLanguage(win, language);
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings.language', newValue: language }));
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'gones.settings.power-user', newValue: 'true' }));
  });
  cy.document().its('documentElement.lang').should('eq', language);
}

function checkA11y(label, context) {
  cy.readFile('node_modules/axe-core/axe.min.js', 'utf8').then(source => {
    cy.window({ log: false }).then(win => {
      if (!win.axe) win.eval(source);
      return win.axe.run(context ?? win.document, { runOnly: { type: 'tag', values: AXE_TAGS } });
    }).then(results => {
      if (results.violations.length) {
        const violations = results.violations
          .map(violation => `${violation.id}: ${violation.help}\n  ${violation.nodes.map(node => node.target.join(' ')).join('\n  ')}`)
          .join('\n');
        cy.task('log', `axe violations on ${label}:\n${violations}`, { log: false });
      }
      expect(
        results.violations.map(violation => `${label}: ${violation.id} (${violation.nodes.map(node => node.target.join(' ')).join(', ')})`),
        `axe-core violations on ${label}`
      ).to.deep.eq([]);
    });
  });
}

function assertNoHorizontalOverflow(label) {
  cy.document().then(document => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    expect(overflow, `${label} horizontal overflow`).to.be.at.most(1);
  });
}

function mockImageUploads(ids) {
  let uploadIndex = 0;
  cy.intercept('POST', '**/api/event-images', req => {
    const id = ids[uploadIndex++];
    expect(id, 'unexpected image upload').to.be.a('string');
    req.reply({
      statusCode: 201,
      body: {
        id,
        state: 'Temporary',
        expiresAt: '2030-08-02T00:00:00Z',
        width: 320,
        height: 180,
        variants: [{ width: 320, height: 180, url: `/api/event-images/${id}/variants/320` }]
      }
    });
  }).as('imageUpload');
  cy.intercept('GET', '**/api/event-images/*/variants/320', {
    statusCode: 200,
    headers: { 'content-type': 'image/webp', 'cache-control': 'no-store' },
    fixture: 'event-proposal-private.webp,null'
  }).as('imageVariant');
}

function selectImages(count) {
  for (let index = 0; index < count; index++) {
    cy.get('[data-cy="event-image-picker"]').selectFile({
      contents: 'cypress/fixtures/event-proposal-private.webp',
      fileName: `event-${index + 1}.webp`,
      mimeType: 'image/webp'
    });
    cy.wait('@imageUpload');
  }
  cy.get('[data-cy^="event-image-card-local-"]').should('have.length', count);
  cy.get('[data-cy="event-image-publish-blocked"]').should('not.exist');
}

function fillValidForm(referenceAlias = '@myOrganizations') {
  cy.wait([referenceAlias, '@formats', '@timeZones']);
  cy.get('[data-cy="event-title"]').type('Lyon Legacy Open');
  cy.get('[data-cy="event-summary"]').type('Raw summary');
  cy.get('[data-cy="event-body"]').type('**Live** body.');
  cy.get('[data-cy="event-format"]').select('Legacy');
  cy.get('[data-cy="event-capacity"]').type('32');
  cy.get('[data-cy="event-start-date"]').type('2027-08-01');
  cy.get('[data-cy="event-start-time"]').type('10:00');
  cy.get('[data-cy="event-street"]').type(manualLocation.streetAddress);
  cy.get('[data-cy="event-postal-code"]').type(manualLocation.postalCode);
  cy.get('[data-cy="event-city"]').type(manualLocation.city);
  cy.get('[data-cy="event-country"]').select(manualLocation.country);
  cy.get('[data-cy="event-region"]').type(manualLocation.region);
  cy.get('[data-cy="event-time-zone"]').select(manualLocation.timeZoneId);
}

describe('Organizer Event direct create editor', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('renders instant actual-layout Markdown preview without preview HTTP', () => {
    mockSession();
    mockReferences();
    cy.intercept('POST', '**/api/events/preview').as('removedPreview');
    cy.intercept('GET', '**/api/event-locations/autocomplete*').as('removedAutocomplete');
    cy.intercept('POST', '**/api/event-locations/resolve').as('removedResolve');
    visit();
    fillValidForm();

    cy.get('[data-cy="event-live-preview-detail"]').should('contain.text', 'Legacy — Lyon Legacy Open');
    cy.get('[data-cy="event-live-preview-detail"] gones-server-sanitized-html strong').should('contain.text', 'Live');
    cy.get('@removedPreview.all').should('have.length', 0);
    cy.get('@removedAutocomplete.all').should('have.length', 0);
    cy.get('@removedResolve.all').should('have.length', 0);
    cy.get('[data-cy="event-publish"]').should('be.enabled');
  });

  it('publishes one image, rejects a second, and renders public lightbox', () => {
    mockSession();
    mockReferences();
    mockImageUploads(imageIds);
    visit();
    fillValidForm();
    selectImages(1);
    cy.get('[data-cy="event-image-picker"]').selectFile({
      contents: 'cypress/fixtures/event-proposal-private.webp', fileName: 'second.webp', mimeType: 'image/webp'
    });
    cy.get('[data-cy="event-image-limit-error"]').should('be.visible');
    cy.get('@imageUpload.all').should('have.length', 1);
    checkA11y('Event editor with singular uploader', '[data-cy="event-create-form"]');

    const publishedDetail = {
      ...detail,
      image: { id: imageIds[0], variants: [{ width: 320, height: 180, url: `/api/event-images/${imageIds[0]}/variants/320` }] }
    };
    cy.intercept('POST', '**/api/events', req => {
      expect(req.body.location).to.deep.eq(manualLocation);
      expect(req.body.imageId).to.eq(imageIds[0]);
      req.reply({ statusCode: 201, body: { id: detail.id, slug: detail.slug, status: 'Published' } });
    }).as('publish');
    cy.intercept('GET', `**/api/events/${detail.slug}`, publishedDetail).as('detail');
    cy.intercept('GET', '**/api/events/*/participants*', { items: [], page: 1, pageSize: 50, totalCount: 0 });
    cy.intercept('GET', '**/api/events/*/registration-capability*', { canRegister: false, canUnregister: false, reason: 'organizer' });

    cy.get('[data-cy="event-publish"]').click();
    cy.wait('@publish');
    cy.wait('@detail');
    cy.get('[data-cy="event-detail-media-hero-image"]').should('have.attr', 'alt', `${detail.displayTitle} — Event image`);
    cy.get('[data-cy="event-detail-media-hero"]').focus().type('{enter}');
    cy.get('[data-cy="event-detail-lightbox-close"]').should('have.focus');
    cy.get('[data-cy="event-detail-lightbox"]').trigger('keydown', { key: 'Escape' });
    cy.get('[data-cy="event-detail-lightbox"]').should('not.exist');
  });

  it('publishes a valid Event with no summary, Markdown body, or images', () => {
    mockSession();
    mockReferences();
    visit();
    fillValidForm();
    cy.get('[data-cy="event-summary"]').clear();
    cy.get('[data-cy="event-body"]').clear();

    const optionalDetail = { ...detail, summary: null, bodyHtml: null, image: null };
    cy.intercept('POST', '**/api/events', req => {
      expect(req.body).not.to.have.property('summary');
      expect(req.body).not.to.have.property('bodyMarkdown');
      expect(req.body).not.to.have.property('imageId');
      req.reply({ statusCode: 201, body: { id: detail.id, slug: detail.slug, status: 'Published' } });
    }).as('publishOptional');
    cy.intercept('GET', `**/api/events/${detail.slug}`, optionalDetail).as('optionalDetail');
    cy.intercept('GET', '**/api/events/*/participants*', { items: [], page: 1, pageSize: 50, totalCount: 0 });
    cy.intercept('GET', '**/api/events/*/registration-capability*', { canRegister: false, canUnregister: false, reason: 'organizer' });

    cy.get('[data-cy="event-publish"]').should('be.enabled').click();
    cy.wait('@publishOptional');
    cy.wait('@optionalDetail');
    cy.get('[data-cy="event-detail-summary"]').should('not.exist');
    cy.get('[data-cy="event-detail-no-description"]').should('be.visible');
    cy.get('[data-cy="event-detail-media"]').should('not.exist');
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
    cy.viewport(375, 812);
    cy.get('[data-cy="event-create-form"]').then($form => {
      cy.get('[data-cy="event-live-preview"]').then($preview => {
        expect($preview[0].getBoundingClientRect().top).to.be.at.least($form[0].getBoundingClientRect().bottom);
      });
    });
    cy.get('[data-cy="event-image-picker"]').should('be.visible');
    assertNoHorizontalOverflow('Event editor @375px');
    checkA11y('Event editor @375px', '[data-cy="event-create-form"]');

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

  it('lets a plain verified User upload and submit one proposal image', () => {
    mockSession('User');
    mockPublicOrganizations();
    mockImageUploads([imageIds[0]]);
    cy.intercept('GET', '**/api/event-proposals/approvers?*', [
      { id: profile.id, username: 'organizer-user', globalRole: 'Organizer' }
    ]).as('approvers');
    cy.intercept('POST', '**/api/event-proposals', req => {
      expect(req.body.event.imageId).to.eq(imageIds[0]);
      expect(req.body.event.bodyMarkdown).to.eq('**Live** body.');
      expect(req.body.event.location).to.deep.eq(manualLocation);
      expect(req.body.recipientUserIds).to.deep.eq([profile.id]);
      req.reply({ statusCode: 201, body: { id: 'proposal-1', status: 'Pending', expiresAt: '2030-08-08T00:00:00Z', recipientCount: 1 } });
    }).as('proposal');
    visit();
    fillValidForm('@publicOrganizations');
    selectImages(1);

    cy.get('[data-cy="event-submit-for-approval"]').should('be.enabled').click();
    cy.wait('@approvers');
    cy.get(`[data-cy="approver-option-${profile.id}"]`).check();
    cy.get('[data-cy="approver-dialog-submit"]').click();
    cy.wait('@proposal');
    cy.get('[data-cy="event-proposal-sent"]').should('be.visible').and('contain.text', '1');
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
