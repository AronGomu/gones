import { TournamentRegistrationHistoryResponse } from '../../api/generated/gones-api';

export interface RegistrationAttemptGroups {
  upcoming: TournamentRegistrationHistoryResponse[];
  history: TournamentRegistrationHistoryResponse[];
}

export function partitionRegistrationAttempts(
  attempts: TournamentRegistrationHistoryResponse[],
  now = new Date()
): RegistrationAttemptGroups {
  const upcoming: TournamentRegistrationHistoryResponse[] = [];
  const history: TournamentRegistrationHistoryResponse[] = [];
  for (const attempt of attempts) {
    (attempt.isCurrent && new Date(String(attempt.startsAtUtc)).getTime() > now.getTime() ? upcoming : history).push(attempt);
  }
  return { upcoming, history };
}

export function registrationVenueTime(attempt: TournamentRegistrationHistoryResponse, language: 'en' | 'fr'): string {
  const locale = language === 'fr' ? 'fr-FR' : 'en-US';
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: attempt.timeZoneId
  }).format(new Date(String(attempt.startsAtUtc)));
  return `${formatted} (${attempt.timeZoneId})`;
}
