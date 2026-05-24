import { describe, expect, it } from 'vitest';
import { createIdFactory } from './models';
import { importRoundEntries } from './round-import';

describe('round import adapter', () => {
  it('converts current import rows to neutral match fields without losing Deck Archetype data', () => {
    const imported = importRoundEntries('Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist\n7,Alice,Won 2-1,Bob,Fire,Ice', { idFactory: createIdFactory('entry') });
    expect(imported.entries).toEqual([{
      kind: 'match',
      id: 'entry-1',
      table: '7',
      player1Name: 'Alice',
      player2Name: 'Bob',
      player1Score: 2,
      player2Score: 1,
      player1DeckArchetype: 'Fire',
      player2DeckArchetype: 'Ice'
    }]);
  });

  it('preserves invalid rows as source data', () => {
    const imported = importRoundEntries('Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist\n1,Alice,Won 0-2,Bob,Fire,Ice', { idFactory: createIdFactory('entry') });
    expect(imported.entries[0]).toMatchObject({ kind: 'invalid', rawText: '1,Alice,Won 0-2,Bob,Fire,Ice', playerDecklist: 'Fire', opponentDecklist: 'Ice' });
  });
});
