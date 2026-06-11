import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { CalendarEventDocument, LeagueDocument, PersistedLeague } from '../domain/models';
import type { ApplicationBackend } from './application-backend';

/**
 * Future Nest.js adapter for the same frontend backend bridge used by the local
 * browser implementation. The MVP UI is frontend-only and no longer exposes
 * login, authentication, or role-management behavior.
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

  createLeague(name: string): Promise<PersistedLeague> {
    return firstValueFrom(this.http.post<PersistedLeague>(this.url('/leagues'), { name }));
  }

  insertLeague(league: LeagueDocument): Promise<PersistedLeague> {
    return firstValueFrom(this.http.post<PersistedLeague>(this.url('/leagues/import'), { league }));
  }

  saveLeague(league: LeagueDocument, expectedVersion: number): Promise<PersistedLeague> {
    return firstValueFrom(this.http.put<PersistedLeague>(this.url(`/leagues/${encodeURIComponent(league.id)}`), { league, expectedVersion }));
  }

  deleteLeague(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(this.url(`/leagues/${encodeURIComponent(id)}`)));
  }

  listCalendarEvents(): Promise<CalendarEventDocument[]> {
    return firstValueFrom(this.http.get<CalendarEventDocument[]>(this.url('/calendar-events')));
  }

  saveCalendarEvent(event: CalendarEventDocument): Promise<CalendarEventDocument> {
    return firstValueFrom(this.http.put<CalendarEventDocument>(this.url(`/calendar-events/${encodeURIComponent(event.id)}`), { event }));
  }

  deleteCalendarEvent(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(this.url(`/calendar-events/${encodeURIComponent(id)}`)));
  }

  private url(path: string): string {
    return `${environment.apiBaseUrl.replace(/\/$/, '')}${path}`;
  }
}
