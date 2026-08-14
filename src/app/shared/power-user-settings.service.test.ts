import { afterEach, describe, expect, it, vi } from 'vitest';
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

    expect(new PowerUserSettingsService().enabled()).toBe(expected);
  });

  it('persists literal booleans for signed-out visitors', () => {
    const browserStorage = storage();
    vi.stubGlobal('localStorage', browserStorage);
    const settings = new PowerUserSettingsService();

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
    const settings = new PowerUserSettingsService();

    expect(settings.enabled()).toBe(false);
    settings.setEnabled(true);
    expect(settings.enabled()).toBe(true);
  });

  it('throws powerUserRequired while disabled', () => {
    vi.stubGlobal('localStorage', storage());
    const settings = new PowerUserSettingsService();

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
