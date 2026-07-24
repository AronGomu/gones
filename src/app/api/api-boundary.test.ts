import '@angular/compiler';
import { HttpClient, HttpContext, HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  API_ETAG,
  API_IDEMPOTENCY_KEY,
  ApiAccessTokenStore,
  ApiProblemError,
  apiBoundaryInterceptor,
  applyApiBoundary,
  buildApiHeaders,
  joinApiUrl,
  normalizeApiBaseUrl
} from './api-boundary';
import { Client } from './generated/gones-api';

describe('API boundary', () => {
  it('joins base URLs without duplicate slashes', () => {
    expect(joinApiUrl('https://api.example/', '/api/users/me')).toBe('https://api.example/api/users/me');
    expect(joinApiUrl('', 'api/users/me')).toBe('/api/users/me');
    expect(normalizeApiBaseUrl('https://api.example///')).toBe('https://api.example');
  });

  it('omits absent JWT and forwards ETag and idempotency key', () => {
    const anonymous = buildApiHeaders(undefined, '"v2"', 'create-1');
    expect(anonymous.has('Authorization')).toBe(false);
    expect(anonymous.get('If-Match')).toBe('"v2"');
    expect(anonymous.get('Idempotency-Key')).toBe('create-1');
    expect(buildApiHeaders('jwt').get('Authorization')).toBe('Bearer jwt');
  });

  it('generated client uses same-origin base without protocol-relative URL', async () => {
    let sentUrl: string | undefined;
    const http = {
      request: (_method: string, url: string) => {
        sentUrl = url;
        return of(new HttpResponse({ status: 200, body: new Blob(['{"status":"live"}'], { type: 'application/json' }) }));
      }
    } as unknown as HttpClient;

    await firstValueFrom(new Client(http).live());

    expect(sentUrl).toBe('/health/live');
  });

  it('in-memory token store never persists token', () => {
    const store = new ApiAccessTokenStore();
    store.set('token');
    expect(store.token).toBe('token');
    store.clear();
    expect(store.token).toBeUndefined();
    expect(new ApiAccessTokenStore().token).toBeUndefined();
  });

  it('uses credentials and applies in-memory token plus request context', async () => {
    const context = new HttpContext().set(API_ETAG, '"v4"').set(API_IDEMPOTENCY_KEY, 'update-4');
    const request = new HttpRequest('PATCH', '/api/users/me', {}, { context });
    let sent: HttpRequest<unknown> | undefined;

    await firstValueFrom(applyApiBoundary(request, candidate => {
      sent = candidate;
      return of(new HttpResponse({ status: 204 }));
    }, 'access-token'));

    expect(sent?.withCredentials).toBe(true);
    expect(sent?.headers.get('Authorization')).toBe('Bearer access-token');
    expect(sent?.headers.get('If-Match')).toBe('"v4"');
    expect(sent?.headers.get('Idempotency-Key')).toBe('update-4');
  });

  it('interceptor reads token through dependency injection', async () => {
    const injector = Injector.create({ providers: [ApiAccessTokenStore] });
    injector.get(ApiAccessTokenStore).set('injected-token');
    const request = new HttpRequest('GET', '/api/users/me');
    let sent: HttpRequest<unknown> | undefined;

    await runInInjectionContext(injector, () => firstValueFrom(apiBoundaryInterceptor(request, candidate => {
      sent = candidate;
      return of(new HttpResponse({ status: 200 }));
    })));

    expect(sent?.headers.get('Authorization')).toBe('Bearer injected-token');
    expect(sent?.withCredentials).toBe(true);
  });

  it('maps RFC 7807 responses to ApiProblemError', async () => {
    const request = new HttpRequest('GET', '/api/missing');
    const result = firstValueFrom(applyApiBoundary(request, () => throwError(() =>
      new HttpErrorResponse({ status: 404, error: { type: 'urn:gones:problem:not_found', code: 'not_found', message: 'Missing.' } })
    )));

    await expect(result).rejects.toMatchObject({ status: 404, message: 'Missing.', problem: { code: 'not_found' } } satisfies Partial<ApiProblemError>);
  });

  it('maps Blob RFC 7807 responses from generated client transport', async () => {
    const request = new HttpRequest('GET', '/api/missing');
    const blob = new Blob([JSON.stringify({ type: 'urn:gones:problem:not_found', code: 'not_found', message: 'Missing.' })], { type: 'application/problem+json' });
    const result = firstValueFrom(applyApiBoundary(request, () => throwError(() => new HttpErrorResponse({ status: 404, error: blob }))));

    await expect(result).rejects.toMatchObject({ status: 404, problem: { code: 'not_found' } });
  });

  it('preserves malformed Blob errors by identity', async () => {
    const request = new HttpRequest('GET', '/api/fail');
    const sentinel = new HttpErrorResponse({ status: 502, error: new Blob(['not-json']) });
    const result = firstValueFrom(applyApiBoundary(request, () => throwError(() => sentinel)));

    await expect(result).rejects.toBe(sentinel);
  });

  it('preserves non-Problem Details errors by identity', async () => {
    const sentinel = new Error('network');
    const request = new HttpRequest('GET', '/api/fail');
    const result = firstValueFrom(applyApiBoundary(request, () => throwError(() => sentinel)));

    await expect(result).rejects.toBe(sentinel);
  });
});
