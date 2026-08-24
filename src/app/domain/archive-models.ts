import { createRound, defaultIdFactory, getDefaultTournamentName, normalizeLeagueStatus, normalizeTournamentStatus } from './models';
import type { CalendarEventDocument, IdFactory, LeagueDocument, LeagueStatus, PlayerArchetypeDocument, RoundDocument, TournamentDocument } from './models';
import { derivePlayerArchetypesFromRounds, normalizePlayerArchetypes } from './tournament-archetypes';

/**
 * The three-tier Archive — League → LeagueSeason → Tournament. A Tournament is a first-class
 * top-level record: it carries no `leagueId`, and `seasonId: null` means it stands alone.
 *
 * Shared non-archive shapes stay in `models.ts` and are re-exported here, never duplicated: two
 * declarations of the same round shape would drift, and every import site would have to pick one.
 */
export type {
  LeagueStatus, RoundDocument, RoundEntry, MatchRoundEntry, ByeRoundEntry,
  InvalidRoundEntry, PlayerArchetypeDocument, CalendarEventDocument
} from './models';

export const ARCHIVE_DATA_VERSION = 5;
export const SUPPORTED_ARCHIVE_IMPORT_VERSIONS = [5] as const;
export const ARCHIVE_LOCK_WINDOW_DAYS = 365;

const DAY_MS = 86_400_000;
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

/** Top tier. Groups Seasons. Has no page of its own — it is a column and a filter. */
export interface ArchiveLeagueDocument {
  id: string;
  name: string;
  createdAt: string;   // ISO 8601 UTC
}

export interface PersistedArchiveLeague extends ArchiveLeagueDocument {
  documentVersion: number;
  updatedAt: string;   // ISO 8601 UTC
  eTag?: string;
}

/** Middle tier. Mandatory parent League. What used to be called a League. */
export interface LeagueSeasonDocument {
  id: string;
  name: string;
  leagueId: string;    // mandatory — a Season always belongs to a League
  status: LeagueStatus;
}

export interface PersistedLeagueSeason extends LeagueSeasonDocument {
  documentVersion: number;
  updatedAt: string;
  eTag?: string;
}

/**
 * Bottom tier, now top-level: every Tournament is its own row. `seasonId: null` means standalone.
 * There is NO `leagueId` — the League is derived by joining through `seasonId`.
 */
export interface ArchiveTournamentDocument {
  id: string;
  name: string;
  seasonId: string | null;
  tournamentDate: string;   // ISO 8601 date, `YYYY-MM-DD`
  status: LeagueStatus;
  rounds: RoundDocument[];
  playerArchetypes: PlayerArchetypeDocument[];
}

export interface PersistedArchiveTournament extends ArchiveTournamentDocument {
  documentVersion: number;
  updatedAt: string;
  eTag?: string;
}

export interface ArchiveBundle {
  version: typeof ARCHIVE_DATA_VERSION;
  leagues: ArchiveLeagueDocument[];
  leagueSeasons: LeagueSeasonDocument[];
  tournaments: ArchiveTournamentDocument[];
  calendarEvents: CalendarEventDocument[];
}

export type ArchiveLeagueInput = Partial<ArchiveLeagueDocument>;
export type LeagueSeasonInput = Partial<LeagueSeasonDocument>;
export interface ArchiveTournamentInput extends Partial<Omit<ArchiveTournamentDocument, 'rounds' | 'playerArchetypes'>> {
  rounds?: RoundDocument[];
  playerArchetypes?: PlayerArchetypeDocument[];
}

/** `''`, whitespace, `null` and `undefined` all mean standalone. */
export function normalizeSeasonId(seasonId: string | null | undefined): string | null {
  const text = String(seasonId ?? '').trim();
  return text || null;
}

/**
 * A brand-new League is created by an adapter, which passes an explicit `createdAt`; the epoch
 * fallback exists only for a stored row that lost the field. A `new Date()` here would make every
 * read of that row return a different document.
 */
export function createArchiveLeague(
  { id, name = 'New League', createdAt }: ArchiveLeagueInput = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): ArchiveLeagueDocument {
  return {
    id: id ?? idFactory(),
    name: String(name || 'New League').trim() || 'New League',
    createdAt: normalizeInstant(createdAt)
  };
}

export function createLeagueSeason(
  { id, name = 'New Season', leagueId = '', status }: LeagueSeasonInput = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): LeagueSeasonDocument {
  return {
    id: id ?? idFactory(),
    name: String(name || 'New Season').trim() || 'New Season',
    leagueId: String(leagueId ?? ''),
    status: normalizeLeagueStatus(status)
  };
}

export function createArchiveTournament(
  { id, name = getDefaultTournamentName(), seasonId = null, tournamentDate = '', status, rounds = [], playerArchetypes }: ArchiveTournamentInput = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): ArchiveTournamentDocument {
  const normalizedRounds = (Array.isArray(rounds) ? rounds : []).map((round) => createRound(round, { idFactory }));
  return {
    id: id ?? idFactory(),
    name: String(name || getDefaultTournamentName()).trim() || getDefaultTournamentName(),
    seasonId: normalizeSeasonId(seasonId),
    tournamentDate: String(tournamentDate ?? ''),
    status: normalizeTournamentStatus(status),
    rounds: normalizedRounds,
    playerArchetypes: normalizePlayerArchetypes(playerArchetypes ?? derivePlayerArchetypesFromRounds({ rounds: normalizedRounds }))
  };
}

export function normalizeArchiveLeague(league: ArchiveLeagueInput = {}, options: { idFactory?: IdFactory } = {}): ArchiveLeagueDocument {
  return createArchiveLeague(league, options);
}

export function normalizeLeagueSeason(season: LeagueSeasonInput = {}, options: { idFactory?: IdFactory } = {}): LeagueSeasonDocument {
  return createLeagueSeason(season, options);
}

export function normalizeArchiveTournament(tournament: ArchiveTournamentInput = {}, options: { idFactory?: IdFactory } = {}): ArchiveTournamentDocument {
  return createArchiveTournament(tournament, options);
}

/** Bridges to the shared standings/rename/archetype functions, which still speak the legacy shape. */
export function toTournamentDocument(tournament: ArchiveTournamentDocument, leagueId = ''): TournamentDocument {
  const { seasonId: _seasonId, ...rest } = tournament;
  return { ...rest, leagueId };
}

export function toArchiveTournamentDocument(tournament: TournamentDocument, seasonId: string | null = null): ArchiveTournamentDocument {
  const { leagueId: _leagueId, ...rest } = tournament;
  return { ...rest, seasonId: normalizeSeasonId(seasonId) };
}

export function toLeagueDocument(season: LeagueSeasonDocument, tournaments: readonly ArchiveTournamentDocument[]): LeagueDocument {
  return {
    id: season.id,
    name: season.name,
    status: season.status,
    tournaments: tournaments.map((tournament) => toTournamentDocument(tournament, season.id))
  };
}

/**
 * `locked ⇔ (now − tournamentDate) > 365`, counted in whole UTC calendar days. Exactly 365 days old
 * is not locked; 366 days old is. Compared on the UTC day on purpose: the same row must lock on the
 * same date for every reader, whatever their timezone, and must agree with the C# `ArchiveLockRule`.
 */
export function isArchiveTournamentLocked(tournamentDate: string, now: Date = new Date()): boolean {
  const played = utcDayNumber(tournamentDate);
  if (played === null) return false;
  const today = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / DAY_MS);
  return today - played > ARCHIVE_LOCK_WINDOW_DAYS;
}

/** A stored date that does not round-trip (`2026-02-30`, `2027-02-29`, junk) is not a date at all. */
function utcDayNumber(date: string): number | null {
  const text = String(date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const value = Date.parse(`${text}T00:00:00.000Z`);
  if (Number.isNaN(value)) return null;
  return new Date(value).toISOString().slice(0, 10) === text ? Math.floor(value / DAY_MS) : null;
}

/** Canonical UTC ISO 8601, or the epoch for a row that never carried a stamp. */
function normalizeInstant(value: unknown, fallback = EPOCH_ISO): string {
  const parsed = Date.parse(String(value ?? '').trim());
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
}
