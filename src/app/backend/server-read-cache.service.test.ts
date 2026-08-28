import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserProfileResponse } from '../api/generated/gones-api';
import { AuthSessionCoordinationService } from '../auth/auth-session-coordination.service';
import { AuthService } from '../auth/auth.service';
import { installFakeWebLocks } from '../auth/fake-web-locks';
import { SessionScopeService } from '../auth/session-scope.service';
import { REGISTRATIONS_CACHE_FAMILY, registrationsCacheKey } from '../features/events/my-registrations';
import { CachedRead, IndexedDbServerReadCacheStore, PRIVATE_CACHE_MAX_KEYS, SERVER_READ_CACHE_STORE_PORT, ServerReadCacheService } from './server-read-cache.service';

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
    delete: vi.fn(async (key: string) => { rows.delete(key); }),
    clear: vi.fn(async () => { rows.clear(); }),
    keys: vi.fn(async () => [...rows.keys()])
  };
}

type Store = ReturnType<typeof fakeStore>;

function setup(options: { userId?: string | null; store?: Store } = {}) {
  const store = options.store ?? fakeStore();
  const profile = signal<UserProfileResponse | null>(options.userId ? ({ id: options.userId } as UserProfileResponse) : null);
  const auth = { profile } as unknown as AuthService;
  const sessionScope = new SessionScopeService();
  const coordination = new AuthSessionCoordinationService();
  if (options.userId) coordination.bindProfile(options.userId, coordination.generation());
  const injector = Injector.create({ providers: [
    { provide: AuthService, useValue: auth },
    { provide: AuthSessionCoordinationService, useValue: coordination },
    { provide: SessionScopeService, useValue: sessionScope },
    { provide: SERVER_READ_CACHE_STORE_PORT, useValue: store }
  ] });
  const service = runInInjectionContext(injector, () => new ServerReadCacheService());
  return { service, store, profile, sessionScope, coordination };
}

function cached(value: unknown): CachedRead<unknown> {
  return { value, cachedAt: '2026-08-09T10:00:00.000Z' };
}

/** A row this many hours old, for the TTL boundary the fallback-only `read()` never had. */
function cachedHoursAgo(value: unknown, hours: number): CachedRead<unknown> {
  return { value, cachedAt: new Date(Date.now() - hours * 60 * 60 * 1000).toISOString() };
}

beforeEach(() => {
  localStorage.clear();
  installFakeWebLocks();
});

afterEach(() => vi.restoreAllMocks());

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

  it('a stale other-tab profile cannot capture a newer shared generation', async () => {
    const { service, store, profile } = setup({ userId: 'u1' });
    const otherTab = new AuthSessionCoordinationService();
    await otherTab.withAvailableLock(() => otherTab.advanceGeneration());
    await store.clear();

    await expect(service.read('leagues', () => Promise.resolve([1]))).resolves.toEqual({ value: [1], stale: false });

    expect(profile()?.id).toBe('u1');
    expect(store.rows.size).toBe(0);
    expect(store.write).not.toHaveBeenCalled();
  });

  it('an old profile cannot cache during same-tab token-to-profile publication', async () => {
    const { service, store, profile, coordination } = setup({ userId: 'u1' });
    await coordination.withAvailableLock(() => coordination.advanceGeneration());

    await expect(service.read('leagues', () => Promise.resolve([1]))).resolves.toEqual({ value: [1], stale: false });

    expect(profile()?.id).toBe('u1');
    expect(store.rows.size).toBe(0);
    expect(store.write).not.toHaveBeenCalled();
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

  it('does not recreate a purged row when another tab response lands with a stale profile', async () => {
    const store = fakeStore({ 'u1:leagues': cached(['old']) });
    const tabB = setup({ userId: 'u1', store });
    const tabA = new AuthSessionCoordinationService();
    let resolveLoad!: (value: number[]) => void;
    const pending = tabB.service.read('leagues', () => new Promise<number[]>((resolve) => { resolveLoad = resolve; }));

    tabA.invalidateSession();
    await store.clear();
    tabA.markPurgeComplete();
    resolveLoad([1]);

    await expect(pending).resolves.toEqual({ value: [1], stale: false });
    expect(tabB.profile()?.id).toBe('u1');
    expect(store.rows.size).toBe(0);
    expect(store.write).not.toHaveBeenCalled();
  });

  it('returns original server error when fallback lookup spans another tab invalidation', async () => {
    const store = fakeStore({ 'u1:leagues': cached(['old']) });
    let capturedRow: CachedRead<unknown> | null | undefined;
    let releaseRead!: () => void;
    store.read.mockImplementationOnce((key: string) => {
      capturedRow = store.rows.get(key) ?? null;
      return new Promise((resolve) => {
        releaseRead = () => resolve(capturedRow ?? null);
      });
    });
    const tabB = setup({ userId: 'u1', store });
    const tabA = new AuthSessionCoordinationService();
    const serverError = new Error('original server error');
    const pending = tabB.service.read('leagues', () => Promise.reject(serverError));
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf('function'));
    expect(capturedRow?.value).toEqual(['old']);

    tabA.invalidateSession();
    await store.clear();
    tabA.markPurgeComplete();
    releaseRead();

    await expect(pending).rejects.toBe(serverError);
    expect(tabB.profile()?.id).toBe('u1');
  });

  it('does not recreate a purged row when localStorage becomes unwritable', async () => {
    const store = fakeStore({ 'u1:leagues': cached(['old']) });
    const tabB = setup({ userId: 'u1', store });
    const tabA = new AuthSessionCoordinationService();
    let resolveLoad!: (value: number[]) => void;
    const pending = tabB.service.read('leagues', () => new Promise<number[]>((resolve) => { resolveLoad = resolve; }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });

    tabA.invalidateSession();
    await store.clear();
    tabA.markPurgeComplete();
    resolveLoad([1]);

    await expect(pending).resolves.toEqual({ value: [1], stale: false });
    expect(tabB.profile()?.id).toBe('u1');
    expect(store.rows.size).toBe(0);
    expect(store.write).not.toHaveBeenCalled();
  });

  it('does not return a captured stale row when localStorage becomes unwritable', async () => {
    const store = fakeStore({ 'u1:leagues': cached(['old']) });
    let capturedRow: CachedRead<unknown> | null | undefined;
    let releaseRead!: () => void;
    store.read.mockImplementationOnce((key: string) => {
      capturedRow = store.rows.get(key) ?? null;
      return new Promise((resolve) => {
        releaseRead = () => resolve(capturedRow ?? null);
      });
    });
    const tabB = setup({ userId: 'u1', store });
    const tabA = new AuthSessionCoordinationService();
    const serverError = new Error('original server error');
    const pending = tabB.service.read('leagues', () => Promise.reject(serverError));
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf('function'));
    expect(capturedRow?.value).toEqual(['old']);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });

    tabA.invalidateSession();
    await store.clear();
    tabA.markPurgeComplete();
    releaseRead();

    await expect(pending).rejects.toBe(serverError);
    expect(tabB.profile()?.id).toBe('u1');
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

/**
 * F39 — the freshness check only decides whether a row is served; without eviction every distinct
 * query string mints one permanent key until logout. Writes past the cap sweep: expired rows first,
 * then oldest-first back to the cap. The sweep is over-cap-only, so a normal write stays one keys()
 * call, and a broken sweep is swallowed like any other cache write failure.
 */
describe('ServerReadCacheService eviction', () => {
  function seedFresh(count: number): Record<string, CachedRead<unknown>> {
    const seed: Record<string, CachedRead<unknown>> = {};
    for (let i = 0; i < count; i++) seed[`u1:audit?page=${i}`] = cachedHoursAgo([i], 1 + i / 1000);
    return seed;
  }

  it('evicts the oldest row once the key count passes the cap', async () => {
    const store = fakeStore(seedFresh(PRIVATE_CACHE_MAX_KEYS));
    const { service } = setup({ userId: 'u1', store });

    await service.read('audit?page=new', () => Promise.resolve(['new']));

    expect(store.rows.size).toBe(PRIVATE_CACHE_MAX_KEYS);
    expect(store.rows.has(`u1:audit?page=${PRIVATE_CACHE_MAX_KEYS - 1}`)).toBe(false);
    expect(store.rows.has('u1:audit?page=new')).toBe(true);
  });

  it('drops every expired row when a write triggers the sweep', async () => {
    const seed = seedFresh(PRIVATE_CACHE_MAX_KEYS - 5);
    for (let i = 0; i < 5; i++) seed[`u1:stale?page=${i}`] = cachedHoursAgo([i], 25);
    const store = fakeStore(seed);
    const { service } = setup({ userId: 'u1', store });

    await service.read('audit?page=new', () => Promise.resolve(['new']));

    expect([...store.rows.keys()].filter((key) => key.startsWith('u1:stale'))).toEqual([]);
    expect(store.rows.size).toBe(PRIVATE_CACHE_MAX_KEYS - 4);
  });

  it('never sweeps a store at or under the cap', async () => {
    const store = fakeStore({ 'u1:audit?page=0': cachedHoursAgo([0], 25) });
    const { service } = setup({ userId: 'u1', store });

    await service.read('audit?page=1', () => Promise.resolve([1]));

    expect(store.delete).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(2);
  });

  it('a broken sweep never breaks the working server read', async () => {
    const store = fakeStore(seedFresh(PRIVATE_CACHE_MAX_KEYS));
    store.delete.mockRejectedValueOnce(new Error('indexedDbUnavailable'));
    const { service } = setup({ userId: 'u1', store });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.read('audit?page=new', () => Promise.resolve(['new']))).resolves.toEqual({ value: ['new'], stale: false });

    expect(logged.mock.calls.map(([line]) => String(line)).join()).toContain('server-read-cache.write');
    logged.mockRestore();
  });
});

/**
 * ADR 0039 amends ADR 0031: the same store also answers a *fresh* navigation while its row is under
 * the TTL. Everything that made `read()` safe still holds — anonymous callers cache nothing, and a
 * response that lands after the session moved is answered but never written.
 */
describe('ServerReadCacheService readCached', () => {
  it('serves a fresh row without calling the loader', async () => {
    const store = fakeStore({ 'u1:registrations': cachedHoursAgo([9], 1) });
    const { service } = setup({ userId: 'u1', store });
    const load = vi.fn(async () => [1]);

    const result = await service.readCached('registrations', load);

    expect(load).not.toHaveBeenCalled();
    expect(result).toMatchObject({ value: [9], fromCache: true, stale: false });
    expect(result.fetchedAt).toBe(store.rows.get('u1:registrations')?.cachedAt);
  });

  it('reloads an expired row', async () => {
    const store = fakeStore({ 'u1:registrations': cachedHoursAgo([9], 25) });
    const { service } = setup({ userId: 'u1', store });
    const load = vi.fn(async () => [1]);

    const result = await service.readCached('registrations', load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ value: [1], fromCache: false, stale: false });
    expect(store.rows.get('u1:registrations')?.value).toEqual([1]);
  });

  it('force always reloads', async () => {
    const store = fakeStore({ 'u1:registrations': cachedHoursAgo([9], 1) });
    const { service } = setup({ userId: 'u1', store });
    const load = vi.fn(async () => [1]);

    const result = await service.readCached('registrations', load, { force: true });

    expect(load).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ value: [1], fromCache: false });
    expect(store.read).not.toHaveBeenCalled();
  });

  it('honours a caller TTL', async () => {
    const store = fakeStore({ 'u1:registrations': cachedHoursAgo([9], 2) });
    const { service } = setup({ userId: 'u1', store });

    await expect(service.readCached('registrations', async () => [1], { ttlMs: 60 * 60 * 1000 }))
      .resolves.toMatchObject({ value: [1], fromCache: false });
  });

  it('falls back to a stale row when the loader rejects', async () => {
    const store = fakeStore({ 'u1:registrations': cachedHoursAgo([9], 25) });
    const { service } = setup({ userId: 'u1', store });

    const result = await service.readCached('registrations', () => Promise.reject(new Error('offline')));

    expect(result).toMatchObject({ value: [9], stale: true, fromCache: true });
  });

  it('rethrows when there is no row', async () => {
    const { service } = setup({ userId: 'u1' });

    await expect(service.readCached('registrations', () => Promise.reject(new Error('offline')))).rejects.toThrowError('offline');
  });

  it('never caches for an anonymous caller', async () => {
    const { service, store } = setup();

    await expect(service.readCached('registrations', async () => [1])).resolves.toMatchObject({ value: [1], fromCache: false, stale: false });

    expect(store.rows.size).toBe(0);
    expect(store.read).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('writes nothing when the user changed mid-flight', async () => {
    const { service, store, profile } = setup({ userId: 'u1' });

    const pending = service.readCached('registrations', () => Promise.resolve([1]));
    profile.set({ id: 'u2' } as UserProfileResponse);

    await expect(pending).resolves.toMatchObject({ value: [1], fromCache: false });
    expect(store.rows.size).toBe(0);
    expect(store.write).not.toHaveBeenCalled();
  });

  it('never serves user A rows to user B', async () => {
    const store = fakeStore({ 'u1:registrations': cachedHoursAgo(['user-a'], 1) });
    const { service, profile } = setup({ userId: 'u1', store });
    profile.set({ id: 'u2' } as UserProfileResponse);

    await expect(service.readCached('registrations', async () => ['user-b'])).resolves.toMatchObject({ value: ['user-b'], fromCache: false });
  });

  it('treats a broken cache as a miss, not a failure', async () => {
    const store = fakeStore({ 'u1:registrations': cachedHoursAgo([9], 1) });
    store.read.mockRejectedValueOnce(new Error('indexedDbUnavailable'));
    const { service } = setup({ userId: 'u1', store });

    await expect(service.readCached('registrations', async () => [1])).resolves.toMatchObject({ value: [1], fromCache: false });
  });
});

describe('ServerReadCacheService invalidate', () => {
  it('drops one row only', async () => {
    const store = fakeStore({ 'u1:registrations': cached([1]), 'u1:settings': cached([2]) });
    const { service } = setup({ userId: 'u1', store });

    await service.invalidate('registrations');

    expect([...store.rows.keys()]).toEqual(['u1:settings']);
  });

  it('forces the next read back to the server', async () => {
    const store = fakeStore({ 'u1:registrations': cachedHoursAgo([9], 1) });
    const { service } = setup({ userId: 'u1', store });

    await service.invalidate('registrations');

    await expect(service.readCached('registrations', async () => [1])).resolves.toMatchObject({ value: [1], fromCache: false });
  });

  it('deletes nothing for an anonymous caller', async () => {
    const store = fakeStore({ 'u1:registrations': cached([1]) });
    const { service } = setup({ store });

    await service.invalidate('registrations');

    expect(store.delete).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(1);
  });

  it('never turns a broken cache into a failed mutation', async () => {
    const store = fakeStore({ 'u1:registrations': cached([1]) });
    store.delete.mockRejectedValueOnce(new Error('indexedDbUnavailable'));
    const { service } = setup({ userId: 'u1', store });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.invalidate('registrations')).resolves.toBeUndefined();

    expect(logged.mock.calls.map(([line]) => String(line)).join()).toContain('server-read-cache.invalidate');
    logged.mockRestore();
  });
});

/**
 * `invalidateFamily` matches a key that *is* the family or begins `<family>?` and nothing else, so a
 * paged key shaped any other way makes the call a silent no-op — the mutation looks invalidated and
 * the page keeps serving the row for the full 24h. These pin the one paged family in the app against
 * the matcher rather than trusting the two to stay in step.
 */
describe('ServerReadCacheService invalidateFamily', () => {
  it('drops every page My Registrations caches, and nothing else', async () => {
    const store = fakeStore({
      [`u1:${registrationsCacheKey(1)}`]: cached([1]),
      [`u1:${registrationsCacheKey(2)}`]: cached([2]),
      [`u1:${REGISTRATIONS_CACHE_FAMILY}`]: cached([3]),
      'u1:registrations-elsewhere': cached([4]),
      'u2:registrations?page=1': cached([5])
    });
    const { service } = setup({ userId: 'u1', store });

    await service.invalidateFamily(REGISTRATIONS_CACHE_FAMILY);

    expect([...store.rows.keys()]).toEqual(['u1:registrations-elsewhere', 'u2:registrations?page=1']);
  });

  it('deletes nothing for an anonymous caller', async () => {
    const store = fakeStore({ [`u1:${registrationsCacheKey(1)}`]: cached([1]) });
    const { service } = setup({ store });

    await service.invalidateFamily(REGISTRATIONS_CACHE_FAMILY);

    expect(store.delete).not.toHaveBeenCalled();
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

interface FakeObjectStoreState {
  keyPath: string;
  rows: Map<IDBValidKey, unknown>;
}

interface FakeDbState {
  version: number;
  stores: Map<string, FakeObjectStoreState>;
  connections: Set<FakeDatabase>;
  deletionChecks: Set<() => void>;
}

const fakeDatabases = new Map<string, FakeDbState>();
const openedDatabaseNames: string[] = [];
const deletedDatabaseNames: string[] = [];
const createdObjectStores: Array<{ name: string; keyPath: string | string[] | null }> = [];
const transactionStoreNames: string[] = [];
const extractedPutKeys: IDBValidKey[] = [];
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

  constructor(private readonly storeName: string, private readonly store: FakeObjectStoreState) {}

  objectStore(name: string): { get(key: IDBValidKey): FakeRequest<unknown>; put(value: Record<string, unknown>): FakeRequest<IDBValidKey>; delete(key: IDBValidKey): FakeRequest<undefined> } {
    if (name !== this.storeName) throw new DOMException(`Object store ${name} is not in this transaction.`, 'NotFoundError');
    return {
      get: (key) => this.request(() => this.store.rows.get(key)),
      delete: (key) => this.request(() => { this.store.rows.delete(key); return undefined; }),
      put: (value) => this.request(() => {
        const key = value[this.store.keyPath] as IDBValidKey | undefined;
        if (key === undefined) throw new DOMException(`Missing key path ${this.store.keyPath}.`, 'DataError');
        extractedPutKeys.push(key);
        this.store.rows.set(key, structuredClone(value));
        return key;
      })
    };
  }

  private request<T>(run: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>();
    queueMicrotask(() => {
      try {
        request.result = run();
        request.onsuccess?.();
        queueMicrotask(() => this.oncomplete?.());
      } catch (error) {
        request.error = error instanceof DOMException ? error : new DOMException(String(error), 'UnknownError');
        this.error = request.error;
        request.onerror?.();
      }
    });
    return request;
  }
}

class FakeDatabase {
  readonly objectStoreNames = { contains: (name: string) => this.state.stores.has(name) };
  onversionchange: (() => void) | null = null;
  private closed = false;

  constructor(private readonly state: FakeDbState) { state.connections.add(this); }

  createObjectStore(name: string, options?: IDBObjectStoreParameters): void {
    if (this.state.stores.has(name)) throw new DOMException(`Object store ${name} already exists.`, 'ConstraintError');
    const keyPath = options?.keyPath ?? null;
    createdObjectStores.push({ name, keyPath });
    if (typeof keyPath !== 'string') throw new DOMException('Fake requires string keyPath.', 'DataError');
    this.state.stores.set(name, { keyPath, rows: new Map() });
  }

  transaction(storeNames: string | string[]): FakeTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    if (names.length !== 1) throw new DOMException('Fake supports one object store.', 'NotFoundError');
    const storeName = names[0];
    transactionStoreNames.push(storeName);
    const store = this.state.stores.get(storeName);
    if (!store) throw new DOMException(`Object store ${storeName} does not exist.`, 'NotFoundError');
    return new FakeTransaction(storeName, store);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.state.connections.delete(this);
    for (const check of this.state.deletionChecks) queueMicrotask(check);
  }
}

const fakeIndexedDb = {
  open(name: string, version: number): FakeRequest<FakeDatabase> {
    openedDatabaseNames.push(name);
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      const state = fakeDatabases.get(name) ?? { version: 0, stores: new Map(), connections: new Set(), deletionChecks: new Set() };
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
    deletedDatabaseNames.push(name);
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
    openedDatabaseNames.length = 0;
    deletedDatabaseNames.length = 0;
    createdObjectStores.length = 0;
    transactionStoreNames.length = 0;
    extractedPutKeys.length = 0;
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

    expect(fakeDatabases.has('gones-cache')).toBe(false);
    await expect(second.read('u1:leagues')).resolves.toBeNull();
    await second.write('u2:leagues', cached({ leagues: [2] }));
    await expect(second.read('u2:leagues')).resolves.toEqual(cached({ leagues: [2] }));

    expect(new Set(openedDatabaseNames)).toEqual(new Set(['gones-cache']));
    expect(deletedDatabaseNames).toEqual(['gones-cache']);
    expect(createdObjectStores).toEqual([
      { name: 'reads', keyPath: 'key' },
      { name: 'reads', keyPath: 'key' }
    ]);
    expect(new Set(transactionStoreNames)).toEqual(new Set(['reads']));
    expect(extractedPutKeys).toEqual(['u1:leagues', 'u2:leagues']);
  });

  it('deletes one row and leaves the rest of the database standing', async () => {
    const store = new IndexedDbServerReadCacheStore();
    await store.write('u1:leagues', cached([1]));
    await store.write('u1:settings', cached([2]));

    await store.delete('u1:leagues');

    await expect(store.read('u1:leagues')).resolves.toBeNull();
    await expect(store.read('u1:settings')).resolves.toEqual(cached([2]));
    expect(deletedDatabaseNames).toEqual([]);
  });

  it('rejects a delete blocked past the hold deadline so the purge settles and stays retryable', async () => {
    vi.useFakeTimers();
    try {
      const store = new IndexedDbServerReadCacheStore();
      await store.write('u1:leagues', cached([1]));
      const state = fakeDatabases.get('gones-cache')!;
      // A frozen or back-forward-cached tab: holds a connection, never runs versionchange.
      const frozenPeer = { onversionchange: null, close: () => undefined } as unknown as FakeDatabase;
      state.connections.add(frozenPeer);
      const pending = store.clear();
      const settled = expect(pending).rejects.toThrow('indexedDbDeleteBlocked');
      await vi.advanceTimersByTimeAsync(10_000);
      await settled;
      expect(fakeDatabases.has('gones-cache')).toBe(true); // delete never completed; a later purge retries it
    } finally {
      vi.useRealTimers();
    }
  });

  it('completes a briefly blocked delete when the peer closes before the deadline', async () => {
    vi.useFakeTimers();
    try {
      const store = new IndexedDbServerReadCacheStore();
      await store.write('u1:leagues', cached([1]));
      const state = fakeDatabases.get('gones-cache')!;
      const frozenPeer = { onversionchange: null, close: () => undefined } as unknown as FakeDatabase;
      state.connections.add(frozenPeer);
      const pending = store.clear();
      await vi.advanceTimersByTimeAsync(1_000);
      state.connections.delete(frozenPeer);
      for (const check of [...state.deletionChecks]) check();
      await expect(pending).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(10_000); // deadline timer was cleared; must not throw late
      expect(fakeDatabases.has('gones-cache')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
