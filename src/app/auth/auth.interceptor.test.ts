import '@angular/compiler';
import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { defer, firstValueFrom, of, shareReplay, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiAccessTokenStore } from '../api/api-boundary';
import { AuthService } from './auth.service';
import { authSessionInterceptor } from './auth.interceptor';

describe('authSessionInterceptor', () => {
  it('refreshes once then replays original request once', async () => {
    const store = new ApiAccessTokenStore();
    store.set('expired');
    const auth = { refreshAccessToken: vi.fn(() => { store.set('fresh'); return of(undefined); }), clear: vi.fn() };
    const injector = Injector.create({ providers: [{ provide: ApiAccessTokenStore, useValue: store }, { provide: AuthService, useValue: auth }] });
    let calls = 0;
    const response = await runInInjectionContext(injector, () => firstValueFrom(authSessionInterceptor(new HttpRequest('GET', '/api/users/me'), req => {
      calls++;
      if (calls === 1) return throwError(() => new HttpErrorResponse({ status: 401 }));
      expect(req.context).toBeTruthy();
      return of(new HttpResponse({ status: 200 }));
    })));
    expect((response as HttpResponse<unknown>).status).toBe(200);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it('shares one refresh across concurrent 401 responses and replays each request once', async () => {
    const store = new ApiAccessTokenStore(); store.set('expired');
    const refreshResult = new Subject<void>();
    let refreshCalls = 0;
    const refreshFlight = defer(() => { refreshCalls++; return refreshResult; }).pipe(shareReplay({ bufferSize: 1, refCount: false }));
    const auth = { refreshAccessToken: vi.fn(() => refreshFlight), clear: vi.fn() };
    const injector = Injector.create({ providers: [{ provide: ApiAccessTokenStore, useValue: store }, { provide: AuthService, useValue: auth }] });
    const calls = [0, 0];
    const requests = calls.map((_, index) => runInInjectionContext(injector, () => firstValueFrom(authSessionInterceptor(new HttpRequest('GET', `/api/resource/${index}`), () => {
      calls[index]++;
      return calls[index] === 1 ? throwError(() => new HttpErrorResponse({ status: 401 })) : of(new HttpResponse({ status: 200 }));
    }))));

    refreshResult.next(); refreshResult.complete();
    await Promise.all(requests);

    expect(refreshCalls).toBe(1);
    expect(calls).toEqual([2, 2]);
  });

  it('does not recurse on refresh endpoint', async () => {
    const store = new ApiAccessTokenStore(); store.set('expired');
    const auth = { refreshAccessToken: vi.fn(() => of(undefined)), clear: vi.fn() };
    const injector = Injector.create({ providers: [{ provide: ApiAccessTokenStore, useValue: store }, { provide: AuthService, useValue: auth }] });
    const result = runInInjectionContext(injector, () => firstValueFrom(authSessionInterceptor(new HttpRequest('POST', '/api/auth/refresh', null), () => throwError(() => new HttpErrorResponse({ status: 401 })) )));
    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
  });
});
