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
import { of, throwError } from 'rxjs';
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

function setupHarness(globalRole: string, client: Partial<Client> = {}, routeValues: Record<string, string> = {}, powerEnabled = true) {
  const profile = { id: 'u1', email: 'a@example.test', emailVerified: true, globalRole } as unknown as UserProfileResponse;
  const auth = { profile: signal<UserProfileResponse | null>(profile) } as unknown as AuthService;
  const route = { snapshot: { paramMap: paramMap(routeValues) } } as unknown as ActivatedRoute;

  const injector = Injector.create({ providers: [
    { provide: Client, useValue: client },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: {} },
    { provide: MatDialog, useValue: {} },
    { provide: AuthService, useValue: auth },
    { provide: EventProposalService, useValue: {} },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(powerEnabled), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
    DeckArchetypeSettingsService,
    I18nService
  ] });

  return {
    component: runInInjectionContext(injector, () => new OrganizerEventCreateComponent()),
    destroy: () => injector.destroy()
  };
}

function setup(globalRole: string, client: Partial<Client> = {}, routeValues: Record<string, string> = {}): OrganizerEventCreateComponent {
  return setupHarness(globalRole, client, routeValues).component;
}

function locationClient(extra: Record<string, unknown> = {}): Partial<Client> {
  return {
    formatsAll: () => of([]),
    organizationsAll: () => of([{ id: 'org-mine', name: 'My Club' }]),
    ...extra
  } as unknown as Partial<Client>;
}

describe('OrganizerEventCreateComponent live direct editor', () => {
  it('requires a trimmed title and enforces the 160-character client limit', () => {
    const component = setup('Organizer');
    component.form.controls.title.setValue('   ');
    component.form.controls.title.markAsTouched();
    expect(component.form.controls.title.invalid).toBe(true);
    expect(component.fieldError('title')).toBe(component.i18n.t('eventCreate.required'));

    component.form.controls.title.setValue('x'.repeat(161));
    expect(component.form.controls.title.invalid).toBe(true);
    expect(component.fieldError('title')).toBe(component.i18n.t('eventCreate.titleTooLong'));

    component.form.controls.title.setValue(' Valid title ');
    expect(component.form.controls.title.valid).toBe(true);
  });

  it('maps DST payload errors to start controls and other payload errors to the general region', () => {
    const component = setup('Organizer');
    const editor = component as unknown as {
      applyFieldErrors(error: unknown): void;
      fieldErrors(): Record<string, string>;
    };

    editor.applyFieldErrors(new ApiProblemError(400, {
      errors: { payload: ['Tournament start time falls in a daylight-saving gap.'] }
    }));
    expect(editor.fieldErrors()).toMatchObject({
      startDate: 'Tournament start time falls in a daylight-saving gap.',
      startTime: 'Tournament start time falls in a daylight-saving gap.'
    });
    expect(editor.fieldErrors()['title']).toBeUndefined();

    editor.applyFieldErrors(new ApiProblemError(400, {
      errors: { payload: ['Payload is inconsistent.'] }
    }));
    expect(editor.fieldErrors()).toEqual({ general: 'Payload is inconsistent.' });
  });

  it('updates actual detail preview locally without Event preview HTTP', () => {
    const preview = vi.fn();
    const component = setup('Organizer', locationClient({ preview }));
    component.ngOnInit();
    component.formats.set([{ id: 'fmt1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]);
    component.form.patchValue({
      organizationId: 'org-mine',
      title: 'Instant Cup',
      summary: 'Live summary',
      bodyMarkdown: '**Live Markdown**',
      streetAddress: '1 Rue Test',
      postalCode: '69001',
      city: 'Lyon',
      country: 'France',
      region: 'Auvergne-Rhône-Alpes',
      timeZoneId: 'Europe/Paris',
      eventType: 'weekly',
      capacity: 32,
      formatId: 'fmt1'
    });
    const controls = component.form.controls as unknown as Record<string, { setValue(value: string): void }>;
    controls['startDate']?.setValue('2027-08-01');
    controls['startTime']?.setValue('10:00');

    const draft = (component as unknown as { draftPreview(): { displayTitle: string; bodyHtml: string | undefined } }).draftPreview();
    expect(draft.displayTitle).toContain('Instant Cup');
    expect(draft.bodyHtml).toContain('<strong>Live Markdown</strong>');
    expect(preview).not.toHaveBeenCalled();
  });

  it('persists collapse state for tab session with exact ARIA labels', () => {
    sessionStorage.removeItem('gones.event-editor.preview-collapsed');
    const first = setup('Organizer');
    expect((first as unknown as { previewCollapsed(): boolean }).previewCollapsed()).toBe(false);
    (first as unknown as { togglePreview(): void }).togglePreview();
    expect(sessionStorage.getItem('gones.event-editor.preview-collapsed')).toBe('true');

    const second = setup('Organizer');
    expect((second as unknown as { previewCollapsed(): boolean }).previewCollapsed()).toBe(true);
    sessionStorage.removeItem('gones.event-editor.preview-collapsed');
  });

  it('requires a manual timezone and blocks direct publish for failed/pending upload', () => {
    const component = setup('Organizer');
    component.form.patchValue({
      organizationId: 'org', title: 'Cup', streetAddress: 'Street', postalCode: '69001', city: 'Lyon', country: 'France',
      region: 'Auvergne-Rhône-Alpes', eventType: 'weekly', capacity: 32, formatId: 'fmt'
    });
    const editor = component as unknown as {
      imagePublishBlocked: { set(value: boolean): void };
      publishDisabled(): boolean;
    };
    expect(component.form.controls.timeZoneId.invalid).toBe(true);
    expect(editor.publishDisabled()).toBe(true);
    component.form.controls.timeZoneId.setValue('Europe/Paris');
    expect(component.form.controls.timeZoneId.valid).toBe(true);
    editor.imagePublishBlocked.set(true);
    expect(editor.publishDisabled()).toBe(true);
  });
});

describe('OrganizerEventCreateComponent edit concurrency', () => {
  const managedEvent = {
    id: 'event-1', organizationId: 'org-1', organizationName: 'Club', title: 'Original', displayTitle: 'Legacy — Original', slug: 'original',
    summary: 'Summary', bodyMarkdown: 'Original body', liveTournamentUrl: '/live/keep', archiveTournamentUrl: '/archive/keep',
    location: {
      streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France',
      region: 'Auvergne-Rhône-Alpes', timeZoneId: 'Europe/Paris'
    },
    streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France', region: 'Auvergne-Rhône-Alpes',
    eventType: 'weekly', timeZoneId: 'Europe/Paris', startsAtLocal: '2027-08-01T10:00',
    venueStartDate: '2027-08-01', venueStartTime: '10:00:00', venueEndDate: '2027-08-01', venueEndTime: '23:59:59',
    startsAtUtc: '2027-08-01T08:00:00Z', endsAtUtc: '2027-08-01T21:59:59Z', capacity: 32,
    status: 'Published', formatIds: ['fmt-1'], images: [{
      id: 'image-1', altText: 'Original alt',
      variants: [{ width: 320, height: 180, url: '/api/event-images/image-1/variants/320' }]
    }],
    version: 3, eTag: '"3"'
  };

  it('maps missing-image PATCH 404 to media reload recovery instead of permission failure', async () => {
    const latest = { ...managedEvent, images: [], version: 4, eTag: '"4"' };
    const updateEventDetails = vi.fn(() => throwError(() => new ApiProblemError(404, { code: 'image_not_found' })));
    const listOrganizerEvents = vi.fn(() => of({ items: [latest], page: 1, pageSize: 100, totalCount: 1 }));
    const component = setup('Organizer', { updateEventDetails, listOrganizerEvents } as unknown as Partial<Client>, { id: 'event-1' });
    const editor = component as unknown as { applyCanonical(event: unknown): void };
    component.formats.set([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]);
    editor.applyCanonical(managedEvent);

    await component.saveEdit();

    expect(component.fieldErrors()['images']).toBe(component.i18n.t('eventManage.imageMissing'));
    expect(component.staleEvent()).toBe(latest);
    expect(component.submitError()).toBeNull();
    expect(component.fieldErrors()['images']).not.toBe(component.i18n.t('eventManage.forbidden'));

    component.reloadLatest();

    expect(component.fieldErrors()['images']).toBeUndefined();
  });

  it('sends nested ETag edit, keeps local draft on 412, then explicitly reloads canonical media and location', async () => {
    const latest = {
      ...managedEvent,
      title: 'Server title',
      bodyMarkdown: 'Server body',
      location: { ...managedEvent.location, streetAddress: '9 Server Street', timeZoneId: 'Europe/London' },
      streetAddress: '9 Server Street',
      timeZoneId: 'Europe/London',
      images: [{
        id: 'image-2', altText: 'Server image',
        variants: [{ width: 320, height: 180, url: '/api/event-images/image-2/variants/320' }]
      }],
      version: 4,
      eTag: '"4"'
    };
    const updateEventDetails = vi.fn((_eventId: string, _ifMatch: string | undefined, _body: unknown) =>
      throwError(() => new ApiProblemError(412, { code: 'stale_etag' })));
    const listOrganizerEvents = vi.fn(() => of({ items: [latest], page: 1, pageSize: 100, totalCount: 1 }));
    const component = setup('Organizer', { updateEventDetails, listOrganizerEvents } as unknown as Partial<Client>, { id: 'event-1' });
    const editor = component as unknown as { applyCanonical(event: unknown): void };
    component.formats.set([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]);
    editor.applyCanonical(managedEvent);
    component.form.controls.bodyMarkdown.setValue('Local draft body');
    component.form.controls.images.setValue([{ imageId: 'image-1', altText: 'Local alt' }]);

    await component.saveEdit();

    expect(updateEventDetails).toHaveBeenCalledWith('event-1', '"3"', {
      title: 'Original', summary: 'Summary', bodyMarkdown: 'Local draft body',
      location: {
        streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France',
        region: 'Auvergne-Rhône-Alpes', timeZoneId: 'Europe/Paris'
      },
      eventType: 'weekly', startsAtLocal: '2027-08-01T10:00', capacity: 32, formatIds: ['fmt-1'],
      images: [{ imageId: 'image-1', altText: 'Local alt' }]
    });
    const sent = updateEventDetails.mock.calls[0]![2] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('liveTournamentUrl');
    expect(sent).not.toHaveProperty('archiveTournamentUrl');
    expect(sent).not.toHaveProperty('endsAtLocal');
    expect(component.form.controls.bodyMarkdown.value).toBe('Local draft body');
    expect(component.staleEvent()).toBe(latest);
    expect(component.staleChanges()).toEqual(expect.arrayContaining([expect.stringMatching(/image/i)]));

    component.reloadLatest();

    expect(component.form.controls.title.value).toBe('Server title');
    expect(component.form.controls.streetAddress.value).toBe('9 Server Street');
    expect(component.form.controls.timeZoneId.value).toBe('Europe/London');
    expect(component.form.controls.images.value).toEqual([{ imageId: 'image-2', altText: 'Server image' }]);
    expect(component.baseEvent()).toBe(latest);
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

  it('keeps Event publication enabled for an admin when Power User mode is off', () => {
    const { component, destroy } = setupHarness('Admin', {}, {}, false);
    expect(component.canPublishDirectly()).toBe(true);
    destroy();
  });

  it('uses one required format control without retired end or tournament-link controls', () => {
    const component = setup('Organizer');
    expect(component.form.controls.formatId.value).toBe('');
    expect(component.form.controls.formatId.valid).toBe(false);
    expect('endsAtLocal' in component.form.controls).toBe(false);
    expect('liveTournamentUrl' in component.form.controls).toBe(false);
    expect('archiveTournamentUrl' in component.form.controls).toBe(false);
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
