import type { GlobalRole } from '../../data/archive-command-ux';

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
  /** Browser-local deck archetype catalog — offered when no server catalog is (ADR 0032). */
  localCatalog: boolean;
  /** Browser-local player rename over the browser League store — offered when no server maintenance is. */
  localMaintenance: boolean;
}

/**
 * The API database owns League, Live and Calendar data, so the migration-bundle export stays retired
 * with the browser store (ADR 0020). The two browser-local catalogs came back as the *complement* of
 * their server-backed equivalents (ADR 0032): a viewer never sees two archetype panels or two player
 * panels, so there is never a question about which one they just edited.
 */
export function settingsCapabilities(flags: SettingsFeatureFlags, role: GlobalRole | null | undefined): SettingsCapabilities {
  const signedIn = flags.authV1 && role != null;
  return {
    adminCatalog: flags.adminV1 && role === 'Admin',
    organizerMaintenance: role === 'Organizer' || role === 'Admin',
    profileLink: signedIn,
    orgNotifications: signedIn && flags.adminV1,
    localCatalog: !(flags.adminV1 && role === 'Admin'),
    localMaintenance: !(role === 'Organizer' || role === 'Admin')
  };
}
