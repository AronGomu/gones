import { Injectable } from '@angular/core';

const AUTH_SESSION_TRANSITION_LOCK = 'gones.auth.session-transition';
const AUTH_COORDINATION_PROBE_KEY = 'gones.auth.coordinationProbe';
const AUTH_PRIVATE_PURGE_REQUIRED_KEY = 'gones.auth.privatePurgeRequired';
const AUTH_SESSION_GENERATION_KEY = 'gones.auth.sessionGeneration';
const AUTH_SESSION_OWNER_KEY = 'gones.auth.sessionOwner';

export interface AuthCacheScope {
  readonly profileId: string;
  readonly generation: number;
}

export class AuthCoordinationUnavailableError extends Error {
  constructor() { super('authCoordinationUnavailable'); }
}

/**
 * Origin-wide auth ordering metadata: markers, the session counter, and the account id that owns the
 * current generation. Ownership is the one identifier here, it is what lets a tab tell a peer
 * establishing its own account from a peer establishing another one, and teardown removes it. No
 * profile or domain data is ever stored.
 */
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

  /**
   * Starts a new profile session. Caller must hold `withAvailableLock()`. `profileId` is the account
   * the token published in this same hold belongs to: recording it here, where the counter moves,
   * is what keeps the two from ever disagreeing. Omitting it costs only the re-anchor — every reader
   * of a missing record supersedes instead.
   */
  advanceGeneration(profileId?: string): number {
    const nextGeneration = this.generation() + 1;
    this.profileScope = undefined;
    this.persistGeneration(nextGeneration);
    this.persistGenerationOwner(nextGeneration, profileId);
    this.localGeneration = nextGeneration;
    return nextGeneration;
  }

  /**
   * The current generation, when `profileId` is exactly the account the tab that advanced it
   * published it for. Everything else answers `undefined` and so supersedes the caller: no record, a
   * record an older generation left behind, another account, a purge in between, unreadable storage.
   */
  generationOwnedBy(profileId: string): number | undefined {
    if (!profileId || !this.isAvailable() || this.isPurgeRequired()) return undefined;
    const generation = this.generation();
    try {
      return globalThis.localStorage?.getItem(AUTH_SESSION_OWNER_KEY) === `${generation}:${profileId}` ? generation : undefined;
    } catch {
      this.storageUnavailable = true;
      return undefined;
    }
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
    try {
      this.persistGenerationOwner(nextGeneration, undefined);
    } catch {
      // A record this teardown could not remove still names an older generation, so no establishment
      // can read it as an owner. Removing it is hygiene for a store that outlives logout, not ordering.
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

  /** The generation is part of the stored value, so a record can only ever answer for its own. */
  private persistGenerationOwner(generation: number, profileId: string | undefined): void {
    const owner = profileId ? `${generation}:${profileId}` : null;
    try {
      if (owner === null) globalThis.localStorage?.removeItem(AUTH_SESSION_OWNER_KEY);
      else globalThis.localStorage?.setItem(AUTH_SESSION_OWNER_KEY, owner);
      if ((globalThis.localStorage?.getItem(AUTH_SESSION_OWNER_KEY) ?? null) !== owner) throw new AuthCoordinationUnavailableError();
    } catch {
      this.storageUnavailable = true;
      throw new AuthCoordinationUnavailableError();
    }
  }
}
