import { describe, expect, it } from 'vitest';
import { settingsCapabilities, type SettingsCapabilities } from './settings-capabilities';

const noFlags = { authV1: false, adminV1: false };
const allFlags = { authV1: true, adminV1: true };

describe('settingsCapabilities', () => {
  it('keeps the retired browser sections retired', () => {
    // ADR 0032 brings back the local catalog and the local rename; ADR 0020's one-way door on the
    // migration bundle is untouched, so that one stays off the object entirely.
    const retired = ['migrationBundleExport'];

    for (const role of [null, 'User', 'Organizer', 'Admin'] as const) {
      const capabilities = settingsCapabilities(allFlags, role) as SettingsCapabilities & Record<string, unknown>;
      for (const section of retired) expect(capabilities[section]).toBeUndefined();
    }
  });

  it('grants the Admin catalog section to Admins only', () => {
    expect(settingsCapabilities(allFlags, 'Admin').adminCatalog).toBe(true);
    expect(settingsCapabilities(allFlags, 'Organizer').adminCatalog).toBe(false);
    expect(settingsCapabilities(allFlags, 'User').adminCatalog).toBe(false);
    expect(settingsCapabilities(allFlags, null).adminCatalog).toBe(false);
    expect(settingsCapabilities({ ...allFlags, adminV1: false }, 'Admin').adminCatalog).toBe(false);
  });

  it('grants Organizer maintenance to Organizers and Admins', () => {
    expect(settingsCapabilities(allFlags, 'Organizer').organizerMaintenance).toBe(true);
    expect(settingsCapabilities(allFlags, 'Admin').organizerMaintenance).toBe(true);
    expect(settingsCapabilities(allFlags, 'User').organizerMaintenance).toBe(false);
    expect(settingsCapabilities(allFlags, null).organizerMaintenance).toBe(false);
  });

  it('shows profile link and org notifications only to signed-in users on flagged builds', () => {
    expect(settingsCapabilities(allFlags, 'User').profileLink).toBe(true);
    expect(settingsCapabilities(allFlags, null).profileLink).toBe(false);
    expect(settingsCapabilities({ ...allFlags, authV1: false }, 'User').profileLink).toBe(false);

    expect(settingsCapabilities(allFlags, 'User').orgNotifications).toBe(true);
    expect(settingsCapabilities(allFlags, null).orgNotifications).toBe(false);
    expect(settingsCapabilities({ ...allFlags, adminV1: false }, 'User').orgNotifications).toBe(false);
  });

  it('local sections are the complement of the server sections', () => {
    const roles = [null, 'User', 'Organizer', 'Admin'] as const;

    expect(roles.map((role) => settingsCapabilities(allFlags, role).localCatalog)).toEqual([true, true, true, false]);
    expect(roles.map((role) => settingsCapabilities(allFlags, role).localMaintenance)).toEqual([true, true, false, false]);
  });

  it('an anonymous viewer on a bare build still gets both local sections', () => {
    expect(settingsCapabilities(noFlags, null)).toEqual({
      adminCatalog: false,
      organizerMaintenance: false,
      profileLink: false,
      orgNotifications: false,
      localCatalog: true,
      localMaintenance: true
    });
  });
});
