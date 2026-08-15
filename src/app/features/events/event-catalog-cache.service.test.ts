import '@angular/compiler';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injector } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { API_BASE_URL } from '../../api/generated/gones-api';
import { PublicEventView } from './public-event-list';
import { EVENT_CATALOG_CACHE_KEY, EventCatalogCacheService } from './event-catalog-cache.service';

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

const items: PublicEventView[] = [];
const body = { items, generatedAt: '2026-08-08T00:00:00Z', count: 0, truncated: false };

function buildService(get: ReturnType<typeof vi.fn>): EventCatalogCacheService {
  const injector = Injector.create({ providers: [
    EventCatalogCacheService,
    { provide: HttpClient, useValue: { get } },
    { provide: API_BASE_URL, useValue: 'https://api.example' }
  ] });
  return injector.get(EventCatalogCacheService);
}

describe('EventCatalogCacheService', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = makeStorage();
  });

  it('load fetches once and caches', async () => {
    const get = vi.fn().mockReturnValueOnce(of(new HttpResponse({ body, status: 200, headers: new HttpHeaders({ ETag: '"v1"' }) })));
    const service = buildService(get);

    const first = await service.load();
    expect(first.fromCache).toBe(false);
    const second = await service.load();
    expect(second.fromCache).toBe(true);

    expect(get).toHaveBeenCalledTimes(1);
    // T17: the catalog reads the Event surface. The old `/api/tournaments/all` path is gone and
    // 404s, so a regression here is a blank calendar rather than a slow one.
    expect(get.mock.calls[0][0]).toBe('https://api.example/api/events/all');
  });

  it('load skips the request within 24h', async () => {
    globalThis.localStorage!.setItem(EVENT_CATALOG_CACHE_KEY, JSON.stringify({
      items, etag: '"v1"', fetchedAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const get = vi.fn();
    const service = buildService(get);

    const result = await service.load();
    expect(result.fromCache).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('load refetches after 24h', async () => {
    globalThis.localStorage!.setItem(EVENT_CATALOG_CACHE_KEY, JSON.stringify({
      items, etag: '"v1"', fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const get = vi.fn().mockReturnValueOnce(of(new HttpResponse({ body, status: 200, headers: new HttpHeaders({ ETag: '"v2"' }) })));
    const service = buildService(get);

    const result = await service.load();
    expect(result.fromCache).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('force always refetches', async () => {
    globalThis.localStorage!.setItem(EVENT_CATALOG_CACHE_KEY, JSON.stringify({
      items, etag: '"v1"', fetchedAt: new Date().toISOString(), truncated: false
    }));
    const get = vi.fn().mockReturnValueOnce(of(new HttpResponse({ body, status: 200, headers: new HttpHeaders({ ETag: '"v2"' }) })));
    const service = buildService(get);

    const result = await service.load({ force: true });
    expect(result.fromCache).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('a failed refetch falls back to the cache', async () => {
    globalThis.localStorage!.setItem(EVENT_CATALOG_CACHE_KEY, JSON.stringify({
      items, etag: '"v1"', fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), truncated: false
    }));
    const get = vi.fn().mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Offline' })));
    const service = buildService(get);

    const result = await service.load();
    expect(result.items).toEqual(items);
    expect(result.stale).toBe(true);
  });

  it('a failed first load rejects', async () => {
    const get = vi.fn().mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Offline' })));
    const service = buildService(get);

    await expect(service.load()).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});
