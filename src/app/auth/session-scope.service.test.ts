import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { UserProfileResponse } from '../api/generated/gones-api';
import { CachedRead, SERVER_READ_CACHE_STORE_PORT, ServerReadCacheService } from '../backend/server-read-cache.service';
import { AuthService } from './auth.service';
import { SessionScopeService, isServiceWorkerDataCache } from './session-scope.service';

describe('SessionScopeService', () => {
  it('runs every registered reset so no user-scoped memory survives logout', () => {
    const service = create();
    const first = vi.fn();
    const second = vi.fn();
    service.register(first);
    service.register(second);

    service.clear();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('purges service worker API caches and keeps asset caches', async () => {
    const names = ['ngsw:/:1:data:dynamic:public-calendar-reads:cache', 'ngsw:/:db:control', 'ngsw:/:1:assets:app:cache'];
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(names),
      delete: (name: string) => { deleted.push(name); return Promise.resolve(true); }
    });

    create().clear();
    await Promise.resolve();
    await Promise.resolve();

    expect(deleted).toEqual(['ngsw:/:1:data:dynamic:public-calendar-reads:cache']);
    vi.unstubAllGlobals();
  });

  /**
   * ADR 0031 — the offline read cache is the one browser store holding private, user-scoped data, so
   * the reset it registers here is what keeps user A's leagues out of user B's session in a shared
   * browser. `AuthService.clear()` (logout, failed bootstrap, account deletion) is what calls this.
   */
  it('purges the authenticated read cache before the next user can read it', async () => {
    const rows = new Map<string, CachedRead<unknown>>();
    const store = {
      read: async (key: string) => rows.get(key) ?? null,
      write: async (key: string, entry: CachedRead<unknown>) => { rows.set(key, entry); },
      clear: async () => { rows.clear(); }
    };
    const sessionScope = create();
    const profile = signal<UserProfileResponse | null>({ id: 'user-a' } as UserProfileResponse);
    const injector = Injector.create({ providers: [
      { provide: AuthService, useValue: { profile } as unknown as AuthService },
      { provide: SessionScopeService, useValue: sessionScope },
      { provide: SERVER_READ_CACHE_STORE_PORT, useValue: store }
    ] });
    const cache = runInInjectionContext(injector, () => new ServerReadCacheService());
    await cache.read('leagues', () => Promise.resolve(['user-a league']));
    expect([...rows.keys()]).toEqual(['user-a:leagues']);

    sessionScope.clear();

    await vi.waitFor(() => expect(rows.size).toBe(0));
    profile.set({ id: 'user-b' } as UserProfileResponse);
    await expect(cache.read('leagues', () => Promise.reject(new Error('offline')))).rejects.toThrowError('offline');
    profile.set({ id: 'user-a' } as UserProfileResponse);
    await expect(cache.read('leagues', () => Promise.reject(new Error('offline')))).rejects.toThrowError('offline');
  });

  it('recognises only service worker data caches', () => {
    expect(isServiceWorkerDataCache('ngsw:/:1:data:dynamic:public-league-reads:cache')).toBe(true);
    expect(isServiceWorkerDataCache('ngsw:/:1:assets:app:cache')).toBe(false);
    expect(isServiceWorkerDataCache('other-cache')).toBe(false);
  });
});

function create(): SessionScopeService {
  return Injector.create({ providers: [SessionScopeService] }).get(SessionScopeService);
}
