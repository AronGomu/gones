import { Routes } from '@angular/router';
import { DataAuthorityCapabilityFlags, DataMode } from './config/data-authority';
import { adminGuard, organizerGuard, userGuard } from './auth/auth.guards';

const authRoutes: Routes = [
  { path: 'login', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'login' } },
  { path: 'register', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'register' } },
  { path: 'auth/complete-profile', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'complete-profile' } },
  { path: 'verify-email', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'verify-email' } },
  { path: 'forgot-password', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'forgot-password' } },
  { path: 'reset-password', loadComponent: () => import('./auth/auth-entry.component').then((m) => m.AuthEntryComponent), data: { mode: 'reset-password' } },
  { path: 'profile', canActivate: [userGuard], loadComponent: () => import('./auth/profile.component').then((m) => m.ProfileComponent) },
  { path: 'profile/sessions', canActivate: [userGuard], loadComponent: () => import('./auth/sessions.component').then((m) => m.SessionsComponent) }
];

const registrationAndOrganizerRoutes: Routes = [
  { path: 'registrations', canActivate: [userGuard], loadComponent: () => import('./features/calendar/my-registrations.component').then((m) => m.MyRegistrationsComponent) },
  { path: 'organizer/tournaments', canActivate: [organizerGuard], loadComponent: () => import('./features/calendar/organizer-tournament-list.component').then((m) => m.OrganizerTournamentListComponent) },
  { path: 'organizer/tournaments/new', canActivate: [organizerGuard], loadComponent: () => import('./features/calendar/organizer-tournament-create.component').then((m) => m.OrganizerTournamentCreateComponent) },
  { path: 'organizer/tournaments/:id/edit', canActivate: [organizerGuard], loadComponent: () => import('./features/calendar/organizer-tournament-create.component').then((m) => m.OrganizerTournamentCreateComponent) },
  { path: 'organizer/tournaments/:id/participants', canActivate: [organizerGuard], loadComponent: () => import('./features/calendar/organizer-participants.component').then((m) => m.OrganizerParticipantsComponent) }
];

const adminRoutes: Routes = [
  { path: 'organizations', loadComponent: () => import('./features/admin/organization-list.component').then((m) => m.OrganizationListComponent) },
  { path: 'organizations/:id', loadComponent: () => import('./features/admin/organization-detail.component').then((m) => m.OrganizationDetailComponent) },
  { path: 'organizer/organizations', canActivate: [userGuard], loadComponent: () => import('./features/admin/organizer-organizations.component').then((m) => m.OrganizerOrganizationsComponent) },
  { path: 'admin', canActivate: [adminGuard], loadComponent: () => import('./features/admin/admin-home.component').then((m) => m.AdminHomeComponent) },
  { path: 'admin/users', canActivate: [adminGuard], loadComponent: () => import('./features/admin/admin-users.component').then((m) => m.AdminUsersComponent) },
  { path: 'admin/organizations', canActivate: [adminGuard], loadComponent: () => import('./features/admin/admin-organizations.component').then((m) => m.AdminOrganizationsComponent) },
  { path: 'admin/audit', canActivate: [adminGuard], loadComponent: () => import('./features/admin/admin-audit.component').then((m) => m.AdminAuditComponent) },
  { path: 'admin/notifications/history', canActivate: [adminGuard], data: { mode: 'history' }, loadComponent: () => import('./features/admin/admin-notification-delivery.component').then((m) => m.AdminNotificationDeliveryComponent) },
  { path: 'admin/notifications/dead-letters', canActivate: [adminGuard], data: { mode: 'dead-letters' }, loadComponent: () => import('./features/admin/admin-notification-delivery.component').then((m) => m.AdminNotificationDeliveryComponent) },
  { path: 'admin/tournaments/deleted', canActivate: [adminGuard], loadComponent: () => import('./features/calendar/admin-deleted-tournaments.component').then((m) => m.AdminDeletedTournamentsComponent) }
];

/**
 * Legacy mode keeps the browser-store Calendar/Event pages; server mode serves Calendar V1 and
 * redirects the old Event detail path. No build exposes both.
 */
export function calendarRoutes(mode: DataMode): Routes {
  if (mode === 'legacy-browser') {
    return [
      { path: 'calendar', loadComponent: () => import('./features/menu/calendar.component').then((m) => m.CalendarComponent) },
      { path: 'events/:slug', loadComponent: () => import('./features/events/event-detail.component').then((m) => m.EventDetailComponent) }
    ];
  }
  return [
    { path: 'calendar', loadComponent: () => import('./features/calendar/public-calendar.component').then((m) => m.PublicCalendarComponent) },
    { path: 'calendar/tournaments/:slug', loadComponent: () => import('./features/calendar/public-tournament-detail.component').then((m) => m.PublicTournamentDetailComponent) },
    { path: 'events/:slug', redirectTo: ({ params }) => `/calendar/tournaments/${encodeURIComponent(String(params['slug'] ?? ''))}` }
  ];
}

/**
 * Route exposure follows the declared data authority. A legacy-browser build never exposes an auth,
 * registration, organizer or admin route, whatever the capability flags claim (ADR 0019).
 */
export function buildRoutes(mode: DataMode, features: DataAuthorityCapabilityFlags): Routes {
  const serverAuthority = mode === 'server';
  const authV1 = serverAuthority && features.authV1;
  const adminV1 = serverAuthority && features.adminV1;

  return [
    { path: '', loadComponent: () => import('./features/menu/home-menu.component').then((m) => m.HomeMenuComponent) },
    { path: 'about', loadComponent: () => import('./features/menu/about.component').then((m) => m.AboutComponent) },
    ...calendarRoutes(mode),
    { path: 'leagues', loadComponent: () => import('./features/leagues/league-list.component').then((m) => m.LeagueListComponent) },
    { path: 'live-tournaments', loadComponent: () => import('./features/live-tournaments/live-tournament-list.component').then((m) => m.LiveTournamentListComponent) },
    { path: 'live-tournaments/new', loadComponent: () => import('./features/live-tournaments/live-tournament-runner.component').then((m) => m.LiveTournamentRunnerComponent) },
    { path: 'live-tournaments/:liveTournamentId', loadComponent: () => import('./features/live-tournaments/live-tournament-runner.component').then((m) => m.LiveTournamentRunnerComponent) },
    { path: 'leagues/:leagueId', loadComponent: () => import('./features/leagues/league-detail.component').then((m) => m.LeagueDetailComponent) },
    { path: 'leagues/:leagueId/tournaments/:tournamentId', loadComponent: () => import('./features/tournaments/tournament-detail.component').then((m) => m.TournamentDetailComponent) },
    { path: 'leagues/:leagueId/tournaments/:tournamentId/result', loadComponent: () => import('./features/tournaments/tournament-result.component').then((m) => m.TournamentResultComponent) },
    { path: 'leagues/:leagueId/tournaments/:tournamentId/result/metagames', loadComponent: () => import('./features/tournaments/tournament-result.component').then((m) => m.TournamentResultComponent) },
    { path: 'players/:playerName', loadComponent: () => import('./features/players/player-detail.component').then((m) => m.PlayerDetailComponent) },
    { path: 'settings', loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent) },
    ...(authV1 ? authRoutes : []),
    ...(authV1 ? registrationAndOrganizerRoutes : []),
    ...(adminV1 ? adminRoutes : []),
    { path: 'app-error', loadComponent: () => import('./shared/route-error-boundary').then((m) => m.RouteErrorComponent) },
    { path: '**', loadComponent: () => import('./shared/not-found.component').then((m) => m.NotFoundComponent) }
  ];
}
