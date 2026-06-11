import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/menu/home-menu.component').then((m) => m.HomeMenuComponent) },
  { path: 'about', loadComponent: () => import('./features/menu/about.component').then((m) => m.AboutComponent) },
  { path: 'calendar', loadComponent: () => import('./features/menu/calendar.component').then((m) => m.CalendarComponent) },
  { path: 'events/:slug', loadComponent: () => import('./features/events/event-detail.component').then((m) => m.EventDetailComponent) },
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
  { path: '**', loadComponent: () => import('./shared/not-found.component').then((m) => m.NotFoundComponent) }
];
