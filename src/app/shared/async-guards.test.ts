import { describe, expect, it, vi } from 'vitest';
import { LatestRequest, PendingLock } from './async-guards';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('LatestRequest', () => {
  it('only treats the newest token as current', () => {
    const guard = new LatestRequest();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('drops an out-of-order response so newer state survives', async () => {
    const guard = new LatestRequest();
    const slow = deferred<string>();
    const fast = deferred<string>();
    let rendered = '';

    const load = async (token: number, source: Promise<string>) => {
      const value = await source;
      if (guard.isCurrent(token)) rendered = value;
    };

    const slowRun = load(guard.begin(), slow.promise);
    const fastRun = load(guard.begin(), fast.promise);
    fast.resolve('page-2');
    await fastRun;
    slow.resolve('page-1');
    await slowRun;

    expect(rendered).toBe('page-2');
  });

  it('cancel invalidates in-flight requests without starting one', () => {
    const guard = new LatestRequest();
    const token = guard.begin();

    guard.cancel();

    expect(guard.isCurrent(token)).toBe(false);
  });
});

describe('PendingLock', () => {
  it('drops a duplicate submit while one is in flight', async () => {
    const lock = new PendingLock();
    const gate = deferred<void>();
    const task = vi.fn(async () => { await gate.promise; return 'saved'; });

    const first = lock.run(task);
    const duplicate = await lock.run(task);
    expect(lock.pending).toBe(true);
    gate.resolve();

    expect(await first).toBe('saved');
    expect(duplicate).toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);
    expect(lock.pending).toBe(false);
  });

  it('releases the lock when the task throws so the user can retry', async () => {
    const lock = new PendingLock();

    await expect(lock.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    expect(lock.pending).toBe(false);
    expect(await lock.run(async () => 'ok')).toBe('ok');
  });
});
