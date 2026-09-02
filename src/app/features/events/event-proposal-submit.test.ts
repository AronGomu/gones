import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as organizer-event-create.component.test.ts: no TestBed / zone.js in this
// repo, so `effect()` is stubbed to a no-op and the component is built with a bare Injector.
// These tests assert on component state and spy calls, never on rendered DOM.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { OrganizerEventCreateComponent } from './organizer-event-create.component';
import { EventProposalService } from './event-proposal.service';
import { AuthService } from '../../auth/auth.service';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { Client, UserProfileResponse } from '../../api/generated/gones-api';

function paramMap(values: Record<string, string> = {}): ParamMap {
  return {
    keys: Object.keys(values),
    has: name => Object.prototype.hasOwnProperty.call(values, name),
    get: name => values[name] ?? null,
    getAll: name => values[name] ? [values[name]] : []
  };
}

function setup(dialogAfterClosed: unknown) {
  const profile = { id: 'u1', email: 'a@example.test', emailVerified: true, globalRole: 'User' } as unknown as UserProfileResponse;
  const auth = { profile: signal<UserProfileResponse | null>(profile) } as unknown as AuthService;
  const route = { snapshot: { paramMap: paramMap() } } as unknown as ActivatedRoute;
  const dialogStub = { open: vi.fn(() => ({ afterClosed: () => of(dialogAfterClosed) })) };
  const proposalsStub = {
    listApprovers: vi.fn(async () => [{ id: 'a1', username: 'admin1', globalRole: 'Admin' }]),
    submit: vi.fn(async () => ({ id: 'p1', status: 'Pending', expiresAt: '2027-08-01T00:00:00Z', recipientCount: 2 }))
  };

  const injector = Injector.create({ providers: [
    { provide: Client, useValue: {} },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: {} },
    { provide: MatDialog, useValue: dialogStub },
    { provide: AuthService, useValue: auth },
    { provide: EventProposalService, useValue: proposalsStub },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(true), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
    DeckArchetypeSettingsService,
    I18nService
  ] });

  const component = runInInjectionContext(injector, () => new OrganizerEventCreateComponent());
  return { component, dialogStub, proposalsStub };
}

function fillValidForm(component: OrganizerEventCreateComponent): void {
  component.form.setValue({
    organizationId: 'org1',
    title: 'My Event',
    summary: '',
    bodyMarkdown: '',
    streetAddress: '1 rue Test',
    postalCode: '69001',
    city: 'Lyon',
    country: 'France',
    region: 'Auvergne-Rhône-Alpes',
    locationToken: 'signed-location-token',
    latitude: 45.764,
    longitude: 4.8357,
    eventType: 'weekly',
    timeZoneId: 'Europe/Paris',
    startDate: '2027-08-01',
    startTime: '10:00',
    endsAtLocal: '',
    capacity: 32,
    formatId: 'fmt1',
    liveTournamentUrl: '',
    archiveTournamentUrl: '',
    images: []
  });
}

describe('OrganizerEventCreateComponent.submitForApproval', () => {
  it('an invalid form opens no dialog', async () => {
    const { component, dialogStub } = setup(undefined);
    await component.submitForApproval();
    expect(dialogStub.open).not.toHaveBeenCalled();
    expect(component.fieldError('title')).toBeTruthy();
  });

  it('cancelling posts nothing', async () => {
    const { component, proposalsStub } = setup(undefined);
    fillValidForm(component);
    await component.submitForApproval();
    expect(proposalsStub.submit).not.toHaveBeenCalled();
  });

  // T26. The dialog may only ever offer people who represent the chosen organization, so the
  // request that fills it has to carry that organization.
  it('scopes the approver request to the chosen organization', async () => {
    const { component, proposalsStub } = setup(['id1']);
    fillValidForm(component);
    await component.submitForApproval();
    expect(proposalsStub.listApprovers).toHaveBeenCalledWith('org1');
  });

  it('an organization with no reviewer opens no dialog', async () => {
    const { component, dialogStub, proposalsStub } = setup(['id1']);
    proposalsStub.listApprovers = vi.fn(async () => []);
    fillValidForm(component);
    await component.submitForApproval();
    expect(dialogStub.open).not.toHaveBeenCalled();
    expect(proposalsStub.submit).not.toHaveBeenCalled();
    expect(component.proposalError()).toBeTruthy();
  });

  it('confirming posts the payload and recipients', async () => {
    const { component, proposalsStub } = setup(['id1']);
    fillValidForm(component);
    await component.submitForApproval();
    expect(proposalsStub.submit).toHaveBeenCalledTimes(1);
    expect(proposalsStub.submit).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'weekly',
      formatIds: ['fmt1'],
      images: [],
      location: expect.objectContaining({ region: 'Auvergne-Rhône-Alpes', country: 'France', city: 'Lyon' })
    }), ['id1']);
  });

  it('success shows the confirmation panel', async () => {
    const { component } = setup(['id1']);
    fillValidForm(component);
    await component.submitForApproval();
    expect(component.proposalSentCount()).toBe(2);
  });

  it('a server error keeps the form', async () => {
    const { component, proposalsStub } = setup(['id1']);
    proposalsStub.submit = vi.fn(async () => {
      throw new ApiProblemError(400, { message: 'Validation failed.', errors: { title: ['Title is required.'] } });
    });
    fillValidForm(component);
    const titleBefore = component.form.controls.title.value;
    await component.submitForApproval();
    expect(component.form.controls.title.value).toBe(titleBefore);
    expect(component.proposalError()).toBeTruthy();
  });
});
