import { Component, HostListener, Input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { RankingRow } from '../domain/results';

@Component({
  selector: 'gones-ranking-table',
  standalone: true,
  imports: [MatTableModule, RouterLink],
  template: `
    @if (!rows.length) {
      <p class="muted" data-cy="empty-ranking">{{ emptyText }}</p>
    } @else if (isPhoneLayout()) {
      <ol class="ranking-cards" data-cy="ranking-card-list" aria-label="Ranking list">
        @for (row of rows; track row.playerName) {
          <li class="ranking-card">
            <div class="ranking-card-main">
              <span class="rank-badge">#{{ row.rank }}</span>
              <a [routerLink]="['/players', row.playerName]">{{ row.playerName }}</a>
            </div>
            <dl class="ranking-card-stats">
              <div><dt>Record</dt><dd>{{ row.matchWins }}-{{ row.matchLosses }}-{{ row.matchDraws }} @if (row.byes) { <span>({{ row.byes }} bye)</span> }</dd></div>
              <div><dt>Pts</dt><dd>{{ row.points }}</dd></div>
              <div><dt>OMW</dt><dd>{{ formatPercentage(row.opponentsMatchWinPercentage) }}</dd></div>
              <div><dt>GW</dt><dd>{{ formatPercentage(row.gameWinPercentage) }}</dd></div>
              <div><dt>OGW</dt><dd>{{ formatPercentage(row.opponentsGameWinPercentage) }}</dd></div>
            </dl>
          </li>
        }
      </ol>
    } @else {
      <div class="table-wrap" aria-label="Ranking table">
        <table mat-table [dataSource]="rows" class="ranking-table" data-cy="ranking-table">
          <ng-container matColumnDef="rank"><th mat-header-cell *matHeaderCellDef>Rank</th><td mat-cell *matCellDef="let row">{{ row.rank }}</td></ng-container>
          <ng-container matColumnDef="player"><th mat-header-cell *matHeaderCellDef>Player</th><td mat-cell *matCellDef="let row"><a [routerLink]="['/players', row.playerName]">{{ row.playerName }}</a></td></ng-container>
          <ng-container matColumnDef="record"><th mat-header-cell *matHeaderCellDef>Record</th><td mat-cell *matCellDef="let row">{{ row.matchWins }}-{{ row.matchLosses }}-{{ row.matchDraws }} @if (row.byes) { <span>({{ row.byes }} bye)</span> }</td></ng-container>
          <ng-container matColumnDef="points"><th mat-header-cell *matHeaderCellDef>Pts</th><td mat-cell *matCellDef="let row">{{ row.points }}</td></ng-container>
          <ng-container matColumnDef="omw"><th mat-header-cell *matHeaderCellDef>OMW</th><td mat-cell *matCellDef="let row">{{ formatPercentage(row.opponentsMatchWinPercentage) }}</td></ng-container>
          <ng-container matColumnDef="gw"><th mat-header-cell *matHeaderCellDef>GW</th><td mat-cell *matCellDef="let row">{{ formatPercentage(row.gameWinPercentage) }}</td></ng-container>
          <ng-container matColumnDef="ogw"><th mat-header-cell *matHeaderCellDef>OGW</th><td mat-cell *matCellDef="let row">{{ formatPercentage(row.opponentsGameWinPercentage) }}</td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
      </div>
    }
  `
})
export class RankingTableComponent {
  @Input({ required: true }) rows: RankingRow[] = [];
  @Input() emptyText = 'No result yet';
  columns = ['rank', 'player', 'record', 'points', 'omw', 'gw', 'ogw'];
  readonly isPhoneLayout = signal(getIsPhoneLayout());

  @HostListener('window:resize') updateLayout(): void {
    this.isPhoneLayout.set(getIsPhoneLayout());
  }

  formatPercentage(value: number | null | undefined): string {
    return value === null || value === undefined ? 'N/A' : `${Math.round(value * 100)}%`;
  }
}

function getIsPhoneLayout(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
}
