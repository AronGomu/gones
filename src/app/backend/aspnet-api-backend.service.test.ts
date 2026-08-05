import '@angular/compiler';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiProblemError } from '../api/api-boundary';
import type { Client, LeagueCommandResponse } from '../api/generated/gones-api';
import { createLiveTournament } from '../domain/live-tournament';
import { createLeague, createMatchRoundEntry } from '../domain/models';
import { AspNetApiBackend, encodeLeagueETag } from './aspnet-api-backend.service';

const response: LeagueCommandResponse = {
  id: 'league-1',
  name: 'League',
  status: 'active',
  tournaments: [],
  documentVersion: 6,
  updatedAt: '2026-08-02T00:00:00Z' as never,
  eTag: '"AAAAAAAAAAY="'
};

function clientMock() {
  return new Proxy({}, {
    get(target, property: string) {
      const record = target as Record<string, ReturnType<typeof vi.fn>>;
      return record[property] ??= vi.fn(() => of(property === 'moveResultTournament' ? { source: response, target: response } : property === 'restoreFullLeagueData' ? { leagues: [response] } : response));
    }
  }) as Client & Record<string, ReturnType<typeof vi.fn>>;
}

describe('ASP.NET League command adapter', () => {
  it('maps every League/Result intent to generated command with exact If-Match', async () => {
    const client = clientMock();
    const backend = new AspNetApiBackend(client, {} as never);
    const entry = createMatchRoundEntry({ id: 'entry-1', player1Name: 'Alice', player2Name: 'Bob' });
    const etag = '"AAAAAAAAAAU="';

    await backend.createLeague('League', 'create-key');
    await backend.renameLeague('league-1', 5, 'Renamed');
    await backend.changeLeagueStatus('league-1', 5, 'completed');
    await backend.deleteLeague('league-1', 5);
    await backend.createResultTournament('league-1', 5, 'Tournament', '2026-08-02');
    await backend.editResultTournament('league-1', 'tournament-1', 5, 'Edited', '2026-08-03');
    await backend.deleteResultTournament('league-1', 'tournament-1', 5);
    await backend.moveResultTournament('league-1', 'tournament-1', 5, 'league-2', 9);
    await backend.addResultRound('league-1', 'tournament-1', 5);
    await backend.deleteResultRound('league-1', 'tournament-1', 'round-1', 5);
    await backend.importResultRound('league-1', 'tournament-1', 'round-1', 5, 'csv');
    await backend.replaceResultRound('league-1', 'tournament-1', 'round-1', 5, [entry]);
    await backend.addResultEntry('league-1', 'tournament-1', 'round-1', 5, entry);
    await backend.editResultEntry('league-1', 'tournament-1', 'round-1', 'entry-1', 5, entry);
    await backend.deleteResultEntry('league-1', 'tournament-1', 'round-1', 'entry-1', 5);
    await backend.updateResultPlayerArchetype('league-1', 'tournament-1', 'Alice', 5, 'Control');
    await backend.renameLeaguePlayerName('league-1', 5, 'Alice', 'Alicia');
    await backend.restoreLeague({ kind: 'league', gonesDataVersion: 3, league: createLeague({ id: 'old' }) }, 'restore-key');
    await backend.restoreFullLeagueData({ kind: 'fullData', gonesDataVersion: 3, leagues: [createLeague({ id: 'old' })] }, 'restore-full-key');

    expect(encodeLeagueETag(5)).toBe(etag);
    expect(client.createLeague).toHaveBeenCalledWith('create-key', { name: 'League' });
    expect(client.renameLeague).toHaveBeenCalledWith('league-1', etag, { name: 'Renamed' });
    expect(client.changeLeagueStatus).toHaveBeenCalledWith('league-1', etag, { status: 'completed' });
    expect(client.deleteLeague).toHaveBeenCalledWith('league-1', etag);
    expect(client.createResultTournament).toHaveBeenCalledWith('league-1', etag, { name: 'Tournament', tournamentDate: '2026-08-02' });
    expect(client.editResultTournament).toHaveBeenCalledWith('league-1', 'tournament-1', etag, { name: 'Edited', tournamentDate: '2026-08-03' });
    expect(client.deleteResultTournament).toHaveBeenCalledWith('league-1', 'tournament-1', etag);
    expect(client.moveResultTournament).toHaveBeenCalledWith('league-1', 'tournament-1', etag, '"AAAAAAAAAAk="', { targetLeagueId: 'league-2' });
    expect(client.addResultRound).toHaveBeenCalledWith('league-1', 'tournament-1', etag);
    expect(client.deleteResultRound).toHaveBeenCalledWith('league-1', 'tournament-1', 'round-1', etag);
    expect(client.importResultRound).toHaveBeenCalledWith('league-1', 'tournament-1', 'round-1', etag, { text: 'csv' });
    expect(client.replaceResultRound).toHaveBeenCalledWith('league-1', 'tournament-1', 'round-1', etag, { entries: [entry] });
    expect(client.addResultEntry).toHaveBeenCalledWith('league-1', 'tournament-1', 'round-1', etag, entry);
    expect(client.editResultEntry).toHaveBeenCalledWith('league-1', 'tournament-1', 'round-1', 'entry-1', etag, entry);
    expect(client.deleteResultEntry).toHaveBeenCalledWith('league-1', 'tournament-1', 'round-1', 'entry-1', etag);
    expect(client.updateResultPlayerArchetype).toHaveBeenCalledWith('league-1', 'tournament-1', 'Alice', etag, { archetype: 'Control' });
    expect(client.renameLeaguePlayerName).toHaveBeenCalledWith('league-1', etag, { fromName: 'Alice', toName: 'Alicia' });
    expect(client.restoreLeague).toHaveBeenCalledWith('restore-key', expect.objectContaining({ kind: 'league', gonesDataVersion: 3 }));
    expect(client.restoreFullLeagueData).toHaveBeenCalledWith('restore-full-key', expect.objectContaining({ kind: 'fullData', gonesDataVersion: 3 }));
  });
});

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
    const backend = new AspNetApiBackend(client, {} as never);

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
    const backend = new AspNetApiBackend(liveClientMock(), {} as never);
    const updated = await backend.startLiveRound('live-1', 7);
    expect(updated.documentVersion).toBe(8);
    expect(updated.id).toBe('live-1');
  });

  it('reads the full document for Organizer and falls back to the public detail for read-only users', async () => {
    const backend = new AspNetApiBackend(liveClientMock(), {} as never);
    const full = await backend.getLiveTournament('live-1');
    expect(full?.documentVersion).toBe(8);

    const publicDetail = { ...liveDocument, pairingSeed: undefined, firstRoundPlayerOrder: undefined, checkpoints: undefined, documentVersion: 8, serverUpdatedAt: '2026-08-02T00:00:00Z' };
    const readOnlyClient = liveClientMock({
      getLiveTournamentDocument: vi.fn(() => throwError(() => new ApiProblemError(403, { code: 'forbidden' }))),
      liveTournaments2: vi.fn(() => of(publicDetail))
    });
    const readOnlyBackend = new AspNetApiBackend(readOnlyClient, {} as never);
    const fallback = await readOnlyBackend.getLiveTournament('live-1');
    expect(readOnlyClient.liveTournaments2).toHaveBeenCalledWith('live-1');
    expect(fallback?.checkpoints).toEqual([]);
    expect(fallback?.documentVersion).toBe(8);

    const missingClient = liveClientMock({ getLiveTournamentDocument: vi.fn(() => throwError(() => new ApiProblemError(404, { code: 'not_found' }))) });
    await expect(new AspNetApiBackend(missingClient, {} as never).getLiveTournament('missing')).resolves.toBeNull();
  });

  it('rejects legacy whole-document Live saves in server mode', async () => {
    const backend = new AspNetApiBackend(liveClientMock(), {} as never);
    await expect(backend.saveLiveTournament(liveDocument)).rejects.toThrow('liveWholeDocumentSaveDisabled');
  });
});
