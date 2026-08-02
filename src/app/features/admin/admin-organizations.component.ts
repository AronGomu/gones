import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { AdminOrganizationResponse, Client } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { pagedQueryParams, readPagedQuery, totalPages } from './admin-query';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="admin-page stack" data-cy="admin-organizations" aria-labelledby="admin-orgs-title">
      <header class="page-heading"><div><p class="kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="admin-orgs-title">{{ i18n.t('admin.organizations') }}</h1></div><a mat-stroked-button routerLink="/admin">{{ i18n.t('admin.back') }}</a></header>
      <form class="filter-bar auth-form" (ngSubmit)="applyFilters()">
        <label for="admin-org-search">{{ i18n.t('common.search') }}</label>
        <input id="admin-org-search" data-cy="admin-org-search" name="search" [(ngModel)]="search" />
        <label><input type="checkbox" name="includeDeleted" [(ngModel)]="includeDeleted" /> {{ i18n.t('admin.includeDeleted') }}</label>
        <button mat-flat-button type="submit">{{ i18n.t('common.apply') }}</button>
      </form>

      <mat-card class="panel"><mat-card-content>
        <form class="auth-form" data-cy="admin-create-org" (ngSubmit)="create()">
          <h2>{{ i18n.t('admin.createOrganization') }}</h2>
          <label for="org-name">{{ i18n.t('org.name') }}</label><input id="org-name" name="name" [(ngModel)]="draft.name" required />
          <label for="org-owner">{{ i18n.t('admin.ownerUserId') }}</label><input id="org-owner" name="ownerUserId" [(ngModel)]="draft.ownerUserId" required />
          <label for="org-description">{{ i18n.t('org.description') }}</label><textarea id="org-description" name="description" [(ngModel)]="draft.description"></textarea>
          <label for="org-website">{{ i18n.t('org.website') }}</label><input id="org-website" name="website" [(ngModel)]="draft.website" />
          <label for="org-contact">{{ i18n.t('org.contactEmail') }}</label><input id="org-contact" name="contactEmail" [(ngModel)]="draft.contactEmail" />
          <button mat-flat-button type="submit" [disabled]="pending()">{{ i18n.t('common.create') }}</button>
        </form>
      </mat-card-content></mat-card>

      @if (loading()) { <p>{{ i18n.t('common.loading') }}</p> }
      @else if (error()) { <div class="stack"><p class="error" role="alert">{{ error() }}</p><button mat-stroked-button type="button" (click)="reload()">{{ i18n.t('common.retry') }}</button></div> }
      @else if (!items().length) { <p>{{ i18n.t('common.empty') }}</p> }
      @else {
        <div class="admin-table" role="table" [attr.aria-label]="i18n.t('admin.organizations')">
          @for (org of items(); track org.id) {
            <mat-card class="panel admin-row" role="row" [attr.data-cy]="'admin-org-row-' + org.name">
              <mat-card-content class="stack">
                <div class="admin-row-grid">
                  <div><strong>{{ org.name }}</strong><p class="muted">{{ org.id }}</p></div>
                  <div>@if (org.deletedAt) { <span class="warning">{{ i18n.t('admin.deleted') }}</span> } @else { <span>{{ i18n.t('common.active') }}</span> }</div>
                  <div class="admin-actions">
                    <button mat-stroked-button type="button" [disabled]="pending()" (click)="edit(org)">{{ i18n.t('common.edit') }}</button>
                    @if (org.deletedAt) { <button mat-stroked-button type="button" [disabled]="pending()" (click)="restore(org)">{{ i18n.t('admin.restore') }}</button> }
                    @else { <button mat-stroked-button type="button" class="danger-ghost-action" [disabled]="pending()" (click)="delete(org)">{{ i18n.t('common.delete') }}</button> }
                  </div>
                </div>
                @if (editing()?.id === org.id) {
                  <form class="auth-form" data-cy="admin-edit-org" (ngSubmit)="saveEdit()">
                    <label for="edit-org-name">{{ i18n.t('org.name') }}</label><input id="edit-org-name" name="editName" [(ngModel)]="editDraft.name" required />
                    <label for="edit-org-description">{{ i18n.t('org.description') }}</label><textarea id="edit-org-description" name="editDescription" [(ngModel)]="editDraft.description"></textarea>
                    <label for="edit-org-website">{{ i18n.t('org.website') }}</label><input id="edit-org-website" name="editWebsite" [(ngModel)]="editDraft.website" />
                    <label for="edit-org-contact">{{ i18n.t('org.contactEmail') }}</label><input id="edit-org-contact" name="editContact" [(ngModel)]="editDraft.contactEmail" />
                    <div class="actions"><button mat-stroked-button type="button" (click)="editing.set(null)">{{ i18n.t('common.cancel') }}</button><button mat-flat-button type="submit" [disabled]="pending()">{{ i18n.t('common.save') }}</button></div>
                  </form>
                }
              </mat-card-content>
            </mat-card>
          }
        </div>
        <div class="pager"><button mat-stroked-button type="button" [disabled]="page <= 1" (click)="goPage(page - 1)">{{ i18n.t('common.previous') }}</button><span>{{ page }} / {{ pages() }}</span><button mat-stroked-button type="button" [disabled]="page >= pages()" (click)="goPage(page + 1)">{{ i18n.t('common.next') }}</button></div>
      }
      @if (status()) { <p role="status" data-cy="admin-org-status">{{ status() }}</p> }
    </section>
  `
})
export class AdminOrganizationsComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly items = signal<AdminOrganizationResponse[]>([]);
  readonly editing = signal<AdminOrganizationResponse | null>(null);
  readonly loading = signal(true);
  readonly pending = signal(false);
  readonly error = signal('');
  readonly status = signal('');
  readonly pages = signal(1);
  search = '';
  includeDeleted = false;
  page = 1;
  pageSize = 20;
  draft = { name: '', ownerUserId: '', description: '', website: '', contactEmail: '' };
  editDraft = { name: '', description: '', website: '', contactEmail: '' };

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const query = readPagedQuery(params);
      this.search = query.search;
      this.page = query.page;
      this.pageSize = query.pageSize;
      this.includeDeleted = params.get('includeDeleted') === 'true';
      void this.reload();
    });
  }

  applyFilters(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: pagedQueryParams({ search: this.search, page: 1, pageSize: this.pageSize }, this.includeDeleted ? { includeDeleted: true } : {}) });
  }

  goPage(page: number): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: pagedQueryParams({ search: this.search, page, pageSize: this.pageSize }, this.includeDeleted ? { includeDeleted: true } : {}) });
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.client.organizationsGET3(this.search || undefined, this.includeDeleted, this.page, this.pageSize));
      this.items.set(response.items ?? []);
      this.pages.set(totalPages(response.totalCount ?? 0, response.pageSize || this.pageSize));
    } catch {
      this.error.set(this.i18n.t('admin.loadFailed'));
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async create(): Promise<void> {
    await this.mutate(async () => {
      await firstValueFrom(this.client.organizationsPOST({ ...this.draft }));
      this.draft = { name: '', ownerUserId: '', description: '', website: '', contactEmail: '' };
      await this.reload();
    });
  }

  edit(org: AdminOrganizationResponse): void {
    this.editing.set(org);
    this.editDraft = { name: org.name, description: org.description ?? '', website: org.website ?? '', contactEmail: org.contactEmail ?? '' };
  }

  async saveEdit(): Promise<void> {
    const org = this.editing();
    if (!org) return;
    await this.mutate(async () => {
      await firstValueFrom(this.client.organizationsPUT(org.id, { ...this.editDraft }));
      this.editing.set(null);
      await this.reload();
    });
  }

  async delete(org: AdminOrganizationResponse): Promise<void> {
    if (!confirm(this.i18n.t('admin.confirmDeleteOrg', { name: org.name }))) return;
    await this.mutate(async () => { await firstValueFrom(this.client.organizationsDELETE(org.id)); await this.reload(); });
  }

  async restore(org: AdminOrganizationResponse): Promise<void> {
    await this.mutate(async () => { await firstValueFrom(this.client.restore(org.id)); await this.reload(); });
  }

  private async mutate(action: () => Promise<void>): Promise<void> {
    this.pending.set(true);
    this.error.set('');
    this.status.set('');
    try {
      await action();
      this.status.set(this.i18n.t('admin.saved'));
    } catch {
      this.error.set(this.i18n.t('admin.actionFailed'));
    } finally {
      this.pending.set(false);
    }
  }
}
