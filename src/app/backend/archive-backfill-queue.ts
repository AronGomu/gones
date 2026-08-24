import { Injectable, computed, inject, signal } from '@angular/core';
import { ArchiveCacheService, CACHE_YEAR_PARTITION_STORE, CATALOG_TTL_MS } from './archive-cache.service';
import type { ArchiveTournamentSummary, ArchiveYearEntry, ArchiveYearPartition } from './archive-cache.service';
import { requestResult, runTransaction } from './indexed-db';

/**
 * The **only** writer of the `year-partitions` store.
 *
 * The Tournament table cannot be fetched in one body — the measured peak is about 17,500
 * Tournaments in a single year — so it is cached one calendar year per record, and this queue
 * fills those records one at a time. Everything here exists to keep one rule true: a year is
 * atomically whole or absent. The partition is built with its `completedAt` stamp already set
 * and written by a single `put` inside a single transaction, so a browser killed mid-backfill
 * leaves no record rather than a half one, and a reader never has to ask whether a year it can
 * see is finished.
 */

/** One year as the server answered it, before it becomes a partition. */
export interface ArchiveYearPage { items: ArchiveTournamentSummary[]; totalCount: number; truncated: boolean }
export type ArchiveYearLoader = (year: number) => Promise<ArchiveYearPage>;
export type ArchiveYearFreshness = 'fresh' | 'stale' | 'missing';
export interface ArchiveBackfillFailure { year: number; error: unknown }
export interface ArchiveBackfillReport { written: number[]; failed: ArchiveBackfillFailure[] }

/** Complete means stamped. An unstamped record is not a year, it is debris. */
export function isArchiveYearPartitionComplete(partition: ArchiveYearPartition | null | undefined): partition is ArchiveYearPartition {
  return Boolean(partition && partition.completedAt);
}

/**
 * Freshness of one cached year.
 *
 * A locked year can never change again, so it is served whatever its age — that is the whole
 * reason the years index puts `locked` on the wire. An unlocked year obeys the one 24h TTL of
 * ADR 0039, and an instant that will not parse counts as expired, so a corrupt stamp cannot pin
 * a page to old data forever.
 */
export function classifyArchiveYear(
  partition: ArchiveYearPartition | null | undefined,
  entry: ArchiveYearEntry,
  now = Date.now()
): ArchiveYearFreshness {
  if (!isArchiveYearPartitionComplete(partition)) return 'missing';
  if (entry.locked) return 'fresh';
  const completedAt = Date.parse(partition.completedAt ?? '');
  return Number.isFinite(completedAt) && now - completedAt < CATALOG_TTL_MS ? 'fresh' : 'stale';
}

@Injectable({ providedIn: 'root' })
export class ArchiveBackfillQueue {
  private readonly cache = inject(ArchiveCacheService);
  private readonly queued = signal<readonly number[]>([]);
  private inFlight?: Promise<ArchiveBackfillReport>;

  /** Years waiting, in enqueue order, deduplicated. */
  readonly pending = computed(() => this.queued());
  /** True while a drain is in flight. */
  readonly running = signal(false);

  /** Appends the years not already waiting. Enqueueing never starts work. */
  enqueue(years: readonly number[]): void {
    const current = this.queued();
    const added = years.filter((year) => Number.isInteger(year) && !current.includes(year));
    if (added.length === 0) return;
    this.queued.set([...current, ...added]);
  }

  /**
   * One drain at a time, one year at a time. A second caller joins the run in flight instead of
   * starting a second writer — "single writer" is not a comment, it is this branch.
   */
  drain(loader: ArchiveYearLoader): Promise<ArchiveBackfillReport> {
    this.inFlight ??= this.run(loader).finally(() => {
      this.inFlight = undefined;
      this.running.set(false);
    });
    return this.inFlight;
  }

  private async run(loader: ArchiveYearLoader): Promise<ArchiveBackfillReport> {
    this.running.set(true);
    const report: ArchiveBackfillReport = { written: [], failed: [] };
    for (let next = this.take(); next !== undefined; next = this.take()) {
      try {
        await this.store(next, await loader(next));
        report.written.push(next);
      } catch (error) {
        report.failed.push({ year: next, error });
      }
    }
    return report;
  }

  /** Shifts the head off the queue, so a year enqueued mid-run is picked up by this run. */
  private take(): number | undefined {
    const [head, ...rest] = this.queued();
    if (head === undefined) return undefined;
    this.queued.set(rest);
    return head;
  }

  /**
   * The atomic unit of this whole cache: the record is complete in memory before the transaction
   * opens, so the only two outcomes are a committed whole year and no change at all. A rejected
   * `put` rolls the transaction back and `runTransaction` rejects, which lands the year in
   * `report.failed` with nothing written.
   */
  private async store(year: number, page: ArchiveYearPage): Promise<void> {
    const partition: ArchiveYearPartition = {
      year,
      completedAt: new Date().toISOString(),
      // The server's uncapped count, so a truncated year is visible as items.length < rowCount.
      rowCount: page.totalCount,
      items: page.items
    };
    // Spelled out rather than inferred: `server-authority-boundary.test.ts` detects IndexedDB users
    // by the type names their source carries, and a writer of a browser store must not be invisible
    // to that assertion.
    const database: IDBDatabase = await this.cache.database();
    await runTransaction(database, [CACHE_YEAR_PARTITION_STORE], 'readwrite', async (transaction) => {
      await requestResult(transaction.objectStore(CACHE_YEAR_PARTITION_STORE).put(partition));
    });
  }
}
