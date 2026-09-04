import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as public-calendar.component.test.ts: no TestBed / zone.js in this repo, so
// `effect()` is stubbed to a no-op (it is what drags `ChangeDetectionScheduler` into I18nService)
// and the component is built with a bare Injector.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { buildBreadcrumbs, Translator } from './app-breadcrumbs';
import { AppComponent } from './app.component';
import { AuthService } from './auth/auth.service';
import { LastVisitedUrlService } from './auth/last-visited-url.service';
import { ArchiveRepository } from './data/archive-repository.service';
import { LiveTournamentRepository } from './data/live-tournament-repository.service';
import { I18nService } from './i18n/i18n.service';
import { translate } from './i18n/messages';
import { DeckArchetypeSettingsService } from './shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from './shared/power-user-settings.service';

describe('global-stats breadcrumb', () => {
  const en: Translator = (key, params) => translate('en', key, params);

  it('labels /global-stats as Global Rankings in EN', async () => {
    const crumbs = await buildBreadcrumbs('/global-stats', en);
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Global Rankings']);
    expect(crumbs[1].link).toBeUndefined();
  });

  it('labels /global-stats as Classement Global in FR', async () => {
    const crumbs = await buildBreadcrumbs('/global-stats');
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Classement Global']);
  });
});

describe('buildBreadcrumbs', () => {
  it('builds the account page breadcrumb with Settings linked back to /settings', async () => {
    const crumbs = await buildBreadcrumbs('/settings/account');
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Paramètres', 'Compte']);
    expect(crumbs[1].link).toEqual(['/settings']);
    expect(crumbs[2].link).toBeUndefined();
  });

  it('builds the plain settings breadcrumb with no link', async () => {
    const crumbs = await buildBreadcrumbs('/settings');
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Paramètres']);
  });

  it('reads every retired archive path as Introuvable, with no crumb of its own', async () => {
    for (const path of ['/leagues', '/leagues/abc', '/leagues-archive', '/leagues-archive/abc', '/leagues-archive/abc/tournaments-archive/def/result']) {
      const crumbs = await buildBreadcrumbs(path);
      expect(crumbs.map((item) => item.label), path).toEqual(['Menu', 'Introuvable']);
    }
  });

  it('no longer reads the retired /leagues segment as the archive', async () => {
    const crumbs = await buildBreadcrumbs('/leagues/abc');
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Introuvable']);
  });
});

describe('three-tier archive breadcrumbs', () => {
  const en: Translator = (key, params) => translate('en', key, params);

  it('labels the archive tournaments tab', async () => {
    const crumbs = await buildBreadcrumbs('/archive/tournaments', en);
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Archive', 'Tournaments']);
    expect(crumbs[1].link).toEqual(['/archive/league-seasons']);
  });

  it('labels an archived tournament and links its tab', async () => {
    const crumbs = await buildBreadcrumbs('/archive/tournaments/t1', en);
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Archive', 'Tournaments', 'Tournament']);
    expect(crumbs[2].link).toEqual(['/archive/tournaments']);
    expect(crumbs[3].link).toBeUndefined();
  });

  it('labels an archived tournament result and links the tournament', async () => {
    const crumbs = await buildBreadcrumbs('/archive/tournaments/t1/result', en);
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Archive', 'Tournaments', 'Tournament', 'Result']);
    expect(crumbs[3].link).toEqual(['/archive/tournaments', 't1']);
  });

  it('labels the metagame view of a result the same way', async () => {
    const crumbs = await buildBreadcrumbs('/archive/tournaments/t1/result/metagames', en);
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Archive', 'Tournaments', 'Tournament', 'Result']);
  });

  it('labels a league season', async () => {
    const crumbs = await buildBreadcrumbs('/archive/league-seasons/s1', en);
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Archive', 'Season']);
  });

  it('renders Not Found on no archive path', async () => {
    for (const path of ['/archive', '/archive/league-seasons', '/archive/league-seasons/s1', '/archive/tournaments', '/archive/tournaments/t1', '/archive/tournaments/t1/result', '/archive/tournaments/t1/result/metagames']) {
      const crumbs = await buildBreadcrumbs(path, en);
      expect(crumbs.map((item) => item.label), path).not.toContain(translate('en', 'nav.notFound'));
    }
  });
});

/**
 * Feedback item 5: `/tournaments/new` rendered a "Not Found" breadcrumb because every Event page
 * fell through to the final `nav.notFound` return. The canonical `/events/*` paths get their own
 * branches here, asserted in both catalogs so a key that only moved in `en` fails.
 */
describe('event breadcrumbs', () => {
  const en: Translator = (key, params) => translate('en', key, params);
  const labels = async (path: string, t?: Translator) => (await buildBreadcrumbs(path, t)).map((item) => item.label);

  it('labels the create page "Create Event" in both catalogs', async () => {
    expect(await labels('/events/new', en)).toEqual(['Menu', 'Events', 'Create Event']);
    expect(await labels('/events/new')).toEqual(['Menu', 'Événements', 'Créer un événement']);
  });

  it('links the Calendar crumb back to /events from an Event page', async () => {
    const crumbs = await buildBreadcrumbs('/events/gones-night', en);
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Events', 'Event']);
    expect(crumbs[1].link).toEqual(['/events']);
    expect(crumbs[2].link).toBeUndefined();
  });

  it('builds the events crumb', async () => {
    const crumbs = await buildBreadcrumbs('/events');
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Événements']);
    expect(crumbs[0].link).toEqual(['/']);
  });

  it('builds the event detail crumb', async () => {
    const crumbs = await buildBreadcrumbs('/events/lyon-legacy', en);
    expect(crumbs).toHaveLength(3);
    expect(crumbs[1].link).toEqual(['/events']);
  });

  it('treats /calendar as not found', async () => {
    const crumbs = await buildBreadcrumbs('/calendar');
    expect(crumbs[crumbs.length - 1].label).toBe('Introuvable');
  });

  it('labels every organizer Event page instead of falling through to Not Found', async () => {
    for (const path of ['/organizer/events', '/organizer/events/abc/edit', '/organizer/events/abc/participants']) {
      expect(await labels(path, en), path).toEqual(['Menu', 'My Events']);
      expect(await labels(path), path).toEqual(['Menu', 'Mes événements']);
    }
  });

  it('roots the admin tree at admin', async () => {
    expect(await labels('/admin', en)).toEqual(['Admin console']);
    expect(await labels('/admin')).toEqual(['Console Admin']);
  });

  it('builds the users crumb', async () => {
    expect(await labels('/admin/users', en)).toEqual(['Admin console', 'Users']);
  });

  it('builds the organizations crumb', async () => {
    expect(await labels('/admin/organizations', en)).toEqual(['Admin console', 'Organizations']);
  });

  it('builds the audit crumb', async () => {
    expect(await labels('/admin/audit', en)).toEqual(['Admin console', 'Audit']);
  });

  it('builds both notification crumbs', async () => {
    expect(await labels('/admin/notifications/history', en)).toEqual(['Admin console', 'Notification history']);
    expect(await labels('/admin/notifications/dead-letters', en)).toEqual(['Admin console', 'Dead letters']);
  });

  it('builds the deleted events crumb', async () => {
    expect(await labels('/admin/events/deleted', en)).toEqual(['Admin console', 'Deleted Events']);
    expect(await labels('/admin/events/deleted')).toEqual(['Console Admin', 'Événements supprimés']);
  });

  it('never shows Menu under admin', async () => {
    for (const path of ['/admin', '/admin/users', '/admin/organizations', '/admin/audit', '/admin/notifications/history', '/admin/notifications/dead-letters', '/admin/events/deleted']) {
      const crumbs = await labels(path, en);
      expect(crumbs, path).not.toContain('Menu');
    }
  });

  it('never falls through to not found under admin', async () => {
    for (const path of ['/admin', '/admin/users', '/admin/organizations', '/admin/audit', '/admin/notifications/history', '/admin/notifications/dead-letters', '/admin/events/deleted']) {
      const crumbs = await labels(path, en);
      expect(crumbs, path).not.toContain('Page not found');
    }
  });

  it('labels the renamed event-requests review page', async () => {
    expect(await labels('/event-requests/token', en)).toEqual(['Menu', 'Event request']);
    expect(await labels('/event-requests/token')).toEqual(['Menu', 'Demande d’événement']);
  });
});

/**
 * `showHeaderImport` lives on AppComponent, which has no zone-free unit harness in this repo
 * (no TestBed, no zone.js). It is driven here the way the router drives it — `updateRouteState(url)`
 * — against a bare `Injector`, so the claim under test is the behaviour and not the source text.
 *
 * This used to be two `toContain` assertions over `app.component.ts`. They constrained nothing: a
 * dead `this.showHeaderImport.set(true)` added after the real line left both of them green while the
 * button appeared on every page, and the negative assertion was whitespace-sensitive, so a
 * `path==='/leagues'` branch slipped straight through. Both were confirmed in T27 before the
 * rewrite.
 *
 * The old comment also claimed a Cypress spec covered this end to end. It never did: the spec that
 * made the claim only asserted the button *exists* on the archive list page and never asserted its
 * absence anywhere else, so nothing there failed if the button leaked onto other routes. That spec
 * was retired with the legacy archive surface; the negative half lives here and only here.
 */
describe('header import visibility', () => {
  async function appAt(url: string): Promise<AppComponent> {
    const injector = Injector.create({ providers: [
      { provide: Router, useValue: { url: '/', events: new Subject<never>(), navigate: vi.fn(async () => true) } },
      { provide: AuthService, useValue: { enabled: false, profile: signal(null) } },
      { provide: LastVisitedUrlService, useValue: { record: vi.fn() } },
      { provide: ArchiveRepository, useValue: { getTournament: vi.fn(async () => null) } },
      { provide: LiveTournamentRepository, useValue: { get: vi.fn(async () => null) } },
      { provide: MatDialog, useValue: { open: vi.fn() } },
      { provide: PowerUserSettingsService, useValue: { enabled: signal(true), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
      DeckArchetypeSettingsService,
      I18nService
    ] });

    const component = runInInjectionContext(injector, () => new AppComponent());
    await (component as unknown as { updateRouteState(url: string): Promise<void> }).updateRouteState(url);
    return component;
  }

  async function showHeaderImportAt(url: string): Promise<boolean> {
    const component = await appAt(url);
    return component.showHeaderImport();
  }

  it('shows the header import on the archive list route', async () => {
    expect(await showHeaderImportAt('/archive/league-seasons')).toBe(true);
    expect(await showHeaderImportAt('/archive/league-seasons?imported=1')).toBe(true);
  });

  it('hides the header import on every other route, every retired one included', async () => {
    for (const url of ['/', '/leagues', '/leagues/abc', '/leagues-archive', '/leagues-archive/abc', '/archive/tournaments', '/archive/league-seasons/abc', '/settings', '/calendar']) {
      expect(await showHeaderImportAt(url), url).toBe(false);
    }
  });

  it('detects About exactly while ignoring query and hash', async () => {
    expect((await appAt('/about')).isAboutPage()).toBe(true);
    expect((await appAt('/about?from=home#staff')).isAboutPage()).toBe(true);
    expect((await appAt('/about-us')).isAboutPage()).toBe(false);
    expect((await appAt('/events')).isAboutPage()).toBe(false);
  });
});

describe('breadcrumb-root detection', () => {
  it('menu is a breadcrumb root', async () => {
    const crumbs = await buildBreadcrumbs('/');
    expect(crumbs).toHaveLength(1);
  });

  it('admin home is a breadcrumb root', async () => {
    const crumbs = await buildBreadcrumbs('/admin');
    expect(crumbs).toHaveLength(1);
  });

  it('every other listed path is not a root', async () => {
    const paths = [
      '/about',
      '/events',
      '/settings',
      '/registrations',
      '/global-stats',
      '/players/x',
      '/archive/league-seasons',
      '/live-tournaments',
      '/admin/users',
      '/admin/organizations',
      '/admin/audit',
      '/login'
    ];
    for (const path of paths) {
      const crumbs = await buildBreadcrumbs(path);
      expect(crumbs.length, `${path} should not be a breadcrumb root`).toBeGreaterThanOrEqual(2);
    }
  });
});
