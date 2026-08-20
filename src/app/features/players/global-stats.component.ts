import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { BackButtonComponent } from '../../shared/back-button.component';
import { formatRatingDelta } from './rating-format';
import { SyncBarComponent } from '../../shared/sync-bar.component';
import { GlobalPlayerStatisticsRow, OpponentRecord, PlayerArchetypeUsage } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import {
  GLOBAL_STATS_PAGE_SIZES,
  GlobalStatsPageSize,
  GlobalStatsSortCol,
  GlobalStatsQuery,
  globalStatsQueryParams,
  parseGlobalStatsQuery,
  sortGlobalStatsRows,
  toggleGlobalStatsSort,
} from './global-stats-query';
import { GlobalStatsCatalogCacheService } from './global-stats-catalog-cache.service';

export const SEARCH_DEBOUNCE_MS = 300;

@Component({
  standalone: true,
  imports: [RouterLink, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, BackButtonComponent, SyncBarComponent],
  template: `
    <gones-back-button data-cy="global-stats-back-top" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />

    <div class="global-stats-heading-row" data-cy="global-stats-heading-row">
      <section class="page-heading" data-cy="global-stats-heading">
        <div data-cy="global-stats-heading-text">
          <h1 data-cy="global-stats-title">{{ i18n.t('globalStats.title') }}</h1>
        </div>
      </section>
      <gones-sync-bar cyPrefix="global-stats" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="onSync()" data-cy="global-stats-sync-bar" />
    </div>

    <div class="global-stats-controls" data-cy="global-stats-controls">
      <div class="global-stats-search-wrap" data-cy="global-stats-search-wrap">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="global-stats-search-field" data-cy="global-stats-search-field">
          <input
            matInput
            data-cy="global-stats-search-input"
            [placeholder]="i18n.t('globalStats.searchPlaceholder')"
            [attr.aria-label]="i18n.t('globalStats.searchAria')"
            [ngModel]="searchDraft()"
            (ngModelChange)="setSearchDraft($event)"
          />
        </mat-form-field>
        @if (searchDraft()) {
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
    @if (truncated()) {
      <p class="warning" role="status" data-cy="global-stats-truncated">{{ i18n.t('globalStats.truncatedWarning', { count: allRows().length }) }}</p>
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
              <th (click)="sortBy('rating')" [attr.aria-sort]="ariaSort('rating')" class="sortable-col" data-cy="global-stats-col-rating">{{ i18n.t('globalStats.colRating') }}</th>
              @if (showDecayedRating()) {
                <th (click)="sortBy('decayedRating')" [attr.aria-sort]="ariaSort('decayedRating')" class="sortable-col" data-cy="global-stats-col-decayed-rating">{{ i18n.t('globalStats.colDecayedRating') }}</th>
              }
              <th (click)="sortBy('tournamentsPlayed')" [attr.aria-sort]="ariaSort('tournamentsPlayed')" class="sortable-col" data-cy="global-stats-col-tournaments">{{ i18n.t('globalStats.colTournaments') }}</th>
              <th (click)="sortBy('playedMatchCount')" [attr.aria-sort]="ariaSort('playedMatchCount')" class="sortable-col" data-cy="global-stats-col-matches">{{ i18n.t('globalStats.colMatches') }}</th>
              <th (click)="sortBy('matchWins')" [attr.aria-sort]="ariaSort('matchWins')" class="sortable-col" data-cy="global-stats-col-match-wins">{{ i18n.t('globalStats.colMatchWins') }}</th>
              <th (click)="sortBy('matchLosses')" [attr.aria-sort]="ariaSort('matchLosses')" class="sortable-col" data-cy="global-stats-col-match-losses">{{ i18n.t('globalStats.colMatchLosses') }}</th>
              <th (click)="sortBy('matchDraws')" [attr.aria-sort]="ariaSort('matchDraws')" class="sortable-col" data-cy="global-stats-col-match-draws">{{ i18n.t('globalStats.colMatchDraws') }}</th>
              <th (click)="sortBy('matchWinrate')" [attr.aria-sort]="ariaSort('matchWinrate')" class="sortable-col" data-cy="global-stats-col-match-winrate">{{ i18n.t('globalStats.colMatchWinrate') }}</th>
              <th data-cy="global-stats-col-nemesis">{{ i18n.t('globalStats.colNemesis') }}</th>
              <th data-cy="global-stats-col-rival">{{ i18n.t('globalStats.colRival') }}</th>
              <th data-cy="global-stats-col-archetype">{{ i18n.t('globalStats.colArchetype') }}</th>
            </tr>
          </thead>
          <tbody data-cy="global-stats-tbody">
            @if (!pagedRows().length) {
              <tr data-cy="global-stats-empty-row">
                <td [attr.colspan]="visibleColumnCount()" data-cy="global-stats-no-results">{{ i18n.t('globalStats.noResults') }}</td>
              </tr>
            }
            @for (row of pagedRows(); track row.playerName) {
              <tr [attr.data-cy]="'global-stats-row-' + row.position">
                <td [attr.data-cy]="'global-stats-cell-position-' + row.position">{{ row.position }}</td>
                <td [attr.data-cy]="'global-stats-cell-player-' + row.position"><a [routerLink]="['/players', row.playerName]" [attr.data-cy]="'global-stats-player-link-' + row.position">{{ row.playerName }}</a></td>
                <td [attr.data-cy]="'global-stats-cell-rating-' + row.position">
                  @if (row.rating !== undefined) {
                    <span [attr.data-cy]="'global-stats-cell-' + row.position + '-rating-value'">{{ row.rating }}</span>
                    <span class="rating-delta" [class.rating-delta--up]="row.lastRatingDelta > 0" [class.rating-delta--down]="row.lastRatingDelta < 0" [attr.data-cy]="'global-stats-cell-' + row.position + '-rating-delta'">{{ formatDelta(row.lastRatingDelta) }}</span>
                    @if (row.provisional) {
                      <span class="rating-badge rating-badge--provisional" [attr.aria-label]="i18n.t('globalStats.provisionalAria')" [attr.data-cy]="'global-stats-cell-' + row.position + '-rating-provisional'">{{ i18n.t('globalStats.provisionalBadge') }}</span>
                    } @else if (row.inactive) {
                      <span class="rating-badge rating-badge--inactive" [attr.aria-label]="i18n.t('globalStats.inactiveAria')" [attr.data-cy]="'global-stats-cell-' + row.position + '-rating-inactive'">{{ i18n.t('globalStats.inactiveBadge') }}</span>
                    }
                  } @else {
                    <span [attr.data-cy]="'global-stats-cell-' + row.position + '-rating-value'">—</span>
                  }
                </td>
                @if (showDecayedRating()) {
                  <td [attr.data-cy]="'global-stats-cell-decayed-rating-' + row.position">{{ row.decayedRating }}</td>
                }
                <td [attr.data-cy]="'global-stats-cell-tournaments-' + row.position">{{ row.tournamentsPlayed }}</td>
                <td [attr.data-cy]="'global-stats-cell-matches-' + row.position">{{ row.playedMatchCount }}</td>
                <td [attr.data-cy]="'global-stats-cell-match-wins-' + row.position">{{ row.matchWins }}</td>
                <td [attr.data-cy]="'global-stats-cell-match-losses-' + row.position">{{ row.matchLosses }}</td>
                <td [attr.data-cy]="'global-stats-cell-match-draws-' + row.position">{{ row.matchDraws }}</td>
                <td [attr.data-cy]="'global-stats-cell-match-winrate-' + row.position">{{ formatPct(row.matchWinrate) }}</td>
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

    <gones-back-button data-cy="global-stats-back-bottom" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `,
  styles: [`
    .global-stats-heading-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; }
    .global-stats-heading-row .page-heading { flex: 1 1 auto; min-width: 0; margin: 0; }
    .global-stats-heading-row gones-sync-bar { flex: 0 1 auto; }
    .global-stats-controls { display: flex; align-items: flex-end; flex-wrap: wrap; gap: .75rem; margin-top: 1.25rem; margin-bottom: 1rem; }
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
    .rating-delta { margin-left: .35rem; font-size: .78rem; font-weight: 800; }
    .rating-delta--up { color: oklch(80% 0.15 145); }
    .rating-delta--down { color: oklch(78% 0.14 25); }
    .rating-badge { margin-left: .35rem; padding: .05rem .3rem; border: 1px solid var(--soot); font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim-ash); }
    .rating-badge--inactive { border-color: var(--dim-ash); }
    .global-stats-pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: .75rem; }
    .global-stats-pagination button { border: 1px solid var(--soot); background: var(--black-metal); color: var(--ash); cursor: pointer; min-height: 2.5rem; padding: .45rem .75rem; }
    .global-stats-pagination button:disabled { cursor: default; opacity: .45; }
  `]
})
export class GlobalStatsComponent implements OnDestroy {
  private readonly cacheService = inject(GlobalStatsCatalogCacheService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly i18n = inject(I18nService);

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  readonly loading = signal(false);
  readonly error = signal('');
  readonly stale = signal(false);
  readonly truncated = signal(false);
  readonly syncedAt = signal<string | undefined>(undefined);

  readonly allRows = signal<GlobalPlayerStatisticsRow[]>([]);

  readonly showDecayedRating = computed(() => this.allRows().some(row => row.decayedRating !== null && row.decayedRating !== undefined));
  readonly visibleColumnCount = computed(() => this.showDecayedRating() ? 13 : 12);

  readonly currentPage = signal(1);
  readonly currentSize = signal<GlobalStatsPageSize>(100);
  readonly currentSort = signal<GlobalStatsSortCol | undefined>(undefined);
  readonly currentDirection = signal<'asc' | 'desc' | undefined>(undefined);
  readonly searchDraft = signal('');

  readonly filteredRows = computed(() => {
    const term = this.searchDraft().toLowerCase().trim();
    if (!term) return this.allRows();
    return this.allRows().filter(r => r.playerName.toLowerCase().includes(term));
  });

  /** Server ordering, reproduced client-side so both rankings surfaces agree (see the helper). */
  readonly sortedRows = computed(() => sortGlobalStatsRows(this.filteredRows(), this.currentSort(), this.currentDirection() ?? 'desc'));

  readonly pagedRows = computed(() => {
    const page = this.currentPage();
    const size = this.currentSize();
    const start = (page - 1) * size;
    return this.sortedRows().slice(start, start + size).map((row, i) => ({ ...row, position: start + i + 1 }));
  });

  readonly totalCount = computed(() => this.filteredRows().length);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.currentSize())));

  readonly pageSizes = GLOBAL_STATS_PAGE_SIZES;

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const query = parseGlobalStatsQuery(params);
      this.currentPage.set(query.page);
      this.currentSize.set(query.size);
      this.currentSort.set(query.sort);
      this.currentDirection.set(query.direction);
      this.searchDraft.set(query.search);
    });
    void this.loadCatalog();
  }

  ngOnDestroy(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
  }

  private async loadCatalog(options: { force?: boolean } = {}): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await this.cacheService.load(options);
      this.allRows.set(result.items);
      this.syncedAt.set(result.fetchedAt);
      this.stale.set(result.stale);
      this.truncated.set(result.truncated);
    } catch {
      this.error.set(this.i18n.t('globalStats.errorLoad'));
    } finally {
      this.loading.set(false);
    }
  }

  onSync(): void {
    void this.loadCatalog({ force: true });
  }

  setSearchDraft(value: string): void {
    this.searchDraft.set(value);
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const query: GlobalStatsQuery = {
        page: 1,
        size: this.currentSize(),
        search: value,
        sort: this.currentSort(),
        direction: this.currentDirection(),
      };
      void this.router.navigate([], { relativeTo: this.route, queryParams: globalStatsQueryParams(query) });
    }, SEARCH_DEBOUNCE_MS);
  }

  clearSearch(): void {
    this.setSearchDraft('');
  }

  sortBy(col: GlobalStatsSortCol): void {
    const current: GlobalStatsQuery = {
      page: this.currentPage(),
      size: this.currentSize(),
      search: this.searchDraft(),
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
      search: this.searchDraft(),
      sort: this.currentSort(),
      direction: this.currentDirection(),
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: globalStatsQueryParams({ ...current, page }),
    });
  }

  setSize(size: GlobalStatsPageSize): void {
    const current: GlobalStatsQuery = {
      page: 1,
      size,
      search: this.searchDraft(),
      sort: this.currentSort(),
      direction: this.currentDirection(),
    };
    void this.router.navigate([], { relativeTo: this.route, queryParams: globalStatsQueryParams(current) });
  }

  formatDelta(value: number | null | undefined): string { return formatRatingDelta(value); }

  formatPct(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
  }

  formatOpponent(value: OpponentRecord | null | undefined): string {
    return value === null || value === undefined ? '—' : `${value.name} (${value.wins}-${value.losses})`;
  }

  formatArchetype(value: PlayerArchetypeUsage | null | undefined): string {
    return value === null || value === undefined ? '—' : `${value.name} (${value.matchCount})`;
  }
}
