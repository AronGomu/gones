import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Request header that makes `ngsw-worker.js` ignore a request entirely: it is never matched
 * against a data group, never read from cache, and never written to cache.
 */
export const NGSW_BYPASS_HEADER = 'ngsw-bypass';

/**
 * Anonymous public reads the service worker may keep for offline display.
 *
 * This is the single source of truth for the offline read surface; `ngsw-config.json`
 * mirrors it as URL globs and `service-worker-cache.test.ts` proves the two agree.
 */
const PUBLIC_CACHEABLE_API_PATHS: readonly RegExp[] = [
  /^\/api\/tournaments$/,
  /^\/api\/tournaments\/[^/]+$/,
  /^\/api\/organizations$/,
  /^\/api\/organizations\/[^/]+$/,
  /^\/api\/leagues$/,
  /^\/api\/leagues\/[^/]+$/,
  /^\/api\/leagues\/[^/]+\/result$/,
  /^\/api\/leagues\/[^/]+\/tournaments\/[^/]+$/,
  /^\/api\/leagues\/[^/]+\/tournaments\/[^/]+\/result$/,
  /^\/api\/leagues\/[^/]+\/players\/[^/]+\/statistics$/,
  /^\/api\/formats$/,
  /^\/api\/deck-archetypes$/
];

/**
 * Reads that must never reach a shared cache even though they are GETs: session and profile
 * state, Admin and Organizer surfaces, private participant rosters, bulk exports, and the
 * fast-moving Live Tournament reads whose authority is always the server.
 */
const NEVER_CACHEABLE_API_PATHS: readonly RegExp[] = [
  /^\/api\/auth(\/|$)/,
  /^\/api\/users(\/|$)/,
  /^\/api\/admin(\/|$)/,
  /^\/api\/maintenance(\/|$)/,
  /^\/api\/organizer(\/|$)/,
  /^\/api\/live-tournaments(\/|$)/,
  /\/registrations(\/|$)/,
  /\/registration-capability$/,
  /\/participants$/,
  /\/blocked-users(\/|$)/,
  /\/members(\/|$)/,
  /\/notification-settings$/,
  /\/document$/,
  /\/export$/,
  /\/lookup$/
];

export interface PublicApiRequestProbe {
  method: string;
  url: string;
  hasAuthorization?: boolean;
}

/** True only for anonymous public GETs whose response is identical for every visitor. */
export function isCacheablePublicApiRequest(probe: PublicApiRequestProbe): boolean {
  if (probe.method.toUpperCase() !== 'GET') return false;
  if (probe.hasAuthorization) return false;
  const path = requestPath(probe.url);
  if (!path) return false;
  if (NEVER_CACHEABLE_API_PATHS.some(pattern => pattern.test(path))) return false;
  return PUBLIC_CACHEABLE_API_PATHS.some(pattern => pattern.test(path));
}

/**
 * Marks every request that is not an anonymous public GET so the service worker cannot cache
 * it. Runs last in the interceptor chain, after `Authorization` has been attached.
 */
export const serviceWorkerBypassInterceptor: HttpInterceptorFn = (request, next) => {
  if (isCacheablePublicApiRequest({ method: request.method, url: request.url, hasAuthorization: request.headers.has('Authorization') })) {
    return next(request);
  }
  return next(request.clone({ setHeaders: { [NGSW_BYPASS_HEADER]: 'true' } }));
};

function requestPath(url: string): string {
  try {
    return new URL(url, globalThis.location?.href ?? 'http://localhost/').pathname;
  } catch {
    return '';
  }
}
