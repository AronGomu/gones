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
import { LeagueRepository } from '../../data/league-repository.service';
import { PersistedLeague, PLACEHOLDER_LEAGUE_ID } from '../../domain/models';
import { calculateLeagueResult } from '../../domain/results';
import { I18nService } from '../../i18n/i18n.service';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { TextPromptDialogComponent } from '../../shared/dialogs';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />

    <section class="page-heading league-list-heading">
      <div><h1>{{ i18n.t('leagues.title') }}</h1></div>
    </section>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (showLeagueFilter()) {
      <div class="league-toolbar">
        <mat-form-field appearance="outline" class="search"><mat-label>{{ i18n.t('leagues.search') }}</mat-label><input matInput [(ngModel)]="searchTerm"></mat-form-field>
      </div>
    }
    @if (loading()) { <mat-spinner diameter="40" /> }
    @else {
      @if (!filteredLeagues().length) { <p class="muted">{{ i18n.t('leagues.noneMatch') }}</p> }
      <div class="league-grid">
        @for (league of filteredLeagues(); track league.id) {
          <a class="league-card" [routerLink]="['/leagues', league.id]" data-cy="league-list-item">
            <span class="status league-card-status" [class.completed]="league.status === 'completed'"><span class="status-dot" aria-hidden="true"></span>{{ league.status === 'completed' ? i18n.t('common.completed') : i18n.t('common.active') }}</span>
            <h2>{{ league.name }}</h2>
            <p>{{ leagueMeta(league) }}</p>
            <span class="card-view-action" aria-hidden="true">{{ i18n.t('common.view') }}</span>
          </a>
        }
        <button class="league-card league-create-card" type="button" (click)="createLeague()" data-cy="create-league-card">
          <h2>{{ i18n.t('leagues.newLeague') }}</h2>
          <span class="card-view-action" aria-hidden="true">{{ i18n.t('common.create') }}</span>
        </button>
      </div>
    }

    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `
})
export class LeagueListComponent {
  readonly i18n = inject(I18nService);
  readonly leagues = signal<PersistedLeague[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  searchTerm = '';
  readonly showLeagueFilter = computed(() => this.leagues().length > 9);
  readonly filteredLeagues = computed(() => {
    const search = this.showLeagueFilter() ? this.searchTerm.trim().toLowerCase() : '';
    return this.leagues()
      .filter((league) => league.id !== PLACEHOLDER_LEAGUE_ID || league.tournaments.length > 0)
      .filter((league) => !search || league.name.toLowerCase().includes(search));
  });

  constructor(private readonly repo: LeagueRepository, private readonly router: Router, private readonly dialog: MatDialog) {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try { this.leagues.set(await this.repo.listLeagues()); }
    catch (error) { logBoundaryError('league-list.load', error); this.error.set(this.i18n.t('leagues.loadFailed')); }
    finally { this.loading.set(false); }
  }

  playerCount(league: PersistedLeague): number { return calculateLeagueResult(league).rows.length; }

  leagueMeta(league: PersistedLeague): string {
    const tournamentCount = league.tournaments.length;
    const playerCount = this.playerCount(league);
    return this.i18n.t('leagues.meta', {
      tournaments: this.i18n.plural(tournamentCount, 'leagues.tournamentCount', 'leagues.tournamentCountPlural'),
      players: this.i18n.plural(playerCount, 'leagues.playerCount', 'leagues.playerCountPlural')
    });
  }

  async createLeague(): Promise<void> {
    const name = await firstDialogValue(this.dialog.open(TextPromptDialogComponent, { data: { title: this.i18n.t('leagues.createTitle'), label: this.i18n.t('leagues.createLabel'), confirmLabel: this.i18n.t('leagues.createConfirm') } }).afterClosed());
    if (!name) return;
    const league = await this.repo.createLeague(name);
    await this.router.navigate(['/leagues', league.id]);
  }

}

function firstDialogValue<T>(source: Observable<T | undefined>): Promise<T | undefined> {
  return firstValueFrom(source);
}
