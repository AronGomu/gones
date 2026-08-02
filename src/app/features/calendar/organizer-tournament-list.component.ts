import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { Client, TournamentManagementResponse, TournamentMutationResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { MessageKey } from '../../i18n/messages';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { canCancelTournament, canEditTournament } from './tournament-management';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatDialogModule],
  template: `
    <section class="tournament-management-page stack" data-cy="organizer-tournaments" aria-labelledby="organizer-tournaments-title">
      <header class="page-heading">
        <div><p class="kicker">{{ i18n.t('tournamentCreate.kicker') }}</p><h1 id="organizer-tournaments-title">{{ i18n.t('tournamentManage.title') }}</h1></div>
        <a mat-flat-button class="home-primary-action" routerLink="/organizer/tournaments/new">{{ i18n.t('tournamentManage.create') }}</a>
      </header>
      <p class="muted">{{ i18n.t('tournamentManage.scopeHelp') }}</p>

      @if (loading()) { <p role="status" data-cy="tournament-management-loading">{{ i18n.t('common.loading') }}</p> }
      @else if (error()) {
        <div class="error stack" role="alert" data-cy="tournament-management-error"><span>{{ error() }}</span><button mat-stroked-button type="button" (click)="load()">{{ i18n.t('common.retry') }}</button></div>
      } @else if (!items().length) {
        <div class="panel stack tournament-management-empty" data-cy="tournament-management-empty"><h2>{{ i18n.t('tournamentManage.emptyTitle') }}</h2><p>{{ i18n.t('tournamentManage.emptyBody') }}</p></div>
      } @else {
        <div class="tournament-management-list" role="list">
          @for (tournament of items(); track tournament.id) {
            <mat-card class="panel tournament-management-row" role="listitem" [attr.data-cy]="'tournament-row-' + tournament.id">
              <mat-card-content class="stack">
                <div class="tournament-management-row-grid">
                  <div><p class="kicker">{{ tournament.organizationName }}</p><h2>{{ tournament.title }}</h2><p class="muted">{{ tournament.venueStartDate }} · {{ tournament.venueStartTime.slice(0, 5) }} · {{ tournament.city }}</p></div>
                  <span [class]="'calendar-status calendar-status--' + tournament.status.toLowerCase()">{{ tournament.status }}</span>
                  <div class="admin-actions tournament-management-actions">
                    <a mat-stroked-button [routerLink]="['/calendar/tournaments', tournament.slug]">{{ i18n.t('tournamentManage.publicView') }}</a>
                    @if (canEdit(tournament)) { <a mat-stroked-button data-cy="tournament-edit" [routerLink]="['/organizer/tournaments', tournament.id, 'edit']">{{ i18n.t('common.edit') }}</a> }
                    @if (canCancel(tournament)) { <button mat-stroked-button type="button" data-cy="tournament-cancel" [disabled]="!!pendingId()" (click)="cancel(tournament)">{{ pendingId() === tournament.id ? i18n.t('tournamentManage.cancelling') : i18n.t('tournamentManage.cancel') }}</button> }
                    @if (canEdit(tournament)) { <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="tournament-delete" [disabled]="!!pendingId()" (click)="delete(tournament)">{{ pendingId() === tournament.id ? i18n.t('common.deleting') : i18n.t('common.delete') }}</button> }
                  </div>
                </div>
              </mat-card-content>
            </mat-card>
          }
        </div>
        <nav class="pager" [attr.aria-label]="i18n.t('calendar.pagesAria')"><button mat-stroked-button type="button" [disabled]="page() <= 1 || !!pendingId()" (click)="goPage(page() - 1)">{{ i18n.t('common.previous') }}</button><span>{{ page() }} / {{ pages() }}</span><button mat-stroked-button type="button" [disabled]="page() >= pages() || !!pendingId()" (click)="goPage(page() + 1)">{{ i18n.t('common.next') }}</button></nav>
      }
      @if (status()) { <p role="status" data-cy="tournament-management-status">{{ status() }}</p> }
    </section>
  `
})
export class OrganizerTournamentListComponent {
  readonly i18n = inject(I18nService);
  private readonly client = inject(Client);
  private readonly dialog = inject(MatDialog);
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
  private readonly mutationKeys = new Map<string, string>();

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const page = Number(params.get('page') ?? 1);
      this.page.set(Number.isInteger(page) && page > 0 ? page : 1);
      void this.load();
    });
  }

  canEdit(tournament: TournamentManagementResponse): boolean { return canEditTournament(tournament); }
  canCancel(tournament: TournamentManagementResponse): boolean { return canCancelTournament(tournament); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(this.client.listOrganizerTournaments(this.page(), this.pageSize));
      this.items.set(response.items);
      this.totalCount.set(response.totalCount);
    } catch {
      this.items.set([]);
      this.error.set(this.i18n.t('tournamentManage.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  goPage(page: number): void { void this.router.navigate([], { relativeTo: this.route, queryParams: { page } }); }

  async cancel(tournament: TournamentManagementResponse): Promise<void> {
    const confirmed = await this.confirm(
      'tournamentManage.cancelTitle',
      'tournamentManage.cancelBody',
      'tournamentManage.cancelConfirm',
      true
    );
    if (!confirmed) return;
    await this.mutate(tournament, 'cancel', () => firstValueFrom(this.client.cancelTournament(tournament.id, tournament.eTag, this.mutationKey('cancel', tournament.id))), response => {
      this.replaceMutation(tournament.id, response);
      this.status.set(this.i18n.t('tournamentManage.cancelled'));
    });
  }

  async delete(tournament: TournamentManagementResponse): Promise<void> {
    const confirmed = await this.confirm(
      'tournamentManage.deleteTitle',
      'tournamentManage.deleteBody',
      'tournamentManage.deleteConfirm',
      true
    );
    if (!confirmed) return;
    await this.mutate(tournament, 'delete', () => firstValueFrom(this.client.deleteTournament(tournament.id, tournament.eTag, this.mutationKey('delete', tournament.id), null)), () => {
      this.items.update(items => items.filter(item => item.id !== tournament.id));
      this.totalCount.update(count => Math.max(0, count - 1));
      this.status.set(this.i18n.t('tournamentManage.deleted'));
    });
  }

  private async confirm(title: MessageKey, message: MessageKey, confirmLabel: MessageKey, destructive: boolean): Promise<boolean> {
    return Boolean(await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: { title: this.i18n.t(title), message: this.i18n.t(message), confirmLabel: this.i18n.t(confirmLabel), destructive }
    }).afterClosed()));
  }

  private async mutate(
    tournament: TournamentManagementResponse,
    action: 'cancel' | 'delete',
    request: () => Promise<TournamentMutationResponse>,
    success: (response: TournamentMutationResponse) => void
  ): Promise<void> {
    if (this.pendingId()) return;
    this.pendingId.set(tournament.id);
    this.error.set('');
    this.status.set('');
    try {
      success(await request());
      this.mutationKeys.delete(`${action}:${tournament.id}`);
    } catch (error) {
      if (error instanceof ApiProblemError) this.mutationKeys.delete(`${action}:${tournament.id}`);
      this.error.set(error instanceof ApiProblemError && error.status === 412
        ? this.i18n.t('tournamentManage.staleList')
        : error instanceof ApiProblemError && (error.status === 403 || error.status === 404 || error.status === 409)
          ? this.i18n.t('tournamentManage.serverRejected')
          : this.i18n.t('tournamentManage.actionFailed'));
      if (error instanceof ApiProblemError && error.status === 412) await this.load();
    } finally {
      this.pendingId.set('');
    }
  }

  private mutationKey(action: 'cancel' | 'delete', id: string): string {
    const key = `${action}:${id}`;
    const existing = this.mutationKeys.get(key);
    if (existing) return existing;
    const created = globalThis.crypto.randomUUID();
    this.mutationKeys.set(key, created);
    return created;
  }

  private replaceMutation(id: string, response: TournamentMutationResponse): void {
    this.items.update(items => items.map(item => item.id === id
      ? { ...item, status: response.status, version: response.version, eTag: response.eTag }
      : item));
  }
}
