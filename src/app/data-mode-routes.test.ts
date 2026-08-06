import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { buildRoutes, calendarRoutes } from './app.routes';

const legacyFeatures = { authV1: false, adminV1: false };
const serverFeatures = { authV1: true, adminV1: true };

const paths = (mode: 'legacy-browser' | 'server', features: { authV1: boolean; adminV1: boolean }): string[] =>
  buildRoutes(mode, features).map((route) => route.path ?? '');

describe('calendar routes per data mode', () => {
  it('keeps the legacy browser Calendar and Event pages in legacy mode', () => {
    expect(calendarRoutes('legacy-browser').map((route) => [route.path, Boolean(route.redirectTo)])).toEqual([
      ['calendar', false],
      ['events/:slug', false]
    ]);
  });

  it('serves the server Calendar V1 pages plus the legacy detail redirect in server mode', () => {
    expect(calendarRoutes('server').map((route) => [route.path, Boolean(route.redirectTo)])).toEqual([
      ['calendar', false],
      ['calendar/tournaments/:slug', false],
      ['events/:slug', true]
    ]);
  });
});

describe('route exposure per data mode', () => {
  it('exposes no auth, registration, organizer or admin route in legacy mode', () => {
    const legacyPaths = paths('legacy-browser', legacyFeatures);

    for (const path of [
      'login',
      'register',
      'profile',
      'registrations',
      'organizer/tournaments',
      'organizer/tournaments/new',
      'organizer/organizations',
      'admin',
      'admin/users',
      'admin/tournaments/deleted'
    ]) {
      expect(legacyPaths).not.toContain(path);
    }
  });

  it('keeps the frozen legacy surface: browsing, League editing, Settings and the cutover export', () => {
    const legacyPaths = paths('legacy-browser', legacyFeatures);

    for (const path of ['', 'about', 'calendar', 'events/:slug', 'leagues', 'live-tournaments', 'settings']) {
      expect(legacyPaths).toContain(path);
    }
  });

  it('exposes the auth, registration, organizer and admin surface in server mode', () => {
    const serverPaths = paths('server', serverFeatures);

    for (const path of ['login', 'profile', 'registrations', 'organizer/tournaments', 'admin', 'admin/tournaments/deleted']) {
      expect(serverPaths).toContain(path);
    }
    // The legacy Event detail path survives only as a redirect into the server Calendar.
    expect(buildRoutes('server', serverFeatures).find((route) => route.path === 'events/:slug')?.redirectTo).toBeTruthy();
  });

  it('never enables an auth or admin route from a legacy build even if a flag leaks in', () => {
    const leaked = paths('legacy-browser', serverFeatures);

    expect(leaked).not.toContain('login');
    expect(leaked).not.toContain('admin');
    expect(leaked).not.toContain('registrations');
  });
});
