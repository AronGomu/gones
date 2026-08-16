import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserProfileResponse } from '../api/generated/gones-api';
import { AuthSessionCoordinationService } from '../auth/auth-session-coordination.service';
import { AuthService } from '../auth/auth.service';
import { installFakeWebLocks } from '../auth/fake-web-locks';
import { SessionScopeService } from '../auth/session-scope.service';
import { CachedRead, SERVER_READ_CACHE_STORE_PORT, ServerReadCacheService } from './server-read-cache.service';

function fakeStore(seed: Record<string, CachedRead<unknown>> = {}) {
  const rows = new Map<string, CachedRead<unknown>>(Object.entries(seed));
  return {
    rows,
    read: async (key: string) => rows.get(key) ?? null,
    write: async (key: string, entry: CachedRead<unknown>) => { rows.set(key, entry); },
    delete: async (key: string) => { rows.delete(key); },
    clear: async () => { rows.clear(); }
  };
}

function buildService(userId: string, store: ReturnType<typeof fakeStore>): ServerReadCacheService {
  const profile = signal<UserProfileResponse | null>({ id: userId } as UserProfileResponse);
  const auth = { profile } as unknown as AuthService;
  const coordination = new AuthSessionCoordinationService();
  coordination.bindProfile(userId, coordination.generation());
  const injector = Injector.create({ providers: [
    { provide: AuthService, useValue: auth },
    { provide: AuthSessionCoordinationService, useValue: coordination },
    { provide: SessionScopeService, useValue: new SessionScopeService() },
    { provide: SERVER_READ_CACHE_STORE_PORT, useValue: store }
  ] });
  return runInInjectionContext(injector, () => new ServerReadCacheService());
}

beforeEach(() => {
  localStorage.clear();
  installFakeWebLocks();
});

describe('private cache scope isolation', () => {
  it('does not leak between accounts', async () => {
    const shared = fakeStore();

    const serviceA = buildService('user-a', shared);
    const userAData = [{ userId: 'user-a', eventId: 'e1' }];
    await serviceA.readCached('registrations:1', async () => userAData);

    expect(shared.rows.has('user-a:registrations:1')).toBe(true);
    expect(shared.rows.has('user-b:registrations:1')).toBe(false);

    const serviceB = buildService('user-b', shared);
    const userBData = [{ userId: 'user-b', eventId: 'e2' }];
    let loaderCalled = false;
    const result = await serviceB.readCached('registrations:1', async () => {
      loaderCalled = true;
      return userBData;
    });

    expect(loaderCalled).toBe(true);
    expect(result.fromCache).toBe(false);
    expect(result.value).toEqual(userBData);
    expect(result.value).not.toEqual(userAData);
  });

  it('serves user A data from cache without calling the loader a second time', async () => {
    const shared = fakeStore();
    const serviceA = buildService('user-a', shared);
    const userAData = [{ userId: 'user-a', eventId: 'e1' }];
    let calls = 0;
    const loader = async () => { calls++; return userAData; };

    await serviceA.readCached('registrations:1', loader);
    const cached = await serviceA.readCached('registrations:1', loader);

    expect(calls).toBe(1);
    expect(cached.fromCache).toBe(true);
    expect(cached.value).toEqual(userAData);
  });
});
