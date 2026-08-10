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

function setup(refresh: () => Observable<AccessTokenResponse>) {
  const client = {
    refresh: vi.fn(refresh),
    meGET: vi.fn(() => of(profile)),
    login: vi.fn(() => of(token)),
    logout: vi.fn(() => of(undefined)),
    logoutAll: vi.fn(() => of(undefined))
  };
  const catalogSync = { adopt: vi.fn(async () => undefined) };
  const injector = Injector.create({ providers: [AuthService, ApiAccessTokenStore, SessionScopeService, { provide: Client, useValue: client }, { provide: SessionCatalogSyncService, useValue: catalogSync }] });
  return { service: injector.get(AuthService), store: injector.get(ApiAccessTokenStore), sessionScope: injector.get(SessionScopeService), client, catalogSync };
}

describe('AuthService.bootstrap', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });

  it('restores the session from the refresh cookie before the first route renders', async () => {
    const { service, store, client } = setup(() => of(token));

    await service.bootstrap();

    expect(client.refresh).toHaveBeenCalledTimes(1);
    expect(service.profile()).not.toBeNull();
    expect(service.profile()?.username).toBe('user');
    expect(store.token).toBe('memory-token');
    expect(service.bootstrapped()).toBe(true);
    expect(service.bootstrapFailed()).toBe(false);
  });

  it('records the failure and still finishes bootstrapping when there is no usable cookie', async () => {
    const { service, store } = setup(() => throwError(() => new Error('no refresh cookie')));

    await service.bootstrap();

    expect(service.profile()).toBeNull();
    expect(store.token).toBeUndefined();
    expect(service.bootstrapFailed()).toBe(true);
    expect(service.bootstrapped()).toBe(true);
  });

  it('a restored session adopts the server catalog too', async () => {
    // A reload with a live cookie is a sign-in as far as the conflict rule is concerned (ADR 0032).
    const { service, catalogSync } = setup(() => of(token));

    await service.bootstrap();

    expect(catalogSync.adopt).toHaveBeenCalledTimes(1);
  });

  it('a failed bootstrap waits for private cache purge before completing', async () => {
    const { service, sessionScope } = setup(() => throwError(() => new Error('no refresh cookie')));
    let releases = 0;
    const waiting: Array<() => void> = [];
    sessionScope.register(() => new Promise<void>((resolve) => { waiting.push(resolve); }));

    const pending = service.bootstrap();
    await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    expect(service.bootstrapped()).toBe(false);
    while (waiting.length) { releases += 1; waiting.shift()!(); }
    await vi.waitFor(() => {
      while (waiting.length) { releases += 1; waiting.shift()!(); }
      expect(service.bootstrapped()).toBe(true);
    });
    await pending;

    expect(releases).toBeGreaterThanOrEqual(1);
  });

  it('a failed bootstrap adopts nothing, so the browser keeps its local catalog', async () => {
    const { service, catalogSync } = setup(() => throwError(() => new Error('no refresh cookie')));

    await service.bootstrap();

    expect(catalogSync.adopt).not.toHaveBeenCalled();
  });

  it('runs the refresh round trip once, so a second call cannot re-enter it', async () => {
    const { service, client } = setup(() => of(token));

    await service.bootstrap();
    await service.bootstrap();

    expect(client.refresh).toHaveBeenCalledTimes(1);
  });
});
