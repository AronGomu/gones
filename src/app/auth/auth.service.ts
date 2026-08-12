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
import { AuthCoordinationUnavailableError, AuthSessionCoordinationService } from './auth-session-coordination.service';
import { SessionCatalogSyncService } from './session-catalog-sync.service';
import { SessionScopeService } from './session-scope.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = inject(Client);
  private readonly tokens = inject(ApiAccessTokenStore);
  private readonly sessionScope = inject(SessionScopeService);
  private readonly coordination = inject(AuthSessionCoordinationService);
  private readonly catalogSync = inject(SessionCatalogSyncService);
  private refreshFlight?: Observable<void>;

  readonly enabled = dataAuthority().authV1;
  readonly profile = signal<UserProfileResponse | null>(null);
  readonly bootstrapped = signal(!this.enabled);
  /** Startup refresh failed. Distinguishes an expired session from a visitor who never signed in. */
  readonly bootstrapFailed = signal(false);

  async bootstrap(): Promise<void> {
    if (!this.enabled || this.bootstrapped()) return;
    let generation: number | undefined;
    let profileEstablishmentStarted = false;
    try {
      generation = await this.prepareEstablishment();
      const response = await firstValueFrom(this.client.refresh());
      profileEstablishmentStarted = true;
      await this.establishProfile(response, generation);
    } catch (error) {
      this.bootstrapFailed.set(true);
      if (error instanceof AuthCoordinationUnavailableError) {
        await this.invalidateAndPurgeIgnoringFailure();
        throw error;
      }
      if (generation !== undefined && !profileEstablishmentStarted) await this.clearFailedEstablishment(generation);
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

  register(request: RegisterRequest): Promise<UserProfileResponse> {
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
    const generation = await this.prepareEstablishmentOrFailClosed();
    try {
      const response = await firstValueFrom(this.client.refresh());
      await this.coordination.withAvailableLock(() => this.publishToken(response, generation));
    } catch (error) {
      await this.clearFailedEstablishment(generation);
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

  private async establishProfile(response: AccessTokenResponse, generation: number): Promise<UserProfileResponse> {
    let sessionGeneration = generation;
    try {
      await this.coordination.withAvailableLock(() => {
        this.assertGeneration(generation);
        sessionGeneration = this.coordination.advanceGeneration();
        this.tokens.set(response.accessToken);
      });
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
    await this.coordination.withLock(async () => {
      if (this.coordination.generation() !== generation) return;
      await this.invalidateAndPurgeIgnoringFailure();
    });
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
