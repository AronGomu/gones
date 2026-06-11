import { describe, expect, it } from 'vitest';
import { buildCalendarIcs, calendarIcsFilename } from './calendar-ics';
import { createCalendarEvent } from './models';

describe('calendar ICS export', () => {
  it('builds a VCALENDAR with escaped event fields and date-time data', () => {
    const event = createCalendarEvent({
      id: 'event-1',
      title: 'Friday, Modern; Night',
      eventDate: '2026-07-10',
      startTime: '19:30',
      endTime: '22:00',
      location: 'Local Store',
      description: 'Bring decklists\nPay at desk',
      externalLink: 'https://example.com/register'
    });

    const ics = buildCalendarIcs([event], { now: new Date('2026-06-11T12:00:00Z') });

    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('BEGIN:VEVENT\r\n');
    expect(ics).toContain('UID:event-1@gones\r\n');
    expect(ics).toContain('DTSTAMP:20260611T120000Z\r\n');
    expect(ics).toContain('DTSTART:20260710T193000\r\n');
    expect(ics).toContain('DTEND:20260710T220000\r\n');
    expect(ics).toContain('SUMMARY:Friday\\, Modern\\; Night\r\n');
    expect(ics).toContain('DESCRIPTION:Bring decklists\\nPay at desk\\nhttps://example.com/register\r\n');
    expect(ics).toContain('URL:https://example.com/register\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('uses all-day dates when no start time exists', () => {
    const event = createCalendarEvent({ id: 'event-2', title: 'All Day', eventDate: '2026-07-11', startTime: '' });
    expect(buildCalendarIcs([event])).toContain('DTSTART;VALUE=DATE:20260711');
  });

  it('builds stable ICS filenames', () => {
    expect(calendarIcsFilename(createCalendarEvent({ title: 'Modern Night!', eventDate: '2026-07-10' }))).toBe('2026-07-10-modern-night.ics');
  });
});
