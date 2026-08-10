import '@angular/compiler';
import { Injector } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiAccessTokenStore } from '../api/api-boundary';
import { AccessTokenResponse, Client, UserProfileResponse } from '../api/generated/gones-api';
import { AuthService } from './auth.service';
import { SessionCatalogSyncService } from './session-catalog-sync.service';
import { SessionScopeService } from './session-scope.service';

const profile = { id: 'u1', email: 'u@example.test', emailVerified: true, globalRole: 'User', username: 'user', firstName: 'U', lastName: 'Ser', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthDatePublic: false, isPreferredLanguagePublic: false } as unknown as UserProfileResponse;
const token = { accessToken: 'memory-token', tokenType: 'Bearer', expiresAt: {} } as AccessTokenResponse;

function setup(meDELETE: () => Observable<void>) {
  const client = {
    refresh: vi.fn(() => of(token)),
    meGET: vi.fn(() => of(profile)),
    login: vi.fn(() => of(token)),
    logout: vi.fn(() => of(undefined)),
    logoutAll: vi.fn(() => of(undefined)),
    meDELETE: vi.fn(meDELETE)
  };
  const injector = Injector.create({ providers: [AuthService, ApiAccessTokenStore, SessionScopeService, { provide: Client, useValue: client }, { provide: SessionCatalogSyncService, useValue: { adopt: vi.fn(async () => undefined) } }] });
  return { service: injector.get(AuthService), store: injector.get(ApiAccessTokenStore), sessionScope: injector.get(SessionScopeService), client };
}

describe('AuthService.deleteAccount', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });

  it('sends the confirmation password once and drops the local session', async () => {
    const { service, store, sessionScope, client } = setup(() => of(undefined as unknown as void));
    const reset = vi.fn();
    sessionScope.register(reset);
    await service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });
    expect(service.profile()).not.toBeNull();

    await service.deleteAccount('valid-password-value');

    expect(client.meDELETE).toHaveBeenCalledTimes(1);
    expect(client.meDELETE).toHaveBeenCalledWith({ currentPassword: 'valid-password-value' });
    expect(service.profile()).toBeNull();
    expect(store.token).toBeUndefined();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('reports successful server deletion despite purge failure and makes the next tab retry purge before login', async () => {
    const firstTab = setup(() => of(undefined as unknown as void));
    firstTab.sessionScope.register(() => Promise.reject(new Error('purge failed')));
    await firstTab.service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(firstTab.service.deleteAccount('valid-password-value')).resolves.toBeUndefined();

    expect(firstTab.service.profile()).toBeNull();
    expect(firstTab.store.token).toBeUndefined();
    const secondTab = setup(() => of(undefined as unknown as void));
    let releaseRetry!: () => void;
    secondTab.sessionScope.register(() => new Promise<void>((resolve) => { releaseRetry = resolve; }));
    const nextLogin = secondTab.service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });
    await vi.waitFor(() => expect(releaseRetry).toBeTypeOf('function'));
    expect(secondTab.client.login).not.toHaveBeenCalled();
    expect(secondTab.service.profile()).toBeNull();
    expect(secondTab.store.token).toBeUndefined();

    releaseRetry();
    await nextLogin;
    expect(secondTab.client.login).toHaveBeenCalledTimes(1);
    expect(secondTab.service.profile()).not.toBeNull();
    logged.mockRestore();
  });

  it('keeps the session when the server rejects the password', async () => {
    const { service, store, client } = setup(() => throwError(() => new Error('Bad Request')));
    await service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });

    await expect(service.deleteAccount('wrong')).rejects.toThrow('Bad Request');

    expect(client.meDELETE).toHaveBeenCalledTimes(1);
    expect(service.profile()).not.toBeNull();
    expect(store.token).toBe('memory-token');
  });
});
