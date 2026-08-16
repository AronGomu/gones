import '@angular/compiler';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistedLeague } from '../../domain/models';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { LEAGUE_CATALOG_CACHE_KEY, LeagueArchiveCatalogCacheService } from './league-archive-catalog-cache.service';

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: () => null,
    get length() { return store.size; }
  } as Storage;
}

const items: PersistedLeague[] = [];

function buildService(listServerLeagues: ReturnType<typeof vi.fn>): LeagueArchiveCatalogCacheService {
  const injector = Injector.create({ providers: [
    LeagueArchiveCatalogCacheService,
    { provide: LeagueArchiveRepository, useValue: { listServerLeagues } }
  ] });
  return injector.get(LeagueArchiveCatalogCacheService);
}

describe('LeagueArchiveCatalogCacheService', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = makeStorage();
  });

  it('fetches when the cache is empty', async () => {
    const listServerLeagues = vi.fn().mockResolvedValue(items);
    const service = buildService(listServerLeagues);

    const result = await service.load();
    expect(result.fromCache).toBe(false);
    expect(listServerLeagues).toHaveBeenCalledTimes(1);
  });

  it('serves a fresh cache', async () => {
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({
      items, fetchedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const listServerLeagues = vi.fn();
    const service = buildService(listServerLeagues);

    const result = await service.load();
    expect(result.fromCache).toBe(true);
    expect(listServerLeagues).not.toHaveBeenCalled();
  });

  it('refetches a 25h old cache', async () => {
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({
      items, fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const listServerLeagues = vi.fn().mockResolvedValue(items);
    const service = buildService(listServerLeagues);

    const result = await service.load();
    expect(result.fromCache).toBe(false);
    expect(listServerLeagues).toHaveBeenCalledTimes(1);
  });

  it('force refetches a fresh cache', async () => {
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({
      items, fetchedAt: new Date().toISOString(), truncated: false
    }));
    const listServerLeagues = vi.fn().mockResolvedValue(items);
    const service = buildService(listServerLeagues);

    const result = await service.load({ force: true });
    expect(result.fromCache).toBe(false);
    expect(listServerLeagues).toHaveBeenCalledTimes(1);
  });

  it('falls back to the cache on failure', async () => {
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({
      items, fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const listServerLeagues = vi.fn().mockRejectedValue(new Error('Offline'));
    const service = buildService(listServerLeagues);

    const result = await service.load();
    expect(result.items).toEqual(items);
    expect(result.stale).toBe(true);
  });

  it('rethrows with no cache', async () => {
    const listServerLeagues = vi.fn().mockRejectedValue(new Error('Offline'));
    const service = buildService(listServerLeagues);

    await expect(service.load()).rejects.toThrow('Offline');
  });
});
