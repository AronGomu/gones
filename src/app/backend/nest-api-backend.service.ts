import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { LeagueDocument, PersistedLeague, UserRole } from '../domain/models';
import type { ApplicationBackend, AuthSession, AuthorizedUser } from './application-backend';

/**
 * Future Nest.js adapter for the same frontend backend bridge used by the local
 * browser implementation. When the Nest API is introduced, provide this class
 * for APP_BACKEND and keep UI/repository call sites unchanged.
 */
@Injectable({ providedIn: 'root' })
export class NestApiBackend implements ApplicationBackend {
  readonly mode = 'nest-api' as const;
  readonly configured = Boolean(environment.apiBaseUrl);

  constructor(private readonly http: HttpClient) {}

  listLeagues(): Promise<PersistedLeague[]> {
    return firstValueFrom(this.http.get<PersistedLeague[]>(this.url('/leagues')));
  }

  getLeague(id: string): Promise<PersistedLeague | null> {
    return firstValueFrom(this.http.get<PersistedLeague | null>(this.url(`/leagues/${encodeURIComponent(id)}`)));
  }

  createLeague(name: string, actorEmail: string): Promise<PersistedLeague> {
    return firstValueFrom(this.http.post<PersistedLeague>(this.url('/leagues'), { name, actorEmail }));
  }

  insertLeague(league: LeagueDocument, actorEmail: string): Promise<PersistedLeague> {
    return firstValueFrom(this.http.post<PersistedLeague>(this.url('/leagues/import'), { league, actorEmail }));
  }

  saveLeague(league: LeagueDocument, expectedVersion: number, actorEmail: string): Promise<PersistedLeague> {
    return firstValueFrom(this.http.put<PersistedLeague>(this.url(`/leagues/${encodeURIComponent(league.id)}`), { league, expectedVersion, actorEmail }));
  }

  deleteLeague(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(this.url(`/leagues/${encodeURIComponent(id)}`)));
  }

  getSession(): Promise<AuthSession | null> {
    return firstValueFrom(this.http.get<AuthSession | null>(this.url('/auth/session')));
  }

  signIn(email: string): Promise<AuthSession> {
    return firstValueFrom(this.http.post<AuthSession>(this.url('/auth/local-session'), { email }));
  }

  signOut(): Promise<void> {
    return firstValueFrom(this.http.post<void>(this.url('/auth/sign-out'), {}));
  }

  lookupRole(email: string): Promise<UserRole> {
    return firstValueFrom(this.http.get<UserRole>(this.url(`/authorized-users/${encodeURIComponent(email)}/role`)));
  }

  listAuthorizedUsers(): Promise<AuthorizedUser[]> {
    return firstValueFrom(this.http.get<AuthorizedUser[]>(this.url('/authorized-users')));
  }

  upsertAuthorizedUser(email: string, role: 'organizer' | 'admin', actorEmail: string): Promise<void> {
    return firstValueFrom(this.http.put<void>(this.url(`/authorized-users/${encodeURIComponent(email)}`), { role, actorEmail }));
  }

  removeAuthorizedUser(email: string, actorEmail: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(this.url(`/authorized-users/${encodeURIComponent(email)}`), { body: { actorEmail } }));
  }

  private url(path: string): string {
    return `${environment.apiBaseUrl.replace(/\/$/, '')}${path}`;
  }
}
