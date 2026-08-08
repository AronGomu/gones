import { describe, expect, it } from 'vitest';
import { accountFormIsDirty, accountFormPayload, accountFormValues, AccountFormValues } from './account-form';
import { UserProfileResponse } from '../../api/generated/gones-api';

const profileFixture = {
  id: 'u1', email: 'a@example.test', emailVerified: true, globalRole: 'User',
  username: 'alice', firstName: 'Alice', lastName: 'Anders',
  locationCountry: 'FR', locationRegion: 'IDF', locationCity: 'Paris',
  birthDate: '1990-04-17', preferredLanguage: 'en',
  isFirstNamePublic: true, isLastNamePublic: false, isLocationPublic: false,
  isBirthDatePublic: false, isPreferredLanguagePublic: true,
  createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z'
} as unknown as UserProfileResponse;

describe('accountFormValues', () => {
  it('maps a profile to form values', () => {
    const values = accountFormValues(profileFixture);
    expect(values.username).toBe('alice');
    expect(values.firstName).toBe('Alice');
    expect(values.lastName).toBe('Anders');
    expect(values.locationCountry).toBe('FR');
    expect(values.locationRegion).toBe('IDF');
    expect(values.locationCity).toBe('Paris');
    expect(values.birthDate).toBe('1990-04-17');
    expect(values.preferredLanguage).toBe('en');
    expect(values.isFirstNamePublic).toBe(true);
    expect(values.isLastNamePublic).toBe(false);
    expect(values.isLocationPublic).toBe(false);
    expect(values.isBirthDatePublic).toBe(false);
    expect(values.isPreferredLanguagePublic).toBe(true);
  });

  it('maps a null profile to empty values', () => {
    const values = accountFormValues(null);
    expect(values.username).toBe('');
    expect(values.firstName).toBe('');
    expect(values.lastName).toBe('');
    expect(values.locationCountry).toBe('');
    expect(values.locationRegion).toBe('');
    expect(values.locationCity).toBe('');
    expect(values.birthDate).toBe('');
    expect(values.preferredLanguage).toBe('fr');
    expect(values.isFirstNamePublic).toBe(false);
    expect(values.isLastNamePublic).toBe(false);
    expect(values.isLocationPublic).toBe(false);
    expect(values.isBirthDatePublic).toBe(false);
    expect(values.isPreferredLanguagePublic).toBe(false);
  });
});

describe('accountFormIsDirty', () => {
  const baseline = accountFormValues(profileFixture);

  it('is not dirty when unchanged', () => {
    expect(accountFormIsDirty(baseline, baseline)).toBe(false);
  });

  it('is dirty on a changed pseudo', () => {
    expect(accountFormIsDirty(baseline, { ...baseline, username: 'x' })).toBe(true);
  });

  it('is dirty on a changed privacy flag', () => {
    expect(accountFormIsDirty(baseline, { ...baseline, isLocationPublic: true })).toBe(true);
  });

  it('ignores the password field for dirtiness', () => {
    const withPassword = { ...baseline, currentPassword: 'abc' } as AccountFormValues;
    expect(accountFormIsDirty(baseline, withPassword)).toBe(false);
  });
});

describe('accountFormPayload', () => {
  it('sends undefined for empty optionals', () => {
    const baseline = accountFormValues(profileFixture);
    const payload = accountFormPayload({ ...baseline, locationCity: '', birthDate: '' }, '');
    expect(payload.locationCity).toBeUndefined();
    expect(payload.birthDate).toBeUndefined();
    expect(payload.currentPassword).toBeUndefined();
  });
});
