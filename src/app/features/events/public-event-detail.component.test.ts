import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as public-calendar.component.test.ts: no TestBed / zone.js in this repo, so
// `effect()` is stubbed to a no-op and the component is built with a bare Injector. Rendered
// output is asserted in cypress/e2e/event-registration.cy.js.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { of } from 'rxjs';
import {
  PublicEventDetailResponse,
  PublicEventParticipantListResponse,
  PublicEventParticipantResponse,
  UserProfileResponse
} from '../../api/generated/gones-api';
import { ApiProblemError } from '../../api/api-boundary';
import { AuthService } from '../../auth/auth.service';
import { I18nService } from '../../i18n/i18n.service';
import { translate } from '../../i18n/messages';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { OnlineStatusService } from '../../shared/online-status.service';
import { PublicEventDetailComponent } from './public-event-detail.component';
import { PublicEventService } from './public-event.service';
import { RegistrationSuccessDialogComponent } from './registration-success-dialog.component';
import { EventRegistrationService } from './event-registration.service';

const event = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Lyon Legacy',
  slug: 'lyon-legacy',
  organization: { id: '22222222-2222-2222-2222-222222222222', name: 'Gones' },
  formats: []
} as unknown as PublicEventDetailResponse;

function build(options: { register?: () => Promise<unknown>; confirmUnregister?: boolean } = {}) {
  const open = vi.fn((_dialog: unknown, _config?: unknown) => ({ afterClosed: () => of(options.confirmUnregister ?? true) }));
  const registrations = {
    register: vi.fn(options.register ?? (async () => ({}))),
    unregister: vi.fn(async () => ({})),
    capability: vi.fn(async () => ({ canRegister: true, canUnregister: false, reason: 'available', activeParticipantCount: 0, capacity: 2 })),
    participants: vi.fn(async (): Promise<PublicEventParticipantListResponse> => ({ items: [], page: 1, pageSize: 100, totalCount: 0 }))
  };
  const injector = Injector.create({ providers: [
    { provide: PublicEventService, useValue: { icsUrl: vi.fn(() => 'https://api.example/x.ics'), detail: vi.fn(async () => ({ data: event, stale: false, cachedAt: undefined })) } },
    { provide: EventRegistrationService, useValue: registrations },
    { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['slug', 'lyon-legacy']]) } } },
    { provide: MatDialog, useValue: { open } },
    { provide: AuthService, useValue: { enabled: true, profile: signal<UserProfileResponse | null>({ id: 'user' } as UserProfileResponse) } },
    { provide: OnlineStatusService, useValue: { online: signal(true) } },
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new PublicEventDetailComponent());
  component.event.set(event);
  return { component, open, registrations };
}

const source = readFileSync(join(__dirname, 'public-event-detail.component.ts'), 'utf8');
const headerStart = source.indexOf('class="public-participants__header"');
const header = source.slice(headerStart, source.indexOf('</div>', source.indexOf('class="public-participants__header-actions"')) + 6);

describe('PublicEventDetailComponent registration actions', () => {
  it('removes the standalone registration section', () => {
    expect(source).not.toContain('data-cy="registration-section"');
    expect(source).not.toContain('class="registration-action"');
  });

  it('participants header owns ICS then auth, register and unregister actions', () => {
    expect(headerStart).toBeGreaterThan(-1);
    expect(header).toContain('data-cy="public-participants-title"');
    expect(header).toContain('class="public-participants__header-actions"');
    expect(header).toContain('data-cy="registration-ics"');
    expect(header).toContain('[href]="service.icsUrl(item.slug)"');
    expect(header).toContain('data-cy="registration-login"');
    expect(header).toContain('data-cy="registration-register"');
    expect(header).toContain('class="registration-register-button"');
    expect(header).toContain('data-cy="registration-unregister"');
    expect(header).toContain('class="danger-ghost-action"');
    expect(header.indexOf('data-cy="registration-ics"')).toBeLessThan(header.indexOf('data-cy="registration-login"'));
    expect(header.indexOf('data-cy="registration-login"')).toBeLessThan(header.indexOf('data-cy="registration-register"'));
    expect(header.indexOf('data-cy="registration-register"')).toBeLessThan(header.indexOf('data-cy="registration-unregister"'));
    expect(source).toContain('[showIcsAction]="false"');
    const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');
    expect(stylesheet).toContain('.public-participants__header {');
    expect(stylesheet).toContain('justify-content: space-between;');
    expect(stylesheet).toContain('.public-participants__header-actions {');
    expect(stylesheet).toContain('.registration-register-button:not(:disabled) {');
  });

  /**
   * T13's rule, asserted on the anchor this page actually renders. The hero anchor of
   * `event-detail-view` is opted out here (`[showIcsAction]="false"`), so this is the only
   * Add-to-Calendar link a visitor can click on an Event page: it must hand the file to the OS
   * calendar app rather than save it.
   */
  it('does not force a download from the Add-to-Calendar action', () => {
    const icsMarker = header.indexOf('data-cy="registration-ics"');
    const icsAnchor = header.slice(header.lastIndexOf('<a', icsMarker), header.indexOf('</a>', icsMarker));

    expect(icsAnchor).not.toContain(' download');
    expect(icsAnchor).toContain('type="text/calendar"');
  });

  it('keeps capability, offline, reason and mutation status inside Participants', () => {
    const participants = source.slice(source.indexOf('data-cy="public-participants-section"'));
    expect(participants).toContain('data-cy="registration-capability-loading"');
    expect(participants).toContain('data-cy="registration-capability-error"');
    expect(participants).toContain('data-cy="registration-reason"');
    expect(participants).toContain('data-cy="registration-offline"');
    expect(participants).toContain('data-cy="registration-status"');
  });

  it('always loads participants with the event detail', async () => {
    const { component, registrations } = build();
    await component.load();
    expect(registrations.participants).toHaveBeenCalledWith('lyon-legacy', 1, 100);
    expect(source).not.toContain('data-cy="public-participants-show"');
    expect(source).not.toContain('participantsRequested');
  });

  it('show more appends the next participants page', async () => {
    const { component, registrations } = build();
    const pageOne = { userId: 'u1', username: 'Alpha' } as unknown as PublicEventParticipantResponse;
    const pageTwo = { userId: 'u2', username: 'Beta' } as unknown as PublicEventParticipantResponse;
    registrations.participants
      .mockResolvedValueOnce({ items: [pageOne], page: 1, pageSize: 100, totalCount: 2 })
      .mockResolvedValueOnce({ items: [pageTwo], page: 2, pageSize: 100, totalCount: 2 });
    await component.loadParticipants();
    await component.loadMoreParticipants();
    expect(registrations.participants).toHaveBeenLastCalledWith('lyon-legacy', 2, 100);
    expect(component.participants()).toEqual([pageOne, pageTwo]);
    expect(component.participantsTotal()).toBe(2);
  });

  it('puts registered count and capacity beside the Participants title', () => {
    const titleRowStart = source.indexOf('data-cy="public-participants-title-row"');
    const titleRow = source.slice(titleRowStart, source.indexOf('</div>', titleRowStart));
    expect(titleRowStart).toBeGreaterThan(-1);
    expect(titleRow).toContain('data-cy="public-participants-title"');
    expect(titleRow).toContain('data-cy="registration-capacity-status"');
    expect(titleRow).toContain('participantCapacityStatus(item.capacity)');
    expect(translate('en', 'registration.capacityStatus', { count: 12, capacity: 32 })).toBe('12 / 32 registered');
    expect(source).toContain('data-cy="public-participants-more"');
  });

  it('links participants carrying a matched Player Statistics name', () => {
    expect(source).toContain('@if (participant.playerName; as playerName)');
    expect(source).toContain("[routerLink]=\"['/players', playerName]\"");
  });

  it('shows capacity only after participant count succeeds, including zero', () => {
    const { component } = build();
    expect(component.participantCapacityStatus(2)).toBeNull();
    component.participantsTotal.set(0);
    expect(component.participantCapacityStatus(2)).toBe(translate('fr', 'registration.capacityStatus', { count: 0, capacity: 2 }));
  });

  it('successful registration opens the success dialog', async () => {
    const { component, open } = build();
    await component.register();
    expect(open).toHaveBeenCalledWith(RegistrationSuccessDialogComponent, { data: { title: 'Lyon Legacy' } });
    expect(component.mutationStatus()).toBe(translate('fr', 'registration.registered'));
  });

  it('failed registration does not open the success dialog', async () => {
    const { component, open } = build({
      register: async () => { throw new ApiProblemError(409, { code: 'event_full', title: 'full', status: 409 }); }
    });
    await component.register();
    expect(open).not.toHaveBeenCalled();
    expect(component.mutationStatus()).toBe(translate('fr', 'registration.full'));
  });

  it('a second submit while one is in flight neither registers nor confirms twice', async () => {
    const { component, open, registrations } = build();
    await Promise.all([component.register(), component.register()]);
    expect(registrations.register).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('unregister still uses the confirm dialog', async () => {
    const { component, open, registrations } = build();
    await component.confirmUnregister();
    expect(open.mock.calls[0][0]).toBe(ConfirmDialogComponent);
    expect(registrations.unregister).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('RegistrationSuccessDialogComponent', () => {
  const dialogSource = readFileSync(join(__dirname, 'registration-success-dialog.component.ts'), 'utf8');

  it('links to my registrations and closes on either action', () => {
    expect(dialogSource).toContain('data-cy="registration-success-my-registrations"');
    expect(dialogSource).toContain('routerLink="/registrations"');
    expect(dialogSource).toContain('mat-flat-button');
    expect(dialogSource).toContain('data-cy="registration-success-close"');
    expect(dialogSource).toMatch(/data-cy="registration-success-my-registrations"[\s\S]{0,20}>/);
    expect((dialogSource.match(/mat-dialog-close/g) ?? []).length).toBe(2);
  });

  it('names the dialog and repeats the event title', () => {
    expect(dialogSource).toContain('mat-dialog-title');
    expect(dialogSource).toContain(`i18n.t('registration.successTitle')`);
    expect(dialogSource).toContain(`i18n.t('registration.successMessage', { title: data.title })`);
  });
});
