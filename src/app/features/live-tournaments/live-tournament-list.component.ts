import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LeagueRepository } from '../../data/league-repository.service';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { LiveTournamentDocument, LiveTournamentStage } from '../../domain/live-tournament';
import { PersistedLeague, PLACEHOLDER_LEAGUE_ID } from '../../domain/models';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatCardModule, MatProgressSpinnerModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" label="Back to Menu" position="top" />

    <section class="page-heading live-tournament-heading running-tournament-heading">
      <div>
        <h1>Running Tournaments</h1>
      </div>
    </section>

    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (loading()) { <mat-spinner diameter="40" /> }
    @else {
      <section class="running-tournament-list" aria-label="Running tournaments">
        @if (!runningTournaments().length) {
          <mat-card class="panel running-tournament-empty" data-cy="running-tournament-empty-state">
            <mat-card-title>No running tournaments</mat-card-title>
            <mat-card-content><p>No tournament is running on this device yet.</p></mat-card-content>
          </mat-card>
        }
        @for (tournament of runningTournaments(); track tournament.id) {
          <mat-card class="panel running-tournament-card" data-cy="running-tournament-card">
            <div class="running-tournament-card-header">
              <div class="running-tournament-title-row">
                <h2 mat-card-title>{{ tournament.name || 'Live Tournament' }}</h2>
                <span class="running-tournament-league">{{ leagueName(tournament.leagueId) }}</span>
                <span class="running-tournament-rounds">{{ tournament.roundCount }} Swiss rounds</span>
              </div>
              <span class="running-tournament-status" [ngClass]="statusClass(tournament.stage)">{{ statusLabel(tournament.stage, tournament.currentRoundNumber) }}</span>
            </div>
            <mat-card-content>
              <dl class="running-tournament-meta" aria-label="Tournament details">
                <div><dt>Date</dt><dd>{{ formatDate(tournament.tournamentDate) }}</dd></div>
                <div><dt>Players</dt><dd>{{ tournament.players.length }}</dd></div>
                <div><dt>Last saved</dt><dd>{{ formatDateTime(tournament.updatedAt) }}</dd></div>
              </dl>
            </mat-card-content>
            <mat-card-actions class="running-tournament-actions">
              <a class="running-tournament-resume" [routerLink]="['/live-tournaments', tournament.id]" [attr.aria-label]="'Resume ' + (tournament.name || 'Live Tournament')" data-cy="resume-running-tournament">Resume</a>
            </mat-card-actions>
          </mat-card>
        }

        <button class="running-tournament-card running-tournament-create-card league-create-card" type="button" [disabled]="creating()" (click)="createTournament()" data-cy="create-running-tournament-card">
          <h2>{{ creating() ? 'Creating…' : 'Create a new tournament' }}</h2>
          <span class="card-view-action" aria-hidden="true">CREATE</span>
        </button>
      </section>
    }
  `
})
export class LiveTournamentListComponent {
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly error = signal('');
  readonly tournaments = signal<LiveTournamentDocument[]>([]);
  readonly leagues = signal<PersistedLeague[]>([]);
  readonly runningTournaments = computed(() => this.tournaments().filter((tournament) => tournament.stage !== 'completed'));

  constructor(private readonly liveRepo: LiveTournamentRepository, private readonly leagueRepo: LeagueRepository, private readonly router: Router) { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [tournaments, leagues] = await Promise.all([this.liveRepo.list(), this.leagueRepo.listLeagues()]);
      this.tournaments.set(tournaments);
      this.leagues.set(leagues);
      this.error.set('');
    } catch (error) {
      logBoundaryError('live-tournament-list.load', error);
      this.error.set('Could not load running tournaments from this device.');
    } finally {
      this.loading.set(false);
    }
  }

  async createTournament(): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    try {
      const tournament = await this.liveRepo.create();
      await this.router.navigate(['/live-tournaments', tournament.id]);
    } catch (error) {
      logBoundaryError('live-tournament-list.create', error);
      this.error.set('Could not create a running tournament.');
    } finally {
      this.creating.set(false);
    }
  }

  leagueName(leagueId: string): string {
    if (!leagueId || leagueId === PLACEHOLDER_LEAGUE_ID) return 'Unassigned Tournaments';
    return this.leagues().find((league) => league.id === leagueId)?.name ?? 'Unknown league';
  }

  statusLabel(stage: LiveTournamentStage, currentRoundNumber: number): string {
    if (stage === 'registration') return 'Registration';
    if (stage === 'round') return `Round ${currentRoundNumber} running`;
    if (stage === 'standings') return 'Running';
    return 'Completed';
  }

  statusClass(stage: LiveTournamentStage): string {
    if (stage === 'registration') return 'running-tournament-status--registration';
    if (stage === 'completed') return 'running-tournament-status--completed';
    return 'running-tournament-status--running';
  }

  formatDate(value: string): string {
    const date = this.parseDateInput(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
  }

  formatDateTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  private parseDateInput(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return new Date(value);
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
}
