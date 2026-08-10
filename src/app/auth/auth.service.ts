import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, defer, finalize, firstValueFrom, map, shareReplay, tap, throwError } from 'rxjs';
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
import { SessionCatalogSyncService } from './session-catalog-sync.service';
import { SessionScopeService } from './session-scope.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = inject(Client);
  private readonly tokens = inject(ApiAccessTokenStore);
  private readonly sessionScope = inject(SessionScopeService);
  private readonly catalogSync = inject(SessionCatalogSyncService);
  private refreshFlight?: Observable<void>;

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
    try {
      await firstValueFrom(this.refreshAccessToken());
      await this.loadProfile();
      await this.catalogSync.adopt();
    } catch {
      this.bootstrapFailed.set(true);
      this.clear();
    } finally {
      this.bootstrapped.set(true);
    }
  }

  refreshAccessToken(): Observable<void> {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = defer(() => this.client.refresh()).pipe(
      tap(response => this.acceptToken(response)),
      map(() => undefined),
      catchError(error => {
        this.clear();
        return throwError(() => error);
      }),
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
  async login(request: LoginRequest): Promise<UserProfileResponse> {
    this.acceptToken(await firstValueFrom(this.client.login(request)));
    const profile = await this.loadProfile();
    await this.catalogSync.adopt();
    return profile;
  }

  register(request: RegisterRequest): Promise<UserProfileResponse> {
    return firstValueFrom(this.client.register(request));
  }

  async completeOAuth(request: CompleteOAuthRequest): Promise<OAuthFlowResponse> {
    const response = await firstValueFrom(this.client.complete(request));
    if (response.accessToken) {
      this.acceptToken({ accessToken: response.accessToken, expiresAt: response.expiresAt!, tokenType: response.tokenType ?? 'Bearer' });
      await this.loadProfile();
    }
    return response;
  }

  async verifyOAuthEmail(token: string, deviceLabel?: string): Promise<void> {
    const response = await firstValueFrom(this.client.verifyEmail2({ token, deviceLabel }));
    if (!response.accessToken) throw new Error('OAuth verification did not return an access token.');
    this.acceptToken({ accessToken: response.accessToken, expiresAt: response.expiresAt!, tokenType: response.tokenType ?? 'Bearer' });
    await this.loadProfile();
  }

  async logout(all = false): Promise<void> {
    try {
      await firstValueFrom(all ? this.client.logoutAll() : this.client.logout());
    } finally {
      this.clear();
    }
  }

  /**
   * Hard, irreversible account deletion. The server drops the account and clears the refresh cookie,
   * so the local session is dropped too — there is nothing left to refresh into.
   */
  async deleteAccount(currentPassword: string): Promise<void> {
    await firstValueFrom(this.client.meDELETE({ currentPassword }));
    this.clear();
  }

  clear(): void {
    this.tokens.clear();
    this.profile.set(null);
    this.sessionScope.clear();
  }

  async loadProfile(): Promise<UserProfileResponse> {
    const profile = await firstValueFrom(this.client.meGET());
    this.profile.set(profile);
    return profile;
  }

  async updateProfile(request: PatchUserProfileRequest): Promise<UserProfileResponse> {
    const profile = await firstValueFrom(this.client.mePATCH(request));
    this.profile.set(profile);
    return profile;
  }

  async requestEmailChange(request: EmailChangeRequest): Promise<void> {
    await firstValueFrom(this.client.emailChange(request));
    this.profile.update(profile => profile ? { ...profile, emailVerified: false } : null);
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

  private acceptToken(response: AccessTokenResponse): void {
    this.tokens.set(response.accessToken);
  }
}
