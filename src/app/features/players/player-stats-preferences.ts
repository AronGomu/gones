export const ONLINE_ONLY_KEY = 'gones.playerStats.onlineOnly';
export const MATCH_PAGE_SIZE_KEY = 'gones.playerStats.matchPageSize';
export const MATCH_PAGE_SIZES = [10, 20, 50, 100] as const;
export type MatchPageSize = typeof MATCH_PAGE_SIZES[number];
export const DEFAULT_MATCH_PAGE_SIZE: MatchPageSize = 50;

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readOnlineOnly(storage?: PreferenceStorage): boolean {
  const value = read(ONLINE_ONLY_KEY, storage);
  return value === 'false' ? false : true;
}

export function writeOnlineOnly(value: boolean, storage?: PreferenceStorage): void {
  write(ONLINE_ONLY_KEY, String(value), storage);
}

export function readMatchPageSize(storage?: PreferenceStorage): MatchPageSize {
  const value = Number(read(MATCH_PAGE_SIZE_KEY, storage));
  return MATCH_PAGE_SIZES.includes(value as MatchPageSize) ? value as MatchPageSize : DEFAULT_MATCH_PAGE_SIZE;
}

export function writeMatchPageSize(value: MatchPageSize, storage?: PreferenceStorage): void {
  write(MATCH_PAGE_SIZE_KEY, String(value), storage);
}

function read(key: string, storage?: PreferenceStorage): string | null {
  try {
    return storage ? storage.getItem(key) : globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string, storage?: PreferenceStorage): void {
  try {
    if (storage) storage.setItem(key, value);
    else globalThis.localStorage.setItem(key, value);
  } catch {
    // Browser display preferences remain optional when storage is unavailable.
  }
}
