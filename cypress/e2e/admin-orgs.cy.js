const adminProfile = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'admin@example.test',
  emailVerified: true,
  globalRole: 'Admin',
  username: 'admin-user',
  firstName: 'Admin',
  lastName: 'User',
  location: undefined,
  birthYear: undefined,
  preferredLanguage: 'en',
  isFirstNamePublic: false,
  isLastNamePublic: false,
  isLocationPublic: false,
  isBirthYearPublic: false,
  isPreferredLanguagePublic: false,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z'
};

function profile(globalRole = 'Admin') {
  return { ...adminProfile, globalRole };
}

function mockSession(globalRole = 'Admin') {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2026-08-01T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', profile(globalRole));
}

const MATE_ID = '88888888-8888-8888-8888-888888888888';

const SEED_MARKER = 'gones.e2e.storage-seeded';

function seedStorage(win) {
  win.localStorage.setItem('gones.settings.language', 'en');
  win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  // A denied Admin route redirects to '/?denied=…', and `firstVisitHomeGuard` sends a browser that has
  // never completed a first visit on from there to /about — swallowing the denial notice this spec
  // asserts. Only '' and '/about' ever record that visit, so a session that deep-links to /admin/users
  // never has it. Record it, as any browser that has already been to the app would have.
  win.localStorage.setItem('gones.first-visit.completed', 'true');
  win.localStorage.setItem(SEED_MARKER, 'true');
}

// The production build registers the ngsw service worker, and once that worker controls the page it
// answers the navigation request out of its own cache: the document never travels through the Cypress
// proxy, so Cypress cannot install its hook and `onBeforeLoad` is never called — no error, no seed.
// Re-apply the seed from the loaded window and visit once more when the hook was skipped; the marker
// keeps that to a single extra load per test.
function visit(path) {
  cy.visit(path, { onBeforeLoad: seedStorage });
  cy.window({ log: false }).then(win => {
    if (win.localStorage.getItem(SEED_MARKER) === 'true') return;
    seedStorage(win);
    cy.visit(path);
  });
}

describe('admin organization and account controls', () => {
  beforeEach(() => cy.viewport(1280, 800));
  // Clear the private IndexedDB read-cache between tests so each test starts with a cold cache.
  // Without this, cached responses from earlier tests would be served instead of the test's intercepts.
  beforeEach(() => cy.window().then(win => new Promise(resolve => {
    const req = win.indexedDB.deleteDatabase('gones-cache');
    req.onsuccess = resolve;
    req.onerror = resolve;
    req.onblocked = resolve;
  })));

  it('enforces role matrix for Admin routes', () => {
    mockSession('User');
    visit('/admin/users');
    cy.location('pathname').should('eq', '/');
    cy.location('search').should('contain', 'denied=');

    mockSession('Admin');
    cy.intercept('GET', '**/api/admin/users?*', { items: [], page: 1, pageSize: 20, totalCount: 0 });
    visit('/admin/users');
    cy.get('[data-cy="admin-users"]').should('be.visible');
  });

  it('shows Admin pages with URL filters, retry, audit redacted diffs, and mobile focus', () => {
    mockSession('Admin');
    cy.intercept('GET', '**/api/admin/organizations?*', { items: [], page: 1, pageSize: 20, totalCount: 0 }).as('orgs');
    cy.intercept('GET', '**/api/admin/audit?*', {
      items: [{ id: 'a1', actorId: adminProfile.id, action: 'admin.role.granted', entityType: 'user', entityId: '22222222-2222-2222-2222-222222222222', redactedDiff: '{"fields":["globalRole"],"token":"nope"}', occurredAt: '2026-08-01T00:00:00Z' }],
      page: 1,
      pageSize: 20,
      totalCount: 1
    }).as('audit');
    visit('/admin');
    cy.get('[data-cy="admin-card-organizations"]').click();
    cy.location('pathname').should('eq', '/admin/organizations');
    cy.get('[data-cy="admin-org-search"]').type('Lyon{enter}');
    cy.location('search').should('contain', 'search=Lyon');
    cy.wait('@orgs');

    cy.viewport(375, 812);
    visit('/admin/audit?action=admin.role');
    cy.get('[data-cy="audit-action"]').focus().should('have.focus');
    cy.wait('@audit').its('request.url').should('contain', 'action=admin.role');
    cy.get('[data-cy="audit-redacted-diff"]').should('contain.text', 'redacted').and('not.contain.text', 'nope');
    cy.document().then(doc => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
  });

  it('handles organizer pages, cross-org tamper, and a member-removal refusal without relying on hidden controls', () => {
    mockSession('User');
    cy.intercept('GET', '**/api/users/me/organizations', [{ id: 'org-owned', name: 'Owned Club', description: '', website: '', contactEmail: '', role: 'Organizer', createdAt: '2026-08-01T00:00:00Z' }]);
    visit('/organizer/organizations');
    cy.get('[data-cy="my-org-card-Owned Club"]').should('be.visible');
    // Ownership is gone, so every member manages the organization.
    cy.get('[data-cy="manage-org-link"]').should('contain.text', 'Manage');

    cy.intercept('GET', '**/api/organizations/org-owned', { id: 'org-owned', name: 'Owned Club', description: '', website: '', contactEmail: '', createdAt: '2026-08-01T00:00:00Z' });
    cy.intercept('GET', '**/api/organizations/org-owned/members', [
      { userId: adminProfile.id, username: 'owner-user', role: 'Organizer', createdAt: '2026-08-01T00:00:00Z' },
      { userId: MATE_ID, username: 'mate-user', role: 'Organizer', createdAt: '2026-08-01T00:00:00Z' }
    ]);
    cy.intercept('GET', '**/api/organizations/org-owned/notification-settings', { organizationId: 'org-owned', notifyOnRegistration: true, notifyOnUnregistration: false, updatedAt: '2026-08-01T00:00:00Z' });
    // `RemoveMemberAsync` protects no member since ADR 0041 — the last one may leave and the
    // organization falls back to Draft — so the only refusal left is the 404 a member row that is
    // already gone produces. `last_owner` no longer exists anywhere in the API.
    cy.intercept('DELETE', '**/api/organizations/org-owned/members/**', { statusCode: 404, body: { code: 'not_found', status: 404 } }).as('removeMember');
    visit('/organizations/org-owned');
    cy.get('[data-cy="org-owner-panel"]').should('be.visible');
    // Adding a member grants the global Organizer role, so the server takes it from an Admin only;
    // a plain member is shown the reason instead of a control that fails.
    cy.get('[data-cy="org-add-member-form"]').should('not.exist');
    cy.get('[data-cy="org-add-member-admin-only"]').should('be.visible');
    // There is exactly one organization role now, so the roster reads the role out instead of
    // offering a select that could only ever pick the value it already has.
    cy.get(`[data-cy="org-member-role-${MATE_ID}"]`).should('have.text', 'Organizer');
    cy.get(`[data-cy="org-member-role-${MATE_ID}"]`).should('not.match', 'select');
    cy.on('window:confirm', () => true);
    cy.get('[data-cy="org-member-owner-user"] button').click();
    cy.wait('@removeMember');
    cy.get('[data-cy="org-manage-status"]').should('not.be.empty');

    cy.intercept('GET', '**/api/organizations/org-hidden', { id: 'org-hidden', name: 'Hidden Club', description: '', website: '', contactEmail: '', createdAt: '2026-08-01T00:00:00Z' });
    cy.intercept('GET', '**/api/organizations/org-hidden/members', { statusCode: 404, body: { code: 'not_found' } });
    cy.intercept('GET', '**/api/organizations/org-hidden/notification-settings', { statusCode: 404, body: { code: 'not_found' } });
    visit('/organizations/org-hidden');
    cy.get('[data-cy="org-manage-denied"]').should('be.visible');
  });

  it('assigns an organization to a plain user and renders the server refusal on removal', () => {
    mockSession('Admin');
    const orgId = '66666666-6666-6666-6666-666666666666';
    const userId = '77777777-7777-7777-7777-777777777777';
    let roster = [];
    let organization = { id: orgId, name: 'Draft Club', description: '', website: '', contactEmail: '', deletedAt: null, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', version: 1, memberCount: 0, isDraft: true };

    cy.intercept('GET', '**/api/admin/organizations?*', req => req.reply({ items: [organization], page: 1, pageSize: 20, totalCount: 1 })).as('orgs');
    cy.intercept('GET', '**/api/admin/users?*', {
      items: [{ id: userId, email: 'plain@example.test', emailVerified: true, globalRole: 'User', username: 'plain-user', firstName: 'Plain', lastName: 'User', isClosed: false, createdAt: '2026-08-01T00:00:00Z' }],
      page: 1,
      pageSize: 100,
      totalCount: 1
    }).as('pickerUsers');
    cy.intercept('GET', `**/api/admin/organizations/${orgId}/members`, req => req.reply(roster)).as('roster');
    cy.intercept('POST', `**/api/organizations/${orgId}/members`, req => {
      expect(req.body).to.deep.eq({ userId, role: 'Organizer' });
      roster = [{ userId, username: 'plain-user', email: 'plain@example.test', globalRole: 'Organizer', role: 'Organizer', createdAt: '2026-08-02T00:00:00Z' }];
      organization = { ...organization, memberCount: 1, isDraft: false };
      req.reply({ statusCode: 201, body: { userId, username: 'plain-user', role: 'Organizer', createdAt: '2026-08-02T00:00:00Z' } });
    }).as('addMember');

    visit('/admin/organizations');
    cy.get('[data-cy="admin-org-detail-empty"]').should('be.visible');
    cy.get(`[data-cy="admin-org-draft-${orgId}"]`).should('be.visible');
    cy.get(`[data-cy="admin-org-select-${orgId}"]`).click();
    cy.wait('@roster');
    cy.location('search').should('contain', `organization=${orgId}`);
    cy.get(`[data-cy="admin-org-select-${orgId}"]`).should('have.attr', 'aria-current', 'true');

    cy.get('[data-cy="admin-org-member-search"]').type('plain');
    cy.get(`[data-cy="admin-org-member-option-${userId}"]`).should('contain.text', 'plain@example.test').click();
    cy.wait('@addMember');
    cy.get(`[data-cy="admin-org-member-${userId}"]`).should('contain.text', 'plain-user');
    cy.get(`[data-cy="admin-org-draft-${orgId}"]`).should('not.exist');
    cy.get(`[data-cy="admin-org-member-option-${userId}"]`).should('not.exist');

    cy.intercept('DELETE', `**/api/organizations/${orgId}/members/${userId}`, { statusCode: 404, body: { code: 'not_found', status: 404 } }).as('removeMember');
    cy.on('window:confirm', () => true);
    cy.get(`[data-cy="admin-org-member-remove-${userId}"]`).click();
    cy.wait('@removeMember');
    cy.get('[data-cy="admin-orgs-error"]').should('be.visible').and('contain.text', 'not_found');
  });

  it('requires a typed Username and shows the membership impact for account disable', () => {
    mockSession('Admin');
    const userId = '22222222-2222-2222-2222-222222222222';
    cy.intercept('GET', '**/api/admin/users?*', {
      items: [{ id: userId, email: 'owner@example.test', emailVerified: true, globalRole: 'User', username: 'owner-user', firstName: 'Owner', lastName: 'User', isClosed: false, createdAt: '2026-08-01T00:00:00Z' }],
      page: 1,
      pageSize: 20,
      totalCount: 1
    });
    cy.intercept('GET', `**/api/admin/users/${userId}/closure-impact`, {
      userId,
      username: 'owner-user',
      email: 'owner@example.test',
      globalRole: 'User',
      isClosed: false,
      isLastAdmin: false,
      isSelf: false,
      canClose: true,
      blockReason: null,
      otherMembershipOrganizationIds: ['55555555-5555-5555-5555-555555555555']
    });
    cy.intercept('POST', `**/api/admin/users/${userId}/disable`, req => {
      expect(req.body).to.deep.eq({ confirmedUsername: 'owner-user' });
      req.reply({ statusCode: 204 });
    }).as('disable');
    visit('/admin/users');
    cy.get('[data-cy="close-user-owner-user"]').click();
    cy.get('[data-cy="admin-close-impact"]').should('contain.text', '1');
    // Closure just leaves the organizations now: there is no transfer control left to fill in.
    cy.get('[data-cy^="transfer-owner-"]').should('not.exist');
    cy.get('[data-cy="admin-close-username"]').type('owner-user');
    cy.get('[data-cy="admin-close-confirm"]').click();
    cy.wait('@disable');
  });

  it('shows a new organization immediately after create and serves page from cache on reload', () => {
    mockSession('Admin');
    const newOrgId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const newOrg = { id: newOrgId, name: 'Fresh Club', description: '', website: '', contactEmail: '', deletedAt: null, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', version: 1, memberCount: 0, isDraft: true };
    let listCallCount = 0;

    cy.intercept('GET', '**/api/admin/organizations?*', req => {
      listCallCount++;
      req.reply({ items: listCallCount > 1 ? [newOrg] : [], page: 1, pageSize: 20, totalCount: listCallCount > 1 ? 1 : 0 });
    }).as('orgList');
    cy.intercept('GET', '**/api/admin/users?*', { items: [], page: 1, pageSize: 100, totalCount: 0 });
    cy.intercept('POST', '**/api/admin/organizations', req => {
      req.reply({ statusCode: 201, body: newOrg });
    }).as('createOrg');

    visit('/admin/organizations');
    cy.wait('@orgList');

    // The filter applies while typing, so there is no Apply button to press.
    cy.get('[data-cy="admin-org-search-submit"]').should('not.exist');

    cy.get('[data-cy="admin-org-create-toggle"]').click();
    cy.get('[data-cy="admin-create-org-owner"]').should('not.exist');
    // An empty name blocks the submit inline, without a request.
    cy.get('[data-cy="admin-create-org-name-error"]').should('be.visible');
    cy.get('[data-cy="admin-create-org-submit"]').should('be.disabled');
    cy.get('[data-cy="admin-create-org-name"]').type('Fresh Club');
    cy.get('[data-cy="admin-create-org-name-error"]').should('not.exist');
    cy.get('[data-cy="admin-create-org-submit"]').click();
    cy.wait('@createOrg');
    cy.wait('@orgList');

    cy.get(`[data-cy="admin-org-row-name-${newOrgId}"]`).should('contain.text', 'Fresh Club');

    // Reload the page: the cache is still warm (re-invalidated but just refetched), so verify the
    // list renders without a new network request.
    cy.intercept('GET', '**/api/admin/organizations?*').as('orgListReload');
    cy.reload();
    cy.get(`[data-cy="admin-org-row-name-${newOrgId}"]`).should('contain.text', 'Fresh Club');
    // The reload should NOT fire a new API request (IndexedDB cache serves it).
    cy.get('@orgListReload.all').should('have.length', 0);

    // Cancel closes the create form and clears the draft.
    cy.get('[data-cy="admin-org-create-toggle"]').click();
    cy.get('[data-cy="admin-create-org-name"]').type('Abandoned Club');
    cy.get('[data-cy="admin-create-org-cancel"]').click();
    cy.get('[data-cy="admin-create-org"]').should('not.exist');
    cy.get('[data-cy="admin-org-create-toggle"]').click();
    cy.get('[data-cy="admin-create-org-name"]').should('have.value', '');
  });

  it('admin pages show breadcrumb rooted at Admin, not Menu', () => {
    mockSession();
    cy.intercept('GET', '**/api/admin/users?*', { items: [], page: 1, pageSize: 20, totalCount: 0 });
    cy.visit('/admin/users');
    cy.get('[data-cy="breadcrumbs"]').invoke('text').should('match', /Admin console|Console Admin/);
    cy.get('[data-cy="breadcrumbs"]').should('not.contain.text', 'Menu');
  });
});
