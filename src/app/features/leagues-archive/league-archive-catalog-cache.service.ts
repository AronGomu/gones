import { Injectable, inject } from '@angular/core';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { LeagueArchiveSummary } from '../../data/league-archive-summary';
import { CatalogEntry, CatalogResult, clearCatalogEntry, isCatalogFresh, readCatalogEntry, writeCatalogEntry } from '../../shared/catalog-cache';

/**
 * `.v2` because the entry changed shape: it held whole League documents and now holds summary rows
 * (ADR 0042). Reading a v1 entry back as a v2 array would render every card with no counts, so the
 * key bump is what makes an upgraded browser miss instead of misread.
 */
export const LEAGUE_CATALOG_CACHE_KEY = 'gones.leagues-archive.catalog.v2';
const LEGACY_LEAGUE_CATALOG_CACHE_KEY = 'gones.leagues-archive.catalog';

/**
 * Drops the catalog row so the next `/leagues-archive` load reads the server instead of a snapshot
 * taken before this mutation (ADR 0039: the TTL governs navigation, never correctness).
 *
 * It is a module function rather than a method because the callers are the League and Tournament
 * mutation sites — the app header, the Live runner's finalize — none of which own this page or its
 * injector, and a created, renamed or deleted League must not wait out 24 hours to appear.
 *
 * It clears the v1 key too. Nothing reads that key any more, so an upgraded browser would otherwise
 * keep up to ~2.9 MB of dead documents in `localStorage` against a ~5 MB quota forever — the exact
 * pressure ADR 0042 removed.
 */
export function clearLeagueCatalogCache(): void {
  clearCatalogEntry(LEAGUE_CATALOG_CACHE_KEY);
  clearCatalogEntry(LEGACY_LEAGUE_CATALOG_CACHE_KEY);
}

type StoredEntry = CatalogEntry<LeagueArchiveSummary[]>;

@Injectable({ providedIn: 'root' })
export class LeagueArchiveCatalogCacheService {
  private readonly repo = inject(LeagueArchiveRepository);

  async load(options: { force?: boolean } = {}): Promise<CatalogResult<LeagueArchiveSummary[]>> {
    const cached = readCatalogEntry<LeagueArchiveSummary[]>(LEAGUE_CATALOG_CACHE_KEY);
    if (!options.force && cached && isCatalogFresh(cached)) {
      // A cached catalog carries the cap it was taken under, so serving it does not quietly drop the
      // warning the fresh read raised.
      this.repo.catalogTruncated.set(cached.truncated);
      return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: true, stale: false, truncated: cached.truncated };
    }
    try {
      const items = await this.repo.listServerLeagueSummaries();
      const truncated = this.repo.catalogTruncated();
      const fetchedAt = new Date().toISOString();
      const entry: StoredEntry = { items, fetchedAt, truncated };
      writeCatalogEntry(LEAGUE_CATALOG_CACHE_KEY, entry);
      return { items, fetchedAt, fromCache: false, stale: false, truncated };
    } catch (error) {
      if (cached) {
        this.repo.catalogTruncated.set(cached.truncated);
        return { items: cached.items, fetchedAt: cached.fetchedAt, fromCache: false, stale: true, truncated: cached.truncated };
      }
      throw error;
    }
  }
}
