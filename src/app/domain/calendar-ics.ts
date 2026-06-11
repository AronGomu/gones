import { CalendarEventDocument } from './models';

export function buildCalendarIcs(events: CalendarEventDocument[], { calendarName = 'Gones Calendar', now = new Date() } = {}): string {
  const sorted = [...events].sort((left, right) => left.eventDate.localeCompare(right.eventDate) || left.startTime.localeCompare(right.startTime) || left.title.localeCompare(right.title));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gones//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    ...sorted.flatMap((event) => buildEventLines(event, now)),
    'END:VCALENDAR'
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export function calendarIcsFilename(eventOrName: CalendarEventDocument | string, now = new Date()): string {
  const name = typeof eventOrName === 'string' ? eventOrName : eventOrName.title;
  const fallbackDate = typeof eventOrName === 'string' ? now.toISOString().slice(0, 10) : eventOrName.eventDate;
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'calendar';
  return `${fallbackDate}-${slug}.ics`;
}

function buildEventLines(event: CalendarEventDocument, now: Date): string[] {
  const description = event.externalLink ? [event.description, event.externalLink].filter(Boolean).join('\n') : event.description;
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.id)}@gones`,
    `DTSTAMP:${formatUtcDateTime(now)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    ...dateLines(event),
    event.location ? `LOCATION:${escapeIcsText(event.location)}` : '',
    description ? `DESCRIPTION:${escapeIcsText(description)}` : '',
    event.externalLink ? `URL:${escapeIcsText(event.externalLink)}` : '',
    'END:VEVENT'
  ];
  return lines.filter(Boolean);
}

function dateLines(event: CalendarEventDocument): string[] {
  if (event.startTime) {
    return [`DTSTART:${formatLocalDateTime(event.eventDate, event.startTime)}`, `DTEND:${formatLocalDateTime(event.eventDate, event.endTime || event.startTime)}`];
  }
  return [`DTSTART;VALUE=DATE:${event.eventDate.replaceAll('-', '')}`];
}

function formatLocalDateTime(date: string, time: string): string {
  return `${date.replaceAll('-', '')}T${time.replace(':', '')}00`;
}

function formatUtcDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
