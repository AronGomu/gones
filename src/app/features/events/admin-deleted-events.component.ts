import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { Client, EventManagementResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { ServerReadCacheService } from '../../backend/server-read-cache.service';
import { SyncBarComponent } from '../../shared/sync-bar.component';
import { adminCacheKey } from '../admin/admin-query';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, BackButtonComponent, SyncBarComponent],
  template: `
    <gones-back-button data-cy="admin-deleted-events-back-top" [link]="['/admin']" [label]="i18n.t('admin.back')" position="top" />

    <section class="tournament-management-page stack" data-cy="deleted-events" aria-labelledby="deleted-events-title">
      <header class="page-heading" data-cy="deleted-events-heading"><div data-cy="deleted-events-heading-text"><p class="kicker" data-cy="deleted-events-kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="deleted-events-title" data-cy="deleted-events-title">{{ i18n.t('eventManage.deletedTitle') }}</h1></div><a mat-stroked-button routerLink="/admin" data-cy="deleted-events-back">{{ i18n.t('admin.back') }}</a></header>
      <gones-sync-bar cyPrefix="admin-deleted-events" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="sync()" data-cy="admin-deleted-events-sync-bar" />
      <p class="muted" data-cy="deleted-events-help">{{ i18n.t('eventManage.restoreHelp') }}</p>
      @if (loading()) { <p role="status" data-cy="deleted-events-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) { <div class="error stack" role="alert" data-cy="deleted-events-error"><span data-cy="deleted-events-error-text">{{ error() }}</span><button mat-stroked-button type="button" data-cy="deleted-events-retry" (click)="load()">{{ i18n.t('common.retry') }}</button></div> }
      @else if (!items().length) { <div class="panel stack" data-cy="deleted-events-empty"><h2 data-cy="deleted-events-empty-title">{{ i18n.t('eventManage.deletedEmpty') }}</h2></div> }
      @else {
        <div class="tournament-management-list" role="list" data-cy="deleted-events-list">
          @for (event of items(); track event.id) {
            <mat-card class="panel tournament-management-row" role="listitem" [attr.data-cy]="'deleted-event-row-' + event.id"><mat-card-content [attr.data-cy]="'deleted-event-content-' + event.id">
              <div class="tournament-management-row-grid" [attr.data-cy]="'deleted-event-grid-' + event.id">
                <div [attr.data-cy]="'deleted-event-summary-' + event.id"><p class="kicker" [attr.data-cy]="'deleted-event-organization-' + event.id">{{ event.organizationName }}</p><h2 [attr.data-cy]="'deleted-event-title-' + event.id">{{ event.title }}</h2><p class="muted" [attr.data-cy]="'deleted-event-reason-' + event.id">{{ event.deletedReason || i18n.t('eventManage.noDeleteReason') }}</p></div>
                <span class="warning" [attr.data-cy]="'deleted-event-badge-' + event.id">{{ i18n.t('admin.deleted') }}</span>
                <div class="admin-actions" [attr.data-cy]="'deleted-event-actions-' + event.id"><button mat-flat-button type="button" data-cy="event-restore" [disabled]="!!pendingId()" (click)="restore(event)">{{ pendingId() === event.id ? i18n.t('eventManage.restoring') : i18n.t('admin.restore') }}</button></div>
              </div>
            </mat-card-content></mat-card>
          }
        </div>
        <nav class="pager" data-cy="deleted-events-pager" [attr.aria-label]="i18n.t('event.pagesAria')"><button mat-stroked-button type="button" data-cy="deleted-events-page-previous" [disabled]="page() <= 1 || !!pendingId()" (click)="goPage(page() - 1)">{{ i18n.t('common.previous') }}</button><span data-cy="deleted-events-page">{{ page() }} / {{ pages() }}</span><button mat-stroked-button type="button" data-cy="deleted-events-page-next" [disabled]="page() >= pages() || !!pendingId()" (click)="goPage(page() + 1)">{{ i18n.t('common.next') }}</button></nav>
      }
      @if (status()) { <p role="status" data-cy="deleted-events-status">{{ status() }}</p> }
    </section>

    <gones-back-button data-cy="admin-deleted-events-back-bottom" [link]="['/admin']" [label]="i18n.t('admin.back')" position="bottom" />
  `
})
export class AdminDeletedEventsComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly items = signal<EventManagementResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly status = signal('');
  readonly pendingId = signal('');
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly stale = signal(false);
  readonly page = signal(1);
  readonly pageSize = 20;
  private readonly cache = inject(ServerReadCacheService);
  readonly totalCount = signal(0);
  readonly pages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const page = Number(params.get('page') ?? 1);
      this.page.set(Number.isInteger(page) && page > 0 ? page : 1);
      void this.load();
    });
  }

  async load(options: { force?: boolean } = {}): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const key = adminCacheKey('admin-deleted-events', { page: this.page() });
      const result = await this.cache.readCached(key, () => firstValueFrom(this.client.listDeletedEvents(this.page(), this.pageSize)), options);
      this.items.set(result.value.items);
      this.totalCount.set(result.value.totalCount);
      this.syncedAt.set(result.fetchedAt);
      this.stale.set(result.stale);
    } catch {
      this.items.set([]);
      this.error.set(this.i18n.t('eventManage.loadDeletedFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  sync(): void { void this.load({ force: true }); }

  goPage(page: number): void { void this.router.navigate([], { relativeTo: this.route, queryParams: { page } }); }

  async restore(event: EventManagementResponse): Promise<void> {
    if (this.pendingId()) return;
    this.pendingId.set(event.id);
    this.error.set('');
    this.status.set('');
    try {
      await firstValueFrom(this.client.restoreEvent(event.id, event.eTag));
      await this.cache.invalidateFamily('admin-deleted-events');
      this.items.update(items => items.filter(item => item.id !== event.id));
      this.totalCount.update(count => Math.max(0, count - 1));
      this.status.set(this.i18n.t('eventManage.restored'));
    } catch (error) {
      this.error.set(error instanceof ApiProblemError && error.status === 412
        ? this.i18n.t('eventManage.staleList')
        : error instanceof ApiProblemError && (error.status === 403 || error.status === 404 || error.status === 409)
          ? this.i18n.t('eventManage.restoreRejected')
          : this.i18n.t('eventManage.actionFailed'));
      if (error instanceof ApiProblemError && error.status === 412) {
        await this.cache.invalidateFamily('admin-deleted-events');
        await this.load();
      }
    } finally {
      this.pendingId.set('');
    }
  }
}
