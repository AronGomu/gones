import { describe, expect, it } from 'vitest';
import { PublicEventView } from '../events/public-event-list';
import { selectUpcomingEvents } from './about-upcoming-events';

function event(id: string, startsAtUtc: unknown, venueStartDate: string, venueStartTime: string, title = id, organizationName = 'Gones Lyon'): PublicEventView {
  return {
    id,
    title,
    displayTitle: title,
    slug: id,
    summary: undefined,
    venue: { streetAddress: '', postalCode: '', city: 'Lyon', country: 'France' },
    timeZoneId: 'Europe/Paris',
    venueStartDate,
    venueStartTime,
    venueEndDate: venueStartDate,
    venueEndTime: venueStartTime,
    startsAtUtc,
    endsAtUtc: startsAtUtc,
    capacity: undefined,
    status: 'published',
    organization: organizationName ? { id: `org-${organizationName}`, name: organizationName } : undefined,
    formats: []
  } as unknown as PublicEventView;
}

describe('selectUpcomingEvents', () => {
  const now = new Date('2026-08-30T12:00:00Z');

  it('keeps finite strictly-future events, applies stable list order, and caps output at three', () => {
    const past = event('past', '2026-08-30T11:59:59Z', '2026-08-31', '09:00');
    const nowEvent = event('now', now.toISOString(), '2026-08-31', '09:01');
    const invalid = event('invalid', 'not-a-date', '2026-08-31', '09:02');
    const futureLate = event('late', '2026-09-03T10:00:00Z', '2026-09-03', '12:00');
    const futureEarly = event('early', '2026-09-01T10:00:00Z', '2026-09-01', '12:00');
    const futureMiddle = event('middle', '2026-09-02T10:00:00Z', '2026-09-02', '12:00');
    const futureExtra = event('extra', '2026-09-04T10:00:00Z', '2026-09-04', '12:00');

    expect(selectUpcomingEvents([
      futureLate, invalid, past, futureExtra, nowEvent, futureMiddle, futureEarly
    ], now)).toEqual([futureEarly, futureMiddle, futureLate]);
  });

  it('keeps only events owned by the MTGones organization', () => {
    const mtgones = event('mtgones', '2026-09-01T10:00:00Z', '2026-09-01', '12:00');
    const other = event('other', '2026-09-01T09:00:00Z', '2026-09-01', '11:00', 'Other', 'Ligue AURA');
    const unowned = event('unowned', '2026-09-01T08:00:00Z', '2026-09-01', '10:00', 'Unowned', '');

    expect(selectUpcomingEvents([other, unowned, mtgones], now)).toEqual([mtgones]);
  });

  it('does not mutate frozen input or its order', () => {
    const first = event('first', '2026-09-01T10:00:00Z', '2026-09-01', '12:00');
    const second = event('second', '2026-09-02T10:00:00Z', '2026-09-02', '12:00');
    const items = Object.freeze([second, first]) as readonly PublicEventView[];

    expect(selectUpcomingEvents(items, now)).toEqual([first, second]);
    expect(items).toEqual([second, first]);
  });
});
