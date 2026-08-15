import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, PublicEventCatalogResponse } from '../../api/generated/gones-api';
import { joinApiUrl } from '../../api/api-boundary';
import { PublicEventView } from './public-event-list';

export const EVENT_CATALOG_CACHE_KEY = 'gones.events.catalog';
export const EVENT_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

export interface EventCatalogResult {
  items: PublicEventView[];
  fetchedAt: string;
  fromCache: boolean;
  stale: boolean;
  truncated: boolean;
}

interface StoredEntry {
  items: PublicEventView[];
  etag?: string;
  fetchedAt: string;
  truncated: boolean;
}

@Injectable({ providedIn: 'root' })
export class EventCatalogCacheService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  readonly cachedAt = signal<string | undefined>(undefined);
  readonly truncated = signal(false);

  async load(options: { force?: boolean } = {}): Promise<EventCatalogResult> {
    const cached = this.readCache();
    if (!options.force && cached && Date.now() - Date.parse(cached.fetchedAt) < EVENT_CATALOG_TTL_MS) {
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
      this.writeCache(entry);
      this.cachedAt.set(fetchedAt);
      this.truncated.set(truncated);
      return { items, fetchedAt, fromCache: false, stale: false, truncated };
    } catch (error) {
      if (cached && error instanceof HttpErrorResponse && error.status === 304) {
        const fetchedAt = new Date().toISOString();
        this.writeCache({ ...cached, fetchedAt });
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

  private readCache(): StoredEntry | undefined {
    try {
      const raw = globalThis.localStorage?.getItem(EVENT_CATALOG_CACHE_KEY);
      return raw ? JSON.parse(raw) as StoredEntry : undefined;
    } catch {
      return undefined;
    }
  }

  private writeCache(entry: StoredEntry): void {
    try {
      globalThis.localStorage?.setItem(EVENT_CATALOG_CACHE_KEY, JSON.stringify(entry));
    } catch {
      // Cache failure must not hide fresh public data.
    }
  }
}
