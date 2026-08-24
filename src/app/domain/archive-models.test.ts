import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_DATA_VERSION,
  ARCHIVE_LOCK_WINDOW_DAYS,
  SUPPORTED_ARCHIVE_IMPORT_VERSIONS,
  createArchiveLeague,
  createArchiveTournament,
  createLeagueSeason,
  isArchiveTournamentLocked,
  normalizeArchiveTournament,
  toArchiveTournamentDocument,
  toLeagueDocument,
  toTournamentDocument
} from './archive-models';
import type { ArchiveTournamentInput, RoundDocument } from './archive-models';
import { createMatchRoundEntry, createRound, createTournament } from './models';

/**
 * The lock rule is compared against fixed UTC instants on purpose: it mirrors the C# `ArchiveLockRule`
 * day for day, so a suite that read the wall clock would agree with the backend only until midnight.
 */
const roundWithArchetypes = () => createRound({
  id: 'round-1',
  entries: [
    createMatchRoundEntry({ id: 'entry-1', player1Name: 'Carol', player2Name: 'Alice', player1DeckArchetype: 'Burn', player2DeckArchetype: 'Control' }),
    createMatchRoundEntry({ id: 'entry-2', player1Name: 'Bob', player2Name: 'Dave', player1DeckArchetype: 'Aggro', player2DeckArchetype: '' })
  ]
});

describe('archive bundle contract', () => {
  it('the archive bundle version is 5 and only 5 imports', () => {
    expect(ARCHIVE_DATA_VERSION).toBe(5);
    expect([...SUPPORTED_ARCHIVE_IMPORT_VERSIONS]).toEqual([5]);
    expect(ARCHIVE_LOCK_WINDOW_DAYS).toBe(365);
  });
});

describe('isArchiveTournamentLocked', () => {
  it('a Tournament played today is not locked', () => {
    expect(isArchiveTournamentLocked('2026-08-22', new Date('2026-08-22T00:00:00.000Z'))).toBe(false);
  });

  it('a Tournament played exactly 365 days ago is not locked', () => {
    expect(isArchiveTournamentLocked('2026-08-17', new Date('2027-08-17T23:59:59.999Z'))).toBe(false);
  });

  it('a Tournament played 366 days ago is locked', () => {
    expect(isArchiveTournamentLocked('2026-08-17', new Date('2027-08-18T00:00:00.000Z'))).toBe(true);
  });

  it("the lock compares whole UTC days, not the reader's local day", () => {
    expect(isArchiveTournamentLocked('2026-08-17', new Date('2027-08-18T00:30:00.000Z'))).toBe(true);
    expect(isArchiveTournamentLocked('2026-08-17', new Date('2027-08-17T23:30:00.000Z'))).toBe(false);
  });

  it('a future Tournament is never locked', () => {
    expect(isArchiveTournamentLocked('2030-01-01', new Date('2027-08-18T00:00:00.000Z'))).toBe(false);
  });

  it('an unparseable date never locks', () => {
    const now = new Date('2030-01-01T00:00:00.000Z');

    for (const date of ['', 'nope', '2027-02-29', '2026-02-30', '17/08/2026']) {
      expect(isArchiveTournamentLocked(date, now), date).toBe(false);
    }
  });
});

describe('three-tier factories', () => {
  it('a missing season is stored as standalone, never as an empty string', () => {
    expect(createArchiveTournament({}).seasonId).toBeNull();
    expect(createArchiveTournament({ seasonId: '' }).seasonId).toBeNull();
    expect(createArchiveTournament({ seasonId: '  ' }).seasonId).toBeNull();
  });

  it('an unknown Tournament status reads completed', () => {
    expect(createArchiveTournament({ status: undefined }).status).toBe('completed');
    expect(createArchiveTournament({ status: 'active' }).status).toBe('active');
  });

  it('an unknown Season status reads active', () => {
    expect(createLeagueSeason({ status: undefined }).status).toBe('active');
    expect(createLeagueSeason({ status: 'completed' }).status).toBe('completed');
  });

  it('a Tournament derives its archetypes from its rounds when none are given', () => {
    const tournament = createArchiveTournament({ id: 'local-t1', rounds: [roundWithArchetypes()] });

    expect(tournament.playerArchetypes).toEqual([
      { playerName: 'Alice', archetype: 'Control' },
      { playerName: 'Bob', archetype: 'Aggro' },
      { playerName: 'Carol', archetype: 'Burn' },
      { playerName: 'Dave', archetype: '' }
    ]);
  });

  it('given archetypes are normalized and deduped', () => {
    const tournament = createArchiveTournament({
      id: 'local-t1',
      playerArchetypes: [{ playerName: ' Bob ', archetype: 'No Archetype' }, { playerName: 'Bob', archetype: 'Burn' }]
    });

    expect(tournament.playerArchetypes).toEqual([{ playerName: 'Bob', archetype: '' }]);
  });

  it('a League without a createdAt falls back to the epoch, deterministically', () => {
    expect(createArchiveLeague({ name: 'Lyon' }).createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(createArchiveLeague({ name: 'Lyon' }).createdAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('a League createdAt is canonicalized to UTC', () => {
    expect(createArchiveLeague({ createdAt: '2026-08-22T10:00:00+02:00' }).createdAt).toBe('2026-08-22T08:00:00.000Z');
  });

  it('normalizeArchiveTournament repairs a partial stored row', () => {
    const repaired = normalizeArchiveTournament({ id: 'local-1' } as ArchiveTournamentInput);

    expect(repaired).toMatchObject({ id: 'local-1', rounds: [], playerArchetypes: [], seasonId: null, status: 'completed' });
    expect(repaired.name).not.toBe('');
  });
});

describe('legacy document bridges', () => {
  it('toTournamentDocument drops seasonId and carries the given leagueId', () => {
    const tournament = createArchiveTournament({ id: 'local-t1', name: 'Open', tournamentDate: '2026-08-17' });

    const document = toTournamentDocument(tournament, 'season-1');

    expect(document.leagueId).toBe('season-1');
    expect('seasonId' in document).toBe(false);
  });

  it('toArchiveTournamentDocument drops leagueId and normalizes the season', () => {
    const legacy = createTournament({ id: 't-1', leagueId: 'league-1', name: 'Open', tournamentDate: '2026-08-17' });

    const archived = toArchiveTournamentDocument(legacy, '');

    expect(archived.seasonId).toBeNull();
    expect('leagueId' in archived).toBe(false);
  });

  it("toLeagueDocument nests the Season's Tournaments under the Season id", () => {
    const season = createLeagueSeason({ id: 'season-1', name: 'Spring', leagueId: 'league-1' });
    const tournaments = [
      createArchiveTournament({ id: 'local-t1', name: 'Open', tournamentDate: '2026-08-17', seasonId: 'season-1' }),
      createArchiveTournament({ id: 'local-t2', name: 'Cup', tournamentDate: '2026-08-24', seasonId: 'season-1' })
    ];

    const league = toLeagueDocument(season, tournaments);

    expect(league).toMatchObject({ id: 'season-1', name: 'Spring', status: 'active' });
    expect(league.tournaments.map((tournament) => tournament.leagueId)).toEqual(['season-1', 'season-1']);
  });

  it('the shared round shapes are the very types models.ts declares', () => {
    const round: RoundDocument = createRound({ id: 'round-1', entries: [] });

    expect(round).toEqual(createRound({ id: 'round-1', entries: [] }));
  });
});
