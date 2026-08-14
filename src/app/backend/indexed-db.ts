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

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDbRequestFailed'));
  });
}

/** Run every request produced by `action` in one transaction and expose its result only after commit. */
export function runTransaction<T>(
  database: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  action: (transaction: IDBTransaction) => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let actionResult: T;
    let actionError: unknown;
    let actionCompleted = false;
    let transactionCompleted = false;
    let settled = false;
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    try {
      const transaction = database.transaction(stores, mode);
      const resolveIfComplete = () => {
        if (settled || !actionCompleted || !transactionCompleted) return;
        settled = true;
        resolve(actionResult);
      };
      transaction.oncomplete = () => {
        transactionCompleted = true;
        if (actionError !== undefined) rejectOnce(actionError);
        else resolveIfComplete();
      };
      transaction.onerror = () => rejectOnce(actionError ?? transaction.error ?? new Error('indexedDbTransactionFailed'));
      transaction.onabort = () => rejectOnce(actionError ?? transaction.error ?? new Error('indexedDbTransactionAborted'));
      void action(transaction).then(
        result => {
          actionResult = result;
          actionCompleted = true;
          resolveIfComplete();
        },
        error => {
          actionError = error;
          actionCompleted = true;
          if (transactionCompleted) rejectOnce(error);
          else {
            try { transaction.abort(); }
            catch { rejectOnce(error); }
          }
        }
      );
    } catch (error) {
      rejectOnce(error);
    }
  });
}

/** One-request compatibility wrapper, still resolved only after transaction commit. */
function run<T>(database: IDBDatabase, store: string, mode: IDBTransactionMode, request: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return runTransaction(database, [store], mode, transaction => requestResult(request(transaction.objectStore(store))));
}
