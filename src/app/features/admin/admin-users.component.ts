import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import {
  AdminAccountClosureImpactResponse,
  AdminUserSummaryResponse,
  Client
} from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { ServerReadCacheService } from '../../backend/server-read-cache.service';
import { SyncBarComponent } from '../../shared/sync-bar.component';
import { adminCacheKey, pagedQueryParams, readPagedQuery, totalPages } from './admin-query';
import { LatestRequest } from '../../shared/async-guards';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, BackButtonComponent, SyncBarComponent],
  template: `
    <gones-back-button data-cy="admin-users-back-top" [link]="['/admin']" [label]="i18n.t('admin.back')" position="top" />

    <section class="admin-page stack" data-cy="admin-users" aria-labelledby="admin-users-title">
      <header class="page-heading" data-cy="admin-users-heading">
        <div data-cy="admin-users-heading-text"><p class="kicker" data-cy="admin-users-kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="admin-users-title" data-cy="admin-users-title">{{ i18n.t('admin.users') }}</h1></div>
      </header>
      <gones-sync-bar cyPrefix="admin-users" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="sync()" data-cy="admin-users-sync-bar" />

      <form class="filter-bar auth-form" data-cy="admin-users-filters" (ngSubmit)="applyFilters()">
        <label for="admin-user-search" data-cy="admin-user-search-label">{{ i18n.t('common.search') }}</label>
        <input id="admin-user-search" data-cy="admin-user-search" name="search" [(ngModel)]="search" />
        <button mat-flat-button type="submit" data-cy="admin-user-search-submit">{{ i18n.t('common.apply') }}</button>
      </form>

      @if (loading()) { <p data-cy="admin-users-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) {
        <div class="stack" data-cy="admin-users-error-panel"><p class="error" role="alert" data-cy="admin-users-error">{{ error() }}</p><button mat-stroked-button type="button" data-cy="admin-users-retry" (click)="reload()">{{ i18n.t('common.retry') }}</button></div>
      } @else if (!items().length) { <p data-cy="admin-users-empty">{{ i18n.t('common.empty') }}</p> }
      @else {
        <div class="admin-table" role="table" data-cy="admin-users-table" [attr.aria-label]="i18n.t('admin.users')">
          @for (user of items(); track user.id) {
            <mat-card class="panel admin-row" role="row" [attr.data-cy]="'admin-user-row-' + user.username">
              <mat-card-content class="admin-row-grid" [attr.data-cy]="'admin-user-row-grid-' + user.id">
                <div [attr.data-cy]="'admin-user-row-summary-' + user.id"><strong [attr.data-cy]="'admin-user-row-username-' + user.id">{{ user.username }}</strong><p class="muted" [attr.data-cy]="'admin-user-row-email-' + user.id">{{ user.email }}</p></div>
                <div [attr.data-cy]="'admin-user-row-role-' + user.id">{{ user.globalRole }}@if (user.isClosed) { <span class="warning" [attr.data-cy]="'admin-user-row-closed-' + user.id"> · {{ i18n.t('admin.closed') }}</span> }</div>
                <div class="admin-actions" [attr.data-cy]="'admin-user-row-actions-' + user.id">
                  @if (!user.isClosed) {
                    <button mat-stroked-button type="button" [attr.data-cy]="'grant-organizer-' + user.username" (click)="grant(user, 'Organizer')">{{ i18n.t('admin.grantOrganizer') }}</button>
                    <button mat-stroked-button type="button" [attr.data-cy]="'grant-admin-' + user.username" (click)="grant(user, 'Admin')">{{ i18n.t('admin.grantAdmin') }}</button>
                    <button mat-stroked-button type="button" [attr.data-cy]="'revoke-organizer-' + user.username" (click)="revoke(user, 'Organizer')">{{ i18n.t('admin.revokeOrganizer') }}</button>
                    <button mat-stroked-button type="button" [attr.data-cy]="'revoke-admin-' + user.username" (click)="revoke(user, 'Admin')">{{ i18n.t('admin.revokeAdmin') }}</button>
                    <button mat-stroked-button type="button" class="danger-ghost-action" [attr.data-cy]="'close-user-' + user.username" (click)="openClose(user)">{{ i18n.t('admin.closeAccount') }}</button>
                  }
                </div>
              </mat-card-content>
            </mat-card>
          }
        </div>
        <div class="pager" data-cy="admin-users-pager">
          <button mat-stroked-button type="button" data-cy="admin-users-prev" [disabled]="page <= 1" (click)="goPage(page - 1)">{{ i18n.t('common.previous') }}</button>
          <span data-cy="admin-users-page">{{ page }} / {{ pages() }}</span>
          <button mat-stroked-button type="button" data-cy="admin-users-next" [disabled]="page >= pages()" (click)="goPage(page + 1)">{{ i18n.t('common.next') }}</button>
        </div>
      }

      @if (closing(); as target) {
        <mat-card class="panel auth-card" data-cy="admin-close-dialog">
          <mat-card-content class="stack" data-cy="admin-close-dialog-content">
            <h2 data-cy="admin-close-title">{{ i18n.t('admin.closeTitle') }}</h2>
            <p data-cy="admin-close-help">{{ i18n.t('admin.closeHelp', { username: target.username }) }}</p>
            @if (impact(); as impact) {
              <p class="warning" data-cy="admin-close-impact">{{ i18n.t('admin.closeImpact', { memberships: impact.otherMembershipOrganizationIds.length }) }}</p>
              @if (impact.blockReason === 'self_close' || impact.blockReason === 'last_admin' || impact.isClosed) {
                <p class="error" role="alert" data-cy="admin-close-blocked">{{ i18n.t('admin.closeBlocked') }}</p>
              } @else {
                <label for="confirm-username" data-cy="admin-close-username-label">{{ i18n.t('admin.confirmUsername') }}</label>
                <input id="confirm-username" data-cy="admin-close-username" [(ngModel)]="confirmUsername" name="confirmUsername" />
                <div class="actions" data-cy="admin-close-actions">
                  <button mat-stroked-button type="button" data-cy="admin-close-cancel" (click)="cancelClose()">{{ i18n.t('common.cancel') }}</button>
                  <button mat-flat-button type="button" class="danger-ghost-action" data-cy="admin-close-confirm" [disabled]="pending()" (click)="confirmClose()">{{ i18n.t('admin.closeConfirm') }}</button>
                </div>
              }
            } @else if (impactError()) {
              <p class="error" role="alert" data-cy="admin-close-impact-error">{{ impactError() }}</p>
              <button mat-stroked-button type="button" data-cy="admin-close-impact-retry" (click)="openClose(target)">{{ i18n.t('common.retry') }}</button>
            } @else { <p data-cy="admin-close-loading">{{ i18n.t('common.loading') }}</p> }
            @if (closeError()) { <p class="error" role="alert" data-cy="admin-close-error">{{ closeError() }}</p> }
          </mat-card-content>
        </mat-card>
      }
    </section>

    <gones-back-button data-cy="admin-users-back-bottom" [link]="['/admin']" [label]="i18n.t('admin.back')" position="bottom" />
  `
})
export class AdminUsersComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly items = signal<AdminUserSummaryResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly pending = signal(false);
  readonly closing = signal<AdminUserSummaryResponse | null>(null);
  readonly impact = signal<AdminAccountClosureImpactResponse | null>(null);
  readonly impactError = signal('');
  readonly closeError = signal('');
  readonly pages = signal(1);
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly stale = signal(false);
  private readonly cache = inject(ServerReadCacheService);
  private readonly latest = new LatestRequest();
  search = '';
  page = 1;
  pageSize = 20;
  confirmUsername = '';

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const query = readPagedQuery(params);
      this.search = query.search;
      this.page = query.page;
      this.pageSize = query.pageSize;
      void this.reload();
    });
  }

  applyFilters(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: pagedQueryParams({ search: this.search, page: 1, pageSize: this.pageSize }) });
  }

  goPage(page: number): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: pagedQueryParams({ search: this.search, page, pageSize: this.pageSize }) });
  }

  async reload(options: { force?: boolean } = {}): Promise<void> {
    const request = this.latest.begin();
    this.loading.set(true);
    this.error.set('');
    try {
      const key = adminCacheKey('admin-users', { search: this.search, page: this.page, pageSize: this.pageSize });
      const result = await this.cache.readCached(key, () => firstValueFrom(this.client.users(this.search || undefined, this.page, this.pageSize)), options);
      if (!this.latest.isCurrent(request)) return;
      this.items.set(result.value.items ?? []);
      this.pages.set(totalPages(result.value.totalCount ?? 0, result.value.pageSize || this.pageSize));
      this.syncedAt.set(result.fetchedAt);
      this.stale.set(result.stale);
    } catch {
      if (!this.latest.isCurrent(request)) return;
      this.error.set(this.i18n.t('admin.loadFailed'));
      this.items.set([]);
    } finally {
      if (this.latest.isCurrent(request)) this.loading.set(false);
    }
  }

  sync(): void { void this.reload({ force: true }); }

  async grant(user: AdminUserSummaryResponse, role: string): Promise<void> {
    if (!confirm(this.i18n.t('admin.confirmRoleGrant', { username: user.username, role }))) return;
    await this.mutate(() => firstValueFrom(this.client.grant(user.id, role)));
  }

  async revoke(user: AdminUserSummaryResponse, role: string): Promise<void> {
    if (!confirm(this.i18n.t('admin.confirmRoleRevoke', { username: user.username, role }))) return;
    await this.mutate(() => firstValueFrom(this.client.revoke(user.id, role)));
  }

  async openClose(user: AdminUserSummaryResponse): Promise<void> {
    this.closing.set(user);
    this.impact.set(null);
    this.impactError.set('');
    this.closeError.set('');
    this.confirmUsername = '';
    try {
      this.impact.set(await firstValueFrom(this.client.closureImpact(user.id)));
    } catch {
      this.impactError.set(this.i18n.t('admin.loadFailed'));
    }
  }

  cancelClose(): void {
    this.closing.set(null);
    this.impact.set(null);
  }

  async confirmClose(): Promise<void> {
    const user = this.closing();
    if (!user || this.pending()) return;
    this.pending.set(true);
    this.closeError.set('');
    try {
      await firstValueFrom(this.client.disable(user.id, { confirmedUsername: this.confirmUsername }));
      this.cancelClose();
      await this.cache.invalidateFamily('admin-users');
      await this.reload();
    } catch {
      this.closeError.set(this.i18n.t('admin.closeFailed'));
    } finally {
      this.pending.set(false);
    }
  }

  private async mutate(action: () => Promise<unknown>): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    try {
      await action();
      await this.cache.invalidateFamily('admin-users');
      await this.reload();
    } catch {
      this.error.set(this.i18n.t('admin.actionFailed'));
    } finally {
      this.pending.set(false);
    }
  }
}
