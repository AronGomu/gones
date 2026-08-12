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
import { PublicEventDetailResponse, UserProfileResponse } from '../../api/generated/gones-api';
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
    participants: vi.fn(async () => ({ items: [] }))
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
const actionsStart = source.indexOf('data-cy="registration-actions"');
const actions = source.slice(actionsStart, source.indexOf('</div>', actionsStart));

describe('PublicEventDetailComponent registration actions', () => {
  it('ics and register share one action row', () => {
    expect(actionsStart).toBeGreaterThan(-1);
    expect(actions).toContain('data-cy="registration-ics"');
    expect(actions).toContain('[href]="service.icsUrl(item.slug)"');
    expect(actions).toContain('download');
    expect(actions).toContain('data-cy="registration-register"');
    expect(actions).toContain('class="registration-register-button"');
    expect(actions.indexOf('data-cy="registration-ics"')).toBeLessThan(actions.indexOf('data-cy="registration-register"'));
    expect(source).toContain('[showIcsAction]="false"');
    const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');
    expect(stylesheet).toContain('.registration-actions {');
    expect(stylesheet).toContain('.registration-register-button:not(:disabled) {');
  });

  it('my registrations button is gone from the registration section', () => {
    expect(source).not.toContain('my-registrations-link');
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
