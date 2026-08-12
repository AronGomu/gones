import { describe, expect, it } from 'vitest';
import { PublicEventView } from './public-calendar';
import { splitSearchTerms } from '../../shared/search-highlight';
import { filterEvents, searchableText } from './event-fuzzy-search';

function makeItem(overrides: Partial<PublicEventView>): PublicEventView {
  return {
    id: overrides.id ?? 'id-1',
    title: 'Legacy Open',
    slug: 'legacy-open',
    summary: 'A long description mentioning zzzq nowhere else in this fixture.',
    venue: { streetAddress: '1 Rue de la Republique', postalCode: '69001', city: 'Lyon', country: 'France' },
    timeZoneId: 'Europe/Paris',
    venueStartDate: '2026-09-12',
    venueStartTime: '09:00:00',
    venueEndDate: '2026-09-12',
    venueEndTime: '18:00:00',
    startsAtUtc: '2026-09-12T07:00:00Z',
    endsAtUtc: '2026-09-12T16:00:00Z',
    capacity: 64,
    status: 'published',
    organization: { id: 'org-1', name: 'Gones Events', description: undefined, website: undefined, contactEmail: undefined },
    formats: [{ id: 'format-1', name: 'Legacy', slug: 'legacy', sortOrder: 0 }],
    ...overrides
  } as PublicEventView;
}

function org(name: string): PublicEventView['organization'] {
  return { id: name, name, description: undefined, website: undefined, contactEmail: undefined };
}

function formats(...names: string[]): PublicEventView['formats'] {
  return names.map((name, index) => ({ id: name, name, slug: name.toLowerCase(), sortOrder: index }));
}

const lyonLegacy = makeItem({ id: 'lyon-legacy', title: 'Lyon Legacy Open' });
const rhoneModern = makeItem({
  id: 'rhone-modern',
  title: 'Rhône Modern Classic',
  slug: 'rhone-modern-classic',
  venue: { streetAddress: '2 Quai du Rhône', postalCode: '69002', city: 'Rhône-Ville', country: 'France' },
  formats: formats('Modern'),
  organization: org('Gones Events')
});
const cancelledLegacy = makeItem({
  id: 'cancelled-legacy',
  title: 'Cancelled Legacy Cup',
  slug: 'cancelled-legacy-cup',
  status: 'cancelled',
  venue: { streetAddress: '3 Rue Victor Hugo', postalCode: '75001', city: 'Paris', country: 'France' },
  organization: org('Other Org'),
  formats: formats('Legacy')
});
const otherOrgModern = makeItem({
  id: 'other-org-modern',
  title: 'Other Org Modern',
  slug: 'other-org-modern',
  venue: { streetAddress: '4 Boulevard Voltaire', postalCode: '13001', city: 'Marseille', country: 'France' },
  organization: org('Other Org'),
  formats: formats('Modern')
});

const items: PublicEventView[] = [lyonLegacy, rhoneModern, cancelledLegacy, otherOrgModern];

describe('splitSearchTerms', () => {
  it('splits on comma, semicolon and whitespace', () => {
    expect(splitSearchTerms('lyon, legacy; 2026 modern')).toEqual(['lyon', 'legacy', '2026', 'modern']);
  });

  it('keeps an escaped comma inside a term', () => {
    expect(splitSearchTerms('saint\\,étienne')).toEqual(['saint,étienne']);
  });

  it('keeps an escaped space inside a term', () => {
    expect(splitSearchTerms('grand\\ prix')).toEqual(['grand prix']);
  });

  it('drops empty terms', () => {
    expect(splitSearchTerms('lyon,,  ,legacy')).toEqual(['lyon', 'legacy']);
  });
});

describe('filterEvents', () => {
  it('empty query returns every item', () => {
    expect(filterEvents(items, '   ')).toBe(items);
  });

  it('matches on city', () => {
    expect(filterEvents(items, 'lyon')).toEqual([lyonLegacy]);
  });

  it('matches on organization name', () => {
    const result = filterEvents(items, 'gones');
    expect(result.map(item => item.id).sort()).toEqual(['lyon-legacy', 'rhone-modern']);
  });

  it('matches on format name', () => {
    const result = filterEvents(items, 'legacy');
    expect(result.map(item => item.id).sort()).toEqual(['cancelled-legacy', 'lyon-legacy']);
  });

  it('matches on status', () => {
    expect(filterEvents(items, 'cancelled')).toEqual([cancelledLegacy]);
  });

  it('matches on venue date', () => {
    const result = filterEvents(items, '2026-09-12');
    expect(result).toHaveLength(4);
  });

  it('ignores accents and case', () => {
    expect(filterEvents(items, 'RHONE')).toEqual([rhoneModern]);
  });

  it('ANDs multiple terms', () => {
    expect(filterEvents(items, 'lyon legacy')).toEqual([lyonLegacy]);
  });

  it('never matches the long description', () => {
    expect(filterEvents(items, 'zzzq')).toEqual([]);
  });
});

describe('searchableText', () => {
  it('excludes the summary field', () => {
    expect(searchableText(lyonLegacy)).not.toContain('zzzq');
  });
});
