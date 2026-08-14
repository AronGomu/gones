import { describe, expect, it } from 'vitest';
import { requestResult, runTransaction } from './indexed-db';

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private pending = 0;
  private putCount = 0;
  private aborted = false;
  private completed = false;
  private readonly staged: Map<string, unknown>;

  constructor(private readonly rows: Map<string, unknown>, private readonly failPutAt?: number) {
    this.staged = new Map(rows);
  }

  objectStore(): IDBObjectStore {
    return {
      get: (key: string) => this.request(() => this.staged.get(key)),
      put: (value: { id: string }) => this.request(() => {
        this.putCount += 1;
        if (this.putCount === this.failPutAt) throw new DOMException('Injected put failure', 'ConstraintError');
        this.staged.set(value.id, structuredClone(value));
        return value.id;
      })
    } as unknown as IDBObjectStore;
  }

  abort(): void {
    if (this.completed || this.aborted) return;
    this.aborted = true;
    queueMicrotask(() => this.onabort?.());
  }

  private request<T>(action: () => T): IDBRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      try {
        request.result = action();
        request.onsuccess?.();
      } catch (error) {
        request.error = error as DOMException;
        this.error = request.error;
        request.onerror?.();
        this.abort();
      } finally {
        this.pending -= 1;
        queueMicrotask(() => this.completeIfIdle());
      }
    });
    return request as unknown as IDBRequest<T>;
  }

  private completeIfIdle(): void {
    if (this.pending !== 0 || this.aborted || this.completed) return;
    this.completed = true;
    this.rows.clear();
    for (const [key, value] of this.staged) this.rows.set(key, value);
    this.oncomplete?.();
  }
}

class FakeDatabase {
  constructor(private readonly rows: Map<string, unknown>, private readonly failPutAt?: number) {}

  transaction(): IDBTransaction {
    return new FakeTransaction(this.rows, this.failPutAt) as unknown as IDBTransaction;
  }
}

describe('IndexedDB transaction helpers', () => {
  it('returns request results but resolves the action only after transaction completion', async () => {
    const rows = new Map<string, unknown>([['source', { id: 'source', version: 1 }]]);
    const database = new FakeDatabase(rows) as unknown as IDBDatabase;

    const result = await runTransaction(database, ['leagues'], 'readwrite', async transaction => {
      const store = transaction.objectStore('leagues');
      const source = await requestResult<{ id: string; version: number }>(store.get('source'));
      await requestResult(store.put({ ...source, version: 2 }));
      return source.version + 1;
    });

    expect(result).toBe(2);
    expect(rows.get('source')).toEqual({ id: 'source', version: 2 });
  });

  it('aborts and rolls back staged writes when a later request fails', async () => {
    const rows = new Map<string, unknown>([
      ['source', { id: 'source', version: 1 }],
      ['target', { id: 'target', version: 1 }]
    ]);
    const database = new FakeDatabase(rows, 2) as unknown as IDBDatabase;

    await expect(runTransaction(database, ['leagues'], 'readwrite', async transaction => {
      const store = transaction.objectStore('leagues');
      await requestResult(store.put({ id: 'source', version: 2 }));
      await requestResult(store.put({ id: 'target', version: 2 }));
    })).rejects.toThrow('Injected put failure');

    expect([...rows.values()]).toEqual([{ id: 'source', version: 1 }, { id: 'target', version: 1 }]);
  });
});
