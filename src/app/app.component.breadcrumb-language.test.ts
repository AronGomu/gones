import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NEVER } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatDialog } from '@angular/material/dialog';

// Capture effect callbacks without auto-running them. The StaticInjector created by
// Injector.create() has no EffectScheduler, so effects are invoked manually via runEffects()
// to simulate Angular's reactive scheduling after a language-signal change.
const { capturedEffects } = vi.hoisted(() => {
  const capturedEffects: Array<() => void> = [];
  return { capturedEffects };
});

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return {
    ...actual,
    effect: (fn: () => void) => {
      capturedEffects.push(fn);
      return { destroy: () => {} };
    }
  };
});

import { AppComponent } from './app.component';
import { AuthService } from './auth/auth.service';
import { LastVisitedUrlService } from './auth/last-visited-url.service';
import { ArchiveRepository } from './data/archive-repository.service';
import { LiveTournamentRepository } from './data/live-tournament-repository.service';
import { I18nService } from './i18n/i18n.service';
import { DeckArchetypeSettingsService } from './shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from './shared/power-user-settings.service';

function setup(url = '/settings') {
  localStorage.setItem('gones.settings', JSON.stringify({ language: 'en', deckArchetypes: [] }));
  localStorage.setItem('gones.settings.language', 'en');

  const injector = Injector.create({
    providers: [
      { provide: Router, useValue: { url, navigate: vi.fn().mockResolvedValue(true), events: NEVER } },
      { provide: AuthService, useValue: { enabled: false, profile: signal(null) } },
      { provide: LastVisitedUrlService, useValue: { record: vi.fn() } },
      { provide: ArchiveRepository, useValue: { getTournament: vi.fn().mockResolvedValue(null) } },
      { provide: LiveTournamentRepository, useValue: { get: vi.fn().mockResolvedValue(null) } },
      { provide: PowerUserSettingsService, useValue: { enabled: signal(false) } },
      { provide: MatDialog, useValue: {} },
      DeckArchetypeSettingsService,
      I18nService,
    ],
  });
  const component = runInInjectionContext(injector, () => new AppComponent());
  const settings = injector.get(DeckArchetypeSettingsService);
  return { component, settings };
}

async function runEffects(): Promise<void> {
  capturedEffects.forEach((fn) => fn());
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('breadcrumb retranslates on language change', () => {
  beforeEach(() => {
    capturedEffects.length = 0;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('retranslates the breadcrumb when the language changes', async () => {
    const { component, settings } = setup('/settings');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(component.breadcrumbs().map((c) => c.label)).toContain('Settings');

    await settings.setLanguage('fr');
    await runEffects();

    expect(component.breadcrumbs().map((c) => c.label)).toContain('Paramètres');
  });

  it('keeps the breadcrumb for the current url, not the previous one', async () => {
    const { component, settings } = setup('/about');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    await settings.setLanguage('fr');
    await runEffects();

    const labels = component.breadcrumbs().map((c) => c.label);
    expect(labels[labels.length - 1]).toBe('À propos');
  });

  it('lets the newest rebuild win when two overlap', async () => {
    const { component, settings } = setup('/settings');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(component.breadcrumbs().map((c) => c.label)).toContain('Settings');

    // Two rebuilds started back to back without awaiting the first. `breadcrumbs().length > 0` holds by
    // construction here — nothing ever writes an empty array — so it said nothing about which of the
    // two won. The last request set `en`, and `updateRouteState`'s request guard is what makes the
    // English labels the ones that survive.
    await settings.setLanguage('fr');
    capturedEffects.forEach((fn) => fn());
    await settings.setLanguage('en');
    capturedEffects.forEach((fn) => fn());

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const labels = component.breadcrumbs().map((c) => c.label);
    expect(labels).toContain('Settings');
    expect(labels).not.toContain('Paramètres');
  });
});
