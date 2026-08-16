import { Injectable } from '@angular/core';
import { isLocalLeagueId, LOCAL_PLACEHOLDER_LEAGUE_ID, newLocalLeagueId } from '../data/league-archive-origin';
import {
  createLeague,
  createRound,
  createTournament,
  isUnassignedLeagueName,
  normalizeDeckArchetype,
  normalizeLeague,
  trimPlayerName,
  LeagueDocument,
  LeagueStatus,
  PersistedLeague,
  PlayerArchetypeDocument,
  PLACEHOLDER_LEAGUE_NAME,
  RoundDocument,
  RoundEntry,
  TournamentDocument
} from '../domain/models';
import { renamePlayerInLeague } from '../domain/rename-player';
import { importRoundEntries } from '../domain/round-import';
import { get, getAll, openDatabase, put, remove, requestResult, runTransaction } from './indexed-db';
import type { ArchiveTournamentEditBatchCommand, ArchiveTournamentEditBatchResult, FullLeagueRestoreCommand, LeagueArchiveBackendPort, LeagueRestoreCommand, MoveResultTournamentResult } from './application-backend';

/**
 * Browser-local League authority (ADR 0028) — the League half of the browser-local store, next to
 * the Live one (ADR 0021). Nothing here talks to the network: there is no HTTP dependency to talk
 * with, and nothing is ever synchronised in either direction. A league belongs to this store for its
 * whole life, and its `local-` id prefix is the whole routing rule.
 *
 * Every rule lives in `src/app/domain/models.ts`. This adapter only loads a document, hands it to a
 * pure domain function, guards the version and writes the result back.
 */
export const LOCAL_LEAGUE_DB_NAME = 'gones-leagues';
export const LOCAL_LEAGUE_STORE = 'leagues';
const LOCAL_LEAGUE_DB_VERSION = 1;

/**
 * Stale-write rejection with the shape `league-archive-command-ux.ts` already classifies as `stale`:
 * it keys on `status === 412` first and on this exact message second, so both authorities produce the
 * identical "reload the latest document and reapply" conflict UX.
 */
export class LeagueConcurrencyError extends Error {
  readonly status = 412;

  constructor() {
    super('staleLeagueDocument');
    this.name = 'LeagueConcurrencyError';
  }
}

@Injectable({ providedIn: 'root' })
export class LocalLeagueArchiveBackend implements LeagueArchiveBackendPort {
  private database?: Promise<IDBDatabase>;

  async listLeagueArchives(): Promise<PersistedLeague[]> {
    const database = await this.open();
    await this.ensurePlaceholder(database);
    const rows = await getAll<Partial<PersistedLeague>>(database, LOCAL_LEAGUE_STORE);
    return rows
      .map((row) => this.persist(row))
      .sort((left, right) => placeholderRank(left) - placeholderRank(right) || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  }

  async getLeagueArchive(id: string): Promise<PersistedLeague | null> {
    const stored = await get<Partial<PersistedLeague>>(await this.open(), LOCAL_LEAGUE_STORE, id);
    return stored ? this.persist(stored) : null;
  }

  async createLeagueArchive(name: string): Promise<PersistedLeague> {
    const created: PersistedLeague = {
      ...createLeague({ id: newLocalLeagueId(), name }),
      documentVersion: 1,
      updatedAt: new Date().toISOString()
    };
    await put(await this.open(), LOCAL_LEAGUE_STORE, created);
    return created;
  }

  renameLeagueArchive(id: string, expectedVersion: number, name: string): Promise<PersistedLeague> {
    return this.mutate(id, expectedVersion, (league) => ({ ...league, name }));
  }

  changeLeagueArchiveStatus(id: string, expectedVersion: number, status: LeagueStatus): Promise<PersistedLeague> {
    return this.mutate(id, expectedVersion, (league) => ({ ...league, status }));
  }

  async deleteLeagueArchive(id: string, expectedVersion: number): Promise<void> {
    const database = await this.open();
    const current = await this.require(database, id);
    if (current.documentVersion !== expectedVersion) throw new LeagueConcurrencyError();
    await remove(database, LOCAL_LEAGUE_STORE, id);
  }

  createArchiveTournament(id: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague> {
    return this.mutate(id, expectedVersion, (league) => ({ ...league, tournaments: [...league.tournaments, createTournament({ leagueId: league.id, name, tournamentDate, status: 'active' })] }));
  }

  editArchiveTournament(id: string, tournamentId: string, expectedVersion: number, name: string, tournamentDate: string): Promise<PersistedLeague> {
    return this.mutateTournament(id, tournamentId, expectedVersion, (tournament) => createTournament({ ...tournament, name, tournamentDate }));
  }

  deleteArchiveTournament(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.mutate(id, expectedVersion, (league) => ({ ...league, tournaments: league.tournaments.filter((tournament) => tournament.id !== tournamentId) }));
  }

  async moveArchiveTournament(id: string, tournamentId: string, expectedVersion: number, targetLeagueId: string, targetExpectedVersion: number): Promise<MoveResultTournamentResult> {
    const result = await this.applyArchiveTournamentEditBatch(id, tournamentId, expectedVersion, emptyEditBatch(), {
      leagueId: targetLeagueId,
      expectedVersion: targetExpectedVersion
    });
    return { fromLeague: result.sourceLeague, toLeague: result.destinationLeague! };
  }

  async applyArchiveTournamentEditBatch(
    sourceLeagueId: string,
    tournamentId: string,
    sourceExpectedVersion: number,
    command: ArchiveTournamentEditBatchCommand,
    target?: { leagueId: string; expectedVersion: number }
  ): Promise<ArchiveTournamentEditBatchResult> {
    if (!isLocalLeagueId(sourceLeagueId) || (target && !isLocalLeagueId(target.leagueId))) throw new Error('crossAuthorityMoveNotSupported');
    if (target?.leagueId === sourceLeagueId) throw new Error('targetLeagueMustDiffer');
    const database = await this.open();
    return runTransaction(database, [LOCAL_LEAGUE_STORE], 'readwrite', async transaction => {
      const store = transaction.objectStore(LOCAL_LEAGUE_STORE);
      const sourceRow = await requestResult<Partial<PersistedLeague> | undefined>(store.get(sourceLeagueId));
      if (!sourceRow) throw new Error('leagueNotFound');
      const source = this.persist(sourceRow);
      const targetRow = target
        ? await requestResult<Partial<PersistedLeague> | undefined>(store.get(target.leagueId))
        : undefined;
      if (target && !targetRow) throw new Error('leagueNotFound');
      const destination = targetRow ? this.persist(targetRow) : null;
      if (source.documentVersion !== sourceExpectedVersion || (target && destination?.documentVersion !== target.expectedVersion)) {
        throw new LeagueConcurrencyError();
      }

      const edited = applyLocalEditBatch(source, tournamentId, command, Boolean(target));
      const timestamp = new Date().toISOString();
      let sourceDocument: LeagueDocument = edited;
      let destinationDocument: LeagueDocument | null = destination;
      if (destination) {
        if (destination.status !== 'active') throw new Error('completedLeagueCannotBeEdited');
        const moved = edited.tournaments.find(item => item.id === tournamentId);
        if (!moved) throw new Error('tournamentNotFound');
        if (destination.tournaments.some(item => item.id === tournamentId)) throw new Error('tournamentAlreadyExists');
        sourceDocument = { ...edited, tournaments: edited.tournaments.filter(item => item.id !== tournamentId) };
        destinationDocument = { ...destination, tournaments: [...destination.tournaments, createTournament({ ...moved, leagueId: destination.id })] };
      }

      const sourceLeague: PersistedLeague = {
        ...normalizeLeague(sourceDocument),
        id: source.id,
        documentVersion: source.documentVersion + 1,
        updatedAt: timestamp
      };
      const destinationLeague: PersistedLeague | null = destination && destinationDocument ? {
        ...normalizeLeague(destinationDocument),
        id: destination.id,
        documentVersion: destination.documentVersion + 1,
        updatedAt: timestamp
      } : null;
      await requestResult(store.put(sourceLeague));
      if (destinationLeague) await requestResult(store.put(destinationLeague));
      return { sourceLeague, destinationLeague };
    });
  }

  addArchiveRound(id: string, tournamentId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.mutateTournament(id, tournamentId, expectedVersion, (tournament) => ({ ...tournament, rounds: [...tournament.rounds, createRound({})] }));
  }

  deleteArchiveRound(id: string, tournamentId: string, roundId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.mutateTournament(id, tournamentId, expectedVersion, (tournament) => ({ ...tournament, rounds: tournament.rounds.filter((round) => round.id !== roundId) }));
  }

  /** `importRoundEntries` returns an `ImportResult` wrapper; the round takes its `entries`. */
  importArchiveRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, text: string): Promise<PersistedLeague> {
    return this.mutateRound(id, tournamentId, roundId, expectedVersion, (round) => createRound({ id: round.id, entries: importRoundEntries(text).entries }));
  }

  replaceArchiveRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, entries: RoundEntry[]): Promise<PersistedLeague> {
    return this.mutateRound(id, tournamentId, roundId, expectedVersion, (round) => createRound({ id: round.id, entries }));
  }

  addArchiveEntry(id: string, tournamentId: string, roundId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague> {
    return this.mutateRound(id, tournamentId, roundId, expectedVersion, (round) => createRound({ id: round.id, entries: [...round.entries, entry] }));
  }

  editArchiveEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number, entry: RoundEntry): Promise<PersistedLeague> {
    return this.mutateRound(id, tournamentId, roundId, expectedVersion, (round) => createRound({
      id: round.id,
      entries: round.entries.map((item) => item.id === entryId ? { ...entry, id: entryId } : item)
    }));
  }

  deleteArchiveEntry(id: string, tournamentId: string, roundId: string, entryId: string, expectedVersion: number): Promise<PersistedLeague> {
    return this.mutateRound(id, tournamentId, roundId, expectedVersion, (round) => createRound({ id: round.id, entries: round.entries.filter((item) => item.id !== entryId) }));
  }

  updateArchivePlayerArchetype(id: string, tournamentId: string, playerName: string, expectedVersion: number, archetype: string): Promise<PersistedLeague> {
    return this.mutateTournament(id, tournamentId, expectedVersion, (tournament) => ({ ...tournament, playerArchetypes: upsertArchetype(tournament.playerArchetypes, playerName, archetype) }));
  }

  renameLeagueArchivePlayerName(id: string, expectedVersion: number, fromName: string, toName: string): Promise<PersistedLeague> {
    return this.mutate(id, expectedVersion, (league) => renamePlayerInLeague(league, fromName, toName));
  }

  restoreLeagueArchive(command: LeagueRestoreCommand): Promise<PersistedLeague> {
    return this.putRestored(command.league);
  }

  async restoreFullLeagueArchiveData(command: FullLeagueRestoreCommand): Promise<PersistedLeague[]> {
    const restored: PersistedLeague[] = [];
    for (const league of command.leagues) restored.push(await this.putRestored(league));
    return restored;
  }

  /**
   * Load, guard the version, apply one pure domain transform, bump and persist. Every write path in
   * this adapter goes through here, so the optimistic-concurrency rule has exactly one home.
   */
  private async mutate(id: string, expectedVersion: number, change: (league: PersistedLeague) => LeagueDocument): Promise<PersistedLeague> {
    const database = await this.open();
    const current = await this.require(database, id);
    if (current.documentVersion !== expectedVersion) throw new LeagueConcurrencyError();
    const next: PersistedLeague = {
      ...normalizeLeague(change(current)),
      id: current.id,
      documentVersion: current.documentVersion + 1,
      updatedAt: new Date().toISOString()
    };
    await put(database, LOCAL_LEAGUE_STORE, next);
    return next;
  }

  /** One tournament of the league is replaced by `change`; an unknown id leaves every tournament as it was. */
  private mutateTournament(id: string, tournamentId: string, expectedVersion: number, change: (tournament: TournamentDocument) => TournamentDocument): Promise<PersistedLeague> {
    return this.mutate(id, expectedVersion, (league) => ({
      ...league,
      tournaments: league.tournaments.map((tournament) => tournament.id === tournamentId ? change(tournament) : tournament)
    }));
  }

  /** One round of one tournament is replaced by `change`; every other round is left alone. */
  private mutateRound(id: string, tournamentId: string, roundId: string, expectedVersion: number, change: (round: RoundDocument) => RoundDocument): Promise<PersistedLeague> {
    return this.mutateTournament(id, tournamentId, expectedVersion, (tournament) => ({
      ...tournament,
      rounds: tournament.rounds.map((round) => round.id === roundId ? change(round) : round)
    }));
  }

  /**
   * A restored league keeps its content and loses its id: it always lands as a brand-new row under a
   * freshly minted `local-` id, and its name is uniquified against the store. That makes a restore
   * additive, exactly like the server's `RestoreOneAsync` — no incoming id, from either namespace or
   * either placeholder, can name a row that already exists, so importing a bundle can never
   * overwrite a live league and importing the same bundle twice yields two of them.
   */
  private async putRestored(league: LeagueDocument): Promise<PersistedLeague> {
    const database = await this.open();
    const taken = (await getAll<Partial<PersistedLeague>>(database, LOCAL_LEAGUE_STORE)).map((row) => String(row.name ?? ''));
    const target = createLeague({ ...league, id: newLocalLeagueId() });
    const restored: PersistedLeague = {
      ...target,
      name: uniqueRestoredName(target.name, taken),
      documentVersion: 1,
      updatedAt: new Date().toISOString()
    };
    await put(database, LOCAL_LEAGUE_STORE, restored);
    return restored;
  }

  /**
   * The local placeholder is a distinct row from the server's fixed `placeholder-league`, so
   * `createLeague` does not recognise its id and does not force the canonical name — this adapter
   * sets it, here and nowhere else.
   */
  private async ensurePlaceholder(database: IDBDatabase): Promise<void> {
    const stored = await get<Partial<PersistedLeague>>(database, LOCAL_LEAGUE_STORE, LOCAL_PLACEHOLDER_LEAGUE_ID);
    if (stored) return;
    const placeholder: PersistedLeague = {
      ...createLeague({ id: LOCAL_PLACEHOLDER_LEAGUE_ID, name: PLACEHOLDER_LEAGUE_NAME, status: 'active', tournaments: [] }),
      documentVersion: 1,
      updatedAt: new Date().toISOString()
    };
    await put(database, LOCAL_LEAGUE_STORE, placeholder);
  }

  private async require(database: IDBDatabase, id: string): Promise<PersistedLeague> {
    const stored = await get<Partial<PersistedLeague>>(database, LOCAL_LEAGUE_STORE, id);
    if (!stored) throw new Error('leagueNotFound');
    return this.persist(stored);
  }

  private persist(row: Partial<PersistedLeague>): PersistedLeague {
    return { ...normalizeLeague(row), documentVersion: row.documentVersion ?? 1, updatedAt: row.updatedAt };
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = openDatabase(LOCAL_LEAGUE_DB_NAME, LOCAL_LEAGUE_DB_VERSION, (database) => {
        if (!database.objectStoreNames.contains(LOCAL_LEAGUE_STORE)) database.createObjectStore(LOCAL_LEAGUE_STORE, { keyPath: 'id' });
      }).catch((error: unknown) => {
        this.database = undefined; // never memoize a failed open: a later call must retry
        throw error;
      });
    }
    return this.database;
  }
}

function emptyEditBatch(): ArchiveTournamentEditBatchCommand {
  return { addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: [] };
}

function applyLocalEditBatch(
  league: PersistedLeague,
  tournamentId: string,
  command: ArchiveTournamentEditBatchCommand,
  moving: boolean
): LeagueDocument {
  if (league.status !== 'active') throw new Error('completedLeagueCannotBeEdited');
  if (!command || !Array.isArray(command.addRounds) || !Array.isArray(command.deleteRoundIds)
      || !Array.isArray(command.replaceRounds) || !Array.isArray(command.updateArchetypes)) {
    throw new Error('invalidArchiveTournamentEditBatch');
  }
  if (!moving && !command.editTournament && command.addRounds.length === 0 && command.deleteRoundIds.length === 0
      && command.replaceRounds.length === 0 && command.updateArchetypes.length === 0) {
    throw new Error('emptyArchiveTournamentEditBatch');
  }
  if (command.editTournament && !command.editTournament.name.trim()) throw new Error('tournamentNameRequired');

  const tournament = league.tournaments.find(item => item.id === tournamentId);
  if (!tournament) throw new Error('tournamentNotFound');
  const existingRoundIds = new Set(tournament.rounds.map(round => round.id));
  const addIds = uniqueIntentIds(command.addRounds.map(intent => intent.roundId), 'duplicateAddRound');
  const deleteIds = uniqueIntentIds(command.deleteRoundIds, 'duplicateDeleteRound');
  const replaceIds = uniqueIntentIds(command.replaceRounds.map(intent => intent.roundId), 'duplicateReplaceRound');
  for (const roundId of addIds) {
    if (!isStableRoundId(roundId)) throw new Error('invalidRoundId');
    if (existingRoundIds.has(roundId)) throw new Error('roundAlreadyExists');
  }
  for (const roundId of deleteIds) if (!existingRoundIds.has(roundId)) throw new Error('roundNotFound');
  for (const roundId of replaceIds) {
    if (!existingRoundIds.has(roundId)) throw new Error('roundNotFound');
    if (deleteIds.has(roundId)) throw new Error('conflictingRoundIntents');
  }
  const archetypeNames = command.updateArchetypes.map(intent => trimPlayerName(intent.playerName));
  if (archetypeNames.some(name => !name) || new Set(archetypeNames).size !== archetypeNames.length) throw new Error('duplicateArchetypeIntent');

  let updated: TournamentDocument = command.editTournament
    ? createTournament({ ...tournament, name: command.editTournament.name, tournamentDate: command.editTournament.tournamentDate })
    : tournament;
  updated = {
    ...updated,
    rounds: [
      ...updated.rounds.filter(round => !deleteIds.has(round.id)).map(round => {
        const replacement = command.replaceRounds.find(intent => intent.roundId === round.id);
        return replacement ? createRound({ id: round.id, entries: replacement.entries }) : round;
      }),
      ...command.addRounds.map(intent => createRound({ id: intent.roundId, entries: intent.entries }))
    ]
  };
  for (const intent of command.updateArchetypes) {
    updated = { ...updated, playerArchetypes: upsertArchetype(updated.playerArchetypes, intent.playerName, intent.archetype) };
  }
  return { ...league, tournaments: league.tournaments.map(item => item.id === tournamentId ? updated : item) };
}

function uniqueIntentIds(ids: string[], error: string): Set<string> {
  const result = new Set(ids);
  if (result.size !== ids.length) throw new Error(error);
  return result;
}

function isStableRoundId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Player names match after `trimPlayerName`; the archetype itself goes through the domain normaliser. */
function upsertArchetype(archetypes: PlayerArchetypeDocument[], playerName: string, archetype: string): PlayerArchetypeDocument[] {
  const name = trimPlayerName(playerName);
  const row: PlayerArchetypeDocument = { playerName: name, archetype: normalizeDeckArchetype(archetype) };
  const rows = archetypes ?? [];
  return rows.some((item) => trimPlayerName(item.playerName) === name)
    ? rows.map((item) => trimPlayerName(item.playerName) === name ? row : item)
    : [...rows, row];
}

/**
 * The server's `LeagueCommandEndpoints.UniqueName`, mirrored: a restored league that would collide
 * with a name already in the store is suffixed `(restored)`, then numbered. An unassigned name is
 * suffixed on sight, so a restored placeholder never poses as this store's own placeholder row.
 */
function uniqueRestoredName(name: string, taken: string[]): string {
  const names = new Set(taken);
  const base = isUnassignedLeagueName(name) ? `${name} (restored)` : name;
  if (!names.has(base)) return base;
  const restored = `${base} (restored)`;
  if (!names.has(restored)) return restored;
  let suffix = 2;
  while (names.has(`${restored} ${suffix}`)) suffix++;
  return `${restored} ${suffix}`;
}

/** The unassigned league leads the list, exactly like the server list does. */
function placeholderRank(league: PersistedLeague): number {
  return league.id === LOCAL_PLACEHOLDER_LEAGUE_ID ? 0 : 1;
}
