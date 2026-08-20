import { describe, expect, it } from 'vitest';
import { GlobalPlayerStatisticsRow } from '../../api/generated/gones-api';
import {
  GLOBAL_STATS_PAGE_SIZES,
  GLOBAL_STATS_SORTABLE_COLS,
  parseGlobalStatsQuery,
  sortGlobalStatsRows,
  toggleGlobalStatsSort,
  globalStatsQueryParams,
  type GlobalStatsQuery,
} from './global-stats-query';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
describe('parseGlobalStatsQuery — defaults', () => {
  it('returns page 1, size 100, empty search, no sort or direction for empty params', () => {
    const q = parseGlobalStatsQuery(new URLSearchParams());
    expect(q.page).toBe(1);
    expect(q.size).toBe(100);
    expect(q.search).toBe('');
    expect(q.sort).toBeUndefined();
    expect(q.direction).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------
describe('parseGlobalStatsQuery — sanitization', () => {
  it('clamps bad page values to 1', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('page=0')).page).toBe(1);
    expect(parseGlobalStatsQuery(new URLSearchParams('page=-1')).page).toBe(1);
    expect(parseGlobalStatsQuery(new URLSearchParams('page=abc')).page).toBe(1);
    expect(parseGlobalStatsQuery(new URLSearchParams('page=1.5')).page).toBe(1);
  });

  it('resets unknown page-size values to 100', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('size=20')).size).toBe(100);
    expect(parseGlobalStatsQuery(new URLSearchParams('size=0')).size).toBe(100);
    expect(parseGlobalStatsQuery(new URLSearchParams('size=abc')).size).toBe(100);
  });

  it('accepts only valid page sizes', () => {
    for (const s of GLOBAL_STATS_PAGE_SIZES) {
      expect(parseGlobalStatsQuery(new URLSearchParams(`size=${s}`)).size).toBe(s);
    }
  });

  it('drops unknown sort columns', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('sort=unknownCol')).sort).toBeUndefined();
    expect(parseGlobalStatsQuery(new URLSearchParams('sort=position')).sort).toBeUndefined();
    expect(parseGlobalStatsQuery(new URLSearchParams('sort=playerName')).sort).toBeUndefined();
  });

  it('accepts valid sortable columns', () => {
    for (const col of GLOBAL_STATS_SORTABLE_COLS) {
      expect(parseGlobalStatsQuery(new URLSearchParams(`sort=${col}`)).sort).toBe(col);
    }
  });

  it('drops invalid direction values', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('direction=up')).direction).toBeUndefined();
    expect(parseGlobalStatsQuery(new URLSearchParams('direction=DESC')).direction).toBeUndefined();
  });

  it('accepts asc and desc direction', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('direction=asc')).direction).toBe('asc');
    expect(parseGlobalStatsQuery(new URLSearchParams('direction=desc')).direction).toBe('desc');
  });

  it('trims whitespace from search', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('search=  alice  ')).search).toBe('alice');
  });
});

// ---------------------------------------------------------------------------
// Toggle sort
// ---------------------------------------------------------------------------
describe('toggleGlobalStatsSort', () => {
  const base: GlobalStatsQuery = { page: 3, size: 25, search: 'foo' };

  it('clicking a new column sets it desc and resets page to 1', () => {
    const q = toggleGlobalStatsSort(base, 'matchWins');
    expect(q.sort).toBe('matchWins');
    expect(q.direction).toBe('desc');
    expect(q.page).toBe(1);
  });

  it('clicking the same column when desc switches to asc', () => {
    const q = toggleGlobalStatsSort({ ...base, sort: 'matchWins', direction: 'desc' }, 'matchWins');
    expect(q.sort).toBe('matchWins');
    expect(q.direction).toBe('asc');
    expect(q.page).toBe(1);
  });

  it('clicking the same column when asc switches to desc', () => {
    const q = toggleGlobalStatsSort({ ...base, sort: 'matchWins', direction: 'asc' }, 'matchWins');
    expect(q.sort).toBe('matchWins');
    expect(q.direction).toBe('desc');
    expect(q.page).toBe(1);
  });

  it('preserves search and size on toggle', () => {
    const q = toggleGlobalStatsSort(base, 'matchWins');
    expect(q.search).toBe('foo');
    expect(q.size).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Round-trip — globalStatsQueryParams → parseGlobalStatsQuery
// ---------------------------------------------------------------------------
describe('globalStatsQueryParams round-trip', () => {
  it('omits page=1 from params', () => {
    const params = globalStatsQueryParams({ page: 1, size: 100, search: '' });
    expect(Object.prototype.hasOwnProperty.call(params, 'page')).toBe(false);
  });

  it('omits size=100 from params', () => {
    const params = globalStatsQueryParams({ page: 1, size: 100, search: '' });
    expect(Object.prototype.hasOwnProperty.call(params, 'size')).toBe(false);
  });

  it('omits empty search from params', () => {
    const params = globalStatsQueryParams({ page: 1, size: 100, search: '' });
    expect(Object.prototype.hasOwnProperty.call(params, 'search')).toBe(false);
  });

  it('includes non-default values', () => {
    const params = globalStatsQueryParams({ page: 3, size: 25, search: 'alice', sort: 'matchWins', direction: 'asc' });
    expect(params['page']).toBe(3);
    expect(params['size']).toBe(25);
    expect(params['search']).toBe('alice');
    expect(params['sort']).toBe('matchWins');
    expect(params['direction']).toBe('asc');
  });

  it('round-trips a full query', () => {
    const original: GlobalStatsQuery = { page: 2, size: 50, search: 'bob', sort: 'gameWinrate', direction: 'asc' };
    const params = globalStatsQueryParams(original);
    const qs = new URLSearchParams(params as Record<string, string>);
    const parsed = parseGlobalStatsQuery(qs);
    expect(parsed).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Ordering — the client-side catalog must rank exactly as the paged endpoint does
// ---------------------------------------------------------------------------

function row(playerName: string, overrides: Partial<GlobalPlayerStatisticsRow> = {}): GlobalPlayerStatisticsRow {
  return {
    position: 0, playerName, playedMatchCount: 0, matchWins: 0, matchLosses: 0, matchDraws: 0,
    matchWinrate: 0, playedGameCount: 0, gameWins: 0, gameLosses: 0, gameWinrate: 0,
    nemesis: undefined, rival: undefined, mostPlayedArchetype: undefined,
    rating: 1500, ratingDeviation: 350, previousRating: 1500, lastRatingDelta: 0,
    tournamentsPlayed: 0, lastPlayedDate: undefined, provisional: true, inactive: false,
    decayedRating: undefined,
    ...overrides
  };
}

const names = (rows: readonly GlobalPlayerStatisticsRow[]): string[] => rows.map((item) => item.playerName);

describe('sortGlobalStatsRows', () => {
  /**
   * `PublicLeagueEndpoints.OrderGlobalStats` puts a null winrate last in **both** directions. A
   * comparator that coerces null to 0 and then negates for `desc` hands ascending order to the very
   * players the server ranks last — and a 0–0 draw makes a null `gameWinrate` reachable.
   */
  it('ranks a missing winrate last whichever direction is asked for', () => {
    const rows = [
      row('Ana', { gameWinrate: undefined }),
      row('Bo', { gameWinrate: 0.25 }),
      row('Cy', { gameWinrate: 0.75 })
    ];

    expect(names(sortGlobalStatsRows(rows, 'gameWinrate', 'asc'))).toEqual(['Bo', 'Cy', 'Ana']);
    expect(names(sortGlobalStatsRows(rows, 'gameWinrate', 'desc'))).toEqual(['Cy', 'Bo', 'Ana']);
  });

  /** The name tiebreak is always ascending on the server; negating it with the value reversed it. */
  it('tiebreaks equal values by name ascending in both directions', () => {
    const rows = [row('Zoe', { matchWins: 4 }), row('Ana', { matchWins: 4 }), row('Mel', { matchWins: 4 })];

    expect(names(sortGlobalStatsRows(rows, 'matchWins', 'desc'))).toEqual(['Ana', 'Mel', 'Zoe']);
    expect(names(sortGlobalStatsRows(rows, 'matchWins', 'asc'))).toEqual(['Ana', 'Mel', 'Zoe']);
  });

  /** Ordinal, not the browser locale: Player Names are exact and case-sensitive (ADR 0040). */
  it('tiebreaks names by code unit, not by locale collation', () => {
    const rows = [row('a', { matchWins: 1 }), row('B', { matchWins: 1 })];

    expect(names(sortGlobalStatsRows(rows, 'matchWins', 'desc'))).toEqual(['B', 'a']);
  });

  /** With no `?sort=` the endpoint documents `matchWins DESC, gameWins DESC, matchDraws DESC, name ASC`. */
  it('applies the documented default ordering when no sort is selected', () => {
    const rows = [
      row('Ana', { matchWins: 2, gameWins: 4, matchDraws: 0 }),
      row('Bo', { matchWins: 3, gameWins: 6, matchDraws: 1 }),
      row('Cy', { matchWins: 2, gameWins: 5, matchDraws: 0 }),
      row('Dee', { matchWins: 2, gameWins: 4, matchDraws: 2 }),
      row('Abe', { matchWins: 2, gameWins: 4, matchDraws: 0 })
    ];

    expect(names(sortGlobalStatsRows(rows))).toEqual(['Bo', 'Cy', 'Dee', 'Abe', 'Ana']);
  });

  it('leaves the input array untouched', () => {
    const rows = [row('Zoe', { matchWins: 1 }), row('Ana', { matchWins: 2 })];

    sortGlobalStatsRows(rows, 'matchWins', 'desc');

    expect(names(rows)).toEqual(['Zoe', 'Ana']);
  });

  it('game statistics still break ties in the default order (Assumption 8 guard)', () => {
    const rows = [
      row('Player1', { matchWins: 5, gameWins: 3 }),
      row('Player2', { matchWins: 5, gameWins: 7 }),
    ];
    expect(names(sortGlobalStatsRows(rows))).toEqual(['Player2', 'Player1']);
  });

  it('game statistics still sortable via ?sort=gameWins param (Assumption 8 guard)', () => {
    const rows = [
      row('Player1', { gameWins: 3 }),
      row('Player2', { gameWins: 7 }),
      row('Player3', { gameWins: 5 }),
    ];
    expect(names(sortGlobalStatsRows(rows, 'gameWins', 'desc'))).toEqual(['Player2', 'Player3', 'Player1']);
  });
});
