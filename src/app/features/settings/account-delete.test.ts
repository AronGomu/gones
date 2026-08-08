import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AccountSettingsComponent } from './account-settings.component';
import { AuthService } from '../../auth/auth.service';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { GeoService } from '../../shared/geo.service';
import { ApiProblemError } from '../../api/api-boundary';
import { UserProfileResponse } from '../../api/generated/gones-api';

const baseProfile = {
  id: 'u1', email: 'a@example.test', emailVerified: true, globalRole: 'User',
  username: 'alice', firstName: 'Alice', lastName: 'Anders',
  locationCountry: 'FR', locationRegion: 'IDF', locationCity: 'Paris',
  birthDate: '1990-04-17', preferredLanguage: 'en',
  isFirstNamePublic: true, isLastNamePublic: false, isLocationPublic: false,
  isBirthDatePublic: false, isPreferredLanguagePublic: true,
  createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z'
} as unknown as UserProfileResponse;

interface AuthStub {
  profile: WritableSignal<UserProfileResponse | null>;
  deleteAccount: ReturnType<typeof vi.fn>;
  startLink: ReturnType<typeof vi.fn>;
  unlink: ReturnType<typeof vi.fn>;
  listExternalIdentities: ReturnType<typeof vi.fn>;
}

function makeAuthStub(deleteAccount: ReturnType<typeof vi.fn> = vi.fn(async () => undefined)): AuthStub {
  return {
    profile: signal<UserProfileResponse | null>(baseProfile),
    deleteAccount,
    startLink: vi.fn(async () => 'https://provider.example/authorize'),
    unlink: vi.fn(async () => undefined),
    listExternalIdentities: vi.fn(async () => [])
  };
}

function createComponent(dialogAfterClosed: unknown, authStub: AuthStub = makeAuthStub()) {
  const dialogStub = { open: vi.fn(() => ({ afterClosed: () => of(dialogAfterClosed) })) };
  const geoStub = { countries: vi.fn(async () => []), regions: vi.fn(async () => []), cities: vi.fn(async () => []) };
  const router = { navigate: vi.fn() };
  const injector = Injector.create({
    providers: [
      { provide: AuthService, useValue: authStub },
      { provide: MatDialog, useValue: dialogStub },
      { provide: Router, useValue: router },
      { provide: GeoService, useValue: geoStub },
      DeckArchetypeSettingsService,
      I18nService
    ]
  });
  const component = runInInjectionContext(injector, () => new AccountSettingsComponent());
  return { component, authStub, dialogStub, router };
}

describe('AccountSettingsComponent.deleteAccount', () => {
  it('cancelling makes no request', async () => {
    const { component, authStub } = createComponent(undefined);
    await component.deleteAccount();
    expect(authStub.deleteAccount).not.toHaveBeenCalled();
  });

  it('confirming deletes and navigates', async () => {
    const { component, authStub, router } = createComponent('pw');
    await component.deleteAccount();
    expect(authStub.deleteAccount).toHaveBeenCalledWith('pw');
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('a bad password shows a field error', async () => {
    const deleteAccount = vi.fn(async () => {
      throw new ApiProblemError(400, { errors: { currentPassword: ['Incorrect password.'] } });
    });
    const { component, router } = createComponent('wrong', makeAuthStub(deleteAccount));
    await component.deleteAccount();
    expect(component.fieldErrors()['currentPassword']).toEqual(['Incorrect password.']);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('the last-admin conflict shows its own message', async () => {
    const deleteAccount = vi.fn(async () => {
      throw new ApiProblemError(409, { code: 'lastAdmin' });
    });
    const { component } = createComponent('pw', makeAuthStub(deleteAccount));
    await component.deleteAccount();
    expect(component.error()).toBe(component.i18n.t('account.deleteLastAdmin'));
  });

  it('the owned-records conflict lists what blocks it', async () => {
    const deleteAccount = vi.fn(async () => {
      throw new ApiProblemError(409, { code: 'account_owns_records', relations: ['scheduled_tournaments.created_by_user_id'] } as never);
    });
    const { component, router } = createComponent('pw', makeAuthStub(deleteAccount));
    await component.deleteAccount();
    expect(component.error().startsWith(component.i18n.t('account.deleteOwnsRecords'))).toBe(true);
    expect(component.error()).toContain('scheduled_tournaments.created_by_user_id');
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
