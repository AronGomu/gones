import { Component, InjectionToken, OnDestroy, Signal, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { ArchiveRepository, ArchiveTournamentRow } from '../../data/archive-repository.service';
import { ArchiveYearEntry, isArchiveTournamentRowLocked } from '../../data/archive-summary';
import { I18nService } from '../../i18n/i18n.service';
import { MessageKey } from '../../i18n/messages';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { ArchiveShellComponent } from './archive-shell.component';
import { ARCHIVE_SEARCH_DEBOUNCE_MS } from './league-season-list.component';

export const ARCHIVE_TABLE_PAGE_SIZES = [25, 50, 100] as const;
export type ArchiveTablePageSize = (typeof ARCHIVE_TABLE_PAGE_SIZES)[number];
export const DEFAULT_ARCHIVE_TABLE_PAGE_SIZE: ArchiveTablePageSize = 25;

/** The binding sort vocabulary of Tab 2: four visual columns carrying six values. */
export const ARCHIVE_TOURNAMENT_SORT_KEYS = ['name', 'leagueName', 'date', 'updated', 'players', 'status'] as const;
export type ArchiveTournamentSortKey = (typeof ARCHIVE_TOURNAMENT_SORT_KEYS)[number];
export const DEFAULT_ARCHIVE_TOURNAMENT_SORT: ArchiveTournamentSortKey = 'date';
export const DEFAULT_ARCHIVE_TOURNAMENT_DIRECTION: 'asc' | 'desc' = 'desc';

/** The four visual columns of Variant B. */
export type ArchiveTournamentColumn = 'tournamentLeague' | 'dateUpdated' | 'players' | 'status';

/** Which sort keys each column owns. `aria-sort` is set on the column that owns the active key. */
export const ARCHIVE_TOURNAMENT_COLUMN_KEYS: Record<ArchiveTournamentColumn, readonly ArchiveTournamentSortKey[]> = {
  tournamentLeague: ['name', 'leagueName'],
  dateUpdated: ['date', 'updated'],
  players: ['players'],
  status: ['status']
};

/** A paired header sorts on its FIRST value; the second stays reachable through the sort select. */
export const ARCHIVE_TOURNAMENT_COLUMN_PRIMARY: Record<ArchiveTournamentColumn, ArchiveTournamentSortKey> = {
  tournamentLeague: 'name',
  dateUpdated: 'date',
  players: 'players',
  status: 'status'
};

const ARCHIVE_TOURNAMENT_SORT_LABEL_KEYS: Record<ArchiveTournamentSortKey, MessageKey> = {
  name: 'archiveTournaments.sortName',
  leagueName: 'archiveTournaments.sortLeagueName',
  date: 'archiveTournaments.sortDate',
  updated: 'archiveTournaments.sortUpdated',
  players: 'archiveTournaments.sortPlayers',
  status: 'archiveTournaments.sortStatus'
};

const ARCHIVE_TOURNAMENT_COLUMN_LABEL_KEYS: Record<ArchiveTournamentColumn, MessageKey> = {
  tournamentLeague: 'archiveTournaments.colTournamentLeague',
  dateUpdated: 'archiveTournaments.colDateUpdated',
  players: 'archiveTournaments.colPlayers',
  status: 'archiveTournaments.colStatus'
};

/** The whole list state, and the whole query string. `year` is the one value never omitted. */
export interface ArchiveTournamentQuery {
  readonly sort: ArchiveTournamentSortKey;
  readonly dir: 'asc' | 'desc';
  readonly page: number;                       // 1-based, always >= 1
  readonly size: ArchiveTablePageSize;
  readonly search: string;                     // already trimmed
  readonly year: number | null;                // null ⇒ resolve to the newest indexed year
  readonly season: string | null;
}

export const DEFAULT_ARCHIVE_TOURNAMENT_QUERY: ArchiveTournamentQuery = {
  sort: DEFAULT_ARCHIVE_TOURNAMENT_SORT,
  dir: DEFAULT_ARCHIVE_TOURNAMENT_DIRECTION,
  page: 1,
  size: DEFAULT_ARCHIVE_TABLE_PAGE_SIZE,
  search: '',
  year: null,
  season: null
};

/** One loaded calendar year, however the repository obtained it. */
export interface ArchiveYearRows {
  readonly items: readonly ArchiveTournamentRow[];
  /** The server's uncapped count for the year, plus the browser-local rows dated inside it. */
  readonly totalCount: number;
  /** The server capped the year: fewer rows came back than it says the year holds. */
  readonly truncated: boolean;
  readonly syncedAt: string | undefined;
  readonly stale: boolean;
}

export interface ArchiveTournamentTabSource {
  listYears(): Promise<readonly ArchiveYearEntry[]>;
  loadYear(year: number, force?: boolean): Promise<ArchiveYearRows>;
  /** `seasonId` → the name of the League that Season belongs to. A missing key renders an empty line. */
  listSeasonLeagueNames(): Promise<ReadonlyMap<string, string>>;
}

function archiveTournamentTabSourceFactory(): ArchiveTournamentTabSource {
  const repo = inject(ArchiveRepository);
  return {
    // Unioned: a year only a browser-local Tournament occupies is offered too (ADR 0028).
    listYears: () => repo.listYears(),
    // One year at a time, and the union is the repository's job: this returns the server partition
    // for `year` plus the browser-local Tournaments bucketed into `year`. The bucketing rule lives
    // there once, and it is total — an undated browser-local row is filed, never dropped.
    loadYear: async (year, force = false) => {
      const catalog = await repo.listTournaments({ force, year });
      return {
        items: catalog.items,
        totalCount: catalog.totalCount,
        truncated: catalog.truncated,
        syncedAt: catalog.fetchedAt,
        stale: catalog.stale
      };
    },
    listSeasonLeagueNames: async () => {
      const [seasons, leagues] = await Promise.all([repo.listLeagueSeasons(), repo.listLeagues()]);
      const leagueNames = new Map(leagues.items.map((league) => [league.id, league.name]));
      return new Map(seasons.items.flatMap((season) => {
        const name = leagueNames.get(season.leagueId);
        return name === undefined ? [] : [[season.id, name] as const];
      }));
    }
  };
}

export const ARCHIVE_TOURNAMENT_TAB_SOURCE = new InjectionToken<ArchiveTournamentTabSource>('ARCHIVE_TOURNAMENT_TAB_SOURCE', {
  providedIn: 'root',
  factory: archiveTournamentTabSourceFactory
});

/**
 * Reads the list state out of the URL. Accepts both `URLSearchParams` (tests) and Angular `ParamMap`
 * (router). Every unknown, malformed or out-of-range value falls back to its default.
 */
export function parseArchiveTournamentQuery(params: { get(key: string): string | null }): ArchiveTournamentQuery {
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const rawSize = Number(params.get('size') ?? DEFAULT_ARCHIVE_TABLE_PAGE_SIZE);
  const size: ArchiveTablePageSize = (ARCHIVE_TABLE_PAGE_SIZES as readonly number[]).includes(rawSize)
    ? (rawSize as ArchiveTablePageSize)
    : DEFAULT_ARCHIVE_TABLE_PAGE_SIZE;

  const rawSort = params.get('sort') ?? '';
  const sort: ArchiveTournamentSortKey = (ARCHIVE_TOURNAMENT_SORT_KEYS as readonly string[]).includes(rawSort)
    ? (rawSort as ArchiveTournamentSortKey)
    : DEFAULT_ARCHIVE_TOURNAMENT_SORT;

  const rawDir = params.get('dir') ?? '';
  const dir: 'asc' | 'desc' = rawDir === 'asc' || rawDir === 'desc' ? rawDir : DEFAULT_ARCHIVE_TOURNAMENT_DIRECTION;

  const rawYear = params.get('year') ?? '';
  const year = /^\d{4}$/.test(rawYear) ? Number(rawYear) : null;

  const season = params.get('season');
  return { sort, dir, page, size, search: (params.get('search') ?? '').trim(), year, season: season || null };
}

/** Router query params. Every default is omitted; `year` is written whenever it is non-null. */
export function archiveTournamentQueryParams(query: ArchiveTournamentQuery): Params {
  const params: Params = {};
  if (query.sort !== DEFAULT_ARCHIVE_TOURNAMENT_SORT) params['sort'] = query.sort;
  if (query.dir !== DEFAULT_ARCHIVE_TOURNAMENT_DIRECTION) params['dir'] = query.dir;
  if (query.page !== 1) params['page'] = query.page;
  if (query.size !== DEFAULT_ARCHIVE_TABLE_PAGE_SIZE) params['size'] = query.size;
  if (query.search) params['search'] = query.search;
  if (query.season !== null) params['season'] = query.season;
  if (query.year !== null) params['year'] = query.year;
  return params;
}

/** New key → `desc`, page 1. Same key → flip the direction, page 1. */
export function toggleArchiveTournamentSort(query: ArchiveTournamentQuery, key: ArchiveTournamentSortKey): ArchiveTournamentQuery {
  const same = query.sort === key;
  const dir: 'asc' | 'desc' = same && query.dir === 'desc' ? 'asc' : 'desc';
  return { ...query, sort: key, dir, page: 1 };
}

/** Season filter then case-insensitive substring over Tournament name and League name. */
export function filterArchiveTournamentRows(
  rows: readonly ArchiveTournamentRow[],
  search: string,
  seasonId: string | null,
  leagueNameOf: (row: ArchiveTournamentRow) => string
): ArchiveTournamentRow[] {
  const term = search.trim().toLowerCase();
  return rows.filter((row) =>
    (seasonId === null || row.seasonId === seasonId)
    && (!term || row.name.toLowerCase().includes(term) || leagueNameOf(row).toLowerCase().includes(term)));
}

/** Fixed locale so the order is a property of the code, not of the reader's browser. */
const NAME_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Total, deterministic ordering. Never mutates `rows`. */
export function sortArchiveTournamentRows(
  rows: readonly ArchiveTournamentRow[],
  sort: ArchiveTournamentSortKey,
  dir: 'asc' | 'desc',
  leagueNameOf: (row: ArchiveTournamentRow) => string
): ArchiveTournamentRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    // An empty League name — a standalone Tournament, or a Season whose League is missing — sorts
    // last in BOTH directions: an absent value is not a small value.
    if (sort === 'leagueName') {
      const missing = Number(leagueNameOf(left) === '') - Number(leagueNameOf(right) === '');
      if (missing) return missing;
    }
    return sign * compareArchiveTournamentBy(left, right, sort, leagueNameOf) || compareOrdinal(left.id, right.id);
  });
}

function compareArchiveTournamentBy(
  left: ArchiveTournamentRow,
  right: ArchiveTournamentRow,
  sort: ArchiveTournamentSortKey,
  leagueNameOf: (row: ArchiveTournamentRow) => string
): number {
  switch (sort) {
    case 'name': return NAME_COLLATOR.compare(left.name, right.name);
    case 'leagueName': return NAME_COLLATOR.compare(leagueNameOf(left), leagueNameOf(right));
    case 'date': return compareOrdinal(left.tournamentDate, right.tournamentDate);
    case 'updated': return compareNumbers(instantValue(left.updatedAt), instantValue(right.updatedAt));
    case 'players': return compareNumbers(left.playerCount, right.playerCount);
    case 'status': return compareOrdinal(left.status, right.status);
  }
}

/** An instant that will not parse sorts as the epoch rather than poisoning the comparator with NaN. */
function instantValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Code-unit order, matching the `id ASC` tiebreak the server orders its catalogs by. */
function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Tab 2 of the Archive: every Tournament of one calendar year, standalone ones included, in the same
 * Variant B treatment as Tab 1 and inside the same shell. The year is required by the catalog
 * endpoint, so a first load with no `?year=` resolves the newest indexed year and writes it into the
 * URL without a history entry.
 */
@Component({
  selector: 'gones-tournament-list',
  standalone: true,
  imports: [FormsModule, RouterLink, ArchiveShellComponent, BackButtonComponent],
  template: `
    <gones-back-button data-cy="archive-tournaments-back-top" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />

    <gones-archive-shell
      activeTab="tournaments"
      [syncedAt]="syncedAt()"
      [loading]="loading()"
      [stale]="stale()"
      (sync)="sync()"
      data-cy="archive-tournaments-shell"
    >
      <div class="archive-toolbar" data-cy="archive-tournaments-toolbar">
        <div class="archive-field archive-field--grow" data-cy="archive-tournaments-search-field">
          <label for="archive-tournaments-search" data-cy="archive-tournaments-search-label">{{ i18n.t('archive.searchLabel') }}</label>
          <input
            id="archive-tournaments-search"
            type="search"
            data-cy="archive-tournaments-search-input"
            [placeholder]="i18n.t('archiveTournaments.searchPlaceholder')"
            [ngModel]="searchDraft()"
            (ngModelChange)="setSearchDraft($event)"
          />
          @if (searchDraft()) {
            <button type="button" class="archive-ghost-button" data-cy="archive-tournaments-search-clear" (click)="clearSearch()">{{ i18n.t('common.clear') }}</button>
          }
        </div>
        <div class="archive-field" data-cy="archive-tournaments-year-field">
          <label for="archive-tournaments-year" data-cy="archive-tournaments-year-label">{{ i18n.t('archiveTournaments.yearLabel') }}</label>
          <select id="archive-tournaments-year" data-cy="archive-tournaments-year-select" [attr.aria-label]="i18n.t('archiveTournaments.yearAria')" [ngModel]="query().year" (ngModelChange)="setYear($any(+$event))">
            @for (option of yearOptions(); track option.year) {
              <option [value]="option.year" [attr.data-cy]="'archive-tournaments-year-option-' + option.year">{{ option.year }}</option>
            }
          </select>
        </div>
        <div class="archive-field" data-cy="archive-tournaments-sort-field">
          <label for="archive-tournaments-sort" data-cy="archive-tournaments-sort-label">{{ i18n.t('archive.sortLabel') }}</label>
          <select id="archive-tournaments-sort" data-cy="archive-tournaments-sort-select" [ngModel]="query().sort" (ngModelChange)="setSort($event)">
            @for (key of sortKeys; track key) {
              <option [value]="key" [attr.data-cy]="'archive-tournaments-sort-option-' + key">{{ sortLabel(key) }}</option>
            }
          </select>
          <button
            type="button"
            class="archive-ghost-button"
            data-cy="archive-tournaments-direction-button"
            [attr.aria-label]="i18n.t('archive.directionToggleAria', { direction: i18n.t(query().dir === 'asc' ? 'archive.ascending' : 'archive.descending') })"
            (click)="toggleDirection()"
          >{{ query().dir === 'asc' ? '↑' : '↓' }}</button>
        </div>
        <div class="archive-field" data-cy="archive-tournaments-size-field">
          <label for="archive-tournaments-size" data-cy="archive-tournaments-size-label">{{ i18n.t('archive.sizeLabel') }}</label>
          <!-- \`[value]\` does not populate SelectControlValueAccessor's option map, so the \`+\` is
               load-bearing: without it a \`'25'\` would not equal the default and would reach the URL. -->
          <select id="archive-tournaments-size" data-cy="archive-tournaments-size-select" [ngModel]="query().size" (ngModelChange)="setSize($any(+$event))">
            @for (size of pageSizes; track size) {
              <option [value]="size" [attr.data-cy]="'archive-tournaments-size-option-' + size">{{ size }}</option>
            }
          </select>
        </div>
      </div>

      @if (query().season) {
        <p class="archive-season-filter" data-cy="archive-tournaments-season-filter">
          <span data-cy="archive-tournaments-season-filter-label">{{ i18n.t('archiveTournaments.seasonFilter') }}</span>
          <button type="button" class="archive-ghost-button" data-cy="archive-tournaments-season-filter-clear" (click)="clearSeasonFilter()">{{ i18n.t('archiveTournaments.clearSeasonFilter') }}</button>
        </p>
      }

      @if (error()) { <p class="error" role="alert" data-cy="archive-tournaments-error">{{ error() }}</p> }
      @if (truncated()) { <p class="warning" role="status" data-cy="archive-tournaments-truncated">{{ truncationMessage() }}</p> }
      @if (hasLocalRows()) { <p class="archive-local-notice" role="status" data-cy="archive-tournaments-local-notice">{{ localNotice() }}</p> }

      <div class="archive-status-line" data-cy="archive-tournaments-status-line">
        <span aria-live="polite" data-cy="archive-tournaments-page-status">{{ i18n.t('archiveTournaments.pageStatus', { page: currentPage(), total: totalPages(), count: totalRows() }) }}</span>
      </div>

      <div class="table-wrap" data-cy="archive-tournaments-table-wrap">
        <table class="ranking-table archive-table" [attr.aria-label]="i18n.t('archiveTournaments.tournamentsAria')" data-cy="archive-tournaments-table">
          <thead data-cy="archive-tournaments-thead">
            <tr data-cy="archive-tournaments-header-row">
              <th scope="col" [attr.aria-sort]="ariaSort('tournamentLeague')" data-cy="archive-tournaments-col-tournament-league">
                <button type="button" class="archive-sort-button" data-cy="archive-tournaments-sort-tournament-league" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('tournamentLeague') })" (click)="sortByColumn('tournamentLeague')">{{ i18n.t('archiveTournaments.colTournamentLeague') }}</button>
              </th>
              <th scope="col" [attr.aria-sort]="ariaSort('dateUpdated')" data-cy="archive-tournaments-col-dates">
                <button type="button" class="archive-sort-button" data-cy="archive-tournaments-sort-dates" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('dateUpdated') })" (click)="sortByColumn('dateUpdated')">{{ i18n.t('archiveTournaments.colDateUpdated') }}</button>
              </th>
              <th scope="col" class="archive-num" [attr.aria-sort]="ariaSort('players')" data-cy="archive-tournaments-col-players">
                <button type="button" class="archive-sort-button" data-cy="archive-tournaments-sort-players" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('players') })" (click)="sortByColumn('players')">{{ i18n.t('archiveTournaments.colPlayers') }}</button>
              </th>
              <th scope="col" [attr.aria-sort]="ariaSort('status')" data-cy="archive-tournaments-col-status">
                <button type="button" class="archive-sort-button" data-cy="archive-tournaments-sort-status" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('status') })" (click)="sortByColumn('status')">{{ i18n.t('archiveTournaments.colStatus') }}</button>
              </th>
            </tr>
          </thead>
          <tbody data-cy="archive-tournaments-tbody">
            @if (loading()) {
              @for (index of skeletonRows; track index) {
                <tr [attr.data-cy]="'archive-tournaments-skeleton-row-' + index">
                  <td [attr.data-cy]="'archive-tournaments-skeleton-name-' + index"><span class="archive-skel archive-skel--wide" [attr.data-cy]="'archive-tournaments-skeleton-name-bar-' + index" aria-hidden="true"></span><span class="archive-skel archive-skel--sub" [attr.data-cy]="'archive-tournaments-skeleton-league-bar-' + index" aria-hidden="true"></span></td>
                  <td [attr.data-cy]="'archive-tournaments-skeleton-dates-' + index"><span class="archive-skel" [attr.data-cy]="'archive-tournaments-skeleton-dates-bar-' + index" aria-hidden="true"></span></td>
                  <td class="archive-num" [attr.data-cy]="'archive-tournaments-skeleton-players-' + index"><span class="archive-skel archive-skel--narrow" [attr.data-cy]="'archive-tournaments-skeleton-players-bar-' + index" aria-hidden="true"></span></td>
                  <td [attr.data-cy]="'archive-tournaments-skeleton-status-' + index"><span class="archive-skel archive-skel--narrow" [attr.data-cy]="'archive-tournaments-skeleton-status-bar-' + index" aria-hidden="true"></span></td>
                </tr>
              }
            } @else if (!pagedRows().length) {
              <tr data-cy="archive-tournaments-empty-row">
                <td colspan="4" data-cy="archive-tournaments-empty-cell">
                  <div class="archive-empty" data-cy="archive-tournaments-empty">
                    <strong data-cy="archive-tournaments-empty-title">{{ emptyTitle() }}</strong>
                    <span data-cy="archive-tournaments-empty-body">{{ emptyBody() }}</span>
                  </div>
                </td>
              </tr>
            } @else {
              @for (row of pagedRows(); track row.id) {
                <tr [attr.data-cy]="'archive-tournaments-row-' + row.id">
                  <td [attr.data-cy]="'archive-tournaments-cell-name-' + row.id">
                    <span class="archive-two-line" [attr.data-cy]="'archive-tournaments-name-' + row.id">
                      <a class="archive-name-link" [routerLink]="['/archive/tournaments', row.id]" [attr.aria-label]="i18n.t('archiveTournaments.openAria', { name: row.name })" [attr.data-cy]="'archive-tournaments-link-' + row.id">{{ row.name }}</a>
                      @if (row.isLocal) {
                        <span class="archive-local-badge" [attr.title]="i18n.t('archive.localBadgeTitle')" [attr.data-cy]="'archive-tournaments-local-badge-' + row.id">{{ i18n.t('archive.localBadge') }}</span>
                      }
                      <span class="archive-sub" [attr.data-cy]="'archive-tournaments-league-' + row.id">{{ leagueNameOf(row) }}</span>
                    </span>
                  </td>
                  <td [attr.data-cy]="'archive-tournaments-dates-' + row.id">
                    <span class="archive-two-line" [attr.data-cy]="'archive-tournaments-dates-stack-' + row.id">
                      <span [attr.data-cy]="'archive-tournaments-played-' + row.id">{{ i18n.formatDate(row.tournamentDate) }}</span>
                      <span class="archive-sub" [attr.data-cy]="'archive-tournaments-updated-' + row.id">{{ i18n.t('archive.updatedPrefix', { date: i18n.formatDate(row.updatedAt) }) }}</span>
                    </span>
                  </td>
                  <td class="archive-num" [attr.data-cy]="'archive-tournaments-players-' + row.id">{{ row.playerCount }}</td>
                  <td [attr.data-cy]="'archive-tournaments-cell-status-' + row.id">
                    <span class="status" [class.completed]="row.status === 'completed'" [attr.data-cy]="'archive-tournaments-status-' + row.id"><span class="status-dot" aria-hidden="true" [attr.data-cy]="'archive-tournaments-status-dot-' + row.id"></span>{{ statusLabel(row) }}</span>
                    @if (isLocked(row)) {
                      <span class="archive-lock" role="img" [attr.aria-label]="i18n.t('archiveTournaments.locked')" [attr.title]="i18n.t('archiveTournaments.locked')" [attr.data-cy]="'archive-tournaments-lock-' + row.id">🔒</span>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <nav class="archive-pager" [attr.aria-label]="i18n.t('archiveTournaments.paginationAria')" data-cy="archive-tournaments-pagination">
        <button type="button" data-cy="archive-tournaments-page-previous" [disabled]="currentPage() <= 1" (click)="goPage(currentPage() - 1)">{{ i18n.t('common.previous') }}</button>
        <span data-cy="archive-tournaments-page-indicator">{{ i18n.t('archive.pageIndicator', { page: currentPage(), total: totalPages() }) }}</span>
        <button type="button" data-cy="archive-tournaments-page-next" [disabled]="currentPage() >= totalPages()" (click)="goPage(currentPage() + 1)">{{ i18n.t('common.next') }}</button>
      </nav>
    </gones-archive-shell>

    <gones-back-button data-cy="archive-tournaments-back-bottom" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `,
  styles: [`
    .archive-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; margin: 0 0 .85rem; }
    .archive-field { display: flex; align-items: center; gap: .45rem; padding: .5rem .7rem; border: 1px solid var(--soot); background: var(--iron); }
    .archive-field--grow { flex: 1 1 12rem; min-width: 11rem; }
    .archive-field--grow input { width: 100%; }
    .archive-field label { color: var(--steel); font-size: .72rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    .archive-field input, .archive-field select { min-width: 6ch; border: 0; background: transparent; color: var(--ash); font: inherit; font-size: .88rem; outline: 0; }
    .archive-field select { cursor: pointer; }
    .archive-field input::placeholder { color: var(--steel); }
    .archive-field input:focus-visible, .archive-field select:focus-visible { outline: 2px solid var(--hot-blood); outline-offset: 2px; }
    .archive-ghost-button { min-height: 1.9rem; padding: .2rem .5rem; border: 1px solid var(--soot); background: var(--black-metal); color: var(--dim-ash); font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; }
    .archive-ghost-button:hover { background: var(--raised-iron); color: var(--ash); }
    .archive-season-filter { display: flex; align-items: center; gap: .6rem; margin: 0 0 .6rem; color: var(--steel); font-size: .82rem; }
    .archive-status-line { margin: 0 0 .5rem; color: var(--dim-ash); font-size: .85rem; font-weight: 800; }
    /* Same two overrides Tab 1 needs: the global \`.ranking-table\` 680px floor and its \`nowrap\` cells
       are what stop a four-column table from fitting a phone. */
    .ranking-table.archive-table { width: 100%; min-width: 0; border-collapse: collapse; font-size: .88rem; }
    .archive-table th, .archive-table td { padding: .55rem .7rem; border-bottom: 1px solid var(--soot); text-align: left; vertical-align: middle; white-space: normal; }
    .archive-table .status { white-space: nowrap; }
    .archive-table thead th { background: var(--black-metal); color: var(--dim-ash); font-size: .72rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; white-space: normal; }
    .archive-table td.archive-num, .archive-table th.archive-num { text-align: right; }
    .archive-table th.archive-num .archive-sort-button { text-align: right; }
    .archive-sort-button { width: 100%; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; letter-spacing: inherit; text-align: inherit; text-transform: inherit; cursor: pointer; }
    .archive-sort-button:hover { color: var(--ash); }
    .archive-sort-button:focus-visible { outline: 2px solid var(--hot-blood); outline-offset: 2px; }
    .archive-table th[aria-sort="ascending"] .archive-sort-button::after { content: ' ↑'; color: var(--hot-blood); }
    .archive-table th[aria-sort="descending"] .archive-sort-button::after { content: ' ↓'; color: var(--hot-blood); }
    .archive-table tbody tr:nth-child(even) { background: color-mix(in oklch, var(--raised-iron) 52%, var(--iron)); }
    .archive-table tbody tr:hover { background: color-mix(in oklch, var(--blood) 13%, var(--raised-iron)); }
    .archive-two-line { display: flex; flex-direction: column; gap: .12rem; white-space: normal; }
    /* Rendered even when empty: a standalone Tournament has no League line, and a row one line
       shorter than its neighbours is worse than a blank one. */
    .archive-sub { min-height: 1.1em; color: var(--steel); font-size: .78rem; }
    .archive-name-link { color: var(--ash); font-weight: 700; text-decoration: none; }
    .archive-name-link:hover, .archive-name-link:focus-visible { color: var(--hot-blood); text-decoration: underline; text-underline-offset: .16em; }
    .archive-lock { margin-left: .4rem; color: var(--steel); font-size: .78rem; }
    .archive-empty { padding: 2.4rem 1rem; text-align: center; color: var(--steel); }
    .archive-empty strong { display: block; margin-bottom: .4rem; color: var(--dim-ash); font-size: 1rem; }
    .archive-skel { display: block; height: .72rem; margin: .2rem 0; background: linear-gradient(90deg, var(--raised-iron), var(--soot), var(--raised-iron)); background-size: 200% 100%; animation: archive-skel-shimmer 1.3s linear infinite; }
    .archive-skel--wide { width: 70%; }
    .archive-skel--sub { width: 45%; height: .6rem; }
    .archive-skel--narrow { width: 40%; }
    @keyframes archive-skel-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .archive-skel { animation: none; } }
    .archive-pager { display: flex; align-items: center; justify-content: center; gap: 1rem; margin: .85rem 0 0; color: var(--steel); font-size: .84rem; }
    .archive-pager button { min-height: 2.4rem; padding: .45rem .8rem; border: 1px solid var(--soot); background: var(--iron); color: var(--dim-ash); font: inherit; font-size: .82rem; font-weight: 700; cursor: pointer; }
    .archive-pager button:disabled { opacity: .38; cursor: not-allowed; }
    .archive-pager button:not(:disabled):hover { background: var(--raised-iron); color: var(--ash); }
  `]
})
export class TournamentListComponent implements OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly source = inject(ARCHIVE_TOURNAMENT_TAB_SOURCE);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private yearsLoaded = false;

  readonly loading = signal(true);
  readonly error = signal('');
  readonly stale = signal(false);
  readonly truncated = signal(false);
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly years = signal<readonly ArchiveYearEntry[]>([]);
  readonly rows = signal<readonly ArchiveTournamentRow[]>([]);
  readonly totalCount = signal(0);
  readonly seasonLeagueNames = signal<ReadonlyMap<string, string>>(new Map());
  readonly searchDraft = signal('');
  readonly query = signal<ArchiveTournamentQuery>(DEFAULT_ARCHIVE_TOURNAMENT_QUERY);

  readonly pageSizes = ARCHIVE_TABLE_PAGE_SIZES;
  readonly sortKeys = ARCHIVE_TOURNAMENT_SORT_KEYS;
  /** Five skeleton rows, the same height as five real ones, so the table does not jump on load. */
  readonly skeletonRows = [0, 1, 2, 3, 4] as const;

  readonly filteredRows: Signal<ArchiveTournamentRow[]>;
  readonly sortedRows: Signal<ArchiveTournamentRow[]>;
  readonly totalRows: Signal<number>;
  readonly totalPages: Signal<number>;
  readonly currentPage: Signal<number>;
  readonly pagedRows: Signal<ArchiveTournamentRow[]>;
  readonly yearOptions: Signal<ArchiveYearEntry[]>;
  readonly emptyArchive: Signal<boolean>;
  /** At least one row on this page lives in this browser — the ADR 0028 notice is rendered only then. */
  readonly hasLocalRows: Signal<boolean>;
  /** A shown browser-local row whose date is not a `YYYY-MM-DD`, and so was bucketed by the clock. */
  readonly localUndatedShown: Signal<boolean>;

  constructor() {
    this.filteredRows = computed(() =>
      filterArchiveTournamentRows(this.rows(), this.query().search, this.query().season, this.leagueNameOf));
    this.sortedRows = computed(() =>
      sortArchiveTournamentRows(this.filteredRows(), this.query().sort, this.query().dir, this.leagueNameOf));
    this.totalRows = computed(() => this.filteredRows().length);
    this.totalPages = computed(() => Math.max(1, Math.ceil(this.totalRows() / this.query().size)));
    this.currentPage = computed(() => Math.min(Math.max(this.query().page, 1), this.totalPages()));
    this.pagedRows = computed(() => {
      const start = (this.currentPage() - 1) * this.query().size;
      return this.sortedRows().slice(start, start + this.query().size);
    });
    this.hasLocalRows = computed(() => this.pagedRows().some((row) => row.isLocal));
    this.localUndatedShown = computed(() =>
      this.pagedRows().some((row) => row.isLocal && !/^\d{4}-\d{2}-\d{2}$/.test(row.tournamentDate)));
    /** Newest first: the year a reader wants is almost always the last one played. */
    this.yearOptions = computed(() => [...this.years()].sort((left, right) => right.year - left.year));
    this.emptyArchive = computed(() => !this.loading() && !this.error() && this.years().length === 0);

    this.route.queryParamMap.subscribe((params) => {
      this.query.set(parseArchiveTournamentQuery(params));
      this.searchDraft.set((params.get('search') ?? '').trim());
      void this.load();
    });
  }

  ngOnDestroy(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
  }

  /**
   * Resolves the year, then loads it. When the URL's year is absent or unknown the newest indexed
   * year is written into the URL with no history entry and the subscription re-enters with it —
   * `GET /api/archive/tournaments/all` has no all-years mode, so a year is not optional.
   */
  async load(options: { force?: boolean } = {}): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      if (!this.yearsLoaded || options.force) {
        this.years.set(await this.source.listYears());
        this.yearsLoaded = true;
      }
      const resolved = this.resolveYear();
      if (resolved === null) {
        this.rows.set([]);
        return;
      }
      if (resolved !== this.query().year) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: archiveTournamentQueryParams({ ...this.query(), year: resolved, page: 1 }),
          replaceUrl: true
        });
        return;
      }
      const page = await this.source.loadYear(resolved, options.force === true);
      this.rows.set(page.items);
      this.totalCount.set(page.totalCount);
      this.truncated.set(page.truncated);
      this.syncedAt.set(page.syncedAt);
      this.stale.set(page.stale);
      this.seasonLeagueNames.set(await this.source.listSeasonLeagueNames());
    } catch (error) {
      logBoundaryError('archive-tournament-list.load', error, { year: this.query().year });
      this.error.set(this.i18n.t('archiveTournaments.loadFailed'));
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  sync(): void { void this.load({ force: true }); }

  /** The URL's year when the index holds it, else the newest indexed year, else `null`. */
  private resolveYear(): number | null {
    const years = this.years();
    if (!years.length) return null;
    const requested = this.query().year;
    if (requested !== null && years.some((entry) => entry.year === requested)) return requested;
    return Math.max(...years.map((entry) => entry.year));
  }

  /** `''` for a standalone Tournament, and for one whose Season is not in the catalog. */
  readonly leagueNameOf = (row: ArchiveTournamentRow): string =>
    row.seasonId === null ? '' : this.seasonLeagueNames().get(row.seasonId) ?? '';

  /** Derived from the date at read time, never from a stored flag; a local row is never locked. */
  isLocked(row: ArchiveTournamentRow, now?: Date): boolean { return isArchiveTournamentRowLocked(row, now); }

  statusLabel(row: ArchiveTournamentRow): string {
    return this.i18n.t(row.status === 'completed' ? 'archive.tournamentCompleted' : 'archive.tournamentActive');
  }

  /**
   * The ADR 0028 notice, plus the bucketing sentence only while an undated browser-local row is on
   * screen: without it that record appears in a year it was never played in, with no explanation.
   */
  localNotice(): string {
    const notice = this.i18n.t('archive.localNotice');
    if (!this.localUndatedShown()) return notice;
    return `${notice} ${this.i18n.t('archive.localUndated', { year: this.query().year ?? '' })}`;
  }

  truncationMessage(): string {
    return this.i18n.t('archiveTournaments.truncated', {
      shown: this.rows().length,
      total: this.totalCount(),
      year: this.query().year ?? ''
    });
  }

  emptyTitle(): string {
    if (this.emptyArchive()) return this.i18n.t('archiveTournaments.emptyArchive');
    if (this.filtered()) return this.i18n.t('archiveTournaments.noneMatch');
    return this.i18n.t('archiveTournaments.emptyYear', { year: this.query().year ?? '' });
  }

  emptyBody(): string {
    if (this.emptyArchive()) return this.i18n.t('archiveTournaments.emptyArchiveBody');
    if (this.filtered()) return this.i18n.t('archiveTournaments.noneMatchBody');
    return this.i18n.t('archiveTournaments.emptyYearBody');
  }

  filtered(): boolean { return this.query().search !== '' || this.query().season !== null; }

  private navigate(query: ArchiveTournamentQuery): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: archiveTournamentQueryParams(query) });
  }

  /** Clicking a paired header selects its FIRST value; clicking the active key flips the direction. */
  sortByColumn(column: ArchiveTournamentColumn): void {
    this.navigate(toggleArchiveTournamentSort(this.query(), ARCHIVE_TOURNAMENT_COLUMN_PRIMARY[column]));
  }

  ariaSort(column: ArchiveTournamentColumn): 'ascending' | 'descending' | null {
    if (!ARCHIVE_TOURNAMENT_COLUMN_KEYS[column].includes(this.query().sort)) return null;
    return this.query().dir === 'asc' ? 'ascending' : 'descending';
  }

  setSort(key: ArchiveTournamentSortKey): void { this.navigate({ ...this.query(), sort: key, page: 1 }); }

  toggleDirection(): void {
    this.navigate({ ...this.query(), dir: this.query().dir === 'asc' ? 'desc' : 'asc', page: 1 });
  }

  setSearchDraft(value: string): void {
    this.searchDraft.set(value);
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(
      () => this.navigate({ ...this.query(), search: value.trim(), page: 1 }),
      ARCHIVE_SEARCH_DEBOUNCE_MS
    );
  }

  clearSearch(): void { this.setSearchDraft(''); }
  setYear(year: number): void { this.navigate({ ...this.query(), year, page: 1 }); }
  setSize(size: ArchiveTablePageSize): void { this.navigate({ ...this.query(), size, page: 1 }); }
  goPage(page: number): void { this.navigate({ ...this.query(), page }); }
  clearSeasonFilter(): void { this.navigate({ ...this.query(), season: null, page: 1 }); }

  sortLabel(key: ArchiveTournamentSortKey): string { return this.i18n.t(ARCHIVE_TOURNAMENT_SORT_LABEL_KEYS[key]); }
  columnLabel(column: ArchiveTournamentColumn): string { return this.i18n.t(ARCHIVE_TOURNAMENT_COLUMN_LABEL_KEYS[column]); }
}
