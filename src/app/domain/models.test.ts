import { describe, expect, it } from 'vitest';
import { createLeague, createTournament, normalizeTournamentStatus } from './models';

describe('Archive Tournament completion status', () => {
  it('defaults a missing status to completed', () => {
    const parsed = JSON.parse('{"id":"t","leagueId":"l","name":"T","tournamentDate":"2026-01-01","rounds":[],"playerArchetypes":[]}');
    expect(createTournament(parsed).status).toBe('completed');
    expect(createTournament({}).status).toBe('completed');
  });

  it('keeps an explicit active', () => {
    expect(createTournament({ status: 'active' }).status).toBe('active');
  });

  it('maps an unknown value to completed', () => {
    for (const status of ['weird', 'finished', '', null, undefined, 7]) {
      expect(normalizeTournamentStatus(status)).toBe('completed');
    }
  });

  it('never cascades from the league', () => {
    const league = createLeague({ name: 'L', status: 'completed', tournaments: [{ name: 'T', status: 'active' }] });
    expect(league.status).toBe('completed');
    expect(league.tournaments[0].status).toBe('active');
  });
});
