import { describe, expect, it } from 'vitest';
import { RoundEntry } from '../../domain/models';
import type { PersistedArchiveTournament } from '../../domain/archive-models';
import { localPlayerNames } from './local-player-names';

function tournament(id: string, name: string, entries: RoundEntry[]): PersistedArchiveTournament {
  return {
    id,
    name,
    seasonId: null,
    tournamentDate: '2026-08-10',
    status: 'completed',
    rounds: [{ id: `${id}-round`, entries }],
    playerArchetypes: [],
    documentVersion: 1,
    updatedAt: '2026-08-10T00:00:00.000Z'
  };
}

function match(id: string, player1Name: string, player2Name: string): RoundEntry {
  return { kind: 'match', id, table: '1', player1Name, player2Name, player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' };
}

function bye(id: string, playerName: string): RoundEntry {
  return { kind: 'bye', id, table: '', playerName, deckArchetype: '' };
}

describe('localPlayerNames', () => {
  it('folds match and bye entries', () => {
    const tournaments = [tournament('local-1', 'Local league', [match('e1', 'A', 'B'), bye('e2', 'A')])];

    expect(localPlayerNames(tournaments)).toEqual([
      { name: 'A', occurrenceCount: 2, leagueCount: 1 },
      { name: 'B', occurrenceCount: 1, leagueCount: 1 }
    ]);
  });

  it('folds case and counts Tournaments', () => {
    const tournaments = [
      tournament('local-1', 'First', [bye('e1', 'Alice')]),
      tournament('local-2', 'Second', [bye('e2', 'alice')])
    ];

    expect(localPlayerNames(tournaments)).toEqual([{ name: 'Alice', occurrenceCount: 2, leagueCount: 2 }]);
  });

  it('skips blank names', () => {
    const tournaments = [tournament('local-1', 'First', [match('e1', 'Alice', '   '), bye('e2', '')])];

    expect(localPlayerNames(tournaments)).toEqual([{ name: 'Alice', occurrenceCount: 1, leagueCount: 1 }]);
  });
});
