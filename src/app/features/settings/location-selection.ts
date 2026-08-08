import { AccountFormValues } from './account-form';

export function applyCountry(values: AccountFormValues, code: string): AccountFormValues {
  return { ...values, locationCountry: code, locationRegion: '', locationCity: '' };
}

export function applyRegion(values: AccountFormValues, code: string): AccountFormValues {
  return { ...values, locationRegion: code, locationCity: '' };
}

export function optionsWithStoredValue(options: string[], stored: string): string[] {
  if (!stored || options.includes(stored)) return options;
  return [...options, stored];
}
