import '@angular/compiler';
import { Injector } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiAccessTokenStore } from '../api/api-boundary';
import { AccessTokenResponse, Client, UserProfileResponse } from '../api/generated/gones-api';
import { AuthService } from './auth.service';
import { SessionCatalogSyncService } from './session-catalog-sync.service';
import { SessionScopeService } from './session-scope.service';

const profile = { id: 'u1', email: 'u@example.test', emailVerified: true, globalRole: 'User', username: 'user', firstName: 'U', lastName: 'Ser', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthDatePublic: false, isPreferredLanguagePublic: false } as unknown as UserProfileResponse;
const profileB = { ...profile, id: 'u2', email: 'u2@example.test', username: 'user-b' } as UserProfileResponse;
const token = { accessToken: 'memory-token', tokenType: 'Bearer', expiresAt: {} } as AccessTokenResponse;

function setup(refresh: () => Observable<AccessTokenResponse>) {
  const client = {
    refresh: vi.fn(refresh),
    meGET: vi.fn(() => of(profile)),
    login: vi.fn(() => of(token)),
    complete: vi.fn(() => of({ accessToken: token.accessToken, expiresAt: token.expiresAt, tokenType: token.tokenType })),
    verifyEmail2: vi.fn(() => of({ accessToken: token.accessToken, expiresAt: token.expiresAt, tokenType: token.tokenType })),
    logout: vi.fn(() => of(undefined)),
    logoutAll: vi.fn(() => of(undefined))
  };
  // The catalog sync is faked, and records the profile it saw: "remote prevails" is only correct if
  // it runs once the session exists.
  let profileWhenAdopted: UserProfileResponse | null | undefined;
  const catalogSync = { adopt: vi.fn(async (_expectedProfileId: string, _isCurrentSession: () => boolean) => { profileWhenAdopted = service.profile(); }) };
  const injector = Injector.create({ providers: [AuthService, ApiAccessTokenStore, SessionScopeService, { provide: Client, useValue: client }, { provide: SessionCatalogSyncService, useValue: catalogSync }] });
  const service = injector.get(AuthService);
  return { service, store: injector.get(ApiAccessTokenStore), sessionScope: injector.get(SessionScopeService), client, catalogSync, profileWhenAdopted: () => profileWhenAdopted };
}

describe('AuthService', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });

  it('keeps access token in memory only', async () => {
    const { service, store } = setup(() => of(token));
    await service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });
    expect(store.token).toBe('memory-token');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('shares exactly one refresh flight', async () => {
    const result = new BehaviorSubject<AccessTokenResponse | null>(null);
    const { service, client } = setup(() => new Observable(subscriber => result.subscribe(value => { if (value) { subscriber.next(value); subscriber.complete(); } })));
    const first = firstValueFrom(service.refreshAccessToken());
    const second = firstValueFrom(service.refreshAccessToken());
    result.next(token);
    await Promise.all([first, second]);
    expect(client.refresh).toHaveBeenCalledTimes(1);
  });

  it('drops user-scoped state on logout so a later session cannot read it', async () => {
    const { service, store, sessionScope } = setup(() => of(token));
    const reset = vi.fn();
    sessionScope.register(reset);
    await service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });

    await service.logout();

    expect(store.token).toBeUndefined();
    expect(service.profile()).toBeNull();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('sign-in adopts the server catalog', async () => {
    // ADR 0032: the server list replaces the browser one, once, after the profile lands.
    const { service, catalogSync, profileWhenAdopted } = setup(() => of(token));

    await service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });

    expect(catalogSync.adopt).toHaveBeenCalledTimes(1);
    expect(profileWhenAdopted()?.id).toBe('u1');
  });

  it('OAuth completion adopts the server catalog once', async () => {
    const { service, catalogSync } = setup(() => of(token));

    await service.completeOAuth({ completionTicket: 'ticket', email: 'u@example.test', username: 'user', firstName: 'U', lastName: 'Ser', deviceLabel: undefined });

    expect(catalogSync.adopt).toHaveBeenCalledTimes(1);
  });

  it('OAuth email verification adopts the server catalog once', async () => {
    const { service, catalogSync } = setup(() => of(token));

    await service.verifyOAuthEmail('verification-token');

    expect(catalogSync.adopt).toHaveBeenCalledTimes(1);
  });

  it('signing out adopts nothing, so the browser keeps its anonymous catalog', async () => {
    const { service, catalogSync } = setup(() => of(token));
    await service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });

    await service.logout();

    expect(catalogSync.adopt).toHaveBeenCalledTimes(1);
  });

  it('logout does not resolve until private session resets finish', async () => {
    const { service, sessionScope } = setup(() => of(token));
    let release!: () => void;
    sessionScope.register(() => new Promise<void>((resolve) => { release = resolve; }));
    await service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });

    let completed = false;
    const pending = service.logout().then(() => { completed = true; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(completed).toBe(false);

    release();
    await pending;
    expect(completed).toBe(true);
  });

  it('serializes a later tab login behind unresolved teardown purge', async () => {
    let lockTail: Promise<void> = Promise.resolve();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: <T>(_name: string, callback: () => Promise<T>) => {
          const pending = lockTail.then(callback, callback);
          lockTail = pending.then(() => undefined, () => undefined);
          return pending;
        }
      }
    });
    const firstTab = setup(() => of(token));
    const secondTab = setup(() => of(token));
    secondTab.client.meGET.mockReturnValue(of(profileB));
    await firstTab.service.login({ email: 'a@example.test', password: 'password', deviceLabel: undefined });
    const rows = new Map([['user-a', 'private']]);
    let release!: () => void;
    firstTab.sessionScope.register(() => new Promise<void>((resolve) => {
      release = () => { rows.clear(); resolve(); };
    }));
    secondTab.catalogSync.adopt.mockImplementation(async (userId: string) => { rows.set(userId, 'private'); });

    const teardown = firstTab.service.logout();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const establishment = secondTab.service.login({ email: 'b@example.test', password: 'password', deviceLabel: undefined });
    await Promise.resolve();

    expect(secondTab.service.profile()).toBeNull();
    expect(secondTab.client.login).not.toHaveBeenCalled();
    expect(rows.has('user-a')).toBe(true);

    release();
    await Promise.all([teardown, establishment]);

    expect(secondTab.service.profile()?.id).toBe('u2');
    expect(secondTab.client.login).toHaveBeenCalledTimes(1);
    expect([...rows.entries()]).toEqual([['u2', 'private']]);
  });

  it('preserves refresh error when private purge also fails', async () => {
    const refreshError = new Error('refresh failed');
    const { service, sessionScope } = setup(() => throwError(() => refreshError));
    sessionScope.register(() => Promise.reject(new Error('purge failed')));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(firstValueFrom(service.refreshAccessToken())).rejects.toBe(refreshError);

    expect(logged.mock.calls.map(([line]) => String(line)).join()).toContain('auth.session-purge');
    logged.mockRestore();
  });

  it('preserves logout server error when private purge also fails without an unhandled rejection', async () => {
    const logoutError = new Error('logout failed');
    const { service, sessionScope, client } = setup(() => of(token));
    client.logout.mockReturnValue(throwError(() => logoutError));
    sessionScope.register(() => Promise.reject(new Error('purge failed')));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.logout()).rejects.toBe(logoutError);

    expect(service.profile()).toBeNull();
    expect(logged.mock.calls.map(([line]) => String(line)).join()).toContain('auth.session-purge');
    logged.mockRestore();
  });

  it('clears auth when refresh fails', async () => {
    const { service, store } = setup(() => throwError(() => new Error('refresh failed')));
    store.set('stale');
    await expect(firstValueFrom(service.refreshAccessToken())).rejects.toThrow('refresh failed');
    expect(store.token).toBeUndefined();
    expect(service.profile()).toBeNull();
  });
});
