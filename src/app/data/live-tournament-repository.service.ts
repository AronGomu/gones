import { Inject, Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { LIVE_BACKEND, LiveBackendPort, LiveFinalizeResult, LivePlayerCommand, LiveScoreCommand, LiveSettingsCommand } from '../backend/application-backend';
import { LiveTournamentDocument } from '../domain/live-tournament';

/**
 * Facade over the flag-switched Live Tournament backend port. With `liveServer` off it keeps the
 * legacy per-browser localStorage store (whole-document saves); with the flag on every mutation is
 * an explicit server intent command guarded by the document version (If-Match ETag).
 */
@Injectable({ providedIn: 'root' })
export class LiveTournamentRepository {
  readonly serverMode = environment.features.liveServer;

  constructor(@Inject(LIVE_BACKEND) private readonly backend: LiveBackendPort) {}

  get configured(): boolean { return !this.serverMode || environment.apiBaseUrl.length > 0; }

  async list(): Promise<LiveTournamentDocument[]> {
    return this.backend.listLiveTournaments();
  }

  async get(id: string): Promise<LiveTournamentDocument | null> {
    return this.backend.getLiveTournament(id);
  }

  async create(): Promise<LiveTournamentDocument> {
    return this.backend.createLiveTournament(todayDateInputValue());
  }

  /** Legacy-only whole-document save; rejects when liveServer is enabled. */
  async save(tournament: LiveTournamentDocument): Promise<LiveTournamentDocument> {
    if (this.serverMode) throw new Error('liveWholeDocumentSaveDisabled');
    return this.backend.saveLiveTournament(tournament);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.backend.getLiveTournament(id);
    if (!existing) return;
    await this.backend.deleteLiveTournament(id, existing.documentVersion);
  }

  updateLiveSettings(id: string, expectedVersion: number, settings: LiveSettingsCommand): Promise<LiveTournamentDocument> {
    return this.backend.updateLiveSettings(id, expectedVersion, settings);
  }

  addLivePlayer(id: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument> {
    return this.backend.addLivePlayer(id, expectedVersion, player);
  }

  editLivePlayer(id: string, playerId: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument> {
    return this.backend.editLivePlayer(id, playerId, expectedVersion, player);
  }

  setLivePlayerPaid(id: string, playerId: string, expectedVersion: number, paid: boolean): Promise<LiveTournamentDocument> {
    return this.backend.setLivePlayerPaid(id, playerId, expectedVersion, paid);
  }

  dropLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.backend.dropLivePlayer(id, playerId, expectedVersion);
  }

  removeLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.backend.removeLivePlayer(id, playerId, expectedVersion);
  }

  startLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.backend.startLiveRound(id, expectedVersion);
  }

  regenerateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.backend.regenerateLiveRound(id, expectedVersion);
  }

  cancelLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.backend.cancelLiveRound(id, expectedVersion);
  }

  validateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.backend.validateLiveRound(id, expectedVersion);
  }

  scoreLiveRoundEntry(id: string, roundId: string, entryId: string, expectedVersion: number, score: LiveScoreCommand): Promise<LiveTournamentDocument> {
    return this.backend.scoreLiveRoundEntry(id, roundId, entryId, expectedVersion, score);
  }

  restoreLiveCheckpoint(id: string, checkpointId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.backend.restoreLiveCheckpoint(id, checkpointId, expectedVersion);
  }

  finalizeLiveTournament(id: string, expectedVersion: number, idempotencyKey?: string): Promise<LiveFinalizeResult> {
    return this.backend.finalizeLiveTournament(id, expectedVersion, idempotencyKey);
  }
}

function todayDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
