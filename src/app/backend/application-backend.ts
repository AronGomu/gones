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

export interface AddArchiveRoundIntent {
  roundId: string;
  entries: RoundEntry[];
}

export interface ReplaceArchiveRoundIntent {
  roundId: string;
  entries: RoundEntry[];
}

export interface ArchiveTournamentEditBatchCommand {
  editTournament?: { name: string; tournamentDate: string };
  status?: LeagueStatus;
  addRounds: AddArchiveRoundIntent[];
  deleteRoundIds: string[];
  replaceRounds: ReplaceArchiveRoundIntent[];
  updateArchetypes: { playerName: string; archetype: string }[];
}

export interface ArchiveTournamentEditBatchResult {
  sourceLeague: PersistedLeague;
  destinationLeague: PersistedLeague | null;
}

/**
 * A whole store read in one answer. `truncated` is the store admitting it returned less than it holds
 * — the server catalog has a row cap (ADR 0039), so a caller that may not present a partial archive
 * as a complete one has something to check.
 */
export interface LeagueArchiveCatalog {
  leagues: PersistedLeague[];
  truncated: boolean;
}

export interface LeagueArchiveBackendPort {
  listLeagueArchives(): Promise<LeagueArchiveCatalog>;
  getLeagueArchive(id: string): Promise<PersistedLeague | null>;
  createLeagueArchive(name: string, idempotencyKey?: string): Promise<PersistedLeague>;
  renameLeagueArchive(id: string, expectedVersion: number, name: string): Promise<PersistedLeague>;
  changeLeagueArchiveStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeague>;
  deleteLeagueArchive(id: string, expectedVersion: number): Promise<void>;
  createArchiveTournament(id: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague>;
  editArchiveTournament(id: string, tournamentId: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague>;
  deleteArchiveTournament(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague>;
  moveArchiveTournament(id: string, tournamentId: string, expectedVersion: number, targetLeagueId: string, targetExpectedVersion: number): Promise<MoveResultTournamentResult>;
  applyArchiveTournamentEditBatch(sourceLeagueId: string, tournamentId: string, sourceExpectedVersion: number, command: ArchiveTournamentEditBatchCommand, target?: { leagueId: string; expectedVersion: number }): Promise<ArchiveTournamentEditBatchResult>;
  addArchiveRound(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague>;
  deleteArchiveRound(id: string, tournamentId: string, roundId: string, expectedVersion: number): Promise<PersistedLeague>;
  importArchiveRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, text: string): Promise<PersistedLeague>;
  replaceArchiveRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, entries: RoundEntry[]): Promise<PersistedLeague>;
  addArchiveEntry(id: string, tournamentId: string, roundId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague>;
  editArchiveEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague>;
  deleteArchiveEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number): Promise<PersistedLeague>;
  updateArchivePlayerArchetype(id: string, tournamentId: string, playerName: string, expectedVersion: number, archetype: string): Promise<PersistedLeague>;
  renameLeagueArchivePlayerName(id: string, expectedVersion: number, fromName: string, toName: string): Promise<PersistedLeague>;
  restoreLeagueArchive(command: LeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague>;
  restoreFullLeagueArchiveData(command: FullLeagueRestoreCommand, idempotencyKey?: string): Promise<PersistedLeague[]>;
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

export const LEAGUE_ARCHIVE_BACKEND = new InjectionToken<LeagueArchiveBackendPort>('Gones League Archive backend bridge', {
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
