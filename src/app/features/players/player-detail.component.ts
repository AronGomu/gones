import { Component, computed, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { LeagueRepository } from '../../data/league-repository.service';
import { GonesData, PersistedLeague } from '../../domain/models';
import { calculatePlayerStatistics } from '../../domain/player-stats';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, BackButtonComponent],
  template: `
    <gones-back-button label="Back to previous page" position="top" />
    <section class="page-heading"><div><p class="kicker">Player Statistics</p><h1>{{ playerName() }}</h1></div></section>
    <mat-form-field appearance="outline"><mat-label>Filter matches</mat-label><input matInput [(ngModel)]="matchSearch"></mat-form-field>
    <div class="stat-grid">
      <mat-card><mat-card-title>Played Matches</mat-card-title><mat-card-content>{{ stats().playedMatchCount }}</mat-card-content></mat-card>
      <mat-card><mat-card-title>Byes</mat-card-title><mat-card-content>{{ stats().byeCount }}</mat-card-content></mat-card>
      <mat-card><mat-card-title>Match Win Rate</mat-card-title><mat-card-content>{{ pct(stats().matchWinrate) }}</mat-card-content></mat-card>
      <mat-card><mat-card-title>Game Win Rate</mat-card-title><mat-card-content>{{ pct(stats().gameWinrate) }}</mat-card-content></mat-card>
      <mat-card><mat-card-title>Nemesis</mat-card-title><mat-card-content>{{ stats().nemesis || 'N/A' }}</mat-card-content></mat-card>
      <mat-card><mat-card-title>Rival</mat-card-title><mat-card-content>{{ stats().rival || 'N/A' }}</mat-card-content></mat-card>
    </div>
    <section class="stack"><h2>Matches</h2>
      @if (!filteredMatches().length) { <p class="muted">No Matches.</p> }
      @for (match of filteredMatches(); track match.tournament.id + match.roundIndex + match.opponentName) {
        <mat-card class="match-card"><mat-card-title>{{ match.tournament.tournamentDate || 'No date' }} · {{ match.league.name }} {{ match.tournament.name }} Round {{ match.roundIndex + 1 }}</mat-card-title><mat-card-content>{{ match.opponentName }} · {{ match.ownScore }}-{{ match.opponentScore }}</mat-card-content></mat-card>
      }
    </section>
    <gones-back-button label="Back to previous page" position="bottom" />
  `
})
export class PlayerDetailComponent {
  readonly playerName = signal('');
  readonly leagues = signal<PersistedLeague[]>([]);
  matchSearch = '';
  readonly data = computed<GonesData>(() => ({ version: 2, leagues: this.leagues() }));
  readonly stats = computed(() => calculatePlayerStatistics(this.data(), this.playerName()));
  readonly filteredMatches = computed(() => {
    const search = this.matchSearch.trim().toLowerCase();
    return this.stats().matches.filter((match) => !search || `${match.tournament.name} ${match.league.name} ${match.opponentName}`.toLowerCase().includes(search));
  });

  constructor(private readonly repo: LeagueRepository, private readonly route: ActivatedRoute) {
    this.playerName.set(this.route.snapshot.paramMap.get('playerName') ?? '');
    void this.repo.listLeagues().then((leagues) => this.leagues.set(leagues));
  }
  pct(value: number | null): string { return value == null ? 'N/A' : `${Math.round(value * 100)}%`; }
}
