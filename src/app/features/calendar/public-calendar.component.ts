import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
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
  calendarPageCount,
  clampCalendarPage,
  groupTournamentsByVenueDate,
  isPastCalendarDay,
  paginateTournaments,
  readCalendarQuery,
  shiftMonth,
  sortTournamentsForList,
  statusPresentation,
  tournamentCardDatePresentation,
  tournamentDatePresentation,
  tournamentsByDate,
  MAX_DAY_CELL_EVENTS
} from './public-calendar';
import { AllTournamentsCacheService } from './all-tournaments-cache.service';
import { PublicTournamentService } from './public-tournament.service';
import { filterTournaments } from './tournament-fuzzy-search';
import { HighlightPart, highlightSearchText } from '../../shared/search-highlight';

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
        @if (canCreateTournament()) {
          <a mat-flat-button class="create-action-button calendar-create-tournament" routerLink="/tournaments/new" data-cy="calendar-create-tournament">{{ i18n.t('calendar.createTournament') }}</a>
        }
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
          <section #monthGrid class="public-month-grid" role="grid" [style.min-height.px]="gridMinHeight()" [attr.aria-label]="i18n.t('calendar.monthAria')" data-cy="public-month-grid">
            <div class="public-month-row public-month-row--head" role="row" data-cy="calendar-month-row-head">
              @for (weekday of weekdays; track weekday) { <div class="classic-calendar__weekday" role="columnheader" data-cy="calendar-weekday">{{ weekday }}</div> }
            </div>
            @for (week of monthWeeks(); track week[0].date) {
              <div class="public-month-row" role="row" data-cy="calendar-month-row">
                @for (day of week; track day.date) {
                  <article class="public-month-day" role="gridcell" [class.public-month-day--muted]="!day.inMonth" [class.public-month-day--past]="isPast(day.date)" [attr.data-cy]="isPast(day.date) ? 'calendar-month-day-past' : 'calendar-month-day'">
                    <time [attr.datetime]="day.date" data-cy="calendar-month-day-date">{{ day.day }}</time>
                    @for (event of visibleDayEvents(day.date); track event.id) {
                      <a class="public-month-event" [routerLink]="['/calendar/tournaments', event.slug]" [attr.data-cy]="'calendar-month-day-event-' + event.slug" [attr.title]="event.title">
                        <span class="public-month-event__time" data-cy="calendar-month-day-event-time">{{ event.venueStartTime.slice(0, 5) }}</span>
                        <span class="public-month-event__title" data-cy="calendar-month-day-event-title">@for (part of highlightParts(event.title); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'calendar-month-day-event-title-part-' + event.slug + '-' + $index">{{ part.text }}</span> }</span>
                      </a>
                    }
                    @if (hiddenDayEventCount(day.date); as hidden) {
                      <span class="public-month-more" data-cy="calendar-month-day-more">{{ i18n.t('calendar.moreEvents', { count: hidden }) }}</span>
                    }
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
            @if (pageCount() > 1) {
              <nav class="calendar-pagination" [attr.aria-label]="i18n.t('calendar.paginationAria')" data-cy="calendar-pagination">
                <button mat-stroked-button type="button" data-cy="calendar-page-prev" [disabled]="currentPage() <= 1" (click)="movePage(-1)">{{ i18n.t('common.previous') }}</button>
                <span class="muted" role="status" aria-live="polite" data-cy="calendar-page-status">{{ i18n.t('calendar.pageStatus', { page: currentPage(), total: pageCount() }) }}</span>
                <button mat-stroked-button type="button" data-cy="calendar-page-next" [disabled]="currentPage() >= pageCount()" (click)="movePage(1)">{{ i18n.t('common.next') }}</button>
              </nav>
            }
          } @else { <ng-container *ngTemplateOutlet="emptyState" /> }
        }
      }

      <ng-template #emptyState><section class="panel calendar-state" data-cy="calendar-empty"><h2 data-cy="calendar-empty-title">{{ i18n.t('calendar.emptyTitle') }}</h2><p data-cy="calendar-empty-body">{{ i18n.t('calendar.emptyBody') }}</p></section></ng-template>
      <ng-template #tournamentCard let-item><article class="panel public-tournament-card" role="link" tabindex="0" [attr.aria-label]="item.title" [attr.data-cy]="'tournament-' + item.slug" (click)="openTournament(item)" (keydown.enter)="openTournament(item)" (keydown.space)="openTournament(item, $event)">
        <div data-cy="calendar-card-body"><span class="calendar-status" [class]="'calendar-status calendar-status--' + status(item).className" data-cy="calendar-card-status">{{ status(item).label }}</span><h3 data-cy="calendar-card-title"><a [routerLink]="['/calendar/tournaments', item.slug]" data-cy="calendar-card-link" (click)="$event.stopPropagation()">@for (part of highlightParts(item.title); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'calendar-card-title-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</a></h3><p data-cy="calendar-card-date">@for (part of highlightParts(cardDate(item)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'calendar-card-date-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</p>@if (date(item).secondary; as secondary) { <p class="viewer-date" data-cy="calendar-card-viewer-date">{{ i18n.t('calendar.viewerTime') }}: {{ secondary }}</p> }<p data-cy="calendar-card-venue">@for (part of highlightParts(venue(item)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'calendar-card-venue-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</p>@if (item.summary) { <p class="muted" data-cy="calendar-card-summary">@for (part of highlightParts(item.summary); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'calendar-card-summary-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</p> }</div>
        <div class="calendar-event__actions" data-cy="calendar-card-actions"><a mat-stroked-button [href]="service.icsUrl(item.slug)" download data-cy="calendar-card-ics" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()">{{ i18n.t('calendar.addToCalendar') }}</a></div>
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
  @ViewChild('monthGrid') private monthGrid?: ElementRef<HTMLElement>;

  readonly skeletons = Array.from({ length: 6 });
  readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly today = signal(localDateValue(new Date()));
  readonly query = signal<CalendarQuery>(readCalendarQuery(this.route.snapshot.queryParamMap, this.preferredView()));
  readonly searchDraft = signal<string>(this.query().q);
  readonly allItems = signal<PublicTournamentView[]>([]);
  readonly syncedAt = signal<string | undefined>(undefined);
  // Pins the grid height for the duration of a month change so the document cannot shrink under the
  // scroll position that is about to be restored.
  readonly gridMinHeight = signal<number | null>(null);
  readonly truncated = signal(false);
  readonly loading = signal(true);
  readonly stale = signal(false);
  readonly error = signal(false);
  readonly items = computed(() => filterTournaments(this.allItems(), this.searchDraft()));
  readonly sortedItems = computed(() => sortTournamentsForList(this.items()));
  readonly pageCount = computed(() => calendarPageCount(this.sortedItems().length));
  readonly currentPage = computed(() => clampCalendarPage(this.query().page, this.sortedItems().length));
  readonly pagedItems = computed(() => paginateTournaments(this.sortedItems(), this.query().page));
  readonly groups = computed(() => groupTournamentsByVenueDate(this.pagedItems()));
  readonly monthLabel = computed(() => this.i18n.formatDate(`${this.query().month}-01`, { month: 'long', year: 'numeric' }));
  readonly monthDays = computed(() => buildMonthDays(this.query().month));
  // ARIA requires grid > row > gridcell; the rows use `display: contents` so the CSS grid is unchanged.
  readonly monthWeeks = computed(() => chunkIntoWeeks(this.monthDays()));
  readonly eventsByDate = computed(() => tournamentsByDate(this.items()));
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
    this.searchDebounce = setTimeout(() => { void this.navigate({ ...this.query(), q: this.searchDraft(), page: 1 }); }, SEARCH_DEBOUNCE_MS);
  }

  sync(): void { void this.load({ force: true }); }
  /**
   * Month navigation is a query-param navigation on the same route, so the router's
   * `scrollPositionRestoration: 'enabled'` treats it as a fresh page and scrolls back to the top —
   * the grid re-renders in place, which is why nothing about the handler looked wrong. `scroll:
   * 'manual'` opts this one navigation out of that restoration — the router schedules its own scroll
   * a few hundred milliseconds after the navigation resolves and would undo any restore — and the
   * position is captured before navigating, then re-applied once the new grid is laid out.
   */
  async moveMonth(amount: number): Promise<void> {
    const top = window.scrollY;
    this.gridMinHeight.set(this.monthGrid?.nativeElement.offsetHeight ?? null);
    await this.navigate({ ...this.query(), month: shiftMonth(this.query().month, amount), page: 1 }, { scroll: 'manual' });
    requestAnimationFrame(() => {
      if (top > 0) window.scrollTo({ top });
      this.gridMinHeight.set(null);
    });
  }
  setView(view: CalendarView): void {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* Preference is optional. */ }
    void this.navigate({ ...this.query(), view, page: 1 });
  }
  movePage(amount: number): void {
    const next = clampCalendarPage(this.currentPage() + amount, this.sortedItems().length);
    if (next === this.currentPage()) return;
    void this.navigate({ ...this.query(), page: next });
  }
  reload(): void { void this.load(); }
  status(item: PublicTournamentView) { return statusPresentation(item.status); }
  date(item: PublicTournamentView) { return tournamentDatePresentation(item, this.i18n.locale()); }
  cardDate(item: PublicTournamentView): string { return tournamentCardDatePresentation(item, this.i18n.locale()); }
  openTournament(item: PublicTournamentView, event?: Event): void { event?.preventDefault(); void this.router.navigate(['/calendar/tournaments', item.slug]); }
  venue(item: PublicTournamentView): string { return [item.venue.streetAddress, item.venue.postalCode, item.venue.city, item.venue.country].filter(Boolean).join(', '); }
  formatGroupDate(group: VenueDateGroup): string { return this.i18n.formatDate(group.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  isPast(date: string): boolean { return isPastCalendarDay(date, this.today()); }
  highlightParts(text: string): HighlightPart[] { return highlightSearchText(text, this.searchDraft()); }
  dayEvents(date: string): PublicTournamentView[] { return this.eventsByDate().get(date) ?? []; }
  visibleDayEvents(date: string): PublicTournamentView[] { return this.dayEvents(date).slice(0, MAX_DAY_CELL_EVENTS); }
  hiddenDayEventCount(date: string): number { return Math.max(0, this.dayEvents(date).length - MAX_DAY_CELL_EVENTS); }

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

  private navigate(query: CalendarQuery, extras: { scroll?: 'manual' } = {}): Promise<boolean> { return this.router.navigate([], { relativeTo: this.route, queryParams: buildCalendarQueryParams(query), ...extras }); }
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
    return { date: localDateValue(date), day: date.getDate(), inMonth: date.getMonth() === monthNumber - 1 };
  });
}

/** The grid's cell keys are local wall dates, so "today" has to be read the same way. */
function localDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
