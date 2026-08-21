import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computed, signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AdminDeletedEventsComponent } from './admin-deleted-events.component';

const source = readFileSync(join(__dirname, 'admin-deleted-events.component.ts'), 'utf8');

function makeCacheMock(fromCache = false) {
  return {
    readCached: vi.fn(async (_key: string, loader: () => Promise<unknown>, _opts = {}) =>
      fromCache
        ? { value: { items: [], totalCount: 0 }, fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), fromCache: true, stale: false }
        : { value: await loader(), fetchedAt: new Date().toISOString(), fromCache: false, stale: false }
    ),
    invalidateFamily: vi.fn(async () => undefined)
  };
}

function makeComponent(cache: ReturnType<typeof makeCacheMock>, listFn: ReturnType<typeof vi.fn>) {
  const pageSignal = signal(1);
  const totalCount = signal(0);
  const pageSize = 20;
  const component = Object.create(AdminDeletedEventsComponent.prototype) as AdminDeletedEventsComponent;
  Object.assign(component, {
    cache,
    client: { listDeletedEvents: listFn, restoreEvent: vi.fn().mockReturnValue(of(undefined)) },
    i18n: { t: (key: string) => key },
    items: signal([]),
    loading: signal(false),
    error: signal(''),
    status: signal(''),
    pendingId: signal(''),
    syncedAt: signal<string | undefined>(undefined),
    stale: signal(false),
    page: pageSignal,
    totalCount,
    pageSize,
    pages: computed(() => Math.max(1, Math.ceil(totalCount() / pageSize)))
  });
  return component;
}

describe('AdminDeletedEventsComponent template', () => {
  it('renders a gones-sync-bar with the admin-deleted-events prefix', () => {
    expect(source).toContain('cyPrefix="admin-deleted-events"');
    expect(source).toContain('(sync)="sync()"');
  });
});

describe('AdminDeletedEventsComponent caching', () => {
  it('serves a fresh cache without calling the API', async () => {
    const listFn = vi.fn();
    const cache = makeCacheMock(true);
    const component = makeComponent(cache, listFn);

    await component.load();

    expect(listFn).not.toHaveBeenCalled();
    expect(cache.readCached).toHaveBeenCalledOnce();
  });

  it('invalidates admin-deleted-events family after a successful restore', async () => {
    const listFn = vi.fn().mockResolvedValue({ items: [], totalCount: 0 });
    const cache = makeCacheMock(false);
    const component = makeComponent(cache, listFn);
    const event = { id: 'ev-1', eTag: '"1"', title: 'Test', organizationName: 'Org', deletedReason: '' } as Parameters<typeof component.restore>[0];

    await component.restore(event);

    expect(cache.invalidateFamily).toHaveBeenCalledWith('admin-deleted-events');
  });
});
