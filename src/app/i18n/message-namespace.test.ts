import { catalogs } from './messages';

const en = catalogs.en;
const fr = catalogs.fr;

describe('message namespace', () => {
  it('has no calendar namespace', () => {
    for (const key of Object.keys(en)) {
      expect(key).not.toMatch(/^calendar\./);
    }
    for (const key of Object.keys(fr)) {
      expect(key).not.toMatch(/^calendar\./);
    }
  });

  it('en and fr have identical key sets', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });

  it('keeps both load-failure messages', () => {
    expect((en as Record<string, string>)['event.loadFailed']).toBeDefined();
    expect((en as Record<string, string>)['event.listLoadFailed']).toBeDefined();
    expect((en as Record<string, string>)['event.loadFailed']).not.toEqual(
      (en as Record<string, string>)['event.listLoadFailed'],
    );
  });
});
