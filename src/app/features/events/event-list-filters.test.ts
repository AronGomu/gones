import { describe, expect, it, vi } from 'vitest';
import { PublicEventView } from './public-event-list';
import {
  defaultEventListFilters,
  eventFilterOptions,
  filterEventList,
  readStoredEventSearch,
  writeStoredEventSearch
} from './event-list-filters';

const lyon: PublicEventView = {
  id: 'lyon', title: 'Lyon Weekly', displayTitle: 'Legacy — Lyon Weekly', slug: 'lyon-weekly', summary: undefined,
  venue: { streetAddress: '1 Street', postalCode: '69001', city: 'Lyon', region: 'Auvergne-Rhône-Alpes', country: 'France' },
  timeZoneId: 'Europe/Paris', venueStartDate: '2026-08-31', venueStartTime: '10:00:00', venueEndDate: '2026-08-31', venueEndTime: '18:00:00',
  startsAtUtc: '2026-08-31T08:00:00Z', endsAtUtc: '2026-08-31T16:00:00Z', capacity: 32, status: 'Published', eventType: 'weekly',
  organization: { id: 'org', name: 'Gones', description: undefined, website: undefined, contactEmail: undefined, organizers: [] },
  formats: [{ id: 'legacy', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]
};
const paris: PublicEventView = {
  ...lyon, id: 'paris', slug: 'paris-major', title: 'Paris Major', venueStartDate: '2027-03-01', eventType: 'major',
  venue: { ...lyon.venue, city: 'Paris', region: 'Île-de-France' },
  formats: [{ id: 'modern', name: 'Modern', slug: 'modern', sortOrder: 2 }]
};

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

describe('Event list filters', () => {
  it('exposes exactly weekly, monthly and major in order', async () => {
    const { EVENT_TYPES } = await import('./event-list-filters');
    expect(EVENT_TYPES).toEqual(['weekly', 'monthly', 'major']);
  });

  it('defaults from today through six clamped calendar months', () => {
    expect(defaultEventListFilters(new Date(2026, 7, 31), { country: 'France', region: 'Auvergne-Rhône-Alpes', city: 'Lyon' })).toEqual({
      from: '2026-08-31', to: '2027-02-28', country: 'France', region: 'Auvergne-Rhône-Alpes', city: 'Lyon', format: '', eventType: ''
    });
  });

  it('ANDs inclusive dates, location, format and Event Type', () => {
    expect(filterEventList([lyon, paris], {
      from: '2026-08-31', to: '2026-08-31', country: 'france', region: 'auvergne-rhone-alpes', city: 'LYON', format: 'legacy', eventType: 'weekly'
    })).toEqual([lyon]);
  });

  it.each([
    ['from', { venueStartDate: '2026-08-30' }],
    ['to', { venueStartDate: '2026-09-01' }],
    ['country', { venue: { ...lyon.venue, country: 'Belgium' } }],
    ['region', { venue: { ...lyon.venue, region: 'Île-de-France' } }],
    ['city', { venue: { ...lyon.venue, city: 'Paris' } }],
    ['format', { formats: [{ id: 'modern', name: 'Modern', slug: 'modern', sortOrder: 2 }] }],
    ['eventType', { eventType: 'major' }]
  ])('enforces %s independently', (_field, override) => {
    const candidate = { ...lyon, ...override } as PublicEventView;
    expect(filterEventList([candidate], {
      from: '2026-08-31', to: '2026-08-31', country: 'France', region: 'Auvergne-Rhône-Alpes', city: 'Lyon', format: 'legacy', eventType: 'weekly'
    })).toEqual([]);
  });

  it('uses empty format and Event Type as all', () => {
    expect(filterEventList([lyon, paris], { from: '', to: '', country: '', region: '', city: '', format: '', eventType: '' }))
      .toEqual([lyon, paris]);
  });

  it('does not render high-cardinality Region or City options before their parent is selected', () => {
    const options = eventFilterOptions([lyon, paris], { country: '', region: '', city: '' });
    expect(options.regions).toEqual([]);
    expect(options.cities).toEqual([]);
  });

  it('derives dependent location options from full catalog', () => {
    const options = eventFilterOptions([lyon, paris], { country: 'France', region: 'Île-de-France', city: 'Paris' });
    expect(options.countries).toEqual(['France']);
    expect(options.regions).toEqual(['Auvergne-Rhône-Alpes', 'Île-de-France']);
    expect(options.cities).toEqual(['Paris']);
    expect(options.formats.map(format => format.id)).toEqual(['legacy', 'modern']);
  });

  it('round-trips versioned search memory without navigation fields', () => {
    const storage = memoryStorage();
    const filters = defaultEventListFilters(new Date(2026, 0, 1));
    writeStoredEventSearch(storage, 'key', ' lyon ', { ...filters, month: '2026-01', view: 'list' } as typeof filters);
    expect(readStoredEventSearch(storage, 'key')).toEqual({ q: 'lyon', filters });
    expect(JSON.parse(storage.values.get('key')!).filters).toEqual(filters);
  });

  it('remembers intentionally unbounded dates', () => {
    const storage = memoryStorage();
    const filters = { ...defaultEventListFilters(new Date(2026, 0, 1)), from: '', to: '' };
    writeStoredEventSearch(storage, 'key', '', filters);
    expect(readStoredEventSearch(storage, 'key')).toEqual({ q: '', filters });
  });

  it('rejects corrupt, reversed and unknown-type search memory', () => {
    const getItem = vi.fn()
      .mockReturnValueOnce('{')
      .mockReturnValueOnce(JSON.stringify({ version: 1, q: '', filters: { from: '2026-02-01', to: '2026-01-01', country: '', region: '', city: '', format: '', eventType: '' } }))
      .mockReturnValueOnce(JSON.stringify({ version: 1, q: '', filters: { from: '2026-01-01', to: '2026-02-01', country: '', region: '', city: '', format: '', eventType: 'other' } }));
    expect(readStoredEventSearch({ getItem }, 'key')).toBeNull();
    expect(readStoredEventSearch({ getItem }, 'key')).toBeNull();
    expect(readStoredEventSearch({ getItem }, 'key')).toBeNull();
  });
});
