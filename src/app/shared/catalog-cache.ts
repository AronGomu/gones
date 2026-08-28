/**
 * Public catalog cache in `localStorage` (ADR 0023, generalised by ADR 0039).
 *
 * These helpers hold the public half of the one TTL contract: a page loads its whole catalog once,
 * serves the stored copy while it is under 24 hours old, and refetches beyond that. Only **public**
 * data may be stored here — `localStorage` outlives logout and is readable by the next account on
 * this browser, so private rows belong in the per-user store of ADR 0031 instead.
 *
 * Every function swallows its own failure: a store that is full, disabled or holding a half-written
 * value is a cache miss, never an error the page has to render.
 */
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/** What is stored. `etag` feeds the conditional refetch, `truncated` the row-cap warning. */
export interface CatalogEntry<T> {
  items: T;
  etag?: string;
  fetchedAt: string;
  truncated: boolean;
}

/** What a page gets back: the items plus how they were obtained. */
export interface CatalogResult<T> {
  items: T;
  fetchedAt: string;
  fromCache: boolean;
  stale: boolean;
  truncated: boolean;
}

export function readCatalogEntry<T>(key: string): CatalogEntry<T> | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) as CatalogEntry<T> : undefined;
  } catch {
    return undefined;
  }
}

export function writeCatalogEntry<T>(key: string, entry: CatalogEntry<T>): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(entry));
  } catch {
    // Cache failure must not hide fresh public data.
  }
}

export function clearCatalogEntry(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // A row that cannot be dropped expires on its own; the next load overwrites it.
  }
}

/** An instant that will not parse is stale, so a corrupt row cannot pin a page to old data forever. */
export function isCatalogFresh(entry: CatalogEntry<unknown>, ttlMs = CATALOG_TTL_MS, now = Date.now()): boolean {
  const fetchedAt = Date.parse(entry.fetchedAt);
  return Number.isFinite(fetchedAt) && now - fetchedAt < ttlMs;
}

/** A localStorage key family holding one entry per entity, bounded by count with oldest-first eviction. */
export interface BoundedPrefixConfig {
  prefix: string;
  maxEntries: number;
  timestampField: 'fetchedAt' | 'cachedAt';
}

/**
 * Bounded write for per-entity key families (`gones.player.`, `gones.events.cache.`): a full store
 * evicts the oldest sibling and retries instead of silently dropping the fresh row, and a family
 * past its cap sheds oldest entries after every successful write. A row that cannot be parsed or
 * dated counts as oldest, so corruption is reclaimed first. Never throws — same doctrine as above.
 */
export function writeBoundedCacheValue(config: BoundedPrefixConfig, key: string, serialized: string): void {
  const storage = globalThis.localStorage;
  if (!storage) return;
  try {
    for (;;) {
      try {
        storage.setItem(key, serialized);
        break;
      } catch {
        if (!evictOldest(storage, config, key)) return;
      }
    }
    while (siblingKeys(storage, config.prefix).length > config.maxEntries) {
      if (!evictOldest(storage, config, key)) return;
    }
  } catch {
    // A store whose enumeration itself fails is a cache miss, never an error.
  }
}

function siblingKeys(storage: Storage, prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/** Removes the oldest family member other than `keep`. Returns false when there is nothing left to evict. */
function evictOldest(storage: Storage, config: BoundedPrefixConfig, keep: string): boolean {
  const candidates = siblingKeys(storage, config.prefix).filter((key) => key !== keep).sort();
  let victim: string | undefined;
  let victimAt = Infinity;
  for (const key of candidates) {
    let at: number;
    try {
      at = Date.parse((JSON.parse(storage.getItem(key) ?? '') as Record<string, string>)[config.timestampField]);
      if (Number.isNaN(at)) at = -Infinity;
    } catch {
      at = -Infinity;
    }
    if (at < victimAt) {
      victim = key;
      victimAt = at;
    }
  }
  if (victim === undefined) return false;
  storage.removeItem(victim);
  return true;
}
