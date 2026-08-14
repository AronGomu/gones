import { Inject, inject, Injectable, signal } from '@angular/core';
import { LIVE_BACKEND, LIVE_BACKEND_MODE, LiveBackendPort, LiveFinalizeResult, LivePlayerCommand, LiveScoreCommand, LiveSettingsCommand } from '../backend/application-backend';
import { ServerReadCacheService } from '../backend/server-read-cache.service';
import { LiveTournamentDocument } from '../domain/live-tournament';
import { PowerUserSettingsService } from '../shared/power-user-settings.service';

/**
 * Facade over the Live Tournament backend port. Every mutation is an explicit server intent command
 * guarded by the document version (If-Match ETag); the whole-document save path went with the
 * browser store (ADR 0020).
 */
@Injectable({ providedIn: 'root' })
export class LiveTournamentRepository {
  private readonly mode = inject(LIVE_BACKEND_MODE);
  private readonly cache = inject(ServerReadCacheService);
  private readonly power = inject(PowerUserSettingsService);

  /** Last server list/detail answer came from this user's offline cache. Local mode never sets these. */
  readonly listStale = signal(false);
  readonly detailStale = signal(false);

  constructor(@Inject(LIVE_BACKEND) private readonly backend: LiveBackendPort) {}

  async list(): Promise<LiveTournamentDocument[]> {
    return this.read('live-tournaments', this.listStale, () => this.backend.listLiveTournaments());
  }

  async get(id: string): Promise<LiveTournamentDocument | null> {
    return this.read(`live-tournament:${id}`, this.detailStale, () => this.backend.getLiveTournament(id));
  }

  /**
   * Only the server adapter is cached (ADR 0031). The browser-local adapter (ADR 0021) is already
   * offline, and mirroring it would create two answers for one document. Reads only: a mutation that
   * fails offline still fails, with nothing queued.
   */
  private async read<T>(resource: string, stale: { set(value: boolean): void }, load: () => Promise<T>): Promise<T> {
    stale.set(false);
    if (this.mode !== 'aspnet-api') return load();
    const result = await this.cache.read(resource, load);
    stale.set(result.stale);
    return result.value;
  }

  create(): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.createLiveTournament(todayDateInputValue()));
  }

  delete(id: string): Promise<void> {
    return this.freshMutation(async () => {
      const existing = await this.backend.getLiveTournament(id);
      if (!existing) return;
      await this.backend.deleteLiveTournament(id, existing.documentVersion);
    });
  }

  updateLiveSettings(id: string, expectedVersion: number, settings: LiveSettingsCommand): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.updateLiveSettings(id, expectedVersion, settings));
  }

  addLivePlayer(id: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.addLivePlayer(id, expectedVersion, player));
  }

  editLivePlayer(id: string, playerId: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.editLivePlayer(id, playerId, expectedVersion, player));
  }

  setLivePlayerPaid(id: string, playerId: string, expectedVersion: number, paid: boolean): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.setLivePlayerPaid(id, playerId, expectedVersion, paid));
  }

  dropLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.dropLivePlayer(id, playerId, expectedVersion));
  }

  removeLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.removeLivePlayer(id, playerId, expectedVersion));
  }

  startLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.startLiveRound(id, expectedVersion));
  }

  regenerateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.regenerateLiveRound(id, expectedVersion));
  }

  cancelLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.cancelLiveRound(id, expectedVersion));
  }

  validateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.validateLiveRound(id, expectedVersion));
  }

  scoreLiveRoundEntry(id: string, roundId: string, entryId: string, expectedVersion: number, score: LiveScoreCommand): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.scoreLiveRoundEntry(id, roundId, entryId, expectedVersion, score));
  }

  restoreLiveCheckpoint(id: string, checkpointId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.freshMutation(() => this.backend.restoreLiveCheckpoint(id, checkpointId, expectedVersion));
  }

  finalizeLiveTournament(id: string, expectedVersion: number, idempotencyKey?: string): Promise<LiveFinalizeResult> {
    return this.freshMutation(() => this.backend.finalizeLiveTournament(id, expectedVersion, idempotencyKey));
  }

  private async freshMutation<T>(action: () => Promise<T>): Promise<T> {
    this.power.requireEnabled();
    const result = await action();
    this.detailStale.set(false);
    return result;
  }
}

function todayDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
