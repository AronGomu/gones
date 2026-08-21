import { EventRegistrationHistoryResponse } from '../../api/generated/gones-api';

/**
 * The private cache family My Registrations pages under (ADR 0039).
 *
 * The `?` is load-bearing: `ServerReadCacheService.invalidateFamily` only matches a key that is the
 * family itself or begins `<family>?`, so a page key that separated its page with anything else
 * would make the invalidation a silent no-op and leave a new or cancelled registration hidden for
 * the full 24 hours.
 */
export const REGISTRATIONS_CACHE_FAMILY = 'registrations';

export function registrationsCacheKey(page: number): string {
  return `${REGISTRATIONS_CACHE_FAMILY}?page=${page}`;
}

export interface RegistrationAttemptGroups {
  upcoming: EventRegistrationHistoryResponse[];
  history: EventRegistrationHistoryResponse[];
}

export function partitionRegistrationAttempts(
  attempts: EventRegistrationHistoryResponse[],
  now = new Date()
): RegistrationAttemptGroups {
  const upcoming: EventRegistrationHistoryResponse[] = [];
  const history: EventRegistrationHistoryResponse[] = [];
  for (const attempt of attempts) {
    (attempt.isCurrent && new Date(String(attempt.startsAtUtc)).getTime() > now.getTime() ? upcoming : history).push(attempt);
  }
  return { upcoming, history };
}

export function registrationVenueTime(attempt: EventRegistrationHistoryResponse, language: 'en' | 'fr'): string {
  const locale = language === 'fr' ? 'fr-FR' : 'en-US';
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: attempt.timeZoneId
  }).format(new Date(String(attempt.startsAtUtc)));
  return `${formatted} (${attempt.timeZoneId})`;
}
