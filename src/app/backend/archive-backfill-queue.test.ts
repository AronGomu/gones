import '@angular/compiler';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Injector } from '@angular/core';
import { ARCHIVE_CACHE_DB_NAME, ArchiveCacheService, CACHE_YEAR_PARTITION_STORE, CATALOG_TTL_MS } from './archive-cache.service';
import type { ArchiveTournamentSummary, ArchiveYearEntry, ArchiveYearPartition } from './archive-cache.service';
import { ArchiveBackfillQueue, classifyArchiveYear, isArchiveYearPartitionComplete } from './archive-backfill-queue';
import type { ArchiveYearPage } from './archive-backfill-queue';
import { fakeIndexedDbState, installFakeIndexedDb, resetFakeIndexedDb, restoreRealIndexedDb } from './in-memory-indexeddb.fake';

beforeEach(() => {
  resetFakeIndexedDb();
  installFakeIndexedDb();
});

afterEach(() => {
  restoreRealIndexedDb();
});

const row = (id: string, tournamentDate: string): ArchiveTournamentSummary =>
  ({ id, name: id, seasonId: null, tournamentDate, status: 'completed', updatedAt: '2026-08-01T00:00:00.000Z', documentVersion: 1, playerCount: 4 });
const page = (items: ArchiveTournamentSummary[], totalCount = items.length, truncated = false): ArchiveYearPage => ({ items, totalCount, truncated });
const entry = (year: number, locked: boolean): ArchiveYearEntry => ({ year, locked, tournamentCount: 1 });
const build = (): { queue: ArchiveBackfillQueue; cache: ArchiveCacheService } => {
  const cache = new ArchiveCacheService();
  const injector = Injector.create({ providers: [ArchiveBackfillQueue, { provide: ArchiveCacheService, useValue: cache }] });
  return { cache, queue: injector.get(ArchiveBackfillQueue) };
};
/** The raw stored row, bypassing the completeness filter, so "nothing was written" is provable. */
const storedRow = (year: number): unknown =>
  fakeIndexedDbState.databases.get(ARCHIVE_CACHE_DB_NAME)?.stores.get(CACHE_YEAR_PARTITION_STORE)?.rows.get(String(year));

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = join(srcRoot, '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    if (item.isDirectory()) return sourceFiles(path);
    return item.isFile() && item.name.endsWith('.ts') && !item.name.endsWith('.test.ts') ? [path] : [];
  });
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles(srcRoot)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repoRoot, path).split('\\').join('/'))
    .sort();
}

describe('archive year freshness', () => {
  it('classifies an absent partition as missing', () => {
    expect(classifyArchiveYear(null, entry(2026, false))).toBe('missing');
    expect(isArchiveYearPartitionComplete(null)).toBe(false);
  });

  it('classifies a partition without completedAt as missing', () => {
    const partition: ArchiveYearPartition = { year: 2026, completedAt: undefined, rowCount: 0, items: [] };

    expect(classifyArchiveYear(partition, entry(2026, false))).toBe('missing');
    expect(isArchiveYearPartitionComplete(partition)).toBe(false);
  });

  it('classifies a locked year as fresh whatever its age', () => {
    const now = Date.parse('2026-08-22T10:00:00.000Z');
    const partition: ArchiveYearPartition = { year: 2024, completedAt: new Date(now - 400 * 86_400_000).toISOString(), rowCount: 0, items: [] };

    expect(classifyArchiveYear(partition, entry(2024, true), now)).toBe('fresh');
  });

  it('classifies an unlocked year under 24h as fresh', () => {
    const now = Date.parse('2026-08-22T10:00:00.000Z');
    const partition: ArchiveYearPartition = { year: 2026, completedAt: new Date(now - 23 * 3_600_000).toISOString(), rowCount: 0, items: [] };

    expect(classifyArchiveYear(partition, entry(2026, false), now)).toBe('fresh');
  });

  it('classifies an unlocked year at exactly 24h as stale', () => {
    const now = Date.parse('2026-08-22T10:00:00.000Z');
    const partition: ArchiveYearPartition = { year: 2026, completedAt: new Date(now - CATALOG_TTL_MS).toISOString(), rowCount: 0, items: [] };

    expect(classifyArchiveYear(partition, entry(2026, false), now)).toBe('stale');
  });

  it('classifies an unparsable completedAt as stale when unlocked and fresh when locked', () => {
    const partition: ArchiveYearPartition = { year: 2026, completedAt: 'soon', rowCount: 0, items: [] };

    expect(classifyArchiveYear(partition, entry(2026, false))).toBe('stale');
    expect(classifyArchiveYear(partition, entry(2026, true))).toBe('fresh');
  });
});

describe('archive backfill queue', () => {
  it('writes a partition stamped completedAt in one transaction', async () => {
    const { cache, queue } = build();
    await cache.database();
    fakeIndexedDbState.readwriteTransactionCount = 0;
    queue.enqueue([2026]);

    const report = await queue.drain(async () => page([row('id-a', '2026-01-02'), row('id-b', '2026-03-04')]));

    expect(report.written).toEqual([2026]);
    expect(fakeIndexedDbState.readwriteTransactionCount).toBe(1);
    const stored = await cache.readYearPartition(2026);
    expect(stored).toMatchObject({ year: 2026, rowCount: 2 });
    expect(stored!.items.map((item) => item.id)).toEqual(['id-a', 'id-b']);
    expect(Number.isFinite(Date.parse(stored!.completedAt ?? ''))).toBe(true);
  });

  it('records the uncapped totalCount so truncation is visible', async () => {
    const { cache, queue } = build();
    queue.enqueue([2026]);

    await queue.drain(async () => page([row('a', '2026-01-01'), row('b', '2026-01-02'), row('c', '2026-01-03')], 25_001, true));

    const stored = await cache.readYearPartition(2026);
    expect(stored!.rowCount).toBe(25_001);
    expect(stored!.items).toHaveLength(3);
  });

  it('an aborted write leaves the previously stored partition unchanged', async () => {
    const { cache, queue } = build();
    queue.enqueue([2026]);
    await queue.drain(async () => page([row('id-a', '2026-01-02'), row('id-b', '2026-03-04')]));
    const first = await cache.readYearPartition(2026);
    const firstRaw = structuredClone(storedRow(2026));
    fakeIndexedDbState.failPutAt = fakeIndexedDbState.putCount + 1;
    queue.enqueue([2026]);

    const report = await queue.drain(async () => page([row('id-z', '2026-09-09')], 1));

    expect(report.written).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].year).toBe(2026);
    expect(await cache.readYearPartition(2026)).toEqual(first);
    expect(storedRow(2026)).toEqual(firstRaw);
  });

  it('a rejected loader writes no record at all', async () => {
    const { cache, queue } = build();
    queue.enqueue([2026]);

    const report = await queue.drain(async () => { throw new Error('offline'); });

    expect(await cache.readYearPartition(2026)).toBeNull();
    expect(await cache.readAllYearPartitions()).toEqual([]);
    expect(storedRow(2026)).toBeUndefined();
    expect((report.failed[0].error as Error).message).toBe('offline');
    expect(report.written).toEqual([]);
  });

  it('a failed year does not stop the run', async () => {
    const { cache, queue } = build();
    queue.enqueue([2024, 2025]);

    const report = await queue.drain(async (year) => {
      if (year === 2024) throw new Error('offline');
      return page([row('id-a', '2025-05-05')]);
    });

    expect(report.written).toEqual([2025]);
    expect(report.failed.map((failure) => failure.year)).toEqual([2024]);
    expect(await cache.readYearPartition(2025)).not.toBeNull();
    expect(await cache.readYearPartition(2024)).toBeNull();
  });

  it('drains in enqueue order, one year at a time', async () => {
    const { queue } = build();
    const calls: number[] = [];
    let inFlight = 0;
    queue.enqueue([2026, 2024, 2025]);

    await queue.drain(async (year) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      calls.push(year);
      await Promise.resolve();
      inFlight -= 1;
      return page([]);
    });

    expect(calls).toEqual([2026, 2024, 2025]);
  });

  it('deduplicates a year already queued', async () => {
    const { queue } = build();
    queue.enqueue([2026]);
    queue.enqueue([2026, 2027]);

    expect(queue.pending()).toEqual([2026, 2027]);

    const calls: number[] = [];
    await queue.drain(async (year) => { calls.push(year); return page([]); });

    expect(calls).toEqual([2026, 2027]);
  });

  it('a year enqueued during a drain is processed by that drain', async () => {
    const { queue } = build();
    queue.enqueue([2026]);

    const report = await queue.drain(async (year) => {
      if (year === 2026) queue.enqueue([2027]);
      return page([]);
    });

    expect(report.written).toEqual([2026, 2027]);
  });

  it('a second drain while one is running joins the first', async () => {
    const { queue } = build();
    queue.enqueue([2026]);
    let loaderBCalls = 0;

    const first = queue.drain(async () => page([]));
    const second = queue.drain(async () => { loaderBCalls += 1; return page([]); });

    expect(queue.running()).toBe(true);
    expect(second).toBe(first);
    expect(await first).toBe(await second);
    expect(loaderBCalls).toBe(0);
  });

  it('pending and running track the queue', async () => {
    const { queue } = build();
    queue.enqueue([2026]);

    expect(queue.pending()).toEqual([2026]);
    expect(queue.running()).toBe(false);

    let duringPending: readonly number[] = [-1];
    let duringRunning = false;
    await queue.drain(async () => {
      duringPending = queue.pending();
      duringRunning = queue.running();
      return page([]);
    });

    expect(duringPending).toEqual([]);
    expect(duringRunning).toBe(true);
    expect(queue.pending()).toEqual([]);
    expect(queue.running()).toBe(false);
  });

  it('is the only file that writes the year-partition store', () => {
    expect(filesMatching(/CACHE_YEAR_PARTITION_STORE/)).toEqual([
      'src/app/backend/archive-backfill-queue.ts',
      'src/app/backend/archive-cache.service.ts'
    ]);
    expect(filesMatching(/objectStore\(CACHE_YEAR_PARTITION_STORE\)\.put\(/)).toEqual([
      'src/app/backend/archive-backfill-queue.ts'
    ]);
  });
});
