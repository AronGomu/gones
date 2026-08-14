/**
 * The refresh cookie is host-bound and `SameSite=Lax` on the plain-http dev host (ADR 0029), so a
 * page served from `localhost` can never send a cookie the API set on `127.0.0.1`: login appears to
 * work, then the session dies on the first reload because `POST /api/auth/refresh` arrives without
 * the cookie. Both names address the same dev stack, so the app moves itself to the API's host
 * rather than running in a configuration where the session cannot survive.
 *
 * Loopback only, development only: no production deployment may be redirected by build defaults.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The URL the page must move to, or `undefined` when the current host can carry the session. */
export function canonicalDevHostUrl(pageUrl: string, apiBaseUrl: string, production: boolean): string | undefined {
  if (production) return undefined;

  let page: URL;
  let apiHost: string;
  try {
    page = new URL(pageUrl);
    apiHost = new URL(apiBaseUrl).hostname;
  } catch {
    return undefined;
  }

  if (page.hostname === apiHost) return undefined;
  if (!LOOPBACK_HOSTS.has(page.hostname) || !LOOPBACK_HOSTS.has(apiHost)) return undefined;

  page.hostname = apiHost;
  return page.href;
}
