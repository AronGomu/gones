import { Injectable } from '@angular/core';

/** Angular service worker cache names holding cached API responses. */
const SERVICE_WORKER_DATA_CACHE = /^ngsw:.*:data:/;

export function isServiceWorkerDataCache(name: string): boolean {
  return SERVICE_WORKER_DATA_CACHE.test(name);
}

/**
 * Drops every user-scoped scrap the app keeps in memory when a session ends, and purges the
 * service worker's cached API responses so no later session — or service worker update — can
 * surface data that belonged to the previous user.
 */
@Injectable({ providedIn: 'root' })
export class SessionScopeService {
  private readonly resets = new Set<() => void>();

  register(reset: () => void): void {
    this.resets.add(reset);
  }

  clear(): void {
    for (const reset of this.resets) reset();
    void this.purgeCachedApiResponses();
  }

  private async purgeCachedApiResponses(): Promise<void> {
    const storage = globalThis.caches;
    if (!storage) return;
    try {
      const names = await storage.keys();
      await Promise.all(names.filter(isServiceWorkerDataCache).map(name => storage.delete(name)));
    } catch {
      // Purging is defence in depth; private responses are never cached in the first place.
    }
  }
}
