import { InjectionToken, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { CalendarEventDocument, LeagueDocument, LeagueStatus, PersistedLeague, RoundEntry } from '../domain/models';
import { LocalFrontendBackend } from './local-frontend-backend.service';
import { AspNetApiBackend } from './aspnet-api-backend.service';

export interface LeagueRestoreCommand {
  kind: 'league';
  gonesDataVersion: number;
  league: LeagueDocument;
}

export interface FullLeagueRestoreCommand {
  kind: 'fullData';
  gonesDataVersion: number;
  leagues: LeagueDocument[];
}

export interface MoveResultTournamentResult {
  fromLeague: PersistedLeague;
  toLeague: PersistedLeague;
}

export interface LeagueBackendPort {
  listLeagues(): Promise<PersistedLeague[]>;
  getLeague(id: string): Promise<PersistedLeague | null>;
  createLeague(name: string, idempotencyKey?: string): Promise<PersistedLeague>;
  renameLeague(id: string, expectedVersion: number, name: string): Promise<PersistedLeague>;
  changeLeagueStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeague>;
  deleteLeague(id: string, expectedVersion: number): Promise<void>;
  createResultTournament(id: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague>;
  editResultTournament(id: string, tournamentId: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague>;
  deleteResultTournament(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague>;
  moveResultTournament(id: string, tournamentId: string, expectedVersion: number, targetLeagueId: string, targetExpectedVersion: number): Promise<MoveResultTournamentResult>;
  addResultRound(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague>;
  deleteResultRound(id: string, tournamentId: string, roundId: string, expectedVersion: number): Promise<PersistedLeague>;
  importResultRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, text: string): Promise<PersistedLeague>;
  replaceResultRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, entries: RoundEntry[]): Promise<PersistedLeague>;
  addResultEntry(id: string, tournamentId: string, roundId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague>;
  editResultEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague>;
  deleteResultEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number): Promise<PersistedLeague>;
  updateResultPlayerArchetype(id: string, tournamentId: string, playerName: string, expectedVersion: number, archetype: string): Promise<PersistedLeague>;
  renameLeaguePlayerName(id: string, expectedVersion: number, fromName: string, toName: string): Promise<PersistedLeague>;
  restoreLeague(command: LeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague>;
  restoreFullLeagueData(command: FullLeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague[]>;
  /** Legacy-only whole-document path. Server adapter rejects it when leagueServer is enabled. */
  saveLeague(league: LeagueDocument, expectedVersion: number): Promise<PersistedLeague>;
  /** Legacy-only pre-restored insert. Server restores use restoreLeague/restoreFullLeagueData. */
  insertLeague(league: LeagueDocument): Promise<PersistedLeague>;
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

export function resolveLeagueBackendMode(leagueServer: boolean, apiBaseUrl: string): ApplicationBackend['mode'] {
  if (!leagueServer) return 'frontend-local';
  if (!apiBaseUrl) throw new Error('aspNetApiBaseUrlMissing');
  return 'aspnet-api';
}

export const APP_BACKEND = new InjectionToken<ApplicationBackend>('Gones application backend bridge', {
  providedIn: 'root',
  factory: () => resolveBackendMode(environment.features.apiBackend, environment.apiBaseUrl) === 'aspnet-api'
    ? inject(AspNetApiBackend)
    : inject(LocalFrontendBackend)
});

export const LEAGUE_BACKEND = new InjectionToken<LeagueBackendPort>('Gones League backend bridge', {
  providedIn: 'root',
  factory: () => resolveLeagueBackendMode(environment.features.leagueServer, environment.apiBaseUrl) === 'aspnet-api'
    ? inject(AspNetApiBackend)
    : inject(LocalFrontendBackend)
});
