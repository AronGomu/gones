import { HttpContextToken, HttpErrorResponse, HttpHandlerFn, HttpHeaders, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, from, mergeMap, throwError } from 'rxjs';

export const API_ETAG = new HttpContextToken<string | undefined>(() => undefined);
export const API_IDEMPOTENCY_KEY = new HttpContextToken<string | undefined>(() => undefined);

export interface ApiProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  message?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
}

export class ApiProblemError extends Error {
  constructor(readonly status: number, readonly problem: ApiProblemDetails) {
    super(problem.message ?? problem.title ?? 'API request failed.');
  }
}

@Injectable({ providedIn: 'root' })
export class ApiAccessTokenStore {
  private value?: string;
  get token(): string | undefined { return this.value; }
  set(token: string | undefined): void { this.value = token; }
  clear(): void { this.value = undefined; }
}

export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function joinApiUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path.startsWith('/') ? path : `/${path}`;
  return `${normalizeApiBaseUrl(baseUrl)}/${path.replace(/^\/+/, '')}`;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Keep local HTTP API calls same-site so browsers can store and replay the Lax refresh cookie. */
export function alignLoopbackApiUrl(requestUrl: string, pageHostname?: string): string {
  if (!pageHostname || !LOOPBACK_HOSTS.has(pageHostname)) return requestUrl;
  try {
    const url = new URL(requestUrl);
    if (!LOOPBACK_HOSTS.has(url.hostname) || url.hostname === pageHostname) return requestUrl;
    url.hostname = pageHostname;
    return url.toString();
  } catch {
    return requestUrl;
  }
}

/**
 * The archive reads whose freshness the app governs, not the browser (ADR 0039).
 *
 * These endpoints answer `public, max-age=3600`, so the browser serves a repeat GET out of its own
 * HTTP cache with no request at all. That second, invisible TTL can only make the app's contract
 * wrong: pressing Synchronize refetched nothing, and a mutation that had just dropped the IndexedDB
 * copy refilled it from the same stale bytes for up to an hour. The app already decides when a read
 * is due — its own 24h TTL, the Synchronize button, `invalidateArchiveCaches()` — so every request
 * it does issue has to reach the server. `no-cache` is revalidate, not re-download: the browser
 * still sends its stored validator and the server still answers `304` when nothing changed.
 */
const APP_GOVERNED_READ_PATH = /^\/api\/archive\//;

/** True for a GET whose freshness the app owns; those requests must not be answered from the HTTP cache. */
export function isAppGovernedRead(method: string, url: string): boolean {
  if (method !== 'GET') return false;
  try {
    return APP_GOVERNED_READ_PATH.test(new URL(url, 'https://gones.invalid').pathname);
  } catch {
    return false;
  }
}

export function buildApiHeaders(accessToken?: string, etag?: string, idempotencyKey?: string): HttpHeaders {
  let headers = new HttpHeaders();
  if (accessToken) headers = headers.set('Authorization', `Bearer ${accessToken}`);
  if (etag) headers = headers.set('If-Match', etag);
  if (idempotencyKey) headers = headers.set('Idempotency-Key', idempotencyKey);
  return headers;
}

export const apiBoundaryInterceptor: HttpInterceptorFn = (request, next) =>
  applyApiBoundary(request, next, inject(ApiAccessTokenStore).token);

export function applyApiBoundary(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  token?: string,
  pageHostname = globalThis.location?.hostname
) {
  const boundaryHeaders = buildApiHeaders(token, request.context.get(API_ETAG), request.context.get(API_IDEMPOTENCY_KEY));
  let headers = request.headers;
  for (const name of boundaryHeaders.keys()) headers = headers.set(name, boundaryHeaders.get(name)!);

  const url = alignLoopbackApiUrl(request.url, pageHostname);
  if (isAppGovernedRead(request.method, url)) headers = headers.set('Cache-Control', 'no-cache');
  return next(request.clone({ url, headers, withCredentials: true })).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        if (error.error instanceof Blob) {
          return from(error.error.text()).pipe(mergeMap(text => {
            const problem = parseProblemDetails(text);
            return throwError(() => problem ? new ApiProblemError(error.status, problem) : error);
          }));
        }
        if (isProblemDetails(error.error)) return throwError(() => new ApiProblemError(error.status, error.error));
      }
      return throwError(() => error);
    })
  );
}

function parseProblemDetails(value: string): ApiProblemDetails | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isProblemDetails(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isProblemDetails(value: unknown): value is ApiProblemDetails {
  return typeof value === 'object' && value !== null && ('code' in value || 'type' in value || 'title' in value);
}
