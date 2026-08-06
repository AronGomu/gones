import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { dataAuthority } from '../config/data-authority';
import { ApiProblemError, joinApiUrl } from '../api/api-boundary';
import { I18nService } from '../i18n/i18n.service';
import { AuthFieldErrors, fieldErrorsFromProblem } from './auth-errors';
import { AuthService } from './auth.service';
import { registrationDestination } from './registration-gate';
import { safeReturnUrl } from './return-url';

@Component({ selector: 'gones-field-errors', standalone: true, template: `@for (message of messages() ?? []; track message) { <p class="field-error" role="alert">{{ message }}</p> }` })
export class FieldErrorsComponent { readonly messages = input<string[]>(); }

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, FieldErrorsComponent],
  template: `
    <section class="auth-shell" [attr.aria-labelledby]="titleId">
      <mat-card class="panel auth-card">
        <mat-card-content class="stack">
          <header>
            <p class="kicker">{{ i18n.t('auth.account') }}</p>
            <h1 [id]="titleId">{{ title() }}</h1>
          </header>

          @if (mode() === 'login') {
            <form class="auth-form" (ngSubmit)="submitLogin()" novalidate>
              <fieldset [disabled]="pending()">
                <label for="auth-email">{{ i18n.t('auth.email') }}</label>
                <input id="auth-email" data-cy="auth-email" type="email" autocomplete="email" required [(ngModel)]="email" name="email" [attr.aria-invalid]="hasError('email')" [attr.aria-describedby]="hasError('email') ? 'auth-email-error' : null">
                <gones-field-errors id="auth-email-error" [messages]="fieldErrors()['email']" />
                <label for="auth-password">{{ i18n.t('auth.password') }}</label>
                <input id="auth-password" data-cy="auth-password" type="password" autocomplete="current-password" required [(ngModel)]="password" name="password" [attr.aria-invalid]="hasError('password')" [attr.aria-describedby]="hasError('password') ? 'auth-password-error' : null">
                <gones-field-errors id="auth-password-error" [messages]="fieldErrors()['password']" />
                <button mat-flat-button class="home-primary-action" data-cy="auth-submit" type="submit">{{ pending() ? i18n.t('auth.signingIn') : i18n.t('auth.signIn') }}</button>
              </fieldset>
            </form>
            <div class="oauth-grid" [attr.aria-label]="i18n.t('auth.socialSignIn')">
              <button mat-stroked-button type="button" data-cy="oauth-google" (click)="startOAuth('google')">{{ i18n.t('auth.continueGoogle') }}</button>
              <button mat-stroked-button type="button" data-cy="oauth-facebook" (click)="startOAuth('facebook')">{{ i18n.t('auth.continueFacebook') }}</button>
            </div>
            <nav class="auth-links" [attr.aria-label]="i18n.t('auth.accountLinks')">
              <a routerLink="/register">{{ i18n.t('auth.createAccount') }}</a>
              <a routerLink="/forgot-password">{{ i18n.t('auth.forgotPassword') }}</a>
            </nav>
          } @else if (mode() === 'register') {
            <form class="auth-form" (ngSubmit)="submitRegister()" novalidate>
              <fieldset [disabled]="pending()">
                <label for="register-email">{{ i18n.t('auth.email') }}</label>
                <input id="register-email" data-cy="auth-email" type="email" autocomplete="email" required [(ngModel)]="email" name="email" [attr.aria-invalid]="hasError('email')" [attr.aria-describedby]="hasError('email') ? 'register-email-error' : null"><gones-field-errors id="register-email-error" [messages]="fieldErrors()['email']" />
                <label for="register-username">{{ i18n.t('auth.username') }}</label>
                <input id="register-username" data-cy="auth-username" autocomplete="username" required [(ngModel)]="username" name="username" [attr.aria-invalid]="hasError('username')" [attr.aria-describedby]="hasError('username') ? 'register-username-error' : null"><gones-field-errors id="register-username-error" [messages]="fieldErrors()['username']" />
                <div class="auth-name-grid">
                  <div><label for="register-first">{{ i18n.t('auth.firstName') }}</label><input id="register-first" required autocomplete="given-name" [(ngModel)]="firstName" name="firstName" [attr.aria-invalid]="hasError('firstName')" [attr.aria-describedby]="hasError('firstName') ? 'register-first-error' : null"><gones-field-errors id="register-first-error" [messages]="fieldErrors()['firstName']" /></div>
                  <div><label for="register-last">{{ i18n.t('auth.lastName') }}</label><input id="register-last" required autocomplete="family-name" [(ngModel)]="lastName" name="lastName" [attr.aria-invalid]="hasError('lastName')" [attr.aria-describedby]="hasError('lastName') ? 'register-last-error' : null"><gones-field-errors id="register-last-error" [messages]="fieldErrors()['lastName']" /></div>
                </div>
                <label for="register-password">{{ i18n.t('auth.password') }}</label>
                <input id="register-password" data-cy="auth-password" type="password" autocomplete="new-password" minlength="12" required [(ngModel)]="password" name="password" [attr.aria-invalid]="hasError('password')" [attr.aria-describedby]="hasError('password') ? 'register-password-error' : null"><gones-field-errors id="register-password-error" [messages]="fieldErrors()['password']" />
                <button mat-flat-button class="home-primary-action" data-cy="auth-submit" type="submit">{{ pending() ? i18n.t('auth.creatingAccount') : i18n.t('auth.createAccount') }}</button>
              </fieldset>
            </form>
            <div class="oauth-grid"><button mat-stroked-button type="button" (click)="startOAuth('google')">{{ i18n.t('auth.continueGoogle') }}</button><button mat-stroked-button type="button" (click)="startOAuth('facebook')">{{ i18n.t('auth.continueFacebook') }}</button></div>
            <a routerLink="/login">{{ i18n.t('auth.haveAccount') }}</a>
          } @else if (mode() === 'complete-profile') {
            <p class="muted">{{ i18n.t('auth.completeProfileHelp') }}</p>
            <form class="auth-form" (ngSubmit)="submitCompleteProfile()" novalidate><fieldset [disabled]="pending()">
              <label for="complete-email">{{ i18n.t('auth.email') }}</label><input id="complete-email" type="email" required [(ngModel)]="email" name="email" [attr.aria-invalid]="hasError('email')" [attr.aria-describedby]="hasError('email') ? 'complete-email-error' : null"><gones-field-errors id="complete-email-error" [messages]="fieldErrors()['email']" />
              <label for="complete-username">{{ i18n.t('auth.username') }}</label><input id="complete-username" required [(ngModel)]="username" name="username" [attr.aria-invalid]="hasError('username')" [attr.aria-describedby]="hasError('username') ? 'complete-username-error' : null"><gones-field-errors id="complete-username-error" [messages]="fieldErrors()['username']" />
              <div class="auth-name-grid"><div><label for="complete-first">{{ i18n.t('auth.firstName') }}</label><input id="complete-first" required [(ngModel)]="firstName" name="firstName" [attr.aria-invalid]="hasError('firstName')" [attr.aria-describedby]="hasError('firstName') ? 'complete-first-error' : null"><gones-field-errors id="complete-first-error" [messages]="fieldErrors()['firstName']" /></div><div><label for="complete-last">{{ i18n.t('auth.lastName') }}</label><input id="complete-last" required [(ngModel)]="lastName" name="lastName" [attr.aria-invalid]="hasError('lastName')" [attr.aria-describedby]="hasError('lastName') ? 'complete-last-error' : null"><gones-field-errors id="complete-last-error" [messages]="fieldErrors()['lastName']" /></div></div>
              <button mat-flat-button class="home-primary-action" data-cy="complete-profile-submit" type="submit">{{ pending() ? i18n.t('common.saving') : i18n.t('auth.completeProfile') }}</button>
            </fieldset></form>
          } @else if (mode() === 'verify-email') {
            <p class="muted">{{ i18n.t('auth.verifyHelp') }}</p>
            @if (token) { <button mat-flat-button class="home-primary-action" data-cy="verify-email-submit" type="button" [disabled]="pending()" (click)="submitVerification()">{{ i18n.t('auth.verifyEmail') }}</button> }
            <form class="auth-form" (ngSubmit)="resendVerification()"><fieldset [disabled]="pending()">
              <label for="verify-email-address">{{ i18n.t('auth.email') }}</label><input id="verify-email-address" data-cy="verify-email-address" type="email" autocomplete="email" required [(ngModel)]="email" name="email">
              <button mat-stroked-button type="submit" data-cy="resend-verification">{{ i18n.t('auth.resendVerification') }}</button>
            </fieldset></form>
            <a routerLink="/login">{{ i18n.t('auth.backToLogin') }}</a>
          } @else if (mode() === 'forgot-password') {
            <p class="muted">{{ i18n.t('auth.forgotHelp') }}</p>
            <form class="auth-form" (ngSubmit)="submitForgotPassword()"><fieldset [disabled]="pending()"><label for="forgot-email">{{ i18n.t('auth.email') }}</label><input id="forgot-email" type="email" autocomplete="email" required [(ngModel)]="email" name="email"><button mat-flat-button class="home-primary-action" type="submit">{{ i18n.t('auth.sendReset') }}</button></fieldset></form>
          } @else if (mode() === 'reset-password') {
            <form class="auth-form" (ngSubmit)="submitResetPassword()"><fieldset [disabled]="pending()"><label for="reset-password">{{ i18n.t('auth.newPassword') }}</label><input id="reset-password" type="password" autocomplete="new-password" minlength="12" required [(ngModel)]="password" name="password" [attr.aria-invalid]="hasError('password')" [attr.aria-describedby]="hasError('password') ? 'reset-password-error' : null"><gones-field-errors id="reset-password-error" [messages]="fieldErrors()['password']" /><button mat-flat-button class="home-primary-action" type="submit">{{ i18n.t('auth.resetPassword') }}</button></fieldset></form>
          }

          @if (error()) { <p class="error" role="alert" data-cy="auth-error">{{ error() }}</p> }
          @if (status()) { <p class="settings-saved" role="status" aria-live="polite" data-cy="auth-status">{{ status() }}</p> }
        </mat-card-content>
      </mat-card>
    </section>
  `
})
export class AuthEntryComponent {
  readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly mode = signal(this.route.snapshot.data['mode'] as AuthMode);
  readonly titleId = 'auth-page-title';
  readonly pending = signal(false);
  readonly error = signal('');
  readonly status = signal('');
  readonly fieldErrors = signal<AuthFieldErrors>({});
  email = this.route.snapshot.queryParamMap.get('email') ?? '';
  username = this.route.snapshot.queryParamMap.get('username') ?? '';
  firstName = this.route.snapshot.queryParamMap.get('firstName') ?? '';
  lastName = this.route.snapshot.queryParamMap.get('lastName') ?? '';
  password = '';
  readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';
  private readonly completionTicket = this.route.snapshot.queryParamMap.get('ticket') ?? this.route.snapshot.queryParamMap.get('completionTicket') ?? '';

  title(): string {
    const keys: Record<AuthMode, Parameters<I18nService['t']>[0]> = { login: 'auth.signIn', register: 'auth.createAccount', 'complete-profile': 'auth.completeProfile', 'verify-email': 'auth.verifyEmail', 'forgot-password': 'auth.forgotPassword', 'reset-password': 'auth.resetPassword' };
    return this.i18n.t(keys[this.mode()]);
  }

  hasError(name: string): boolean { return Boolean(this.fieldErrors()[name]?.length); }

  async submitLogin(): Promise<void> {
    await this.run(async () => {
      await this.auth.login({ email: this.email, password: this.password, deviceLabel: deviceLabel() });
      await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'), '/profile'));
    });
  }

  async submitRegister(): Promise<void> {
    await this.run(async () => {
      const profile = await this.auth.register({ email: this.email, username: this.username, password: this.password, firstName: this.firstName, lastName: this.lastName });
      await this.router.navigate([registrationDestination(profile)], { queryParams: { email: profile.email, registered: 'true' } });
    });
  }

  async submitCompleteProfile(): Promise<void> {
    if (!this.completionTicket) { this.error.set(this.i18n.t('auth.invalidOAuth')); return; }
    await this.run(async () => {
      const response = await this.auth.completeOAuth({ completionTicket: this.completionTicket, email: this.email, username: this.username, firstName: this.firstName, lastName: this.lastName, deviceLabel: deviceLabel() });
      if (response.status === 'email_verification_required') await this.router.navigate(['/verify-email'], { queryParams: { email: this.email, oauth: 'true' } });
      else await this.router.navigate(['/profile']);
    });
  }

  async submitVerification(): Promise<void> {
    await this.run(async () => {
      if (this.route.snapshot.queryParamMap.get('oauth') === 'true') {
        await this.auth.verifyOAuthEmail(this.token, deviceLabel());
        await this.router.navigate(['/profile']);
      } else {
        await this.auth.verifyEmail(this.token);
        this.status.set(this.i18n.t('auth.verifiedStatus'));
      }
    });
  }

  async resendVerification(): Promise<void> {
    await this.run(async () => { await this.auth.resendVerification({ email: this.email }); this.status.set(this.i18n.t('auth.resendStatus')); });
  }

  async submitForgotPassword(): Promise<void> {
    await this.run(async () => { await this.auth.forgotPassword({ email: this.email }); this.status.set(this.i18n.t('auth.forgotStatus')); });
  }

  async submitResetPassword(): Promise<void> {
    if (!this.token) { this.error.set(this.i18n.t('auth.invalidReset')); return; }
    await this.run(async () => { await this.auth.resetPassword({ token: this.token, password: this.password }); this.status.set(this.i18n.t('auth.resetStatus')); });
  }

  startOAuth(provider: 'google' | 'facebook'): void {
    window.location.assign(joinApiUrl(dataAuthority().apiBaseUrl, `/api/auth/oauth/${provider}/start`));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true); this.error.set(''); this.status.set(''); this.fieldErrors.set({});
    try { await action(); }
    catch (error) {
      this.fieldErrors.set(fieldErrorsFromProblem(error));
      this.error.set(error instanceof ApiProblemError && error.status === 429 ? this.i18n.t('auth.rateLimited') : this.i18n.t('auth.genericError'));
    } finally { this.pending.set(false); }
  }
}

type AuthMode = 'login' | 'register' | 'complete-profile' | 'verify-email' | 'forgot-password' | 'reset-password';
function deviceLabel(): string { return `${navigator.platform || 'Browser'} · ${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'}`.slice(0, 100); }
