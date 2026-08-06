import type { GlobalRole } from '../../data/league-command-ux';

export interface SettingsFeatureFlags {
  authV1: boolean;
  adminV1: boolean;
  /** True when the API database owns League/Live/Calendar data (ADR 0019). */
  serverAuthority: boolean;
}

/** Which Settings sections are available for the current data authority and viewer role. */
export interface SettingsCapabilities {
  /** Local (browser) Deck Archetype catalog mutation. Legacy authority only. */
  localArchetypeMutation: boolean;
  /** Local (browser) Player rename over local league documents. Legacy authority only. */
  localPlayerRename: boolean;
  /** Private migration-bundle export for the future cutover. Legacy authority only. */
  migrationBundleExport: boolean;
  /** Admin-only global Deck Archetype catalog CRUD + import. */
  adminCatalog: boolean;
  /** Organizer/Admin Player Name search + rename over the shared League source. */
  organizerMaintenance: boolean;
  /** Link to the account profile page (email, password, preferred language). */
  profileLink: boolean;
  /** Organization notification preferences for owned organizations. */
  orgNotifications: boolean;
}

export function settingsCapabilities(flags: SettingsFeatureFlags, role: GlobalRole | null | undefined): SettingsCapabilities {
  const signedIn = flags.authV1 && role != null;
  return {
    localArchetypeMutation: !flags.serverAuthority,
    localPlayerRename: !flags.serverAuthority,
    migrationBundleExport: !flags.serverAuthority,
    adminCatalog: flags.serverAuthority && flags.adminV1 && role === 'Admin',
    organizerMaintenance: flags.serverAuthority && (role === 'Organizer' || role === 'Admin'),
    profileLink: signedIn,
    orgNotifications: signedIn && flags.adminV1
  };
}
