import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { AdminAuditComponent } from './admin-audit.component';

const source = readFileSync(join(__dirname, 'admin-audit.component.ts'), 'utf8');

function makeCacheMock(fromCache = false) {
  return {
    readCached: vi.fn(async (_key: string, loader: () => Promise<unknown>, _opts = {}) =>
      fromCache
        ? { value: { items: [], page: 1, pageSize: 20, totalCount: 0 }, fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), fromCache: true, stale: false }
        : { value: await loader(), fetchedAt: new Date().toISOString(), fromCache: false, stale: false }
    )
  };
}

function makeComponent(cache: ReturnType<typeof makeCacheMock>, auditFn: ReturnType<typeof vi.fn>) {
  const component = Object.create(AdminAuditComponent.prototype) as AdminAuditComponent;
  Object.assign(component, {
    cache,
    client: { audit: auditFn },
    i18n: { t: (key: string) => key, formatDateTime: (v: string) => v },
    items: signal([]),
    loading: signal(false),
    error: signal(''),
    pages: signal(1),
    syncedAt: signal<string | undefined>(undefined),
    stale: signal(false),
    action: '',
    entityType: '',
    entityId: '',
    actorId: '',
    from: '',
    to: '',
    page: 1,
    pageSize: 20
  });
  return component;
}

describe('AdminAuditComponent template', () => {
  it('renders a gones-sync-bar with the admin-audit prefix', () => {
    expect(source).toContain('cyPrefix="admin-audit"');
    expect(source).toContain('(sync)="sync()"');
  });
});

describe('AdminAuditComponent caching', () => {
  it('serves a fresh cache without calling the API', async () => {
    const auditFn = vi.fn();
    const cache = makeCacheMock(true);
    const component = makeComponent(cache, auditFn);

    await component.reload();

    expect(auditFn).not.toHaveBeenCalled();
    expect(cache.readCached).toHaveBeenCalledOnce();
  });

  it('sync forces a refetch with force option', async () => {
    const auditFn = vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, totalCount: 0 });
    const cache = makeCacheMock(false);
    const component = makeComponent(cache, auditFn);

    component.sync();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(cache.readCached).toHaveBeenCalledWith(expect.any(String), expect.any(Function), { force: true });
  });
});
