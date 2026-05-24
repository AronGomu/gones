import { Component, Input } from '@angular/core';
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
    } @else {
      <div class="table-wrap">
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

  formatPercentage(value: number | null | undefined): string {
    return value === null || value === undefined ? 'N/A' : `${Math.round(value * 100)}%`;
  }
}
