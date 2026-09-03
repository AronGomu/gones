import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { EventManagementResponse } from '../../api/generated/gones-api';
import {
  canCancelEvent,
  canEditEvent,
  changedEventFields,
  eventUpdatePayload,
  majorEventChanges,
  managementToDetail,
  managementToDraft
} from './event-management';

const event = {
  id: 'event', organizationId: 'org', organizationName: 'Club', title: 'Legacy Open', slug: 'legacy-open',
  summary: 'Summary', bodyMarkdown: '**Body**',
  location: {
    streetAddress: '1 Old Street', postalCode: '69001', city: 'Lyon', country: 'France',
    region: 'Auvergne-Rhône-Alpes', locationToken: 'editor-location-token'
  },
  streetAddress: '1 Old Street', postalCode: '69001', city: 'Lyon', country: 'France', region: 'Auvergne-Rhône-Alpes',
  eventType: 'weekly', timeZoneId: 'Europe/Paris', startsAtLocal: '2027-08-01T10:00',
  venueStartDate: '2027-08-01', venueStartTime: '10:00:00', venueEndDate: '2027-08-01', venueEndTime: '23:59:59',
  startsAtUtc: '2027-08-01T08:00:00Z', endsAtUtc: '2027-08-01T21:59:59Z', capacity: 32,
  status: 'Published', deletedAt: undefined, deletedReason: undefined, formatIds: ['legacy'], version: 3, eTag: '"3"',
  displayTitle: 'Legacy — Legacy Open', liveTournamentUrl: '/live/123', archiveTournamentUrl: 'https://example.test/archive/123',
  images: [{
    id: 'image-1', altText: 'Poster', variants: [
      { width: 320, height: 180, url: '/api/event-images/image-1/variants/320' },
      { width: 960, height: 540, url: '/api/event-images/image-1/variants/960' }
    ]
  }]
} as unknown as EventManagementResponse;

describe('Event management state', () => {
  it('hydrates canonical nested location, Markdown, and ordered images into edit draft', () => {
    expect(managementToDraft(event)).toEqual({
      organizationId: 'org', title: 'Legacy Open', summary: 'Summary', bodyMarkdown: '**Body**', streetAddress: '1 Old Street',
      postalCode: '69001', city: 'Lyon', country: 'France', region: 'Auvergne-Rhône-Alpes',
      eventType: 'weekly', timeZoneId: 'Europe/Paris', startDate: '2027-08-01', startTime: '10:00',
      capacity: 32, formatId: 'legacy', images: [{ imageId: 'image-1', altText: 'Poster' }]
    });
  });

  it('requires legacy rows to choose Event Type and treats that choice as major', () => {
    const legacy = { ...event, eventType: undefined };
    const draft = managementToDraft(legacy);
    expect(draft.eventType).toBe('');
    expect(majorEventChanges(legacy, { ...draft, eventType: 'weekly' })).toContain('Event Type');
  });

  it('classifies location, start, type, capacity, and format as major but Markdown and images as minor', () => {
    const draft = { ...managementToDraft(event), streetAddress: '2 New Street', startDate: '2027-08-02', startTime: '11:00' };
    expect(majorEventChanges(event, draft)).toEqual(['start date/time', 'street address']);
    expect(majorEventChanges(event, { ...managementToDraft(event), capacity: 64, formatId: 'modern' })).toEqual(['capacity', 'formats']);
    expect(majorEventChanges(event, { ...managementToDraft(event), bodyMarkdown: 'Changed', images: [] })).toEqual([]);
  });

  it('builds exact nested update payload without hidden URLs or end control', () => {
    const payload = eventUpdatePayload({
      ...managementToDraft(event),
      bodyMarkdown: '  line  \nnext  ',
      images: [{ imageId: 'image-1', altText: '  Poster alt  ' }]
    });
    expect(payload).toEqual({
      title: 'Legacy Open', summary: 'Summary', bodyMarkdown: '  line  \nnext  ',
      location: {
        streetAddress: '1 Old Street', postalCode: '69001', city: 'Lyon', country: 'France',
        region: 'Auvergne-Rhône-Alpes', timeZoneId: 'Europe/Paris'
      },
      eventType: 'weekly', startsAtLocal: '2027-08-01T10:00', capacity: 32, formatIds: ['legacy'],
      images: [{ imageId: 'image-1', altText: 'Poster alt' }]
    });
    expect(payload).not.toHaveProperty('liveTournamentUrl');
    expect(payload).not.toHaveProperty('archiveTournamentUrl');
    expect(payload).not.toHaveProperty('endsAtLocal');
  });

  it('detects canonical image membership, alt, and order changes for stale reload', () => {
    const second = {
      id: 'image-2', altText: undefined,
      variants: [{ width: 320, height: 180, url: '/api/event-images/image-2/variants/320' }]
    };
    expect(changedEventFields(event, { ...event, images: [second, ...event.images] })).toContain('images');
    expect(changedEventFields(event, { ...event, images: [{ ...event.images[0]!, altText: 'Changed' }] })).toContain('images');
    expect(changedEventFields(event, { ...event, bodyMarkdown: 'Changed' })).toContain('description');
  });

  it('maps management response into current public-detail preview including images', () => {
    expect(managementToDetail(event, [{ id: 'legacy', name: 'Legacy', slug: 'legacy', sortOrder: 0 }])).toMatchObject({
      displayTitle: 'Legacy — Legacy Open', liveTournamentUrl: '/live/123', archiveTournamentUrl: 'https://example.test/archive/123',
      images: [{ id: 'image-1', altText: 'Poster' }]
    });
  });

  it('hides edit/delete after cutoff while cancel remains available until cancellation', () => {
    expect(canEditEvent(event, new Date('2027-07-31T12:00:00Z'))).toBe(true);
    expect(canEditEvent(event, new Date('2027-08-01T08:00:00Z'))).toBe(false);
    expect(canCancelEvent(event)).toBe(true);
    expect(canCancelEvent({ ...event, status: 'Cancelled' })).toBe(false);
  });
});
