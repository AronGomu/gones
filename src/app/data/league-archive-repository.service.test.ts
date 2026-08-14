import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { AuthSessionCoordinationService } from '../auth/auth-session-coordination.service';
import { AuthService } from '../auth/auth.service';
import { installFakeWebLocks } from '../auth/fake-web-locks';
import { UserProfileResponse } from '../api/generated/gones-api';
import { SessionScopeService } from '../auth/session-scope.service';
import { LEAGUE_ARCHIVE_BACKEND, LeagueArchiveBackendPort } from '../backend/application-backend';
import { LocalLeagueArchiveBackend } from '../backend/local-league-archive-backend.service';
import { CachedRead, SERVER_READ_CACHE_STORE_PORT, ServerReadCacheService } from '../backend/server-read-cache.service';
import { GlobalRole } from './league-archive-command-ux';
import { LOCAL_PLACEHOLDER_LEAGUE_ID } from './league-archive-origin';
import { LeagueArchiveRepository } from './league-archive-repository.service';
import { createRoundEntry, PersistedLeague, PLACEHOLDER_LEAGUE_ID, PLACEHOLDER_LEAGUE_NAME } from '../domain/models';
import { PowerUserSettingsService } from '../shared/power-user-settings.service';

/**
 * ADR 0028 — the repository is where the two stores merge. Same rationale as
 * `public-calendar.component.test.ts`: no TestBed in this repo, so the service is built with a bare
 * `Injector` and two hand-written fakes standing in for the two adapters. Every claim here is about
 * *which* store was asked, which is the entire routing rule.
 */

const SERVER_ID = '7f3a1d2c-0b44-4f9e-9a1e-2c8f0d6b5a11';
const LOCAL_ID = 'local-1';

function league(id: string, name = `League ${id}`): PersistedLeague {
  return { id, name, status: 'active', tournaments: [], documentVersion: 4, updatedAt: '2026-08-09T10:00:00.000Z' };
}

/** Every port method as a spy, so "the other store was never asked" is assertable per call. */
function fakeBackend(list: PersistedLeague[], byId: Record<string, PersistedLeague> = {}) {
  const resolveOne = vi.fn(async (id: string) => byId[id] ?? list.find((item) => item.id === id) ?? null);
  return {
    listLeagueArchives: vi.fn(async () => list),
    getLeagueArchive: resolveOne,
    createLeagueArchive: vi.fn(async (name: string) => league('created', name)),
    renameLeagueArchive: vi.fn(async () => league('renamed')),
    changeLeagueArchiveStatus: vi.fn(async () => league('status')),
    deleteLeagueArchive: vi.fn(async () => undefined),
    createArchiveTournament: vi.fn(async (id: string) => ({ ...league(id), tournaments: [{ id: 'new-tournament' }] } as unknown as PersistedLeague)),
    editArchiveTournament: vi.fn(async () => league('tournament-edited')),
    deleteArchiveTournament: vi.fn(async () => league('tournament-deleted')),
    moveArchiveTournament: vi.fn(async () => ({ fromLeague: league('from'), toLeague: league('to') })),
    addArchiveRound: vi.fn(async () => league('round-added')),
    deleteArchiveRound: vi.fn(async () => league('round-deleted')),
    importArchiveRound: vi.fn(async () => league('round-imported')),
    replaceArchiveRound: vi.fn(async () => league('round-replaced')),
    addArchiveEntry: vi.fn(async () => league('entry-added')),
    editArchiveEntry: vi.fn(async () => league('entry-edited')),
    deleteArchiveEntry: vi.fn(async () => league('entry-deleted')),
    updateArchivePlayerArchetype: vi.fn(async () => league('archetype')),
    renameLeagueArchivePlayerName: vi.fn(async () => league('player-renamed')),
    restoreLeagueArchive: vi.fn(async () => league('restored')),
    restoreFullLeagueArchiveData: vi.fn(async () => [league('restored')])
  } satisfies LeagueArchiveBackendPort & Record<string, unknown>;
}

type Fake = ReturnType<typeof fakeBackend>;

/**
 * ADR 0031 — the offline read cache sits in front of the server half only, so it is part of this
 * harness: the real service with an in-memory store. `userId` is what arms it; without one the caller
 * is anonymous and every read passes straight through, which is what the rest of these tests assert
 * against.
 */
function setup(options: { server?: Fake; local?: Fake; role?: GlobalRole; userId?: string; cached?: Record<string, CachedRead<unknown>>; power?: boolean } = {}) {
  installFakeWebLocks();
  const server = options.server ?? fakeBackend([league('s1'), league('s2')], { [SERVER_ID]: league(SERVER_ID) });
  const local = options.local ?? fakeBackend([league(LOCAL_ID)]);
  const profile = options.role || options.userId ? ({ globalRole: options.role, id: options.userId } as unknown as UserProfileResponse) : null;
  const auth = { profile: signal<UserProfileResponse | null>(profile) } as unknown as AuthService;
  const coordination = new AuthSessionCoordinationService();
  if (options.userId) coordination.bindProfile(options.userId, coordination.generation());
  const rows = new Map<string, CachedRead<unknown>>(Object.entries(options.cached ?? {}));
  const cacheStore = {
    read: async (key: string) => rows.get(key) ?? null,
    write: async (key: string, entry: CachedRead<unknown>) => { rows.set(key, entry); },
    clear: async () => { rows.clear(); }
  };
  const powerEnabled = signal(options.power ?? true);
  const power = {
    enabled: powerEnabled,
    requireEnabled: () => { if (!powerEnabled()) throw new Error('powerUserRequired'); }
  } as unknown as PowerUserSettingsService;
  const injector = Injector.create({ providers: [
    { provide: LEAGUE_ARCHIVE_BACKEND, useValue: server },
    { provide: LocalLeagueArchiveBackend, useValue: local },
    { provide: AuthService, useValue: auth },
    { provide: AuthSessionCoordinationService, useValue: coordination },
    { provide: SERVER_READ_CACHE_STORE_PORT, useValue: cacheStore },
    { provide: PowerUserSettingsService, useValue: power },
    SessionScopeService,
    ServerReadCacheService
  ] });
  const repository = runInInjectionContext(injector, () => new LeagueArchiveRepository());
  return { repository, server, local, rows };
}

/** No call at all reached this fake. */
function untouched(fake: Fake): string[] {
  return Object.entries(fake).filter(([, spy]) => spy.mock.calls.length > 0).map(([name]) => name);
}

describe('LeagueArchiveRepository merged listing', () => {
  it('listing merges both stores', async () => {
    const { repository } = setup({ server: fakeBackend([league('S1'), league('S2')]), local: fakeBackend([league('L1')]) });

    const leagues = await repository.listLeagues();

    expect(leagues).toHaveLength(3);
    expect(leagues.map((item) => item.id)).toEqual(['S1', 'S2', 'L1']);
  });

  it('a failing server read degrades to local', async () => {
    const server = fakeBackend([]);
    server.listLeagueArchives.mockRejectedValueOnce({ status: 401 });
    const { repository } = setup({ server, local: fakeBackend([league('L1')]) });

    await expect(repository.listLeagues()).resolves.toEqual([league('L1')]);
  });

  it('a failing server read is not silent', async () => {
    const server = fakeBackend([]);
    server.listLeagueArchives.mockRejectedValueOnce({ status: 401 });
    const { repository } = setup({ server, local: fakeBackend([league('L1')]) });

    expect(repository.serverUnavailable()).toBe(false);
    await repository.listLeagues();
    expect(repository.serverUnavailable()).toBe(true);
  });

  it('a recovered server read clears the flag', async () => {
    const server = fakeBackend([league('S1')]);
    server.listLeagueArchives.mockRejectedValueOnce({ status: 401 });
    const { repository } = setup({ server });

    await repository.listLeagues();
    expect(repository.serverUnavailable()).toBe(true);
    await repository.listLeagues();
    expect(repository.serverUnavailable()).toBe(false);
  });

  it('serves the cached list when the server is unreachable, and says the server is unreachable', async () => {
    const server = fakeBackend([]);
    server.listLeagueArchives.mockRejectedValueOnce(new Error('offline'));
    const cached = { 'u1:leagues': { value: [league('S1')], cachedAt: '2026-08-09T10:00:00.000Z' } };
    const { repository } = setup({ server, local: fakeBackend([]), userId: 'u1', cached });

    await expect(repository.listLeagues()).resolves.toEqual([league('S1')]);
    expect(repository.serverUnavailable()).toBe(true);
  });

  it('a fulfilled server read replaces the cached list rather than merging with it', async () => {
    const cached = { 'u1:leagues': { value: [league('S9')], cachedAt: '2026-08-09T10:00:00.000Z' } };
    const { repository, rows } = setup({ server: fakeBackend([league('S1')]), local: fakeBackend([]), userId: 'u1', cached });

    await expect(repository.listLeagues()).resolves.toEqual([league('S1')]);

    expect(rows.get('u1:leagues')?.value).toEqual([league('S1')]);
    expect(repository.serverUnavailable()).toBe(false);
  });

  it('a browser-local league is never cached: it is already offline and owns itself', async () => {
    const { repository, rows } = setup({ userId: 'u1' });

    await repository.getLeague(LOCAL_ID);
    expect([...rows.keys()]).toEqual([]);

    await repository.getLeague(SERVER_ID);
    expect([...rows.keys()]).toEqual([`u1:league:${SERVER_ID}`]);
  });

  it('both stores failing propagates', async () => {
    const server = fakeBackend([]);
    const local = fakeBackend([]);
    server.listLeagueArchives.mockRejectedValueOnce(new Error('serverDown'));
    local.listLeagueArchives.mockRejectedValueOnce(new Error('localDown'));
    const { repository } = setup({ server, local });

    await expect(repository.listLeagues()).rejects.toThrowError('serverDown');
  });
});

describe('LeagueArchiveRepository read routing', () => {
  it('reading a local id hits the local store only', async () => {
    const { repository, server, local } = setup();

    await repository.getLeague(LOCAL_ID);

    expect(local.getLeagueArchive).toHaveBeenCalledWith(LOCAL_ID);
    expect(untouched(server)).toEqual([]);
  });

  it('reading a server id hits the server only', async () => {
    const { repository, server, local } = setup();

    await repository.getLeague(SERVER_ID);

    expect(server.getLeagueArchive).toHaveBeenCalledWith(SERVER_ID);
    expect(untouched(local)).toEqual([]);
  });

  it('signals cached server detail as stale, then clears after server recovery', async () => {
    const server = fakeBackend([], { [SERVER_ID]: league(SERVER_ID, 'Fresh') });
    server.getLeagueArchive.mockRejectedValueOnce(new Error('offline'));
    const cached = { [`u1:league:${SERVER_ID}`]: { value: league(SERVER_ID, 'Cached'), cachedAt: '2026-08-09T10:00:00.000Z' } };
    const { repository } = setup({ server, userId: 'u1', cached });

    await expect(repository.getLeague(SERVER_ID)).resolves.toMatchObject({ name: 'Cached' });
    expect(repository.detailStale()).toBe(true);
    await expect(repository.getLeague(SERVER_ID)).resolves.toMatchObject({ name: 'Fresh' });
    expect(repository.detailStale()).toBe(false);
  });

  it('clears cached-detail staleness after a successful fresh mutation', async () => {
    const server = fakeBackend([], { [SERVER_ID]: league(SERVER_ID, 'Fresh') });
    server.getLeagueArchive.mockRejectedValueOnce(new Error('offline'));
    const cached = { [`u1:league:${SERVER_ID}`]: { value: league(SERVER_ID, 'Cached'), cachedAt: '2026-08-09T10:00:00.000Z' } };
    const { repository } = setup({ server, userId: 'u1', cached });

    await repository.getLeague(SERVER_ID);
    expect(repository.detailStale()).toBe(true);
    await repository.renameLeague(league(SERVER_ID), 'Renamed');

    expect(repository.detailStale()).toBe(false);
  });

  it('never signals server-cache staleness for a browser-local detail', async () => {
    const { repository } = setup();
    repository.detailStale.set(true);

    await repository.getLeague(LOCAL_ID);

    expect(repository.detailStale()).toBe(false);
  });
});

describe('LeagueArchiveRepository create routing', () => {
  it('creating as an anonymous visitor writes local', async () => {
    const { repository, server, local } = setup();

    await repository.createLeague('Summer');

    expect(local.createLeagueArchive).toHaveBeenCalledWith('Summer', undefined);
    expect(untouched(server)).toEqual([]);
  });

  it('creating as a plain user writes local', async () => {
    const { repository, server, local } = setup({ role: 'User' });

    await repository.createLeague('Summer');

    expect(local.createLeagueArchive).toHaveBeenCalled();
    expect(untouched(server)).toEqual([]);
  });

  it('creating as an organizer writes the server and clears stale detail only after success', async () => {
    const { repository, server, local } = setup({ role: 'Organizer' });
    repository.detailStale.set(true);

    await repository.createLeague('Summer');

    expect(server.createLeagueArchive).toHaveBeenCalledWith('Summer', undefined);
    expect(untouched(local)).toEqual([]);
    expect(repository.detailStale()).toBe(false);
  });

  it('the unassigned name resolves the local placeholder for an anonymous visitor', async () => {
    const local = fakeBackend([], { [LOCAL_PLACEHOLDER_LEAGUE_ID]: league(LOCAL_PLACEHOLDER_LEAGUE_ID) });
    const { repository, server } = setup({ local });

    const resolved = await repository.createLeague(PLACEHOLDER_LEAGUE_NAME);

    expect(resolved.id).toBe(LOCAL_PLACEHOLDER_LEAGUE_ID);
    expect(local.createLeagueArchive).not.toHaveBeenCalled();
    expect(untouched(server)).toEqual([]);
  });

  it('the unassigned name resolves the server placeholder for an organizer', async () => {
    const server = fakeBackend([], { [PLACEHOLDER_LEAGUE_ID]: league(PLACEHOLDER_LEAGUE_ID) });
    const { repository, local } = setup({ server, role: 'Organizer' });

    const resolved = await repository.createLeague(PLACEHOLDER_LEAGUE_NAME);

    expect(resolved.id).toBe(PLACEHOLDER_LEAGUE_ID);
    expect(server.createLeagueArchive).not.toHaveBeenCalled();
    expect(untouched(local)).toEqual([]);
  });

  it('a missing placeholder is an error, not a silent create', async () => {
    const { repository } = setup();

    await expect(repository.createLeague(PLACEHOLDER_LEAGUE_NAME)).rejects.toThrowError('placeholderLeagueMissing');
  });
});

/**
 * The routing surface is 17 methods: `getLeague` and `moveTournament` have their own cases above and
 * below, and these 15 writes are the rest. Each runs twice — once against a `local-` id and once
 * against a server id — and each asserts the other store was never touched at all.
 */
const entry = createRoundEntry({ table: '1' });
const writes: [name: string, call: (repository: LeagueArchiveRepository, target: PersistedLeague) => Promise<unknown>, port: keyof Fake][] = [
  ['renameLeague', (repository, target) => repository.renameLeague(target, 'New name'), 'renameLeagueArchive'],
  ['changeLeagueStatus', (repository, target) => repository.changeLeagueStatus(target, 'completed'), 'changeLeagueArchiveStatus'],
  ['deleteLeague', (repository, target) => repository.deleteLeague(target.id), 'deleteLeagueArchive'],
  ['createResultTournament', (repository, target) => repository.createResultTournament(target, 'Cup', '2026-08-09'), 'createArchiveTournament'],
  ['editResultTournament', (repository, target) => repository.editResultTournament(target, 't1', 'Cup', '2026-08-09'), 'editArchiveTournament'],
  ['deleteResultTournament', (repository, target) => repository.deleteResultTournament(target, 't1'), 'deleteArchiveTournament'],
  ['addResultRound', (repository, target) => repository.addResultRound(target, 't1'), 'addArchiveRound'],
  ['deleteResultRound', (repository, target) => repository.deleteResultRound(target, 't1', 'r1'), 'deleteArchiveRound'],
  ['importResultRound', (repository, target) => repository.importResultRound(target, 't1', 'r1', 'text'), 'importArchiveRound'],
  ['replaceResultRound', (repository, target) => repository.replaceResultRound(target, 't1', 'r1', [entry]), 'replaceArchiveRound'],
  ['addResultEntry', (repository, target) => repository.addResultEntry(target, 't1', 'r1', entry), 'addArchiveEntry'],
  ['editResultEntry', (repository, target) => repository.editResultEntry(target, 't1', 'r1', 'e1', entry), 'editArchiveEntry'],
  ['deleteResultEntry', (repository, target) => repository.deleteResultEntry(target, 't1', 'r1', 'e1'), 'deleteArchiveEntry'],
  ['updateResultPlayerArchetype', (repository, target) => repository.updateResultPlayerArchetype(target, 't1', 'Alice', 'Burn'), 'updateArchivePlayerArchetype'],
  ['renameLeaguePlayerName', (repository, target) => repository.renameLeaguePlayerName(target, 'Alice', 'Alicia'), 'renameLeagueArchivePlayerName']
];

describe('LeagueArchiveRepository write routing', () => {
  it('covers every routed write', () => {
    expect(writes).toHaveLength(15);
  });

  for (const [name, call, port] of writes) {
    it(`${name} routes a local id to the local store only`, async () => {
      const { repository, server, local } = setup();
      repository.detailStale.set(true);

      await call(repository, league(LOCAL_ID));

      expect(local[port]).toHaveBeenCalled();
      expect(untouched(server)).toEqual([]);
      expect(repository.detailStale()).toBe(false);
    });

    it(`${name} routes a server id to the server only`, async () => {
      const { repository, server, local } = setup();
      repository.detailStale.set(true);

      await call(repository, league(SERVER_ID));

      expect(server[port]).toHaveBeenCalled();
      expect(untouched(local)).toEqual([]);
      expect(repository.detailStale()).toBe(false);
    });
  }

  it('a failed mutation keeps cached-detail warning stale', async () => {
    const server = fakeBackend([]);
    server.renameLeagueArchive.mockRejectedValueOnce(new Error('offline'));
    const { repository } = setup({ server });
    repository.detailStale.set(true);

    await expect(repository.renameLeague(league(SERVER_ID), 'New name')).rejects.toThrowError('offline');

    expect(repository.detailStale()).toBe(true);
  });

  it('successful restore mutations clear cached-detail warning', async () => {
    const { repository } = setup({ role: 'Organizer' });
    repository.detailStale.set(true);
    await repository.restoreLeague({} as never);
    expect(repository.detailStale()).toBe(false);

    repository.detailStale.set(true);
    await repository.restoreFullLeagueData({} as never);
    expect(repository.detailStale()).toBe(false);
  });

  it('passes the expected document version through', async () => {
    const { repository, server } = setup();

    await repository.renameLeague(league(SERVER_ID), 'New name');

    expect(server.renameLeagueArchive).toHaveBeenCalledWith(SERVER_ID, 4, 'New name');
  });
});

describe('LeagueArchiveRepository Power User gate', () => {
  it('rejects all 19 port mutations before either adapter is called', async () => {
    const { repository, server, local } = setup({ power: false, role: 'Organizer' });
    const target = league(SERVER_ID);
    const calls: Array<() => Promise<unknown>> = [
      () => repository.createLeague('Summer'),
      ...writes.map(([, call]) => () => call(repository, target)),
      () => repository.restoreLeague({} as never),
      () => repository.restoreFullLeagueData({} as never),
      () => repository.moveTournament('t1', SERVER_ID, 'server-2')
    ];

    expect(calls).toHaveLength(19);
    for (const call of calls) await expect(call()).rejects.toThrowError('powerUserRequired');
    expect(untouched(server)).toEqual([]);
    expect(untouched(local)).toEqual([]);
  });

  it('leaves reads available while disabled', async () => {
    const { repository, server, local } = setup({ power: false });

    await repository.listLeagues();
    await repository.getLeague(LOCAL_ID);
    await repository.getLeague(SERVER_ID);

    expect(server.listLeagueArchives).toHaveBeenCalled();
    expect(server.getLeagueArchive).toHaveBeenCalledWith(SERVER_ID);
    expect(local.listLeagueArchives).toHaveBeenCalled();
    expect(local.getLeagueArchive).toHaveBeenCalledWith(LOCAL_ID);
  });
});

describe('LeagueArchiveRepository tournament moves', () => {
  it('a cross-store move is refused, local to server', async () => {
    const { repository, server, local } = setup();

    await expect(repository.moveTournament('t1', LOCAL_ID, SERVER_ID)).rejects.toThrowError('crossAuthorityMoveNotSupported');
    expect(untouched(server)).toEqual([]);
    expect(untouched(local)).toEqual([]);
  });

  it('a cross-store move is refused, server to local', async () => {
    const { repository, server, local } = setup();

    await expect(repository.moveTournament('t1', SERVER_ID, LOCAL_ID)).rejects.toThrowError('crossAuthorityMoveNotSupported');
    expect(untouched(server)).toEqual([]);
    expect(untouched(local)).toEqual([]);
  });

  it('a same-store move is delegated and clears cached-detail warning', async () => {
    const local = fakeBackend([league(LOCAL_ID), league('local-2')]);
    const { repository, server } = setup({ local });
    repository.detailStale.set(true);

    await repository.moveTournament('t1', LOCAL_ID, 'local-2');

    expect(local.moveArchiveTournament).toHaveBeenCalledWith(LOCAL_ID, 't1', 4, 'local-2', 4);
    expect(untouched(server)).toEqual([]);
    expect(repository.detailStale()).toBe(false);
  });
});
