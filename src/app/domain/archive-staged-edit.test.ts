import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import type { MatchRoundEntry, RoundDocument } from './models';
import type { ArchiveTournamentDocument } from './archive-models';
import {
  ARCHIVE_STANDALONE_SEASON_VALUE,
  archiveStagedDeletionSummary,
  archiveStagedEditBatchIsEmpty,
  buildArchiveStagedEditBatch
} from './archive-staged-edit';

function match(id: string, table = id): MatchRoundEntry {
  return {
    kind: 'match',
    id,
    table,
    player1Name: 'Ana',
    player2Name: 'Ben',
    player1Score: 2,
    player2Score: 0,
    player1DeckArchetype: '',
    player2DeckArchetype: ''
  };
}

function round(id: string, entries: MatchRoundEntry[]): RoundDocument {
  return { id, entries };
}

function doc(overrides: Partial<ArchiveTournamentDocument> = {}): ArchiveTournamentDocument {
  return {
    id: 't-1',
    name: 'A',
    seasonId: 's1',
    tournamentDate: '2026-01-01',
    status: 'active',
    rounds: [round('r1', [match('e1')])],
    playerArchetypes: [],
    ...overrides
  };
}

describe('buildArchiveStagedEditBatch', () => {
  it('an unchanged draft produces an empty batch', () => {
    const source = doc();
    const batch = buildArchiveStagedEditBatch(source, structuredClone(source), source.seasonId);
    expect(archiveStagedEditBatchIsEmpty(batch)).toBe(true);
    expect(batch.addRounds).toEqual([]);
    expect(batch.deleteRoundIds).toEqual([]);
    expect(batch.replaceRounds).toEqual([]);
    expect(batch.updateArchetypes).toEqual([]);
    expect(batch.editTournament).toBeUndefined();
    expect(batch.status).toBeUndefined();
    expect(Object.hasOwn(batch, 'moveToSeasonId')).toBe(false);
  });

  it('a renamed or redated draft emits one editTournament intent', () => {
    const source = doc({ name: 'A', tournamentDate: '2026-01-01' });
    const draft = doc({ name: 'B', tournamentDate: '2026-02-02' });
    const batch = buildArchiveStagedEditBatch(source, draft, source.seasonId);
    expect(batch.editTournament).toEqual({ name: 'B', tournamentDate: '2026-02-02' });
    expect(batch.addRounds).toEqual([]);
    expect(batch.deleteRoundIds).toEqual([]);
    expect(batch.replaceRounds).toEqual([]);
    expect(batch.updateArchetypes).toEqual([]);
  });

  it('a status change emits a status intent', () => {
    const batch = buildArchiveStagedEditBatch(doc({ status: 'active' }), doc({ status: 'completed' }), 's1');
    expect(batch.status).toBe('completed');
    expect(archiveStagedEditBatchIsEmpty(batch)).toBe(false);
  });

  it('a new round is an add, a dropped round is a delete, a changed round is a replace', () => {
    const source = doc({ rounds: [round('r1', [match('e1')]), round('r2', [match('e2')])] });
    const draft = doc({ rounds: [round('r2', [match('e2', 'changed')]), round('r3', [match('e3')])] });
    const batch = buildArchiveStagedEditBatch(source, draft, 's1');
    expect(batch.addRounds.map((intent) => intent.roundId)).toEqual(['r3']);
    expect(batch.deleteRoundIds).toEqual(['r1']);
    expect(batch.replaceRounds.map((intent) => intent.roundId)).toEqual(['r2']);
    expect(batch.replaceRounds[0].entries).toEqual([match('e2', 'changed')]);
  });

  it('a reordered round counts as a replace', () => {
    const source = doc({ rounds: [round('r1', [match('e1'), match('e2')])] });
    const draft = doc({ rounds: [round('r1', [match('e2'), match('e1')])] });
    const batch = buildArchiveStagedEditBatch(source, draft, 's1');
    expect(batch.replaceRounds).toHaveLength(1);
    expect(batch.replaceRounds[0].entries.map((entry) => entry.id)).toEqual(['e2', 'e1']);
  });

  it('round intents carry a deep copy, not a reference', () => {
    const source = doc({ rounds: [] });
    const draft = doc({ rounds: [round('r9', [match('e9')])] });
    const batch = buildArchiveStagedEditBatch(source, draft, 's1');
    (batch.addRounds[0].entries[0] as MatchRoundEntry).table = 'mutated';
    expect((draft.rounds[0].entries[0] as MatchRoundEntry).table).toBe('e9');
  });

  it('changed archetypes are emitted sorted, missing counted as empty', () => {
    const source = doc({ playerArchetypes: [{ playerName: 'Bob', archetype: 'Burn' }] });
    const draft = doc({
      playerArchetypes: [
        { playerName: 'Bob', archetype: '' },
        { playerName: 'Alice', archetype: 'Elves' }
      ]
    });
    const batch = buildArchiveStagedEditBatch(source, draft, 's1');
    expect(batch.updateArchetypes).toEqual([
      { playerName: 'Alice', archetype: 'Elves' },
      { playerName: 'Bob', archetype: '' }
    ]);
  });

  it('an unchanged archetype is not emitted', () => {
    const archetypes = [{ playerName: 'Alice', archetype: 'Elves' }];
    const batch = buildArchiveStagedEditBatch(
      doc({ playerArchetypes: archetypes }),
      doc({ playerArchetypes: structuredClone(archetypes) }),
      's1'
    );
    expect(batch.updateArchetypes).toEqual([]);
  });

  it('attaching to a Season emits the move', () => {
    const source = doc({ seasonId: null });
    const batch = buildArchiveStagedEditBatch(source, structuredClone(source), 's1');
    expect(batch.moveToSeasonId).toBe('s1');
    expect(archiveStagedEditBatchIsEmpty(batch)).toBe(false);
  });

  it('detaching to standalone emits a null move, not an empty batch', () => {
    const source = doc({ seasonId: 's1' });
    const batch = buildArchiveStagedEditBatch(source, structuredClone(source), null);
    expect(Object.hasOwn(batch, 'moveToSeasonId')).toBe(true);
    expect(batch.moveToSeasonId).toBeNull();
    expect(archiveStagedEditBatchIsEmpty(batch)).toBe(false);
  });

  it('an unchanged Season emits no move key', () => {
    const source = doc({ seasonId: 's1' });
    const batch = buildArchiveStagedEditBatch(source, structuredClone(source), 's1');
    expect(Object.hasOwn(batch, 'moveToSeasonId')).toBe(false);
  });
});

describe('archiveStagedDeletionSummary', () => {
  it('the deletion summary counts dropped rounds and dropped entries separately', () => {
    const source = doc({
      rounds: [round('r1', [match('e1'), match('e2')]), round('r2', [match('e3'), match('e4'), match('e5')])]
    });
    const draft = doc({ rounds: [round('r2', [match('e3')])] });
    expect(archiveStagedDeletionSummary(source, draft)).toEqual({ rounds: 1, entries: 2 });
  });

  it('the deletion summary ignores entries added to a surviving round', () => {
    const source = doc({ rounds: [round('r1', [match('e1')])] });
    const draft = doc({ rounds: [round('r1', [match('e1'), match('e2')])] });
    expect(archiveStagedDeletionSummary(source, draft)).toEqual({ rounds: 0, entries: 0 });
  });
});

describe('ARCHIVE_STANDALONE_SEASON_VALUE', () => {
  it('the standalone sentinel is a reserved value', () => {
    expect(ARCHIVE_STANDALONE_SEASON_VALUE).toBe('__standalone__');
  });
});
