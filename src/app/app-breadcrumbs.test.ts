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
});
