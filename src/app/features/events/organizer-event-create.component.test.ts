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
import { of, Subject, throwError } from 'rxjs';
import { OrganizerEventCreateComponent } from './organizer-event-create.component';
import { EventProposalService } from './event-proposal.service';
import { AuthService } from '../../auth/auth.service';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { AdminOrganizationListResponse, AdminOrganizationResponse, Client, OrganizationListResponse, UserProfileResponse } from '../../api/generated/gones-api';
import { ApiProblemError } from '../../api/api-boundary';

function paramMap(values: Record<string, string> = {}): ParamMap {
  return {
    keys: Object.keys(values),
    has: name => Object.prototype.hasOwnProperty.call(values, name),
    get: name => values[name] ?? null,
    getAll: name => values[name] ? [values[name]] : []
  };
}

function setupHarness(globalRole: string, client: Partial<Client> = {}) {
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

  return {
    component: runInInjectionContext(injector, () => new OrganizerEventCreateComponent()),
    destroy: () => injector.destroy()
  };
}

function setup(globalRole: string, client: Partial<Client> = {}): OrganizerEventCreateComponent {
  return setupHarness(globalRole, client).component;
}

function locationClient(extra: Record<string, unknown> = {}): Partial<Client> {
  return {
    formatsAll: () => of([]),
    organizationsAll: () => of([{ id: 'org-mine', name: 'My Club' }]),
    ...extra
  } as unknown as Partial<Client>;
}

const suggestion = {
  placeId: 'google-place',
  primaryText: '10 Rue de la République',
  secondaryText: '69001 Lyon, France'
};

const resolvedLocation = {
  streetAddress: '10 Rue de la République',
  postalCode: '69001',
  city: 'Lyon',
  country: 'France',
  region: 'Auvergne-Rhône-Alpes',
  latitude: 45.764,
  longitude: 4.8357,
  timeZoneId: 'Europe/Paris',
  locationToken: 'signed-location-token',
  expiresAt: '2030-01-01T12:30:00Z'
};

describe('OrganizerEventCreateComponent resolved location', () => {
  it('debounces street autocomplete and sends nothing below three characters', async () => {
    vi.useFakeTimers();
    try {
      const autocompleteEventLocations = vi.fn(() => of({ suggestions: [suggestion] }));
      const component = setup('Organizer', locationClient({ autocompleteEventLocations }));
      component.ngOnInit();

      component.form.controls.streetAddress.setValue('Pa');
      await vi.advanceTimersByTimeAsync(300);
      expect(autocompleteEventLocations).not.toHaveBeenCalled();

      component.form.controls.streetAddress.setValue('Par');
      await vi.advanceTimersByTimeAsync(299);
      expect(autocompleteEventLocations).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(autocompleteEventLocations).toHaveBeenCalledTimes(1);
      expect(autocompleteEventLocations).toHaveBeenCalledWith('Par', expect.any(String), component.i18n.language());
      expect(component.locationSuggestions()).toEqual([suggestion]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks a successful empty autocomplete so the form can explain no matches', async () => {
    vi.useFakeTimers();
    try {
      const component = setup('Organizer', locationClient({
        autocompleteEventLocations: () => of({ suggestions: [] })
      }));
      component.ngOnInit();

      component.form.controls.streetAddress.setValue('Unknown street');
      await vi.advanceTimersByTimeAsync(300);

      expect(component.locationSearchComplete()).toBe(true);
      expect(component.locationSuggestions()).toEqual([]);
      expect(component.locationError()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps only the latest autocomplete response and renders at most five suggestions', async () => {
    vi.useFakeTimers();
    try {
      const first = new Subject<{ suggestions: typeof suggestion[] }>();
      const second = new Subject<{ suggestions: typeof suggestion[] }>();
      const autocompleteEventLocations = vi.fn((input: string) => input === 'Paris' ? first : second);
      const component = setup('Organizer', locationClient({ autocompleteEventLocations }));
      component.ngOnInit();

      component.form.controls.streetAddress.setValue('Paris');
      await vi.advanceTimersByTimeAsync(300);
      component.form.controls.streetAddress.setValue('Parish');
      await vi.advanceTimersByTimeAsync(300);
      second.next({ suggestions: Array.from({ length: 7 }, (_, index) => ({ ...suggestion, placeId: `latest-${index}` })) });
      first.next({ suggestions: [{ ...suggestion, placeId: 'stale' }] });

      expect(component.locationSuggestions()).toHaveLength(5);
      expect(component.locationSuggestions()[0].placeId).toBe('latest-0');
      expect(component.locationSuggestions().some(item => item.placeId === 'stale')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels an in-flight autocomplete when street drops below three characters', async () => {
    vi.useFakeTimers();
    try {
      const pending = new Subject<{ suggestions: typeof suggestion[] }>();
      const autocompleteEventLocations = vi.fn(() => pending);
      const component = setup('Organizer', locationClient({ autocompleteEventLocations }));
      component.ngOnInit();

      component.form.controls.streetAddress.setValue('Paris');
      await vi.advanceTimersByTimeAsync(300);
      component.form.controls.streetAddress.setValue('Pa');
      pending.next({ suggestions: [{ ...suggestion, placeId: 'stale' }] });

      expect(autocompleteEventLocations).toHaveBeenCalledTimes(1);
      expect(component.locationSuggestions()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fills canonical fields and hidden resolution claims after selection', async () => {
    const component = setup('Organizer', locationClient({ resolveEventLocation: () => of(resolvedLocation) }));
    component.ngOnInit();

    await component.resolveLocation(suggestion);

    expect(component.form.getRawValue()).toMatchObject({
      streetAddress: resolvedLocation.streetAddress,
      postalCode: resolvedLocation.postalCode,
      city: resolvedLocation.city,
      country: resolvedLocation.country,
      region: resolvedLocation.region,
      latitude: resolvedLocation.latitude,
      longitude: resolvedLocation.longitude,
      timeZoneId: resolvedLocation.timeZoneId,
      locationToken: resolvedLocation.locationToken
    });
    expect(component.form.controls.locationToken.valid).toBe(true);
    expect(component.locationSuggestions()).toEqual([]);
    expect(component.locationError()).toBe('');
  });

  it('reuses one UUID billing token for autocomplete and resolve during the editing session', async () => {
    vi.useFakeTimers();
    try {
      const autocompleteEventLocations = vi.fn((_input: string, _sessionToken: string, _language: string) => of({ suggestions: [suggestion] }));
      const resolveEventLocation = vi.fn((_request: { sessionToken: string }) => of(resolvedLocation));
      const component = setup('Organizer', locationClient({ autocompleteEventLocations, resolveEventLocation }));
      component.ngOnInit();

      component.form.controls.streetAddress.setValue('Paris');
      await vi.advanceTimersByTimeAsync(300);
      await component.resolveLocation(suggestion);

      const autocompleteSessionToken = autocompleteEventLocations.mock.calls[0]![1];
      const resolveSessionToken = resolveEventLocation.mock.calls[0]![0].sessionToken;
      expect(autocompleteSessionToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(resolveSessionToken).toBe(autocompleteSessionToken);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a stale resolve response after the user edits a location field', async () => {
    const pending = new Subject<typeof resolvedLocation>();
    const component = setup('Organizer', locationClient({ resolveEventLocation: () => pending }));
    component.ngOnInit();

    const resolving = component.resolveLocation(suggestion);
    component.form.controls.region.setValue('Île-de-France');
    pending.next(resolvedLocation);
    pending.complete();
    await resolving;

    expect(component.form.controls.region.value).toBe('Île-de-France');
    expect(component.form.controls.locationToken.value).toBe('');
    expect(component.form.controls.timeZoneId.value).toBe('');
  });

  it('clears token, timezone, and coordinates synchronously after each visible location field edit', async () => {
    const component = setup('Organizer', locationClient({ resolveEventLocation: () => of(resolvedLocation) }));
    component.ngOnInit();

    for (const field of ['streetAddress', 'postalCode', 'city', 'country', 'region'] as const) {
      await component.resolveLocation(suggestion);

      component.form.controls[field].setValue(`${component.form.controls[field].value} edited`);

      expect(component.form.controls.locationToken.value, field).toBe('');
      expect(component.form.controls.timeZoneId.value, field).toBe('');
      expect(component.form.controls.latitude.value, field).toBeNull();
      expect(component.form.controls.longitude.value, field).toBeNull();
      expect(component.form.controls.locationToken.invalid, field).toBe(true);
    }
  });

  it('cancels pending debounce, subscriptions, and in-flight location HTTP work on destroy', async () => {
    vi.useFakeTimers();
    try {
      const beforeDebounce = vi.fn(() => of({ suggestions: [suggestion] }));
      const first = setupHarness('Organizer', locationClient({ autocompleteEventLocations: beforeDebounce }));
      first.component.ngOnInit();
      first.component.form.controls.streetAddress.setValue('Paris');

      first.destroy();
      await vi.advanceTimersByTimeAsync(300);

      expect(beforeDebounce).not.toHaveBeenCalled();

      const pending = new Subject<{ suggestions: typeof suggestion[] }>();
      const inFlight = vi.fn(() => pending);
      const second = setupHarness('Organizer', locationClient({ autocompleteEventLocations: inFlight }));
      second.component.ngOnInit();
      second.component.form.controls.streetAddress.setValue('Paris');
      await vi.advanceTimersByTimeAsync(300);
      expect(pending.observed).toBe(true);

      second.destroy();

      expect(pending.observed).toBe(false);
      pending.next({ suggestions: [suggestion] });
      expect(second.component.locationSuggestions()).toEqual([]);

      const pendingResolve = new Subject<typeof resolvedLocation>();
      const third = setupHarness('Organizer', locationClient({ resolveEventLocation: () => pendingResolve }));
      third.component.ngOnInit();
      const resolving = third.component.resolveLocation(suggestion);
      expect(pendingResolve.observed).toBe(true);

      third.destroy();
      await resolving;

      expect(pendingResolve.observed).toBe(false);
      expect(third.component.locationError()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps street input and retries autocomplete after provider outage', async () => {
    vi.useFakeTimers();
    try {
      const autocompleteEventLocations = vi.fn()
        .mockReturnValueOnce(throwError(() => new ApiProblemError(503, { code: 'location_provider_unavailable' })))
        .mockReturnValueOnce(of({ suggestions: [suggestion] }));
      const component = setup('Organizer', locationClient({ autocompleteEventLocations }));
      component.ngOnInit();
      component.form.controls.streetAddress.setValue('Paris');
      await vi.advanceTimersByTimeAsync(300);

      expect(component.form.controls.streetAddress.value).toBe('Paris');
      expect(component.locationError()).toBeTruthy();
      expect(component.canRetryLocation()).toBe(true);

      await component.retryLocationResolution();

      expect(autocompleteEventLocations).toHaveBeenCalledTimes(2);
      expect(component.locationSuggestions()).toEqual([suggestion]);
      expect(component.locationError()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps entered address and exposes retry after provider outage', async () => {
    const resolveEventLocation = vi.fn(() => throwError(() => new ApiProblemError(503, {
      code: 'location_provider_unavailable',
      message: 'Event location provider is unavailable.'
    })));
    const component = setup('Organizer', locationClient({ resolveEventLocation }));
    component.ngOnInit();
    component.form.controls.streetAddress.setValue('10 Rue de la République');

    await component.resolveLocation(suggestion);

    expect(component.form.controls.streetAddress.value).toBe('10 Rue de la République');
    expect(component.locationError()).toBeTruthy();
    expect(component.canRetryLocation()).toBe(true);
    await component.retryLocationResolution();
    expect(resolveEventLocation).toHaveBeenCalledTimes(2);
  });
});

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
