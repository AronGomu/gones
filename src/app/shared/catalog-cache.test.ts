import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_TTL_MS, clearCatalogEntry, isCatalogFresh, readCatalogEntry, writeBoundedCacheValue, writeCatalogEntry } from './catalog-cache';

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

/** The bounded writer enumerates its key family, which the stub above deliberately cannot do. */
function makeEnumerableStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; }
  } as Storage;
}

/** A store that refuses every write while it still holds `limit` rows, so only eviction lets one in. */
function makeQuotaBoundStorage(limit: number, seed: Record<string, string>): Storage {
  const base = makeEnumerableStorage();
  for (const [key, value] of Object.entries(seed)) base.setItem(key, value);
  return {
    getItem: (key: string) => base.getItem(key),
    setItem: (key: string, value: string) => {
      if (base.length >= limit) throw new DOMException('quota', 'QuotaExceededError');
      base.setItem(key, value);
    },
    removeItem: (key: string) => { base.removeItem(key); },
    clear: () => { base.clear(); },
    key: (index: number) => base.key(index),
    get length() { return base.length; }
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

/**
 * F15 — the per-entity key families (`gones.player.`, `gones.events.cache.`) used to grow one key per
 * entity visited and never shed one, so a full origin turned every later write into a swallowed
 * quota error. Every assertion here is observable storage state: which keys survive, and how many.
 */
function row(fetchedAt: string): string {
  return JSON.stringify({ fetchedAt });
}

function keysUnder(prefix: string): string[] {
  const storage = globalThis.localStorage;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys.sort();
}

describe('bounded catalog cache writes', () => {
  const config = { prefix: 'p.', maxEntries: 3, timestampField: 'fetchedAt' } as const;

  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = makeEnumerableStorage();
  });

  it('caps a prefix at maxEntries and evicts the oldest by timestamp', () => {
    globalThis.localStorage.setItem('p.a', row('2026-08-01T00:00:00.000Z'));
    globalThis.localStorage.setItem('p.b', row('2026-08-02T00:00:00.000Z'));
    globalThis.localStorage.setItem('p.c', row('2026-08-03T00:00:00.000Z'));

    writeBoundedCacheValue(config, 'p.d', row('2026-08-04T00:00:00.000Z'));

    expect(globalThis.localStorage.getItem('p.a')).toBeNull();
    expect(keysUnder('p.')).toEqual(['p.b', 'p.c', 'p.d']);
  });

  it('rewriting an existing key at the cap evicts nothing', () => {
    globalThis.localStorage.setItem('p.a', row('2026-08-01T00:00:00.000Z'));
    globalThis.localStorage.setItem('p.b', row('2026-08-02T00:00:00.000Z'));
    globalThis.localStorage.setItem('p.c', row('2026-08-03T00:00:00.000Z'));

    writeBoundedCacheValue(config, 'p.b', row('2026-08-04T00:00:00.000Z'));

    expect(keysUnder('p.')).toEqual(['p.a', 'p.b', 'p.c']);
    expect(globalThis.localStorage.getItem('p.b')).toBe(row('2026-08-04T00:00:00.000Z'));
  });

  it('evicts the oldest sibling and retries when the store is full', () => {
    (globalThis as { localStorage?: Storage }).localStorage = makeQuotaBoundStorage(2, {
      'p.old': row('2026-08-01T00:00:00.000Z'),
      'p.new': row('2026-08-02T00:00:00.000Z')
    });

    expect(() => writeBoundedCacheValue(config, 'p.fresh', row('2026-08-03T00:00:00.000Z'))).not.toThrow();

    expect(globalThis.localStorage.getItem('p.old')).toBeNull();
    expect(globalThis.localStorage.getItem('p.new')).not.toBeNull();
    expect(globalThis.localStorage.getItem('p.fresh')).toBe(row('2026-08-03T00:00:00.000Z'));
  });

  it('gives up silently when quota persists with no sibling left', () => {
    (globalThis as { localStorage?: Storage }).localStorage = makeQuotaBoundStorage(0, {
      'p.a': row('2026-08-01T00:00:00.000Z'),
      'p.b': row('2026-08-02T00:00:00.000Z')
    });

    expect(() => writeBoundedCacheValue(config, 'p.c', row('2026-08-03T00:00:00.000Z'))).not.toThrow();

    expect(globalThis.localStorage.getItem('p.c')).toBeNull();
  });

  it('treats an unparsable sibling as oldest', () => {
    globalThis.localStorage.setItem('p.junk', '{');
    globalThis.localStorage.setItem('p.ok', row('2026-08-01T00:00:00.000Z'));

    writeBoundedCacheValue({ ...config, maxEntries: 2 }, 'p.new', row('2026-08-02T00:00:00.000Z'));

    expect(keysUnder('p.')).toEqual(['p.new', 'p.ok']);
  });

  it('never touches keys outside the prefix', () => {
    globalThis.localStorage.setItem('other.key', 'kept');
    globalThis.localStorage.setItem('p.a', row('2026-08-01T00:00:00.000Z'));
    globalThis.localStorage.setItem('p.b', row('2026-08-02T00:00:00.000Z'));

    writeBoundedCacheValue({ ...config, maxEntries: 2 }, 'p.c', row('2026-08-03T00:00:00.000Z'));

    expect(globalThis.localStorage.getItem('other.key')).toBe('kept');
    expect(keysUnder('p.')).toEqual(['p.b', 'p.c']);
  });

  it('writes nothing when localStorage is absent', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
    try {
      expect(() => writeBoundedCacheValue(config, 'p.a', row('2026-08-01T00:00:00.000Z'))).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      vi.restoreAllMocks();
    }
  });
});
