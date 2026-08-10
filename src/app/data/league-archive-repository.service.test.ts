import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { UserProfileResponse } from '../api/generated/gones-api';
import { LEAGUE_ARCHIVE_BACKEND, LeagueArchiveBackendPort } from '../backend/application-backend';
import { LocalLeagueArchiveBackend } from '../backend/local-league-archive-backend.service';
import { GlobalRole } from './league-archive-command-ux';
import { LOCAL_PLACEHOLDER_LEAGUE_ID } from './league-archive-origin';
import { LeagueArchiveRepository } from './league-archive-repository.service';
import { createRoundEntry, PersistedLeague, PLACEHOLDER_LEAGUE_ID, PLACEHOLDER_LEAGUE_NAME } from '../domain/models';

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

function setup(options: { server?: Fake; local?: Fake; role?: GlobalRole } = {}) {
  const server = options.server ?? fakeBackend([league('s1'), league('s2')], { [SERVER_ID]: league(SERVER_ID) });
  const local = options.local ?? fakeBackend([league(LOCAL_ID)]);
  const profile = options.role ? ({ globalRole: options.role } as UserProfileResponse) : null;
  const auth = { profile: signal<UserProfileResponse | null>(profile) } as unknown as AuthService;
  const injector = Injector.create({ providers: [
    { provide: LEAGUE_ARCHIVE_BACKEND, useValue: server },
    { provide: LocalLeagueArchiveBackend, useValue: local },
    { provide: AuthService, useValue: auth }
  ] });
  const repository = runInInjectionContext(injector, () => new LeagueArchiveRepository());
  return { repository, server, local };
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

  it('creating as an organizer writes the server', async () => {
    const { repository, server, local } = setup({ role: 'Organizer' });

    await repository.createLeague('Summer');

    expect(server.createLeagueArchive).toHaveBeenCalledWith('Summer', undefined);
    expect(untouched(local)).toEqual([]);
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

      await call(repository, league(LOCAL_ID));

      expect(local[port]).toHaveBeenCalled();
      expect(untouched(server)).toEqual([]);
    });

    it(`${name} routes a server id to the server only`, async () => {
      const { repository, server, local } = setup();

      await call(repository, league(SERVER_ID));

      expect(server[port]).toHaveBeenCalled();
      expect(untouched(local)).toEqual([]);
    });
  }

  it('passes the expected document version through', async () => {
    const { repository, server } = setup();

    await repository.renameLeague(league(SERVER_ID), 'New name');

    expect(server.renameLeagueArchive).toHaveBeenCalledWith(SERVER_ID, 4, 'New name');
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

  it('a same-store move is delegated', async () => {
    const local = fakeBackend([league(LOCAL_ID), league('local-2')]);
    const { repository, server } = setup({ local });

    await repository.moveTournament('t1', LOCAL_ID, 'local-2');

    expect(local.moveArchiveTournament).toHaveBeenCalledWith(LOCAL_ID, 't1', 4, 'local-2', 4);
    expect(untouched(server)).toEqual([]);
  });
});
