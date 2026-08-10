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
  LoginRequest,
  OAuthFlowResponse,
  PatchUserProfileRequest,
  RegisterRequest,
  ResetPasswordRequest,
  UserProfileResponse
} from '../api/generated/gones-api';
import { logBoundaryError } from '../shared/app-logger';
import { SessionCatalogSyncService } from './session-catalog-sync.service';
import { SessionScopeService } from './session-scope.service';

const AUTH_SESSION_TRANSITION_LOCK = 'gones.auth.session-transition';
const AUTH_PRIVATE_PURGE_REQUIRED_KEY = 'gones.auth.privatePurgeRequired';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = inject(Client);
  private readonly tokens = inject(ApiAccessTokenStore);
  private readonly sessionScope = inject(SessionScopeService);
  private readonly catalogSync = inject(SessionCatalogSyncService);
  private refreshFlight?: Observable<void>;
  private transitionTail: Promise<void> = Promise.resolve();
  private transitionCounter = 0;
  private latestTeardownTransition = 0;
  private purgeRequired = false;

  readonly enabled = dataAuthority().authV1;
  readonly profile = signal<UserProfileResponse | null>(null);
  readonly bootstrapped = signal(!this.enabled);
  /**
   * Startup refresh was attempted and rejected. Distinguishes "session expired" from "never signed
   * in": both leave `profile()` null, but only the former should be reported to the user.
   */
  readonly bootstrapFailed = signal(false);

  async bootstrap(): Promise<void> {
    if (!this.enabled || this.bootstrapped()) return;
    await this.runTransition(async (transitionId) => {
      try {
        await this.ensurePurgeCompleteUnlocked();
        const response = await firstValueFrom(this.client.refresh());
        this.publishTokenUnlocked(response, transitionId);
        const profile = await this.loadProfileUnlocked(transitionId);
        await this.adoptCatalogUnlocked(profile, transitionId);
        this.assertCurrentTransition(transitionId);
      } catch {
        this.markTeardown(transitionId);
        this.bootstrapFailed.set(true);
        await this.clearIgnoringPurgeFailureUnlocked();
      } finally {
        this.bootstrapped.set(true);
      }
    });
  }

  refreshAccessToken(): Observable<void> {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = defer(() => from(this.runTransition(async (transitionId) => {
      await this.ensurePurgeCompleteUnlocked();
      try {
        const response = await firstValueFrom(this.client.refresh());
        this.publishTokenUnlocked(response, transitionId);
      } catch (error) {
        this.markTeardown(transitionId);
        await this.clearPreservingPrimaryErrorUnlocked(error);
      }
    }))).pipe(
      map(() => undefined),
      finalize(() => { this.refreshFlight = undefined; }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.refreshFlight;
  }

  /**
   * The session exists the moment the profile lands, and from then on the server catalog is the
   * authority (ADR 0031/0032): `adopt()` replaces this browser's deck-archetype list. It never
   * throws and never uploads, so signing in offline changes nothing.
   */
  login(request: LoginRequest): Promise<UserProfileResponse> {
    return this.runTransition(async (transitionId) => {
      await this.ensurePurgeCompleteUnlocked();
      this.publishTokenUnlocked(await firstValueFrom(this.client.login(request)), transitionId);
      const profile = await this.loadProfileUnlocked(transitionId);
      await this.adoptCatalogUnlocked(profile, transitionId);
      this.assertCurrentTransition(transitionId);
      return profile;
    });
  }

  register(request: RegisterRequest): Promise<UserProfileResponse> {
    return firstValueFrom(this.client.register(request));
  }

  completeOAuth(request: CompleteOAuthRequest): Promise<OAuthFlowResponse> {
    return this.runTransition(async (transitionId) => {
      await this.ensurePurgeCompleteUnlocked();
      const response = await firstValueFrom(this.client.complete(request));
      if (response.accessToken) {
        this.publishTokenUnlocked({ accessToken: response.accessToken, expiresAt: response.expiresAt!, tokenType: response.tokenType ?? 'Bearer' }, transitionId);
        const profile = await this.loadProfileUnlocked(transitionId);
        await this.adoptCatalogUnlocked(profile, transitionId);
        this.assertCurrentTransition(transitionId);
      }
      return response;
    });
  }

  verifyOAuthEmail(token: string, deviceLabel?: string): Promise<void> {
    return this.runTransition(async (transitionId) => {
      await this.ensurePurgeCompleteUnlocked();
      const response = await firstValueFrom(this.client.verifyEmail2({ token, deviceLabel }));
      if (!response.accessToken) throw new Error('OAuth verification did not return an access token.');
      this.publishTokenUnlocked({ accessToken: response.accessToken, expiresAt: response.expiresAt!, tokenType: response.tokenType ?? 'Bearer' }, transitionId);
      const profile = await this.loadProfileUnlocked(transitionId);
      await this.adoptCatalogUnlocked(profile, transitionId);
      this.assertCurrentTransition(transitionId);
    });
  }

  logout(all = false): Promise<void> {
    return this.runTeardownTransition(async () => {
      let serverError: unknown;
      let serverFailed = false;
      try {
        await firstValueFrom(all ? this.client.logoutAll() : this.client.logout());
      } catch (error) {
        serverError = error;
        serverFailed = true;
      }
      await this.clearIgnoringPurgeFailureUnlocked();
      if (serverFailed) throw serverError;
    });
  }

  /**
   * Hard, irreversible account deletion. The server drops the account and clears the refresh cookie,
   * so the local session is dropped too — there is nothing left to refresh into.
   */
  deleteAccount(currentPassword: string): Promise<void> {
    return this.runTeardownTransition(async () => {
      await firstValueFrom(this.client.meDELETE({ currentPassword }));
      await this.clearIgnoringPurgeFailureUnlocked();
    });
  }

  clear(): Promise<void> {
    return this.runTeardownTransition(() => this.clearUnlocked());
  }

  updateProfile(request: PatchUserProfileRequest): Promise<UserProfileResponse> {
    return this.runTransition(async (transitionId) => {
      const profile = await firstValueFrom(this.client.mePATCH(request));
      this.assertCurrentTransition(transitionId);
      this.profile.set(profile);
      return profile;
    });
  }

  requestEmailChange(request: EmailChangeRequest): Promise<void> {
    return this.runTransition(async (transitionId) => {
      await firstValueFrom(this.client.emailChange(request));
      this.assertCurrentTransition(transitionId);
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

  private runTransition<T>(action: (transitionId: number) => Promise<T>): Promise<T> {
    const transitionId = ++this.transitionCounter;
    return this.enqueueTransition(transitionId, action);
  }

  private runTeardownTransition<T>(action: (transitionId: number) => Promise<T>): Promise<T> {
    const transitionId = ++this.transitionCounter;
    this.markTeardown(transitionId);
    return this.enqueueTransition(transitionId, action);
  }

  private async enqueueTransition<T>(transitionId: number, action: (transitionId: number) => Promise<T>): Promise<T> {
    const locks = globalThis.navigator?.locks;
    if (locks) return await locks.request(AUTH_SESSION_TRANSITION_LOCK, () => action(transitionId));
    const pending = this.transitionTail.then(() => action(transitionId), () => action(transitionId));
    this.transitionTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private markTeardown(transitionId: number): void {
    this.latestTeardownTransition = Math.max(this.latestTeardownTransition, transitionId);
  }

  private assertCurrentTransition(transitionId: number): void {
    if (this.latestTeardownTransition <= transitionId) return;
    this.tokens.clear();
    this.profile.set(null);
    throw new Error('authSessionTransitionSuperseded');
  }

  private publishTokenUnlocked(response: AccessTokenResponse, transitionId: number): void {
    this.assertCurrentTransition(transitionId);
    this.tokens.set(response.accessToken);
  }

  private async loadProfileUnlocked(transitionId: number): Promise<UserProfileResponse> {
    const profile = await firstValueFrom(this.client.meGET());
    this.assertCurrentTransition(transitionId);
    this.profile.set(profile);
    return profile;
  }

  private adoptCatalogUnlocked(profile: UserProfileResponse, transitionId: number): Promise<void> {
    return this.catalogSync.adopt(profile.id, () => this.profile() === profile && this.latestTeardownTransition <= transitionId);
  }

  private async clearUnlocked(): Promise<void> {
    this.tokens.clear();
    this.profile.set(null);
    this.markPurgeRequired();
    await this.ensurePurgeCompleteUnlocked();
  }

  private async ensurePurgeCompleteUnlocked(): Promise<void> {
    if (!this.purgeRequired && !this.isPurgeRequiredInBrowser()) return;
    try {
      await this.sessionScope.clear();
      this.purgeRequired = false;
      this.clearBrowserPurgeMarker();
    } catch (error) {
      this.markPurgeRequired();
      logBoundaryError('auth.session-purge', error);
      throw error;
    }
  }

  private markPurgeRequired(): void {
    this.purgeRequired = true;
    try {
      globalThis.localStorage?.setItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY, '1');
    } catch {
      // In-memory flag still blocks this tab; unavailable storage cannot coordinate other tabs.
    }
  }

  private isPurgeRequiredInBrowser(): boolean {
    try {
      return globalThis.localStorage?.getItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY) === '1';
    } catch {
      return false;
    }
  }

  private clearBrowserPurgeMarker(): void {
    try {
      globalThis.localStorage?.removeItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY);
    } catch {
      // Successful purge makes a stale safety marker harmless; a later session may purge once more.
    }
  }

  private async clearIgnoringPurgeFailureUnlocked(): Promise<void> {
    try {
      await this.clearUnlocked();
    } catch {
      // Secondary purge failure is logged by `ensurePurgeCompleteUnlocked`; next establishment retries.
    }
  }

  private async clearPreservingPrimaryErrorUnlocked(error: unknown): Promise<never> {
    await this.clearIgnoringPurgeFailureUnlocked();
    throw error;
  }
}
