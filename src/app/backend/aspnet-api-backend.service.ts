import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiProblemError } from '../api/api-boundary';
import { Client, LiveCommandResponse, LiveTournamentDocumentResponse, PublicLiveTournamentDetailResponse, LiveTournamentDocument as ApiLiveTournamentDocument } from '../api/generated/gones-api';
import { LiveTournamentDocument, normalizeLiveTournament } from '../domain/live-tournament';
import type { BackendMode, LiveBackendPort, LiveFinalizeResult, LivePlayerCommand, LiveScoreCommand, LiveSettingsCommand } from './application-backend';

/**
 * Server-authority adapter for the Live Tournament capability. It carries intent commands only: no
 * whole-document Live save and no legacy CalendarEvent store, because in server mode the API database
 * is the sole authority and those paths only ever existed to write the browser store (ADR 0019).
 * The archive has its own server adapter, `ServerArchiveBackend`.
 */
@Injectable({ providedIn: 'root' })
export class AspNetApiBackend implements LiveBackendPort {
  readonly mode: BackendMode = 'aspnet-api';

  constructor(private readonly client: Client) {}

  async listLiveTournaments(): Promise<LiveTournamentDocument[]> {
    const summaries = [];
    const pageSize = 100;
    for (let page = 1; ; page++) {
      const response = await firstValueFrom(this.client.liveTournaments(page, pageSize, undefined, undefined));
      summaries.push(...response.items);
      if (summaries.length >= response.totalCount) break;
    }
    return Promise.all(summaries.map(async item => this.toLiveDocument(await firstValueFrom(this.client.liveTournaments2(item.id)))));
  }

  async getLiveTournament(id: string): Promise<LiveTournamentDocument | null> {
    try {
      const response = await firstValueFrom(this.client.getLiveTournamentDocument(id));
      return this.toLiveDocument(response);
    } catch (error) {
      if (error instanceof ApiProblemError && error.status === 404) return null;
      if (error instanceof ApiProblemError && (error.status === 401 || error.status === 403)) {
        try { return this.toLiveDocument(await firstValueFrom(this.client.liveTournaments2(id))); }
        catch (fallbackError) {
          if (fallbackError instanceof ApiProblemError && fallbackError.status === 404) return null;
          throw fallbackError;
        }
      }
      throw error;
    }
  }

  async createLiveTournament(tournamentDate: string, idempotencyKey = newIdempotencyKey()): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.createLiveTournament(idempotencyKey, { tournamentDate } as never));
  }

  async deleteLiveTournament(id: string, expectedVersion: number): Promise<void> {
    await firstValueFrom(this.client.deleteLiveTournament(id, encodeLeagueETag(expectedVersion)));
  }

  updateLiveSettings(id: string, expectedVersion: number, settings: LiveSettingsCommand): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.updateLiveTournamentSettings(id, encodeLeagueETag(expectedVersion), settings));
  }

  addLivePlayer(id: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.addLiveTournamentPlayer(id, encodeLeagueETag(expectedVersion), player));
  }

  editLivePlayer(id: string, playerId: string, expectedVersion: number, player: LivePlayerCommand): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.editLiveTournamentPlayer(id, playerId, encodeLeagueETag(expectedVersion), player));
  }

  setLivePlayerPaid(id: string, playerId: string, expectedVersion: number, paid: boolean): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.setLiveTournamentPlayerPaid(id, playerId, encodeLeagueETag(expectedVersion), { paid }));
  }

  dropLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.dropLiveTournamentPlayer(id, playerId, encodeLeagueETag(expectedVersion)));
  }

  removeLivePlayer(id: string, playerId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.removeLiveTournamentPlayer(id, playerId, encodeLeagueETag(expectedVersion)));
  }

  startLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.startLiveTournamentRound(id, encodeLeagueETag(expectedVersion)));
  }

  regenerateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.regenerateLiveTournamentRound(id, encodeLeagueETag(expectedVersion)));
  }

  cancelLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.cancelLiveTournamentRound(id, encodeLeagueETag(expectedVersion)));
  }

  validateLiveRound(id: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.validateLiveTournamentRound(id, encodeLeagueETag(expectedVersion)));
  }

  scoreLiveRoundEntry(id: string, roundId: string, entryId: string, expectedVersion: number, score: LiveScoreCommand): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.scoreLiveTournamentRoundEntry(id, roundId, entryId, encodeLeagueETag(expectedVersion), score));
  }

  restoreLiveCheckpoint(id: string, checkpointId: string, expectedVersion: number): Promise<LiveTournamentDocument> {
    return this.liveCommand(this.client.restoreLiveTournamentCheckpoint(id, checkpointId, encodeLeagueETag(expectedVersion)));
  }

  async finalizeLiveTournament(id: string, expectedVersion: number, idempotencyKey = newIdempotencyKey()): Promise<LiveFinalizeResult> {
    const response = await firstValueFrom(this.client.finalizeLiveTournament(id, encodeLeagueETag(expectedVersion), idempotencyKey));
    return {
      liveTournamentId: response.id,
      leagueId: response.leagueId,
      finalizedTournamentId: response.finalizedTournamentId,
      liveDocumentVersion: response.liveDocumentVersion
    };
  }

  private async liveCommand(request: ReturnType<Client['startLiveTournamentRound']>): Promise<LiveTournamentDocument> {
    return this.toLiveDocument(await firstValueFrom(request));
  }

  private toLiveDocument(response: LiveCommandResponse | LiveTournamentDocumentResponse | PublicLiveTournamentDetailResponse): LiveTournamentDocument {
    const source: Partial<ApiLiveTournamentDocument> = 'document' in response && typeof response.document === 'object'
      ? response.document
      : response as PublicLiveTournamentDetailResponse;
    return normalizeLiveTournament({
      ...(source as unknown as Partial<LiveTournamentDocument>),
      documentVersion: response.documentVersion
    });
  }

}

export function encodeLeagueETag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalidLeagueDocumentVersion');
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, BigInt(version));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `"${btoa(binary)}"`;
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `league-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
