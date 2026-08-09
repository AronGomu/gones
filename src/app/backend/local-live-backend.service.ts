import { Injectable } from '@angular/core';
import {
  autoLiveSwissRoundCount,
  cancelCurrentSwissRound,
  createLiveTournament,
  createLiveTournamentPlayer,
  finalizeLiveTournament as finalizeLiveTournamentDocument,
  generateNextSwissRound,
  normalizeLiveTournament,
  regenerateCurrentSwissRound,
  restoreLiveTournamentCheckpoint,
  updateLiveRoundEntryResult,
  validateCurrentSwissRound,
  LiveTournamentDocument,
  LiveTournamentRoundDocument
} from '../domain/live-tournament';
import { trimPlayerName } from '../domain/models';
import { get, getAll, openDatabase, put, remove } from './indexed-db';
import type { LiveBackendPort, LiveFinalizeResult, LivePlayerCommand, LiveScoreCommand, LiveSettingsCommand } from './application-backend';

/**
 * Browser-local Live authority (ADR 0021).
 *
 * Bound to `LIVE_BACKEND` for anonymous visitors and the plain `User` role; `Organizer` and `Admin`
 * keep `AspNetApiBackend`. Nothing here talks to the network — there is no HTTP dependency to talk
 * with — and nothing is ever synchronised in either direction.
 *
 * Every rule lives in `src/app/domain/live-tournament.ts`. This adapter only loads a document,
 * hands it to a pure domain function, guards the version and writes the result back.
 */
export const LOCAL_LIVE_DB_NAME = 'gones-live';
export const LOCAL_LIVE_STORE = 'tournaments';
const LOCAL_LIVE_DB_VERSION = 1;

/**
 * Stale-write rejection with the shape `live-command-ux.ts` already classifies as `stale`: it keys
 * on `status === 412` first and on this exact message second, so the runner's conflict handling —
 * "reload the latest document and reapply" — is identical on both authorities.
 */
export class LiveConcurrencyError extends Error {
  readonly status = 412;

  constructor() {
    super('staleLiveTournamentDocument');
    this.name = 'LiveConcurrencyError';
  }
}

@Injectable({ providedIn: 'root' })
export class LocalLiveBackend implements LiveBackendPort {
  private database?: Promise<IDBDatabase>;

  async listLiveTournaments(): Promise<LiveTournamentDocument[]> {
    const rows = await getAll<Partial<LiveTournamentDocument>>(await this.open(), LOCAL_LIVE_STORE);
    return rows
      .map((row) => normalizeLiveTournament(row))
      .sort((left, right) => right.tournamentDate.localeCompare(left.tournamentDate) || left.name.localeCompare(right.name));
  }

  async getLiveTournament(id: string): Promise<LiveTournamentDocument | null> {
    const stored = await get<Partial<LiveTournamentDocument>>(await this.open(), LOCAL_LIVE_STORE, id);
    return stored ? normalizeLiveTournament(stored) : null;
  }

  async createLiveTournament(tournamentDate: string): Promise<LiveTournamentDocument> {
    const created = createLiveTournament({ tournamentDate, documentVersion: 1 });
    await put(await this.open(), LOCAL_LIVE_STORE, created);
    return created;
  }

  async deleteLiveTournament(id: string, expectedVersion: number): Promise<void> {
    const database = await this.open();
    const current = await this.require(database, id);
    if (current.documentVersion !== expectedVersion) throw new LiveConcurrencyError();
    await remove(database, LOCAL_LIVE_STORE, id);
  }

  updateLiveSettings(id: string, expectedVersion: number, settings: LiveSettingsCommand): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => withAutomaticRoundCount({
      ...document,
      name: settings.name,
      leagueId: settings.leagueId,
      tournamentDate: settings.tournamentDate,
      roundCount: settings.roundCount,
      customRoundCount: settings.customRoundCount,
      paidTrackingEnabled: settings.paidTrackingEnabled
    }));
  }

  addLivePlayer(id: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => {
      const added = createLiveTournamentPlayer(player);
      // Registration lists newest first, like the API; a late arrival joins at the end.
      const players = document.stage === 'registration' ? [added, ...document.players] : [...document.players, added];
      return withAutomaticRoundCount({ ...document, players });
    });
  }

  editLivePlayer(id: string, playerId: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => {
      const current = document.players.find((item) => item.id === playerId);
      if (!current) return document;
      const edited = createLiveTournamentPlayer({ ...current, ...player, id: playerId });
      return withAutomaticRoundCount({
        ...document,
        players: document.players.map((item) => item.id === playerId ? edited : item),
        // Round entries carry player names, not ids, so a rename has to follow the player.
        rounds: edited.name === current.name ? document.rounds : renameRoundEntries(document.rounds, current.name, edited.name)
      });
    });
  }

  setLivePlayerPaid(id: string, playerId: string, expectedVersion: number, paid: boolean): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => ({
      ...document,
      players: document.players.map((item) => item.id === playerId ? { ...item, paid } : item)
    }));
  }

  dropLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => withAutomaticRoundCount({
      ...document,
      players: document.players.map((item) => item.id === playerId ? { ...item, dropped: true } : item)
    }));
  }

  removeLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => withAutomaticRoundCount({
      ...document,
      players: document.players.filter((item) => item.id !== playerId)
    }));
  }

  startLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => generateNextSwissRound(document));
  }

  regenerateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => regenerateCurrentSwissRound(document));
  }

  cancelLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => cancelCurrentSwissRound(document));
  }

  validateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => validateCurrentSwissRound(document));
  }

  scoreLiveRoundEntry(id: string, roundId: string, entryId: string, expectedVersion: number, score: LiveScoreCommand): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => updateLiveRoundEntryResult(document, roundId, entryId, score));
  }

  restoreLiveCheckpoint(id: string, checkpointId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.mutate(id, expectedVersion, (document) => restoreLiveTournamentCheckpoint(document, checkpointId));
  }

  /**
   * Local finalization cannot write a League — that is what `Organizer` buys (ADR 0021). It builds
   * the same `TournamentDocument` the server would have archived and completes the live document;
   * the empty `leagueId` is the caller's signal to offer the JSON download instead of navigating.
   */
  async finalizeLiveTournament(id: string, expectedVersion: number): Promise<LiveFinalizeResult> {
    const completed = await this.mutate(id, expectedVersion, (document) => ({
      ...document,
      stage: 'completed' as const,
      finalizedTournamentId: document.finalizedTournamentId ?? finalizeLiveTournamentDocument(document).id
    }));
    return {
      liveTournamentId: completed.id,
      leagueId: '',
      finalizedTournamentId: completed.finalizedTournamentId ?? '',
      liveDocumentVersion: completed.documentVersion
    };
  }

  /**
   * Load, guard the version, apply one pure domain transform, bump and persist. Every write path in
   * this adapter goes through here, so the optimistic-concurrency rule has exactly one home.
   */
  private async mutate(id: string, expectedVersion: number, change: (document: LiveTournamentDocument) => LiveTournamentDocument): Promise<LiveTournamentDocument> {
    const database = await this.open();
    const current = await this.require(database, id);
    if (current.documentVersion !== expectedVersion) throw new LiveConcurrencyError();
    const next = normalizeLiveTournament({
      ...change(current),
      id: current.id,
      documentVersion: current.documentVersion + 1,
      updatedAt: new Date().toISOString()
    });
    await put(database, LOCAL_LIVE_STORE, next);
    return next;
  }

  private async require(database: IDBDatabase, id: string): Promise<LiveTournamentDocument> {
    const stored = await get<Partial<LiveTournamentDocument>>(database, LOCAL_LIVE_STORE, id);
    if (!stored) throw new Error('liveTournamentNotFound');
    return normalizeLiveTournament(stored);
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = openDatabase(LOCAL_LIVE_DB_NAME, LOCAL_LIVE_DB_VERSION, (database) => {
        if (!database.objectStoreNames.contains(LOCAL_LIVE_STORE)) database.createObjectStore(LOCAL_LIVE_STORE, { keyPath: 'id' });
      }).catch((error: unknown) => {
        this.database = undefined; // never memoize a failed open: a later call must retry
        throw error;
      });
    }
    return this.database;
  }
}

/** The API applies the same rule server-side: an automatic round count follows the active roster. */
function withAutomaticRoundCount(document: LiveTournamentDocument): LiveTournamentDocument {
  if (document.customRoundCount || document.stage !== 'registration') return document;
  return { ...document, roundCount: autoLiveSwissRoundCount(document) };
}

function renameRoundEntries(rounds: LiveTournamentRoundDocument[], oldName: string, newName: string): LiveTournamentRoundDocument[] {
  const normalizedOldName = trimPlayerName(oldName);
  if (!normalizedOldName) return rounds;
  return rounds.map((round) => ({
    ...round,
    entries: round.entries.map((item) => {
      const entry = item.entry;
      if (entry.kind === 'bye' && trimPlayerName(entry.playerName) === normalizedOldName) return { ...item, entry: { ...entry, playerName: newName } };
      if (entry.kind !== 'match') return item;
      return {
        ...item,
        entry: {
          ...entry,
          player1Name: trimPlayerName(entry.player1Name) === normalizedOldName ? newName : entry.player1Name,
          player2Name: trimPlayerName(entry.player2Name) === normalizedOldName ? newName : entry.player2Name
        }
      };
    })
  }));
}
