import Fuse from 'fuse.js';
import { PublicTournamentView } from './public-calendar';

export function splitSearchTerms(query: string): string[] {
  const terms: string[] = [];
  let current = '';
  for (let index = 0; index < query.length; index++) {
    const char = query[index];
    if (char === '\\' && index + 1 < query.length) {
      current += query[index + 1];
      index++;
      continue;
    }
    if (char === ',' || char === ';' || /\s/.test(char)) {
      if (current) {
        terms.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) terms.push(current);
  return terms;
}

export function searchableText(item: PublicTournamentView): string {
  return [
    item.title,
    item.slug,
    item.status,
    item.organization?.name,
    ...(item.formats ?? []).map(format => format.name),
    item.venue?.streetAddress,
    item.venue?.postalCode,
    item.venue?.city,
    item.venue?.country,
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
  item: PublicTournamentView;
  text: string;
}

export function filterTournaments(items: PublicTournamentView[], query: string): PublicTournamentView[] {
  const terms = splitSearchTerms(query);
  if (terms.length === 0) return items;

  const entries: SearchableEntry[] = items.map(item => ({ item, text: normalizeSearchValue(searchableText(item)) }));
  const fuse = new Fuse(entries, { keys: ['text'], threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2 });

  let matched: Set<PublicTournamentView> | undefined;
  for (const term of terms) {
    const normalizedTerm = normalizeSearchValue(term);
    const termMatches = new Set(fuse.search(normalizedTerm).map(result => result.item.item));
    matched = matched === undefined ? termMatches : new Set([...matched].filter(item => termMatches.has(item)));
  }

  return items.filter(item => matched?.has(item));
}
