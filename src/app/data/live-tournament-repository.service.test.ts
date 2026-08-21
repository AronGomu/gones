import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { UserProfileResponse } from '../api/generated/gones-api';
import { AuthSessionCoordinationService } from '../auth/auth-session-coordination.service';
import { AuthService } from '../auth/auth.service';
import { installFakeWebLocks } from '../auth/fake-web-locks';
import { SessionScopeService } from '../auth/session-scope.service';
import { LIVE_BACKEND, LIVE_BACKEND_MODE, LiveBackendMode, LiveBackendPort } from '../backend/application-backend';
import { CachedRead, SERVER_READ_CACHE_STORE_PORT, ServerReadCacheService } from '../backend/server-read-cache.service';
import { LiveTournamentDocument } from '../domain/live-tournament';
import { PowerUserSettingsService } from '../shared/power-user-settings.service';
import { LiveTournamentRepository } from './live-tournament-repository.service';

/**
 * ADR 0031 — the Live reads of an `Organizer` or `Admin` come from the server, so they are cached;
 * the browser-local store (ADR 0021) is already offline and must not be mirrored a second time.
 * Mode is the whole rule, and these tests are about which side of it a call lands on.
 */

const LIVE_ID = 'live-1';

function document(id = LIVE_ID): LiveTournamentDocument {
  return { id, name: 'Cup', documentVersion: 1 } as unknown as LiveTournamentDocument;
}

function setup(options: { mode?: LiveBackendMode; userId?: string; cached?: Record<string, CachedRead<unknown>>; powerEnabled?: boolean } = {}) {
  installFakeWebLocks();
  const backend = {
    listLiveTournaments: vi.fn(async () => [document()]),
    getLiveTournament: vi.fn(async () => document()),
    createLiveTournament: vi.fn(async () => document('created')),
    deleteLiveTournament: vi.fn(async () => undefined),
    updateLiveSettings: vi.fn(async () => document()),
    addLivePlayer: vi.fn(async () => document()),
    editLivePlayer: vi.fn(async () => document()),
    setLivePlayerPaid: vi.fn(async () => document()),
    dropLivePlayer: vi.fn(async () => document()),
    removeLivePlayer: vi.fn(async () => document()),
    startLiveRound: vi.fn(async () => document()),
    regenerateLiveRound: vi.fn(async () => document()),
    cancelLiveRound: vi.fn(async () => document()),
    validateLiveRound: vi.fn(async () => document()),
    scoreLiveRoundEntry: vi.fn(async () => document()),
    restoreLiveCheckpoint: vi.fn(async () => document()),
    finalizeLiveTournament: vi.fn(async () => ({ liveTournamentId: LIVE_ID, leagueId: 'league-1', finalizedTournamentId: 'final-1', liveDocumentVersion: 2 }))
  } as unknown as LiveBackendPort & Record<keyof LiveBackendPort, ReturnType<typeof vi.fn>>;
  const rows = new Map<string, CachedRead<unknown>>(Object.entries(options.cached ?? {}));
  const cacheStore = {
    read: async (key: string) => rows.get(key) ?? null,
    write: async (key: string, entry: CachedRead<unknown>) => { rows.set(key, entry); },
    delete: async (key: string) => { rows.delete(key); },
    clear: async () => { rows.clear(); },
    keys: async () => [...rows.keys()]
  };
  const profile = signal<UserProfileResponse | null>(options.userId ? ({ id: options.userId } as UserProfileResponse) : null);
  const coordination = new AuthSessionCoordinationService();
  if (options.userId) coordination.bindProfile(options.userId, coordination.generation());
  const powerEnabled = signal(options.powerEnabled ?? true);
  const power = {
    enabled: powerEnabled,
    setEnabled: (value: boolean) => powerEnabled.set(value),
    requireEnabled: () => { if (!powerEnabled()) throw new Error('powerUserRequired'); }
  };
  const injector = Injector.create({ providers: [
    { provide: LIVE_BACKEND, useValue: backend },
    { provide: LIVE_BACKEND_MODE, useValue: options.mode ?? 'aspnet-api' },
    { provide: PowerUserSettingsService, useValue: power },
    { provide: AuthService, useValue: { profile } as unknown as AuthService },
    { provide: AuthSessionCoordinationService, useValue: coordination },
    { provide: SERVER_READ_CACHE_STORE_PORT, useValue: cacheStore },
    SessionScopeService,
    ServerReadCacheService
  ] });
  const repository = runInInjectionContext(injector, () => new LiveTournamentRepository(backend));
  return { repository, backend, rows };
}

describe('LiveTournamentRepository Power User perimeter', () => {
  it('rejects every mutation before touching the backend while Power mode is off', async () => {
    const calls: Array<(repository: LiveTournamentRepository) => Promise<unknown>> = [
      (repository) => repository.create(),
      (repository) => repository.delete(LIVE_ID),
      (repository) => repository.updateLiveSettings(LIVE_ID, 1, {} as never),
      (repository) => repository.addLivePlayer(LIVE_ID, 1, {} as never),
      (repository) => repository.editLivePlayer(LIVE_ID, 'p1', 1, {} as never),
      (repository) => repository.setLivePlayerPaid(LIVE_ID, 'p1', 1, true),
      (repository) => repository.dropLivePlayer(LIVE_ID, 'p1', 1),
      (repository) => repository.removeLivePlayer(LIVE_ID, 'p1', 1),
      (repository) => repository.startLiveRound(LIVE_ID, 1),
      (repository) => repository.regenerateLiveRound(LIVE_ID, 1),
      (repository) => repository.cancelLiveRound(LIVE_ID, 1),
      (repository) => repository.validateLiveRound(LIVE_ID, 1),
      (repository) => repository.scoreLiveRoundEntry(LIVE_ID, 'r1', 'e1', 1, {} as never),
      (repository) => repository.restoreLiveCheckpoint(LIVE_ID, 'c1', 1),
      (repository) => repository.finalizeLiveTournament(LIVE_ID, 1)
    ];

    expect(calls).toHaveLength(15);
    for (const call of calls) {
      const { repository, backend } = setup({ powerEnabled: false });
      await expect(call(repository)).rejects.toThrowError('powerUserRequired');
      expect(Object.values(backend).every((mock) => mock.mock.calls.length === 0)).toBe(true);
    }
  });

  it('keeps list and detail reads available while Power mode is off', async () => {
    const { repository, backend } = setup({ mode: 'browser-local', powerEnabled: false });

    await expect(repository.list()).resolves.toEqual([document()]);
    await expect(repository.get(LIVE_ID)).resolves.toEqual(document());
    expect(backend.listLiveTournaments).toHaveBeenCalledOnce();
    expect(backend.getLiveTournament).toHaveBeenCalledWith(LIVE_ID);
  });
});

describe('LiveTournamentRepository offline read cache', () => {
  it('caches the server list and serves it back when the server is unreachable', async () => {
    const { repository, backend, rows } = setup({ userId: 'u1' });

    await expect(repository.list()).resolves.toEqual([document()]);
    expect([...rows.keys()]).toEqual(['u1:live-tournaments']);

    backend.listLiveTournaments.mockRejectedValueOnce(new Error('offline'));
    await expect(repository.list()).resolves.toEqual([document()]);
    expect(repository.listStale()).toBe(true);

    await expect(repository.list()).resolves.toEqual([document()]);
    expect(repository.listStale()).toBe(false);
  });

  it('caches a server document and serves it back when the server is unreachable', async () => {
    const { repository, backend, rows } = setup({ userId: 'u1' });

    await repository.get(LIVE_ID);
    expect([...rows.keys()]).toEqual([`u1:live-tournament:${LIVE_ID}`]);

    backend.getLiveTournament.mockRejectedValueOnce(new Error('offline'));
    await expect(repository.get(LIVE_ID)).resolves.toEqual(document());
    expect(repository.detailStale()).toBe(true);

    await expect(repository.get(LIVE_ID)).resolves.toEqual(document());
    expect(repository.detailStale()).toBe(false);
  });

  it('clears cached-detail staleness after a successful create', async () => {
    const { repository, backend } = setup({ userId: 'u1' });
    await repository.get(LIVE_ID);
    backend.getLiveTournament.mockRejectedValueOnce(new Error('offline'));
    await repository.get(LIVE_ID);
    expect(repository.detailStale()).toBe(true);

    await repository.create();

    expect(repository.detailStale()).toBe(false);
  });

  it('never caches the browser-local store: it is already offline', async () => {
    const { repository, rows } = setup({ mode: 'browser-local', userId: 'u1' });

    repository.listStale.set(true);
    repository.detailStale.set(true);
    await repository.list();
    await repository.get(LIVE_ID);

    expect([...rows.keys()]).toEqual([]);
    expect(repository.listStale()).toBe(false);
    expect(repository.detailStale()).toBe(false);
  });

  it('caches nothing for an anonymous reader', async () => {
    const { repository, rows } = setup();

    await repository.list();

    expect([...rows.keys()]).toEqual([]);
  });

  it('every successful mutation clears cached-detail warning', async () => {
    const calls: Array<(repository: LiveTournamentRepository) => Promise<unknown>> = [
      (repository) => repository.create(),
      (repository) => repository.delete(LIVE_ID),
      (repository) => repository.updateLiveSettings(LIVE_ID, 1, {} as never),
      (repository) => repository.addLivePlayer(LIVE_ID, 1, {} as never),
      (repository) => repository.editLivePlayer(LIVE_ID, 'p1', 1, {} as never),
      (repository) => repository.setLivePlayerPaid(LIVE_ID, 'p1', 1, true),
      (repository) => repository.dropLivePlayer(LIVE_ID, 'p1', 1),
      (repository) => repository.removeLivePlayer(LIVE_ID, 'p1', 1),
      (repository) => repository.startLiveRound(LIVE_ID, 1),
      (repository) => repository.regenerateLiveRound(LIVE_ID, 1),
      (repository) => repository.cancelLiveRound(LIVE_ID, 1),
      (repository) => repository.validateLiveRound(LIVE_ID, 1),
      (repository) => repository.scoreLiveRoundEntry(LIVE_ID, 'r1', 'e1', 1, {} as never),
      (repository) => repository.restoreLiveCheckpoint(LIVE_ID, 'c1', 1),
      (repository) => repository.finalizeLiveTournament(LIVE_ID, 1)
    ];

    expect(calls).toHaveLength(15);
    for (const call of calls) {
      const { repository } = setup({ userId: 'u1' });
      repository.detailStale.set(true);
      await call(repository);
      expect(repository.detailStale()).toBe(false);
    }
  });

  it('never caches a mutation, and a failed mutation keeps cached-detail warning stale', async () => {
    const { repository, backend, rows } = setup({ userId: 'u1' });
    backend.createLiveTournament.mockRejectedValueOnce(new Error('offline'));
    repository.detailStale.set(true);

    await expect(repository.create()).rejects.toThrowError('offline');

    expect([...rows.keys()]).toEqual([]);
    expect(repository.detailStale()).toBe(true);
  });
});
