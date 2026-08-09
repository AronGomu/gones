import '@angular/compiler';
import { HttpClient } from '@angular/common/http';
import { Injector } from '@angular/core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveCommandError } from '../data/live-command-ux';
import { finalizeLiveTournament as finalizeLiveTournamentDocument, generateNextSwissRound, LiveTournamentDocument } from '../domain/live-tournament';
import { LOCAL_LIVE_DB_NAME, LOCAL_LIVE_STORE, LocalLiveBackend } from './local-live-backend.service';

/**
 * `fake-indexeddb` is not a dependency and this ticket adds none, so the whole IndexedDB surface the
 * adapter uses is stubbed in-memory here. The backing maps live at module scope, which is what makes
 * the "survives a new service instance" row meaningful: a second adapter re-opens the same data.
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

function newBackend(http = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() }): { backend: LocalLiveBackend; http: typeof http } {
  const injector = Injector.create({ providers: [LocalLiveBackend, { provide: HttpClient, useValue: http }] });
  return { backend: injector.get(LocalLiveBackend), http };
}

const player = (name: string) => ({ name, initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' });

async function withFourPlayers(backend: LocalLiveBackend, roundCount = 1): Promise<LiveTournamentDocument> {
  let document = await backend.createLiveTournament('2026-08-08');
  document = await backend.updateLiveSettings(document.id, document.documentVersion, {
    name: 'Local Cup', leagueId: '', tournamentDate: '2026-08-08', roundCount, customRoundCount: true, paidTrackingEnabled: false
  });
  for (const name of ['Alice', 'Bob', 'Carol', 'Dave']) {
    document = await backend.addLivePlayer(document.id, document.documentVersion, player(name));
  }
  return document;
}

async function scoreAndValidate(backend: LocalLiveBackend, started: LiveTournamentDocument): Promise<LiveTournamentDocument> {
  let document = started;
  const round = document.rounds.find((item) => item.roundNumber === document.currentRoundNumber)!;
  for (const item of round.entries.filter(({ entry }) => entry.kind === 'match')) {
    document = await backend.scoreLiveRoundEntry(document.id, round.id, item.entry.id, document.documentVersion, { player1Score: 2, player2Score: 0 });
  }
  return backend.validateLiveRound(document.id, document.documentVersion);
}

beforeEach(() => {
  databases.clear();
  installFakeIndexedDb();
});

afterEach(() => {
  if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
  else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'indexedDB');
});

describe('LocalLiveBackend', () => {
  it('names the documented database and store', () => {
    expect(LOCAL_LIVE_DB_NAME).toBe('gones-live');
    expect(LOCAL_LIVE_STORE).toBe('tournaments');
  });

  it('create then list round-trips', async () => {
    const { backend } = newBackend();

    const created = await backend.createLiveTournament('2026-08-08');
    const listed = await backend.listLiveTournaments();

    expect(created.documentVersion).toBe(1);
    expect(created.tournamentDate).toBe('2026-08-08');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: created.id, documentVersion: 1 });
  });

  it('survives a new service instance', async () => {
    const created = await newBackend().backend.createLiveTournament('2026-08-08');

    const reopened = await newBackend().backend.getLiveTournament(created.id);

    expect(reopened).toEqual(created);
  });

  it('a mutation bumps the version', async () => {
    const { backend } = newBackend();
    const created = await backend.createLiveTournament('2026-08-08');

    const updated = await backend.addLivePlayer(created.id, 1, player('Alice'));

    expect(updated.documentVersion).toBe(2);
    expect(updated.players.map((item) => item.name)).toEqual(['Alice']);
  });

  it('a stale version is rejected', async () => {
    const { backend } = newBackend();
    const created = await backend.createLiveTournament('2026-08-08');
    await backend.addLivePlayer(created.id, 1, player('Alice'));

    const error = await backend.addLivePlayer(created.id, 1, player('Bob')).then(() => null, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(liveCommandError(error)).toBe('stale');
    expect((await backend.getLiveTournament(created.id))?.players).toHaveLength(1);
  });

  it('delete removes the document', async () => {
    const { backend } = newBackend();
    const created = await backend.createLiveTournament('2026-08-08');

    await backend.deleteLiveTournament(created.id, created.documentVersion);

    expect(await backend.getLiveTournament(created.id)).toBeNull();
    expect(await backend.listLiveTournaments()).toEqual([]);
  });

  it('rounds go through the domain rules', async () => {
    const { backend } = newBackend();
    const registered = await withFourPlayers(backend);

    const started = await backend.startLiveRound(registered.id, registered.documentVersion);

    const expected = generateNextSwissRound({ ...registered, pairingSeed: started.pairingSeed });
    const pairings = (document: LiveTournamentDocument) => document.rounds[0].entries.map(({ entry }) => JSON.stringify({ ...entry, id: '' }));
    expect(started.stage).toBe('round');
    expect(started.rounds[0].entries).toHaveLength(2);
    expect(pairings(started)).toEqual(pairings(expected));
    expect(started.documentVersion).toBe(registered.documentVersion + 1);
  });

  it('restore rolls back to a checkpoint', async () => {
    const { backend } = newBackend();
    const registered = await withFourPlayers(backend);
    const started = await backend.startLiveRound(registered.id, registered.documentVersion);
    const validated = await scoreAndValidate(backend, started);
    const checkpoint = validated.checkpoints.at(-1)!;

    const restored = await backend.restoreLiveCheckpoint(validated.id, checkpoint.id, validated.documentVersion);

    expect(validated.stage).toBe('standings');
    expect(restored.stage).toBe('round');
    expect(restored.rounds.every((round) => !round.validated)).toBe(true);
    expect(restored.documentVersion).toBe(validated.documentVersion + 1);
  });

  it('finalize returns a tournament document', async () => {
    const { backend } = newBackend();
    const registered = await withFourPlayers(backend);
    const started = await backend.startLiveRound(registered.id, registered.documentVersion);
    const validated = await scoreAndValidate(backend, started);

    const result = await backend.finalizeLiveTournament(validated.id, validated.documentVersion);

    expect(result.leagueId).toBe('');
    expect(result.liveTournamentId).toBe(validated.id);
    expect(result.finalizedTournamentId).not.toBe('');
    expect(result.liveDocumentVersion).toBe(validated.documentVersion + 1);

    const stored = (await backend.getLiveTournament(validated.id))!;
    expect(stored.stage).toBe('completed');
    expect(stored.finalizedTournamentId).toBe(result.finalizedTournamentId);
    // "Downloadable" is exactly this: the caller rebuilds the same TournamentDocument the server
    // would have archived, and hands it to `saveJsonFile` instead of writing a League.
    const downloadable = finalizeLiveTournamentDocument(stored);
    expect(downloadable.id).toBe(result.finalizedTournamentId);
    expect(downloadable.rounds).toHaveLength(1);
    expect(downloadable.rounds[0].entries).toHaveLength(2);
  });

  it('no network call is made', async () => {
    const { backend, http } = newBackend();
    const registered = await withFourPlayers(backend);
    const started = await backend.startLiveRound(registered.id, registered.documentVersion);
    const validated = await scoreAndValidate(backend, started);
    await backend.finalizeLiveTournament(validated.id, validated.documentVersion);
    await backend.listLiveTournaments();

    for (const [method, spy] of Object.entries(http)) {
      expect(spy, `HttpClient.${method}`).not.toHaveBeenCalled();
    }
    // Structural proof, stronger than the spies: the adapter has no HTTP dependency to call.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'local-live-backend.service.ts'), 'utf8');
    expect(source).not.toMatch(/HttpClient|fetch\(|XMLHttpRequest|firstValueFrom/);
  });
});
