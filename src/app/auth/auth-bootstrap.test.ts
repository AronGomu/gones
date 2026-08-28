import '@angular/compiler';
import { Injector } from '@angular/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiAccessTokenStore } from '../api/api-boundary';
import { AccessTokenResponse, Client, UserProfileResponse } from '../api/generated/gones-api';
import { runAuthBootstrap } from './auth-bootstrap';
import { AuthCoordinationUnavailableError, AuthSessionCoordinationService } from './auth-session-coordination.service';
import { AuthService } from './auth.service';
import { installFakeWebLocks, removeWebLocks } from './fake-web-locks';
import { SessionCatalogSyncService } from './session-catalog-sync.service';
import { SessionScopeService } from './session-scope.service';

const profile = { id: 'u1', email: 'u@example.test', emailVerified: true, globalRole: 'User', username: 'user', firstName: 'U', lastName: 'Ser', preferredLanguage: 'en', isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false, isBirthDatePublic: false, isPreferredLanguagePublic: false } as unknown as UserProfileResponse;
const token = { accessToken: 'memory-token', tokenType: 'Bearer', expiresAt: {} } as AccessTokenResponse;

function setup() {
  const client = {
    refresh: vi.fn(() => of(token)),
    meGET: vi.fn(() => of(profile)),
    login: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn()
  };
  const catalogSync = { adopt: vi.fn(async () => undefined) };
  const injector = Injector.create({ providers: [AuthService, AuthSessionCoordinationService, ApiAccessTokenStore, SessionScopeService, { provide: Client, useValue: client }, { provide: SessionCatalogSyncService, useValue: catalogSync }] });
  return { service: injector.get(AuthService), client };
}

describe('runAuthBootstrap', () => {
  beforeEach(() => {
    localStorage.clear();
    installFakeWebLocks();
  });

  it('resolves anonymously when session coordination is unavailable', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const auth = { bootstrap: vi.fn(async () => { throw new AuthCoordinationUnavailableError(); }) };

    await expect(runAuthBootstrap(auth)).resolves.toBeUndefined();

    logged.mockRestore();
  });

  it('logs the degradation as a boundary error, never silently', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const auth = { bootstrap: vi.fn(async () => { throw new AuthCoordinationUnavailableError(); }) };

    await runAuthBootstrap(auth);

    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(logged.mock.calls[0][0]))).toEqual({ level: 'error', boundary: 'auth.bootstrap', context: { degraded: 'anonymous' }, message: 'authCoordinationUnavailable' });
    logged.mockRestore();
  });

  it('rethrows every other bootstrap failure unchanged', async () => {
    const auth = { bootstrap: vi.fn(async () => { throw new Error('boom'); }) };

    await expect(runAuthBootstrap(auth)).rejects.toThrow('boom');
  });

  it('a real AuthService without Web Locks still settles signed-out', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { service, client } = setup();
    removeWebLocks();

    await expect(runAuthBootstrap(service)).resolves.toBeUndefined();

    expect(service.bootstrapped()).toBe(true);
    expect(service.bootstrapFailed()).toBe(true);
    expect(service.profile()).toBeNull();
    expect(client.refresh).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
