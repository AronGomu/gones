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

function visit(path) {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('gones.settings.language', 'en');
      win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
    }
  });
}

describe('admin organization and account controls', () => {
  beforeEach(() => cy.viewport(1280, 800));

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
    cy.get('[data-cy="admin-nav-organizations"]').click();
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

  it('handles owner pages, cross-org tamper, and last-owner guard without relying on hidden controls', () => {
    mockSession('User');
    cy.intercept('GET', '**/api/users/me/organizations', [{ id: 'org-owned', name: 'Owned Club', description: '', website: '', contactEmail: '', role: 'Owner', createdAt: '2026-08-01T00:00:00Z' }]);
    visit('/organizer/organizations');
    cy.get('[data-cy="my-org-card-Owned Club"]').should('be.visible');

    cy.intercept('GET', '**/api/organizations/org-owned', { id: 'org-owned', name: 'Owned Club', description: '', website: '', contactEmail: '', createdAt: '2026-08-01T00:00:00Z' });
    cy.intercept('GET', '**/api/organizations/org-owned/members', [{ userId: adminProfile.id, username: 'owner-user', role: 'Owner', createdAt: '2026-08-01T00:00:00Z' }]);
    cy.intercept('GET', '**/api/organizations/org-owned/notification-settings', { organizationId: 'org-owned', notifyOnRegistration: true, notifyOnUnregistration: false, updatedAt: '2026-08-01T00:00:00Z' });
    cy.intercept('DELETE', '**/api/organizations/org-owned/members/**', { statusCode: 409, body: { code: 'last_owner' } }).as('removeOwner');
    visit('/organizations/org-owned');
    cy.get('[data-cy="org-owner-panel"]').should('be.visible');
    cy.on('window:confirm', () => true);
    cy.get('[data-cy="org-member-owner-user"] button').click();
    cy.wait('@removeOwner');
    cy.get('[data-cy="org-manage-status"]').should('not.be.empty');

    cy.intercept('GET', '**/api/organizations/org-hidden', { id: 'org-hidden', name: 'Hidden Club', description: '', website: '', contactEmail: '', createdAt: '2026-08-01T00:00:00Z' });
    cy.intercept('GET', '**/api/organizations/org-hidden/members', { statusCode: 404, body: { code: 'not_found' } });
    cy.intercept('GET', '**/api/organizations/org-hidden/notification-settings', { statusCode: 404, body: { code: 'not_found' } });
    visit('/organizations/org-hidden');
    cy.get('[data-cy="org-manage-denied"]').should('be.visible');
  });

  it('requires typed Username and ownership-transfer summary for account disable impact', () => {
    mockSession('Admin');
    const userId = '22222222-2222-2222-2222-222222222222';
    const orgId = '33333333-3333-3333-3333-333333333333';
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
      blockReason: 'missing_owner_transfer',
      soleOwnedOrganizations: [{ organizationId: orgId, organizationName: 'Solo Club', suggestedNewOwnerUserId: '44444444-4444-4444-4444-444444444444', suggestedNewOwnerUsername: 'mate-user' }],
      otherMembershipOrganizationIds: ['55555555-5555-5555-5555-555555555555']
    });
    cy.intercept('POST', `**/api/admin/users/${userId}/disable`, req => {
      expect(req.body.confirmedUsername).to.eq('owner-user');
      expect(req.body.ownershipTransfers).to.deep.eq([{ organizationId: orgId, newOwnerUserId: '44444444-4444-4444-4444-444444444444' }]);
      req.reply({ statusCode: 204 });
    }).as('disable');
    visit('/admin/users');
    cy.get('[data-cy="close-user-owner-user"]').click();
    cy.get('[data-cy="admin-close-impact"]').should('contain.text', '1').and('contain.text', '1');
    cy.get('[data-cy="admin-close-username"]').type('owner-user');
    cy.get(`[data-cy="transfer-owner-${orgId}"]`).clear().type('44444444-4444-4444-4444-444444444444');
    cy.get('[data-cy="admin-close-confirm"]').click();
    cy.wait('@disable');
  });
});
