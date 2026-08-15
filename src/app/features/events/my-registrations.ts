import { EventRegistrationHistoryResponse } from '../../api/generated/gones-api';

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
