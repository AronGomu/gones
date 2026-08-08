import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, PublicTournamentCatalogResponse } from '../../api/generated/gones-api';
import { joinApiUrl } from '../../api/api-boundary';
import { PublicTournamentView } from './public-calendar';

export const ALL_TOURNAMENTS_CACHE_KEY = 'gones.calendar-v1.all-tournaments';
export const ALL_TOURNAMENTS_TTL_MS = 24 * 60 * 60 * 1000;

export interface AllTournamentsResult {
  items: PublicTournamentView[];
  fetchedAt: string;
  fromCache: boolean;
  stale: boolean;
  truncated: boolean;
}

interface StoredEntry {
  items: PublicTournamentView[];
  etag?: string;
  fetchedAt: string;
  truncated: boolean;
}

@Injectable({ providedIn: 'root' })
export class AllTournamentsCacheService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  readonly cachedAt = signal<string | undefined>(undefined);
  readonly truncated = signal(false);

  async load(options: { force?: boolean } = {}): Promise<AllTournamentsResult> {
    const cached = this.readCache();
    if (!options.force && cached && Date.now() - Date.parse(cached.fetchedAt) < ALL_TOURNAMENTS_TTL_MS) {
      this.cachedAt.set(cached.fetchedAt);
      this.truncated.set(cached.truncated);
      return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: true, stale: false, truncated: cached.truncated };
    }

    const url = joinApiUrl(this.baseUrl, '/api/tournaments/all');
    const headers = cached?.etag ? new HttpHeaders({ 'If-None-Match': cached.etag }) : undefined;
    try {
      const response = await firstValueFrom(
        this.http.get<PublicTournamentCatalogResponse>(url, { headers, observe: 'response' })
      );
      const fetchedAt = new Date().toISOString();
      const body = response.body;
      const items = (body?.items ?? []) as unknown as PublicTournamentView[];
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
      const raw = globalThis.localStorage?.getItem(ALL_TOURNAMENTS_CACHE_KEY);
      return raw ? JSON.parse(raw) as StoredEntry : undefined;
    } catch {
      return undefined;
    }
  }

  private writeCache(entry: StoredEntry): void {
    try {
      globalThis.localStorage?.setItem(ALL_TOURNAMENTS_CACHE_KEY, JSON.stringify(entry));
    } catch {
      // Cache failure must not hide fresh public data.
    }
  }
}
