import { describe, expect, it } from 'vitest';
import { createMatchRoundEntry, createTournament } from './models';
import { mergeImportedRoundArchetypes, setTournamentPlayerArchetype, tournamentPlayerArchetypeRows, validateTournamentPlayerArchetypes } from './tournament-archetypes';

describe('tournament player archetypes', () => {
  it('derives legacy tournament archetypes from existing round entry deck fields', () => {
    const tournament = createTournament({
      rounds: [{ entries: [createMatchRoundEntry({ player1Name: 'Alice', player1DeckArchetype: 'Fire', player2Name: 'Bob', player2DeckArchetype: 'Ice' })] }]
    });

    expect(tournament.playerArchetypes).toEqual([
      { playerName: 'Alice', archetype: 'Fire' },
      { playerName: 'Bob', archetype: 'Ice' }
    ]);
  });

  it('keeps a single tournament archetype per player while merging imported round entries', () => {
    const tournament = createTournament({ playerArchetypes: [{ playerName: 'Alice', archetype: 'Fire' }] });
    const importedEntries = [createMatchRoundEntry({ player1Name: 'Alice', player1DeckArchetype: 'Water', player2Name: 'Bob', player2DeckArchetype: 'Ice' })];

    const merged = mergeImportedRoundArchetypes(tournament, importedEntries);

    expect(merged.conflicts).toEqual([{ playerName: 'Alice', existingArchetype: 'Fire', importedArchetype: 'Water' }]);
    expect(merged.playerArchetypes).toEqual([
      { playerName: 'Alice', archetype: 'Fire' },
      { playerName: 'Bob', archetype: 'Ice' }
    ]);
    expect(merged.entries[0]).toMatchObject({ kind: 'match', player1Name: 'Alice', player1DeckArchetype: 'Fire', player2Name: 'Bob', player2DeckArchetype: 'Ice' });
  });

  it('reports conflicting persisted rows without changing the current archetype', () => {
    const tournament = createTournament({ playerArchetypes: [{ playerName: 'Alice', archetype: 'Fire' }] });
    const edited = { ...tournament, playerArchetypes: [...tournament.playerArchetypes, { playerName: 'Alice', archetype: 'Water' }] };

    expect(validateTournamentPlayerArchetypes(edited)).toEqual([{ playerName: 'Alice', existingArchetype: 'Fire', importedArchetype: 'Water' }]);
  });

  it('lists round players plus saved archetypes for the bottom tournament container', () => {
    const tournament = setTournamentPlayerArchetype(createTournament({
      rounds: [{ entries: [createMatchRoundEntry({ player1Name: 'Alice', player2Name: 'Bob' })] }]
    }), 'Alice', 'Fire');

    expect(tournamentPlayerArchetypeRows(tournament)).toEqual([
      { playerName: 'Alice', archetype: 'Fire' },
      { playerName: 'Bob', archetype: '' }
    ]);
  });

  it('stores empty string when saving No archetype placeholder', () => {
    const tournament = setTournamentPlayerArchetype(createTournament(), 'Alice', 'No archetype');
    expect(tournament.playerArchetypes).toEqual([{ playerName: 'Alice', archetype: '' }]);
  });

  it('clears No Archetype labels on tournament load/import normalization', () => {
    const tournament = createTournament({
      playerArchetypes: [{ playerName: 'Alice', archetype: 'No Archetype' }, { playerName: 'Bob', archetype: 'Fire' }],
      rounds: [{ entries: [createMatchRoundEntry({ player1Name: 'Alice', player1DeckArchetype: 'No archetype', player2Name: 'Bob', player2DeckArchetype: 'Fire' })] }]
    });
    expect(tournament.playerArchetypes).toEqual([
      { playerName: 'Alice', archetype: '' },
      { playerName: 'Bob', archetype: 'Fire' }
    ]);
    const match = tournament.rounds[0].entries[0];
    expect(match).toMatchObject({ player1DeckArchetype: '', player2DeckArchetype: 'Fire' });
  });
});
