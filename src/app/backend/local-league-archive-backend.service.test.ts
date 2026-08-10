import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { leagueCommandError } from '../data/league-archive-command-ux';
import { isLocalLeagueId, LOCAL_PLACEHOLDER_LEAGUE_ID } from '../data/league-archive-origin';
import { createMatchRoundEntry, getDefaultTournamentName, LeagueStatus, MatchRoundEntry, PersistedLeague, PLACEHOLDER_LEAGUE_ID, PLACEHOLDER_LEAGUE_NAME, RoundEntry } from '../domain/models';
import { renamePlayerInLeague } from '../domain/rename-player';
import { importRoundEntries } from '../domain/round-import';
import type { LeagueArchiveBackendPort } from './application-backend';
import { LOCAL_LEAGUE_DB_NAME, LOCAL_LEAGUE_STORE, LocalLeagueArchiveBackend } from './local-league-archive-backend.service';

/**
 * `fake-indexeddb` is not a dependency and this ticket adds none, so the whole IndexedDB surface the
 * adapter uses is stubbed in-memory here — the same fake `local-live-backend.service.test.ts` uses.
 * The backing maps live at module scope, so a second adapter instance re-opens the same data.
 */
interface FakeStore {
  keyPath: string;
  rows: Map<string, unknown>;
}

interface FakeDatabaseState {
  version: number;
  stores: Map<string, FakeStore>;
}

const databases = new Map<string, FakeDatabaseState>();

function clone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class FakeObjectStore {
  constructor(private readonly store: FakeStore, private readonly transaction: FakeTransaction) {}

  getAll(): FakeRequest<unknown[]> {
    return this.transaction.enqueue(() => [...this.store.rows.values()].map((row) => clone(row)));
  }

  get(key: string): FakeRequest<unknown> {
    const row = this.store.rows.get(key);
    return this.transaction.enqueue(() => (row === undefined ? undefined : clone(row)));
  }

  put(value: Record<string, unknown>): FakeRequest<string> {
    return this.transaction.enqueue(() => {
      const key = String(value[this.store.keyPath]);
      this.store.rows.set(key, clone(value));
      return key;
    });
  }

  delete(key: string): FakeRequest<undefined> {
    return this.transaction.enqueue(() => {
      this.store.rows.delete(key);
      return undefined;
    });
  }
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private pending = 0;
  private failed = false;
  private settled = false;

  constructor(private readonly state: FakeDatabaseState, readonly mode: string) {}

  objectStore(name: string): FakeObjectStore {
    const store = this.state.stores.get(name);
    if (!store) throw new Error(`NotFoundError: object store ${name}`);
    return new FakeObjectStore(store, this);
  }

  enqueue<T>(run: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      this.pending -= 1;
      try {
        request.result = run();
        request.onsuccess?.();
      } catch (error) {
        this.failed = true;
        request.error = error as DOMException;
        request.onerror?.();
      }
      if (this.pending === 0) queueMicrotask(() => this.settle());
    });
    return request;
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    if (this.failed) this.onerror?.();
    else this.oncomplete?.();
  }
}

class FakeDatabase {
  readonly objectStoreNames: { contains: (name: string) => boolean };

  constructor(private readonly state: FakeDatabaseState) {
    this.objectStoreNames = { contains: (name: string) => this.state.stores.has(name) };
  }

  createObjectStore(name: string, options: { keyPath: string }): void {
    this.state.stores.set(name, { keyPath: options.keyPath, rows: new Map() });
  }

  transaction(_names: string[], mode: string): FakeTransaction {
    return new FakeTransaction(this.state, mode);
  }

  close(): void {}
}

const fakeIndexedDb = {
  open(name: string, version: number): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      const existing = databases.get(name);
      const state = existing ?? { version: 0, stores: new Map<string, FakeStore>() };
      if (!existing) databases.set(name, state);
      const upgradeNeeded = state.version < version;
      request.result = new FakeDatabase(state);
      if (upgradeNeeded) {
        state.version = version;
        request.onupgradeneeded?.();
      }
      queueMicrotask(() => request.onsuccess?.());
    });
    return request;
  }
};

const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

function installFakeIndexedDb(): void {
  Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDb as unknown as IDBFactory, configurable: true, writable: true });
}

const league = (id: string, name: string) => ({ id, name, status: 'active' as LeagueStatus, tournaments: [] });

/** Built the way the UI builds an entry: through the domain factory, so it carries a real id. */
const match = (player1Name: string, player2Name: string, id?: string): MatchRoundEntry =>
  createMatchRoundEntry({ id, player1Name, player2Name, player1Score: 2, player2Score: 0 });

/** One local league, one tournament, one round holding two match entries, at a known version. */
async function leagueWithRound(): Promise<{ backend: LocalLeagueArchiveBackend; leagueId: string; tournamentId: string; roundId: string; version: number; league: PersistedLeague }> {
  const backend = new LocalLeagueArchiveBackend();
  const created = await backend.createLeagueArchive('Summer');
  const withTournament = await backend.createArchiveTournament(created.id, created.documentVersion, 'Weekly', '2026-08-15');
  const tournamentId = withTournament.tournaments[0].id;
  const withRound = await backend.addArchiveRound(created.id, tournamentId, withTournament.documentVersion);
  const roundId = withRound.tournaments[0].rounds[0].id;
  const filled = await backend.replaceArchiveRound(created.id, tournamentId, roundId, withRound.documentVersion, [match('Alice', 'Bob'), match('Carol', 'Dave')]);
  return { backend, leagueId: created.id, tournamentId, roundId, version: filled.documentVersion, league: filled };
}

const roundOf = (persisted: PersistedLeague, tournamentId: string, roundId: string) =>
  persisted.tournaments.find((tournament) => tournament.id === tournamentId)!.rounds.find((round) => round.id === roundId)!;

const rejection = (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (reason: unknown) => reason);

const withoutIds = (entries: RoundEntry[]) => entries.map((entry) => ({ ...entry, id: '' }));

beforeEach(() => {
  databases.clear();
  installFakeIndexedDb();
});

afterEach(() => {
  if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
  else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'indexedDB');
});

describe('LocalLeagueArchiveBackend', () => {
  it('names the documented database and store', () => {
    expect(LOCAL_LEAGUE_DB_NAME).toBe('gones-leagues');
    expect(LOCAL_LEAGUE_STORE).toBe('leagues');
  });

  it('listing an empty store seeds the placeholder', async () => {
    const backend = new LocalLeagueArchiveBackend();

    const listed = await backend.listLeagueArchives();

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: LOCAL_PLACEHOLDER_LEAGUE_ID, name: PLACEHOLDER_LEAGUE_NAME, status: 'active' });
    expect(listed[0].tournaments).toEqual([]);
  });

  it('creating a league gives it a local id', async () => {
    const backend = new LocalLeagueArchiveBackend();

    const created = await backend.createLeagueArchive('Summer');

    expect(isLocalLeagueId(created.id)).toBe(true);
    expect(created.name).toBe('Summer');
    expect(created.documentVersion).toBe(1);
  });

  it('a created league is readable back', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    expect(await backend.getLeagueArchive(created.id)).toEqual(created);
  });

  it('an unknown id reads as null', async () => {
    const backend = new LocalLeagueArchiveBackend();

    expect(await backend.getLeagueArchive('local-nope')).toBeNull();
  });

  it('creating trims and defaults the name', async () => {
    const backend = new LocalLeagueArchiveBackend();

    expect((await backend.createLeagueArchive('   ')).name).toBe('New League');
    expect((await backend.createLeagueArchive('  Winter  ')).name).toBe('Winter');
  });

  it('renaming bumps the version', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    const renamed = await backend.renameLeagueArchive(created.id, created.documentVersion, 'Winter');

    expect(renamed.name).toBe('Winter');
    expect(renamed.documentVersion).toBe(2);
    expect(renamed.id).toBe(created.id);
  });

  it('renaming with a stale version is refused', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    const error = await backend.renameLeagueArchive(created.id, 99, 'Winter').then(() => null, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as { status?: number }).status).toBe(412);
    expect((error as Error).message).toBe('staleLeagueDocument');
    expect(leagueCommandError(error)).toBe('stale');
  });

  it('a refused write leaves the document untouched', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    await backend.renameLeagueArchive(created.id, 99, 'Winter').catch(() => undefined);

    const stored = await backend.getLeagueArchive(created.id);
    expect(stored?.name).toBe('Summer');
    expect(stored?.documentVersion).toBe(1);
  });

  it('changing status bumps the version', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    const completed = await backend.changeLeagueArchiveStatus(created.id, created.documentVersion, 'completed');

    expect(completed.status).toBe('completed');
    expect(completed.documentVersion).toBe(2);
  });

  it('an unknown status normalises', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    const updated = await backend.changeLeagueArchiveStatus(created.id, created.documentVersion, 'nonsense' as LeagueStatus);

    expect(updated.status).toBe('active');
  });

  it('deleting removes the row', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    await backend.deleteLeagueArchive(created.id, created.documentVersion);

    expect(await backend.getLeagueArchive(created.id)).toBeNull();
  });

  it('deleting with a stale version is refused', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    const error = await backend.deleteLeagueArchive(created.id, 99).then(() => null, (reason: unknown) => reason);

    expect((error as { status?: number }).status).toBe(412);
    expect(await backend.getLeagueArchive(created.id)).not.toBeNull();
  });

  it('deleting an unknown id rejects', async () => {
    const backend = new LocalLeagueArchiveBackend();

    const error = await backend.deleteLeagueArchive('local-nope', 1).then(() => null, (reason: unknown) => reason);

    expect((error as Error).message).toBe('leagueNotFound');
  });

  it('every write stamps updatedAt', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    const renamed = await backend.renameLeagueArchive(created.id, created.documentVersion, 'Winter');

    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(renamed.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(renamed.updatedAt! >= created.updatedAt!).toBe(true);
  });

  it('listing sorts the placeholder first then by name', async () => {
    const backend = new LocalLeagueArchiveBackend();
    await backend.createLeagueArchive('Zulu');
    await backend.createLeagueArchive('alpha');

    const listed = await backend.listLeagueArchives();

    expect(listed.map((item) => item.name)).toEqual([PLACEHOLDER_LEAGUE_NAME, 'alpha', 'Zulu']);
    expect(listed[0].id).toBe(LOCAL_PLACEHOLDER_LEAGUE_ID);
  });

  it('restoring a single league lands in the local namespace', async () => {
    const backend = new LocalLeagueArchiveBackend();

    const restored = await backend.restoreLeagueArchive({ kind: 'league', gonesDataVersion: 4, league: league('server-uuid', 'Imported') });

    expect(isLocalLeagueId(restored.id)).toBe(true);
    expect(restored.name).toBe('Imported');
    expect(restored.documentVersion).toBe(1);
    expect(await backend.getLeagueArchive(restored.id)).toEqual(restored);
  });

  it('restoring full data lands every league locally', async () => {
    const backend = new LocalLeagueArchiveBackend();

    const restored = await backend.restoreFullLeagueArchiveData({
      kind: 'fullData',
      gonesDataVersion: 4,
      leagues: [league('server-a', 'Alpha'), league('server-b', 'Beta')]
    });

    expect(restored).toHaveLength(2);
    expect(restored.every((item) => isLocalLeagueId(item.id))).toBe(true);
    for (const item of restored) expect(await backend.getLeagueArchive(item.id)).toEqual(item);
    expect(await backend.listLeagueArchives()).toHaveLength(3);
  });

  it('a restored server placeholder becomes the local placeholder', async () => {
    const backend = new LocalLeagueArchiveBackend();

    const restored = await backend.restoreFullLeagueArchiveData({
      kind: 'fullData',
      gonesDataVersion: 4,
      leagues: [league(PLACEHOLDER_LEAGUE_ID, PLACEHOLDER_LEAGUE_NAME), league('server-b', 'Beta')]
    });

    expect(restored[0].id).toBe(LOCAL_PLACEHOLDER_LEAGUE_ID);
    const listed = await backend.listLeagueArchives();
    expect(listed.filter((item) => item.id === LOCAL_PLACEHOLDER_LEAGUE_ID)).toHaveLength(1);
    expect(listed).toHaveLength(2);
  });

  it('creating a tournament appends it', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    const updated = await backend.createArchiveTournament(created.id, created.documentVersion, 'Weekly', '2026-08-15');

    expect(updated.tournaments).toHaveLength(1);
    expect(updated.tournaments[0]).toMatchObject({ name: 'Weekly', tournamentDate: '2026-08-15', leagueId: created.id });
    expect(updated.tournaments[0].id).toBeTruthy();
    expect(updated.documentVersion).toBe(2);
  });

  it('an unnamed tournament gets the default name', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    const updated = await backend.createArchiveTournament(created.id, created.documentVersion, '', '');

    expect(updated.tournaments[0].name).toBe(getDefaultTournamentName());
  });

  it('creating with a stale version is refused', async () => {
    const backend = new LocalLeagueArchiveBackend();
    const created = await backend.createLeagueArchive('Summer');

    const error = await rejection(backend.createArchiveTournament(created.id, 99, 'x', ''));

    expect((error as { status?: number }).status).toBe(412);
    expect((await backend.getLeagueArchive(created.id))?.tournaments).toHaveLength(0);
  });

  it('editing a tournament changes name and date', async () => {
    const { backend, leagueId, tournamentId, roundId, version, league: before } = await leagueWithRound();

    const updated = await backend.editArchiveTournament(leagueId, tournamentId, version, 'Renamed', '2026-09-01');

    expect(updated.tournaments[0]).toMatchObject({ id: tournamentId, name: 'Renamed', tournamentDate: '2026-09-01', leagueId });
    expect(updated.tournaments[0].rounds).toEqual(before.tournaments[0].rounds);
    expect(roundOf(updated, tournamentId, roundId).entries).toHaveLength(2);
    expect(updated.documentVersion).toBe(version + 1);
  });

  it('editing an unknown tournament is a no-op write', async () => {
    const { backend, leagueId, version, league: before } = await leagueWithRound();

    const updated = await backend.editArchiveTournament(leagueId, 'nope', version, 'x', '');

    expect(updated.tournaments).toEqual(before.tournaments);
    expect(updated.documentVersion).toBe(version + 1);
  });

  it('deleting a tournament removes it', async () => {
    const { backend, leagueId, tournamentId, version } = await leagueWithRound();
    const twoTournaments = await backend.createArchiveTournament(leagueId, version, 'Second', '2026-08-22');
    const survivorId = twoTournaments.tournaments.find((tournament) => tournament.id !== tournamentId)!.id;

    const updated = await backend.deleteArchiveTournament(leagueId, tournamentId, twoTournaments.documentVersion);

    expect(updated.tournaments.map((tournament) => tournament.id)).toEqual([survivorId]);
  });

  it('adding a round appends an empty round', async () => {
    const { backend, leagueId, tournamentId, version } = await leagueWithRound();

    const updated = await backend.addArchiveRound(leagueId, tournamentId, version);

    expect(updated.tournaments[0].rounds).toHaveLength(2);
    expect(updated.tournaments[0].rounds[1].entries).toEqual([]);
    expect(updated.tournaments[0].rounds[1].id).toBeTruthy();
  });

  it('deleting a round removes only that round', async () => {
    const { backend, leagueId, tournamentId, roundId, version } = await leagueWithRound();
    const twoRounds = await backend.addArchiveRound(leagueId, tournamentId, version);
    const secondRoundId = twoRounds.tournaments[0].rounds[1].id;

    const updated = await backend.deleteArchiveRound(leagueId, tournamentId, roundId, twoRounds.documentVersion);

    expect(updated.tournaments[0].rounds.map((round) => round.id)).toEqual([secondRoundId]);
  });

  it('replacing a round swaps its entries', async () => {
    const { backend, leagueId, tournamentId, roundId, version } = await leagueWithRound();
    const twoRounds = await backend.addArchiveRound(leagueId, tournamentId, version);
    const otherRoundId = twoRounds.tournaments[0].rounds[1].id;

    const updated = await backend.replaceArchiveRound(leagueId, tournamentId, roundId, twoRounds.documentVersion, [match('Erin', 'Frank')]);

    const replaced = roundOf(updated, tournamentId, roundId);
    expect(replaced.entries).toHaveLength(1);
    expect(replaced.entries[0]).toMatchObject({ kind: 'match', player1Name: 'Erin', player2Name: 'Frank' });
    expect(roundOf(updated, tournamentId, otherRoundId).entries).toEqual([]);
  });

  it('importing a round parses text into entries', async () => {
    const { backend, leagueId, tournamentId, roundId, version } = await leagueWithRound();
    const text = '1,Alice,Won 2-1,Bob,Fire,Ice\n2,Carol,Lost 0-2,Dave,Water,Earth';

    const updated = await backend.importArchiveRound(leagueId, tournamentId, roundId, version, text);

    expect(withoutIds(roundOf(updated, tournamentId, roundId).entries)).toEqual(withoutIds(importRoundEntries(text).entries));
  });

  it('adding an entry appends to the round', async () => {
    const { backend, leagueId, tournamentId, roundId, version } = await leagueWithRound();

    const updated = await backend.addArchiveEntry(leagueId, tournamentId, roundId, version, match('Erin', 'Frank'));

    const entries = roundOf(updated, tournamentId, roundId).entries;
    expect(entries).toHaveLength(3);
    expect(entries[2]).toMatchObject({ kind: 'match', player1Name: 'Erin', player2Name: 'Frank' });
    expect(entries[2].id).toBeTruthy();
  });

  it('editing an entry replaces it in place', async () => {
    const { backend, leagueId, tournamentId, roundId, version, league: before } = await leagueWithRound();
    const [first, second] = roundOf(before, tournamentId, roundId).entries;

    const updated = await backend.editArchiveEntry(leagueId, tournamentId, roundId, first.id, version, match('Alicia', 'Bob', first.id));

    const entries = roundOf(updated, tournamentId, roundId).entries;
    expect(entries.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(entries[0]).toMatchObject({ kind: 'match', player1Name: 'Alicia', player2Name: 'Bob' });
  });

  it('deleting an entry removes it', async () => {
    const { backend, leagueId, tournamentId, roundId, version, league: before } = await leagueWithRound();
    const [first, second] = roundOf(before, tournamentId, roundId).entries;

    const updated = await backend.deleteArchiveEntry(leagueId, tournamentId, roundId, first.id, version);

    expect(roundOf(updated, tournamentId, roundId).entries.map((entry) => entry.id)).toEqual([second.id]);
  });

  it('setting a player archetype records it', async () => {
    const { backend, leagueId, tournamentId, version } = await leagueWithRound();

    const updated = await backend.updateArchivePlayerArchetype(leagueId, tournamentId, 'Alice', version, 'Burn');

    expect(updated.tournaments[0].playerArchetypes).toContainEqual({ playerName: 'Alice', archetype: 'Burn' });
  });

  it('setting an archetype twice overwrites', async () => {
    const { backend, leagueId, tournamentId, version } = await leagueWithRound();
    const first = await backend.updateArchivePlayerArchetype(leagueId, tournamentId, 'Alice', version, 'Burn');

    const updated = await backend.updateArchivePlayerArchetype(leagueId, tournamentId, 'Alice', first.documentVersion, 'Storm');

    const rows = updated.tournaments[0].playerArchetypes.filter((row) => row.playerName === 'Alice');
    expect(rows).toEqual([{ playerName: 'Alice', archetype: 'Storm' }]);
  });

  it('renaming a player rewrites every entry', async () => {
    const { backend, leagueId, tournamentId, roundId, version, league: before } = await leagueWithRound();

    const updated = await backend.renameLeagueArchivePlayerName(leagueId, version, 'Alice', 'Alicia');

    const entries = roundOf(updated, tournamentId, roundId).entries;
    expect(JSON.stringify(updated.tournaments)).not.toContain('Alice"');
    expect(entries[0]).toMatchObject({ kind: 'match', player1Name: 'Alicia', player2Name: 'Bob' });
    expect(updated.tournaments).toEqual(renamePlayerInLeague(before, 'Alice', 'Alicia').tournaments);
  });

  it('moving a tournament transfers it', async () => {
    const { backend, leagueId, tournamentId, version } = await leagueWithRound();
    const target = await backend.createLeagueArchive('Autumn');

    const moved = await backend.moveArchiveTournament(leagueId, tournamentId, version, target.id, target.documentVersion);

    expect(moved.fromLeague.tournaments).toHaveLength(0);
    expect(moved.toLeague.tournaments).toHaveLength(1);
    expect(moved.toLeague.tournaments[0]).toMatchObject({ id: tournamentId, leagueId: target.id });
    expect(moved.fromLeague.documentVersion).toBe(version + 1);
    expect(moved.toLeague.documentVersion).toBe(target.documentVersion + 1);
    expect(await backend.getLeagueArchive(leagueId)).toEqual(moved.fromLeague);
    expect(await backend.getLeagueArchive(target.id)).toEqual(moved.toLeague);
  });

  it('moving refuses a stale source', async () => {
    const { backend, leagueId, tournamentId, version } = await leagueWithRound();
    const target = await backend.createLeagueArchive('Autumn');

    const error = await rejection(backend.moveArchiveTournament(leagueId, tournamentId, version + 50, target.id, target.documentVersion));

    expect((error as { status?: number }).status).toBe(412);
    expect((await backend.getLeagueArchive(leagueId))?.tournaments).toHaveLength(1);
    expect(await backend.getLeagueArchive(target.id)).toEqual(target);
  });

  it('moving refuses a stale target', async () => {
    const { backend, leagueId, tournamentId, version, league: before } = await leagueWithRound();
    const target = await backend.createLeagueArchive('Autumn');

    const error = await rejection(backend.moveArchiveTournament(leagueId, tournamentId, version, target.id, target.documentVersion + 50));

    expect((error as { status?: number }).status).toBe(412);
    expect(await backend.getLeagueArchive(leagueId)).toEqual(before);
    expect(await backend.getLeagueArchive(target.id)).toEqual(target);
  });

  it('moving to a server league is refused', async () => {
    const { backend, leagueId, tournamentId, version, league: before } = await leagueWithRound();

    const error = await rejection(backend.moveArchiveTournament(leagueId, tournamentId, version, PLACEHOLDER_LEAGUE_ID, 1));

    expect((error as Error).message).toBe('crossAuthorityMoveNotSupported');
    expect(await backend.getLeagueArchive(leagueId)).toEqual(before);
    expect(await backend.getLeagueArchive(PLACEHOLDER_LEAGUE_ID)).toBeNull();
  });

  it('moving into the local placeholder is allowed', async () => {
    const { backend, leagueId, tournamentId, version } = await leagueWithRound();
    const placeholder = (await backend.listLeagueArchives()).find((item) => item.id === LOCAL_PLACEHOLDER_LEAGUE_ID)!;

    const moved = await backend.moveArchiveTournament(leagueId, tournamentId, version, LOCAL_PLACEHOLDER_LEAGUE_ID, placeholder.documentVersion);

    expect(moved.toLeague.id).toBe(LOCAL_PLACEHOLDER_LEAGUE_ID);
    expect(moved.toLeague.tournaments.map((tournament) => tournament.id)).toEqual([tournamentId]);
    expect(moved.toLeague.name).toBe(PLACEHOLDER_LEAGUE_NAME);
    expect(moved.fromLeague.tournaments).toHaveLength(0);
  });

  it('every write bumps exactly one version', async () => {
    const { backend, leagueId, tournamentId, roundId, version, league: before } = await leagueWithRound();
    const entryId = roundOf(before, tournamentId, roundId).entries[0].id;

    let current = version;
    for (const call of [
      () => backend.createArchiveTournament(leagueId, current, 'Second', '2026-08-22'),
      () => backend.editArchiveTournament(leagueId, tournamentId, current, 'Renamed', '2026-09-01'),
      () => backend.addArchiveRound(leagueId, tournamentId, current),
      () => backend.replaceArchiveRound(leagueId, tournamentId, roundId, current, [match('Erin', 'Frank')]),
      () => backend.importArchiveRound(leagueId, tournamentId, roundId, current, '1,Alice,Won 2-1,Bob,Fire,Ice'),
      () => backend.addArchiveEntry(leagueId, tournamentId, roundId, current, match('Gina', 'Hank')),
      () => backend.editArchiveEntry(leagueId, tournamentId, roundId, entryId, current, match('Alicia', 'Bob', entryId)),
      () => backend.deleteArchiveEntry(leagueId, tournamentId, roundId, entryId, current),
      () => backend.updateArchivePlayerArchetype(leagueId, tournamentId, 'Alice', current, 'Burn'),
      () => backend.renameLeagueArchivePlayerName(leagueId, current, 'Alice', 'Alicia'),
      () => backend.deleteArchiveRound(leagueId, tournamentId, roundId, current),
      () => backend.deleteArchiveTournament(leagueId, tournamentId, current)
    ]) {
      const expected = current + 1;
      const result = await call();
      expect(result.documentVersion).toBe(expected);
      current = result.documentVersion;
    }

    // The move is the one command that spans two documents: one bump per league.
    const source = await leagueWithRound();
    const target = await source.backend.createLeagueArchive('Autumn');
    const moved = await source.backend.moveArchiveTournament(source.leagueId, source.tournamentId, source.version, target.id, target.documentVersion);

    expect(moved.fromLeague.documentVersion).toBe(source.version + 1);
    expect(moved.toLeague.documentVersion).toBe(target.documentVersion + 1);
  });

  it('every method rejects a stale version', async () => {
    const { backend, leagueId, tournamentId, roundId, version, league: before } = await leagueWithRound();
    const entryId = roundOf(before, tournamentId, roundId).entries[0].id;
    const target = await backend.createLeagueArchive('Autumn');
    const stale = version + 50;

    const calls: (() => Promise<unknown>)[] = [
      () => backend.createArchiveTournament(leagueId, stale, 'Second', '2026-08-22'),
      () => backend.editArchiveTournament(leagueId, tournamentId, stale, 'Renamed', '2026-09-01'),
      () => backend.deleteArchiveTournament(leagueId, tournamentId, stale),
      () => backend.addArchiveRound(leagueId, tournamentId, stale),
      () => backend.deleteArchiveRound(leagueId, tournamentId, roundId, stale),
      () => backend.replaceArchiveRound(leagueId, tournamentId, roundId, stale, [match('Erin', 'Frank')]),
      () => backend.importArchiveRound(leagueId, tournamentId, roundId, stale, '1,Alice,Won 2-1,Bob,Fire,Ice'),
      () => backend.addArchiveEntry(leagueId, tournamentId, roundId, stale, match('Gina', 'Hank')),
      () => backend.editArchiveEntry(leagueId, tournamentId, roundId, entryId, stale, match('Alicia', 'Bob', entryId)),
      () => backend.deleteArchiveEntry(leagueId, tournamentId, roundId, entryId, stale),
      () => backend.updateArchivePlayerArchetype(leagueId, tournamentId, 'Alice', stale, 'Burn'),
      () => backend.renameLeagueArchivePlayerName(leagueId, stale, 'Alice', 'Alicia'),
      () => backend.moveArchiveTournament(leagueId, tournamentId, stale, target.id, target.documentVersion)
    ];

    for (const call of calls) {
      const error = await rejection(call());
      expect((error as { status?: number }).status).toBe(412);
      expect((error as Error).message).toBe('staleLeagueDocument');
      expect(leagueCommandError(error)).toBe('stale');
      expect(await backend.getLeagueArchive(leagueId)).toEqual(before);
      expect(await backend.getLeagueArchive(target.id)).toEqual(target);
    }
  });

  it('the adapter satisfies the whole port', () => {
    const port: LeagueArchiveBackendPort = new LocalLeagueArchiveBackend();

    const methods: (keyof LeagueArchiveBackendPort)[] = [
      'listLeagueArchives', 'getLeagueArchive', 'createLeagueArchive', 'renameLeagueArchive', 'changeLeagueArchiveStatus', 'deleteLeagueArchive',
      'createArchiveTournament', 'editArchiveTournament', 'deleteArchiveTournament', 'moveArchiveTournament', 'addArchiveRound', 'deleteArchiveRound',
      'importArchiveRound', 'replaceArchiveRound', 'addArchiveEntry', 'editArchiveEntry', 'deleteArchiveEntry', 'updateArchivePlayerArchetype',
      'renameLeagueArchivePlayerName', 'restoreLeagueArchive', 'restoreFullLeagueArchiveData'
    ];

    expect(methods).toHaveLength(21);
    for (const method of methods) expect(typeof port[method]).toBe('function');
  });

  it('the adapter never talks to the network', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'local-league-archive-backend.service.ts'), 'utf8');

    expect(source).not.toMatch(/HttpClient|fetch\(|XMLHttpRequest|firstValueFrom|\/api\//);
  });
});
