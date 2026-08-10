import { Inject, inject, Injectable } from '@angular/core';
import { LIVE_BACKEND, LIVE_BACKEND_MODE, LiveBackendPort, LiveFinalizeResult, LivePlayerCommand, LiveScoreCommand, LiveSettingsCommand } from '../backend/application-backend';
import { ServerReadCacheService } from '../backend/server-read-cache.service';
import { LiveTournamentDocument } from '../domain/live-tournament';

/**
 * Facade over the Live Tournament backend port. Every mutation is an explicit server intent command
 * guarded by the document version (If-Match ETag); the whole-document save path went with the
 * browser store (ADR 0020).
 */
@Injectable({ providedIn: 'root' })
export class LiveTournamentRepository {
  private readonly mode = inject(LIVE_BACKEND_MODE);
  private readonly cache = inject(ServerReadCacheService);

  constructor(@Inject(LIVE_BACKEND) private readonly backend: LiveBackendPort) {}

  async list(): Promise<LiveTournamentDocument[]> {
    return this.read('live-tournaments', () => this.backend.listLiveTournaments());
  }

  async get(id: string): Promise<LiveTournamentDocument | null> {
    return this.read(`live-tournament:${id}`, () => this.backend.getLiveTournament(id));
  }

  /**
   * Only the server adapter is cached (ADR 0031). The browser-local adapter (ADR 0021) is already
   * offline, and mirroring it would create two answers for one document. Reads only: a mutation that
   * fails offline still fails, with nothing queued.
   */
  private async read<T>(resource: string, load: () => Promise<T>): Promise<T> {
    if (this.mode !== 'aspnet-api') return load();
    return (await this.cache.read(resource, load)).value;
  }

  async create(): Promise<LiveTournamentDocument> {
    return this.backend.createLiveTournament(todayDateInputValue());
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
