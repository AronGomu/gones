/**
 * Shared in-memory IndexedDB fake for the backend vitest suites.
 *
 * `fake-indexeddb` is deliberately not a dependency, so the IndexedDB surface the local adapters and
 * the caches use is stubbed here instead. This is the superset of the four fakes that were previously
 * copy-pasted across those suites: keys are normalized with `String(...)` because the archive year
 * store is keyed by a number, object stores expose `clear()`, a put can be made to fail on demand, and
 * a failed or aborted transaction rolls every store back to its start-of-transaction snapshot.
 *
 * The backing maps live at module scope, which is what makes a "survives a new service instance" row
 * meaningful: a second adapter re-opens the same data until `resetFakeIndexedDb()` drops it.
 *
 * Test scaffolding only, never reachable from an app path — `server-authority-boundary.test.ts`
 * allowlists this file by name.
 */

export interface FakeStore {
  keyPath: string;
  rows: Map<string, unknown>;
}

export interface FakeDatabaseState {
  version: number;
  stores: Map<string, FakeStore>;
}

export interface FakeIndexedDbState {
  /** Backing data, keyed by database name. Suites may read and mutate directly. */
  readonly databases: Map<string, FakeDatabaseState>;
  /** 1-based put ordinal that throws DOMException('Injected put failure', 'ConstraintError'). null = never. */
  failPutAt: number | null;
  /** Total put() calls since last resetFakeIndexedDb(). Suites may reset to 0 mid-test. */
  putCount: number;
  /** Total transactions opened with mode 'readwrite' since last resetFakeIndexedDb(). */
  readwriteTransactionCount: number;
}

/** Shared mutable state. Counters are fields (not module lets) so importing suites can assign them. */
export const fakeIndexedDbState: FakeIndexedDbState = {
  databases: new Map<string, FakeDatabaseState>(),
  failPutAt: null,
  putCount: 0,
  readwriteTransactionCount: 0
};

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

  get(key: unknown): FakeRequest<unknown> {
    const row = this.store.rows.get(String(key));
    return this.transaction.enqueue(() => (row === undefined ? undefined : clone(row)));
  }

  put(value: Record<string, unknown>): FakeRequest<string> {
    return this.transaction.enqueue(() => {
      fakeIndexedDbState.putCount += 1;
      if (fakeIndexedDbState.putCount === fakeIndexedDbState.failPutAt) throw new DOMException('Injected put failure', 'ConstraintError');
      const key = String(value[this.store.keyPath]);
      this.store.rows.set(key, clone(value));
      return key;
    });
  }

  delete(key: unknown): FakeRequest<undefined> {
    return this.transaction.enqueue(() => { this.store.rows.delete(String(key)); return undefined; });
  }

  clear(): FakeRequest<undefined> {
    return this.transaction.enqueue(() => { this.store.rows.clear(); return undefined; });
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
  private readonly snapshot: Map<string, Map<string, unknown>>;

  constructor(private readonly state: FakeDatabaseState, readonly mode: string) {
    this.snapshot = new Map([...state.stores].map(([name, store]) => [name, new Map([...store.rows].map(([key, value]) => [key, clone(value)]))]));
  }

  abort(): void { this.failed = true; queueMicrotask(() => this.settle(true)); }

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
      try { request.result = run(); request.onsuccess?.(); }
      catch (error) { this.failed = true; request.error = error as DOMException; request.onerror?.(); }
      if (this.pending === 0) setTimeout(() => this.settle(), 0);
    });
    return request;
  }

  private settle(aborted = false): void {
    if (this.settled) return;
    this.settled = true;
    if (this.failed) {
      for (const [name, rows] of this.snapshot) {
        const store = this.state.stores.get(name);
        if (store) store.rows = new Map(rows);
      }
      if (aborted) this.onabort?.(); else this.onerror?.();
    } else this.oncomplete?.();
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
    if (mode === 'readwrite') fakeIndexedDbState.readwriteTransactionCount += 1;
    return new FakeTransaction(this.state, mode);
  }

  close(): void {}
}

const fakeIndexedDb = {
  open(name: string, version: number): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      const existing = fakeIndexedDbState.databases.get(name);
      const state = existing ?? { version: 0, stores: new Map<string, FakeStore>() };
      if (!existing) fakeIndexedDbState.databases.set(name, state);
      const upgradeNeeded = state.version < version;
      request.result = new FakeDatabase(state);
      if (upgradeNeeded) { state.version = version; request.onupgradeneeded?.(); }
      queueMicrotask(() => request.onsuccess?.());
    });
    return request;
  }
};

const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

/** Replaces globalThis.indexedDB with the fake factory (configurable + writable). */
export function installFakeIndexedDb(): void {
  Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDb as unknown as IDBFactory, configurable: true, writable: true });
}

/**
 * Restores the globalThis.indexedDB descriptor captured at module load,
 * or deletes the property if none existed.
 */
export function restoreRealIndexedDb(): void {
  if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
  else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'indexedDB');
}

/** Clears databases and resets failPutAt to null, putCount and readwriteTransactionCount to 0. */
export function resetFakeIndexedDb(): void {
  fakeIndexedDbState.databases.clear();
  fakeIndexedDbState.failPutAt = null;
  fakeIndexedDbState.putCount = 0;
  fakeIndexedDbState.readwriteTransactionCount = 0;
}

/**
 * Replaces globalThis.indexedDB with a one-shot failing factory: the first open() fires
 * onerror with DOMException('Injected open failure', 'UnknownError'); every later open()
 * falls through to the shared fake.
 */
export function installOpenFailingOnce(): void {
  let failed = false;
  const factory = {
    open(name: string, version: number): FakeRequest<FakeDatabase> {
      if (failed) return fakeIndexedDb.open(name, version);
      failed = true;
      const request = new FakeRequest<FakeDatabase>();
      queueMicrotask(() => {
        request.error = new DOMException('Injected open failure', 'UnknownError');
        request.onerror?.();
      });
      return request;
    }
  };
  Object.defineProperty(globalThis, 'indexedDB', { value: factory as unknown as IDBFactory, configurable: true, writable: true });
}
