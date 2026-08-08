import { PatchUserProfileRequest, UserProfileResponse } from '../../api/generated/gones-api';

export interface AccountFormValues {
  username: string;
  firstName: string;
  lastName: string;
  locationCountry: string;
  locationRegion: string;
  locationCity: string;
  birthDate: string;
  preferredLanguage: string;
  isFirstNamePublic: boolean;
  isLastNamePublic: boolean;
  isLocationPublic: boolean;
  isBirthDatePublic: boolean;
  isPreferredLanguagePublic: boolean;
}

function isoDate(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).slice(0, 10);
}

export function accountFormValues(profile: UserProfileResponse | null): AccountFormValues {
  return {
    username: profile?.username ?? '',
    firstName: profile?.firstName ?? '',
    lastName: profile?.lastName ?? '',
    locationCountry: profile?.locationCountry ?? '',
    locationRegion: profile?.locationRegion ?? '',
    locationCity: profile?.locationCity ?? '',
    birthDate: isoDate(profile?.birthDate),
    preferredLanguage: profile?.preferredLanguage ?? 'fr',
    isFirstNamePublic: profile?.isFirstNamePublic ?? false,
    isLastNamePublic: profile?.isLastNamePublic ?? false,
    isLocationPublic: profile?.isLocationPublic ?? false,
    isBirthDatePublic: profile?.isBirthDatePublic ?? false,
    isPreferredLanguagePublic: profile?.isPreferredLanguagePublic ?? false
  };
}

const ACCOUNT_FORM_KEYS: (keyof AccountFormValues)[] = [
  'username', 'firstName', 'lastName', 'locationCountry', 'locationRegion', 'locationCity',
  'birthDate', 'preferredLanguage', 'isFirstNamePublic', 'isLastNamePublic', 'isLocationPublic',
  'isBirthDatePublic', 'isPreferredLanguagePublic'
];

export function accountFormIsDirty(baseline: AccountFormValues, current: AccountFormValues): boolean {
  return ACCOUNT_FORM_KEYS.some(key => baseline[key] !== current[key]);
}

export function accountFormPayload(values: AccountFormValues, currentPassword: string): PatchUserProfileRequest {
  return {
    username: values.username,
    firstName: values.firstName,
    lastName: values.lastName,
    locationCountry: values.locationCountry || undefined,
    locationRegion: values.locationRegion || undefined,
    locationCity: values.locationCity || undefined,
    birthDate: (values.birthDate || undefined) as PatchUserProfileRequest['birthDate'],
    preferredLanguage: values.preferredLanguage,
    isFirstNamePublic: values.isFirstNamePublic,
    isLastNamePublic: values.isLastNamePublic,
    isLocationPublic: values.isLocationPublic,
    isBirthDatePublic: values.isBirthDatePublic,
    isPreferredLanguagePublic: values.isPreferredLanguagePublic,
    currentPassword: currentPassword || undefined
  };
}
