import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { Client, TournamentManagementResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule],
  template: `
    <section class="tournament-management-page stack" data-cy="deleted-tournaments" aria-labelledby="deleted-tournaments-title">
      <header class="page-heading" data-cy="deleted-tournaments-heading"><div data-cy="deleted-tournaments-heading-text"><p class="kicker" data-cy="deleted-tournaments-kicker">{{ i18n.t('admin.kicker') }}</p><h1 id="deleted-tournaments-title" data-cy="deleted-tournaments-title">{{ i18n.t('tournamentManage.deletedTitle') }}</h1></div><a mat-stroked-button routerLink="/admin" data-cy="deleted-tournaments-back">{{ i18n.t('admin.back') }}</a></header>
      <p class="muted" data-cy="deleted-tournaments-help">{{ i18n.t('tournamentManage.restoreHelp') }}</p>
      @if (loading()) { <p role="status" data-cy="deleted-tournaments-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) { <div class="error stack" role="alert" data-cy="deleted-tournaments-error"><span data-cy="deleted-tournaments-error-text">{{ error() }}</span><button mat-stroked-button type="button" data-cy="deleted-tournaments-retry" (click)="load()">{{ i18n.t('common.retry') }}</button></div> }
      @else if (!items().length) { <div class="panel stack" data-cy="deleted-tournaments-empty"><h2 data-cy="deleted-tournaments-empty-title">{{ i18n.t('tournamentManage.deletedEmpty') }}</h2></div> }
      @else {
        <div class="tournament-management-list" role="list" data-cy="deleted-tournaments-list">
          @for (tournament of items(); track tournament.id) {
            <mat-card class="panel tournament-management-row" role="listitem" [attr.data-cy]="'deleted-tournament-row-' + tournament.id"><mat-card-content [attr.data-cy]="'deleted-tournament-content-' + tournament.id">
              <div class="tournament-management-row-grid" [attr.data-cy]="'deleted-tournament-grid-' + tournament.id">
                <div [attr.data-cy]="'deleted-tournament-summary-' + tournament.id"><p class="kicker" [attr.data-cy]="'deleted-tournament-organization-' + tournament.id">{{ tournament.organizationName }}</p><h2 [attr.data-cy]="'deleted-tournament-title-' + tournament.id">{{ tournament.title }}</h2><p class="muted" [attr.data-cy]="'deleted-tournament-reason-' + tournament.id">{{ tournament.deletedReason || i18n.t('tournamentManage.noDeleteReason') }}</p></div>
                <span class="warning" [attr.data-cy]="'deleted-tournament-badge-' + tournament.id">{{ i18n.t('admin.deleted') }}</span>
                <div class="admin-actions" [attr.data-cy]="'deleted-tournament-actions-' + tournament.id"><button mat-flat-button type="button" data-cy="tournament-restore" [disabled]="!!pendingId()" (click)="restore(tournament)">{{ pendingId() === tournament.id ? i18n.t('tournamentManage.restoring') : i18n.t('admin.restore') }}</button></div>
              </div>
            </mat-card-content></mat-card>
          }
        </div>
        <nav class="pager" data-cy="deleted-tournaments-pager" [attr.aria-label]="i18n.t('calendar.pagesAria')"><button mat-stroked-button type="button" data-cy="deleted-tournaments-page-previous" [disabled]="page() <= 1 || !!pendingId()" (click)="goPage(page() - 1)">{{ i18n.t('common.previous') }}</button><span data-cy="deleted-tournaments-page">{{ page() }} / {{ pages() }}</span><button mat-stroked-button type="button" data-cy="deleted-tournaments-page-next" [disabled]="page() >= pages() || !!pendingId()" (click)="goPage(page() + 1)">{{ i18n.t('common.next') }}</button></nav>
      }
      @if (status()) { <p role="status" data-cy="deleted-tournaments-status">{{ status() }}</p> }
    </section>
  `
})
export class AdminDeletedTournamentsComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly items = signal<TournamentManagementResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly status = signal('');
  readonly pendingId = signal('');
  readonly page = signal(1);
  readonly pageSize = 20;
  readonly totalCount = signal(0);
  readonly pages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const page = Number(params.get('page') ?? 1);
      this.page.set(Number.isInteger(page) && page > 0 ? page : 1);
      void this.load();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.client.listDeletedTournaments(this.page(), this.pageSize));
      this.items.set(response.items);
      this.totalCount.set(response.totalCount);
    } catch {
      this.items.set([]);
      this.error.set(this.i18n.t('tournamentManage.loadDeletedFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  goPage(page: number): void { void this.router.navigate([], { relativeTo: this.route, queryParams: { page } }); }

  async restore(tournament: TournamentManagementResponse): Promise<void> {
    if (this.pendingId()) return;
    this.pendingId.set(tournament.id);
    this.error.set('');
    this.status.set('');
    try {
      await firstValueFrom(this.client.restoreTournament(tournament.id, tournament.eTag));
      this.items.update(items => items.filter(item => item.id !== tournament.id));
      this.totalCount.update(count => Math.max(0, count - 1));
      this.status.set(this.i18n.t('tournamentManage.restored'));
    } catch (error) {
      this.error.set(error instanceof ApiProblemError && error.status === 412
        ? this.i18n.t('tournamentManage.staleList')
        : error instanceof ApiProblemError && (error.status === 403 || error.status === 404 || error.status === 409)
          ? this.i18n.t('tournamentManage.restoreRejected')
          : this.i18n.t('tournamentManage.actionFailed'));
      if (error instanceof ApiProblemError && error.status === 412) await this.load();
    } finally {
      this.pendingId.set('');
    }
  }
}
