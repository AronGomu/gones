import type { GlobalRole } from '../../data/league-command-ux';

export interface SettingsFeatureFlags {
  authV1: boolean;
  adminV1: boolean;
  leagueServer: boolean;
}

/** Which Settings sections are available for the current build flags and viewer role. */
export interface SettingsCapabilities {
  /** Local (browser) Deck Archetype catalog mutation. Removed once the server catalog owns mutations. */
  localArchetypeMutation: boolean;
  /** Local (browser) Player rename over local league documents. */
  localPlayerRename: boolean;
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
    localArchetypeMutation: !flags.leagueServer,
    localPlayerRename: !flags.leagueServer,
    adminCatalog: flags.leagueServer && flags.adminV1 && role === 'Admin',
    organizerMaintenance: flags.leagueServer && (role === 'Organizer' || role === 'Admin'),
    profileLink: signedIn,
    orgNotifications: signedIn && flags.adminV1
  };
}
