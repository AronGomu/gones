import { Injectable, inject } from '@angular/core';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { PersistedLeague } from '../../domain/models';
import { CatalogEntry, CatalogResult, clearCatalogEntry, isCatalogFresh, readCatalogEntry, writeCatalogEntry } from '../../shared/catalog-cache';

export const LEAGUE_CATALOG_CACHE_KEY = 'gones.leagues-archive.catalog';

/**
 * Drops the catalog row so the next `/leagues-archive` load reads the server instead of a snapshot
 * taken before this mutation (ADR 0039: the TTL governs navigation, never correctness).
 *
 * It is a module function rather than a method because the callers are the League and Tournament
 * mutation sites — the app header, the Live runner's finalize — none of which own this page or its
 * injector, and a created, renamed or deleted League must not wait out 24 hours to appear.
 */
export function clearLeagueCatalogCache(): void {
  clearCatalogEntry(LEAGUE_CATALOG_CACHE_KEY);
}

type StoredEntry = CatalogEntry<PersistedLeague[]>;

@Injectable({ providedIn: 'root' })
export class LeagueArchiveCatalogCacheService {
  private readonly repo = inject(LeagueArchiveRepository);

  async load(options: { force?: boolean } = {}): Promise<CatalogResult<PersistedLeague[]>> {
    const cached = readCatalogEntry<PersistedLeague[]>(LEAGUE_CATALOG_CACHE_KEY);
    if (!options.force && cached && isCatalogFresh(cached)) {
      return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: true, stale: false, truncated: false };
    }
    try {
      const items = await this.repo.listServerLeagues();
      const fetchedAt = new Date().toISOString();
      const entry: StoredEntry = { items, fetchedAt, truncated: false };
      writeCatalogEntry(LEAGUE_CATALOG_CACHE_KEY, entry);
      return { items, fetchedAt, fromCache: false, stale: false, truncated: false };
    } catch (error) {
      if (cached) {
        return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: false, stale: true, truncated: false };
      }
      throw error;
    }
  }
}
