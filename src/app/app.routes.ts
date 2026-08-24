import { Routes } from '@angular/router';
import { DataAuthorityCapabilityFlags } from './config/data-authority';
import { adminGuard, organizerGuard, userGuard, verifiedEmailGuard } from './auth/auth.guards';
import { firstVisitHomeGuard, markVisitedGuard } from './shared/first-visit.guard';
import { powerUserGuard } from './shared/power-user.guard';

const authRoutes: Routes = [
  { path: 'login', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'login' } },
  { path: 'register', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'register' } },
  { path: 'auth/complete-profile', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'complete-profile' } },
  { path: 'verify-email', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'verify-email' } },
  { path: 'forgot-password', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'forgot-password' } },
  { path: 'reset-password', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'reset-password' } },
  { path: 'profile', pathMatch: 'full', redirectTo: 'settings/account' },
  { path: 'settings/account', canActivate: [userGuard], loadComponent: () => import('./features/settings/account-settings.component').then((m) => m.AccountSettingsComponent) }
];

const eventId = (params: Record<string, unknown>) => encodeURIComponent(String(params['id'] ?? ''));

const registrationAndOrganizerRoutes: Routes = [
  { path: 'registrations', canActivate: [userGuard], loadComponent: () => import('./features/events/my-registrations.component').then((m) => m.MyRegistrationsComponent) },
  { path: 'events/new', canActivate: [organizerGuard, verifiedEmailGuard, powerUserGuard], loadComponent: () => import('./features/events/organizer-event-create.component').then((m) => m.OrganizerEventCreateComponent) },
  { path: 'organizer/events', canActivate: [organizerGuard], loadComponent: () => import('./features/events/organizer-event-list.component').then((m) => m.OrganizerEventListComponent) },
  { path: 'organizer/events/:id/edit', canActivate: [organizerGuard, verifiedEmailGuard, powerUserGuard], loadComponent: () => import('./features/events/organizer-event-create.component').then((m) => m.OrganizerEventCreateComponent) },
  { path: 'organizer/events/:id/participants', canActivate: [organizerGuard], loadComponent: () => import('./features/events/organizer-participants.component').then((m) => m.OrganizerParticipantsComponent) },
  { path: 'tournaments/new', pathMatch: 'full', redirectTo: 'events/new' },
  { path: 'organizer/tournaments/new', pathMatch: 'full', redirectTo: 'events/new' },
  { path: 'organizer/tournaments', pathMatch: 'full', redirectTo: 'organizer/events' },
  { path: 'organizer/tournaments/:id/edit', pathMatch: 'full', redirectTo: ({ params }) => `/organizer/events/${eventId(params)}/edit` },
  { path: 'organizer/tournaments/:id/participants', pathMatch: 'full', redirectTo: ({ params }) => `/organizer/events/${eventId(params)}/participants` }
];

const adminRoutes: Routes = [
  { path: 'organizations/:id', loadComponent: () => import('./features/admin/organization-detail.component').then((m) => m.OrganizationDetailComponent) },
  { path: 'organizer/organizations', canActivate: [userGuard], loadComponent: () => import('./features/admin/organizer-organizations.component').then((m) => m.OrganizerOrganizationsComponent) },
  { path: 'admin', canActivate: [adminGuard], loadComponent: () => import('./features/admin/admin-home.component').then((m) => m.AdminHomeComponent) },
  { path: 'admin/users', canActivate: [adminGuard], loadComponent: () => import('./features/admin/admin-users.component').then((m) => m.AdminUsersComponent) },
  { path: 'admin/organizations', canActivate: [adminGuard], loadComponent: () => import('./features/admin/admin-organizations.component').then((m) => m.AdminOrganizationsComponent) },
  { path: 'admin/audit', canActivate: [adminGuard], loadComponent: () => import('./features/admin/admin-audit.component').then((m) => m.AdminAuditComponent) },
  { path: 'admin/notifications/history', canActivate: [adminGuard], data: { mode: 'history' }, loadComponent: () => import('./features/admin/admin-notification-delivery.component').then((m) => m.AdminNotificationDeliveryComponent) },
  { path: 'admin/notifications/dead-letters', canActivate: [adminGuard], data: { mode: 'dead-letters' }, loadComponent: () => import('./features/admin/admin-notification-delivery.component').then((m) => m.AdminNotificationDeliveryComponent) },
  { path: 'admin/events/deleted', canActivate: [adminGuard], loadComponent: () => import('./features/events/admin-deleted-events.component').then((m) => m.AdminDeletedEventsComponent) },
  { path: 'admin/tournaments/deleted', pathMatch: 'full', redirectTo: 'admin/events/deleted' }
];

/**
 * Events V2. `/events` browses the Event list and calendar view, `/events/:slug` is the canonical
 * Event page. `/calendar` and `/calendar/tournaments/:slug` are removed with no redirect alias —
 * stale bookmarks hit the 404 page (ADR 0038 supersedes the redirect clause of ADR 0035).
 */
export function eventRoutes(): Routes {
  return [
    { path: 'events', loadComponent: () => import('./features/events/public-event-list.component').then((m) => m.PublicEventListComponent) },
    { path: 'events/:slug', loadComponent: () => import('./features/events/public-event-detail.component').then((m) => m.PublicEventDetailComponent) }
  ];
}

/**
 * The archived League feature was renamed to `leagues-archive` / `tournaments-archive` (ADR 0022).
 * Every retired path stays reachable as a parameter-preserving redirect so bookmarks survive; the
 * API paths deliberately carry no such alias.
 */
function archiveRedirectRoutes(): Routes {
  const leagueId = (params: Record<string, unknown>) => encodeURIComponent(String(params['leagueId'] ?? ''));
  const tournamentId = (params: Record<string, unknown>) => encodeURIComponent(String(params['tournamentId'] ?? ''));
  const tournamentPath = (params: Record<string, unknown>) => `/leagues-archive/${leagueId(params)}/tournaments-archive/${tournamentId(params)}`;

  return [
    { path: 'leagues', pathMatch: 'full', redirectTo: 'leagues-archive' },
    { path: 'leagues/:leagueId', pathMatch: 'full', redirectTo: ({ params }) => `/leagues-archive/${leagueId(params)}` },
    { path: 'leagues/:leagueId/tournaments/:tournamentId', pathMatch: 'full', redirectTo: ({ params }) => tournamentPath(params) },
    { path: 'leagues/:leagueId/tournaments/:tournamentId/result', pathMatch: 'full', redirectTo: ({ params }) => `${tournamentPath(params)}/result` },
    { path: 'leagues/:leagueId/tournaments/:tournamentId/result/metagames', pathMatch: 'full', redirectTo: ({ params }) => `${tournamentPath(params)}/result/metagames` }
  ];
}

/**
 * Route exposure follows the resolved capability flags. The data authority is always the server, so
 * auth, registration, organizer and admin routes are gated by their own flags alone (ADR 0020).
 */
export function buildRoutes(features: DataAuthorityCapabilityFlags): Routes {
  const authV1 = features.authV1;
  const adminV1 = features.adminV1;

  return [
    { path: '', canActivate: [firstVisitHomeGuard], loadComponent: () => import('./features/menu/home-menu.component').then((m) => m.HomeMenuComponent) },
    { path: 'about', canActivate: [markVisitedGuard], loadComponent: () => import('./features/menu/about.component').then((m) => m.AboutComponent) },
    // Spread before the calendar routes: `events/new` has to match ahead of `events/:slug`.
    ...(authV1 ? registrationAndOrganizerRoutes : []),
    ...eventRoutes(),
    { path: 'event-requests/:token', loadComponent: () => import('./features/events/event-request.component').then((m) => m.EventRequestComponent) },
    { path: 'tournament-requests/:token', pathMatch: 'full', redirectTo: ({ params }) => `/event-requests/${encodeURIComponent(String(params['token'] ?? ''))}` },
    { path: 'archive', pathMatch: 'full', redirectTo: 'archive/league-seasons' },
    { path: 'archive/league-seasons', loadComponent: () => import('./features/archive/league-season-list.component').then((m) => m.LeagueSeasonListComponent) },
    // Placeholder until the Tournaments tab ships: the tab strip links here, and bouncing back to the
    // Seasons tab beats sending the click to the 404 page. Replaced by a `loadComponent` entry then.
    { path: 'archive/tournaments', pathMatch: 'full', redirectTo: 'archive/league-seasons' },
    { path: 'leagues-archive', loadComponent: () => import('./features/leagues-archive/league-archive-list.component').then((m) => m.LeagueArchiveListComponent) },
    { path: 'live-tournaments', loadComponent: () => import('./features/live-tournaments/live-tournament-list.component').then((m) => m.LiveTournamentListComponent) },
    { path: 'live-tournaments/new', canActivate: [powerUserGuard], loadComponent: () => import('./features/live-tournaments/live-tournament-runner.component').then((m) => m.LiveTournamentRunnerComponent) },
    { path: 'live-tournaments/:liveTournamentId', loadComponent: () => import('./features/live-tournaments/live-tournament-runner.component').then((m) => m.LiveTournamentRunnerComponent) },
    { path: 'leagues-archive/:leagueId', loadComponent: () => import('./features/leagues-archive/league-archive-detail.component').then((m) => m.LeagueArchiveDetailComponent) },
    { path: 'leagues-archive/:leagueId/tournaments-archive/:tournamentId', loadComponent: () => import('./features/tournaments-archive/tournament-archive-detail.component').then((m) => m.TournamentArchiveDetailComponent) },
    { path: 'leagues-archive/:leagueId/tournaments-archive/:tournamentId/result', loadComponent: () => import('./features/tournaments-archive/tournament-archive-result.component').then((m) => m.TournamentArchiveResultComponent) },
    { path: 'leagues-archive/:leagueId/tournaments-archive/:tournamentId/result/metagames', loadComponent: () => import('./features/tournaments-archive/tournament-archive-result.component').then((m) => m.TournamentArchiveResultComponent) },
    ...archiveRedirectRoutes(),
    { path: 'global-stats', loadComponent: () => import('./features/players/global-stats.component').then((m) => m.GlobalStatsComponent) },
    { path: 'players/:playerName', loadComponent: () => import('./features/players/player-detail.component').then((m) => m.PlayerDetailComponent) },
    { path: 'settings', loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent) },
    ...(authV1 ? authRoutes : []),
    ...(adminV1 ? adminRoutes : []),
    { path: 'app-error', loadComponent: () => import('./shared/route-error-boundary').then((m) => m.RouteErrorComponent) },
    { path: '**', loadComponent: () => import('./shared/not-found.component').then((m) => m.NotFoundComponent) }
  ];
}
