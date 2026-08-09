import { CommonModule } from '@angular/common';
import { Component, computed, signal, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../auth/auth.service';
import { LIVE_BACKEND_MODE } from '../../backend/application-backend';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { canManageLive } from '../../data/live-command-ux';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { LiveTournamentDocument, LiveTournamentStage } from '../../domain/live-tournament';
import { PersistedLeague, PLACEHOLDER_LEAGUE_ID } from '../../domain/models';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { I18nService } from '../../i18n/i18n.service';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatCardModule, MatProgressSpinnerModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />

    <section class="page-heading live-tournament-heading running-tournament-heading">
      <div>
        <h1>{{ i18n.t('liveList.title') }}</h1>
      </div>
    </section>

    @if (localMode) { <p class="muted" role="status" data-cy="live-local-mode-notice">{{ i18n.t('live.localModeNotice') }}</p> }
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (loading()) { <mat-spinner diameter="40" /> }
    @else {
      <section class="running-tournament-list" [attr.aria-label]="i18n.t('liveList.aria')">
        @if (!runningTournaments().length) {
          <mat-card class="panel running-tournament-empty" data-cy="running-tournament-empty-state">
            <mat-card-title>{{ i18n.t('liveList.emptyTitle') }}</mat-card-title>
            <mat-card-content><p>{{ i18n.t('liveList.emptyBody') }}</p></mat-card-content>
          </mat-card>
        }
        @for (tournament of runningTournaments(); track tournament.id) {
          <a class="panel running-tournament-card" [routerLink]="['/live-tournaments', tournament.id]" [attr.aria-label]="i18n.t('liveList.resumeAria', { name: tournament.name || i18n.t('liveList.liveTournament') })" data-cy="running-tournament-card">
            <div class="running-tournament-card-header">
              <div class="running-tournament-title-row">
                <h2>{{ tournament.name || i18n.t('liveList.liveTournament') }}</h2>
                <span class="running-tournament-league">{{ leagueName(tournament.leagueId) }}</span>
                <span class="running-tournament-rounds">{{ i18n.t('liveList.swissRounds', { count: tournament.roundCount }) }}</span>
              </div>
              <span class="running-tournament-status" [ngClass]="statusClass(tournament.stage)">{{ statusLabel(tournament.stage, tournament.currentRoundNumber) }}</span>
            </div>
            <div class="running-tournament-card-content">
              <dl class="running-tournament-meta" [attr.aria-label]="i18n.t('liveList.detailsAria')">
                <div><dt>{{ i18n.t('common.date') }}</dt><dd>{{ formatDate(tournament.tournamentDate) }}</dd></div>
                <div><dt>{{ i18n.t('common.players') }}</dt><dd>{{ tournament.players.length }}</dd></div>
                <div><dt>{{ i18n.t('liveList.lastSaved') }}</dt><dd>{{ formatDateTime(tournament.updatedAt) }}</dd></div>
              </dl>
            </div>
            <div class="running-tournament-actions">
              <span class="running-tournament-resume" data-cy="resume-running-tournament">{{ i18n.t('liveList.resume') }}</span>
            </div>
          </a>
        }

        @if (canManage()) {
          <button class="running-tournament-card running-tournament-create-card league-create-card" type="button" [disabled]="creating()" (click)="createTournament()" data-cy="create-running-tournament-card">
            <h2>{{ creating() ? i18n.t('common.creating') : i18n.t('liveList.create') }}</h2>
            <span class="card-view-action" aria-hidden="true">{{ i18n.t('common.create') }}</span>
          </button>
        } @else { <p class="muted" data-cy="live-list-read-only">{{ i18n.t('live.readOnly') }}</p> }
      </section>
    }

    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `
})
export class LiveTournamentListComponent {
  readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly error = signal('');
  readonly tournaments = signal<LiveTournamentDocument[]>([]);
  readonly leagues = signal<PersistedLeague[]>([]);
  readonly runningTournaments = computed(() => this.tournaments().filter((tournament) => tournament.stage !== 'completed'));
  /** Resolved once, with the port itself (ADR 0021): a role change mid-session needs a reload. */
  readonly localMode = inject(LIVE_BACKEND_MODE) === 'browser-local';
  /** In the browser-local store the visitor owns everything they can see, so they always manage it. */
  readonly canManage = computed(() => this.localMode || canManageLive(this.auth.profile()?.globalRole));

  constructor(private readonly liveRepo: LiveTournamentRepository, private readonly leagueRepo: LeagueArchiveRepository, private readonly router: Router) { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      // The browser-local store never finalizes into a League, and Leagues are a server read the
      // anonymous visitor is not entitled to — so local mode does not ask for them at all.
      const [tournaments, leagues] = await Promise.all([this.liveRepo.list(), this.localMode ? Promise.resolve([]) : this.leagueRepo.listLeagues()]);
      this.tournaments.set(tournaments);
      this.leagues.set(leagues);
      this.error.set('');
    } catch (error) {
      logBoundaryError('live-tournament-list.load', error);
      this.error.set(this.i18n.t('liveList.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  async createTournament(): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    try {
      const tournament = await this.liveRepo.create();
      await this.router.navigate(['/live-tournaments', tournament.id], { state: { editTitle: true } });
    } catch (error) {
      logBoundaryError('live-tournament-list.create', error);
      this.error.set(this.i18n.t('liveList.createFailed'));
    } finally {
      this.creating.set(false);
    }
  }

  leagueName(leagueId: string): string {
    if (!leagueId || leagueId === PLACEHOLDER_LEAGUE_ID) return this.i18n.t('liveList.unassigned');
    return this.leagues().find((league) => league.id === leagueId)?.name ?? this.i18n.t('liveList.unknownLeague');
  }

  statusLabel(stage: LiveTournamentStage, currentRoundNumber: number): string {
    if (stage === 'registration') return this.i18n.t('liveList.statusRegistration');
    if (stage === 'round') return this.i18n.t('liveList.statusRound', { n: currentRoundNumber });
    if (stage === 'standings') return this.i18n.t('liveList.statusRunning');
    return this.i18n.t('liveList.statusCompleted');
  }

  statusClass(stage: LiveTournamentStage): string {
    if (stage === 'registration') return 'running-tournament-status--registration';
    if (stage === 'completed') return 'running-tournament-status--completed';
    return 'running-tournament-status--running';
  }

  formatDate(value: string): string {
    return this.i18n.formatDate(value, { dateStyle: 'medium' });
  }

  formatDateTime(value: string): string {
    return this.i18n.formatDateTime(value);
  }
}
