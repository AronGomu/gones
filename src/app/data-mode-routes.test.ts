import '@angular/compiler';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRoutes, calendarRoutes } from './app.routes';
import { organizerGuard, userGuard, verifiedEmailGuard } from './auth/auth.guards';
import { firstVisitHomeGuard, markVisitedGuard } from './shared/first-visit.guard';

const noCapabilities = { authV1: false, adminV1: false };
const allCapabilities = { authV1: true, adminV1: true };

const paths = (features: { authV1: boolean; adminV1: boolean }): string[] =>
  buildRoutes(features).map((route) => route.path ?? '');

const routeFor = (path: string) => buildRoutes(noCapabilities).find((route) => route.path === path);

/** Invokes a parameter-preserving functional `redirectTo` the way the Router does. */
const redirectWith = (path: string, params: Record<string, string>): string => {
  const redirect = routeFor(path)?.redirectTo;
  if (typeof redirect !== 'function') throw new Error(`route ${path} has no functional redirectTo`);
  return String((redirect as (input: { params: Record<string, string> }) => string)({ params }));
};

/** Application sources only. Tests are excluded: they name the retired path to prove it is gone. */
function appSourceFiles(directory = join(__dirname)): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : appSourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('calendar routes', () => {
  it('serves the Calendar V1 pages plus the retired Event detail redirect', () => {
    expect(calendarRoutes().map((route) => [route.path, Boolean(route.redirectTo)])).toEqual([
      ['calendar', false],
      ['calendar/tournaments/:slug', false],
      ['events/:slug', true]
    ]);
  });

  it('exposes no browser-store Calendar or Event page', () => {
    const loaded = calendarRoutes().map((route) => String(route.loadComponent ?? ''));

    for (const retired of ['features/menu/calendar.component', 'features/events/event-detail.component']) {
      expect(loaded.some((source) => source.includes(retired))).toBe(false);
    }
  });
});

describe('route exposure per capability flag', () => {
  it('always serves the public browsing, League archive, Live and Settings surface', () => {
    for (const path of ['', 'about', 'calendar', 'calendar/tournaments/:slug', 'leagues-archive', 'live-tournaments', 'settings']) {
      expect(paths(noCapabilities)).toContain(path);
    }
  });

  it('exposes the auth, registration, organizer and admin surface when the flags are on', () => {
    const enabled = paths(allCapabilities);

    for (const path of ['login', 'profile', 'registrations', 'organizer/tournaments', 'admin', 'admin/tournaments/deleted']) {
      expect(enabled).toContain(path);
    }
    // The retired Event detail path survives only as a redirect into the Calendar.
    expect(buildRoutes(allCapabilities).find((route) => route.path === 'events/:slug')?.redirectTo).toBeTruthy();
  });

  it('serves no sessions page, the feature was removed', () => {
    expect(paths(allCapabilities)).not.toContain('profile/sessions');
  });

  it('exposes settings/account when auth is on', () => {
    expect(paths(allCapabilities)).toContain('settings/account');
  });

  it('hides settings/account when auth is off', () => {
    expect(paths(noCapabilities)).not.toContain('settings/account');
  });

  it('keeps settings anonymous', () => {
    const settingsRoute = buildRoutes(noCapabilities).find((route) => route.path === 'settings');
    expect(settingsRoute?.canActivate).toBeUndefined();
  });

  it('redirects profile to the account settings route', () => {
    const profileRoute = buildRoutes(allCapabilities).find((route) => route.path === 'profile');
    expect(profileRoute?.redirectTo).toBe('settings/account');
    expect(profileRoute?.pathMatch).toBe('full');
  });

  it('guards the account route', () => {
    const accountRoute = buildRoutes(allCapabilities).find((route) => route.path === 'settings/account');
    expect(accountRoute?.canActivate).toContain(userGuard);
  });

  it('exposes no auth, registration, organizer or admin route while the flags are off', () => {
    const disabled = paths(noCapabilities);

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
      expect(disabled).not.toContain(path);
    }
  });

  it('gates the admin surface on adminV1 alone, not on being signed in', () => {
    const authOnly = paths({ authV1: true, adminV1: false });

    expect(authOnly).toContain('login');
    expect(authOnly).not.toContain('admin');
    expect(authOnly).not.toContain('admin/users');
  });

  it('exposes tournaments/new when auth is on', () => {
    expect(paths(allCapabilities)).toContain('tournaments/new');
  });

  it('guards tournaments/new with userGuard and verifiedEmailGuard', () => {
    const route = buildRoutes(allCapabilities).find((route) => route.path === 'tournaments/new');
    expect(route).toBeDefined();
    expect(route!.canActivate).toContain(userGuard);
    expect(route!.canActivate).toContain(verifiedEmailGuard);
  });

  it('redirects the organizer create path to tournaments/new', () => {
    const route = buildRoutes(allCapabilities).find((route) => route.path === 'organizer/tournaments/new');
    expect(route?.redirectTo).toBe('tournaments/new');
  });

  it('keeps the organizer edit path guarded by organizerGuard', () => {
    const route = buildRoutes(allCapabilities).find((route) => route.path === 'organizer/tournaments/:id/edit');
    expect(route?.canActivate).toContain(organizerGuard);
  });

  it('redirects the home route to /about on the first visit', () => {
    const homeRoute = buildRoutes(noCapabilities).find((route) => route.path === '');
    expect(homeRoute?.canActivate).toContain(firstVisitHomeGuard);
  });

  it('marks the visit when landing on /about', () => {
    const aboutRoute = buildRoutes(noCapabilities).find((route) => route.path === 'about');
    expect(aboutRoute?.canActivate).toContain(markVisitedGuard);
  });

  it('leaves deep links like /calendar untouched by the first-visit guard', () => {
    const calendarRoute = buildRoutes(noCapabilities).find((route) => route.path === 'calendar');
    expect(calendarRoute?.canActivate).toBeUndefined();
  });

  it('serves the archive list route', () => {
    expect(paths(noCapabilities)).toContain('leagues-archive');
  });

  it('serves the archive detail route', () => {
    expect(paths(noCapabilities)).toContain('leagues-archive/:leagueId');
  });

  it('serves the archive tournament routes', () => {
    for (const path of [
      'leagues-archive/:leagueId/tournaments-archive/:tournamentId',
      'leagues-archive/:leagueId/tournaments-archive/:tournamentId/result',
      'leagues-archive/:leagueId/tournaments-archive/:tournamentId/result/metagames'
    ]) {
      expect(paths(noCapabilities)).toContain(path);
    }
  });

  it('redirects the old list path', () => {
    expect(routeFor('leagues')?.redirectTo).toBe('leagues-archive');
    expect(routeFor('leagues')?.pathMatch).toBe('full');
  });

  it('redirects the old detail path with its parameter', () => {
    expect(redirectWith('leagues/:leagueId', { leagueId: 'abc' })).toBe('/leagues-archive/abc');
  });

  it('redirects the old tournament path with both parameters', () => {
    expect(redirectWith('leagues/:leagueId/tournaments/:tournamentId', { leagueId: 'a', tournamentId: 'b' }))
      .toBe('/leagues-archive/a/tournaments-archive/b');
    expect(redirectWith('leagues/:leagueId/tournaments/:tournamentId/result', { leagueId: 'a', tournamentId: 'b' }))
      .toBe('/leagues-archive/a/tournaments-archive/b/result');
    expect(redirectWith('leagues/:leagueId/tournaments/:tournamentId/result/metagames', { leagueId: 'a', tournamentId: 'b' }))
      .toBe('/leagues-archive/a/tournaments-archive/b/result/metagames');
  });

  it('serves no bare leagues route target anywhere in the app source', () => {
    const offenders = appSourceFiles()
      .filter((file) => /routerLink="\/leagues"|routerLink="\/leagues\/|'\/leagues'|"\/leagues"|\['\/leagues',/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(__dirname.length + 1));

    expect(offenders).toEqual([]);
  });

  it('exposes the tournament request review route without auth capability', () => {
    expect(paths(noCapabilities)).toContain('tournament-requests/:token');
  });

  it('leaves the tournament request review route unguarded', () => {
    const route = buildRoutes(noCapabilities).find((route) => route.path === 'tournament-requests/:token');
    expect(route?.canActivate).toBeUndefined();
  });
});
