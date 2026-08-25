import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `effect()` requires ChangeDetectionScheduler which StaticInjector.create() does not provide.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NEVER } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { AuthService } from './auth/auth.service';
import { LastVisitedUrlService } from './auth/last-visited-url.service';
import { ArchiveRepository } from './data/archive-repository.service';
import { LiveTournamentRepository } from './data/live-tournament-repository.service';
import { I18nService } from './i18n/i18n.service';
import { DeckArchetypeSettingsService } from './shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from './shared/power-user-settings.service';
import { MatDialog } from '@angular/material/dialog';

// No TestBed / zone.js in this repo (see AGENT.md environment facts) — assert on the template
// source string instead of a rendered DOM. Precedent: home-menu.component.test.ts.
const source = readFileSync(join(__dirname, 'app.component.ts'), 'utf8');

describe('AppComponent toolbar auth entry', () => {
  it('the toolbar offers a sign-in action when signed out', () => {
    const line = source.split('\n').find((l) => l.includes('data-cy="toolbar-sign-in-link"'));
    expect(line).toBeDefined();
    expect(line).toContain('routerLink="/login"');
  });

  it('the sign-in action lives in the same slot as logout', () => {
    const start = source.indexOf('data-cy="auth-toolbar-actions"');
    expect(start).toBeGreaterThan(-1);
    const ifMatch = source.slice(start).match(/@if \(auth\.profile\(\); as profile\) \{[\s\S]*?\n\s*\} @else \{[\s\S]*?\n\s*\}/);
    expect(ifMatch).not.toBeNull();
    const authBlockEnd = start + ifMatch!.index! + ifMatch![0].length;
    const signInIndex = source.indexOf('data-cy="toolbar-sign-in-link"');
    expect(signInIndex).toBeGreaterThan(start);
    expect(signInIndex).toBeLessThan(authBlockEnd);
  });

  it('the sign-in action is only rendered when there is no profile', () => {
    const start = source.indexOf('@if (auth.profile(); as profile) {');
    expect(start).toBeGreaterThan(-1);
    const elseIndex = source.indexOf('} @else {', start);
    expect(elseIndex).toBeGreaterThan(start);
    const signInIndex = source.indexOf('data-cy="toolbar-sign-in-link"');
    expect(signInIndex).toBeGreaterThan(elseIndex);
  });

  it('the auth block is the last thing in the toolbar', () => {
    const authIndex = source.indexOf('data-cy="auth-toolbar-actions"');
    expect(authIndex).toBeGreaterThan(-1);
    // `app-league-header-actions` was the retired League detail page's block; T19 removed it with the
    // route that rendered it, so only the four surviving blocks are ordered against the auth block.
    for (const marker of [
      'app-live-tournament-header-actions',
      'app-leagues-header-actions',
      'app-tournament-header-actions',
      'app-settings-header-actions'
    ]) {
      const markerIndex = source.indexOf(`data-cy="${marker}"`);
      expect(markerIndex).toBeGreaterThan(-1);
      expect(authIndex).toBeGreaterThan(markerIndex);
    }
  });

  it('nothing but the toolbar close follows the auth block', () => {
    const authIndex = source.indexOf('data-cy="auth-toolbar-actions"');
    expect(authIndex).toBeGreaterThan(-1);
    const toolbarCloseIndex = source.indexOf('</mat-toolbar>', authIndex);
    expect(toolbarCloseIndex).toBeGreaterThan(authIndex);
    const tail = source.slice(authIndex, toolbarCloseIndex);
    expect(tail).not.toMatch(/data-cy="app-/);
  });
});

function setupApp(initialUrl = '/') {
  const navigate = vi.fn().mockResolvedValue(true);
  const logout = vi.fn().mockResolvedValue(undefined);
  const injector = Injector.create({ providers: [
    { provide: I18nService, useValue: { t: (k: string) => k } },
    { provide: Router, useValue: { url: initialUrl, navigate, events: NEVER } },
    { provide: AuthService, useValue: { logout, profile: signal(null), enabled: false } },
    { provide: LastVisitedUrlService, useValue: { record: vi.fn(), last: () => '' } },
    { provide: ArchiveRepository, useValue: { getTournament: vi.fn().mockResolvedValue(null) } },
    { provide: LiveTournamentRepository, useValue: { get: vi.fn().mockResolvedValue(null) } },
    { provide: DeckArchetypeSettingsService, useValue: {} },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(false) } },
    { provide: MatDialog, useValue: {} },
  ] });
  const component = runInInjectionContext(injector, () => new AppComponent());
  return { component, navigate, logout };
}

describe('AppComponent logout and showSignInLink', () => {
  it('logout carries the current url as returnUrl', async () => {
    const { component, navigate, logout } = setupApp();
    component.currentUrl.set('/registrations');
    await component.logout();
    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/registrations' } });
  });

  it('logout preserves query parameters', async () => {
    const { component, navigate } = setupApp();
    component.currentUrl.set('/events?view=list&q=lyon');
    await component.logout();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/events?view=list&q=lyon' } });
  });

  it('hides the sign-in link on auth pages', () => {
    const { component } = setupApp();
    for (const path of ['/login', '/register', '/auth/complete-profile', '/verify-email', '/forgot-password', '/reset-password']) {
      component.currentUrl.set(path);
      expect(component.showSignInLink(), `expected false for ${path}`).toBe(false);
    }
  });

  it('shows the sign-in link elsewhere', () => {
    const { component } = setupApp();
    component.currentUrl.set('/events');
    expect(component.showSignInLink()).toBe(true);
  });
});
