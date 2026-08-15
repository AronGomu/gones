import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { I18nService } from '../../i18n/i18n.service';
import { AuthService } from '../../auth/auth.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { OfflineBannerComponent } from '../../shared/offline-banner.component';
import {
  EventListQuery,
  CalendarView,
  PAGE_SIZE,
  PublicEventView,
  addEventRegisterIntent,
  eventRegisterIntent,
  VenueDateGroup,
  buildEventListQueryParams,
  calendarPageCount,
  clampCalendarPage,
  groupEventsByVenueDate,
  isPastCalendarDay,
  paginateEvents,
  readEventListQuery,
  removeEventRegisterIntent,
  shiftMonth,
  sortEventsForList,
  eventDatePresentation,
  eventsByDate,
  MAX_DAY_CELL_EVENTS
} from './public-event-list';
import { EventCatalogCacheService } from './event-catalog-cache.service';
import { PublicEventService } from './public-event.service';
import { filterEvents } from './event-fuzzy-search';
import { HighlightPart, highlightSearchText } from '../../shared/search-highlight';
import { EventRegistrationCapabilityResponse } from '../../api/generated/gones-api';
import { MessageKey } from '../../i18n/messages';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { EventRegistrationService, registrationErrorKey } from './event-registration.service';
import { RegistrationSuccessDialogComponent } from './registration-success-dialog.component';
import { canManageLeagues } from '../../data/league-archive-command-ux';
import { canUsePowerMutation, PowerUserSettingsService } from '../../shared/power-user-settings.service';

interface MonthDay {
  date: string;
  day: number;
  inMonth: boolean;
}

const VIEW_KEY = 'gones.events.view';
const SEARCH_DEBOUNCE_MS = 300;

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, BackButtonComponent, OfflineBannerComponent],
  template: `
    <div class="calendar-top-actions" data-cy="event-list-top-actions">
      <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="event-list-back-top" />
      <div class="calendar-sync-group" data-cy="event-list-sync-group">
        @if (syncedAt(); as instant) { <span class="muted calendar-synced-at" data-cy="event-list-synced-at">{{ i18n.t('event.syncedAt', { instant: i18n.formatDateTime(instant) }) }}</span> }
        <button mat-stroked-button type="button" class="secondary-action calendar-sync-button" data-cy="event-list-sync" [disabled]="loading()" (click)="sync()" [attr.aria-label]="i18n.t('event.synchroniseAria')">
          <svg class="calendar-sync-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.9-3" /><path d="M4 5v5h5" /><path d="M4 13a8 8 0 0 0 14.9 3" /><path d="M20 19v-5h-5" /></svg>
          <span data-cy="event-list-sync-label">{{ i18n.t('event.synchronise') }}</span>
        </button>
      </div>
    </div>
    <section class="info-page public-calendar-page" aria-labelledby="public-calendar-title" data-cy="public-calendar">
      <header class="section-header" data-cy="event-list-header">
        <div data-cy="event-list-header-text"><h1 id="public-calendar-title" data-cy="event-list-title">{{ i18n.t('event.publicTitle') }}</h1></div>
      </header>

      <form class="calendar-search-row" data-cy="event-list-search-row" (ngSubmit)="$event.preventDefault()">
        <input id="calendar-search" name="q" type="search" class="calendar-search-input" data-cy="event-list-search"
               [attr.aria-label]="i18n.t('common.search')"
               [attr.placeholder]="i18n.t('event.searchPlaceholder')"
               [ngModel]="searchDraft()" (ngModelChange)="setSearchDraft($event)">
      </form>

      <div class="calendar-view-tabs" role="group" [attr.aria-label]="i18n.t('event.viewAria')" data-cy="event-list-view-tabs">
        <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'calendar'" data-cy="event-list-view" (click)="setView('calendar')">{{ i18n.t('event.tabCalendar') }}</button>
        <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'list'" data-cy="list-view" (click)="setView('list')">{{ i18n.t('event.listView') }}</button>
        @if (canCreateEvent()) {
          <a mat-flat-button class="create-action-button calendar-create-tournament" routerLink="/events/new" data-cy="event-list-create-event">{{ i18n.t('event.createEvent') }}</a>
        }
      </div>

      <gones-offline-banner [stale]="stale()" [cachedAt]="syncedAt()" data-cy="event-list-offline-banner" />
      @if (registrationMessageKey(); as messageKey) { <p class="registration-live-status" role="status" aria-live="polite" data-cy="event-list-registration-message">{{ i18n.t(messageKey) }}</p> }
      @if (error()) {
        <section class="panel calendar-state" role="alert" data-cy="event-list-error"><h2 data-cy="event-list-error-title">{{ i18n.t('event.listLoadFailed') }}</h2><button mat-stroked-button type="button" data-cy="event-list-retry" (click)="reload()">{{ i18n.t('common.retry') }}</button></section>
      } @else if (loading()) {
        <section class="calendar-skeleton" aria-busy="true" aria-live="polite" data-cy="event-list-loading"><span class="sr-only" data-cy="event-list-loading-label">{{ i18n.t('common.loading') }}</span>@for (_ of skeletons; track $index) { <div data-cy="event-list-skeleton-item"></div> }</section>
      } @else {
        @if (truncated()) { <p class="warning" role="status" data-cy="event-list-truncated">{{ i18n.t('event.truncatedWarning', { count: allItems().length }) }}</p> }
        @if (query().view === 'calendar') {
          <nav class="calendar-month-controls" [attr.aria-label]="i18n.t('event.navAria')" data-cy="event-list-month-controls">
            <button mat-stroked-button type="button" data-cy="event-list-month-prev" (click)="moveMonth(-1)">{{ i18n.t('common.previous') }}</button><h2 data-cy="event-list-month-label">{{ monthLabel() }}</h2><button mat-stroked-button type="button" data-cy="event-list-month-next" (click)="moveMonth(1)">{{ i18n.t('common.next') }}</button>
          </nav>
          <section #monthGrid class="public-month-grid" role="grid" [style.min-height.px]="gridMinHeight()" [attr.aria-label]="i18n.t('event.monthAria')" data-cy="public-month-grid">
            <div class="public-month-row public-month-row--head" role="row" data-cy="event-list-month-row-head">
              @for (weekday of weekdays; track weekday) { <div class="classic-calendar__weekday" role="columnheader" data-cy="event-list-weekday">{{ weekday }}</div> }
            </div>
            @for (week of monthWeeks(); track week[0].date) {
              <div class="public-month-row" role="row" data-cy="event-list-month-row">
                @for (day of week; track day.date) {
                  <article class="public-month-day" role="gridcell" [class.public-month-day--muted]="!day.inMonth" [class.public-month-day--past]="isPast(day.date)" [attr.data-cy]="isPast(day.date) ? 'event-list-month-day-past' : 'event-list-month-day'">
                    <time [attr.datetime]="day.date" data-cy="event-list-month-day-date">{{ day.day }}</time>
                    @for (event of visibleDayEvents(day.date); track event.id) {
                      <a class="public-month-event" [routerLink]="['/events', event.slug]" [attr.data-cy]="'event-list-month-day-event-' + event.slug" [attr.title]="event.title">
                        <span class="public-month-event__time" data-cy="event-list-month-day-event-time">{{ event.venueStartTime.slice(0, 5) }}</span>
                        <span class="public-month-event__title" data-cy="event-list-month-day-event-title">@for (part of highlightParts(event.title); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'event-list-month-day-event-title-part-' + event.slug + '-' + $index">{{ part.text }}</span> }</span>
                      </a>
                    }
                    @if (hiddenDayEventCount(day.date); as hidden) {
                      <span class="public-month-more" data-cy="event-list-month-day-more">{{ i18n.t('event.moreEvents', { count: hidden }) }}</span>
                    }
                  </article>
                }
              </div>
            }
          </section>
          @if (!items().length) { <ng-container *ngTemplateOutlet="emptyState" /> }
        } @else {
          @if (groups().length) {
            <section class="public-calendar-list" data-cy="event-list-list">
              @for (group of groups(); track group.date) {
                <section class="venue-date-group" [attr.data-venue-date]="group.date" [attr.data-cy]="'event-list-venue-date-' + group.date"><h2 data-cy="event-list-venue-date-label">{{ formatGroupDate(group) }}</h2>
                  @for (item of group.items; track item.id) { <ng-container *ngTemplateOutlet="eventCard; context: { $implicit: item }" /> }
                </section>
              }
            </section>
            @if (pageCount() > 1) {
              <nav class="calendar-pagination" [attr.aria-label]="i18n.t('event.paginationAria')" data-cy="event-list-pagination">
                <button mat-stroked-button type="button" data-cy="event-list-page-prev" [disabled]="currentPage() <= 1" (click)="movePage(-1)">{{ i18n.t('common.previous') }}</button>
                <span class="muted" role="status" aria-live="polite" data-cy="event-list-page-status">{{ i18n.t('event.pageStatus', { page: currentPage(), total: pageCount() }) }}</span>
                <button mat-stroked-button type="button" data-cy="event-list-page-next" [disabled]="currentPage() >= pageCount()" (click)="movePage(1)">{{ i18n.t('common.next') }}</button>
              </nav>
            }
          } @else { <ng-container *ngTemplateOutlet="emptyState" /> }
        }
      }

      <ng-template #emptyState><section class="panel calendar-state" data-cy="event-list-empty"><h2 data-cy="event-list-empty-title">{{ i18n.t('event.emptyTitle') }}</h2><p data-cy="event-list-empty-body">{{ i18n.t('event.emptyBody') }}</p></section></ng-template>
      <ng-template #eventCard let-item><article class="panel public-tournament-card" role="link" tabindex="0" [attr.aria-label]="item.displayTitle" [attr.data-cy]="'event-' + item.slug" (click)="openEvent(item)" (keydown.enter)="openEvent(item)" (keydown.space)="openEvent(item, $event)">
        <div data-cy="event-list-card-body"><div class="calendar-card-heading" data-cy="event-list-card-heading"><h3 data-cy="event-list-card-title"><a [routerLink]="['/events', item.slug]" data-cy="event-list-card-link" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()">@for (part of highlightParts(item.displayTitle); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'event-list-card-title-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</a></h3><time [attr.datetime]="item.startsAtUtc" data-cy="event-list-card-start-time">{{ item.venueStartTime.slice(0, 5) }}</time></div>@if (date(item).secondary; as secondary) { <p class="viewer-date" data-cy="event-list-card-viewer-date">{{ i18n.t('event.viewerTime') }}: {{ secondary }}</p> }<p data-cy="event-list-card-venue">@for (part of highlightParts(venue(item)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'event-list-card-venue-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</p>@if (item.summary) { <p class="muted" data-cy="event-list-card-summary">@for (part of highlightParts(item.summary); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'event-list-card-summary-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</p> }</div>
        <div class="calendar-event__actions" data-cy="event-list-card-actions"><a mat-stroked-button [href]="service.icsUrl(item.slug)" download data-cy="event-list-card-ics" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()">{{ i18n.t('event.addToCalendar') }}</a>@if (showCardRegister(item)) { <button mat-flat-button type="button" class="registration-register-button" data-cy="event-list-card-register" [disabled]="pendingEventId() === item.id" (click)="registerFromCard(item, $event)" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()">{{ pendingEventId() === item.id ? i18n.t('registration.pending') : i18n.t('registration.register') }}</button> }</div>
      </article></ng-template>
    </section>
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" data-cy="event-list-back-bottom" />
  `
})
export class PublicEventListComponent implements OnInit, OnDestroy {
  readonly i18n = inject(I18nService);
  readonly service = inject(PublicEventService);
  readonly auth = inject(AuthService);
  private readonly catalog = inject(EventCatalogCacheService);
  private readonly registrations = inject(EventRegistrationService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly power = inject(PowerUserSettingsService);
  private readonly initialRegisterSlug = eventRegisterIntent(this.router.url);
  private subscription?: Subscription;
  private searchDebounce?: ReturnType<typeof setTimeout>;
  private loadId = 0;
  private capabilityGeneration = 0;
  @ViewChild('monthGrid') private monthGrid?: ElementRef<HTMLElement>;

  readonly skeletons = Array.from({ length: 6 });
  readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly today = signal(localDateValue(new Date()));
  readonly query = signal<EventListQuery>(readEventListQuery(this.route.snapshot.queryParamMap, this.preferredView()));
  readonly searchDraft = signal<string>(this.query().q);
  readonly allItems = signal<PublicEventView[]>([]);
  readonly syncedAt = signal<string | undefined>(undefined);
  // Pins the grid height for the duration of a month change so the document cannot shrink under the
  // scroll position that is about to be restored.
  readonly gridMinHeight = signal<number | null>(null);
  readonly truncated = signal(false);
  readonly loading = signal(true);
  readonly stale = signal(false);
  readonly error = signal(false);
  readonly items = computed(() => filterEvents(this.allItems(), this.searchDraft()));
  readonly sortedItems = computed(() => sortEventsForList(this.items()));
  readonly pageCount = computed(() => calendarPageCount(this.sortedItems().length));
  readonly currentPage = computed(() => clampCalendarPage(this.query().page, this.sortedItems().length));
  readonly pagedItems = computed(() => paginateEvents(this.sortedItems(), this.query().page));
  readonly groups = computed(() => groupEventsByVenueDate(this.pagedItems()));
  readonly monthLabel = computed(() => this.i18n.formatDate(`${this.query().month}-01`, { month: 'long', year: 'numeric' }));
  readonly monthDays = computed(() => buildMonthDays(this.query().month));
  // ARIA requires grid > row > gridcell; the rows use `display: contents` so the CSS grid is unchanged.
  readonly monthWeeks = computed(() => chunkIntoWeeks(this.monthDays()));
  // Named apart from the `eventsByDate` helper it wraps: the two would otherwise differ only by a
  // `this.`, which is a trap for the next reader rather than a nicety.
  readonly dayEventIndex = computed(() => eventsByDate(this.items()));
  readonly canCreateEvent = computed(() => canUsePowerMutation(
    this.power.enabled(),
    canManageLeagues(this.auth.profile()?.globalRole) && this.auth.profile()?.emailVerified === true
  ));
  readonly registrationCapabilities = signal<Record<string, EventRegistrationCapabilityResponse>>({});
  readonly pendingEventId = signal<string | null>(null);
  readonly registrationMessageKey = signal<MessageKey | null>(null);
  private readonly capabilityWatcher = effect(() => {
    const profile = this.auth.profile();
    const view = this.query().view;
    const visible = this.pagedItems();
    queueMicrotask(() => { void this.refreshVisibleCapabilities(view === 'list' ? visible : [], profile); });
  });

  ngOnInit(): void {
    this.subscription = this.route.queryParamMap.subscribe(params => {
      const query = readEventListQuery(params, this.preferredView());
      if (params.get('month') !== query.month || params.get('view') !== query.view) {
        void this.router.navigate([], { relativeTo: this.route, queryParams: buildEventListQueryParams(query), replaceUrl: true });
        return;
      }
      this.query.set(query);
      this.searchDraft.set(query.q);
    });
    void this.initialize();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.capabilityWatcher.destroy();
    this.capabilityGeneration++;
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
  date(item: PublicEventView) { return eventDatePresentation(item, this.i18n.locale()); }
  openEvent(item: PublicEventView, event?: Event): void { event?.preventDefault(); void this.router.navigate(['/events', item.slug]); }
  showCardRegister(item: PublicEventView): boolean {
    return this.auth.profile() === null || this.registrationCapabilities()[item.id]?.canRegister === true;
  }
  async registerFromCard(item: PublicEventView, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.registrationMessageKey.set(null);
    await this.auth.whenSessionReady();
    if (this.auth.profile() === null) {
      const returnUrl = addEventRegisterIntent(this.router.url, item.slug);
      await this.router.navigate(['/login'], { queryParams: { returnUrl } });
      return;
    }
    await this.confirmAndRegister(item, false);
  }
  async refreshVisibleCapabilities(
    visible = this.pagedItems(),
    profile = this.auth.profile()
  ): Promise<void> {
    const generation = ++this.capabilityGeneration;
    if (profile === null || this.query().view !== 'list') {
      this.registrationCapabilities.set({});
      return;
    }
    const next: Record<string, EventRegistrationCapabilityResponse> = {};
    await Promise.all(visible.slice(0, PAGE_SIZE).map(async item => {
      try { next[item.id] = await this.registrations.capability(item.id); }
      catch { /* Failed capability intentionally hides signed-in CTA. */ }
    }));
    if (generation === this.capabilityGeneration) this.registrationCapabilities.set(next);
  }
  async resumeRegistrationIntent(): Promise<void> {
    if (!this.initialRegisterSlug) return;
    const item = this.allItems().find(candidate => candidate.slug === this.initialRegisterSlug);
    if (!item) {
      this.registrationMessageKey.set('registration.unavailable');
      await this.stripRegisterIntent();
      return;
    }
    if (this.auth.profile() === null) return;
    await this.confirmAndRegister(item, true);
  }
  venue(item: PublicEventView): string { return [item.venue.streetAddress, item.venue.postalCode, item.venue.city, item.venue.country].filter(Boolean).join(', '); }
  formatGroupDate(group: VenueDateGroup): string { return this.i18n.formatDate(group.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  isPast(date: string): boolean { return isPastCalendarDay(date, this.today()); }
  highlightParts(text: string): HighlightPart[] { return highlightSearchText(text, this.searchDraft()); }
  dayEvents(date: string): PublicEventView[] { return this.dayEventIndex().get(date) ?? []; }
  visibleDayEvents(date: string): PublicEventView[] { return this.dayEvents(date).slice(0, MAX_DAY_CELL_EVENTS); }
  hiddenDayEventCount(date: string): number { return Math.max(0, this.dayEvents(date).length - MAX_DAY_CELL_EVENTS); }

  private async initialize(): Promise<void> {
    await this.load();
    await this.auth.whenSessionReady();
    await this.resumeRegistrationIntent();
  }

  private async confirmAndRegister(item: PublicEventView, resumed: boolean): Promise<void> {
    if (this.pendingEventId() !== null) return;
    this.pendingEventId.set(item.id);
    let intentStripped = false;
    try {
      const capability = await this.registrations.capability(item.id);
      this.registrationCapabilities.update(current => ({ ...current, [item.id]: capability }));
      if (!capability.canRegister) {
        this.registrationMessageKey.set(registrationErrorKey(capability.reason));
        return;
      }
      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: this.i18n.t('registration.registerTitle'),
          message: this.i18n.t('registration.registerConfirm', { title: item.displayTitle }),
          confirmLabel: this.i18n.t('registration.register')
        }
      }).afterClosed());
      if (!confirmed) return;
      await this.registrations.register(item.id);
      this.registrationMessageKey.set('registration.registered');
      this.registrationCapabilities.update(current => ({
        ...current,
        [item.id]: { ...capability, canRegister: false, canUnregister: true, reason: 'registration_already_active' }
      }));
      if (resumed) {
        await this.stripRegisterIntent();
        intentStripped = true;
      }
      await firstValueFrom(this.dialog.open(RegistrationSuccessDialogComponent, { data: { title: item.title } }).afterClosed());
    } catch {
      this.registrationMessageKey.set('registration.failed');
    } finally {
      this.pendingEventId.set(null);
      if (resumed && !intentStripped) await this.stripRegisterIntent();
    }
  }

  private async stripRegisterIntent(): Promise<void> {
    await this.router.navigateByUrl(removeEventRegisterIntent(this.router.url), { replaceUrl: true });
  }

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

  private navigate(query: EventListQuery, extras: { scroll?: 'manual' } = {}): Promise<boolean> { return this.router.navigate([], { relativeTo: this.route, queryParams: buildEventListQueryParams(query), ...extras }); }
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
