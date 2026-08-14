import { describe, expect, it } from 'vitest';
import { EventManagementResponse } from '../../api/generated/gones-api';
import { canCancelEvent, canEditEvent, majorEventChanges, managementToDraft } from './event-management';

const event: EventManagementResponse = {
  id: 'event', organizationId: 'org', organizationName: 'Club', title: 'Legacy Open', slug: 'legacy-open',
  summary: 'Summary', bodyHtml: '<p>Body</p>', streetAddress: '1 Old Street', postalCode: '69001', city: 'Lyon', country: 'France',
  timeZoneId: 'Europe/Paris', venueStartDate: '2027-08-01', venueStartTime: '10:00:00', venueEndDate: '2027-08-01',
  venueEndTime: '18:00:00', startsAtUtc: '2027-08-01T08:00:00Z' as never, endsAtUtc: '2027-08-01T16:00:00Z' as never, capacity: 32,
  status: 'Published', deletedAt: undefined, deletedReason: undefined, formatIds: ['legacy'], version: 3, eTag: '"3"',
  displayTitle: 'Legacy — Legacy Open', liveTournamentUrl: '/live/123', archiveTournamentUrl: 'https://example.test/archive/123'
};

describe('Event management state', () => {
  it('hydrates edit draft from canonical management DTO', () => {
    expect(managementToDraft(event)).toEqual({
      organizationId: 'org', title: 'Legacy Open', summary: 'Summary', bodyHtml: '<p>Body</p>', streetAddress: '1 Old Street',
      postalCode: '69001', city: 'Lyon', country: 'France', timeZoneId: 'Europe/Paris', startsAtLocal: '2027-08-01T10:00',
      endsAtLocal: '2027-08-01T18:00', capacity: 32, formatId: 'legacy', liveTournamentUrl: '/live/123',
      archiveTournamentUrl: 'https://example.test/archive/123'
    });
  });

  it('classifies date and address edits as explicit major changes', () => {
    const draft = { ...managementToDraft(event), streetAddress: '2 New Street', startsAtLocal: '2027-08-02T11:00' };
    expect(majorEventChanges(event, draft)).toEqual(['start date/time', 'street address']);
    expect(majorEventChanges(event, { ...managementToDraft(event), capacity: 64, formatId: 'modern' })).toEqual(['capacity', 'formats']);
    expect(majorEventChanges(event, { ...managementToDraft(event), title: 'Renamed' })).toEqual([]);
  });

  it('maps links into update and preview DTOs', async () => {
    const { eventUpdatePayload, managementToDetail } = await import('./event-management');
    expect(eventUpdatePayload({ ...managementToDraft(event), liveTournamentUrl: ' ', archiveTournamentUrl: ' /archive/123 ' })).toMatchObject({
      formatIds: ['legacy'], liveTournamentUrl: undefined, archiveTournamentUrl: '/archive/123'
    });
    expect(managementToDetail(event, [{ id: 'legacy', name: 'Legacy', slug: 'legacy', sortOrder: 0 }])).toMatchObject({
      displayTitle: 'Legacy — Legacy Open', liveTournamentUrl: '/live/123', archiveTournamentUrl: 'https://example.test/archive/123'
    });
  });

  it('hides edit/delete after cutoff while cancel remains available until cancellation', () => {
    expect(canEditEvent(event, new Date('2027-07-31T12:00:00Z'))).toBe(true);
    expect(canEditEvent(event, new Date('2027-08-01T08:00:00Z'))).toBe(false);
    expect(canCancelEvent(event)).toBe(true);
    expect(canCancelEvent({ ...event, status: 'Cancelled' })).toBe(false);
  });
});
