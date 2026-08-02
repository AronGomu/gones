const adminProfile = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'admin@example.test',
  emailVerified: true,
  globalRole: 'Admin',
  username: 'admin-user',
  firstName: 'Admin',
  lastName: 'User',
  preferredLanguage: 'en',
  isFirstNamePublic: false,
  isLastNamePublic: false,
  isLocationPublic: false,
  isBirthYearPublic: false,
  isPreferredLanguagePublic: false,
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z'
};

function mockSession() {
  cy.intercept('POST', '**/api/auth/refresh', { accessToken: 'memory-token', expiresAt: '2026-08-02T01:00:00Z', tokenType: 'Bearer' });
  cy.intercept('GET', '**/api/users/me', adminProfile);
}

function visit(path) {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.setItem('gones.settings.language', 'en');
      win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
    }
  });
}

const reconciliation = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  templateKey: 'reminder',
  userId: '22222222-2222-2222-2222-222222222222',
  tournamentId: '33333333-3333-3333-3333-333333333333',
  status: 'Reconciliation',
  deliveryStatus: 'Deferred',
  providerMessageId: 'provider-message-1',
  attemptCount: 2,
  lastErrorCode: 'brevo_acceptance_uncertain',
  createdAt: '2026-08-02T00:00:00Z',
  lastAttemptAt: '2026-08-02T00:01:00Z',
  canRetry: true
};

describe('Admin notification delivery operations', () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    mockSession();
  });

  it('shows provider-safe history with URL status filter', () => {
    cy.intercept('GET', '**/api/admin/notifications/history?*', { items: [reconciliation], page: 1, pageSize: 20, totalCount: 1 }).as('history');
    visit('/admin/notifications/history');
    cy.wait('@history');
    cy.get('[data-cy="notification-row"]').should('contain.text', 'provider-message-1').and('not.contain.text', 'admin@example.test');
    cy.get('[data-cy="notification-status"]').select('Sent');
    cy.contains('button', 'Apply').click();
    cy.location('search').should('contain', 'status=Sent');
  });

  it('requires confirmation, locks retry, reloads dead letters, stays mobile-safe', () => {
    let requests = 0;
    cy.intercept('GET', '**/api/admin/notifications/dead-letters?*', (request) => {
      requests++;
      request.reply({ items: requests === 1 ? [reconciliation] : [], page: 1, pageSize: 20, totalCount: requests === 1 ? 1 : 0 });
    }).as('deadLetters');
    cy.intercept('POST', '**/api/admin/notifications/dead-letters/*/retry', (request) => {
      expect(request.body).to.deep.equal({ operatorApproved: true });
      request.reply({ attemptId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });
    }).as('retry');
    cy.on('window:confirm', () => true);
    cy.viewport(375, 812);
    visit('/admin/notifications/dead-letters');
    cy.wait('@deadLetters');
    cy.get('[data-cy="notification-retry"]').click();
    cy.wait('@retry');
    cy.wait('@deadLetters');
    cy.get('[data-cy="notification-empty"]').should('be.visible');
    cy.document().then((doc) => expect(doc.documentElement.scrollWidth).to.be.at.most(375));
  });
});
