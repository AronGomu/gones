import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { PublicTournamentListResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
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
import { PublicTournamentService } from './public-tournament.service';

interface MonthDay {
  date: string;
  day: number;
  inMonth: boolean;
  items: PublicTournamentView[];
}

const VIEW_KEY = 'gones.calendar-v1.view';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, BackButtonComponent, OfflineBannerComponent],
  template: `
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />
    <section class="info-page public-calendar-page" aria-labelledby="public-calendar-title" data-cy="public-calendar">
      <header class="section-header">
        <div><p class="kicker">{{ i18n.t('calendar.publicKicker') }}</p><h1 id="public-calendar-title">{{ i18n.t('calendar.publicTitle') }}</h1></div>
        <div class="calendar-view-tabs" role="group" [attr.aria-label]="i18n.t('calendar.viewAria')">
          <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'calendar'" data-cy="calendar-view" (click)="setView('calendar')">{{ i18n.t('calendar.tabCalendar') }}</button>
          <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'list'" data-cy="list-view" (click)="setView('list')">{{ i18n.t('calendar.listView') }}</button>
        </div>
      </header>

      <form class="panel calendar-filter-form" data-cy="calendar-filters" (ngSubmit)="applyFilters()">
        <label>{{ i18n.t('common.search') }}<input name="search" [ngModel]="draft().search" (ngModelChange)="setDraft('search', $event)"></label>
        <label>{{ i18n.t('calendar.status') }}<select name="status" [ngModel]="draft().status" (ngModelChange)="setDraft('status', $event)"><option value="">{{ i18n.t('calendar.allStatuses') }}</option><option value="Published">Published</option><option value="Ongoing">Ongoing</option><option value="Completed">Completed</option><option value="Cancelled">Cancelled</option></select></label>
        <label>{{ i18n.t('calendar.city') }}<input name="city" [ngModel]="draft().city" (ngModelChange)="setDraft('city', $event)"></label>
        <label>{{ i18n.t('calendar.country') }}<input name="country" [ngModel]="draft().country" (ngModelChange)="setDraft('country', $event)"></label>
        <label>{{ i18n.t('calendar.organization') }}<input name="organization" [ngModel]="draft().organization" (ngModelChange)="setDraft('organization', $event)"></label>
        <label>{{ i18n.t('calendar.format') }}<input name="format" [ngModel]="draft().format" (ngModelChange)="setDraft('format', $event)"></label>
        <label class="check-row calendar-past-toggle"><input name="past" type="checkbox" [ngModel]="draft().past" (ngModelChange)="setDraftPast($event)">{{ i18n.t('calendar.includePast') }}</label>
        <button mat-flat-button class="home-primary-action" type="submit">{{ i18n.t('common.apply') }}</button>
      </form>

      <gones-offline-banner [stale]="stale()" [cachedAt]="cachedAt()" />
      @if (error()) {
        <section class="panel calendar-state" role="alert" data-cy="calendar-error"><h2>{{ i18n.t('calendar.loadFailed') }}</h2><button mat-stroked-button type="button" (click)="reload()">{{ i18n.t('common.retry') }}</button></section>
      } @else if (loading()) {
        <section class="calendar-skeleton" aria-busy="true" aria-live="polite" data-cy="calendar-loading"><span class="sr-only">{{ i18n.t('common.loading') }}</span>@for (_ of skeletons; track $index) { <div></div> }</section>
      } @else {
        @if (query().view === 'calendar') {
          <nav class="calendar-month-controls" [attr.aria-label]="i18n.t('calendar.navAria')">
            <button mat-stroked-button type="button" (click)="moveMonth(-1)">{{ i18n.t('common.previous') }}</button><h2>{{ monthLabel() }}</h2><button mat-stroked-button type="button" (click)="moveMonth(1)">{{ i18n.t('common.next') }}</button>
          </nav>
          @if (items().length) {
            <section class="public-month-grid" role="grid" [attr.aria-label]="i18n.t('calendar.monthAria')">
              <div class="public-month-row public-month-row--head" role="row">
                @for (weekday of weekdays; track weekday) { <div class="classic-calendar__weekday" role="columnheader">{{ weekday }}</div> }
              </div>
              @for (week of monthWeeks(); track week[0].date) {
                <div class="public-month-row" role="row">
                  @for (day of week; track day.date) {
                    <article class="public-month-day" role="gridcell" [class.public-month-day--muted]="!day.inMonth">
                      <time [attr.datetime]="day.date">{{ day.day }}</time>
                      @for (item of day.items; track item.id) {
                        <a class="calendar-pill" [class.calendar-pill--cancelled]="status(item).className === 'cancelled'" [routerLink]="['/calendar/tournaments', item.slug]"><span>{{ item.venueStartTime.slice(0, 5) }}</span> {{ item.title }} @if (status(item).className === 'cancelled' || status(item).className === 'completed') { <strong class="calendar-pill__status">{{ status(item).label }}</strong> }</a>
                      }
                    </article>
                  }
                </div>
              }
            </section>
          } @else { <ng-container *ngTemplateOutlet="emptyState" /> }
        } @else {
          @if (groups().length) {
            <section class="public-calendar-list" data-cy="calendar-list">
              @for (group of groups(); track group.date) {
                <section class="venue-date-group" [attr.data-venue-date]="group.date"><h2>{{ formatGroupDate(group) }}</h2>
                  @for (item of group.items; track item.id) { <ng-container *ngTemplateOutlet="tournamentCard; context: { $implicit: item }" /> }
                </section>
              }
            </section>
          } @else { <ng-container *ngTemplateOutlet="emptyState" /> }
        }
        @if (totalPages() > 1) {
          <nav class="pagination" [attr.aria-label]="i18n.t('calendar.pagesAria')"><button mat-stroked-button type="button" [disabled]="query().page <= 1" (click)="setPage(query().page - 1)">{{ i18n.t('common.previous') }}</button><span>{{ query().page }} / {{ totalPages() }}</span><button mat-stroked-button type="button" [disabled]="query().page >= totalPages()" (click)="setPage(query().page + 1)">{{ i18n.t('common.next') }}</button></nav>
        }
      }

      <ng-template #emptyState><section class="panel calendar-state" data-cy="calendar-empty"><h2>{{ i18n.t('calendar.emptyTitle') }}</h2><p>{{ i18n.t('calendar.emptyBody') }}</p></section></ng-template>
      <ng-template #tournamentCard let-item><article class="panel public-tournament-card" [attr.data-cy]="'tournament-' + item.slug">
        <div><span class="calendar-status" [class]="'calendar-status calendar-status--' + status(item).className">{{ status(item).label }}</span><h3><a [routerLink]="['/calendar/tournaments', item.slug]">{{ item.title }}</a></h3><p>{{ date(item).primary }}</p>@if (date(item).secondary; as secondary) { <p class="viewer-date">{{ i18n.t('calendar.viewerTime') }}: {{ secondary }}</p> }<p>{{ venue(item) }}</p>@if (item.summary) { <p class="muted">{{ item.summary }}</p> }</div>
        <div class="calendar-event__actions"><a mat-stroked-button [routerLink]="['/calendar/tournaments', item.slug]">{{ i18n.t('calendar.viewPage') }}</a><a mat-stroked-button [href]="service.icsUrl(item.slug)" download>{{ i18n.t('calendar.addToCalendar') }}</a></div>
      </article></ng-template>
    </section>
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `
})
export class PublicCalendarComponent implements OnInit, OnDestroy {
  readonly i18n = inject(I18nService);
  readonly service = inject(PublicTournamentService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private subscription?: Subscription;
  private loadId = 0;

  readonly skeletons = Array.from({ length: 6 });
  readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly query = signal<CalendarQuery>(readCalendarQuery(this.route.snapshot.queryParamMap, this.preferredView()));
  readonly draft = signal<CalendarQuery>(this.query());
  readonly result = signal<PublicTournamentListResponse | null>(null);
  readonly loading = signal(true);
  readonly stale = signal(false);
  readonly cachedAt = signal<string | undefined>(undefined);
  readonly error = signal(false);
  readonly items = computed(() => this.result()?.items ?? []);
  readonly groups = computed(() => groupTournamentsByVenueDate(this.items()));
  readonly totalPages = computed(() => Math.max(1, Math.ceil((this.result()?.totalCount ?? 0) / (this.result()?.pageSize ?? 20))));
  readonly monthLabel = computed(() => this.i18n.formatDate(`${this.query().month}-01`, { month: 'long', year: 'numeric' }));
  readonly monthDays = computed(() => buildMonthDays(this.query().month, this.groups()));
  // ARIA requires grid > row > gridcell; the rows use `display: contents` so the CSS grid is unchanged.
  readonly monthWeeks = computed(() => chunkIntoWeeks(this.monthDays()));

  ngOnInit(): void {
    this.subscription = this.route.queryParamMap.subscribe(params => {
      const query = readCalendarQuery(params, this.preferredView());
      if (params.get('month') !== query.month || params.get('view') !== query.view) {
        void this.router.navigate([], { relativeTo: this.route, queryParams: buildCalendarQueryParams(query), replaceUrl: true });
        return;
      }
      this.query.set(query);
      this.draft.set(query);
      void this.load(query);
    });
  }

  ngOnDestroy(): void { this.subscription?.unsubscribe(); }

  setDraft(key: 'search' | 'status' | 'city' | 'country' | 'organization' | 'format', value: string): void { this.draft.update(query => ({ ...query, [key]: value })); }
  setDraftPast(value: boolean): void { this.draft.update(query => ({ ...query, past: value })); }
  applyFilters(): void { void this.navigate({ ...this.draft(), page: 1 }); }
  setPage(page: number): void { void this.navigate({ ...this.query(), page }); }
  moveMonth(amount: number): void { void this.navigate({ ...this.query(), month: shiftMonth(this.query().month, amount), page: 1 }); }
  setView(view: CalendarView): void {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* Preference is optional. */ }
    void this.navigate({ ...this.query(), view, page: 1 });
  }
  reload(): void { void this.load(this.query()); }
  status(item: PublicTournamentView) { return statusPresentation(item.status); }
  date(item: PublicTournamentView) { return tournamentDatePresentation(item, this.i18n.locale()); }
  venue(item: PublicTournamentView): string { return [item.venue.streetAddress, item.venue.postalCode, item.venue.city, item.venue.country].filter(Boolean).join(', '); }
  formatGroupDate(group: VenueDateGroup): string { return this.i18n.formatDate(group.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }

  private async load(query: CalendarQuery): Promise<void> {
    const id = ++this.loadId;
    this.loading.set(true);
    this.error.set(false);
    try {
      const result = await this.service.list(query);
      if (id !== this.loadId) return;
      this.result.set(result.data);
      this.stale.set(result.stale);
      this.cachedAt.set(result.cachedAt);
    } catch {
      if (id === this.loadId) { this.error.set(true); this.stale.set(false); this.cachedAt.set(undefined); }
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

function buildMonthDays(month: string, groups: VenueDateGroup[]): MonthDay[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const start = new Date(year, monthNumber - 1, 1 - first.getDay());
  const byDate = new Map(groups.map(group => [group.date, group.items]));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { date: dateValue, day: date.getDate(), inMonth: date.getMonth() === monthNumber - 1, items: byDate.get(dateValue) ?? [] };
  });
}
