import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { Client, PublicOrganizationResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { pagedQueryParams, readPagedQuery, totalPages } from './admin-query';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="admin-page stack" data-cy="organizations" aria-labelledby="organizations-title">
      <header class="page-heading" data-cy="orgs-heading"><div data-cy="orgs-heading-text"><p class="kicker" data-cy="orgs-kicker">{{ i18n.t('org.kicker') }}</p><h1 id="organizations-title" data-cy="orgs-title">{{ i18n.t('org.publicList') }}</h1></div></header>
      <form class="filter-bar auth-form" data-cy="orgs-filters" (ngSubmit)="applyFilters()">
        <label for="org-search" data-cy="orgs-search-label">{{ i18n.t('common.search') }}</label>
        <input id="org-search" data-cy="org-search" name="search" [(ngModel)]="search" />
        <button mat-flat-button type="submit" data-cy="org-search-submit">{{ i18n.t('common.apply') }}</button>
      </form>
      @if (loading()) { <p data-cy="orgs-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) { <div class="stack" data-cy="orgs-error-panel"><p class="error" role="alert" data-cy="orgs-error">{{ error() }}</p><button mat-stroked-button type="button" data-cy="orgs-retry" (click)="reload()">{{ i18n.t('common.retry') }}</button></div> }
      @else if (!items().length) { <p data-cy="orgs-empty">{{ i18n.t('common.empty') }}</p> }
      @else {
        <div class="card-grid" role="list" data-cy="orgs-list" [attr.aria-label]="i18n.t('org.publicList')">
          @for (org of items(); track org.id) {
            <a class="panel organization-card" role="listitem" [routerLink]="['/organizations', org.id]" [attr.data-cy]="'org-card-' + org.name">
              <h2 [attr.data-cy]="'orgs-card-name-' + org.id">{{ org.name }}</h2>
              @if (org.description) { <p [attr.data-cy]="'orgs-card-description-' + org.id">{{ org.description }}</p> }
              @if (org.website) { <p class="muted" [attr.data-cy]="'orgs-card-website-' + org.id">{{ org.website }}</p> }
            </a>
          }
        </div>
        <div class="pager" data-cy="orgs-pager">
          <button mat-stroked-button type="button" data-cy="orgs-page-previous" [disabled]="page <= 1" (click)="goPage(page - 1)">{{ i18n.t('common.previous') }}</button>
          <span data-cy="orgs-page">{{ page }} / {{ pages() }}</span>
          <button mat-stroked-button type="button" data-cy="orgs-page-next" [disabled]="page >= pages()" (click)="goPage(page + 1)">{{ i18n.t('common.next') }}</button>
        </div>
      }
    </section>
  `
})
export class OrganizationListComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly items = signal<PublicOrganizationResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly pages = signal(1);
  search = '';
  page = 1;
  pageSize = 20;

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
      const response = await firstValueFrom(this.client.organizationsGET(this.search || undefined, this.page, this.pageSize));
      this.items.set(response.items ?? []);
      this.pages.set(totalPages(response.totalCount ?? 0, response.pageSize || this.pageSize));
    } catch {
      this.error.set(this.i18n.t('org.loadFailed'));
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
