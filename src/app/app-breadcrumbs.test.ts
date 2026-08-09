import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBreadcrumbs } from './app-breadcrumbs';

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
 * (no TestBed, no zone.js). Its one behavioural claim — the header import button belongs to the
 * archive list and to nothing else — is asserted on the source, and end-to-end in
 * `cypress/e2e/league-server.cy.js`.
 */
describe('header import visibility', () => {
  const source = readFileSync(join(__dirname, 'app.component.ts'), 'utf8');

  it('shows the header import on the archive list path only', () => {
    expect(source).toContain("this.showHeaderImport.set(path === '/leagues-archive');");
    expect(source).not.toContain("=== '/leagues'");
  });
});
