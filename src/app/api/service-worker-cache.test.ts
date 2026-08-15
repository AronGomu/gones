import '@angular/compiler';
import { HttpHeaders, HttpRequest } from '@angular/common/http';
import { readFileSync } from 'node:fs';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  NGSW_BYPASS_HEADER,
  isCacheablePublicApiRequest,
  serviceWorkerBypassInterceptor
} from './service-worker-cache';

const ORIGIN = 'https://gones.example';

/** Anonymous public reads the installable app is allowed to serve from cache while offline. */
const PUBLIC_GET_URLS = [
  '/api/events',
  '/api/events?from=2026-08-01&to=2026-08-31&page=1&pageSize=20',
  '/api/events/lyon-legacy',
  '/api/events/lyon-legacy.ics',
  '/api/organizations',
  '/api/organizations?page=1',
  '/api/organizations/22222222-2222-2222-2222-222222222222',
  '/api/leagues-archive',
  '/api/leagues-archive?search=lyon',
  '/api/leagues-archive/league-1',
  '/api/leagues-archive/league-1/result',
  '/api/leagues-archive/league-1/tournaments-archive/t-1',
  '/api/leagues-archive/league-1/tournaments-archive/t-1/result',
  '/api/leagues-archive/league-1/players/Alice/statistics',
  '/api/formats',
  '/api/deck-archetypes'
];

/** Private, user-scoped, or fast-changing reads that must never land in a shared cache. */
const PRIVATE_GET_URLS = [
  '/api/auth/refresh',
  '/api/auth/oauth/google/start',
  '/api/users/me',
  '/api/users/me/sessions',
  '/api/users/me/registrations',
  '/api/users/me/email-history',
  '/api/users/me/external-identities',
  '/api/admin/users',
  '/api/admin/audit',
  '/api/admin/organizations',
  '/api/admin/organizations/22222222-2222-2222-2222-222222222222/members',
  '/api/admin/notifications/dead-letters',
  '/api/admin/events/deleted',
  '/api/maintenance/player-names',
  '/api/organizer/events',
  '/api/organizations/22222222-2222-2222-2222-222222222222/members',
  '/api/organizations/22222222-2222-2222-2222-222222222222/notification-settings',
  '/api/organizations/22222222-2222-2222-2222-222222222222/blocked-users',
  '/api/organizations/22222222-2222-2222-2222-222222222222/users/lookup',
  '/api/events/11111111-1111-1111-1111-111111111111/registrations',
  '/api/events/11111111-1111-1111-1111-111111111111/registrations/export',
  '/api/events/11111111-1111-1111-1111-111111111111/registration-capability',
  '/api/events/lyon-legacy/participants',
  '/api/leagues-archive/league-1/export',
  '/api/live-tournaments',
  '/api/live-tournaments/live-1',
  '/api/live-tournaments/live-1/standings',
  '/api/live-tournaments/live-1/document'
];

describe('service worker public read allowlist', () => {
  it('accepts every anonymous public GET, relative or absolute', () => {
    for (const url of PUBLIC_GET_URLS) {
      expect(isCacheablePublicApiRequest({ method: 'GET', url }), url).toBe(true);
      expect(isCacheablePublicApiRequest({ method: 'GET', url: `${ORIGIN}${url}` }), url).toBe(true);
    }
  });

  it('rejects auth, profile, Admin, organizer, and private participant reads', () => {
    for (const url of PRIVATE_GET_URLS) {
      expect(isCacheablePublicApiRequest({ method: 'GET', url }), url).toBe(false);
      expect(isCacheablePublicApiRequest({ method: 'GET', url: `${ORIGIN}${url}` }), url).toBe(false);
    }
  });

  it('rejects Authorization-keyed requests and every mutation on public paths', () => {
    expect(isCacheablePublicApiRequest({ method: 'GET', url: '/api/events', hasAuthorization: true })).toBe(false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(isCacheablePublicApiRequest({ method, url: '/api/events' }), method).toBe(false);
    }
  });

  it('rejects non-API URLs so only the asset groups own the app shell', () => {
    expect(isCacheablePublicApiRequest({ method: 'GET', url: '/events' })).toBe(false);
    expect(isCacheablePublicApiRequest({ method: 'GET', url: '/index.html' })).toBe(false);
  });
});

describe('serviceWorkerBypassInterceptor', () => {
  it('leaves anonymous public GETs cacheable', () => {
    const next = vi.fn().mockReturnValue(of(null));
    serviceWorkerBypassInterceptor(new HttpRequest('GET', '/api/events'), next).subscribe();
    expect(next.mock.calls[0][0].headers.has(NGSW_BYPASS_HEADER)).toBe(false);
  });

  it('bypasses the service worker for Authorization-keyed, private, and mutation requests', () => {
    const authorized = new HttpRequest('GET', '/api/events', { headers: new HttpHeaders({ Authorization: 'Bearer token' }) });
    const cases: HttpRequest<unknown>[] = [
      authorized,
      new HttpRequest('GET', '/api/users/me'),
      new HttpRequest('POST', '/api/events/t-1/registrations', {})
    ];
    for (const request of cases) {
      const next = vi.fn().mockReturnValue(of(null));
      serviceWorkerBypassInterceptor(request, next).subscribe();
      expect(next.mock.calls[0][0].headers.get(NGSW_BYPASS_HEADER), request.url).toBe('true');
    }
  });
});

describe('ngsw-config.json data groups', () => {
  it('caches only allowlisted public reads with bounded freshness and entry count', async () => {
    const manifest = await buildManifest();
    expect(manifest.dataGroups.length).toBeGreaterThan(0);

    for (const group of manifest.dataGroups) {
      expect(group.strategy, group.name).toBe('freshness');
      expect(group.maxSize, group.name).toBeGreaterThan(0);
      expect(group.maxSize, group.name).toBeLessThanOrEqual(200);
      expect(group.maxAge, group.name).toBeGreaterThan(0);
      expect(group.timeoutMs, group.name).toBeGreaterThan(0);
    }

    const matches = (url: string) => manifest.dataGroups.some(group => group.patterns.some(pattern => new RegExp(pattern).test(url)));
    for (const url of PUBLIC_GET_URLS) expect(matches(`${ORIGIN}${url}`), url).toBe(true);
    for (const url of PRIVATE_GET_URLS) expect(matches(`${ORIGIN}${url}`), url).toBe(false);
  });

  it('keeps API URLs out of the navigation fallback so cached HTML never masks an API read', async () => {
    const manifest = await buildManifest();
    const navigationMatches = manifest.navigationUrls.reduce(
      (isMatch: boolean, pattern: { positive: boolean; regex: string }) =>
        pattern.positive ? isMatch || new RegExp(pattern.regex).test('/api/events') : isMatch && !new RegExp(pattern.regex).test('/api/events'),
      false
    );
    expect(navigationMatches).toBe(false);
  });
});

interface ManifestDataGroup {
  name: string;
  patterns: string[];
  strategy: string;
  maxSize: number;
  maxAge: number;
  timeoutMs: number;
}

async function buildManifest(): Promise<{ dataGroups: ManifestDataGroup[]; navigationUrls: { positive: boolean; regex: string }[] }> {
  const { Generator } = await import('@angular/service-worker/config');
  const files = ['/index.html', '/manifest.webmanifest', '/favicon.ico', '/main.js', '/styles.css'];
  const filesystem = {
    list: () => Promise.resolve(files),
    read: () => Promise.resolve(''),
    hash: () => Promise.resolve('0'.repeat(40)),
    write: () => Promise.reject(new Error('read-only filesystem'))
  };
  const config = JSON.parse(readFileSync('ngsw-config.json', 'utf8'));
  const manifest = await new Generator(filesystem, '/').process(config);
  return manifest as unknown as { dataGroups: ManifestDataGroup[]; navigationUrls: { positive: boolean; regex: string }[] };
}
