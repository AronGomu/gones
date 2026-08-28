import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isLocalArchiveId } from '../data/archive-origin';
import { isArchiveTournamentRowLocked } from '../data/archive-summary';
import { ARCHIVE_DATA_VERSION, createArchiveLeague, createArchiveTournament, createLeagueSeason } from '../domain/archive-models';
import type { ArchiveBundle, PersistedArchiveTournament, RoundEntry } from '../domain/archive-models';
import { createCalendarEvent, createMatchRoundEntry, MatchRoundEntry } from '../domain/models';
import { renamePlayerInTournament } from '../domain/rename-player';
import { importRoundEntries } from '../domain/round-import';
import {
  ArchiveConcurrencyError,
  ArchiveLeagueNotEmptyError,
  ArchiveNotFoundError,
  LOCAL_ARCHIVE_DB_NAME,
  LOCAL_ARCHIVE_DB_VERSION,
  LOCAL_LEAGUE_SEASON_STORE,
  LOCAL_LEAGUE_STORE,
  LOCAL_TOURNAMENT_STORE,
  LocalArchiveBackend
} from './local-archive-backend.service';
import type { ArchiveTournamentEditBatch } from './local-archive-backend.service';
import { fakeIndexedDbState, installFakeIndexedDb, installOpenFailingOnce, resetFakeIndexedDb, restoreRealIndexedDb } from './in-memory-indexeddb.fake';

/** Built the way the UI builds an entry: through the domain factory, so it carries a real id. */
const match = (player1Name: string, player2Name: string, id?: string): MatchRoundEntry =>
  createMatchRoundEntry({ id, player1Name, player2Name, player1Score: 2, player2Score: 0 });

const rejection = (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (reason: unknown) => reason);

const withoutIds = (entries: RoundEntry[]) => entries.map((entry) => ({ ...entry, id: '' }));

const roundOf = (tournament: PersistedArchiveTournament, roundId: string) => tournament.rounds.find((round) => round.id === roundId)!;

const emptyBatch = (): ArchiveTournamentEditBatch => ({ addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: [] });

/** One League, one Season under it, one Tournament in the Season and one standalone Tournament. */
async function seededArchive() {
  const backend = new LocalArchiveBackend();
  const league = await backend.createArchiveLeague('Lyon');
  const season = await backend.createLeagueSeason(league.id, 'Spring');
  const tournament = await backend.createArchiveTournament(season.id, 'Weekly', '2026-08-15');
  const standalone = await backend.createArchiveTournament(null, 'Open', '2026-08-16');
  return { backend, league, season, tournament, standalone };
}

/** The seeded archive plus one filled round on its Season Tournament, at a known version. */
async function archiveWithRound() {
  const seeded = await seededArchive();
  const withRound = await seeded.backend.addArchiveRound(seeded.tournament.id, seeded.tournament.documentVersion);
  const roundId = withRound.rounds[0].id;
  const filled = await seeded.backend.replaceArchiveRound(withRound.id, roundId, withRound.documentVersion, [match('Alice', 'Bob'), match('Carol', 'Dave')]);
  return { ...seeded, roundId, tournament: filled };
}

function bundleOf(calendarEvents: ArchiveBundle['calendarEvents'] = []): ArchiveBundle {
  return {
    version: ARCHIVE_DATA_VERSION,
    leagues: [createArchiveLeague({ id: 'bundle-league', name: 'Lyon', createdAt: '2026-01-01T00:00:00.000Z' })],
    leagueSeasons: [createLeagueSeason({ id: 'bundle-season', name: 'Spring', leagueId: 'bundle-league' })],
    tournaments: [
      createArchiveTournament({ id: 'bundle-t1', name: 'Weekly', tournamentDate: '2026-02-01', seasonId: 'bundle-season' }),
      createArchiveTournament({ id: 'bundle-t2', name: 'Open', tournamentDate: '2026-03-01', seasonId: null })
    ],
    calendarEvents
  };
}

beforeEach(() => {
  resetFakeIndexedDb();
  installFakeIndexedDb();
});

afterEach(() => {
  restoreRealIndexedDb();
});

describe('LocalArchiveBackend', () => {
  it('names the documented database, version and three stores', () => {
    expect(LOCAL_ARCHIVE_DB_NAME).toBe('gones-archive-local');
    expect(LOCAL_ARCHIVE_DB_VERSION).toBe(1);
    expect(LOCAL_LEAGUE_STORE).toBe('leagues');
    expect(LOCAL_LEAGUE_SEASON_STORE).toBe('league-seasons');
    expect(LOCAL_TOURNAMENT_STORE).toBe('tournaments');
  });

  it('an empty store lists nothing and seeds nothing', async () => {
    const backend = new LocalArchiveBackend();

    const catalogs = [
      await backend.listArchiveLeagues(),
      await backend.listArchiveLeagueSummaries(),
      await backend.listLeagueSeasons(),
      await backend.listLeagueSeasonSummaries(),
      await backend.listArchiveTournaments(),
      await backend.listArchiveTournamentSummaries()
    ];

    for (const catalog of catalogs) expect(catalog).toEqual({ items: [], totalCount: 0, truncated: false });
    expect((await backend.listArchiveLeagues()).items).toEqual([]);
  });

  it('creates a League under a local- id at version 1', async () => {
    const created = await new LocalArchiveBackend().createArchiveLeague('Lyon');

    expect(isLocalArchiveId(created.id)).toBe(true);
    expect(created).toMatchObject({ name: 'Lyon', documentVersion: 1 });
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('creates a Season under its League', async () => {
    const { league, season } = await seededArchive();

    expect(season).toMatchObject({ leagueId: league.id, name: 'Spring', status: 'active', documentVersion: 1 });
    expect(isLocalArchiveId(season.id)).toBe(true);
  });

  it('refuses a Season whose League is absent', async () => {
    const backend = new LocalArchiveBackend();

    const reason = await rejection(backend.createLeagueSeason('local-missing', 'S1'));

    expect(reason).toBeInstanceOf(ArchiveNotFoundError);
    expect(reason).toMatchObject({ status: 404 });
    expect((await backend.listLeagueSeasons()).items).toEqual([]);
  });

  it('renames a Season and changes its status through the version guard', async () => {
    const { backend, season } = await seededArchive();

    const renamed = await backend.renameLeagueSeason(season.id, season.documentVersion, 'Autumn');
    const completed = await backend.changeLeagueSeasonStatus(renamed.id, renamed.documentVersion, 'completed');

    expect(renamed).toMatchObject({ name: 'Autumn', documentVersion: season.documentVersion + 1 });
    expect(completed).toMatchObject({ name: 'Autumn', status: 'completed', documentVersion: season.documentVersion + 2 });
    await expect(backend.renameLeagueSeason(season.id, season.documentVersion, 'Stale')).rejects.toMatchObject({ status: 412 });
  });

  it('moves a Season to another League and refuses an absent one', async () => {
    const { backend, season } = await seededArchive();
    const other = await backend.createArchiveLeague('Paris');

    const moved = await backend.moveLeagueSeason(season.id, season.documentVersion, other.id);

    expect(moved).toMatchObject({ leagueId: other.id, documentVersion: season.documentVersion + 1 });
    const reason = await rejection(backend.moveLeagueSeason(moved.id, moved.documentVersion, 'local-missing'));
    expect(reason).toBeInstanceOf(ArchiveNotFoundError);
    expect(await backend.getLeagueSeason(season.id)).toEqual(moved);
  });

  it('creates a standalone Tournament', async () => {
    const created = await new LocalArchiveBackend().createArchiveTournament(null, 'Open', '2026-08-17');

    expect(created).toMatchObject({ seasonId: null, name: 'Open', tournamentDate: '2026-08-17', status: 'active', documentVersion: 1 });
    expect(created.rounds).toEqual([]);
    expect(created.playerArchetypes).toEqual([]);
  });

  it('creates a Tournament inside a Season', async () => {
    const { season, tournament } = await seededArchive();

    expect(tournament.seasonId).toBe(season.id);
  });

  it('refuses a Tournament whose Season is absent', async () => {
    const backend = new LocalArchiveBackend();

    const reason = await rejection(backend.createArchiveTournament('local-missing', 'Weekly', '2026-08-17'));

    expect(reason).toBeInstanceOf(ArchiveNotFoundError);
    expect((await backend.listArchiveTournaments()).items).toEqual([]);
  });

  it('rejects a stale write with the 412 mirror', async () => {
    const { backend, league } = await seededArchive();

    const reason = await rejection(backend.renameArchiveLeague(league.id, league.documentVersion - 1, 'Renamed'));

    expect(reason).toBeInstanceOf(ArchiveConcurrencyError);
    expect(reason).toMatchObject({ status: 412, message: 'staleArchiveDocument' });
    expect(await backend.getArchiveLeague(league.id)).toEqual(league);
  });

  it('rejects a stale delete and leaves the row in place', async () => {
    const { backend, standalone } = await seededArchive();

    await expect(backend.deleteArchiveTournament(standalone.id, standalone.documentVersion + 1)).rejects.toMatchObject({ status: 412 });

    expect(await backend.getArchiveTournament(standalone.id)).toEqual(standalone);
  });

  it('refuses to delete a League that still holds a Season', async () => {
    const { backend, league } = await seededArchive();

    const reason = await rejection(backend.deleteArchiveLeague(league.id, league.documentVersion));

    expect(reason).toBeInstanceOf(ArchiveLeagueNotEmptyError);
    expect(reason).toMatchObject({ status: 409, message: 'archiveLeagueNotEmpty' });
    expect((await backend.listArchiveLeagues()).items.map((row) => row.id)).toEqual([league.id]);
  });

  it('deletes a League once its last Season is gone', async () => {
    const { backend, league, season } = await seededArchive();

    await backend.deleteLeagueSeason(season.id, season.documentVersion);
    await backend.deleteArchiveLeague(league.id, league.documentVersion);

    expect((await backend.listArchiveLeagues()).items).toEqual([]);
  });

  it('deleting a Season detaches its Tournaments', async () => {
    const { backend, season, tournament } = await seededArchive();
    const second = await backend.createArchiveTournament(season.id, 'Cup', '2026-08-18');
    const transactionsBefore = fakeIndexedDbState.readwriteTransactionCount;

    await backend.deleteLeagueSeason(season.id, season.documentVersion);

    expect(await backend.getLeagueSeason(season.id)).toBeNull();
    expect(await backend.getArchiveTournament(tournament.id)).toMatchObject({ seasonId: null, documentVersion: tournament.documentVersion + 1 });
    expect(await backend.getArchiveTournament(second.id)).toMatchObject({ seasonId: null, documentVersion: second.documentVersion + 1 });
    expect(fakeIndexedDbState.readwriteTransactionCount - transactionsBefore).toBe(1);
  });

  it('a failed detach leaves both stores untouched', async () => {
    const { backend, season, tournament } = await seededArchive();
    const second = await backend.createArchiveTournament(season.id, 'Cup', '2026-08-18');
    fakeIndexedDbState.putCount = 0;
    fakeIndexedDbState.failPutAt = 2;

    await expect(backend.deleteLeagueSeason(season.id, season.documentVersion)).rejects.toThrow();

    expect(await backend.getLeagueSeason(season.id)).toEqual(season);
    expect(await backend.getArchiveTournament(tournament.id)).toEqual(tournament);
    expect(await backend.getArchiveTournament(second.id)).toEqual(second);
  });

  it('moving a Tournament to null makes it standalone', async () => {
    const { backend, tournament } = await seededArchive();

    const moved = await backend.moveArchiveTournament(tournament.id, tournament.documentVersion, null);

    expect(moved.seasonId).toBeNull();
    expect(moved.documentVersion).toBe(tournament.documentVersion + 1);
  });

  it('moving a Tournament to an absent Season is refused', async () => {
    const { backend, tournament } = await seededArchive();

    const reason = await rejection(backend.moveArchiveTournament(tournament.id, tournament.documentVersion, 'local-missing'));

    expect(reason).toBeInstanceOf(ArchiveNotFoundError);
    expect(await backend.getArchiveTournament(tournament.id)).toEqual(tournament);
  });

  it('editing a Tournament bumps no Season and no League', async () => {
    const { backend, league, season, tournament } = await seededArchive();

    await backend.editArchiveTournament(tournament.id, tournament.documentVersion, 'Renamed', '2026-09-01');

    expect(await backend.getLeagueSeason(season.id)).toEqual(season);
    expect(await backend.getArchiveLeague(league.id)).toEqual(league);
  });

  it('adds, imports, replaces and deletes a round through the version guard', async () => {
    const { backend, tournament } = await seededArchive();
    const text = 'table,player,result,opponent,player_decklist,opponent_decklist\n1,Erin,won 2-0,Frank,Burn,Control';

    const added = await backend.addArchiveRound(tournament.id, tournament.documentVersion);
    const roundId = added.rounds[0].id;
    const imported = await backend.importArchiveRound(added.id, roundId, added.documentVersion, text);
    const replaced = await backend.replaceArchiveRound(imported.id, roundId, imported.documentVersion, [match('Alice', 'Bob')]);
    const deleted = await backend.deleteArchiveRound(replaced.id, roundId, replaced.documentVersion);

    expect([added, imported, replaced, deleted].map((row) => row.documentVersion))
      .toEqual([tournament.documentVersion + 1, tournament.documentVersion + 2, tournament.documentVersion + 3, tournament.documentVersion + 4]);
    expect(added.rounds).toHaveLength(1);
    expect(withoutIds(roundOf(imported, roundId).entries)).toEqual(withoutIds(importRoundEntries(text).entries));
    expect(roundOf(replaced, roundId).entries.map((entry) => entry.id)).toHaveLength(1);
    expect(deleted.rounds).toEqual([]);
  });

  it('adds, edits and deletes an entry', async () => {
    const { backend, roundId, tournament } = await archiveWithRound();
    const entryId = roundOf(tournament, roundId).entries[0].id;

    const added = await backend.addArchiveEntry(tournament.id, roundId, tournament.documentVersion, match('Erin', 'Frank'));
    expect(roundOf(added, roundId).entries).toHaveLength(3);

    const edited = await backend.editArchiveEntry(added.id, roundId, entryId, added.documentVersion, match('Alice', 'Grace'));
    const editedEntry = roundOf(edited, roundId).entries.find((entry) => entry.id === entryId);
    expect(editedEntry).toMatchObject({ kind: 'match', id: entryId, player2Name: 'Grace' });

    const deleted = await backend.deleteArchiveEntry(edited.id, roundId, entryId, edited.documentVersion);
    expect(roundOf(deleted, roundId).entries.map((entry) => entry.id)).not.toContain(entryId);
  });

  it('renames a player across every round', async () => {
    const { backend, roundId, tournament } = await archiveWithRound();
    const expected = renamePlayerInTournament(tournament, 'Alice', 'Alicia');

    const renamed = await backend.renameArchiveTournamentPlayer(tournament.id, tournament.documentVersion, 'Alice', 'Alicia');

    expect(JSON.stringify(renamed.rounds)).not.toContain('"Alice"');
    expect(roundOf(renamed, roundId).entries).toEqual(expected.rounds[0].entries);
    expect(renamed.playerArchetypes).toEqual(expected.playerArchetypes);
  });

  it('sets a player archetype', async () => {
    const { backend, tournament } = await archiveWithRound();

    const updated = await backend.updateArchiveTournamentArchetype(tournament.id, tournament.documentVersion, 'Bob', 'Burn');

    expect(updated.playerArchetypes).toContainEqual({ playerName: 'Bob', archetype: 'Burn' });
  });

  it('applies a staged edit batch as one version bump', async () => {
    const { backend, tournament } = await archiveWithRound();
    const newRoundId = crypto.randomUUID();
    const batch: ArchiveTournamentEditBatch = {
      ...emptyBatch(),
      editTournament: { name: 'Renamed', tournamentDate: '2026-09-01' },
      addRounds: [{ roundId: newRoundId, entries: [match('Erin', 'Frank')] }],
      updateArchetypes: [{ playerName: 'Alice', archetype: 'Storm' }]
    };

    const result = await backend.applyArchiveTournamentEditBatch(tournament.id, tournament.documentVersion, batch);

    expect(result.documentVersion).toBe(tournament.documentVersion + 1);
    expect(result).toMatchObject({ name: 'Renamed', tournamentDate: '2026-09-01' });
    expect(result.rounds.map((round) => round.id)).toEqual([roundOf(tournament, tournament.rounds[0].id).id, newRoundId]);
    expect(result.playerArchetypes).toContainEqual({ playerName: 'Alice', archetype: 'Storm' });
  });

  it('moves a Tournament inside a staged edit batch', async () => {
    const { backend, league, tournament } = await archiveWithRound();
    const otherSeason = await backend.createLeagueSeason(league.id, 'Autumn');

    const result = await backend.applyArchiveTournamentEditBatch(tournament.id, tournament.documentVersion, { ...emptyBatch(), moveToSeasonId: otherSeason.id });

    expect(result.seasonId).toBe(otherSeason.id);
    expect(result.documentVersion).toBe(tournament.documentVersion + 1);
  });

  it('refuses an empty staged edit batch', async () => {
    const { backend, tournament } = await archiveWithRound();

    await expect(backend.applyArchiveTournamentEditBatch(tournament.id, tournament.documentVersion, emptyBatch()))
      .rejects.toThrowError('emptyArchiveTournamentEditBatch');
  });

  it('refuses a staged edit batch that both deletes and replaces a round', async () => {
    const { backend, roundId, tournament } = await archiveWithRound();

    await expect(backend.applyArchiveTournamentEditBatch(tournament.id, tournament.documentVersion, {
      ...emptyBatch(),
      deleteRoundIds: [roundId],
      replaceRounds: [{ roundId, entries: [match('Erin', 'Frank')] }]
    })).rejects.toThrowError('conflictingRoundIntents');
  });

  it('a browser-local Tournament stays editable however old it is', async () => {
    const backend = new LocalArchiveBackend();
    const created = await backend.createArchiveTournament(null, 'Ancient', '2000-01-01');

    const edited = await backend.editArchiveTournament(created.id, created.documentVersion, 'Still Editable', '2000-01-01');

    expect(edited.name).toBe('Still Editable');
    expect(isArchiveTournamentRowLocked({ id: created.id, tournamentDate: created.tournamentDate })).toBe(false);
  });

  it('restores a bundle under fresh ids, remapping every parent link', async () => {
    const backend = new LocalArchiveBackend();
    const bundle = bundleOf();

    const restored = await backend.restoreArchiveBundle(bundle);

    for (const row of [...restored.leagues, ...restored.leagueSeasons, ...restored.tournaments]) {
      expect(isLocalArchiveId(row.id)).toBe(true);
      expect(row.documentVersion).toBe(1);
    }
    expect([...restored.leagues, ...restored.leagueSeasons, ...restored.tournaments].map((row) => row.id))
      .not.toContain('bundle-league');
    expect(restored.leagueSeasons[0].leagueId).toBe(restored.leagues[0].id);
    expect(restored.tournaments[0].seasonId).toBe(restored.leagueSeasons[0].id);
    expect(restored.tournaments[1].seasonId).toBeNull();
  });

  it('restoring the same bundle twice yields two independent copies', async () => {
    const backend = new LocalArchiveBackend();

    const first = await backend.restoreArchiveBundle(bundleOf());
    const second = await backend.restoreArchiveBundle(bundleOf());

    expect((await backend.listArchiveLeagues()).totalCount).toBe(2);
    expect((await backend.listLeagueSeasons()).totalCount).toBe(2);
    expect((await backend.listArchiveTournaments()).totalCount).toBe(4);
    expect(first.leagues[0].name).toBe('Lyon');
    expect(second.leagues[0].name).toBe('Lyon (restored)');
  });

  it('ignores the calendar half of a bundle', async () => {
    const backend = new LocalArchiveBackend();

    await backend.restoreArchiveBundle(bundleOf([createCalendarEvent({ id: 'bundle-event', title: 'Regional' })]));

    expect((await backend.listArchiveLeagues()).totalCount).toBe(1);
    expect((await backend.listLeagueSeasons()).totalCount).toBe(1);
    expect((await backend.listArchiveTournaments()).totalCount).toBe(2);
  });

  it('refuses a bundle whose version is not 5', async () => {
    const backend = new LocalArchiveBackend();

    await expect(backend.restoreArchiveBundle({ ...bundleOf(), version: 4 } as unknown as ArchiveBundle))
      .rejects.toThrowError('unsupportedArchiveBundleVersion');

    expect((await backend.listArchiveLeagues()).items).toEqual([]);
    expect((await backend.listArchiveTournaments()).items).toEqual([]);
  });

  it('lists tournaments newest first, ties broken by id', async () => {
    const backend = new LocalArchiveBackend();
    const january = await backend.createArchiveTournament(null, 'January', '2026-01-01');
    const march = await backend.createArchiveTournament(null, 'March', '2026-03-01');
    const februaryA = await backend.createArchiveTournament(null, 'February A', '2026-02-01');
    const februaryB = await backend.createArchiveTournament(null, 'February B', '2026-02-01');
    const tied = [februaryA.id, februaryB.id].sort((left, right) => left.localeCompare(right));

    const listed = await backend.listArchiveTournamentSummaries();

    expect(listed.items.map((row) => row.id)).toEqual([march.id, ...tied, january.id]);
  });

  it("lists a Season's Tournaments and the standalone ones separately", async () => {
    const { backend, season, tournament, standalone } = await seededArchive();
    const second = await backend.createArchiveTournament(season.id, 'Cup', '2026-08-18');

    expect((await backend.listSeasonTournamentSummaries(season.id)).items.map((row) => row.id)).toEqual([second.id, tournament.id]);
    expect((await backend.listSeasonTournamentSummaries(null)).items.map((row) => row.id)).toEqual([standalone.id]);
  });

  it('summary catalogs report totalCount and never truncate', async () => {
    const { backend } = await seededArchive();

    for (const catalog of [
      await backend.listArchiveLeagueSummaries(),
      await backend.listLeagueSeasonSummaries(),
      await backend.listArchiveTournamentSummaries()
    ]) {
      expect(catalog.totalCount).toBe(catalog.items.length);
      expect(catalog.truncated).toBe(false);
      expect(catalog.items.length).toBeGreaterThan(0);
    }
  });

  it('a failed open is retried on the next call', async () => {
    const backend = new LocalArchiveBackend();
    installOpenFailingOnce();

    await expect(backend.listArchiveLeagues()).rejects.toThrow();

    expect((await backend.listArchiveLeagues()).items).toEqual([]);
  });
});
