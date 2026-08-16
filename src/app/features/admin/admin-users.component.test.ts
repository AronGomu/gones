import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { AdminUserSummaryResponse } from '../../api/generated/gones-api';
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

const ME = '11111111-1111-1111-1111-111111111111';

function row(id: string, username: string, globalRole = 'User'): AdminUserSummaryResponse {
  return {
    id,
    email: `${username}@example.test`,
    emailVerified: true,
    globalRole,
    username,
    firstName: '',
    lastName: '',
    isClosed: false,
    createdAt: '2026-08-01T00:00:00Z'
  } as unknown as AdminUserSummaryResponse;
}

// No TestBed / zone.js in this repo, so a rendered `disabled` attribute cannot be read here: the
// predicates and the handler guards are asserted directly, and the bindings that carry them are
// asserted against the template source. `cypress/e2e/admin-orgs.cy.js` asserts the rendered state.
function guardComponent(client: Record<string, unknown> = {}) {
  const component = Object.create(AdminUsersComponent.prototype) as AdminUsersComponent;
  Object.assign(component, {
    auth: { profile: () => ({ id: ME }) },
    cache: makeCacheMock(false),
    client: { grant: vi.fn(), revoke: vi.fn(), closureImpact: vi.fn(), ...client },
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
    confirmUsername: ''
  });
  return component;
}

const GUARDED_BUTTONS = ['grant-organizer', 'grant-admin', 'revoke-admin', 'close-user'];

function buttonTag(dataCyPrefix: string): string {
  const match = source.match(new RegExp(`<button[^>]*'${dataCyPrefix}-' \\+ user\\.username[^>]*>`));
  expect(match, `no button tag for ${dataCyPrefix}`).not.toBeNull();
  return match![0];
}

describe('AdminUsersComponent role guards', () => {
  it('disables revoke admin on my own row', () => {
    const component = guardComponent();
    expect(component.isSelf(row(ME, 'admin-user', 'Admin'))).toBe(true);
    expect(buttonTag('revoke-admin')).toContain('[disabled]="isSelf(user)"');
  });

  it('leaves revoke admin enabled for others', () => {
    const component = guardComponent();
    expect(component.isSelf(row('22222222-2222-2222-2222-222222222222', 'other-admin', 'Admin'))).toBe(false);
  });

  it('disables close on my own row', () => {
    const component = guardComponent();
    expect(component.isSelf(row(ME, 'admin-user', 'Admin'))).toBe(true);
    expect(buttonTag('close-user')).toContain('[disabled]="isSelf(user)"');
  });

  it('disables granting a held role', () => {
    const component = guardComponent();
    const organizer = row('u2', 'organizer-bob', 'Organizer');
    expect(component.holdsRole(organizer, 'Organizer')).toBe(true);
    expect(component.holdsRole(organizer, 'Admin')).toBe(false);
    expect(buttonTag('grant-organizer')).toContain(`[disabled]="holdsRole(user, 'Organizer')"`);
    expect(buttonTag('grant-admin')).toContain(`[disabled]="holdsRole(user, 'Admin')"`);
  });

  it('disables granting Organizer to an Admin', () => {
    const component = guardComponent();
    const admin = row('u3', 'other-admin', 'Admin');
    expect(component.holdsRole(admin, 'Organizer')).toBe(true);
    expect(component.holdsRole(admin, 'Admin')).toBe(true);
    expect(component.grantBlockedReason(admin, 'Organizer')).toBe('admin.adminIncludesOrganizer');
  });

  it('keeps both grants enabled for a plain User', () => {
    const component = guardComponent();
    const plain = row('u4', 'plain-jane', 'User');
    expect(component.holdsRole(plain, 'Organizer')).toBe(false);
    expect(component.holdsRole(plain, 'Admin')).toBe(false);
    expect(component.grantBlockedReason(plain, 'Organizer')).toBeNull();
    expect(component.grantBlockedReason(plain, 'Admin')).toBeNull();
  });

  it('issues no request from a disabled action', async () => {
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const grant = vi.fn();
    const revoke = vi.fn();
    const closureImpact = vi.fn();
    const component = guardComponent({ grant, revoke, closureImpact });

    await component.grant(row('u3', 'other-admin', 'Admin'), 'Organizer');
    await component.revoke(row(ME, 'admin-user', 'Admin'), 'Admin');
    await component.openClose(row(ME, 'admin-user', 'Admin'));

    expect(grant).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(closureImpact).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(component.closing()).toBeNull();
    confirmSpy.mockRestore();
  });

  it('explains every disabled button', () => {
    for (const prefix of GUARDED_BUTTONS) {
      const tag = buttonTag(prefix);
      expect(tag, prefix).toContain('[disabled]=');
      expect(tag, prefix).toContain('[attr.title]=');
      expect(tag, prefix).toContain('[attr.aria-label]=');
    }
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
