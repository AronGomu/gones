import { Component, computed, effect, inject, signal, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ExternalIdentityResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { fieldErrorsFromProblem, AuthFieldErrors } from '../../auth/auth-errors';
import { AuthService } from '../../auth/auth.service';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { GeoOption, GeoService, hasStructuredRegions } from '../../shared/geo.service';
import { AccountFormValues, accountFormIsDirty, accountFormPayload, accountFormValues } from './account-form';
import { applyCountry, applyRegion, optionsWithStoredValue } from './location-selection';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatDialogModule],
  template: `
    <section class="profile-page stack" aria-labelledby="account-title" data-cy="account-settings-page">
      <header class="page-heading" data-cy="account-heading"><div data-cy="account-heading-text"><h1 id="account-title" data-cy="account-title">{{ i18n.t('settings.accountTitle') }}</h1></div><div class="actions" data-cy="account-heading-actions"><a mat-stroked-button routerLink="/registrations" data-cy="account-registrations-link">{{ i18n.t('registration.myRegistrations') }}</a></div></header>

      <mat-card class="panel auth-card" data-cy="account-details-card"><mat-card-content data-cy="account-details-card-content">
        <form id="account-details-form" class="auth-form" (ngSubmit)="saveProfile()" novalidate data-cy="account-details-form"><fieldset data-cy="account-details-fieldset" [disabled]="pending()">
          <h2 data-cy="account-details-title">{{ i18n.t('profile.details') }}</h2>
          <label for="profile-username" data-cy="account-username-label">{{ i18n.t('account.pseudo') }}</label><input id="profile-username" data-cy="account-username" autocomplete="username" required [ngModel]="form().username" (ngModelChange)="setField('username', $event)" name="username" [attr.aria-invalid]="hasError('username')" [attr.aria-describedby]="hasError('username') ? 'profile-username-error' : null"><div id="profile-username-error" data-cy="account-username-error">@for (message of fieldErrors()['username']; track message) { <p class="field-error" role="alert" data-cy="account-username-error-message">{{ message }}</p> }</div>
          <div class="auth-name-grid" data-cy="account-name-grid"><div data-cy="account-first-name-group"><label for="profile-first" data-cy="account-first-name-label">{{ i18n.t('auth.firstName') }}</label><input id="profile-first" data-cy="account-first-name" required [ngModel]="form().firstName" (ngModelChange)="setField('firstName', $event)" name="firstName" [attr.aria-invalid]="hasError('firstName')" [attr.aria-describedby]="hasError('firstName') ? 'profile-first-error' : null"><div id="profile-first-error" data-cy="account-first-name-error">@for (message of fieldErrors()['firstName']; track message) { <p class="field-error" role="alert" data-cy="account-first-name-error-message">{{ message }}</p> }</div></div><div data-cy="account-last-name-group"><label for="profile-last" data-cy="account-last-name-label">{{ i18n.t('auth.lastName') }}</label><input id="profile-last" data-cy="account-last-name" required [ngModel]="form().lastName" (ngModelChange)="setField('lastName', $event)" name="lastName" [attr.aria-invalid]="hasError('lastName')" [attr.aria-describedby]="hasError('lastName') ? 'profile-last-error' : null"><div id="profile-last-error" data-cy="account-last-name-error">@for (message of fieldErrors()['lastName']; track message) { <p class="field-error" role="alert" data-cy="account-last-name-error-message">{{ message }}</p> }</div></div></div>
          <label for="account-location-country" data-cy="account-location-country-label">{{ i18n.t('profile.locationCountry') }}</label>
          <select id="account-location-country" data-cy="account-location-country" [ngModel]="form().locationCountry" (ngModelChange)="setCountry($event)" name="locationCountry" [attr.aria-invalid]="hasError('locationCountry')" [attr.aria-describedby]="hasError('locationCountry') ? 'profile-location-country-error' : null">
            <option value="" data-cy="account-location-country-empty">—</option>
            @for (country of countryOptions(); track country.code) { <option [value]="country.name" [attr.data-cy]="'account-location-country-' + country.code">{{ country.name }}</option> }
          </select>
          <div id="profile-location-country-error" data-cy="account-location-country-error">@for (message of fieldErrors()['locationCountry']; track message) { <p class="field-error" role="alert" data-cy="account-location-country-error-message">{{ message }}</p> }</div>

          <label for="account-location-region" data-cy="account-location-region-label">{{ i18n.t('profile.locationRegion') }}</label>
          @if (hasStructuredRegions(countryCodeOf(form().locationCountry))) {
            <select id="account-location-region" data-cy="account-location-region-select" [ngModel]="form().locationRegion" (ngModelChange)="setRegion($event)" name="locationRegion" [attr.aria-invalid]="hasError('locationRegion')" [attr.aria-describedby]="hasError('locationRegion') ? 'profile-location-region-error' : null">
              <option value="" data-cy="account-location-region-empty">—</option>
              @for (region of regionOptionNames(); track region) { <option [value]="region" [attr.data-cy]="'account-location-region-' + region">{{ region }}</option> }
            </select>
          } @else {
            <input id="account-location-region" data-cy="account-location-region" autocomplete="address-level1" [ngModel]="form().locationRegion" (ngModelChange)="setField('locationRegion', $event)" name="locationRegion" [attr.aria-invalid]="hasError('locationRegion')" [attr.aria-describedby]="hasError('locationRegion') ? 'profile-location-region-error' : null">
          }
          <div id="profile-location-region-error" data-cy="account-location-region-error">@for (message of fieldErrors()['locationRegion']; track message) { <p class="field-error" role="alert" data-cy="account-location-region-error-message">{{ message }}</p> }</div>

          <label for="account-location-city" data-cy="account-location-city-label">{{ i18n.t('profile.locationCity') }}</label>
          @if (hasStructuredRegions(countryCodeOf(form().locationCountry))) {
            <select id="account-location-city" data-cy="account-location-city-select" [ngModel]="form().locationCity" (ngModelChange)="setField('locationCity', $event)" name="locationCity" [attr.aria-invalid]="hasError('locationCity')" [attr.aria-describedby]="hasError('locationCity') ? 'profile-location-city-error' : null">
              <option value="" data-cy="account-location-city-empty">—</option>
              @for (city of cityOptionNames(); track city) { <option [value]="city" [attr.data-cy]="'account-location-city-' + city">{{ city }}</option> }
            </select>
          } @else {
            <input id="account-location-city" data-cy="account-location-city" autocomplete="address-level2" [ngModel]="form().locationCity" (ngModelChange)="setField('locationCity', $event)" name="locationCity" [attr.aria-invalid]="hasError('locationCity')" [attr.aria-describedby]="hasError('locationCity') ? 'profile-location-city-error' : null">
          }
          <div id="profile-location-city-error" data-cy="account-location-city-error">@for (message of fieldErrors()['locationCity']; track message) { <p class="field-error" role="alert" data-cy="account-location-city-error-message">{{ message }}</p> }</div>
          <label for="profile-birth-date" data-cy="account-birth-date-label">{{ i18n.t('profile.birthDate') }}</label><input id="profile-birth-date" data-cy="account-birth-date" type="date" min="1900-01-01" [max]="today" [ngModel]="form().birthDate" (ngModelChange)="setField('birthDate', $event)" name="birthDate" [attr.aria-invalid]="hasError('birthDate')" [attr.aria-describedby]="hasError('birthDate') ? 'profile-birth-date-error' : null"><div id="profile-birth-date-error" data-cy="account-birth-date-error">@for (message of fieldErrors()['birthDate']; track message) { <p class="field-error" role="alert" data-cy="account-birth-date-error-message">{{ message }}</p> }</div>
          <label for="profile-language" data-cy="account-language-label">{{ i18n.t('profile.language') }}</label><select id="profile-language" data-cy="account-language" [ngModel]="form().preferredLanguage" (ngModelChange)="setField('preferredLanguage', $event)" name="preferredLanguage" [attr.aria-invalid]="hasError('preferredLanguage')" [attr.aria-describedby]="hasError('preferredLanguage') ? 'profile-language-error' : null"><option value="en" data-cy="account-language-en">English</option><option value="fr" data-cy="account-language-fr">Français</option></select><div id="profile-language-error" data-cy="account-language-error">@for (message of fieldErrors()['preferredLanguage']; track message) { <p class="field-error" role="alert" data-cy="account-language-error-message">{{ message }}</p> }</div>

          <fieldset class="privacy-group" data-cy="account-privacy-group">
            <legend data-cy="account-privacy-legend">{{ i18n.t('profile.privacy') }}</legend>
            <p class="muted" data-cy="account-privacy-help">{{ i18n.t('profile.privacyHelp') }}</p>
            <label class="check-row" data-cy="account-public-first-name-row"><input type="checkbox" data-cy="account-public-first-name" [ngModel]="form().isFirstNamePublic" (ngModelChange)="setField('isFirstNamePublic', $event)" name="isFirstNamePublic">{{ i18n.t('profile.publicFirstName') }}</label>
            <label class="check-row" data-cy="account-public-last-name-row"><input type="checkbox" data-cy="account-public-last-name" [ngModel]="form().isLastNamePublic" (ngModelChange)="setField('isLastNamePublic', $event)" name="isLastNamePublic">{{ i18n.t('profile.publicLastName') }}</label>
            <label class="check-row" data-cy="account-public-location-row"><input data-cy="account-location-public" type="checkbox" [ngModel]="form().isLocationPublic" (ngModelChange)="setField('isLocationPublic', $event)" name="isLocationPublic">{{ i18n.t('profile.publicLocation') }}</label>
            <label class="check-row" data-cy="account-public-birth-date-row"><input type="checkbox" data-cy="account-public-birth-date" [ngModel]="form().isBirthDatePublic" (ngModelChange)="setField('isBirthDatePublic', $event)" name="isBirthDatePublic">{{ i18n.t('profile.publicBirthDate') }}</label>
            <label class="check-row" data-cy="account-public-language-row"><input type="checkbox" data-cy="account-public-language" [ngModel]="form().isPreferredLanguagePublic" (ngModelChange)="setField('isPreferredLanguagePublic', $event)" name="isPreferredLanguagePublic">{{ i18n.t('profile.publicLanguage') }}</label>
          </fieldset>
          @if (pseudoChanged()) {
            <label for="profile-password" data-cy="account-current-password-label">{{ i18n.t('account.pseudoPassword') }}</label><input id="profile-password" data-cy="account-current-password" type="password" autocomplete="current-password" [(ngModel)]="currentPassword" name="currentPassword">
          }
        </fieldset></form>

        <section class="account-email-section" data-cy="account-email-section">
          <h2 data-cy="account-email-title">{{ i18n.t('profile.emailSettings') }}</h2>
          <p data-cy="account-email-current"><strong data-cy="account-email-current-value">{{ profile()?.email }}</strong></p>
          <p class="warning" data-cy="account-email-change-help">{{ i18n.t('profile.emailChangeHelp') }}</p>
          <form class="auth-form" (ngSubmit)="changeEmail()" data-cy="account-email-form"><fieldset data-cy="account-email-fieldset" [disabled]="emailPending()">
            <label for="profile-new-email" data-cy="account-new-email-label">{{ i18n.t('profile.newEmail') }}</label><input id="profile-new-email" data-cy="account-new-email" type="email" autocomplete="email" required [(ngModel)]="newEmail" name="newEmail">
            <label for="profile-email-password" data-cy="account-email-password-label">{{ i18n.t('profile.currentPassword') }}</label><input id="profile-email-password" data-cy="account-email-password" type="password" autocomplete="current-password" required [(ngModel)]="emailPassword" name="emailPassword">
            <button mat-stroked-button type="submit" data-cy="account-change-email">{{ i18n.t('profile.changeEmail') }}</button>
          </fieldset></form>
        </section>

        <button form="account-details-form" mat-flat-button class="warning-action" data-cy="account-save" type="submit" [disabled]="pending() || !isDirty()">{{ pending() ? i18n.t('common.saving') : i18n.t('account.submit') }}</button>
      </mat-card-content></mat-card>

      <mat-card class="panel auth-card" data-cy="account-linked-accounts-card"><mat-card-content class="stack" data-cy="account-linked-accounts-card-content">
        <h2 data-cy="account-linked-accounts-title">{{ i18n.t('profile.linkedAccounts') }}</h2>
        <p class="muted" data-cy="account-link-help">{{ i18n.t('account.linkHelp') }}</p>
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
  private readonly dialog = inject(MatDialog);
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
  readonly baseline = signal<AccountFormValues>(accountFormValues(this.profile()));
  readonly form = signal<AccountFormValues>(accountFormValues(this.profile()));
  currentPassword = '';
  newEmail = '';
  emailPassword = '';
  readonly isDirty = computed(() => accountFormIsDirty(this.baseline(), this.form()));
  readonly pseudoChanged = computed(() => this.baseline().username !== this.form().username);

  private readonly geo = inject(GeoService);
  readonly hasStructuredRegions = hasStructuredRegions;
  readonly countryOptions = signal<GeoOption[]>([]);
  readonly regionOptions = signal<GeoOption[]>([]);
  readonly cityOptions = signal<string[]>([]);
  readonly regionOptionNames = computed(() => optionsWithStoredValue(this.regionOptions().map(region => region.name), this.form().locationRegion));
  readonly cityOptionNames = computed(() => optionsWithStoredValue(this.cityOptions(), this.form().locationCity));

  constructor() {
    void this.loadIdentities();
    void this.geo.countries().then(options => this.countryOptions.set(options));
    effect(() => {
      const values = accountFormValues(this.profile());
      this.baseline.set(values);
      if (!this.isDirty()) this.form.set(values);
    });
    effect(() => {
      const countryCode = this.countryCodeOf(this.form().locationCountry);
      void this.geo.regions(countryCode).then(options => this.regionOptions.set(options));
    });
    effect(() => {
      const countryCode = this.countryCodeOf(this.form().locationCountry);
      const region = this.regionOptions().find(option => option.name === this.form().locationRegion);
      void this.geo.cities(countryCode, region?.code ?? '').then(options => this.cityOptions.set(options));
    });
  }

  identity(provider: string): ExternalIdentityResponse | undefined { return this.identities().find(item => item.provider.toLowerCase() === provider); }
  hasError(name: string): boolean { return Boolean(this.fieldErrors()[name]?.length); }

  setField<K extends keyof AccountFormValues>(key: K, value: AccountFormValues[K]): void {
    this.form.update(values => ({ ...values, [key]: value }));
  }

  setCountry(name: string): void { this.form.update(values => applyCountry(values, name)); }
  setRegion(name: string): void { this.form.update(values => applyRegion(values, name)); }

  countryCodeOf(name: string): string {
    return this.countryOptions().find(country => country.name === name)?.code ?? '';
  }

  async saveProfile(): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: this.i18n.t('account.confirmTitle'), message: this.i18n.t('account.confirmMessage'), confirmLabel: this.i18n.t('account.submit'), destructive: false } }).afterClosed());
    if (!confirmed) return;
    await this.run(this.pending, async () => {
      await this.auth.updateProfile(accountFormPayload(this.form(), this.currentPassword));
      await this.settings.setLanguage(this.form().preferredLanguage);
      this.baseline.set(accountFormValues(this.auth.profile()));
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
    await this.run(this.identityPending, async () => { window.location.assign(await this.auth.startLink(provider)); });
  }

  async unlink(provider: string): Promise<void> {
    await this.run(this.identityPending, async () => { await this.auth.unlink(provider); await this.loadIdentities(); this.status.set(this.i18n.t('profile.unlinked')); });
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
