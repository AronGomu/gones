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
import { buildBreadcrumbs } from './app-breadcrumbs';
import { AppComponent } from './app.component';
import { AuthService } from './auth/auth.service';
import { LastVisitedUrlService } from './auth/last-visited-url.service';
import { LeagueArchiveRepository } from './data/league-archive-repository.service';
import { LiveTournamentRepository } from './data/live-tournament-repository.service';
import { I18nService } from './i18n/i18n.service';
import { DeckArchetypeSettingsService } from './shared/deck-archetype-settings.service';

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

  it('labels the archive list breadcrumb "Ligues (archive)"', async () => {
    const crumbs = await buildBreadcrumbs('/leagues-archive');
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Ligues (archive)']);
  });

  it('links every archive crumb into the renamed segments', async () => {
    const crumbs = await buildBreadcrumbs('/leagues-archive/abc/tournaments-archive/def/result');
    expect(crumbs[1].label).toBe('Ligues (archive)');
    expect(crumbs[1].link).toEqual(['/leagues-archive']);
    expect(crumbs[2].link).toEqual(['/leagues-archive', 'abc']);
    expect(crumbs[3].link).toEqual(['/leagues-archive', 'abc', 'tournaments-archive', 'def']);
  });

  it('no longer reads the retired /leagues segment as the archive', async () => {
    const crumbs = await buildBreadcrumbs('/leagues/abc');
    expect(crumbs.map((item) => item.label)).toEqual(['Menu', 'Introuvable']);
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
 * The old comment also claimed `cypress/e2e/league-server.cy.js` covered this end to end. It does
 * not: `league-server.cy.js:199` asserts the button *exists* on `/leagues-archive` and never asserts
 * its absence anywhere else, so nothing there fails if the button leaks onto other routes. The
 * negative half of the claim lives here and only here.
 */
describe('header import visibility', () => {
  async function showHeaderImportAt(url: string): Promise<boolean> {
    const injector = Injector.create({ providers: [
      { provide: Router, useValue: { url: '/', events: new Subject<never>(), navigate: vi.fn(async () => true) } },
      { provide: AuthService, useValue: { enabled: false, profile: signal(null) } },
      { provide: LastVisitedUrlService, useValue: { record: vi.fn() } },
      { provide: LeagueArchiveRepository, useValue: { getLeague: vi.fn(async () => null) } },
      { provide: LiveTournamentRepository, useValue: { get: vi.fn(async () => null) } },
      { provide: MatDialog, useValue: { open: vi.fn() } },
      DeckArchetypeSettingsService,
      I18nService
    ] });

    const component = runInInjectionContext(injector, () => new AppComponent());
    await (component as unknown as { updateRouteState(url: string): Promise<void> }).updateRouteState(url);
    return component.showHeaderImport();
  }

  it('shows the header import on the archive list route', async () => {
    expect(await showHeaderImportAt('/leagues-archive')).toBe(true);
    expect(await showHeaderImportAt('/leagues-archive?imported=1')).toBe(true);
  });

  it('hides the header import on every other route, the retired /leagues included', async () => {
    for (const url of ['/', '/leagues', '/leagues/abc', '/leagues-archive/abc', '/leagues-archive/abc/tournaments-archive/def', '/settings', '/calendar']) {
      expect(await showHeaderImportAt(url), url).toBe(false);
    }
  });
});
