import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `fake-indexeddb` is not a dependency and this ticket adds none, so the IndexedDB surface the
 * cache uses is stubbed in-memory here — the same fake `local-league-archive-backend.service.test.ts`
 * uses, plus `clear()` and string-normalized keys, because the year store is keyed by a number.
 */
interface FakeStore { keyPath: string; rows: Map<string, unknown> }
interface FakeDatabaseState { version: number; stores: Map<string, FakeStore> }

const databases = new Map<string, FakeDatabaseState>();
let failPutAt: number | null = null;
let putCount = 0;
let readwriteTransactionCount = 0;

function clone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class FakeObjectStore {
  constructor(private readonly store: FakeStore, private readonly transaction: FakeTransaction) {}

  getAll(): FakeRequest<unknown[]> {
    return this.transaction.enqueue(() => [...this.store.rows.values()].map((row) => clone(row)));
  }

  get(key: unknown): FakeRequest<unknown> {
    const row = this.store.rows.get(String(key));
    return this.transaction.enqueue(() => (row === undefined ? undefined : clone(row)));
  }

  put(value: Record<string, unknown>): FakeRequest<string> {
    return this.transaction.enqueue(() => {
      putCount += 1;
      if (putCount === failPutAt) throw new DOMException('Injected put failure', 'ConstraintError');
      const key = String(value[this.store.keyPath]);
      this.store.rows.set(key, clone(value));
      return key;
    });
  }

  delete(key: unknown): FakeRequest<undefined> {
    return this.transaction.enqueue(() => { this.store.rows.delete(String(key)); return undefined; });
  }

  clear(): FakeRequest<undefined> {
    return this.transaction.enqueue(() => { this.store.rows.clear(); return undefined; });
  }
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private pending = 0;
  private failed = false;
  private settled = false;
  private readonly snapshot: Map<string, Map<string, unknown>>;

  constructor(private readonly state: FakeDatabaseState, readonly mode: string) {
    this.snapshot = new Map([...state.stores].map(([name, store]) => [name, new Map([...store.rows].map(([key, value]) => [key, clone(value)]))]));
  }

  abort(): void { this.failed = true; queueMicrotask(() => this.settle(true)); }

  objectStore(name: string): FakeObjectStore {
    const store = this.state.stores.get(name);
    if (!store) throw new Error(`NotFoundError: object store ${name}`);
    return new FakeObjectStore(store, this);
  }

  enqueue<T>(run: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      this.pending -= 1;
      try { request.result = run(); request.onsuccess?.(); }
      catch (error) { this.failed = true; request.error = error as DOMException; request.onerror?.(); }
      if (this.pending === 0) setTimeout(() => this.settle(), 0);
    });
    return request;
  }

  private settle(aborted = false): void {
    if (this.settled) return;
    this.settled = true;
    if (this.failed) {
      for (const [name, rows] of this.snapshot) {
        const store = this.state.stores.get(name);
        if (store) store.rows = new Map(rows);
      }
      if (aborted) this.onabort?.(); else this.onerror?.();
    } else this.oncomplete?.();
  }
}

class FakeDatabase {
  readonly objectStoreNames: { contains: (name: string) => boolean };

  constructor(private readonly state: FakeDatabaseState) {
    this.objectStoreNames = { contains: (name: string) => this.state.stores.has(name) };
  }

  createObjectStore(name: string, options: { keyPath: string }): void {
    this.state.stores.set(name, { keyPath: options.keyPath, rows: new Map() });
  }

  transaction(_names: string[], mode: string): FakeTransaction {
    if (mode === 'readwrite') readwriteTransactionCount += 1;
    return new FakeTransaction(this.state, mode);
  }

  close(): void {}
}

const fakeIndexedDb = {
  open(name: string, version: number): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      const existing = databases.get(name);
      const state = existing ?? { version: 0, stores: new Map<string, FakeStore>() };
      if (!existing) databases.set(name, state);
      const upgradeNeeded = state.version < version;
      request.result = new FakeDatabase(state);
      if (upgradeNeeded) { state.version = version; request.onupgradeneeded?.(); }
      queueMicrotask(() => request.onsuccess?.());
    });
    return request;
  }
};

const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

function installFakeIndexedDb(): void {
  Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDb as unknown as IDBFactory, configurable: true, writable: true });
}

beforeEach(() => {
  databases.clear();
  failPutAt = null;
  putCount = 0;
  readwriteTransactionCount = 0;
  installFakeIndexedDb();
});

afterEach(() => {
  if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
  else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'indexedDB');
});

import {
  ARCHIVE_CACHE_DB_NAME, ARCHIVE_CACHE_DB_VERSION, ARCHIVE_CACHE_STORES, ARCHIVE_CATALOG_KEY,
  ARCHIVE_YEARS_META_KEY, ArchiveCacheService, CACHE_LEAGUE_STORE,
  CACHE_YEAR_PARTITION_STORE, CATALOG_TTL_MS, isArchiveCatalogFresh, utcDayKey
} from './archive-cache.service';
import type { ArchiveCatalogRecord, ArchiveLeagueSummary, ArchiveYearPartition, ArchiveYearsMetaRecord } from './archive-cache.service';

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
  databases.get(ARCHIVE_CACHE_DB_NAME)!.stores.get(store)!.rows.set(key, value);
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

    expect([...databases.get(ARCHIVE_CACHE_DB_NAME)!.stores.keys()]).toEqual([...ARCHIVE_CACHE_STORES]);
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
    readwriteTransactionCount = 0;

    await cache.clearAll();

    expect(readwriteTransactionCount).toBe(1);
    expect(await cache.readLeagueCatalog()).toBeNull();
    expect(await cache.readSeasonCatalog()).toBeNull();
    expect(await cache.readYearsMeta()).toBeNull();
    expect(await cache.readAllYearPartitions()).toEqual([]);
  });

  it('a failed read is a miss, never a throw', async () => {
    const cache = new ArchiveCacheService();
    await cache.database();
    databases.get(ARCHIVE_CACHE_DB_NAME)!.stores.get(CACHE_LEAGUE_STORE)!.rows = new ThrowingMap();

    expect(await cache.readLeagueCatalog()).toBeNull();
  });

  it('a failed write resolves and leaves the previous row in place', async () => {
    const cache = new ArchiveCacheService();
    const first = catalogRecord([league('a')]);
    await cache.writeLeagueCatalog(first);
    failPutAt = putCount + 1;

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
