import { describe, expect, it } from 'vitest';
import { createLeague, createMatchRoundEntry, createRound, createTournament, PersistedLeague, TournamentDocument } from './models';
import { archiveTournamentDeletionSummary, buildArchiveTournamentEditBatch, sameAuthorityLeagueOptions } from './archive-tournament-edit-batch';

function tournament(): TournamentDocument {
  return createTournament({
    id: 't1', leagueId: 'server-1', name: 'Cup', tournamentDate: '2026-08-13',
    rounds: [
      createRound({ id: 'r1', entries: [createMatchRoundEntry({ id: 'e1', player1Name: 'Alice', player2Name: 'Bob' })] }),
      createRound({ id: 'r2', entries: [createMatchRoundEntry({ id: 'e2', player1Name: 'Cara', player2Name: 'Dan' })] })
    ],
    playerArchetypes: [{ playerName: 'Alice', archetype: 'Burn' }]
  });
}

function persisted(id: string, status: 'active' | 'completed' = 'active'): PersistedLeague {
  return { ...createLeague({ id, name: id, status }), documentVersion: 1 };
}

describe('buildArchiveTournamentEditBatch', () => {
  it('emits no intents for an unchanged draft', () => {
    const source = tournament();
    expect(buildArchiveTournamentEditBatch(source, structuredClone(source))).toEqual({
      addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: []
    });
  });

  it('emits one title/date intent when either value changes', () => {
    const source = tournament();
    const draft = structuredClone(source);
    draft.name = 'Renamed';
    draft.tournamentDate = '2026-09-01';
    expect(buildArchiveTournamentEditBatch(source, draft).editTournament).toEqual({ name: 'Renamed', tournamentDate: '2026-09-01' });
  });

  it('adds stable round ids with entries, deletes missing rounds, and fully replaces changed/order-shifted rounds', () => {
    const source = tournament();
    const draft = structuredClone(source);
    draft.rounds = [
      { ...draft.rounds[0], entries: [...draft.rounds[0].entries, createMatchRoundEntry({ id: 'e3', player1Name: 'Eve', player2Name: 'Finn' })] },
      createRound({ id: 'r3', entries: [createMatchRoundEntry({ id: 'e4', player1Name: 'Gail', player2Name: 'Hank' })] })
    ];
    const command = buildArchiveTournamentEditBatch(source, draft);
    expect(command.deleteRoundIds).toEqual(['r2']);
    expect(command.replaceRounds).toEqual([{ roundId: 'r1', entries: draft.rounds[0].entries }]);
    expect(command.addRounds).toEqual([{ roundId: 'r3', entries: draft.rounds[1].entries }]);

    const reordered = structuredClone(source);
    reordered.rounds[0].entries.reverse();
    reordered.rounds[0].entries.push(createMatchRoundEntry({ id: 'e5' }));
    reordered.rounds[0].entries.reverse();
    expect(buildArchiveTournamentEditBatch(source, reordered).replaceRounds).toEqual([{ roundId: 'r1', entries: reordered.rounds[0].entries }]);
  });

  it('emits changed, added, and cleared archetype intents without unchanged rows', () => {
    const source = tournament();
    source.playerArchetypes.push({ playerName: 'Bob', archetype: 'Control' });
    const draft = structuredClone(source);
    draft.playerArchetypes = [
      { playerName: 'Alice', archetype: 'Tempo' },
      { playerName: 'Cara', archetype: 'Combo' }
    ];
    expect(buildArchiveTournamentEditBatch(source, draft).updateArchetypes).toEqual([
      { playerName: 'Alice', archetype: 'Tempo' },
      { playerName: 'Bob', archetype: '' },
      { playerName: 'Cara', archetype: 'Combo' }
    ]);
  });
});

describe('archiveTournamentDeletionSummary', () => {
  it('counts deleted rounds plus entries removed from retained rounds', () => {
    const source = tournament();
    source.rounds[0].entries.push(createMatchRoundEntry({ id: 'e3' }));
    const draft = structuredClone(source);
    draft.rounds = [{ ...draft.rounds[0], entries: [draft.rounds[0].entries[0]] }];
    expect(archiveTournamentDeletionSummary(source, draft)).toEqual({ rounds: 1, entries: 1 });
  });
});

describe('sameAuthorityLeagueOptions', () => {
  it('keeps active same-origin targets only', () => {
    const source = persisted('local-source');
    expect(sameAuthorityLeagueOptions(source, [
      source,
      persisted('local-target'),
      persisted('local-completed', 'completed'),
      persisted('server-target')
    ]).map(item => item.id)).toEqual(['local-source', 'local-target']);
  });
});
