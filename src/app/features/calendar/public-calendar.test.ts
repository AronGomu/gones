import { ParamMap } from '@angular/router';
import { describe, expect, it } from 'vitest';
import {
  PAGE_SIZE,
  PublicEventView,
  addCalendarRegisterIntent,
  buildCalendarQueryParams,
  calendarRegisterIntent,
  removeCalendarRegisterIntent,
  calendarPageCount,
  clampCalendarPage,
  groupEventsByVenueDate,
  isPastCalendarDay,
  paginateEvents,
  readCalendarQuery,
  sortEventsForList,
  eventDatePresentation,
  eventsByDate,
  venueMapsUrl
} from './public-calendar';

function make(count: number): PublicEventView[] {
  return Array.from({ length: count }, (_, index) => ({
    ...event,
    id: `item-${String(index).padStart(3, '0')}`,
    venueStartDate: '2026-08-01',
    title: `Event ${String(index).padStart(3, '0')}`
  }));
}

const event: PublicEventView = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Lyon Legacy',
  displayTitle: 'Legacy — Lyon Legacy',
  slug: 'lyon-legacy',
  summary: 'Legacy event',
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris',
  venueStartDate: '2026-08-01',
  venueStartTime: '23:30:00',
  venueEndDate: '2026-08-02',
  venueEndTime: '01:30:00',
  startsAtUtc: '2026-08-01T21:30:00Z',
  endsAtUtc: '2026-08-01T23:30:00Z',
  capacity: 32,
  status: 'Published',
  organization: { id: '22222222-2222-2222-2222-222222222222', name: 'Gones', description: undefined, website: undefined, contactEmail: undefined },
  formats: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]
};

function params(values: Record<string, string>): ParamMap {
  return {
    keys: Object.keys(values),
    has: name => Object.prototype.hasOwnProperty.call(values, name),
    get: name => values[name] ?? null,
    getAll: name => values[name] ? [values[name]] : []
  };
}

describe('public Calendar helpers', () => {
  it('groups events by venue-local date, not viewer-local date', () => {
    const groups = groupEventsByVenueDate([
      event,
      { ...event, id: 'other', slug: 'other', venueStartDate: '2026-08-02', startsAtUtc: '2026-08-02T00:30:00Z' }
    ]);

    expect(groups.map(group => [group.date, group.items.map(item => item.slug)])).toEqual([
      ['2026-08-01', ['lyon-legacy']],
      ['2026-08-02', ['other']]
    ]);
  });

  it('shows viewer-local secondary date only when wall date or time differs', () => {
    const different = eventDatePresentation(event, 'en-US', 'Asia/Tokyo');
    const same = eventDatePresentation(event, 'en-US', 'Europe/Paris');

    expect(different.primary).toContain('Europe/Paris');
    expect(different.secondary).toContain('Aug 2');
    expect(different.secondary).toContain('Asia/Tokyo');
    expect(same.secondary).toBeUndefined();
  });

  it('reads the reduced query', () => {
    expect(readCalendarQuery(params({
      month: '2026-09', view: 'list', q: 'lyon', past: 'true'
    }), 'calendar', new Date('2026-03-01T12:00:00Z'))).toEqual({
      month: '2026-09', view: 'list', q: 'lyon', past: true, page: 1
    });
  });

  it('drops removed parameters', () => {
    const result = readCalendarQuery(params({
      month: '2026-08', status: 'Published', city: 'Lyon'
    }), 'calendar');
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('city');
  });

  it('a missing page parameter reads as one', () => {
    expect(readCalendarQuery(params({ month: '2026-08', view: 'list' }), 'list').page).toBe(1);
  });

  it('a page parameter is parsed', () => {
    expect(readCalendarQuery(params({ month: '2026-08', view: 'list', page: '3' }), 'list').page).toBe(3);
  });

  it('a junk page parameter reads as one', () => {
    expect(readCalendarQuery(params({ month: '2026-08', view: 'list', page: 'abc' }), 'list').page).toBe(1);
    expect(readCalendarQuery(params({ month: '2026-08', view: 'list', page: '0' }), 'list').page).toBe(1);
    expect(readCalendarQuery(params({ month: '2026-08', view: 'list', page: '-2' }), 'list').page).toBe(1);
  });

  it('uses local view preference only when URL omits view', () => {
    expect(readCalendarQuery(params({}), 'list', new Date('2026-03-01T12:00:00Z')).view).toBe('list');
    expect(readCalendarQuery(params({ view: 'calendar' }), 'list', new Date('2026-03-01T12:00:00Z')).view).toBe('calendar');
  });

  it('builds only the reduced parameters', () => {
    expect(buildCalendarQueryParams({ month: '2026-09', view: 'calendar', q: '', past: false, page: 1 }))
      .toEqual({ month: '2026-09', view: 'calendar' });
  });

  it('keeps q when set', () => {
    expect(buildCalendarQueryParams({ month: '2026-09', view: 'calendar', q: 'lyon\\,legacy', past: false, page: 1 }))
      .toEqual({ month: '2026-09', view: 'calendar', q: 'lyon\\,legacy' });
  });

  it('page one is not written to the url', () => {
    expect(buildCalendarQueryParams({ month: '2026-09', view: 'calendar', q: '', past: false, page: 1 }))
      .not.toHaveProperty('page');
  });

  it('a later page is written to the url', () => {
    expect(buildCalendarQueryParams({ month: '2026-09', view: 'calendar', q: '', past: false, page: 4 })['page'])
      .toBe('4');
  });

});

describe('calendar registration intent', () => {
  it('adds an encoded slug while preserving safe Calendar query and hash', () => {
    expect(addCalendarRegisterIntent('/calendar?month=2026-08&view=list#events', 'lyon legacy'))
      .toBe('/calendar?month=2026-08&view=list&register=lyon+legacy#events');
  });

  it('parses a register slug only from a safe Calendar URL', () => {
    expect(calendarRegisterIntent('/calendar?view=list&register=lyon-legacy')).toBe('lyon-legacy');
    expect(calendarRegisterIntent('/events/x?register=lyon-legacy')).toBeNull();
    expect(calendarRegisterIntent('https://evil.test/calendar?register=lyon-legacy')).toBeNull();
  });

  it('removes only the transient register parameter', () => {
    expect(removeCalendarRegisterIntent('/calendar?month=2026-08&register=lyon-legacy&q=legacy#events'))
      .toBe('/calendar?month=2026-08&q=legacy#events');
  });

  it('falls back to Calendar for unsafe input before adding intent', () => {
    expect(addCalendarRegisterIntent('//evil.test/steal', 'lyon-legacy')).toBe('/calendar?register=lyon-legacy');
  });
});

describe('calendar list pagination', () => {
  it('an empty catalogue is still one page', () => {
    expect(calendarPageCount(0)).toBe(1);
  });

  it('exactly twenty is one page', () => {
    expect(calendarPageCount(20)).toBe(1);
  });

  it('twenty-one is two pages', () => {
    expect(calendarPageCount(21)).toBe(2);
  });

  it('forty is two pages', () => {
    expect(calendarPageCount(40)).toBe(2);
  });

  it('page zero clamps up', () => {
    expect(clampCalendarPage(0, 45)).toBe(1);
  });

  it('a page past the end clamps down', () => {
    expect(clampCalendarPage(99, 45)).toBe(3);
  });

  it('a fractional page truncates', () => {
    expect(clampCalendarPage(2.7, 45)).toBe(2);
  });

  it('NaN falls back to page one', () => {
    expect(clampCalendarPage(Number.NaN, 45)).toBe(1);
  });

  it('the first page holds the first twenty', () => {
    const page = paginateEvents(make(45), 1);
    expect(page).toHaveLength(20);
    expect(page[0].id).toBe('item-000');
  });

  it('the last page holds the remainder', () => {
    const page = paginateEvents(make(45), 3);
    expect(page).toHaveLength(5);
    expect(page[0].id).toBe('item-040');
  });

  it('an out-of-range page returns the last one', () => {
    expect(paginateEvents(make(45), 9)).toEqual(paginateEvents(make(45), 3));
  });

  it('PAGE_SIZE is twenty', () => {
    expect(PAGE_SIZE).toBe(20);
  });

  it('sorting is stable across equal dates and times', () => {
    const itemB: PublicEventView = { ...event, id: 'b', title: 'B' };
    const itemA: PublicEventView = { ...event, id: 'a', title: 'A' };
    const sorted = sortEventsForList([itemB, itemA]);
    expect(sorted.map(item => item.title)).toEqual(['A', 'B']);
  });

  it('the venue date is compared before anything else', () => {
    const later: PublicEventView = { ...event, id: 'a', title: 'A', venueStartDate: '2026-08-02' };
    const earlier: PublicEventView = { ...event, id: 'b', title: 'B', venueStartDate: '2026-08-01' };
    expect(sortEventsForList([later, earlier]).map(item => item.id)).toEqual(['b', 'a']);
  });

  // Each comparator below the first is only reached when every comparator above it ties, so each one
  // needs a pair that ties on all of them. Without such a pair, deleting the comparator changes
  // nothing observable and the order silently becomes whatever the input order happened to be.
  it('an equal date falls through to the venue start time', () => {
    const late: PublicEventView = { ...event, id: 'a', title: 'Same', venueStartTime: '18:00:00' };
    const early: PublicEventView = { ...event, id: 'b', title: 'Same', venueStartTime: '09:00:00' };
    expect(sortEventsForList([late, early]).map(item => item.id)).toEqual(['b', 'a']);
  });

  it('an equal date and time falls through to the title', () => {
    const second: PublicEventView = { ...event, id: 'a', title: 'Zulu' };
    const first: PublicEventView = { ...event, id: 'b', title: 'Alpha' };
    expect(sortEventsForList([second, first]).map(item => item.id)).toEqual(['b', 'a']);
  });

  it('an equal date, time and title falls through to the id', () => {
    const second: PublicEventView = { ...event, id: 'b', title: 'Same' };
    const first: PublicEventView = { ...event, id: 'a', title: 'Same' };
    expect(sortEventsForList([second, first]).map(item => item.id)).toEqual(['a', 'b']);
  });
});

describe('eventsByDate', () => {
  it('keys on the venue start date', () => {
    const map = eventsByDate([
      { ...event, id: 'a', venueStartDate: '2026-03-01' },
      { ...event, id: 'b', venueStartDate: '2026-03-01' },
      { ...event, id: 'c', venueStartDate: '2026-03-04' }
    ]);

    expect(map.size).toBe(2);
    expect(map.get('2026-03-01')).toHaveLength(2);
    expect(map.get('2026-03-04')).toHaveLength(1);
  });

  it('sorts a day by start time then title', () => {
    const map = eventsByDate([
      { ...event, id: 'b', venueStartDate: '2026-03-01', venueStartTime: '14:00:00', title: 'B' },
      { ...event, id: 'z', venueStartDate: '2026-03-01', venueStartTime: '09:30:00', title: 'Z' },
      { ...event, id: 'a', venueStartDate: '2026-03-01', venueStartTime: '09:30:00', title: 'A' }
    ]);

    expect(map.get('2026-03-01')?.map(item => item.title)).toEqual(['A', 'Z', 'B']);
  });

  it('returns no entry for a day with nothing', () => {
    const map = eventsByDate([{ ...event, id: 'a', venueStartDate: '2026-03-01' }]);

    expect(map.has('2026-03-02')).toBe(false);
  });
});

describe('isPastCalendarDay', () => {
  it('marks yesterday as past', () => {
    expect(isPastCalendarDay('2026-08-11', '2026-08-12')).toBe(true);
  });

  it('does not mark today as past', () => {
    expect(isPastCalendarDay('2026-08-12', '2026-08-12')).toBe(false);
  });

  it('does not mark tomorrow as past', () => {
    expect(isPastCalendarDay('2026-08-13', '2026-08-12')).toBe(false);
  });

  it('compares across month and year boundaries', () => {
    expect(isPastCalendarDay('2025-12-31', '2026-01-01')).toBe(true);
  });
});

describe('venueMapsUrl', () => {
  it('encodes the full address', () => {
    expect(venueMapsUrl({ streetAddress: '1 rue de la Ré', postalCode: '69001', city: 'Lyon', country: 'France' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=1%20rue%20de%20la%20R%C3%A9%2C%2069001%2C%20Lyon%2C%20France');
  });

  it('skips missing parts', () => {
    expect(venueMapsUrl({ city: 'Lyon' })).toBe('https://www.google.com/maps/search/?api=1&query=Lyon');
  });

  it('returns null for an empty venue', () => {
    expect(venueMapsUrl({})).toBeNull();
  });

  // The venue comes from the API, so the query has to stay a percent-encoded payload of one fixed
  // host: no separator, quote or space may survive as a live character in the URL.
  it('percent-encodes separators, quotes and spaces without moving the host', () => {
    const url = venueMapsUrl({ streetAddress: '1 "Bar" & Grill', city: 'Lyon' });

    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=1%20%22Bar%22%20%26%20Grill%2C%20Lyon');
    expect(url!.slice(url!.indexOf('&query='))).not.toMatch(/[ "]|&(?!query=)/);
  });
});
