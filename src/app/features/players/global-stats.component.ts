import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { Client, GlobalPlayerStatisticsRow, OpponentRecord, PlayerArchetypeUsage } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { LatestRequest } from '../../shared/async-guards';
import {
  GLOBAL_STATS_PAGE_SIZES,
  GlobalStatsPageSize,
  GlobalStatsSortCol,
  GlobalStatsQuery,
  globalStatsQueryParams,
  parseGlobalStatsQuery,
  toggleGlobalStatsSort,
} from './global-stats-query';

@Component({
  standalone: true,
  imports: [RouterLink, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule],
  template: `
    <section class="page-heading" data-cy="global-stats-heading">
      <div data-cy="global-stats-heading-text">
        <h1 data-cy="global-stats-title">{{ i18n.t('globalStats.title') }}</h1>
      </div>
    </section>

    <div class="global-stats-controls" data-cy="global-stats-controls">
      <div class="global-stats-search-wrap" data-cy="global-stats-search-wrap">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="global-stats-search-field" data-cy="global-stats-search-field">
          <input
            matInput
            data-cy="global-stats-search-input"
            [placeholder]="i18n.t('globalStats.searchPlaceholder')"
            [attr.aria-label]="i18n.t('globalStats.searchAria')"
            [(ngModel)]="searchDraft"
            (keydown.enter)="applySearch()"
          />
        </mat-form-field>
        <button mat-stroked-button type="button" data-cy="global-stats-search-apply" (click)="applySearch()">{{ i18n.t('common.apply') }}</button>
        @if (searchDraft) {
          <button mat-stroked-button type="button" data-cy="global-stats-search-clear" [attr.aria-label]="i18n.t('globalStats.clearSearchAria')" (click)="clearSearch()">{{ i18n.t('common.clear') }}</button>
        }
      </div>
      <div class="global-stats-size-wrap" data-cy="global-stats-size-wrap">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="global-stats-size-field" data-cy="global-stats-size-field">
          <mat-label data-cy="global-stats-size-label">{{ i18n.t('globalStats.pageSizeLabel') }}</mat-label>
          <mat-select data-cy="global-stats-page-size-select" [value]="currentSize()" (selectionChange)="setSize($event.value)">
            @for (s of pageSizes; track s) {
              <mat-option [value]="s" [attr.data-cy]="'global-stats-size-option-' + s">{{ s }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
    </div>

    @if (loading()) {
      <div data-cy="global-stats-loading"><mat-spinner diameter="36" data-cy="global-stats-spinner" /></div>
    }
    @if (error()) {
      <p class="error" role="alert" data-cy="global-stats-error">{{ error() }}</p>
    }

    @if (!loading() && !error()) {
      <div class="global-stats-status-bar" data-cy="global-stats-status-bar">
        <span aria-live="polite" data-cy="global-stats-count-status">{{ i18n.t('globalStats.pageStatus', { page: currentPage(), total: totalPages(), count: totalCount() }) }}</span>
      </div>

      <div class="table-wrap" data-cy="global-stats-table-wrap">
        <table class="ranking-table" [attr.aria-label]="i18n.t('globalStats.aria')" data-cy="global-stats-table">
          <thead data-cy="global-stats-thead">
            <tr data-cy="global-stats-header-row">
              <th data-cy="global-stats-col-position">{{ i18n.t('globalStats.colPosition') }}</th>
              <th data-cy="global-stats-col-player">{{ i18n.t('globalStats.colPlayer') }}</th>
              <th (click)="sortBy('playedMatchCount')" [attr.aria-sort]="ariaSort('playedMatchCount')" class="sortable-col" data-cy="global-stats-col-matches">{{ i18n.t('globalStats.colMatches') }}</th>
              <th (click)="sortBy('matchWins')" [attr.aria-sort]="ariaSort('matchWins')" class="sortable-col" data-cy="global-stats-col-match-wins">{{ i18n.t('globalStats.colMatchWins') }}</th>
              <th (click)="sortBy('matchLosses')" [attr.aria-sort]="ariaSort('matchLosses')" class="sortable-col" data-cy="global-stats-col-match-losses">{{ i18n.t('globalStats.colMatchLosses') }}</th>
              <th (click)="sortBy('matchDraws')" [attr.aria-sort]="ariaSort('matchDraws')" class="sortable-col" data-cy="global-stats-col-match-draws">{{ i18n.t('globalStats.colMatchDraws') }}</th>
              <th (click)="sortBy('matchWinrate')" [attr.aria-sort]="ariaSort('matchWinrate')" class="sortable-col" data-cy="global-stats-col-match-winrate">{{ i18n.t('globalStats.colMatchWinrate') }}</th>
              <th (click)="sortBy('playedGameCount')" [attr.aria-sort]="ariaSort('playedGameCount')" class="sortable-col" data-cy="global-stats-col-games">{{ i18n.t('globalStats.colGames') }}</th>
              <th (click)="sortBy('gameWins')" [attr.aria-sort]="ariaSort('gameWins')" class="sortable-col" data-cy="global-stats-col-game-wins">{{ i18n.t('globalStats.colGameWins') }}</th>
              <th (click)="sortBy('gameLosses')" [attr.aria-sort]="ariaSort('gameLosses')" class="sortable-col" data-cy="global-stats-col-game-losses">{{ i18n.t('globalStats.colGameLosses') }}</th>
              <th (click)="sortBy('gameWinrate')" [attr.aria-sort]="ariaSort('gameWinrate')" class="sortable-col" data-cy="global-stats-col-game-winrate">{{ i18n.t('globalStats.colGameWinrate') }}</th>
              <th data-cy="global-stats-col-nemesis">{{ i18n.t('globalStats.colNemesis') }}</th>
              <th data-cy="global-stats-col-rival">{{ i18n.t('globalStats.colRival') }}</th>
              <th data-cy="global-stats-col-archetype">{{ i18n.t('globalStats.colArchetype') }}</th>
            </tr>
          </thead>
          <tbody data-cy="global-stats-tbody">
            @if (!items().length) {
              <tr data-cy="global-stats-empty-row">
                <td colspan="14" data-cy="global-stats-no-results">{{ i18n.t('globalStats.noResults') }}</td>
              </tr>
            }
            @for (row of items(); track row.playerName) {
              <tr [attr.data-cy]="'global-stats-row-' + row.position">
                <td [attr.data-cy]="'global-stats-cell-position-' + row.position">{{ row.position }}</td>
                <td [attr.data-cy]="'global-stats-cell-player-' + row.position"><a [routerLink]="['/players', row.playerName]" [attr.data-cy]="'global-stats-player-link-' + row.position">{{ row.playerName }}</a></td>
                <td [attr.data-cy]="'global-stats-cell-matches-' + row.position">{{ row.playedMatchCount }}</td>
                <td [attr.data-cy]="'global-stats-cell-match-wins-' + row.position">{{ row.matchWins }}</td>
                <td [attr.data-cy]="'global-stats-cell-match-losses-' + row.position">{{ row.matchLosses }}</td>
                <td [attr.data-cy]="'global-stats-cell-match-draws-' + row.position">{{ row.matchDraws }}</td>
                <td [attr.data-cy]="'global-stats-cell-match-winrate-' + row.position">{{ formatPct(row.matchWinrate) }}</td>
                <td [attr.data-cy]="'global-stats-cell-games-' + row.position">{{ row.playedGameCount }}</td>
                <td [attr.data-cy]="'global-stats-cell-game-wins-' + row.position">{{ row.gameWins }}</td>
                <td [attr.data-cy]="'global-stats-cell-game-losses-' + row.position">{{ row.gameLosses }}</td>
                <td [attr.data-cy]="'global-stats-cell-game-winrate-' + row.position">{{ formatPct(row.gameWinrate) }}</td>
                <td [attr.data-cy]="'global-stats-cell-nemesis-' + row.position">{{ formatOpponent(row.nemesis) }}</td>
                <td [attr.data-cy]="'global-stats-cell-rival-' + row.position">{{ formatOpponent(row.rival) }}</td>
                <td [attr.data-cy]="'global-stats-cell-archetype-' + row.position">{{ formatArchetype(row.mostPlayedArchetype) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (totalCount()) {
        <nav class="global-stats-pagination" [attr.aria-label]="i18n.t('globalStats.paginationAria')" data-cy="global-stats-pagination">
          <button type="button" data-cy="global-stats-page-previous" [disabled]="currentPage() <= 1" (click)="goPage(currentPage() - 1)">{{ i18n.t('common.previous') }}</button>
          <span data-cy="global-stats-page-status" aria-live="polite">{{ i18n.t('globalStats.pageStatus', { page: currentPage(), total: totalPages(), count: totalCount() }) }}</span>
          <button type="button" data-cy="global-stats-page-next" [disabled]="currentPage() >= totalPages()" (click)="goPage(currentPage() + 1)">{{ i18n.t('common.next') }}</button>
        </nav>
      }
    }
  `,
  styles: [`
    .global-stats-controls { display: flex; align-items: flex-end; flex-wrap: wrap; gap: .75rem; margin-bottom: 1rem; }
    .global-stats-search-wrap { display: flex; align-items: center; gap: .5rem; flex: 1 1 auto; min-width: 0; }
    .global-stats-search-field { flex: 1 1 auto; min-width: 0; max-width: 28rem; }
    .global-stats-size-field { width: 9rem; }
    .global-stats-status-bar { color: var(--dim-ash); font-size: .88rem; font-weight: 800; margin-bottom: .5rem; }
    .table-wrap { width: 100%; overflow-x: auto; }
    .ranking-table { width: 100%; border-collapse: collapse; font-size: .88rem; }
    .ranking-table th, .ranking-table td { border: 1px solid var(--soot); padding: .4rem .65rem; text-align: left; white-space: nowrap; }
    .ranking-table th { background: var(--raised-iron); font-weight: 900; text-transform: uppercase; letter-spacing: .06em; font-size: .75rem; }
    .ranking-table th.sortable-col { cursor: pointer; user-select: none; }
    .ranking-table th.sortable-col:hover { background: color-mix(in oklch, var(--raised-iron) 70%, var(--soot)); }
    .ranking-table th[aria-sort="ascending"]::after { content: ' ↑'; }
    .ranking-table th[aria-sort="descending"]::after { content: ' ↓'; }
    .ranking-table tbody tr:hover { background: color-mix(in oklch, var(--iron) 80%, var(--raised-iron)); }
    .ranking-table a { color: oklch(78% 0.1 230); text-decoration: none; }
    .ranking-table a:hover { text-decoration: underline; }
    .global-stats-pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: .75rem; }
    .global-stats-pagination button { border: 1px solid var(--soot); background: var(--black-metal); color: var(--ash); cursor: pointer; min-height: 2.5rem; padding: .45rem .75rem; }
    .global-stats-pagination button:disabled { cursor: default; opacity: .45; }
  `]
})
export class GlobalStatsComponent {
  private readonly client = inject(Client);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly i18n = inject(I18nService);

  private readonly latest = new LatestRequest();

  readonly loading = signal(false);
  readonly error = signal('');
  readonly items = signal<GlobalPlayerStatisticsRow[]>([]);
  readonly totalCount = signal(0);
  readonly currentPage = signal(1);
  readonly currentSize = signal<GlobalStatsPageSize>(100);
  readonly currentSort = signal<GlobalStatsSortCol | undefined>(undefined);
  readonly currentDirection = signal<'asc' | 'desc' | undefined>(undefined);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.currentSize())));

  readonly pageSizes = GLOBAL_STATS_PAGE_SIZES;

  searchDraft = '';

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const query = parseGlobalStatsQuery(params);
      this.currentPage.set(query.page);
      this.currentSize.set(query.size);
      this.currentSort.set(query.sort);
      this.currentDirection.set(query.direction);
      this.searchDraft = query.search;
      void this.load(query);
    });
  }

  private async load(query: GlobalStatsQuery): Promise<void> {
    const token = this.latest.begin();
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.client.getGlobalPlayerStatistics(
          query.page,
          query.size,
          query.search || undefined,
          query.sort,
          query.direction,
        ),
      );
      if (!this.latest.isCurrent(token)) return;
      this.items.set(response.items ?? []);
      this.totalCount.set(response.totalCount ?? 0);
      this.currentPage.set(response.page ?? query.page);
    } catch {
      if (!this.latest.isCurrent(token)) return;
      this.error.set(this.i18n.t('globalStats.errorLoad'));
      this.items.set([]);
      this.totalCount.set(0);
    } finally {
      if (this.latest.isCurrent(token)) this.loading.set(false);
    }
  }

  sortBy(col: GlobalStatsSortCol): void {
    const current: GlobalStatsQuery = {
      page: this.currentPage(),
      size: this.currentSize(),
      search: this.searchDraft,
      sort: this.currentSort(),
      direction: this.currentDirection(),
    };
    const next = toggleGlobalStatsSort(current, col);
    void this.router.navigate([], { relativeTo: this.route, queryParams: globalStatsQueryParams(next) });
  }

  ariaSort(col: GlobalStatsSortCol): 'ascending' | 'descending' | null {
    if (this.currentSort() !== col) return null;
    return this.currentDirection() === 'asc' ? 'ascending' : 'descending';
  }

  goPage(page: number): void {
    const current: GlobalStatsQuery = {
      page: this.currentPage(),
      size: this.currentSize(),
      search: this.searchDraft,
      sort: this.currentSort(),
      direction: this.currentDirection(),
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: globalStatsQueryParams({ ...current, page }),
    });
  }

  applySearch(): void {
    const current: GlobalStatsQuery = {
      page: 1,
      size: this.currentSize(),
      search: this.searchDraft,
      sort: this.currentSort(),
      direction: this.currentDirection(),
    };
    void this.router.navigate([], { relativeTo: this.route, queryParams: globalStatsQueryParams(current) });
  }

  clearSearch(): void {
    this.searchDraft = '';
    this.applySearch();
  }

  setSize(size: GlobalStatsPageSize): void {
    const current: GlobalStatsQuery = {
      page: 1,
      size,
      search: this.searchDraft,
      sort: this.currentSort(),
      direction: this.currentDirection(),
    };
    void this.router.navigate([], { relativeTo: this.route, queryParams: globalStatsQueryParams(current) });
  }

  formatPct(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
  }

  formatOpponent(value: OpponentRecord | null | undefined): string {
    return value === null || value === undefined ? '—' : `${value.name} (${value.wins}-${value.losses})`;
  }

  formatArchetype(value: PlayerArchetypeUsage | null | undefined): string {
    return value === null || value === undefined
      ? '—'
      : this.i18n.t('player.archetypeMatches', { name: value.name, count: value.matchCount });
  }
}
