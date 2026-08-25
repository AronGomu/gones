import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Client, ArchiveGlobalPlayerStatisticsRow } from '../../api/generated/gones-api';
import { CatalogEntry, CatalogResult, isCatalogFresh, readCatalogEntry, writeCatalogEntry } from '../../shared/catalog-cache';

export const GLOBAL_STATS_CACHE_KEY = 'gones.global-stats.catalog';

type StoredEntry = CatalogEntry<ArchiveGlobalPlayerStatisticsRow[]>;

@Injectable({ providedIn: 'root' })
export class GlobalStatsCatalogCacheService {
  private readonly client = inject(Client);

  async load(options: { force?: boolean } = {}): Promise<CatalogResult<ArchiveGlobalPlayerStatisticsRow[]>> {
    const cached = readCatalogEntry<ArchiveGlobalPlayerStatisticsRow[]>(GLOBAL_STATS_CACHE_KEY);
    if (!options.force && cached && isCatalogFresh(cached)) {
      return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: true, stale: false, truncated: cached.truncated };
    }
    try {
      const response = await firstValueFrom(this.client.getArchiveGlobalPlayerStatisticsCatalog(undefined, undefined));
      const fetchedAt = new Date().toISOString();
      const items = response.items ?? [];
      const truncated = response.truncated ?? false;
      const entry: StoredEntry = { items, fetchedAt, truncated };
      writeCatalogEntry(GLOBAL_STATS_CACHE_KEY, entry);
      return { items, fetchedAt, fromCache: false, stale: false, truncated };
    } catch {
      if (cached) {
        return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: false, stale: true, truncated: cached.truncated };
      }
      throw new Error('globalStats.errorLoad');
    }
  }
}
