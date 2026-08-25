import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// No TestBed / zone.js in this repo, so `effect()` — which drags `ChangeDetectionScheduler` into
// I18nService — is stubbed and the component is built in a bare Injector.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { buildBreadcrumbs, Translator } from '../../app-breadcrumbs';
import { buildRoutes } from '../../app.routes';
import { ArchiveRepository } from '../../data/archive-repository.service';
import { ArchiveLeagueSeasonSummary, ArchiveLeagueSummary } from '../../data/archive-summary';
import { I18nService } from '../../i18n/i18n.service';
import { catalogs, MessageKey, translate } from '../../i18n/messages';
import { DeckArchetypeSettingsService, SettingsLanguage } from '../../shared/deck-archetype-settings.service';
import { ARCHIVE_SEASON_SOURCE } from './league-season-detail.component';
import {
  ALL_LEAGUES,
  buildLeagueSeasonRows,
  DEFAULT_LEAGUE_SEASON_QUERY,
  filterLeagueSeasonRows,
  LeagueSeasonListComponent,
  LeagueSeasonQuery,
  LeagueSeasonRow,
  LeagueSeasonSortKey,
  leagueSeasonQueryParams,
  parseLeagueSeasonQuery,
  sortLeagueSeasonRows,
  toggleLeagueSeasonSort
} from './league-season-list.component';

const source = readFileSync(join(__dirname, 'league-season-list.component.ts'), 'utf8');

/**
 * The source slice a control-flow block owns, from its opening `{` to the `}` that balances it, so an
 * assertion can say "this element is *inside* that guard" rather than "both strings exist somewhere".
 */
function templateBlock(opening: string): string {
  const start = source.indexOf(opening);
  expect(start, `template block "${opening}"`).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = start + opening.length - 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unbalanced template block "${opening}"`);
}

/** A catalog row plus the origin flag the repository stamps on it (ADR 0028). */
type LocalFlagged<T> = T & { isLocal?: boolean };

function seasonSummary(overrides: Partial<LocalFlagged<ArchiveLeagueSeasonSummary>> = {}): LocalFlagged<ArchiveLeagueSeasonSummary> {
  return {
    id: 's-1',
    name: 'Ligue Lyon 2026',
    leagueId: 'lg-1',
    status: 'active',
    updatedAt: '2026-08-18T10:00:00.000Z',
    documentVersion: 1,
    tournamentCount: 12,
    playerCount: 84,
    firstTournamentDate: '2026-01-12',
    lastTournamentDate: '2026-08-17',
    ...overrides
  };
}

function leagueSummary(overrides: Partial<LocalFlagged<ArchiveLeagueSummary>> = {}): LocalFlagged<ArchiveLeagueSummary> {
  return {
    id: 'lg-1',
    name: 'Ligue Lyon',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-18T10:00:00.000Z',
    documentVersion: 1,
    ...overrides
  };
}

function row(overrides: Partial<LeagueSeasonRow> = {}): LeagueSeasonRow {
  return { ...seasonSummary(), leagueName: 'Ligue Lyon', locked: false, isLocal: false, ...overrides };
}

const params = (query: string) => new URLSearchParams(query);

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function buildComponent(options: {
  seasons?: LocalFlagged<ArchiveLeagueSeasonSummary>[];
  leagues?: LocalFlagged<ArchiveLeagueSummary>[];
  query?: string;
  language?: SettingsLanguage;
  seasonsError?: unknown;
  leaguesError?: unknown;
  truncated?: boolean;
  stale?: boolean;
  /** Every repository member the component reaches, in order, so "and nothing else" is observable. */
  recordRepositoryAccess?: string[];
} = {}) {
  const touched = options.recordRepositoryAccess;
  const listLeagueSeasons = vi.fn(async () => {
    if (options.seasonsError !== undefined) throw options.seasonsError;
    return {
      items: options.seasons ?? [seasonSummary()],
      totalCount: (options.seasons ?? [seasonSummary()]).length,
      fetchedAt: '2026-08-20T10:00:00.000Z',
      fromCache: false,
      stale: options.stale ?? false,
      truncated: options.truncated ?? false
    };
  });
  const listLeagues = vi.fn(async () => {
    if (options.leaguesError !== undefined) throw options.leaguesError;
    return {
      items: options.leagues ?? [leagueSummary()],
      totalCount: (options.leagues ?? [leagueSummary()]).length,
      fetchedAt: '2026-08-20T10:00:00.000Z',
      fromCache: false,
      stale: false,
      truncated: false
    };
  });
  const router = { navigate: vi.fn(async () => true) };
  const repository: Record<string, unknown> = { listLeagueSeasons, listLeagues };
  const injector = Injector.create({ providers: [
    {
      provide: ArchiveRepository,
      useValue: touched
        ? new Proxy(repository, {
          get(target, property: string | symbol) {
            // Angular probes `ngOnDestroy` and `name` on a `useValue` provider; only a real member
            // of the repository counts as the component reaching for it.
            if (typeof property === 'string' && property in target) touched.push(property);
            return Reflect.get(target, property) as unknown;
          }
        })
        : repository
    },
    // The row expansion reads through this port; the list itself never issues that read on load.
    { provide: ARCHIVE_SEASON_SOURCE, useValue: { listSeasonTournaments: async () => ({ items: [], fromCache: true }) } },
    { provide: ActivatedRoute, useValue: { queryParamMap: of(params(options.query ?? '')) } },
    { provide: Router, useValue: router },
    // The real service defaults to French and reads `localStorage`; the language is pinned here so
    // every rendered string is a stable assertion rather than a property of the test environment.
    { provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>(options.language ?? 'en') } },
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new LeagueSeasonListComponent());
  return { component, router, listLeagueSeasons, listLeagues };
}

const navigatedParams = (router: { navigate: ReturnType<typeof vi.fn> }, call = 0) =>
  router.navigate.mock.calls[call][1].queryParams;

describe('parseLeagueSeasonQuery', () => {
  it('defaults an empty query string', () => {
    expect(parseLeagueSeasonQuery(params(''))).toEqual({
      sort: 'lastPlayed', dir: 'desc', page: 1, size: 25, search: '', league: 'all'
    });
  });

  it('reads every parameter', () => {
    expect(parseLeagueSeasonQuery(params('sort=players&dir=asc&page=3&size=50&search=lyon&league=lg-1'), new Set(['lg-1'])))
      .toEqual({ sort: 'players', dir: 'asc', page: 3, size: 50, search: 'lyon', league: 'lg-1' });
  });

  it('rejects an unknown sort key', () => {
    expect(parseLeagueSeasonQuery(params('sort=rating')).sort).toBe('lastPlayed');
  });

  it('accepts all seven sort keys', () => {
    const keys: LeagueSeasonSortKey[] = ['name', 'leagueName', 'lastPlayed', 'updated', 'tournaments', 'players', 'status'];
    for (const key of keys) expect(parseLeagueSeasonQuery(params(`sort=${key}`)).sort).toBe(key);
  });

  it('rejects an unknown direction', () => {
    expect(parseLeagueSeasonQuery(params('dir=sideways')).dir).toBe('desc');
  });

  it('rejects a page size off the menu', () => {
    expect(parseLeagueSeasonQuery(params('size=30')).size).toBe(25);
  });

  it('accepts 25, 50 and 100', () => {
    expect(parseLeagueSeasonQuery(params('size=25')).size).toBe(25);
    expect(parseLeagueSeasonQuery(params('size=50')).size).toBe(50);
    expect(parseLeagueSeasonQuery(params('size=100')).size).toBe(100);
  });

  it('rejects a non-integer or zero page', () => {
    for (const raw of ['page=0', 'page=-2', 'page=abc', 'page=1.5']) {
      expect(parseLeagueSeasonQuery(params(raw)).page, raw).toBe(1);
    }
  });

  it('trims the search term', () => {
    expect(parseLeagueSeasonQuery(params('search=%20lyon%20')).search).toBe('lyon');
  });

  it('drops a League id the catalog does not know', () => {
    expect(parseLeagueSeasonQuery(params('league=ghost'), new Set(['lg-1'])).league).toBe(ALL_LEAGUES);
  });

  it('drops any League id when no catalog has landed', () => {
    expect(parseLeagueSeasonQuery(params('league=lg-1')).league).toBe(ALL_LEAGUES);
  });
});

describe('leagueSeasonQueryParams', () => {
  it('omits every default', () => {
    expect(leagueSeasonQueryParams(DEFAULT_LEAGUE_SEASON_QUERY)).toEqual({});
  });

  it('emits only what differs', () => {
    expect(leagueSeasonQueryParams({ ...DEFAULT_LEAGUE_SEASON_QUERY, page: 2, search: 'x' })).toEqual({ page: 2, search: 'x' });
  });

  it('round-trips', () => {
    const query: LeagueSeasonQuery = { sort: 'players', dir: 'asc', page: 3, size: 50, search: 'lyon', league: 'lg-1' };
    const emitted = leagueSeasonQueryParams(query) as Record<string, string>;
    expect(parseLeagueSeasonQuery(new URLSearchParams(emitted), new Set(['lg-1']))).toEqual(query);
  });
});

describe('toggleLeagueSeasonSort', () => {
  it('a new key starts descending', () => {
    expect(toggleLeagueSeasonSort(DEFAULT_LEAGUE_SEASON_QUERY, 'name')).toMatchObject({ sort: 'name', dir: 'desc', page: 1 });
  });

  it('the same key flips to ascending', () => {
    expect(toggleLeagueSeasonSort({ ...DEFAULT_LEAGUE_SEASON_QUERY, sort: 'name', dir: 'desc' }, 'name').dir).toBe('asc');
  });

  it('the same key flips back to descending', () => {
    expect(toggleLeagueSeasonSort({ ...DEFAULT_LEAGUE_SEASON_QUERY, sort: 'name', dir: 'asc' }, 'name').dir).toBe('desc');
  });

  it('any sort change returns to page 1', () => {
    expect(toggleLeagueSeasonSort({ ...DEFAULT_LEAGUE_SEASON_QUERY, page: 7 }, 'players').page).toBe(1);
  });
});

describe('buildLeagueSeasonRows', () => {
  const now = new Date('2026-08-22T00:00:00.000Z');
  const daysBefore = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

  it('joins the League name onto the Season row', () => {
    expect(buildLeagueSeasonRows([seasonSummary({ leagueId: 'lg-1' })], [leagueSummary({ id: 'lg-1', name: 'Ligue Lyon' })])[0].leagueName)
      .toBe('Ligue Lyon');
  });

  it('leaves the League name blank when the League is missing', () => {
    expect(buildLeagueSeasonRows([seasonSummary({ leagueId: 'lg-9' })], [])[0].leagueName).toBe('');
  });

  it('a Season with no Tournament is never locked', () => {
    expect(buildLeagueSeasonRows([seasonSummary({ lastTournamentDate: null })], [], now)[0].locked).toBe(false);
  });

  it('a Season whose latest Tournament is 400 days old is locked', () => {
    expect(buildLeagueSeasonRows([seasonSummary({ lastTournamentDate: daysBefore(400) })], [], now)[0].locked).toBe(true);
  });

  it('a Season whose latest Tournament is 365 days old is not locked', () => {
    expect(buildLeagueSeasonRows([seasonSummary({ lastTournamentDate: daysBefore(365) })], [], now)[0].locked).toBe(false);
  });

  it('a Season whose latest Tournament is 366 days old is locked', () => {
    expect(buildLeagueSeasonRows([seasonSummary({ lastTournamentDate: daysBefore(366) })], [], now)[0].locked).toBe(true);
  });

  /**
   * A browser-authored Season is always editable by the reader who wrote it, so the committed
   * `isLeagueSeasonRowLocked` exempts it whatever its date. T12's repository merges the browser-local
   * half into `listLeagueSeasons()`, so those rows really do reach this table.
   */
  it('never locks a browser-local Season, whatever its date', () => {
    expect(buildLeagueSeasonRows([seasonSummary({ id: 'local-1', lastTournamentDate: daysBefore(4000) })], [], now)[0].locked).toBe(false);
  });

  it('carries every catalog field through untouched', () => {
    const season = seasonSummary();
    expect(buildLeagueSeasonRows([season], [leagueSummary()])[0]).toMatchObject(season);
  });

  it('flags a browser-local Season', () => {
    const rows = buildLeagueSeasonRows([seasonSummary({ id: 'local-1', isLocal: true }), seasonSummary({ id: 's-1', isLocal: false })], []);

    expect(rows[0].isLocal).toBe(true);
    expect(rows[1].isLocal).toBe(false);
  });

  it('defaults isLocal to false for a bare wire summary', () => {
    expect(buildLeagueSeasonRows([seasonSummary()], [])[0].isLocal).toBe(false);
  });

  it('still locks an old server Season', () => {
    expect(buildLeagueSeasonRows([seasonSummary({ id: 's-1', lastTournamentDate: '1990-01-01' })], [], now)[0].locked).toBe(true);
  });

  it('never locks a browser-local Season however old it is', () => {
    // The lock keys on the `local-` id prefix, not on `isLocal`: one derivation for the whole app.
    expect(buildLeagueSeasonRows([seasonSummary({ id: 'local-1', isLocal: true, lastTournamentDate: '1990-01-01' })], [], now)[0].locked).toBe(false);
  });
});

describe('filterLeagueSeasonRows', () => {
  const rows = [
    row({ id: 's-1', name: 'Ligue Lyon 2026', leagueId: 'lg-1', leagueName: 'Ligue Lyon' }),
    row({ id: 's-2', name: 'Étape 12', leagueId: 'lg-1', leagueName: 'Ligue Lyon' }),
    row({ id: 's-3', name: 'Circuit 2026', leagueId: 'lg-2', leagueName: 'Circuit Nord' })
  ];

  it('no filter returns every row in order', () => {
    expect(filterLeagueSeasonRows(rows, { search: '', league: ALL_LEAGUES }).map((item) => item.id)).toEqual(['s-1', 's-2', 's-3']);
  });

  it('filters by League id', () => {
    expect(filterLeagueSeasonRows(rows, { search: '', league: 'lg-1' }).map((item) => item.id)).toEqual(['s-1', 's-2']);
  });

  it('matches the Season name, case-insensitively', () => {
    expect(filterLeagueSeasonRows(rows, { search: 'LYON', league: ALL_LEAGUES }).map((item) => item.name)).toContain('Ligue Lyon 2026');
  });

  it('matches the League name too', () => {
    expect(filterLeagueSeasonRows(rows, { search: 'lyon', league: ALL_LEAGUES }).map((item) => item.id)).toContain('s-2');
  });

  it('combines the League filter and the search', () => {
    expect(filterLeagueSeasonRows(rows, { search: '2026', league: 'lg-1' }).map((item) => item.id)).toEqual(['s-1']);
  });

  it('an unmatched search returns nothing', () => {
    expect(filterLeagueSeasonRows(rows, { search: 'vintage', league: ALL_LEAGUES })).toEqual([]);
  });
});

describe('sortLeagueSeasonRows', () => {
  const dated = [
    row({ id: 's-1', lastTournamentDate: '2026-03-01' }),
    row({ id: 's-2', lastTournamentDate: '2026-08-17' }),
    row({ id: 's-3', lastTournamentDate: '2025-11-30' })
  ];

  it('sorts by lastPlayed descending by default', () => {
    expect(sortLeagueSeasonRows(dated, 'lastPlayed', 'desc').map((item) => item.id)).toEqual(['s-2', 's-1', 's-3']);
  });

  it('sorts by lastPlayed ascending', () => {
    expect(sortLeagueSeasonRows(dated, 'lastPlayed', 'asc').map((item) => item.id)).toEqual(['s-3', 's-1', 's-2']);
  });

  it('a Season with no Tournament sorts last descending', () => {
    const rows = [...dated, row({ id: 's-4', lastTournamentDate: null })];
    expect(sortLeagueSeasonRows(rows, 'lastPlayed', 'desc').at(-1)?.id).toBe('s-4');
  });

  it('a Season with no Tournament sorts last ascending too', () => {
    const rows = [...dated, row({ id: 's-4', lastTournamentDate: null })];
    expect(sortLeagueSeasonRows(rows, 'lastPlayed', 'asc').at(-1)?.id).toBe('s-4');
  });

  it('sorts names naturally, not lexically', () => {
    const rows = [row({ id: 's-1', name: 'Season 10' }), row({ id: 's-2', name: 'Season 2' })];
    expect(sortLeagueSeasonRows(rows, 'name', 'asc').map((item) => item.name)).toEqual(['Season 2', 'Season 10']);
  });

  it('folds accents when sorting names', () => {
    const rows = [row({ id: 's-1', name: 'Zulu' }), row({ id: 's-2', name: 'Étape' }), row({ id: 's-3', name: 'Etape B' })];
    const names = sortLeagueSeasonRows(rows, 'name', 'asc').map((item) => item.name);
    expect(Math.abs(names.indexOf('Étape') - names.indexOf('Etape B'))).toBe(1);
  });

  it('sorts by tournaments numerically', () => {
    const rows = [row({ id: 's-1', tournamentCount: 10 }), row({ id: 's-2', tournamentCount: 2 })];
    expect(sortLeagueSeasonRows(rows, 'tournaments', 'asc').map((item) => item.tournamentCount)).toEqual([2, 10]);
  });

  it('sorts by players numerically', () => {
    const rows = [row({ id: 's-1', playerCount: 84 }), row({ id: 's-2', playerCount: 9 })];
    expect(sortLeagueSeasonRows(rows, 'players', 'asc').map((item) => item.playerCount)).toEqual([9, 84]);
  });

  it('sorts by updated chronologically', () => {
    const rows = [
      row({ id: 's-1', updatedAt: '2026-01-02T00:00:00.000Z' }),
      row({ id: 's-2', updatedAt: '2026-08-18T10:00:00.000Z' })
    ];
    expect(sortLeagueSeasonRows(rows, 'updated', 'desc').map((item) => item.id)).toEqual(['s-2', 's-1']);
  });

  it('sorts by leagueName', () => {
    const rows = [row({ id: 's-1', leagueName: 'Ligue' }), row({ id: 's-2', leagueName: 'Circuit' })];
    expect(sortLeagueSeasonRows(rows, 'leagueName', 'asc').map((item) => item.leagueName)).toEqual(['Circuit', 'Ligue']);
  });

  it('sorts by status', () => {
    const rows = [row({ id: 's-1', status: 'completed' }), row({ id: 's-2', status: 'active' })];
    expect(sortLeagueSeasonRows(rows, 'status', 'asc').map((item) => item.status)).toEqual(['active', 'completed']);
  });

  it('breaks every tie on id ascending, in both directions', () => {
    const rows = [row({ id: 'b', tournamentCount: 5 }), row({ id: 'a', tournamentCount: 5 })];
    expect(sortLeagueSeasonRows(rows, 'tournaments', 'asc').map((item) => item.id)).toEqual(['a', 'b']);
    expect(sortLeagueSeasonRows(rows, 'tournaments', 'desc').map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('never mutates the input array', () => {
    const rows = Object.freeze([row({ id: 'b' }), row({ id: 'a' })]) as readonly LeagueSeasonRow[];
    const sorted = sortLeagueSeasonRows(rows, 'name', 'asc');
    expect(sorted).not.toBe(rows);
    expect(rows.map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('league season list behaviour', () => {
  it('loads both catalogs once on construction', async () => {
    const { listLeagueSeasons, listLeagues } = buildComponent();
    await settled();

    expect(listLeagueSeasons).toHaveBeenCalledTimes(1);
    expect(listLeagues).toHaveBeenCalledTimes(1);
  });

  it('clears loading and publishes the sync stamp', async () => {
    const { component } = buildComponent();
    await settled();

    expect(component.loading()).toBe(false);
    expect(component.syncedAt()).toBe('2026-08-20T10:00:00.000Z');
  });

  it('surfaces a truncated Season catalog', async () => {
    const { component } = buildComponent({ truncated: true });
    await settled();

    expect(component.truncated()).toBe(true);
  });

  it('surfaces a stale read', async () => {
    const { component } = buildComponent({ stale: true });
    await settled();

    expect(component.stale()).toBe(true);
  });

  it('renders the failure message when the Season catalog rejects', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { component } = buildComponent({ seasonsError: new Error('offline') });
    await settled();

    expect(component.error()).toBe('Could not load the Archive. Check connection, then retry.');
    expect(component.loading()).toBe(false);
    logged.mockRestore();
  });

  it('survives a failed League catalog', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { component } = buildComponent({ leaguesError: new Error('offline'), seasons: [seasonSummary()] });
    await settled();

    expect(component.error()).toBe('');
    expect(component.rows()).toHaveLength(1);
    expect(component.rows()[0].leagueName).toBe('');
    expect(component.stale()).toBe(true);
    logged.mockRestore();
  });

  it('sync forces a refetch', async () => {
    const { component, listLeagueSeasons, listLeagues } = buildComponent();
    await settled();

    component.sync();
    await settled();

    expect(listLeagueSeasons).toHaveBeenLastCalledWith({ force: true });
    expect(listLeagues).toHaveBeenLastCalledWith({ force: true });
  });

  it('pages to 25 rows by default', async () => {
    const { component } = buildComponent({ seasons: manySeasons(60) });
    await settled();

    expect(component.pagedRows()).toHaveLength(25);
    expect(component.totalPages()).toBe(3);
    expect(component.currentPage()).toBe(1);
  });

  it('a page beyond the end clamps without navigating', async () => {
    const { component, router } = buildComponent({ seasons: manySeasons(5), query: 'page=9' });
    await settled();

    expect(component.currentPage()).toBe(1);
    expect(component.pagedRows()).toHaveLength(5);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('the second page holds different rows', async () => {
    const seasons = manySeasons(60);
    const first = buildComponent({ seasons });
    const second = buildComponent({ seasons, query: 'page=2' });
    await settled();

    const firstIds = new Set(first.component.pagedRows().map((item) => item.id));
    expect(second.component.pagedRows().some((item) => firstIds.has(item.id))).toBe(false);
  });

  it("sortByColumn navigates on the column's first key", async () => {
    const { component, router } = buildComponent();
    await settled();

    component.sortByColumn('datesUpdated');
    expect(navigatedParams(router)).toEqual({ dir: 'asc' });
  });

  it('sortByColumn on a new column starts descending and omits the default', async () => {
    const { component, router } = buildComponent();
    await settled();

    component.sortByColumn('counts');
    expect(navigatedParams(router)).toEqual({ sort: 'tournaments' });
  });

  it('ariaSort marks the column that owns the active key', async () => {
    const { component } = buildComponent({ query: 'sort=updated&dir=asc' });
    await settled();

    expect(component.ariaSort('datesUpdated')).toBe('ascending');
    expect(component.ariaSort('seasonLeague')).toBeNull();
  });

  it('ariaSort marks nothing else', async () => {
    const { component } = buildComponent({ query: 'sort=players' });
    await settled();

    expect(component.ariaSort('counts')).toBe('descending');
    expect(component.ariaSort('seasonLeague')).toBeNull();
    expect(component.ariaSort('datesUpdated')).toBeNull();
    expect(component.ariaSort('status')).toBeNull();
  });

  it('setSort keeps the direction and returns to page 1', async () => {
    const { component, router } = buildComponent({ query: 'sort=name&dir=asc&page=4' });
    await settled();

    component.setSort('players');
    expect(navigatedParams(router)).toEqual({ sort: 'players', dir: 'asc' });
  });

  it('toggleDirection flips and returns to page 1', async () => {
    const { component, router } = buildComponent({ query: 'page=4' });
    await settled();

    component.toggleDirection();
    expect(navigatedParams(router)).toEqual({ dir: 'asc' });
  });

  it('setLeague navigates and returns to page 1', async () => {
    const { component, router } = buildComponent();
    await settled();

    component.setLeague('lg-1');
    expect(navigatedParams(router)).toEqual({ league: 'lg-1' });
  });

  it('setSize navigates and returns to page 1', async () => {
    const { component, router } = buildComponent();
    await settled();

    component.setSize(50);
    expect(navigatedParams(router)).toEqual({ size: 50 });
  });

  it('search is debounced by 300 ms', async () => {
    const { component, router } = buildComponent();
    await settled();
    vi.useFakeTimers();

    component.setSearchDraft('ly');
    vi.advanceTimersByTime(299);
    expect(router.navigate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(navigatedParams(router)).toEqual({ search: 'ly' });
    vi.useRealTimers();
  });

  it('a second keystroke restarts the debounce', async () => {
    const { component, router } = buildComponent();
    await settled();
    vi.useFakeTimers();

    component.setSearchDraft('l');
    vi.advanceTimersByTime(200);
    component.setSearchDraft('ly');
    vi.advanceTimersByTime(300);

    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(navigatedParams(router)).toEqual({ search: 'ly' });
    vi.useRealTimers();
  });

  it('clearSearch empties the draft and the query', async () => {
    const { component, router } = buildComponent({ query: 'search=vintage' });
    await settled();
    vi.useFakeTimers();

    component.clearSearch();
    vi.advanceTimersByTime(300);

    expect(component.searchDraft()).toBe('');
    expect(navigatedParams(router)).toEqual({});
    vi.useRealTimers();
  });

  it('ngOnDestroy cancels a pending debounce', async () => {
    const { component, router } = buildComponent();
    await settled();
    vi.useFakeTimers();

    component.setSearchDraft('x');
    component.ngOnDestroy();
    vi.advanceTimersByTime(500);

    expect(router.navigate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('filtered() is false with no filter and true with either', async () => {
    const plain = buildComponent();
    const searched = buildComponent({ query: 'search=x' });
    const scoped = buildComponent({ query: 'league=lg-1' });
    await settled();

    expect(plain.component.filtered()).toBe(false);
    expect(searched.component.filtered()).toBe(true);
    expect(scoped.component.filtered()).toBe(true);
  });

  it('filterLabel quotes the search term when there is one', async () => {
    const { component } = buildComponent({ query: 'search=vintage&league=lg-1' });
    await settled();

    expect(component.filterLabel()).toBe('vintage');
  });

  it("filterLabel quotes the filtered League's name when there is no search", async () => {
    const { component } = buildComponent({ query: 'league=lg-1' });
    await settled();

    expect(component.filterLabel()).toBe('Ligue Lyon');
  });

  it('filterLabel is empty with no filter at all', async () => {
    const { component } = buildComponent();
    await settled();

    expect(component.filterLabel()).toBe('');
  });

  it('formatDate renders an em dash for a null date', async () => {
    const { component } = buildComponent();
    await settled();

    expect(component.formatDate(null)).toBe('—');
  });

  it('leagueLabel falls back to the unknown-League message', async () => {
    const { component } = buildComponent();
    await settled();

    expect(component.leagueLabel(row({ leagueName: '' }))).toBe('Unknown League');
  });

  it('reads the unioned catalogs and nothing else off the repository', async () => {
    const touched: string[] = [];
    const { component } = buildComponent({ recordRepositoryAccess: touched });
    await settled();

    expect(touched).toEqual(['listLeagueSeasons', 'listLeagues']);
    expect(component.rows()).toHaveLength(1);
  });

  it('searches a browser-local Season beside a server one', async () => {
    const { component } = buildComponent({
      seasons: [seasonSummary({ id: 'local-1', name: 'Home Season', isLocal: true }), seasonSummary({ id: 's-1', name: 'Away Season' })],
      query: 'search=home'
    });
    await settled();

    expect(component.pagedRows().map((item) => item.id)).toEqual(['local-1']);
  });

  it('applies the League filter to a browser-local Season', async () => {
    const { component } = buildComponent({
      seasons: [seasonSummary({ id: 'local-1', leagueId: 'local-L', isLocal: true }), seasonSummary({ id: 's-1', leagueId: 'lg-1' })],
      leagues: [leagueSummary({ id: 'local-L', name: 'Browser League', isLocal: true }), leagueSummary()],
      query: 'league=local-L'
    });
    await settled();

    expect(component.pagedRows().map((item) => item.id)).toEqual(['local-1']);
  });

  it('sorts a browser-local Season among the server rows', async () => {
    const { component } = buildComponent({
      seasons: [
        seasonSummary({ id: 's-1', lastTournamentDate: '2025-01-01' }),
        seasonSummary({ id: 'local-1', lastTournamentDate: '2026-01-01', isLocal: true })
      ]
    });
    await settled();

    expect(component.pagedRows()[0].id).toBe('local-1');
  });

  it('counts a browser-local Season in the pager and reaches it on page 2', async () => {
    const seasons = [...manySeasons(25), seasonSummary({ id: 'local-1', lastTournamentDate: '2020-01-01', isLocal: true })];
    const first = buildComponent({ seasons });
    const second = buildComponent({ seasons, query: 'page=2' });
    await settled();

    expect(first.component.totalRows()).toBe(26);
    expect(first.component.totalPages()).toBe(2);
    expect(first.component.pagedRows().some((item) => item.isLocal)).toBe(false);
    expect(second.component.pagedRows().map((item) => item.id)).toEqual(['local-1']);
  });

  it('holds a local row only when this browser authored one', async () => {
    const serverOnly = buildComponent();
    const withLocal = buildComponent({ seasons: [seasonSummary({ id: 'local-1', isLocal: true })] });
    await settled();

    expect(serverOnly.component.hasLocalRows()).toBe(false);
    expect(withLocal.component.hasLocalRows()).toBe(true);
  });

  it('never locks a browser-local row it renders', async () => {
    const { component } = buildComponent({ seasons: [seasonSummary({ id: 'local-1', lastTournamentDate: '1990-01-01', isLocal: true })] });
    await settled();

    expect(component.pagedRows()[0].locked).toBe(false);
  });

  it('statusLabel translates both statuses', async () => {
    const en = buildComponent();
    const fr = buildComponent({ language: 'fr' });
    await settled();

    expect(en.component.statusLabel(row({ status: 'active' }))).toBe('Active');
    expect(en.component.statusLabel(row({ status: 'completed' }))).toBe('Completed');
    expect(fr.component.statusLabel(row({ status: 'active' }))).toBe('Active');
    expect(fr.component.statusLabel(row({ status: 'completed' }))).toBe('Terminée');
  });
});

function manySeasons(count: number): LocalFlagged<ArchiveLeagueSeasonSummary>[] {
  return Array.from({ length: count }, (_, index) =>
    seasonSummary({ id: `s-${String(index).padStart(2, '0')}`, name: `Season ${index}` }));
}

describe('league season list template', () => {
  it('renders exactly four header cells', () => {
    expect(source.match(/<th /g)).toHaveLength(4);
  });

  it('each header carries aria-sort and a real button', () => {
    expect(source).toContain(`[attr.aria-sort]="ariaSort('seasonLeague')"`);
    expect(source).toContain(`[attr.aria-sort]="ariaSort('datesUpdated')"`);
    expect(source).toContain(`[attr.aria-sort]="ariaSort('counts')"`);
    expect(source).toContain(`[attr.aria-sort]="ariaSort('status')"`);
    expect(source.match(/type="button" class="archive-sort-button"/g)).toHaveLength(4);
  });

  it('the header labels are the paired ones', () => {
    for (const key of ['archive.colSeasonLeague', 'archive.colLastPlayedUpdated', 'archive.colTournamentsPlayers', 'archive.colStatus']) {
      expect(source).toContain(key);
    }
  });

  it('the Season name cell is the link', () => {
    const cell = source.indexOf(`'archive-seasons-cell-name-'`);
    const nextCell = source.indexOf(`'archive-seasons-cell-dates-'`);
    expect(cell).toBeGreaterThan(-1);
    expect(nextCell).toBeGreaterThan(cell);
    expect(source.slice(cell, nextCell)).toContain(`[routerLink]="['/archive/league-seasons', row.id]"`);
  });

  it('the row expands one level, and never into a second table', () => {
    // The Tournaments tab ticket made the row interactive; what stays forbidden is a nested table
    // and a second expansion vocabulary beside the one the shared read path drives. `aria-expanded`
    // sits on the expander button, never on the `<tr>` — see the axe `aria-conditional-attr` rule.
    const expanderStart = source.indexOf('<button type="button" class="archive-expand"');
    expect(expanderStart, 'the expander button').toBeGreaterThan(-1);
    const expander = source.slice(expanderStart, source.indexOf('</button>', expanderStart));
    expect(expander).toContain('[attr.aria-expanded]="isSeasonExpanded(row.id)"');
    expect(expander).toContain('[attr.aria-controls]="seasonChildrenRowId(row.id)"');
    expect(source).toContain('[id]="seasonChildrenRowId(row.id)"');
    expect(source).not.toContain('toggleExpansion(');
    expect(source).not.toContain('archive-seasons-chevron');
    expect(source).not.toContain('archive-seasons-kids');
  });

  it('every row carries both values of all three paired cells', () => {
    expect(source).toContain('archive-seasons-league-');
    expect(source).toContain('archive-seasons-updated-');
    expect(source).toContain('archive-seasons-players-');
  });

  it('the lock marker is visible on a locked row and only there', () => {
    expect(source.match(/data-cy\]="'archive-seasons-lock-/g)).toHaveLength(1);
    expect(templateBlock('@if (row.locked) {')).toContain(`'archive-seasons-lock-'`);
  });

  it('the local badge is rendered on a browser-local row and only there', () => {
    expect(source.match(/data-cy\]="'archive-seasons-local-badge-/g)).toHaveLength(1);
    const badge = templateBlock('@if (row.isLocal) {');
    expect(badge).toContain(`'archive-seasons-local-badge-'`);
    expect(badge).toContain(`i18n.t('archive.localBadge')`);
    // The name cell, beside the Season link — not a fifth column.
    const nameCell = source.slice(source.indexOf(`'archive-seasons-cell-name-'`), source.indexOf(`'archive-seasons-cell-dates-'`));
    expect(nameCell).toContain(`'archive-seasons-local-badge-'`);
  });

  it('the local notice is rendered only when this browser holds a row', () => {
    expect(templateBlock('@if (hasLocalRows()) {')).toContain('archive-seasons-local-notice');
    expect(source).toContain(`i18n.t('archive.localNotice')`);
  });

  it('the lock marker is announced', () => {
    expect(source).toContain('role="img"');
    expect(source).toContain(`i18n.t('archive.lockedAria')`);
  });

  it('the status chip reuses the shared classes', () => {
    expect(source).toContain('class="status"');
    expect(source).toContain('class="status-dot"');
  });

  it('the skeleton renders five rows inside the real table', () => {
    expect(source).toContain('@for (index of skeletonRows; track index)');
    expect(source).toContain('skeletonRows = [0, 1, 2, 3, 4]');
  });

  it('the empty state spans all four columns', () => {
    expect(source).toContain('colspan="4"');
  });

  it('the empty state distinguishes a filtered miss from an empty archive', () => {
    expect(source).toContain('archive.emptySearchTitle');
    expect(source).toContain('archive.emptyTitle');
  });

  it('the truncation warning is a status region', () => {
    expect(source).toContain('class="warning" role="status"');
    expect(source).toContain('archive.truncatedSeasons');
  });

  it('the load failure is an alert', () => {
    expect(source).toContain('class="error" role="alert"');
  });

  it('the page status is a live region', () => {
    expect(source).toContain('aria-live="polite" data-cy="archive-seasons-page-status"');
  });

  it('previous is disabled on page 1 and next on the last page', () => {
    expect(source).toContain('[disabled]="currentPage() <= 1"');
    expect(source).toContain('[disabled]="currentPage() >= totalPages()"');
  });

  it('the pager nav is labelled', () => {
    expect(source).toContain(`i18n.t('archive.paginationAria')`);
  });

  it('every select is labelled by a real label element', () => {
    for (const id of ['archive-seasons-search', 'archive-seasons-league', 'archive-seasons-sort', 'archive-seasons-size']) {
      expect(source).toContain(`for="${id}"`);
    }
  });

  it('the sort select offers all seven keys', () => {
    expect(source).toContain('@for (key of sortKeys; track key)');
    expect(source).toContain('sortKeys = LEAGUE_SEASON_SORT_KEYS');
  });

  it('hardcodes no colour', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|oklch\(/);
  });

  it('the table keeps the shared wrapper classes', () => {
    expect(source).toContain('class="table-wrap"');
    expect(source).toContain('class="ranking-table archive-table"');
  });

  it('names no browser store', () => {
    expect(source).not.toMatch(/localStorage|indexedDB|IDB[A-Z]/);
  });

  it('calls no mutation', () => {
    expect(source).not.toMatch(/createLeagueSeason|invalidateArchiveCaches|deleteLeagueSeason/);
  });

  it('carries both back buttons', () => {
    expect(source).toContain('position="top"');
    expect(source).toContain('position="bottom"');
  });
});

describe('archive routes', () => {
  const allCapabilities = { authV1: true, adminV1: true };
  const routeFor = (path: string, features = allCapabilities) => buildRoutes(features).find((route) => route.path === path);

  it('registers the archive index redirect', () => {
    expect(routeFor('archive')).toMatchObject({ path: 'archive', pathMatch: 'full', redirectTo: 'archive/league-seasons' });
  });

  it('registers the League Seasons tab', () => {
    expect(typeof routeFor('archive/league-seasons')?.loadComponent).toBe('function');
  });

  it('registers the Tournaments tab', () => {
    expect(typeof routeFor('archive/tournaments')?.loadComponent).toBe('function');
    expect(routeFor('archive/tournaments')?.redirectTo).toBeUndefined();
  });

  it('registers the Season detail route the tab 1 rows link to', () => {
    expect(typeof routeFor('archive/league-seasons/:seasonId')?.loadComponent).toBe('function');
  });

  // T13 asserted the legacy routes were left in place beside the new ones. T19 retired them, so the
  // same two cases now assert their absence — the expand step's guarantee inverted by the contract step.
  it('registers no legacy archive route', () => {
    for (const path of [
      'leagues-archive',
      'leagues-archive/:leagueId',
      'leagues-archive/:leagueId/tournaments-archive/:tournamentId',
      'leagues-archive/:leagueId/tournaments-archive/:tournamentId/result',
      'leagues-archive/:leagueId/tournaments-archive/:tournamentId/result/metagames'
    ]) {
      expect(routeFor(path), path).toBeUndefined();
    }
  });

  it('registers no legacy redirect', () => {
    expect(routeFor('leagues')).toBeUndefined();
    expect(routeFor('leagues/:leagueId')).toBeUndefined();
  });

  it('archive routes are registered whatever the capability flags', () => {
    for (const features of [{ authV1: false, adminV1: false }, allCapabilities]) {
      for (const path of ['archive', 'archive/league-seasons', 'archive/tournaments']) {
        expect(routeFor(path, features), `${path} @ ${JSON.stringify(features)}`).toBeDefined();
      }
    }
  });
});

describe('archive breadcrumbs', () => {
  const en: Translator = (key, translationParams) => translate('en', key, translationParams);
  const labels = async (path: string, translator?: Translator) =>
    (await buildBreadcrumbs(path, translator)).map((crumb) => crumb.label);

  it('labels /archive as Archive in EN', async () => {
    expect(await labels('/archive', en)).toEqual(['Menu', 'Archive']);
  });

  it('labels /archive/league-seasons as Archive in EN', async () => {
    const crumbs = await buildBreadcrumbs('/archive/league-seasons', en);
    expect(crumbs.map((crumb) => crumb.label)).toEqual(['Menu', 'Archive']);
    expect(crumbs[1].link).toBeUndefined();
  });

  it('labels /archive in FR', async () => {
    expect(await labels('/archive/league-seasons')).toEqual(['Menu', 'Archive']);
  });

  it('does not fall through to Not Found', async () => {
    const crumbs = await labels('/archive/league-seasons', en);
    expect(crumbs).not.toContain('Not Found');
    expect(await labels('/archive')).not.toContain('Introuvable');
  });

  it('reads the retired archive path as Not Found', async () => {
    expect(await labels('/leagues-archive', en)).toEqual(['Menu', 'Not Found']);
  });
});

const NEW_MESSAGE_KEYS: MessageKey[] = [
  'crumb.archive', 'archive.title', 'archive.tabsAria', 'archive.tabLeagueSeasons', 'archive.tabTournaments',
  'archive.seasonsAria', 'archive.colSeasonLeague', 'archive.colLastPlayedUpdated', 'archive.colTournamentsPlayers',
  'archive.colStatus', 'archive.sortByAria', 'archive.sortLabel', 'archive.sortName', 'archive.sortLeagueName',
  'archive.sortLastPlayed', 'archive.sortUpdated', 'archive.sortTournaments', 'archive.sortPlayers',
  'archive.sortStatus', 'archive.ascending', 'archive.descending', 'archive.directionToggleAria',
  'archive.searchLabel', 'archive.searchPlaceholder', 'archive.leagueFilterLabel', 'archive.leagueFilterAll',
  'archive.sizeLabel', 'archive.updatedPrefix', 'archive.tournamentsValue', 'archive.playersValue',
  'archive.unknownLeague', 'archive.lockedAria', 'archive.lockedTitle', 'archive.openSeasonAria',
  'archive.pageStatus', 'archive.pageIndicator', 'archive.paginationAria', 'archive.emptyTitle',
  'archive.emptyBody', 'archive.emptySearchTitle', 'archive.emptySearchBody', 'archive.truncatedSeasons',
  'archive.loadFailed'
];

describe('archive messages', () => {
  it('every new key exists in en and fr', () => {
    expect(NEW_MESSAGE_KEYS).toHaveLength(43);
    for (const key of NEW_MESSAGE_KEYS) {
      expect(catalogs.en[key], `en ${key}`).toBeTruthy();
      expect(catalogs.fr[key], `fr ${key}`).toBeTruthy();
    }
  });

  it('no new key is left as its English text in French', () => {
    for (const key of ['archive.tabLeagueSeasons', 'archive.searchPlaceholder', 'archive.emptyTitle', 'archive.loadFailed'] as MessageKey[]) {
      expect(catalogs.fr[key], key).not.toBe(catalogs.en[key]);
    }
  });

  it('the interpolations survive translation', () => {
    for (const token of ['{page}', '{total}', '{count}']) {
      expect(catalogs.fr['archive.pageStatus']).toContain(token);
    }
    expect(catalogs.fr['archive.updatedPrefix']).toContain('{date}');
    expect(catalogs.fr['archive.openSeasonAria']).toContain('{name}');
  });

  it('no legacy archive key was replaced', () => {
    expect(catalogs.en['archive.markComplete']).toBe('Mark complete');
    expect(catalogs.en['archive.reopen']).toBe('Reopen');
  });
});
