import { isArchiveTournamentLocked, toLeagueDocument, toTournamentDocument } from '../domain/archive-models';
import type {
  ArchiveTournamentDocument, LeagueStatus, PersistedArchiveLeague, PersistedArchiveTournament, PersistedLeagueSeason
} from '../domain/archive-models';
import { calculateLeagueResult, calculateTournamentResult } from '../domain/results';
import { isLocalArchiveId } from './archive-origin';

/**
 * The read models of the archive catalog, shared by both authorities. Field names, nullability and
 * optionality are the wire contract of `/api/archive/**` — a browser-local row is projected into the
 * very same shape so a merged catalog (ADR 0028) stays uniform.
 *
 * No summary carries an `isLocal` flag: origin is already encoded in the id, so a caller that needs
 * it calls `isLocalArchiveId(row.id)`.
 */
export interface ArchiveCatalogResponse<T> {
  items: T[];
  totalCount: number;
  truncated: boolean;
}

export interface ArchiveLeagueSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  documentVersion: number;
}

export interface ArchiveLeagueSeasonSummary {
  id: string;
  name: string;
  leagueId: string;
  status: LeagueStatus;
  updatedAt: string;
  documentVersion: number;
  tournamentCount: number;
  playerCount: number;
  firstTournamentDate: string | null;   // null when the Season has no Tournament
  lastTournamentDate: string | null;
}

export interface ArchiveTournamentSummary {
  id: string;
  name: string;
  seasonId: string | null;
  tournamentDate: string;
  status: LeagueStatus;
  updatedAt: string;
  documentVersion: number;
  playerCount: number;
}

export interface ArchiveYearEntry {
  year: number;
  locked: boolean;
  tournamentCount: number;
}

export interface ArchiveYearsResponse {
  years: ArchiveYearEntry[];   // ascending by year
}

export function summarizeArchiveLeague(league: PersistedArchiveLeague): ArchiveLeagueSummary {
  return {
    id: league.id,
    name: league.name,
    createdAt: league.createdAt,
    updatedAt: league.updatedAt,
    documentVersion: league.documentVersion
  };
}

/**
 * The server denormalizes both counters onto its aggregate; a browser-local Season derives them here
 * with the very formula the backend mirrors — `calculateLeagueResult` — so the two halves of a merged
 * catalog never disagree.
 */
export function summarizeLeagueSeason(season: PersistedLeagueSeason, tournaments: readonly ArchiveTournamentDocument[]): ArchiveLeagueSeasonSummary {
  const dates = tournaments.map((tournament) => tournament.tournamentDate).filter(Boolean).sort((left, right) => left.localeCompare(right));
  return {
    id: season.id,
    name: season.name,
    leagueId: season.leagueId,
    status: season.status,
    updatedAt: season.updatedAt,
    documentVersion: season.documentVersion,
    tournamentCount: tournaments.length,
    playerCount: calculateLeagueResult(toLeagueDocument(season, tournaments)).rows.length,
    firstTournamentDate: dates[0] ?? null,
    lastTournamentDate: dates.at(-1) ?? null
  };
}

export function summarizeArchiveTournament(tournament: PersistedArchiveTournament): ArchiveTournamentSummary {
  return {
    id: tournament.id,
    name: tournament.name,
    seasonId: tournament.seasonId,
    tournamentDate: tournament.tournamentDate,
    status: tournament.status,
    updatedAt: tournament.updatedAt,
    documentVersion: tournament.documentVersion,
    playerCount: calculateTournamentResult(toTournamentDocument(tournament)).rows.length
  };
}

/**
 * The row-level lock: a browser-local row is never locked, whatever its date. `locked` is not on the
 * wire for a Tournament row on purpose — a row cached today as unlocked becomes locked later with no
 * refetch, so every reader derives it from the date it already holds.
 */
export function isArchiveTournamentRowLocked(row: Pick<ArchiveTournamentSummary, 'id' | 'tournamentDate'>, now: Date = new Date()): boolean {
  return !isLocalArchiveId(row.id) && isArchiveTournamentLocked(row.tournamentDate, now);
}

/** A Season is locked when every one of its Tournaments is — i.e. when its latest one is. */
export function isLeagueSeasonRowLocked(row: Pick<ArchiveLeagueSeasonSummary, 'id' | 'lastTournamentDate'>, now: Date = new Date()): boolean {
  return row.lastTournamentDate !== null && !isLocalArchiveId(row.id) && isArchiveTournamentLocked(row.lastTournamentDate, now);
}
