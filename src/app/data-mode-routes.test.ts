import '@angular/compiler';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRoutes, eventRoutes } from './app.routes';
import { organizerGuard, userGuard, verifiedEmailGuard } from './auth/auth.guards';
import { firstVisitHomeGuard, markVisitedGuard } from './shared/first-visit.guard';
import { eventCreatePowerGuard, powerUserGuard } from './shared/power-user.guard';

const noCapabilities = { authV1: false, adminV1: false };
const allCapabilities = { authV1: true, adminV1: true };

const paths = (features: { authV1: boolean; adminV1: boolean }): string[] =>
  buildRoutes(features).map((route) => route.path ?? '');

const routeFor = (path: string, features = noCapabilities) => buildRoutes(features).find((route) => route.path === path);

/** Invokes a parameter-preserving functional `redirectTo` the way the Router does. */
const redirectWith = (path: string, params: Record<string, string>, features = noCapabilities): string => {
  const redirect = routeFor(path, features)?.redirectTo;
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

describe('event routes', () => {
  it('exposes the events browse route', () => {
    expect(buildRoutes({ authV1: true, adminV1: true }).some((route) => route.path === 'events')).toBe(true);
  });

  it('no longer exposes any calendar path', () => {
    const allPaths = buildRoutes({ authV1: true, adminV1: true }).map((route) => route.path ?? '');
    expect(allPaths.some((path) => path.startsWith('calendar'))).toBe(false);
  });

  it('matches events before events/:slug', () => {
    const routes = buildRoutes({ authV1: true, adminV1: true });
    const eventsIndex = routes.findIndex((route) => route.path === 'events');
    const slugIndex = routes.findIndex((route) => route.path === 'events/:slug');
    expect(eventsIndex).toBeGreaterThan(-1);
    expect(eventsIndex).toBeLessThan(slugIndex);
  });

  it('exposes no browser-store Calendar or Event page', () => {
    const loaded = eventRoutes().map((route) => String(route.loadComponent ?? ''));

    for (const retired of ['features/menu/calendar.component', 'features/events/event-detail.component']) {
      expect(loaded.some((source) => source.includes(retired))).toBe(false);
    }
  });
});

describe('route exposure per capability flag', () => {
  it('always serves the public browsing, archive, Live and Settings surface', () => {
    for (const path of ['', 'about', 'events', 'events/:slug', 'global-stats', 'archive/league-seasons', 'live-tournaments', 'live-tournaments/:liveTournamentId', 'settings']) {
      expect(paths(noCapabilities)).toContain(path);
    }
  });

  it('guards only the Live create route with the Power User gate', () => {
    expect(routeFor('live-tournaments/new')?.canActivate).toEqual([powerUserGuard]);
    expect(routeFor('live-tournaments')?.canActivate).toBeUndefined();
    expect(routeFor('live-tournaments/:liveTournamentId')?.canActivate).toBeUndefined();
  });

  it('exposes the auth, registration, organizer and admin surface when the flags are on', () => {
    const enabled = paths(allCapabilities);

    for (const path of ['login', 'profile', 'registrations', 'organizer/events', 'admin', 'admin/events/deleted']) {
      expect(enabled).toContain(path);
    }
  });

  it('has no organizations list route', () => {
    const enabled = paths(allCapabilities);

    expect(enabled).not.toContain('organizations');
    expect(enabled).toContain('organizations/:id');
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
    expect(accountRoute?.canActivate ?? [], 'settings/account should be guarded by userGuard').toContain(userGuard);
  });

  it('exposes no auth, registration, organizer or admin route while the flags are off', () => {
    const disabled = paths(noCapabilities);

    for (const path of [
      'login',
      'register',
      'profile',
      'registrations',
      'organizer/events',
      'events/new',
      'organizer/organizations',
      'admin',
      'admin/users',
      'admin/events/deleted'
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

  it('exposes events/new when auth is on', () => {
    expect(paths(allCapabilities)).toContain('events/new');
  });

  it('guards events/new with user, verified-email and Admin-aware Power User gates in order', () => {
    const route = buildRoutes(allCapabilities).find((route) => route.path === 'events/new');
    expect(route).toBeDefined();
    expect(route!.canActivate).toEqual([userGuard, verifiedEmailGuard, eventCreatePowerGuard]);
  });

  it('matches events/new before the events/:slug detail route', () => {
    const routes = buildRoutes(allCapabilities).map((route) => route.path);
    expect(routes.indexOf('events/new')).toBeGreaterThan(-1);
    expect(routes.indexOf('events/new')).toBeLessThan(routes.indexOf('events/:slug'));
  });

  it('matches events/new before events/:slug', () => {
    const routes = buildRoutes(allCapabilities).map((route) => route.path);
    expect(routes.indexOf('events/new')).toBeLessThan(routes.indexOf('events/:slug'));
  });

  it('redirects both retired create paths to events/new', () => {
    for (const path of ['tournaments/new', 'organizer/tournaments/new']) {
      const route = buildRoutes(allCapabilities).find((route) => route.path === path);
      expect(route?.redirectTo, path).toBe('events/new');
      expect(route?.pathMatch, path).toBe('full');
    }
  });

  it('redirects the retired organizer paths, parameters preserved', () => {
    const listRoute = buildRoutes(allCapabilities).find((route) => route.path === 'organizer/tournaments');
    expect(listRoute?.redirectTo).toBe('organizer/events');
    expect(listRoute?.pathMatch).toBe('full');
    expect(redirectWith('organizer/tournaments/:id/edit', { id: 'abc' }, allCapabilities)).toBe('/organizer/events/abc/edit');
    expect(redirectWith('organizer/tournaments/:id/participants', { id: 'abc' }, allCapabilities)).toBe('/organizer/events/abc/participants');
  });

  it('redirects the retired admin deleted-events path', () => {
    const route = buildRoutes(allCapabilities).find((route) => route.path === 'admin/tournaments/deleted');
    expect(route?.redirectTo).toBe('admin/events/deleted');
    expect(route?.pathMatch).toBe('full');
  });

  it('keeps organizer edit behind organizer, verified-email and Power User gates in order', () => {
    const route = buildRoutes(allCapabilities).find((route) => route.path === 'organizer/events/:id/edit');
    expect(route?.canActivate).toEqual([organizerGuard, verifiedEmailGuard, powerUserGuard]);
  });

  it('redirects the home route to /about on the first visit', () => {
    const homeRoute = buildRoutes(noCapabilities).find((route) => route.path === '');
    expect(homeRoute?.canActivate ?? [], "'' should be guarded by firstVisitHomeGuard").toContain(firstVisitHomeGuard);
  });

  it('marks the visit when landing on /about', () => {
    const aboutRoute = buildRoutes(noCapabilities).find((route) => route.path === 'about');
    expect(aboutRoute?.canActivate ?? [], "about should be guarded by markVisitedGuard").toContain(markVisitedGuard);
  });

  it('leaves deep links like /events untouched by the first-visit guard', () => {
    const eventsRoute = buildRoutes(noCapabilities).find((route) => route.path === 'events');
    expect(eventsRoute?.canActivate).toBeUndefined();
  });

  it('serves the three-tier archive routes', () => {
    for (const path of [
      'archive',
      'archive/league-seasons',
      'archive/league-seasons/:seasonId',
      'archive/tournaments',
      'archive/tournaments/:tournamentId',
      'archive/tournaments/:tournamentId/result',
      'archive/tournaments/:tournamentId/result/metagames'
    ]) {
      expect(paths(noCapabilities), path).toContain(path);
    }
  });

  /**
   * ADR 0022 kept parameter-preserving redirects for the retired archive paths because "bookmarks and
   * old links are a real user's problem". Gones is unreleased with zero users, so T19 reversed that
   * clause: every retired path falls through to the `**` 404 route with no alias and no redirect.
   */
  it('registers no retired archive route and no redirect onto one', () => {
    const registered = paths(noCapabilities);
    for (const retired of [
      'leagues',
      'leagues/:leagueId',
      'leagues/:leagueId/tournaments/:tournamentId',
      'leagues/:leagueId/tournaments/:tournamentId/result',
      'leagues/:leagueId/tournaments/:tournamentId/result/metagames',
      'leagues-archive',
      'leagues-archive/:leagueId',
      'leagues-archive/:leagueId/tournaments-archive/:tournamentId',
      'leagues-archive/:leagueId/tournaments-archive/:tournamentId/result',
      'leagues-archive/:leagueId/tournaments-archive/:tournamentId/result/metagames'
    ]) {
      expect(registered, retired).not.toContain(retired);
    }
    expect(buildRoutes(noCapabilities).filter((route) => route.redirectTo === 'leagues-archive')).toEqual([]);
  });

  it('serves no bare leagues route target anywhere in the app source', () => {
    const offenders = appSourceFiles()
      .filter((file) => /routerLink="\/leagues"|routerLink="\/leagues\/|'\/leagues'|"\/leagues"|\['\/leagues',/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(__dirname.length + 1));

    expect(offenders).toEqual([]);
  });

  it('exposes the event request review route without auth capability', () => {
    expect(paths(noCapabilities)).toContain('event-requests/:token');
  });

  it('leaves the event request review route unguarded', () => {
    const route = buildRoutes(noCapabilities).find((route) => route.path === 'event-requests/:token');
    expect(route?.canActivate).toBeUndefined();
  });

  it('redirects the retired tournament-requests path with its token', () => {
    expect(redirectWith('tournament-requests/:token', { token: 'tok en/1' })).toBe('/event-requests/tok%20en%2F1');
    expect(routeFor('tournament-requests/:token')?.pathMatch).toBe('full');
  });
});
