import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import { Client } from '../api/generated/gones-api';
import { ArchiveBackfillQueue, classifyArchiveYear, isArchiveYearPartitionComplete } from '../backend/archive-backfill-queue';
import type { ArchiveYearPage } from '../backend/archive-backfill-queue';
import { ARCHIVE_CATALOG_KEY, ARCHIVE_YEARS_META_KEY, ArchiveCacheService, isArchiveCatalogFresh, utcDayKey } from '../backend/archive-cache.service';
import type {
  ArchiveCatalogRecord, ArchiveLeagueSeasonSummary, ArchiveLeagueSummary, ArchiveTournamentSummary,
  ArchiveYearEntry, ArchiveYearPartition
} from '../backend/archive-cache.service';
import { LocalArchiveBackend } from '../backend/local-archive-backend.service';
import type { LeagueStatus } from '../domain/archive-models';
import { isLocalArchiveId } from './archive-origin';
import type { ArchiveCatalogResponse } from './archive-summary';

/**
 * The archive read funnel (ADR 0028's two stores, one list; ADR 0039's one TTL).
 *
 * Public catalogs come from the server and are cached in `gones-archive-cache`; browser-authored
 * records come from the local authority and are never written into that cache — a purge must not
 * be able to delete something the user wrote. Every returned row carries `isLocal`, which is the
 * whole routing rule the table and the detail pages use.
 *
 * This file names no IndexedDB symbol on purpose: storage lives behind `ArchiveCacheService` and
 * `ArchiveBackfillQueue`, which is what keeps `server-authority-boundary.test.ts`'s allowlist
 * down to the two files that genuinely need the API.
 */

/** Renames `gones-league-updated`. Dispatched after every cache purge. */
export const ARCHIVE_UPDATED_EVENT = 'gones-archive-updated';

/** A row plus where it lives. `isLocal` is repository-only and is never stored in the cache. */
export type ArchiveLeagueRow = ArchiveLeagueSummary & { isLocal: boolean };
export type ArchiveLeagueSeasonRow = ArchiveLeagueSeasonSummary & { isLocal: boolean };
export type ArchiveTournamentRow = ArchiveTournamentSummary & { isLocal: boolean };

export interface ArchiveCatalogResult<T> {
  items: T[];
  totalCount: number;      // server totalCount + the browser-local row count
  truncated: boolean;      // the server hit its row cap
  fetchedAt: string;       // ISO instant of the server half; for Tournaments the OLDEST partition
  fromCache: boolean;      // the server half came from IndexedDB, no request was made
  stale: boolean;          // the server was not reached, or a year could not be refreshed
}

export interface ArchiveSeasonTournamentsResult {
  items: ArchiveTournamentRow[];
  /** true ⇒ served from IndexedDB or from the browser-local store; no request was made. */
  fromCache: boolean;
}

/** The runtime JSON, not the generated typing: NodaTime fields arrive as ISO strings. */
interface RawCatalog<T> { items: T[]; totalCount: number; truncated: boolean }
interface RawArchiveLeague { id: string; name: string; createdAt: unknown; updatedAt: unknown; documentVersion: number }
interface RawArchiveSeason {
  id: string; name: string; leagueId: string; status: string; updatedAt: unknown; documentVersion: number;
  tournamentCount: number; playerCount: number; firstTournamentDate?: unknown; lastTournamentDate?: unknown;
}
interface RawArchiveTournament {
  id: string; name: string; seasonId?: string | null; tournamentDate: unknown; status: string;
  updatedAt: unknown; documentVersion: number; playerCount: number;
}
interface RawArchiveYears { years: { year: number; locked: boolean; tournamentCount: number }[] }

/** Exactly the five archive reads this repository makes, and nothing else on `Client`. */
export interface ArchiveReadClient {
  getArchiveLeagueCatalog(): Observable<RawCatalog<RawArchiveLeague>>;
  getArchiveLeagueSeasonCatalog(): Observable<RawCatalog<RawArchiveSeason>>;
  getArchiveTournamentYearCatalog(year: string | undefined): Observable<RawCatalog<RawArchiveTournament>>;
  getArchiveYears(): Observable<RawArchiveYears>;
  archiveSeasonTournaments(seasonId: string): Observable<RawCatalog<RawArchiveTournament>>;
}

/**
 * Exactly the three browser-local reads this repository makes (ADR 0028). It consumes T10's
 * **summaries**, not its persisted documents, so a Season's counters have one definition in the app:
 * `summarizeLeagueSeason` counts the players the standings count, and a second formula here would
 * disagree with it the moment a round holds an entry that fails validation.
 */
interface LocalArchiveSource {
  listArchiveLeagueSummaries(): Promise<ArchiveCatalogResponse<ArchiveLeagueSummary>>;
  listLeagueSeasonSummaries(): Promise<ArchiveCatalogResponse<ArchiveLeagueSeasonSummary>>;
  listArchiveTournamentSummaries(): Promise<ArchiveCatalogResponse<ArchiveTournamentSummary>>;
}

/** `[]` when either bound is null, when a bound is not a `YYYY-…` string, or when last < first. */
export function archiveYearRange(firstTournamentDate: string | null, lastTournamentDate: string | null): number[] {
  if (!firstTournamentDate || !lastTournamentDate) return [];
  const from = Number(firstTournamentDate.slice(0, 4));
  const to = Number(lastTournamentDate.slice(0, 4));
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return [];
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** The server's `tournament_date DESC, document_id COLLATE "C" ASC`, reproduced byte for byte. */
export function compareArchiveTournamentRows(left: ArchiveTournamentSummary, right: ArchiveTournamentSummary): number {
  if (left.tournamentDate !== right.tournamentDate) return left.tournamentDate < right.tournamentDate ? 1 : -1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

const toStatus = (value: string): LeagueStatus => (value === 'completed' ? 'completed' : 'active');
const toText = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const toOptionalText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

const toLeagueRow = (raw: RawArchiveLeague): ArchiveLeagueSummary =>
  ({ id: raw.id, name: raw.name, createdAt: toText(raw.createdAt), updatedAt: toText(raw.updatedAt), documentVersion: raw.documentVersion });

const toSeasonRow = (raw: RawArchiveSeason): ArchiveLeagueSeasonSummary => ({
  id: raw.id, name: raw.name, leagueId: raw.leagueId, status: toStatus(raw.status),
  updatedAt: toText(raw.updatedAt), documentVersion: raw.documentVersion,
  tournamentCount: raw.tournamentCount, playerCount: raw.playerCount,
  firstTournamentDate: toOptionalText(raw.firstTournamentDate),
  lastTournamentDate: toOptionalText(raw.lastTournamentDate)
});

const toTournamentRow = (raw: RawArchiveTournament): ArchiveTournamentSummary => ({
  id: raw.id, name: raw.name, seasonId: raw.seasonId ?? null, tournamentDate: toText(raw.tournamentDate),
  status: toStatus(raw.status), updatedAt: toText(raw.updatedAt), documentVersion: raw.documentVersion,
  playerCount: raw.playerCount
});

/** Origin is a repository concern: it is added on the way out and never on the way into the cache. */
const tag = <T extends object>(row: T, isLocal: boolean): T & { isLocal: boolean } => ({ ...row, isLocal });

/** One tier's plumbing, so the League and Season catalogs cannot drift apart. */
interface CatalogPort<TRaw, TRow extends object> {
  read(): Promise<ArchiveCatalogRecord<TRow> | null>;
  write(record: ArchiveCatalogRecord<TRow>): Promise<void>;
  fetch(): Observable<RawCatalog<TRaw>>;
  normalize(raw: TRaw): TRow;
  local(): Promise<ArchiveCatalogResponse<TRow>>;
}

@Injectable({ providedIn: 'root' })
export class ArchiveRepository {
  private readonly client: ArchiveReadClient = inject(Client);
  private readonly cache = inject(ArchiveCacheService);
  private readonly queue = inject(ArchiveBackfillQueue);
  private readonly local: LocalArchiveSource = inject(LocalArchiveBackend);

  listLeagues(options: { force?: boolean } = {}): Promise<ArchiveCatalogResult<ArchiveLeagueRow>> {
    return this.loadCatalog<RawArchiveLeague, ArchiveLeagueSummary>({
      read: () => this.cache.readLeagueCatalog(),
      write: (record) => this.cache.writeLeagueCatalog(record),
      fetch: () => this.client.getArchiveLeagueCatalog(),
      normalize: toLeagueRow,
      local: () => this.local.listArchiveLeagueSummaries()
    }, options.force === true);
  }

  listLeagueSeasons(options: { force?: boolean } = {}): Promise<ArchiveCatalogResult<ArchiveLeagueSeasonRow>> {
    return this.loadCatalog<RawArchiveSeason, ArchiveLeagueSeasonSummary>({
      read: () => this.cache.readSeasonCatalog(),
      write: (record) => this.cache.writeSeasonCatalog(record),
      fetch: () => this.client.getArchiveLeagueSeasonCatalog(),
      normalize: toSeasonRow,
      local: () => this.local.listLeagueSeasonSummaries()
    }, options.force === true);
  }

  /** Ascending by year. Served from the `meta` snapshot only while it carries today's UTC day. */
  async listYears(options: { force?: boolean } = {}): Promise<ArchiveYearEntry[]> {
    return (await this.loadYears(options)).years;
  }

  /** Backfills every missing or stale year, then serves every cached partition plus local rows. */
  async listTournaments(options: { force?: boolean } = {}): Promise<ArchiveCatalogResult<ArchiveTournamentRow>> {
    const localRows = await this.readLocal(() => this.local.listArchiveTournamentSummaries());
    const loaded = await this.loadYearsOrDegrade(options);
    let stale = loaded.stale;
    let fromCache = loaded.fromCache;

    let partitions = await this.cache.readAllYearPartitions();
    // A years index that came from the offline fallback cannot say which years are locked, so running
    // the queue off it would refetch the whole archive on every load. Serve what is stored instead.
    if (!loaded.unavailable && !stale) {
      const cached = new Map(partitions.map((partition) => [partition.year, partition]));
      const due = loaded.years
        .filter((entry) => options.force === true || classifyArchiveYear(cached.get(entry.year), entry) !== 'fresh')
        .map((entry) => entry.year);
      if (due.length > 0) {
        this.queue.enqueue(due);
        const report = await this.queue.drain((year) => this.loadYearPage(year));
        if (report.failed.length > 0) stale = true;
        fromCache = false;
        partitions = await this.cache.readAllYearPartitions();
      }
    }
    if (loaded.unavailable && partitions.length === 0 && localRows.length === 0) throw loaded.error;

    const items = [...partitions.flatMap((partition) => partition.items).map((row) => tag(row, false)), ...localRows.map((row) => tag(row, true))]
      .sort(compareArchiveTournamentRows);
    return {
      items,
      totalCount: partitions.reduce((total, partition) => total + partition.rowCount, 0) + localRows.length,
      // `rowCount` is the server's uncapped count, so a capped year shows up as fewer rows than that.
      truncated: partitions.some((partition) => partition.items.length < partition.rowCount),
      fetchedAt: oldestCompletedAt(partitions) ?? new Date().toISOString(),
      fromCache,
      stale
    };
  }

  /** §8.1 read-through. Writes nothing, ever. */
  async listSeasonTournaments(season: {
    id: string;
    firstTournamentDate: string | null;
    lastTournamentDate: string | null;
  }): Promise<ArchiveSeasonTournamentsResult> {
    // A browser-authored Season has no server half; asking the API for it would 404 forever.
    if (isLocalArchiveId(season.id)) {
      const tournaments = await this.readLocal(() => this.local.listArchiveTournamentSummaries());
      return {
        items: tournaments.filter((item) => item.seasonId === season.id).map((item) => tag(item, true)).sort(compareArchiveTournamentRows),
        fromCache: true
      };
    }
    const years = archiveYearRange(season.firstTournamentDate, season.lastTournamentDate);
    if (years.length === 0) return { items: [], fromCache: true };
    const index = new Map((await this.listYears()).map((entry) => [entry.year, entry]));
    const partitions = await Promise.all(years.map((year) => this.cache.readYearPartition(year)));
    // Cached, complete AND locked for every year the Season spans — anything less and a row could
    // have changed since the partition was taken, so the server answers instead.
    const servable = years.every((year, position) => index.get(year)?.locked === true && isArchiveYearPartitionComplete(partitions[position]));
    if (servable) {
      return {
        items: partitions
          .flatMap((partition) => partition?.items ?? [])
          .filter((item) => item.seasonId === season.id)
          .map((item) => tag(item, false))
          .sort(compareArchiveTournamentRows),
        fromCache: true
      };
    }
    // Deliberately not cached: caching it here would make a second writer of the year store and
    // could leave a half-year behind. Rendering it and forgetting it is the whole design.
    const response = await firstValueFrom(this.client.archiveSeasonTournaments(season.id));
    return {
      items: (response.items ?? []).map((raw) => tag(toTournamentRow(raw), false)).sort(compareArchiveTournamentRows),
      fromCache: false
    };
  }

  /**
   * The single funnel every archive mutation goes through: drop every cached catalog, then tell
   * the app. The TTL governs navigation, never correctness (ADR 0039), so a write must never wait
   * out 24 hours to become visible.
   */
  async invalidateArchiveCaches(): Promise<void> {
    await this.cache.clearAll();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ARCHIVE_UPDATED_EVENT));
  }

  private async loadCatalog<TRaw, TRow extends object>(
    port: CatalogPort<TRaw, TRow>,
    force: boolean
  ): Promise<ArchiveCatalogResult<TRow & { isLocal: boolean }>> {
    const [record, localRows] = await Promise.all([port.read(), this.readLocal(port.local)]);
    const merge = (
      items: TRow[],
      totalCount: number,
      truncated: boolean,
      fetchedAt: string,
      fromCache: boolean,
      stale: boolean
    ): ArchiveCatalogResult<TRow & { isLocal: boolean }> => ({
      items: [...items.map((row) => tag(row, false)), ...localRows.map((row) => tag(row, true))],
      totalCount: totalCount + localRows.length,
      truncated,
      fetchedAt,
      fromCache,
      stale
    });

    if (!force && record && isArchiveCatalogFresh(record)) {
      return merge(record.items, record.totalCount, record.truncated, record.fetchedAt, true, false);
    }
    try {
      const response = await firstValueFrom(port.fetch());
      const fresh: ArchiveCatalogRecord<TRow> = {
        key: ARCHIVE_CATALOG_KEY,
        items: (response.items ?? []).map(port.normalize),
        totalCount: response.totalCount,
        truncated: response.truncated,
        fetchedAt: new Date().toISOString()
      };
      await port.write(fresh);
      return merge(fresh.items, fresh.totalCount, fresh.truncated, fresh.fetchedAt, false, false);
    } catch (error) {
      if (record) return merge(record.items, record.totalCount, record.truncated, record.fetchedAt, false, true);
      // The local half alone is a truthful answer; an empty state would not be (ADR 0031).
      if (localRows.length > 0) return merge([], 0, false, new Date().toISOString(), false, true);
      throw error;
    }
  }

  /** Turns "there is no years index at all" into a value, so the Tournament read stays linear. */
  private async loadYearsOrDegrade(
    options: { force?: boolean }
  ): Promise<{ years: ArchiveYearEntry[]; stale: boolean; fromCache: boolean; unavailable: boolean; error?: unknown }> {
    try {
      return { ...(await this.loadYears(options)), unavailable: false };
    } catch (error) {
      return { years: [], stale: true, fromCache: false, unavailable: true, error };
    }
  }

  private async loadYears(options: { force?: boolean }): Promise<{ years: ArchiveYearEntry[]; stale: boolean; fromCache: boolean }> {
    const snapshot = await this.cache.readYearsMeta();
    // `locked` flips at midnight UTC, so a snapshot is worthless the moment the day rolls over —
    // the same reason the server puts the UTC day in this endpoint's ETag.
    if (!options.force && snapshot && snapshot.utcDay === utcDayKey()) return { years: snapshot.years, stale: false, fromCache: true };
    try {
      const response = await firstValueFrom(this.client.getArchiveYears());
      const years = [...(response.years ?? [])].sort((left, right) => left.year - right.year);
      await this.cache.writeYearsMeta({ key: ARCHIVE_YEARS_META_KEY, years, fetchedAt: new Date().toISOString(), utcDay: utcDayKey() });
      return { years, stale: false, fromCache: false };
    } catch (error) {
      // Offline: the snapshot still says which years exist, but never that one is immutable.
      if (snapshot) return { years: snapshot.years.map((entry) => ({ ...entry, locked: false })), stale: true, fromCache: true };
      throw error;
    }
  }

  private async loadYearPage(year: number): Promise<ArchiveYearPage> {
    const response = await firstValueFrom(this.client.getArchiveTournamentYearCatalog(String(year)));
    return { items: (response.items ?? []).map(toTournamentRow), totalCount: response.totalCount, truncated: response.truncated };
  }

  /** A browser-local store that will not open is an empty local half, never a failed page. */
  private async readLocal<T>(read: () => Promise<ArchiveCatalogResponse<T>>): Promise<T[]> {
    try {
      return (await read()).items;
    } catch {
      return [];
    }
  }
}

/** The served catalog is only as fresh as its oldest year. */
function oldestCompletedAt(partitions: ArchiveYearPartition[]): string | undefined {
  return partitions
    .map((partition) => partition.completedAt)
    .filter((completedAt): completedAt is string => Boolean(completedAt))
    .sort()[0];
}
