import { CommonModule } from '@angular/common';
import { Component, computed, signal, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../auth/auth.service';
import { LIVE_BACKEND_MODE } from '../../backend/application-backend';
import { ServerReadCacheService } from '../../backend/server-read-cache.service';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { canManageLive } from '../../data/live-command-ux';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { LiveTournamentDocument, LiveTournamentStage } from '../../domain/live-tournament';
import { PersistedLeague, PLACEHOLDER_LEAGUE_ID } from '../../domain/models';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { I18nService } from '../../i18n/i18n.service';
import { SyncBarComponent } from '../../shared/sync-bar.component';
import { canUsePowerMutation, PowerUserSettingsService } from '../../shared/power-user-settings.service';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatCardModule, MatProgressSpinnerModule, BackButtonComponent, SyncBarComponent],
  template: `
    <gones-back-button data-cy="live-list-back-top" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />

    <section class="page-heading live-tournament-heading running-tournament-heading" data-cy="live-list-heading">
      <div data-cy="live-list-heading-text">
        <h1 data-cy="live-list-title">{{ i18n.t('liveList.title') }}</h1>
      </div>
    </section>
    <gones-sync-bar cyPrefix="live-list" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="sync()" data-cy="live-list-sync-bar" />

    @if (localMode) { <p class="muted" role="status" data-cy="live-local-mode-notice">{{ i18n.t('live.localModeNotice') }}</p> }
    @if (liveRepo.listStale()) { <p class="warning" role="status" data-cy="live-list-cached-stale">{{ i18n.t('offline.cachedServerRead') }}</p> }
    @if (error()) { <p class="error" role="alert" data-cy="live-list-error">{{ error() }}</p> }
    @if (loading()) { <mat-spinner diameter="40" data-cy="live-list-spinner" /> }
    @else {
      <section class="running-tournament-list" data-cy="live-list-section" [attr.aria-label]="i18n.t('liveList.aria')">
        @if (!runningTournaments().length) {
          <mat-card class="panel running-tournament-empty" data-cy="running-tournament-empty-state">
            <mat-card-title data-cy="live-list-empty-title">{{ i18n.t('liveList.emptyTitle') }}</mat-card-title>
            <mat-card-content data-cy="live-list-empty-content"><p data-cy="live-list-empty-body">{{ i18n.t('liveList.emptyBody') }}</p></mat-card-content>
          </mat-card>
        }
        @for (tournament of runningTournaments(); track tournament.id) {
          <a class="panel running-tournament-card" [routerLink]="['/live-tournaments', tournament.id]" [attr.aria-label]="i18n.t('liveList.resumeAria', { name: tournament.name || i18n.t('liveList.liveTournament') })" data-cy="running-tournament-card">
            <div class="running-tournament-card-header" [attr.data-cy]="'live-list-card-header-' + tournament.id">
              <div class="running-tournament-title-row" [attr.data-cy]="'live-list-card-title-row-' + tournament.id">
                <h2 [attr.data-cy]="'live-list-card-name-' + tournament.id">{{ tournament.name || i18n.t('liveList.liveTournament') }}</h2>
                <span class="running-tournament-league" [attr.data-cy]="'live-list-card-league-' + tournament.id">{{ leagueName(tournament.leagueId) }}</span>
                <span class="running-tournament-rounds" [attr.data-cy]="'live-list-card-rounds-' + tournament.id">{{ i18n.t('liveList.swissRounds', { count: tournament.roundCount }) }}</span>
              </div>
              <span class="running-tournament-status" [attr.data-cy]="'live-list-card-status-' + tournament.id" [ngClass]="statusClass(tournament.stage)">{{ statusLabel(tournament.stage, tournament.currentRoundNumber) }}</span>
            </div>
            <div class="running-tournament-card-content" [attr.data-cy]="'live-list-card-content-' + tournament.id">
              <dl class="running-tournament-meta" [attr.data-cy]="'live-list-card-meta-' + tournament.id" [attr.aria-label]="i18n.t('liveList.detailsAria')">
                <div [attr.data-cy]="'live-list-card-date-' + tournament.id"><dt [attr.data-cy]="'live-list-card-date-term-' + tournament.id">{{ i18n.t('common.date') }}</dt><dd [attr.data-cy]="'live-list-card-date-value-' + tournament.id">{{ formatDate(tournament.tournamentDate) }}</dd></div>
                <div [attr.data-cy]="'live-list-card-players-' + tournament.id"><dt [attr.data-cy]="'live-list-card-players-term-' + tournament.id">{{ i18n.t('common.players') }}</dt><dd [attr.data-cy]="'live-list-card-players-value-' + tournament.id">{{ tournament.players.length }}</dd></div>
                <div [attr.data-cy]="'live-list-card-saved-' + tournament.id"><dt [attr.data-cy]="'live-list-card-saved-term-' + tournament.id">{{ i18n.t('liveList.lastSaved') }}</dt><dd [attr.data-cy]="'live-list-card-saved-value-' + tournament.id">{{ formatDateTime(tournament.updatedAt) }}</dd></div>
              </dl>
            </div>
            <div class="running-tournament-actions" [attr.data-cy]="'live-list-card-actions-' + tournament.id">
              <span class="running-tournament-resume" data-cy="resume-running-tournament">{{ i18n.t('liveList.resume') }}</span>
            </div>
          </a>
        }

        @if (canManage()) {
          <button class="running-tournament-card running-tournament-create-card league-create-card" type="button" [disabled]="creating()" (click)="createTournament()" data-cy="create-running-tournament-card">
            <h2 data-cy="live-list-create-label">{{ creating() ? i18n.t('common.creating') : i18n.t('liveList.create') }}</h2>
            <span class="card-view-action" data-cy="live-list-create-action" aria-hidden="true">{{ i18n.t('common.create') }}</span>
          </button>
        } @else { <p class="muted" data-cy="live-list-read-only">{{ i18n.t('live.readOnly') }}</p> }
      </section>
    }

    <gones-back-button data-cy="live-list-back-bottom" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `
})
export class LiveTournamentListComponent {
  readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly power = inject(PowerUserSettingsService);
  private readonly cache = inject(ServerReadCacheService);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly error = signal('');
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly stale = signal(false);
  readonly tournaments = signal<LiveTournamentDocument[]>([]);
  readonly leagues = signal<PersistedLeague[]>([]);
  readonly runningTournaments = computed(() => this.tournaments().filter((tournament) => tournament.stage !== 'completed'));
  /** Resolved once, with the port itself (ADR 0021): a role change mid-session needs a reload. */
  readonly localMode = inject(LIVE_BACKEND_MODE) === 'browser-local';
  /** In the browser-local store the visitor owns everything they can see, so they have Live authority. */
  readonly existingAuthorityAllowed = computed(() => this.localMode || canManageLive(this.auth.profile()?.globalRole));
  readonly canManage = computed(() => canUsePowerMutation(this.power.enabled(), this.existingAuthorityAllowed()));

  constructor(readonly liveRepo: LiveTournamentRepository, private readonly leagueRepo: LeagueArchiveRepository, private readonly router: Router) { void this.load(); }

  async load(options: { force?: boolean } = {}): Promise<void> {
    this.loading.set(true);
    try {
      // The browser-local store never finalizes into a League, and Leagues are a server read the
      // anonymous visitor is not entitled to — so local mode does not ask for them at all.
      const [listResult, leagues] = await Promise.all([
        this.cache.readCached('live-tournaments', () => this.liveRepo.list(), options),
        this.localMode ? Promise.resolve([]) : this.leagueRepo.listLeagues()
      ]);
      this.tournaments.set(listResult.value);
      this.syncedAt.set(listResult.fetchedAt);
      this.stale.set(listResult.stale);
      this.leagues.set(leagues);
      this.error.set('');
    } catch (error) {
      logBoundaryError('live-tournament-list.load', error);
      this.error.set(this.i18n.t('liveList.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  sync(): void { void this.load({ force: true }); }

  async createTournament(): Promise<void> {
    if (!this.canManage() || this.creating()) return;
    this.creating.set(true);
    try {
      const tournament = await this.liveRepo.create();
      await this.cache.invalidate('live-tournaments');
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
