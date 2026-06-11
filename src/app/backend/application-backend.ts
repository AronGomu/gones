import { InjectionToken, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { CalendarEventDocument, LeagueDocument, PersistedLeague } from '../domain/models';
import { LocalFrontendBackend } from './local-frontend-backend.service';
import { NestApiBackend } from './nest-api-backend.service';

export interface LeagueBackendPort {
  listLeagues(): Promise<PersistedLeague[]>;
  getLeague(id: string): Promise<PersistedLeague | null>;
  createLeague(name: string): Promise<PersistedLeague>;
  insertLeague(league: LeagueDocument): Promise<PersistedLeague>;
  saveLeague(league: LeagueDocument, expectedVersion: number): Promise<PersistedLeague>;
  deleteLeague(id: string): Promise<void>;
}

export interface CalendarEventBackendPort {
  listCalendarEvents(): Promise<CalendarEventDocument[]>;
  saveCalendarEvent(event: CalendarEventDocument): Promise<CalendarEventDocument>;
  deleteCalendarEvent(id: string): Promise<void>;
}

export interface ApplicationBackend extends LeagueBackendPort, CalendarEventBackendPort {
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
