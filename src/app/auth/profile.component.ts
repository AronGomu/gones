import { Component, inject, signal, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ExternalIdentityResponse, LocalDate } from '../api/generated/gones-api';
import { I18nService } from '../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../shared/deck-archetype-settings.service';
import { fieldErrorsFromProblem, AuthFieldErrors } from './auth-errors';
import { AuthService } from './auth.service';

function isoDate(value: LocalDate | undefined): string {
  return value === undefined || value === null ? '' : String(value).slice(0, 10);
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="profile-page stack" aria-labelledby="profile-title">
      <header class="page-heading"><div><p class="kicker">{{ i18n.t('auth.account') }}</p><h1 id="profile-title">{{ i18n.t('profile.title') }}</h1></div><div class="actions"><a mat-stroked-button routerLink="/registrations">{{ i18n.t('registration.myRegistrations') }}</a><a mat-stroked-button routerLink="/profile/sessions">{{ i18n.t('profile.sessions') }}</a></div></header>

      <mat-card class="panel auth-card"><mat-card-content>
        <form class="auth-form" (ngSubmit)="saveProfile()" novalidate><fieldset [disabled]="pending()">
          <h2>{{ i18n.t('profile.details') }}</h2>
          <label for="profile-username">{{ i18n.t('auth.username') }}</label><input id="profile-username" data-cy="profile-username" autocomplete="username" required [(ngModel)]="username" name="username" [attr.aria-invalid]="hasError('username')" [attr.aria-describedby]="hasError('username') ? 'profile-username-error' : null"><div id="profile-username-error">@for (message of fieldErrors()['username']; track message) { <p class="field-error" role="alert">{{ message }}</p> }</div>
          <div class="auth-name-grid"><div><label for="profile-first">{{ i18n.t('auth.firstName') }}</label><input id="profile-first" required [(ngModel)]="firstName" name="firstName" [attr.aria-invalid]="hasError('firstName')" [attr.aria-describedby]="hasError('firstName') ? 'profile-first-error' : null"><div id="profile-first-error">@for (message of fieldErrors()['firstName']; track message) { <p class="field-error" role="alert">{{ message }}</p> }</div></div><div><label for="profile-last">{{ i18n.t('auth.lastName') }}</label><input id="profile-last" required [(ngModel)]="lastName" name="lastName" [attr.aria-invalid]="hasError('lastName')" [attr.aria-describedby]="hasError('lastName') ? 'profile-last-error' : null"><div id="profile-last-error">@for (message of fieldErrors()['lastName']; track message) { <p class="field-error" role="alert">{{ message }}</p> }</div></div></div>
          <label for="profile-location-country">{{ i18n.t('profile.locationCountry') }}</label><input id="profile-location-country" data-cy="profile-location-country" autocomplete="country-name" [(ngModel)]="locationCountry" name="locationCountry" [attr.aria-invalid]="hasError('locationCountry')" [attr.aria-describedby]="hasError('locationCountry') ? 'profile-location-country-error' : null"><div id="profile-location-country-error">@for (message of fieldErrors()['locationCountry']; track message) { <p class="field-error" role="alert">{{ message }}</p> }</div>
          <label for="profile-location-region">{{ i18n.t('profile.locationRegion') }}</label><input id="profile-location-region" data-cy="profile-location-region" autocomplete="address-level1" [(ngModel)]="locationRegion" name="locationRegion" [attr.aria-invalid]="hasError('locationRegion')" [attr.aria-describedby]="hasError('locationRegion') ? 'profile-location-region-error' : null"><div id="profile-location-region-error">@for (message of fieldErrors()['locationRegion']; track message) { <p class="field-error" role="alert">{{ message }}</p> }</div>
          <label for="profile-location-city">{{ i18n.t('profile.locationCity') }}</label><input id="profile-location-city" data-cy="profile-location-city" autocomplete="address-level2" [(ngModel)]="locationCity" name="locationCity" [attr.aria-invalid]="hasError('locationCity')" [attr.aria-describedby]="hasError('locationCity') ? 'profile-location-city-error' : null"><div id="profile-location-city-error">@for (message of fieldErrors()['locationCity']; track message) { <p class="field-error" role="alert">{{ message }}</p> }</div>
          <label for="profile-birth-date">{{ i18n.t('profile.birthDate') }}</label><input id="profile-birth-date" data-cy="profile-birth-date" type="date" min="1900-01-01" [max]="today" [(ngModel)]="birthDate" name="birthDate" [attr.aria-invalid]="hasError('birthDate')" [attr.aria-describedby]="hasError('birthDate') ? 'profile-birth-date-error' : null"><div id="profile-birth-date-error">@for (message of fieldErrors()['birthDate']; track message) { <p class="field-error" role="alert">{{ message }}</p> }</div>
          <label for="profile-language">{{ i18n.t('profile.language') }}</label><select id="profile-language" data-cy="profile-language" [(ngModel)]="preferredLanguage" name="preferredLanguage" [attr.aria-invalid]="hasError('preferredLanguage')" [attr.aria-describedby]="hasError('preferredLanguage') ? 'profile-language-error' : null"><option value="en">English</option><option value="fr">Français</option></select><div id="profile-language-error">@for (message of fieldErrors()['preferredLanguage']; track message) { <p class="field-error" role="alert">{{ message }}</p> }</div>

          <fieldset class="privacy-group">
            <legend>{{ i18n.t('profile.privacy') }}</legend>
            <p class="muted">{{ i18n.t('profile.privacyHelp') }}</p>
            <label class="check-row"><input type="checkbox" [(ngModel)]="isFirstNamePublic" name="isFirstNamePublic">{{ i18n.t('profile.publicFirstName') }}</label>
            <label class="check-row"><input type="checkbox" [(ngModel)]="isLastNamePublic" name="isLastNamePublic">{{ i18n.t('profile.publicLastName') }}</label>
            <label class="check-row"><input data-cy="profile-location-public" type="checkbox" [(ngModel)]="isLocationPublic" name="isLocationPublic">{{ i18n.t('profile.publicLocation') }}</label>
            <label class="check-row"><input type="checkbox" [(ngModel)]="isBirthDatePublic" name="isBirthDatePublic">{{ i18n.t('profile.publicBirthDate') }}</label>
            <label class="check-row"><input type="checkbox" [(ngModel)]="isPreferredLanguagePublic" name="isPreferredLanguagePublic">{{ i18n.t('profile.publicLanguage') }}</label>
          </fieldset>
          <label for="profile-password">{{ i18n.t('profile.currentPasswordUsername') }}</label><input id="profile-password" type="password" autocomplete="current-password" [(ngModel)]="currentPassword" name="currentPassword">
          <button mat-flat-button class="home-primary-action" data-cy="profile-save" type="submit">{{ pending() ? i18n.t('common.saving') : i18n.t('common.save') }}</button>
        </fieldset></form>
      </mat-card-content></mat-card>

      <mat-card class="panel auth-card"><mat-card-content class="stack">
        <h2>{{ i18n.t('profile.emailSettings') }}</h2>
        <p><strong>{{ profile()?.email }}</strong></p>
        <p class="warning">{{ i18n.t('profile.emailChangeHelp') }}</p>
        <form class="auth-form" (ngSubmit)="changeEmail()"><fieldset [disabled]="emailPending()">
          <label for="profile-new-email">{{ i18n.t('profile.newEmail') }}</label><input id="profile-new-email" data-cy="profile-new-email" type="email" autocomplete="email" required [(ngModel)]="newEmail" name="newEmail">
          <label for="profile-email-password">{{ i18n.t('profile.currentPassword') }}</label><input id="profile-email-password" type="password" autocomplete="current-password" required [(ngModel)]="emailPassword" name="emailPassword">
          <button mat-stroked-button type="submit" data-cy="profile-change-email">{{ i18n.t('profile.changeEmail') }}</button>
        </fieldset></form>
      </mat-card-content></mat-card>

      <mat-card class="panel auth-card"><mat-card-content class="stack">
        <h2>{{ i18n.t('profile.linkedAccounts') }}</h2>
        <p class="muted">{{ i18n.t('profile.linkHelp') }}</p>
        <label for="link-password">{{ i18n.t('profile.currentPasswordOptional') }}</label><input id="link-password" type="password" autocomplete="current-password" [(ngModel)]="linkPassword">
        @for (provider of providers; track provider) {
          <div class="identity-row">
            <strong>{{ provider === 'google' ? 'Google' : 'Facebook' }}</strong>
            @if (identity(provider); as linked) {
              <span>{{ linked.providerEmail || i18n.t('profile.linked') }}</span>
              <button mat-stroked-button type="button" [attr.data-cy]="'unlink-' + provider" [disabled]="identityPending()" (click)="unlink(provider)">{{ i18n.t('profile.unlink') }}</button>
            } @else { <button mat-stroked-button type="button" [attr.data-cy]="'link-' + provider" [disabled]="identityPending()" (click)="link(provider)">{{ i18n.t('profile.link') }}</button> }
          </div>
        }
      </mat-card-content></mat-card>

      <div class="actions"><button mat-stroked-button type="button" class="danger-ghost-action" [disabled]="pending()" (click)="logout()">{{ i18n.t('auth.logout') }}</button></div>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      @if (status()) { <p class="settings-saved" role="status" aria-live="polite" data-cy="profile-status">{{ status() }}</p> }
    </section>
  `
})
export class ProfileComponent {
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
