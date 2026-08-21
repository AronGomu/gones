import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AdminNotificationDeliveryComponent } from './admin-notification-delivery.component';

const source = readFileSync(join(__dirname, 'admin-notification-delivery.component.ts'), 'utf8');

function makeCacheMock(fromCache = false) {
  return {
    readCached: vi.fn(async (_key: string, loader: () => Promise<unknown>, _opts = {}) =>
      fromCache
        ? { value: { items: [], page: 1, pageSize: 20, totalCount: 0 }, fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), fromCache: true, stale: false }
        : { value: await loader(), fetchedAt: new Date().toISOString(), fromCache: false, stale: false }
    ),
    invalidateFamily: vi.fn(async () => undefined)
  };
}

function makeComponent(cache: ReturnType<typeof makeCacheMock>, historyFn: ReturnType<typeof vi.fn>, deadLetters = false, retryFn = vi.fn().mockReturnValue(of(undefined))) {
  const component = Object.create(AdminNotificationDeliveryComponent.prototype) as AdminNotificationDeliveryComponent;
  Object.assign(component, {
    cache,
    client: { history: historyFn, deadLetters: historyFn, retry: retryFn },
    i18n: { t: (key: string) => key, formatDateTime: (v: string) => v },
    items: signal([]),
    loading: signal(false),
    error: signal(''),
    pages: signal(1),
    retrying: signal(new Set<string>()),
    syncedAt: signal<string | undefined>(undefined),
    stale: signal(false),
    deadLetters,
    title: signal(''),
    status: '',
    page: 1,
    pageSize: 20
  });
  return component;
}

describe('AdminNotificationDeliveryComponent template', () => {
  it('renders a gones-sync-bar with the admin-notifications prefix', () => {
    expect(source).toContain('cyPrefix="admin-notifications"');
    expect(source).toContain('(sync)="sync()"');
  });
});

describe('AdminNotificationDeliveryComponent caching', () => {
  it('serves a fresh cache without calling the API', async () => {
    const historyFn = vi.fn();
    const cache = makeCacheMock(true);
    const component = makeComponent(cache, historyFn);

    await component.reload();

    expect(historyFn).not.toHaveBeenCalled();
    expect(cache.readCached).toHaveBeenCalledOnce();
  });

  it('includes the mode in the cache key so history and dead-letters are keyed separately', async () => {
    const historyFn = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, totalCount: 0 });
    const cacheA = makeCacheMock(false);
    const cacheB = makeCacheMock(false);
    const history = makeComponent(cacheA, historyFn, false);
    const deadLetter = makeComponent(cacheB, historyFn, true);

    await history.reload();
    await deadLetter.reload();

    const keyA = cacheA.readCached.mock.calls[0][0] as string;
    const keyB = cacheB.readCached.mock.calls[0][0] as string;
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain('history');
    expect(keyB).toContain('dead-letters');
  });

  it('invalidates admin-notifications family after a successful retry', () => {
    const retryBody = source.slice(source.indexOf('async retry('));
    const invalidateIdx = retryBody.indexOf("invalidateFamily('admin-notifications')");
    const reloadIdx = retryBody.indexOf('await this.reload()');
    expect(invalidateIdx, 'invalidateFamily not found in retry()').toBeGreaterThan(-1);
    expect(invalidateIdx, 'invalidateFamily must precede reload in retry()').toBeLessThan(reloadIdx);
  });
});
