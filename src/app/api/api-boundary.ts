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

export function buildApiHeaders(accessToken?: string, etag?: string, idempotencyKey?: string): HttpHeaders {
  let headers = new HttpHeaders();
  if (accessToken) headers = headers.set('Authorization', `Bearer ${accessToken}`);
  if (etag) headers = headers.set('If-Match', etag);
  if (idempotencyKey) headers = headers.set('Idempotency-Key', idempotencyKey);
  return headers;
}

export const apiBoundaryInterceptor: HttpInterceptorFn = (request, next) =>
  applyApiBoundary(request, next, inject(ApiAccessTokenStore).token);

export function applyApiBoundary(request: HttpRequest<unknown>, next: HttpHandlerFn, token?: string) {
  const boundaryHeaders = buildApiHeaders(token, request.context.get(API_ETAG), request.context.get(API_IDEMPOTENCY_KEY));
  let headers = request.headers;
  for (const name of boundaryHeaders.keys()) headers = headers.set(name, boundaryHeaders.get(name)!);

  return next(request.clone({ headers, withCredentials: true })).pipe(
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
