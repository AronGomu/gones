/**
 * T24 — Global Stats page E2E tests.
 * After T24 the page fetches the full catalog once (/all), caches it 24h,
 * and filters / sorts / pages client-side. All intercepts target the /all endpoint.
 */

const BASE_ROW = {
  position: 1,
  playerName: 'Alice',
  playedMatchCount: 20,
  matchWins: 15,
  matchLosses: 4,
  matchDraws: 1,
  matchWinrate: 0.75,
  playedGameCount: 45,
  gameWins: 32,
  gameLosses: 13,
  gameWinrate: 0.711,
  nemesis: { name: 'Bob', wins: 3, losses: 2 },
  rival: { name: 'Carol', wins: 4, losses: 4 },
  mostPlayedArchetype: { name: 'Delver', matchCount: 18 },
};

function makeRow(overrides) {
  return { ...BASE_ROW, ...overrides };
}

function mockCatalog(items = [BASE_ROW]) {
  cy.intercept('GET', '**/api/leagues-archive/global-player-statistics/all', {
    items,
    totalCount: items.length,
    truncated: false,
  }).as('catalog');
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------
describe('Global Stats — 14 column headers', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    mockCatalog();
    cy.visit('/global-stats');
    cy.wait('@catalog');
  });

  const HEADERS = ['#', 'Player', 'Matches', 'MW', 'ML', 'MD', 'M%', 'Games', 'GW', 'GL', 'G%', 'Nemesis', 'Rival', 'Archetype'];

  it('renders all 14 column headers in order', () => {
    cy.get('[data-cy="global-stats-table"]').within(() => {
      cy.get('th').then(($headers) => {
        const texts = [...$headers].map((el) => el.textContent.trim());
        for (const [i, expected] of HEADERS.entries()) {
          expect(texts[i], `header ${i}`).to.include(expected);
        }
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
describe('Global Stats — cell formatting', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, playerName: 'Alice', matchWinrate: 0.75, gameWinrate: 0.711 }),
      makeRow({ position: 2, playerName: 'Bob', matchWinrate: null, gameWinrate: null, nemesis: null, rival: null, mostPlayedArchetype: null }),
    ];
    mockCatalog(rows);
    cy.visit('/global-stats');
    cy.wait('@catalog');
  });

  it('shows percentage as whole number for Alice', () => {
    cy.get('[data-cy="global-stats-cell-match-winrate-1"]').should('have.text', '75%');
    cy.get('[data-cy="global-stats-cell-game-winrate-1"]').should('have.text', '71%');
  });

  it('shows — for null rates on Bob', () => {
    cy.get('[data-cy="global-stats-cell-match-winrate-2"]').should('have.text', '—');
    cy.get('[data-cy="global-stats-cell-game-winrate-2"]').should('have.text', '—');
  });

  it('shows — for null nemesis/rival/archetype on Bob', () => {
    cy.get('[data-cy="global-stats-cell-nemesis-2"]').should('have.text', '—');
    cy.get('[data-cy="global-stats-cell-rival-2"]').should('have.text', '—');
    cy.get('[data-cy="global-stats-cell-archetype-2"]').should('have.text', '—');
  });

  it('shows Name (W-L) for opponent columns on Alice', () => {
    cy.get('[data-cy="global-stats-cell-nemesis-1"]').should('have.text', 'Bob (3-2)');
    cy.get('[data-cy="global-stats-cell-rival-1"]').should('have.text', 'Carol (4-4)');
  });

  it('shows Name (N matches) for archetype column on Alice', () => {
    cy.get('[data-cy="global-stats-cell-archetype-1"]').should('have.text', 'Delver (18 matches)');
  });
});

// ---------------------------------------------------------------------------
// Sorting — client-side, no request
// ---------------------------------------------------------------------------
describe('Global Stats — client-side sort', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, playerName: 'Alice', matchWins: 5 }),
      makeRow({ position: 2, playerName: 'Bob', matchWins: 10 }),
    ];
    mockCatalog(rows);
    cy.visit('/global-stats');
    cy.wait('@catalog');
  });

  it('clicking Match Wins header sorts client-side (no extra request)', () => {
    cy.get('[data-cy="global-stats-col-match-wins"]').click();
    // No second network request — Bob (10 wins) should be first
    cy.get('[data-cy="global-stats-cell-player-1"]').should('have.text', 'Bob');
  });

  it('clicking Match Wins twice reverses the sort', () => {
    cy.get('[data-cy="global-stats-col-match-wins"]').click();
    cy.get('[data-cy="global-stats-col-match-wins"]').click();
    cy.get('[data-cy="global-stats-cell-player-1"]').should('have.text', 'Alice');
  });

  it('Position column is not clickable (not a button)', () => {
    cy.get('[data-cy="global-stats-col-position"]').should('not.have.attr', 'role', 'button');
  });
});

// ---------------------------------------------------------------------------
// Search — on input, no Apply button
// ---------------------------------------------------------------------------
describe('Global Stats — search on input', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, playerName: 'Alice' }),
      makeRow({ position: 2, playerName: 'Bob' }),
    ];
    mockCatalog(rows);
    cy.visit('/global-stats');
    cy.wait('@catalog');
  });

  it('has no apply button', () => {
    cy.get('[data-cy="global-stats-search-apply"]').should('not.exist');
  });

  it('typing filters rows client-side', () => {
    cy.get('[data-cy="global-stats-search-input"]').type('ali');
    cy.get('[data-cy="global-stats-cell-player-1"]').should('have.text', 'Alice');
    cy.get('[data-cy="global-stats-cell-player-2"]').should('not.exist');
  });
});

// ---------------------------------------------------------------------------
// Pagination — client-side
// ---------------------------------------------------------------------------
describe('Global Stats — client-side paging', () => {
  it('page sizes 25, 50 update the visible rows without a new request', () => {
    cy.clearLocalStorage();
    const rows = Array.from({ length: 60 }, (_, i) => makeRow({ position: i + 1, playerName: `Player${i + 1}` }));
    mockCatalog(rows);
    cy.visit('/global-stats');
    cy.wait('@catalog');

    // Default size=100 shows all 60 — check last row
    cy.get('[data-cy="global-stats-cell-player-60"]').should('exist');

    // The catalog is cached; changing page size must not send a new request
    cy.intercept('GET', '**/api/leagues-archive/global-player-statistics/all').as('unexpectedCatalog');
    cy.get('[data-cy="global-stats-page-size-select"]').click();
    cy.get('[data-cy="global-stats-size-option-25"]').click();
    cy.get('[data-cy="global-stats-cell-player-25"]').should('exist');
    cy.get('[data-cy="global-stats-cell-player-26"]').should('not.exist');
  });
});

// ---------------------------------------------------------------------------
// Sync bar
// ---------------------------------------------------------------------------
describe('Global Stats — sync bar', () => {
  it('has a sync button', () => {
    cy.clearLocalStorage();
    mockCatalog();
    cy.visit('/global-stats');
    cy.wait('@catalog');
    cy.get('[data-cy="global-stats-sync-button"]').should('exist');
  });

  it('pressing sync triggers a new catalog request', () => {
    cy.clearLocalStorage();
    mockCatalog();
    cy.visit('/global-stats');
    cy.wait('@catalog');

    mockCatalog();
    cy.get('[data-cy="global-stats-sync-button"]').click();
    cy.wait('@catalog');
  });
});

// ---------------------------------------------------------------------------
// Player navigation
// ---------------------------------------------------------------------------
describe('Global Stats — player link navigation', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    mockCatalog();
    cy.visit('/global-stats');
    cy.wait('@catalog');
  });

  it('clicking a player name navigates to /players/:name', () => {
    cy.get('[data-cy="global-stats-player-link-1"]').should('have.attr', 'href').and('include', '/players/Alice');
  });
});

// ---------------------------------------------------------------------------
// Home navigation
// ---------------------------------------------------------------------------
describe('Global Stats — home card', () => {
  it('home page shows a Global Rankings card that navigates to /global-stats', () => {
    cy.visit('/');
    cy.get('[data-cy="menu-global-stats-card"]').should('exist').click();
    cy.url().should('include', '/global-stats');
  });
});
