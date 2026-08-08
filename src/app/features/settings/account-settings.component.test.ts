import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Effects created in a component/service constructor need a `ChangeDetectionScheduler`
// that only exists once bootstrapped via `bootstrapApplication`/`TestBed`. This repo has
// neither (no zone.js, no @angular/platform-browser-dynamic testing harness), so these
// component-level unit tests build their own `Injector` and stub `effect()` to a no-op —
// only the derived-state (`isDirty`, `pseudoChanged`) and method behaviour under test rely
// on synchronous signal reads, not on the profile-arrives-after-bootstrap effect (T9 step 7).
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
  updateProfile: ReturnType<typeof vi.fn>;
  startLink: ReturnType<typeof vi.fn>;
  unlink: ReturnType<typeof vi.fn>;
  listExternalIdentities: ReturnType<typeof vi.fn>;
}

function makeAuthStub(): AuthStub {
  const profileSignal = signal<UserProfileResponse | null>(baseProfile);
  return {
    profile: profileSignal,
    updateProfile: vi.fn(async (request: Partial<UserProfileResponse>) => {
      const patched = { ...profileSignal(), ...request } as UserProfileResponse;
      profileSignal.set(patched);
      return patched;
    }),
    startLink: vi.fn(async () => 'https://provider.example/authorize'),
    unlink: vi.fn(async () => undefined),
    listExternalIdentities: vi.fn(async () => [])
  };
}

function createComponent(dialogAfterClosed: unknown, authStub: AuthStub = makeAuthStub()) {
  const dialogStub = { open: vi.fn(() => ({ afterClosed: () => of(dialogAfterClosed) })) };
  const injector = Injector.create({
    providers: [
      { provide: AuthService, useValue: authStub },
      { provide: MatDialog, useValue: dialogStub },
      { provide: Router, useValue: { navigate: vi.fn() } },
      DeckArchetypeSettingsService,
      I18nService
    ]
  });
  const component = runInInjectionContext(injector, () => new AccountSettingsComponent());
  return { component, authStub, dialogStub };
}

describe('AccountSettingsComponent', () => {
  it('dialog cancel makes no request', async () => {
    const { component, authStub } = createComponent(false);
    component.setField('locationCity', 'Lyon');
    await component.saveProfile();
    expect(authStub.updateProfile).not.toHaveBeenCalled();
  });

  it('dialog confirm saves and resets the baseline', async () => {
    const { component, authStub } = createComponent(true);
    component.setField('locationCity', 'Lyon');
    expect(component.isDirty()).toBe(true);
    await component.saveProfile();
    expect(authStub.updateProfile).toHaveBeenCalledTimes(1);
    expect(component.isDirty()).toBe(false);
  });

  it('link sends no password', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true, configurable: true });
    const { component, authStub } = createComponent(false);
    await component.link('google');
    expect(authStub.startLink).toHaveBeenCalledWith('google');
    expect(authStub.startLink).toHaveBeenCalledTimes(1);
  });
});
