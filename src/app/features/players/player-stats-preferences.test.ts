import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MATCH_PAGE_SIZE,
  MATCH_PAGE_SIZE_KEY,
  ONLINE_ONLY_KEY,
  readMatchPageSize,
  readOnlineOnly,
  writeMatchPageSize,
  writeOnlineOnly,
} from './player-stats-preferences';

describe('player stats preferences', () => {
  it('defaults to online-only and 50 matches per page', () => {
    const storage = { getItem: () => null, setItem: vi.fn() };
    expect(readOnlineOnly(storage)).toBe(true);
    expect(readMatchPageSize(storage)).toBe(DEFAULT_MATCH_PAGE_SIZE);
  });

  it('restores supported values and persists changes', () => {
    const values = new Map([[ONLINE_ONLY_KEY, 'false'], [MATCH_PAGE_SIZE_KEY, '20']]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn() };
    expect(readOnlineOnly(storage)).toBe(false);
    expect(readMatchPageSize(storage)).toBe(20);

    writeOnlineOnly(true, storage);
    writeMatchPageSize(100, storage);
    expect(storage.setItem).toHaveBeenNthCalledWith(1, ONLINE_ONLY_KEY, 'true');
    expect(storage.setItem).toHaveBeenNthCalledWith(2, MATCH_PAGE_SIZE_KEY, '100');
  });

  it('falls back for malformed or unsupported values', () => {
    const storage = { getItem: (key: string) => key === ONLINE_ONLY_KEY ? 'yes' : '25', setItem: vi.fn() };
    expect(readOnlineOnly(storage)).toBe(true);
    expect(readMatchPageSize(storage)).toBe(50);
  });

  it('fails safe when browser storage throws', () => {
    const storage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readOnlineOnly(storage)).toBe(true);
    expect(readMatchPageSize(storage)).toBe(50);
    expect(() => writeOnlineOnly(false, storage)).not.toThrow();
    expect(() => writeMatchPageSize(10, storage)).not.toThrow();
  });
});
