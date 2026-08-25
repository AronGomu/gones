import { Component, OnDestroy, Signal, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { ArchiveLeagueRow, ArchiveLeagueSeasonRow, ArchiveRepository } from '../../data/archive-repository.service';
import { ArchiveLeagueSeasonSummary, ArchiveLeagueSummary, isLeagueSeasonRowLocked } from '../../data/archive-summary';
import { LeagueStatus } from '../../domain/archive-models';
import { I18nService } from '../../i18n/i18n.service';
import { MessageKey } from '../../i18n/messages';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { ArchiveShellComponent } from './archive-shell.component';
import {
  ARCHIVE_SEASON_SOURCE, ArchiveTournamentRow, SEASON_EXPANSION_PREVIEW_LIMIT, SeasonExpansionState, readSeasonTournaments
} from './league-season-detail.component';

export const LEAGUE_SEASON_PAGE_SIZES = [25, 50, 100] as const;
export type LeagueSeasonPageSize = (typeof LEAGUE_SEASON_PAGE_SIZES)[number];
export const DEFAULT_LEAGUE_SEASON_PAGE_SIZE: LeagueSeasonPageSize = 25;

/** The binding sort vocabulary of Tab 1. Six paired values plus the unpaired `status`. */
export const LEAGUE_SEASON_SORT_KEYS = [
  'name', 'leagueName', 'lastPlayed', 'updated', 'tournaments', 'players', 'status'
] as const;
export type LeagueSeasonSortKey = (typeof LEAGUE_SEASON_SORT_KEYS)[number];
export const DEFAULT_LEAGUE_SEASON_SORT: LeagueSeasonSortKey = 'lastPlayed';
export const DEFAULT_LEAGUE_SEASON_DIRECTION: 'asc' | 'desc' = 'desc';

/** The four visual columns of Variant B. */
export type LeagueSeasonColumn = 'seasonLeague' | 'datesUpdated' | 'counts' | 'status';

/** Which sort keys each column owns. `aria-sort` is set on the column that owns the active key. */
export const LEAGUE_SEASON_COLUMN_KEYS: Record<LeagueSeasonColumn, readonly LeagueSeasonSortKey[]> = {
  seasonLeague: ['name', 'leagueName'],
  datesUpdated: ['lastPlayed', 'updated'],
  counts: ['tournaments', 'players'],
  status: ['status']
};

/** A paired header sorts on its FIRST value; the second stays reachable through the sort select. */
export const LEAGUE_SEASON_COLUMN_PRIMARY: Record<LeagueSeasonColumn, LeagueSeasonSortKey> = {
  seasonLeague: 'name',
  datesUpdated: 'lastPlayed',
  counts: 'tournaments',
  status: 'status'
};

/** Sentinel for "no League filter". Never a real document id. */
export const ALL_LEAGUES = 'all';

export const ARCHIVE_SEARCH_DEBOUNCE_MS = 300;

const LEAGUE_SEASON_SORT_LABEL_KEYS: Record<LeagueSeasonSortKey, MessageKey> = {
  name: 'archive.sortName',
  leagueName: 'archive.sortLeagueName',
  lastPlayed: 'archive.sortLastPlayed',
  updated: 'archive.sortUpdated',
  tournaments: 'archive.sortTournaments',
  players: 'archive.sortPlayers',
  status: 'archive.sortStatus'
};

const LEAGUE_SEASON_COLUMN_LABEL_KEYS: Record<LeagueSeasonColumn, MessageKey> = {
  seasonLeague: 'archive.colSeasonLeague',
  datesUpdated: 'archive.colLastPlayedUpdated',
  counts: 'archive.colTournamentsPlayers',
  status: 'archive.colStatus'
};

/** The whole list state, and the whole query string. Nothing about this view lives elsewhere. */
export interface LeagueSeasonQuery {
  sort: LeagueSeasonSortKey;
  dir: 'asc' | 'desc';
  page: number;                 // 1-based, always >= 1
  size: LeagueSeasonPageSize;
  search: string;               // already trimmed
  league: string;               // a League document id, or ALL_LEAGUES
}

export const DEFAULT_LEAGUE_SEASON_QUERY: LeagueSeasonQuery = {
  sort: DEFAULT_LEAGUE_SEASON_SORT,
  dir: DEFAULT_LEAGUE_SEASON_DIRECTION,
  page: 1,
  size: DEFAULT_LEAGUE_SEASON_PAGE_SIZE,
  search: '',
  league: ALL_LEAGUES
};

/**
 * One rendered row: the catalog row joined to its League's name and stamped with the derived lock.
 * `leagueName` is `''` when the League is absent from the League catalog — which happens when the
 * League catalog was truncated by its row cap. The template prints the "Unknown League" message for
 * that case rather than an empty line.
 */
export interface LeagueSeasonRow {
  id: string;
  name: string;
  leagueId: string;
  leagueName: string;
  status: LeagueStatus;
  updatedAt: string;
  documentVersion: number;
  tournamentCount: number;
  playerCount: number;
  firstTournamentDate: string | null;
  lastTournamentDate: string | null;
  locked: boolean;
  /** This row lives in `gones-archive-local`. Display only — the lock keys on the id, not on this. */
  isLocal: boolean;
}

/** Fixed locale so the order is a property of the code, not of the reader's browser. `numeric` puts
 *  "Season 2" before "Season 10"; `sensitivity: 'base'` makes "Étape" and "Etape" adjacent. */
const NAME_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Reads the list state out of the URL. Accepts both `URLSearchParams` (tests) and Angular `ParamMap`
 * (router) — both expose `.get()`. Every unknown, malformed or out-of-range value falls back to its
 * default, exactly as `parseGlobalStatsQuery` does.
 *
 * `knownLeagueIds` is the gate on `?league=`: an id that is not in the League catalog resolves to
 * `ALL_LEAGUES`, so a stale bookmark shows the whole list instead of a permanently empty table whose
 * cause is invisible. Callers pass an empty set before the catalog lands and the real set after, so
 * this must be re-derived when the catalog arrives, never captured once.
 */
export function parseLeagueSeasonQuery(
  params: { get(key: string): string | null },
  knownLeagueIds: ReadonlySet<string> = new Set<string>()
): LeagueSeasonQuery {
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const rawSize = Number(params.get('size') ?? DEFAULT_LEAGUE_SEASON_PAGE_SIZE);
  const size: LeagueSeasonPageSize = (LEAGUE_SEASON_PAGE_SIZES as readonly number[]).includes(rawSize)
    ? (rawSize as LeagueSeasonPageSize)
    : DEFAULT_LEAGUE_SEASON_PAGE_SIZE;

  const rawSort = params.get('sort') ?? '';
  const sort: LeagueSeasonSortKey = (LEAGUE_SEASON_SORT_KEYS as readonly string[]).includes(rawSort)
    ? (rawSort as LeagueSeasonSortKey)
    : DEFAULT_LEAGUE_SEASON_SORT;

  const rawDir = params.get('dir') ?? '';
  const dir: 'asc' | 'desc' = rawDir === 'asc' || rawDir === 'desc' ? rawDir : DEFAULT_LEAGUE_SEASON_DIRECTION;

  const rawLeague = params.get('league') ?? ALL_LEAGUES;
  const league = rawLeague !== ALL_LEAGUES && knownLeagueIds.has(rawLeague) ? rawLeague : ALL_LEAGUES;

  return { sort, dir, page, size, search: (params.get('search') ?? '').trim(), league };
}

/** Serialises to Angular router query params, omitting every value that equals its default. */
export function leagueSeasonQueryParams(query: LeagueSeasonQuery): Params {
  const params: Params = {};
  if (query.sort !== DEFAULT_LEAGUE_SEASON_SORT) params['sort'] = query.sort;
  if (query.dir !== DEFAULT_LEAGUE_SEASON_DIRECTION) params['dir'] = query.dir;
  if (query.page !== 1) params['page'] = query.page;
  if (query.size !== DEFAULT_LEAGUE_SEASON_PAGE_SIZE) params['size'] = query.size;
  if (query.search) params['search'] = query.search;
  if (query.league !== ALL_LEAGUES) params['league'] = query.league;
  return params;
}

/** New key → `desc`, page 1. Same key → flip the direction, page 1. */
export function toggleLeagueSeasonSort(query: LeagueSeasonQuery, key: LeagueSeasonSortKey): LeagueSeasonQuery {
  const same = query.sort === key;
  const dir: 'asc' | 'desc' = same && query.dir === 'desc' ? 'asc' : 'desc';
  return { ...query, sort: key, dir, page: 1 };
}

/**
 * Joins the two catalogs and derives the lock. Pure; `now` is injectable for the tests. Accepts rows
 * from either authority: `isLocal` is optional so a bare wire summary is still assignable.
 */
export function buildLeagueSeasonRows(
  seasons: readonly (ArchiveLeagueSeasonSummary & { isLocal?: boolean })[],
  leagues: readonly (ArchiveLeagueSummary & { isLocal?: boolean })[],
  now: Date = new Date()
): LeagueSeasonRow[] {
  const names = new Map(leagues.map((league) => [league.id, league.name]));
  return seasons.map((season) => ({
    ...season,
    leagueName: names.get(season.leagueId) ?? '',
    // Every Tournament of the Season is locked exactly when its LATEST one is, because the latest
    // one locks last. A Season with no Tournament has nothing to lock and stays editable, and so
    // does a browser-authored one — `isLeagueSeasonRowLocked` is the single definition of both.
    // Deriving the lock from `isLocal` here would be a second rule that could drift from the first.
    locked: isLeagueSeasonRowLocked(season, now),
    isLocal: season.isLocal ?? false
  }));
}

/** League filter then case-insensitive substring over Season name and League name. Order preserved. */
export function filterLeagueSeasonRows(
  rows: readonly LeagueSeasonRow[],
  query: Pick<LeagueSeasonQuery, 'search' | 'league'>
): LeagueSeasonRow[] {
  const term = query.search.trim().toLowerCase();
  return rows.filter((row) =>
    (query.league === ALL_LEAGUES || row.leagueId === query.league)
    && (!term || row.name.toLowerCase().includes(term) || row.leagueName.toLowerCase().includes(term)));
}

/** Total, deterministic ordering. Never mutates `rows`. */
export function sortLeagueSeasonRows(
  rows: readonly LeagueSeasonRow[],
  sort: LeagueSeasonSortKey,
  dir: 'asc' | 'desc'
): LeagueSeasonRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    // `lastPlayed` is the only nullable sort key. A Season with no Tournament sorts last in BOTH
    // directions, so flipping the direction never lifts an empty Season above a played one.
    if (sort === 'lastPlayed') {
      const missing = Number(left.lastTournamentDate === null) - Number(right.lastTournamentDate === null);
      if (missing) return missing;
    }
    return sign * compareLeagueSeasonBy(left, right, sort) || compareOrdinal(left.id, right.id);
  });
}

function compareLeagueSeasonBy(left: LeagueSeasonRow, right: LeagueSeasonRow, sort: LeagueSeasonSortKey): number {
  switch (sort) {
    case 'name': return NAME_COLLATOR.compare(left.name, right.name);
    case 'leagueName': return NAME_COLLATOR.compare(left.leagueName, right.leagueName);
    case 'lastPlayed': return compareOrdinal(left.lastTournamentDate ?? '', right.lastTournamentDate ?? '');
    case 'updated': return compareNumbers(instantValue(left.updatedAt), instantValue(right.updatedAt));
    case 'tournaments': return compareNumbers(left.tournamentCount, right.tournamentCount);
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
 * Tab 1 of the Archive: the whole LeagueSeason catalog, joined to the League catalog, sorted,
 * filtered and paged in the browser. Every one of the six list controls navigates — the query string
 * is the only state — so reloading a URL reproduces the view exactly.
 */
@Component({
  selector: 'gones-league-season-list',
  standalone: true,
  imports: [FormsModule, RouterLink, ArchiveShellComponent, BackButtonComponent],
  template: `
    <gones-back-button data-cy="archive-seasons-back-top" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />

    <gones-archive-shell
      activeTab="league-seasons"
      [syncedAt]="syncedAt()"
      [loading]="loading()"
      [stale]="stale()"
      (sync)="sync()"
      data-cy="archive-seasons-shell"
    >
      <div class="archive-toolbar" data-cy="archive-seasons-toolbar">
        <div class="archive-field archive-field--grow" data-cy="archive-seasons-search-field">
          <label for="archive-seasons-search" data-cy="archive-seasons-search-label">{{ i18n.t('archive.searchLabel') }}</label>
          <input
            id="archive-seasons-search"
            type="search"
            data-cy="archive-seasons-search-input"
            [placeholder]="i18n.t('archive.searchPlaceholder')"
            [ngModel]="searchDraft()"
            (ngModelChange)="setSearchDraft($event)"
          />
          @if (searchDraft()) {
            <button type="button" class="archive-ghost-button" data-cy="archive-seasons-search-clear" (click)="clearSearch()">{{ i18n.t('common.clear') }}</button>
          }
        </div>
        <div class="archive-field" data-cy="archive-seasons-league-field">
          <label for="archive-seasons-league" data-cy="archive-seasons-league-label">{{ i18n.t('archive.leagueFilterLabel') }}</label>
          <select id="archive-seasons-league" data-cy="archive-seasons-league-select" [ngModel]="query().league" (ngModelChange)="setLeague($event)">
            <option [value]="allLeagues" data-cy="archive-seasons-league-option-all">{{ i18n.t('archive.leagueFilterAll') }}</option>
            @for (league of leagues(); track league.id) {
              <option [value]="league.id" [attr.data-cy]="'archive-seasons-league-option-' + league.id">{{ league.name }}</option>
            }
          </select>
        </div>
        <div class="archive-field" data-cy="archive-seasons-sort-field">
          <label for="archive-seasons-sort" data-cy="archive-seasons-sort-label">{{ i18n.t('archive.sortLabel') }}</label>
          <select id="archive-seasons-sort" data-cy="archive-seasons-sort-select" [ngModel]="query().sort" (ngModelChange)="setSort($event)">
            @for (key of sortKeys; track key) {
              <option [value]="key" [attr.data-cy]="'archive-seasons-sort-option-' + key">{{ sortLabel(key) }}</option>
            }
          </select>
          <button
            type="button"
            class="archive-ghost-button"
            data-cy="archive-seasons-direction-button"
            [attr.aria-label]="i18n.t('archive.directionToggleAria', { direction: i18n.t(query().dir === 'asc' ? 'archive.ascending' : 'archive.descending') })"
            (click)="toggleDirection()"
          >{{ query().dir === 'asc' ? '↑' : '↓' }}</button>
        </div>
        <div class="archive-field" data-cy="archive-seasons-size-field">
          <label for="archive-seasons-size" data-cy="archive-seasons-size-label">{{ i18n.t('archive.sizeLabel') }}</label>
          <!-- \`[value]\` does not populate SelectControlValueAccessor's option map (only \`[ngValue]\`
               does), so ngModelChange emits the DOM string and the \`+\` is load-bearing: without it a
               \`'25'\` would not equal the default and would be emitted into the URL. The cast is sound
               because the only options rendered are \`pageSizes\`, and parseLeagueSeasonQuery revalidates
               the value off the URL on the next navigation regardless. -->
          <select id="archive-seasons-size" data-cy="archive-seasons-size-select" [ngModel]="query().size" (ngModelChange)="setSize($any(+$event))">
            @for (size of pageSizes; track size) {
              <option [value]="size" [attr.data-cy]="'archive-seasons-size-option-' + size">{{ size }}</option>
            }
          </select>
        </div>
      </div>

      @if (error()) { <p class="error" role="alert" data-cy="archive-seasons-error">{{ error() }}</p> }
      @if (truncated()) { <p class="warning" role="status" data-cy="archive-seasons-truncated">{{ i18n.t('archive.truncatedSeasons', { shown: seasons().length }) }}</p> }
      @if (hasLocalRows()) { <p class="archive-local-notice" role="status" data-cy="archive-seasons-local-notice">{{ i18n.t('archive.localNotice') }}</p> }

      <div class="archive-status-line" data-cy="archive-seasons-status-line">
        <span aria-live="polite" data-cy="archive-seasons-page-status">{{ i18n.t('archive.pageStatus', { page: currentPage(), total: totalPages(), count: totalRows() }) }}</span>
      </div>

      <div class="table-wrap" data-cy="archive-seasons-table-wrap">
        <table class="ranking-table archive-table" [attr.aria-label]="i18n.t('archive.seasonsAria')" data-cy="archive-seasons-table">
          <thead data-cy="archive-seasons-thead">
            <tr data-cy="archive-seasons-header-row">
              <th scope="col" [attr.aria-sort]="ariaSort('seasonLeague')" data-cy="archive-seasons-col-season-league">
                <button type="button" class="archive-sort-button" data-cy="archive-seasons-sort-season-league" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('seasonLeague') })" (click)="sortByColumn('seasonLeague')">{{ i18n.t('archive.colSeasonLeague') }}</button>
              </th>
              <th scope="col" [attr.aria-sort]="ariaSort('datesUpdated')" data-cy="archive-seasons-col-dates">
                <button type="button" class="archive-sort-button" data-cy="archive-seasons-sort-dates" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('datesUpdated') })" (click)="sortByColumn('datesUpdated')">{{ i18n.t('archive.colLastPlayedUpdated') }}</button>
              </th>
              <th scope="col" class="archive-num" [attr.aria-sort]="ariaSort('counts')" data-cy="archive-seasons-col-counts">
                <button type="button" class="archive-sort-button" data-cy="archive-seasons-sort-counts" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('counts') })" (click)="sortByColumn('counts')">{{ i18n.t('archive.colTournamentsPlayers') }}</button>
              </th>
              <th scope="col" [attr.aria-sort]="ariaSort('status')" data-cy="archive-seasons-col-status">
                <button type="button" class="archive-sort-button" data-cy="archive-seasons-sort-status" [attr.aria-label]="i18n.t('archive.sortByAria', { column: columnLabel('status') })" (click)="sortByColumn('status')">{{ i18n.t('archive.colStatus') }}</button>
              </th>
            </tr>
          </thead>
          <tbody data-cy="archive-seasons-tbody">
            @if (loading()) {
              @for (index of skeletonRows; track index) {
                <tr [attr.data-cy]="'archive-seasons-skeleton-row-' + index">
                  <td [attr.data-cy]="'archive-seasons-skeleton-name-' + index"><span class="archive-skel archive-skel--wide" [attr.data-cy]="'archive-seasons-skeleton-name-bar-' + index" aria-hidden="true"></span><span class="archive-skel archive-skel--sub" [attr.data-cy]="'archive-seasons-skeleton-league-bar-' + index" aria-hidden="true"></span></td>
                  <td [attr.data-cy]="'archive-seasons-skeleton-dates-' + index"><span class="archive-skel" [attr.data-cy]="'archive-seasons-skeleton-dates-bar-' + index" aria-hidden="true"></span></td>
                  <td class="archive-num" [attr.data-cy]="'archive-seasons-skeleton-counts-' + index"><span class="archive-skel archive-skel--narrow" [attr.data-cy]="'archive-seasons-skeleton-counts-bar-' + index" aria-hidden="true"></span></td>
                  <td [attr.data-cy]="'archive-seasons-skeleton-status-' + index"><span class="archive-skel archive-skel--narrow" [attr.data-cy]="'archive-seasons-skeleton-status-bar-' + index" aria-hidden="true"></span></td>
                </tr>
              }
            } @else if (!pagedRows().length) {
              <tr data-cy="archive-seasons-empty-row">
                <td colspan="4" data-cy="archive-seasons-empty-cell">
                  <div class="archive-empty" data-cy="archive-seasons-empty">
                    <strong data-cy="archive-seasons-empty-title">{{ filtered() ? i18n.t('archive.emptySearchTitle', { search: filterLabel() }) : i18n.t('archive.emptyTitle') }}</strong>
                    <span data-cy="archive-seasons-empty-body">{{ filtered() ? i18n.t('archive.emptySearchBody') : i18n.t('archive.emptyBody') }}</span>
                  </div>
                </td>
              </tr>
            } @else {
              @for (row of pagedRows(); track row.id) {
                <!-- \`aria-expanded\` lives on the expander button, not here: on a \`role=row\` outside a
                     treegrid it is an attribute no assistive technology acts on, and axe-core's
                     \`aria-conditional-attr\` rule fails the page for it. The button carries the state
                     and \`aria-controls\`, which is how a reader learns both. -->
                <tr [attr.data-cy]="'archive-seasons-row-' + row.id" (click)="toggleSeasonExpansion(row)">
                  <td [attr.data-cy]="'archive-seasons-cell-name-' + row.id">
                    <span class="archive-two-line" [attr.data-cy]="'archive-seasons-name-stack-' + row.id">
                      <span class="archive-name-row" [attr.data-cy]="'archive-seasons-name-row-' + row.id">
                        <button type="button" class="archive-expand" [attr.aria-expanded]="isSeasonExpanded(row.id)" [attr.aria-controls]="seasonChildrenRowId(row.id)" [attr.aria-label]="expandLabel(row)" [attr.data-cy]="'archive-seasons-expand-' + row.id" (click)="$event.stopPropagation(); toggleSeasonExpansion(row)">▸</button>
                        <a class="archive-name-link" [routerLink]="['/archive/league-seasons', row.id]" [attr.aria-label]="i18n.t('archive.openSeasonAria', { name: row.name })" [attr.data-cy]="'archive-seasons-link-' + row.id" (click)="$event.stopPropagation()">{{ row.name }}</a>
                        @if (row.isLocal) {
                          <span class="archive-local-badge" [attr.title]="i18n.t('archive.localBadgeTitle')" [attr.data-cy]="'archive-seasons-local-badge-' + row.id">{{ i18n.t('archive.localBadge') }}</span>
                        }
                      </span>
                      <span class="archive-sub" [attr.data-cy]="'archive-seasons-league-' + row.id">{{ leagueLabel(row) }}</span>
                    </span>
                  </td>
                  <td [attr.data-cy]="'archive-seasons-cell-dates-' + row.id">
                    <span class="archive-two-line" [attr.data-cy]="'archive-seasons-dates-stack-' + row.id">
                      <span [attr.data-cy]="'archive-seasons-last-played-' + row.id">{{ formatDate(row.lastTournamentDate) }}</span>
                      <span class="archive-sub" [attr.data-cy]="'archive-seasons-updated-' + row.id">{{ i18n.t('archive.updatedPrefix', { date: formatDate(row.updatedAt) }) }}</span>
                    </span>
                  </td>
                  <td class="archive-num" [attr.data-cy]="'archive-seasons-cell-counts-' + row.id">
                    <span class="archive-two-line" [attr.data-cy]="'archive-seasons-counts-stack-' + row.id">
                      <span [attr.data-cy]="'archive-seasons-tournaments-' + row.id">{{ i18n.t('archive.tournamentsValue', { count: row.tournamentCount }) }}</span>
                      <span class="archive-sub" [attr.data-cy]="'archive-seasons-players-' + row.id">{{ i18n.t('archive.playersValue', { count: row.playerCount }) }}</span>
                    </span>
                  </td>
                  <td [attr.data-cy]="'archive-seasons-cell-status-' + row.id">
                    <span class="status" [class.completed]="row.status === 'completed'" [attr.data-cy]="'archive-seasons-status-' + row.id"><span class="status-dot" aria-hidden="true" [attr.data-cy]="'archive-seasons-status-dot-' + row.id"></span>{{ statusLabel(row) }}</span>
                    @if (row.locked) {
                      <span class="archive-lock" role="img" [attr.aria-label]="i18n.t('archive.lockedAria')" [attr.title]="i18n.t('archive.lockedTitle')" [attr.data-cy]="'archive-seasons-lock-' + row.id">🔒</span>
                    }
                  </td>
                </tr>
                <tr class="archive-children" [id]="seasonChildrenRowId(row.id)" [hidden]="!isSeasonExpanded(row.id)" [attr.data-cy]="'archive-seasons-children-' + row.id">
                  <td [attr.colspan]="4" [attr.data-cy]="'archive-seasons-children-cell-' + row.id">
                    <div class="archive-child-list" [attr.data-cy]="'archive-seasons-child-list-' + row.id">
                      @if (expansion().status === 'loading') {
                        <span class="archive-child-placeholder" [attr.data-cy]="'archive-seasons-child-loading-' + row.id">{{ i18n.t('archiveSeason.fetching') }}</span>
                      } @else if (expansion().status === 'failed') {
                        <span class="archive-child-placeholder" [attr.data-cy]="'archive-seasons-child-failed-' + row.id">{{ i18n.t('archiveSeason.loadFailed') }}</span>
                      } @else {
                        @for (child of expandedChildren(); track child.id) {
                          <a class="archive-child-line" [routerLink]="['/archive/tournaments', child.id]" [attr.data-cy]="'archive-seasons-child-' + child.id" (click)="$event.stopPropagation()">
                            <b [attr.data-cy]="'archive-seasons-child-name-' + child.id">{{ child.name }}</b>@if (child.isLocal) {
                              <span class="archive-local-badge" [attr.title]="i18n.t('archive.localBadgeTitle')" [attr.data-cy]="'archive-seasons-child-local-' + child.id">{{ i18n.t('archive.localBadge') }}</span>
                            }<span class="archive-child-separator" aria-hidden="true" [attr.data-cy]="'archive-seasons-child-separator-' + child.id">·</span><span class="archive-child-meta" [attr.data-cy]="'archive-seasons-child-meta-' + child.id">{{ childLine(child) }}</span>
                          </a>
                        } @empty {
                          <span class="archive-child-placeholder" [attr.data-cy]="'archive-seasons-child-empty-' + row.id">{{ i18n.t('archiveSeason.noTournaments') }}</span>
                        }
                        @if (hasMoreChildren()) {
                          <a class="archive-child-line" [routerLink]="['/archive/league-seasons', row.id]" [attr.data-cy]="'archive-seasons-child-more-' + row.id" (click)="$event.stopPropagation()"><b [attr.data-cy]="'archive-seasons-child-more-label-' + row.id">{{ i18n.t('archiveSeason.showAll', { count: expandedTotal() }) }}</b></a>
                        }
                      }
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <nav class="archive-pager" [attr.aria-label]="i18n.t('archive.paginationAria')" data-cy="archive-seasons-pagination">
        <button type="button" data-cy="archive-seasons-page-previous" [disabled]="currentPage() <= 1" (click)="goPage(currentPage() - 1)">{{ i18n.t('common.previous') }}</button>
        <span data-cy="archive-seasons-page-indicator">{{ i18n.t('archive.pageIndicator', { page: currentPage(), total: totalPages() }) }}</span>
        <button type="button" data-cy="archive-seasons-page-next" [disabled]="currentPage() >= totalPages()" (click)="goPage(currentPage() + 1)">{{ i18n.t('common.next') }}</button>
      </nav>
    </gones-archive-shell>

    <gones-back-button data-cy="archive-seasons-back-bottom" [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
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
    .archive-status-line { margin: 0 0 .5rem; color: var(--dim-ash); font-size: .85rem; font-weight: 800; }
    /* The global rule pins \`.ranking-table\` to a 680px floor; two class selectors outrank it without
       \`!important\`. Clearing it only lets the table shrink to its content — it does not on its own
       stop the internal scroll: measured at 375px the table was still 678px wide with the floor gone,
       because the cells were still \`nowrap\` (see the two rules below). The prototype accepts a table
       that scrolls inside \`.table-wrap\`'s \`overflow-x: auto\`; what must not scroll is the page. */
    .ranking-table.archive-table { width: 100%; min-width: 0; border-collapse: collapse; font-size: .88rem; }
    /* The global \`.ranking-table th, td\` rule is \`nowrap\`, which is the other half of the 680px
       floor. The status cell is the one that still could not shrink: its chip plus the lock marker
       were pinned to one line. The cell wraps; the chip's own label does not. */
    .archive-table th, .archive-table td { padding: .55rem .7rem; border-bottom: 1px solid var(--soot); text-align: left; vertical-align: middle; white-space: normal; }
    .archive-table .status { white-space: nowrap; }
    /* The paired headers wrap. Clearing the 680px floor is necessary but not sufficient: with the
       global \`.ranking-table th\` \`nowrap\` still in force the four header labels alone measure 589px,
       so the table could not shrink below 678px and still scrolled at 375px. Their min-content is the
       longest single word once they may wrap, which is what actually fits the phone. */
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
    .archive-name-row { display: flex; align-items: baseline; gap: .1rem; }
    .archive-expand { min-height: 0; padding: 0 .35rem 0 0; border: 0; background: transparent; color: var(--steel); font: inherit; cursor: pointer; }
    .archive-expand:hover { color: var(--ash); }
    .archive-expand:focus-visible { outline: 2px solid var(--hot-blood); outline-offset: 2px; }
    .archive-expand[aria-expanded="true"] { color: var(--hot-blood); }
    .archive-children > td { padding: 0; border-bottom: 1px solid var(--soot); background: var(--black-metal); }
    .archive-child-list { padding: .35rem .7rem .5rem 2.1rem; }
    .archive-child-line { display: block; margin: .1rem 0; padding: .36rem .5rem .36rem .75rem; border-left: 2px solid var(--rust-plate); font-size: .85rem; text-decoration: none; }
    .archive-child-line:hover, .archive-child-line:focus-visible { border-left-color: var(--hot-blood); background: color-mix(in oklch, var(--blood) 14%, transparent); }
    .archive-child-meta { color: var(--dim-ash); }
    .archive-child-separator { margin: 0 .45rem; color: var(--soot); }
    .archive-child-placeholder { display: block; padding: .36rem .5rem .36rem .75rem; border-left: 2px solid var(--rust-plate); color: var(--steel); font-size: .85rem; font-style: italic; }
    .archive-sub { color: var(--steel); font-size: .78rem; }
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
export class LeagueSeasonListComponent implements OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly repo = inject(ArchiveRepository);
  private readonly seasonSource = inject(ARCHIVE_SEASON_SOURCE);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  /** The one expanded Season, or `null`. One at a time: an expansion may issue a read-through
   *  request, and holding several in flight multiplies exactly the cost §8.1 exists to avoid. */
  readonly expandedSeasonId = signal<string | null>(null);
  readonly expansion = signal<SeasonExpansionState>({ status: 'loading' });

  readonly loading = signal(true);
  readonly error = signal('');
  readonly stale = signal(false);
  readonly truncated = signal(false);
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly seasons = signal<ArchiveLeagueSeasonRow[]>([]);
  readonly leagues = signal<ArchiveLeagueRow[]>([]);
  readonly searchDraft = signal('');
  private readonly routeParams = signal<{ get(key: string): string | null } | null>(null);

  readonly allLeagues = ALL_LEAGUES;
  readonly pageSizes = LEAGUE_SEASON_PAGE_SIZES;
  readonly sortKeys = LEAGUE_SEASON_SORT_KEYS;
  /** Five skeleton rows, the same height as five real ones, so the table does not jump on load. */
  readonly skeletonRows = [0, 1, 2, 3, 4] as const;

  readonly leagueIds: Signal<ReadonlySet<string>>;
  readonly query: Signal<LeagueSeasonQuery>;
  readonly rows: Signal<LeagueSeasonRow[]>;
  readonly filteredRows: Signal<LeagueSeasonRow[]>;
  readonly sortedRows: Signal<LeagueSeasonRow[]>;
  readonly totalRows: Signal<number>;
  readonly totalPages: Signal<number>;
  /** The URL's page clamped into range. The URL is NOT rewritten: a clamp that navigated would loop. */
  readonly currentPage: Signal<number>;
  readonly pagedRows: Signal<LeagueSeasonRow[]>;
  /** True when at least one filter is active, which selects the "nothing matched" empty message. */
  readonly filtered: Signal<boolean>;
  /** At least one row of this list lives in this browser — the ADR 0028 notice is rendered only then. */
  readonly hasLocalRows: Signal<boolean>;
  /** What the "nothing matched" message quotes: the search term, or the filtered League's name. */
  readonly filterLabel: Signal<string>;

  constructor() {
    this.leagueIds = computed(() => new Set(this.leagues().map((league) => league.id)));
    this.query = computed(() => {
      const params = this.routeParams();
      return params ? parseLeagueSeasonQuery(params, this.leagueIds()) : DEFAULT_LEAGUE_SEASON_QUERY;
    });
    this.rows = computed(() => buildLeagueSeasonRows(this.seasons(), this.leagues()));
    this.filteredRows = computed(() => filterLeagueSeasonRows(this.rows(), this.query()));
    this.sortedRows = computed(() => sortLeagueSeasonRows(this.filteredRows(), this.query().sort, this.query().dir));
    this.totalRows = computed(() => this.filteredRows().length);
    this.totalPages = computed(() => Math.max(1, Math.ceil(this.totalRows() / this.query().size)));
    this.currentPage = computed(() => Math.min(Math.max(this.query().page, 1), this.totalPages()));
    this.pagedRows = computed(() => {
      const start = (this.currentPage() - 1) * this.query().size;
      return this.sortedRows().slice(start, start + this.query().size);
    });
    this.hasLocalRows = computed(() => this.rows().some((row) => row.isLocal));
    this.filtered = computed(() => this.query().search !== '' || this.query().league !== ALL_LEAGUES);
    this.filterLabel = computed(() =>
      this.query().search || this.leagues().find((league) => league.id === this.query().league)?.name || '');

    this.route.queryParamMap.subscribe((params) => {
      this.routeParams.set(params);
      // The draft mirrors the URL on every navigation, including Back, so the input never disagrees
      // with the list it filters.
      this.searchDraft.set((params.get('search') ?? '').trim());
    });
    void this.load();
  }

  ngOnDestroy(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
  }

  /** Reads both catalogs. `force` bypasses the 24h TTL. Never throws. */
  async load(options: { force?: boolean } = {}): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    const [seasons, leagues] = await Promise.allSettled([
      this.repo.listLeagueSeasons(options),
      this.repo.listLeagues(options)
    ]);
    if (seasons.status === 'rejected') {
      logBoundaryError('archive-league-season-list.load', seasons.reason);
      this.error.set(this.i18n.t('archive.loadFailed'));
      this.loading.set(false);
      return;
    }
    this.seasons.set(seasons.value.items);
    this.syncedAt.set(seasons.value.fetchedAt);
    this.truncated.set(seasons.value.truncated);
    // A failed League catalog is survivable: every Season still renders, with its League name blank
    // and the "Unknown League" label in its place. A failed Season catalog is not.
    if (leagues.status === 'fulfilled') this.leagues.set(leagues.value.items);
    else logBoundaryError('archive-league-season-list.load-leagues', leagues.reason);
    this.stale.set(seasons.value.stale || leagues.status !== 'fulfilled' || leagues.value.stale);
    this.loading.set(false);
  }

  sync(): void { void this.load({ force: true }); }

  private navigate(query: LeagueSeasonQuery): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: leagueSeasonQueryParams(query) });
  }

  /** Clicking a paired header selects its FIRST value; clicking the active key flips the direction. */
  sortByColumn(column: LeagueSeasonColumn): void {
    this.navigate(toggleLeagueSeasonSort(this.query(), LEAGUE_SEASON_COLUMN_PRIMARY[column]));
  }

  ariaSort(column: LeagueSeasonColumn): 'ascending' | 'descending' | null {
    if (!LEAGUE_SEASON_COLUMN_KEYS[column].includes(this.query().sort)) return null;
    return this.query().dir === 'asc' ? 'ascending' : 'descending';
  }

  setSort(key: LeagueSeasonSortKey): void {
    // Choosing a key from the select never flips the direction: it is a column picker, and the
    // direction has its own control beside it.
    this.navigate({ ...this.query(), sort: key, page: 1 });
  }

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
  setLeague(leagueId: string): void { this.navigate({ ...this.query(), league: leagueId, page: 1 }); }
  setSize(size: LeagueSeasonPageSize): void { this.navigate({ ...this.query(), size, page: 1 }); }
  goPage(page: number): void { this.navigate({ ...this.query(), page }); }

  /** `null` renders the em dash; a `YYYY-MM-DD` or an instant renders in the active locale. */
  formatDate(value: string | null): string { return value ? this.i18n.formatDate(value) : '—'; }
  leagueLabel(row: LeagueSeasonRow): string { return row.leagueName || this.i18n.t('archive.unknownLeague'); }
  statusLabel(row: LeagueSeasonRow): string {
    return this.i18n.t(row.status === 'completed' ? 'common.completed' : 'common.active');
  }

  isSeasonExpanded(seasonId: string): boolean { return this.expandedSeasonId() === seasonId; }
  seasonChildrenRowId(seasonId: string): string { return `archive-season-children-${seasonId}`; }

  expandLabel(row: LeagueSeasonRow): string {
    return this.i18n.t(this.isSeasonExpanded(row.id) ? 'archiveSeason.collapseAria' : 'archiveSeason.expandAria', { name: row.name });
  }

  expandedChildren(): readonly ArchiveTournamentRow[] {
    const state = this.expansion();
    return state.status === 'ready' ? state.items.slice(0, SEASON_EXPANSION_PREVIEW_LIMIT) : [];
  }

  hasMoreChildren(): boolean {
    const state = this.expansion();
    return state.status === 'ready' && state.items.length > SEASON_EXPANSION_PREVIEW_LIMIT;
  }

  expandedTotal(): number {
    const state = this.expansion();
    return state.status === 'ready' ? state.items.length : 0;
  }

  /** One Season open at a time: an expansion may issue a read-through request. */
  async toggleSeasonExpansion(row: LeagueSeasonRow): Promise<void> {
    if (this.isSeasonExpanded(row.id)) { this.expandedSeasonId.set(null); return; }
    this.expandedSeasonId.set(row.id);
    this.expansion.set({ status: 'loading' });
    try {
      const read = await readSeasonTournaments(row, this.seasonSource);
      if (this.expandedSeasonId() !== row.id) return;   // a faster click won
      this.expansion.set({ status: 'ready', origin: read.origin, items: read.items });
    } catch (error) {
      logBoundaryError('archive-season-expansion.load', error, { seasonId: row.id });
      if (this.expandedSeasonId() === row.id) this.expansion.set({ status: 'failed' });
    }
  }

  /** The compact one-line child, identical in shape to the Season page's list. */
  childLine(row: ArchiveTournamentRow): string {
    return this.i18n.t('archiveSeason.childLine', {
      date: this.i18n.formatDate(row.tournamentDate),
      players: this.i18n.plural(row.playerCount, 'archiveSeason.playerCount', 'archiveSeason.playerCountPlural'),
      status: this.i18n.t(row.status === 'completed' ? 'archive.tournamentCompleted' : 'archive.tournamentActive')
    });
  }

  sortLabel(key: LeagueSeasonSortKey): string { return this.i18n.t(LEAGUE_SEASON_SORT_LABEL_KEYS[key]); }
  columnLabel(column: LeagueSeasonColumn): string { return this.i18n.t(LEAGUE_SEASON_COLUMN_LABEL_KEYS[column]); }
}
