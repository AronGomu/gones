import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../../i18n/i18n.service';
import { AuthService } from '../../auth/auth.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { OfflineBannerComponent } from '../../shared/offline-banner.component';
import {
  CalendarQuery,
  CalendarView,
  PublicTournamentView,
  VenueDateGroup,
  buildCalendarQueryParams,
  groupTournamentsByVenueDate,
  readCalendarQuery,
  shiftMonth,
  statusPresentation,
  tournamentDatePresentation
} from './public-calendar';
import { AllTournamentsCacheService } from './all-tournaments-cache.service';
import { PublicTournamentService } from './public-tournament.service';
import { filterTournaments } from './tournament-fuzzy-search';

interface MonthDay {
  date: string;
  day: number;
  inMonth: boolean;
}

const VIEW_KEY = 'gones.calendar-v1.view';
const SEARCH_DEBOUNCE_MS = 300;

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, BackButtonComponent, OfflineBannerComponent],
  template: `
    <div class="calendar-top-actions" data-cy="calendar-top-actions">
      <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="calendar-back-top" />
      <div class="calendar-sync-group" data-cy="calendar-sync-group">
        @if (syncedAt(); as instant) { <span class="muted calendar-synced-at" data-cy="calendar-synced-at">{{ i18n.t('calendar.syncedAt', { instant: i18n.formatDateTime(instant) }) }}</span> }
        <button mat-stroked-button type="button" class="secondary-action calendar-sync-button" data-cy="calendar-sync" [disabled]="loading()" (click)="sync()" [attr.aria-label]="i18n.t('calendar.synchroniseAria')">
          <svg class="calendar-sync-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.9-3" /><path d="M4 5v5h5" /><path d="M4 13a8 8 0 0 0 14.9 3" /><path d="M20 19v-5h-5" /></svg>
          <span data-cy="calendar-sync-label">{{ i18n.t('calendar.synchronise') }}</span>
        </button>
      </div>
    </div>
    <section class="info-page public-calendar-page" aria-labelledby="public-calendar-title" data-cy="public-calendar">
      <header class="section-header" data-cy="calendar-header">
        <div data-cy="calendar-header-text"><h1 id="public-calendar-title" data-cy="calendar-title">{{ i18n.t('calendar.publicTitle') }}</h1></div>
        <div class="calendar-header-actions" data-cy="calendar-header-actions">
          @if (canCreateTournament()) {
            <a mat-flat-button class="home-primary-action" routerLink="/tournaments/new" data-cy="calendar-create-tournament">{{ i18n.t('calendar.createTournament') }}</a>
          }
        </div>
      </header>

      <form class="calendar-search-row" data-cy="calendar-search-row" (ngSubmit)="$event.preventDefault()">
        <input id="calendar-search" name="q" type="search" class="calendar-search-input" data-cy="calendar-search"
               [attr.aria-label]="i18n.t('common.search')"
               [attr.placeholder]="i18n.t('calendar.searchPlaceholder')"
               [ngModel]="searchDraft()" (ngModelChange)="setSearchDraft($event)">
      </form>

      <div class="calendar-view-tabs" role="group" [attr.aria-label]="i18n.t('calendar.viewAria')" data-cy="calendar-view-tabs">
        <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'calendar'" data-cy="calendar-view" (click)="setView('calendar')">{{ i18n.t('calendar.tabCalendar') }}</button>
        <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'list'" data-cy="list-view" (click)="setView('list')">{{ i18n.t('calendar.listView') }}</button>
      </div>

      <gones-offline-banner [stale]="stale()" [cachedAt]="syncedAt()" data-cy="calendar-offline-banner" />
      @if (error()) {
        <section class="panel calendar-state" role="alert" data-cy="calendar-error"><h2 data-cy="calendar-error-title">{{ i18n.t('calendar.loadFailed') }}</h2><button mat-stroked-button type="button" data-cy="calendar-retry" (click)="reload()">{{ i18n.t('common.retry') }}</button></section>
      } @else if (loading()) {
        <section class="calendar-skeleton" aria-busy="true" aria-live="polite" data-cy="calendar-loading"><span class="sr-only" data-cy="calendar-loading-label">{{ i18n.t('common.loading') }}</span>@for (_ of skeletons; track $index) { <div data-cy="calendar-skeleton-item"></div> }</section>
      } @else {
        @if (truncated()) { <p class="warning" role="status" data-cy="calendar-truncated">{{ i18n.t('calendar.truncatedWarning', { count: allItems().length }) }}</p> }
        @if (query().view === 'calendar') {
          <nav class="calendar-month-controls" [attr.aria-label]="i18n.t('calendar.navAria')" data-cy="calendar-month-controls">
            <button mat-stroked-button type="button" data-cy="calendar-month-prev" (click)="moveMonth(-1)">{{ i18n.t('common.previous') }}</button><h2 data-cy="calendar-month-label">{{ monthLabel() }}</h2><button mat-stroked-button type="button" data-cy="calendar-month-next" (click)="moveMonth(1)">{{ i18n.t('common.next') }}</button>
          </nav>
          <section class="public-month-grid" role="grid" [attr.aria-label]="i18n.t('calendar.monthAria')" data-cy="public-month-grid">
            <div class="public-month-row public-month-row--head" role="row" data-cy="calendar-month-row-head">
              @for (weekday of weekdays; track weekday) { <div class="classic-calendar__weekday" role="columnheader" data-cy="calendar-weekday">{{ weekday }}</div> }
            </div>
            @for (week of monthWeeks(); track week[0].date) {
              <div class="public-month-row" role="row" data-cy="calendar-month-row">
                @for (day of week; track day.date) {
                  <article class="public-month-day" role="gridcell" [class.public-month-day--muted]="!day.inMonth" data-cy="calendar-month-day">
                    <time [attr.datetime]="day.date" data-cy="calendar-month-day-date">{{ day.day }}</time>
                  </article>
                }
              </div>
            }
          </section>
          @if (!items().length) { <ng-container *ngTemplateOutlet="emptyState" /> }
        } @else {
          @if (groups().length) {
            <section class="public-calendar-list" data-cy="calendar-list">
              @for (group of groups(); track group.date) {
                <section class="venue-date-group" [attr.data-venue-date]="group.date" [attr.data-cy]="'calendar-venue-date-' + group.date"><h2 data-cy="calendar-venue-date-label">{{ formatGroupDate(group) }}</h2>
                  @for (item of group.items; track item.id) { <ng-container *ngTemplateOutlet="tournamentCard; context: { $implicit: item }" /> }
                </section>
              }
            </section>
          } @else { <ng-container *ngTemplateOutlet="emptyState" /> }
        }
      }

      <ng-template #emptyState><section class="panel calendar-state" data-cy="calendar-empty"><h2 data-cy="calendar-empty-title">{{ i18n.t('calendar.emptyTitle') }}</h2><p data-cy="calendar-empty-body">{{ i18n.t('calendar.emptyBody') }}</p></section></ng-template>
      <ng-template #tournamentCard let-item><article class="panel public-tournament-card" [attr.data-cy]="'tournament-' + item.slug">
        <div data-cy="calendar-card-body"><span class="calendar-status" [class]="'calendar-status calendar-status--' + status(item).className" data-cy="calendar-card-status">{{ status(item).label }}</span><h3 data-cy="calendar-card-title"><a [routerLink]="['/calendar/tournaments', item.slug]" data-cy="calendar-card-link">{{ item.title }}</a></h3><p data-cy="calendar-card-date">{{ date(item).primary }}</p>@if (date(item).secondary; as secondary) { <p class="viewer-date" data-cy="calendar-card-viewer-date">{{ i18n.t('calendar.viewerTime') }}: {{ secondary }}</p> }<p data-cy="calendar-card-venue">{{ venue(item) }}</p>@if (item.summary) { <p class="muted" data-cy="calendar-card-summary">{{ item.summary }}</p> }</div>
        <div class="calendar-event__actions" data-cy="calendar-card-actions"><a mat-stroked-button [routerLink]="['/calendar/tournaments', item.slug]" data-cy="calendar-card-view">{{ i18n.t('calendar.viewPage') }}</a><a mat-stroked-button [href]="service.icsUrl(item.slug)" download data-cy="calendar-card-ics">{{ i18n.t('calendar.addToCalendar') }}</a></div>
      </article></ng-template>
    </section>
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" data-cy="calendar-back-bottom" />
  `
})
export class PublicCalendarComponent implements OnInit, OnDestroy {
  readonly i18n = inject(I18nService);
  readonly service = inject(PublicTournamentService);
  readonly auth = inject(AuthService);
  private readonly catalog = inject(AllTournamentsCacheService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private subscription?: Subscription;
  private searchDebounce?: ReturnType<typeof setTimeout>;
  private loadId = 0;

  readonly skeletons = Array.from({ length: 6 });
  readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly query = signal<CalendarQuery>(readCalendarQuery(this.route.snapshot.queryParamMap, this.preferredView()));
  readonly searchDraft = signal<string>(this.query().q);
  readonly allItems = signal<PublicTournamentView[]>([]);
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly truncated = signal(false);
  readonly loading = signal(true);
  readonly stale = signal(false);
  readonly error = signal(false);
  readonly items = computed(() => filterTournaments(this.allItems(), this.searchDraft()));
  readonly groups = computed(() => groupTournamentsByVenueDate(this.items()));
  readonly monthLabel = computed(() => this.i18n.formatDate(`${this.query().month}-01`, { month: 'long', year: 'numeric' }));
  readonly monthDays = computed(() => buildMonthDays(this.query().month));
  // ARIA requires grid > row > gridcell; the rows use `display: contents` so the CSS grid is unchanged.
  readonly monthWeeks = computed(() => chunkIntoWeeks(this.monthDays()));
  readonly canCreateTournament = computed(() => this.auth.enabled && this.auth.profile()?.emailVerified === true);

  ngOnInit(): void {
    this.subscription = this.route.queryParamMap.subscribe(params => {
      const query = readCalendarQuery(params, this.preferredView());
      if (params.get('month') !== query.month || params.get('view') !== query.view) {
        void this.router.navigate([], { relativeTo: this.route, queryParams: buildCalendarQueryParams(query), replaceUrl: true });
        return;
      }
      this.query.set(query);
      this.searchDraft.set(query.q);
    });
    void this.load();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  setSearchDraft(value: string): void {
    this.searchDraft.set(value);
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { void this.navigate({ ...this.query(), q: this.searchDraft() }); }, SEARCH_DEBOUNCE_MS);
  }

  sync(): void { void this.load({ force: true }); }
  moveMonth(amount: number): void { void this.navigate({ ...this.query(), month: shiftMonth(this.query().month, amount) }); }
  setView(view: CalendarView): void {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* Preference is optional. */ }
    void this.navigate({ ...this.query(), view });
  }
  reload(): void { void this.load(); }
  status(item: PublicTournamentView) { return statusPresentation(item.status); }
  date(item: PublicTournamentView) { return tournamentDatePresentation(item, this.i18n.locale()); }
  venue(item: PublicTournamentView): string { return [item.venue.streetAddress, item.venue.postalCode, item.venue.city, item.venue.country].filter(Boolean).join(', '); }
  formatGroupDate(group: VenueDateGroup): string { return this.i18n.formatDate(group.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }

  private async load(options: { force?: boolean } = {}): Promise<void> {
    const id = ++this.loadId;
    this.loading.set(true);
    this.error.set(false);
    try {
      const result = await this.catalog.load(options);
      if (id !== this.loadId) return;
      this.allItems.set(result.items);
      this.syncedAt.set(result.fetchedAt);
      this.stale.set(result.stale);
      this.truncated.set(result.truncated);
    } catch {
      if (id === this.loadId) { this.error.set(true); this.stale.set(false); this.syncedAt.set(undefined); }
    } finally {
      if (id === this.loadId) this.loading.set(false);
    }
  }

  private navigate(query: CalendarQuery): Promise<boolean> { return this.router.navigate([], { relativeTo: this.route, queryParams: buildCalendarQueryParams(query) }); }
  private preferredView(): CalendarView {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'calendar'; } catch { return 'calendar'; }
  }
}

/** Splits the flat 42-cell month into the seven-day rows ARIA's grid pattern requires. */
function chunkIntoWeeks(days: MonthDay[]): MonthDay[][] {
  const weeks: MonthDay[][] = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));
  return weeks;
}

function buildMonthDays(month: string): MonthDay[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const start = new Date(year, monthNumber - 1, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { date: dateValue, day: date.getDate(), inMonth: date.getMonth() === monthNumber - 1 };
  });
}
