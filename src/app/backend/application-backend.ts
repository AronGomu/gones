import { InjectionToken, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { CalendarEventDocument, LeagueDocument, PersistedLeague } from '../domain/models';
import { LocalFrontendBackend } from './local-frontend-backend.service';
import { AspNetApiBackend } from './aspnet-api-backend.service';

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
  readonly mode: 'frontend-local' | 'aspnet-api';
  readonly configured: boolean;
}

export function resolveBackendMode(apiBackend: boolean, apiBaseUrl: string): ApplicationBackend['mode'] {
  if (!apiBackend) return 'frontend-local';
  if (!apiBaseUrl) throw new Error('aspNetApiBaseUrlMissing');
  return 'aspnet-api';
}

export const APP_BACKEND = new InjectionToken<ApplicationBackend>('Gones application backend bridge', {
  providedIn: 'root',
  factory: () => resolveBackendMode(environment.features.apiBackend, environment.apiBaseUrl) === 'aspnet-api'
    ? inject(AspNetApiBackend)
    : inject(LocalFrontendBackend)
});
