import { inject, Injectable, InjectionToken } from '@angular/core';
import { AuthCacheScope, AuthSessionCoordinationService } from '../auth/auth-session-coordination.service';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { logBoundaryError } from '../shared/app-logger';
import { get, openDatabase, put, remove } from './indexed-db';

/**
 * Per-user offline read cache for server responses (ADR 0031, amended by ADR 0039).
 *
 * It is a cache, never an authority: it is never merged into a response, and nothing in it is ever
 * sent back to the server. A fulfilled read overwrites its row unconditionally — that is "remote
 * prevails" in code.
 *
 * There are two reads over the one store. `read()` is **fallback-only**: its row is served solely
 * after the server read it mirrors has failed, which is the original ADR 0031 contract and is
 * unchanged for its callers. `readCached()` is **TTL-primary** (ADR 0039): it serves a row that is
 * younger than the TTL without calling the server at all, falls back to an older row when the load
 * fails, and is what every page on the one cache contract uses. `invalidate()` is how a page that
 * just mutated its own data drops its entry instead of waiting out the TTL.
 *
 * It is also private data, so it is scoped to one user (`<userId>:<resource>`) and the whole database
 * is dropped by the reset this service registers with `SessionScopeService`: logout, a failed
 * bootstrap and account deletion all reach it. A closed tab does not.
 *
 * IndexedDB is confined to this file, `indexed-db.ts`, `local-live-backend.service.ts` (ADR 0021) and
 * `local-league-archive-backend.service.ts` (ADR 0028); `server-authority-boundary.test.ts` fails if
 * it appears anywhere else.
 */
export const SERVER_READ_CACHE_DB_NAME = 'gones-cache';
export const SERVER_READ_CACHE_STORE = 'reads';
const SERVER_READ_CACHE_DB_VERSION = 1;

/** Same 24h TTL as the public catalog cache: one contract, two stores (ADR 0039). */
export const PRIVATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedRead<T> { value: T; cachedAt: string; }
export interface ServerReadResult<T> { value: T; stale: boolean; cachedAt?: string; }
export interface PrivateCacheResult<T> { value: T; fetchedAt: string; fromCache: boolean; stale: boolean; }

/** The persistence seam. Everything IndexedDB lives behind it, so nothing else grows an `IDBDatabase`. */
export interface ServerReadCacheStore {
  read(key: string): Promise<CachedRead<unknown> | null>;
  write(key: string, entry: CachedRead<unknown>): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** The default is the real database; a unit test provides a fake instead. */
export const SERVER_READ_CACHE_STORE_PORT = new InjectionToken<ServerReadCacheStore>('Gones server read cache store', {
  providedIn: 'root',
  factory: () => new IndexedDbServerReadCacheStore()
});

@Injectable({ providedIn: 'root' })
export class ServerReadCacheService {
  private readonly auth = inject(AuthService);
  private readonly coordination = inject(AuthSessionCoordinationService, { optional: true }) ?? new AuthSessionCoordinationService();
  private readonly store = inject(SERVER_READ_CACHE_STORE_PORT);

  constructor() {
    inject(SessionScopeService).register(() => this.purge());
  }

  /**
   * Read-through with an offline fallback (ADR 0031). A fulfilled load always overwrites the cache
   * row — remote prevails, unconditionally. A rejected load falls back to the row when there is one,
   * flagged stale, and rethrows when there is not. Anonymous callers are passed straight through and
   * cache nothing.
   *
   * The session is re-read after the load resolves: a response that lands after the user signed out
   * (or after the next one signed in) is answered to its caller and written nowhere, so an in-flight
   * read cannot outlive the purge that logout triggers.
   */
  async read<T>(resource: string, load: () => Promise<T>): Promise<ServerReadResult<T>> {
    const scope = this.coordination.captureCacheScope(this.auth.profile()?.id);
    if (!scope) return { value: await load(), stale: false };
    const key = this.key(scope, resource);
    let value: T;
    try {
      value = await load();
    } catch (error) {
      if (!await this.isCurrent(scope)) throw error;
      const row = await this.cached(key);
      if (!row || !await this.isCurrent(scope)) throw error;
      return { value: row.value as T, stale: true, cachedAt: row.cachedAt };
    }
    await this.remember(scope, key, value);
    return { value, stale: false };
  }

  /**
   * Read-through under a TTL (ADR 0039). A row younger than `ttlMs` is served as-is and the loader is
   * never called; anything older is reloaded, and `force` skips the row entirely. A rejected load
   * still falls back to whatever row exists, flagged stale, and still rethrows when there is none.
   *
   * Every privacy guarantee of `read()` is kept verbatim: an anonymous caller is passed through and
   * caches nothing, and the session is re-checked after the load resolves, so a response that lands
   * after a logout or after the next sign-in is answered to its caller and written nowhere.
   */
  async readCached<T>(resource: string, load: () => Promise<T>, options: { ttlMs?: number; force?: boolean } = {}): Promise<PrivateCacheResult<T>> {
    const scope = this.coordination.captureCacheScope(this.auth.profile()?.id);
    if (!scope) return { value: await load(), fetchedAt: new Date().toISOString(), fromCache: false, stale: false };
    const key = this.key(scope, resource);
    const ttlMs = options.ttlMs ?? PRIVATE_CACHE_TTL_MS;
    if (!options.force) {
      const row = await this.cached(key);
      if (row && await this.isCurrent(scope) && Date.now() - Date.parse(row.cachedAt) < ttlMs) {
        return { value: row.value as T, fetchedAt: row.cachedAt, fromCache: true, stale: false };
      }
    }
    let value: T;
    try {
      value = await load();
    } catch (error) {
      if (!await this.isCurrent(scope)) throw error;
      const row = await this.cached(key);
      if (!row || !await this.isCurrent(scope)) throw error;
      return { value: row.value as T, fetchedAt: row.cachedAt, fromCache: true, stale: true };
    }
    await this.remember(scope, key, value);
    return { value, fetchedAt: new Date().toISOString(), fromCache: false, stale: false };
  }

  /**
   * Drops one row, so a page that just mutated its own data reads the server again instead of its own
   * stale copy. A broken cache is logged and swallowed: a cache that cannot forget must not turn a
   * successful mutation into a failed one.
   */
  async invalidate(resource: string): Promise<void> {
    const scope = this.coordination.captureCacheScope(this.auth.profile()?.id);
    if (!scope) return;
    const key = this.key(scope, resource);
    try {
      await this.coordination.withAvailableLock(async () => {
        if (!this.isCurrentUnlocked(scope)) return;
        await this.store.delete(key);
      });
    } catch (error) {
      logBoundaryError('server-read-cache.invalidate', error);
    }
  }

  /** Drops the whole database. Registered with SessionScopeService, so logout purges it. */
  async purge(): Promise<void> {
    try {
      await this.store.clear();
    } catch (error) {
      logBoundaryError('server-read-cache.purge', error);
      throw error;
    }
  }

  private key(scope: AuthCacheScope, resource: string): string {
    return `${scope.profileId}:${resource}`;
  }

  private async isCurrent(scope: AuthCacheScope): Promise<boolean> {
    try {
      return await this.coordination.withAvailableLock(() => this.isCurrentUnlocked(scope));
    } catch {
      return false;
    }
  }

  private isCurrentUnlocked(scope: AuthCacheScope): boolean {
    return this.coordination.isCacheScopeCurrent(scope, this.auth.profile()?.id);
  }

  /** A broken cache is a miss, never a second failure reported over the real one. */
  private async cached(key: string): Promise<CachedRead<unknown> | null> {
    try {
      return await this.store.read(key);
    } catch {
      return null;
    }
  }

  /** A broken cache must never break a working server read, so the write failure stops here. */
  private async remember(scope: AuthCacheScope, key: string, value: unknown): Promise<void> {
    try {
      await this.coordination.withAvailableLock(async () => {
        if (!this.isCurrentUnlocked(scope)) return;
        await this.store.write(key, { value, cachedAt: new Date().toISOString() });
        if (!this.isCurrentUnlocked(scope)) await this.store.clear();
      });
    } catch (error) {
      logBoundaryError('server-read-cache.write', error);
    }
  }
}

/** Row shape: the key path is `key`, so `<userId>:<resource>` is the primary key of the store. */
interface CachedReadRow extends CachedRead<unknown> { key: string; }

export class IndexedDbServerReadCacheStore implements ServerReadCacheStore {
  private database?: Promise<IDBDatabase>;

  async read(key: string): Promise<CachedRead<unknown> | null> {
    const row = await get<CachedReadRow>(await this.open(), SERVER_READ_CACHE_STORE, key);
    return row ? { value: row.value, cachedAt: row.cachedAt } : null;
  }

  async write(key: string, entry: CachedRead<unknown>): Promise<void> {
    await put(await this.open(), SERVER_READ_CACHE_STORE, { key, ...entry } satisfies CachedReadRow);
  }

  async delete(key: string): Promise<void> {
    await remove(await this.open(), SERVER_READ_CACHE_STORE, key);
  }

  /**
   * Deleting beats emptying: no row, no index and no schema of the previous session survives, and a
   * later read simply recreates the database. The open connection is closed first, or the delete
   * blocks on it.
   */
  async clear(): Promise<void> {
    const pending = this.database;
    this.database = undefined;
    const database = await pending?.catch(() => undefined);
    database?.close();
    await deleteDatabase(SERVER_READ_CACHE_DB_NAME);
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      const opening = openDatabase(SERVER_READ_CACHE_DB_NAME, SERVER_READ_CACHE_DB_VERSION, (database) => {
        if (!database.objectStoreNames.contains(SERVER_READ_CACHE_STORE)) database.createObjectStore(SERVER_READ_CACHE_STORE, { keyPath: 'key' });
      });
      const tracked = opening.then((database) => {
        database.onversionchange = () => {
          database.close();
          if (this.database === tracked) this.database = undefined;
        };
        return database;
      }).catch((error: unknown) => {
        if (this.database === tracked) this.database = undefined; // a later call must retry
        throw error;
      });
      this.database = tracked;
    }
    return this.database;
  }
}

/**
 * The one call `indexed-db.ts` does not wrap, because this is the only store that is ever dropped
 * whole. A blocked request stays pending: every same-app connection closes on `versionchange`, then
 * the browser completes deletion instead of turning a temporary block into a permanent failure.
 */
function deleteDatabase(name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const factory = globalThis.indexedDB;
    if (!factory) {
      resolve(); // nothing was ever stored, so nothing survives
      return;
    }
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('indexedDbDeleteFailed'));
    request.onblocked = () => undefined;
  });
}
