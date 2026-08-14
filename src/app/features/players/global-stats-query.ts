import { Params } from '@angular/router';

export const GLOBAL_STATS_PAGE_SIZES = [10, 25, 50, 100] as const;
export type GlobalStatsPageSize = (typeof GLOBAL_STATS_PAGE_SIZES)[number];

export const GLOBAL_STATS_SORTABLE_COLS = [
  'playedMatchCount',
  'matchWins',
  'matchLosses',
  'matchDraws',
  'matchWinrate',
  'playedGameCount',
  'gameWins',
  'gameLosses',
  'gameWinrate',
] as const;
export type GlobalStatsSortCol = (typeof GLOBAL_STATS_SORTABLE_COLS)[number];

export interface GlobalStatsQuery {
  page: number;
  size: GlobalStatsPageSize;
  search: string;
  sort?: GlobalStatsSortCol;
  direction?: 'asc' | 'desc';
}

/** Accepts both `URLSearchParams` (tests) and Angular `ParamMap` (router) — both expose `.get()`. */
export function parseGlobalStatsQuery(params: { get(key: string): string | null }): GlobalStatsQuery {
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const rawSize = Number(params.get('size') ?? 100);
  const size: GlobalStatsPageSize = (GLOBAL_STATS_PAGE_SIZES as readonly number[]).includes(rawSize)
    ? (rawSize as GlobalStatsPageSize)
    : 100;

  const search = (params.get('search') ?? '').trim();

  const rawSort = params.get('sort') ?? undefined;
  const sort: GlobalStatsSortCol | undefined = rawSort !== undefined && (GLOBAL_STATS_SORTABLE_COLS as readonly string[]).includes(rawSort)
    ? (rawSort as GlobalStatsSortCol)
    : undefined;

  const rawDir = params.get('direction') ?? undefined;
  const direction: 'asc' | 'desc' | undefined = rawDir === 'asc' || rawDir === 'desc' ? rawDir : undefined;

  return { page, size, search, sort, direction };
}

/**
 * Produces the new query after clicking a sortable column header.
 * - New column → desc, page 1.
 * - Same column → toggle direction, page 1.
 */
export function toggleGlobalStatsSort(query: GlobalStatsQuery, col: GlobalStatsSortCol): GlobalStatsQuery {
  const same = query.sort === col;
  const direction: 'asc' | 'desc' = same && query.direction === 'desc' ? 'asc' : 'desc';
  return { ...query, sort: col, direction, page: 1 };
}

/**
 * Serialises a `GlobalStatsQuery` to Angular router query params.
 * Omits defaults (page=1, size=100, empty search, no sort/direction) to keep URLs clean.
 */
export function globalStatsQueryParams(query: GlobalStatsQuery): Params {
  const params: Params = {};
  if (query.page !== 1) params['page'] = query.page;
  if (query.size !== 100) params['size'] = query.size;
  if (query.search) params['search'] = query.search;
  if (query.sort) params['sort'] = query.sort;
  if (query.direction) params['direction'] = query.direction;
  return params;
}
