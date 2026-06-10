import { describe, expect, it } from 'vitest';
import { createTournament } from './models';
import { buildTournamentSummary, formatSummaryPercentage } from './tournament-summary';

describe('tournament summary', () => {
  it('builds a shareable standings summary with records and archetype percentages', () => {
    const tournament = createTournament({
      name: 'Store Championship',
      tournamentDate: '2026-06-10',
      rounds: [{ entries: [
        { kind: 'match', id: 'm1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: 'Fire', player2DeckArchetype: 'Ice' },
        { kind: 'match', id: 'm2', table: '2', player1Name: 'Charlie', player2Name: 'Dana', player1Score: 1, player2Score: 2, player1DeckArchetype: 'Fire', player2DeckArchetype: 'Earth' },
        { kind: 'bye', id: 'b1', table: '3', playerName: 'Eve', deckArchetype: 'Ice' }
      ] }] }
    );

    const summary = buildTournamentSummary(tournament, new Date('2026-06-10T12:00:00.000Z'));

    expect(summary).toMatchObject({
      tournamentName: 'Store Championship',
      tournamentDate: '2026-06-10',
      generatedAt: '2026-06-10T12:00:00.000Z',
      status: 'Final',
      stats: { playerCount: 5, roundCount: 1, matchCount: 2, byeCount: 1, gameCount: 5 }
    });
    expect(summary.topRows.map((row) => ({ rank: row.rank, playerName: row.playerName, record: row.record, archetype: row.archetype }))).toEqual([
      { rank: 1, playerName: 'Alice', record: '1-0-0', archetype: 'Fire' },
      { rank: 2, playerName: 'Dana', record: '1-0-0', archetype: 'Earth' },
      { rank: 3, playerName: 'Eve', record: '1-0-0, 1 bye', archetype: 'Ice' },
      { rank: 4, playerName: 'Charlie', record: '0-1-0', archetype: 'Fire' },
      { rank: 5, playerName: 'Bob', record: '0-1-0', archetype: 'Ice' }
    ]);
    expect(summary.archetypeShares).toEqual([
      { archetype: 'Fire', playerCount: 2, totalPlayerCount: 5, percentage: 0.4 },
      { archetype: 'Ice', playerCount: 2, totalPlayerCount: 5, percentage: 0.4 },
      { archetype: 'Earth', playerCount: 1, totalPlayerCount: 5, percentage: 0.2 }
    ]);
  });

  it('includes every standings row so the result page can fill available space', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      kind: 'bye' as const,
      id: `bye-${index}`,
      table: String(index + 1),
      playerName: `Player ${index + 1}`,
      deckArchetype: 'Deck'
    }));
    const summary = buildTournamentSummary(createTournament({ rounds: [{ entries }] }));
    expect(summary.topRows).toHaveLength(12);
  });

  it('excludes missing archetype labels from metagame shares', () => {
    const tournament = createTournament({
      rounds: [{ entries: [
        { kind: 'match', id: 'm1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: 'Fire', player2DeckArchetype: 'Unknown' },
        { kind: 'match', id: 'm2', table: '2', player1Name: 'Charlie', player2Name: 'Dana', player1Score: 2, player2Score: 0, player1DeckArchetype: 'N/A', player2DeckArchetype: 'null' },
        { kind: 'match', id: 'm3', table: '3', player1Name: 'Eve', player2Name: 'Frank', player1Score: 2, player2Score: 0, player1DeckArchetype: 'Fire', player2DeckArchetype: 'no archetype' }
      ] }]
    });

    expect(buildTournamentSummary(tournament).archetypeShares).toEqual([
      { archetype: 'Fire', playerCount: 2, totalPlayerCount: 2, percentage: 1 }
    ]);
  });

  it('formats summary percentages for report output', () => {
    expect(formatSummaryPercentage(0.667)).toBe('67%');
  });
});
