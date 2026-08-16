import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { AdminNotificationResponse, Client } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { ServerReadCacheService } from '../../backend/server-read-cache.service';
import { SyncBarComponent } from '../../shared/sync-bar.component';
import { adminCacheKey, pagedQueryParams, readPagedQuery, totalPages } from './admin-query';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, BackButtonComponent, SyncBarComponent],
  template: `
    <gones-back-button data-cy="admin-notification-delivery-back-top" [link]="['/admin']" [label]="i18n.t('admin.back')" position="top" />

    <section class="admin-page stack" data-cy="admin-notification-delivery" aria-labelledby="notification-delivery-title">
      <header class="page-heading" data-cy="notification-heading">
        <div data-cy="notification-heading-text"><p class="kicker" data-cy="notification-kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="notification-delivery-title" data-cy="notification-title">{{ title() }}</h1></div>
        <a mat-stroked-button routerLink="/admin" data-cy="notification-back">{{ i18n.t('admin.back') }}</a>
      </header>
      <gones-sync-bar cyPrefix="admin-notifications" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="sync()" data-cy="admin-notifications-sync-bar" />
      <nav class="admin-nav" data-cy="notification-nav" [attr.aria-label]="i18n.t('admin.notificationNav')">
        <a mat-stroked-button routerLink="/admin/notifications/history" data-cy="notification-nav-history">{{ i18n.t('admin.notificationHistory') }}</a>
        <a mat-stroked-button routerLink="/admin/notifications/dead-letters" data-cy="notification-nav-dead-letters">{{ i18n.t('admin.notificationDeadLetters') }}</a>
      </nav>
      <form class="filter-bar auth-form" data-cy="notification-filters" (ngSubmit)="applyFilters()">
        <label for="notification-status" data-cy="notification-status-label">{{ i18n.t('admin.notificationStatus') }}</label>
        <select id="notification-status" data-cy="notification-status" name="status" [(ngModel)]="status">
          <option value="" data-cy="notification-status-option-all">{{ i18n.t('admin.notificationAll') }}</option>
          <option value="Pending" data-cy="notification-status-option-pending">Pending</option><option value="Sending" data-cy="notification-status-option-sending">Sending</option><option value="Sent" data-cy="notification-status-option-sent">Sent</option>
          <option value="Reconciliation" data-cy="notification-status-option-reconciliation">Reconciliation</option><option value="DeadLetter" data-cy="notification-status-option-dead-letter">DeadLetter</option>
        </select>
        <button mat-flat-button type="submit" data-cy="notification-filter-submit">{{ i18n.t('common.apply') }}</button>
      </form>
      @if (loading()) { <p data-cy="notification-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) { <div class="stack" data-cy="notification-error-panel"><p class="error" role="alert" data-cy="notification-error">{{ error() }}</p><button mat-stroked-button type="button" data-cy="notification-retry-load" (click)="reload()">{{ i18n.t('common.retry') }}</button></div> }
      @else if (!items().length) { <p data-cy="notification-empty">{{ i18n.t('common.empty') }}</p> }
      @else {
        <div class="admin-table" role="table" data-cy="notification-table" [attr.aria-label]="title()">
          @for (item of items(); track item.id) {
            <mat-card class="panel admin-row" role="row" data-cy="notification-row"><mat-card-content class="stack" [attr.data-cy]="'notification-row-content-' + item.id">
              <div class="admin-row-grid" [attr.data-cy]="'notification-row-grid-' + item.id">
                <div [attr.data-cy]="'notification-row-template-' + item.id"><strong [attr.data-cy]="'notification-row-template-key-' + item.id">{{ item.templateKey }}</strong><p class="muted" [attr.data-cy]="'notification-row-id-' + item.id">{{ item.id }}</p></div>
                <div [attr.data-cy]="'notification-row-state-' + item.id"><strong [attr.data-cy]="'notification-row-status-' + item.id">{{ item.status }}</strong><p class="muted" [attr.data-cy]="'notification-row-delivery-status-' + item.id">{{ item.deliveryStatus || i18n.t('common.na') }}</p></div>
                <time [attr.data-cy]="'notification-row-created-' + item.id" [dateTime]="instantText(item.createdAt)">{{ formatInstant(item.createdAt) }}</time>
              </div>
              <p class="muted" [attr.data-cy]="'notification-row-attempts-' + item.id">{{ i18n.t('admin.notificationAttempts') }}: {{ item.attemptCount }} · {{ i18n.t('admin.notificationProviderId') }}: {{ item.providerMessageId || i18n.t('common.na') }}</p>
              @if (item.lastErrorCode) { <p class="error" [attr.data-cy]="'notification-row-error-' + item.id">{{ item.lastErrorCode }}</p> }
              @if (item.canRetry) {
                <button mat-flat-button type="button" data-cy="notification-retry" [disabled]="retrying().has(item.id)" [attr.aria-busy]="retrying().has(item.id)" (click)="retry(item)">
                  {{ retrying().has(item.id) ? i18n.t('common.loading') : i18n.t('admin.notificationRetry') }}
                </button>
              }
            </mat-card-content></mat-card>
          }
        </div>
        <div class="pager" data-cy="notification-pager"><button mat-stroked-button type="button" data-cy="notification-page-previous" [disabled]="page <= 1" (click)="goPage(page - 1)">{{ i18n.t('common.previous') }}</button><span data-cy="notification-page">{{ page }} / {{ pages() }}</span><button mat-stroked-button type="button" data-cy="notification-page-next" [disabled]="page >= pages()" (click)="goPage(page + 1)">{{ i18n.t('common.next') }}</button></div>
      }
    </section>

    <gones-back-button data-cy="admin-notification-delivery-back-bottom" [link]="['/admin']" [label]="i18n.t('admin.back')" position="bottom" />
  `
})
export class AdminNotificationDeliveryComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly items = signal<AdminNotificationResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly pages = signal(1);
  readonly retrying = signal(new Set<string>());
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly stale = signal(false);
  readonly deadLetters = this.route.snapshot.data['mode'] === 'dead-letters';
  readonly title = signal(this.i18n.t(this.deadLetters ? 'admin.notificationDeadLetters' : 'admin.notificationHistory'));
  private readonly cache = inject(ServerReadCacheService);
  status = '';
  page = 1;
  pageSize = 20;

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const query = readPagedQuery(params);
      this.page = query.page;
      this.pageSize = query.pageSize;
      this.status = params.get('status') ?? '';
      void this.reload();
    });
  }

  applyFilters(): void { this.navigate(1); }
  goPage(page: number): void { this.navigate(page); }

  async reload(options: { force?: boolean } = {}): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const mode = this.deadLetters ? 'dead-letters' : 'history';
      const key = adminCacheKey('admin-notifications', { mode, status: this.status, page: this.page, pageSize: this.pageSize });
      const result = await this.cache.readCached(key, () => {
        const request = this.deadLetters
          ? this.client.deadLetters(this.status || undefined, this.page, this.pageSize)
          : this.client.history(this.status || undefined, this.page, this.pageSize);
        return firstValueFrom(request);
      }, options);
      this.items.set(result.value.items ?? []);
      this.pages.set(totalPages(result.value.totalCount ?? 0, result.value.pageSize || this.pageSize));
      this.syncedAt.set(result.fetchedAt);
      this.stale.set(result.stale);
    } catch {
      this.items.set([]);
      this.error.set(this.i18n.t('admin.notificationLoadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  sync(): void { void this.reload({ force: true }); }

  async retry(item: AdminNotificationResponse): Promise<void> {
    if (!item.canRetry || !window.confirm(this.i18n.t('admin.notificationRetryConfirm'))) return;
    this.retrying.update((current) => new Set(current).add(item.id));
    try {
      await firstValueFrom(this.client.retry(item.id, { operatorApproved: true }));
      await this.cache.invalidateFamily('admin-notifications');
      await this.reload();
    } catch {
      this.error.set(this.i18n.t('admin.notificationRetryFailed'));
    } finally {
      this.retrying.update((current) => { const next = new Set(current); next.delete(item.id); return next; });
    }
  }

  instantText(value: unknown): string { return String(value); }
  formatInstant(value: unknown): string { return this.i18n.formatDateTime(String(value)); }

  private navigate(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: pagedQueryParams({ search: '', page, pageSize: this.pageSize }, this.status ? { status: this.status } : {})
    });
  }
}
