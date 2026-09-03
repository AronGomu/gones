import { Routes } from '@angular/router';
import { DataAuthorityCapabilityFlags } from './config/data-authority';
import { adminGuard, organizerGuard, userGuard, verifiedEmailGuard } from './auth/auth.guards';
import { firstVisitHomeGuard, markVisitedGuard } from './shared/first-visit.guard';
import { eventCreatePowerGuard, powerUserGuard } from './shared/power-user.guard';

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
  { path: 'events/new', canActivate: [userGuard, verifiedEmailGuard, eventCreatePowerGuard], loadComponent: () => import('./features/events/organizer-event-create.component').then((m) => m.OrganizerEventCreateComponent) },
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
 * Route exposure follows the resolved capability flags. The data authority is always the server, so
 * auth, registration, organizer and admin routes are gated by their own flags alone (ADR 0020).
 *
 * The archive is served from `/archive/**` on three tiers (League → LeagueSeason → Tournament).
 * Every retired archive path — `/leagues`, the flat League list, its detail page and its nested
 * tournament pages — is removed with no redirect alias, so a stale bookmark hits the 404 page.
 * ADR 0022 kept redirects because "Bookmarks and old links are a real user's problem"; Gones is
 * unreleased with zero users, so that rationale is void. Its "No API path aliases" clause still
 * stands, and the retired API routes 404 too. The retired path literals are deliberately not
 * spelled out here: `src/app/shared/retired-archive-surface.test.ts` scans this file for them.
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
    { path: 'archive/tournaments', loadComponent: () => import('./features/archive/tournament-list.component').then((m) => m.TournamentListComponent) },
    { path: 'archive/league-seasons/:seasonId', loadComponent: () => import('./features/archive/league-season-detail.component').then((m) => m.LeagueSeasonDetailComponent) },
    { path: 'archive/tournaments/:tournamentId', loadComponent: () => import('./features/archive/tournament-detail.component').then((m) => m.TournamentDetailComponent) },
    { path: 'archive/tournaments/:tournamentId/result', loadComponent: () => import('./features/archive/tournament-result.component').then((m) => m.TournamentResultComponent) },
    { path: 'archive/tournaments/:tournamentId/result/metagames', loadComponent: () => import('./features/archive/tournament-result.component').then((m) => m.TournamentResultComponent) },
    { path: 'live-tournaments', loadComponent: () => import('./features/live-tournaments/live-tournament-list.component').then((m) => m.LiveTournamentListComponent) },
    { path: 'live-tournaments/new', canActivate: [powerUserGuard], loadComponent: () => import('./features/live-tournaments/live-tournament-runner.component').then((m) => m.LiveTournamentRunnerComponent) },
    { path: 'live-tournaments/:liveTournamentId', loadComponent: () => import('./features/live-tournaments/live-tournament-runner.component').then((m) => m.LiveTournamentRunnerComponent) },
    { path: 'global-stats', loadComponent: () => import('./features/players/global-stats.component').then((m) => m.GlobalStatsComponent) },
    { path: 'players/:playerName', loadComponent: () => import('./features/players/player-detail.component').then((m) => m.PlayerDetailComponent) },
    { path: 'settings', loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent) },
    ...(authV1 ? authRoutes : []),
    ...(adminV1 ? adminRoutes : []),
    { path: 'app-error', loadComponent: () => import('./shared/route-error-boundary').then((m) => m.RouteErrorComponent) },
    { path: '**', loadComponent: () => import('./shared/not-found.component').then((m) => m.NotFoundComponent) }
  ];
}
