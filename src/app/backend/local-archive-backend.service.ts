import { Injectable } from '@angular/core';
import { newLocalArchiveId } from '../data/archive-origin';
import { summarizeArchiveLeague, summarizeArchiveTournament, summarizeLeagueSeason } from '../data/archive-summary';
import type { ArchiveCatalogResponse, ArchiveLeagueSeasonSummary, ArchiveLeagueSummary, ArchiveTournamentSummary } from '../data/archive-summary';
import {
  createArchiveLeague,
  createArchiveTournament,
  createLeagueSeason,
  normalizeArchiveLeague,
  normalizeArchiveTournament,
  normalizeLeagueSeason,
  normalizeSeasonId,
  SUPPORTED_ARCHIVE_IMPORT_VERSIONS
} from '../domain/archive-models';
import type {
  ArchiveBundle,
  ArchiveLeagueDocument,
  ArchiveTournamentDocument,
  LeagueSeasonDocument,
  LeagueStatus,
  PersistedArchiveLeague,
  PersistedArchiveTournament,
  PersistedLeagueSeason,
  RoundDocument,
  RoundEntry
} from '../domain/archive-models';
import { createRound, trimPlayerName } from '../domain/models';
import { renamePlayerInTournament } from '../domain/rename-player';
import { importRoundEntries } from '../domain/round-import';
import { setTournamentPlayerArchetype } from '../domain/tournament-archetypes';
import { get, getAll, openDatabase, put, requestResult, runTransaction } from './indexed-db';

/**
 * Browser-local three-tier Archive authority (ADR 0028) — the browser half of the merged catalog,
 * next to the Live one (ADR 0021). Nothing here talks to the network and nothing is ever synchronised
 * in either direction: a record belongs to this store for its whole life, and its `local-` id prefix
 * is the whole routing rule.
 *
 * Every rule lives in `src/app/domain/archive-models.ts`. This adapter only loads a row, hands it to
 * a pure domain function, guards the version and writes the result back.
 */
export const LOCAL_ARCHIVE_DB_NAME = 'gones-archive-local';
export const LOCAL_ARCHIVE_DB_VERSION = 1;
export const LOCAL_LEAGUE_STORE = 'leagues';
export const LOCAL_LEAGUE_SEASON_STORE = 'league-seasons';
export const LOCAL_TOURNAMENT_STORE = 'tournaments';

const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
const STABLE_ROUND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deletes the retired `gones-leagues` database (ADR 0028's first browser-local store) once per page
 * load. Gones is unreleased, so this exists only so a developer's browser does not keep a dead store
 * forever. Best-effort and non-blocking: a browser that blocks the delete (another tab still has the
 * database open) is left alone and retried on the next load.
 */
export function purgeRetiredLeagueDatabase(): void {
  if (typeof indexedDB === 'undefined') return;
  try {
    indexedDB.deleteDatabase('gones-leagues');
  } catch {
    /* a blocked delete is retried next load */
  }
}

/**
 * Stale-write rejection with the shape `archive-command-ux.ts` classifies as `stale`: it keys on
 * `status === 412` first and on this exact message second, so both authorities produce the identical
 * "reload the latest document and reapply" conflict UX. The message stays camelCase on purpose — it
 * is a browser-local string, not a wire code.
 */
export class ArchiveConcurrencyError extends Error {
  readonly status = 412;

  constructor() {
    super('staleArchiveDocument');
    this.name = 'ArchiveConcurrencyError';
  }
}

/** A League is deleted only once it holds no Season. Mirrors the server's `409`. */
export class ArchiveLeagueNotEmptyError extends Error {
  readonly status = 409;

  constructor() {
    super('archiveLeagueNotEmpty');
    this.name = 'ArchiveLeagueNotEmptyError';
  }
}

/** `subject` names the tier, so a caller can phrase the message; the classifier only reads `status`. */
export class ArchiveNotFoundError extends Error {
  readonly status = 404;

  constructor(readonly subject: 'league' | 'leagueSeason' | 'tournament') {
    super('archiveRecordNotFound');
    this.name = 'ArchiveNotFoundError';
  }
}

export interface ArchiveRoundIntent {
  roundId: string;
  entries: RoundEntry[];
}

/**
 * One staged save (ADR 0037). Because a Tournament is now its own row with its own version, a move
 * is just `moveToSeasonId` inside the same batch — there is no second document to version-guard.
 * `moveToSeasonId` absent ⇒ the Tournament does not move. Present and `null` ⇒ it becomes standalone.
 */
export interface ArchiveTournamentEditBatch {
  editTournament?: { name: string; tournamentDate: string };
  status?: LeagueStatus;
  moveToSeasonId?: string | null;
  addRounds: ArchiveRoundIntent[];
  deleteRoundIds: string[];
  replaceRounds: ArchiveRoundIntent[];
  updateArchetypes: { playerName: string; archetype: string }[];
}

export interface ArchiveRestoreResult {
  leagues: PersistedArchiveLeague[];
  leagueSeasons: PersistedLeagueSeason[];
  tournaments: PersistedArchiveTournament[];
}

/**
 * The archive authority port. Implemented here by the browser-local store; the server adapter
 * implements the same shape against `/api/archive/**` in a later ticket, which is why every create
 * and the restore accept an optional `idempotencyKey` this implementation ignores.
 */
export interface ArchiveBackendPort {
  listArchiveLeagues(): Promise<ArchiveCatalogResponse<PersistedArchiveLeague>>;
  listArchiveLeagueSummaries(): Promise<ArchiveCatalogResponse<ArchiveLeagueSummary>>;
  listLeagueSeasons(): Promise<ArchiveCatalogResponse<PersistedLeagueSeason>>;
  listLeagueSeasonSummaries(): Promise<ArchiveCatalogResponse<ArchiveLeagueSeasonSummary>>;
  listArchiveTournaments(): Promise<ArchiveCatalogResponse<PersistedArchiveTournament>>;
  listArchiveTournamentSummaries(): Promise<ArchiveCatalogResponse<ArchiveTournamentSummary>>;
  listSeasonTournamentSummaries(seasonId: string | null): Promise<ArchiveCatalogResponse<ArchiveTournamentSummary>>;
  getArchiveLeague(id: string): Promise<PersistedArchiveLeague | null>;
  getLeagueSeason(id: string): Promise<PersistedLeagueSeason | null>;
  getArchiveTournament(id: string): Promise<PersistedArchiveTournament | null>;

  createArchiveLeague(name: string, idempotencyKey?: string): Promise<PersistedArchiveLeague>;
  renameArchiveLeague(id: string, expectedVersion: number, name: string): Promise<PersistedArchiveLeague>;
  deleteArchiveLeague(id: string, expectedVersion: number): Promise<void>;

  createLeagueSeason(leagueId: string, name: string, idempotencyKey?: string): Promise<PersistedLeagueSeason>;
  renameLeagueSeason(id: string, expectedVersion: number, name: string): Promise<PersistedLeagueSeason>;
  changeLeagueSeasonStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeagueSeason>;
  moveLeagueSeason(id: string, expectedVersion: number, leagueId: string): Promise<PersistedLeagueSeason>;
  deleteLeagueSeason(id: string, expectedVersion: number): Promise<void>;

  createArchiveTournament(seasonId: string | null, name: string, tournamentDate: string, idempotencyKey?: string): Promise<PersistedArchiveTournament>;
  editArchiveTournament(id: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedArchiveTournament>;
  moveArchiveTournament(id: string, expectedVersion: number, seasonId: string | null): Promise<PersistedArchiveTournament>;
  deleteArchiveTournament(id: string, expectedVersion: number): Promise<void>;
  addArchiveRound(id: string, expectedVersion: number): Promise<PersistedArchiveTournament>;
  deleteArchiveRound(id: string, roundId: string, expectedVersion: number): Promise<PersistedArchiveTournament>;
  importArchiveRound(id: string, roundId: string, expectedVersion: number, text: string): Promise<PersistedArchiveTournament>;
  replaceArchiveRound(id: string, roundId: string, expectedVersion: number, entries: RoundEntry[]): Promise<PersistedArchiveTournament>;
  addArchiveEntry(id: string, roundId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedArchiveTournament>;
  editArchiveEntry(id: string, roundId: string, entryId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedArchiveTournament>;
  deleteArchiveEntry(id: string, roundId: string, entryId: string, expectedVersion: number): Promise<PersistedArchiveTournament>;
  updateArchiveTournamentArchetype(id: string, expectedVersion: number, playerName: string, archetype: string): Promise<PersistedArchiveTournament>;
  renameArchiveTournamentPlayer(id: string, expectedVersion: number, fromName: string, toName: string): Promise<PersistedArchiveTournament>;
  applyArchiveTournamentEditBatch(id: string, expectedVersion: number, batch: ArchiveTournamentEditBatch): Promise<PersistedArchiveTournament>;

  restoreArchiveBundle(bundle: ArchiveBundle, idempotencyKey?: string): Promise<ArchiveRestoreResult>;
}

@Injectable({ providedIn: 'root' })
export class LocalArchiveBackend implements ArchiveBackendPort {
  private database?: Promise<IDBDatabase>;

  async listArchiveLeagues(): Promise<ArchiveCatalogResponse<PersistedArchiveLeague>> {
    return catalog(await this.readLeagues());
  }

  async listArchiveLeagueSummaries(): Promise<ArchiveCatalogResponse<ArchiveLeagueSummary>> {
    return catalog((await this.readLeagues()).map(summarizeArchiveLeague));
  }

  async listLeagueSeasons(): Promise<ArchiveCatalogResponse<PersistedLeagueSeason>> {
    return catalog(await this.readSeasons());
  }

  /** One readonly transaction over both stores, so a Season's counters and its Tournaments are one snapshot. */
  async listLeagueSeasonSummaries(): Promise<ArchiveCatalogResponse<ArchiveLeagueSeasonSummary>> {
    const database = await this.open();
    return catalog(await runTransaction(database, [LOCAL_LEAGUE_SEASON_STORE, LOCAL_TOURNAMENT_STORE], 'readonly', async (transaction) => {
      const seasonRows = await requestResult<Partial<PersistedLeagueSeason>[]>(transaction.objectStore(LOCAL_LEAGUE_SEASON_STORE).getAll());
      const tournamentRows = await requestResult<Partial<PersistedArchiveTournament>[]>(transaction.objectStore(LOCAL_TOURNAMENT_STORE).getAll());
      const tournaments = tournamentRows.map((row) => this.persistTournament(row));
      return seasonRows
        .map((row) => this.persistSeason(row))
        .sort(byUpdatedAt)
        .map((season) => summarizeLeagueSeason(season, tournaments.filter((tournament) => tournament.seasonId === season.id)));
    }));
  }

  async listArchiveTournaments(): Promise<ArchiveCatalogResponse<PersistedArchiveTournament>> {
    return catalog(await this.readTournaments());
  }

  async listArchiveTournamentSummaries(): Promise<ArchiveCatalogResponse<ArchiveTournamentSummary>> {
    return catalog((await this.readTournaments()).map(summarizeArchiveTournament));
  }

  /** `null` selects the standalone Tournaments. The store is small and hand-authored, so this filters in memory. */
  async listSeasonTournamentSummaries(seasonId: string | null): Promise<ArchiveCatalogResponse<ArchiveTournamentSummary>> {
    const target = normalizeSeasonId(seasonId);
    return catalog((await this.readTournaments()).filter((row) => row.seasonId === target).map(summarizeArchiveTournament));
  }

  async getArchiveLeague(id: string): Promise<PersistedArchiveLeague | null> {
    const stored = await get<Partial<PersistedArchiveLeague>>(await this.open(), LOCAL_LEAGUE_STORE, id);
    return stored ? this.persistLeague(stored) : null;
  }

  async getLeagueSeason(id: string): Promise<PersistedLeagueSeason | null> {
    const stored = await get<Partial<PersistedLeagueSeason>>(await this.open(), LOCAL_LEAGUE_SEASON_STORE, id);
    return stored ? this.persistSeason(stored) : null;
  }

  async getArchiveTournament(id: string): Promise<PersistedArchiveTournament | null> {
    const stored = await get<Partial<PersistedArchiveTournament>>(await this.open(), LOCAL_TOURNAMENT_STORE, id);
    return stored ? this.persistTournament(stored) : null;
  }

  async createArchiveLeague(name: string, _idempotencyKey?: string): Promise<PersistedArchiveLeague> {
    const timestamp = new Date().toISOString();
    const created: PersistedArchiveLeague = {
      ...createArchiveLeague({ id: newLocalArchiveId(), name, createdAt: timestamp }),
      documentVersion: 1,
      updatedAt: timestamp
    };
    await put(await this.open(), LOCAL_LEAGUE_STORE, created);
    return created;
  }

  renameArchiveLeague(id: string, expectedVersion: number, name: string): Promise<PersistedArchiveLeague> {
    return this.mutateLeague(id, expectedVersion, (league) => ({ ...league, name }));
  }

  /** One transaction over both stores: a League that still holds a Season is refused before anything is written. */
  async deleteArchiveLeague(id: string, expectedVersion: number): Promise<void> {
    const database = await this.open();
    await runTransaction(database, [LOCAL_LEAGUE_STORE, LOCAL_LEAGUE_SEASON_STORE], 'readwrite', async (transaction) => {
      const current = await this.requireLeague(transaction, id);
      if (current.documentVersion !== expectedVersion) throw new ArchiveConcurrencyError();
      const seasons = await requestResult<Partial<PersistedLeagueSeason>[]>(transaction.objectStore(LOCAL_LEAGUE_SEASON_STORE).getAll());
      if (seasons.some((season) => season.leagueId === id)) throw new ArchiveLeagueNotEmptyError();
      await requestResult(transaction.objectStore(LOCAL_LEAGUE_STORE).delete(id));
    });
  }

  async createLeagueSeason(leagueId: string, name: string, _idempotencyKey?: string): Promise<PersistedLeagueSeason> {
    const database = await this.open();
    return runTransaction(database, [LOCAL_LEAGUE_SEASON_STORE, LOCAL_LEAGUE_STORE], 'readwrite', async (transaction) => {
      await this.requireLeague(transaction, leagueId);
      const timestamp = new Date().toISOString();
      const created: PersistedLeagueSeason = {
        ...createLeagueSeason({ id: newLocalArchiveId(), name, leagueId, status: 'active' }),
        documentVersion: 1,
        updatedAt: timestamp
      };
      await requestResult(transaction.objectStore(LOCAL_LEAGUE_SEASON_STORE).put(created));
      return created;
    });
  }

  renameLeagueSeason(id: string, expectedVersion: number, name: string): Promise<PersistedLeagueSeason> {
    return this.mutateSeason(id, expectedVersion, (season) => ({ ...season, name }));
  }

  changeLeagueSeasonStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeagueSeason> {
    return this.mutateSeason(id, expectedVersion, (season) => ({ ...season, status }));
  }

  moveLeagueSeason(id: string, expectedVersion: number, leagueId: string): Promise<PersistedLeagueSeason> {
    return this.mutateSeason(id, expectedVersion, async (season, transaction) => {
      await this.requireLeague(transaction, leagueId);
      return { ...season, leagueId };
    }, [LOCAL_LEAGUE_STORE]);
  }

  /** Detach, never cascade: the Season row goes, every Tournament that referenced it stays and becomes standalone. */
  async deleteLeagueSeason(id: string, expectedVersion: number): Promise<void> {
    const database = await this.open();
    await runTransaction(database, [LOCAL_LEAGUE_SEASON_STORE, LOCAL_TOURNAMENT_STORE], 'readwrite', async (transaction) => {
      const current = await this.requireSeason(transaction, id);
      if (current.documentVersion !== expectedVersion) throw new ArchiveConcurrencyError();
      const tournaments = transaction.objectStore(LOCAL_TOURNAMENT_STORE);
      const rows = await requestResult<Partial<PersistedArchiveTournament>[]>(tournaments.getAll());
      const detached = rows.map((row) => this.persistTournament(row)).filter((row) => row.seasonId === id);
      const timestamp = new Date().toISOString();
      await requestResult(transaction.objectStore(LOCAL_LEAGUE_SEASON_STORE).delete(id));
      for (const tournament of detached) {
        await requestResult(tournaments.put({ ...tournament, seasonId: null, documentVersion: tournament.documentVersion + 1, updatedAt: timestamp }));
      }
    });
  }

  async createArchiveTournament(seasonId: string | null, name: string, tournamentDate: string, _idempotencyKey?: string): Promise<PersistedArchiveTournament> {
    const target = normalizeSeasonId(seasonId);
    const database = await this.open();
    return runTransaction(database, [LOCAL_TOURNAMENT_STORE, LOCAL_LEAGUE_SEASON_STORE], 'readwrite', async (transaction) => {
      if (target !== null) await this.requireSeason(transaction, target);
      const timestamp = new Date().toISOString();
      const created: PersistedArchiveTournament = {
        ...createArchiveTournament({ id: newLocalArchiveId(), name, tournamentDate, seasonId: target, status: 'active' }),
        documentVersion: 1,
        updatedAt: timestamp
      };
      await requestResult(transaction.objectStore(LOCAL_TOURNAMENT_STORE).put(created));
      return created;
    });
  }

  editArchiveTournament(id: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedArchiveTournament> {
    return this.mutateTournament(id, expectedVersion, (tournament) => ({ ...tournament, name, tournamentDate }));
  }

  moveArchiveTournament(id: string, expectedVersion: number, seasonId: string | null): Promise<PersistedArchiveTournament> {
    return this.mutateTournament(id, expectedVersion, async (tournament, transaction) => {
      const target = normalizeSeasonId(seasonId);
      if (target !== null) await this.requireSeason(transaction, target);
      return { ...tournament, seasonId: target };
    }, [LOCAL_LEAGUE_SEASON_STORE]);
  }

  async deleteArchiveTournament(id: string, expectedVersion: number): Promise<void> {
    const database = await this.open();
    await runTransaction(database, [LOCAL_TOURNAMENT_STORE], 'readwrite', async (transaction) => {
      const current = await this.requireTournament(transaction, id);
      if (current.documentVersion !== expectedVersion) throw new ArchiveConcurrencyError();
      await requestResult(transaction.objectStore(LOCAL_TOURNAMENT_STORE).delete(id));
    });
  }

  addArchiveRound(id: string, expectedVersion: number): Promise<PersistedArchiveTournament> {
    return this.mutateTournament(id, expectedVersion, (tournament) => ({ ...tournament, rounds: [...tournament.rounds, createRound({})] }));
  }

  deleteArchiveRound(id: string, roundId: string, expectedVersion: number): Promise<PersistedArchiveTournament> {
    return this.mutateTournament(id, expectedVersion, (tournament) => ({ ...tournament, rounds: tournament.rounds.filter((round) => round.id !== roundId) }));
  }

  /** `importRoundEntries` returns an `ImportResult` wrapper; the round takes its `entries`. */
  importArchiveRound(id: string, roundId: string, expectedVersion: number, text: string): Promise<PersistedArchiveTournament> {
    return this.mutateRound(id, roundId, expectedVersion, (round) => createRound({ id: round.id, entries: importRoundEntries(text).entries }));
  }

  replaceArchiveRound(id: string, roundId: string, expectedVersion: number, entries: RoundEntry[]): Promise<PersistedArchiveTournament> {
    return this.mutateRound(id, roundId, expectedVersion, (round) => createRound({ id: round.id, entries }));
  }

  addArchiveEntry(id: string, roundId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedArchiveTournament> {
    return this.mutateRound(id, roundId, expectedVersion, (round) => createRound({ id: round.id, entries: [...round.entries, entry] }));
  }

  editArchiveEntry(id: string, roundId: string, entryId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedArchiveTournament> {
    return this.mutateRound(id, roundId, expectedVersion, (round) => createRound({
      id: round.id,
      entries: round.entries.map((item) => item.id === entryId ? { ...entry, id: entryId } : item)
    }));
  }

  deleteArchiveEntry(id: string, roundId: string, entryId: string, expectedVersion: number): Promise<PersistedArchiveTournament> {
    return this.mutateRound(id, roundId, expectedVersion, (round) => createRound({ id: round.id, entries: round.entries.filter((item) => item.id !== entryId) }));
  }

  updateArchiveTournamentArchetype(id: string, expectedVersion: number, playerName: string, archetype: string): Promise<PersistedArchiveTournament> {
    return this.mutateTournament(id, expectedVersion, (tournament) => withArchetype(tournament, playerName, archetype));
  }

  renameArchiveTournamentPlayer(id: string, expectedVersion: number, fromName: string, toName: string): Promise<PersistedArchiveTournament> {
    return this.mutateTournament(id, expectedVersion, (tournament) =>
      renamePlayerInTournament(tournament, fromName, toName));
  }

  applyArchiveTournamentEditBatch(id: string, expectedVersion: number, batch: ArchiveTournamentEditBatch): Promise<PersistedArchiveTournament> {
    return this.mutateTournament(id, expectedVersion, async (tournament, transaction) => {
      const next = applyEditBatch(tournament, batch);
      if (batch.moveToSeasonId !== undefined && next.seasonId !== null) await this.requireSeason(transaction, next.seasonId);
      return next;
    }, [LOCAL_LEAGUE_SEASON_STORE]);
  }

  /**
   * Additive and id-minting, exactly like the server's restore: every row lands under a freshly minted
   * `local-` id and every parent link is remapped, so importing a bundle can never overwrite a live
   * record and importing the same bundle twice yields two independent copies. `calendarEvents` is
   * ignored — the Calendar is server-owned and is not part of the browser-local archive.
   */
  async restoreArchiveBundle(bundle: ArchiveBundle, _idempotencyKey?: string): Promise<ArchiveRestoreResult> {
    if (!(SUPPORTED_ARCHIVE_IMPORT_VERSIONS as readonly number[]).includes(bundle.version)) throw new Error('unsupportedArchiveBundleVersion');
    const database = await this.open();
    const taken = new Set((await getAll<Partial<PersistedArchiveLeague>>(database, LOCAL_LEAGUE_STORE)).map((row) => String(row.name ?? '')));
    const leagueIds = new Map(bundle.leagues.map((league) => [league.id, newLocalArchiveId()]));
    const seasonIds = new Map(bundle.leagueSeasons.map((season) => [season.id, newLocalArchiveId()]));
    for (const season of bundle.leagueSeasons) {
      if (!leagueIds.has(season.leagueId)) throw new Error('unresolvedArchiveBundleLink:leagueSeasons');
    }
    for (const tournament of bundle.tournaments) {
      if (tournament.seasonId !== null && !seasonIds.has(tournament.seasonId)) throw new Error('unresolvedArchiveBundleLink:tournaments');
    }
    const timestamp = new Date().toISOString();

    const leagues: PersistedArchiveLeague[] = bundle.leagues.map((league) => {
      const name = uniqueRestoredName(createArchiveLeague(league).name, taken);
      taken.add(name);
      return { ...createArchiveLeague({ ...league, id: leagueIds.get(league.id), name }), documentVersion: 1, updatedAt: timestamp };
    });
    const leagueSeasons: PersistedLeagueSeason[] = bundle.leagueSeasons.map((season) => ({
      ...createLeagueSeason({ ...season, id: seasonIds.get(season.id), leagueId: leagueIds.get(season.leagueId) ?? '' }),
      documentVersion: 1,
      updatedAt: timestamp
    }));
    const tournaments: PersistedArchiveTournament[] = bundle.tournaments.map((tournament) => ({
      ...createArchiveTournament({ ...tournament, id: newLocalArchiveId(), seasonId: seasonIds.get(tournament.seasonId ?? '') ?? null }),
      documentVersion: 1,
      updatedAt: timestamp
    }));

    await runTransaction(database, [LOCAL_LEAGUE_STORE, LOCAL_LEAGUE_SEASON_STORE, LOCAL_TOURNAMENT_STORE], 'readwrite', async (transaction) => {
      await Promise.all([
        ...leagues.map((row) => requestResult(transaction.objectStore(LOCAL_LEAGUE_STORE).put(row))),
        ...leagueSeasons.map((row) => requestResult(transaction.objectStore(LOCAL_LEAGUE_SEASON_STORE).put(row))),
        ...tournaments.map((row) => requestResult(transaction.objectStore(LOCAL_TOURNAMENT_STORE).put(row)))
      ]);
    });
    return { leagues, leagueSeasons, tournaments };
  }

  private async readLeagues(): Promise<PersistedArchiveLeague[]> {
    const rows = await getAll<Partial<PersistedArchiveLeague>>(await this.open(), LOCAL_LEAGUE_STORE);
    return rows.map((row) => this.persistLeague(row)).sort(byUpdatedAt);
  }

  private async readSeasons(): Promise<PersistedLeagueSeason[]> {
    const rows = await getAll<Partial<PersistedLeagueSeason>>(await this.open(), LOCAL_LEAGUE_SEASON_STORE);
    return rows.map((row) => this.persistSeason(row)).sort(byUpdatedAt);
  }

  private async readTournaments(): Promise<PersistedArchiveTournament[]> {
    const rows = await getAll<Partial<PersistedArchiveTournament>>(await this.open(), LOCAL_TOURNAMENT_STORE);
    return rows.map((row) => this.persistTournament(row)).sort(byTournamentDate);
  }

  private async requireLeague(transaction: IDBTransaction, id: string): Promise<PersistedArchiveLeague> {
    const row = await requestResult<Partial<PersistedArchiveLeague> | undefined>(transaction.objectStore(LOCAL_LEAGUE_STORE).get(id));
    if (!row) throw new ArchiveNotFoundError('league');
    return this.persistLeague(row);
  }

  private async requireSeason(transaction: IDBTransaction, id: string): Promise<PersistedLeagueSeason> {
    const row = await requestResult<Partial<PersistedLeagueSeason> | undefined>(transaction.objectStore(LOCAL_LEAGUE_SEASON_STORE).get(id));
    if (!row) throw new ArchiveNotFoundError('leagueSeason');
    return this.persistSeason(row);
  }

  private async requireTournament(transaction: IDBTransaction, id: string): Promise<PersistedArchiveTournament> {
    const row = await requestResult<Partial<PersistedArchiveTournament> | undefined>(transaction.objectStore(LOCAL_TOURNAMENT_STORE).get(id));
    if (!row) throw new ArchiveNotFoundError('tournament');
    return this.persistTournament(row);
  }

  /**
   * Load, guard the version, apply one pure domain transform, bump and persist — per row. Every write
   * path goes through one of these three, so the optimistic-concurrency rule has exactly one home per
   * tier and a Tournament write never touches its Season's or its League's version.
   */
  private async mutateLeague(id: string, expectedVersion: number, change: (league: PersistedArchiveLeague) => ArchiveLeagueDocument): Promise<PersistedArchiveLeague> {
    const database = await this.open();
    return runTransaction(database, [LOCAL_LEAGUE_STORE], 'readwrite', async (transaction) => {
      const current = await this.requireLeague(transaction, id);
      if (current.documentVersion !== expectedVersion) throw new ArchiveConcurrencyError();
      const next: PersistedArchiveLeague = {
        ...normalizeArchiveLeague(change(current)),
        id: current.id,
        documentVersion: current.documentVersion + 1,
        updatedAt: new Date().toISOString()
      };
      await requestResult(transaction.objectStore(LOCAL_LEAGUE_STORE).put(next));
      return next;
    });
  }

  private async mutateSeason(
    id: string,
    expectedVersion: number,
    change: (season: PersistedLeagueSeason, transaction: IDBTransaction) => LeagueSeasonDocument | Promise<LeagueSeasonDocument>,
    extraStores: string[] = []
  ): Promise<PersistedLeagueSeason> {
    const database = await this.open();
    return runTransaction(database, [LOCAL_LEAGUE_SEASON_STORE, ...extraStores], 'readwrite', async (transaction) => {
      const current = await this.requireSeason(transaction, id);
      if (current.documentVersion !== expectedVersion) throw new ArchiveConcurrencyError();
      const next: PersistedLeagueSeason = {
        ...normalizeLeagueSeason(await change(current, transaction)),
        id: current.id,
        documentVersion: current.documentVersion + 1,
        updatedAt: new Date().toISOString()
      };
      await requestResult(transaction.objectStore(LOCAL_LEAGUE_SEASON_STORE).put(next));
      return next;
    });
  }

  private async mutateTournament(
    id: string,
    expectedVersion: number,
    change: (tournament: PersistedArchiveTournament, transaction: IDBTransaction) => ArchiveTournamentDocument | Promise<ArchiveTournamentDocument>,
    extraStores: string[] = []
  ): Promise<PersistedArchiveTournament> {
    const database = await this.open();
    return runTransaction(database, [LOCAL_TOURNAMENT_STORE, ...extraStores], 'readwrite', async (transaction) => {
      const current = await this.requireTournament(transaction, id);
      if (current.documentVersion !== expectedVersion) throw new ArchiveConcurrencyError();
      const next: PersistedArchiveTournament = {
        ...normalizeArchiveTournament(await change(current, transaction)),
        id: current.id,
        documentVersion: current.documentVersion + 1,
        updatedAt: new Date().toISOString()
      };
      await requestResult(transaction.objectStore(LOCAL_TOURNAMENT_STORE).put(next));
      return next;
    });
  }

  /** One round of the Tournament is replaced by `change`; every other round is left alone. */
  private mutateRound(id: string, roundId: string, expectedVersion: number, change: (round: RoundDocument) => RoundDocument): Promise<PersistedArchiveTournament> {
    return this.mutateTournament(id, expectedVersion, (tournament) => ({
      ...tournament,
      rounds: tournament.rounds.map((round) => round.id === roundId ? change(round) : round)
    }));
  }

  private persistLeague(row: Partial<PersistedArchiveLeague>): PersistedArchiveLeague {
    return { ...normalizeArchiveLeague(row), documentVersion: row.documentVersion ?? 1, updatedAt: row.updatedAt ?? EPOCH_ISO };
  }

  private persistSeason(row: Partial<PersistedLeagueSeason>): PersistedLeagueSeason {
    return { ...normalizeLeagueSeason(row), documentVersion: row.documentVersion ?? 1, updatedAt: row.updatedAt ?? EPOCH_ISO };
  }

  private persistTournament(row: Partial<PersistedArchiveTournament>): PersistedArchiveTournament {
    return { ...normalizeArchiveTournament(row), documentVersion: row.documentVersion ?? 1, updatedAt: row.updatedAt ?? EPOCH_ISO };
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = openDatabase(LOCAL_ARCHIVE_DB_NAME, LOCAL_ARCHIVE_DB_VERSION, (database) => {
        for (const store of [LOCAL_LEAGUE_STORE, LOCAL_LEAGUE_SEASON_STORE, LOCAL_TOURNAMENT_STORE]) {
          if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: 'id' });
        }
      }).catch((error: unknown) => {
        this.database = undefined; // never memoize a failed open: a later call must retry
        throw error;
      });
    }
    return this.database;
  }
}

/** The browser store has no row cap of its own, so its catalog is never truncated. */
function catalog<T>(items: T[]): ArchiveCatalogResponse<T> {
  return { items, totalCount: items.length, truncated: false };
}

function byUpdatedAt<T extends { id: string; updatedAt: string }>(left: T, right: T): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function byTournamentDate(left: PersistedArchiveTournament, right: PersistedArchiveTournament): number {
  return right.tournamentDate.localeCompare(left.tournamentDate) || left.id.localeCompare(right.id);
}

function withArchetype(tournament: ArchiveTournamentDocument, playerName: string, archetype: string): ArchiveTournamentDocument {
  return setTournamentPlayerArchetype(tournament, playerName, archetype);
}

/**
 * One staged save, validated then applied in the contracted order. There is no status gate: an
 * archived Tournament is `completed` by default, so gating on status would make the archive
 * read-only. The only write guards are `documentVersion` and, on the server, the 365-day lock.
 */
function applyEditBatch(tournament: ArchiveTournamentDocument, batch: ArchiveTournamentEditBatch): ArchiveTournamentDocument {
  if (!batch || !Array.isArray(batch.addRounds) || !Array.isArray(batch.deleteRoundIds)
      || !Array.isArray(batch.replaceRounds) || !Array.isArray(batch.updateArchetypes)) {
    throw new Error('invalidArchiveTournamentEditBatch');
  }
  if (!batch.editTournament && !batch.status && !('moveToSeasonId' in batch) && batch.addRounds.length === 0
      && batch.deleteRoundIds.length === 0 && batch.replaceRounds.length === 0 && batch.updateArchetypes.length === 0) {
    throw new Error('emptyArchiveTournamentEditBatch');
  }
  if (batch.editTournament && !batch.editTournament.name.trim()) throw new Error('tournamentNameRequired');

  const existingRoundIds = new Set(tournament.rounds.map((round) => round.id));
  const addIds = uniqueIntentIds(batch.addRounds.map((intent) => intent.roundId), 'duplicateAddRound');
  const deleteIds = uniqueIntentIds(batch.deleteRoundIds, 'duplicateDeleteRound');
  const replaceIds = uniqueIntentIds(batch.replaceRounds.map((intent) => intent.roundId), 'duplicateReplaceRound');
  for (const roundId of addIds) {
    if (!STABLE_ROUND_ID.test(roundId)) throw new Error('invalidRoundId');
    if (existingRoundIds.has(roundId)) throw new Error('roundAlreadyExists');
  }
  for (const roundId of deleteIds) if (!existingRoundIds.has(roundId)) throw new Error('roundNotFound');
  for (const roundId of replaceIds) {
    if (!existingRoundIds.has(roundId)) throw new Error('roundNotFound');
    if (deleteIds.has(roundId)) throw new Error('conflictingRoundIntents');
  }
  const archetypeNames = batch.updateArchetypes.map((intent) => trimPlayerName(intent.playerName));
  if (archetypeNames.some((name) => !name) || new Set(archetypeNames).size !== archetypeNames.length) throw new Error('duplicateArchetypeIntent');

  let updated: ArchiveTournamentDocument = batch.editTournament
    ? createArchiveTournament({ ...tournament, name: batch.editTournament.name, tournamentDate: batch.editTournament.tournamentDate })
    : tournament;
  updated = {
    ...updated,
    rounds: [
      ...updated.rounds.filter((round) => !deleteIds.has(round.id)).map((round) => {
        const replacement = batch.replaceRounds.find((intent) => intent.roundId === round.id);
        return replacement ? createRound({ id: round.id, entries: replacement.entries }) : round;
      }),
      ...batch.addRounds.map((intent) => createRound({ id: intent.roundId, entries: intent.entries }))
    ]
  };
  for (const intent of batch.updateArchetypes) updated = withArchetype(updated, intent.playerName, intent.archetype);
  if (batch.status !== undefined) updated = { ...updated, status: batch.status };
  if (batch.moveToSeasonId !== undefined) updated = { ...updated, seasonId: normalizeSeasonId(batch.moveToSeasonId) };
  return updated;
}

function uniqueIntentIds(ids: string[], error: string): Set<string> {
  const result = new Set(ids);
  if (result.size !== ids.length) throw new Error(error);
  return result;
}

/**
 * The server's `UniqueName`, mirrored: a restored League that would collide with a name already in
 * the store is suffixed `(restored)`, then numbered.
 */
function uniqueRestoredName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const restored = `${name} (restored)`;
  if (!taken.has(restored)) return restored;
  let suffix = 2;
  while (taken.has(`${restored} ${suffix}`)) suffix++;
  return `${restored} ${suffix}`;
}
