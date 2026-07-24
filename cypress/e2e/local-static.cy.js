const STORE_KEY = 'gones.frontend.backend.v1';

describe('legacy static mode', () => {
  it('persists a League locally without API traffic', () => {
    cy.visit('/leagues', {
      onBeforeLoad(win) {
        win.localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, leagues: [] }));
        win.localStorage.setItem('gones.settings.language', 'en');
      }
    });

    cy.get('[data-cy="create-league-card"]').click();
    cy.contains('mat-dialog-container', 'New League').within(() => {
      cy.get('input').type('Local Smoke League');
      cy.contains('button', 'Create League').click();
    });
    cy.contains('h1 button', 'Local Smoke League').should('be.visible');
    cy.reload();
    cy.contains('h1 button', 'Local Smoke League').should('be.visible');
    cy.window().then(win => {
      const apiRequests = win.performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(url => new URL(url).pathname.startsWith('/api/'));
      expect(apiRequests).to.deep.equal([]);
      expect(win.localStorage.getItem(STORE_KEY)).to.contain('Local Smoke League');
    });
  });
});
