import '@angular/compiler';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiProblemError } from '../api/api-boundary';
import type { Client } from '../api/generated/gones-api';
import { createLiveTournament } from '../domain/live-tournament';
import { AspNetApiBackend } from './aspnet-api-backend.service';

const liveDocument = createLiveTournament({ id: 'live-1', name: 'Live', documentVersion: 7, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' });

function liveClientMock(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const command = { document: liveDocument, documentVersion: 8, serverUpdatedAt: '2026-08-02T00:00:00Z', eTag: '"AAAAAAAAAAg="' };
  return new Proxy({ ...overrides }, {
    get(target, property: string) {
      const record = target as Record<string, ReturnType<typeof vi.fn>>;
      return record[property] ??= vi.fn(() => of(
        property === 'finalizeLiveTournament'
          ? { id: 'live-1', stage: 'completed', leagueId: 'league-9', finalizedTournamentId: 'tournament-9', liveDocumentVersion: 9, liveETag: '"AAAAAAAAAAk="', leagueDocumentVersion: 2, leagueETag: '"AAAAAAAAAAI="' }
          : property === 'deleteLiveTournament'
            ? { id: 'live-1', deleted: true, documentVersion: 8, eTag: '"AAAAAAAAAAg="' }
            : property === 'getLiveTournamentDocument'
              ? { document: liveDocument, documentVersion: 8, serverUpdatedAt: '2026-08-02T00:00:00Z' }
              : command));
    }
  }) as Client & Record<string, ReturnType<typeof vi.fn>>;
}

describe('ASP.NET Live command adapter', () => {
  const etag = '"AAAAAAAAAAc="';

  it('maps every Live intent to the generated command with exact If-Match and Idempotency-Key', async () => {
    const client = liveClientMock();
    const backend = new AspNetApiBackend(client);

    await backend.createLiveTournament('2026-08-05', 'live-create-key');
    await backend.updateLiveSettings('live-1', 7, { name: 'Live', leagueId: 'league-9', tournamentDate: '2026-08-05', roundCount: 3, customRoundCount: false, paidTrackingEnabled: true });
    await backend.addLivePlayer('live-1', 7, { name: 'Alice', initialWins: 1, initialDraws: 0, initialLosses: 0, archetype: 'Control' });
    await backend.editLivePlayer('live-1', 'player-1', 7, { name: 'Alicia', initialWins: 1, initialDraws: 2, initialLosses: 3, archetype: 'Tempo' });
    await backend.setLivePlayerPaid('live-1', 'player-1', 7, true);
    await backend.dropLivePlayer('live-1', 'player-1', 7);
    await backend.removeLivePlayer('live-1', 'player-1', 7);
    await backend.startLiveRound('live-1', 7);
    await backend.regenerateLiveRound('live-1', 7);
    await backend.cancelLiveRound('live-1', 7);
    await backend.validateLiveRound('live-1', 7);
    await backend.scoreLiveRoundEntry('live-1', 'round-1', 'entry-1', 7, { player1Score: 2, player2Score: 1 });
    await backend.restoreLiveCheckpoint('live-1', 'checkpoint-1', 7);
    const finalize = await backend.finalizeLiveTournament('live-1', 7, 'finalize-key');
    await backend.deleteLiveTournament('live-1', 7);

    expect(client.createLiveTournament).toHaveBeenCalledWith('live-create-key', { tournamentDate: '2026-08-05' });
    expect(client.updateLiveTournamentSettings).toHaveBeenCalledWith('live-1', etag, { name: 'Live', leagueId: 'league-9', tournamentDate: '2026-08-05', roundCount: 3, customRoundCount: false, paidTrackingEnabled: true });
    expect(client.addLiveTournamentPlayer).toHaveBeenCalledWith('live-1', etag, { name: 'Alice', initialWins: 1, initialDraws: 0, initialLosses: 0, archetype: 'Control' });
    expect(client.editLiveTournamentPlayer).toHaveBeenCalledWith('live-1', 'player-1', etag, { name: 'Alicia', initialWins: 1, initialDraws: 2, initialLosses: 3, archetype: 'Tempo' });
    expect(client.setLiveTournamentPlayerPaid).toHaveBeenCalledWith('live-1', 'player-1', etag, { paid: true });
    expect(client.dropLiveTournamentPlayer).toHaveBeenCalledWith('live-1', 'player-1', etag);
    expect(client.removeLiveTournamentPlayer).toHaveBeenCalledWith('live-1', 'player-1', etag);
    expect(client.startLiveTournamentRound).toHaveBeenCalledWith('live-1', etag);
    expect(client.regenerateLiveTournamentRound).toHaveBeenCalledWith('live-1', etag);
    expect(client.cancelLiveTournamentRound).toHaveBeenCalledWith('live-1', etag);
    expect(client.validateLiveTournamentRound).toHaveBeenCalledWith('live-1', etag);
    expect(client.scoreLiveTournamentRoundEntry).toHaveBeenCalledWith('live-1', 'round-1', 'entry-1', etag, { player1Score: 2, player2Score: 1 });
    expect(client.restoreLiveTournamentCheckpoint).toHaveBeenCalledWith('live-1', 'checkpoint-1', etag);
    expect(client.finalizeLiveTournament).toHaveBeenCalledWith('live-1', etag, 'finalize-key');
    expect(client.deleteLiveTournament).toHaveBeenCalledWith('live-1', etag);
    expect(finalize).toEqual({ liveTournamentId: 'live-1', leagueId: 'league-9', finalizedTournamentId: 'tournament-9', liveDocumentVersion: 9 });
  });

  it('applies the response documentVersion to mapped Live documents', async () => {
    const backend = new AspNetApiBackend(liveClientMock());
    const updated = await backend.startLiveRound('live-1', 7);
    expect(updated.documentVersion).toBe(8);
    expect(updated.id).toBe('live-1');
  });

  it('reads the full document for Organizer and falls back to the public detail for read-only users', async () => {
    const backend = new AspNetApiBackend(liveClientMock());
    const full = await backend.getLiveTournament('live-1');
    expect(full?.documentVersion).toBe(8);

    const publicDetail = { ...liveDocument, pairingSeed: undefined, firstRoundPlayerOrder: undefined, checkpoints: undefined, documentVersion: 8, serverUpdatedAt: '2026-08-02T00:00:00Z' };
    const readOnlyClient = liveClientMock({
      getLiveTournamentDocument: vi.fn(() => throwError(() => new ApiProblemError(403, { code: 'forbidden' }))),
      liveTournaments2: vi.fn(() => of(publicDetail))
    });
    const readOnlyBackend = new AspNetApiBackend(readOnlyClient);
    const fallback = await readOnlyBackend.getLiveTournament('live-1');
    expect(readOnlyClient.liveTournaments2).toHaveBeenCalledWith('live-1');
    expect(fallback?.checkpoints).toEqual([]);
    expect(fallback?.documentVersion).toBe(8);

    const missingClient = liveClientMock({ getLiveTournamentDocument: vi.fn(() => throwError(() => new ApiProblemError(404, { code: 'not_found' }))) });
    await expect(new AspNetApiBackend(missingClient).getLiveTournament('missing')).resolves.toBeNull();
  });

  it('carries no whole-document Live save at all in server mode', () => {
    expect('saveLiveTournament' in new AspNetApiBackend(liveClientMock())).toBe(false);
  });
});
