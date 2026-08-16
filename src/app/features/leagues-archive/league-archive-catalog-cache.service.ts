import { Injectable, inject } from '@angular/core';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { PersistedLeague } from '../../domain/models';
import { CatalogEntry, CatalogResult, isCatalogFresh, readCatalogEntry, writeCatalogEntry } from '../../shared/catalog-cache';

export const LEAGUE_CATALOG_CACHE_KEY = 'gones.leagues-archive.catalog';

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
