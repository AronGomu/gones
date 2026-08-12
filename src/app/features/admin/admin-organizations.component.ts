import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import {
  AdminOrganizationMemberResponse,
  AdminOrganizationResponse,
  AdminUserSummaryResponse,
  Client
} from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { LatestRequest } from '../../shared/async-guards';
import { pagedQueryParams, readPagedQuery, totalPages } from './admin-query';

export const MAX_PICKER_USERS = 500;
const PICKER_PAGE_SIZE = 100;

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="admin-page stack" data-cy="admin-organizations" aria-labelledby="admin-orgs-title">
      <header class="page-heading" data-cy="admin-orgs-heading"><div data-cy="admin-orgs-heading-text"><p class="kicker" data-cy="admin-orgs-kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="admin-orgs-title" data-cy="admin-orgs-title">{{ i18n.t('admin.organizations') }}</h1></div><a mat-stroked-button routerLink="/admin" data-cy="admin-orgs-back">{{ i18n.t('admin.back') }}</a></header>

      <div class="admin-org-workbench" data-cy="admin-org-workbench">
        <div class="stack" data-cy="admin-org-list-pane">
          <form class="filter-bar auth-form" data-cy="admin-orgs-filters" (ngSubmit)="applyFilters()">
            <label for="admin-org-search" data-cy="admin-org-search-label">{{ i18n.t('common.search') }}</label>
            <input id="admin-org-search" data-cy="admin-org-search" name="search" [(ngModel)]="search" />
            <label data-cy="admin-org-include-deleted-label"><input type="checkbox" data-cy="admin-org-include-deleted" name="includeDeleted" [(ngModel)]="includeDeleted" /> {{ i18n.t('admin.includeDeleted') }}</label>
            <button mat-flat-button type="submit" data-cy="admin-org-search-submit">{{ i18n.t('common.apply') }}</button>
          </form>

          <button mat-stroked-button type="button" data-cy="admin-org-create-toggle" [attr.aria-expanded]="showCreate()" (click)="showCreate.set(!showCreate())">{{ i18n.t('admin.newOrganization') }}</button>
          @if (showCreate()) {
            <mat-card class="panel" data-cy="admin-create-org-card"><mat-card-content data-cy="admin-create-org-card-content">
              <form class="auth-form" data-cy="admin-create-org" (ngSubmit)="create()">
                <h2 data-cy="admin-create-org-title">{{ i18n.t('admin.createOrganization') }}</h2>
                <label for="org-name" data-cy="admin-create-org-name-label">{{ i18n.t('org.name') }}</label><input id="org-name" data-cy="admin-create-org-name" name="name" [(ngModel)]="draft.name" required />
                <label for="org-owner" data-cy="admin-create-org-owner-label">{{ i18n.t('admin.ownerUserId') }}</label><input id="org-owner" data-cy="admin-create-org-owner" name="ownerUserId" [(ngModel)]="draft.ownerUserId" required />
                <label for="org-description" data-cy="admin-create-org-description-label">{{ i18n.t('org.description') }}</label><textarea id="org-description" data-cy="admin-create-org-description" name="description" [(ngModel)]="draft.description"></textarea>
                <label for="org-website" data-cy="admin-create-org-website-label">{{ i18n.t('org.website') }}</label><input id="org-website" data-cy="admin-create-org-website" name="website" [(ngModel)]="draft.website" />
                <label for="org-contact" data-cy="admin-create-org-contact-label">{{ i18n.t('org.contactEmail') }}</label><input id="org-contact" data-cy="admin-create-org-contact" name="contactEmail" [(ngModel)]="draft.contactEmail" />
                <button mat-flat-button type="submit" data-cy="admin-create-org-submit" [disabled]="pending()">{{ i18n.t('common.create') }}</button>
              </form>
            </mat-card-content></mat-card>
          }

          @if (loading()) { <p data-cy="admin-orgs-loading">{{ i18n.t('common.loading') }}</p> }
          @else if (error()) { <div class="stack" data-cy="admin-orgs-error-panel"><p class="error" role="alert" data-cy="admin-orgs-error">{{ error() }}</p><button mat-stroked-button type="button" data-cy="admin-orgs-retry" (click)="reload()">{{ i18n.t('common.retry') }}</button></div> }
          @else if (!items().length) { <p data-cy="admin-orgs-empty">{{ i18n.t('common.empty') }}</p> }
          @else {
            <ul class="admin-org-list" data-cy="admin-orgs-list" [attr.aria-label]="i18n.t('admin.organizations')">
              @for (org of items(); track org.id) {
                <li [attr.data-cy]="'admin-org-item-' + org.id">
                  <button type="button" class="admin-org-select" [attr.data-cy]="'admin-org-select-' + org.id" [attr.aria-current]="selectedId() === org.id ? 'true' : null" (click)="select(org)">
                    <strong [attr.data-cy]="'admin-org-row-name-' + org.id">{{ org.name }}</strong>
                    <span class="muted" [attr.data-cy]="'admin-org-member-count-' + org.id">{{ i18n.t('admin.memberCount', { count: org.memberCount }) }}</span>
                    @if (org.isDraft) { <span class="warning" [attr.data-cy]="'admin-org-draft-' + org.id">{{ i18n.t('admin.draftOrganization') }}</span> }
                    @if (org.deletedAt) { <span class="warning" [attr.data-cy]="'admin-org-row-deleted-' + org.id">{{ i18n.t('admin.deleted') }}</span> }
                  </button>
                </li>
              }
            </ul>
            <div class="pager" data-cy="admin-orgs-pager"><button mat-stroked-button type="button" data-cy="admin-orgs-page-previous" [disabled]="page <= 1" (click)="goPage(page - 1)">{{ i18n.t('common.previous') }}</button><span data-cy="admin-orgs-page">{{ page }} / {{ pages() }}</span><button mat-stroked-button type="button" data-cy="admin-orgs-page-next" [disabled]="page >= pages()" (click)="goPage(page + 1)">{{ i18n.t('common.next') }}</button></div>
          }
        </div>

        <div class="stack" data-cy="admin-org-detail-pane">
          @if (selected(); as org) {
            <mat-card class="panel" data-cy="admin-org-detail-card"><mat-card-content class="stack" data-cy="admin-org-detail-card-content">
              <h2 data-cy="admin-org-detail-title">{{ org.name }}</h2>
              <p class="muted" data-cy="admin-org-detail-id">{{ org.id }}</p>
              @if (org.isDraft) { <p class="warning" data-cy="admin-org-detail-draft">{{ i18n.t('admin.draftOrganization') }}</p> }
              <div class="admin-actions" data-cy="admin-org-detail-actions">
                @if (org.deletedAt) { <button mat-stroked-button type="button" [attr.data-cy]="'admin-org-restore-' + org.id" [disabled]="pending()" (click)="restore(org)">{{ i18n.t('admin.restore') }}</button> }
                @else { <button mat-stroked-button type="button" class="danger-ghost-action" [attr.data-cy]="'admin-org-delete-' + org.id" [disabled]="pending()" (click)="delete(org)">{{ i18n.t('common.delete') }}</button> }
              </div>
              <form class="auth-form" data-cy="admin-edit-org" (ngSubmit)="saveEdit()">
                <label for="edit-org-name" data-cy="admin-edit-org-name-label">{{ i18n.t('org.name') }}</label><input id="edit-org-name" data-cy="admin-edit-org-name" name="editName" [(ngModel)]="editDraft.name" required />
                <label for="edit-org-description" data-cy="admin-edit-org-description-label">{{ i18n.t('org.description') }}</label><textarea id="edit-org-description" data-cy="admin-edit-org-description" name="editDescription" [(ngModel)]="editDraft.description"></textarea>
                <label for="edit-org-website" data-cy="admin-edit-org-website-label">{{ i18n.t('org.website') }}</label><input id="edit-org-website" data-cy="admin-edit-org-website" name="editWebsite" [(ngModel)]="editDraft.website" />
                <label for="edit-org-contact" data-cy="admin-edit-org-contact-label">{{ i18n.t('org.contactEmail') }}</label><input id="edit-org-contact" data-cy="admin-edit-org-contact" name="editContact" [(ngModel)]="editDraft.contactEmail" />
                <div class="actions" data-cy="admin-edit-org-actions"><button mat-flat-button type="submit" data-cy="admin-edit-org-save" [disabled]="pending()">{{ i18n.t('common.save') }}</button></div>
              </form>
            </mat-card-content></mat-card>

            <mat-card class="panel" data-cy="admin-org-roster-card"><mat-card-content class="stack" data-cy="admin-org-roster-card-content">
              <h3 data-cy="admin-org-roster-title">{{ i18n.t('admin.organizationRoster') }}</h3>
              @if (membersLoading()) { <p data-cy="admin-org-members-loading">{{ i18n.t('common.loading') }}</p> }
              @else if (membersError()) { <p class="error" role="alert" data-cy="admin-org-members-error">{{ membersError() }}</p> }
              @else if (!members().length) { <p data-cy="admin-org-members-empty">{{ i18n.t('common.empty') }}</p> }
              @else {
                <ul class="admin-member-chips" data-cy="admin-org-members" [attr.aria-label]="i18n.t('admin.organizationRoster')">
                  @for (member of members(); track member.userId) {
                    <li class="setup-chip" [attr.data-cy]="'admin-org-member-' + member.userId">
                      <span [attr.data-cy]="'admin-org-member-username-' + member.userId">{{ member.username }}</span>
                      <span class="muted" [attr.data-cy]="'admin-org-member-email-' + member.userId">{{ member.email }}</span>
                      <span class="muted" [attr.data-cy]="'admin-org-member-role-' + member.userId">{{ member.role }}</span>
                      <button mat-stroked-button type="button" class="danger-ghost-action" [attr.data-cy]="'admin-org-member-remove-' + member.userId" [attr.aria-label]="i18n.t('admin.removeMember', { username: member.username })" [disabled]="pending()" (click)="removeMember(member)">{{ i18n.t('common.remove') }}</button>
                    </li>
                  }
                </ul>
              }

              <div class="stack" data-cy="admin-org-member-picker">
                <label for="admin-org-member-search" data-cy="admin-org-member-search-label">{{ i18n.t('common.search') }}</label>
                <input id="admin-org-member-search" data-cy="admin-org-member-search" name="memberSearch" [ngModel]="memberSearch()" (ngModelChange)="memberSearch.set($event)" />
                @if (userCapReached()) { <p class="warning" data-cy="admin-org-member-cap-warning">{{ i18n.t('admin.userPickerCapped', { count: maxPickerUsers }) }}</p> }
                @if (usersLoading()) { <p data-cy="admin-org-member-options-loading">{{ i18n.t('common.loading') }}</p> }
                @else if (usersError()) { <p class="error" role="alert" data-cy="admin-org-member-picker-error">{{ usersError() }}</p> }
                @else if (!filteredUsers().length) { <p data-cy="admin-org-member-options-empty">{{ i18n.t('common.empty') }}</p> }
                @else {
                  <ul class="admin-member-options" data-cy="admin-org-member-options">
                    @for (user of filteredUsers(); track user.id) {
                      <li [attr.data-cy]="'admin-org-member-option-item-' + user.id">
                        <button type="button" class="admin-org-select" [attr.data-cy]="'admin-org-member-option-' + user.id" [attr.aria-label]="i18n.t('admin.addMember', { username: user.username })" [disabled]="pending()" (click)="addMember(user)">
                          <strong [attr.data-cy]="'admin-org-member-option-username-' + user.id">{{ user.username }}</strong>
                          <span class="muted" [attr.data-cy]="'admin-org-member-option-email-' + user.id">{{ user.email }}</span>
                          <span class="muted" [attr.data-cy]="'admin-org-member-option-role-' + user.id">{{ user.globalRole }}</span>
                        </button>
                      </li>
                    }
                  </ul>
                }
              </div>
            </mat-card-content></mat-card>
          } @else {
            <p data-cy="admin-org-detail-empty">{{ i18n.t('admin.selectOrganization') }}</p>
          }
        </div>
      </div>

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
  readonly selectedId = signal('');
  readonly members = signal<AdminOrganizationMemberResponse[]>([]);
  readonly users = signal<AdminUserSummaryResponse[]>([]);
  readonly memberSearch = signal('');
  readonly userCapReached = signal(false);
  readonly usersError = signal('');
  readonly usersLoading = signal(true);
  readonly showCreate = signal(false);
  readonly loading = signal(true);
  readonly membersLoading = signal(false);
  readonly membersError = signal('');
  readonly pending = signal(false);
  readonly error = signal('');
  readonly status = signal('');
  readonly pages = signal(1);
  readonly maxPickerUsers = MAX_PICKER_USERS;
  readonly selected = computed(() => this.items().find((org) => org.id === this.selectedId()) ?? null);
  readonly filteredUsers = computed(() => {
    const memberIds = new Set(this.members().map((member) => member.userId));
    const term = this.memberSearch().trim().toLowerCase();
    return this.users().filter((user) =>
      !memberIds.has(user.id) && (!term || `${user.username} ${user.email}`.toLowerCase().includes(term)));
  });
  private readonly latestMembers = new LatestRequest();
  private editDraftId = '';
  search = '';
  includeDeleted = false;
  page = 1;
  pageSize = 20;
  draft = { name: '', ownerUserId: '', description: '', website: '', contactEmail: '' };
  editDraft = { name: '', description: '', website: '', contactEmail: '' };

  constructor() {
    void this.loadUsers();
    this.route.queryParamMap.subscribe((params) => {
      const query = readPagedQuery(params);
      this.search = query.search;
      this.page = query.page;
      this.pageSize = query.pageSize;
      this.includeDeleted = params.get('includeDeleted') === 'true';
      const organization = params.get('organization') ?? '';
      if (organization !== this.selectedId()) {
        this.selectedId.set(organization);
        void this.loadMembers();
      }
      void this.reload();
    });
  }

  applyFilters(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: pagedQueryParams({ search: this.search, page: 1, pageSize: this.pageSize }, this.queryExtras()) });
  }

  goPage(page: number): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: pagedQueryParams({ search: this.search, page, pageSize: this.pageSize }, this.queryExtras()) });
  }

  select(org: AdminOrganizationResponse): void {
    if (this.selectedId() !== org.id) {
      this.selectedId.set(org.id);
      this.memberSearch.set('');
      void this.loadMembers();
    }
    this.syncEditDraft(org);
    void this.router.navigate([], { relativeTo: this.route, queryParams: pagedQueryParams({ search: this.search, page: this.page, pageSize: this.pageSize }, this.queryExtras()) });
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.client.organizationsGET3(this.search || undefined, this.includeDeleted, this.page, this.pageSize));
      this.items.set(response.items ?? []);
      this.pages.set(totalPages(response.totalCount ?? 0, response.pageSize || this.pageSize));
      const selected = this.selected();
      if (selected) this.syncEditDraft(selected);
    } catch {
      this.error.set(this.i18n.t('admin.loadFailed'));
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMembers(): Promise<void> {
    const organizationId = this.selectedId();
    const request = this.latestMembers.begin();
    if (!organizationId) {
      this.members.set([]);
      this.membersError.set('');
      this.membersLoading.set(false);
      return;
    }
    this.membersLoading.set(true);
    this.membersError.set('');
    try {
      const members = await firstValueFrom(this.client.membersAll2(organizationId));
      if (!this.latestMembers.isCurrent(request)) return;
      this.members.set(members ?? []);
    } catch {
      if (!this.latestMembers.isCurrent(request)) return;
      this.members.set([]);
      this.membersError.set(this.i18n.t('admin.loadFailed'));
    } finally {
      if (this.latestMembers.isCurrent(request)) this.membersLoading.set(false);
    }
  }

  async addMember(user: AdminUserSummaryResponse): Promise<void> {
    const organizationId = this.selectedId();
    if (!organizationId) return;
    await this.mutate(async () => {
      await firstValueFrom(this.client.membersPOST(organizationId, { userId: user.id, role: 'Organizer' }));
      this.memberSearch.set('');
      await this.loadMembers();
      await this.reload();
    });
  }

  async removeMember(member: AdminOrganizationMemberResponse): Promise<void> {
    const organizationId = this.selectedId();
    if (!organizationId) return;
    if (!confirm(this.i18n.t('admin.confirmRemoveMember', { username: member.username, name: this.selected()?.name ?? '' }))) return;
    await this.mutate(async () => {
      await firstValueFrom(this.client.membersDELETE(organizationId, member.userId));
      await this.loadMembers();
      await this.reload();
    });
  }

  async create(): Promise<void> {
    await this.mutate(async () => {
      await firstValueFrom(this.client.organizationsPOST({ ...this.draft }));
      this.draft = { name: '', ownerUserId: '', description: '', website: '', contactEmail: '' };
      this.showCreate.set(false);
      await this.reload();
    });
  }

  async saveEdit(): Promise<void> {
    const org = this.selected();
    if (!org) return;
    await this.mutate(async () => {
      await firstValueFrom(this.client.organizationsPUT(org.id, { ...this.editDraft }));
      await this.reload();
    });
  }

  async delete(org: AdminOrganizationResponse): Promise<void> {
    if (!confirm(this.i18n.t('admin.confirmDeleteOrg', { name: org.name }))) return;
    await this.mutate(async () => {
      await firstValueFrom(this.client.organizationsDELETE(org.id));
      await this.reload();
      // A deleted organization drops out of the list unless "include deleted" is on: clear the
      // selection rather than leave `?organization=` pointing at a row the pane cannot show.
      if (this.selectedId() === org.id && !this.selected()) this.clearSelection();
    });
  }

  async restore(org: AdminOrganizationResponse): Promise<void> {
    await this.mutate(async () => { await firstValueFrom(this.client.restore(org.id)); await this.reload(); });
  }

  // The server caps `pageSize` at 100 and there is no user-search endpoint yet, so the picker holds
  // a bounded prefix of the account list and says so when it is truncated (T13 guardrail).
  private async loadUsers(): Promise<void> {
    const loaded: AdminUserSummaryResponse[] = [];
    let page = 1;
    let totalCount = 0;
    this.usersError.set('');
    this.usersLoading.set(true);
    try {
      while (loaded.length < MAX_PICKER_USERS) {
        const response = await firstValueFrom(this.client.users(undefined, page, PICKER_PAGE_SIZE));
        const batch = response.items ?? [];
        loaded.push(...batch);
        totalCount = response.totalCount ?? loaded.length;
        if (batch.length < PICKER_PAGE_SIZE || loaded.length >= totalCount) break;
        page += 1;
      }
    } catch {
      this.users.set([]);
      this.userCapReached.set(false);
      this.usersError.set(this.i18n.t('admin.loadFailed'));
      return;
    } finally {
      this.usersLoading.set(false);
    }
    this.users.set(loaded.slice(0, MAX_PICKER_USERS));
    this.userCapReached.set(loaded.length >= MAX_PICKER_USERS && totalCount > MAX_PICKER_USERS);
  }

  private clearSelection(): void {
    this.selectedId.set('');
    this.members.set([]);
    this.memberSearch.set('');
    void this.router.navigate([], { relativeTo: this.route, queryParams: pagedQueryParams({ search: this.search, page: this.page, pageSize: this.pageSize }, this.queryExtras()) });
  }

  private syncEditDraft(org: AdminOrganizationResponse): void {
    if (this.editDraftId === org.id) return;
    this.editDraftId = org.id;
    this.editDraft = { name: org.name, description: org.description ?? '', website: org.website ?? '', contactEmail: org.contactEmail ?? '' };
  }

  private queryExtras(): Params {
    const extra: Params = {};
    if (this.includeDeleted) extra['includeDeleted'] = true;
    if (this.selectedId()) extra['organization'] = this.selectedId();
    return extra;
  }

  private async mutate(action: () => Promise<void>): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set('');
    this.status.set('');
    try {
      await action();
      this.status.set(this.i18n.t('admin.saved'));
    } catch (failure) {
      const code = failure instanceof ApiProblemError ? failure.problem.code : undefined;
      this.error.set(code ? this.i18n.t('admin.actionFailedCode', { code }) : this.i18n.t('admin.actionFailed'));
    } finally {
      this.pending.set(false);
    }
  }
}
