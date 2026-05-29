import { InjectionToken, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { LeagueDocument, PersistedLeague, UserRole } from '../domain/models';
import { LocalFrontendBackend } from './local-frontend-backend.service';
import { NestApiBackend } from './nest-api-backend.service';

export interface AuthSession {
  email: string;
  role: UserRole;
  provider: 'local';
}

export interface AuthorizedUser {
  email: string;
  role: 'organizer' | 'admin';
  createdAt?: string;
  updatedAt?: string;
}

export interface LeagueBackendPort {
  listLeagues(): Promise<PersistedLeague[]>;
  getLeague(id: string): Promise<PersistedLeague | null>;
  createLeague(name: string, actorEmail: string): Promise<PersistedLeague>;
  insertLeague(league: LeagueDocument, actorEmail: string): Promise<PersistedLeague>;
  saveLeague(league: LeagueDocument, expectedVersion: number, actorEmail: string): Promise<PersistedLeague>;
  deleteLeague(id: string): Promise<void>;
}

export interface AuthBackendPort {
  getSession(): Promise<AuthSession | null>;
  signIn(email: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  lookupRole(email: string): Promise<UserRole>;
}

export interface AuthorizedUsersBackendPort {
  listAuthorizedUsers(): Promise<AuthorizedUser[]>;
  upsertAuthorizedUser(email: string, role: 'organizer' | 'admin', actorEmail: string): Promise<void>;
  removeAuthorizedUser(email: string, actorEmail: string): Promise<void>;
}

export interface ApplicationBackend extends LeagueBackendPort, AuthBackendPort, AuthorizedUsersBackendPort {
  readonly mode: 'frontend-local' | 'nest-api';
  readonly configured: boolean;
}

export const APP_BACKEND = new InjectionToken<ApplicationBackend>('Gones application backend bridge', {
  providedIn: 'root',
  factory: () => {
    if (environment.backend === 'nest-api') {
      if (!environment.apiBaseUrl) throw new Error('nestApiBaseUrlMissing');
      return inject(NestApiBackend);
    }
    return inject(LocalFrontendBackend);
  }
});
