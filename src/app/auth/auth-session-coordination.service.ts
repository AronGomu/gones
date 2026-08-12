import { Injectable } from '@angular/core';

const AUTH_SESSION_TRANSITION_LOCK = 'gones.auth.session-transition';
const AUTH_COORDINATION_PROBE_KEY = 'gones.auth.coordinationProbe';
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
  private profileScope?: AuthCacheScope;
  private storageUnavailable = false;

  isAvailable(): boolean {
    if (!globalThis.navigator?.locks || this.storageUnavailable) return false;
    try {
      globalThis.localStorage?.getItem(AUTH_SESSION_GENERATION_KEY);
      globalThis.localStorage?.getItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY);
      return Boolean(globalThis.localStorage);
    } catch {
      this.storageUnavailable = true;
      return false;
    }
  }

  requireAvailable(): void {
    if (!this.isAvailable()) throw new AuthCoordinationUnavailableError();
  }

  /** Probe runs inside the auth lock, so concurrent tabs cannot race its fixed transient key. */
  requireWritable(): void {
    this.requireAvailable();
    let wrote = false;
    let removed = false;
    try {
      globalThis.localStorage?.setItem(AUTH_COORDINATION_PROBE_KEY, '1');
      wrote = globalThis.localStorage?.getItem(AUTH_COORDINATION_PROBE_KEY) === '1';
    } catch {
      // Removal still runs below if the write landed before a later operation failed.
    }
    try {
      globalThis.localStorage?.removeItem(AUTH_COORDINATION_PROBE_KEY);
      removed = globalThis.localStorage?.getItem(AUTH_COORDINATION_PROBE_KEY) === null;
    } catch {
      // A probe that cannot be removed is unavailable too.
    }
    if (wrote && removed) return;
    this.storageUnavailable = true;
    throw new AuthCoordinationUnavailableError();
  }

  async withLock<T>(action: () => Promise<T> | T): Promise<T> {
    const locks = globalThis.navigator?.locks;
    if (!locks) throw new AuthCoordinationUnavailableError();
    return await locks.request(AUTH_SESSION_TRANSITION_LOCK, action);
  }

  async withAvailableLock<T>(action: () => Promise<T> | T): Promise<T> {
    this.requireAvailable();
    return await this.withLock(() => {
      this.requireWritable();
      return action();
    });
  }

  generation(): number {
    try {
      const stored = Number(globalThis.localStorage?.getItem(AUTH_SESSION_GENERATION_KEY) ?? 0);
      if (Number.isSafeInteger(stored) && stored >= 0) this.localGeneration = Math.max(this.localGeneration, stored);
    } catch {
      this.storageUnavailable = true;
    }
    return this.localGeneration;
  }

  isPurgeRequired(): boolean {
    if (this.localPurgeRequired) return true;
    try {
      return globalThis.localStorage?.getItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY) === '1';
    } catch {
      this.storageUnavailable = true;
      return true;
    }
  }

  /** Starts a new profile session. Caller must hold `withAvailableLock()`. */
  advanceGeneration(): number {
    const nextGeneration = this.generation() + 1;
    this.profileScope = undefined;
    this.persistGeneration(nextGeneration);
    this.localGeneration = nextGeneration;
    return nextGeneration;
  }

  bindProfile(profileId: string, generation: number): void {
    if (!profileId || this.isPurgeRequired() || this.generation() !== generation) {
      throw new Error('authSessionTransitionSuperseded');
    }
    this.profileScope = { profileId, generation };
  }

  isProfileScopeCurrent(profileId: string, generation?: number): boolean {
    const scope = this.profileScope;
    if (!scope || !this.isAvailable()) return false;
    return scope.profileId === profileId
      && (generation === undefined || scope.generation === generation)
      && !this.isPurgeRequired()
      && this.generation() === scope.generation;
  }

  invalidateSession(): number {
    const nextGeneration = this.generation() + 1;
    this.localGeneration = nextGeneration;
    this.localPurgeRequired = true;
    this.profileScope = undefined;
    let purgeMarkerPersisted = false;
    let generationPersisted = true;
    try {
      globalThis.localStorage?.setItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY, '1');
      purgeMarkerPersisted = globalThis.localStorage?.getItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY) === '1';
    } catch {
      // Generation write below may still invalidate other tabs.
    }
    try {
      this.persistGeneration(nextGeneration);
    } catch {
      generationPersisted = false;
    }
    if (!purgeMarkerPersisted || !generationPersisted) this.storageUnavailable = true;
    return nextGeneration;
  }

  markPurgeComplete(): void {
    try {
      globalThis.localStorage?.removeItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY);
      if (globalThis.localStorage?.getItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY) !== null) throw new AuthCoordinationUnavailableError();
      this.localPurgeRequired = false;
    } catch {
      this.storageUnavailable = true;
      throw new AuthCoordinationUnavailableError();
    }
  }

  captureCacheScope(profileId: string | undefined): AuthCacheScope | null {
    const scope = this.profileScope;
    if (!profileId || !scope || !this.isProfileScopeCurrent(profileId)) return null;
    return scope;
  }

  isCacheScopeCurrent(scope: AuthCacheScope, profileId: string | undefined): boolean {
    return this.profileScope === scope && profileId === scope.profileId && this.isProfileScopeCurrent(scope.profileId, scope.generation);
  }

  private persistGeneration(generation: number): void {
    try {
      globalThis.localStorage?.setItem(AUTH_SESSION_GENERATION_KEY, String(generation));
      if (globalThis.localStorage?.getItem(AUTH_SESSION_GENERATION_KEY) !== String(generation)) throw new AuthCoordinationUnavailableError();
    } catch {
      this.storageUnavailable = true;
      throw new AuthCoordinationUnavailableError();
    }
  }
}
