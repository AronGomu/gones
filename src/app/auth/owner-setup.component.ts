import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { Client } from '../api/generated/gones-api';
import { ApiProblemError } from '../api/api-boundary';
import { I18nService } from '../i18n/i18n.service';
import { BackButtonComponent } from '../shared/back-button.component';
import { FieldErrorsComponent } from './auth-entry.component';
import { AuthFieldErrors, fieldErrorsFromProblem } from './auth-errors';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, BackButtonComponent, FieldErrorsComponent],
  template: `
    <gones-back-button [link]="['/login']" [label]="i18n.t('auth.backToLogin')" position="top" data-cy="owner-back-top" />
    <section class="auth-shell" aria-labelledby="owner-title" data-cy="owner-shell">
      <mat-card class="panel auth-card" data-cy="owner-card">
        <mat-card-content class="stack" data-cy="owner-content">
          <h1 id="owner-title" data-cy="owner-title">{{ i18n.t('auth.ownerSetup') }}</h1>
          @if (completed()) {
            <p role="status" aria-live="polite" data-cy="owner-completed">{{ i18n.t('auth.ownerSetupCompleted') }}</p>
          } @else if (!hasToken()) {
            <p role="alert" data-cy="owner-invalid">{{ i18n.t('auth.ownerSetupInvalid') }}</p>
          } @else {
            <p class="muted" data-cy="owner-help">{{ i18n.t('auth.ownerSetupHelp') }}</p>
            <form class="auth-form" (ngSubmit)="submit()" data-cy="owner-form">
              <fieldset [disabled]="pending()" data-cy="owner-fieldset">
                @for (field of fields; track field.name) {
                  <label [attr.for]="'owner-' + field.id" [attr.data-cy]="'owner-' + field.id + '-label'">{{ i18n.t(field.label) }}</label>
                  <input [id]="'owner-' + field.id" [attr.data-cy]="'owner-' + field.id" [type]="field.type"
                    [autocomplete]="field.autocomplete" [minlength]="field.min" [maxlength]="field.max" required
                    [(ngModel)]="values[field.name]" [name]="field.name"
                    [attr.aria-invalid]="!!fieldErrors()[field.name]?.length" [attr.aria-describedby]="'owner-' + field.id + '-error'">
                  <gones-field-errors [id]="'owner-' + field.id + '-error'" [attr.data-cy]="'owner-' + field.id + '-error'" [messages]="fieldErrors()[field.name]" />
                }
                <button mat-flat-button class="home-primary-action" type="submit" [disabled]="!valid()" data-cy="owner-submit">{{ pending() ? i18n.t('common.saving') : i18n.t('auth.ownerSetup') }}</button>
              </fieldset>
            </form>
          }
          @if (error()) { <p role="alert" class="error" data-cy="owner-error">{{ error() }}</p> }
          <p class="muted" data-cy="owner-resend-help">{{ i18n.t('auth.ownerSetupResend') }}</p>
          <a routerLink="/login" [queryParams]="{ returnUrl: '/admin' }" data-cy="owner-login">{{ i18n.t('auth.backToLogin') }}</a>
        </mat-card-content>
      </mat-card>
    </section>
  `
})
export class OwnerSetupComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private token = new URLSearchParams(this.route.snapshot.fragment ?? '').get('token') ?? '';
  readonly hasToken = signal(this.token.length === 43);
  readonly pending = signal(false);
  readonly completed = signal(false);
  readonly error = signal('');
  readonly fieldErrors = signal<AuthFieldErrors>({});
  readonly values = { username: '', firstName: '', lastName: '', password: '', confirmPassword: '' };
  readonly fields = [
    { name: 'username', id: 'username', label: 'auth.username', type: 'text', autocomplete: 'username', min: 3, max: 64 },
    { name: 'firstName', id: 'first-name', label: 'auth.firstName', type: 'text', autocomplete: 'given-name', min: 1, max: 100 },
    { name: 'lastName', id: 'last-name', label: 'auth.lastName', type: 'text', autocomplete: 'family-name', min: 1, max: 100 },
    { name: 'password', id: 'password', label: 'auth.password', type: 'password', autocomplete: 'new-password', min: 12, max: 128 },
    { name: 'confirmPassword', id: 'confirm-password', label: 'auth.confirmPassword', type: 'password', autocomplete: 'new-password', min: 12, max: 128 }
  ] as const;

  constructor() {
    // Fragment is delivery-only. Keep it out of browser history and all subsequent links.
    if (this.route.snapshot.fragment) history.replaceState(history.state, '', location.pathname + location.search);
  }

  valid(): boolean {
    return this.fields.every(field => {
      const value = this.values[field.name];
      return value.length >= field.min && value.length <= field.max && (field.type === 'password' || value.trim().length > 0);
    });
  }

  async submit(): Promise<void> {
    if (this.pending() || this.completed() || !this.hasToken()) return;
    this.error.set('');
    this.fieldErrors.set({});
    if (this.values.password !== this.values.confirmPassword) {
      this.fieldErrors.set({ confirmPassword: [this.i18n.t('auth.passwordMismatch')] });
      return;
    }
    if (!this.valid()) return;
    this.pending.set(true);
    try {
      const { username, firstName, lastName, password } = this.values;
      await firstValueFrom(this.client.completeOwnerSetup({ token: this.token, username, firstName, lastName, password }));
      this.token = '';
      this.hasToken.set(false);
      this.values.password = '';
      this.values.confirmPassword = '';
      this.completed.set(true);
    } catch (error) {
      this.fieldErrors.set(fieldErrorsFromProblem(error));
      this.error.set(error instanceof ApiProblemError && error.status === 429 ? this.i18n.t('auth.rateLimited') : this.i18n.t('auth.ownerSetupFailed'));
    } finally { this.pending.set(false); }
  }
}
