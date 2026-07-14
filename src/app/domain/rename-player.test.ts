import { describe, expect, it } from 'vitest';
import { createLeague, createMatchRoundEntry, createTournament } from './models';
import { renamePlayerInLeague, renamePlayerInRoundEntry } from './rename-player';

describe('renamePlayer', () => {
  it('renames match and bye players in rounds', () => {
    const league = createLeague({
      name: 'L',
      tournaments: [createTournament({
        name: 'T',
        rounds: [{
          entries: [
            createMatchRoundEntry({ player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0 }),
            { kind: 'bye', table: '2', playerName: 'Alice', deckArchetype: '' }
          ]
        }],
        playerArchetypes: [{ playerName: 'Alice', archetype: 'Fire' }, { playerName: 'Bob', archetype: 'Ice' }]
      })]
    });

    const renamed = renamePlayerInLeague(league, 'Alice', 'Alicia');
    const round = renamed.tournaments[0].rounds[0];
    expect(round.entries[0]).toMatchObject({ kind: 'match', player1Name: 'Alicia', player2Name: 'Bob' });
    expect(round.entries[1]).toMatchObject({ kind: 'bye', playerName: 'Alicia' });
    expect(renamed.tournaments[0].playerArchetypes).toEqual([
      { playerName: 'Alicia', archetype: 'Fire' },
      { playerName: 'Bob', archetype: 'Ice' }
    ]);
  });

  it('merges into an existing player name', () => {
    const league = createLeague({
      name: 'L',
      tournaments: [createTournament({
        name: 'T',
        rounds: [{
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
      })]
    });

    const merged = renamePlayerInLeague(league, 'Alice', 'Bob');
    const entries = merged.tournaments[0].rounds[0].entries;
    expect(entries[0]).toMatchObject({ kind: 'match', player1Name: 'Bob', player2Name: 'Bob' });
    expect(merged.tournaments[0].playerArchetypes.map((row) => row.playerName).sort()).toEqual(['Bob', 'Carol']);
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
