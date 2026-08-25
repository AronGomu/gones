import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, Observable, Subject, isObservable, of, throwError } from 'rxjs';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { GlobalStatsComponent, SEARCH_DEBOUNCE_MS } from './global-stats.component';
import { catalogs } from '../../i18n/messages';
import { Client } from '../../api/generated/gones-api';
import type { ArchiveGlobalPlayerStatisticsResponse, ArchiveGlobalPlayerStatisticsRow } from '../../api/generated/gones-api';
import { ArchiveRepository } from '../../data/archive-repository.service';
import type { ArchiveLeagueRow, ArchiveLeagueSeasonRow } from '../../data/archive-repository.service';

const source = readFileSync(join(__dirname, 'global-stats.component.ts'), 'utf8');

// ---------------------------------------------------------------------------
// Template structure checks
// ---------------------------------------------------------------------------
describe('GlobalStatsComponent template — 11 column headers', () => {
  const COL_DATA_CY = [
    'global-stats-col-position',
    'global-stats-col-player',
    'global-stats-col-rating',
    'global-stats-col-tournaments',
    'global-stats-col-matches',
    'global-stats-col-match-wins',
    'global-stats-col-match-losses',
    'global-stats-col-match-draws',
    'global-stats-col-match-winrate',
    'global-stats-col-rival',
    'global-stats-col-archetype',
  ];

  it('contains all 11 column header data-cy values in order', () => {
    for (const cy of COL_DATA_CY) {
      expect(source, `missing: ${cy}`).toContain(`"${cy}"`);
    }
    const indices = COL_DATA_CY.map((cy) => source.indexOf(`"${cy}"`));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i], `${COL_DATA_CY[i]} not after ${COL_DATA_CY[i - 1]}`).toBeGreaterThan(indices[i - 1]);
    }
  });

  it('drops the game columns', () => {
    expect(source).not.toMatch(/data-cy="global-stats-col-game/);
    expect(source).not.toContain('data-cy="global-stats-col-games"');
  });

  it('drops the nemesis column', () => {
    expect(source).not.toContain('global-stats-col-nemesis');
    expect(source).not.toContain('global-stats-cell-nemesis-');
  });

  it('empty row uses a computed colspan bound to visibleColumnCount()', () => {
    expect(source).toContain('[attr.colspan]="visibleColumnCount()"');
    expect(source).not.toContain('colspan="12"');
    expect(source).not.toContain('colspan="10"');
  });
});

describe('GlobalStatsComponent template — sortable headers', () => {
  const SORTABLE = [
    'global-stats-col-rating',
    'global-stats-col-tournaments',
    'global-stats-col-matches',
    'global-stats-col-match-wins',
    'global-stats-col-match-losses',
    'global-stats-col-match-draws',
    'global-stats-col-match-winrate',
  ];
  const NOT_SORTABLE = [
    'global-stats-col-position',
    'global-stats-col-player',
    'global-stats-col-rival',
    'global-stats-col-archetype',
  ];

  it('sortable column headers have a click handler', () => {
    for (const cy of SORTABLE) {
      const idx = source.indexOf(`"${cy}"`);
      const vicinity = source.slice(Math.max(0, idx - 200), idx + 300);
      expect(vicinity, `${cy} missing click handler`).toMatch(/\(click\)/);
    }
  });

  it('non-sortable column headers have no click handler on the header cell', () => {
    for (const cy of NOT_SORTABLE) {
      const idx = source.indexOf(`"${cy}"`);
      const tagStart = source.lastIndexOf('<', idx);
      const tagEnd = source.indexOf('>', idx);
      const tag = source.slice(tagStart, tagEnd + 1);
      expect(tag, `${cy} should not have click`).not.toContain('(click)');
    }
  });

  it('sortable columns carry aria-sort', () => {
    for (const cy of SORTABLE) {
      const idx = source.indexOf(`"${cy}"`);
      const vicinity = source.slice(Math.max(0, idx - 300), idx + 400);
      expect(vicinity, `${cy} missing aria-sort`).toContain('aria-sort');
    }
  });
});

describe('GlobalStatsComponent template — player link', () => {
  it('uses [routerLink] with /players/:playerName', () => {
    expect(source).toContain(`['/players', row.playerName]`);
  });
});

describe('GlobalStatsComponent template — search form and paging', () => {
  it('has no apply button', () => {
    expect(source).not.toContain('global-stats-search-apply');
  });

  it('contains a search input with data-cy', () => {
    expect(source).toContain('data-cy="global-stats-search-input"');
  });

  it('contains a page-size select', () => {
    expect(source).toContain('data-cy="global-stats-page-size-select"');
  });

  it('paginates by page number alone — no first, previous, next or last buttons', () => {
    expect(source).not.toContain('global-stats-page-previous');
    expect(source).not.toContain('global-stats-page-next');
    expect(source).not.toContain('global-stats-page-first');
    expect(source).not.toContain('global-stats-page-last');
    expect(source).not.toContain("i18n.t('common.previous')");
    expect(source).not.toContain("i18n.t('common.next')");
  });

  it('contains a page status element', () => {
    expect(source).toContain('data-cy="global-stats-page-status"');
  });

  it('renders one numbered button per windowed page', () => {
    expect(source).toContain("@for (item of pageWindow(); track $index)");
    expect(source).toContain("'global-stats-page-number-' + place + '-' + item");
    expect(source).toContain("'global-stats-page-gap-' + place + '-' + $index");
  });

  it('renders the same pagination above and below the table from one template', () => {
    expect(source.match(/<ng-template #paginationNav/g)).toHaveLength(1);
    const top = source.indexOf("$implicit: 'top'");
    const table = source.indexOf('data-cy="global-stats-table-wrap"');
    const bottom = source.indexOf("$implicit: 'bottom'");
    expect(top).toBeGreaterThan(-1);
    expect(top).toBeLessThan(table);
    expect(bottom).toBeGreaterThan(table);
  });

  it('announces the page only once — the status span belongs to the bottom copy', () => {
    expect(source.match(/data-cy="global-stats-page-status"/g)).toHaveLength(1);
    expect(source).toContain("@if (place === 'bottom')");
  });

  it('separates the top pagination from the table', () => {
    expect(source).toContain("[class.global-stats-pagination--top]=\"place === 'top'\"");
    expect(source).toMatch(/\.global-stats-pagination--top \{[^}]*margin-bottom/);
  });

  it('marks the current numbered button with aria-current', () => {
    expect(source).toContain("[attr.aria-current]");
  });

  it('contains a table-wrap container', () => {
    expect(source).toContain('table-wrap');
    expect(source).toContain('ranking-table');
  });

  it('renders both back buttons', () => {
    expect(source).toContain('global-stats-back-top');
    expect(source).toContain('global-stats-back-bottom');
  });
});

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ArchiveGlobalPlayerStatisticsRow> = {}): ArchiveGlobalPlayerStatisticsRow {
  return {
    position: 1,
    playerName: 'Alice',
    playedMatchCount: 10,
    matchWins: 7,
    matchLosses: 2,
    matchDraws: 1,
    matchWinrate: 0.7,
    playedGameCount: 22,
    gameWins: 15,
    gameLosses: 7,
    gameWinrate: 0.68,
    nemesis: undefined,
    rival: undefined,
    mostPlayedArchetype: undefined,
    rating: 1500,
    ratingDeviation: 350,
    previousRating: 1500,
    lastRatingDelta: 0,
    tournamentsPlayed: 0,
    lastPlayedDate: undefined,
    provisional: true,
    inactive: false,
    decayedRating: undefined,
    ...overrides,
  };
}

function rankingsResponse(
  items: ArchiveGlobalPlayerStatisticsRow[],
  overrides: Partial<ArchiveGlobalPlayerStatisticsResponse> = {},
): ArchiveGlobalPlayerStatisticsResponse {
  return { items, page: 1, pageSize: 100, totalCount: items.length, sort: undefined, direction: undefined, ...overrides };
}

function leagueSummary(id: string, name: string): ArchiveLeagueRow {
  return { id, name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', documentVersion: 1, isLocal: false };
}

function seasonSummary(id: string, name: string, leagueId: string): ArchiveLeagueSeasonRow {
  return {
    id, name, leagueId, status: 'completed',
    updatedAt: '2026-01-01T00:00:00.000Z', documentVersion: 1,
    tournamentCount: 0, playerCount: 0, firstTournamentDate: null, lastTournamentDate: null, isLocal: false,
  };
}

/**
 * A responder may hand back an Observable so a test can hold one request open — invariant 12 (a
 * superseded response is dropped) cannot be expressed with an already-resolved value.
 */
type Responder = ArchiveGlobalPlayerStatisticsResponse
  | ((scopeKind: string, scopeId: string | undefined) => ArchiveGlobalPlayerStatisticsResponse | Observable<ArchiveGlobalPlayerStatisticsResponse>);

function paramMapOf(params: Record<string, string | null>) {
  return {
    keys: Object.keys(params),
    has: (k: string) => params[k] !== undefined && params[k] !== null,
    get: (k: string) => params[k] ?? null,
    getAll: () => [],
  };
}

/** The generated signature, so a test can assert on the `sort` and `direction` arguments by index. */
type RankingsArgs = [
  scopeKind: string, scopeId: string | undefined, page: number | undefined, pageSize: number | undefined,
  search: string | undefined, sort: string | undefined, direction: string | undefined,
];

function buildComponent(
  response: Responder = rankingsResponse([]),
  routeParams: Record<string, string | null> = {},
  scopeCatalogs: { leagues?: ArchiveLeagueRow[]; seasons?: ArchiveLeagueSeasonRow[]; fail?: boolean } = {},
) {
  // The app default is French; the copy assertions below name the English strings, so pin the
  // language before `DeckArchetypeSettingsService` bootstraps from storage.
  localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  localStorage.setItem('gones.settings.language', 'en');

  const getArchiveGlobalPlayerStatistics = vi.fn((...args: RankingsArgs) => {
    const result = typeof response === 'function' ? response(args[0], args[1]) : response;
    return isObservable(result) ? result : of(result);
  });
  const client = { getArchiveGlobalPlayerStatistics } as unknown as Client;

  const catalogResult = <T>(items: T[]) =>
    ({ items, totalCount: items.length, truncated: false, fetchedAt: '2026-08-22T00:00:00.000Z', fromCache: false, stale: false });
  const listLeagues = vi.fn(async () => {
    if (scopeCatalogs.fail) throw new Error('offline');
    return catalogResult(scopeCatalogs.leagues ?? []);
  });
  const listLeagueSeasons = vi.fn(async () => {
    if (scopeCatalogs.fail) throw new Error('offline');
    return catalogResult(scopeCatalogs.seasons ?? []);
  });
  const archive = { listLeagues, listLeagueSeasons } as unknown as ArchiveRepository;

  const queryParamMap = new BehaviorSubject(paramMapOf(routeParams));
  const route = { queryParamMap } as unknown as ActivatedRoute;
  const navigate = vi.fn().mockResolvedValue(true);
  const router = { navigate } as unknown as Router;

  const injector = Injector.create({
    providers: [
      { provide: Client, useValue: client },
      { provide: ArchiveRepository, useValue: archive },
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: router },
      DeckArchetypeSettingsService,
      I18nService,
    ],
  });

  const comp = runInInjectionContext(injector, () => new GlobalStatsComponent());
  const emit = (params: Record<string, string | null>) => queryParamMap.next(paramMapOf(params));
  return { comp, client: getArchiveGlobalPlayerStatistics, listLeagues, listLeagueSeasons, router: { navigate }, emit };
}

const lastQueryParams = (router: { navigate: ReturnType<typeof vi.fn> }): Record<string, unknown> => {
  const extras = router.navigate.mock.calls.at(-1)?.[1] as { queryParams?: Record<string, unknown> } | undefined;
  return extras?.queryParams ?? {};
};

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

describe('GlobalStatsComponent — format helpers', () => {
  it('formatPct returns "—" for null/undefined', () => {
    const { comp } = buildComponent();
    expect(comp.formatPct(null)).toBe('—');
    expect(comp.formatPct(undefined)).toBe('—');
  });

  it('formatPct returns whole-number percentage for non-null', () => {
    const { comp } = buildComponent();
    expect(comp.formatPct(0.75)).toBe('75%');
    expect(comp.formatPct(1)).toBe('100%');
    expect(comp.formatPct(0)).toBe('0%');
    expect(comp.formatPct(0.333)).toBe('33%');
  });

  it('formatOpponent returns "—" for null/undefined', () => {
    const { comp } = buildComponent();
    expect(comp.formatOpponent(null)).toBe('—');
    expect(comp.formatOpponent(undefined)).toBe('—');
  });

  it('formatOpponent returns "Name (W-L)" for a record', () => {
    const { comp } = buildComponent();
    expect(comp.formatOpponent({ name: 'Alice', wins: 3, losses: 1 })).toBe('Alice (3-1)');
  });

  it('formatArchetype returns "—" for null/undefined', () => {
    const { comp } = buildComponent();
    expect(comp.formatArchetype(null)).toBe('—');
    expect(comp.formatArchetype(undefined)).toBe('—');
  });

  it('formatArchetype returns "Name (N)" for a record', () => {
    const { comp } = buildComponent();
    expect(comp.formatArchetype({ name: 'Delver', matchCount: 18 })).toBe('Delver (18)');
  });
});

// ---------------------------------------------------------------------------
// Rating column — formatDelta helper
// ---------------------------------------------------------------------------

describe('GlobalStatsComponent — formatDelta', () => {
  it('returns empty string for zero delta', () => {
    const { comp } = buildComponent();
    expect(comp.formatDelta(0)).toBe('');
  });

  it('returns +N for positive delta', () => {
    const { comp } = buildComponent();
    expect(comp.formatDelta(28)).toBe('+28');
  });

  it('returns -N for negative delta', () => {
    const { comp } = buildComponent();
    expect(comp.formatDelta(-13)).toBe('-13');
  });

  it('returns empty string for null/undefined delta', () => {
    const { comp } = buildComponent();
    expect(comp.formatDelta(null)).toBe('');
    expect(comp.formatDelta(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Rating column — template structure
// ---------------------------------------------------------------------------

describe('GlobalStatsComponent template — rating cell', () => {
  it('renders the integer rating value', () => {
    expect(source).toContain('row.rating');
    expect(source).toContain('rating-value');
  });

  it('renders the rating delta with up/down classes', () => {
    expect(source).toContain('rating-delta--up');
    expect(source).toContain('rating-delta--down');
    expect(source).toContain('formatDelta(row.lastRatingDelta)');
  });

  it('includes provisional badge with data-cy hook', () => {
    expect(source).toContain('rating-badge--provisional');
    expect(source).toContain('rating-provisional');
  });

  it('includes inactive badge with data-cy hook', () => {
    expect(source).toContain('rating-badge--inactive');
    expect(source).toContain('rating-inactive');
  });

  it('falls back to \u2014 when rating is undefined (stale cache)', () => {
    // The third alternative of the old regex was `globalStats.colRating`, which matches the column
    // header — always present — so deleting the whole fallback kept this green. Assert the @else branch
    // itself: the guard, and the em dash it renders into the same rating-value cell.
    expect(source).toContain('@if (row.rating !== undefined)');
    expect(source).toMatch(/@else\s*\{\s*<span[^>]*-rating-value'">\u2014<\/span>\s*\}/);
  });

  it('renders the tournamentsPlayed count', () => {
    expect(source).toContain('row.tournamentsPlayed');
  });
});

// ---------------------------------------------------------------------------
// Search — the term is committed to the URL and requested from the server
// ---------------------------------------------------------------------------

describe('GlobalStatsComponent — search', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('commits the search to the URL after the debounce', async () => {
    const { comp, router } = buildComponent();
    await vi.runAllTimersAsync();

    comp.setSearchDraft('ly');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(lastQueryParams(router)['search']).toBe('ly');
  });

  /** The server owns the match: the client neither lower-cases the term nor filters the rows. */
  it('sends the search term to the server unchanged', async () => {
    const { comp, router } = buildComponent();
    await vi.runAllTimersAsync();

    comp.setSearchDraft('LY');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(lastQueryParams(router)['search']).toBe('LY');
    expect(source).not.toContain('toLowerCase()');
  });

  it('debounces: three keystrokes inside 300 ms cause one navigation', async () => {
    const { comp, router } = buildComponent();
    await vi.runAllTimersAsync();

    comp.setSearchDraft('a');
    comp.setSearchDraft('al');
    comp.setSearchDraft('ali');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(router.navigate).toHaveBeenCalledTimes(1);
  });
});

describe('GlobalStatsComponent — numbered pagination', () => {
  it('windows the pages around the current one', async () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      makeRow({ playerName: `Player ${i + 1}`, position: i + 1 })
    );
    const { comp } = buildComponent(rankingsResponse(rows));
    await vi.waitFor(() => expect(comp.totalCount()).toBe(200));

    comp.currentSize.set(10);
    expect(comp.totalPages()).toBe(20);
    expect(comp.pageWindow()).toEqual([1, 2, 'gap', 20]);

    comp.currentPage.set(9);
    expect(comp.pageWindow()).toEqual([1, 'gap', 8, 9, 10, 'gap', 20]);
  });
});

// ---------------------------------------------------------------------------
// Scope filter — the League / Season the stored ratings are read for
// ---------------------------------------------------------------------------

const LEAGUES = [leagueSummary('L1', 'Ligue Lyon'), leagueSummary('L2', 'Circuit Rhône-Alpes')];
const SEASONS = [
  seasonSummary('S1', 'Ligue Lyon 2026', 'L1'),
  seasonSummary('S2', 'Ligue Lyon 2025', 'L1'),
  seasonSummary('S9', 'Circuit 2026', 'L2'),
];
const SCOPE_CATALOGS = { leagues: LEAGUES, seasons: SEASONS };

describe('GlobalStatsComponent — scope filter', () => {
  it('requests the global scope by default', async () => {
    const { client } = buildComponent();
    await vi.waitFor(() => expect(client).toHaveBeenCalledTimes(1));
    expect(client).toHaveBeenCalledWith('global', undefined, 1, 100, undefined, undefined, undefined);
  });

  it('requests the league scope with its id', async () => {
    const { client } = buildComponent(rankingsResponse([]), { league: 'L1' });
    await vi.waitFor(() => expect(client).toHaveBeenCalledTimes(1));
    expect(client.mock.calls[0][0]).toBe('league');
    expect(client.mock.calls[0][1]).toBe('L1');
  });

  it('requests the season scope with its id', async () => {
    const { client } = buildComponent(rankingsResponse([]), { league: 'L1', season: 'S1' });
    await vi.waitFor(() => expect(client).toHaveBeenCalledTimes(1));
    expect(client.mock.calls[0][0]).toBe('season');
    expect(client.mock.calls[0][1]).toBe('S1');
  });

  /**
   * ADR 0028: a `local-` id lives in this browser's IndexedDB and has no meaning on the wire. A
   * scope the picker offers is a scope the picker can send, so a browser-local row must never reach
   * either select.
   */
  it('never offers a browser-local League or Season as a scope', async () => {
    const { comp } = buildComponent(rankingsResponse([]), {}, {
      leagues: [...LEAGUES, { ...leagueSummary('local-a1', 'Draft League'), isLocal: true }],
      seasons: [...SEASONS, { ...seasonSummary('local-b2', 'Draft Season', 'local-a1'), isLocal: true }],
    });
    await vi.waitFor(() => expect(comp.leagues().length).toBeGreaterThan(0));

    expect(comp.leagues().map((league) => league.id)).toEqual(['L1', 'L2']);
    expect(comp.seasons().map((season) => season.id)).toEqual(['S1', 'S2', 'S9']);
  });

  /** The Season select reads `seasonOptions()`, so the filter has to survive that derivation too. */
  it('keeps a browser-local Season out of the Season options of its own League', async () => {
    const { comp } = buildComponent(rankingsResponse([]), { league: 'L1' }, {
      leagues: LEAGUES,
      seasons: [...SEASONS, { ...seasonSummary('local-b2', 'Draft Season', 'L1'), isLocal: true }],
    });
    await vi.waitFor(() => expect(comp.seasons().length).toBeGreaterThan(0));

    expect(comp.seasonOptions().map((season) => season.id)).toEqual(['S1', 'S2']);
  });

  /** D2: the URL says `dir`, the wire keeps the server's own `direction`. */
  it('sends the URL direction under the wire name', async () => {
    const { client } = buildComponent(rankingsResponse([]), { sort: 'matchWins', dir: 'asc' });
    await vi.waitFor(() => expect(client).toHaveBeenCalledTimes(1));
    expect(client.mock.calls[0][5]).toBe('matchWins');
    expect(client.mock.calls[0][6]).toBe('asc');
  });

  /**
   * The headline of the slice: a scoped row is the player's record inside that Season, read from
   * `player_statistics`, and not their global numbers filtered down.
   */
  it('keeps the numbers the scope returned', async () => {
    const scoped = makeRow({ playerName: 'Alice', position: 1, playedMatchCount: 6, tournamentsPlayed: 2, matchWinrate: 0.5 });
    const global = makeRow({ playerName: 'Alice', position: 1, playedMatchCount: 40, tournamentsPlayed: 12, matchWinrate: 0.75 });
    const { comp } = buildComponent(
      (scopeKind, scopeId) => rankingsResponse([scopeKind === 'season' && scopeId === 'S1' ? scoped : global]),
      { league: 'L1', season: 'S1' },
    );
    await vi.waitFor(() => expect(comp.pagedRows().length).toBe(1));

    expect(comp.pagedRows()[0].playedMatchCount).toBe(6);
    expect(comp.pagedRows()[0].tournamentsPlayed).toBe(2);
    expect(comp.pagedRows()[0].matchWinrate).toBe(0.5);
  });

  it('renumbers positions from the scoped response', async () => {
    const rows = [1, 2, 3].map((position) => makeRow({ playerName: `Player ${position}`, position }));
    const { comp } = buildComponent(rankingsResponse(rows), { season: 'S1' });
    await vi.waitFor(() => expect(comp.pagedRows().length).toBe(3));

    expect(comp.pagedRows().map((row) => row.position)).toEqual([1, 2, 3]);
    expect(source).not.toContain('start + i + 1');
  });

  it('renders the scope note only in a scoped view', () => {
    expect(source).toContain('data-cy="global-stats-scope-note"');
    expect(source).toContain("@if (scope().kind !== 'global')");
  });

  it('names the active season in the badge', async () => {
    const { comp } = buildComponent(rankingsResponse([]), { league: 'L1', season: 'S1' }, SCOPE_CATALOGS);
    await vi.waitFor(() => expect(comp.seasons().length).toBe(3));
    expect(comp.scopeLabel()).toBe('Ligue Lyon 2026');
  });

  it('names the active league in the badge', async () => {
    const { comp } = buildComponent(rankingsResponse([]), { league: 'L1' }, SCOPE_CATALOGS);
    await vi.waitFor(() => expect(comp.leagues().length).toBe(2));
    expect(comp.scopeLabel()).toBe('Ligue Lyon');
  });

  it('labels the badge global when nothing is chosen', async () => {
    const { comp } = buildComponent(rankingsResponse([]), {}, SCOPE_CATALOGS);
    await vi.waitFor(() => expect(comp.leagues().length).toBe(2));
    expect(comp.scopeLabel()).toBe('All tournaments');
  });

  it('falls back to the raw id before the catalog lands', async () => {
    const { comp } = buildComponent(rankingsResponse([]), { season: 'S9' });
    expect(comp.scopeLabel()).toBe('S9');
  });

  it('narrows the season options to the chosen league', async () => {
    const { comp } = buildComponent(rankingsResponse([]), { league: 'L1' }, SCOPE_CATALOGS);
    await vi.waitFor(() => expect(comp.seasons().length).toBe(3));
    expect(comp.seasonOptions().map((season) => season.id)).toEqual(['S1', 'S2']);
  });

  it('offers every season while the league is all', async () => {
    const { comp } = buildComponent(rankingsResponse([]), {}, SCOPE_CATALOGS);
    await vi.waitFor(() => expect(comp.seasons().length).toBe(3));
    expect(comp.seasonOptions().length).toBe(3);
  });

  it('navigates with both scope keys when a season is chosen', async () => {
    const { comp, router } = buildComponent(rankingsResponse([]), {}, SCOPE_CATALOGS);
    await vi.waitFor(() => expect(comp.seasons().length).toBe(3));

    comp.setSeason('S1');

    expect(lastQueryParams(router)['league']).toBe('L1');
    expect(lastQueryParams(router)['season']).toBe('S1');
    expect(lastQueryParams(router)['page']).toBeUndefined();
  });

  it('resets the season when the new league does not own it', async () => {
    const { comp, router } = buildComponent(rankingsResponse([]), { league: 'L2', season: 'S9' }, SCOPE_CATALOGS);
    await vi.waitFor(() => expect(comp.seasons().length).toBe(3));

    comp.setLeague('L1');

    expect(lastQueryParams(router)['season']).toBeUndefined();
    expect(lastQueryParams(router)['league']).toBe('L1');
  });
});

describe('GlobalStatsComponent — scoped empty state, status and paging', () => {
  it('says the scope is empty rather than the archive', async () => {
    const { comp } = buildComponent(rankingsResponse([]), { season: 'S1' });
    await vi.waitFor(() => expect(comp.loading()).toBe(false));
    expect(comp.emptyMessage()).toBe('No player has a rating in this scope yet.');
  });

  it('keeps the generic empty copy for an empty search', async () => {
    const { comp } = buildComponent(rankingsResponse([]), { season: 'S1', search: 'zzz' });
    await vi.waitFor(() => expect(comp.loading()).toBe(false));
    expect(comp.emptyMessage()).toBe('No players found.');
  });

  /** A standalone Tournament (`seasonId: null`) feeds the global scope only — say so in the gap. */
  it('explains that standalone tournaments only feed the global scope', () => {
    expect(source).toContain('data-cy="global-stats-empty-standalone-hint"');
    expect(source).toContain('globalStats.standaloneHint');
  });

  it('counts players in this scope in the status line', async () => {
    const { comp } = buildComponent(rankingsResponse([], { totalCount: 18 }), { season: 'S1' });
    await vi.waitFor(() => expect(comp.totalCount()).toBe(18));
    expect(comp.pageStatus()).toBe('Page 1 of 1 (18 players in this scope)');
  });

  it('counts players plainly in the global scope', async () => {
    const { comp } = buildComponent(rankingsResponse([], { totalCount: 18 }));
    await vi.waitFor(() => expect(comp.totalCount()).toBe(18));
    expect(comp.pageStatus()).toBe('Page 1 of 1 (18 players)');
  });

  it('sorting issues a new scoped request', async () => {
    const { comp, router } = buildComponent(rankingsResponse([]), { league: 'L1', season: 'S1' });
    await vi.waitFor(() => expect(comp.loading()).toBe(false));

    comp.sortBy('rating');

    expect(lastQueryParams(router)).toMatchObject({ league: 'L1', season: 'S1', sort: 'rating', dir: 'desc' });
  });

  it('paging issues a new scoped request', async () => {
    const { comp, router } = buildComponent(rankingsResponse([]), { season: 'S1' });
    await vi.waitFor(() => expect(comp.loading()).toBe(false));

    comp.goPage(3);

    expect(lastQueryParams(router)['page']).toBe(3);
    expect(lastQueryParams(router)['season']).toBe('S1');
  });

  it('page size 100 is the default and is not written to the URL', async () => {
    const { comp, router } = buildComponent();
    await vi.waitFor(() => expect(comp.loading()).toBe(false));
    expect(comp.currentSize()).toBe(100);

    comp.setSize(100);

    expect(lastQueryParams(router)['size']).toBeUndefined();
  });

  it('drops sort=decayedRating from the request while the column is off the wire', async () => {
    const { client } = buildComponent(rankingsResponse([makeRow({ decayedRating: undefined })]), { sort: 'decayedRating' });
    await vi.waitFor(() => expect(client).toHaveBeenCalledTimes(1));
    expect(client.mock.calls[0][5]).toBeUndefined();
  });

  it('sends sort=decayedRating once the column is on the wire', async () => {
    const { client, comp, emit } = buildComponent(rankingsResponse([makeRow({ decayedRating: 1480 })]), { sort: 'decayedRating' });
    await vi.waitFor(() => expect(comp.showDecayedRating()).toBe(true));

    emit({ sort: 'decayedRating' });

    await vi.waitFor(() => expect(client).toHaveBeenCalledTimes(2));
    expect(client.mock.calls.at(-1)?.[5]).toBe('decayedRating');
  });
});

describe('GlobalStatsComponent — scoped failures', () => {
  it('surfaces a filter failure without hiding the table', async () => {
    const { comp } = buildComponent(rankingsResponse([makeRow()]), {}, { fail: true });
    await vi.waitFor(() => expect(comp.scopeError()).toBeTruthy());

    expect(comp.scopeError()).toBe('Could not load the League and Season filters.');
    expect(comp.error()).toBe('');
    expect(comp.pagedRows().length).toBe(1);
  });

  it('reports a rankings failure when nothing is on screen', async () => {
    const { comp } = buildComponent(() => throwError(() => new Error('offline')));
    await vi.waitFor(() => expect(comp.error()).toBeTruthy());

    expect(comp.error()).toBe('Could not load global statistics.');
    expect(comp.stale()).toBe(false);
  });

  it('keeps the previous page and goes stale when a refetch fails', async () => {
    let calls = 0;
    const { comp } = buildComponent(() => {
      calls += 1;
      return calls === 1 ? rankingsResponse([makeRow()]) : throwError(() => new Error('offline'));
    });
    await vi.waitFor(() => expect(comp.pagedRows().length).toBe(1));

    comp.onSync();

    await vi.waitFor(() => expect(comp.stale()).toBe(true));
    expect(comp.error()).toBe('');
    expect(comp.pagedRows().length).toBe(1);
  });

  /** D4: a slow global response must not paint global numbers under a Season badge. */
  it('drops a superseded response', async () => {
    const pending = new Subject<ArchiveGlobalPlayerStatisticsResponse>();
    const { comp, emit } = buildComponent((scopeKind) =>
      scopeKind === 'global' ? pending : rankingsResponse([makeRow({ playerName: 'Season Player' })]));

    emit({ season: 'S1' });
    await vi.waitFor(() => expect(comp.pagedRows().length).toBe(1));
    expect(comp.pagedRows()[0].playerName).toBe('Season Player');

    pending.next(rankingsResponse([makeRow({ playerName: 'Global Player' })]));
    pending.complete();

    expect(comp.pagedRows()[0].playerName).toBe('Season Player');
  });

  it('sync refetches the current scope', async () => {
    const { comp, client } = buildComponent(rankingsResponse([]), { season: 'S1' });
    await vi.waitFor(() => expect(client).toHaveBeenCalledTimes(1));

    comp.onSync();

    await vi.waitFor(() => expect(client).toHaveBeenCalledTimes(2));
    for (const call of client.mock.calls) {
      expect(call[0]).toBe('season');
      expect(call[1]).toBe('S1');
    }
  });
});

// ---------------------------------------------------------------------------
// i18n catalog coverage
// ---------------------------------------------------------------------------
describe('GlobalStatsComponent — i18n keys present in both catalogs', () => {
  const requiredKeys = [
    'globalStats.title',
    'globalStats.searchPlaceholder',
    'globalStats.pageSizeLabel',
    'globalStats.paginationAria',
    'globalStats.pageStatus',
    'globalStats.pageAria',
    'globalStats.noResults',
    'globalStats.truncatedWarning',
    'globalStats.colPosition',
    'globalStats.colPlayer',
    'globalStats.colMatches',
    'globalStats.colMatchWins',
    'globalStats.colMatchLosses',
    'globalStats.colMatchDraws',
    'globalStats.colMatchWinrate',
    'globalStats.colRating',
    'globalStats.colDecayedRating',
    'globalStats.colTournaments',
    'globalStats.provisionalBadge',
    'globalStats.inactiveBadge',
    'globalStats.colRival',
    'globalStats.colArchetype',
    'globalStats.scopeLeagueLabel',
    'globalStats.scopeSeasonLabel',
    'globalStats.scopeAllLeagues',
    'globalStats.scopeAllSeasons',
    'globalStats.scopeGlobalName',
    'globalStats.scopeBadge',
    'globalStats.scopeBadgeAria',
    'globalStats.scopeNote',
    'globalStats.scopeLoadFailed',
    'globalStats.noResultsScope',
    'globalStats.standaloneHint',
    'globalStats.pageStatusScope',
    'crumb.globalStats',
    'home.globalStats',
    'home.globalStatsDesc',
  ] as const;

  for (const key of requiredKeys) {
    it(`has ${key} in both catalogs`, () => {
      expect(catalogs.en[key as keyof typeof catalogs.en], `en missing ${key}`).toBeTruthy();
      expect(catalogs.fr[key as keyof typeof catalogs.fr], `fr missing ${key}`).toBeTruthy();
    });
  }
});

// ---------------------------------------------------------------------------
// Decayed rating column — conditional display and colspan
// ---------------------------------------------------------------------------

describe('GlobalStatsComponent — decayed rating column', () => {
  it('hides the decayed column when every row is undefined', async () => {
    const { comp } = buildComponent(rankingsResponse([makeRow({ decayedRating: undefined })]));
    await vi.waitFor(() => expect(comp.pagedRows().length).toBeGreaterThan(0));
    expect(comp.showDecayedRating()).toBe(false);
  });

  it('shows the decayed column when a row carries one', async () => {
    const { comp } = buildComponent(rankingsResponse([makeRow({ decayedRating: 1488 })]));
    await vi.waitFor(() => expect(comp.pagedRows().length).toBeGreaterThan(0));
    expect(comp.showDecayedRating()).toBe(true);
  });

  it('spans the empty row across the visible columns', async () => {
    const { comp } = buildComponent(rankingsResponse([makeRow({ decayedRating: 1488 })]));
    await vi.waitFor(() => expect(comp.pagedRows().length).toBeGreaterThan(0));
    expect(comp.visibleColumnCount()).toBe(12);
  });

  it('spans the empty row across the visible columns when off', async () => {
    const { comp } = buildComponent(rankingsResponse([makeRow({ decayedRating: undefined })]));
    await vi.waitFor(() => expect(comp.pagedRows().length).toBeGreaterThan(0));
    expect(comp.visibleColumnCount()).toBe(11);
  });

  it('refuses ?sort=decayedRating while the column is off the wire', async () => {
    // The server answers 400 for this sort while Gones:PlayerStatistics:ExposeDecayedRating is off, and
    // the rows arrive without the column. The client honours the same gate rather than ordering by a
    // field that is not there.
    const { comp } = buildComponent(
      rankingsResponse([makeRow({ decayedRating: undefined })]),
      { sort: 'decayedRating', dir: 'desc' },
    );
    await vi.waitFor(() => expect(comp.pagedRows().length).toBeGreaterThan(0));
    expect(comp.showDecayedRating()).toBe(false);
    expect(comp.currentSort()).toBeUndefined();
    expect(comp.ariaSort('decayedRating')).toBeNull();
  });

  it('accepts ?sort=decayedRating once the column is on the wire', async () => {
    const { comp } = buildComponent(
      rankingsResponse([makeRow({ decayedRating: 1488 })]),
      { sort: 'decayedRating', dir: 'desc' },
    );
    await vi.waitFor(() => expect(comp.pagedRows().length).toBeGreaterThan(0));
    expect(comp.showDecayedRating()).toBe(true);
    // The gate re-reads the URL when the rows land: the params arrive before the catalog does.
    expect(comp.currentSort()).toBe('decayedRating');
    expect(comp.ariaSort('decayedRating')).toBe('descending');
  });
});

describe('GlobalStatsComponent — match column label values', () => {
  it('uses Wins, Losses, Draw in English', () => {
    expect(catalogs.en['globalStats.colMatchWins']).toBe('Wins');
    expect(catalogs.en['globalStats.colMatchLosses']).toBe('Losses');
    expect(catalogs.en['globalStats.colMatchDraws']).toBe('Draw');
  });

  it('uses Victoires, Défaites, Nuls in French', () => {
    expect(catalogs.fr['globalStats.colMatchWins']).toBe('Victoires');
    expect(catalogs.fr['globalStats.colMatchLosses']).toBe('Défaites');
    expect(catalogs.fr['globalStats.colMatchDraws']).toBe('Nuls');
  });

  it('uses Archetype (matches) / Archétype (matchs) for archetype header', () => {
    expect(catalogs.en['globalStats.colArchetype']).toBe('Archetype (matches)');
    expect(catalogs.fr['globalStats.colArchetype']).toBe('Archétype (matchs)');
  });
});
