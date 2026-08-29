import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogs } from '../../i18n/messages';

// No TestBed / zone.js in this repo (see AGENT.md environment facts) — assert on the template
// source string instead of a rendered DOM. Precedent: server-authority-boundary.test.ts.
const source = readFileSync(join(__dirname, 'home-menu.component.ts'), 'utf8');

describe('HomeMenuComponent template', () => {
  it('shows an enabled registrations link when signed in and a disabled card when anonymous', () => {
    expect(source).toContain('@if (auth.profile())');
    expect(source).toContain('routerLink="/registrations" data-cy="menu-registrations-card"');
    expect(source).toContain('aria-disabled="true" data-cy="menu-registrations-card-disabled"');
    expect(source).toContain('home-destination--disabled');
  });

  it('the home menu no longer carries a login card', () => {
    expect(source).not.toContain('menu-login-card');
  });

  it('the home menu carries every required destination', () => {
    expect(source).toContain('menu-running-tournaments-card');
    expect(source).toContain('menu-archive-card');
    expect(source).toContain('menu-global-stats-card');
    expect(source).toContain('menu-calendar-card');
    expect(source).toContain('menu-settings-link');
    expect(source).toContain('menu-about-link');
  });

  it('hides unreleased destinations from User and Organizer roles only', () => {
    expect(source).toContain('@if (showUnreleasedCards())');
    expect(source).toContain("role !== 'User' && role !== 'Organizer'");
  });

  it('assigns the requested Scryfall art crop to every home card', () => {
    for (const artPath of [
      '/assets/card-art/snapcaster-mage.jpg',
      '/assets/card-art/scroll-rack.jpg',
      '/assets/card-art/force-of-will.jpg',
      '/assets/card-art/library-of-alexandria.jpg',
      '/assets/card-art/lightning-bolt.jpg',
      '/assets/card-art/fire-ice.jpg',
      '/assets/card-art/grim-monolith.jpg',
    ]) expect(source).toContain(artPath);
    expect(source).toContain('loading="lazy"');
    expect(source).toContain('home-destination__art--fire-left');
    expect(source).toContain('home-destination__art--fire-right');
  });

  it('Global Stats card links to /global-stats', () => {
    expect(source).toContain('routerLink="/global-stats"');
  });

  it('template order is Calendar, My Reg, Global Stats, Leagues, Live, About, Settings', () => {
    // Extract unique identifiers in appearance order (the @if block cards appear once each)
    const identifiers = [...source.matchAll(/data-cy="(menu-[a-z-]+(?:-card|-link)(?:-title|-desc)?)"/g)]
      .map((m) => m[1])
      .filter((id) => !id.endsWith('-title') && !id.endsWith('-desc'));
    const unique: string[] = [];
    for (const id of identifiers) { if (!unique.includes(id)) unique.push(id); }
    expect(unique).toEqual([
      'menu-calendar-card',
      'menu-registrations-card',
      'menu-global-stats-card',
      'menu-archive-card',
      'menu-running-tournaments-card',
      'menu-about-link',
      'menu-settings-link',
    ]);
  });

  it('Live Tournaments home card uses Live Tournaments copy (not Running)', () => {
    expect(catalogs.en['home.runningTournaments']).toBe('Live Tournaments');
    expect(catalogs.fr['home.runningTournaments']).toBe('Tournois live');
  });

  it('Live Tournaments breadcrumb uses Live Tournaments copy', () => {
    expect(catalogs.en['crumb.runningTournaments']).toBe('Live Tournaments');
    expect(catalogs.fr['crumb.runningTournaments']).toBe('Tournois live');
  });

  it('settings is the last card', () => {
    const identifiers = [...source.matchAll(/data-cy="(menu-[a-z-]+(?:-card|-link))"/g)].map((match) => match[1]);
    const settingsIndex = identifiers.lastIndexOf('menu-settings-link');
    expect(settingsIndex).toBeGreaterThan(-1);
    for (const identifier of identifiers) {
      if (identifier === 'menu-settings-link') continue;
      expect(identifiers.indexOf(identifier)).toBeLessThan(settingsIndex);
    }
  });

  it('home menu calendar card title renders the events label', () => {
    expect(source).toContain('data-cy="menu-calendar-card-title"');
    expect(catalogs.en['home.calendar']).toBe('Events');
  });

  it('localizes the About card without forcing French', () => {
    expect(source).not.toMatch(/routerLink="\/about"[^>]*\slang="fr"/);
    expect(catalogs.en['home.about']).toBe('About');
    expect(catalogs.en['home.aboutDesc']).toBe('Discover the Lyon association, its Legacy tournaments, its team, and the major Fire & Ice events.');
    expect(catalogs.fr['home.about']).toBe('À propos');
  });

  it('about is the second-to-last card', () => {
    const identifiers = [...source.matchAll(/data-cy="(menu-[a-z-]+(?:-card|-link))"/g)].map((match) => match[1]);
    const uniqueOrdered: string[] = [];
    for (const identifier of identifiers) {
      if (!uniqueOrdered.includes(identifier)) uniqueOrdered.push(identifier);
    }
    expect(uniqueOrdered.slice(-2)).toEqual(['menu-about-link', 'menu-settings-link']);
  });
});
