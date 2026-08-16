import '@angular/compiler';
import { signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LatestRequest } from '../../shared/async-guards';
import { MyRegistrationsComponent } from './my-registrations.component';

// No TestBed / zone.js in this repo (see AGENT.md environment facts) — source assertions
// and direct method calls on Object.create instances. Precedent: settings.component.test.ts.
const source = readFileSync(join(__dirname, 'my-registrations.component.ts'), 'utf8');

describe('MyRegistrationsComponent template', () => {
  it('renders a top and a bottom return button', () => {
    expect(source).toMatch(/<gones-back-button\s[^>]*position="top"[^>]*>/);
    expect(source).toMatch(/<gones-back-button\s[^>]*position="bottom"[^>]*>/);
    const buttons = source.match(/<gones-back-button\s[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toContain(`[link]="['/']"`);
    }
  });

  it('renders no page kicker, but keeps the per-card organization label', () => {
    const headerMatch = source.match(/<header class="page-heading"[^>]*>[\s\S]*?<\/header>/);
    expect(headerMatch).not.toBeNull();
    expect(headerMatch![0]).not.toContain('class="kicker"');

    const cardMatch = source.match(/<ng-template #attemptCard[\s\S]*?<\/ng-template>/);
    expect(cardMatch).not.toBeNull();
    expect(cardMatch![0]).toMatch(/<p class="kicker"[^>]*>\{\{ attempt\.organizationName \}\}<\/p>/);
  });

  it('renders the sync bar directly under the registrations-header block', () => {
    expect(source).toMatch(/data-cy="registrations-header"/);
    expect(source).toMatch(/cyPrefix="registrations"/);
    expect(source).toMatch(/\(sync\)="sync\(\)"/);
  });
});

function makeCacheMock(result: Partial<{ value: object; fetchedAt: string; fromCache: boolean; stale: boolean }>) {
  return {
    readCached: vi.fn(async (_resource: string, loader: () => Promise<unknown>, _opts = {}) =>
      result.fromCache
        ? result
        : { value: await loader(), fetchedAt: new Date().toISOString(), fromCache: false, stale: false, ...result }
    ),
    invalidate: vi.fn(async () => undefined)
  };
}

function makeComponent(cacheMock: ReturnType<typeof makeCacheMock>, listFn: ReturnType<typeof vi.fn>) {
  const component = Object.create(MyRegistrationsComponent.prototype) as MyRegistrationsComponent;
  Object.assign(component, {
    cache: cacheMock,
    registrations: { list: listFn },
    items: signal([]),
    loading: signal(false),
    error: signal(false),
    page: signal(1),
    totalCount: signal(0),
    syncedAt: signal<string | undefined>(undefined),
    stale: signal(false),
    latest: new LatestRequest()
  });
  return component;
}

describe('MyRegistrationsComponent caching', () => {
  const emptyResponse = { items: [], page: 1, pageSize: 20, totalCount: 0 };

  it('serves a fresh cache without an API call', async () => {
    const listFn = vi.fn();
    const cache = makeCacheMock({ value: emptyResponse, fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), fromCache: true, stale: false });
    const component = makeComponent(cache, listFn);

    await component.load();

    expect(cache.readCached).toHaveBeenCalledWith('registrations:1', expect.any(Function), {});
    expect(listFn).not.toHaveBeenCalled();
  });

  it('refetches after 24h (cache miss)', async () => {
    const listFn = vi.fn().mockResolvedValue(emptyResponse);
    const cache = makeCacheMock({ fromCache: false });
    const component = makeComponent(cache, listFn);

    await component.load();

    expect(listFn).toHaveBeenCalledTimes(1);
  });

  it('sync forces a refetch', async () => {
    const listFn = vi.fn().mockResolvedValue(emptyResponse);
    const cache = makeCacheMock({ fromCache: false });
    const component = makeComponent(cache, listFn);

    component.sync();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(cache.readCached).toHaveBeenCalledWith('registrations:1', expect.any(Function), { force: true });
  });

  it('shows the synced-at label from the cache result', async () => {
    const instant = new Date().toISOString();
    const cache = makeCacheMock({ value: emptyResponse, fetchedAt: instant, fromCache: true, stale: false });
    const component = makeComponent(cache, vi.fn());

    await component.load();

    expect(component.syncedAt()).toBe(instant);
    expect(component.stale()).toBe(false);
  });

  it('falls back to the cache when the API fails', async () => {
    const cachedItems = [{ attemptId: 'a', eventId: 'e', eventSlug: 's', eventTitle: 't', organizationName: 'Org', startsAtUtc: '2030-01-01T00:00:00Z', timeZoneId: 'UTC', status: 'Confirmed', isCurrent: true, registeredByUserId: 'u', registeredAt: '2030-01-01T00:00:00Z' }];
    const staleResponse = { items: cachedItems, page: 1, pageSize: 20, totalCount: 1 };
    const cache = {
      readCached: vi.fn().mockResolvedValue({ value: staleResponse, fetchedAt: new Date().toISOString(), fromCache: true, stale: true }),
      invalidate: vi.fn()
    };
    const component = makeComponent(cache, vi.fn());

    await component.load();

    expect(component.items()).toEqual(cachedItems);
    expect(component.stale()).toBe(true);
    expect(component.error()).toBe(false);
  });
});
