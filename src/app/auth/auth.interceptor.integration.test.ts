import '@angular/compiler';
import { HttpClient, HttpErrorResponse, HttpEvent, HttpHeaders, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { defer, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBoundaryInterceptor, ApiAccessTokenStore } from '../api/api-boundary';
import { Client, UserProfileResponse } from '../api/generated/gones-api';
import { AuthSessionCoordinationService } from './auth-session-coordination.service';
import { AuthService } from './auth.service';
import { authSessionInterceptor } from './auth.interceptor';
import { installFakeWebLocks } from './fake-web-locks';
import { SessionCatalogSyncService } from './session-catalog-sync.service';
import { SessionScopeService } from './session-scope.service';

const originalProfile = {
  id: 'u1', email: 'old@example.test', emailVerified: true, globalRole: 'User', username: 'user',
  firstName: 'Old', lastName: 'Name', preferredLanguage: 'en', isFirstNamePublic: false,
  isLastNamePublic: false, isLocationPublic: false, isBirthDatePublic: false,
  isPreferredLanguagePublic: false
} as unknown as UserProfileResponse;
const updatedProfile = { ...originalProfile, firstName: 'Updated' } as UserProfileResponse;

interface RequestOptions {
  body?: unknown;
  context?: HttpRequest<unknown>['context'];
  headers?: HttpHeaders;
}

function jsonResponse(status: number, value?: unknown): HttpResponse<Blob> {
  return new HttpResponse({ status, body: new Blob(value === undefined ? [] : [JSON.stringify(value)], { type: 'application/json' }) });
}

function setup(handler: (request: HttpRequest<unknown>) => Observable<HttpEvent<unknown>>) {
  const injectorRef: { current?: Injector } = {};
  const http = {
    request: (method: string, url: string, options: RequestOptions = {}) => defer(() => {
      const request = new HttpRequest(method.toUpperCase(), url, options.body ?? null, {
        headers: options.headers,
        context: options.context
      });
      return runInInjectionContext(injectorRef.current!, () => authSessionInterceptor(request, authRequest =>
        runInInjectionContext(injectorRef.current!, () => apiBoundaryInterceptor(authRequest, handler))));
    })
  } as unknown as HttpClient;
  const client = new Client(http, '');
  const injector = Injector.create({ providers: [
    AuthService,
    AuthSessionCoordinationService,
    ApiAccessTokenStore,
    SessionScopeService,
    { provide: Client, useValue: client },
    { provide: SessionCatalogSyncService, useValue: { adopt: vi.fn(async () => undefined) } }
  ] });
  injectorRef.current = injector;
  const service = injector.get(AuthService);
  const store = injector.get(ApiAccessTokenStore);
  const coordination = injector.get(AuthSessionCoordinationService);
  coordination.bindProfile(originalProfile.id, coordination.generation());
  service.profile.set(originalProfile);
  store.set('expired-token');
  return { service, store };
}

describe('AuthService with authSessionInterceptor', () => {
  beforeEach(() => {
    localStorage.clear();
    installFakeWebLocks();
  });

  it.each([
    ['profile update', 'PATCH', '/api/users/me'],
    ['email change', 'POST', '/api/users/me/email-change']
  ])('settles %s through 401, refresh, and replay without auth-lock re-entry', async (_label, method, path) => {
    let protectedCalls = 0;
    let refreshCalls = 0;
    const { service, store } = setup(request => {
      if (request.url === '/api/auth/refresh') {
        refreshCalls++;
        return of(jsonResponse(200, { accessToken: 'fresh-token', tokenType: 'Bearer', expiresAt: '2026-08-11T00:00:00Z' }));
      }
      if (request.method === method && request.url === path) {
        protectedCalls++;
        if (protectedCalls === 1) return throwError(() => new HttpErrorResponse({ status: 401, url: request.url }));
        expect(request.headers.get('Authorization')).toBe('Bearer fresh-token');
        return of(path.endsWith('email-change')
          ? jsonResponse(202, { message: 'sent' })
          : jsonResponse(200, updatedProfile));
      }
      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    if (path.endsWith('email-change')) {
      await expect(service.requestEmailChange({ newEmail: 'new@example.test', currentPassword: 'password' })).resolves.toBeUndefined();
      expect(service.profile()?.emailVerified).toBe(false);
    } else {
      await expect(service.updateProfile({ firstName: 'Updated' } as Parameters<AuthService['updateProfile']>[0])).resolves.toMatchObject({ firstName: 'Updated' });
      expect(service.profile()?.firstName).toBe('Updated');
    }

    expect(protectedCalls).toBe(2);
    expect(refreshCalls).toBe(1);
    expect(store.token).toBe('fresh-token');
  });

  it('rejects exact account DELETE 401 once without refresh', async () => {
    let deleteCalls = 0;
    let refreshCalls = 0;
    const { service, store } = setup(request => {
      if (request.url === '/api/auth/refresh') {
        refreshCalls++;
        return of(jsonResponse(200, { accessToken: 'fresh-token', tokenType: 'Bearer', expiresAt: '2026-08-11T00:00:00Z' }));
      }
      if (request.method === 'DELETE' && request.url === '/api/users/me') {
        deleteCalls++;
        return throwError(() => new HttpErrorResponse({ status: 401, url: request.url }));
      }
      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    await expect(service.deleteAccount('wrong-password')).rejects.toMatchObject({ status: 401 });

    expect(deleteCalls).toBe(1);
    expect(refreshCalls).toBe(0);
    expect(service.profile()).toEqual(originalProfile);
    expect(store.token).toBe('expired-token');
  });
});
