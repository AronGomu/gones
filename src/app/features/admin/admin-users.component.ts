import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import {
  AdminAccountClosureImpactResponse,
  AdminUserSummaryResponse,
  Client,
  OwnershipTransferBody
} from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { pagedQueryParams, readPagedQuery, totalPages } from './admin-query';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="admin-page stack" data-cy="admin-users" aria-labelledby="admin-users-title">
      <header class="page-heading">
        <div><p class="kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="admin-users-title">{{ i18n.t('admin.users') }}</h1></div>
        <a mat-stroked-button routerLink="/admin">{{ i18n.t('admin.back') }}</a>
      </header>

      <form class="filter-bar auth-form" (ngSubmit)="applyFilters()">
        <label for="admin-user-search">{{ i18n.t('common.search') }}</label>
        <input id="admin-user-search" data-cy="admin-user-search" name="search" [(ngModel)]="search" />
        <button mat-flat-button type="submit" data-cy="admin-user-search-submit">{{ i18n.t('common.apply') }}</button>
      </form>

      @if (loading()) { <p data-cy="admin-users-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) {
        <div class="stack"><p class="error" role="alert">{{ error() }}</p><button mat-stroked-button type="button" data-cy="admin-users-retry" (click)="reload()">{{ i18n.t('common.retry') }}</button></div>
      } @else if (!items().length) { <p data-cy="admin-users-empty">{{ i18n.t('common.empty') }}</p> }
      @else {
        <div class="admin-table" role="table" [attr.aria-label]="i18n.t('admin.users')">
          @for (user of items(); track user.id) {
            <mat-card class="panel admin-row" role="row" [attr.data-cy]="'admin-user-row-' + user.username">
              <mat-card-content class="admin-row-grid">
                <div><strong>{{ user.username }}</strong><p class="muted">{{ user.email }}</p></div>
                <div>{{ user.globalRole }}@if (user.isClosed) { <span class="warning"> · {{ i18n.t('admin.closed') }}</span> }</div>
                <div class="admin-actions">
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
        <div class="pager">
          <button mat-stroked-button type="button" data-cy="admin-users-prev" [disabled]="page <= 1" (click)="goPage(page - 1)">{{ i18n.t('common.previous') }}</button>
          <span data-cy="admin-users-page">{{ page }} / {{ pages() }}</span>
          <button mat-stroked-button type="button" data-cy="admin-users-next" [disabled]="page >= pages()" (click)="goPage(page + 1)">{{ i18n.t('common.next') }}</button>
        </div>
      }

      @if (closing(); as target) {
        <mat-card class="panel auth-card" data-cy="admin-close-dialog">
          <mat-card-content class="stack">
            <h2>{{ i18n.t('admin.closeTitle') }}</h2>
            <p>{{ i18n.t('admin.closeHelp', { username: target.username }) }}</p>
            @if (impact(); as impact) {
              <p class="warning" data-cy="admin-close-impact">{{ i18n.t('admin.closeImpact', { orgs: impact.soleOwnedOrganizations.length, memberships: impact.otherMembershipOrganizationIds.length }) }}</p>
              @if (impact.blockReason === 'self_close' || impact.blockReason === 'last_admin' || impact.isClosed) {
                <p class="error" role="alert">{{ i18n.t('admin.closeBlocked') }}</p>
              } @else {
                @for (org of impact.soleOwnedOrganizations; track org.organizationId) {
                  <label [attr.for]="'transfer-' + org.organizationId">{{ i18n.t('admin.transferOwner', { name: org.organizationName }) }}</label>
                  <input [id]="'transfer-' + org.organizationId" [attr.data-cy]="'transfer-owner-' + org.organizationId" [(ngModel)]="transfers[org.organizationId]" [name]="'transfer-' + org.organizationId" [placeholder]="org.suggestedNewOwnerUserId || ''" />
                }
                <label for="confirm-username">{{ i18n.t('admin.confirmUsername') }}</label>
                <input id="confirm-username" data-cy="admin-close-username" [(ngModel)]="confirmUsername" name="confirmUsername" />
                <div class="actions">
                  <button mat-stroked-button type="button" (click)="cancelClose()">{{ i18n.t('common.cancel') }}</button>
                  <button mat-flat-button type="button" class="danger-ghost-action" data-cy="admin-close-confirm" [disabled]="pending()" (click)="confirmClose()">{{ i18n.t('admin.closeConfirm') }}</button>
                </div>
              }
            } @else if (impactError()) {
              <p class="error" role="alert">{{ impactError() }}</p>
              <button mat-stroked-button type="button" (click)="openClose(target)">{{ i18n.t('common.retry') }}</button>
            } @else { <p>{{ i18n.t('common.loading') }}</p> }
            @if (closeError()) { <p class="error" role="alert" data-cy="admin-close-error">{{ closeError() }}</p> }
          </mat-card-content>
        </mat-card>
      }
    </section>
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
  search = '';
  page = 1;
  pageSize = 20;
  confirmUsername = '';
  transfers: Record<string, string> = {};

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

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.client.users(this.search || undefined, this.page, this.pageSize));
      this.items.set(response.items ?? []);
      this.pages.set(totalPages(response.totalCount ?? 0, response.pageSize || this.pageSize));
    } catch {
      this.error.set(this.i18n.t('admin.loadFailed'));
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }

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
    this.transfers = {};
    try {
      const impact = await firstValueFrom(this.client.closureImpact(user.id));
      this.impact.set(impact);
      for (const org of impact.soleOwnedOrganizations ?? []) {
        this.transfers[org.organizationId] = org.suggestedNewOwnerUserId ?? '';
      }
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
    const ownershipTransfers: OwnershipTransferBody[] = Object.entries(this.transfers)
      .filter(([, value]) => value.trim())
      .map(([organizationId, newOwnerUserId]) => ({ organizationId, newOwnerUserId: newOwnerUserId.trim() }));
    this.pending.set(true);
    this.closeError.set('');
    try {
      await firstValueFrom(this.client.disable(user.id, { confirmedUsername: this.confirmUsername, ownershipTransfers }));
      this.cancelClose();
      await this.reload();
    } catch {
      this.closeError.set(this.i18n.t('admin.closeFailed'));
    } finally {
      this.pending.set(false);
    }
  }

  private async mutate(action: () => Promise<unknown>): Promise<void> {
    this.pending.set(true);
    this.error.set('');
    try {
      await action();
      await this.reload();
    } catch {
      this.error.set(this.i18n.t('admin.actionFailed'));
    } finally {
      this.pending.set(false);
    }
  }
}
