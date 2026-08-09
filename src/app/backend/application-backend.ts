import { InjectionToken, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { DataAuthority, dataAuthority } from '../config/data-authority';
import { LiveTournamentDocument } from '../domain/live-tournament';
import { LeagueDocument, LeagueStatus, PersistedLeague, RoundEntry } from '../domain/models';
import { AspNetApiBackend } from './aspnet-api-backend.service';
import { LocalLiveBackend } from './local-live-backend.service';

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
}

export interface LiveSettingsCommand {
  name: string;
  leagueId: string;
  tournamentDate: string;
  roundCount: number;
  customRoundCount: boolean;
  paidTrackingEnabled: boolean;
}

export interface LivePlayerCommand {
  name: string;
  initialWins: number;
  initialDraws: number;
  initialLosses: number;
  archetype: string;
}

export interface LiveScoreCommand {
  player1Score: number;
  player2Score: number;
}

export interface LiveFinalizeResult {
  liveTournamentId: string;
  leagueId: string;
  finalizedTournamentId: string;
  liveDocumentVersion: number;
}

export interface LiveBackendPort {
  listLiveTournaments(): Promise<LiveTournamentDocument[]>;
  getLiveTournament(id: string): Promise<LiveTournamentDocument | null>;
  createLiveTournament(tournamentDate: string, idempotencyKey?: string): Promise<LiveTournamentDocument>;
  deleteLiveTournament(id: string, expectedVersion: number): Promise<void>;
  updateLiveSettings(id: string, expectedVersion: number, settings: LiveSettingsCommand): Promise<LiveTournamentDocument>;
  addLivePlayer(id: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument>;
  editLivePlayer(id: string, playerId: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument>;
  setLivePlayerPaid(id: string, playerId: string, expectedVersion: number, paid: boolean): Promise<LiveTournamentDocument>;
  dropLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument>;
  removeLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument>;
  startLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument>;
  regenerateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument>;
  cancelLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument>;
  validateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument>;
  scoreLiveRoundEntry(id: string, roundId: string, entryId: string, expectedVersion: number, score: LiveScoreCommand): Promise<LiveTournamentDocument>;
  restoreLiveCheckpoint(id: string, checkpointId: string, expectedVersion: number): Promise<LiveTournamentDocument>;
  finalizeLiveTournament(id: string, expectedVersion: number, idempotencyKey?: string): Promise<LiveFinalizeResult>;
}

export type BackendMode = 'aspnet-api';

export type LiveBackendMode = 'aspnet-api' | 'browser-local';

/**
 * The API adapter is the only adapter. ADR 0020 removed the browser store, so there is no second
 * source of truth to bridge to and no whole-document or CalendarEvent write path to expose: every
 * mutation is an explicit server intent command guarded by the document version (If-Match ETag).
 *
 * This stays the League authority check. Only the Live port has a second adapter (ADR 0021).
 */
export function resolveBackendMode(authority: DataAuthority): BackendMode {
  if (!authority.serverAuthority) throw new Error('serverAuthorityRequired');
  return 'aspnet-api';
}

/**
 * Role-scoped Live authority (ADR 0021). `Organizer` and `Admin` keep the server-authoritative
 * adapter; anonymous visitors and the plain `User` role get a strictly offline browser store that
 * never synchronises. The non-server authority is still refused, so ADR 0020's failure-closed
 * startup is preserved.
 */
export function resolveLiveBackendMode(authority: DataAuthority, globalRole: string | undefined): LiveBackendMode {
  if (!authority.serverAuthority) throw new Error('serverAuthorityRequired');
  return globalRole === 'Organizer' || globalRole === 'Admin' ? 'aspnet-api' : 'browser-local';
}

export const LEAGUE_BACKEND = new InjectionToken<LeagueBackendPort>('Gones League backend bridge', {
  providedIn: 'root',
  factory: () => {
    resolveBackendMode(dataAuthority());
    return inject(AspNetApiBackend);
  }
});

/**
 * The Live authority is decided once, here, from the profile `AuthService.bootstrap()` loaded before
 * the first route renders. A role granted mid-session takes effect on the next reload — deliberate,
 * see ADR 0021; there is no reactive re-resolution.
 */
export const LIVE_BACKEND_MODE = new InjectionToken<LiveBackendMode>('Gones Live Tournament authority', {
  providedIn: 'root',
  factory: () => resolveLiveBackendMode(dataAuthority(), inject(AuthService).profile()?.globalRole)
});

export const LIVE_BACKEND = new InjectionToken<LiveBackendPort>('Gones Live Tournament backend bridge', {
  providedIn: 'root',
  factory: () => inject(LIVE_BACKEND_MODE) === 'aspnet-api' ? inject(AspNetApiBackend) : inject(LocalLiveBackend)
});
