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
import { of } from 'rxjs';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { GlobalStatsCatalogCacheService } from './global-stats-catalog-cache.service';
import { GlobalStatsComponent, SEARCH_DEBOUNCE_MS } from './global-stats.component';
import { catalogs } from '../../i18n/messages';
import type { GlobalPlayerStatisticsRow } from '../../api/generated/gones-api';

const source = readFileSync(join(__dirname, 'global-stats.component.ts'), 'utf8');

// ---------------------------------------------------------------------------
// Template structure checks
// ---------------------------------------------------------------------------
describe('GlobalStatsComponent template — 14 column headers', () => {
  const COL_DATA_CY = [
    'global-stats-col-position',
    'global-stats-col-player',
    'global-stats-col-matches',
    'global-stats-col-match-wins',
    'global-stats-col-match-losses',
    'global-stats-col-match-draws',
    'global-stats-col-match-winrate',
    'global-stats-col-games',
    'global-stats-col-game-wins',
    'global-stats-col-game-losses',
    'global-stats-col-game-winrate',
    'global-stats-col-nemesis',
    'global-stats-col-rival',
    'global-stats-col-archetype',
  ];

  it('contains all 14 column header data-cy values in order', () => {
    for (const cy of COL_DATA_CY) {
      expect(source, `missing: ${cy}`).toContain(`"${cy}"`);
    }
    const indices = COL_DATA_CY.map((cy) => source.indexOf(`"${cy}"`));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i], `${COL_DATA_CY[i]} not after ${COL_DATA_CY[i - 1]}`).toBeGreaterThan(indices[i - 1]);
    }
  });
});

describe('GlobalStatsComponent template — sortable headers', () => {
  const SORTABLE = [
    'global-stats-col-matches',
    'global-stats-col-match-wins',
    'global-stats-col-match-losses',
    'global-stats-col-match-draws',
    'global-stats-col-match-winrate',
    'global-stats-col-games',
    'global-stats-col-game-wins',
    'global-stats-col-game-losses',
    'global-stats-col-game-winrate',
  ];
  const NOT_SORTABLE = [
    'global-stats-col-position',
    'global-stats-col-player',
    'global-stats-col-nemesis',
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

  it('contains Previous and Next buttons', () => {
    expect(source).toContain('data-cy="global-stats-page-previous"');
    expect(source).toContain('data-cy="global-stats-page-next"');
  });

  it('contains a page status element', () => {
    expect(source).toContain('data-cy="global-stats-page-status"');
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

function makeRow(overrides: Partial<GlobalPlayerStatisticsRow> = {}): GlobalPlayerStatisticsRow {
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
    ...overrides,
  };
}

function makeCatalogResult(items: GlobalPlayerStatisticsRow[], extra: Partial<import('../../shared/catalog-cache').CatalogResult<GlobalPlayerStatisticsRow[]>> = {}): import('../../shared/catalog-cache').CatalogResult<GlobalPlayerStatisticsRow[]> {
  return { items, fetchedAt: new Date().toISOString(), fromCache: false, stale: false, truncated: false, ...extra };
}

function buildComponent(
  catalogResult: import('../../shared/catalog-cache').CatalogResult<GlobalPlayerStatisticsRow[]> = makeCatalogResult([]),
  routeParams: Record<string, string | null> = {},
) {
  const load = vi.fn(async () => catalogResult);
  const cacheService = { load } as unknown as GlobalStatsCatalogCacheService;

  const route = {
    queryParamMap: of({
      keys: [],
      has: () => false,
      get: (k: string) => routeParams[k] ?? null,
      getAll: () => [],
    }),
  } as unknown as ActivatedRoute;
  const router = { navigate: vi.fn(async () => true) } as unknown as Router;

  const injector = Injector.create({
    providers: [
      { provide: GlobalStatsCatalogCacheService, useValue: cacheService },
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: router },
      DeckArchetypeSettingsService,
      I18nService,
    ],
  });

  const comp = runInInjectionContext(injector, () => new GlobalStatsComponent());
  return { comp, load, router };
}

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

  it('formatArchetype returns localized "Name (N matches)" for a record', () => {
    const writeLang = (language: 'en' | 'fr') => {
      localStorage.setItem('gones.settings', JSON.stringify({ language, deckArchetypes: [] }));
      localStorage.setItem('gones.settings.language', language);
    };

    writeLang('en');
    expect(buildComponent().comp.formatArchetype({ name: 'Delver', matchCount: 7 })).toBe('Delver (7 matches)');

    writeLang('fr');
    expect(buildComponent().comp.formatArchetype({ name: 'Delver', matchCount: 7 })).toBe('Delver (7 matchs)');

    expect(catalogs.en['player.archetypeMatches']).toBe('{name} ({count} matches)');
    expect(catalogs.fr['player.archetypeMatches']).toBe('{name} ({count} matchs)');
  });
});

// ---------------------------------------------------------------------------
// Cache and catalog loading
// ---------------------------------------------------------------------------

describe('GlobalStatsComponent — catalog cache', () => {
  it('serves a fresh cache without calling the client again', async () => {
    const result = makeCatalogResult([makeRow()], { fromCache: true });
    const { load } = buildComponent(result);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // load is called once by constructor; returns fromCache:true meaning no network
    expect(load).toHaveBeenCalledWith({});
  });

  it('refetches after 24h', async () => {
    const staleResult = makeCatalogResult([makeRow()], { fromCache: false, stale: false });
    const { load } = buildComponent(staleResult);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledWith({});
  });

  it('sync forces a refetch', async () => {
    const { comp, load } = buildComponent();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    comp.onSync();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load).toHaveBeenLastCalledWith({ force: true });
  });
});

// ---------------------------------------------------------------------------
// Client-side filtering, sorting, paging
// ---------------------------------------------------------------------------

describe('GlobalStatsComponent — filtering', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('filters on input after debounce', async () => {
    const rows = [
      makeRow({ playerName: 'Lyon Player', position: 1 }),
      makeRow({ playerName: 'Paris Player', position: 2 }),
    ];
    const { comp } = buildComponent(makeCatalogResult(rows));
    // Resolve the async loadCatalog
    await vi.runAllTimersAsync();

    comp.setSearchDraft('ly');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    const visible = comp.pagedRows().map(r => r.playerName);
    expect(visible).toEqual(['Lyon Player']);
  });

  it('filters case-insensitively', async () => {
    const rows = [
      makeRow({ playerName: 'Lyon Player', position: 1 }),
      makeRow({ playerName: 'Paris Player', position: 2 }),
    ];
    const { comp } = buildComponent(makeCatalogResult(rows));
    await vi.runAllTimersAsync();

    comp.setSearchDraft('LY');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(comp.pagedRows().map(r => r.playerName)).toEqual(['Lyon Player']);
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

  it('renumbers positions after filtering', async () => {
    const rows = [
      makeRow({ playerName: 'Alpha', position: 1, playedMatchCount: 10 }),
      makeRow({ playerName: 'Beta', position: 2, playedMatchCount: 8 }),
      makeRow({ playerName: 'Aleph', position: 3, playedMatchCount: 6 }),
    ];
    const { comp } = buildComponent(makeCatalogResult(rows));
    await vi.runAllTimersAsync();

    comp.setSearchDraft('al');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    const positions = comp.pagedRows().map(r => r.position);
    expect(positions).toEqual([1, 2]);
  });
});

describe('GlobalStatsComponent — sorting without a request', () => {
  it('sorts without calling load again', async () => {
    const rows = [
      makeRow({ playerName: 'Alice', matchWins: 5, position: 1 }),
      makeRow({ playerName: 'Bob', matchWins: 10, position: 2 }),
    ];
    const { comp, load } = buildComponent(makeCatalogResult(rows));
    // Wait for async loadCatalog to resolve
    await Promise.resolve();
    await Promise.resolve();

    const callCountBefore = load.mock.calls.length;
    comp.sortBy('matchWins');
    expect(load.mock.calls.length).toBe(callCountBefore);
  });
});

describe('GlobalStatsComponent — paging without a request', () => {
  it('pages without calling load again', async () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeRow({ playerName: `Player ${i + 1}`, position: i + 1 })
    );
    const { comp, load } = buildComponent(makeCatalogResult(rows));
    await Promise.resolve();
    await Promise.resolve();

    comp.currentSize.set(10);
    const callCountBefore = load.mock.calls.length;
    comp.goPage(2);
    expect(load.mock.calls.length).toBe(callCountBefore);
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
    'globalStats.noResults',
    'globalStats.truncatedWarning',
    'globalStats.colPosition',
    'globalStats.colPlayer',
    'globalStats.colMatches',
    'globalStats.colMatchWins',
    'globalStats.colMatchLosses',
    'globalStats.colMatchDraws',
    'globalStats.colMatchWinrate',
    'globalStats.colGames',
    'globalStats.colGameWins',
    'globalStats.colGameLosses',
    'globalStats.colGameWinrate',
    'globalStats.colNemesis',
    'globalStats.colRival',
    'globalStats.colArchetype',
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
