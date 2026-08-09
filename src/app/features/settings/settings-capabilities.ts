import type { GlobalRole } from '../../data/league-archive-command-ux';

export interface SettingsFeatureFlags {
  authV1: boolean;
  adminV1: boolean;
}

/** Which Settings sections are available for the current viewer role. */
export interface SettingsCapabilities {
  /** Admin-only global Deck Archetype catalog CRUD + import. */
  adminCatalog: boolean;
  /** Organizer/Admin Player Name search + rename over the shared League source. */
  organizerMaintenance: boolean;
  /** Link to the account profile page (email, password, preferred language). */
  profileLink: boolean;
  /** Organization notification preferences for owned organizations. */
  orgNotifications: boolean;
}

/**
 * The API database owns League, Live and Calendar data, so there are no browser-local Settings
 * sections left: the local Deck Archetype catalog, the local Player rename and the migration-bundle
 * export all went with the browser store (ADR 0020).
 */
export function settingsCapabilities(flags: SettingsFeatureFlags, role: GlobalRole | null | undefined): SettingsCapabilities {
  const signedIn = flags.authV1 && role != null;
  return {
    adminCatalog: flags.adminV1 && role === 'Admin',
    organizerMaintenance: role === 'Organizer' || role === 'Admin',
    profileLink: signedIn,
    orgNotifications: signedIn && flags.adminV1
  };
}
