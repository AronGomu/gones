import { describe, expect, it } from 'vitest';
// @ts-expect-error - bulk loader is plain ESM shared with seeding scripts.
import { searchText, storedEventType } from '../scripts/bulk-load-stress.mjs';

describe('stress Event bulk mapping', () => {
  it.each([
    ['weekly', 'Weekly'],
    ['monthly', 'Monthly'],
    ['major', 'Major']
  ])('persists %s as domain enum %s', (wire, stored) => {
    expect(storedEventType(wire)).toBe(stored);
  });

  it('includes Region and Event Type in normalized search text', () => {
    expect(searchText({
      title: 'Open', summary: 'Regional event', city: 'Lyon', region: 'Auvergne-Rhône-Alpes', country: 'France', eventType: 'major'
    })).toBe('OPEN REGIONAL EVENT LYON AUVERGNE-RHÔNE-ALPES FRANCE MAJOR');
  });
});
