import { describe, expect, it } from 'vitest';
import { createIdFactory, createLeague } from './models';
import { exportFullData, exportLeague, leagueExportFilename, restoreFullData, restoreLeague } from './export-restore';

describe('export/restore contracts', () => {
  it('uses kind-tagged league exports with only the selected League and regenerates ids on restore', () => {
    const source = createLeague({ id: 'old-league', name: 'League', tournaments: [{ id: 'old-tournament', leagueId: 'old-league', name: 'Tournament', tournamentDate: '2026-01-01', rounds: [{ id: 'old-round', entries: [{ kind: 'match', id: 'old-entry', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }] }] });
    const otherLeague = createLeague({ id: 'other-league', name: 'Other League' });
    const file = exportLeague(source, { appVersion: 'test', now: new Date('2026-01-01T00:00:00Z') });
    expect(file).toMatchObject({ kind: 'league', gonesDataVersion: 2, gonesAppVersion: 'test' });
    expect(file.league.id).toBe('old-league');
    expect(file.league.name).toBe('League');
    expect(file.league.tournaments).toHaveLength(1);
    expect(file).not.toHaveProperty('leagues');
    expect(JSON.stringify(file)).not.toContain(otherLeague.id);
    const restored = restoreLeague(file, { idFactory: createIdFactory('new') });
    expect(restored.id).toBe('new-1');
    expect(restored.tournaments[0].id).toBe('new-2');
    expect(restored.tournaments[0].rounds[0].id).not.toBe('old-round');
    expect(restored.tournaments[0].rounds[0].entries[0].id).not.toBe('old-entry');
  });

  it('preserves tournament-level player archetypes across export restore', () => {
    const source = createLeague({ name: 'League', tournaments: [{ name: 'Tournament', playerArchetypes: [{ playerName: 'Alice', archetype: 'Fire' }], rounds: [] }] });
    const restored = restoreLeague(exportLeague(source), { idFactory: createIdFactory('new') });
    expect(restored.tournaments[0].playerArchetypes).toEqual([{ playerName: 'Alice', archetype: 'Fire' }]);
  });

  it('builds League export filenames from date and League name', () => {
    const league = createLeague({ name: 'Demo League' });
    expect(leagueExportFilename(league, new Date('2026-06-10T17:30:00Z'))).toBe('2026-06-10 Demo League.json');
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
