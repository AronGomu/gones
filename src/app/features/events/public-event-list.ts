import { ParamMap } from '@angular/router';
import { PublicEventSummaryResponse } from '../../api/generated/gones-api';
import { safeReturnUrl } from '../../auth/return-url';

export type CalendarView = 'calendar' | 'list';

export interface EventListQuery {
  month: string;
  view: CalendarView;
  q: string;
  past: boolean;
  page: number;
}

export const PAGE_SIZE = 20;

export interface PublicEventView {
  id: string;
  title: string;
  displayTitle: string;
  slug: string;
  summary: string | undefined;
  venue: PublicEventSummaryResponse['venue'];
  timeZoneId: string;
  venueStartDate: string;
  venueStartTime: string;
  venueEndDate: string;
  venueEndTime: string;
  startsAtUtc: unknown;
  endsAtUtc: unknown;
  capacity: number | undefined;
  status: string;
  organization: PublicEventSummaryResponse['organization'];
  formats: PublicEventSummaryResponse['formats'];
}

export interface VenueDateGroup {
  date: string;
  items: PublicEventView[];
}

export interface EventDatePresentation {
  primary: string;
  secondary?: string;
}

export function readEventListQuery(params: ParamMap, preferredView: CalendarView, now = new Date()): EventListQuery {
  const rawView = params.get('view');
  return {
    month: validMonth(params.get('month')) ?? monthValue(now),
    view: rawView === 'list' || rawView === 'calendar' ? rawView : preferredView,
    past: params.get('past') === 'true',
    q: clean(params.get('q')),
    page: readPage(params.get('page'))
  };
}

export function buildEventListQueryParams(query: EventListQuery): Record<string, string> {
  const result: Record<string, string> = { month: query.month };
  if (query.q) result['q'] = query.q;
  if (query.past) result['past'] = 'true';
  result['view'] = query.view;
  if (query.page > 1) result['page'] = String(query.page);
  return result;
}

export function eventRegisterIntent(candidate: string | null | undefined): string | null {
  const url = calendarUrl(candidate);
  if (!url) return null;
  const slug = url.searchParams.get('register')?.trim() ?? '';
  return slug.length > 0 && slug.length <= 200 && !hasControlCharacter(slug) ? slug : null;
}

export function addEventRegisterIntent(candidate: string | null | undefined, slug: string): string {
  const url = calendarUrl(candidate) ?? new URL('/events', EVENT_LIST_ORIGIN);
  const cleanSlug = slug.trim().slice(0, 200);
  if (cleanSlug && !hasControlCharacter(cleanSlug)) url.searchParams.set('register', cleanSlug);
  else url.searchParams.delete('register');
  return localUrl(url);
}

export function removeEventRegisterIntent(candidate: string | null | undefined): string {
  const url = calendarUrl(candidate) ?? new URL('/events', EVENT_LIST_ORIGIN);
  url.searchParams.delete('register');
  return localUrl(url);
}

const EVENT_LIST_ORIGIN = 'https://events.internal';

function calendarUrl(candidate: string | null | undefined): URL | null {
  const safe = safeReturnUrl(candidate, '');
  if (!safe) return null;
  const url = new URL(safe, EVENT_LIST_ORIGIN);
  return url.pathname === '/events' ? url : null;
}

function localUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function readPage(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

/** Stable flat order for paging: venue date, then venue start time, then title, then id. */
export function sortEventsForList(items: PublicEventView[]): PublicEventView[] {
  return [...items].sort((left, right) =>
    left.venueStartDate.localeCompare(right.venueStartDate)
    || left.venueStartTime.localeCompare(right.venueStartTime)
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id));
}

export function calendarPageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampCalendarPage(page: number, total: number, pageSize = PAGE_SIZE): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), calendarPageCount(total, pageSize));
}

export function paginateEvents(items: PublicEventView[], page: number, pageSize = PAGE_SIZE): PublicEventView[] {
  const safePage = clampCalendarPage(page, items.length, pageSize);
  return items.slice((safePage - 1) * pageSize, safePage * pageSize);
}

/** Both `YYYY-MM-DD`; today is deliberately excluded, so only strictly earlier days read as past. */
export function isPastCalendarDay(date: string, today: string): boolean {
  return date < today;
}

/**
 * Google Maps search link for a venue, or null when the venue carries no address. The host is
 * fixed and the address — API data — only ever reaches the URL percent-encoded.
 */
export function venueMapsUrl(venue: { streetAddress?: string; postalCode?: string; city?: string; country?: string }): string | null {
  const address = [venue.streetAddress, venue.postalCode, venue.city, venue.country].filter(Boolean).join(', ');
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
}

export const MAX_DAY_CELL_EVENTS = 3;

export interface MonthDay {
  date: string;
  day: number;
  inMonth: boolean;
}

export function buildMonthDays(month: string): MonthDay[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const weekdayIndex = (first.getDay() + 6) % 7;
  const start = new Date(year, monthNumber - 1, 1 - weekdayIndex);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date: localDateValue(date), day: date.getDate(), inMonth: date.getMonth() === monthNumber - 1 };
  });
}

export function localDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Events keyed by their venue start date, each list sorted by start time then title. */
export function eventsByDate(items: PublicEventView[]): Map<string, PublicEventView[]> {
  const grouped = new Map<string, PublicEventView[]>();
  for (const item of items) {
    const current = grouped.get(item.venueStartDate) ?? [];
    current.push(item);
    grouped.set(item.venueStartDate, current);
  }
  for (const dateItems of grouped.values()) {
    dateItems.sort((left, right) => left.venueStartTime.localeCompare(right.venueStartTime) || left.title.localeCompare(right.title));
  }
  return grouped;
}

export function groupEventsByVenueDate(items: PublicEventView[]): VenueDateGroup[] {
  const grouped = new Map<string, PublicEventView[]>();
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

export function eventDatePresentation(
  event: Omit<PublicEventView, 'id'>,
  locale: string,
  viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): EventDatePresentation {
  const instant = new Date(String(event.startsAtUtc));
  const venueDate = formatWallDate(event.venueStartDate, locale);
  const venueTime = formatWallTime(event.venueStartTime, locale);
  const venueShortZone = zoneName(instant, locale, event.timeZoneId);
  const primary = `${venueDate}, ${venueTime} (${venueShortZone}, ${event.timeZoneId})`;
  if (!viewerTimeZone || viewerTimeZone === event.timeZoneId || Number.isNaN(instant.getTime())) return { primary };

  const viewerParts = dateTimeParts(instant, locale, viewerTimeZone);
  const venueWall = `${event.venueStartDate}T${event.venueStartTime.slice(0, 5)}`;
  if (viewerParts.wall === venueWall) return { primary };
  return { primary, secondary: `${viewerParts.label} (${viewerParts.zone}, ${viewerTimeZone})` };
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
