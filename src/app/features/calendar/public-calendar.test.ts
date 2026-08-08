import { ParamMap } from '@angular/router';
import { describe, expect, it } from 'vitest';
import {
  PublicTournamentView,
  buildCalendarQueryParams,
  groupTournamentsByVenueDate,
  readCalendarQuery,
  statusPresentation,
  tournamentDatePresentation
} from './public-calendar';

const tournament: PublicTournamentView = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Lyon Legacy',
  slug: 'lyon-legacy',
  summary: 'Legacy tournament',
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
  it('groups tournaments by venue-local date, not viewer-local date', () => {
    const groups = groupTournamentsByVenueDate([
      tournament,
      { ...tournament, id: 'other', slug: 'other', venueStartDate: '2026-08-02', startsAtUtc: '2026-08-02T00:30:00Z' }
    ]);

    expect(groups.map(group => [group.date, group.items.map(item => item.slug)])).toEqual([
      ['2026-08-01', ['lyon-legacy']],
      ['2026-08-02', ['other']]
    ]);
  });

  it('shows viewer-local secondary date only when wall date or time differs', () => {
    const different = tournamentDatePresentation(tournament, 'en-US', 'Asia/Tokyo');
    const same = tournamentDatePresentation(tournament, 'en-US', 'Europe/Paris');

    expect(different.primary).toContain('Europe/Paris');
    expect(different.secondary).toContain('Aug 2');
    expect(different.secondary).toContain('Asia/Tokyo');
    expect(same.secondary).toBeUndefined();
  });

  it('reads the reduced query', () => {
    expect(readCalendarQuery(params({
      month: '2026-09', view: 'list', q: 'lyon', past: 'true'
    }), 'calendar', new Date('2026-03-01T12:00:00Z'))).toEqual({
      month: '2026-09', view: 'list', q: 'lyon', past: true
    });
  });

  it('drops removed parameters', () => {
    const result = readCalendarQuery(params({
      month: '2026-08', status: 'Published', city: 'Lyon', page: '3'
    }), 'calendar');
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('city');
    expect(result).not.toHaveProperty('page');
  });

  it('uses local view preference only when URL omits view', () => {
    expect(readCalendarQuery(params({}), 'list', new Date('2026-03-01T12:00:00Z')).view).toBe('list');
    expect(readCalendarQuery(params({ view: 'calendar' }), 'list', new Date('2026-03-01T12:00:00Z')).view).toBe('calendar');
  });

  it('builds only the reduced parameters', () => {
    expect(buildCalendarQueryParams({ month: '2026-09', view: 'calendar', q: '', past: false }))
      .toEqual({ month: '2026-09', view: 'calendar' });
  });

  it('keeps q when set', () => {
    expect(buildCalendarQueryParams({ month: '2026-09', view: 'calendar', q: 'lyon\\,legacy', past: false }))
      .toEqual({ month: '2026-09', view: 'calendar', q: 'lyon\\,legacy' });
  });

  it('renders explicit cancelled badge and completed text', () => {
    expect(statusPresentation('Cancelled')).toEqual({ label: 'Cancelled', className: 'cancelled' });
    expect(statusPresentation('Completed')).toEqual({ label: 'Completed', className: 'completed' });
  });
});
