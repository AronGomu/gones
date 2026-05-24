import { Routes } from '@angular/router';
import { adminGuard } from './auth/role.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'leagues' },
  { path: 'leagues', loadComponent: () => import('./features/leagues/league-list.component').then((m) => m.LeagueListComponent) },
  { path: 'leagues/:leagueId', loadComponent: () => import('./features/leagues/league-detail.component').then((m) => m.LeagueDetailComponent) },
  { path: 'leagues/:leagueId/tournaments/:tournamentId', loadComponent: () => import('./features/tournaments/tournament-detail.component').then((m) => m.TournamentDetailComponent) },
  { path: 'players/:playerName', loadComponent: () => import('./features/players/player-detail.component').then((m) => m.PlayerDetailComponent) },
  { path: 'admin/users', canActivate: [adminGuard], loadComponent: () => import('./admin/admin-users.component').then((m) => m.AdminUsersComponent) },
  { path: 'login', loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent) },
  { path: '**', loadComponent: () => import('./shared/not-found.component').then((m) => m.NotFoundComponent) }
];
