import { describe, expect, it } from 'vitest';
import { AccountFormValues } from './account-form';
import { applyCountry, applyRegion, optionsWithStoredValue } from './location-selection';

const values: AccountFormValues = {
  username: 'alice', firstName: 'Alice', lastName: 'Anders',
  locationCountry: 'France', locationRegion: 'Rhône', locationCity: 'Lyon',
  birthDate: '', preferredLanguage: 'fr',
  isFirstNamePublic: false, isLastNamePublic: false, isLocationPublic: false,
  isBirthDatePublic: false, isPreferredLanguagePublic: false
};

describe('location-selection', () => {
  it('country change clears region and city', () => {
    const result = applyCountry(values, 'Belgium');
    expect(result.locationCountry).toBe('Belgium');
    expect(result.locationRegion).toBe('');
    expect(result.locationCity).toBe('');
  });

  it('region change clears city', () => {
    const result = applyRegion(values, 'Auvergne-Rhône-Alpes');
    expect(result.locationRegion).toBe('Auvergne-Rhône-Alpes');
    expect(result.locationCity).toBe('');
  });

  it('stored value survives an unknown option', () => {
    expect(optionsWithStoredValue(['Lyon'], 'Villeurbanne')).toEqual(['Lyon', 'Villeurbanne']);
  });

  it('stored value already present is not duplicated', () => {
    expect(optionsWithStoredValue(['Lyon'], 'Lyon')).toEqual(['Lyon']);
  });

  it('empty stored value is not appended', () => {
    expect(optionsWithStoredValue(['Lyon'], '')).toEqual(['Lyon']);
  });
});
