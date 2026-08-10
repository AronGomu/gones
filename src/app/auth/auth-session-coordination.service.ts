import { Injectable } from '@angular/core';

const AUTH_SESSION_TRANSITION_LOCK = 'gones.auth.session-transition';
const AUTH_PRIVATE_PURGE_REQUIRED_KEY = 'gones.auth.privatePurgeRequired';
const AUTH_SESSION_GENERATION_KEY = 'gones.auth.sessionGeneration';

export interface AuthCacheScope {
  readonly profileId: string;
  readonly generation: number;
}

export class AuthCoordinationUnavailableError extends Error {
  constructor() { super('authCoordinationUnavailable'); }
}

/** Origin-wide auth ordering metadata. Values are marker/counter only, never profile or domain data. */
@Injectable({ providedIn: 'root' })
export class AuthSessionCoordinationService {
  private localGeneration = 0;
  private localPurgeRequired = false;

  isAvailable(): boolean {
    if (!globalThis.navigator?.locks) return false;
    try {
      globalThis.localStorage?.getItem(AUTH_SESSION_GENERATION_KEY);
      globalThis.localStorage?.getItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY);
      return Boolean(globalThis.localStorage);
    } catch {
      return false;
    }
  }

  requireAvailable(): void {
    if (!this.isAvailable()) throw new AuthCoordinationUnavailableError();
  }

  async withLock<T>(action: () => Promise<T> | T): Promise<T> {
    const locks = globalThis.navigator?.locks;
    if (!locks) throw new AuthCoordinationUnavailableError();
    return await locks.request(AUTH_SESSION_TRANSITION_LOCK, action);
  }

  generation(): number {
    try {
      const stored = Number(globalThis.localStorage?.getItem(AUTH_SESSION_GENERATION_KEY) ?? 0);
      if (Number.isSafeInteger(stored) && stored >= 0) this.localGeneration = Math.max(this.localGeneration, stored);
    } catch {
      // Local value still invalidates work in this tab. Establishment fails availability checks.
    }
    return this.localGeneration;
  }

  isPurgeRequired(): boolean {
    if (this.localPurgeRequired) return true;
    try {
      return globalThis.localStorage?.getItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY) === '1';
    } catch {
      return true;
    }
  }

  invalidateSession(): number {
    const nextGeneration = this.generation() + 1;
    this.localGeneration = nextGeneration;
    this.localPurgeRequired = true;
    try {
      globalThis.localStorage?.setItem(AUTH_SESSION_GENERATION_KEY, String(nextGeneration));
      globalThis.localStorage?.setItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY, '1');
    } catch {
      // Teardown remains effective in this tab; establishment cannot pass availability checks.
    }
    return nextGeneration;
  }

  markPurgeComplete(): void {
    this.localPurgeRequired = false;
    try {
      globalThis.localStorage?.removeItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY);
    } catch {
      // Stale marker is safe: next coordinated establishment purges again.
    }
  }

  captureCacheScope(profileId: string | undefined): AuthCacheScope | null {
    if (!profileId || this.isPurgeRequired()) return null;
    return { profileId, generation: this.generation() };
  }

  isCacheScopeCurrent(scope: AuthCacheScope, profileId: string | undefined): boolean {
    return profileId === scope.profileId && !this.isPurgeRequired() && this.generation() === scope.generation;
  }
}
