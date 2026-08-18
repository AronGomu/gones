import { Params } from '@angular/router';
import { GlobalPlayerStatisticsRow } from '../../api/generated/gones-api';

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

/** The two columns a player can legitimately have no value for — a winrate over zero played rows. */
const GLOBAL_STATS_NULLABLE_COLS: readonly GlobalStatsSortCol[] = ['matchWinrate', 'gameWinrate'];

/**
 * The ranking order the paged endpoint serves, reproduced for the client-side catalog so the two
 * Player Statistics surfaces never disagree on who is at position 1.
 *
 * Three details are copied deliberately from `PublicLeagueEndpoints.OrderGlobalStats`:
 * a missing winrate sorts **last in both directions** (so the null test is applied before the
 * direction, never flipped by it), the Player Name tiebreak is always ascending and **ordinal**
 * (Player Names are exact and case-sensitive under ADR 0040, not browser-locale collated), and no
 * requested sort means `matchWins DESC, gameWins DESC, matchDraws DESC, playerName ASC` rather than
 * whatever order the catalog happened to arrive in.
 */
export function sortGlobalStatsRows<T extends GlobalPlayerStatisticsRow>(
  rows: readonly T[],
  sort?: GlobalStatsSortCol,
  direction: 'asc' | 'desc' = 'desc'
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  const sorted = [...rows];
  if (!sort) {
    return sorted.sort((left, right) =>
      compareValues(right.matchWins, left.matchWins)
      || compareValues(right.gameWins, left.gameWins)
      || compareValues(right.matchDraws, left.matchDraws)
      || compareOrdinal(left.playerName, right.playerName));
  }
  const nullable = GLOBAL_STATS_NULLABLE_COLS.includes(sort);
  return sorted.sort((left, right) => {
    const leftValue = left[sort] as number | null | undefined;
    const rightValue = right[sort] as number | null | undefined;
    if (nullable) {
      const missing = compareValues(Number(leftValue == null), Number(rightValue == null));
      if (missing) return missing;
    }
    return sign * compareValues(leftValue ?? 0, rightValue ?? 0) || compareOrdinal(left.playerName, right.playerName);
  });
}

function compareValues(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Code-unit order, which is what the `C` collation the endpoint asks Postgres for produces. */
function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
