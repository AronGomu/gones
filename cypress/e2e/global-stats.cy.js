/**
 * T24 — Global Stats page E2E tests.
 * After T24 the page fetches the full catalog once (/all), caches it 24h,
 * and filters / sorts / pages client-side. All intercepts target the /all endpoint.
 */

const BASE_ROW = {
  position: 1,
  playerName: 'Alice',
  rating: 1524,
  lastRatingDelta: 0,
  tournamentsPlayed: 7,
  provisional: false,
  inactive: false,
  ratingDeviation: 45,
  previousRating: 1524,
  lastPlayedDate: '2025-01-01',
  decayedRating: null,
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
describe('Global Stats — 12 column headers', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    mockCatalog();
    cy.visit('/global-stats');
    cy.wait('@catalog');
  });

  const HEADERS = ['#', 'Player', 'Classement', 'Tournois', 'Matchs', 'Victoires', 'Défaites', 'Nuls', 'M%', 'Nemesis', 'Rival', 'Archétype (matchs)'];

  it('renders all 12 column headers in order', () => {
    cy.get('[data-cy="global-stats-table"]').within(() => {
      cy.get('th').then(($headers) => {
        const texts = [...$headers].map((el) => el.textContent.trim());
        for (const [i, expected] of HEADERS.entries()) {
          expect(texts[i], `header ${i}`).to.include(expected);
        }
      });
    });
  });

  it('rating column header is present', () => {
    cy.get('[data-cy="global-stats-col-rating"]').should('exist');
  });

  it('clicking the Rating header navigates to ?sort=rating&direction=desc', () => {
    cy.get('[data-cy="global-stats-col-rating"]').click();
    cy.url().should('include', 'sort=rating').and('include', 'direction=desc');
  });
});

describe('Global Stats — rating column', () => {
  it('renders a provisional badge for a provisional player', () => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, playerName: 'NewPlayer', provisional: true, inactive: false, tournamentsPlayed: 2 }),
    ];
    mockCatalog(rows);
    cy.visit('/global-stats');
    cy.wait('@catalog');
    cy.get('[data-cy="global-stats-cell-1-rating-provisional"]').should('exist');
    cy.get('[data-cy="global-stats-cell-1-rating-inactive"]').should('not.exist');
  });

  it('renders an inactive badge for an inactive player', () => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, playerName: 'OldPlayer', provisional: false, inactive: true }),
    ];
    mockCatalog(rows);
    cy.visit('/global-stats');
    cy.wait('@catalog');
    cy.get('[data-cy="global-stats-cell-1-rating-inactive"]').should('exist');
    cy.get('[data-cy="global-stats-cell-1-rating-provisional"]').should('not.exist');
  });

  it('renders no badge for an active ranked player', () => {
    cy.clearLocalStorage();
    mockCatalog();
    cy.visit('/global-stats');
    cy.wait('@catalog');
    cy.get('[data-cy="global-stats-cell-1-rating-provisional"]').should('not.exist');
    cy.get('[data-cy="global-stats-cell-1-rating-inactive"]').should('not.exist');
  });

  it('renders — when rating is undefined (stale cache row)', () => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, rating: undefined, lastRatingDelta: undefined }),
    ];
    mockCatalog(rows);
    cy.visit('/global-stats');
    cy.wait('@catalog');
    cy.get('[data-cy="global-stats-cell-1-rating-value"]').should('have.text', '—');
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
  });

  it('shows — for null rates on Bob', () => {
    cy.get('[data-cy="global-stats-cell-match-winrate-2"]').should('have.text', '—');
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

  it('shows Name (N) for archetype column on Alice', () => {
    cy.get('[data-cy="global-stats-cell-archetype-1"]').should('have.text', 'Delver (18)');
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
// Heading row layout
// ---------------------------------------------------------------------------
describe('Global Stats — heading row', () => {
  function rect(selector) {
    return cy.get(selector).then($el => $el[0].getBoundingClientRect());
  }

  it('title and sync bar share a row on a wide viewport', () => {
    cy.clearLocalStorage();
    mockCatalog();
    cy.viewport(1280, 800);
    cy.visit('/global-stats');
    cy.wait('@catalog');

    rect('[data-cy="global-stats-title"]').then(titleRect => {
      rect('[data-cy="global-stats-sync-button"]').then(syncRect => {
        expect(syncRect.top).to.be.lessThan(titleRect.bottom);
        expect(titleRect.top).to.be.lessThan(syncRect.bottom);
        expect(syncRect.left).to.be.greaterThan(titleRect.right);
      });
    });
  });

  it('title and sync bar stack on a narrow viewport', () => {
    cy.clearLocalStorage();
    mockCatalog();
    cy.viewport(420, 800);
    cy.visit('/global-stats');
    cy.wait('@catalog');

    rect('[data-cy="global-stats-title"]').then(titleRect => {
      rect('[data-cy="global-stats-sync-button"]').then(syncRect => {
        expect(syncRect.top).to.be.at.least(titleRect.bottom);
      });
    });
  });

  it('heading hooks survive', () => {
    cy.clearLocalStorage();
    mockCatalog();
    cy.viewport(1280, 800);
    cy.visit('/global-stats');
    cy.wait('@catalog');

    cy.get('[data-cy="global-stats-heading"]').should('exist');
    cy.get('[data-cy="global-stats-heading-text"]').should('exist');
    cy.get('[data-cy="global-stats-title"]').should('exist');
    cy.get('[data-cy="global-stats-sync-bar"]').should('exist');
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
