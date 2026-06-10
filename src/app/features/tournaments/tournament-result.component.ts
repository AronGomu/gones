import { Component, computed, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { LeagueRepository } from '../../data/league-repository.service';
import { PersistedLeague, TournamentDocument } from '../../domain/models';
import { ArchetypeShare, buildTournamentSummary, TournamentSummary } from '../../domain/tournament-summary';
import { logBoundaryError } from '../../shared/app-logger';

@Component({
  standalone: true,
  imports: [MatButtonModule, MatCardModule, RouterLink],
  template: `
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (summary(); as report) {
      <section class="tournament-result-page" [class.result-page--metagame]="page() === 'metagames'" data-cy="tournament-result-page">
        <section class="result-hero">
          <div class="result-title-block">
            <h1><span>{{ league()?.name || 'Unknown league' }}</span><span>&nbsp;</span><span>{{ report.tournamentName }}</span><span class="result-page-separator" aria-hidden="true"> — </span><span class="result-page-label">{{ pageLabel() }}</span></h1>
            <p class="result-subtitle">{{ report.tournamentDate || 'No date' }}</p>
          </div>
          @if (page() === 'standings') {
            <div class="result-counts" aria-label="Tournament statistics">
              <div class="result-player-badge"><span>Players</span><strong>{{ report.stats.playerCount }}</strong></div>
              <div class="result-player-badge"><span>Rounds</span><strong>{{ report.stats.roundCount }}</strong></div>
              <div class="result-player-badge"><span>Matches</span><strong>{{ report.stats.matchCount }}</strong></div>
            </div>
          }
        </section>

        <section class="result-page-body">
          @if (page() === 'standings') {
            <section class="result-panel result-standings" aria-label="Standings">
              <table>
                <thead><tr><th>#</th><th>Player</th><th>Archetype</th><th>Record</th><th>Pts</th></tr></thead>
                <tbody>
                  @for (row of report.topRows; track row.playerName) {
                    <tr><td class="rank">{{ row.rank }}</td><td><strong>{{ row.playerName }}</strong></td><td>{{ row.archetype }}</td><td>{{ row.record }}</td><td>{{ row.points }}</td></tr>
                  } @empty {
                    <tr><td colspan="5" class="empty">No valid results yet.</td></tr>
                  }
                </tbody>
              </table>
            </section>
          } @else {
            <section class="result-panel result-metagame" aria-label="Metagame">
              @if (metagameSegments().length) {
                <div class="metagame-pie-wrap">
                  <svg class="metagame-pie" viewBox="0 0 100 100" role="img" aria-label="Metagame archetype share pie chart">
                    @for (segment of metagameSegments(); track segment.archetype) {
                      @if (segment.fullCircle) {
                        <circle cx="50" cy="50" r="42" [attr.fill]="segment.color" />
                      } @else {
                        <path [attr.d]="segment.path" [attr.fill]="segment.color"></path>
                      }
                      <text class="metagame-pie-label" [attr.x]="segment.labelX" [attr.y]="segment.labelY" text-anchor="middle">
                        <tspan [attr.x]="segment.labelX" dy="-0.15em">{{ segment.archetype }}</tspan>
                        <tspan [attr.x]="segment.labelX" dy="1.25em">{{ segment.playerCount }}/{{ segment.totalPlayerCount }}</tspan>
                      </text>
                    }
                  </svg>
                </div>
              } @else {
                <p class="empty">No archetype data yet.</p>
              }
              <div class="result-player-badge metagame-player-badge"><span>Players</span><strong>{{ report.stats.playerCount }}</strong></div>
            </section>
          }
        </section>
      </section>
    } @else if (!loading()) {
      <mat-card class="panel"><mat-card-title>Tournament result not found</mat-card-title><mat-card-content><p>The requested Tournament result does not exist or was deleted.</p></mat-card-content></mat-card>
    }
    @if (!loading() && leagueId()) {
      <footer class="back-button-row back-button-row--bottom result-footer" aria-label="Result page navigation">
        <a mat-stroked-button class="back-button secondary-action" [routerLink]="['/leagues', leagueId(), 'tournaments', tournamentId()]">Back to Tournament</a>
        @if (page() === 'standings') {
          <a mat-stroked-button class="back-button secondary-action" [routerLink]="['/leagues', leagueId(), 'tournaments', tournamentId(), 'result', 'metagames']">See Archetype Share</a>
        } @else {
          <a mat-stroked-button class="back-button secondary-action" [routerLink]="['/leagues', leagueId(), 'tournaments', tournamentId(), 'result']">See Standings</a>
        }
      </footer>
    }
  `
})
export class TournamentResultComponent {
  readonly loading = signal(true);
  readonly error = signal('');
  readonly league = signal<PersistedLeague | null>(null);
  readonly leagueId = signal('');
  readonly tournamentId = signal('');
  readonly tournament = computed(() => this.league()?.tournaments.find((item) => item.id === this.tournamentId()) ?? null);
  readonly summary = computed<TournamentSummary | null>(() => this.tournament() ? buildTournamentSummary(this.tournament() as TournamentDocument) : null);
  readonly page = signal<'standings' | 'metagames'>('standings');
  readonly pageLabel = computed(() => this.page() === 'metagames' ? 'Metagame' : 'Standings');
  readonly metagameSegments = computed(() => buildPieSegments(this.summary()?.archetypeShares.slice(0, 8) ?? []));

  constructor(private readonly repo: LeagueRepository, private readonly route: ActivatedRoute, private readonly router: Router) { void this.load(); }

  async load(): Promise<void> {
    const leagueId = this.route.snapshot.paramMap.get('leagueId') ?? '';
    const tournamentId = this.route.snapshot.paramMap.get('tournamentId') ?? '';
    this.leagueId.set(leagueId);
    this.tournamentId.set(tournamentId);
    this.page.set(this.router.url.endsWith('/metagames') ? 'metagames' : 'standings');
    try { this.league.set(await this.repo.getLeague(leagueId)); }
    catch (error) { logBoundaryError('tournament-result.load', error, { leagueId, tournamentId }); this.error.set('Could not load this Tournament result.'); }
    finally { this.loading.set(false); }
  }

}

interface PieSegment {
  archetype: string;
  playerCount: number;
  totalPlayerCount: number;
  color: string;
  path: string;
  labelX: string;
  labelY: string;
  fullCircle: boolean;
}

const PIE_COLORS = ['#d73a31', '#f2b84b', '#7fbf5b', '#44a7c4', '#8b6ee8', '#d96fa8', '#d9823b', '#c9d1d9'];

function buildPieSegments(shares: ArchetypeShare[]): PieSegment[] {
  let startAngle = -90;
  return shares.map((share, index) => {
    const sweep = share.percentage * 360;
    const endAngle = startAngle + sweep;
    const midAngle = startAngle + sweep / 2;
    const segment = {
      archetype: share.archetype,
      playerCount: share.playerCount,
      totalPlayerCount: share.totalPlayerCount,
      color: PIE_COLORS[index % PIE_COLORS.length],
      path: describeSlice(50, 50, 42, startAngle, endAngle),
      ...polarPoint(50, 50, 26, midAngle),
      fullCircle: share.percentage >= 0.999
    };
    startAngle = endAngle;
    return segment;
  });
}

function describeSlice(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polarPoint(cx, cy, radius, endAngle);
  const end = polarPoint(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return [`M ${cx} ${cy}`, `L ${start.labelX} ${start.labelY}`, `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.labelX} ${end.labelY}`, 'Z'].join(' ');
}

function polarPoint(cx: number, cy: number, radius: number, angleDegrees: number): { labelX: string; labelY: string } {
  const angleRadians = angleDegrees * Math.PI / 180;
  return {
    labelX: (cx + radius * Math.cos(angleRadians)).toFixed(2),
    labelY: (cy + radius * Math.sin(angleRadians)).toFixed(2)
  };
}
