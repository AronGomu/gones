/**
 * T15 — Global Stats page E2E tests.
 * Intercepts the API to avoid requiring a running server with populated data.
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

function mockGlobalStats(items = [BASE_ROW], totalCount = items.length, page = 1, pageSize = 100) {
  cy.intercept('GET', '**/api/leagues-archive/global-player-statistics**', (req) => {
    req.reply({ items, page, pageSize, totalCount, sort: undefined, direction: undefined });
  }).as('globalStats');
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------
describe('Global Stats — 14 column headers', () => {
  beforeEach(() => {
    mockGlobalStats();
    cy.visit('/global-stats');
    cy.wait('@globalStats');
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
    const rows = [
      makeRow({ position: 1, playerName: 'Alice', matchWinrate: 0.75, gameWinrate: 0.711 }),
      makeRow({ position: 2, playerName: 'Bob', matchWinrate: null, gameWinrate: null, nemesis: null, rival: null, mostPlayedArchetype: null }),
    ];
    mockGlobalStats(rows, 2);
    cy.visit('/global-stats');
    cy.wait('@globalStats');
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
// Sorting — numeric sort click
// ---------------------------------------------------------------------------
describe('Global Stats — numeric sort', () => {
  beforeEach(() => {
    mockGlobalStats();
    cy.visit('/global-stats');
    cy.wait('@globalStats');
  });

  it('clicking Match Wins header requests sort=matchWins,direction=desc', () => {
    mockGlobalStats();
    cy.get('[data-cy="global-stats-col-match-wins"]').click();
    cy.wait('@globalStats').its('request.url').should('include', 'sort=matchWins').and('include', 'direction=desc');
  });

  it('clicking Match Wins twice requests sort=matchWins,direction=asc', () => {
    mockGlobalStats();
    cy.get('[data-cy="global-stats-col-match-wins"]').click();
    cy.wait('@globalStats');
    mockGlobalStats();
    cy.get('[data-cy="global-stats-col-match-wins"]').click();
    cy.wait('@globalStats').its('request.url').should('include', 'direction=asc');
  });

  it('Position column is not clickable (not a button)', () => {
    // Position header is a plain <th> with no (click) binding
    cy.get('[data-cy="global-stats-col-position"]').should('not.have.attr', 'role', 'button');
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
describe('Global Stats — search', () => {
  beforeEach(() => {
    mockGlobalStats();
    cy.visit('/global-stats');
    cy.wait('@globalStats');
  });

  it('typing a name and applying search includes search param and resets to page 1', () => {
    mockGlobalStats();
    cy.get('[data-cy="global-stats-search-input"]').type('alice');
    cy.get('[data-cy="global-stats-search-apply"]').click();
    cy.wait('@globalStats').its('request.url').should('include', 'search=alice');
    cy.url().should('include', 'search=alice');
    cy.url().should('not.include', 'page=');
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
describe('Global Stats — page size', () => {
  it('page sizes 25, 50, 100 update the request', () => {
    for (const size of [25, 50, 100]) {
      mockGlobalStats(Array.from({ length: size }, (_, i) => makeRow({ position: i + 1, playerName: `Player${i + 1}` })), size * 2);
      cy.visit(`/global-stats?size=${size}`);
      cy.wait('@globalStats').its('request.url').should('include', `pageSize=${size}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Player navigation
// ---------------------------------------------------------------------------
describe('Global Stats — player link navigation', () => {
  beforeEach(() => {
    mockGlobalStats();
    cy.visit('/global-stats');
    cy.wait('@globalStats');
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
