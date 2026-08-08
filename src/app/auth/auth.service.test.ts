import '@angular/compiler';
import { Injector } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiAccessTokenStore } from '../api/api-boundary';
import { AccessTokenResponse, Client, UserProfileResponse } from '../api/generated/gones-api';
import { AuthService } from './auth.service';
import { SessionScopeService } from './session-scope.service';

const profile = { id: 'u1', email: 'u@example.test', emailVerified: true, globalRole: 'User', username: 'user', firstName: 'U', lastName: 'Ser', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthDatePublic: false, isPreferredLanguagePublic: false } as unknown as UserProfileResponse;
const token = { accessToken: 'memory-token', tokenType: 'Bearer', expiresAt: {} } as AccessTokenResponse;

function setup(refresh: () => Observable<AccessTokenResponse>) {
  const client = {
    refresh: vi.fn(refresh),
    meGET: vi.fn(() => of(profile)),
    login: vi.fn(() => of(token)),
    logout: vi.fn(() => of(undefined)),
    logoutAll: vi.fn(() => of(undefined))
  };
  const injector = Injector.create({ providers: [AuthService, ApiAccessTokenStore, SessionScopeService, { provide: Client, useValue: client }] });
  return { service: injector.get(AuthService), store: injector.get(ApiAccessTokenStore), sessionScope: injector.get(SessionScopeService), client };
}

describe('AuthService', () => {
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

  it('clears auth when refresh fails', async () => {
    const { service, store } = setup(() => throwError(() => new Error('refresh failed')));
    store.set('stale');
    await expect(firstValueFrom(service.refreshAccessToken())).rejects.toThrow('refresh failed');
    expect(store.token).toBeUndefined();
    expect(service.profile()).toBeNull();
  });
});
