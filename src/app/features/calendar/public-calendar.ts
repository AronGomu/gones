import { ParamMap } from '@angular/router';
import { PublicTournamentSummaryResponse } from '../../api/generated/gones-api';

export type CalendarView = 'calendar' | 'list';

export interface CalendarQuery {
  month: string;
  view: CalendarView;
  q: string;
  past: boolean;
}

export interface PublicTournamentView {
  id: string;
  title: string;
  slug: string;
  summary: string | undefined;
  venue: PublicTournamentSummaryResponse['venue'];
  timeZoneId: string;
  venueStartDate: string;
  venueStartTime: string;
  venueEndDate: string;
  venueEndTime: string;
  startsAtUtc: unknown;
  endsAtUtc: unknown;
  capacity: number | undefined;
  status: string;
  organization: PublicTournamentSummaryResponse['organization'];
  formats: PublicTournamentSummaryResponse['formats'];
}

export interface VenueDateGroup {
  date: string;
  items: PublicTournamentView[];
}

export interface TournamentDatePresentation {
  primary: string;
  secondary?: string;
}

export function readCalendarQuery(params: ParamMap, preferredView: CalendarView, now = new Date()): CalendarQuery {
  const rawView = params.get('view');
  return {
    month: validMonth(params.get('month')) ?? monthValue(now),
    view: rawView === 'list' || rawView === 'calendar' ? rawView : preferredView,
    past: params.get('past') === 'true',
    q: clean(params.get('q'))
  };
}

export function buildCalendarQueryParams(query: CalendarQuery): Record<string, string> {
  const result: Record<string, string> = { month: query.month };
  if (query.q) result['q'] = query.q;
  if (query.past) result['past'] = 'true';
  result['view'] = query.view;
  return result;
}

export function groupTournamentsByVenueDate(items: PublicTournamentView[]): VenueDateGroup[] {
  const grouped = new Map<string, PublicTournamentView[]>();
  for (const item of items) {
    const current = grouped.get(item.venueStartDate) ?? [];
    current.push(item);
    grouped.set(item.venueStartDate, current);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dateItems]) => ({
      date,
      items: dateItems.sort((left, right) => left.venueStartTime.localeCompare(right.venueStartTime) || left.title.localeCompare(right.title))
    }));
}

export function tournamentDatePresentation(
  tournament: Omit<PublicTournamentView, 'id'>,
  locale: string,
  viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): TournamentDatePresentation {
  const instant = new Date(String(tournament.startsAtUtc));
  const venueDate = formatWallDate(tournament.venueStartDate, locale);
  const venueTime = formatWallTime(tournament.venueStartTime, locale);
  const venueShortZone = zoneName(instant, locale, tournament.timeZoneId);
  const primary = `${venueDate}, ${venueTime} (${venueShortZone}, ${tournament.timeZoneId})`;
  if (!viewerTimeZone || viewerTimeZone === tournament.timeZoneId || Number.isNaN(instant.getTime())) return { primary };

  const viewerParts = dateTimeParts(instant, locale, viewerTimeZone);
  const venueWall = `${tournament.venueStartDate}T${tournament.venueStartTime.slice(0, 5)}`;
  if (viewerParts.wall === venueWall) return { primary };
  return { primary, secondary: `${viewerParts.label} (${viewerParts.zone}, ${viewerTimeZone})` };
}

export function statusPresentation(status: string): { label: string; className: string } {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'cancelled') return { label: 'Cancelled', className: 'cancelled' };
  if (normalized === 'completed') return { label: 'Completed', className: 'completed' };
  if (normalized === 'ongoing') return { label: 'Ongoing', className: 'ongoing' };
  return { label: status || 'Published', className: normalized || 'published' };
}

export function shiftMonth(month: string, amount: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthValue(new Date(year, monthNumber - 1 + amount, 1));
}

function validMonth(value: string | null): string | undefined {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}

function monthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function clean(value: string | null): string {
  return value?.trim() ?? '';
}

function formatWallDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function formatWallTime(value: string, locale: string): string {
  const [hour, minute] = value.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

function zoneName(instant: Date, locale: string, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) return timeZone;
  return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(instant).find(part => part.type === 'timeZoneName')?.value ?? timeZone;
}

function dateTimeParts(instant: Date, locale: string, timeZone: string): { wall: string; label: string; zone: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  const wall = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  const label = new Intl.DateTimeFormat(locale, {
    timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(instant);
  return { wall, label, zone: zoneName(instant, locale, timeZone) };
}
