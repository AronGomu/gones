import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { I18nService } from '../i18n/i18n.service';
import { SyncBarComponent } from './sync-bar.component';

/**
 * No TestBed / zone.js in this repo, so the bar is proved in two halves: the identifiers and the
 * bindings are read off the template it is compiled from, and the state a caller can observe is read
 * off a bare instance. The identifier assertions evaluate the template's own `cyPrefix() + '…'`
 * expressions rather than restating them, so a renamed suffix fails here before it fails in Cypress.
 */

const source = readFileSync(join(__dirname, 'sync-bar.component.ts'), 'utf8');

function testIds(prefix: string): string[] {
  return [...source.matchAll(/\[attr\.data-cy\]="cyPrefix\(\) \+ '([^']+)'"/g)].map(([, suffix]) => prefix + suffix);
}

function tagAround(marker: string, open: string): string {
  const markerIndex = source.indexOf(marker);
  expect(markerIndex, marker).toBeGreaterThan(-1);
  const start = source.lastIndexOf(open, markerIndex);
  return source.slice(start, source.indexOf('>', markerIndex) + 1);
}

function createComponent() {
  const injector = Injector.create({ providers: [
    { provide: I18nService, useValue: { t: (key: string) => key, formatDateTime: (value: string) => value } }
  ] });
  return runInInjectionContext(injector, () => new SyncBarComponent());
}

describe('SyncBarComponent identifiers', () => {
  it('renders the prefixed test ids', () => {
    expect(testIds('admin-users')).toContain('admin-users-sync-button');
    expect(testIds('event-list')).toContain('event-list-sync-button');
  });

  it('prefixes every identifier it renders', () => {
    expect(testIds('admin-users')).toEqual(expect.arrayContaining([
      'admin-users-sync-group',
      'admin-users-sync-synced-at',
      'admin-users-sync-button',
      'admin-users-sync-label',
      'admin-users-sync-offline-banner'
    ]));
    expect(source).not.toMatch(/\sdata-cy="/); // no unprefixed identifier can leak onto a second page
  });
});

describe('SyncBarComponent bindings', () => {
  it('emits sync on click', () => {
    const button = tagAround(`cyPrefix() + '-sync-button'`, '<button');
    expect(button).toContain('(click)="sync.emit()"');

    const component = createComponent();
    const emissions: void[] = [];
    component.sync.subscribe(() => emissions.push(undefined));
    component.sync.emit();

    expect(emissions).toHaveLength(1);
  });

  it('disables the button while loading', () => {
    expect(tagAround(`cyPrefix() + '-sync-button'`, '<button')).toContain('[disabled]="loading()"');
    expect(createComponent().loading()).toBe(false);
  });

  it('hides the label when never synced', () => {
    const label = source.indexOf(`cyPrefix() + '-sync-synced-at'`);
    const guard = source.lastIndexOf('@if (syncedAt(); as instant)', label);
    expect(guard).toBeGreaterThan(-1);
    expect(createComponent().syncedAt()).toBeUndefined();
  });

  it('feeds the offline banner from the same instants', () => {
    const banner = tagAround(`cyPrefix() + '-sync-offline-banner'`, '<gones-offline-banner');
    expect(banner).toContain('[stale]="stale()"');
    expect(banner).toContain('[cachedAt]="syncedAt()"');
    expect(createComponent().stale()).toBe(false);
  });

  it('labels itself from the shared sync namespace', () => {
    expect(source).toContain(`i18n.t('sync.synchronise')`);
    expect(source).toContain(`i18n.t('sync.synchroniseAria')`);
    expect(source).toContain(`i18n.t('sync.syncedAt'`);
    expect(source).not.toContain(`i18n.t('event.`);
  });

  it('carries a decorative refresh icon', () => {
    const iconStart = source.indexOf('class="calendar-sync-icon"');
    expect(iconStart).toBeGreaterThan(-1);
    const icon = source.slice(source.lastIndexOf('<svg', iconStart), source.indexOf('>', iconStart));
    expect(icon).toContain('aria-hidden="true"');
  });
});
