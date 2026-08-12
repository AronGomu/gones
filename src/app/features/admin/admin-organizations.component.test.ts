import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as tournament-request.component.test.ts: no TestBed / zone.js in this repo, so
// `effect()` is stubbed to a no-op and the component is built with a bare Injector. These tests
// assert on component state, spy calls and the template source string, never on rendered DOM.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { AdminOrganizationMemberResponse, AdminOrganizationResponse, AdminUserSummaryResponse, Client } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { AdminOrganizationsComponent, MAX_PICKER_USERS } from './admin-organizations.component';

const source = readFileSync(join(__dirname, 'admin-organizations.component.ts'), 'utf8');

function paramMap(values: Record<string, string> = {}): ParamMap {
  return {
    keys: Object.keys(values),
    has: (name) => Object.prototype.hasOwnProperty.call(values, name),
    get: (name) => values[name] ?? null,
    getAll: (name) => (values[name] ? [values[name]] : [])
  };
}

function org(id: string, overrides: Partial<AdminOrganizationResponse> = {}): AdminOrganizationResponse {
  return {
    id,
    name: `Org ${id}`,
    description: undefined,
    website: undefined,
    contactEmail: undefined,
    deletedAt: undefined,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    version: 1,
    memberCount: 1,
    isDraft: false,
    ...overrides
  } as AdminOrganizationResponse;
}

function member(userId: string, username: string): AdminOrganizationMemberResponse {
  return { userId, username, email: `${username}@example.test`, globalRole: 'Organizer', role: 'Organizer', createdAt: '2026-08-01T00:00:00Z' } as unknown as AdminOrganizationMemberResponse;
}

function user(id: string, username: string, globalRole = 'User'): AdminUserSummaryResponse {
  return { id, email: `${username}@example.test`, emailVerified: true, globalRole, username, firstName: '', lastName: '', isClosed: false, createdAt: '2026-08-01T00:00:00Z' } as unknown as AdminUserSummaryResponse;
}

interface SetupOptions {
  query?: Record<string, string>;
  organizations?: AdminOrganizationResponse[];
  members?: AdminOrganizationMemberResponse[];
  users?: AdminUserSummaryResponse[];
  totalUsers?: number;
}

function setup(options: SetupOptions = {}) {
  const organizations = options.organizations ?? [org('org-1'), org('org-2', { isDraft: true, memberCount: 0 })];
  const allUsers = options.users ?? [user('u1', 'alice'), user('u2', 'organizer-bob', 'Organizer')];
  const totalUsers = options.totalUsers ?? allUsers.length;

  const organizationsGET3 = vi.fn(() => of({ items: organizations, page: 1, pageSize: 20, totalCount: organizations.length }));
  const membersAll2 = vi.fn(() => of(options.members ?? [member('u1', 'alice')]));
  const membersPOST = vi.fn(() => of({}));
  const membersDELETE = vi.fn(() => of(undefined));
  const users = vi.fn((_search: string | undefined, page: number, pageSize: number) =>
    of({ items: allUsers.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalCount: totalUsers })
  );

  const client = { organizationsGET3, membersAll2, membersPOST, membersDELETE, users } as unknown as Client;
  const route = { queryParamMap: of(paramMap(options.query ?? {})) } as unknown as ActivatedRoute;
  const navigate = vi.fn(() => Promise.resolve(true));
  const router = { navigate } as unknown as Router;

  const injector = Injector.create({ providers: [
    { provide: Client, useValue: client },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: router },
    DeckArchetypeSettingsService,
    I18nService
  ] });

  const component = runInInjectionContext(injector, () => new AdminOrganizationsComponent());
  return { component, organizationsGET3, membersAll2, membersPOST, membersDELETE, users, navigate };
}

async function flush(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe('AdminOrganizationsComponent', () => {
  it('selecting an organization loads its roster', async () => {
    const { component, membersAll2 } = setup();
    await flush();
    expect(membersAll2).not.toHaveBeenCalled();

    component.select(org('org-1'));
    await flush();

    expect(membersAll2).toHaveBeenCalledTimes(1);
    expect(membersAll2).toHaveBeenCalledWith('org-1');
    expect(component.members().map((entry) => entry.username)).toEqual(['alice']);
    expect(component.selectedId()).toBe('org-1');
  });

  it('badges draft organizations from the server flag', async () => {
    const { component } = setup();
    await flush();
    expect(component.items().find((entry) => entry.id === 'org-2')?.isDraft).toBe(true);
    expect(source).toContain(`'admin-org-draft-' + org.id`);
    expect(source).toMatch(/@if \(org\.isDraft\)/);
  });

  it('adding a member calls the members endpoint and reloads roster and list', async () => {
    const { component, membersPOST, membersAll2, organizationsGET3 } = setup();
    await flush();
    component.select(org('org-1'));
    await flush();
    const listCalls = organizationsGET3.mock.calls.length;

    await component.addMember(user('u9', 'carol'));
    await flush();

    expect(membersPOST).toHaveBeenCalledWith('org-1', { userId: 'u9', role: 'Organizer' });
    expect(membersAll2).toHaveBeenCalledTimes(2);
    expect(organizationsGET3.mock.calls.length).toBe(listCalls + 1);
    expect(component.error()).toBe('');
  });

  it('removing the last member is allowed and reloads without an error banner', async () => {
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const { component, membersDELETE, organizationsGET3 } = setup({ members: [member('u1', 'alice')] });
    await flush();
    component.select(org('org-1'));
    await flush();
    const listCalls = organizationsGET3.mock.calls.length;

    await component.removeMember(member('u1', 'alice'));
    await flush();

    expect(membersDELETE).toHaveBeenCalledWith('org-1', 'u1');
    expect(organizationsGET3.mock.calls.length).toBe(listCalls + 1);
    expect(component.error()).toBe('');
    confirmSpy.mockRestore();
  });

  it('filters the user picker client side and hides current members', async () => {
    const { component } = setup({ users: [user('u1', 'alice'), user('u2', 'organizer-bob', 'Organizer'), user('u3', 'carol')] });
    await flush();
    component.select(org('org-1'));
    await flush();

    expect(component.filteredUsers().map((entry) => entry.username)).toEqual(['organizer-bob', 'carol']);

    component.memberSearch.set('organizer');
    expect(component.filteredUsers().map((entry) => entry.username)).toEqual(['organizer-bob']);
  });

  it('warns when the user picker hits its cap', async () => {
    const many = Array.from({ length: MAX_PICKER_USERS }, (_, index) => user(`u${index}`, `user-${index}`));
    const { component, users } = setup({ users: many, totalUsers: MAX_PICKER_USERS + 40 });
    await flush(40);

    expect(component.users()).toHaveLength(MAX_PICKER_USERS);
    expect(component.userCapReached()).toBe(true);
    expect(users.mock.calls.every((call) => call[2] === 100)).toBe(true);
    expect(source).toContain('admin-org-member-cap-warning');
    expect(source).toContain(`i18n.t('admin.userPickerCapped', { count: maxPickerUsers })`);
  });

  it('restores the selection from the organization query parameter', async () => {
    const { component, membersAll2 } = setup({ query: { organization: 'org-2' } });
    await flush();

    expect(component.selectedId()).toBe('org-2');
    expect(membersAll2).toHaveBeenCalledWith('org-2');
  });
});
