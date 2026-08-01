import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RefreshSessionResponse } from '../api/generated/gones-api';
import { I18nService } from '../i18n/i18n.service';
import { AuthService } from './auth.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="profile-page stack" aria-labelledby="sessions-title">
      <header class="page-heading"><div><p class="kicker">{{ i18n.t('auth.account') }}</p><h1 id="sessions-title">{{ i18n.t('profile.sessions') }}</h1></div><a mat-stroked-button routerLink="/profile">{{ i18n.t('profile.back') }}</a></header>
      <p class="muted">{{ i18n.t('sessions.help') }}</p>
      @if (loading()) { <p role="status">{{ i18n.t('common.loading') }}</p> }
      @else if (sessions().length) {
        <div class="session-list" role="list">
          @for (session of sessions(); track session.id) {
            <mat-card class="panel session-card" role="listitem" data-cy="session-row"><mat-card-content>
              <div><h2>{{ session.deviceLabel }}</h2><p class="muted">{{ i18n.t('sessions.lastUsed') }} {{ instant(session.lastUsedAt) }}</p><p class="muted">{{ i18n.t('sessions.expires') }} {{ instant(session.idleExpiresAt) }}</p></div>
              <button mat-stroked-button class="danger-ghost-action" type="button" [disabled]="pendingId() === session.id" (click)="revoke(session)">{{ i18n.t('sessions.revoke') }}</button>
            </mat-card-content></mat-card>
          }
        </div>
      } @else { <p class="empty">{{ i18n.t('sessions.empty') }}</p> }
      <button mat-stroked-button class="danger-ghost-action" data-cy="logout-all" type="button" [disabled]="logoutPending()" (click)="logoutAll()">{{ i18n.t('sessions.logoutAll') }}</button>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      @if (status()) { <p class="settings-saved" role="status" aria-live="polite">{{ status() }}</p> }
    </section>
  `
})
export class SessionsComponent {
  readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly sessions = signal<RefreshSessionResponse[]>([]);
  readonly loading = signal(true);
  readonly pendingId = signal('');
  readonly logoutPending = signal(false);
  readonly error = signal('');
  readonly status = signal('');

  constructor() { void this.load(); }
  instant(value: unknown): string { return typeof value === 'string' ? this.i18n.formatDateTime(value) : String(value ?? ''); }

  async revoke(session: RefreshSessionResponse): Promise<void> {
    if (this.pendingId()) return;
    this.pendingId.set(session.id); this.error.set('');
    try { await this.auth.revokeSession(session.id); this.sessions.update(items => items.filter(item => item.id !== session.id)); this.status.set(this.i18n.t('sessions.revoked')); }
    catch { this.error.set(this.i18n.t('auth.genericError')); }
    finally { this.pendingId.set(''); }
  }

  async logoutAll(): Promise<void> {
    if (this.logoutPending()) return;
    this.logoutPending.set(true); this.error.set('');
    try { await this.auth.logout(true); await this.router.navigate(['/login']); }
    catch { this.error.set(this.i18n.t('auth.genericError')); }
    finally { this.logoutPending.set(false); }
  }

  private async load(): Promise<void> {
    try { this.sessions.set(await this.auth.listSessions()); }
    catch { this.error.set(this.i18n.t('sessions.loadFailed')); }
    finally { this.loading.set(false); }
  }
}
