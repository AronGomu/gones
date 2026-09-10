describe('fresh owner setup browser journey', () => {
  it('requires explicit confirmation, private promotion, normal login, and keeps Admin after reload', () => {
    let submissions = 0;
    cy.intercept('POST', '**/api/auth/owner-setup', req => { submissions++; req.continue(); });
    cy.task('ownerSetupLink', null, { log: false }).then(link => cy.visit(link, { log: false }));
    cy.get('[data-cy="owner-form"]').should('be.visible');
    cy.location('hash', { log: false }).should('eq', '');
    cy.task('ownerSetupState', null, { log: false }).should('deep.equal', { users: 0, admins: 0 });
    cy.then(() => expect(submissions).to.equal(0));
    cy.get('[data-cy="owner-username"]').type('OwnerBrowserFixture');
    cy.get('[data-cy="owner-first-name"]').type('Fixture');
    cy.get('[data-cy="owner-last-name"]').type('Owner');
    cy.get('[data-cy="owner-password"]').type('owner-browser-chosen-password', { log: false });
    cy.get('[data-cy="owner-confirm-password"]').type('owner-browser-chosen-password', { log: false });
    cy.get('[data-cy="owner-submit"]').click();
    cy.get('[data-cy="owner-completed"]').should('be.visible');
    cy.then(() => expect(submissions).to.equal(1));
    cy.task('ownerSetupState', null, { log: false }).should('deep.equal', { users: 1, admins: 0 });
    cy.getCookie('gones_refresh', { log: false }).should('be.null');
    cy.task('ownerPromote', null, { log: false });
    cy.get('[data-cy="owner-login"]').click();
    cy.get('[data-cy="auth-email"]').type('owner@example.test', { log: false });
    cy.get('[data-cy="auth-password"]').type('owner-browser-chosen-password', { log: false });
    cy.get('[data-cy="auth-submit"]').click();
    cy.location('pathname').should('eq', '/admin');
    cy.get('[data-cy="admin-home"]').should('be.visible');
    cy.reload();
    cy.get('[data-cy="admin-home"]').should('be.visible');
    cy.location('pathname').should('eq', '/admin');
    cy.window({ log: false }).then(win => {
      const storage = JSON.stringify(win.localStorage) + JSON.stringify(win.sessionStorage);
      expect(storage.includes('owner-browser-chosen-password')).to.equal(false);
      expect(storage.includes('token=')).to.equal(false);
    });
  });
});
