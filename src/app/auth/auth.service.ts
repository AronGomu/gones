import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, defer, finalize, firstValueFrom, map, shareReplay, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
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
  RefreshSessionResponse,
  RegisterRequest,
  ResetPasswordRequest,
  UserProfileResponse
} from '../api/generated/gones-api';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = inject(Client);
  private readonly tokens = inject(ApiAccessTokenStore);
  private refreshFlight?: Observable<void>;

  readonly enabled = environment.features.authV1;
  readonly profile = signal<UserProfileResponse | null>(null);
  readonly bootstrapped = signal(!this.enabled);

  async bootstrap(): Promise<void> {
    if (!this.enabled || this.bootstrapped()) return;
    try {
      await firstValueFrom(this.refreshAccessToken());
      await this.loadProfile();
    } catch {
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

  async login(request: LoginRequest): Promise<UserProfileResponse> {
    this.acceptToken(await firstValueFrom(this.client.login(request)));
    return this.loadProfile();
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

  clear(): void {
    this.tokens.clear();
    this.profile.set(null);
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
  listSessions(): Promise<RefreshSessionResponse[]> { return firstValueFrom(this.client.sessionsAll()); }
  revokeSession(id: string): Promise<void> { return firstValueFrom(this.client.sessions(id)); }
  listExternalIdentities(): Promise<ExternalIdentityResponse[]> { return firstValueFrom(this.client.externalIdentitiesAll()); }
  async startLink(provider: string, currentPassword?: string): Promise<string> {
    return (await firstValueFrom(this.client.startPOST(provider, { currentPassword }))).authorizationUrl;
  }
  unlink(provider: string, currentPassword?: string): Promise<void> {
    return firstValueFrom(this.client.externalIdentities(provider, { currentPassword }));
  }

  private acceptToken(response: AccessTokenResponse): void {
    this.tokens.set(response.accessToken);
  }
}
