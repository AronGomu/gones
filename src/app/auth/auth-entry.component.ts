import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { dataAuthority } from '../config/data-authority';
import { ApiProblemError, joinApiUrl } from '../api/api-boundary';
import { I18nService } from '../i18n/i18n.service';
import { BackButtonComponent } from '../shared/back-button.component';
import { AuthFieldErrors, fieldErrorsFromProblem } from './auth-errors';
import { AuthService } from './auth.service';
import { authReturnLink, AuthMode } from './auth-return-link';
import { LastVisitedUrlService, loginDestination } from './last-visited-url.service';
import { passwordConfirmationErrors } from './password-confirmation';
import { isValidLoginEmail, isValidLoginPassword, loginFormIsValid } from './login-validation';
import { safeReturnUrl } from './return-url';

@Component({
  selector: 'gones-field-errors',
  standalone: true,
  template: `@for (message of messages() ?? []; track message) { <p class="field-error" role="alert" data-cy="field-error-message">{{ message }}</p> }`
})
export class FieldErrorsComponent { readonly messages = input<string[]>(); }

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, FieldErrorsComponent, BackButtonComponent],
  template: `
    @if (returnLink(); as link) {
      <gones-back-button [link]="link" [label]="returnLabel()" position="top" data-cy="auth-back-button-top" />
    }
    <section class="auth-shell" data-cy="auth-shell" [attr.aria-labelledby]="titleId">
      <mat-card class="panel auth-card" data-cy="auth-card">
        <mat-card-content class="stack" data-cy="auth-card-content">
          <header data-cy="auth-header">
            <h1 [id]="titleId" data-cy="auth-title">{{ title() }}</h1>
          </header>

          @if (mode() === 'login') {
            <form class="auth-form" data-cy="login-form" (ngSubmit)="submitLogin()" novalidate>
              <fieldset [disabled]="pending()" data-cy="login-fieldset">
                <label for="auth-email" data-cy="login-email-label">{{ i18n.t('auth.email') }}</label>
                <input id="auth-email" data-cy="auth-email" type="email" autocomplete="email" required [(ngModel)]="email" name="email" [attr.aria-invalid]="hasError('email')" [attr.aria-describedby]="hasError('email') ? 'auth-email-error' : null">
                <gones-field-errors id="auth-email-error" data-cy="login-email-error" [messages]="fieldErrors()['email']" />
                @if (emailInvalid()) { <p class="field-error" role="alert" data-cy="login-email-validity">{{ i18n.t('auth.emailInvalid') }}</p> }
                <label for="auth-password" data-cy="login-password-label">{{ i18n.t('auth.password') }}</label>
                <input id="auth-password" data-cy="auth-password" type="password" autocomplete="current-password" required [(ngModel)]="password" name="password" [attr.aria-invalid]="hasError('password')" [attr.aria-describedby]="hasError('password') ? 'auth-password-error' : null">
                <gones-field-errors id="auth-password-error" data-cy="login-password-error" [messages]="fieldErrors()['password']" />
                @if (passwordInvalid()) { <p class="field-error" role="alert" data-cy="login-password-validity">{{ i18n.t('auth.passwordTooShort') }}</p> }
                <button mat-flat-button class="home-primary-action auth-submit" [class.auth-submit--ready]="loginValid()" [class.auth-submit--idle]="!loginValid()" [disabled]="!loginValid()" data-cy="auth-submit" type="submit">{{ pending() ? i18n.t('auth.signingIn') : i18n.t('auth.signIn') }}</button>
              </fieldset>
            </form>
            <div class="oauth-grid" data-cy="login-oauth-grid" [attr.aria-label]="i18n.t('auth.socialSignIn')">
              <button mat-stroked-button class="oauth-button" type="button" data-cy="oauth-google" (click)="startOAuth('google')">
                <span class="oauth-button__label" data-cy="oauth-google-label">{{ i18n.t('auth.continueWith') }}</span>
                <img class="oauth-button__logo" src="assets/brand/google.svg" [attr.alt]="i18n.t('auth.continueGoogle')" data-cy="oauth-google-logo">
              </button>
              <button mat-stroked-button class="oauth-button" type="button" data-cy="oauth-facebook" (click)="startOAuth('facebook')">
                <span class="oauth-button__label" data-cy="oauth-facebook-label">{{ i18n.t('auth.continueWith') }}</span>
                <img class="oauth-button__logo" src="assets/brand/facebook.svg" [attr.alt]="i18n.t('auth.continueFacebook')" data-cy="oauth-facebook-logo">
              </button>
            </div>
            <nav class="auth-links" data-cy="login-links" [attr.aria-label]="i18n.t('auth.accountLinks')">
              <a routerLink="/register" [queryParams]="returnQueryParams()" data-cy="login-register-link">{{ i18n.t('auth.createAccount') }}</a>
              <a routerLink="/forgot-password" data-cy="login-forgot-link">{{ i18n.t('auth.forgotPassword') }}</a>
            </nav>
          } @else if (mode() === 'register') {
            <form class="auth-form" data-cy="register-form" (ngSubmit)="submitRegister()" novalidate>
              <fieldset [disabled]="pending()" data-cy="register-fieldset">
                <label for="register-email" data-cy="register-email-label">{{ i18n.t('auth.email') }}</label>
                <input id="register-email" [attr.data-cy]="'auth-email'" type="email" autocomplete="email" required [(ngModel)]="email" name="email" [attr.aria-invalid]="hasError('email')" [attr.aria-describedby]="hasError('email') ? 'register-email-error' : null"><gones-field-errors id="register-email-error" data-cy="register-email-error" [messages]="fieldErrors()['email']" />
                <label for="register-username" data-cy="register-username-label">{{ i18n.t('auth.username') }}</label>
                <input id="register-username" data-cy="auth-username" autocomplete="username" required [(ngModel)]="username" name="username" [attr.aria-invalid]="hasError('username')" [attr.aria-describedby]="hasError('username') ? 'register-username-error' : null"><gones-field-errors id="register-username-error" data-cy="register-username-error" [messages]="fieldErrors()['username']" />
                <div class="auth-name-grid" data-cy="register-name-grid">
                  <div data-cy="register-first-wrap"><label for="register-first" data-cy="register-first-label">{{ i18n.t('auth.firstName') }}</label><input id="register-first" data-cy="register-first" required autocomplete="given-name" [(ngModel)]="firstName" name="firstName" [attr.aria-invalid]="hasError('firstName')" [attr.aria-describedby]="hasError('firstName') ? 'register-first-error' : null"><gones-field-errors id="register-first-error" data-cy="register-first-error" [messages]="fieldErrors()['firstName']" /></div>
                  <div data-cy="register-last-wrap"><label for="register-last" data-cy="register-last-label">{{ i18n.t('auth.lastName') }}</label><input id="register-last" data-cy="register-last" required autocomplete="family-name" [(ngModel)]="lastName" name="lastName" [attr.aria-invalid]="hasError('lastName')" [attr.aria-describedby]="hasError('lastName') ? 'register-last-error' : null"><gones-field-errors id="register-last-error" data-cy="register-last-error" [messages]="fieldErrors()['lastName']" /></div>
                </div>
                <label for="register-password" data-cy="register-password-label">{{ i18n.t('auth.password') }}</label>
                <input id="register-password" [attr.data-cy]="'auth-password'" type="password" autocomplete="new-password" minlength="12" required [(ngModel)]="password" name="password" [attr.aria-invalid]="hasError('password')" [attr.aria-describedby]="hasError('password') ? 'register-password-error' : null"><gones-field-errors id="register-password-error" data-cy="register-password-error" [messages]="fieldErrors()['password']" />
                <label for="register-confirm-password" data-cy="register-confirm-password-label">{{ i18n.t('auth.confirmPassword') }}</label>
                <input id="register-confirm-password" data-cy="auth-confirm-password" type="password" autocomplete="new-password" minlength="12" required [(ngModel)]="confirmPassword" name="confirmPassword" [attr.aria-invalid]="hasError('confirmPassword')" [attr.aria-describedby]="hasError('confirmPassword') ? 'register-confirm-password-error' : null">
                <gones-field-errors id="register-confirm-password-error" data-cy="register-confirm-password-error" [messages]="fieldErrors()['confirmPassword']" />
                <button mat-flat-button class="home-primary-action" [attr.data-cy]="'auth-submit'" type="submit">{{ pending() ? i18n.t('auth.creatingAccount') : i18n.t('auth.createAccount') }}</button>
              </fieldset>
            </form>
            <div class="oauth-grid" data-cy="register-oauth-grid" [attr.aria-label]="i18n.t('auth.socialSignIn')">
              <button mat-stroked-button class="oauth-button" type="button" data-cy="register-oauth-google" (click)="startOAuth('google')">
                <span class="oauth-button__label" data-cy="register-oauth-google-label">{{ i18n.t('auth.continueWith') }}</span>
                <img class="oauth-button__logo" src="assets/brand/google.svg" [attr.alt]="i18n.t('auth.continueGoogle')" data-cy="register-oauth-google-logo">
              </button>
              <button mat-stroked-button class="oauth-button" type="button" data-cy="register-oauth-facebook" (click)="startOAuth('facebook')">
                <span class="oauth-button__label" data-cy="register-oauth-facebook-label">{{ i18n.t('auth.continueWith') }}</span>
                <img class="oauth-button__logo" src="assets/brand/facebook.svg" [attr.alt]="i18n.t('auth.continueFacebook')" data-cy="register-oauth-facebook-logo">
              </button>
            </div>
            <a routerLink="/login" [queryParams]="returnQueryParams()" data-cy="register-login-link">{{ i18n.t('auth.haveAccount') }}</a>
          } @else if (mode() === 'complete-profile') {
            <p class="muted" data-cy="complete-help">{{ i18n.t('auth.completeProfileHelp') }}</p>
            <form class="auth-form" data-cy="complete-form" (ngSubmit)="submitCompleteProfile()" novalidate><fieldset [disabled]="pending()" data-cy="complete-fieldset">
              <label for="complete-email" data-cy="complete-email-label">{{ i18n.t('auth.email') }}</label><input id="complete-email" data-cy="complete-email" type="email" required [(ngModel)]="email" name="email" [attr.aria-invalid]="hasError('email')" [attr.aria-describedby]="hasError('email') ? 'complete-email-error' : null"><gones-field-errors id="complete-email-error" data-cy="complete-email-error" [messages]="fieldErrors()['email']" />
              <label for="complete-username" data-cy="complete-username-label">{{ i18n.t('auth.username') }}</label><input id="complete-username" data-cy="complete-username" required [(ngModel)]="username" name="username" [attr.aria-invalid]="hasError('username')" [attr.aria-describedby]="hasError('username') ? 'complete-username-error' : null"><gones-field-errors id="complete-username-error" data-cy="complete-username-error" [messages]="fieldErrors()['username']" />
              <div class="auth-name-grid" data-cy="complete-name-grid"><div data-cy="complete-first-wrap"><label for="complete-first" data-cy="complete-first-label">{{ i18n.t('auth.firstName') }}</label><input id="complete-first" data-cy="complete-first" required [(ngModel)]="firstName" name="firstName" [attr.aria-invalid]="hasError('firstName')" [attr.aria-describedby]="hasError('firstName') ? 'complete-first-error' : null"><gones-field-errors id="complete-first-error" data-cy="complete-first-error" [messages]="fieldErrors()['firstName']" /></div><div data-cy="complete-last-wrap"><label for="complete-last" data-cy="complete-last-label">{{ i18n.t('auth.lastName') }}</label><input id="complete-last" data-cy="complete-last" required [(ngModel)]="lastName" name="lastName" [attr.aria-invalid]="hasError('lastName')" [attr.aria-describedby]="hasError('lastName') ? 'complete-last-error' : null"><gones-field-errors id="complete-last-error" data-cy="complete-last-error" [messages]="fieldErrors()['lastName']" /></div></div>
              <button mat-flat-button class="home-primary-action" data-cy="complete-profile-submit" type="submit">{{ pending() ? i18n.t('common.saving') : i18n.t('auth.completeProfile') }}</button>
            </fieldset></form>
          } @else if (mode() === 'verify-email') {
            <p class="muted" data-cy="verify-help">{{ i18n.t('auth.verifyHelp') }}</p>
            @if (token) { <button mat-flat-button class="home-primary-action" data-cy="verify-email-submit" type="button" [disabled]="pending()" (click)="submitVerification()">{{ i18n.t('auth.verifyEmail') }}</button> }
            <form class="auth-form" data-cy="verify-form" (ngSubmit)="resendVerification()"><fieldset [disabled]="pending()" data-cy="verify-fieldset">
              <label for="verify-email-address" data-cy="verify-email-address-label">{{ i18n.t('auth.email') }}</label><input id="verify-email-address" data-cy="verify-email-address" type="email" autocomplete="email" required [(ngModel)]="email" name="email">
              <button mat-stroked-button type="submit" data-cy="resend-verification">{{ i18n.t('auth.resendVerification') }}</button>
            </fieldset></form>
            <a routerLink="/login" [queryParams]="returnQueryParams()" data-cy="verify-login-link">{{ i18n.t('auth.backToLogin') }}</a>
          } @else if (mode() === 'forgot-password') {
            <p class="muted" data-cy="forgot-help">{{ i18n.t('auth.forgotHelp') }}</p>
            <form class="auth-form" data-cy="forgot-form" (ngSubmit)="submitForgotPassword()"><fieldset [disabled]="pending()" data-cy="forgot-fieldset"><label for="forgot-email" data-cy="forgot-email-label">{{ i18n.t('auth.email') }}</label><input id="forgot-email" data-cy="forgot-email" type="email" autocomplete="email" required [(ngModel)]="email" name="email"><button mat-flat-button class="home-primary-action" data-cy="forgot-submit" type="submit">{{ i18n.t('auth.sendReset') }}</button></fieldset></form>
          } @else if (mode() === 'reset-password') {
            <form class="auth-form" data-cy="reset-form" (ngSubmit)="submitResetPassword()"><fieldset [disabled]="pending()" data-cy="reset-fieldset"><label for="reset-password" data-cy="reset-password-label">{{ i18n.t('auth.newPassword') }}</label><input id="reset-password" data-cy="reset-password" type="password" autocomplete="new-password" minlength="12" required [(ngModel)]="password" name="password" [attr.aria-invalid]="hasError('password')" [attr.aria-describedby]="hasError('password') ? 'reset-password-error' : null"><gones-field-errors id="reset-password-error" data-cy="reset-password-error" [messages]="fieldErrors()['password']" /><button mat-flat-button class="home-primary-action" data-cy="reset-submit" type="submit">{{ i18n.t('auth.resetPassword') }}</button></fieldset></form>
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
  private readonly lastVisited = inject(LastVisitedUrlService);
  readonly mode = signal(this.route.snapshot.data['mode'] as AuthMode);
  readonly titleId = 'auth-page-title';
  readonly pending = signal(false);
  readonly error = signal('');
  readonly status = signal('');
  readonly fieldErrors = signal<AuthFieldErrors>({});
  readonly email = signal(this.route.snapshot.queryParamMap.get('email') ?? '');
  username = this.route.snapshot.queryParamMap.get('username') ?? '';
  firstName = this.route.snapshot.queryParamMap.get('firstName') ?? '';
  lastName = this.route.snapshot.queryParamMap.get('lastName') ?? '';
  readonly password = signal('');
  confirmPassword = '';
  readonly loginValid = computed(() => loginFormIsValid(this.email(), this.password()));
  readonly emailInvalid = computed(() => this.email().length > 0 && !isValidLoginEmail(this.email()));
  readonly passwordInvalid = computed(() => this.password().length > 0 && !isValidLoginPassword(this.password()));
  readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';
  readonly returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'), '');
  readonly returnQueryParams = computed(() => this.returnUrl ? { returnUrl: this.returnUrl } : {});
  private readonly completionTicket = this.route.snapshot.queryParamMap.get('ticket') ?? this.route.snapshot.queryParamMap.get('completionTicket') ?? '';
  readonly returnLink = computed(() => authReturnLink(this.mode()));
  readonly returnLabel = computed(() => this.returnLink()?.[0] === '/' ? this.i18n.t('nav.returnToMenu') : this.i18n.t('auth.backToLogin'));

  title(): string {
    const keys: Record<AuthMode, Parameters<I18nService['t']>[0]> = { login: 'auth.signIn', register: 'auth.createAccount', 'complete-profile': 'auth.completeProfile', 'verify-email': 'auth.verifyEmail', 'forgot-password': 'auth.forgotPassword', 'reset-password': 'auth.resetPassword' };
    return this.i18n.t(keys[this.mode()]);
  }

  hasError(name: string): boolean { return Boolean(this.fieldErrors()[name]?.length); }

  async submitLogin(): Promise<void> {
    await this.run(async () => {
      await this.auth.login({ email: this.email(), password: this.password(), deviceLabel: deviceLabel() });
      await this.router.navigateByUrl(loginDestination(this.route.snapshot.queryParamMap.get('returnUrl'), this.lastVisited.last()));
    });
  }

  async submitRegister(): Promise<void> {
    const mismatch = passwordConfirmationErrors(this.password(), this.confirmPassword, this.i18n.t('auth.passwordMismatch'));
    if (Object.keys(mismatch).length) { this.fieldErrors.set(mismatch); this.error.set(this.i18n.t('auth.passwordMismatch')); return; }
    await this.run(async () => {
      await this.auth.register({
        email: this.email(),
        username: this.username,
        password: this.password(),
        firstName: this.firstName,
        lastName: this.lastName,
        returnUrl: this.returnUrl || undefined
      });
      await this.router.navigate(['/verify-email'], {
        queryParams: { email: this.email(), registered: 'true', ...(this.returnUrl ? { returnUrl: this.returnUrl } : {}) }
      });
    });
  }

  async submitCompleteProfile(): Promise<void> {
    if (!this.completionTicket) { this.error.set(this.i18n.t('auth.invalidOAuth')); return; }
    await this.run(async () => {
      const response = await this.auth.completeOAuth({ completionTicket: this.completionTicket, email: this.email(), username: this.username, firstName: this.firstName, lastName: this.lastName, deviceLabel: deviceLabel() });
      if (response.status === 'email_verification_required') await this.router.navigate(['/verify-email'], { queryParams: { email: this.email(), oauth: 'true' } });
      else await this.router.navigate(['/settings/account']);
    });
  }

  async submitVerification(): Promise<void> {
    await this.run(async () => {
      if (this.route.snapshot.queryParamMap.get('oauth') === 'true') {
        await this.auth.verifyOAuthEmail(this.token, deviceLabel());
        await this.router.navigate(['/settings/account']);
      } else {
        await this.auth.verifyEmail(this.token);
        this.status.set(this.i18n.t('auth.verifiedStatus'));
      }
    });
  }

  async resendVerification(): Promise<void> {
    await this.run(async () => {
      await this.auth.resendVerification({ email: this.email(), returnUrl: this.returnUrl || undefined });
      this.status.set(this.i18n.t('auth.resendStatus'));
    });
  }

  async submitForgotPassword(): Promise<void> {
    await this.run(async () => { await this.auth.forgotPassword({ email: this.email(), returnUrl: undefined }); this.status.set(this.i18n.t('auth.forgotStatus')); });
  }

  async submitResetPassword(): Promise<void> {
    if (!this.token) { this.error.set(this.i18n.t('auth.invalidReset')); return; }
    await this.run(async () => { await this.auth.resetPassword({ token: this.token, password: this.password() }); this.status.set(this.i18n.t('auth.resetStatus')); });
  }

  startOAuth(provider: 'google' | 'facebook'): void {
    window.location.assign(joinApiUrl(dataAuthority().apiBaseUrl, `/api/auth/oauth/${provider}/start`));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true); this.error.set(''); this.status.set(''); this.fieldErrors.set({});
    try { await action(); }
    catch (error) {
      // A taken username is the one rejection the API names but cannot phrase: its field message is
      // English and this product is read in French too, so the localized text replaces it.
      const usernameTaken = error instanceof ApiProblemError && error.problem.code === 'username_taken';
      const fields = fieldErrorsFromProblem(error);
      this.fieldErrors.set(usernameTaken ? { ...fields, username: [this.i18n.t('auth.usernameTaken')] } : fields);
      if (usernameTaken) this.error.set(this.i18n.t('auth.usernameTaken'));
      else this.error.set(error instanceof ApiProblemError && error.status === 429 ? this.i18n.t('auth.rateLimited') : this.i18n.t('auth.genericError'));
    } finally { this.pending.set(false); }
  }
}

function deviceLabel(): string { return `${navigator.platform || 'Browser'} · ${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'}`.slice(0, 100); }
