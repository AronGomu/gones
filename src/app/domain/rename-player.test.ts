import { describe, expect, it } from 'vitest';
import { createMatchRoundEntry } from './models';
import { createArchiveTournament } from './archive-models';
import { renamePlayerInRoundEntry, renamePlayerInTournament } from './rename-player';

describe('renamePlayer', () => {
  it('renames match and bye players in rounds', () => {
    const tournament = createArchiveTournament({
      name: 'T',
      rounds: [{
        id: 'r1',
        entries: [
          createMatchRoundEntry({ player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0 }),
          { kind: 'bye', id: 'b1', table: '2', playerName: 'Alice', deckArchetype: '' }
        ]
      }],
      playerArchetypes: [{ playerName: 'Alice', archetype: 'Fire' }, { playerName: 'Bob', archetype: 'Ice' }]
    });

    const renamed = renamePlayerInTournament(tournament, 'Alice', 'Alicia');
    const round = renamed.rounds[0];
    expect(round.entries[0]).toMatchObject({ kind: 'match', player1Name: 'Alicia', player2Name: 'Bob' });
    expect(round.entries[1]).toMatchObject({ kind: 'bye', playerName: 'Alicia' });
    expect(renamed.playerArchetypes).toEqual([
      { playerName: 'Alicia', archetype: 'Fire' },
      { playerName: 'Bob', archetype: 'Ice' }
    ]);
  });

  it('merges into an existing player name', () => {
    const tournament = createArchiveTournament({
      name: 'T',
      rounds: [{
        id: 'r1',
        entries: [
          createMatchRoundEntry({ player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 1 }),
          createMatchRoundEntry({ player1Name: 'Bob', player2Name: 'Carol', player1Score: 2, player2Score: 0 })
        ]
      }],
      playerArchetypes: [
        { playerName: 'Alice', archetype: 'Fire' },
        { playerName: 'Bob', archetype: 'Ice' },
        { playerName: 'Carol', archetype: '' }
      ]
    });

    const merged = renamePlayerInTournament(tournament, 'Alice', 'Bob');
    const entries = merged.rounds[0].entries;
    expect(entries[0]).toMatchObject({ kind: 'match', player1Name: 'Bob', player2Name: 'Bob' });
    expect(merged.playerArchetypes.map((row) => row.playerName).sort()).toEqual(['Bob', 'Carol']);
  });

  it('renames invalid entry player fields', () => {
    const entry = renamePlayerInRoundEntry({
      kind: 'invalid',
      id: 'x',
      rawText: '',
      table: '1',
      player: 'Alice',
      result: '',
      opponent: 'Bob',
      playerDecklist: '',
      opponentDecklist: ''
    }, 'Alice', 'Alicia');
    expect(entry).toMatchObject({ kind: 'invalid', player: 'Alicia', opponent: 'Bob' });
  });
});
