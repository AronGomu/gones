import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { createLeague } from '../../domain/models';
import { I18nService } from '../../i18n/i18n.service';
import { GlobalStatsCatalogCacheService } from '../players/global-stats-catalog-cache.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { signal } from '@angular/core';
import { LeagueArchiveDetailComponent } from './league-archive-detail.component';

function buildLeague() {
  return { ...createLeague({ id: 'league-1', name: 'Test League', status: 'active', tournaments: [] }), documentVersion: 1 };
}

function catalogItems(items: Array<{ playerName: string; rating: number }>) {
  return items.map(({ playerName, rating }) => ({
    playerName,
    rating,
    position: 1,
    playedMatchCount: 0,
    matchWins: 0,
    matchLosses: 0,
    matchDraws: 0,
    matchWinrate: 0,
    playedGameCount: 0,
    gameWins: 0,
    gameLosses: 0,
    gameWinrate: 0,
    ratingDeviation: 350,
    previousRating: rating,
    lastRatingDelta: 0,
    tournamentsPlayed: 0,
    lastPlayedDate: '2026-01-01',
    provisional: false,
    inactive: false,
  }));
}

async function build(options: {
  catalogItems?: Array<{ playerName: string; rating: number }>;
  catalogError?: unknown;
} = {}) {
  const league = buildLeague();
  const repo = {
    getLeague: vi.fn(async () => league),
  } as unknown as LeagueArchiveRepository;
  const router = { navigate: vi.fn() } as unknown as Router;
  const catalogLoad = options.catalogError
    ? vi.fn().mockRejectedValue(options.catalogError)
    : vi.fn().mockResolvedValue({
        items: catalogItems(options.catalogItems ?? []),
        fetchedAt: '2026-08-20T00:00:00Z',
        fromCache: false,
        stale: false,
        truncated: false,
      });
  const catalogCache = { load: catalogLoad } as unknown as GlobalStatsCatalogCacheService;

  const injector = Injector.create({ providers: [
    { provide: LeagueArchiveRepository, useValue: repo },
    { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['leagueId', 'league-1']]) } } },
    { provide: Router, useValue: router },
    { provide: AuthService, useValue: { profile: signal(null) } },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(false) } },
    { provide: GlobalStatsCatalogCacheService, useValue: catalogCache },
    DeckArchetypeSettingsService,
    I18nService,
  ] });
  const comp = runInInjectionContext(injector, () =>
    new LeagueArchiveDetailComponent(
      injector.get(LeagueArchiveRepository),
      injector.get(AuthService),
      injector.get(ActivatedRoute),
      injector.get(Router),
    )
  );
  // Drain all microtasks: league load + catalog load are sequential async ops
  await vi.waitFor(() => expect(comp.loading()).toBe(false));
  await new Promise(r => setTimeout(r, 0));
  return { comp, catalogLoad };
}

describe('LeagueArchiveDetailComponent ratings signal', () => {
  it('passes the ratings map to the standings table', async () => {
    const { comp } = await build({
      catalogItems: [
        { playerName: 'Alice', rating: 1524 },
        { playerName: 'Bob', rating: 1480 },
      ],
    });
    const map = comp.ratings();
    expect(map).not.toBeNull();
    expect(map?.size).toBe(2);
    expect(map?.get('Alice')).toBe(1524);
    expect(map?.get('Bob')).toBe(1480);
  });

  it('renders no rating column when the catalog read fails', async () => {
    const { comp } = await build({ catalogError: new Error('network') });
    expect(comp.ratings()).toBeNull();
    // page still renders (league loaded successfully)
    expect(comp.league()).not.toBeNull();
  });
});
