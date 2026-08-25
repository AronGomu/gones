import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injector } from '@angular/core';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '../api/generated/gones-api';
import { ArchiveBackfillQueue } from '../backend/archive-backfill-queue';
import type { ArchiveBackfillReport, ArchiveYearLoader } from '../backend/archive-backfill-queue';
import { ArchiveCacheService, ARCHIVE_CATALOG_KEY, ARCHIVE_YEARS_META_KEY, CATALOG_TTL_MS, utcDayKey } from '../backend/archive-cache.service';
import type {
  ArchiveCatalogRecord, ArchiveLeagueSeasonSummary, ArchiveLeagueSummary, ArchiveTournamentSummary,
  ArchiveYearPartition, ArchiveYearsMetaRecord
} from '../backend/archive-cache.service';
import { LocalArchiveBackend } from '../backend/local-archive-backend.service';
import { ServerArchiveBackend } from '../backend/server-archive-backend.service';
import { createArchiveTournament, createLeagueSeason } from '../domain/archive-models';
import { PowerUserSettingsService } from '../shared/power-user-settings.service';
import type { PersistedArchiveTournament, PersistedLeagueSeason, RoundEntry } from '../domain/archive-models';
import { summarizeArchiveTournament, summarizeLeagueSeason } from './archive-summary';
import type { ArchiveCatalogResponse } from './archive-summary';
import { ARCHIVE_UPDATED_EVENT, ArchiveRepository, archiveYearRange, compareArchiveTournamentRows } from './archive-repository.service';

const NOW = Date.parse('2026-08-22T12:00:00.000Z');

const catalogOf = <T>(items: T[], totalCount = items.length, truncated = false): ArchiveCatalogResponse<T> => ({ items, totalCount, truncated });

const leagueRecord = (items: ArchiveLeagueSummary[], fetchedAt: string): ArchiveCatalogRecord<ArchiveLeagueSummary> =>
  ({ key: ARCHIVE_CATALOG_KEY, items, totalCount: items.length, truncated: false, fetchedAt });

const serverLeague = (id: string): ArchiveLeagueSummary =>
  ({ id, name: `League ${id}`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', documentVersion: 1 });

const serverSeason = (id: string): ArchiveLeagueSeasonSummary => ({
  id, name: `Season ${id}`, leagueId: 'l1', status: 'active', updatedAt: '2026-01-02T00:00:00.000Z', documentVersion: 1,
  tournamentCount: 0, playerCount: 0, firstTournamentDate: null, lastTournamentDate: null
});

const serverTournament = (id: string, tournamentDate: string, seasonId: string | null = null): ArchiveTournamentSummary =>
  ({ id, name: id, seasonId, tournamentDate, status: 'completed', updatedAt: '2026-08-01T00:00:00.000Z', documentVersion: 1, playerCount: 4 });

const yearPartition = (year: number, items: ArchiveTournamentSummary[], completedAt = '2026-08-22T10:00:00.000Z', rowCount = items.length): ArchiveYearPartition =>
  ({ year, completedAt, rowCount, items });

const freshYearsMeta = (years: { year: number; locked: boolean; tournamentCount: number }[]): ArchiveYearsMetaRecord =>
  ({ key: ARCHIVE_YEARS_META_KEY, years, fetchedAt: new Date(NOW).toISOString(), utcDay: utcDayKey(NOW) });

/** Every method is a `vi.fn()`, so "this path wrote nothing" is one assertion rather than an inference. */
function cacheStub() {
  return {
    database: vi.fn<() => Promise<IDBDatabase>>(async () => { throw new Error('indexedDbUnavailable'); }),
    readLeagueCatalog: vi.fn<() => Promise<ArchiveCatalogRecord<ArchiveLeagueSummary> | null>>(async () => null),
    writeLeagueCatalog: vi.fn<(record: ArchiveCatalogRecord<ArchiveLeagueSummary>) => Promise<void>>(async () => undefined),
    readSeasonCatalog: vi.fn<() => Promise<ArchiveCatalogRecord<ArchiveLeagueSeasonSummary> | null>>(async () => null),
    writeSeasonCatalog: vi.fn<(record: ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>) => Promise<void>>(async () => undefined),
    readYearPartition: vi.fn<(year: number) => Promise<ArchiveYearPartition | null>>(async () => null),
    readAllYearPartitions: vi.fn<() => Promise<ArchiveYearPartition[]>>(async () => []),
    readYearsMeta: vi.fn<() => Promise<ArchiveYearsMetaRecord | null>>(async () => null),
    writeYearsMeta: vi.fn<(record: ArchiveYearsMetaRecord) => Promise<void>>(async () => undefined),
    clearAll: vi.fn<() => Promise<void>>(async () => undefined)
  };
}

function queueStub() {
  return {
    enqueue: vi.fn<(years: readonly number[]) => void>(),
    drain: vi.fn<(loader: ArchiveYearLoader) => Promise<ArchiveBackfillReport>>(async () => ({ written: [], failed: [] })),
    pending: () => [],
    running: () => false
  };
}

function localStub(parts: {
  leagues?: ArchiveLeagueSummary[];
  seasons?: ArchiveLeagueSeasonSummary[];
  tournaments?: ArchiveTournamentSummary[];
} = {}) {
  return {
    listArchiveLeagueSummaries: vi.fn(async () => catalogOf(parts.leagues ?? [])),
    listLeagueSeasonSummaries: vi.fn(async () => catalogOf(parts.seasons ?? [])),
    listArchiveTournamentSummaries: vi.fn(async () => catalogOf(parts.tournaments ?? []))
  };
}

function build(parts: {
  cache?: ReturnType<typeof cacheStub>;
  queue?: ReturnType<typeof queueStub>;
  client?: object;
  local?: object;
} = {}) {
  const cache = parts.cache ?? cacheStub();
  const queue = parts.queue ?? queueStub();
  const local = parts.local ?? localStub();
  const injector = Injector.create({
    providers: [
      ArchiveRepository,
      { provide: ArchiveCacheService, useValue: cache },
      { provide: ArchiveBackfillQueue, useValue: queue },
      { provide: LocalArchiveBackend, useValue: local },
      { provide: Client, useValue: parts.client ?? {} },
      // The staged-save half of the repository. None of the catalog reads below touches either, but
      // both are field-level `inject(...)` calls, so this bare injector has to be able to answer them.
      { provide: PowerUserSettingsService, useValue: { requireEnabled: () => undefined } },
      { provide: ServerArchiveBackend, useValue: {} }
    ]
  });
  return { repo: injector.get(ArchiveRepository), cache, queue, local };
}

const repositorySource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'archive-repository.service.ts'), 'utf8');

/** A persisted browser-local Tournament, so the shared summarizer can be run against it for real. */
function localTournamentDocument(id: string, seasonId: string, tournamentDate: string, entries: RoundEntry[]): PersistedArchiveTournament {
  return {
    ...createArchiveTournament({ id, seasonId, tournamentDate, status: 'completed', rounds: [{ id: '11111111-1111-4111-8111-111111111111', entries }] }),
    documentVersion: 1,
    updatedAt: '2026-08-01T00:00:00.000Z'
  };
}

const match = (id: string, player1Name: string, player2Name: string, player1Score = 2, player2Score = 1): RoundEntry =>
  ({ kind: 'match', id, table: '1', player1Name, player2Name, player1Score, player2Score, player1DeckArchetype: '', player2DeckArchetype: '' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe('archive repository — public catalogs', () => {
  it('serves the League catalog from IndexedDB while it is under 24h old', async () => {
    const cache = cacheStub();
    cache.readLeagueCatalog = vi.fn(async () => leagueRecord([serverLeague('a')], new Date(NOW - 3_600_000).toISOString()));
    const getArchiveLeagueCatalog = vi.fn(() => of(catalogOf([serverLeague('b')])));
    const { repo } = build({ cache, client: { getArchiveLeagueCatalog } });

    const result = await repo.listLeagues();

    expect(getArchiveLeagueCatalog).not.toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.items.map((item) => item.id)).toEqual(['a']);
  });

  it('refetches the League catalog past 24h and rewrites the record', async () => {
    const cache = cacheStub();
    cache.readLeagueCatalog = vi.fn(async () => leagueRecord([serverLeague('a')], new Date(NOW - 25 * 3_600_000).toISOString()));
    const getArchiveLeagueCatalog = vi.fn(() => of(catalogOf([serverLeague('b')], 9, true)));
    const { repo } = build({ cache, client: { getArchiveLeagueCatalog } });

    const result = await repo.listLeagues();

    expect(getArchiveLeagueCatalog).toHaveBeenCalledTimes(1);
    expect(cache.writeLeagueCatalog).toHaveBeenCalledTimes(1);
    const written = cache.writeLeagueCatalog.mock.calls[0][0];
    expect(written.items.map((item) => item.id)).toEqual(['b']);
    expect(written.fetchedAt).toBe(new Date(NOW).toISOString());
    expect(result.fromCache).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.totalCount).toBe(9);
  });

  it('force ignores a fresh record', async () => {
    const cache = cacheStub();
    cache.readLeagueCatalog = vi.fn(async () => leagueRecord([serverLeague('a')], new Date(NOW).toISOString()));
    const getArchiveLeagueCatalog = vi.fn(() => of(catalogOf([serverLeague('b')])));
    const { repo } = build({ cache, client: { getArchiveLeagueCatalog } });

    const result = await repo.listLeagues({ force: true });

    expect(getArchiveLeagueCatalog).toHaveBeenCalledTimes(1);
    expect(cache.writeLeagueCatalog).toHaveBeenCalledTimes(1);
    expect(result.items.map((item) => item.id)).toEqual(['b']);
  });

  it('normalizes the wire shape', async () => {
    const cache = cacheStub();
    const queue = queueStub();
    const client = {
      getArchiveLeagueCatalog: () => of(catalogOf([{ id: 'l1', name: 'L', createdAt: {}, updatedAt: { toString: () => '2026-05-05T00:00:00Z' }, documentVersion: 2 }])),
      getArchiveLeagueSeasonCatalog: () => of(catalogOf([{
        id: 's1', name: 'S', leagueId: 'l1', status: 'completed', updatedAt: '2026-05-05T00:00:00Z', documentVersion: 1,
        tournamentCount: 0, playerCount: 0, firstTournamentDate: undefined, lastTournamentDate: null
      }])),
      getArchiveYears: () => of({ years: [{ year: 2026, locked: false, tournamentCount: 1 }] }),
      getArchiveTournamentYearCatalog: () => of(catalogOf([
        { id: 't1', name: 'T', tournamentDate: '2026-04-04', status: 'active', updatedAt: '2026-05-05T00:00:00Z', documentVersion: 1, playerCount: 3 }
      ]))
    };
    const { repo } = build({ cache, queue, client });

    const [leagues, seasons] = [await repo.listLeagues(), await repo.listLeagueSeasons()];
    await repo.listTournaments();
    const loader = queue.drain.mock.calls[0][0];
    const loaded = await loader(2026);

    expect(leagues.items[0].updatedAt).toBe('2026-05-05T00:00:00Z');
    expect(leagues.items[0].createdAt).toBe(String({}));
    expect(seasons.items[0].status).toBe('completed');
    expect(seasons.items[0].firstTournamentDate).toBeNull();
    expect(seasons.items[0].lastTournamentDate).toBeNull();
    expect(loaded.items[0].seasonId).toBeNull();
    expect(loaded.items[0].status).toBe('active');
  });

  it('merges browser-local Leagues and flags them', async () => {
    const local = localStub({ leagues: [serverLeague('local-1')] });
    const client = { getArchiveLeagueCatalog: () => of(catalogOf([serverLeague('a')], 4)) };
    const { repo } = build({ client, local });

    const result = await repo.listLeagues();

    expect(result.items).toHaveLength(2);
    expect(result.items.find((item) => item.id === 'a')!.isLocal).toBe(false);
    expect(result.items.find((item) => item.id === 'local-1')!.isLocal).toBe(true);
    expect(result.totalCount).toBe(5);
  });

  it('never writes a browser-local row into the cache', async () => {
    const cache = cacheStub();
    const local = localStub({ leagues: [serverLeague('local-1')] });
    const client = { getArchiveLeagueCatalog: () => of(catalogOf([serverLeague('a')], 4)) };
    const { repo } = build({ cache, client, local });

    await repo.listLeagues();

    const written = cache.writeLeagueCatalog.mock.calls[0][0];
    expect(written.items.map((item) => item.id)).toEqual(['a']);
    expect(written.items.every((item) => !('isLocal' in item))).toBe(true);
  });

  it('derives local Season counters from the local Tournaments', async () => {
    const season: PersistedLeagueSeason = {
      ...createLeagueSeason({ id: 'local-s1', name: 'Local Season', leagueId: 'local-l1', status: 'active' }),
      documentVersion: 1,
      updatedAt: '2026-08-01T00:00:00.000Z'
    };
    // The second Tournament holds a `kind: 'match'` entry that fails validation (a 5-0 result), the
    // exact input on which a naive name-union would count Ghost and Phantom and the shared
    // summarizer does not. Both surfaces must report the same number.
    const tournaments = [
      localTournamentDocument('local-t1', season.id, '2026-03-01', [match('aaaaaaaa-1111-4111-8111-111111111111', 'Alice', 'Bob')]),
      localTournamentDocument('local-t2', season.id, '2026-05-04', [
        match('bbbbbbbb-1111-4111-8111-111111111111', 'Alice', 'Carol'),
        match('cccccccc-1111-4111-8111-111111111111', 'Ghost', 'Phantom', 5, 0)
      ])
    ];
    const expected = summarizeLeagueSeason(season, tournaments);
    const local = {
      listArchiveLeagueSummaries: async () => catalogOf([]),
      listLeagueSeasonSummaries: async () => catalogOf([expected]),
      listArchiveTournamentSummaries: async () => catalogOf(tournaments.map(summarizeArchiveTournament))
    };
    const { repo } = build({ client: { getArchiveLeagueSeasonCatalog: () => of(catalogOf([])) }, local });

    const row = (await repo.listLeagueSeasons()).items[0];

    expect(row.tournamentCount).toBe(2);
    expect(row.firstTournamentDate).toBe('2026-03-01');
    expect(row.lastTournamentDate).toBe('2026-05-04');
    expect(row.isLocal).toBe(true);
    // The shared definition, not a second one: 3 valid players, not the 5 distinct names on the wire.
    expect(row.playerCount).toBe(expected.playerCount);
    expect(row.playerCount).toBe(3);
  });

  it('a rejected catalog read with a cached record serves it as stale', async () => {
    const cache = cacheStub();
    cache.readLeagueCatalog = vi.fn(async () => leagueRecord([serverLeague('a')], new Date(NOW - 25 * 3_600_000).toISOString()));
    const client = { getArchiveLeagueCatalog: () => throwError(() => new Error('offline')) };
    const { repo } = build({ cache, client });

    const result = await repo.listLeagues();

    expect(result.items.map((item) => item.id)).toEqual(['a']);
    expect(result.stale).toBe(true);
    expect(result.fromCache).toBe(false);
  });

  it('a rejected catalog read with no record but local rows serves the local half as stale', async () => {
    const local = localStub({ leagues: [serverLeague('local-1')] });
    const client = { getArchiveLeagueCatalog: () => throwError(() => new Error('offline')) };
    const { repo } = build({ client, local });

    const result = await repo.listLeagues();

    expect(result.items.map((item) => item.id)).toEqual(['local-1']);
    expect(result.stale).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.totalCount).toBe(1);
  });

  it('a rejected catalog read with no record and no local rows rethrows', async () => {
    const failure = new Error('offline');
    const client = { getArchiveLeagueCatalog: () => throwError(() => failure) };
    const { repo } = build({ client });

    await expect(repo.listLeagues()).rejects.toBe(failure);
  });

  it('the Season catalog obeys the same four rules', async () => {
    const fresh = cacheStub();
    fresh.readSeasonCatalog = vi.fn(async () => ({ key: ARCHIVE_CATALOG_KEY, items: [serverSeason('s1')], totalCount: 1, truncated: false, fetchedAt: new Date(NOW - 3_600_000).toISOString() }) as ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>);
    const getArchiveLeagueSeasonCatalog = vi.fn(() => of(catalogOf([serverSeason('s2')])));
    const served = await build({ cache: fresh, client: { getArchiveLeagueSeasonCatalog } }).repo.listLeagueSeasons();
    expect(getArchiveLeagueSeasonCatalog).not.toHaveBeenCalled();
    expect(served.fromCache).toBe(true);

    const stale = cacheStub();
    stale.readSeasonCatalog = vi.fn(async () => ({ key: ARCHIVE_CATALOG_KEY, items: [serverSeason('s1')], totalCount: 1, truncated: false, fetchedAt: new Date(NOW - CATALOG_TTL_MS).toISOString() }) as ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>);
    const refetched = await build({ cache: stale, client: { getArchiveLeagueSeasonCatalog: () => of(catalogOf([serverSeason('s2')])) } }).repo.listLeagueSeasons();
    expect(stale.writeSeasonCatalog).toHaveBeenCalledTimes(1);
    expect(refetched.items.map((item) => item.id)).toEqual(['s2']);

    const forced = cacheStub();
    forced.readSeasonCatalog = vi.fn(async () => ({ key: ARCHIVE_CATALOG_KEY, items: [serverSeason('s1')], totalCount: 1, truncated: false, fetchedAt: new Date(NOW).toISOString() }) as ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>);
    await build({ cache: forced, client: { getArchiveLeagueSeasonCatalog: () => of(catalogOf([serverSeason('s2')])) } }).repo.listLeagueSeasons({ force: true });
    expect(forced.writeSeasonCatalog).toHaveBeenCalledTimes(1);

    const rejected = cacheStub();
    rejected.readSeasonCatalog = vi.fn(async () => ({ key: ARCHIVE_CATALOG_KEY, items: [serverSeason('s1')], totalCount: 1, truncated: false, fetchedAt: new Date(NOW - CATALOG_TTL_MS).toISOString() }) as ArchiveCatalogRecord<ArchiveLeagueSeasonSummary>);
    const degraded = await build({ cache: rejected, client: { getArchiveLeagueSeasonCatalog: () => throwError(() => new Error('offline')) } }).repo.listLeagueSeasons();
    expect(degraded.stale).toBe(true);
    expect(degraded.items.map((item) => item.id)).toEqual(['s1']);
  });
});

describe('archive repository — years index', () => {
  it('caches the years index for the current UTC day only', async () => {
    const cache = cacheStub();
    const getArchiveYears = vi.fn(() => of({ years: [{ year: 2026, locked: false, tournamentCount: 3 }] }));
    const { repo } = build({ cache, client: { getArchiveYears } });

    await repo.listYears();
    cache.readYearsMeta = vi.fn(async () => cache.writeYearsMeta.mock.calls[0][0]);
    await repo.listYears();

    expect(getArchiveYears).toHaveBeenCalledTimes(1);
    expect(cache.writeYearsMeta).toHaveBeenCalledTimes(1);
    expect(cache.writeYearsMeta.mock.calls[0][0].utcDay).toBe(utcDayKey(NOW));
  });

  it('refetches the years index after the UTC day rolls over', async () => {
    const cache = cacheStub();
    cache.readYearsMeta = vi.fn(async () => ({
      key: ARCHIVE_YEARS_META_KEY, years: [{ year: 2025, locked: true, tournamentCount: 1 }],
      fetchedAt: new Date(NOW - 86_400_000).toISOString(), utcDay: utcDayKey(NOW - 86_400_000)
    }));
    const getArchiveYears = vi.fn(() => of({ years: [{ year: 2026, locked: false, tournamentCount: 3 }] }));
    const { repo } = build({ cache, client: { getArchiveYears } });

    const years = await repo.listYears();

    expect(getArchiveYears).toHaveBeenCalledTimes(1);
    expect(years.map((year) => year.year)).toEqual([2026]);
  });

  it('falls back to the snapshot with locked forced false when the years index rejects', async () => {
    const cache = cacheStub();
    const queue = queueStub();
    cache.readYearsMeta = vi.fn(async () => ({
      key: ARCHIVE_YEARS_META_KEY, years: [{ year: 2024, locked: true, tournamentCount: 1 }],
      fetchedAt: new Date(NOW - 86_400_000).toISOString(), utcDay: utcDayKey(NOW - 86_400_000)
    }));
    const { repo } = build({ cache, queue, client: { getArchiveYears: () => throwError(() => new Error('offline')) } });

    const years = await repo.listYears();

    expect(years).toEqual([{ year: 2024, locked: false, tournamentCount: 1 }]);
    expect(queue.drain).not.toHaveBeenCalled();
  });
});

describe('archive repository — year-partitioned Tournaments', () => {
  it('listTournaments enqueues every missing or stale year and drains once', async () => {
    const cache = cacheStub();
    const queue = queueStub();
    cache.readYearsMeta = vi.fn(async () => freshYearsMeta([
      { year: 2024, locked: true, tournamentCount: 1 },
      { year: 2025, locked: false, tournamentCount: 1 },
      { year: 2026, locked: false, tournamentCount: 1 }
    ]));
    cache.readAllYearPartitions = vi.fn(async () => [
      yearPartition(2024, [serverTournament('id-2024', '2024-06-06')]),
      yearPartition(2025, [serverTournament('id-2025', '2025-06-06')], new Date(NOW - 30 * 3_600_000).toISOString())
    ]);
    const { repo } = build({ cache, queue });

    await repo.listTournaments();

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue.mock.calls[0][0]).toEqual([2025, 2026]);
    expect(queue.drain).toHaveBeenCalledTimes(1);
  });

  it('listTournaments orders rows by date desc then id ordinal asc', async () => {
    const cache = cacheStub();
    cache.readYearsMeta = vi.fn(async () => freshYearsMeta([{ year: 2025, locked: true, tournamentCount: 1 }, { year: 2026, locked: true, tournamentCount: 2 }]));
    cache.readAllYearPartitions = vi.fn(async () => [
      yearPartition(2026, [serverTournament('id-b', '2026-01-02'), serverTournament('id-a', '2026-01-02')]),
      yearPartition(2025, [serverTournament('id-c', '2025-12-31')])
    ]);
    const { repo } = build({ cache });

    const result = await repo.listTournaments();

    expect(result.items.map((item) => item.id)).toEqual(['id-a', 'id-b', 'id-c']);
  });

  it('listTournaments reports the oldest partition instant as fetchedAt', async () => {
    const cache = cacheStub();
    cache.readYearsMeta = vi.fn(async () => freshYearsMeta([{ year: 2025, locked: true, tournamentCount: 1 }, { year: 2026, locked: true, tournamentCount: 1 }]));
    cache.readAllYearPartitions = vi.fn(async () => [
      yearPartition(2026, [serverTournament('id-a', '2026-01-02')], '2026-08-22T12:00:00.000Z'),
      yearPartition(2025, [serverTournament('id-c', '2025-12-31')], '2026-08-22T10:00:00.000Z')
    ]);
    const { repo } = build({ cache });

    const result = await repo.listTournaments();

    expect(result.fetchedAt).toBe('2026-08-22T10:00:00.000Z');
  });

  it('listTournaments marks the result stale when a year failed', async () => {
    const cache = cacheStub();
    const queue = queueStub();
    queue.drain = vi.fn(async () => ({ written: [], failed: [{ year: 2026, error: new Error('offline') }] }));
    cache.readYearsMeta = vi.fn(async () => freshYearsMeta([{ year: 2026, locked: false, tournamentCount: 1 }]));
    const { repo } = build({ cache, queue });

    const result = await repo.listTournaments();

    expect(result.stale).toBe(true);
  });

  it('listTournaments appends browser-local Tournaments', async () => {
    const cache = cacheStub();
    cache.readYearsMeta = vi.fn(async () => freshYearsMeta([{ year: 2026, locked: true, tournamentCount: 1 }]));
    cache.readAllYearPartitions = vi.fn(async () => [yearPartition(2026, [serverTournament('id-a', '2026-01-02')], '2026-08-22T10:00:00.000Z', 7)]);
    const local = localStub({ tournaments: [serverTournament('local-t1', '2026-02-02')] });
    const { repo } = build({ cache, local });

    const result = await repo.listTournaments();

    expect(result.items.find((item) => item.id === 'local-t1')!.isLocal).toBe(true);
    expect(result.items.find((item) => item.id === 'id-a')!.isLocal).toBe(false);
    expect(result.totalCount).toBe(8);
    expect(result.truncated).toBe(true);
  });
});

describe('archive repository — Season expansion read-through', () => {
  const season = { id: 's1', firstTournamentDate: '2024-02-01', lastTournamentDate: '2024-11-30' };

  it('expanding a Season whose years are all cached, complete and locked serves from IndexedDB', async () => {
    const cache = cacheStub();
    cache.readYearsMeta = vi.fn(async () => freshYearsMeta([{ year: 2024, locked: true, tournamentCount: 3 }]));
    cache.readYearPartition = vi.fn(async () => yearPartition(2024, [
      serverTournament('id-b', '2024-03-03', 's1'),
      serverTournament('id-a', '2024-03-03', 's1'),
      serverTournament('id-x', '2024-04-04', 'other')
    ]));
    const archiveSeasonTournaments = vi.fn(() => of(catalogOf([])));
    const { repo } = build({ cache, client: { archiveSeasonTournaments } });

    const result = await repo.listSeasonTournaments(season);

    expect(archiveSeasonTournaments).not.toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
    expect(result.items.map((item) => item.id)).toEqual(['id-a', 'id-b']);
  });

  it('expanding an uncached Season fetches read-through and writes nothing', async () => {
    const cache = cacheStub();
    const queue = queueStub();
    cache.readYearsMeta = vi.fn(async () => freshYearsMeta([{ year: 2026, locked: false, tournamentCount: 1 }]));
    const archiveSeasonTournaments = vi.fn(() => of(catalogOf([serverTournament('id-a', '2026-02-02', 's9')])));
    const { repo } = build({ cache, queue, client: { archiveSeasonTournaments } });

    const result = await repo.listSeasonTournaments({ id: 's9', firstTournamentDate: '2026-01-05', lastTournamentDate: '2026-06-06' });

    expect(archiveSeasonTournaments).toHaveBeenCalledTimes(1);
    expect(archiveSeasonTournaments).toHaveBeenCalledWith('s9');
    expect(result.fromCache).toBe(false);
    expect(cache.writeLeagueCatalog).not.toHaveBeenCalled();
    expect(cache.writeSeasonCatalog).not.toHaveBeenCalled();
    expect(cache.writeYearsMeta).not.toHaveBeenCalled();
    expect(cache.clearAll).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(queue.drain).not.toHaveBeenCalled();
  });

  it('expanding a Season whose year is unlocked fetches read-through', async () => {
    const cache = cacheStub();
    cache.readYearsMeta = vi.fn(async () => freshYearsMeta([{ year: 2026, locked: false, tournamentCount: 1 }]));
    cache.readYearPartition = vi.fn(async () => yearPartition(2026, [serverTournament('id-a', '2026-02-02', 's9')]));
    const archiveSeasonTournaments = vi.fn(() => of(catalogOf([serverTournament('id-a', '2026-02-02', 's9')])));
    const { repo } = build({ cache, client: { archiveSeasonTournaments } });

    await repo.listSeasonTournaments({ id: 's9', firstTournamentDate: '2026-01-05', lastTournamentDate: '2026-06-06' });

    expect(archiveSeasonTournaments).toHaveBeenCalledTimes(1);
    expect(cache.writeYearsMeta).not.toHaveBeenCalled();
  });

  it('expanding a Season spanning a cached and an uncached year fetches read-through', async () => {
    const cache = cacheStub();
    cache.readYearsMeta = vi.fn(async () => freshYearsMeta([{ year: 2024, locked: true, tournamentCount: 1 }, { year: 2025, locked: true, tournamentCount: 1 }]));
    cache.readYearPartition = vi.fn(async (year: number) => (year === 2024 ? yearPartition(2024, [serverTournament('id-a', '2024-02-02', 's9')]) : null));
    const archiveSeasonTournaments = vi.fn(() => of(catalogOf([])));
    const { repo } = build({ cache, client: { archiveSeasonTournaments } });

    await repo.listSeasonTournaments({ id: 's9', firstTournamentDate: '2024-02-01', lastTournamentDate: '2025-11-30' });

    expect(archiveSeasonTournaments).toHaveBeenCalledTimes(1);
  });

  it('expanding a Season with no tournament dates returns an empty list with no request', async () => {
    const archiveSeasonTournaments = vi.fn(() => of(catalogOf([])));
    const { repo } = build({ client: { archiveSeasonTournaments } });

    const result = await repo.listSeasonTournaments({ id: 's9', firstTournamentDate: null, lastTournamentDate: '2026-06-06' });

    expect(result.items).toEqual([]);
    expect(result.fromCache).toBe(true);
    expect(archiveSeasonTournaments).not.toHaveBeenCalled();
  });

  it('expanding a browser-local Season reads the local store, never the network', async () => {
    const local = localStub({
      tournaments: [
        serverTournament('local-t2', '2026-05-05', 'local-abc'),
        serverTournament('local-t1', '2026-06-06', 'local-abc'),
        serverTournament('local-t3', '2026-07-07', 'local-other')
      ]
    });
    const archiveSeasonTournaments = vi.fn(() => of(catalogOf([])));
    const { repo } = build({ client: { archiveSeasonTournaments }, local });

    const result = await repo.listSeasonTournaments({ id: 'local-abc', firstTournamentDate: '2026-05-05', lastTournamentDate: '2026-06-06' });

    expect(archiveSeasonTournaments).not.toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
    expect(result.items.map((item) => item.id)).toEqual(['local-t1', 'local-t2']);
    expect(result.items.every((item) => item.isLocal)).toBe(true);
  });

  it('a 404 from the read-through propagates unchanged', async () => {
    const cache = cacheStub();
    const failure = { status: 404 };
    cache.readYearsMeta = vi.fn(async () => freshYearsMeta([{ year: 2026, locked: false, tournamentCount: 1 }]));
    const { repo } = build({ cache, client: { archiveSeasonTournaments: () => throwError(() => failure) } });

    await expect(repo.listSeasonTournaments({ id: 's9', firstTournamentDate: '2026-01-05', lastTournamentDate: '2026-06-06' })).rejects.toBe(failure);
  });
});

describe('archive repository — invalidation and pure helpers', () => {
  it('invalidateArchiveCaches clears every store then dispatches gones-archive-updated', async () => {
    const cache = cacheStub();
    let cleared = false;
    cache.clearAll = vi.fn(async () => { await Promise.resolve(); cleared = true; });
    const { repo } = build({ cache });
    let fired = 0;
    let firedAfterClear = false;
    const listener = (event: Event) => { fired += 1; firedAfterClear = cleared; expect(event.type).toBe(ARCHIVE_UPDATED_EVENT); };
    window.addEventListener(ARCHIVE_UPDATED_EVENT, listener);

    try {
      await repo.invalidateArchiveCaches();
    } finally {
      window.removeEventListener(ARCHIVE_UPDATED_EVENT, listener);
    }

    expect(cache.clearAll).toHaveBeenCalledTimes(1);
    expect(fired).toBe(1);
    expect(firedAfterClear).toBe(true);
  });

  it('archiveYearRange spans both bounds inclusively', () => {
    expect(archiveYearRange('2024-12-31', '2026-01-01')).toEqual([2024, 2025, 2026]);
    expect(archiveYearRange(null, '2026-01-01')).toEqual([]);
    expect(archiveYearRange('2026-01-01', '2024-01-01')).toEqual([]);
    expect(compareArchiveTournamentRows(serverTournament('a', '2026-01-01'), serverTournament('b', '2025-01-01'))).toBeLessThan(0);
  });

  it('names no IndexedDB symbol', () => {
    expect(repositorySource).not.toMatch(/\bindexedDB\b/);
    expect(repositorySource).not.toMatch(/\bIDB[A-Z]\w*/);
    expect(repositorySource).not.toMatch(/localStorage|sessionStorage/);
  });
});
