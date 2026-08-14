import { describe, expect, it } from 'vitest';
import {
  GLOBAL_STATS_PAGE_SIZES,
  GLOBAL_STATS_SORTABLE_COLS,
  parseGlobalStatsQuery,
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
