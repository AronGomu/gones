import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../auth/auth.service';
import { canManageLeagues, leagueCommandError } from '../../data/league-archive-command-ux';
import { isAnyPlaceholderLeagueId, isLocalLeagueId } from '../../data/league-archive-origin';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { PersistedLeague } from '../../domain/models';
import { calculateLeagueResult } from '../../domain/results';
import { I18nService } from '../../i18n/i18n.service';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { TextPromptDialogComponent } from '../../shared/dialogs';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, BackButtonComponent],
  template: `
    <gones-back-button data-cy="leagues-archive-list-back-top" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />

    <section class="page-heading league-list-heading" data-cy="leagues-archive-list-heading">
      <div data-cy="leagues-archive-list-heading-block"><h1 data-cy="leagues-archive-list-title">{{ i18n.t('leagues.title') }}</h1></div>
    </section>
    @if (error()) { <p class="error" role="alert" data-cy="leagues-archive-list-error">{{ error() }}</p> }
    <p class="muted" role="status" data-cy="leagues-archive-local-notice">{{ i18n.t('leagues.localNotice') }}</p>
    @if (repo.serverUnavailable()) { <p class="warning" role="status" data-cy="leagues-archive-server-unavailable">{{ i18n.t('leagues.serverUnavailable') }}</p> }
    @if (showLeagueFilter()) {
      <div class="league-toolbar" data-cy="leagues-archive-list-toolbar">
        <mat-form-field appearance="outline" class="search" data-cy="leagues-archive-list-search-field"><mat-label data-cy="leagues-archive-list-search-label">{{ i18n.t('leagues.search') }}</mat-label><input matInput data-cy="leagues-archive-list-search-input" [(ngModel)]="searchTerm"></mat-form-field>
      </div>
    }
    @if (loading()) { <mat-spinner diameter="40" data-cy="leagues-archive-list-spinner" /> }
    @else {
      @if (!filteredLeagues().length) { <p class="muted" data-cy="leagues-archive-list-empty">{{ i18n.t('leagues.noneMatch') }}</p> }
      <div class="league-grid" data-cy="leagues-archive-list-grid">
        @for (league of filteredLeagues(); track league.id) {
          <a class="league-card" [routerLink]="['/leagues-archive', league.id]" data-cy="leagues-archive-list-item">
            <span class="status league-card-status" data-cy="leagues-archive-list-item-status" [class.completed]="league.status === 'completed'"><span class="status-dot" aria-hidden="true" data-cy="leagues-archive-list-item-status-dot"></span>{{ league.status === 'completed' ? i18n.t('common.completed') : i18n.t('common.active') }}</span>
            @if (isLocal(league)) { <span class="league-card-local-badge" data-cy="leagues-archive-list-item-local-badge">{{ i18n.t('leagues.localBadge') }}</span> }
            <h2 data-cy="leagues-archive-list-item-name">{{ leagueDisplayName(league) }}</h2>
            <p data-cy="leagues-archive-list-item-meta">{{ leagueMeta(league) }}</p>
            <span class="card-view-action" aria-hidden="true" data-cy="leagues-archive-list-item-view">{{ i18n.t('common.view') }}</span>
          </a>
        }
        @if (power.enabled()) {
          <button class="league-card league-create-card" type="button" [disabled]="creating()" (click)="createLeague()" data-cy="leagues-archive-list-create-card">
            <h2 data-cy="leagues-archive-list-create-card-title">{{ creating() ? i18n.t('common.creating') : i18n.t('leagues.newLeague') }}</h2>
            <span class="card-view-action" aria-hidden="true" data-cy="leagues-archive-list-create-card-action">{{ i18n.t('common.create') }}</span>
          </button>
        }
        @if (hasUnmanageableServerLeagues()) { <p class="muted" data-cy="leagues-archive-list-read-only">{{ i18n.t('leagues.readOnly') }}</p> }
      </div>
    }

    <gones-back-button data-cy="leagues-archive-list-back-bottom" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `
})
export class LeagueArchiveListComponent {
  readonly i18n = inject(I18nService);
  readonly leagues = signal<PersistedLeague[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly creating = signal(false);
  readonly power = inject(PowerUserSettingsService);
  /** Power mode applies to both stores; role authority still applies to server leagues. */
  readonly hasUnmanageableServerLeagues = computed(() => !this.power.enabled()
    || (this.leagues().some((league) => !isLocalLeagueId(league.id)) && !canManageLeagues(this.auth.profile()?.globalRole)));
  searchTerm = '';
  readonly showLeagueFilter = computed(() => this.leagues().length > 9);
  readonly filteredLeagues = computed(() => {
    const search = this.showLeagueFilter() ? this.searchTerm.trim().toLowerCase() : '';
    return this.leagues()
      .filter((league) => !isAnyPlaceholderLeagueId(league.id) || league.tournaments.length > 0)
      .filter((league) => !search || this.leagueDisplayName(league).toLowerCase().includes(search) || league.name.toLowerCase().includes(search));
  });

  constructor(readonly repo: LeagueArchiveRepository, private readonly auth: AuthService, private readonly router: Router, private readonly dialog: MatDialog) {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try { this.leagues.set(await this.repo.listLeagues()); }
    catch (error) { logBoundaryError('league-list.load', error); this.error.set(this.i18n.t('leagues.loadFailed')); }
    finally { this.loading.set(false); }
  }

  playerCount(league: PersistedLeague): number { return calculateLeagueResult(league).rows.length; }

  isLocal(league: PersistedLeague): boolean { return isLocalLeagueId(league.id); }

  leagueDisplayName(league: PersistedLeague): string {
    return isAnyPlaceholderLeagueId(league.id) ? this.i18n.t('liveList.unassigned') : league.name;
  }

  leagueMeta(league: PersistedLeague): string {
    const tournamentCount = league.tournaments.length;
    const playerCount = this.playerCount(league);
    return this.i18n.t('leagues.meta', {
      tournaments: this.i18n.plural(tournamentCount, 'leagues.tournamentCount', 'leagues.tournamentCountPlural'),
      players: this.i18n.plural(playerCount, 'leagues.playerCount', 'leagues.playerCountPlural')
    });
  }

  async createLeague(): Promise<void> {
    if (!this.power.enabled()) return;
    const name = await firstDialogValue(this.dialog.open(TextPromptDialogComponent, { data: { title: this.i18n.t('leagues.createTitle'), label: this.i18n.t('leagues.createLabel'), confirmLabel: this.i18n.t('leagues.createConfirm') } }).afterClosed());
    if (!name || this.creating()) return;
    this.creating.set(true);
    try {
      const league = await this.repo.createLeague(name);
      this.error.set('');
      await this.router.navigate(['/leagues-archive', league.id]);
    } catch (error) {
      logBoundaryError('league-list.create', error);
      this.error.set(leagueCommandError(error) === 'forbidden' ? this.i18n.t('leagues.forbidden') : this.i18n.t('leagues.createFailed'));
    } finally { this.creating.set(false); }
  }

}

function firstDialogValue<T>(source: Observable<T | undefined>): Promise<T | undefined> {
  return firstValueFrom(source);
}
