import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserProfileResponse } from '../api/generated/gones-api';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { CachedRead, IndexedDbServerReadCacheStore, SERVER_READ_CACHE_DB_NAME, SERVER_READ_CACHE_STORE, SERVER_READ_CACHE_STORE_PORT, ServerReadCacheService } from './server-read-cache.service';

/**
 * ADR 0031 — the cache answers a failed server read and nothing else. No TestBed in this repo, so the
 * service is built with a bare `Injector`, a fake profile and a fake store standing in for IndexedDB.
 * Every claim here is about the two rules that make the cache safe: remote always overwrites, and a
 * row belongs to exactly one user.
 */

/** The `ServerReadCacheStore` seam, in memory. `rows` is the assertion surface. */
function fakeStore(seed: Record<string, CachedRead<unknown>> = {}) {
  const rows = new Map<string, CachedRead<unknown>>(Object.entries(seed));
  return {
    rows,
    read: vi.fn(async (key: string) => rows.get(key) ?? null),
    write: vi.fn(async (key: string, entry: CachedRead<unknown>) => { rows.set(key, entry); }),
    clear: vi.fn(async () => { rows.clear(); })
  };
}

type Store = ReturnType<typeof fakeStore>;

function setup(options: { userId?: string | null; store?: Store } = {}) {
  const store = options.store ?? fakeStore();
  const profile = signal<UserProfileResponse | null>(options.userId ? ({ id: options.userId } as UserProfileResponse) : null);
  const auth = { profile } as unknown as AuthService;
  const sessionScope = new SessionScopeService();
  const injector = Injector.create({ providers: [
    { provide: AuthService, useValue: auth },
    { provide: SessionScopeService, useValue: sessionScope },
    { provide: SERVER_READ_CACHE_STORE_PORT, useValue: store }
  ] });
  const service = runInInjectionContext(injector, () => new ServerReadCacheService());
  return { service, store, profile, sessionScope };
}

function cached(value: unknown): CachedRead<unknown> {
  return { value, cachedAt: '2026-08-09T10:00:00.000Z' };
}

describe('ServerReadCacheService reads', () => {
  it('a successful read is cached under the signed-in user', async () => {
    const { service, store } = setup({ userId: 'u1' });

    await expect(service.read('leagues', () => Promise.resolve([1]))).resolves.toMatchObject({ value: [1], stale: false });

    expect([...store.rows.keys()]).toEqual(['u1:leagues']);
    expect(store.rows.get('u1:leagues')?.value).toEqual([1]);
  });

  it('a successful read overwrites whatever was cached', async () => {
    const store = fakeStore({ 'u1:leagues': cached([9]) });
    const { service } = setup({ userId: 'u1', store });

    const result = await service.read('leagues', () => Promise.resolve([1]));

    expect(result.value).toEqual([1]);
    expect(store.rows.get('u1:leagues')?.value).toEqual([1]);
  });

  it('a failed read falls back to the cached row and flags it stale', async () => {
    const store = fakeStore({ 'u1:leagues': cached([9]) });
    const { service } = setup({ userId: 'u1', store });

    const result = await service.read('leagues', () => Promise.reject(new Error('offline')));

    expect(result).toEqual({ value: [9], stale: true, cachedAt: '2026-08-09T10:00:00.000Z' });
  });

  it('a failed read with no cached row rethrows', async () => {
    const { service } = setup({ userId: 'u1' });

    await expect(service.read('leagues', () => Promise.reject(new Error('offline')))).rejects.toThrowError('offline');
  });

  it('an anonymous caller is passed through and caches nothing', async () => {
    const { service, store } = setup();

    await expect(service.read('leagues', () => Promise.resolve([1]))).resolves.toEqual({ value: [1], stale: false });

    expect(store.rows.size).toBe(0);
    expect(store.read).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('two users do not share a row', async () => {
    const { service, profile } = setup({ userId: 'u1' });
    await service.read('leagues', () => Promise.resolve([1]));

    profile.set({ id: 'u2' } as UserProfileResponse);

    await expect(service.read('leagues', () => Promise.reject(new Error('offline')))).rejects.toThrowError('offline');
  });
});

describe('ServerReadCacheService session boundary', () => {
  it('a read that lands after logout is never written back', async () => {
    const { service, store, profile } = setup({ userId: 'u1' });

    const pending = service.read('leagues', () => Promise.resolve([1]));
    profile.set(null);

    await expect(pending).resolves.toEqual({ value: [1], stale: false });
    expect(store.rows.size).toBe(0);
  });

  it('a read that lands after the next user signed in is not filed under either of them', async () => {
    const { service, store, profile } = setup({ userId: 'u1' });

    const pending = service.read('leagues', () => Promise.resolve([1]));
    profile.set({ id: 'u2' } as UserProfileResponse);

    await expect(pending).resolves.toEqual({ value: [1], stale: false });
    expect(store.rows.size).toBe(0);
  });

  it('never reads user A cache when a rejected request lands after logout', async () => {
    const store = fakeStore({ 'u1:leagues': cached(['user-a']) });
    const { service, profile } = setup({ userId: 'u1', store });
    let rejectLoad!: (error: Error) => void;
    const pending = service.read('leagues', () => new Promise((_resolve, reject) => { rejectLoad = reject; }));

    profile.set(null);
    rejectLoad(new Error('original server error'));

    await expect(pending).rejects.toThrowError('original server error');
    expect(store.read).not.toHaveBeenCalled();
  });

  it('never returns user A cache when a rejected request lands in user B session', async () => {
    const store = fakeStore({ 'u1:leagues': cached(['user-a']) });
    const { service, profile } = setup({ userId: 'u1', store });
    let rejectLoad!: (error: Error) => void;
    const pending = service.read('leagues', () => new Promise((_resolve, reject) => { rejectLoad = reject; }));

    profile.set({ id: 'u2' } as UserProfileResponse);
    rejectLoad(new Error('original server error'));

    await expect(pending).rejects.toThrowError('original server error');
    expect(store.read).not.toHaveBeenCalled();
  });

  it('rechecks the session after an async cache lookup', async () => {
    const store = fakeStore({ 'u1:leagues': cached(['user-a']) });
    let releaseRead!: () => void;
    store.read.mockImplementationOnce((key: string) => new Promise((resolve) => {
      releaseRead = () => resolve(store.rows.get(key) ?? null);
    }));
    const { service, profile } = setup({ userId: 'u1', store });
    const pending = service.read('leagues', () => Promise.reject(new Error('original server error')));
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf('function'));

    profile.set({ id: 'u2' } as UserProfileResponse);
    releaseRead();

    await expect(pending).rejects.toThrowError('original server error');
  });
});

describe('ServerReadCacheService failure containment', () => {
  it('a broken cache never breaks a working server read', async () => {
    const store = fakeStore();
    store.write.mockRejectedValueOnce(new Error('indexedDbUnavailable'));
    const { service } = setup({ userId: 'u1', store });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.read('leagues', () => Promise.resolve([1]))).resolves.toEqual({ value: [1], stale: false });

    expect(logged.mock.calls.map(([line]) => String(line)).join()).toContain('server-read-cache.write');
    logged.mockRestore();
  });

  it('a broken cache is a miss, not a second failure', async () => {
    const store = fakeStore();
    store.read.mockRejectedValueOnce(new Error('indexedDbUnavailable'));
    const { service } = setup({ userId: 'u1', store });

    await expect(service.read('leagues', () => Promise.reject(new Error('offline')))).rejects.toThrowError('offline');
  });
});

describe('ServerReadCacheService purge', () => {
  it('drops every row so the next user reads nothing of this one', async () => {
    const { service, store, profile } = setup({ userId: 'u1' });
    await service.read('leagues', () => Promise.resolve([1]));

    await service.purge();

    expect(store.rows.size).toBe(0);
    profile.set({ id: 'u1' } as UserProfileResponse);
    await expect(service.read('leagues', () => Promise.reject(new Error('offline')))).rejects.toThrowError('offline');
  });

  it('registers itself with the session scope so logout reaches it', async () => {
    const { service, store, sessionScope } = setup({ userId: 'u1' });
    await service.read('leagues', () => Promise.resolve([1]));

    await sessionScope.clear();

    expect(store.rows.size).toBe(0);
  });
});

interface FakeDbState {
  version: number;
  rows: Map<string, unknown>;
  connections: Set<FakeDatabase>;
  deletionChecks: Set<() => void>;
}

const fakeDatabases = new Map<string, FakeDbState>();
const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor(private readonly state: FakeDbState) {}

  objectStore(): { get(key: string): FakeRequest<unknown>; put(value: { key: string }): FakeRequest<string> } {
    return {
      get: (key) => this.request(() => this.state.rows.get(key)),
      put: (value) => this.request(() => { this.state.rows.set(value.key, structuredClone(value)); return value.key; })
    };
  }

  private request<T>(run: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>();
    queueMicrotask(() => {
      request.result = run();
      request.onsuccess?.();
      queueMicrotask(() => this.oncomplete?.());
    });
    return request;
  }
}

class FakeDatabase {
  readonly objectStoreNames = { contains: (name: string) => name === SERVER_READ_CACHE_STORE };
  onversionchange: (() => void) | null = null;
  private closed = false;

  constructor(private readonly state: FakeDbState) { state.connections.add(this); }

  createObjectStore(): void {}
  transaction(): FakeTransaction { return new FakeTransaction(this.state); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.state.connections.delete(this);
    for (const check of this.state.deletionChecks) queueMicrotask(check);
  }
}

const fakeIndexedDb = {
  open(name: string, version: number): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      const state = fakeDatabases.get(name) ?? { version: 0, rows: new Map(), connections: new Set(), deletionChecks: new Set() };
      fakeDatabases.set(name, state);
      const upgrade = state.version < version;
      state.version = version;
      request.result = new FakeDatabase(state);
      if (upgrade) request.onupgradeneeded?.();
      queueMicrotask(() => request.onsuccess?.());
    });
    return request;
  },
  deleteDatabase(name: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    queueMicrotask(() => {
      const state = fakeDatabases.get(name);
      if (!state) { request.onsuccess?.(); return; }
      let blockedReported = false;
      const finish = () => {
        if (state.connections.size) {
          if (!blockedReported) { blockedReported = true; request.onblocked?.(); }
          return;
        }
        state.deletionChecks.delete(finish);
        fakeDatabases.delete(name);
        request.onsuccess?.();
      };
      state.deletionChecks.add(finish);
      for (const connection of [...state.connections]) connection.onversionchange?.();
      finish();
    });
    return request;
  }
};

describe('IndexedDbServerReadCacheStore production lifecycle', () => {
  beforeEach(() => {
    fakeDatabases.clear();
    Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDb as unknown as IDBFactory, configurable: true, writable: true });
  });

  afterEach(() => {
    if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
    else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'indexedDB');
  });

  it('round-trips, deletes with a second connection, then recreates the database', async () => {
    const first = new IndexedDbServerReadCacheStore();
    const second = new IndexedDbServerReadCacheStore();
    const entry = cached({ leagues: [1] });

    await first.write('u1:leagues', entry);
    await expect(first.read('u1:leagues')).resolves.toEqual(entry);
    await expect(second.read('u1:leagues')).resolves.toEqual(entry); // holds another same-app connection

    await first.clear();

    expect(fakeDatabases.has(SERVER_READ_CACHE_DB_NAME)).toBe(false);
    await expect(second.read('u1:leagues')).resolves.toBeNull();
    await second.write('u2:leagues', cached({ leagues: [2] }));
    await expect(second.read('u2:leagues')).resolves.toEqual(cached({ leagues: [2] }));
  });
});
