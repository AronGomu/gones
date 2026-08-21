import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, PublicEventDetailResponse } from '../../api/generated/gones-api';
import { joinApiUrl } from '../../api/api-boundary';

export interface CachedApiResult<T> {
  data: T;
  stale: boolean;
  /** ISO instant the cached copy was fetched, so a stale page can date itself. */
  cachedAt?: string;
}

interface CacheEntry<T> {
  etag?: string;
  cachedAt?: string;
  data: T;
}

const CACHE_PREFIX = 'gones.events.cache.';

@Injectable({ providedIn: 'root' })
export class PublicEventService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  detail(slug: string): Promise<CachedApiResult<PublicEventDetailResponse>> {
    return this.getCached<PublicEventDetailResponse>(`/api/events/${encodeURIComponent(slug)}`);
  }

  icsUrl(slug: string): string {
    return joinApiUrl(this.baseUrl, `/api/events/${encodeURIComponent(slug)}.ics`);
  }

  private async getCached<T>(path: string, params = new HttpParams()): Promise<CachedApiResult<T>> {
    const url = joinApiUrl(this.baseUrl, path);
    const key = `${CACHE_PREFIX}${encodeURIComponent(`${url}?${params.toString()}`)}`;
    const cached = this.readCache<T>(key);
    const headers = cached?.etag ? new HttpHeaders({ 'If-None-Match': cached.etag }) : undefined;
    try {
      const response = await firstValueFrom(this.http.get<T>(url, { params, headers, observe: 'response' }));
      const cachedAt = this.writeCache(key, response);
      return { data: response.body as T, stale: false, cachedAt };
    } catch (error) {
      if (cached && error instanceof HttpErrorResponse && error.status === 304) return { data: cached.data, stale: false, cachedAt: cached.cachedAt };
      if (cached && error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500)) return { data: cached.data, stale: true, cachedAt: cached.cachedAt };
      throw error;
    }
  }

  private readCache<T>(key: string): CacheEntry<T> | undefined {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? JSON.parse(raw) as CacheEntry<T> : undefined;
    } catch {
      return undefined;
    }
  }

  private writeCache<T>(key: string, response: HttpResponse<T>): string | undefined {
    if (response.body === null) return undefined;
    const cachedAt = new Date().toISOString();
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify({ data: response.body, etag: response.headers.get('ETag') ?? undefined, cachedAt } satisfies CacheEntry<T>));
    } catch {
      // Cache failure must not hide fresh public data.
    }
    return cachedAt;
  }
}
