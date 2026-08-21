import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_TTL_MS, clearCatalogEntry, isCatalogFresh, readCatalogEntry, writeCatalogEntry } from './catalog-cache';

/**
 * ADR 0039 — the public half of the TTL contract. A broken store is a cache miss and never an error
 * the page has to handle, so every assertion here is either a round-trip or a survived failure.
 */

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: () => null,
    get length() { return store.size; }
  } as Storage;
}

const entry = { items: [{ id: 'a' }], etag: '"v1"', fetchedAt: '2026-08-15T10:00:00.000Z', truncated: false };

describe('catalog cache storage', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = makeStorage();
  });

  it('round-trips an entry', () => {
    writeCatalogEntry('k', entry);

    expect(readCatalogEntry('k')).toEqual(entry);
  });

  it('clears an entry', () => {
    writeCatalogEntry('k', entry);

    clearCatalogEntry('k');

    expect(readCatalogEntry('k')).toBeUndefined();
  });

  it('survives unreadable storage', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      ...makeStorage(),
      getItem: () => { throw new DOMException('denied', 'SecurityError'); }
    } as Storage;

    expect(readCatalogEntry('k')).toBeUndefined();
  });

  it('survives a quota error on write', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      ...makeStorage(),
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); }
    } as Storage;

    expect(() => writeCatalogEntry('k', entry)).not.toThrow();
  });

  it('survives an unremovable entry', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      ...makeStorage(),
      removeItem: () => { throw new DOMException('denied', 'SecurityError'); }
    } as Storage;

    expect(() => clearCatalogEntry('k')).not.toThrow();
  });

  it('ignores malformed JSON', () => {
    globalThis.localStorage.setItem('k', '{');

    expect(readCatalogEntry('k')).toBeUndefined();
  });
});

describe('catalog cache freshness', () => {
  it('treats a fresh entry as fresh', () => {
    expect(isCatalogFresh({ ...entry, fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() })).toBe(true);
  });

  it('treats a 25h entry as stale', () => {
    expect(isCatalogFresh({ ...entry, fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })).toBe(false);
  });

  it('honours a caller TTL and a caller clock', () => {
    const fetchedAt = '2026-08-15T10:00:00.000Z';
    const now = Date.parse(fetchedAt) + 90 * 1000;

    expect(isCatalogFresh({ ...entry, fetchedAt }, 60 * 1000, now)).toBe(false);
    expect(isCatalogFresh({ ...entry, fetchedAt }, 120 * 1000, now)).toBe(true);
  });

  it('treats an unparsable instant as stale rather than eternally fresh', () => {
    expect(isCatalogFresh({ ...entry, fetchedAt: 'not-a-date' })).toBe(false);
  });

  it('caps the shared TTL at 24 hours', () => {
    expect(CATALOG_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('catalog cache without a store', () => {
  it('reads and writes nothing when localStorage is absent', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
    try {
      expect(readCatalogEntry('k')).toBeUndefined();
      expect(() => writeCatalogEntry('k', entry)).not.toThrow();
      expect(() => clearCatalogEntry('k')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      vi.restoreAllMocks();
    }
  });
});
