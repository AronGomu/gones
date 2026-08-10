/**
 * Minimal promise wrapper over the IndexedDB request/transaction API — no third-party dependency.
 *
 * IndexedDB is confined to this file, `local-live-backend.service.ts` (ADR 0021) and
 * `local-league-archive-backend.service.ts` (ADR 0028); the boundary test in
 * `server-authority-boundary.test.ts` fails if it appears anywhere else.
 */

export function openDatabase(name: string, version: number, upgrade: (database: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const factory = globalThis.indexedDB;
    if (!factory) {
      reject(new Error('indexedDbUnavailable'));
      return;
    }
    const request = factory.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDbOpenFailed'));
    request.onblocked = () => reject(new Error('indexedDbBlocked'));
  });
}

export function getAll<T>(database: IDBDatabase, store: string): Promise<T[]> {
  return run<T[]>(database, store, 'readonly', (objectStore) => objectStore.getAll()).then((rows) => rows ?? []);
}

export function get<T>(database: IDBDatabase, store: string, key: IDBValidKey): Promise<T | null> {
  return run<T | undefined>(database, store, 'readonly', (objectStore) => objectStore.get(key)).then((row) => row ?? null);
}

export function put(database: IDBDatabase, store: string, value: unknown): Promise<void> {
  return run(database, store, 'readwrite', (objectStore) => objectStore.put(value)).then(() => undefined);
}

export function remove(database: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return run(database, store, 'readwrite', (objectStore) => objectStore.delete(key)).then(() => undefined);
}

/**
 * One request per transaction, resolved on `complete` rather than on the request itself: a write is
 * only durable once its transaction commits.
 */
function run<T>(database: IDBDatabase, store: string, mode: IDBTransactionMode, request: (objectStore: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let result: T;
    try {
      const transaction = database.transaction([store], mode);
      const pending = request(transaction.objectStore(store));
      pending.onsuccess = () => { result = pending.result as T; };
      pending.onerror = () => reject(pending.error ?? new Error('indexedDbRequestFailed'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('indexedDbTransactionFailed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('indexedDbTransactionAborted'));
    } catch (error) {
      reject(error);
    }
  });
}
