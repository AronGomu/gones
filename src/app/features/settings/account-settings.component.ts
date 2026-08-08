import { Component, inject, signal, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ExternalIdentityResponse, LocalDate } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { fieldErrorsFromProblem, AuthFieldErrors } from '../../auth/auth-errors';
import { AuthService } from '../../auth/auth.service';

function isoDate(value: LocalDate | undefined): string {
  return value === undefined || value === null ? '' : String(value).slice(0, 10);
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="profile-page stack" aria-labelledby="account-title" data-cy="account-settings-page">
      <header class="page-heading" data-cy="account-heading"><div data-cy="account-heading-text"><h1 id="account-title" data-cy="account-title">{{ i18n.t('settings.accountTitle') }}</h1></div><div class="actions" data-cy="account-heading-actions"><a mat-stroked-button routerLink="/registrations" data-cy="account-registrations-link">{{ i18n.t('registration.myRegistrations') }}</a></div></header>

      <mat-card class="panel auth-card" data-cy="account-details-card"><mat-card-content data-cy="account-details-card-content">
        <form class="auth-form" (ngSubmit)="saveProfile()" novalidate data-cy="account-details-form"><fieldset data-cy="account-details-fieldset" [disabled]="pending()">
          <h2 data-cy="account-details-title">{{ i18n.t('profile.details') }}</h2>
          <label for="profile-username" data-cy="account-username-label">{{ i18n.t('auth.username') }}</label><input id="profile-username" data-cy="account-username" autocomplete="username" required [(ngModel)]="username" name="username" [attr.aria-invalid]="hasError('username')" [attr.aria-describedby]="hasError('username') ? 'profile-username-error' : null"><div id="profile-username-error" data-cy="account-username-error">@for (message of fieldErrors()['username']; track message) { <p class="field-error" role="alert" data-cy="account-username-error-message">{{ message }}</p> }</div>
          <div class="auth-name-grid" data-cy="account-name-grid"><div data-cy="account-first-name-group"><label for="profile-first" data-cy="account-first-name-label">{{ i18n.t('auth.firstName') }}</label><input id="profile-first" data-cy="account-first-name" required [(ngModel)]="firstName" name="firstName" [attr.aria-invalid]="hasError('firstName')" [attr.aria-describedby]="hasError('firstName') ? 'profile-first-error' : null"><div id="profile-first-error" data-cy="account-first-name-error">@for (message of fieldErrors()['firstName']; track message) { <p class="field-error" role="alert" data-cy="account-first-name-error-message">{{ message }}</p> }</div></div><div data-cy="account-last-name-group"><label for="profile-last" data-cy="account-last-name-label">{{ i18n.t('auth.lastName') }}</label><input id="profile-last" data-cy="account-last-name" required [(ngModel)]="lastName" name="lastName" [attr.aria-invalid]="hasError('lastName')" [attr.aria-describedby]="hasError('lastName') ? 'profile-last-error' : null"><div id="profile-last-error" data-cy="account-last-name-error">@for (message of fieldErrors()['lastName']; track message) { <p class="field-error" role="alert" data-cy="account-last-name-error-message">{{ message }}</p> }</div></div></div>
          <label for="profile-location-country" data-cy="account-location-country-label">{{ i18n.t('profile.locationCountry') }}</label><input id="profile-location-country" data-cy="account-location-country" autocomplete="country-name" [(ngModel)]="locationCountry" name="locationCountry" [attr.aria-invalid]="hasError('locationCountry')" [attr.aria-describedby]="hasError('locationCountry') ? 'profile-location-country-error' : null"><div id="profile-location-country-error" data-cy="account-location-country-error">@for (message of fieldErrors()['locationCountry']; track message) { <p class="field-error" role="alert" data-cy="account-location-country-error-message">{{ message }}</p> }</div>
          <label for="profile-location-region" data-cy="account-location-region-label">{{ i18n.t('profile.locationRegion') }}</label><input id="profile-location-region" data-cy="account-location-region" autocomplete="address-level1" [(ngModel)]="locationRegion" name="locationRegion" [attr.aria-invalid]="hasError('locationRegion')" [attr.aria-describedby]="hasError('locationRegion') ? 'profile-location-region-error' : null"><div id="profile-location-region-error" data-cy="account-location-region-error">@for (message of fieldErrors()['locationRegion']; track message) { <p class="field-error" role="alert" data-cy="account-location-region-error-message">{{ message }}</p> }</div>
          <label for="profile-location-city" data-cy="account-location-city-label">{{ i18n.t('profile.locationCity') }}</label><input id="profile-location-city" data-cy="account-location-city" autocomplete="address-level2" [(ngModel)]="locationCity" name="locationCity" [attr.aria-invalid]="hasError('locationCity')" [attr.aria-describedby]="hasError('locationCity') ? 'profile-location-city-error' : null"><div id="profile-location-city-error" data-cy="account-location-city-error">@for (message of fieldErrors()['locationCity']; track message) { <p class="field-error" role="alert" data-cy="account-location-city-error-message">{{ message }}</p> }</div>
          <label for="profile-birth-date" data-cy="account-birth-date-label">{{ i18n.t('profile.birthDate') }}</label><input id="profile-birth-date" data-cy="account-birth-date" type="date" min="1900-01-01" [max]="today" [(ngModel)]="birthDate" name="birthDate" [attr.aria-invalid]="hasError('birthDate')" [attr.aria-describedby]="hasError('birthDate') ? 'profile-birth-date-error' : null"><div id="profile-birth-date-error" data-cy="account-birth-date-error">@for (message of fieldErrors()['birthDate']; track message) { <p class="field-error" role="alert" data-cy="account-birth-date-error-message">{{ message }}</p> }</div>
          <label for="profile-language" data-cy="account-language-label">{{ i18n.t('profile.language') }}</label><select id="profile-language" data-cy="account-language" [(ngModel)]="preferredLanguage" name="preferredLanguage" [attr.aria-invalid]="hasError('preferredLanguage')" [attr.aria-describedby]="hasError('preferredLanguage') ? 'profile-language-error' : null"><option value="en" data-cy="account-language-en">English</option><option value="fr" data-cy="account-language-fr">Français</option></select><div id="profile-language-error" data-cy="account-language-error">@for (message of fieldErrors()['preferredLanguage']; track message) { <p class="field-error" role="alert" data-cy="account-language-error-message">{{ message }}</p> }</div>

          <fieldset class="privacy-group" data-cy="account-privacy-group">
            <legend data-cy="account-privacy-legend">{{ i18n.t('profile.privacy') }}</legend>
            <p class="muted" data-cy="account-privacy-help">{{ i18n.t('profile.privacyHelp') }}</p>
            <label class="check-row" data-cy="account-public-first-name-row"><input type="checkbox" data-cy="account-public-first-name" [(ngModel)]="isFirstNamePublic" name="isFirstNamePublic">{{ i18n.t('profile.publicFirstName') }}</label>
            <label class="check-row" data-cy="account-public-last-name-row"><input type="checkbox" data-cy="account-public-last-name" [(ngModel)]="isLastNamePublic" name="isLastNamePublic">{{ i18n.t('profile.publicLastName') }}</label>
            <label class="check-row" data-cy="account-public-location-row"><input data-cy="account-location-public" type="checkbox" [(ngModel)]="isLocationPublic" name="isLocationPublic">{{ i18n.t('profile.publicLocation') }}</label>
            <label class="check-row" data-cy="account-public-birth-date-row"><input type="checkbox" data-cy="account-public-birth-date" [(ngModel)]="isBirthDatePublic" name="isBirthDatePublic">{{ i18n.t('profile.publicBirthDate') }}</label>
            <label class="check-row" data-cy="account-public-language-row"><input type="checkbox" data-cy="account-public-language" [(ngModel)]="isPreferredLanguagePublic" name="isPreferredLanguagePublic">{{ i18n.t('profile.publicLanguage') }}</label>
          </fieldset>
          <label for="profile-password" data-cy="account-current-password-label">{{ i18n.t('profile.currentPasswordUsername') }}</label><input id="profile-password" data-cy="account-current-password" type="password" autocomplete="current-password" [(ngModel)]="currentPassword" name="currentPassword">
          <button mat-flat-button class="home-primary-action" data-cy="account-save" type="submit">{{ pending() ? i18n.t('common.saving') : i18n.t('common.save') }}</button>
        </fieldset></form>
      </mat-card-content></mat-card>

      <mat-card class="panel auth-card" data-cy="account-email-card"><mat-card-content class="stack" data-cy="account-email-card-content">
        <h2 data-cy="account-email-title">{{ i18n.t('profile.emailSettings') }}</h2>
        <p data-cy="account-email-current"><strong data-cy="account-email-current-value">{{ profile()?.email }}</strong></p>
        <p class="warning" data-cy="account-email-change-help">{{ i18n.t('profile.emailChangeHelp') }}</p>
        <form class="auth-form" (ngSubmit)="changeEmail()" data-cy="account-email-form"><fieldset data-cy="account-email-fieldset" [disabled]="emailPending()">
          <label for="profile-new-email" data-cy="account-new-email-label">{{ i18n.t('profile.newEmail') }}</label><input id="profile-new-email" data-cy="account-new-email" type="email" autocomplete="email" required [(ngModel)]="newEmail" name="newEmail">
          <label for="profile-email-password" data-cy="account-email-password-label">{{ i18n.t('profile.currentPassword') }}</label><input id="profile-email-password" data-cy="account-email-password" type="password" autocomplete="current-password" required [(ngModel)]="emailPassword" name="emailPassword">
          <button mat-stroked-button type="submit" data-cy="account-change-email">{{ i18n.t('profile.changeEmail') }}</button>
        </fieldset></form>
      </mat-card-content></mat-card>

      <mat-card class="panel auth-card" data-cy="account-linked-accounts-card"><mat-card-content class="stack" data-cy="account-linked-accounts-card-content">
        <h2 data-cy="account-linked-accounts-title">{{ i18n.t('profile.linkedAccounts') }}</h2>
        <p class="muted" data-cy="account-link-help">{{ i18n.t('profile.linkHelp') }}</p>
        <label for="link-password" data-cy="account-link-password-label">{{ i18n.t('profile.currentPasswordOptional') }}</label><input id="link-password" data-cy="account-link-password" type="password" autocomplete="current-password" [(ngModel)]="linkPassword">
        @for (provider of providers; track provider) {
          <div class="identity-row" [attr.data-cy]="'account-identity-row-' + provider">
            <strong [attr.data-cy]="'account-identity-name-' + provider">{{ provider === 'google' ? 'Google' : 'Facebook' }}</strong>
            @if (identity(provider); as linked) {
              <span [attr.data-cy]="'account-identity-status-' + provider">{{ linked.providerEmail || i18n.t('profile.linked') }}</span>
              <button mat-stroked-button type="button" [attr.data-cy]="'unlink-' + provider" [disabled]="identityPending()" (click)="unlink(provider)">{{ i18n.t('profile.unlink') }}</button>
            } @else { <button mat-stroked-button type="button" [attr.data-cy]="'link-' + provider" [disabled]="identityPending()" (click)="link(provider)">{{ i18n.t('profile.link') }}</button> }
          </div>
        }
      </mat-card-content></mat-card>

      <div class="actions" data-cy="account-logout-row"><button mat-stroked-button type="button" class="danger-ghost-action" data-cy="account-logout" [disabled]="pending()" (click)="logout()">{{ i18n.t('auth.logout') }}</button></div>
      @if (error()) { <p class="error" role="alert" data-cy="account-error">{{ error() }}</p> }
      @if (status()) { <p class="settings-saved" role="status" aria-live="polite" data-cy="account-status">{{ status() }}</p> }
    </section>
  `
})
export class AccountSettingsComponent {
  readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly settings = inject(DeckArchetypeSettingsService);
  private readonly router = inject(Router);
  readonly profile = this.auth.profile;
  readonly pending = signal(false);
  readonly emailPending = signal(false);
  readonly identityPending = signal(false);
  readonly error = signal('');
  readonly status = signal('');
  readonly fieldErrors = signal<AuthFieldErrors>({});
  readonly identities = signal<ExternalIdentityResponse[]>([]);
  readonly providers = ['google', 'facebook'] as const;
  readonly today = new Date().toISOString().slice(0, 10);
  username = this.profile()?.username ?? '';
  firstName = this.profile()?.firstName ?? '';
  lastName = this.profile()?.lastName ?? '';
  locationCountry = this.profile()?.locationCountry ?? '';
  locationRegion = this.profile()?.locationRegion ?? '';
  locationCity = this.profile()?.locationCity ?? '';
  birthDate = isoDate(this.profile()?.birthDate);
  preferredLanguage = this.profile()?.preferredLanguage ?? 'fr';
  isFirstNamePublic = this.profile()?.isFirstNamePublic ?? false;
  isLastNamePublic = this.profile()?.isLastNamePublic ?? false;
  isLocationPublic = this.profile()?.isLocationPublic ?? false;
  isBirthDatePublic = this.profile()?.isBirthDatePublic ?? false;
  isPreferredLanguagePublic = this.profile()?.isPreferredLanguagePublic ?? false;
  currentPassword = '';
  newEmail = '';
  emailPassword = '';
  linkPassword = '';

  constructor() { void this.loadIdentities(); }
  identity(provider: string): ExternalIdentityResponse | undefined { return this.identities().find(item => item.provider.toLowerCase() === provider); }
  hasError(name: string): boolean { return Boolean(this.fieldErrors()[name]?.length); }

  async saveProfile(): Promise<void> {
    await this.run(this.pending, async () => {
      await this.auth.updateProfile({ username: this.username, firstName: this.firstName, lastName: this.lastName, locationCountry: this.locationCountry || undefined, locationRegion: this.locationRegion || undefined, locationCity: this.locationCity || undefined, birthDate: this.birthDate ? this.birthDate as unknown as LocalDate : undefined, preferredLanguage: this.preferredLanguage, isFirstNamePublic: this.isFirstNamePublic, isLastNamePublic: this.isLastNamePublic, isLocationPublic: this.isLocationPublic, isBirthDatePublic: this.isBirthDatePublic, isPreferredLanguagePublic: this.isPreferredLanguagePublic, currentPassword: this.currentPassword || undefined });
      await this.settings.setLanguage(this.preferredLanguage);
      this.currentPassword = '';
      this.status.set(this.i18n.t('profile.saved'));
    });
  }

  async changeEmail(): Promise<void> {
    await this.run(this.emailPending, async () => {
      await this.auth.requestEmailChange({ newEmail: this.newEmail, currentPassword: this.emailPassword });
      this.newEmail = ''; this.emailPassword = '';
      this.status.set(this.i18n.t('profile.emailRequested'));
    });
  }

  async link(provider: string): Promise<void> {
    await this.run(this.identityPending, async () => { window.location.assign(await this.auth.startLink(provider, this.linkPassword || undefined)); });
  }

  async unlink(provider: string): Promise<void> {
    await this.run(this.identityPending, async () => { await this.auth.unlink(provider, this.linkPassword || undefined); await this.loadIdentities(); this.status.set(this.i18n.t('profile.unlinked')); });
  }

  async logout(): Promise<void> { await this.auth.logout(); await this.router.navigate(['/login']); }

  private async loadIdentities(): Promise<void> {
    try { this.identities.set(await this.auth.listExternalIdentities()); }
    catch { this.error.set(this.i18n.t('profile.identitiesFailed')); }
  }

  private async run(lock: WritableSignal<boolean>, action: () => Promise<void>): Promise<void> {
    if (lock()) return;
    lock.set(true); this.error.set(''); this.status.set(''); this.fieldErrors.set({});
    try { await action(); }
    catch (error) { this.fieldErrors.set(fieldErrorsFromProblem(error)); this.error.set(this.i18n.t('auth.genericError')); }
    finally { lock.set(false); }
  }
}
