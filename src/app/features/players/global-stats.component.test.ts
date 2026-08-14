import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { Client } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { GlobalStatsComponent } from './global-stats.component';
import { catalogs } from '../../i18n/messages';

const source = readFileSync(join(__dirname, 'global-stats.component.ts'), 'utf8');

// ---------------------------------------------------------------------------
// Template structure checks (source-text, same pattern as home-menu.test.ts)
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
      // Find the header element for this column and confirm it carries a sort click handler
      const idx = source.indexOf(`"${cy}"`);
      const vicinity = source.slice(Math.max(0, idx - 200), idx + 300);
      expect(vicinity, `${cy} missing click handler`).toMatch(/\(click\)/);
    }
  });

  it('non-sortable column headers have no click handler on the header cell', () => {
    for (const cy of NOT_SORTABLE) {
      // Extract a window around the header data-cy; its direct element should not have (click)
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
});

// ---------------------------------------------------------------------------
// Format helpers (instantiate with a minimal injector)
// ---------------------------------------------------------------------------

function buildComponent() {
  const getGlobalPlayerStatistics = vi.fn(() => of({
    items: [],
    page: 1,
    pageSize: 100,
    totalCount: 0,
    sort: undefined,
    direction: undefined,
  }));
  const client = { getGlobalPlayerStatistics } as unknown as Client;
  const route = {
    queryParamMap: of({
      keys: [],
      has: () => false,
      get: () => null,
      getAll: () => [],
    }),
  } as unknown as ActivatedRoute;
  const router = { navigate: vi.fn(async () => true) } as unknown as Router;

  const injector = Injector.create({
    providers: [
      { provide: Client, useValue: client },
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: router },
      DeckArchetypeSettingsService,
      I18nService,
    ],
  });

  return runInInjectionContext(injector, () => new GlobalStatsComponent());
}

describe('GlobalStatsComponent — format helpers', () => {
  it('formatPct returns "—" for null/undefined', () => {
    const comp = buildComponent();
    expect(comp.formatPct(null)).toBe('—');
    expect(comp.formatPct(undefined)).toBe('—');
  });

  it('formatPct returns whole-number percentage for non-null', () => {
    const comp = buildComponent();
    expect(comp.formatPct(0.75)).toBe('75%');
    expect(comp.formatPct(1)).toBe('100%');
    expect(comp.formatPct(0)).toBe('0%');
    expect(comp.formatPct(0.333)).toBe('33%');
  });

  it('formatOpponent returns "—" for null/undefined', () => {
    const comp = buildComponent();
    expect(comp.formatOpponent(null)).toBe('—');
    expect(comp.formatOpponent(undefined)).toBe('—');
  });

  it('formatOpponent returns "Name (W-L)" for a record', () => {
    const comp = buildComponent();
    expect(comp.formatOpponent({ name: 'Alice', wins: 3, losses: 1 })).toBe('Alice (3-1)');
  });

  it('formatArchetype returns "—" for null/undefined', () => {
    const comp = buildComponent();
    expect(comp.formatArchetype(null)).toBe('—');
    expect(comp.formatArchetype(undefined)).toBe('—');
  });

  it('formatArchetype returns "Name (N matches)" for a record', () => {
    const comp = buildComponent();
    expect(comp.formatArchetype({ name: 'Delver', matchCount: 7 })).toBe('Delver (7 matches)');
  });
});

describe('GlobalStatsComponent — initial API call', () => {
  it('calls getGlobalPlayerStatistics on init with default params', () => {
    const getGlobalPlayerStatistics = vi.fn(() => of({
      items: [],
      page: 1,
      pageSize: 100,
      totalCount: 0,
      sort: undefined,
      direction: undefined,
    }));
    const client = { getGlobalPlayerStatistics } as unknown as Client;
    const route = {
      queryParamMap: of({
        keys: [],
        has: () => false,
        get: () => null,
        getAll: () => [],
      }),
    } as unknown as ActivatedRoute;
    const router = { navigate: vi.fn(async () => true) } as unknown as Router;
    const injector = Injector.create({
      providers: [
        { provide: Client, useValue: client },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
        DeckArchetypeSettingsService,
        I18nService,
      ],
    });
    runInInjectionContext(injector, () => new GlobalStatsComponent());
    expect(getGlobalPlayerStatistics).toHaveBeenCalledWith(1, 100, undefined, undefined, undefined);
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
