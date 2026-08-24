/**
 * Global Stats page E2E tests. The page pages, sorts and searches on the server against
 * `/api/archive/global-player-statistics` inside the scope the League and Season selects choose, so
 * every intercept targets that endpoint plus the two archive catalogs that fill the selects.
 */

const ARCHIVE_CACHE_DB = 'gones-archive-cache';
const LYON_LEAGUE = { id: 'lyon', name: 'Ligue Lyon', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', documentVersion: 1 };
const LYON_SEASON = {
  id: 'lyon-2026', name: 'Ligue Lyon 2026', leagueId: 'lyon', status: 'completed',
  updatedAt: '2026-01-01T00:00:00Z', documentVersion: 1, tournamentCount: 4, playerCount: 18,
  firstTournamentDate: '2026-01-10', lastTournamentDate: '2026-06-20',
};

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

/**
 * Stands in for the scoped endpoint: it honours `search`, `sort`, `direction`, `page` and `pageSize`
 * exactly as the server does, and numbers `position` inside the answered page, so a test observes the
 * same round trip the browser makes rather than a client-side filter that no longer exists.
 */
function mockRankings(items = [BASE_ROW], overrides = {}) {
  cy.intercept('GET', '**/api/archive/global-player-statistics?*', (req) => {
    const search = String(req.query.search || '').toLowerCase();
    const sort = req.query.sort;
    const sign = req.query.direction === 'asc' ? 1 : -1;
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 100);

    const matched = search ? items.filter((row) => row.playerName.toLowerCase().includes(search)) : [...items];
    if (sort) matched.sort((left, right) => sign * ((left[sort] ?? 0) - (right[sort] ?? 0)));
    const offset = (page - 1) * pageSize;

    req.reply({
      items: matched.slice(offset, offset + pageSize).map((row, index) => ({ ...row, position: offset + index + 1 })),
      page,
      pageSize,
      totalCount: matched.length,
      ...overrides,
    });
  }).as('rankings');
}

function mockScopeCatalogs(leagues = [LYON_LEAGUE], seasons = [LYON_SEASON]) {
  cy.intercept('GET', '**/api/archive/leagues/all', { items: leagues, totalCount: leagues.length, truncated: false }).as('leagueCatalog');
  cy.intercept('GET', '**/api/archive/league-seasons/all', { items: seasons, totalCount: seasons.length, truncated: false }).as('seasonCatalog');
}

/** The two select catalogs are cached in IndexedDB for 24h, so drop the store before each visit. */
function visitRankings(url = '/global-stats') {
  cy.visit(url, { onBeforeLoad(win) {
    win.indexedDB.deleteDatabase(ARCHIVE_CACHE_DB);
    win.localStorage.setItem('gones.settings.language', 'en');
    win.localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  } });
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------
describe('Global Stats — 11 column headers', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    mockRankings();
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');
  });

  const HEADERS = ['#', 'Player', 'Rating', 'Tournaments', 'Matches', 'Wins', 'Losses', 'Draw', 'M%', 'Rival', 'Archetype (matches)'];

  it('renders all 11 column headers in order', () => {
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

  it('clicking the Rating header navigates to ?sort=rating&dir=desc', () => {
    cy.get('[data-cy="global-stats-col-rating"]').click();
    cy.url().should('include', 'sort=rating').and('include', 'dir=desc');
  });
});

describe('Global Stats — rating column', () => {
  it('renders a provisional badge for a provisional player', () => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, playerName: 'NewPlayer', provisional: true, inactive: false, tournamentsPlayed: 2 }),
    ];
    mockRankings(rows);
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');
    cy.get('[data-cy="global-stats-cell-1-rating-provisional"]').should('exist');
    cy.get('[data-cy="global-stats-cell-1-rating-inactive"]').should('not.exist');
  });

  it('renders an inactive badge for an inactive player', () => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, playerName: 'OldPlayer', provisional: false, inactive: true }),
    ];
    mockRankings(rows);
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');
    cy.get('[data-cy="global-stats-cell-1-rating-inactive"]').should('exist');
    cy.get('[data-cy="global-stats-cell-1-rating-provisional"]').should('not.exist');
  });

  it('renders no badge for an active ranked player', () => {
    cy.clearLocalStorage();
    mockRankings();
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');
    cy.get('[data-cy="global-stats-cell-1-rating-provisional"]').should('not.exist');
    cy.get('[data-cy="global-stats-cell-1-rating-inactive"]').should('not.exist');
  });

  it('renders — when rating is undefined (stale cache row)', () => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, rating: undefined, lastRatingDelta: undefined }),
    ];
    mockRankings(rows);
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');
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
    mockRankings(rows);
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');
  });

  it('shows percentage as whole number for Alice', () => {
    cy.get('[data-cy="global-stats-cell-match-winrate-1"]').should('have.text', '75%');
  });

  it('shows — for null rates on Bob', () => {
    cy.get('[data-cy="global-stats-cell-match-winrate-2"]').should('have.text', '—');
  });

  it('shows — for null rival/archetype on Bob', () => {
    cy.get('[data-cy="global-stats-cell-rival-2"]').should('have.text', '—');
    cy.get('[data-cy="global-stats-cell-archetype-2"]').should('have.text', '—');
  });

  it('shows Name (W-L) for the rival column on Alice', () => {
    cy.get('[data-cy="global-stats-cell-rival-1"]').should('have.text', 'Carol (4-4)');
  });

  it('shows Name (N) for archetype column on Alice', () => {
    cy.get('[data-cy="global-stats-cell-archetype-1"]').should('have.text', 'Delver (18)');
  });
});

// ---------------------------------------------------------------------------
// Sorting — client-side, no request
// ---------------------------------------------------------------------------
describe('Global Stats — server-side sort', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, playerName: 'Alice', matchWins: 5 }),
      makeRow({ position: 2, playerName: 'Bob', matchWins: 10 }),
    ];
    mockRankings(rows);
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');
  });

  it('clicking Match Wins header asks the server for that order', () => {
    cy.get('[data-cy="global-stats-col-match-wins"]').click();
    cy.wait('@rankings').its('request.query.sort').should('eq', 'matchWins');
    // Bob (10 wins) comes back first, at the position the server assigned.
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
// Search — on input, no Apply button; the term is answered by the server
// ---------------------------------------------------------------------------
describe('Global Stats — search on input', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    const rows = [
      makeRow({ position: 1, playerName: 'Alice' }),
      makeRow({ position: 2, playerName: 'Bob' }),
    ];
    mockRankings(rows);
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');
  });

  it('has no apply button', () => {
    cy.get('[data-cy="global-stats-search-apply"]').should('not.exist');
  });

  it('typing narrows the rows through the server', () => {
    cy.get('[data-cy="global-stats-search-input"]').type('ali');
    cy.get('[data-cy="global-stats-cell-player-1"]').should('have.text', 'Alice');
    cy.get('[data-cy="global-stats-cell-player-2"]').should('not.exist');
  });
});

// ---------------------------------------------------------------------------
// Pagination — server-side
// ---------------------------------------------------------------------------
describe('Global Stats — server-side paging', () => {
  it('choosing page size 25 asks the server for one page of 25', () => {
    cy.clearLocalStorage();
    const rows = Array.from({ length: 60 }, (_, i) => makeRow({ position: i + 1, playerName: `Player${i + 1}` }));
    mockRankings(rows);
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');

    // Default size=100 shows all 60 — check last row
    cy.get('[data-cy="global-stats-cell-player-60"]').should('exist');

    cy.get('[data-cy="global-stats-page-size-select"]').click();
    cy.get('[data-cy="global-stats-size-option-25"]').click();
    cy.wait('@rankings').its('request.query.pageSize').should('eq', '25');
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
    mockRankings();
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');
    cy.get('[data-cy="global-stats-sync-button"]').should('exist');
  });

  it('pressing sync triggers a new rankings request', () => {
    cy.clearLocalStorage();
    mockRankings();
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');

    mockRankings();
    mockScopeCatalogs();
    cy.get('[data-cy="global-stats-sync-button"]').click();
    cy.wait('@rankings');
  });
});

// ---------------------------------------------------------------------------
// Player navigation
// ---------------------------------------------------------------------------
describe('Global Stats — player link navigation', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    mockRankings();
    mockScopeCatalogs();
    visitRankings();
    cy.wait('@rankings');
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
    mockRankings();
    mockScopeCatalogs();
    cy.viewport(1280, 800);
    visitRankings();
    cy.wait('@rankings');

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
    mockRankings();
    mockScopeCatalogs();
    cy.viewport(420, 800);
    visitRankings();
    cy.wait('@rankings');

    rect('[data-cy="global-stats-title"]').then(titleRect => {
      rect('[data-cy="global-stats-sync-button"]').then(syncRect => {
        expect(syncRect.top).to.be.at.least(titleRect.bottom);
      });
    });
  });

  it('heading hooks survive', () => {
    cy.clearLocalStorage();
    mockRankings();
    mockScopeCatalogs();
    cy.viewport(1280, 800);
    visitRankings();
    cy.wait('@rankings');

    cy.get('[data-cy="global-stats-heading"]').should('exist');
    cy.get('[data-cy="global-stats-heading-text"]').should('exist');
    cy.get('[data-cy="global-stats-title"]').should('exist');
    cy.get('[data-cy="global-stats-sync-bar"]').should('exist');
  });
});

// ---------------------------------------------------------------------------
// Scope filter — League and Season choose which stored ratings are read
// ---------------------------------------------------------------------------
describe('Global Stats — scope filter', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    mockScopeCatalogs();
  });

  it('choosing a League scopes the request', () => {
    mockRankings();
    visitRankings();
    cy.wait('@rankings');

    cy.get('[data-cy="global-stats-league-select"]').click();
    cy.get('[data-cy="global-stats-league-option-lyon"]').click();

    cy.wait('@rankings').then(({ request }) => {
      expect(request.query.scopeKind).to.eq('league');
      expect(request.query.scopeId).to.eq('lyon');
    });
    cy.url().should('include', 'league=lyon');
  });

  it('choosing a Season scopes the request and names it in the badge', () => {
    mockRankings();
    visitRankings();
    cy.wait('@rankings');

    cy.get('[data-cy="global-stats-season-select"]').click();
    cy.get('[data-cy="global-stats-season-option-lyon-2026"]').click();

    cy.wait('@rankings').then(({ request }) => {
      expect(request.query.scopeKind).to.eq('season');
      expect(request.query.scopeId).to.eq('lyon-2026');
    });
    cy.get('[data-cy="global-stats-scope-badge"]').should('contain.text', 'Ligue Lyon 2026');
  });

  it('an empty scope explains itself', () => {
    mockRankings([], { items: [], totalCount: 0 });
    visitRankings('/global-stats?league=lyon&season=lyon-2026');
    cy.wait('@rankings');

    cy.get('[data-cy="global-stats-no-results"]').should('contain.text', 'No player has a rating in this scope yet.');
    cy.get('[data-cy="global-stats-empty-standalone-hint"]').should('be.visible');
  });
});

// ---------------------------------------------------------------------------
// Home navigation
// ---------------------------------------------------------------------------
const SEED_MARKER = 'gones.e2e.storage-seeded';

function seedVisited(win) {
  win.localStorage.setItem('gones.first-visit.completed', 'true');
  win.localStorage.setItem(SEED_MARKER, 'true');
}

describe('Global Stats — home card', () => {
  // `/` is behind `firstVisitHomeGuard`, which sends a browser with no `gones.first-visit.completed`
  // key to /about — and `testIsolation` clears that key before every test. So the home card is only
  // reachable once the key is seeded. `onBeforeLoad` alone is not enough on the release stack: the
  // ngsw worker can answer the navigation from its own cache, and then the hook never fires. The
  // SEED_MARKER tells us whether it ran, so we can seed on the live window instead. The guard
  // evaluates at `canActivate`, not at bootstrap, so a seed only counts from the next navigation on.
  it('home page shows a Global Rankings card that navigates to /global-stats', () => {
    cy.visit('/', { onBeforeLoad: seedVisited });
    cy.window({ log: false }).then((win) => {
      if (win.localStorage.getItem(SEED_MARKER) !== 'true') seedVisited(win);
    });

    cy.visit('/');
    cy.location('pathname').should('eq', '/');
    cy.get('[data-cy="menu-global-stats-card"]').should('exist').click();
    cy.url().should('include', '/global-stats');
  });
});
