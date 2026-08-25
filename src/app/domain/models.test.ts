import { describe, expect, it } from 'vitest';
import { createArchiveTournament, createLeagueSeason } from './archive-models';
import { normalizeTournamentStatus } from './models';

describe('Archive Tournament completion status', () => {
  it('defaults a missing status to completed', () => {
    const parsed = JSON.parse('{"id":"t","seasonId":"s","name":"T","tournamentDate":"2026-01-01","rounds":[],"playerArchetypes":[]}');
    expect(createArchiveTournament(parsed).status).toBe('completed');
    expect(createArchiveTournament({}).status).toBe('completed');
  });

  it('keeps an explicit active', () => {
    expect(createArchiveTournament({ status: 'active' }).status).toBe('active');
  });

  it('maps an unknown value to completed', () => {
    for (const status of ['weird', 'finished', '', null, undefined, 7]) {
      expect(normalizeTournamentStatus(status)).toBe('completed');
    }
  });

  it('never cascades from the Season', () => {
    // Separate rows now, so the two flags cannot influence each other even by construction.
    const season = createLeagueSeason({ id: 's', name: 'S', leagueId: 'l', status: 'completed' });
    const tournament = createArchiveTournament({ seasonId: 's', name: 'T', status: 'active' });
    expect(season.status).toBe('completed');
    expect(tournament.status).toBe('active');
  });
});
