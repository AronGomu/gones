import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { AdminNotificationResponse, Client } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { pagedQueryParams, readPagedQuery, totalPages } from './admin-query';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="admin-page stack" data-cy="admin-notification-delivery" aria-labelledby="notification-delivery-title">
      <header class="page-heading">
        <div><p class="kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="notification-delivery-title">{{ title() }}</h1></div>
        <a mat-stroked-button routerLink="/admin">{{ i18n.t('admin.back') }}</a>
      </header>
      <nav class="admin-nav" [attr.aria-label]="i18n.t('admin.notificationNav')">
        <a mat-stroked-button routerLink="/admin/notifications/history">{{ i18n.t('admin.notificationHistory') }}</a>
        <a mat-stroked-button routerLink="/admin/notifications/dead-letters">{{ i18n.t('admin.notificationDeadLetters') }}</a>
      </nav>
      <form class="filter-bar auth-form" (ngSubmit)="applyFilters()">
        <label for="notification-status">{{ i18n.t('admin.notificationStatus') }}</label>
        <select id="notification-status" data-cy="notification-status" name="status" [(ngModel)]="status">
          <option value="">{{ i18n.t('admin.notificationAll') }}</option>
          <option value="Pending">Pending</option><option value="Sending">Sending</option><option value="Sent">Sent</option>
          <option value="Reconciliation">Reconciliation</option><option value="DeadLetter">DeadLetter</option>
        </select>
        <button mat-flat-button type="submit">{{ i18n.t('common.apply') }}</button>
      </form>
      @if (loading()) { <p>{{ i18n.t('common.loading') }}</p> }
      @else if (error()) { <div class="stack"><p class="error" role="alert">{{ error() }}</p><button mat-stroked-button type="button" (click)="reload()">{{ i18n.t('common.retry') }}</button></div> }
      @else if (!items().length) { <p data-cy="notification-empty">{{ i18n.t('common.empty') }}</p> }
      @else {
        <div class="admin-table" role="table" [attr.aria-label]="title()">
          @for (item of items(); track item.id) {
            <mat-card class="panel admin-row" role="row" data-cy="notification-row"><mat-card-content class="stack">
              <div class="admin-row-grid">
                <div><strong>{{ item.templateKey }}</strong><p class="muted">{{ item.id }}</p></div>
                <div><strong>{{ item.status }}</strong><p class="muted">{{ item.deliveryStatus || i18n.t('common.na') }}</p></div>
                <time [dateTime]="instantText(item.createdAt)">{{ formatInstant(item.createdAt) }}</time>
              </div>
              <p class="muted">{{ i18n.t('admin.notificationAttempts') }}: {{ item.attemptCount }} · {{ i18n.t('admin.notificationProviderId') }}: {{ item.providerMessageId || i18n.t('common.na') }}</p>
              @if (item.lastErrorCode) { <p class="error">{{ item.lastErrorCode }}</p> }
              @if (item.canRetry) {
                <button mat-flat-button type="button" data-cy="notification-retry" [disabled]="retrying().has(item.id)" [attr.aria-busy]="retrying().has(item.id)" (click)="retry(item)">
                  {{ retrying().has(item.id) ? i18n.t('common.loading') : i18n.t('admin.notificationRetry') }}
                </button>
              }
            </mat-card-content></mat-card>
          }
        </div>
        <div class="pager"><button mat-stroked-button type="button" [disabled]="page <= 1" (click)="goPage(page - 1)">{{ i18n.t('common.previous') }}</button><span>{{ page }} / {{ pages() }}</span><button mat-stroked-button type="button" [disabled]="page >= pages()" (click)="goPage(page + 1)">{{ i18n.t('common.next') }}</button></div>
      }
    </section>
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
  readonly deadLetters = this.route.snapshot.data['mode'] === 'dead-letters';
  readonly title = signal(this.i18n.t(this.deadLetters ? 'admin.notificationDeadLetters' : 'admin.notificationHistory'));
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

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const request = this.deadLetters
        ? this.client.deadLetters(this.status || undefined, this.page, this.pageSize)
        : this.client.history(this.status || undefined, this.page, this.pageSize);
      const response = await firstValueFrom(request);
      this.items.set(response.items ?? []);
      this.pages.set(totalPages(response.totalCount ?? 0, response.pageSize || this.pageSize));
    } catch {
      this.items.set([]);
      this.error.set(this.i18n.t('admin.notificationLoadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  async retry(item: AdminNotificationResponse): Promise<void> {
    if (!item.canRetry || !window.confirm(this.i18n.t('admin.notificationRetryConfirm'))) return;
    this.retrying.update((current) => new Set(current).add(item.id));
    try {
      await firstValueFrom(this.client.retry(item.id, { operatorApproved: true }));
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
