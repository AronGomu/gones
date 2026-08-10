import { describe, expect, it } from 'vitest';
import { catalogs } from './messages';

describe('common.import label', () => {
  it('names one or more leagues in both languages', () => {
    expect(catalogs.en['common.import']).toBe('Import league(s)');
    expect(catalogs.fr['common.import']).toBe('Importer ligue(s)');
    expect(catalogs.en['common.import']).not.toContain('1+');
    expect(catalogs.fr['common.import']).not.toContain('1+');
  });
});
