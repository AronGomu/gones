export const EVENT_TYPES = ['weekly', 'monthly', 'major'] as const;
export type CalendarEventType = typeof EVENT_TYPES[number];

export interface EventListFilters {
  from: string;
  to: string;
  country: string;
  region: string;
  city: string;
  format: string;
  eventType: CalendarEventType | '';
}

interface FilterableEvent {
  venueStartDate: string;
  venue: { country?: string; region?: string; city?: string };
  formats: Array<{ id: string; name: string; sortOrder: number }>;
  eventType?: string;
}

interface StoredEventSearch {
  version: 1;
  q: string;
  filters: EventListFilters;
}

export function defaultEventListFilters(now = new Date(), location: Partial<Pick<EventListFilters, 'country' | 'region' | 'city'>> = {}): EventListFilters {
  return {
    from: localDate(now),
    to: addCalendarMonths(now, 6),
    country: location.country?.trim() ?? '',
    region: location.region?.trim() ?? '',
    city: location.city?.trim() ?? '',
    format: '',
    eventType: ''
  };
}

export function filterEventList<T extends FilterableEvent>(items: T[], filters: EventListFilters): T[] {
  return items.filter(item =>
    (!filters.from || item.venueStartDate >= filters.from)
    && (!filters.to || item.venueStartDate <= filters.to)
    && matches(item.venue.country, filters.country)
    && matches(item.venue.region, filters.region)
    && matches(item.venue.city, filters.city)
    && (!filters.format || item.formats.some(format => format.id === filters.format))
    && (!filters.eventType || item.eventType === filters.eventType));
}

export function eventFilterOptions(items: FilterableEvent[], filters: Pick<EventListFilters, 'country' | 'region' | 'city'>) {
  const countries = unique([...items.map(item => item.venue.country), filters.country]);
  const countryItems = filters.country ? items.filter(item => matches(item.venue.country, filters.country)) : [];
  const regions = unique([...countryItems.map(item => item.venue.region), filters.region]);
  const regionItems = filters.region ? countryItems.filter(item => matches(item.venue.region, filters.region)) : [];
  const cities = unique([...regionItems.map(item => item.venue.city), filters.city]);
  const formats = [...new Map(items.flatMap(item => item.formats).map(format => [format.id, format])).values()]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  return { countries, regions, cities, formats };
}

export function readStoredEventSearch(storage: Pick<Storage, 'getItem'>, key: string): { q: string; filters: EventListFilters } | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value['version'] !== 1 || typeof value['q'] !== 'string' || !isFilters(value['filters'])) return null;
    return { q: value['q'].trim(), filters: value['filters'] };
  } catch {
    return null;
  }
}

export function writeStoredEventSearch(storage: Pick<Storage, 'setItem'>, key: string, q: string, filters: EventListFilters): void {
  try {
    const value: StoredEventSearch = {
      version: 1,
      q: q.trim(),
      filters: {
        from: filters.from,
        to: filters.to,
        country: filters.country,
        region: filters.region,
        city: filters.city,
        format: filters.format,
        eventType: filters.eventType
      }
    };
    storage.setItem(key, JSON.stringify(value));
  } catch { /* Search memory is optional. */ }
}

function addCalendarMonths(date: Date, amount: number): string {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return localDate(target);
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}

function matches(value: string | undefined, selected: string): boolean {
  return !selected || normalize(value) === normalize(selected);
}

function normalize(value: string | undefined): string {
  return value?.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase() ?? '';
}

function isFilters(value: unknown): value is EventListFilters {
  if (!isRecord(value)) return false;
  const strings = ['from', 'to', 'country', 'region', 'city', 'format'];
  if (!strings.every(key => typeof value[key] === 'string')) return false;
  if (!validOptionalDate(value['from']) || !validOptionalDate(value['to'])) return false;
  if (value['from'] && value['to'] && value['from'] > value['to']) return false;
  return value['eventType'] === '' || EVENT_TYPES.includes(value['eventType'] as CalendarEventType);
}

function validOptionalDate(value: unknown): value is string {
  return value === '' || validDate(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
