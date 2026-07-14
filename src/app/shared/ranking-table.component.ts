import { Component, Input, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatTableModule } from '@angular/material/table';
import { RankingRow } from '../domain/results';
import { I18nService } from '../i18n/i18n.service';

let nextRankingTableId = 0;

@Component({
  selector: 'gones-ranking-table',
  standalone: true,
  imports: [MatTableModule, RouterLink],
  template: `
    <section class="collapsible-table" [class.is-collapsed]="collapsed" data-cy="collapsible-ranking-table">
      <button
        type="button"
        class="collapsible-table__header"
        [attr.aria-expanded]="!collapsed"
        [attr.aria-controls]="panelId"
        [attr.aria-label]="collapsed ? i18n.t('ranking.expand') : i18n.t('ranking.collapse')"
        (click)="toggleCollapsed()"
        data-cy="ranking-table-toggle"
      >
        <span class="collapsible-table__chevron" aria-hidden="true">{{ collapsed ? '▸' : '▾' }}</span>
        <span class="muted collapsible-table__summary">{{ rankingSummary }}</span>
      </button>
      <div [id]="panelId" class="collapsible-table__content" [hidden]="collapsed">
        @if (!rows.length) {
          <p class="muted" data-cy="empty-ranking">{{ emptyText || i18n.t('ranking.empty') }}</p>
        } @else {
          <div class="table-wrap">
            <table mat-table [dataSource]="rows" class="ranking-table" data-cy="ranking-table">
              <ng-container matColumnDef="rank"><th mat-header-cell *matHeaderCellDef>{{ i18n.t('common.rank') }}</th><td mat-cell *matCellDef="let row">{{ row.rank }}</td></ng-container>
              <ng-container matColumnDef="player"><th mat-header-cell *matHeaderCellDef>{{ i18n.t('common.player') }}</th><td mat-cell *matCellDef="let row"><a [routerLink]="['/players', row.playerName]">{{ row.playerName }}</a></td></ng-container>
              <ng-container matColumnDef="points"><th mat-header-cell *matHeaderCellDef>{{ i18n.t('common.pts') }}</th><td mat-cell *matCellDef="let row">{{ row.points }}</td></ng-container>
              <ng-container matColumnDef="record"><th mat-header-cell *matHeaderCellDef>{{ i18n.t('common.record') }}</th><td mat-cell *matCellDef="let row"><span class="record-win">{{ row.matchWins }}</span>-<span class="record-loss">{{ row.matchLosses }}</span>-<span class="record-draw">{{ row.matchDraws }}</span> @if (row.byes) { <span class="record-byes">{{ i18n.t('ranking.bye', { count: row.byes }) }}</span> }</td></ng-container>
              <ng-container matColumnDef="omw"><th mat-header-cell *matHeaderCellDef>{{ i18n.t('common.omw') }}</th><td mat-cell *matCellDef="let row">{{ formatPercentage(row.opponentsMatchWinPercentage) }}</td></ng-container>
              <ng-container matColumnDef="gw"><th mat-header-cell *matHeaderCellDef>{{ i18n.t('common.gw') }}</th><td mat-cell *matCellDef="let row">{{ formatPercentage(row.gameWinPercentage) }}</td></ng-container>
              <ng-container matColumnDef="ogw"><th mat-header-cell *matHeaderCellDef>{{ i18n.t('common.ogw') }}</th><td mat-cell *matCellDef="let row">{{ formatPercentage(row.opponentsGameWinPercentage) }}</td></ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr
                mat-row
                *matRowDef="let row; columns: columns"
                class="ranking-table__clickable-row"
                tabindex="0"
                role="link"
                [attr.aria-label]="i18n.t('ranking.openPlayerAria', { name: row.playerName })"
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
  readonly i18n = inject(I18nService);
  @Input({ required: true }) rows: RankingRow[] = [];
  @Input() emptyText = '';
  columns = ['rank', 'player', 'points', 'record', 'omw', 'gw', 'ogw'];
  collapsed = false;
  readonly panelId = `ranking-table-panel-${nextRankingTableId++}`;

  constructor(private readonly router: Router) {}

  get rankingSummary(): string {
    if (!this.rows.length) return this.i18n.t('ranking.noPlayers');
    return this.i18n.plural(this.rows.length, 'ranking.summaryOne', 'ranking.summaryMany');
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
  }

  openPlayerStats(row: RankingRow): void {
    void this.router.navigate(['/players', row.playerName]);
  }

  formatPercentage(value: number | null | undefined): string {
    return value === null || value === undefined ? this.i18n.t('common.na') : `${Math.round(value * 100)}%`;
  }
}
