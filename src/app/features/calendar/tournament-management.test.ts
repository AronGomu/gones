import { describe, expect, it } from 'vitest';
import { TournamentManagementResponse } from '../../api/generated/gones-api';
import { canCancelTournament, canEditTournament, majorTournamentChanges, managementToDraft } from './tournament-management';

const tournament: TournamentManagementResponse = {
  id: 'tournament', organizationId: 'org', organizationName: 'Club', title: 'Legacy Open', slug: 'legacy-open',
  summary: 'Summary', bodyHtml: '<p>Body</p>', streetAddress: '1 Old Street', postalCode: '69001', city: 'Lyon', country: 'France',
  timeZoneId: 'Europe/Paris', venueStartDate: '2027-08-01', venueStartTime: '10:00:00', venueEndDate: '2027-08-01',
  venueEndTime: '18:00:00', startsAtUtc: '2027-08-01T08:00:00Z' as never, endsAtUtc: '2027-08-01T16:00:00Z' as never, capacity: 32,
  status: 'Published', deletedAt: undefined, deletedReason: undefined, formatIds: ['legacy'], version: 3, eTag: '"3"'
};

describe('Tournament management state', () => {
  it('hydrates edit draft from canonical management DTO', () => {
    expect(managementToDraft(tournament)).toEqual({
      organizationId: 'org', title: 'Legacy Open', summary: 'Summary', bodyHtml: '<p>Body</p>', streetAddress: '1 Old Street',
      postalCode: '69001', city: 'Lyon', country: 'France', timeZoneId: 'Europe/Paris', startsAtLocal: '2027-08-01T10:00',
      endsAtLocal: '2027-08-01T18:00', capacity: 32, formatIds: ['legacy']
    });
  });

  it('classifies date and address edits as explicit major changes', () => {
    const draft = { ...managementToDraft(tournament), streetAddress: '2 New Street', startsAtLocal: '2027-08-02T11:00' };
    expect(majorTournamentChanges(tournament, draft)).toEqual(['start date/time', 'street address']);
    expect(majorTournamentChanges(tournament, { ...managementToDraft(tournament), capacity: 64, formatIds: ['legacy', 'modern'] })).toEqual(['capacity', 'formats']);
    expect(majorTournamentChanges(tournament, { ...managementToDraft(tournament), title: 'Renamed' })).toEqual([]);
  });

  it('hides edit/delete after cutoff while cancel remains available until cancellation', () => {
    expect(canEditTournament(tournament, new Date('2027-07-31T12:00:00Z'))).toBe(true);
    expect(canEditTournament(tournament, new Date('2027-08-01T08:00:00Z'))).toBe(false);
    expect(canCancelTournament(tournament)).toBe(true);
    expect(canCancelTournament({ ...tournament, status: 'Cancelled' })).toBe(false);
  });
});
