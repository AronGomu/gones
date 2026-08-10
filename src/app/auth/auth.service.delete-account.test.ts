import '@angular/compiler';
import { Injector } from '@angular/core';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiAccessTokenStore } from '../api/api-boundary';
import { AccessTokenResponse, Client, UserProfileResponse } from '../api/generated/gones-api';
import { AuthSessionCoordinationService } from './auth-session-coordination.service';
import { AuthService } from './auth.service';
import { installFakeWebLocks, SharedFakeWebLocks } from './fake-web-locks';
import { SessionCatalogSyncService } from './session-catalog-sync.service';
import { SessionScopeService } from './session-scope.service';

const profile = { id: 'u1', email: 'u@example.test', emailVerified: true, globalRole: 'User', username: 'user', firstName: 'U', lastName: 'Ser', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthDatePublic: false, isPreferredLanguagePublic: false } as unknown as UserProfileResponse;
const token = { accessToken: 'memory-token', tokenType: 'Bearer', expiresAt: {} } as AccessTokenResponse;

function setup(meDELETE: () => Observable<void>) {
  const client = {
    refresh: vi.fn(() => of(token)),
    meGET: vi.fn(() => of(profile)),
    mePATCH: vi.fn(() => of(profile)),
    login: vi.fn(() => of(token)),
    logout: vi.fn(() => of(undefined)),
    logoutAll: vi.fn(() => of(undefined)),
    meDELETE: vi.fn(meDELETE)
  };
  const injector = Injector.create({ providers: [AuthService, AuthSessionCoordinationService, ApiAccessTokenStore, SessionScopeService, { provide: Client, useValue: client }, { provide: SessionCatalogSyncService, useValue: { adopt: vi.fn(async () => undefined) } }] });
  return { service: injector.get(AuthService), store: injector.get(ApiAccessTokenStore), sessionScope: injector.get(SessionScopeService), client };
}

describe('AuthService.deleteAccount', () => {
  beforeEach(() => {
    localStorage.clear();
    installFakeWebLocks();
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
    installFakeWebLocks(new SharedFakeWebLocks());
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

  it('blocks a later tab establishment behind successful deletion purge', async () => {
    installFakeWebLocks(new SharedFakeWebLocks());
    const firstTab = setup(() => of(undefined as unknown as void));
    const secondTab = setup(() => of(undefined as unknown as void));
    await firstTab.service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });
    let release!: () => void;
    firstTab.sessionScope.register(() => new Promise<void>((resolve) => { release = resolve; }));

    const deletion = firstTab.service.deleteAccount('valid-password-value');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const establishment = secondTab.service.login({ email: 'next@example.test', password: 'password', deviceLabel: undefined });
    await Promise.resolve();

    expect(secondTab.client.login).not.toHaveBeenCalled();
    expect(secondTab.service.profile()).toBeNull();
    release();
    await Promise.all([deletion, establishment]);
    expect(secondTab.client.login).toHaveBeenCalledTimes(1);
    expect(secondTab.service.profile()).not.toBeNull();
  });

  it('keeps the session when the server rejects the password', async () => {
    const { service, store, sessionScope, client } = setup(() => throwError(() => new Error('Bad Request')));
    const reset = vi.fn();
    sessionScope.register(reset);
    await service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });

    await expect(service.deleteAccount('wrong')).rejects.toThrow('Bad Request');

    expect(client.meDELETE).toHaveBeenCalledTimes(1);
    expect(service.profile()).not.toBeNull();
    expect(store.token).toBe('memory-token');
    expect(reset).not.toHaveBeenCalled();
    expect(localStorage.getItem('gones.auth.sessionGeneration')).toBeNull();
    expect(localStorage.getItem('gones.auth.privatePurgeRequired')).toBeNull();
  });

  it('failed deletion does not supersede an earlier in-flight profile update', async () => {
    const { service, store, sessionScope, client } = setup(() => throwError(() => new Error('Bad Request')));
    const updated = { ...profile, firstName: 'Updated' } as UserProfileResponse;
    const updateResult = new Subject<UserProfileResponse>();
    client.mePATCH.mockReturnValue(updateResult);
    const reset = vi.fn();
    sessionScope.register(reset);
    await service.login({ email: 'u@example.test', password: 'password', deviceLabel: undefined });

    const update = service.updateProfile({ firstName: 'Updated' } as Parameters<AuthService['updateProfile']>[0]);
    await expect(service.deleteAccount('wrong')).rejects.toThrow('Bad Request');
    updateResult.next(updated);
    updateResult.complete();
    await expect(update).resolves.toEqual(updated);

    expect(service.profile()?.firstName).toBe('Updated');
    expect(store.token).toBe('memory-token');
    expect(reset).not.toHaveBeenCalled();
    expect(localStorage.getItem('gones.auth.sessionGeneration')).toBeNull();
    expect(localStorage.getItem('gones.auth.privatePurgeRequired')).toBeNull();
  });
});
