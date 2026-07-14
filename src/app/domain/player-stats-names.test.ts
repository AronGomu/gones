import { describe, expect, it } from 'vitest';
import { createLeague, createTournament } from './models';
import { collectKnownPlayerNames, suggestPlayerNames } from './player-stats';

describe('known player name suggestions', () => {
  it('collects unique names from rounds and player archetypes', () => {
    const league = createLeague({
      name: 'League',
      tournaments: [
        createTournament({
          name: 'T1',
          playerArchetypes: [{ playerName: 'Alice', archetype: 'Fire' }, { playerName: 'Bob', archetype: '' }],
          rounds: [{
            entries: [
              { kind: 'match', table: '1', player1Name: 'Alice', player2Name: 'Carol', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' },
              { kind: 'bye', table: '2', playerName: 'Dana', deckArchetype: '' }
            ]
          }]
        })
      ]
    });

    expect(collectKnownPlayerNames([league])).toEqual(['Alice', 'Bob', 'Carol', 'Dana']);
  });

  it('suggests by prefix, excludes registered names, and lists all when query empty', () => {
    const names = ['Alice', 'Alicia', 'Bob', 'Carol'];
    expect(suggestPlayerNames(names, 'ali', { exclude: ['Alice'] })).toEqual(['Alicia']);
    expect(suggestPlayerNames(names, '')).toEqual(['Alice', 'Alicia', 'Bob', 'Carol']);
    expect(suggestPlayerNames(names, '', { limit: 2 })).toEqual(['Alice', 'Alicia']);
  });
});
