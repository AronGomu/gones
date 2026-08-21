import '@angular/compiler';
import { Injector, signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeagueArchiveSummary } from '../../data/league-archive-summary';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { clearLeagueCatalogCache, LEAGUE_CATALOG_CACHE_KEY, LeagueArchiveCatalogCacheService } from './league-archive-catalog-cache.service';

/** The v1 key, spelled out rather than imported: the point of the bump is that it is not exported. */
const LEGACY_KEY = 'gones.leagues-archive.catalog';

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

const items: LeagueArchiveSummary[] = [
  { id: 'league-1', name: 'League', status: 'active', tournamentCount: 2, playerCount: 3, isLocal: false }
];

const catalogTruncated = signal(false);

function buildService(listServerLeagueSummaries: ReturnType<typeof vi.fn>): LeagueArchiveCatalogCacheService {
  const injector = Injector.create({ providers: [
    LeagueArchiveCatalogCacheService,
    { provide: LeagueArchiveRepository, useValue: { listServerLeagueSummaries, catalogTruncated } }
  ] });
  return injector.get(LeagueArchiveCatalogCacheService);
}

describe('LeagueArchiveCatalogCacheService', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = makeStorage();
    catalogTruncated.set(false);
  });

  it('fetches when the cache is empty', async () => {
    const listServerLeagueSummaries = vi.fn().mockResolvedValue(items);
    const service = buildService(listServerLeagueSummaries);

    const result = await service.load();
    expect(result.fromCache).toBe(false);
    expect(listServerLeagueSummaries).toHaveBeenCalledTimes(1);
  });

  /**
   * ADR 0042: the entry changed shape, so it changed key. A browser upgrading mid-TTL must miss on
   * the v1 row rather than read documents back as summaries.
   */
  it('caches summaries under the v2 key', async () => {
    const listServerLeagueSummaries = vi.fn().mockResolvedValue(items);
    const service = buildService(listServerLeagueSummaries);

    await service.load();

    expect(LEAGUE_CATALOG_CACHE_KEY).toBe('gones.leagues-archive.catalog.v2');
    expect(JSON.parse(globalThis.localStorage!.getItem('gones.leagues-archive.catalog.v2')!).items).toEqual(items);
    expect(globalThis.localStorage!.getItem(LEGACY_KEY)).toBeNull();
  });

  it('never reads a v1 entry back as summary rows', async () => {
    globalThis.localStorage!.setItem(LEGACY_KEY, JSON.stringify({
      items: [{ id: 'league-1', name: 'League', status: 'active', tournaments: [], documentVersion: 4 }],
      fetchedAt: new Date().toISOString(),
      truncated: false
    }));
    const listServerLeagueSummaries = vi.fn().mockResolvedValue(items);
    const service = buildService(listServerLeagueSummaries);

    const result = await service.load();

    expect(result.fromCache).toBe(false);
    expect(result.items).toEqual(items);
    expect(listServerLeagueSummaries).toHaveBeenCalledTimes(1);
  });

  it('serves a fresh cached summary without a request', async () => {
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({
      items, fetchedAt: new Date().toISOString(), truncated: false
    }));
    const listServerLeagueSummaries = vi.fn();
    const service = buildService(listServerLeagueSummaries);

    const result = await service.load();

    expect(result.items).toEqual(items);
    expect(result.fromCache).toBe(true);
    expect(listServerLeagueSummaries).not.toHaveBeenCalled();
  });

  it('serves a fresh cache', async () => {
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({
      items, fetchedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const listServerLeagueSummaries = vi.fn();
    const service = buildService(listServerLeagueSummaries);

    const result = await service.load();
    expect(result.fromCache).toBe(true);
    expect(listServerLeagueSummaries).not.toHaveBeenCalled();
  });

  it('refetches a 25h old cache', async () => {
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({
      items, fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const listServerLeagueSummaries = vi.fn().mockResolvedValue(items);
    const service = buildService(listServerLeagueSummaries);

    const result = await service.load();
    expect(result.fromCache).toBe(false);
    expect(listServerLeagueSummaries).toHaveBeenCalledTimes(1);
  });

  it('force refetches a fresh cache', async () => {
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({
      items, fetchedAt: new Date().toISOString(), truncated: false
    }));
    const listServerLeagueSummaries = vi.fn().mockResolvedValue(items);
    const service = buildService(listServerLeagueSummaries);

    const result = await service.load({ force: true });
    expect(result.fromCache).toBe(false);
    expect(listServerLeagueSummaries).toHaveBeenCalledTimes(1);
  });

  it('falls back to the cache on failure', async () => {
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({
      items, fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const listServerLeagueSummaries = vi.fn().mockRejectedValue(new Error('Offline'));
    const service = buildService(listServerLeagueSummaries);

    const result = await service.load();
    expect(result.items).toEqual(items);
    expect(result.stale).toBe(true);
  });

  it('rethrows with no cache', async () => {
    const listServerLeagueSummaries = vi.fn().mockRejectedValue(new Error('Offline'));
    const service = buildService(listServerLeagueSummaries);

    await expect(service.load()).rejects.toThrow('Offline');
  });

  // The row cap is a property of the answer, so it has to survive being stored and served again —
  // otherwise the warning shows on the fetch and silently disappears on the next navigation.
  it('stores the cap the fresh read reported and replays it from the cache', async () => {
    const listServerLeagueSummaries = vi.fn().mockImplementation(async () => { catalogTruncated.set(true); return items; });
    const service = buildService(listServerLeagueSummaries);

    expect((await service.load()).truncated).toBe(true);

    catalogTruncated.set(false);
    const replayed = await service.load();
    expect(replayed.fromCache).toBe(true);
    expect(replayed.truncated).toBe(true);
    expect(catalogTruncated()).toBe(true);
  });
});

/**
 * ADR 0039: the TTL governs navigation, never correctness. Nothing ever dropped this row, so a
 * League created, renamed or deleted — and the Archive Tournament a Live finalize produces — was
 * absent from `/leagues-archive` for a full 24 hours.
 */
describe('clearLeagueCatalogCache', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = makeStorage();
    catalogTruncated.set(false);
  });

  it('sends the next load back to the server even though the row was fresh', async () => {
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({
      items, fetchedAt: new Date().toISOString(), truncated: false
    }));
    const listServerLeagueSummaries = vi.fn().mockResolvedValue(items);
    const service = buildService(listServerLeagueSummaries);

    clearLeagueCatalogCache();

    const result = await service.load();
    expect(result.fromCache).toBe(false);
    expect(listServerLeagueSummaries).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when nothing is cached', () => {
    expect(() => clearLeagueCatalogCache()).not.toThrow();
    expect(globalThis.localStorage!.getItem(LEAGUE_CATALOG_CACHE_KEY)).toBeNull();
  });

  /**
   * Nothing reads the v1 key any more, so leaving it behind parks up to ~2.9 MB of dead documents in
   * a ~5 MB quota — the exact pressure ADR 0042 exists to remove.
   */
  it('clearing drops the v1 key too', () => {
    globalThis.localStorage!.setItem(LEGACY_KEY, JSON.stringify({ items: [], fetchedAt: new Date().toISOString(), truncated: false }));
    globalThis.localStorage!.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({ items, fetchedAt: new Date().toISOString(), truncated: false }));

    clearLeagueCatalogCache();

    expect(globalThis.localStorage!.getItem(LEGACY_KEY)).toBeNull();
    expect(globalThis.localStorage!.getItem(LEAGUE_CATALOG_CACHE_KEY)).toBeNull();
  });
});
