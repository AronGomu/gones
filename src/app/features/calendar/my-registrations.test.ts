import { describe, expect, it } from 'vitest';
import { Instant, TournamentRegistrationHistoryResponse } from '../../api/generated/gones-api';
import { translate } from '../../i18n/messages';
import { partitionRegistrationAttempts, registrationVenueTime } from './my-registrations';

const current: TournamentRegistrationHistoryResponse = {
  attemptId: 'current', tournamentId: 'tournament', tournamentSlug: 'future', tournamentTitle: 'Future', organizationName: 'Gones',
  startsAtUtc: '2035-03-04T09:00:00Z' as unknown as Instant, timeZoneId: 'Europe/Paris', status: 'Confirmed', isCurrent: true,
  registeredByUserId: 'user', registeredAt: '2030-01-01T00:00:00Z' as unknown as Instant, statusChangedByUserId: undefined, statusChangedAt: undefined
};

describe('My Registrations presentation', () => {
  it('puts only active future attempts in upcoming and preserves cancelled attempts in history', () => {
    const cancelled = { ...current, attemptId: 'cancelled', status: 'CancelledByUser', isCurrent: false };
    const groups = partitionRegistrationAttempts([cancelled, current], new Date('2030-01-01T00:00:00Z'));
    expect(groups.upcoming.map(item => item.attemptId)).toEqual(['current']);
    expect(groups.history.map(item => item.attemptId)).toEqual(['cancelled']);
  });

  it('renders event time in venue zone with explicit zone ID', () => {
    expect(registrationVenueTime(current, 'en')).toContain('Europe/Paris');
    expect(registrationVenueTime(current, 'en')).toContain('Mar');
  });

  it('ships registration status and offline copy in English and French', () => {
    expect(translate('en', 'registration.statusConfirmed')).toBe('Confirmed');
    expect(translate('fr', 'registration.statusConfirmed')).toBe('Confirmée');
    expect(translate('en', 'registration.offline')).toContain('Nothing was queued');
    expect(translate('fr', 'registration.offline')).toContain('Rien n’a été mis en file');
  });
});
