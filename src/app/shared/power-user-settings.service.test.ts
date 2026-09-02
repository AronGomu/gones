import '@angular/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { UserProfileResponse } from '../api/generated/gones-api';
import { POWER_USER_STORAGE_KEY, PowerUserSettingsService, canUsePowerMutation } from './power-user-settings.service';

function storage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}

function service(role: 'User' | 'Organizer' | 'Admin' | null = null): PowerUserSettingsService {
  const profile = role ? signal({ globalRole: role } as UserProfileResponse) : signal<UserProfileResponse | null>(null);
  const injector = Injector.create({ providers: [{ provide: AuthService, useValue: { profile } }] });
  return runInInjectionContext(injector, () => new PowerUserSettingsService());
}

afterEach(() => vi.unstubAllGlobals());

describe('PowerUserSettingsService', () => {
  it.each([
    [undefined, false],
    ['invalid', false],
    ['TRUE', false],
    ['false', false],
    ['true', true]
  ])('restores %s as %s', (stored, expected) => {
    vi.stubGlobal('localStorage', storage(stored === undefined ? {} : { [POWER_USER_STORAGE_KEY]: stored }));

    expect(service().enabled()).toBe(expected);
  });

  it('persists literal booleans for signed-out visitors', () => {
    const browserStorage = storage();
    vi.stubGlobal('localStorage', browserStorage);
    const settings = service();

    settings.setEnabled(true);
    expect(settings.enabled()).toBe(true);
    expect(browserStorage.getItem(POWER_USER_STORAGE_KEY)).toBe('true');

    settings.setEnabled(false);
    expect(settings.enabled()).toBe(false);
    expect(browserStorage.getItem(POWER_USER_STORAGE_KEY)).toBe('false');
  });

  it('fails closed when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    });
    const settings = service();

    expect(settings.enabled()).toBe(false);
    settings.setEnabled(true);
    expect(settings.enabled()).toBe(true);
  });

  it('follows the Power User key when another tab changes it', () => {
    const browserStorage = storage();
    vi.stubGlobal('localStorage', browserStorage);
    const settings = service();

    browserStorage.setItem(POWER_USER_STORAGE_KEY, 'true');
    window.dispatchEvent(new StorageEvent('storage', { key: POWER_USER_STORAGE_KEY, newValue: 'true' }));
    expect(settings.enabled()).toBe(true);

    browserStorage.setItem(POWER_USER_STORAGE_KEY, 'false');
    window.dispatchEvent(new StorageEvent('storage', { key: POWER_USER_STORAGE_KEY, newValue: 'false' }));
    expect(settings.enabled()).toBe(false);
  });

  it('leaves the preference alone when another key changes', () => {
    const browserStorage = storage({ [POWER_USER_STORAGE_KEY]: 'true' });
    vi.stubGlobal('localStorage', browserStorage);
    const settings = service();

    browserStorage.setItem(POWER_USER_STORAGE_KEY, 'false');
    window.dispatchEvent(new StorageEvent('storage', { key: 'gones.settings.language', newValue: 'fr' }));

    expect(settings.enabled()).toBe(true);
  });

  it('keeps this tab active on a storage event when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    });
    const settings = service();
    settings.setEnabled(true);

    window.dispatchEvent(new StorageEvent('storage', { key: POWER_USER_STORAGE_KEY, newValue: 'false' }));

    expect(settings.enabled()).toBe(true);
  });

  it.each(['Organizer', 'Admin'] as const)('forces Power User on for %s regardless of browser preference', role => {
    vi.stubGlobal('localStorage', storage({ [POWER_USER_STORAGE_KEY]: 'false' }));
    const settings = service(role);

    expect(settings.enabled()).toBe(true);
    settings.setEnabled(false);
    expect(settings.enabled()).toBe(true);
    expect(() => settings.requireEnabled()).not.toThrow();
  });

  it('throws powerUserRequired while a visitor or plain User is disabled', () => {
    vi.stubGlobal('localStorage', storage());
    const settings = service('User');

    expect(() => settings.requireEnabled()).toThrowError('powerUserRequired');
    settings.setEnabled(true);
    expect(() => settings.requireEnabled()).not.toThrow();
  });
});

describe('canUsePowerMutation', () => {
  it.each([
    [false, false, false],
    [false, true, false],
    [true, false, false],
    [true, true, true]
  ])('power %s and authority %s returns %s', (power, authority, expected) => {
    expect(canUsePowerMutation(power, authority)).toBe(expected);
  });
});
