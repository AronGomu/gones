import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { AdminAuditRecordResponse, Client } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { pagedQueryParams, readPagedQuery, totalPages } from './admin-query';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="admin-page stack" data-cy="admin-audit" aria-labelledby="admin-audit-title">
      <header class="page-heading" data-cy="audit-heading"><div data-cy="audit-heading-text"><p class="kicker" data-cy="audit-kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="admin-audit-title" data-cy="audit-title">{{ i18n.t('admin.audit') }}</h1></div><a mat-stroked-button routerLink="/admin" data-cy="audit-back">{{ i18n.t('admin.back') }}</a></header>
      <form class="filter-bar auth-form audit-filter-grid" data-cy="audit-filters" (ngSubmit)="applyFilters()">
        <label for="audit-action" data-cy="audit-action-label">{{ i18n.t('admin.auditAction') }}</label><input id="audit-action" data-cy="audit-action" name="action" [(ngModel)]="action" />
        <label for="audit-entity-type" data-cy="audit-entity-type-label">{{ i18n.t('admin.auditEntityType') }}</label><input id="audit-entity-type" data-cy="audit-entity-type" name="entityType" [(ngModel)]="entityType" />
        <label for="audit-entity-id" data-cy="audit-entity-id-label">{{ i18n.t('admin.auditEntityId') }}</label><input id="audit-entity-id" data-cy="audit-entity-id" name="entityId" [(ngModel)]="entityId" />
        <label for="audit-actor-id" data-cy="audit-actor-id-label">{{ i18n.t('admin.auditActor') }}</label><input id="audit-actor-id" data-cy="audit-actor-id" name="actorId" [(ngModel)]="actorId" />
        <label for="audit-from" data-cy="audit-from-label">{{ i18n.t('admin.auditFrom') }}</label><input id="audit-from" data-cy="audit-from" name="from" [(ngModel)]="from" placeholder="2026-08-01T00:00:00Z" />
        <label for="audit-to" data-cy="audit-to-label">{{ i18n.t('admin.auditTo') }}</label><input id="audit-to" data-cy="audit-to" name="to" [(ngModel)]="to" placeholder="2026-08-02T00:00:00Z" />
        <button mat-flat-button type="submit" data-cy="audit-filter-submit">{{ i18n.t('common.apply') }}</button>
      </form>
      @if (loading()) { <p data-cy="audit-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) { <div class="stack" data-cy="audit-error-panel"><p class="error" role="alert" data-cy="audit-error">{{ error() }}</p><button mat-stroked-button type="button" data-cy="audit-retry" (click)="reload()">{{ i18n.t('common.retry') }}</button></div> }
      @else if (!items().length) { <p data-cy="audit-empty">{{ i18n.t('common.empty') }}</p> }
      @else {
        <div class="admin-table" role="table" data-cy="audit-table" [attr.aria-label]="i18n.t('admin.audit')">
          @for (record of items(); track record.id) {
            <mat-card class="panel admin-row" role="row" data-cy="audit-row"><mat-card-content class="stack" [attr.data-cy]="'audit-row-content-' + record.id">
              <div class="admin-row-grid" [attr.data-cy]="'audit-row-grid-' + record.id">
                <div [attr.data-cy]="'audit-row-summary-' + record.id"><strong [attr.data-cy]="'audit-row-action-' + record.id">{{ record.action }}</strong><p class="muted" [attr.data-cy]="'audit-row-entity-' + record.id">{{ record.entityType }} · {{ record.entityId }}</p></div>
                <div [attr.data-cy]="'audit-row-actor-' + record.id">{{ record.actorId || i18n.t('common.na') }}</div>
                <time [attr.data-cy]="'audit-row-occurred-' + record.id" [dateTime]="instantText(record.occurredAt)">{{ formatInstant(record.occurredAt) }}</time>
              </div>
              <pre class="redacted-diff" data-cy="audit-redacted-diff">{{ safeDiff(record) }}</pre>
            </mat-card-content></mat-card>
          }
        </div>
        <div class="pager" data-cy="audit-pager"><button mat-stroked-button type="button" data-cy="audit-page-previous" [disabled]="page <= 1" (click)="goPage(page - 1)">{{ i18n.t('common.previous') }}</button><span data-cy="audit-page">{{ page }} / {{ pages() }}</span><button mat-stroked-button type="button" data-cy="audit-page-next" [disabled]="page >= pages()" (click)="goPage(page + 1)">{{ i18n.t('common.next') }}</button></div>
      }
    </section>
  `
})
export class AdminAuditComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly items = signal<AdminAuditRecordResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly pages = signal(1);
  action = '';
  entityType = '';
  entityId = '';
  actorId = '';
  from = '';
  to = '';
  page = 1;
  pageSize = 20;

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const query = readPagedQuery(params);
      this.page = query.page;
      this.pageSize = query.pageSize;
      this.action = params.get('action') ?? '';
      this.entityType = params.get('entityType') ?? '';
      this.entityId = params.get('entityId') ?? '';
      this.actorId = params.get('actorId') ?? '';
      this.from = params.get('from') ?? '';
      this.to = params.get('to') ?? '';
      void this.reload();
    });
  }

  applyFilters(): void { this.navigate(1); }
  goPage(page: number): void { this.navigate(page); }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.client.audit(this.action || undefined, this.entityType || undefined, this.entityId || undefined, this.actorId || undefined, this.from || undefined, this.to || undefined, this.page, this.pageSize));
      this.items.set(response.items ?? []);
      this.pages.set(totalPages(response.totalCount ?? 0, response.pageSize || this.pageSize));
    } catch {
      this.error.set(this.i18n.t('admin.loadFailed'));
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  safeDiff(record: AdminAuditRecordResponse): string {
    return record.redactedDiff.replace(/(password|token|secret)[^,}]*/gi, '$1:redacted');
  }

  instantText(value: unknown): string { return String(value); }

  formatInstant(value: unknown): string { return this.i18n.formatDateTime(String(value)); }

  private navigate(page: number): void {
    const extra = {
      ...(this.action ? { action: this.action } : {}),
      ...(this.entityType ? { entityType: this.entityType } : {}),
      ...(this.entityId ? { entityId: this.entityId } : {}),
      ...(this.actorId ? { actorId: this.actorId } : {}),
      ...(this.from ? { from: this.from } : {}),
      ...(this.to ? { to: this.to } : {})
    };
    void this.router.navigate([], { relativeTo: this.route, queryParams: pagedQueryParams({ search: '', page, pageSize: this.pageSize }, extra) });
  }
}
