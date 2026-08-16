import { describe, expect, it } from 'vitest';
import { createCalendarEvent, createIdFactory, createLeague } from './models';
import { exportFullData, exportLeague, leagueExportFilename, restoreFullData, restoreFullDataBundle, restoreLeague } from './export-restore';

describe('export/restore contracts', () => {
  it('uses kind-tagged league exports with only the selected League and regenerates ids on restore', () => {
    const source = createLeague({ id: 'old-league', name: 'League', tournaments: [{ id: 'old-tournament', leagueId: 'old-league', name: 'Tournament', tournamentDate: '2026-01-01', rounds: [{ id: 'old-round', entries: [{ kind: 'match', id: 'old-entry', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }] }] });
    const otherLeague = createLeague({ id: 'other-league', name: 'Other League' });
    const file = exportLeague(source, { appVersion: 'test', now: new Date('2026-01-01T00:00:00Z') });
    expect(file).toMatchObject({ kind: 'league', gonesDataVersion: 4, gonesAppVersion: 'test' });
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

  it('preserves each tournament status across export restore', () => {
    const source = createLeague({ name: 'League', tournaments: [{ name: 'Done', status: 'completed', rounds: [] }, { name: 'Ongoing', status: 'active', rounds: [] }] });
    const restored = restoreLeague(exportLeague(source), { idFactory: createIdFactory('new') });
    expect(restored.tournaments.map((tournament) => [tournament.name, tournament.status])).toEqual([['Done', 'completed'], ['Ongoing', 'active']]);
  });

  it('reads a restored tournament that predates the status field as completed', () => {
    const restored = restoreLeague(
      { kind: 'league', gonesDataVersion: 4, league: { id: 'old', name: 'Old', status: 'active', tournaments: [{ id: 'old-t', leagueId: 'old', name: 'Legacy', tournamentDate: '2026-01-01', rounds: [] }] } },
      { idFactory: createIdFactory('new') });
    expect(restored.tournaments[0].status).toBe('completed');
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

  it('preserves calendar events in full-data exports and remaps ids on restore', () => {
    const event = createCalendarEvent({ id: 'old-event', title: 'Modern Night', eventDate: '2026-07-10', startTime: '19:30', endTime: '22:00', location: 'Store', description: 'Bring decklists', externalLink: 'https://example.com/register' });
    const file = exportFullData([], { calendarEvents: [event], now: new Date('2026-06-11T00:00:00Z') });
    expect(file.calendarEvents).toEqual([event]);

    const restored = restoreFullDataBundle(file, { idFactory: createIdFactory('new') });
    expect(restored.calendarEvents).toEqual([{ ...event, id: 'new-1' }]);
  });

  it('normalizes older full-data exports without calendar events', () => {
    const file = { kind: 'fullData', gonesDataVersion: 2, gonesAppVersion: 'old', exportedAt: '', leagues: [] };
    expect(restoreFullDataBundle(file).calendarEvents).toEqual([]);
  });

  it('rejects unsupported future data versions', () => {
    expect(() => restoreLeague({ kind: 'league', gonesDataVersion: 999, league: {} })).toThrow('unsupportedGonesExport');
    expect(() => restoreLeague({ kind: 'league', gonesDataVersion: 5, league: {} })).toThrow('unsupportedGonesExport');
  });

  it('keeps restoring every prior kind-tagged data version 1 through 4', () => {
    for (const version of [1, 2, 3, 4]) {
      const restored = restoreLeague(
        { kind: 'league', gonesDataVersion: version, gonesAppVersion: 'old', exportedAt: '', league: { id: 'l', name: `League v${version}`, status: 'active', tournaments: [] } },
        { idFactory: createIdFactory(`v${version}`) }
      );
      expect(restored.name).toBe(`League v${version}`);
    }
  });

  it('exports only allowlisted public fields even when inputs carry private extras', () => {
    const pollutedLeague = { ...createLeague({ name: 'League' }), ownerEmail: 'pii-probe@example.com', refreshToken: 'fake-refresh-token-123' } as never;
    const pollutedEvent = { ...createCalendarEvent({ title: 'Night' }), createdByUserId: 'user-9', password: 'Sup3rSecretPassword!' } as never;
    const file = exportFullData([pollutedLeague], { calendarEvents: [pollutedEvent] });
    const artifact = JSON.stringify(file);
    expect(Object.keys(file.leagues[0]).sort()).toEqual(['id', 'name', 'status', 'tournaments']);
    expect(Object.keys(file.calendarEvents[0]).sort()).toEqual(['address', 'city', 'country', 'description', 'endTime', 'eventDate', 'externalLink', 'id', 'location', 'richDescriptionHtml', 'slug', 'startTime', 'title']);
    for (const probe of ['pii-probe@example.com', 'fake-refresh-token-123', 'Sup3rSecretPassword!', 'ownerEmail', 'createdByUserId']) {
      expect(artifact).not.toContain(probe);
    }
  });
});
