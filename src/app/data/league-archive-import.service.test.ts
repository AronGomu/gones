import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { UserProfileResponse } from '../api/generated/gones-api';
import { LEAGUE_ARCHIVE_BACKEND, LeagueArchiveBackendPort } from '../backend/application-backend';
import { LocalLeagueArchiveBackend } from '../backend/local-league-archive-backend.service';
import { CachedRead, SERVER_READ_CACHE_STORE_PORT, ServerReadCacheService } from '../backend/server-read-cache.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { exportFullData, exportLeague } from '../domain/export-restore';
import { attachExportChecksum } from '../domain/export-schemas';
import { LeagueDocument, PersistedLeague } from '../domain/models';
import { GlobalRole } from './league-archive-command-ux';
import { isLocalLeagueId, LOCAL_LEAGUE_ID_PREFIX } from './league-archive-origin';
import { LeagueArchiveImportService } from './league-archive-import.service';
import { LeagueArchiveRepository } from './league-archive-repository.service';
import { PowerUserSettingsService } from '../shared/power-user-settings.service';

/**
 * ADR 0028 — an imported bundle carries no authority of its own: it lands in whichever store the
 * caller may write, and never in the other one. Same two-fake-backend harness as
 * `league-archive-repository.service.test.ts`, with the real repository in the middle so the routing
 * under test is the shipped one.
 */

const SERVER_ID = '7f3a1d2c-0b44-4f9e-9a1e-2c8f0d6b5a11';
const OTHER_SERVER_ID = '2b6c4e8a-9d21-4c3f-8e77-1a5b3c9d0e42';

function league(id: string, name = `League ${id}`): PersistedLeague {
  return { id, name, status: 'active', tournaments: [], documentVersion: 1, updatedAt: '2026-08-09T10:00:00.000Z' };
}

/** Every port method as a spy, so "the other store was never asked" is assertable per call. */
function fakeBackend(namespace: 'server' | 'local') {
  // Each store rewrites an incoming id into its own namespace, exactly as the two shipped adapters
  // do; the local rewrite itself is proved in `local-league-archive-backend.service.test.ts`.
  const persist = (incoming: LeagueDocument): PersistedLeague =>
    league(namespace === 'local' ? `${LOCAL_LEAGUE_ID_PREFIX}${incoming.id}-restored` : `${incoming.id}-restored`, incoming.name);
  const rows = new Map<string, PersistedLeague>();
  return {
    listLeagueArchives: vi.fn(async () => [...rows.values()]),
    getLeagueArchive: vi.fn(async (id: string) => rows.get(id) ?? null),
    createLeagueArchive: vi.fn(async (name: string) => league('created', name)),
    renameLeagueArchive: vi.fn(async () => league('renamed')),
    changeLeagueArchiveStatus: vi.fn(async () => league('status')),
    deleteLeagueArchive: vi.fn(async (id: string) => { rows.delete(id); }),
    createArchiveTournament: vi.fn(async () => league('tournament-created')),
    editArchiveTournament: vi.fn(async () => league('tournament-edited')),
    deleteArchiveTournament: vi.fn(async () => league('tournament-deleted')),
    moveArchiveTournament: vi.fn(async () => ({ fromLeague: league('from'), toLeague: league('to') })),
    applyArchiveTournamentEditBatch: vi.fn(async () => ({ sourceLeague: league('source'), destinationLeague: null })),
    addArchiveRound: vi.fn(async () => league('round-added')),
    deleteArchiveRound: vi.fn(async () => league('round-deleted')),
    importArchiveRound: vi.fn(async () => league('round-imported')),
    replaceArchiveRound: vi.fn(async () => league('round-replaced')),
    addArchiveEntry: vi.fn(async () => league('entry-added')),
    editArchiveEntry: vi.fn(async () => league('entry-edited')),
    deleteArchiveEntry: vi.fn(async () => league('entry-deleted')),
    updateArchivePlayerArchetype: vi.fn(async () => league('archetype')),
    renameLeagueArchivePlayerName: vi.fn(async () => league('player-renamed')),
    restoreLeagueArchive: vi.fn(async (command: { league: LeagueDocument }) => {
      const restored = persist(command.league);
      rows.set(restored.id, restored);
      return restored;
    }),
    restoreFullLeagueArchiveData: vi.fn(async (command: { leagues: LeagueDocument[] }) => command.leagues.map((incoming) => {
      const restored = persist(incoming);
      rows.set(restored.id, restored);
      return restored;
    }))
  } satisfies LeagueArchiveBackendPort & Record<string, unknown>;
}

type Fake = ReturnType<typeof fakeBackend>;

function setup(role?: GlobalRole) {
  const server = fakeBackend('server');
  const local = fakeBackend('local');
  const profile = role ? ({ globalRole: role } as UserProfileResponse) : null;
  const auth = { profile: signal<UserProfileResponse | null>(profile) } as unknown as AuthService;
  // The repository reads the server through the offline read cache (ADR 0031); an import never does.
  const rows = new Map<string, CachedRead<unknown>>();
  const cacheStore = {
    read: async (key: string) => rows.get(key) ?? null,
    write: async (key: string, entry: CachedRead<unknown>) => { rows.set(key, entry); },
    delete: async (key: string) => { rows.delete(key); },
    clear: async () => { rows.clear(); },
    keys: async () => [...rows.keys()]
  };
  const injector = Injector.create({ providers: [
    { provide: LEAGUE_ARCHIVE_BACKEND, useValue: server },
    { provide: LocalLeagueArchiveBackend, useValue: local },
    { provide: AuthService, useValue: auth },
    { provide: SERVER_READ_CACHE_STORE_PORT, useValue: cacheStore },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(true), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
    SessionScopeService,
    ServerReadCacheService
  ] });
  const repository = runInInjectionContext(injector, () => new LeagueArchiveRepository());
  return { service: new LeagueArchiveImportService(repository), repository, server, local };
}

/** No call at all reached this fake. */
function untouched(fake: Fake): string[] {
  return Object.entries(fake).filter(([, spy]) => spy.mock.calls.length > 0).map(([name]) => name);
}

/** `importFile` only reads `size` and `text()`; jsdom's `File` is not needed to exercise it. */
async function bundleFile(file: object): Promise<File> {
  const text = JSON.stringify(await attachExportChecksum(file));
  return { size: text.length, text: async () => text } as unknown as File;
}

const fullDataBundle = () => bundleFile(exportFullData([league(SERVER_ID, 'Summer'), league(OTHER_SERVER_ID, 'Winter')]));
const leagueBundle = () => bundleFile(exportLeague(league(SERVER_ID, 'Summer')));

describe('LeagueArchiveImportService destination routing', () => {
  it('importing as an anonymous visitor writes local', async () => {
    const { service, server, local } = setup();

    const result = await service.importFile(await fullDataBundle());

    expect(result.kind).toBe('fullData');
    expect(result.importedLeagueIds).toHaveLength(2);
    expect(result.importedLeagueIds.every((id) => isLocalLeagueId(id))).toBe(true);
    expect(local.restoreFullLeagueArchiveData).toHaveBeenCalled();
    expect(untouched(server)).toEqual([]);
  });

  it('importing as a plain user writes local', async () => {
    const { service, server, local } = setup('User');

    const result = await service.importFile(await fullDataBundle());

    expect(result.importedLeagueIds.every((id) => isLocalLeagueId(id))).toBe(true);
    expect(local.restoreFullLeagueArchiveData).toHaveBeenCalled();
    expect(untouched(server)).toEqual([]);
  });

  it('importing as an organizer writes the server', async () => {
    const { service, server, local } = setup('Organizer');

    const result = await service.importFile(await fullDataBundle());

    expect(result.importedLeagueIds.every((id) => isLocalLeagueId(id))).toBe(false);
    expect(server.restoreFullLeagueArchiveData).toHaveBeenCalled();
    expect(untouched(local)).toEqual([]);
  });

  it('a single-league import follows the same authority', async () => {
    const { service, server, local } = setup();

    const result = await service.importFile(await leagueBundle());

    expect(result.kind).toBe('league');
    expect(result.importedLeagueIds.every((id) => isLocalLeagueId(id))).toBe(true);
    expect(local.restoreLeagueArchive).toHaveBeenCalled();
    expect(untouched(server)).toEqual([]);
  });

  it('an admin single-league import writes the server', async () => {
    const { service, server, local } = setup('Admin');

    const result = await service.importFile(await leagueBundle());

    expect(result.importedLeagueIds.every((id) => isLocalLeagueId(id))).toBe(false);
    expect(server.restoreLeagueArchive).toHaveBeenCalled();
    expect(untouched(local)).toEqual([]);
  });

  it('a rejected import leaves both stores untouched', async () => {
    const { service, server, local } = setup();
    local.restoreFullLeagueArchiveData.mockRejectedValueOnce(new Error('quotaExceeded'));

    await expect(service.importFile(await fullDataBundle())).rejects.toThrowError('quotaExceeded');

    expect(local.deleteLeagueArchive).not.toHaveBeenCalled();
    expect(untouched(server)).toEqual([]);
  });
});
