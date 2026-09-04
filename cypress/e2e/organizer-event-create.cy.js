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
    const overflowing = [...document.querySelectorAll('*')]
      .filter(element => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .map(element => element.getAttribute('data-cy') || element.tagName.toLowerCase())
      .slice(0, 8);
    expect(overflow, `${label} horizontal overflow (${overflowing.join(', ')})`).to.be.at.most(1);
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

function fillValidForm(referenceAlias = '@myOrganizations', omittedSelector = '') {
  cy.wait([referenceAlias, '@formats', '@timeZones']);
  cy.get('[data-cy="event-title"]').type('Lyon Legacy Open');
  cy.get('[data-cy="event-summary"]').type('Raw summary');
  cy.get('[data-cy="event-body"]').type('**Live** body.');
  if (omittedSelector !== '[data-cy="event-format"]') cy.get('[data-cy="event-format"]').select('Legacy');
  cy.get('[data-cy="event-capacity"]').type('32');
  cy.get('[data-cy="event-start-date"]').type('2027-08-01');
  cy.get('[data-cy="event-start-time"]').type('10:00');
  cy.get('[data-cy="event-street"]').type(manualLocation.streetAddress);
  cy.get('[data-cy="event-postal-code"]').type(manualLocation.postalCode);
  cy.get('[data-cy="event-city"]').type(manualLocation.city);
  if (omittedSelector !== '[data-cy="event-country"]') cy.get('[data-cy="event-country"]').select(manualLocation.country);
  cy.get('[data-cy="event-region"]').type(manualLocation.region);
  if (omittedSelector !== '[data-cy="event-time-zone"]') cy.get('[data-cy="event-time-zone"]').select(manualLocation.timeZoneId);
}

function setEditorValue(selector, value) {
  cy.get(selector).then($control => {
    const control = $control[0];
    control.value = value;
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function assertSummaryOrder(summary, labels) {
  const indices = labels.map(label => summary.indexOf(`${label}:`));
  indices.forEach((index, position) => expect(index, labels[position]).to.be.greaterThan(-1));
  for (let index = 1; index < indices.length; index++) expect(indices[index]).to.be.greaterThan(indices[index - 1]);
}

function assertRenderedPublishTooltip(labels) {
  cy.get('[data-cy="event-publish-errors"]').invoke('text').then(summary => {
    assertSummaryOrder(summary, labels);
    cy.get('[data-cy="event-publish-tooltip"]').scrollIntoView().trigger('mouseenter');
    cy.get('.mat-mdc-tooltip')
      .should('have.class', 'mat-mdc-tooltip-show')
      .and($tooltip => expect($tooltip.text()).to.eq(summary));
  });
  cy.get('[data-cy="event-publish-tooltip"]').trigger('mouseleave');
  cy.get('.mat-mdc-tooltip').should('not.have.class', 'mat-mdc-tooltip-show');
}

function assertKeyboardPublishTooltip() {
  cy.get('[data-cy="event-publish-tooltip"]').scrollIntoView().then($tooltip => {
    $tooltip[0].ownerDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    $tooltip[0].focus();
  });
  cy.get('[data-cy="event-publish-errors"]').invoke('text').then(summary => {
    cy.get('.mat-mdc-tooltip')
      .should('have.class', 'mat-mdc-tooltip-show')
      .and($tooltip => expect($tooltip.text()).to.eq(summary));
  });
  cy.get('[data-cy="event-publish-tooltip"]').blur();
  cy.get('.mat-mdc-tooltip').should('not.have.class', 'mat-mdc-tooltip-show');
}

describe('Organizer Event direct create editor', () => {
  beforeEach(() => cy.viewport(1280, 800));

  it('renders trimmed title live before a format is selected', () => {
    mockSession();
    mockReferences();
    visit();
    cy.wait(['@myOrganizations', '@formats', '@timeZones']);

    cy.get('[data-cy="event-title"]').type('  Night Cup  ');
    cy.get('[data-cy="event-detail-title-text"]').should('have.text', 'Night Cup');
    cy.get('[data-cy="event-format"]').select('Legacy');
    cy.get('[data-cy="event-detail-title-text"]').should('have.text', 'Legacy — Night Cup');
  });

  it('persists one account-scoped create draft, blocks canceled navigation, and restores it after reload', () => {
    mockSession();
    mockReferences();
    mockImageUploads([imageIds[0]]);
    visit();
    fillValidForm();
    selectImages(1);
    cy.wait(350);

    cy.window().then(win => {
      const key = `gones.event-create.draft.${profile.id}`;
      const draft = JSON.parse(win.localStorage.getItem(key));
      expect(draft.version).to.eq(1);
      expect(draft.userId).to.eq(profile.id);
      expect(draft.value).to.include({ ...manualLocation, title: 'Lyon Legacy Open', formatId });
      expect(draft.image.id).to.eq(imageIds[0]);
      expect(win.localStorage.getItem('gones.event-create.draft.someone-else')).to.eq(null);
    });
    cy.get('[data-cy="app-brand-link"]').click();
    cy.get('[data-cy="confirm-dialog-cancel"]').click();
    cy.location('pathname').should('eq', '/events/new');
    cy.window().then(win => {
      const event = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(event);
      expect(event.defaultPrevented).to.eq(true);
    });

    cy.reload();
    cy.wait(['@myOrganizations', '@formats', '@timeZones']);
    cy.get('[data-cy="event-title"]').should('have.value', 'Lyon Legacy Open');
    cy.get('[data-cy="event-street"]').should('have.value', manualLocation.streetAddress);
    cy.get('[data-cy="event-time-zone"]').should('have.value', manualLocation.timeZoneId);
    cy.get(`[data-cy="event-image-card-restored-${imageIds[0]}"]`).should('be.visible');
  });

  it('guards browser-history back for create and preserves input when canceled', () => {
    mockSession();
    mockReferences();
    cy.intercept('GET', '**/api/organizer/events?*', { items: [], page: 1, pageSize: 20, totalCount: 0 }).as('eventList');
    visit('/organizer/events');
    cy.wait('@eventList');
    cy.get('[data-cy="organizer-events-create"]').click();
    cy.wait(['@myOrganizations', '@formats', '@timeZones']);
    cy.get('[data-cy="event-title"]').type('History guarded create');

    cy.window().then(win => win.history.back());
    cy.get('[data-cy="confirm-dialog-cancel"]').click();
    cy.location('pathname').should('eq', '/events/new');
    cy.get('[data-cy="event-title"]').should('have.value', 'History guarded create');
  });

  it('leaves create after confirmed browser-history back', () => {
    mockSession();
    mockReferences();
    cy.intercept('GET', '**/api/organizer/events?*', { items: [], page: 1, pageSize: 20, totalCount: 0 }).as('eventList');
    visit('/organizer/events');
    cy.wait('@eventList');
    cy.get('[data-cy="organizer-events-create"]').click();
    cy.wait(['@myOrganizations', '@formats', '@timeZones']);
    cy.get('[data-cy="event-title"]').type('History confirmed create');

    cy.window().then(win => win.history.back());
    cy.get('[data-cy="confirm-dialog-confirm"]').click();
    cy.location('pathname').should('eq', '/organizer/events');
    cy.get('[data-cy="event-title"]').should('not.exist');
  });

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
    cy.get('[data-cy="event-publish"]').should('be.enabled').and('have.class', 'create-action-button');
    cy.get('[data-cy="event-create-actions"]').then($actions => {
      cy.get('[data-cy="event-publish"]').then($publish => {
        expect($publish[0].getBoundingClientRect().width).to.be.closeTo($actions[0].getBoundingClientRect().width, 1);
      });
    });
    cy.get('[data-cy="event-publish-tooltip"]').should('not.have.attr', 'tabindex');
    cy.get('[data-cy="event-publish-errors"]').should('not.exist');
  });

  it('renders the full ordered invalid Publish summary on hover without submitting', () => {
    mockSession();
    mockReferences();
    visit();
    cy.wait(['@myOrganizations', '@formats', '@timeZones']);
    cy.get('[data-cy="event-organization"]').should('have.value', ownOrgId);

    setEditorValue('[data-cy="event-title"]', 'x'.repeat(161));
    setEditorValue('[data-cy="event-summary"]', 'x'.repeat(51));
    setEditorValue('[data-cy="event-body"]', 'x'.repeat(20_001));
    setEditorValue('[data-cy="event-capacity"]', '0');
    cy.get('[data-cy="event-image-editor"] input[type=file]').selectFile({
      contents: Cypress.Buffer.from('not-an-image'),
      fileName: 'bad.gif',
      mimeType: 'image/gif'
    });

    cy.get('[data-cy="event-publish"]').should('be.disabled');
    cy.get('[data-cy="event-publish-tooltip"]')
      .should('have.attr', 'tabindex', '0')
      .and('have.attr', 'aria-describedby')
      .and('include', 'event-publish-errors');
    cy.get('[data-cy="event-image-publish-blocked"]').should('be.visible');
    assertRenderedPublishTooltip(['Event name', 'Summary', 'Description', 'Capacity', 'Event image']);
  });

  it('exposes every inducible Publish reason through its hidden ARIA summary', () => {
    mockSession();
    mockReferences();
    visit();
    fillValidForm();

    const states = [
      ['[data-cy="event-title"]', '', 'Lyon Legacy Open', 'Event name'],
      ['[data-cy="event-summary"]', 'x'.repeat(51), 'Raw summary', 'Summary'],
      ['[data-cy="event-body"]', 'x'.repeat(20_001), '**Live** body.', 'Description'],
      ['[data-cy="event-capacity"]', '0', '32', 'Capacity'],
      ['[data-cy="event-region"]', '', manualLocation.region, 'Region'],
      ['[data-cy="event-street"]', '', manualLocation.streetAddress, 'Street address'],
      ['[data-cy="event-postal-code"]', '', manualLocation.postalCode, 'Postal code'],
      ['[data-cy="event-city"]', '', manualLocation.city, 'City'],
      ['[data-cy="event-start-date"]', '', '2027-08-01', 'Start date'],
      ['[data-cy="event-start-time"]', '', '10:00', 'Start time']
    ];
    for (const [selector, invalidValue, validValue, label] of states) {
      setEditorValue(selector, invalidValue);
      cy.get('[data-cy="event-publish"]').should($publish => {
        expect($publish.prop('disabled'), label).to.eq(true);
      });
      cy.get('[data-cy="event-publish-tooltip"]')
        .should('have.attr', 'tabindex', '0')
        .and('have.attr', 'aria-describedby')
        .and('include', 'event-publish-errors');
      cy.get('[data-cy="event-publish-errors"]').should('contain.text', `${label}:`);
      setEditorValue(selector, validValue);
      cy.get('[data-cy="event-publish"]').should('be.enabled');
    }

    cy.get('[data-cy="event-image-editor"] input[type=file]').selectFile({
      contents: Cypress.Buffer.from('not-an-image'),
      fileName: 'bad.gif',
      mimeType: 'image/gif'
    });
    cy.get('[data-cy="event-image-publish-blocked"]').should('be.visible');
    cy.get('[data-cy="event-publish-errors"]').should('contain.text', 'Event image:');

    const freshStates = [
      ['[data-cy="event-format"]', 'Legacy', 'Format'],
      ['[data-cy="event-country"]', manualLocation.country, 'Country'],
      ['[data-cy="event-time-zone"]', manualLocation.timeZoneId, 'IANA time zone']
    ];
    for (const [selector, validValue, label] of freshStates) {
      cy.window().then(win => win.addEventListener('beforeunload', () => {
        win.localStorage.removeItem(`gones.event-create.draft.${profile.id}`);
      }, { once: true }));
      cy.reload();
      fillValidForm('@myOrganizations', selector);
      cy.get('[data-cy="event-publish"]').should('be.disabled');
      cy.get('[data-cy="event-publish-errors"]').should('contain.text', `${label}:`);
      cy.get(selector).select(validValue);
      cy.get('[data-cy="event-publish"]').should('be.enabled');
    }

    cy.intercept('POST', '**/api/events', {
      statusCode: 400,
      headers: { 'content-type': 'application/problem+json' },
      body: { code: 'validation_failed', title: 'Validation failed.', errors: { payload: ['Payload is inconsistent.'] } }
    }).as('generalFailure');
    cy.get('[data-cy="event-publish"]').should('be.enabled').click();
    cy.wait('@generalFailure');
    cy.get('[data-cy="event-publish-errors"]').should('contain.text', 'General:');
    cy.get('@myOrganizations.all').should('have.length', 4);
  });

  it('renders the invalid Publish summary on keyboard focus without submitting', () => {
    mockSession();
    mockReferences();
    visit();
    cy.wait(['@myOrganizations', '@formats', '@timeZones']);
    cy.get('[data-cy="event-organization"]').should('have.value', ownOrgId);

    cy.get('[data-cy="event-publish-tooltip"]')
      .should('have.attr', 'tabindex', '0')
      .and('have.attr', 'aria-describedby')
      .and('include', 'event-publish-errors');
    assertKeyboardPublishTooltip();
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
    cy.window().then(win => expect(win.localStorage.getItem(`gones.event-create.draft.${profile.id}`)).to.eq(null));
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
    cy.get('[data-cy="event-image-drop-zone"]').then($zone => {
      cy.get('[data-cy="event-image-picker"]').then($picker => {
        const zone = $zone[0].getBoundingClientRect();
        const picker = $picker[0].getBoundingClientRect();
        expect(picker.left + picker.width / 2, 'picker horizontal center').to.be.closeTo(zone.left + zone.width / 2, 2);
      });
    });
    assertNoHorizontalOverflow('Event editor @375px');
    checkA11y('Event editor @375px', '[data-cy="event-create-form"]');

    cy.viewport(1024, 500);
    cy.get('[data-cy="event-editor-shell"]').should('have.css', 'grid-template-columns').and('match', /px .*px/);
    cy.scrollTo(0, 600);
    cy.get('[data-cy="event-live-preview"]').should('have.css', 'position', 'sticky').then($preview => {
      const preview = $preview[0].getBoundingClientRect();
      const stickyOffset = Number.parseFloat(getComputedStyle($preview[0]).top);
      expect(preview.top, 'preview reached sticky offset').to.be.closeTo(stickyOffset, 1);
      expect(preview.bottom, 'sticky preview viewport fit').to.be.at.most($preview[0].ownerDocument.defaultView.innerHeight + 1);
    });
    cy.get('[data-cy="event-live-preview-scroll"]').should('have.css', 'overflow-y', 'auto');
    cy.get('[data-cy="event-live-preview-header"]').then($header => {
      const before = $header[0].getBoundingClientRect().top;
      cy.get('[data-cy="event-live-preview-scroll"]').scrollTo('bottom');
      cy.get('[data-cy="event-live-preview-header"]').then($after => {
        expect($after[0].getBoundingClientRect().top, 'preview header after inner scroll').to.be.closeTo(before, 1);
      });
      cy.get('[data-cy="event-live-preview-scroll"]').then($scroll => {
        cy.get('[data-cy="event-detail-description"]').then($detail => {
          const scroll = $scroll[0].getBoundingClientRect();
          const detail = $detail[0].getBoundingClientRect();
          expect(detail.bottom, 'final preview detail reachable').to.be.at.most(scroll.bottom + 1);
          expect(detail.bottom, 'final preview detail visible').to.be.greaterThan(scroll.top);
        });
      });
    });
    cy.get('[data-cy="event-preview-collapse"]').should('be.visible').and('have.attr', 'aria-expanded', 'true').and('contain.text', 'Hide preview').click();
    cy.get('[data-cy="event-live-preview"]').should('exist').and('be.visible');
    cy.get('[data-cy="event-live-preview-scroll"]').should('not.be.visible').and('have.attr', 'hidden');
    cy.get('[data-cy="event-preview-collapse"]').should('be.visible').and('have.attr', 'aria-expanded', 'false').and('contain.text', 'Show preview');
    cy.reload();
    cy.wait(['@myOrganizations', '@formats']);
    cy.get('[data-cy="event-live-preview"]').should('exist').and('be.visible');
    cy.get('[data-cy="event-live-preview-scroll"]').should('not.be.visible').and('have.attr', 'hidden');
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
