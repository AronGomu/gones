import { Component, Input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { RankingRow } from '../domain/results';

let nextRankingTableId = 0;

@Component({
  selector: 'gones-ranking-table',
  standalone: true,
  imports: [MatTableModule, RouterLink],
  template: `
    <section class="collapsible-table" [class.is-collapsed]="collapsed" data-cy="collapsible-ranking-table">
      <div class="collapsible-table__header">
        <button
          type="button"
          class="collapsible-table__toggle"
          [attr.aria-expanded]="!collapsed"
          [attr.aria-controls]="panelId"
          [attr.aria-label]="collapsed ? 'Expand Ranking' : 'Collapse Ranking'"
          (click)="toggleCollapsed()"
          data-cy="ranking-table-toggle"
        >
          <span class="collapsible-table__chevron" aria-hidden="true">{{ collapsed ? '▸' : '▾' }}</span>
        </button>
        <p class="muted collapsible-table__summary">{{ rankingSummary }}</p>
      </div>
      <div [id]="panelId" class="collapsible-table__content" [hidden]="collapsed">
        @if (!rows.length) {
          <p class="muted" data-cy="empty-ranking">{{ emptyText }}</p>
        } @else {
          <div class="table-wrap">
            <table mat-table [dataSource]="rows" class="ranking-table" data-cy="ranking-table">
              <ng-container matColumnDef="rank"><th mat-header-cell *matHeaderCellDef>Rank</th><td mat-cell *matCellDef="let row">{{ row.rank }}</td></ng-container>
              <ng-container matColumnDef="player"><th mat-header-cell *matHeaderCellDef>Player</th><td mat-cell *matCellDef="let row"><a [routerLink]="['/players', row.playerName]">{{ row.playerName }}</a></td></ng-container>
              <ng-container matColumnDef="points"><th mat-header-cell *matHeaderCellDef>Pts</th><td mat-cell *matCellDef="let row">{{ row.points }}</td></ng-container>
              <ng-container matColumnDef="record"><th mat-header-cell *matHeaderCellDef>Record</th><td mat-cell *matCellDef="let row"><span class="record-win">{{ row.matchWins }}</span>-<span class="record-loss">{{ row.matchLosses }}</span>-<span class="record-draw">{{ row.matchDraws }}</span> @if (row.byes) { <span class="record-byes">({{ row.byes }} bye)</span> }</td></ng-container>
              <ng-container matColumnDef="omw"><th mat-header-cell *matHeaderCellDef>OMW</th><td mat-cell *matCellDef="let row">{{ formatPercentage(row.opponentsMatchWinPercentage) }}</td></ng-container>
              <ng-container matColumnDef="gw"><th mat-header-cell *matHeaderCellDef>GW</th><td mat-cell *matCellDef="let row">{{ formatPercentage(row.gameWinPercentage) }}</td></ng-container>
              <ng-container matColumnDef="ogw"><th mat-header-cell *matHeaderCellDef>OGW</th><td mat-cell *matCellDef="let row">{{ formatPercentage(row.opponentsGameWinPercentage) }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr
                mat-row
                *matRowDef="let row; columns: columns"
                class="ranking-table__clickable-row"
                tabindex="0"
                role="link"
                [attr.aria-label]="'Open Player Statistics for ' + row.playerName"
                (click)="openPlayerStats(row)"
                (keydown.enter)="openPlayerStats(row)"
                (keydown.space)="$event.preventDefault(); openPlayerStats(row)"
              ></tr>
            </table>
          </div>
        }
      </div>
    </section>
  `
})
export class RankingTableComponent {
  @Input({ required: true }) rows: RankingRow[] = [];
  @Input() emptyText = 'No result yet';
  columns = ['rank', 'player', 'points', 'record', 'omw', 'gw', 'ogw'];
  collapsed = false;
  readonly panelId = `ranking-table-panel-${nextRankingTableId++}`;

  constructor(private readonly router: Router) {}

  get rankingSummary(): string {
    if (!this.rows.length) return 'No ranked players';
    return `${this.rows.length} ranked ${this.rows.length === 1 ? 'player' : 'players'}`;
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
  }

  openPlayerStats(row: RankingRow): void {
    void this.router.navigate(['/players', row.playerName]);
  }

  formatPercentage(value: number | null | undefined): string {
    return value === null || value === undefined ? 'N/A' : `${Math.round(value * 100)}%`;
  }
}
