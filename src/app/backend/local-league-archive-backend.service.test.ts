import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { leagueCommandError } from '../data/league-archive-command-ux';
import { isLocalLeagueId, LOCAL_PLACEHOLDER_LEAGUE_ID } from '../data/league-archive-origin';
import { LeagueStatus, PLACEHOLDER_LEAGUE_ID, PLACEHOLDER_LEAGUE_NAME } from '../domain/models';
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

  it('the adapter never talks to the network', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'local-league-archive-backend.service.ts'), 'utf8');

    expect(source).not.toMatch(/HttpClient|fetch\(|XMLHttpRequest|firstValueFrom/);
  });
});
