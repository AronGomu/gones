import '@angular/compiler';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { Client, LeagueCommandResponse } from '../api/generated/gones-api';
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
