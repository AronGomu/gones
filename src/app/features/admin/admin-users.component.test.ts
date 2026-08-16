import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { LatestRequest } from '../../shared/async-guards';
import { AdminUsersComponent } from './admin-users.component';

const source = readFileSync(join(__dirname, 'admin-users.component.ts'), 'utf8');

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

function makeComponent(cache: ReturnType<typeof makeCacheMock>, clientUsers: ReturnType<typeof vi.fn>) {
  const component = Object.create(AdminUsersComponent.prototype) as AdminUsersComponent;
  Object.assign(component, {
    cache,
    client: { users: clientUsers },
    i18n: { t: (key: string) => key },
    items: signal([]),
    loading: signal(false),
    error: signal(''),
    pending: signal(false),
    closing: signal(null),
    impact: signal(null),
    impactError: signal(''),
    closeError: signal(''),
    pages: signal(1),
    syncedAt: signal<string | undefined>(undefined),
    stale: signal(false),
    latest: new LatestRequest(),
    search: '',
    page: 1,
    pageSize: 20,
    confirmUsername: '',
    transfers: {}
  });
  return component;
}

const emptyResponse = { items: [], page: 1, pageSize: 20, totalCount: 0 };

describe('AdminUsersComponent template', () => {
  it('renders a gones-sync-bar with the admin-users prefix', () => {
    expect(source).toContain('cyPrefix="admin-users"');
    expect(source).toContain('(sync)="sync()"');
  });
});

describe('AdminUsersComponent caching', () => {
  it('serves a fresh cache without calling the API', async () => {
    const usersFn = vi.fn();
    const cache = makeCacheMock(true);
    const component = makeComponent(cache, usersFn);

    await component.reload();

    expect(usersFn).not.toHaveBeenCalled();
    expect(cache.readCached).toHaveBeenCalledOnce();
  });

  it('keys page 2 separately from page 1', async () => {
    const usersFn = vi.fn().mockResolvedValue(emptyResponse);
    const cache = makeCacheMock(false);
    const component = makeComponent(cache, usersFn);

    component.page = 1;
    await component.reload();
    component.page = 2;
    await component.reload();

    const keys = cache.readCached.mock.calls.map(call => call[0] as string);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toContain('page=1');
    expect(keys[1]).toContain('page=2');
    expect(usersFn).toHaveBeenCalledTimes(2);
  });

  it('invalidates admin-users family after a successful grant', async () => {
    const usersFn = vi.fn().mockResolvedValue(emptyResponse);
    const cache = makeCacheMock(false);
    const component = makeComponent(cache, usersFn);

    type WithMutate = { mutate(action: () => Promise<unknown>): Promise<void> };
    // Call the private mutate helper directly with a resolved action
    await (component as unknown as WithMutate).mutate(() => Promise.resolve());

    expect(cache.invalidateFamily).toHaveBeenCalledWith('admin-users');
    expect(usersFn).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate after a failed grant', async () => {
    type WithMutate = { mutate(action: () => Promise<unknown>): Promise<void> };
    const usersFn = vi.fn().mockResolvedValue(emptyResponse);
    const cache = makeCacheMock(false);
    const component = makeComponent(cache, usersFn);

    await (component as unknown as WithMutate).mutate(() => Promise.reject(new Error('fail')));

    expect(cache.invalidateFamily).not.toHaveBeenCalled();
    expect(usersFn).not.toHaveBeenCalled();
  });

  it('sync forces a refetch with force option', async () => {
    const usersFn = vi.fn().mockResolvedValue(emptyResponse);
    const cache = makeCacheMock(false);
    const component = makeComponent(cache, usersFn);

    component.sync();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(cache.readCached).toHaveBeenCalledWith(expect.any(String), expect.any(Function), { force: true });
  });
});
