import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { BackButtonComponent } from '../../shared/back-button.component';
import { formatRatingDelta } from './rating-format';
import { SyncBarComponent } from '../../shared/sync-bar.component';
import { ArchiveGlobalPlayerStatisticsRow, Client, OpponentRecord, PlayerArchetypeUsage } from '../../api/generated/gones-api';
import { ArchiveRepository } from '../../data/archive-repository.service';
import type { ArchiveLeagueRow, ArchiveLeagueSeasonRow } from '../../data/archive-repository.service';
import { isLocalArchiveId } from '../../data/archive-origin';
import { I18nService } from '../../i18n/i18n.service';
import {
  GLOBAL_STATS_PAGE_SIZES,
  GLOBAL_STATS_SCOPE_ALL,
  GlobalStatsPageSize,
  GlobalStatsScopeSelection,
  GlobalStatsSortCol,
  GlobalStatsQuery,
  globalStatsPageWindow,
  globalStatsQueryParams,
  globalStatsScopeName,
  parseGlobalStatsQuery,
  resolveGlobalStatsScope,
  scopeSeasonOptions,
  selectScopeLeague,
  selectScopeSeason,
  toggleGlobalStatsSort,
} from './global-stats-query';

export const SEARCH_DEBOUNCE_MS = 300;

@Component({
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, BackButtonComponent, SyncBarComponent],
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

    <div class="global-stats-scope" data-cy="global-stats-scope">
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="global-stats-scope-field" data-cy="global-stats-league-field">
        <mat-label data-cy="global-stats-league-label">{{ i18n.t('globalStats.scopeLeagueLabel') }}</mat-label>
        <mat-select data-cy="global-stats-league-select" [value]="currentLeague()" (selectionChange)="setLeague($event.value)">
          <mat-option [value]="scopeAll" data-cy="global-stats-league-option-all">{{ i18n.t('globalStats.scopeAllLeagues') }}</mat-option>
          @for (league of leagues(); track league.id) {
            <mat-option [value]="league.id" [attr.data-cy]="'global-stats-league-option-' + league.id">{{ league.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="global-stats-scope-field" data-cy="global-stats-season-field">
        <mat-label data-cy="global-stats-season-label">{{ i18n.t('globalStats.scopeSeasonLabel') }}</mat-label>
        <mat-select data-cy="global-stats-season-select" [value]="currentSeason()" (selectionChange)="setSeason($event.value)">
          <mat-option [value]="scopeAll" data-cy="global-stats-season-option-all">{{ i18n.t('globalStats.scopeAllSeasons') }}</mat-option>
          @for (season of seasonOptions(); track season.id) {
            <mat-option [value]="season.id" [attr.data-cy]="'global-stats-season-option-' + season.id">{{ season.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <!-- The badge names the scope the numbers were computed in, so a scoped rating is never read as
           the global one. Its visible text is already the whole accessible name; an aria-label here
           would replace "Rating scope: Ligue Lyon 2026" with "Rating scope" and hide the answer. -->
      <span class="global-stats-scope-badge" data-cy="global-stats-scope-badge">
        <span aria-hidden="true" data-cy="global-stats-scope-badge-mark">◆</span>{{ i18n.t('globalStats.scopeBadge', { scope: scopeLabel() }) }}
      </span>
    </div>
    @if (scopeError()) {
      <p class="warning" role="status" data-cy="global-stats-scope-error">{{ scopeError() }}</p>
    }

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

    @if (!loading() && !error()) {
      <div class="global-stats-status-bar" data-cy="global-stats-status-bar">
        <span aria-live="polite" data-cy="global-stats-count-status">{{ pageStatus() }}</span>
      </div>

      @if (totalCount()) {
        <ng-container *ngTemplateOutlet="paginationNav; context: { $implicit: 'top' }" />
      }

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
              <th data-cy="global-stats-col-rival">{{ i18n.t('globalStats.colRival') }}</th>
              <th data-cy="global-stats-col-archetype">{{ i18n.t('globalStats.colArchetype') }}</th>
            </tr>
          </thead>
          <tbody data-cy="global-stats-tbody">
            @if (!pagedRows().length) {
              <tr data-cy="global-stats-empty-row">
                <td [attr.colspan]="visibleColumnCount()" data-cy="global-stats-no-results">
                  {{ emptyMessage() }}
                  @if (scope().kind !== 'global' && !committedSearch()) {
                    <span class="global-stats-empty-hint" data-cy="global-stats-empty-standalone-hint">{{ i18n.t('globalStats.standaloneHint') }}</span>
                  }
                </td>
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
                <td [attr.data-cy]="'global-stats-cell-rival-' + row.position">{{ formatOpponent(row.rival) }}</td>
                <td [attr.data-cy]="'global-stats-cell-archetype-' + row.position">{{ formatArchetype(row.mostPlayedArchetype) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (scope().kind !== 'global') {
        <p class="global-stats-scope-note" data-cy="global-stats-scope-note">{{ i18n.t('globalStats.scopeNote') }}</p>
      }

      @if (totalCount()) {
        <ng-container *ngTemplateOutlet="paginationNav; context: { $implicit: 'bottom' }" />
      }
    }

    <ng-template #paginationNav let-place>
      <nav class="global-stats-pagination" [class.global-stats-pagination--top]="place === 'top'" [attr.aria-label]="i18n.t('globalStats.paginationAria')" [attr.data-cy]="'global-stats-pagination-' + place">
        <span class="global-stats-page-numbers" [attr.data-cy]="'global-stats-page-numbers-' + place">
          @for (item of pageWindow(); track $index) {
            @if (item === 'gap') {
              <span class="global-stats-page-gap" aria-hidden="true" [attr.data-cy]="'global-stats-page-gap-' + place + '-' + $index">…</span>
            } @else {
              <button
                type="button"
                class="global-stats-page-number"
                [class.is-current]="item === currentPage()"
                [attr.aria-current]="item === currentPage() ? 'page' : null"
                [attr.aria-label]="i18n.t('globalStats.pageAria', { page: item })"
                [attr.data-cy]="'global-stats-page-number-' + place + '-' + item"
                (click)="goPage(item)"
              >{{ item }}</button>
            }
          }
        </span>
        <!-- One live region for the page, and the status bar above the table already owns the top one. -->
        @if (place === 'bottom') {
          <span data-cy="global-stats-page-status" aria-live="polite">{{ pageStatus() }}</span>
        }
      </nav>
    </ng-template>

    <gones-back-button data-cy="global-stats-back-bottom" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `,
  styles: [`
    .global-stats-heading-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; }
    .global-stats-heading-row .page-heading { flex: 1 1 auto; min-width: 0; margin: 0; }
    .global-stats-heading-row gones-sync-bar { flex: 0 1 auto; }
    .global-stats-scope { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; margin-top: 1.25rem; padding: .75rem; border: 1px solid var(--soot); background: var(--iron); }
    .global-stats-scope-field { width: 16rem; }
    .global-stats-scope-badge { display: inline-flex; align-items: center; gap: .4rem; padding: .28rem .6rem; border: 1px solid color-mix(in oklch, var(--hot-blood) 50%, var(--soot)); background: color-mix(in oklch, var(--blood) 16%, var(--iron)); color: var(--ash); font-size: .75rem; font-weight: 800; }
    .global-stats-scope-note { margin: .6rem 0 0; color: var(--steel); font-size: .8rem; }
    .global-stats-empty-hint { display: block; margin-top: .35rem; color: var(--steel); font-size: .8rem; }
    .global-stats-controls { display: flex; align-items: flex-end; flex-wrap: wrap; gap: .75rem; margin-top: 1.25rem; margin-bottom: 1rem; }
    .global-stats-search-wrap { display: flex; align-items: center; gap: .5rem; flex: 1 1 auto; min-width: 0; }
    .global-stats-search-field { flex: 1 1 auto; min-width: 0; max-width: 28rem; }
    /* Wide enough for Material's 180px infix plus the outline padding, so 'Rows per page' — and the
       longer French 'Lignes par page' — reads in full instead of being clipped by the field. */
    .global-stats-size-field { width: 14rem; }
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
    .global-stats-pagination { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: .5rem 1rem; margin-top: .75rem; }
    .global-stats-pagination--top { margin-bottom: 1rem; }
    .global-stats-pagination button { border: 1px solid var(--soot); background: var(--black-metal); color: var(--ash); cursor: pointer; min-height: 2.5rem; padding: .45rem .75rem; }
    .global-stats-pagination button:disabled { cursor: default; opacity: .45; }
    .global-stats-page-numbers { display: flex; align-items: center; gap: .25rem; }
    .global-stats-page-number { min-width: 2.5rem; font-variant-numeric: tabular-nums; }
    .global-stats-page-number.is-current { border-color: var(--hot-blood); color: var(--ash); font-weight: 900; }
    .global-stats-page-gap { color: var(--dim-ash); padding: 0 .15rem; }
  `]
})
export class GlobalStatsComponent implements OnDestroy {
  private readonly client = inject(Client);
  private readonly archive = inject(ArchiveRepository);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly i18n = inject(I18nService);

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  readonly loading = signal(false);
  readonly error = signal('');
  readonly stale = signal(false);
  readonly scopeError = signal('');
  readonly syncedAt = signal<string | undefined>(undefined);

  /** One page of one scope, numbered by the server. Never the whole catalog. */
  readonly rows = signal<ArchiveGlobalPlayerStatisticsRow[]>([]);
  readonly totalCount = signal(0);
  readonly leagues = signal<ArchiveLeagueRow[]>([]);
  readonly seasons = signal<ArchiveLeagueSeasonRow[]>([]);
  readonly committedSearch = signal('');
  readonly currentLeague = signal<string>(GLOBAL_STATS_SCOPE_ALL);
  readonly currentSeason = signal<string>(GLOBAL_STATS_SCOPE_ALL);
  readonly scopeAll = GLOBAL_STATS_SCOPE_ALL;
  private requestToken = 0;
  /** One retry per URL emission: re-issue when the loaded rows open the sort gate. */
  private gatedSortRetried = false;

  readonly showDecayedRating = computed(() => this.rows().some(row => row.decayedRating !== null && row.decayedRating !== undefined));
  readonly visibleColumnCount = computed(() => this.showDecayedRating() ? 12 : 11);

  readonly currentPage = signal(1);
  readonly currentSize = signal<GlobalStatsPageSize>(100);
  private readonly routeParams = signal<{ get(key: string): string | null } | null>(null);

  /**
   * The sort the URL asks for, filtered through the gate the server applies: `?sort=decayedRating` is
   * a `400` while `Gones:PlayerStatistics:ExposeDecayedRating` is off. Derived rather than stored so it
   * re-reads the URL when the catalog lands — the query params arrive before the rows do, so a value
   * captured at the first emission would refuse the column forever.
   */
  readonly currentSort = computed<GlobalStatsSortCol | undefined>(() => {
    const params = this.routeParams();
    return params ? parseGlobalStatsQuery(params, { decayedRating: this.showDecayedRating() }).sort : undefined;
  });
  readonly currentDirection = signal<'asc' | 'desc' | undefined>(undefined);
  readonly searchDraft = signal('');

  /** The server numbers the rows inside the requested scope, so positions renumber 1..n per scope. */
  readonly pagedRows = computed(() => this.rows());
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.currentSize())));
  readonly pageWindow = computed(() => globalStatsPageWindow(this.currentPage(), this.totalPages()));

  readonly scope = computed<GlobalStatsScopeSelection>(() =>
    resolveGlobalStatsScope({ league: this.currentLeague(), season: this.currentSeason() }));

  readonly seasonOptions = computed(() => scopeSeasonOptions(this.seasons(), this.currentLeague()));

  /** Never blank: the resolved name, else the raw id, else the global label. */
  readonly scopeLabel = computed(() => {
    const scope = this.scope();
    if (scope.kind === 'global') return this.i18n.t('globalStats.scopeGlobalName');
    return globalStatsScopeName(scope, { leagues: this.leagues(), seasons: this.seasons() }) ?? scope.id;
  });

  readonly pageStatus = computed(() => this.i18n.t(
    this.scope().kind === 'global' ? 'globalStats.pageStatus' : 'globalStats.pageStatusScope',
    { page: this.currentPage(), total: this.totalPages(), count: this.totalCount() }));

  readonly emptyMessage = computed(() =>
    this.committedSearch() || this.scope().kind === 'global'
      ? this.i18n.t('globalStats.noResults')
      : this.i18n.t('globalStats.noResultsScope'));

  readonly pageSizes = GLOBAL_STATS_PAGE_SIZES;

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const query = parseGlobalStatsQuery(params);
      this.currentPage.set(query.page);
      this.currentSize.set(query.size);
      this.routeParams.set(params);
      this.currentDirection.set(query.direction);
      this.searchDraft.set(query.search);
      this.committedSearch.set(query.search);
      this.currentLeague.set(query.league);
      this.currentSeason.set(query.season);
      this.gatedSortRetried = false;
      void this.loadRankings();
    });
    void this.loadScopeCatalogs();
  }

  ngOnDestroy(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
  }

  /**
   * One page of one scope. The rating shown always comes from the stored `(scopeKind, scopeId)` row,
   * so matches, tournaments and winrate are the player's record inside the scope — never their
   * global numbers filtered down.
   */
  private async loadRankings(): Promise<void> {
    const token = ++this.requestToken;
    const scope = this.scope();
    const sentSort = this.currentSort();
    this.loading.set(true);
    try {
      const response = await firstValueFrom(this.client.getArchiveGlobalPlayerStatistics(
        scope.kind,
        scope.kind === 'global' ? undefined : scope.id,
        this.currentPage(),
        this.currentSize(),
        this.committedSearch() || undefined,
        sentSort,
        this.currentDirection(),
      ));
      // A slower earlier request must not paint its scope under a newer scope's badge.
      if (token !== this.requestToken) return;
      this.rows.set(response.items ?? []);
      this.totalCount.set(response.totalCount ?? 0);
      // The rows just flipped the gate: the URL asks for a sort this request did not carry. Re-issue
      // once under the same spinner, so the default ranking is never painted under the gated indicator.
      if (!this.gatedSortRetried && this.currentSort() !== sentSort) {
        this.gatedSortRetried = true;
        void this.loadRankings();
        return;
      }
      this.syncedAt.set(new Date().toISOString());
      this.stale.set(false);
      this.error.set('');
    } catch {
      if (token !== this.requestToken) return;
      if (this.rows().length) this.stale.set(true);
      else this.error.set(this.i18n.t('globalStats.errorLoad'));
    } finally {
      if (token === this.requestToken) this.loading.set(false);
    }
  }

  /**
   * The two selects. A failure here narrows the filter, it does not hide the ranking.
   *
   * The repository serves the union of both stores (ADR 0028), and the scope is a query parameter of
   * a server route: a `local-` id lives in this browser's IndexedDB alone and must never be sent.
   * Offering the scope is what would send it, so the browser-local rows are dropped here. Their
   * ranking is not lost — the server holds no statistics for them, so the scope could only ever have
   * rendered an empty table.
   */
  private async loadScopeCatalogs(): Promise<void> {
    try {
      const [leagues, seasons] = await Promise.all([this.archive.listLeagues(), this.archive.listLeagueSeasons()]);
      this.leagues.set(leagues.items.filter((league) => !isLocalArchiveId(league.id)));
      this.seasons.set(seasons.items.filter((season) => !isLocalArchiveId(season.id)));
      this.scopeError.set('');
    } catch {
      this.scopeError.set(this.i18n.t('globalStats.scopeLoadFailed'));
    }
  }

  onSync(): void {
    void this.loadRankings();
  }

  private query(): GlobalStatsQuery {
    return {
      page: this.currentPage(),
      size: this.currentSize(),
      search: this.committedSearch(),
      sort: this.currentSort(),
      direction: this.currentDirection(),
      league: this.currentLeague(),
      season: this.currentSeason(),
    };
  }

  private navigate(query: GlobalStatsQuery): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: globalStatsQueryParams(query) });
  }

  setSearchDraft(value: string): void {
    this.searchDraft.set(value);
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.navigate({ ...this.query(), search: value, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
  }

  clearSearch(): void {
    this.setSearchDraft('');
  }

  setLeague(league: string): void {
    this.navigate(selectScopeLeague(this.query(), league, this.seasons()));
  }

  setSeason(season: string): void {
    this.navigate(selectScopeSeason(this.query(), season, this.seasons()));
  }

  sortBy(col: GlobalStatsSortCol): void {
    this.navigate(toggleGlobalStatsSort(this.query(), col));
  }

  ariaSort(col: GlobalStatsSortCol): 'ascending' | 'descending' | null {
    if (this.currentSort() !== col) return null;
    return this.currentDirection() === 'asc' ? 'ascending' : 'descending';
  }

  goPage(page: number): void {
    this.navigate({ ...this.query(), page });
  }

  setSize(size: GlobalStatsPageSize): void {
    this.navigate({ ...this.query(), size, page: 1 });
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
