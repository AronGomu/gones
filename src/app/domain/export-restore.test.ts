import { describe, expect, it } from 'vitest';
import { createIdFactory, createLeague } from './models';
import { exportFullData, exportLeague, restoreFullData, restoreLeague } from './export-restore';

describe('export/restore contracts', () => {
  it('uses kind-tagged league exports and regenerates ids on restore', () => {
    const source = createLeague({ id: 'old-league', name: 'League', tournaments: [{ id: 'old-tournament', leagueId: 'old-league', name: 'Tournament', tournamentDate: '2026-01-01', rounds: [{ id: 'old-round', entries: [{ kind: 'match', id: 'old-entry', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }] }] });
    const file = exportLeague(source, { appVersion: 'test', now: new Date('2026-01-01T00:00:00Z') });
    expect(file).toMatchObject({ kind: 'league', gonesDataVersion: 2, gonesAppVersion: 'test' });
    const restored = restoreLeague(file, { idFactory: createIdFactory('new') });
    expect(restored.id).toBe('new-1');
    expect(restored.tournaments[0].id).toBe('new-2');
    expect(restored.tournaments[0].rounds[0].id).not.toBe('old-round');
    expect(restored.tournaments[0].rounds[0].entries[0].id).not.toBe('old-entry');
  });

  it('normalizes legacy finished status to completed', () => {
    const restored = restoreLeague({ version: 1, exportedAt: '', league: { id: 'legacy', name: 'Legacy', status: 'finished', tournaments: [] } }, { idFactory: createIdFactory('new') });
    expect(restored.status).toBe('completed');
  });

  it('rejects wrong restore kind', () => {
    const file = exportFullData([createLeague({ name: 'A' })]);
    expect(() => restoreLeague(file)).toThrow('wrongExportKind');
  });

  it('restores full data alongside existing leagues with duplicate suffixes', () => {
    const file = exportFullData([createLeague({ name: 'League' }), createLeague({ name: 'League' })]);
    const restored = restoreFullData(file, { idFactory: createIdFactory('new'), existingLeagues: [createLeague({ name: 'League' })] });
    expect(restored.map((league) => league.name)).toEqual(['League (restored)', 'League (restored) 2']);
  });

  it('rejects unsupported future data versions', () => {
    expect(() => restoreLeague({ kind: 'league', gonesDataVersion: 999, league: {} })).toThrow('unsupportedGonesExport');
  });
});
