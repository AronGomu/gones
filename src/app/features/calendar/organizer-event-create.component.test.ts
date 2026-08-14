import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as account-settings.component.test.ts and public-calendar.component.test.ts: no
// TestBed / zone.js in this repo, so `effect()` is stubbed to a no-op and the component is built
// with a bare Injector. These tests assert on component state, never on rendered DOM.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { OrganizerEventCreateComponent } from './organizer-event-create.component';
import { EventProposalService } from './event-proposal.service';
import { AuthService } from '../../auth/auth.service';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { AdminOrganizationListResponse, AdminOrganizationResponse, Client, OrganizationListResponse, UserProfileResponse } from '../../api/generated/gones-api';

function paramMap(values: Record<string, string> = {}): ParamMap {
  return {
    keys: Object.keys(values),
    has: name => Object.prototype.hasOwnProperty.call(values, name),
    get: name => values[name] ?? null,
    getAll: name => values[name] ? [values[name]] : []
  };
}

function setup(globalRole: string, client: Partial<Client> = {}): OrganizerEventCreateComponent {
  const profile = { id: 'u1', email: 'a@example.test', emailVerified: true, globalRole } as unknown as UserProfileResponse;
  const auth = { profile: signal<UserProfileResponse | null>(profile) } as unknown as AuthService;
  const route = { snapshot: { paramMap: paramMap() } } as unknown as ActivatedRoute;

  const injector = Injector.create({ providers: [
    { provide: Client, useValue: client },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: {} },
    { provide: MatDialog, useValue: {} },
    { provide: AuthService, useValue: auth },
    { provide: EventProposalService, useValue: {} },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(true), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
    DeckArchetypeSettingsService,
    I18nService
  ] });

  return runInInjectionContext(injector, () => new OrganizerEventCreateComponent());
}

describe('OrganizerEventCreateComponent role gating', () => {
  it('disables submit for a plain user', () => {
    const component = setup('User');
    expect(component.canPublishDirectly()).toBe(false);
  });

  it('keeps submit enabled for an organizer', () => {
    const component = setup('Organizer');
    expect(component.canPublishDirectly()).toBe(true);
  });

  it('keeps submit enabled for an admin', () => {
    const component = setup('Admin');
    expect(component.canPublishDirectly()).toBe(true);
  });

  it('uses one required format control plus optional tournament links', () => {
    const component = setup('Organizer');
    expect(component.form.controls.formatId.value).toBe('');
    expect(component.form.controls.formatId.valid).toBe(false);
    expect(component.form.controls.liveTournamentUrl.value).toBe('');
    expect(component.form.controls.archiveTournamentUrl.value).toBe('');
  });
});

// T26. The picker used to read `GET /api/users/me/organizations` for everyone, so the account the
// proposal flow exists for — a verified user who belongs to nothing — saw an empty `<select>` and a
// button that did nothing. The proposal path reads the anonymous public list instead; the
// direct-publish path must keep reading the caller's own memberships, or an organizer would be
// offered organizations the server will refuse to publish into.
describe('OrganizerEventCreateComponent organization picker', () => {
  function publicPage(items: { id: string; name: string }[], totalCount = items.length) {
    return of({ items, page: 1, pageSize: 100, totalCount } as unknown as OrganizationListResponse);
  }

  it('offers public organizations to a user with zero memberships and makes submit reachable', async () => {
    const organizationsGET = vi.fn(() => publicPage([{ id: 'org-public', name: 'Public Club' }]));
    const organizationsGET3 = vi.fn(() => of({ items: [], page: 1, pageSize: 100, totalCount: 0 } as unknown as AdminOrganizationListResponse));
    const organizationsAll = vi.fn(() => of([]));
    const component = setup('User', {
      formatsAll: () => of([{ id: 'fmt1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]),
      organizationsGET,
      organizationsGET3,
      organizationsAll
    } as unknown as Partial<Client>);

    await component.loadReferences();

    expect(organizationsAll).not.toHaveBeenCalled();
    // T14: the admin catalogue is admin-only, and a plain user must never reach for it.
    expect(organizationsGET3).not.toHaveBeenCalled();
    expect(organizationsGET).toHaveBeenCalledTimes(1);
    expect(component.organizations()).toEqual([{ id: 'org-public', name: 'Public Club' }]);
    expect(component.form.controls.organizationId.value).toBe('org-public');
    expect(component.organizationSelected()).toBe(true);
    expect(component.referenceError()).toBe('');
  });

  it('pulls every page of the public list', async () => {
    const organizationsGET = vi.fn((_search: unknown, page: number | undefined) =>
      page === 1
        ? publicPage([{ id: 'a', name: 'A' }], 2)
        : publicPage([{ id: 'b', name: 'B' }], 2));
    const component = setup('User', {
      formatsAll: () => of([]),
      organizationsGET
    } as unknown as Partial<Client>);

    await component.loadReferences();

    expect(organizationsGET).toHaveBeenCalledTimes(2);
    expect(component.organizations().map(option => option.id)).toEqual(['a', 'b']);
  });

  it('keeps an organizer on their own memberships', async () => {
    const organizationsGET = vi.fn(() => publicPage([{ id: 'org-public', name: 'Public Club' }]));
    const organizationsGET3 = vi.fn(() => of({ items: [], page: 1, pageSize: 100, totalCount: 0 } as unknown as AdminOrganizationListResponse));
    const organizationsAll = vi.fn(() => of([{ id: 'org-mine', name: 'My Club' }]));
    const component = setup('Organizer', {
      formatsAll: () => of([]),
      organizationsGET,
      organizationsGET3,
      organizationsAll
    } as unknown as Partial<Client>);

    await component.loadReferences();

    expect(organizationsGET).not.toHaveBeenCalled();
    // T14 widened the admin picker only. An organizer is still offered exactly what the server
    // would let them publish into, which is their own memberships.
    expect(organizationsGET3).not.toHaveBeenCalled();
    expect(component.organizations()).toEqual([{ id: 'org-mine', name: 'My Club' }]);
  });

  it('reports no organization and leaves submit unreachable when the public list is empty', async () => {
    const component = setup('User', {
      formatsAll: () => of([]),
      organizationsGET: () => publicPage([])
    } as unknown as Partial<Client>);

    await component.loadReferences();

    expect(component.organizations()).toEqual([]);
    expect(component.form.controls.organizationId.value).toBe('');
    // The button binds to this: an empty picker can no longer produce a click that does nothing.
    expect(component.organizationSelected()).toBe(false);
    expect(component.referenceError()).toBeTruthy();
  });

  it('leaves submit unreachable while the references are still loading', () => {
    const component = setup('User');
    expect(component.loadingReferences()).toBe(true);
    expect(component.organizationSelected()).toBe(false);
  });
});

// T14. An admin belongs to nothing in particular, so their own memberships are the wrong list to
// offer them: the server already treats an admin as a member of every organization, so the picker
// reads the admin catalogue instead. What the picker still has to leave out is what the server
// would refuse anyway — soft-deleted organizations, and Draft ones, which publish nothing (T11).
describe('OrganizerEventCreateComponent admin organization picker', () => {
  function adminOrganization(id: string, name: string, extra: Record<string, unknown> = {}): AdminOrganizationResponse {
    return { id, name, memberCount: 1, isDraft: false, ...extra } as unknown as AdminOrganizationResponse;
  }

  function adminPage(items: AdminOrganizationResponse[], totalCount = items.length) {
    return of({ items, page: 1, pageSize: 100, totalCount } as unknown as AdminOrganizationListResponse);
  }

  it('offers every active organization to an admin, not only their memberships', async () => {
    const organizationsGET3 = vi.fn(() => adminPage([
      adminOrganization('org-c', 'Cannes Club'),
      adminOrganization('org-a', 'Annecy Club'),
      adminOrganization('org-b', 'Bourg Club')
    ]));
    const organizationsAll = vi.fn(() => of([{ id: 'org-mine', name: 'My Club' }]));
    const organizationsGET = vi.fn(() => of({ items: [], page: 1, pageSize: 100, totalCount: 0 } as unknown as OrganizationListResponse));
    const component = setup('Admin', {
      formatsAll: () => of([]),
      organizationsGET3,
      organizationsAll,
      organizationsGET
    } as unknown as Partial<Client>);

    await component.loadReferences();

    expect(organizationsGET3).toHaveBeenCalledTimes(1);
    expect(organizationsAll).not.toHaveBeenCalled();
    expect(organizationsGET).not.toHaveBeenCalled();
    expect(component.organizations()).toEqual([
      { id: 'org-a', name: 'Annecy Club' },
      { id: 'org-b', name: 'Bourg Club' },
      { id: 'org-c', name: 'Cannes Club' }
    ]);
    expect(component.form.controls.organizationId.value).toBe('org-a');
    expect(component.referenceError()).toBe('');
  });

  it('hides draft and deleted organizations from the admin picker', async () => {
    const organizationsGET3 = vi.fn(() => adminPage([
      adminOrganization('org-a', 'Annecy Club'),
      adminOrganization('org-draft', 'Draft Club', { memberCount: 0, isDraft: true }),
      adminOrganization('org-gone', 'Gone Club', { deletedAt: '2026-08-01T00:00:00Z' }),
      adminOrganization('org-b', 'Bourg Club')
    ]));
    const component = setup('Admin', {
      formatsAll: () => of([]),
      organizationsGET3
    } as unknown as Partial<Client>);

    await component.loadReferences();

    expect(component.organizations().map(option => option.id)).toEqual(['org-a', 'org-b']);
  });

  it('pulls every page of the admin list', async () => {
    const organizationsGET3 = vi.fn((_search: unknown, _includeDeleted: unknown, page: number | undefined, _pageSize: number | undefined) =>
      page === 1
        ? adminPage([adminOrganization('org-a', 'Annecy Club')], 2)
        : adminPage([adminOrganization('org-b', 'Bourg Club')], 2));
    const component = setup('Admin', {
      formatsAll: () => of([]),
      organizationsGET3
    } as unknown as Partial<Client>);

    await component.loadReferences();

    expect(organizationsGET3).toHaveBeenCalledTimes(2);
    expect(organizationsGET3.mock.calls[0][3]).toBe(100);
    expect(component.organizations().map(option => option.id)).toEqual(['org-a', 'org-b']);
  });

  it('falls back to the admin own memberships when the admin list fails', async () => {
    const organizationsGET3 = vi.fn(() => { throw new Error('boom'); });
    const organizationsAll = vi.fn(() => of([{ id: 'org-mine', name: 'My Club' }]));
    const component = setup('Admin', {
      formatsAll: () => of([]),
      organizationsGET3,
      organizationsAll
    } as unknown as Partial<Client>);

    await component.loadReferences();

    expect(organizationsAll).toHaveBeenCalledTimes(1);
    expect(component.organizations()).toEqual([{ id: 'org-mine', name: 'My Club' }]);
    expect(component.referenceError()).toBe('');
  });

  it('reports the reference failure when both admin sources fail', async () => {
    const component = setup('Admin', {
      formatsAll: () => of([]),
      organizationsGET3: () => { throw new Error('boom'); },
      organizationsAll: () => { throw new Error('boom'); }
    } as unknown as Partial<Client>);

    await component.loadReferences();

    expect(component.organizations()).toEqual([]);
    expect(component.organizationSelected()).toBe(false);
    expect(component.referenceError()).toBeTruthy();
  });
});
