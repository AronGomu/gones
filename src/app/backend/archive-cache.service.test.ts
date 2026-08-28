import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARCHIVE_CACHE_DB_NAME, ARCHIVE_CACHE_DB_VERSION, ARCHIVE_CACHE_STORES, ARCHIVE_CATALOG_KEY,
  ARCHIVE_YEARS_META_KEY, ArchiveCacheService, CACHE_LEAGUE_STORE,
  CACHE_YEAR_PARTITION_STORE, CATALOG_TTL_MS, isArchiveCatalogFresh, utcDayKey
} from './archive-cache.service';
import type { ArchiveCatalogRecord, ArchiveLeagueSummary, ArchiveYearPartition, ArchiveYearsMetaRecord } from './archive-cache.service';
import { fakeIndexedDbState, installFakeIndexedDb, installOpenFailingOnce, resetFakeIndexedDb, restoreRealIndexedDb } from './in-memory-indexeddb.fake';

beforeEach(() => {
  resetFakeIndexedDb();
  installFakeIndexedDb();
});

afterEach(() => {
  restoreRealIndexedDb();
});

const league = (id: string): ArchiveLeagueSummary =>
  ({ id, name: `League ${id}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', documentVersion: 1 });
const partition = (year: number, rowCount = 0, completedAt: string | undefined = '2026-08-22T10:00:00.000Z'): ArchiveYearPartition =>
  ({ year, completedAt, rowCount, items: [] });
const catalogRecord = (items: ArchiveLeagueSummary[], fetchedAt = '2026-08-22T10:00:00.000Z'): ArchiveCatalogRecord<ArchiveLeagueSummary> =>
  ({ key: ARCHIVE_CATALOG_KEY, items, totalCount: items.length, truncated: false, fetchedAt });
const yearsMeta = (): ArchiveYearsMetaRecord => ({
  key: ARCHIVE_YEARS_META_KEY,
  years: [{ year: 2026, locked: false, tournamentCount: 3 }],
  fetchedAt: '2026-08-22T10:00:00.000Z',
  utcDay: '2026-08-22'
});
const cacheSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'archive-cache.service.ts'), 'utf8');

/** Seeds a row the service is forbidden to write itself, so no test depends on a writer it must not have. */
async function seed(cache: ArchiveCacheService, store: string, key: string, value: unknown): Promise<void> {
  await cache.database();
  fakeIndexedDbState.databases.get(ARCHIVE_CACHE_DB_NAME)!.stores.get(store)!.rows.set(key, value);
}

/** A `rows` map whose `get` throws, so a read fails inside the transaction the way a corrupt store would. */
class ThrowingMap extends Map<string, unknown> {
  override get(): never { throw new Error('indexedDbReadFailed'); }
}

describe('archive cache storage contract', () => {
  it('names the documented database, version, stores and keys', () => {
    expect(ARCHIVE_CACHE_DB_NAME).toBe('gones-archive-cache');
    expect(ARCHIVE_CACHE_DB_VERSION).toBe(1);
    expect([...ARCHIVE_CACHE_STORES]).toEqual(['leagues', 'league-seasons', 'year-partitions', 'meta']);
    expect(ARCHIVE_CATALOG_KEY).toBe('catalog');
    expect(ARCHIVE_YEARS_META_KEY).toBe('years');
  });

  it('creates all four stores on first open', async () => {
    await new ArchiveCacheService().database();

    expect([...fakeIndexedDbState.databases.get(ARCHIVE_CACHE_DB_NAME)!.stores.keys()]).toEqual([...ARCHIVE_CACHE_STORES]);
  });

  it('a missing catalog row reads as null', async () => {
    const cache = new ArchiveCacheService();

    expect(await cache.readLeagueCatalog()).toBeNull();
    expect(await cache.readSeasonCatalog()).toBeNull();
    expect(await cache.readYearsMeta()).toBeNull();
  });

  it('a League catalog round-trips with its rows, count, truncation flag and fetch instant', async () => {
    const cache = new ArchiveCacheService();
    const record: ArchiveCatalogRecord<ArchiveLeagueSummary> =
      { key: ARCHIVE_CATALOG_KEY, items: [league('a')], totalCount: 7, truncated: true, fetchedAt: '2026-08-22T10:00:00.000Z' };

    await cache.writeLeagueCatalog(record);

    expect(await cache.readLeagueCatalog()).toEqual(record);
  });

  it('the two catalog stores are independent', async () => {
    const cache = new ArchiveCacheService();

    await cache.writeSeasonCatalog({ key: ARCHIVE_CATALOG_KEY, items: [], totalCount: 0, truncated: false, fetchedAt: '2026-08-22T10:00:00.000Z' });

    expect(await cache.readSeasonCatalog()).not.toBeNull();
    expect(await cache.readLeagueCatalog()).toBeNull();
  });

  it('reads a year partition by its numeric year key', async () => {
    const cache = new ArchiveCacheService();
    const stored = partition(2026, 2);
    await seed(cache, CACHE_YEAR_PARTITION_STORE, '2026', stored);

    expect(await cache.readYearPartition(2026)).toEqual(stored);
    expect(await cache.readYearPartition(2025)).toBeNull();
  });

  it('treats a partition without completedAt as absent', async () => {
    const cache = new ArchiveCacheService();
    await seed(cache, CACHE_YEAR_PARTITION_STORE, '2026', { year: 2026, completedAt: undefined, rowCount: 0, items: [] });

    expect(await cache.readYearPartition(2026)).toBeNull();
    expect(await cache.readAllYearPartitions()).toEqual([]);
  });

  it('reads every complete partition in one call', async () => {
    const cache = new ArchiveCacheService();
    await seed(cache, CACHE_YEAR_PARTITION_STORE, '2024', partition(2024));
    await seed(cache, CACHE_YEAR_PARTITION_STORE, '2025', partition(2025));
    // Spelled out rather than `partition(2026, 0, undefined)`: an explicit `undefined` argument
    // takes the parameter's default, which would stamp the record complete.
    await seed(cache, CACHE_YEAR_PARTITION_STORE, '2026', { ...partition(2026), completedAt: undefined });

    expect((await cache.readAllYearPartitions()).map((row) => row.year).sort()).toEqual([2024, 2025]);
  });

  it('a years-index snapshot round-trips through the meta store', async () => {
    const cache = new ArchiveCacheService();
    const record = yearsMeta();

    await cache.writeYearsMeta(record);

    expect(await cache.readYearsMeta()).toEqual(record);
  });

  it('clearAll empties every store in one transaction', async () => {
    const cache = new ArchiveCacheService();
    await cache.writeLeagueCatalog(catalogRecord([league('a')]));
    await cache.writeSeasonCatalog({ key: ARCHIVE_CATALOG_KEY, items: [], totalCount: 0, truncated: false, fetchedAt: '2026-08-22T10:00:00.000Z' });
    await cache.writeYearsMeta(yearsMeta());
    await seed(cache, CACHE_YEAR_PARTITION_STORE, '2026', partition(2026));
    fakeIndexedDbState.readwriteTransactionCount = 0;

    await cache.clearAll();

    expect(fakeIndexedDbState.readwriteTransactionCount).toBe(1);
    expect(await cache.readLeagueCatalog()).toBeNull();
    expect(await cache.readSeasonCatalog()).toBeNull();
    expect(await cache.readYearsMeta()).toBeNull();
    expect(await cache.readAllYearPartitions()).toEqual([]);
  });

  it('a failed read is a miss, never a throw', async () => {
    const cache = new ArchiveCacheService();
    await cache.database();
    fakeIndexedDbState.databases.get(ARCHIVE_CACHE_DB_NAME)!.stores.get(CACHE_LEAGUE_STORE)!.rows = new ThrowingMap();

    expect(await cache.readLeagueCatalog()).toBeNull();
  });

  it('a failed write resolves and leaves the previous row in place', async () => {
    const cache = new ArchiveCacheService();
    const first = catalogRecord([league('a')]);
    await cache.writeLeagueCatalog(first);
    fakeIndexedDbState.failPutAt = fakeIndexedDbState.putCount + 1;

    await expect(cache.writeLeagueCatalog(catalogRecord([league('b')], '2026-08-23T10:00:00.000Z'))).resolves.toBeUndefined();

    expect(await cache.readLeagueCatalog()).toEqual(first);
  });

  it('an absent indexedDB makes every read a miss and every write a no-op', async () => {
    Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'indexedDB');
    const cache = new ArchiveCacheService();

    expect(await cache.readLeagueCatalog()).toBeNull();
    expect(await cache.readSeasonCatalog()).toBeNull();
    expect(await cache.readYearsMeta()).toBeNull();
    expect(await cache.readYearPartition(2026)).toBeNull();
    expect(await cache.readAllYearPartitions()).toEqual([]);
    await expect(cache.writeLeagueCatalog(catalogRecord([]))).resolves.toBeUndefined();
    await expect(cache.writeYearsMeta(yearsMeta())).resolves.toBeUndefined();
    await expect(cache.clearAll()).resolves.toBeUndefined();
  });

  it('a failed open is not memoized: database() rejects once then retries', async () => {
    installOpenFailingOnce();
    const cache = new ArchiveCacheService();

    await expect(cache.database()).rejects.toThrow('Injected open failure');

    await expect(cache.database()).resolves.toBeDefined();
  });

  it('the cache recovers after a transient open failure', async () => {
    installOpenFailingOnce();
    const cache = new ArchiveCacheService();

    expect(await cache.readLeagueCatalog()).toBeNull();

    const record = catalogRecord([league('a')]);
    await cache.writeLeagueCatalog(record);
    expect(await cache.readLeagueCatalog()).toEqual(record);
  });

  it('exposes no method that writes a single year partition', () => {
    expect(Object.getOwnPropertyNames(ArchiveCacheService.prototype).filter((name) => /partition/i.test(name)).sort())
      .toEqual(['readAllYearPartitions', 'readYearPartition']);
  });

  it('never puts into the year-partition store', () => {
    expect(cacheSource).not.toMatch(/objectStore\(CACHE_YEAR_PARTITION_STORE\)\.put\(/);
    expect(cacheSource).not.toMatch(/CACHE_YEAR_PARTITION_STORE\]\s*,\s*'readwrite'/);
  });

  it('holds no localStorage and no second TTL', () => {
    expect(cacheSource).not.toMatch(/localStorage|sessionStorage|readCatalogEntry|writeCatalogEntry/);
    expect(cacheSource).not.toMatch(/24 \* 60 \* 60 \* 1000|86400000|86_400_000/);
    expect(CATALOG_TTL_MS).toBe(86_400_000);
  });

  it('isArchiveCatalogFresh follows the 24h contract', () => {
    const now = Date.parse('2026-08-22T10:00:00.000Z');
    const at = (offsetMs: number): ArchiveCatalogRecord<unknown> => catalogRecord([], new Date(now - offsetMs).toISOString());

    expect(isArchiveCatalogFresh(at(0), now)).toBe(true);
    expect(isArchiveCatalogFresh(at(23 * 60 * 60 * 1000), now)).toBe(true);
    expect(isArchiveCatalogFresh(at(CATALOG_TTL_MS), now)).toBe(false);
    expect(isArchiveCatalogFresh(catalogRecord([], 'not-a-date'), now)).toBe(false);
  });

  it('utcDayKey formats the UTC day', () => {
    expect(utcDayKey(Date.parse('2026-08-22T23:30:00Z'))).toBe('2026-08-22');
  });
});
