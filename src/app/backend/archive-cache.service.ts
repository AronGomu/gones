import { Injectable } from '@angular/core';
import { CATALOG_TTL_MS } from '../shared/catalog-cache';
import { get, getAll, openDatabase, put, requestResult, runTransaction } from './indexed-db';

/**
 * The public archive catalog cache (ADR 0039's TTL contract), on IndexedDB rather than the ~5 MB
 * key-value budget the other public catalogs share — a single year partition may hold 25,000 rows.
 *
 * An authority and a cache never share a database (ADR 0031), because "purge the cache" must not be
 * able to delete user-authored records. The browser-authored archive lives in `gones-archive-local`;
 * everything here is a copy of a public, anonymous server answer and may be dropped at any moment
 * without losing anything. Nothing user-scoped is stored here, which is why logout does not purge it.
 *
 * This class deliberately owns **no** way to write a single year partition. Only
 * `archive-backfill-queue.ts` does, so a year is written and stamped in one transaction and can
 * never be observed half-filled. The one writable path here is `clearAll()`, a wholesale purge —
 * dropping every year keeps the whole-or-absent rule, dropping part of one would break it.
 *
 * Every read swallows its own failure: a database that is disabled, blocked or holding a
 * half-written value is a cache miss, never an error a page has to render.
 */
export const ARCHIVE_CACHE_DB_NAME = 'gones-archive-cache';
export const ARCHIVE_CACHE_DB_VERSION = 1;
export const CACHE_LEAGUE_STORE = 'leagues';
export const CACHE_SEASON_STORE = 'league-seasons';
export const CACHE_YEAR_PARTITION_STORE = 'year-partitions';
export const CACHE_META_STORE = 'meta';
/** Every store, in creation order. `clearAll()` purges exactly these and nothing else. */
export const ARCHIVE_CACHE_STORES = [CACHE_LEAGUE_STORE, CACHE_SEASON_STORE, CACHE_YEAR_PARTITION_STORE, CACHE_META_STORE] as const;
/** The single key both catalog stores use: one record holds the whole catalog. */
export const ARCHIVE_CATALOG_KEY = 'catalog';
/** The single key the `meta` store currently uses. */
export const ARCHIVE_YEARS_META_KEY = 'years';

/** One TTL for the whole app (ADR 0039). Re-exported so nothing downstream redefines 24 hours. */
export { CATALOG_TTL_MS };

/**
 * The cached row shapes are the archive read models themselves, re-exported rather than redeclared:
 * a second declaration of `ArchiveTournamentSummary` would drift from the one both authorities and
 * the summarizers already speak.
 */
export type { ArchiveLeagueSeasonSummary, ArchiveLeagueSummary, ArchiveTournamentSummary, ArchiveYearEntry } from '../data/archive-summary';

import type { ArchiveLeagueSeasonSummary, ArchiveLeagueSummary, ArchiveTournamentSummary, ArchiveYearEntry } from '../data/archive-summary';

/** One whole public catalog, as one record, under the key `'catalog'`. */
export interface ArchiveCatalogRecord<T> {
  key: typeof ARCHIVE_CATALOG_KEY;
  items: T[];
  totalCount: number;
  truncated: boolean;
  fetchedAt: string;                    // ISO 8601 UTC instant
}

/**
 * One calendar year of Tournament rows. `completedAt` ABSENT ⇒ the year is not cached; a partial
 * record is never written. Written only by `archive-backfill-queue.ts`, in one transaction.
 */
export interface ArchiveYearPartition {
  year: number;
  completedAt: string | undefined;
  rowCount: number;                     // the server's uncapped totalCount for that year
  items: ArchiveTournamentSummary[];
}

/** The years index as last fetched. Valid only while `utcDay` is today: `locked` flips at midnight. */
export interface ArchiveYearsMetaRecord {
  key: typeof ARCHIVE_YEARS_META_KEY;
  years: ArchiveYearEntry[];
  fetchedAt: string;                    // ISO 8601 UTC instant
  utcDay: string;                       // "YYYY-MM-DD", UTC
}

/** An instant that will not parse is stale, so a corrupt record cannot pin a page to old data. */
export function isArchiveCatalogFresh(record: ArchiveCatalogRecord<unknown>, now = Date.now()): boolean {
  const fetchedAt = Date.parse(record.fetchedAt);
  return Number.isFinite(fetchedAt) && now - fetchedAt < CATALOG_TTL_MS;
}

/** The UTC day, `YYYY-MM-DD`. The years index is only valid for the day it was fetched. */
export function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

@Injectable({ providedIn: 'root' })
export class ArchiveCacheService {
  private handle?: Promise<IDBDatabase>;

  database(): Promise<IDBDatabase> {
    if (!this.handle) {
      const opening = openDatabase(ARCHIVE_CACHE_DB_NAME, ARCHIVE_CACHE_DB_VERSION, (database) => {
        for (const store of ARCHIVE_CACHE_STORES) {
          if (database.objectStoreNames.contains(store)) continue;
          database.createObjectStore(store, { keyPath: store === CACHE_YEAR_PARTITION_STORE ? 'year' : 'key' });
        }
      }).catch((error: unknown) => {
        if (this.handle === opening) this.handle = undefined; // a later call must retry
        throw error;
      });
      this.handle = opening;
    }
    return this.handle;
  }

  readLeagueCatalog(): Promise<ArchiveCatalogRecord<ArchiveLeagueSummary> | null> {
    return this.readOne<ArchiveCatalogRecord<ArchiveLeagueSummary>>(CACHE_LEAGUE_STORE, ARCHIVE_CATALOG_KEY);
  }

  writeLeagueCatalog(record: ArchiveCatalogRecord<ArchiveLeagueSummary>): Promise<void> {
    return this.writeOne(CACHE_LEAGUE_STORE, record);
  }

  readSeasonCatalog(): Promise<ArchiveCatalogRecord<ArchiveLeagueSeasonSummary> | null> {
    return this.readOne<ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>>(CACHE_SEASON_STORE, ARCHIVE_CATALOG_KEY);
  }

  writeSeasonCatalog(record: ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>): Promise<void> {
    return this.writeOne(CACHE_SEASON_STORE, record);
  }

  readYearsMeta(): Promise<ArchiveYearsMetaRecord | null> {
    return this.readOne<ArchiveYearsMetaRecord>(CACHE_META_STORE, ARCHIVE_YEARS_META_KEY);
  }

  writeYearsMeta(record: ArchiveYearsMetaRecord): Promise<void> {
    return this.writeOne(CACHE_META_STORE, record);
  }

  /** `null` unless the record exists AND carries `completedAt`: a year is whole or it is absent. */
  async readYearPartition(year: number): Promise<ArchiveYearPartition | null> {
    const stored = await this.readOne<ArchiveYearPartition>(CACHE_YEAR_PARTITION_STORE, year);
    return stored?.completedAt ? stored : null;
  }

  /** Every stored partition, incomplete ones dropped. Order is unspecified; callers sort. */
  async readAllYearPartitions(): Promise<ArchiveYearPartition[]> {
    try {
      const rows = await getAll<ArchiveYearPartition>(await this.database(), CACHE_YEAR_PARTITION_STORE);
      return rows.filter((row) => Boolean(row?.completedAt));
    } catch {
      return [];
    }
  }

  /**
   * Drops every cached catalog in one transaction. Wholesale is the point: a partial purge of the
   * year store would leave a year present but wrong, and only the queue may decide a year's
   * contents.
   */
  async clearAll(): Promise<void> {
    try {
      const database = await this.database();
      await runTransaction(database, [...ARCHIVE_CACHE_STORES], 'readwrite', async (transaction) => {
        await Promise.all(ARCHIVE_CACHE_STORES.map((store) => requestResult(transaction.objectStore(store).clear())));
      });
    } catch {
      // A cache that cannot be dropped expires on its own; the next load overwrites it.
    }
  }

  private async readOne<T>(store: string, key: IDBValidKey): Promise<T | null> {
    try {
      return await get<T>(await this.database(), store, key);
    } catch {
      return null;
    }
  }

  private async writeOne(store: string, value: unknown): Promise<void> {
    try {
      await put(await this.database(), store, value);
    } catch {
      // Cache failure must not hide fresh public data.
    }
  }
}
