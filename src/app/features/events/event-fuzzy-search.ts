import Fuse from 'fuse.js';
import { splitSearchTerms } from '../../shared/search-highlight';
import { PublicEventView } from './public-event-list';

export function searchableText(item: PublicEventView): string {
  return [
    item.title,
    item.slug,
    item.status,
    item.organization?.name,
    ...(item.formats ?? []).map(format => format.name),
    item.venue?.streetAddress,
    item.venue?.postalCode,
    item.venue?.city,
    item.venue?.region,
    item.venue?.country,
    item.eventType,
    item.timeZoneId,
    item.venueStartDate,
    item.venueStartTime,
    item.venueEndDate,
    item.venueEndTime,
    String(item.capacity ?? '')
  ].filter((part): part is string => Boolean(part)).join(' ');
}

export function normalizeSearchValue(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

interface SearchableEntry {
  item: PublicEventView;
  text: string;
}

export function filterEvents(items: PublicEventView[], query: string): PublicEventView[] {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) return items;

  const entries: SearchableEntry[] = items.map(item => ({ item, text: normalizeSearchValue(searchableText(item)) }));
  const fuse = new Fuse(entries, { keys: ['text'], threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2 });

  let matched: Set<PublicEventView> | undefined;
  for (const term of terms) {
    const normalizedTerm = normalizeSearchValue(term);
    const termMatches = new Set(fuse.search(normalizedTerm).map(result => result.item.item));
    matched = matched === undefined ? termMatches : new Set([...matched].filter(item => termMatches.has(item)));
  }

  return items.filter(item => matched?.has(item));
}
