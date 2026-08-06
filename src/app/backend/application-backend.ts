import { InjectionToken, inject } from '@angular/core';
import { DataAuthority, dataAuthority } from '../config/data-authority';
import { LiveTournamentDocument } from '../domain/live-tournament';
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
}

/**
 * Whole-document League writes. They exist only in the legacy browser store, where the document in
 * `localStorage` *is* the source of truth; the server adapter has no equivalent and never will.
 */
export interface LegacyLeagueBackendPort extends LeagueBackendPort {
  saveLeague(league: LeagueDocument, expectedVersion: number): Promise<PersistedLeague>;
  /** Pre-restored insert. Server restores use restoreLeague/restoreFullLeagueData. */
  insertLeague(league: LeagueDocument): Promise<PersistedLeague>;
}

/** Legacy browser CalendarEvent documents. Server mode uses Scheduled Tournaments instead. */
export interface CalendarEventBackendPort {
  listCalendarEvents(): Promise<CalendarEventDocument[]>;
  saveCalendarEvent(event: CalendarEventDocument): Promise<CalendarEventDocument>;
  deleteCalendarEvent(id: string): Promise<void>;
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

/** Whole-document Live writes. Legacy browser store only; the server adapter has no equivalent. */
export interface LegacyLiveBackendPort extends LiveBackendPort {
  saveLiveTournament(document: LiveTournamentDocument): Promise<LiveTournamentDocument>;
}

export type BackendMode = 'frontend-local' | 'aspnet-api';

/**
 * The complete legacy browser adapter surface: intent commands plus the whole-document and
 * CalendarEvent paths that only ever existed while `localStorage` was the authority.
 */
export interface ApplicationBackend extends LegacyLeagueBackendPort, CalendarEventBackendPort, LegacyLiveBackendPort {
  readonly mode: BackendMode;
}

export function resolveLeagueBackendMode(authority: DataAuthority): BackendMode {
  return authority.serverAuthority ? 'aspnet-api' : 'frontend-local';
}

export function resolveLiveBackendMode(authority: DataAuthority): BackendMode {
  return authority.serverAuthority ? 'aspnet-api' : 'frontend-local';
}

/** The browser store adapter exists only under the legacy authority. */
export function legacyBrowserBackendAvailable(authority: DataAuthority): boolean {
  return authority.legacyBrowserAuthority;
}

export const LEAGUE_BACKEND = new InjectionToken<LeagueBackendPort>('Gones League backend bridge', {
  providedIn: 'root',
  factory: () => resolveLeagueBackendMode(dataAuthority()) === 'aspnet-api'
    ? inject(AspNetApiBackend)
    : inject(LocalFrontendBackend)
});

export const LIVE_BACKEND = new InjectionToken<LiveBackendPort>('Gones Live Tournament backend bridge', {
  providedIn: 'root',
  factory: () => resolveLiveBackendMode(dataAuthority()) === 'aspnet-api'
    ? inject(AspNetApiBackend)
    : inject(LocalFrontendBackend)
});

/**
 * Legacy-only browser store bridge. It resolves to `null` under the server authority, so a
 * server-mode build has no injectable second, browser-local source of truth at all. Callers that
 * still own a legacy-only path fail closed on the null through `requireLegacyBrowserStore`.
 */
export const LEGACY_BROWSER_BACKEND = new InjectionToken<ApplicationBackend | null>('Gones legacy browser store bridge', {
  providedIn: 'root',
  factory: () => legacyBrowserBackendAvailable(dataAuthority()) ? inject(LocalFrontendBackend) : null
});

/** Fail closed on a legacy-only path that a server-mode build reached. */
export function requireLegacyBrowserStore(store: ApplicationBackend | null, code: string): ApplicationBackend {
  if (!store) throw new Error(code);
  return store;
}
