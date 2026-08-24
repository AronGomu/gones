import { Params } from '@angular/router';
import { GlobalPlayerStatisticsRow } from '../../api/generated/gones-api';

export const GLOBAL_STATS_PAGE_SIZES = [10, 25, 50, 100] as const;
export type GlobalStatsPageSize = (typeof GLOBAL_STATS_PAGE_SIZES)[number];

export const GLOBAL_STATS_SORTABLE_COLS = [
  'rating',
  'decayedRating',
  'tournamentsPlayed',
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

/**
 * Columns the server only sorts when a configuration key says so. `decayedRating` is answered `400` by
 * `PublicLeagueEndpoints.GetGlobalPlayerStatisticsAsync` unless
 * `Gones:PlayerStatistics:ExposeDecayedRating` is on, and the column is absent from the rows when it is
 * off, so accepting it unconditionally let the client select an ordering neither surface can serve.
 */
export const GLOBAL_STATS_GATED_SORT_COLS: readonly GlobalStatsSortCol[] = ['decayedRating'];

/** Which gated columns the caller has evidence the server is exposing. */
export interface GlobalStatsSortGate {
  decayedRating?: boolean;
}

/** The sentinel both scope levels use for "not narrowed". Never a document id. */
export const GLOBAL_STATS_SCOPE_ALL = 'all';

export type GlobalStatsScopeKind = 'global' | 'league' | 'season';

export interface GlobalStatsScopeSelection {
  kind: GlobalStatsScopeKind;
  /** `''` exactly when `kind === 'global'`; otherwise the League or LeagueSeason document id. */
  id: string;
}

/** Minimal shapes these helpers need, so they stay usable from a test without a wire type. */
export interface GlobalStatsLeagueOption { id: string; name: string; }
export interface GlobalStatsSeasonOption { id: string; name: string; leagueId: string; }

export interface GlobalStatsQuery {
  page: number;
  size: GlobalStatsPageSize;
  search: string;
  sort?: GlobalStatsSortCol;
  direction?: 'asc' | 'desc';
  /** `'all'` or a League document id. */
  league: string;
  /** `'all'` or a LeagueSeason document id. */
  season: string;
}

/**
 * Accepts both `URLSearchParams` (tests) and Angular `ParamMap` (router) — both expose `.get()`.
 *
 * `gate` mirrors the server's own allowlist: a gated column is dropped, exactly as an unknown one is,
 * unless the caller says the server is exposing it.
 */
export function parseGlobalStatsQuery(
  params: { get(key: string): string | null },
  gate: GlobalStatsSortGate = {}
): GlobalStatsQuery {
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const rawSize = Number(params.get('size') ?? 100);
  const size: GlobalStatsPageSize = (GLOBAL_STATS_PAGE_SIZES as readonly number[]).includes(rawSize)
    ? (rawSize as GlobalStatsPageSize)
    : 100;

  const search = (params.get('search') ?? '').trim();

  const rawSort = params.get('sort') ?? undefined;
  const known = rawSort !== undefined && (GLOBAL_STATS_SORTABLE_COLS as readonly string[]).includes(rawSort);
  const allowed = known && (rawSort !== 'decayedRating' || (gate.decayedRating ?? false));
  const sort: GlobalStatsSortCol | undefined = allowed ? (rawSort as GlobalStatsSortCol) : undefined;

  // D2: the browser URL carries `dir`; `direction` is the wire name the API keeps, and a stale
  // `?direction=` link simply falls back to the default order.
  const rawDir = params.get('dir') ?? undefined;
  const direction: 'asc' | 'desc' | undefined = rawDir === 'asc' || rawDir === 'desc' ? rawDir : undefined;

  // Single-select at both levels: every selectable scope has a stored rating, so 'all' or exactly
  // one id — there is no subset to combine and no on-demand replay to fall back on.
  const league = (params.get('league') ?? '').trim() || GLOBAL_STATS_SCOPE_ALL;
  const season = (params.get('season') ?? '').trim() || GLOBAL_STATS_SCOPE_ALL;

  return { page, size, search, sort, direction, league, season };
}

/**
 * The one scope the rankings are asked for. A Season is narrower than its League, so a chosen Season
 * wins; both `'all'` is the global scope, whose id is the empty string.
 */
export function resolveGlobalStatsScope(query: Pick<GlobalStatsQuery, 'league' | 'season'>): GlobalStatsScopeSelection {
  if (query.season !== GLOBAL_STATS_SCOPE_ALL) return { kind: 'season', id: query.season };
  if (query.league !== GLOBAL_STATS_SCOPE_ALL) return { kind: 'league', id: query.league };
  return { kind: 'global', id: '' };
}

/** The Seasons the Season select offers: every Season while the League is `'all'`, that League's otherwise. */
export function scopeSeasonOptions<T extends { leagueId: string }>(seasons: readonly T[], league: string): T[] {
  return league === GLOBAL_STATS_SCOPE_ALL ? [...seasons] : seasons.filter(season => season.leagueId === league);
}

/** Choosing a League drops a Season it does not own, and always returns to page 1. */
export function selectScopeLeague(
  query: GlobalStatsQuery,
  league: string,
  seasons: readonly GlobalStatsSeasonOption[]
): GlobalStatsQuery {
  const keeps = league !== GLOBAL_STATS_SCOPE_ALL
    && query.season !== GLOBAL_STATS_SCOPE_ALL
    && seasons.some(season => season.id === query.season && season.leagueId === league);
  return { ...query, league, season: keeps ? query.season : GLOBAL_STATS_SCOPE_ALL, page: 1 };
}

/**
 * Choosing a Season pins its owning League too: a badge naming a Season while the League select
 * still read "All leagues" is exactly the ambiguity the badge exists to remove.
 */
export function selectScopeSeason(
  query: GlobalStatsQuery,
  season: string,
  seasons: readonly GlobalStatsSeasonOption[]
): GlobalStatsQuery {
  if (season === GLOBAL_STATS_SCOPE_ALL) return { ...query, season: GLOBAL_STATS_SCOPE_ALL, page: 1 };
  const owner = seasons.find(candidate => candidate.id === season);
  return { ...query, season, league: owner ? owner.leagueId : query.league, page: 1 };
}

/**
 * The human name of the active scope, or `undefined` while the catalog holding it has not landed
 * or the id is unknown. The global scope has no name here — the caller labels it.
 */
export function globalStatsScopeName(
  scope: GlobalStatsScopeSelection,
  catalogs: { leagues: readonly GlobalStatsLeagueOption[]; seasons: readonly GlobalStatsSeasonOption[] }
): string | undefined {
  if (scope.kind === 'global') return undefined;
  const list = scope.kind === 'league' ? catalogs.leagues : catalogs.seasons;
  return list.find(entry => entry.id === scope.id)?.name;
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
 * The page numbers the pagination renders, with `'gap'` standing for an elided run. The first page,
 * the last page and the current page's two neighbours are always offered, so both ends of the ranking
 * stay one click away however deep the reader is.
 */
export function globalStatsPageWindow(page: number, totalPages: number): (number | 'gap')[] {
  const current = Math.min(Math.max(page, 1), totalPages);
  const wanted = new Set<number>([1, totalPages]);
  for (let candidate = current - 1; candidate <= current + 1; candidate++) {
    if (candidate >= 1 && candidate <= totalPages) wanted.add(candidate);
  }
  const pages = [...wanted].sort((left, right) => left - right);
  const window: (number | 'gap')[] = [];
  pages.forEach((value, index) => {
    // A gap over a single page would be wider than the page it hides, so print the page instead.
    const previous = pages[index - 1];
    if (index > 0 && value - previous === 2) window.push(value - 1);
    else if (index > 0 && value - previous > 2) window.push('gap');
    window.push(value);
  });
  return window;
}

/** Columns a player can legitimately have no value for — null sorts last in both directions. */
const GLOBAL_STATS_NULLABLE_COLS: readonly GlobalStatsSortCol[] = ['matchWinrate', 'gameWinrate', 'decayedRating'];

/**
 * Columns that rank players, and therefore keep the provisional bucket at the bottom whichever
 * direction is asked for: a rating under five Tournaments is not comparable to a ranked one, so
 * clicking Rating must not lift a newcomer over the table. Every other column sorts on its value
 * alone.
 */
const GLOBAL_STATS_RATING_COLS: readonly GlobalStatsSortCol[] = ['rating', 'decayedRating'];

/**
 * The ranking order the paged endpoint serves, reproduced for the client-side catalog so the two
 * Player Statistics surfaces never disagree on who is at position 1.
 *
 * Three details are copied deliberately from `PublicLeagueEndpoints.OrderGlobalStats`:
 * a missing winrate sorts **last in both directions** (so the null test is applied before the
 * direction, never flipped by it), a rating sort keeps the provisional bucket last in both directions
 * and orders it by the same rating, the Player Name tiebreak is always ascending and **ordinal**
 * (Player Names are exact and case-sensitive under ADR 0040, not browser-locale collated), and no
 * requested sort means the three-bucket partition from `PublicLeagueEndpoints.OrderGlobalStats`:
 * bucket 0 (active ranked) → bucket 1 (inactive) → bucket 2 (provisional); within 0 and 1 rating
 * DESC; within 2 tournamentsPlayed DESC then playedMatchCount DESC; every tie broken by name ASC.
 */
export function sortGlobalStatsRows<T extends GlobalPlayerStatisticsRow>(
  rows: readonly T[],
  sort?: GlobalStatsSortCol,
  direction: 'asc' | 'desc' = 'desc'
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  const sorted = [...rows];
  if (!sort) {
    return sorted.sort((left, right) => {
      const lb = rankingBucket(left);
      const rb = rankingBucket(right);
      if (lb !== rb) return lb - rb;
      if (lb === 2) {
        return compareValues(right.tournamentsPlayed ?? 0, left.tournamentsPlayed ?? 0)
          || compareValues(right.playedMatchCount, left.playedMatchCount)
          || compareOrdinal(left.playerName, right.playerName);
      }
      return compareValues(right.rating ?? 0, left.rating ?? 0)
        || compareOrdinal(left.playerName, right.playerName);
    });
  }
  const nullable = GLOBAL_STATS_NULLABLE_COLS.includes(sort);
  const provisionalLast = GLOBAL_STATS_RATING_COLS.includes(sort);
  return sorted.sort((left, right) => {
    const leftValue = left[sort] as number | null | undefined;
    const rightValue = right[sort] as number | null | undefined;
    if (provisionalLast) {
      const bucket = compareValues(Number(left.provisional ?? false), Number(right.provisional ?? false));
      if (bucket) return bucket;
    }
    if (nullable) {
      const missing = compareValues(Number(leftValue == null), Number(rightValue == null));
      if (missing) return missing;
    }
    return sign * compareValues(leftValue ?? 0, rightValue ?? 0) || compareOrdinal(left.playerName, right.playerName);
  });
}

function rankingBucket(row: GlobalPlayerStatisticsRow): 0 | 1 | 2 {
  if (row.provisional ?? false) return 2;
  if (row.inactive ?? false) return 1;
  return 0;
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
 * Omits defaults (both scope levels `'all'`, page=1, size=100, empty search, no sort/direction) to
 * keep URLs clean. The direction is written under `dir`; the key `direction` is never written.
 */
export function globalStatsQueryParams(query: GlobalStatsQuery): Params {
  const params: Params = {};
  if (query.league !== GLOBAL_STATS_SCOPE_ALL) params['league'] = query.league;
  if (query.season !== GLOBAL_STATS_SCOPE_ALL) params['season'] = query.season;
  if (query.page !== 1) params['page'] = query.page;
  if (query.size !== 100) params['size'] = query.size;
  if (query.search) params['search'] = query.search;
  if (query.sort) params['sort'] = query.sort;
  if (query.direction) params['dir'] = query.direction;
  return params;
}
