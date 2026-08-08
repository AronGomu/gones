import { describe, expect, it } from 'vitest';
import { FirstVisitService, FIRST_VISIT_KEY } from './first-visit.service';

function installFakeStorage(overrides: Partial<Storage> = {}): void {
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: () => null,
    get length() { return store.size; },
    ...overrides
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}

describe('FirstVisitService', () => {
  it('is a first visit with no flag', () => {
    installFakeStorage();
    const service = new FirstVisitService();
    expect(service.isFirstVisit()).toBe(true);
  });

  it('is not a first visit once marked', () => {
    installFakeStorage();
    const service = new FirstVisitService();
    service.markVisited();
    expect(service.isFirstVisit()).toBe(false);
  });

  it('survives a new service instance', () => {
    installFakeStorage();
    const first = new FirstVisitService();
    first.markVisited();
    const second = new FirstVisitService();
    expect(second.isFirstVisit()).toBe(false);
  });

  it('treats unavailable storage as visited', () => {
    installFakeStorage({
      getItem: () => { throw new Error('storage unavailable'); }
    });
    const service = new FirstVisitService();
    expect(service.isFirstVisit()).toBe(false);
  });

  it('never throws when marking fails', () => {
    installFakeStorage({
      setItem: () => { throw new Error('storage unavailable'); }
    });
    const service = new FirstVisitService();
    expect(() => service.markVisited()).not.toThrow();
  });

  it('uses the documented storage key', () => {
    expect(FIRST_VISIT_KEY).toBe('gones.first-visit.completed');
  });
});
