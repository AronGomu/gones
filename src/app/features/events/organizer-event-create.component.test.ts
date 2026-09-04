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
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { Observable, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { OrganizerEventCreateComponent } from './organizer-event-create.component';
import { EventProposalService } from './event-proposal.service';
import { AuthService } from '../../auth/auth.service';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { GeoOption, GeoService } from '../../shared/geo.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { AdminOrganizationListResponse, AdminOrganizationResponse, Client, OrganizationListResponse, PublicFormatResponse, UserProfileResponse } from '../../api/generated/gones-api';
import { ApiProblemError } from '../../api/api-boundary';
import { EventCreateDraftStore, StoredEventCreateDraftV1 } from './event-create-draft';

function paramMap(values: Record<string, string> = {}): ParamMap {
  return {
    keys: Object.keys(values),
    has: name => Object.prototype.hasOwnProperty.call(values, name),
    get: name => values[name] ?? null,
    getAll: name => values[name] ? [values[name]] : []
  };
}

function setupHarness(
  globalRole: string,
  client: Partial<Client> = {},
  routeValues: Record<string, string> = {},
  powerEnabled = true,
  countries: () => Promise<GeoOption[]> = async () => [{ code: 'FR', name: 'France' }],
  draftStore: Pick<EventCreateDraftStore, 'read' | 'write' | 'remove'> = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() },
  dialog: Pick<MatDialog, 'open'> = { open: vi.fn(() => ({ afterClosed: () => of(false) })) } as unknown as Pick<MatDialog, 'open'>,
  proposals: Pick<EventProposalService, 'listApprovers' | 'submit'> = {} as Pick<EventProposalService, 'listApprovers' | 'submit'>
) {
  const profile = { id: 'u1', email: 'a@example.test', emailVerified: true, globalRole } as unknown as UserProfileResponse;
  const auth = { profile: signal<UserProfileResponse | null>(profile) } as unknown as AuthService;
  const route = { snapshot: { paramMap: paramMap(routeValues) } } as unknown as ActivatedRoute;
  const router = { navigate: vi.fn(async () => true) };
  const clientWithCatalog = {
    formatsAll: () => of([]),
    listEventTimeZones: () => of({ ids: [] }),
    ...client
  };

  const injector = Injector.create({ providers: [
    { provide: Client, useValue: clientWithCatalog },
    { provide: GeoService, useValue: { countries } },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: router },
    { provide: MatDialog, useValue: dialog },
    { provide: AuthService, useValue: auth },
    { provide: EventProposalService, useValue: proposals },
    { provide: EventCreateDraftStore, useValue: draftStore },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(powerEnabled), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
    DeckArchetypeSettingsService,
    I18nService
  ] });

  return {
    component: runInInjectionContext(injector, () => new OrganizerEventCreateComponent()),
    auth,
    draftStore,
    dialog,
    router,
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
    component.form.patchValue({ title: '  Instant Cup  ' });

    expect(component.draftPreview().displayTitle).toBe('Instant Cup');

    component.formats.set([{ id: 'fmt1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]);
    component.form.patchValue({
      organizationId: 'org-mine',
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

    const draft = component.draftPreview();
    expect(draft.displayTitle).toBe('Legacy — Instant Cup');
    expect(draft.bodyHtml).toContain('<strong>Live Markdown</strong>');
    expect(preview).not.toHaveBeenCalled();
  });

  it('derives disabled Publish errors in stable field order and collapses duplicate messages by first occurrence without touching controls', () => {
    const component = setup('Organizer');
    component.form.patchValue({
      summary: 'x'.repeat(51),
      bodyMarkdown: 'x'.repeat(20_001),
      eventType: '',
      capacity: 0
    });
    component.loadingReferences.set(false);
    component.organizations.set([{ id: 'org', name: 'Club' }]);
    component.fieldErrors.set({
      locationResolution: 'Location resolution failed.',
      imageId: 'Image failed.',
      general: 'General failure.',
      title: 'Duplicate error.',
      summary: 'Duplicate error.'
    });

    const errors = component.publishErrors();

    expect(component.form.controls.organizationId.touched).toBe(false);
    expect(errors).toEqual([
      'Organisation: Ce champ est obligatoire.',
      'Nom de l’événement: Duplicate error.',
      'Résumé: Duplicate error.',
      'Description: La description ne peut pas dépasser 20 000 caractères.',
      'Format: Ce champ est obligatoire.',
      'Type d’événement: Ce champ est obligatoire.',
      'Capacité: Saisissez une valeur valide.',
      'Pays: Ce champ est obligatoire.',
      'Région: Ce champ est obligatoire.',
      'Adresse: Ce champ est obligatoire.',
      'Code postal: Ce champ est obligatoire.',
      'Ville: Ce champ est obligatoire.',
      'Date de début: Ce champ est obligatoire.',
      'Heure de début: Ce champ est obligatoire.',
      'Résolution du lieu: Location resolution failed.',
      'Image de l’événement: Image failed.',
      'Général: General failure.'
    ]);
    expect(component.publishTooltip()).toBe(errors.join('\n'));
  });

  it('supplies translated general reasons for every non-field Publish disable state', () => {
    const component = setup('Organizer');
    component.form.patchValue({
      organizationId: 'org', title: 'Cup', streetAddress: 'Street', postalCode: '69001', city: 'Lyon', country: 'France',
      region: 'Rhône', timeZoneId: 'Europe/Paris', eventType: 'weekly', startDate: '2035-03-04', startTime: '10:00',
      capacity: 32, formatId: 'fmt'
    });
    component.organizations.set([]);
    component.loadingReferences.set(true);
    expect(component.publishReasons()).toEqual([
      `Général: ${component.i18n.t('eventCreate.loadingReferences')}`
    ]);

    component.loadingReferences.set(false);
    expect(component.publishReasons()).toEqual([
      `Général: ${component.i18n.t('eventCreate.noOrganizations')}`
    ]);

    component.organizations.set([{ id: 'org', name: 'Club' }]);
    component.publishing.set(true);
    expect(component.publishReasons()).toEqual([
      `Général: ${component.i18n.t('eventCreate.publishing')}`
    ]);
    expect(component.publishTooltip()).not.toBe('');
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

  it('loads bundled countries and backend timezone IDs through reference state', async () => {
    const listEventTimeZones = vi.fn(() => of({ ids: ['America/Toronto', 'Europe/Paris'] }));
    const countries = vi.fn(async () => [
      { code: 'CA', name: 'Canada' },
      { code: 'FR', name: 'France' }
    ]);
    const { component, destroy } = setupHarness('Organizer', locationClient({ listEventTimeZones }), {}, true, countries);

    await component.loadReferences();

    expect(countries).toHaveBeenCalledTimes(1);
    expect(listEventTimeZones).toHaveBeenCalledTimes(1);
    expect(component.countries()).toEqual([
      { code: 'CA', name: 'Canada' },
      { code: 'FR', name: 'France' }
    ]);
    expect(component.timeZones()).toEqual(['America/Toronto', 'Europe/Paris']);
    expect(component.referenceError()).toBe('');
    destroy();
  });

  it('logs catalog failure, exposes reference error, then retries every reference', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let attempt = 0;
    const countries = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('country catalog unavailable');
      return [{ code: 'FR', name: 'France' }];
    });
    const listEventTimeZones = vi.fn(() => of({ ids: ['Europe/Paris'] }));
    const { component, destroy } = setupHarness('Organizer', locationClient({ listEventTimeZones }), {}, true, countries);

    await component.loadReferences();

    expect(component.referenceError()).toBe(component.i18n.t('eventCreate.referencesFailed'));
    expect(component.countries()).toEqual([]);
    expect(component.timeZones()).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('event-editor.load-references'));

    await component.loadReferences();

    expect(countries).toHaveBeenCalledTimes(2);
    expect(listEventTimeZones).toHaveBeenCalledTimes(2);
    expect(component.countries()).toEqual([{ code: 'FR', name: 'France' }]);
    expect(component.timeZones()).toEqual(['Europe/Paris']);
    expect(component.referenceError()).toBe('');
    consoleError.mockRestore();
    destroy();
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

describe('OrganizerEventCreateComponent draft persistence and leave guard', () => {
  const draftValue = {
    organizationId: 'org-mine', title: 'Recovered Cup', summary: 'Summary', bodyMarkdown: '**Body**',
    streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France', region: 'Rhône',
    timeZoneId: 'Europe/Paris', eventType: 'weekly' as const, startDate: '2027-08-01', startTime: '10:00',
    capacity: 32, formatId: 'fmt-1'
  };

  async function initializedCreate(
    draftStore: Pick<EventCreateDraftStore, 'read' | 'write' | 'remove'> = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() },
    dialog?: Pick<MatDialog, 'open'>,
    client: Partial<Client> = locationClient({
      formatsAll: () => of([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]),
      listEventTimeZones: () => of({ ids: ['Europe/Paris'] })
    })
  ) {
    const harness = setupHarness('Organizer', client, {}, true, undefined, draftStore, dialog);
    harness.component.ngOnInit();
    await vi.waitFor(() => expect(harness.component.loadingReferences()).toBe(false));
    return harness;
  }

  it('restores only current account draft after references and uses restored data as clean baseline', async () => {
    const stored: StoredEventCreateDraftV1 = {
      version: 1, userId: 'u1', savedAt: '2026-09-03T00:00:00Z', value: draftValue
    };
    const draftStore = { read: vi.fn(() => stored), write: vi.fn(), remove: vi.fn() };
    const { component, destroy } = await initializedCreate(draftStore);

    expect(draftStore.read).toHaveBeenCalledWith('u1');
    expect(component.form.getRawValue()).toMatchObject(draftValue);
    expect(component.dirty()).toBe(false);
    component.form.controls.title.setValue('Changed');
    expect(component.dirty()).toBe(true);
    component.form.controls.title.setValue('Recovered Cup');
    expect(component.dirty()).toBe(false);
    destroy();
  });

  it('fails closed without displaying, guarding, or writing prior-account input after active profile changes', async () => {
    const draftStore = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() };
    const { component, auth, destroy } = await initializedCreate(draftStore);
    auth.profile.set({ id: 'u2', email: 'b@example.test', emailVerified: true, globalRole: 'Organizer' } as unknown as UserProfileResponse);
    component.form.controls.title.setValue('Owned by u1 editor');
    const event = { preventDefault: vi.fn(), returnValue: undefined };

    component.beforeUnload(event as unknown as BeforeUnloadEvent);

    expect(component.draftAccountMismatch()).toBe(true);
    expect(component.dirty()).toBe(false);
    expect(component.confirmLeave()).toBe(true);
    expect(draftStore.write).not.toHaveBeenCalled();
    expect(draftStore.remove).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    destroy();
  });

  it('debounces normalized create writes for 300ms and writes latest state', async () => {
    const draftStore = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() };
    const { component, destroy } = await initializedCreate(draftStore);
    vi.useFakeTimers();

    component.form.controls.title.setValue(' First ');
    component.form.controls.title.setValue(' Latest ');
    vi.advanceTimersByTime(299);
    expect(draftStore.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(draftStore.write).toHaveBeenCalledTimes(1);
    expect(draftStore.write).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', value: expect.objectContaining({ title: 'Latest' })
    }));
    component.form.controls.title.setValue('  ');
    vi.advanceTimersByTime(300);
    expect(draftStore.remove).toHaveBeenCalledWith('u1');
    vi.useRealTimers();
    destroy();
  });

  it('protects input entered while references are delayed, then merges defaults without overwriting it', async () => {
    const formats = new Subject<PublicFormatResponse[]>();
    const draftStore = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() };
    const afterClosed = vi.fn(() => of(false));
    const dialog = { open: vi.fn(() => ({ afterClosed })) } as unknown as Pick<MatDialog, 'open'>;
    const { component, destroy } = setupHarness('Organizer', locationClient({
      formatsAll: () => formats,
      listEventTimeZones: () => of({ ids: ['Europe/Paris'] })
    }), {}, true, undefined, draftStore, dialog);
    component.ngOnInit();

    component.form.controls.title.setValue('Typed while loading');
    await new Promise(resolve => setTimeout(resolve, 320));
    expect(draftStore.write).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', value: expect.objectContaining({ title: 'Typed while loading' })
    }));
    expect(component.dirty()).toBe(true);
    expect(await firstValueFrom(component.confirmLeave() as Observable<boolean>)).toBe(false);
    const unload = { preventDefault: vi.fn(), returnValue: undefined };
    component.beforeUnload(unload as unknown as BeforeUnloadEvent);
    expect(unload.preventDefault).toHaveBeenCalledTimes(1);

    formats.next([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]);
    formats.complete();
    await vi.waitFor(() => expect(component.loadingReferences()).toBe(false));
    expect(component.form.controls.title.value).toBe('Typed while loading');
    expect(component.form.controls.organizationId.value).toBe('org-mine');
    expect(component.dirty()).toBe(true);
    destroy();
  });

  it('merges a delayed restored draft without overwriting input entered before references finish', async () => {
    const formats = new Subject<PublicFormatResponse[]>();
    const stored: StoredEventCreateDraftV1 = {
      version: 1, userId: 'u1', savedAt: '2026-09-03T00:00:00Z', value: draftValue
    };
    const draftStore = { read: vi.fn(() => stored), write: vi.fn(), remove: vi.fn() };
    const { component, destroy } = setupHarness('Organizer', locationClient({
      formatsAll: () => formats,
      listEventTimeZones: () => of({ ids: ['Europe/Paris'] })
    }), {}, true, undefined, draftStore);
    component.ngOnInit();
    component.form.controls.title.setValue('Typed over recovery');
    await new Promise(resolve => setTimeout(resolve, 320));

    expect(draftStore.write).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.objectContaining({ title: 'Typed over recovery', summary: draftValue.summary })
    }));

    formats.next([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]);
    formats.complete();
    await vi.waitFor(() => expect(component.loadingReferences()).toBe(false));
    expect(component.form.controls.title.value).toBe('Typed over recovery');
    expect(component.form.controls.summary.value).toBe(draftValue.summary);
    expect(component.dirty()).toBe(true);
    destroy();
  });

  it('protects debounced input, navigation, and beforeunload after references reject', async () => {
    const draftStore = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() };
    const afterClosed = vi.fn(() => of(false));
    const dialog = { open: vi.fn(() => ({ afterClosed })) } as unknown as Pick<MatDialog, 'open'>;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { component, destroy } = setupHarness(
      'Organizer', locationClient(), {}, true,
      async () => { throw new Error('references unavailable'); }, draftStore, dialog
    );
    component.ngOnInit();
    await vi.waitFor(() => expect(component.loadingReferences()).toBe(false));

    component.form.controls.title.setValue('Typed after failure');
    await new Promise(resolve => setTimeout(resolve, 320));
    expect(draftStore.write).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', value: expect.objectContaining({ title: 'Typed after failure' })
    }));
    expect(await firstValueFrom(component.confirmLeave() as Observable<boolean>)).toBe(false);
    const unload = { preventDefault: vi.fn(), returnValue: undefined };
    component.beforeUnload(unload as unknown as BeforeUnloadEvent);
    expect(unload.preventDefault).toHaveBeenCalledTimes(1);
    expect(component.form.controls.title.value).toBe('Typed after failure');
    consoleError.mockRestore();
    destroy();
  });

  it('opens translated leave confirmation only while dirty and honors cancel/confirm', async () => {
    const afterClosed = vi.fn(() => of(false));
    const dialog = { open: vi.fn(() => ({ afterClosed })) } as unknown as Pick<MatDialog, 'open'>;
    const { component, destroy } = await initializedCreate(undefined, dialog);
    expect(component.confirmLeave()).toBe(true);

    component.form.controls.title.setValue('Changed');
    expect(await firstValueFrom(component.confirmLeave() as Observable<boolean>)).toBe(false);
    expect(dialog.open).toHaveBeenCalledWith(ConfirmDialogComponent, {
      data: {
        title: component.i18n.t('eventCreate.leaveTitle'),
        message: component.i18n.t('eventCreate.leaveBody'),
        confirmLabel: component.i18n.t('eventCreate.leave')
      }
    });
    afterClosed.mockReturnValue(of(true));
    expect(await firstValueFrom(component.confirmLeave() as Observable<boolean>)).toBe(true);
    destroy();
  });

  it('flushes create state and activates native unload semantics only while dirty', async () => {
    const draftStore = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() };
    const { component, destroy } = await initializedCreate(draftStore);
    const clean = { preventDefault: vi.fn(), returnValue: undefined };
    component.beforeUnload(clean as unknown as BeforeUnloadEvent);
    expect(clean.preventDefault).not.toHaveBeenCalled();

    component.form.controls.title.setValue('Changed');
    const dirty = { preventDefault: vi.fn(), returnValue: undefined };
    component.beforeUnload(dirty as unknown as BeforeUnloadEvent);

    expect(draftStore.write).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
    expect(dirty.preventDefault).toHaveBeenCalledTimes(1);
    expect(dirty.returnValue).toBe('');
    destroy();
  });

  it('counts image interaction dirty before upload identity exists and clears after removal restores baseline', async () => {
    const { component, destroy } = await initializedCreate();

    component.onImageInteractionChange('local-1');
    expect(component.form.controls.imageId.value).toBeNull();
    expect(component.dirty()).toBe(true);

    component.onImageInteractionChange(null);
    expect(component.dirty()).toBe(false);
    destroy();
  });

  it('keeps untouched restored image clean through hydration pending and error state', async () => {
    const stored: StoredEventCreateDraftV1 = {
      version: 1, userId: 'u1', savedAt: '2026-09-03T00:00:00Z', value: draftValue,
      image: {
        id: 'image-restored', state: 'Temporary', width: 960, height: 540, expiresAt: '2030-01-01T00:00:00Z',
        variants: [{ width: 320, height: 180, url: '/api/event-images/image-restored/variants/320' }]
      }
    };
    const { component, destroy } = await initializedCreate({ read: vi.fn(() => stored), write: vi.fn(), remove: vi.fn() });
    const selection = {
      imageId: stored.image!.id,
      response: stored.image!,
      previewUrl: '',
      srcset: ''
    };

    component.onImageInteractionChange(stored.image!.id);
    component.onImageChange(selection);
    component.imagePublishBlocked.set(true);
    expect(component.form.controls.imageId.value).toBe(stored.image!.id);
    expect(component.dirty()).toBe(false);

    component.onImageInteractionChange(stored.image!.id);
    component.onImageChange(selection);
    expect(component.dirty()).toBe(false);
    destroy();
  });

  it('retains restored Temporary image through preview error, draft flush, and next reload', async () => {
    const stored: StoredEventCreateDraftV1 = {
      version: 1, userId: 'u1', savedAt: '2026-09-03T00:00:00Z', value: draftValue,
      image: {
        id: 'image-restored', state: 'Temporary', width: 960, height: 540, expiresAt: '2030-01-01T00:00:00Z',
        variants: [{ width: 320, height: 180, url: '/api/event-images/image-restored/variants/320' }]
      }
    };
    let persisted = stored;
    const draftStore = {
      read: vi.fn(() => persisted),
      write: vi.fn((draft: StoredEventCreateDraftV1) => { persisted = draft; }),
      remove: vi.fn()
    };
    const first = await initializedCreate(draftStore);
    first.component.onImageInteractionChange(stored.image!.id);
    first.component.onImageChange({ imageId: stored.image!.id, response: stored.image!, previewUrl: '', srcset: '' });
    first.component.form.controls.title.setValue('Changed while preview failed');
    first.component.beforeUnload({ preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent);

    expect(persisted.image?.id).toBe('image-restored');
    first.destroy();

    const second = await initializedCreate(draftStore);
    expect(second.component.form.controls.imageId.value).toBe('image-restored');
    expect(second.component.form.controls.title.value).toBe('Changed while preview failed');
    second.destroy();
  });

  it('keeps leave guard active while publication is in flight', async () => {
    const response = new Subject<{ slug: string }>();
    const draftStore = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() };
    const { component, destroy } = await initializedCreate(draftStore, undefined, locationClient({
      formatsAll: () => of([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]),
      listEventTimeZones: () => of({ ids: ['Europe/Paris'] }),
      eventsPOST: () => response
    } as unknown as Partial<Client>));
    component.form.patchValue(draftValue);

    const publish = component.publish();
    await Promise.resolve();
    expect(component.publishing()).toBe(true);
    expect(component.dirty()).toBe(true);
    response.next({ slug: 'published-cup' });
    response.complete();
    await publish;
    destroy();
  });

  it('keeps draft and dirty state after failed publication', async () => {
    const eventsPOST = vi.fn(() => throwError(() => new Error('network')));
    const draftStore = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() };
    const { component, destroy } = await initializedCreate(draftStore, undefined, locationClient({
      formatsAll: () => of([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]),
      listEventTimeZones: () => of({ ids: ['Europe/Paris'] }),
      eventsPOST
    }));
    component.form.patchValue(draftValue);

    await component.publish();

    expect(component.dirty()).toBe(true);
    expect(draftStore.remove).not.toHaveBeenCalled();
    expect(component.submitError()).not.toBeNull();
    destroy();
  });

  it('removes matching draft and clears dirty before successful publication navigation', async () => {
    const eventsPOST = vi.fn(() => of({ slug: 'published-cup' }));
    const draftStore = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() };
    const { component, router, destroy } = await initializedCreate(draftStore, undefined, locationClient({
      formatsAll: () => of([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]),
      listEventTimeZones: () => of({ ids: ['Europe/Paris'] }),
      eventsPOST
    }));
    component.form.patchValue(draftValue);
    expect(component.dirty()).toBe(true);

    await component.publish();

    expect(eventsPOST).toHaveBeenCalledTimes(1);
    expect(draftStore.remove).toHaveBeenCalledWith('u1');
    expect(component.dirty()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/events', 'published-cup']);
    destroy();
  });

  it('removes matching draft and clears dirty before successful proposal replacement', async () => {
    const draftStore = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() };
    const dialog = { open: vi.fn(() => ({ afterClosed: () => of(['approver-1']) })) } as unknown as Pick<MatDialog, 'open'>;
    const proposals = {
      listApprovers: vi.fn(async () => [{ id: 'approver-1', username: 'admin', globalRole: 'Admin' }]),
      submit: vi.fn(async () => ({ recipientCount: 1 }))
    } as unknown as Pick<EventProposalService, 'listApprovers' | 'submit'>;
    const { component, destroy } = setupHarness('User', {
      formatsAll: () => of([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]),
      listEventTimeZones: () => of({ ids: ['Europe/Paris'] }),
      organizationsGET: () => of({ items: [{ id: 'org-mine', name: 'Club' }], page: 1, pageSize: 100, totalCount: 1 })
    } as unknown as Partial<Client>, {}, true, undefined, draftStore, dialog, proposals);
    component.ngOnInit();
    await vi.waitFor(() => expect(component.loadingReferences()).toBe(false));
    component.form.patchValue(draftValue);

    await component.submitForApproval();

    expect(proposals.submit).toHaveBeenCalledTimes(1);
    expect(draftStore.remove).toHaveBeenCalledWith('u1');
    expect(component.dirty()).toBe(false);
    expect(component.proposalSentCount()).toBe(1);
    destroy();
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
    status: 'Published', formatIds: ['fmt-1'], image: {
      id: 'image-1', variants: [{ width: 320, height: 180, url: '/api/event-images/image-1/variants/320' }]
    },
    version: 3, eTag: '"3"'
  };

  it('never reads or writes create draft storage and resets dirty only after successful save', async () => {
    const updated = { ...managedEvent, summary: 'Changed summary', version: 4, eTag: '"4"' };
    const draftStore = { read: vi.fn(() => null), write: vi.fn(), remove: vi.fn() };
    const updateEventDetails = vi.fn(() => of(updated));
    const { component, destroy } = setupHarness('Organizer', {
      formatsAll: () => of([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]),
      listEventTimeZones: () => of({ ids: ['Europe/Paris'] }),
      listOrganizerEvents: () => of({ items: [managedEvent], page: 1, pageSize: 100, totalCount: 1 }),
      updateEventDetails
    } as unknown as Partial<Client>, { id: 'event-1' }, true, undefined, draftStore);

    component.ngOnInit();
    await vi.waitFor(() => expect(component.loadingReferences()).toBe(false));
    expect(component.dirty()).toBe(false);
    component.form.controls.summary.setValue('Changed summary');
    expect(component.dirty()).toBe(true);
    await component.saveEdit();

    expect(component.dirty()).toBe(false);
    expect(draftStore.read).not.toHaveBeenCalled();
    expect(draftStore.write).not.toHaveBeenCalled();
    expect(draftStore.remove).not.toHaveBeenCalled();
    destroy();
  });

  it('appends absent current country and timezone values for editing', async () => {
    const legacy = {
      ...managedEvent,
      location: { ...managedEvent.location, country: 'Legacyland', timeZoneId: 'Legacy/Zone' },
      country: 'Legacyland',
      timeZoneId: 'Legacy/Zone'
    };
    const component = setup('Organizer', {
      formatsAll: () => of([]),
      listEventTimeZones: () => of({ ids: ['Europe/Paris'] }),
      listOrganizerEvents: () => of({ items: [legacy], page: 1, pageSize: 100, totalCount: 1 })
    } as unknown as Partial<Client>, { id: 'event-1' });

    await component.loadReferences();

    expect(component.countries()).toEqual([
      { code: 'FR', name: 'France' },
      { code: '', name: 'Legacyland' }
    ]);
    expect(component.timeZones()).toEqual(['Europe/Paris', 'Legacy/Zone']);
    expect(component.form.controls.country.value).toBe('Legacyland');
    expect(component.form.controls.timeZoneId.value).toBe('Legacy/Zone');
  });

  it('maps missing-image PATCH 404 to media reload recovery instead of permission failure', async () => {
    const latest = { ...managedEvent, image: undefined, version: 4, eTag: '"4"' };
    const updateEventDetails = vi.fn(() => throwError(() => new ApiProblemError(404, { code: 'image_not_found' })));
    const listOrganizerEvents = vi.fn(() => of({ items: [latest], page: 1, pageSize: 100, totalCount: 1 }));
    const component = setup('Organizer', { updateEventDetails, listOrganizerEvents } as unknown as Partial<Client>, { id: 'event-1' });
    const editor = component as unknown as { applyCanonical(event: unknown): void };
    component.formats.set([{ id: 'fmt-1', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]);
    editor.applyCanonical(managedEvent);

    await component.saveEdit();

    expect(component.fieldErrors()['imageId']).toBe(component.i18n.t('eventManage.imageMissing'));
    expect(component.staleEvent()).toBe(latest);
    expect(component.submitError()).toBeNull();
    expect(component.fieldErrors()['imageId']).not.toBe(component.i18n.t('eventManage.forbidden'));

    component.reloadLatest();

    expect(component.fieldErrors()['imageId']).toBeUndefined();
  });

  it('sends nested ETag edit, keeps local draft on 412, then explicitly reloads canonical media and location', async () => {
    const latest = {
      ...managedEvent,
      title: 'Server title',
      bodyMarkdown: 'Server body',
      location: { ...managedEvent.location, streetAddress: '9 Server Street', timeZoneId: 'Europe/London' },
      streetAddress: '9 Server Street',
      timeZoneId: 'Europe/London',
      image: {
        id: 'image-2', variants: [{ width: 320, height: 180, url: '/api/event-images/image-2/variants/320' }]
      },
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
    component.form.controls.imageId.setValue('image-1');

    await component.saveEdit();

    expect(updateEventDetails).toHaveBeenCalledWith('event-1', '"3"', {
      title: 'Original', summary: 'Summary', bodyMarkdown: 'Local draft body',
      location: {
        streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France',
        region: 'Auvergne-Rhône-Alpes', timeZoneId: 'Europe/Paris'
      },
      eventType: 'weekly', startsAtLocal: '2027-08-01T10:00', capacity: 32, formatIds: ['fmt-1'],
      imageId: 'image-1'
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
    expect(component.form.controls.imageId.value).toBe('image-2');
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
