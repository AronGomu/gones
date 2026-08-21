import { describe, expect, it } from 'vitest';
import { createLeague, createMatchRoundEntry, createRound, createTournament, PersistedLeague } from '../domain/models';
import { calculateLeagueResult } from '../domain/results';
import { LOCAL_PLACEHOLDER_LEAGUE_ID } from './league-archive-origin';
import { summarizeLeague } from './league-archive-summary';

/**
 * The browser half of ADR 0042. The server denormalized these two numbers; a browser-local League
 * has no server to ask, so it derives them from the document with the formula the list card used to
 * run inline. Both halves have to agree, which is what these tests pin.
 */
function league(id: string, tournamentCount: number): PersistedLeague {
  const tournaments = Array.from({ length: tournamentCount }, (_, index) => createTournament({
    id: `tournament-${index + 1}`,
    leagueId: id,
    name: `Tournament ${index + 1}`,
    rounds: [createRound({
      id: `round-${index + 1}`,
      entries: [
        createMatchRoundEntry({ id: `entry-${index + 1}-a`, player1Name: 'Alice', player2Name: 'Bob' }),
        createMatchRoundEntry({ id: `entry-${index + 1}-b`, player1Name: 'Carol', player2Name: 'Alice' })
      ]
    })]
  }));
  return { ...createLeague({ id, name: `League ${id}`, tournaments }), documentVersion: 4, updatedAt: '2026-08-09T10:00:00.000Z' };
}

describe('summarizeLeague', () => {
  it('counts tournaments and players', () => {
    const summary = summarizeLeague(league('server-1', 2));

    expect(summary.tournamentCount).toBe(2);
    expect(summary.playerCount).toBe(3);
  });

  it('derives the player count with the same formula the list card used', () => {
    const document = league('server-1', 2);

    expect(summarizeLeague(document).playerCount).toBe(calculateLeagueResult(document).rows.length);
  });

  it('copies the identity fields the list page renders', () => {
    expect(summarizeLeague(league('server-1', 0))).toMatchObject({
      id: 'server-1',
      name: 'League server-1',
      status: 'active',
      documentVersion: 4,
      updatedAt: '2026-08-09T10:00:00.000Z'
    });
  });

  it('reads the origin off the id, so a merged list can badge its own rows', () => {
    expect(summarizeLeague(league('server-1', 1)).isLocal).toBe(false);
    expect(summarizeLeague(league(LOCAL_PLACEHOLDER_LEAGUE_ID, 1)).isLocal).toBe(true);
  });

  it('summarizes an empty League without counting anything', () => {
    expect(summarizeLeague(league('server-empty', 0))).toMatchObject({ tournamentCount: 0, playerCount: 0 });
  });
});
