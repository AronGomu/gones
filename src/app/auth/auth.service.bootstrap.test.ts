import '@angular/compiler';
import { Injector } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
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
  return { service: injector.get(AuthService), store: injector.get(ApiAccessTokenStore), client };
}

describe('AuthService.bootstrap', () => {
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

  it('runs the refresh round trip once, so a second call cannot re-enter it', async () => {
    const { service, client } = setup(() => of(token));

    await service.bootstrap();
    await service.bootstrap();

    expect(client.refresh).toHaveBeenCalledTimes(1);
  });
});
