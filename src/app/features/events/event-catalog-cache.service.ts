import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, PublicEventCatalogResponse } from '../../api/generated/gones-api';
import { joinApiUrl } from '../../api/api-boundary';
import { CatalogEntry, CatalogResult, isCatalogFresh, readCatalogEntry, writeCatalogEntry } from '../../shared/catalog-cache';
import { PublicEventView } from './public-event-list';
import { EVENT_DETAIL_CACHE_PREFIX } from './public-event.service';

export const EVENT_CATALOG_CACHE_KEY = 'gones.events.catalog.v2';

export type EventCatalogResult = CatalogResult<PublicEventView[]>;

export function invalidateEventCaches(storage = globalThis.localStorage): void {
  try {
    storage?.removeItem(EVENT_CATALOG_CACHE_KEY);
    const keys = Array.from({ length: storage?.length ?? 0 }, (_, index) => storage?.key(index)).filter((key): key is string => Boolean(key));
    for (const key of keys) {
      if (key.startsWith(EVENT_DETAIL_CACHE_PREFIX) || key.startsWith('gones.events.cache.')) storage?.removeItem(key);
    }
  } catch { /* Cache invalidation is best effort. */ }
}

type StoredEntry = CatalogEntry<PublicEventView[]>;

@Injectable({ providedIn: 'root' })
export class EventCatalogCacheService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  readonly cachedAt = signal<string | undefined>(undefined);
  readonly truncated = signal(false);

  async load(options: { force?: boolean } = {}): Promise<EventCatalogResult> {
    const cached = readCatalogEntry<PublicEventView[]>(EVENT_CATALOG_CACHE_KEY);
    if (!options.force && cached && isCatalogFresh(cached)) {
      this.cachedAt.set(cached.fetchedAt);
      this.truncated.set(cached.truncated);
      return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: true, stale: false, truncated: cached.truncated };
    }

    const url = joinApiUrl(this.baseUrl, '/api/events/all');
    const headers = cached?.etag ? new HttpHeaders({ 'If-None-Match': cached.etag }) : undefined;
    try {
      const response = await firstValueFrom(
        this.http.get<PublicEventCatalogResponse>(url, { headers, observe: 'response' })
      );
      const fetchedAt = new Date().toISOString();
      const body = response.body;
      const items = (body?.items ?? []) as unknown as PublicEventView[];
      const truncated = body?.truncated ?? false;
      const entry: StoredEntry = { items, etag: response.headers.get('ETag') ?? undefined, fetchedAt, truncated };
      writeCatalogEntry(EVENT_CATALOG_CACHE_KEY, entry);
      this.cachedAt.set(fetchedAt);
      this.truncated.set(truncated);
      return { items, fetchedAt, fromCache: false, stale: false, truncated };
    } catch (error) {
      if (cached && error instanceof HttpErrorResponse && error.status === 304) {
        const fetchedAt = new Date().toISOString();
        writeCatalogEntry(EVENT_CATALOG_CACHE_KEY, { ...cached, fetchedAt });
        this.cachedAt.set(fetchedAt);
        this.truncated.set(cached.truncated);
        return { items: cached.items, fetchedAt, fromCache: false, stale: false, truncated: cached.truncated };
      }
      if (cached) {
        this.cachedAt.set(cached.fetchedAt);
        this.truncated.set(cached.truncated);
        return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: false, stale: true, truncated: cached.truncated };
      }
      throw error;
    }
  }
}
