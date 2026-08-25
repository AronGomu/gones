import { describe, expect, it } from 'vitest';
import { ArchiveGlobalPlayerStatisticsRow } from '../../api/generated/gones-api';
import {
  GLOBAL_STATS_PAGE_SIZES,
  GLOBAL_STATS_GATED_SORT_COLS,
  GLOBAL_STATS_SCOPE_ALL,
  GLOBAL_STATS_SORTABLE_COLS,
  globalStatsPageWindow,
  globalStatsScopeName,
  parseGlobalStatsQuery,
  resolveGlobalStatsScope,
  scopeSeasonOptions,
  selectScopeLeague,
  selectScopeSeason,
  sortGlobalStatsRows,
  toggleGlobalStatsSort,
  globalStatsQueryParams,
  type GlobalStatsQuery,
} from './global-stats-query';

const LEAGUES = [{ id: 'L1', name: 'Ligue Lyon' }, { id: 'L2', name: 'Circuit Rhône-Alpes' }];
const SEASONS = [
  { id: 'S1', name: 'Ligue Lyon 2026', leagueId: 'L1' },
  { id: 'S2', name: 'Ligue Lyon 2025', leagueId: 'L1' },
  { id: 'S9', name: 'Circuit 2026', leagueId: 'L2' },
];
const BASE_QUERY: GlobalStatsQuery = { page: 1, size: 100, search: '', league: 'all', season: 'all' };

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
      // Every gated column needs its gate open before it parses; see the decayedRating cases below.
      expect(parseGlobalStatsQuery(new URLSearchParams(`sort=${col}`), { decayedRating: true }).sort).toBe(col);
    }
  });

  it('drops a gated sort column when the gate is shut', () => {
    for (const col of GLOBAL_STATS_GATED_SORT_COLS) {
      expect(parseGlobalStatsQuery(new URLSearchParams(`sort=${col}`)).sort).toBeUndefined();
    }
  });

  it('drops invalid direction values', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('dir=up')).direction).toBeUndefined();
    expect(parseGlobalStatsQuery(new URLSearchParams('dir=DESC')).direction).toBeUndefined();
  });

  it('accepts asc and desc direction', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('dir=asc')).direction).toBe('asc');
    expect(parseGlobalStatsQuery(new URLSearchParams('dir=desc')).direction).toBe('desc');
  });

  it('trims whitespace from search', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('search=  alice  ')).search).toBe('alice');
  });
});

// ---------------------------------------------------------------------------
// Toggle sort
// ---------------------------------------------------------------------------
describe('toggleGlobalStatsSort', () => {
  const base: GlobalStatsQuery = { ...BASE_QUERY, page: 3, size: 25, search: 'foo' };

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
    const params = globalStatsQueryParams(BASE_QUERY);
    expect(Object.prototype.hasOwnProperty.call(params, 'page')).toBe(false);
  });

  it('omits size=100 from params', () => {
    const params = globalStatsQueryParams(BASE_QUERY);
    expect(Object.prototype.hasOwnProperty.call(params, 'size')).toBe(false);
  });

  it('omits empty search from params', () => {
    const params = globalStatsQueryParams(BASE_QUERY);
    expect(Object.prototype.hasOwnProperty.call(params, 'search')).toBe(false);
  });

  it('includes non-default values', () => {
    const params = globalStatsQueryParams({ ...BASE_QUERY, page: 3, size: 25, search: 'alice', sort: 'matchWins', direction: 'asc' });
    expect(params['page']).toBe(3);
    expect(params['size']).toBe(25);
    expect(params['search']).toBe('alice');
    expect(params['sort']).toBe('matchWins');
    expect(params['dir']).toBe('asc');
  });

  it('round-trips a full query', () => {
    const original: GlobalStatsQuery = { ...BASE_QUERY, page: 2, size: 50, search: 'bob', sort: 'gameWinrate', direction: 'asc', league: 'L1', season: 'S1' };
    const params = globalStatsQueryParams(original);
    const qs = new URLSearchParams(params as Record<string, string>);
    const parsed = parseGlobalStatsQuery(qs);
    expect(parsed).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Scope — the League / Season filter the rankings are read for
// ---------------------------------------------------------------------------
describe('global stats scope', () => {
  it('parseGlobalStatsQuery reads league and season', () => {
    const q = parseGlobalStatsQuery(new URLSearchParams('league=L1&season=S1'));
    expect(q.league).toBe('L1');
    expect(q.season).toBe('S1');
  });

  it('parseGlobalStatsQuery defaults both scope levels to all', () => {
    const q = parseGlobalStatsQuery(new URLSearchParams(''));
    expect(q.league).toBe('all');
    expect(q.season).toBe('all');
  });

  it('parseGlobalStatsQuery treats a blank scope as all', () => {
    const q = parseGlobalStatsQuery(new URLSearchParams('league=%20&season='));
    expect(q.league).toBe('all');
    expect(q.season).toBe('all');
  });

  it('parseGlobalStatsQuery reads the direction from dir', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('dir=asc')).direction).toBe('asc');
  });

  /** D2: the URL key is `dir`; `direction` is the wire name and is not read back from the browser. */
  it('parseGlobalStatsQuery ignores the legacy direction key', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('direction=asc')).direction).toBeUndefined();
  });

  it('parseGlobalStatsQuery keeps the page size default at 100', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('')).size).toBe(100);
  });

  it('globalStatsQueryParams omits an unnarrowed scope', () => {
    const params = globalStatsQueryParams(BASE_QUERY);
    expect(Object.prototype.hasOwnProperty.call(params, 'league')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(params, 'season')).toBe(false);
  });

  it('globalStatsQueryParams writes both scope levels when narrowed', () => {
    const params = globalStatsQueryParams({ ...BASE_QUERY, league: 'L1', season: 'S1' });
    expect(params['league']).toBe('L1');
    expect(params['season']).toBe('S1');
  });

  it('globalStatsQueryParams writes dir and never direction', () => {
    const params = globalStatsQueryParams({ ...BASE_QUERY, direction: 'desc' });
    expect(params['dir']).toBe('desc');
    expect(params['direction']).toBeUndefined();
  });

  it('resolveGlobalStatsScope maps all and all to the global scope', () => {
    expect(resolveGlobalStatsScope({ league: 'all', season: 'all' })).toEqual({ kind: 'global', id: '' });
  });

  it('resolveGlobalStatsScope maps a league alone to the league scope', () => {
    expect(resolveGlobalStatsScope({ league: 'L1', season: 'all' })).toEqual({ kind: 'league', id: 'L1' });
  });

  /** A Season is the narrower scope, and the narrower scope is the one the server is asked for. */
  it('resolveGlobalStatsScope prefers the season over its league', () => {
    expect(resolveGlobalStatsScope({ league: 'L1', season: 'S1' })).toEqual({ kind: 'season', id: 'S1' });
  });

  it('scopeSeasonOptions offers every season while the league is all', () => {
    expect(scopeSeasonOptions(SEASONS, GLOBAL_STATS_SCOPE_ALL)).toHaveLength(3);
  });

  it('scopeSeasonOptions narrows to the chosen league', () => {
    expect(scopeSeasonOptions(SEASONS, 'L1').map((season) => season.id)).toEqual(['S1', 'S2']);
  });

  it('selectScopeLeague drops a season the league does not own', () => {
    const next = selectScopeLeague({ ...BASE_QUERY, season: 'S9', page: 4 }, 'L1', SEASONS);
    expect(next.league).toBe('L1');
    expect(next.season).toBe('all');
    expect(next.page).toBe(1);
  });

  it('selectScopeLeague keeps a season the league owns', () => {
    const next = selectScopeLeague({ ...BASE_QUERY, season: 'S1' }, 'L1', SEASONS);
    expect(next.season).toBe('S1');
    expect(next.league).toBe('L1');
    expect(next.page).toBe(1);
  });

  /** D3: without the pin the badge could name a Season while the League select still read "All". */
  it('selectScopeSeason pins the owning league', () => {
    const next = selectScopeSeason({ ...BASE_QUERY, page: 3 }, 'S1', SEASONS);
    expect(next.league).toBe('L1');
    expect(next.season).toBe('S1');
    expect(next.page).toBe(1);
  });

  it('selectScopeSeason clearing back to all keeps the league', () => {
    const next = selectScopeSeason({ ...BASE_QUERY, league: 'L1', season: 'S1' }, 'all', SEASONS);
    expect(next.league).toBe('L1');
    expect(next.season).toBe('all');
    expect(next.page).toBe(1);
  });

  it('globalStatsScopeName resolves a season name', () => {
    expect(globalStatsScopeName({ kind: 'season', id: 'S1' }, { leagues: LEAGUES, seasons: SEASONS })).toBe('Ligue Lyon 2026');
  });

  it('globalStatsScopeName returns undefined for an unknown id', () => {
    expect(globalStatsScopeName({ kind: 'league', id: 'nope' }, { leagues: LEAGUES, seasons: SEASONS })).toBeUndefined();
  });

  it('globalStatsScopeName returns undefined for the global scope', () => {
    expect(globalStatsScopeName({ kind: 'global', id: '' }, { leagues: LEAGUES, seasons: SEASONS })).toBeUndefined();
  });

  it('toggleGlobalStatsSort keeps the scope', () => {
    const next = toggleGlobalStatsSort({ ...BASE_QUERY, league: 'L1', season: 'S1' }, 'rating');
    expect(next.league).toBe('L1');
    expect(next.season).toBe('S1');
    expect(next.page).toBe(1);
    expect(next.direction).toBe('desc');
  });
});

// ---------------------------------------------------------------------------
// Ordering — the client-side catalog must rank exactly as the paged endpoint does
// ---------------------------------------------------------------------------

function row(playerName: string, overrides: Partial<ArchiveGlobalPlayerStatisticsRow> = {}): ArchiveGlobalPlayerStatisticsRow {
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

const names = (rows: readonly ArchiveGlobalPlayerStatisticsRow[]): string[] => rows.map((item) => item.playerName);

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

  /** With no `?sort=` the endpoint uses the three-bucket partition: active → inactive → provisional. */
  it('applies the documented default ordering when no sort is selected', () => {
    const rows = [
      row('Abe', { provisional: false, inactive: false, rating: 1400 }),
      row('Ana', { provisional: false, inactive: false, rating: 1600 }),
      row('Bo', { provisional: false, inactive: false, rating: 2000 }),
      row('Cy', { provisional: false, inactive: false, rating: 1800 }),
      row('Dee', { provisional: false, inactive: false, rating: 1600 }),
    ];
    // bucket 0 (active): rating desc, name ASC for ties (Ana < Dee)
    expect(names(sortGlobalStatsRows(rows))).toEqual(['Bo', 'Cy', 'Ana', 'Dee', 'Abe']);
  });

  // Three-bucket default order (T16)
  it('default order puts active ranked players first', () => {
    const rows = [
      row('Provisional', { provisional: true, inactive: false, rating: 2000 }),
      row('Active', { provisional: false, inactive: false, rating: 1600 }),
      row('Inactive', { provisional: false, inactive: true, rating: 1800 }),
    ];
    expect(names(sortGlobalStatsRows(rows))[0]).toBe('Active');
  });

  it('default order puts inactive ranked players after active ones', () => {
    const rows = [
      row('Inactive', { provisional: false, inactive: true, rating: 2000 }),
      row('Active', { provisional: false, inactive: false, rating: 1600 }),
    ];
    expect(names(sortGlobalStatsRows(rows))).toEqual(['Active', 'Inactive']);
  });

  it('default order puts provisional players last', () => {
    const rows = [
      row('Provisional', { provisional: true, inactive: false, rating: 2100 }),
      row('Inactive', { provisional: false, inactive: true, rating: 1500 }),
      row('Active', { provisional: false, inactive: false, rating: 1600 }),
    ];
    expect(names(sortGlobalStatsRows(rows))).toEqual(['Active', 'Inactive', 'Provisional']);
  });

  it('default order sorts provisional by tournaments then matches', () => {
    const rows = [
      row('Few', { provisional: true, tournamentsPlayed: 2, playedMatchCount: 10 }),
      row('Many', { provisional: true, tournamentsPlayed: 2, playedMatchCount: 20 }),
      row('Most', { provisional: true, tournamentsPlayed: 4, playedMatchCount: 5 }),
    ];
    expect(names(sortGlobalStatsRows(rows))).toEqual(['Most', 'Many', 'Few']);
  });

  it('default order breaks ties on the ordinal name', () => {
    const rows = [
      row('alice', { provisional: false, inactive: false, rating: 1500 }),
      row('Alice', { provisional: false, inactive: false, rating: 1500 }),
    ];
    // 'A' < 'a' in code-unit order
    expect(names(sortGlobalStatsRows(rows))).toEqual(['Alice', 'alice']);
  });

  it('rating is a sortable column', () => {
    const rows = [
      row('Low', { rating: 1200, provisional: false, inactive: false }),
      row('High', { rating: 1800, provisional: false, inactive: false }),
      row('Mid', { rating: 1500, provisional: false, inactive: false }),
    ];
    expect(names(sortGlobalStatsRows(rows, 'rating', 'asc'))).toEqual(['Low', 'Mid', 'High']);
    expect(names(sortGlobalStatsRows(rows, 'rating', 'desc'))).toEqual(['High', 'Mid', 'Low']);
  });

  /**
   * Clicking Rating must not lift an unranked newcomer over the ranked table: the provisional bucket
   * stays last whichever direction is asked for, exactly as `PublicLeagueEndpoints.GlobalSortByRating`
   * orders it.
   */
  it('keeps provisional players last on a rating sort in both directions', () => {
    const rows = [
      row('Newcomer', { provisional: true, rating: 2100 }),
      row('Low', { rating: 1200, provisional: false, inactive: false }),
      row('High', { rating: 1800, provisional: false, inactive: false }),
    ];
    expect(names(sortGlobalStatsRows(rows, 'rating', 'desc'))).toEqual(['High', 'Low', 'Newcomer']);
    expect(names(sortGlobalStatsRows(rows, 'rating', 'asc'))).toEqual(['Low', 'High', 'Newcomer']);
  });

  it('orders the provisional block by the rating that was asked for', () => {
    const rows = [
      row('ProvLow', { provisional: true, rating: 1300 }),
      row('ProvHigh', { provisional: true, rating: 1700 }),
      row('Ranked', { rating: 1400, provisional: false, inactive: false }),
    ];
    expect(names(sortGlobalStatsRows(rows, 'rating', 'desc'))).toEqual(['Ranked', 'ProvHigh', 'ProvLow']);
    expect(names(sortGlobalStatsRows(rows, 'rating', 'asc'))).toEqual(['Ranked', 'ProvLow', 'ProvHigh']);
  });

  /** Only the provisional bucket is pinned: an idle ranked player still sorts on the rating itself. */
  it('leaves inactive ranked players inside the rating order', () => {
    const rows = [
      row('Idle', { rating: 2000, provisional: false, inactive: true }),
      row('Playing', { rating: 1600, provisional: false, inactive: false }),
    ];
    expect(names(sortGlobalStatsRows(rows, 'rating', 'desc'))).toEqual(['Idle', 'Playing']);
  });

  it('keeps provisional players last on a decayed rating sort too', () => {
    const rows = [
      row('Newcomer', { provisional: true, decayedRating: 2100 }),
      row('Ranked', { decayedRating: 1400, provisional: false, inactive: false }),
    ];
    expect(names(sortGlobalStatsRows(rows, 'decayedRating', 'desc'))).toEqual(['Ranked', 'Newcomer']);
  });

  /** The pin is a rating rule: every other column still orders on the value alone. */
  it('does not pin provisional players on a non-rating sort', () => {
    const rows = [
      row('Newcomer', { provisional: true, matchWins: 9 }),
      row('Ranked', { matchWins: 2, provisional: false, inactive: false }),
    ];
    expect(names(sortGlobalStatsRows(rows, 'matchWins', 'desc'))).toEqual(['Newcomer', 'Ranked']);
  });

  it('tournamentsPlayed is a sortable column', () => {
    const rows = [
      row('Few', { tournamentsPlayed: 2 }),
      row('Many', { tournamentsPlayed: 8 }),
      row('None', { tournamentsPlayed: 0 }),
    ];
    expect(names(sortGlobalStatsRows(rows, 'tournamentsPlayed', 'desc'))).toEqual(['Many', 'Few', 'None']);
  });

  it('leaves the input array untouched', () => {
    const rows = [row('Zoe', { matchWins: 1 }), row('Ana', { matchWins: 2 })];

    sortGlobalStatsRows(rows, 'matchWins', 'desc');

    expect(names(rows)).toEqual(['Zoe', 'Ana']);
  });

  it('game statistics still sortable via ?sort=gameWins param (Assumption 8 guard)', () => {
    const rows = [
      row('Player1', { gameWins: 3 }),
      row('Player2', { gameWins: 7 }),
      row('Player3', { gameWins: 5 }),
    ];
    expect(names(sortGlobalStatsRows(rows, 'gameWins', 'desc'))).toEqual(['Player2', 'Player3', 'Player1']);
  });

  it('decayedRating is a sortable column only when the server exposes it', () => {
    // The server answers 400 for ?sort=decayedRating while Gones:PlayerStatistics:ExposeDecayedRating
    // is off, so the client must not select an ordering neither surface can serve.
    expect(parseGlobalStatsQuery(new URLSearchParams('sort=decayedRating'), { decayedRating: true }).sort)
      .toBe('decayedRating');
    expect(parseGlobalStatsQuery(new URLSearchParams('sort=decayedRating'), { decayedRating: false }).sort)
      .toBeUndefined();
    expect(parseGlobalStatsQuery(new URLSearchParams('sort=decayedRating')).sort).toBeUndefined();
  });

  it('the gate never touches an ungated column', () => {
    expect(parseGlobalStatsQuery(new URLSearchParams('sort=rating')).sort).toBe('rating');
    expect(parseGlobalStatsQuery(new URLSearchParams('sort=matchWins'), { decayedRating: false }).sort).toBe('matchWins');
  });

  it('a null decayed rating sorts last in both directions', () => {
    const rows = [
      row('Ana', { decayedRating: undefined }),
      row('Bo', { decayedRating: 1600 }),
      row('Cy', { decayedRating: 1400 }),
    ];
    expect(names(sortGlobalStatsRows(rows, 'decayedRating', 'asc'))).toEqual(['Cy', 'Bo', 'Ana']);
    expect(names(sortGlobalStatsRows(rows, 'decayedRating', 'desc'))).toEqual(['Bo', 'Cy', 'Ana']);
  });
});

// ---------------------------------------------------------------------------
// Page window
// ---------------------------------------------------------------------------
describe('globalStatsPageWindow', () => {
  it('lists every page when there is no run to elide', () => {
    expect(globalStatsPageWindow(1, 1)).toEqual([1]);
    expect(globalStatsPageWindow(2, 4)).toEqual([1, 2, 3, 4]);
    expect(globalStatsPageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('elides the run between the first page and the current neighbourhood', () => {
    expect(globalStatsPageWindow(9, 20)).toEqual([1, 'gap', 8, 9, 10, 'gap', 20]);
  });

  it('keeps the edges adjacent rather than printing a gap over one page', () => {
    expect(globalStatsPageWindow(3, 20)).toEqual([1, 2, 3, 4, 'gap', 20]);
    expect(globalStatsPageWindow(18, 20)).toEqual([1, 'gap', 17, 18, 19, 20]);
  });

  it('never repeats the first or the last page', () => {
    expect(globalStatsPageWindow(1, 20)).toEqual([1, 2, 'gap', 20]);
    expect(globalStatsPageWindow(20, 20)).toEqual([1, 'gap', 19, 20]);
  });

  it('clamps a page outside the range', () => {
    expect(globalStatsPageWindow(0, 3)).toEqual([1, 2, 3]);
    expect(globalStatsPageWindow(99, 3)).toEqual([1, 2, 3]);
  });
});
