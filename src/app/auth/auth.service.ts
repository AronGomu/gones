import { Injectable, inject, signal } from '@angular/core';
import { Observable, defer, finalize, firstValueFrom, from, map, shareReplay } from 'rxjs';
import { dataAuthority } from '../config/data-authority';
import { ApiAccessTokenStore } from '../api/api-boundary';
import {
  AccessTokenResponse,
  Client,
  CompleteOAuthRequest,
  EmailAccountRequest,
  EmailChangeRequest,
  ExternalIdentityResponse,
  GenericAccountActionResponse,
  LoginRequest,
  OAuthFlowResponse,
  PatchUserProfileRequest,
  RegisterRequest,
  ResetPasswordRequest,
  UserProfileResponse
} from '../api/generated/gones-api';
import { logBoundaryError } from '../shared/app-logger';
import { AuthCoordinationUnavailableError, AuthSessionCoordinationService } from './auth-session-coordination.service';
import { SessionCatalogSyncService } from './session-catalog-sync.service';
import { SessionScopeService } from './session-scope.service';

/**
 * Ceiling on how long one tab may hold the origin-wide auth lock for a refresh round trip.
 * It bounds the hold, never the request: aborting a rotation the server already committed
 * leaves a consumed cookie in the jar, and the next restore presents it as a replay.
 */
const REFRESH_LOCK_HOLD_MS = 10_000;

/** Refresh round trip result, captured without rejecting so the hold deadline can race it. */
type RefreshOutcome =
  | { readonly ok: true; readonly response: AccessTokenResponse }
  | { readonly ok: false; readonly error: unknown };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = inject(Client);
  private readonly tokens = inject(ApiAccessTokenStore);
  private readonly sessionScope = inject(SessionScopeService);
  private readonly coordination = inject(AuthSessionCoordinationService);
  private readonly catalogSync = inject(SessionCatalogSyncService);
  private refreshFlight?: Observable<void>;
  private bootstrapFlight?: Promise<void>;

  readonly enabled = dataAuthority().authV1;
  readonly profile = signal<UserProfileResponse | null>(null);
  readonly bootstrapped = signal(!this.enabled);
  /** Startup refresh failed. Distinguishes an expired session from a visitor who never signed in. */
  readonly bootstrapFailed = signal(false);

  async bootstrap(): Promise<void> {
    if (!this.enabled || this.bootstrapped()) return;
    this.bootstrapFlight = this.restoreSession();
    try {
      await this.bootstrapFlight;
    } finally {
      this.bootstrapFlight = undefined;
    }
  }

  /**
   * Route guards must decide on the restored session, never on the null profile that precedes it:
   * the startup refresh is in flight for as long as the network takes, and a synchronous read of
   * `profile()` before it settles answers for a visitor the app has not identified yet.
   */
  whenSessionReady(): Promise<void> {
    if (this.bootstrapped()) return Promise.resolve();
    // A failed restore still settles the session — it means "signed out", which is a decidable answer.
    return this.bootstrapFlight?.catch(() => undefined) ?? Promise.resolve();
  }

  private async restoreSession(): Promise<void> {
    let profileEstablishmentStarted = false;
    try {
      const sessionGeneration = await this.spendRefreshCookie((response, generation) => {
        this.assertGeneration(generation);
        profileEstablishmentStarted = true;
        return this.advanceAndPublishSession(response);
      });
      await this.completeProfileEstablishment(sessionGeneration);
    } catch (error) {
      this.bootstrapFailed.set(true);
      if (error instanceof AuthCoordinationUnavailableError) {
        // `spendRefreshCookie` purges its own unavailable-coordination path. An establishment that
        // already started published the access token, so losing coordination there still has to
        // purge here — `completeProfileEstablishment()` cannot, it needs the lock it just lost.
        if (profileEstablishmentStarted) await this.invalidateAndPurgeIgnoringFailure();
        throw error;
      }
    } finally {
      this.bootstrapped.set(true);
    }
  }

  refreshAccessToken(): Observable<void> {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = defer(() => from(this.refreshAccessTokenOnce())).pipe(
      map(() => undefined),
      finalize(() => { this.refreshFlight = undefined; }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.refreshFlight;
  }

  /** Server catalog replaces browser catalog after profile publication. It never uploads. */
  async login(request: LoginRequest): Promise<UserProfileResponse> {
    const generation = await this.prepareEstablishmentOrFailClosed();
    const response = await firstValueFrom(this.client.login(request));
    return await this.establishProfile(response, generation);
  }

  register(request: RegisterRequest): Promise<GenericAccountActionResponse> {
    return firstValueFrom(this.client.register(request));
  }

  async completeOAuth(request: CompleteOAuthRequest): Promise<OAuthFlowResponse> {
    const generation = await this.prepareEstablishmentOrFailClosed();
    const response = await firstValueFrom(this.client.complete(request));
    if (response.accessToken) {
      await this.establishProfile({
        accessToken: response.accessToken,
        expiresAt: response.expiresAt!,
        tokenType: response.tokenType ?? 'Bearer'
      }, generation);
    }
    return response;
  }

  async verifyOAuthEmail(token: string, deviceLabel?: string): Promise<void> {
    const generation = await this.prepareEstablishmentOrFailClosed();
    const response = await firstValueFrom(this.client.verifyEmail2({ token, deviceLabel }));
    if (!response.accessToken) throw new Error('OAuth verification did not return an access token.');
    await this.establishProfile({
      accessToken: response.accessToken,
      expiresAt: response.expiresAt!,
      tokenType: response.tokenType ?? 'Bearer'
    }, generation);
  }

  logout(all = false): Promise<void> {
    const server = firstValueFrom(all ? this.client.logoutAll() : this.client.logout());
    return this.runTeardown(async () => {
      let serverError: unknown;
      let serverFailed = false;
      server.catch((error: unknown) => { serverError = error; serverFailed = true; });
      await this.invalidateAndPurgeIgnoringFailure();
      try {
        await server;
      } catch (error) {
        serverError = error;
        serverFailed = true;
      }
      if (serverFailed) throw serverError;
    });
  }

  /** DELETE stays inside auth lock; interceptor explicitly marks this exact req non-refreshable. */
  deleteAccount(currentPassword: string): Promise<void> {
    return this.runTeardown(async () => {
      await firstValueFrom(this.client.meDELETE({ currentPassword }));
      await this.invalidateAndPurgeIgnoringFailure();
    });
  }

  clear(): Promise<void> {
    return this.runTeardown(() => this.invalidateAndPurge());
  }

  async updateProfile(request: PatchUserProfileRequest): Promise<UserProfileResponse> {
    const guard = this.captureCurrentSession();
    const profile = await firstValueFrom(this.client.mePATCH(request));
    await this.coordination.withAvailableLock(() => {
      this.assertCurrentSession(guard.generation, guard.profile);
      this.profile.set(profile);
    });
    return profile;
  }

  async requestEmailChange(request: EmailChangeRequest): Promise<void> {
    const guard = this.captureCurrentSession();
    await firstValueFrom(this.client.emailChange(request));
    await this.coordination.withAvailableLock(() => {
      this.assertCurrentSession(guard.generation, guard.profile);
      this.profile.update(profile => profile ? { ...profile, emailVerified: false } : null);
    });
  }

  verifyEmail(token: string): Promise<void> { return firstValueFrom(this.client.verifyEmail({ token })); }
  resendVerification(request: EmailAccountRequest): Promise<unknown> { return firstValueFrom(this.client.resendVerification(request)); }
  forgotPassword(request: EmailAccountRequest): Promise<unknown> { return firstValueFrom(this.client.forgotPassword(request)); }
  resetPassword(request: ResetPasswordRequest): Promise<void> { return firstValueFrom(this.client.resetPassword(request)); }
  listExternalIdentities(): Promise<ExternalIdentityResponse[]> { return firstValueFrom(this.client.externalIdentitiesAll()); }
  async startLink(provider: string): Promise<string> {
    return (await firstValueFrom(this.client.startPOST(provider))).authorizationUrl;
  }
  unlink(provider: string): Promise<void> {
    return firstValueFrom(this.client.externalIdentities(provider));
  }

  private async refreshAccessTokenOnce(): Promise<void> {
    await this.spendRefreshCookie((response, generation) => this.publishToken(response, generation));
  }

  /**
   * Spends the refresh cookie inside the origin-wide auth lock. Two tabs presenting the same
   * cookie reads as a replay to the server, and it revokes the whole session family, so the round
   * trip has to be serialised across tabs and not only inside one.
   *
   * The deadline bounds the hold, never the request: a cancelled rotation the server already
   * committed leaves a consumed cookie in the jar and loses the family on the next restore. So on
   * expiry the lock is released, the round trip stays subscribed, and a late response is published
   * under a fresh lock where `publishToken()`'s generation assertion decides if it is still current.
   */
  private async spendRefreshCookie<T>(underLock: (response: AccessTokenResponse, generation: number) => T): Promise<T> {
    try {
      const held = await this.coordination.withAvailableLock(async () => {
        await this.ensurePurgeComplete();
        const generation = this.coordination.generation();
        const roundTrip = this.settleRefresh();
        let deadlineTimer!: ReturnType<typeof setTimeout>;
        const deadline = new Promise<undefined>(resolve => { deadlineTimer = setTimeout(() => resolve(undefined), REFRESH_LOCK_HOLD_MS); });
        let outcome: RefreshOutcome | undefined;
        try {
          outcome = await Promise.race([roundTrip, deadline]);
        } finally {
          clearTimeout(deadlineTimer);
        }
        if (!outcome) return { late: true as const, generation, roundTrip };
        return { late: false as const, published: await this.finishRefresh(outcome, generation, underLock) };
      });
      if (!held.late) return held.published.value;
      // Awaited outside the lock: re-acquiring first would hold it for the rest of the round trip.
      const late = await held.roundTrip;
      const published = await this.coordination.withAvailableLock(() => this.finishRefresh(late, held.generation, underLock));
      return published.value;
    } catch (error) {
      if (error instanceof AuthCoordinationUnavailableError) await this.invalidateAndPurgeIgnoringFailure();
      throw error;
    }
  }

  /** Never rejects: a rejection racing the hold deadline would surface as an unhandled rejection. */
  private settleRefresh(): Promise<RefreshOutcome> {
    return firstValueFrom(this.client.refresh()).then(
      (response): RefreshOutcome => ({ ok: true, response }),
      (error: unknown): RefreshOutcome => ({ ok: false, error })
    );
  }

  /** Caller already holds the auth lock. Result is boxed so the generic survives the `await`. */
  private async finishRefresh<T>(outcome: RefreshOutcome, generation: number, underLock: (response: AccessTokenResponse, generation: number) => T): Promise<{ value: T }> {
    try {
      if (!outcome.ok) throw outcome.error;
      return { value: underLock(outcome.response, generation) };
    } catch (error) {
      await this.clearFailedEstablishmentLocked(generation);
      throw error;
    }
  }

  private async prepareEstablishmentOrFailClosed(): Promise<number> {
    try {
      return await this.prepareEstablishment();
    } catch (error) {
      if (error instanceof AuthCoordinationUnavailableError) await this.invalidateAndPurgeIgnoringFailure();
      throw error;
    }
  }

  private async prepareEstablishment(): Promise<number> {
    return await this.coordination.withAvailableLock(async () => {
      await this.ensurePurgeComplete();
      return this.coordination.generation();
    });
  }

  /** Caller already holds the auth lock. Generation advance and token publication are one atomic step. */
  private advanceAndPublishSession(response: AccessTokenResponse): number {
    const sessionGeneration = this.coordination.advanceGeneration();
    this.tokens.set(response.accessToken);
    return sessionGeneration;
  }

  private async establishProfile(response: AccessTokenResponse, generation: number): Promise<UserProfileResponse> {
    let sessionGeneration = generation;
    try {
      await this.coordination.withAvailableLock(() => {
        this.assertGeneration(generation);
        sessionGeneration = this.advanceAndPublishSession(response);
      });
    } catch (error) {
      await this.clearFailedEstablishment(sessionGeneration);
      throw error;
    }
    return await this.completeProfileEstablishment(sessionGeneration);
  }

  /** Session generation already advanced and token published under the lock. */
  private async completeProfileEstablishment(sessionGeneration: number): Promise<UserProfileResponse> {
    try {
      const profile = await firstValueFrom(this.client.meGET());
      await this.coordination.withAvailableLock(() => {
        this.assertGeneration(sessionGeneration);
        this.coordination.bindProfile(profile.id, sessionGeneration);
        this.profile.set(profile);
      });
      await this.catalogSync.adopt(profile.id, () => this.isPublishedSessionCurrent(profile, sessionGeneration));
      await this.coordination.withAvailableLock(() => this.assertCurrentSession(sessionGeneration, profile));
      return profile;
    } catch (error) {
      await this.clearFailedEstablishment(sessionGeneration);
      throw error;
    }
  }

  private captureCurrentSession(): { generation: number; profile: UserProfileResponse } {
    this.coordination.requireAvailable();
    const profile = this.profile();
    if (!profile || !this.coordination.isProfileScopeCurrent(profile.id)) throw new Error('authSessionTransitionSuperseded');
    return { generation: this.coordination.generation(), profile };
  }

  private assertCurrentSession(generation: number, profile: UserProfileResponse): void {
    this.assertGeneration(generation);
    if (this.profile() !== profile || !this.coordination.isProfileScopeCurrent(profile.id, generation)) {
      throw new Error('authSessionTransitionSuperseded');
    }
  }

  private assertGeneration(generation: number): void {
    if (this.coordination.isPurgeRequired() || this.coordination.generation() !== generation) {
      throw new Error('authSessionTransitionSuperseded');
    }
  }

  private publishToken(response: AccessTokenResponse, generation: number): void {
    this.assertGeneration(generation);
    this.tokens.set(response.accessToken);
  }

  private isPublishedSessionCurrent(profile: UserProfileResponse, generation: number): boolean {
    return this.profile() === profile && this.coordination.isProfileScopeCurrent(profile.id, generation);
  }

  private async clearFailedEstablishment(generation: number): Promise<void> {
    await this.coordination.withLock(() => this.clearFailedEstablishmentLocked(generation));
  }

  /** Caller already holds the auth lock. */
  private async clearFailedEstablishmentLocked(generation: number): Promise<void> {
    if (this.coordination.generation() !== generation) {
      // A newer establishment owns the session now, and tearing that down origin-wide is not this
      // failure's call. No bound profile means this tab holds no newer session to protect, so the
      // token the failed establishment published goes with it instead of outliving it.
      if (!this.profile()) this.tokens.clear();
      return;
    }
    await this.invalidateAndPurgeIgnoringFailure();
  }

  private runTeardown<T>(action: () => Promise<T>): Promise<T> {
    const locks = globalThis.navigator?.locks;
    return locks ? this.coordination.withLock(action) : action();
  }

  private async invalidateAndPurge(): Promise<void> {
    this.tokens.clear();
    this.profile.set(null);
    this.coordination.invalidateSession();
    await this.ensurePurgeComplete();
  }

  private async invalidateAndPurgeIgnoringFailure(): Promise<void> {
    try {
      await this.invalidateAndPurge();
    } catch {
      // Secondary purge failure was logged; marker stays set for next coordinated establishment.
    }
  }

  private async ensurePurgeComplete(): Promise<void> {
    if (!this.coordination.isPurgeRequired()) return;
    try {
      await this.sessionScope.clear();
      this.coordination.markPurgeComplete();
    } catch (error) {
      logBoundaryError('auth.session-purge', error);
      throw error;
    }
  }
}
