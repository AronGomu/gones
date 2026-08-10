import { Component, computed, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../auth/auth.service';
import { canManageLeague, leagueCommandError } from '../../data/league-archive-command-ux';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { LeagueDocument, PersistedLeague, PLACEHOLDER_LEAGUE_ID } from '../../domain/models';
import { calculateLeagueEndDate, calculateLeagueResult, calculateLeagueStartDate } from '../../domain/results';
import { I18nService } from '../../i18n/i18n.service';
import { RankingTableComponent } from '../../shared/ranking-table.component';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, RankingTableComponent, BackButtonComponent],
  template: `
    <gones-back-button data-cy="leagues-archive-detail-back-top" [link]="['/leagues-archive']" [label]="i18n.t('nav.backToLeagues')" position="top" />
    @if (error()) { <p class="error" role="alert" data-cy="leagues-archive-detail-error">{{ error() }}</p> }
    @if (league(); as saved) {
      <section class="page-heading" data-cy="leagues-archive-detail-heading">
        <div data-cy="leagues-archive-detail-heading-block">
          @if (titleEditing() && !isPlaceholderLeague(saved)) { <mat-form-field appearance="outline" class="title-field" data-cy="leagues-archive-detail-name-field"><mat-label data-cy="leagues-archive-detail-name-label">{{ i18n.t('leagues.name') }}</mat-label><input #leagueNameInput data-cy="leagues-archive-detail-name-input" matInput [(ngModel)]="leagueNameDraft" [readonly]="saving()" (blur)="saveTitleEdit({ restoreFocus: false })" (keydown.enter)="$event.preventDefault(); saveTitleEdit({ restoreFocus: true })"></mat-form-field> }
          @else if (isPlaceholderLeague(saved)) { <h1 data-cy="leagues-archive-detail-placeholder-title">{{ leagueDisplayName(saved) }}</h1> }
          @else if (canManage()) { <h1 data-cy="leagues-archive-detail-editable-title"><button #leagueTitleButton class="editable-title" type="button" data-cy="leagues-archive-detail-title-button" (click)="startTitleEdit()" [attr.aria-label]="i18n.t('leagues.editNameAria', { name: saved.name })">{{ saved.name }}</button></h1> }
          @else { <h1 data-cy="leagues-archive-detail-title">{{ saved.name }}</h1> }
          <p class="muted" data-cy="leagues-archive-detail-date-range">{{ i18n.t('leagues.dateRange', { count: saved.tournaments.length, start: startDate(saved) || i18n.t('leagues.noStartDate'), end: endDate(saved) || i18n.t('leagues.noEndDate') }) }}</p>
        </div>

      </section>

      <section class="stack" data-cy="leagues-archive-detail-ranking-section">
        <h2 data-cy="leagues-archive-detail-ranking-title">{{ i18n.t('leagues.ranking') }}</h2>
        <gones-ranking-table data-cy="leagues-archive-detail-ranking-table" [rows]="result().rows" [emptyText]="i18n.t('leagues.emptyRanking')" />
      </section>

      <section class="stack" data-cy="leagues-archive-detail-tournaments-section">
        <div class="section-header" data-cy="leagues-archive-detail-tournaments-header"><h2 data-cy="leagues-archive-detail-tournaments-title">{{ i18n.t('leagues.tournaments') }}</h2></div>
        @if (!saved.tournaments.length) { <mat-card class="panel" data-cy="leagues-archive-detail-no-tournaments"><mat-card-content data-cy="leagues-archive-detail-no-tournaments-body">{{ i18n.t('leagues.noTournaments') }}</mat-card-content></mat-card> }
        <div class="tournament-card-grid" data-cy="leagues-archive-detail-tournament-grid">
          @for (tournament of sortedTournaments(); track tournament.id) {
            <a class="tournament-rect-card" data-cy="leagues-archive-detail-tournament-card" [routerLink]="['/leagues-archive', saved.id, 'tournaments-archive', tournament.id]" [attr.aria-label]="i18n.t('leagues.openTournamentAria', { name: tournament.name })">
              <span class="tournament-card-copy" data-cy="leagues-archive-detail-tournament-card-copy">
                <strong data-cy="leagues-archive-detail-tournament-card-name">{{ tournament.name }}</strong>
                <span data-cy="leagues-archive-detail-tournament-card-date">{{ formatTournamentDate(tournament.tournamentDate) }}</span>
              </span>
              <span class="card-view-action" aria-hidden="true" data-cy="leagues-archive-detail-tournament-card-view">{{ i18n.t('common.view') }}</span>
            </a>
          }
          @if (canManage()) {
            <button class="league-card league-create-card tournament-add-card" type="button" (click)="createNewTournament()" [disabled]="saving()" data-cy="leagues-archive-detail-create-tournament-card">
              <h2 data-cy="leagues-archive-detail-create-tournament-title">{{ saving() ? i18n.t('common.creating') : i18n.t('leagues.addTournament') }}</h2>
              <span class="card-view-action" aria-hidden="true" data-cy="leagues-archive-detail-create-tournament-action">{{ i18n.t('common.create') }}</span>
            </button>
          }
        </div>
      </section>
      @if (!canManage()) { <p class="muted" data-cy="leagues-archive-detail-read-only">{{ i18n.t('leagues.readOnly') }}</p> }
      @if (stale()) { <button type="button" class="secondary-action" data-cy="leagues-archive-detail-reload" (click)="load()">{{ i18n.t('leagues.reloadLatest') }}</button> }

    } @else if (!loading()) {
      <mat-card class="panel" data-cy="leagues-archive-detail-not-found"><mat-card-title data-cy="leagues-archive-detail-not-found-title">{{ i18n.t('leagues.notFoundTitle') }}</mat-card-title><mat-card-content data-cy="leagues-archive-detail-not-found-body"><p data-cy="leagues-archive-detail-not-found-text">{{ i18n.t('leagues.notFoundBody') }}</p></mat-card-content></mat-card>
    }
    @if (!loading()) { <gones-back-button data-cy="leagues-archive-detail-back-bottom" [link]="['/leagues-archive']" [label]="i18n.t('nav.backToLeagues')" position="bottom" /> }
  `
})
export class LeagueArchiveDetailComponent {
  readonly i18n = inject(I18nService);
  @ViewChild('leagueNameInput') private leagueNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('leagueTitleButton') private leagueTitleButton?: ElementRef<HTMLButtonElement>;

  readonly league = signal<PersistedLeague | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly titleEditing = signal(false);
  readonly error = signal('');
  readonly stale = signal(false);
  /** Per league, not per session: a browser-stored league is manageable by anyone (ADR 0028). */
  readonly canManage = computed(() => canManageLeague(this.league()?.id, this.auth.profile()?.globalRole));
  leagueNameDraft = '';
  readonly result = computed(() => calculateLeagueResult(this.league()!));
  readonly sortedTournaments = computed(() => [...(this.league()?.tournaments ?? [])].sort((a, b) => (b.tournamentDate || '9999-12-31').localeCompare(a.tournamentDate || '9999-12-31') || b.name.localeCompare(a.name)));

  constructor(readonly repo: LeagueArchiveRepository, private readonly auth: AuthService, private readonly route: ActivatedRoute, private readonly router: Router) { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    const id = this.route.snapshot.paramMap.get('leagueId') ?? '';
    try { const league = await this.repo.getLeague(id); this.league.set(league); this.leagueNameDraft = league?.name ?? ''; this.titleEditing.set(false); this.stale.set(false); this.error.set(''); }
    catch (error) { logBoundaryError('league-detail.load', error, { leagueId: id }); this.error.set(this.i18n.t('leagues.loadOneFailed')); }
    finally { this.loading.set(false); }
  }

  startDate(league: LeagueDocument): string { return calculateLeagueStartDate(league); }
  endDate(league: LeagueDocument): string { return calculateLeagueEndDate(league); }

  isPlaceholderLeague(league: PersistedLeague): boolean {
    return league.id === PLACEHOLDER_LEAGUE_ID;
  }

  leagueDisplayName(league: PersistedLeague): string {
    return league.id === PLACEHOLDER_LEAGUE_ID ? this.i18n.t('liveList.unassigned') : league.name;
  }

  startTitleEdit(): void {
    const saved = this.league();
    if (!saved || !this.canManage() || this.saving() || this.isPlaceholderLeague(saved)) return;
    this.leagueNameDraft = saved.name;
    this.titleEditing.set(true);
    this.focusLeagueNameInput();
  }

  async saveTitleEdit({ restoreFocus }: { restoreFocus: boolean }): Promise<void> {
    const saved = this.league();
    if (!saved || !this.titleEditing() || this.saving()) return;
    const name = this.validLeagueName(this.leagueNameDraft, saved.name);
    this.leagueNameDraft = name;
    if (name === saved.name) {
      this.titleEditing.set(false);
      if (restoreFocus) this.focusLeagueTitleButton();
      return;
    }

    this.saving.set(true);
    try {
      const updatedLeague = await this.repo.renameLeague(saved, name);
      this.league.set(updatedLeague);
      window.dispatchEvent(new CustomEvent('gones-league-updated', { detail: { leagueId: updatedLeague.id } }));
      this.leagueNameDraft = updatedLeague.name;
      this.titleEditing.set(false);
      this.error.set('');
      if (restoreFocus) this.focusLeagueTitleButton();
    } catch (error) {
      logBoundaryError('league-detail.renameLeague', error, { leagueId: saved.id });
      const kind = leagueCommandError(error);
      this.stale.set(kind === 'stale');
      this.error.set(kind === 'stale' ? this.i18n.t('leagues.staleRename') : kind === 'forbidden' ? this.i18n.t('leagues.forbidden') : this.i18n.t('leagues.renameFailed'));
      this.titleEditing.set(false);
    } finally {
      this.saving.set(false);
    }
  }

  async createNewTournament(): Promise<void> {
    const saved = this.league();
    if (!saved || this.saving()) return;
    this.saving.set(true);
    try {
      const { league: updatedLeague, tournament } = await this.repo.createResultTournament(saved);
      this.league.set(updatedLeague);
      window.dispatchEvent(new CustomEvent('gones-league-updated', { detail: { leagueId: updatedLeague.id } }));
      this.error.set('');
      this.stale.set(false);
      await this.router.navigate(['/leagues-archive', updatedLeague.id, 'tournaments-archive', tournament.id]);
    } catch (error) {
      logBoundaryError('league-detail.createTournament', error, { leagueId: saved.id });
      const kind = leagueCommandError(error);
      this.stale.set(kind === 'stale');
      this.error.set(kind === 'stale' ? this.i18n.t('leagues.staleCreateTournament') : kind === 'forbidden' ? this.i18n.t('leagues.forbidden') : this.i18n.t('leagues.createTournamentFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  formatTournamentDate(value: string): string {
    if (!value) return this.i18n.t('leagues.noTournamentDate');
    return this.i18n.formatDate(value, { dateStyle: 'medium' });
  }

  private validLeagueName(value: string, fallback: string): string { return String(value ?? '').trim() || fallback; }
  private focusLeagueNameInput(): void { setTimeout(() => this.leagueNameInput?.nativeElement.focus()); }
  private focusLeagueTitleButton(): void { setTimeout(() => this.leagueTitleButton?.nativeElement.focus()); }
}
