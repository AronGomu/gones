import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, PublicTournamentDetailResponse, PublicTournamentListResponse } from '../../api/generated/gones-api';
import { joinApiUrl } from '../../api/api-boundary';
import { CalendarQuery, monthBounds } from './public-calendar';

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

const CACHE_PREFIX = 'gones.calendar-v1.cache.';
const PAGE_SIZE = 20;

@Injectable({ providedIn: 'root' })
export class PublicTournamentService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(query: CalendarQuery): Promise<CachedApiResult<PublicTournamentListResponse>> {
    let params = new HttpParams();
    if (query.view === 'calendar') {
      const bounds = monthBounds(query.month);
      params = params.set('from', bounds.from).set('to', bounds.to);
    }
    for (const key of ['city', 'country', 'organization', 'format', 'status', 'search'] as const) {
      if (query[key]) params = params.set(key, query[key]);
    }
    if (query.past) params = params.set('past', 'true');
    params = params.set('page', query.page).set('pageSize', PAGE_SIZE);
    return this.getCached<PublicTournamentListResponse>('/api/tournaments', params);
  }

  detail(slug: string): Promise<CachedApiResult<PublicTournamentDetailResponse>> {
    return this.getCached<PublicTournamentDetailResponse>(`/api/tournaments/${encodeURIComponent(slug)}`);
  }

  icsUrl(slug: string): string {
    return joinApiUrl(this.baseUrl, `/api/tournaments/${encodeURIComponent(slug)}.ics`);
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
