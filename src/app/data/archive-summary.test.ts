import { describe, expect, it } from 'vitest';
import { createArchiveLeague, createArchiveTournament, createLeagueSeason, toLeagueDocument, toTournamentDocument } from '../domain/archive-models';
import type { ArchiveTournamentDocument, PersistedArchiveLeague, PersistedArchiveTournament, PersistedLeagueSeason } from '../domain/archive-models';
import { createMatchRoundEntry, createRound } from '../domain/models';
import { calculateLeagueResult, calculateTournamentResult } from '../domain/results';
import {
  isArchiveTournamentRowLocked,
  isLeagueSeasonRowLocked,
  summarizeArchiveLeague,
  summarizeArchiveTournament,
  summarizeLeagueSeason
} from './archive-summary';

/**
 * The browser half of the catalog. The server denormalizes these counters; a browser-local record has
 * no server to ask, so it derives them with the shared standings formula. Both halves have to agree,
 * which is what these tests pin.
 */
function tournament(id: string, tournamentDate: string, pairs: [string, string][]): ArchiveTournamentDocument {
  return createArchiveTournament({
    id,
    name: `Tournament ${id}`,
    seasonId: 'season-1',
    tournamentDate,
    rounds: [createRound({
      id: `round-${id}`,
      entries: pairs.map(([player1Name, player2Name], index) => createMatchRoundEntry({ id: `entry-${id}-${index}`, player1Name, player2Name }))
    })]
  });
}

function persistedTournament(id: string, tournamentDate: string, pairs: [string, string][]): PersistedArchiveTournament {
  return { ...tournament(id, tournamentDate, pairs), documentVersion: 3, updatedAt: '2026-08-10T10:00:00.000Z' };
}

function season(): PersistedLeagueSeason {
  return { ...createLeagueSeason({ id: 'season-1', name: 'Spring', leagueId: 'league-1' }), documentVersion: 4, updatedAt: '2026-08-09T10:00:00.000Z' };
}

function league(): PersistedArchiveLeague {
  return { ...createArchiveLeague({ id: 'league-1', name: 'Lyon', createdAt: '2026-01-05T09:00:00.000Z' }), documentVersion: 2, updatedAt: '2026-08-09T10:00:00.000Z' };
}

describe('summarizeLeagueSeason', () => {
  it('summarizes a Season with its tournament and player counts', () => {
    const summary = summarizeLeagueSeason(season(), [tournament('t-1', '2026-01-02', [['Alice', 'Bob']]), tournament('t-2', '2026-02-03', [['Carol', 'Alice']])]);

    expect(summary.tournamentCount).toBe(2);
    expect(summary.playerCount).toBe(3);
  });

  it('derives the Season player count with the shared standings formula', () => {
    const stored = season();
    const tournaments = [tournament('t-1', '2026-01-02', [['Alice', 'Bob']]), tournament('t-2', '2026-02-03', [['Carol', 'Alice']])];

    expect(summarizeLeagueSeason(stored, tournaments).playerCount).toBe(calculateLeagueResult(toLeagueDocument(stored, tournaments)).rows.length);
  });

  it('a Season with no Tournament reports null date bounds', () => {
    expect(summarizeLeagueSeason(season(), [])).toMatchObject({
      firstTournamentDate: null,
      lastTournamentDate: null,
      tournamentCount: 0,
      playerCount: 0
    });
  });

  it('a Season spans its earliest and latest Tournament', () => {
    const summary = summarizeLeagueSeason(season(), [
      tournament('t-1', '2026-03-04', [['Alice', 'Bob']]),
      tournament('t-2', '2026-01-02', [['Alice', 'Bob']]),
      tournament('t-3', '2026-02-03', [['Alice', 'Bob']])
    ]);

    expect(summary.firstTournamentDate).toBe('2026-01-02');
    expect(summary.lastTournamentDate).toBe('2026-03-04');
  });
});

describe('summarizeArchiveTournament', () => {
  it('summarizes a Tournament with the shared player count', () => {
    const stored = persistedTournament('t-1', '2026-01-02', [['Alice', 'Bob'], ['Carol', 'Dave']]);

    expect(summarizeArchiveTournament(stored).playerCount).toBe(calculateTournamentResult(toTournamentDocument(stored)).rows.length);
    expect(summarizeArchiveTournament(stored).playerCount).toBe(4);
  });

  it('a summary carries no isLocal flag', () => {
    const stored = persistedTournament('t-1', '2026-01-02', [['Alice', 'Bob']]);
    const summaries = [summarizeArchiveLeague(league()), summarizeLeagueSeason(season(), []), summarizeArchiveTournament(stored)];

    for (const summary of summaries) expect('isLocal' in summary).toBe(false);
    expect(summaries.map((summary) => summary.id)).toEqual(['league-1', 'season-1', 't-1']);
  });
});

describe('row-level lock', () => {
  it('a browser-local Tournament row is never locked', () => {
    expect(isArchiveTournamentRowLocked({ id: 'local-1', tournamentDate: '2000-01-01' }, new Date('2030-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('a server Tournament row older than the window is locked', () => {
    expect(isArchiveTournamentRowLocked({ id: 'server-1', tournamentDate: '2026-08-17' }, new Date('2027-08-18T00:00:00.000Z'))).toBe(true);
  });

  it('a server Tournament row at exactly 365 days is not locked', () => {
    expect(isArchiveTournamentRowLocked({ id: 'server-1', tournamentDate: '2026-08-17' }, new Date('2027-08-17T12:00:00.000Z'))).toBe(false);
  });

  it('a Season is locked when its last Tournament is locked', () => {
    expect(isLeagueSeasonRowLocked({ id: 'server-1', lastTournamentDate: '2026-08-17' }, new Date('2027-08-18T00:00:00.000Z'))).toBe(true);
  });

  it('a Season whose last Tournament is recent is not locked', () => {
    expect(isLeagueSeasonRowLocked({ id: 'server-1', lastTournamentDate: '2027-08-01' }, new Date('2027-08-18T00:00:00.000Z'))).toBe(false);
  });

  it('a Season with no Tournament is not locked', () => {
    expect(isLeagueSeasonRowLocked({ id: 'server-1', lastTournamentDate: null }, new Date('2027-08-18T00:00:00.000Z'))).toBe(false);
  });

  it('a browser-local Season row is never locked', () => {
    expect(isLeagueSeasonRowLocked({ id: 'local-1', lastTournamentDate: '2000-01-01' }, new Date('2030-01-01T00:00:00.000Z'))).toBe(false);
  });
});
