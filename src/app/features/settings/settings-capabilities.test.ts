import { describe, expect, it } from 'vitest';
import { settingsCapabilities } from './settings-capabilities';

const localFlags = { authV1: false, adminV1: false, leagueServer: false };
const serverFlags = { authV1: true, adminV1: true, leagueServer: true };

describe('settingsCapabilities', () => {
  it('keeps local mutation authority when the league server flag is off', () => {
    const capabilities = settingsCapabilities(localFlags, null);
    expect(capabilities.localArchetypeMutation).toBe(true);
    expect(capabilities.localPlayerRename).toBe(true);
    expect(capabilities.adminCatalog).toBe(false);
    expect(capabilities.organizerMaintenance).toBe(false);
    expect(capabilities.profileLink).toBe(false);
    expect(capabilities.orgNotifications).toBe(false);
  });

  it('removes flag-on local archetype mutation authority for every role', () => {
    for (const role of [null, 'User', 'Organizer', 'Admin'] as const) {
      const capabilities = settingsCapabilities(serverFlags, role);
      expect(capabilities.localArchetypeMutation).toBe(false);
      expect(capabilities.localPlayerRename).toBe(false);
    }
  });

  it('grants the Admin catalog section to Admins only', () => {
    expect(settingsCapabilities(serverFlags, 'Admin').adminCatalog).toBe(true);
    expect(settingsCapabilities(serverFlags, 'Organizer').adminCatalog).toBe(false);
    expect(settingsCapabilities(serverFlags, 'User').adminCatalog).toBe(false);
    expect(settingsCapabilities(serverFlags, null).adminCatalog).toBe(false);
    expect(settingsCapabilities({ ...serverFlags, adminV1: false }, 'Admin').adminCatalog).toBe(false);
  });

  it('grants Organizer maintenance to Organizers and Admins in server mode', () => {
    expect(settingsCapabilities(serverFlags, 'Organizer').organizerMaintenance).toBe(true);
    expect(settingsCapabilities(serverFlags, 'Admin').organizerMaintenance).toBe(true);
    expect(settingsCapabilities(serverFlags, 'User').organizerMaintenance).toBe(false);
    expect(settingsCapabilities(serverFlags, null).organizerMaintenance).toBe(false);
    expect(settingsCapabilities(localFlags, 'Organizer').organizerMaintenance).toBe(false);
  });

  it('shows profile link and org notifications only to signed-in users on flagged builds', () => {
    expect(settingsCapabilities(serverFlags, 'User').profileLink).toBe(true);
    expect(settingsCapabilities(serverFlags, null).profileLink).toBe(false);
    expect(settingsCapabilities({ ...serverFlags, authV1: false }, 'User').profileLink).toBe(false);

    expect(settingsCapabilities(serverFlags, 'User').orgNotifications).toBe(true);
    expect(settingsCapabilities(serverFlags, null).orgNotifications).toBe(false);
    expect(settingsCapabilities({ ...serverFlags, adminV1: false }, 'User').orgNotifications).toBe(false);
  });
});
