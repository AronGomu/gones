/**
 * Player Statistics grid layout.
 *
 * The row order used to be pinned by reading the component source with a regex, which proves
 * nothing about what the browser paints: an outer `grid-template-columns` rule once laid the three
 * row wrappers out side by side and every regex test still passed. These assertions read the
 * rendered DOM and its geometry instead.
 */

const PLAYER_PAYLOAD = {
  statistics: {
    position: 1, playerName: 'Alice', playedMatchCount: 20, matchWins: 15, matchLosses: 4, matchDraws: 1,
    matchWinrate: 0.75, playedGameCount: 45, gameWins: 32, gameLosses: 13, gameWinrate: 0.711,
    nemesis: { name: 'Bob', wins: 3, losses: 2 }, rival: { name: 'Carol', wins: 4, losses: 4 },
    mostPlayedArchetype: { name: 'Delver', matchCount: 18 }
  },
  matches: [{
    kind: 'match', leagueId: 'league-1', leagueName: 'League', tournamentId: 'tournament-1',
    tournamentName: 'Day 1', tournamentDate: '2026-03-05', roundIndex: 0, opponentName: 'Bob',
    ownScore: 2, opponentScore: 0, ownArchetype: 'Delver', opponentArchetype: 'Control'
  }],
  totalMatchCount: 1,
  truncated: false
};

const ROWS = [
  ['match-winrate', 'played-matches', 'match-wins', 'match-losses', 'match-draws'],
  ['game-winrate', 'played-games', 'game-wins', 'game-losses', 'match-draw-rate'],
  ['most-played-archetype', 'nemesis', 'rival']
];

/**
 * A computed colour comes back as `rgb(...)` when it fits sRGB and as `oklch(...)` when it does not,
 * so both sides are rasterised before they are compared instead of matching strings. These four are
 * the tones the component declares: green wins, red losses, yellow draws, page gold for the rest.
 */
const TONES = {
  win: 'oklch(80% 0.15 145)',
  loss: 'oklch(78% 0.14 25)',
  draw: 'oklch(91% 0.18 95)',
  neutral: 'oklch(86% 0.16 82)'
};

/** Rasterise a computed colour to sRGB channels, whatever syntax it was reported in. */
function rasterise(win, color) {
  const canvas = win.document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
}

function visitWith(statistics) {
  cy.intercept('GET', /\/api\/players\//, { ...PLAYER_PAYLOAD, statistics: { ...PLAYER_PAYLOAD.statistics, ...statistics } }).as('playerDetail');
  cy.visit('/players/Alice');
  cy.wait('@playerDetail');
}

/** `should` with a callback retries, so the tone is read after the payload has painted. */
function shouldHaveTone(cell, tone) {
  cy.window().then((win) => {
    const expected = rasterise(win, TONES[tone]);
    cy.get(`[data-cy="player-stat-value-${cell}"]`).should(($value) => {
      const color = getComputedStyle($value[0]).color;
      expect(rasterise(win, color), `${cell} is ${tone} (${color})`).to.deep.equal(expected);
    });
  });
}

/** Top edges of one row's cells, in DOM order. */
function cellTops(rowIndex) {
  return cy.get(`[data-cy="player-stat-row-${rowIndex + 1}"] .player-stat-cell`)
    .then(($cells) => [...$cells].map((cell) => Math.round(cell.getBoundingClientRect().top)));
}

describe('Player Statistics stat grid', () => {
  beforeEach(() => {
    cy.viewport(1280, 900);
    cy.clearLocalStorage();
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } });
    cy.intercept('GET', /\/api\/players\//, PLAYER_PAYLOAD).as('playerDetail');
    cy.visit('/players/Alice');
    cy.wait('@playerDetail');
  });

  it('renders three rows of 5, 5 and 3 cells in order', () => {
    cy.get('[data-cy="player-stat-grid"] > [data-cy^="player-stat-row-"]').should('have.length', 3);
    ROWS.forEach((expected, index) => {
      cy.get(`[data-cy="player-stat-row-${index + 1}"] .player-stat-cell`).then(($cells) => {
        expect([...$cells].map((cell) => cell.dataset.cy)).to.deep.equal(expected.map((name) => `player-stat-cell-${name}`));
      });
    });
  });

  it('paints each row on its own line', () => {
    const rowTops = [];
    ROWS.forEach((_, index) => {
      cellTops(index).then((tops) => {
        // Every cell of a row shares a top edge, so no row wraps or staggers.
        expect(new Set(tops).size, `row ${index + 1} tops`).to.eq(1);
        rowTops.push(tops[0]);
      });
    });
    cy.then(() => {
      expect(rowTops[0], 'row 1 above row 2').to.be.lessThan(rowTops[1]);
      expect(rowTops[1], 'row 2 above row 3').to.be.lessThan(rowTops[2]);
    });
  });

  it('gives the five-cell rows the full grid width', () => {
    cy.get('[data-cy="player-stat-grid"]').then(($grid) => {
      const gridWidth = $grid[0].getBoundingClientRect().width;
      cy.get('[data-cy="player-stat-row-1"]').then(($row) => {
        expect(Math.round($row[0].getBoundingClientRect().width)).to.eq(Math.round(gridWidth));
      });
    });
  });

  it('tones wins green, losses red and draws yellow', () => {
    shouldHaveTone('match-wins', 'win');
    shouldHaveTone('game-wins', 'win');
    shouldHaveTone('match-losses', 'loss');
    shouldHaveTone('game-losses', 'loss');
    shouldHaveTone('match-draws', 'draw');
  });

  it('leaves the played counts and the draw percentage on the page gold', () => {
    shouldHaveTone('played-matches', 'neutral');
    shouldHaveTone('played-games', 'neutral');
    shouldHaveTone('match-draw-rate', 'neutral');
  });
});

describe('Player Statistics winrate tone', () => {
  beforeEach(() => {
    cy.viewport(1280, 900);
    cy.clearLocalStorage();
    cy.intercept('POST', '**/api/auth/refresh', { statusCode: 401, body: { code: 'unauthorized', message: 'No session.' } });
  });

  it('paints a winrate above 50% green', () => {
    visitWith({ matchWinrate: 0.5001, gameWinrate: 0.9 });
    shouldHaveTone('match-winrate', 'win');
    shouldHaveTone('game-winrate', 'win');
  });

  it('paints a winrate below 50% red', () => {
    visitWith({ matchWinrate: 0.4999, gameWinrate: 0.1 });
    shouldHaveTone('match-winrate', 'loss');
    shouldHaveTone('game-winrate', 'loss');
  });

  it('paints an exactly even winrate yellow', () => {
    visitWith({ matchWinrate: 0.5, gameWinrate: 0.5 });
    cy.get('[data-cy="player-stat-value-match-winrate"]').should('have.text', '50.00%');
    shouldHaveTone('match-winrate', 'draw');
    shouldHaveTone('game-winrate', 'draw');
  });
});
