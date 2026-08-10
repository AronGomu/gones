import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { UserProfileResponse } from '../api/generated/gones-api';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { LIVE_BACKEND, LIVE_BACKEND_MODE, LiveBackendMode, LiveBackendPort } from '../backend/application-backend';
import { CachedRead, SERVER_READ_CACHE_STORE_PORT, ServerReadCacheService } from '../backend/server-read-cache.service';
import { LiveTournamentDocument } from '../domain/live-tournament';
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

function setup(options: { mode?: LiveBackendMode; userId?: string; cached?: Record<string, CachedRead<unknown>> } = {}) {
  const backend = {
    listLiveTournaments: vi.fn(async () => [document()]),
    getLiveTournament: vi.fn(async () => document()),
    createLiveTournament: vi.fn(async () => document('created'))
  } as unknown as LiveBackendPort & { listLiveTournaments: ReturnType<typeof vi.fn>; getLiveTournament: ReturnType<typeof vi.fn>; createLiveTournament: ReturnType<typeof vi.fn> };
  const rows = new Map<string, CachedRead<unknown>>(Object.entries(options.cached ?? {}));
  const cacheStore = {
    read: async (key: string) => rows.get(key) ?? null,
    write: async (key: string, entry: CachedRead<unknown>) => { rows.set(key, entry); },
    clear: async () => { rows.clear(); }
  };
  const profile = signal<UserProfileResponse | null>(options.userId ? ({ id: options.userId } as UserProfileResponse) : null);
  const injector = Injector.create({ providers: [
    { provide: LIVE_BACKEND, useValue: backend },
    { provide: LIVE_BACKEND_MODE, useValue: options.mode ?? 'aspnet-api' },
    { provide: AuthService, useValue: { profile } as unknown as AuthService },
    { provide: SERVER_READ_CACHE_STORE_PORT, useValue: cacheStore },
    SessionScopeService,
    ServerReadCacheService
  ] });
  const repository = runInInjectionContext(injector, () => new LiveTournamentRepository(backend));
  return { repository, backend, rows };
}

describe('LiveTournamentRepository offline read cache', () => {
  it('caches the server list and serves it back when the server is unreachable', async () => {
    const { repository, backend, rows } = setup({ userId: 'u1' });

    await expect(repository.list()).resolves.toEqual([document()]);
    expect([...rows.keys()]).toEqual(['u1:live-tournaments']);

    backend.listLiveTournaments.mockRejectedValueOnce(new Error('offline'));
    await expect(repository.list()).resolves.toEqual([document()]);
  });

  it('caches a server document and serves it back when the server is unreachable', async () => {
    const { repository, backend, rows } = setup({ userId: 'u1' });

    await repository.get(LIVE_ID);
    expect([...rows.keys()]).toEqual([`u1:live-tournament:${LIVE_ID}`]);

    backend.getLiveTournament.mockRejectedValueOnce(new Error('offline'));
    await expect(repository.get(LIVE_ID)).resolves.toEqual(document());
  });

  it('never caches the browser-local store: it is already offline', async () => {
    const { repository, rows } = setup({ mode: 'browser-local', userId: 'u1' });

    await repository.list();
    await repository.get(LIVE_ID);

    expect([...rows.keys()]).toEqual([]);
  });

  it('caches nothing for an anonymous reader', async () => {
    const { repository, rows } = setup();

    await repository.list();

    expect([...rows.keys()]).toEqual([]);
  });

  it('never caches a mutation, and an offline mutation still fails', async () => {
    const { repository, backend, rows } = setup({ userId: 'u1' });
    backend.createLiveTournament.mockRejectedValueOnce(new Error('offline'));

    await expect(repository.create()).rejects.toThrowError('offline');

    expect([...rows.keys()]).toEqual([]);
  });
});
