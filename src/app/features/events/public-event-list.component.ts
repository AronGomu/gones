import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { I18nService } from '../../i18n/i18n.service';
import { AuthService } from '../../auth/auth.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { SyncBarComponent } from '../../shared/sync-bar.component';
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
  hasEventStarted,
  isPastCalendarDay,
  paginateEvents,
  readEventListQuery,
  removeEventRegisterIntent,
  shiftMonth,
  sortEventsForList,
  eventDatePresentation,
  eventsByDate,
  filterAvailableEvents,
  MAX_DAY_CELL_EVENTS,
  MonthDay,
  buildMonthDays,
  localDateValue,
  venueMapsUrl
} from './public-event-list';
import { EventCatalogCacheService } from './event-catalog-cache.service';
import { PublicEventService } from './public-event.service';
import { filterEvents } from './event-fuzzy-search';
import { HighlightPart, highlightSearchText } from '../../shared/search-highlight';
import { Client, EventRegistrationCapabilityResponse } from '../../api/generated/gones-api';
import { MessageKey } from '../../i18n/messages';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { EventRegistrationService, registrationErrorKey } from './event-registration.service';
import { RegistrationSuccessDialogComponent } from './registration-success-dialog.component';
import { GeoService } from '../../shared/geo.service';
import {
  EVENT_TYPES,
  EventListFilters,
  defaultEventListFilters,
  eventFilterOptions,
  filterEventList,
  readStoredEventSearch,
  writeStoredEventSearch
} from './event-list-filters';

import { paginationPageWindow } from '../../shared/pagination';

const VIEW_KEY = 'gones.events.view';
const SEARCH_KEY = 'gones.events.search.v1';
const SEARCH_DEBOUNCE_MS = 300;

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, MatTooltipModule, BackButtonComponent, SyncBarComponent],
  template: `
    <div class="calendar-top-actions" data-cy="event-list-top-actions">
      <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="event-list-back-top" />
      <gones-sync-bar cyPrefix="event-list" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="sync()" data-cy="event-list-sync-bar" />
    </div>
    <section #calendarPage class="info-page public-calendar-page" [style.min-height.px]="pageMinHeight()" aria-labelledby="public-calendar-title" data-cy="public-calendar">
      <header class="section-header" data-cy="event-list-header">
        <div data-cy="event-list-header-text"><h1 id="public-calendar-title" data-cy="event-list-title">{{ i18n.t('event.publicTitle') }}</h1></div>
        <div class="calendar-view-tabs" role="group" [attr.aria-label]="i18n.t('event.viewAria')" data-cy="event-list-view-tabs">
          <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'calendar'" data-cy="event-list-view" (click)="setView('calendar')">{{ i18n.t('event.tabCalendar') }}</button>
          <button mat-stroked-button type="button" [attr.aria-pressed]="query().view === 'list'" data-cy="list-view" (click)="setView('list')">{{ i18n.t('event.listView') }}</button>
          <label class="event-past-toggle" data-cy="event-list-hide-past-label"><input type="checkbox" data-cy="event-list-hide-past" [ngModel]="hidePastEvents()" (ngModelChange)="hidePastEvents.set($event)" name="hidePastEvents">{{ i18n.t('event.hidePast') }}</label>
          @if (showCreateEvent()) {
            @let disabledReason = createEventDisabledReason();
            <a mat-flat-button class="create-action-button calendar-create-tournament" [routerLink]="canCreateEvent() ? '/events/new' : null" role="link" tabindex="0" data-cy="event-list-create-event" [disabled]="!canCreateEvent()" [disabledInteractive]="!canCreateEvent()" [matTooltip]="disabledReason ?? ''" [matTooltipDisabled]="!disabledReason">{{ i18n.t('event.createEvent') }}</a>
          }
        </div>
      </header>

      <form class="calendar-search-row" data-cy="event-list-search-row" (ngSubmit)="$event.preventDefault()">
        <input id="calendar-search" name="q" type="search" class="calendar-search-input" data-cy="event-list-search"
               [attr.aria-label]="i18n.t('common.search')"
               [attr.placeholder]="i18n.t('event.searchPlaceholder')"
               [ngModel]="searchDraft()" (ngModelChange)="setSearchDraft($event)">
        <div class="calendar-filter-field" data-cy="event-list-filter-from-field"><label for="event-filter-from" data-cy="event-list-filter-from-label">{{ i18n.t('event.filterFrom') }}</label><input id="event-filter-from" name="from" type="date" data-cy="event-list-filter-from" [ngModel]="query().from" (ngModelChange)="setFilter('from', $event)"></div>
        <div class="calendar-filter-field" data-cy="event-list-filter-to-field"><label for="event-filter-to" data-cy="event-list-filter-to-label">{{ i18n.t('event.filterTo') }}</label><input id="event-filter-to" name="to" type="date" data-cy="event-list-filter-to" [min]="query().from" [ngModel]="query().to" (ngModelChange)="setFilter('to', $event)"></div>
        <div class="calendar-filter-field" data-cy="event-list-filter-country-field"><label for="event-filter-country" data-cy="event-list-filter-country-label">{{ i18n.t('profile.locationCountry') }}</label><select id="event-filter-country" name="country" data-cy="event-list-filter-country" [ngModel]="query().country" (ngModelChange)="setCountryFilter($event)"><option value="" data-cy="event-list-filter-country-all">{{ i18n.t('event.allCountries') }}</option>@for (country of filterOptions().countries; track country) { <option [value]="country" [attr.data-cy]="'event-list-filter-country-' + $index">{{ country }}</option> }</select></div>
        <div class="calendar-filter-field" data-cy="event-list-filter-region-field"><label for="event-filter-region" data-cy="event-list-filter-region-label">{{ i18n.t('profile.locationRegion') }}</label><select id="event-filter-region" name="region" data-cy="event-list-filter-region" [ngModel]="query().region" (ngModelChange)="setRegionFilter($event)"><option value="" data-cy="event-list-filter-region-all">{{ i18n.t('event.allRegions') }}</option>@for (region of filterOptions().regions; track region) { <option [value]="region" [attr.data-cy]="'event-list-filter-region-' + $index">{{ region }}</option> }</select></div>
        <div class="calendar-filter-field" data-cy="event-list-filter-city-field"><label for="event-filter-city" data-cy="event-list-filter-city-label">{{ i18n.t('profile.locationCity') }}</label><select id="event-filter-city" name="city" data-cy="event-list-filter-city" [ngModel]="query().city" (ngModelChange)="setFilter('city', $event)"><option value="" data-cy="event-list-filter-city-all">{{ i18n.t('event.allCities') }}</option>@for (city of filterOptions().cities; track city) { <option [value]="city" [attr.data-cy]="'event-list-filter-city-' + $index">{{ city }}</option> }</select></div>
        <div class="calendar-filter-field" data-cy="event-list-filter-format-field"><label for="event-filter-format" data-cy="event-list-filter-format-label">{{ i18n.t('event.format') }}</label><select id="event-filter-format" name="format" data-cy="event-list-filter-format" [ngModel]="query().format" (ngModelChange)="setFilter('format', $event)"><option value="" data-cy="event-list-filter-format-all">{{ i18n.t('event.allFormats') }}</option>@for (format of filterOptions().formats; track format.id) { <option [value]="format.id" [attr.data-cy]="'event-list-filter-format-' + format.id">{{ format.name }}</option> }</select></div>
        <div class="calendar-filter-field" data-cy="event-list-filter-type-field"><label for="event-filter-type" data-cy="event-list-filter-type-label">{{ i18n.t('event.eventType') }}</label><select id="event-filter-type" name="eventType" data-cy="event-list-filter-type" [ngModel]="query().eventType" (ngModelChange)="setFilter('eventType', $event)"><option value="" data-cy="event-list-filter-type-all">{{ i18n.t('event.allEventTypes') }}</option>@for (type of eventTypes; track type) { <option [value]="type" [attr.data-cy]="'event-list-filter-type-' + type">{{ eventTypeLabel(type) }}</option> }</select></div>
      </form>
      <p class="sr-only" role="status" aria-live="polite" data-cy="event-list-filter-status">{{ i18n.t('event.filterResultCount', { count: availableItems().length }) }}</p>

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
              @for (weekday of weekdays(); track weekday) { <div class="classic-calendar__weekday" role="columnheader" data-cy="event-list-weekday">{{ weekday }}</div> }
            </div>
            @for (week of monthWeeks(); track week[0].date) {
              <div class="public-month-row" role="row" data-cy="event-list-month-row">
                @for (day of week; track day.date) {
                  @let dayIsPast = isPast(day.date);
                  <article class="public-month-day" role="gridcell" [class.public-month-day--muted]="!day.inMonth" [class.public-month-day--past]="dayIsPast" [attr.aria-disabled]="dayIsPast" [attr.data-cy]="dayIsPast ? 'event-list-month-day-past' : 'event-list-month-day'">
                    <time [attr.datetime]="day.date" data-cy="event-list-month-day-date">{{ day.day }}</time>
                    @for (event of visibleDayEvents(day.date); track event.id) {
                      @if (dayIsPast) {
                        <span class="public-month-event public-month-event--disabled" aria-disabled="true" [attr.data-cy]="'event-list-month-day-event-' + event.slug" [attr.title]="event.title">
                          <ng-container *ngTemplateOutlet="monthEventBody; context: { $implicit: event }" />
                        </span>
                      } @else {
                        <a class="public-month-event" [routerLink]="['/events', event.slug]" [attr.data-cy]="'event-list-month-day-event-' + event.slug" [attr.title]="event.title">
                          <ng-container *ngTemplateOutlet="monthEventBody; context: { $implicit: event }" />
                        </a>
                      }
                    }
                    @if (hiddenDayEventCount(day.date); as hidden) {
                      <span class="public-month-more" data-cy="event-list-month-day-more">{{ i18n.t('event.moreEvents', { count: hidden }) }}</span>
                    }
                  </article>
                }
              </div>
            }
          </section>
          @if (!availableItems().length) { <ng-container *ngTemplateOutlet="emptyState" /> }
        } @else {
          @if (groups().length) {
            @if (pageCount() > 1) {
              <ng-container *ngTemplateOutlet="paginationNav; context: { $implicit: 'top' }" />
            }
            <section class="public-calendar-list" data-cy="event-list-list">
              @for (group of groups(); track group.date) {
                <section class="venue-date-group" [attr.data-venue-date]="group.date" [attr.data-cy]="'event-list-venue-date-' + group.date"><h2 data-cy="event-list-venue-date-label">{{ formatGroupDate(group) }}</h2>
                  @for (item of group.items; track item.id) { <ng-container *ngTemplateOutlet="eventCard; context: { $implicit: item }" /> }
                </section>
              }
            </section>
            @if (pageCount() > 1) {
              <ng-container *ngTemplateOutlet="paginationNav; context: { $implicit: 'bottom' }" />
            }
          } @else { <ng-container *ngTemplateOutlet="emptyState" /> }
        }
      }

      <ng-template #paginationNav let-place>
        <nav class="calendar-pagination" [class.calendar-pagination--top]="place === 'top'" [attr.aria-label]="i18n.t(place === 'top' ? 'event.paginationTopAria' : 'event.paginationBottomAria')" [attr.data-cy]="place === 'top' ? 'event-list-pagination-top' : 'event-list-pagination'">
          <span class="calendar-page-numbers" [attr.data-cy]="'event-list-page-numbers-' + place">
            @for (item of pageWindow(); track $index) {
              @if (item === 'gap') {
                <span class="calendar-page-gap" aria-hidden="true" [attr.data-cy]="'event-list-page-gap-' + place + '-' + $index">…</span>
              } @else {
                <button
                  type="button"
                  class="calendar-page-number"
                  [class.is-current]="item === currentPage()"
                  [attr.aria-current]="item === currentPage() ? 'page' : null"
                  [attr.aria-label]="i18n.t('event.pageAria', { page: item })"
                  [attr.data-cy]="'event-list-page-number-' + place + '-' + item"
                  (click)="goPage(item)"
                >{{ item }}</button>
              }
            }
          </span>
          @if (place === 'bottom') {
            <span class="muted" role="status" aria-live="polite" data-cy="event-list-page-status">{{ i18n.t('event.pageStatus', { page: currentPage(), total: pageCount() }) }}</span>
          }
        </nav>
      </ng-template>
      <ng-template #emptyState><section class="panel calendar-state" data-cy="event-list-empty"><h2 data-cy="event-list-empty-title">{{ i18n.t('event.emptyTitle') }}</h2><p data-cy="event-list-empty-body">{{ i18n.t('event.emptyBody') }}</p></section></ng-template>
      <ng-template #monthEventBody let-event><span class="public-month-event__time" data-cy="event-list-month-day-event-time">{{ event.venueStartTime.slice(0, 5) }}</span><span class="public-month-event__title" data-cy="event-list-month-day-event-title">@for (part of highlightParts(event.title); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'event-list-month-day-event-title-part-' + event.slug + '-' + $index">{{ part.text }}</span> }</span></ng-template>
      <ng-template #eventCard let-item><article class="panel public-tournament-card" role="link" tabindex="0" [attr.aria-label]="item.displayTitle" [attr.data-cy]="'event-' + item.slug" (click)="openEvent(item)" (keydown.enter)="openEvent(item)" (keydown.space)="openEvent(item, $event)">
        <div data-cy="event-list-card-body"><div class="calendar-card-heading" data-cy="event-list-card-heading"><h3 data-cy="event-list-card-title"><a [routerLink]="['/events', item.slug]" data-cy="event-list-card-link" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()">@for (part of highlightParts(item.displayTitle); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'event-list-card-title-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</a></h3><time [attr.datetime]="item.startsAtUtc" data-cy="event-list-card-start-time">{{ item.venueStartTime.slice(0, 5) }}</time></div>@if (date(item).secondary; as secondary) { <p class="viewer-date" data-cy="event-list-card-viewer-date">{{ i18n.t('event.viewerTime') }}: {{ secondary }}</p> }@if (cardMapsUrl(item); as mapsUrl) { <p [attr.data-cy]="'event-list-card-venue'"><a class="event-card-venue-link" [attr.data-cy]="'event-list-card-venue-link-' + item.slug" [href]="mapsUrl" target="_blank" rel="noopener noreferrer" [attr.aria-label]="i18n.t('event.openInMaps', { address: venue(item) })" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()"><svg class="maps-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>@for (part of highlightParts(venue(item)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'event-list-card-venue-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</a></p> } @else { <p [attr.data-cy]="'event-list-card-venue'">@for (part of highlightParts(venue(item)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'event-list-card-venue-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</p> }@if (item.summary) { <p class="muted" data-cy="event-list-card-summary">@for (part of highlightParts(item.summary); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'event-list-card-summary-part-' + item.slug + '-' + $index">{{ part.text }}</span> }</p> }</div>
        <div class="calendar-event__actions" data-cy="event-list-card-actions">@if (cardActionsDisabled(item) || showCardRegister(item)) { <button mat-flat-button type="button" class="registration-register-button" data-cy="event-list-card-register" [disabled]="cardActionsDisabled(item) || pendingEventId() === item.id" (click)="registerFromCard(item, $event)" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()">{{ pendingEventId() === item.id ? i18n.t('registration.pending') : i18n.t('registration.register') }}</button> }<a mat-stroked-button [href]="service.icsUrl(item.slug)" type="text/calendar" data-cy="event-list-card-ics" [disabled]="cardActionsDisabled(item)" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()">{{ i18n.t('event.addToCalendar') }}</a></div>
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
  private readonly client = inject(Client);
  private readonly geo = inject(GeoService);
  private readonly initialParams = this.route.snapshot.queryParamMap;
  private readonly initialRegisterSlug = eventRegisterIntent(this.router.url);
  private subscription?: Subscription;
  private searchDebounce?: ReturnType<typeof setTimeout>;
  private loadId = 0;
  private capabilityGeneration = 0;
  private createCapabilityGeneration = 0;
  @ViewChild('monthGrid') private monthGrid?: ElementRef<HTMLElement>;
  @ViewChild('calendarPage') private calendarPage?: ElementRef<HTMLElement>;

  readonly skeletons = Array.from({ length: 6 });
  readonly eventTypes = EVENT_TYPES;
  readonly weekdays = computed(() => {
    const formatter = new Intl.DateTimeFormat(this.i18n.locale(), { weekday: 'short' });
    return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(Date.UTC(2026, 5, 1 + index))));
  });
  readonly today = signal(localDateValue(new Date()));
  readonly query = signal<EventListQuery>(readEventListQuery(this.route.snapshot.queryParamMap, this.preferredView()));
  readonly searchDraft = signal<string>(this.query().q);
  readonly allItems = signal<PublicEventView[]>([]);
  readonly syncedAt = signal<string | undefined>(undefined);
  // Pins the grid height for the duration of a month change so the document cannot shrink under the
  // scroll position that is about to be restored.
  readonly gridMinHeight = signal<number | null>(null);
  // Pins the whole page for the duration of a search, which narrows both views rather than only the
  // grid, so the document cannot shrink under the reader between the keystroke and the URL write.
  readonly pageMinHeight = signal<number | null>(null);
  readonly truncated = signal(false);
  readonly loading = signal(true);
  readonly stale = signal(false);
  readonly error = signal(false);
  readonly filterOptions = computed(() => eventFilterOptions(this.allItems(), this.query()));
  readonly items = computed(() => filterEvents(filterEventList(this.allItems(), this.query()), this.searchDraft()));
  readonly hidePastEvents = signal(true);
  readonly availableItems = computed(() => this.hidePastEvents() ? filterAvailableEvents(this.items()) : this.items());
  readonly sortedItems = computed(() => sortEventsForList(this.availableItems()));
  readonly pageCount = computed(() => calendarPageCount(this.sortedItems().length));
  readonly currentPage = computed(() => clampCalendarPage(this.query().page, this.sortedItems().length));
  readonly pageWindow = computed(() => paginationPageWindow(this.currentPage(), this.pageCount()));
  readonly pagedItems = computed(() => paginateEvents(this.sortedItems(), this.query().page));
  readonly groups = computed(() => groupEventsByVenueDate(this.pagedItems()));
  readonly monthLabel = computed(() => this.i18n.formatDate(`${this.query().month}-01`, { month: 'long', year: 'numeric' }));
  readonly monthDays = computed(() => buildMonthDays(this.query().month));
  // ARIA requires grid > row > gridcell; the rows use `display: contents` so the CSS grid is unchanged.
  readonly monthWeeks = computed(() => chunkIntoWeeks(this.monthDays()));
  // Named apart from the `eventsByDate` helper it wraps: the two would otherwise differ only by a
  // `this.`, which is a trap for the next reader rather than a nicety.
  readonly dayEventIndex = computed(() => eventsByDate(this.availableItems()));
  readonly createEventMembershipState = signal<'idle' | 'loading' | 'enabled' | 'empty' | 'failed'>('idle');
  readonly showCreateEvent = computed(() => {
    const role = this.auth.profile()?.globalRole;
    return role === 'Organizer' || role === 'Admin';
  });
  readonly canCreateEvent = computed(() => this.auth.profile()?.emailVerified === true && this.createEventMembershipState() === 'enabled');
  readonly createEventDisabledReason = computed(() => {
    if (!this.showCreateEvent() || this.canCreateEvent()) return null;
    if (this.auth.profile()?.emailVerified !== true) return this.i18n.t('event.createRequiresVerifiedEmail');
    if (this.createEventMembershipState() === 'empty') return this.i18n.t('event.createRequiresOrganization');
    if (this.createEventMembershipState() === 'failed') return this.i18n.t('event.createOrganizationsUnavailable');
    return this.i18n.t('event.createCheckingOrganizations');
  });
  readonly registrationCapabilities = signal<Record<string, EventRegistrationCapabilityResponse>>({});
  readonly pendingEventId = signal<string | null>(null);
  readonly registrationMessageKey = signal<MessageKey | null>(null);
  private readonly capabilityWatcher = effect(() => {
    const profile = this.auth.profile();
    const view = this.query().view;
    const visible = this.pagedItems();
    queueMicrotask(() => { void this.refreshVisibleCapabilities(view === 'list' ? visible : [], profile); });
  });
  private readonly createCapabilityWatcher = effect(() => {
    const profile = this.auth.profile();
    queueMicrotask(() => { void this.loadCreateCapability(profile); });
  });

  ngOnInit(): void {
    this.subscription = this.route.queryParamMap.subscribe(params => {
      const query = readEventListQuery(params, this.preferredView());
      this.query.set(query);
      this.searchDraft.set(query.q);
    });
    void this.initialize();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.capabilityWatcher.destroy();
    this.createCapabilityWatcher.destroy();
    this.capabilityGeneration++;
    this.createCapabilityGeneration++;
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
  }

  /**
   * Two separate things move the page under a reader who types while scrolled down, and the fix has
   * to answer both. The results narrow on the keystroke, so the document shrinks and the browser
   * clamps the scroll position down with it — pinning the page height holds it still until the
   * search settles. Then the debounced URL write is a query-param navigation on the same route, so
   * the router's `scrollPositionRestoration: 'enabled'` treats it as a fresh page and scrolls to the
   * top; `scroll: 'manual'` opts that one navigation out, exactly as month navigation does.
   */
  setSearchDraft(value: string): void {
    this.pageMinHeight.set(this.calendarPage?.nativeElement.offsetHeight ?? null);
    this.searchDraft.set(value);
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => { void this.commitSearch(); }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * The pin is released here rather than from a `requestAnimationFrame`: the results settled on the
   * keystroke 300 ms ago, so there is no later layout to wait for, and a hidden tab never runs the
   * frame callback at all — which would strand the page at the pinned height.
   */
  private async commitSearch(): Promise<void> {
    await this.navigate({ ...this.query(), q: this.searchDraft(), page: 1 }, { scroll: 'manual' });
    this.pageMinHeight.set(null);
  }

  sync(): void { void Promise.all([this.load({ force: true }), this.loadCreateCapability()]); }
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
  setFilter<K extends keyof EventListFilters>(field: K, value: EventListFilters[K]): void {
    const next = { ...this.query(), [field]: value, page: 1 };
    if (field === 'from' && value && next.to && value > next.to) next.to = String(value);
    if (field === 'to' && value && next.from && value < next.from) next.from = String(value);
    void this.navigate(next);
  }
  setCountryFilter(country: string): void {
    void this.navigate({ ...this.query(), country, region: '', city: '', page: 1 });
  }
  setRegionFilter(region: string): void {
    void this.navigate({ ...this.query(), region, city: '', page: 1 });
  }
  eventTypeLabel(type: typeof EVENT_TYPES[number]): string { return this.i18n.t(`event.type.${type}`); }
  goPage(page: number): void {
    const next = clampCalendarPage(page, this.sortedItems().length);
    if (next === this.currentPage()) return;
    void this.navigate({ ...this.query(), page: next });
  }
  reload(): void { void this.load(); }
  date(item: PublicEventView) { return eventDatePresentation(item, this.i18n.locale()); }
  openEvent(item: PublicEventView, event?: Event): void { event?.preventDefault(); void this.router.navigate(['/events', item.slug]); }
  showCardRegister(item: PublicEventView): boolean {
    return this.auth.profile() === null || this.registrationCapabilities()[item.id]?.canRegister === true;
  }
  cardActionsDisabled(item: PublicEventView): boolean { return hasEventStarted(item, new Date()); }
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
  venue(item: PublicEventView): string { return [item.venue.streetAddress, item.venue.postalCode, item.venue.city, item.venue.region, item.venue.country].filter(Boolean).join(', '); }
  cardMapsUrl(item: PublicEventView): string | null { return venueMapsUrl(item.venue); }
  formatGroupDate(group: VenueDateGroup): string { return this.i18n.formatDate(group.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  isPast(date: string): boolean { return isPastCalendarDay(date, this.today()); }
  highlightParts(text: string): HighlightPart[] { return highlightSearchText(text, this.searchDraft()); }
  dayEvents(date: string): PublicEventView[] { return this.dayEventIndex().get(date) ?? []; }
  visibleDayEvents(date: string): PublicEventView[] { return this.dayEvents(date).slice(0, MAX_DAY_CELL_EVENTS); }
  hiddenDayEventCount(date: string): number { return Math.max(0, this.dayEvents(date).length - MAX_DAY_CELL_EVENTS); }

  private async initialize(): Promise<void> {
    await Promise.all([this.load(), this.auth.whenSessionReady()]);
    await this.initializeSearch();
    await this.loadCreateCapability();
    await this.resumeRegistrationIntent();
  }

  private async initializeSearch(): Promise<void> {
    if (hasSearchFilterParams(this.initialParams)) return;
    const stored = readStoredEventSearch(localStorage, this.searchStorageKey());
    const location = stored ? {} : await this.profileLocation();
    const filters = stored?.filters ?? defaultEventListFilters(new Date(), location);
    const query = { ...this.query(), ...filters, q: stored?.q ?? this.query().q, page: 1 };
    this.query.set(query);
    this.searchDraft.set(query.q);
    await this.navigate(query, { replaceUrl: true });
  }

  private async profileLocation(): Promise<Partial<Pick<EventListFilters, 'country' | 'region' | 'city'>>> {
    const profile = this.auth.profile();
    if (!profile) return {};
    let country = profile.locationCountry?.trim() ?? '';
    let region = profile.locationRegion?.trim() ?? '';
    try {
      const countries = await this.geo.countries();
      const selectedCountry = countries.find(option => option.code === country || option.name === country);
      if (selectedCountry) {
        country = selectedCountry.name;
        const regions = await this.geo.regions(selectedCountry.code);
        region = regions.find(option => option.code === region || option.name === region)?.name ?? region;
      }
    } catch { /* Profile text remains usable when geo assets fail. */ }
    return { country, region, city: profile.locationCity?.trim() ?? '' };
  }

  private async loadCreateCapability(profile = this.auth.profile()): Promise<void> {
    const generation = ++this.createCapabilityGeneration;
    const role = profile?.globalRole;
    if (!profile || (role !== 'Organizer' && role !== 'Admin') || profile.emailVerified !== true) {
      this.createEventMembershipState.set('idle');
      return;
    }
    this.createEventMembershipState.set('loading');
    try {
      const organizations = await firstValueFrom(this.client.organizationsAll());
      if (generation === this.createCapabilityGeneration && this.auth.profile()?.id === profile.id) {
        this.createEventMembershipState.set(organizations.length ? 'enabled' : 'empty');
      }
    } catch {
      if (generation === this.createCapabilityGeneration && this.auth.profile()?.id === profile.id) {
        this.createEventMembershipState.set('failed');
      }
    }
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

  private navigate(query: EventListQuery, extras: { scroll?: 'manual'; replaceUrl?: boolean } = {}): Promise<boolean> {
    writeStoredEventSearch(localStorage, this.searchStorageKey(), query.q, {
      from: query.from,
      to: query.to,
      country: query.country,
      region: query.region,
      city: query.city,
      format: query.format,
      eventType: query.eventType
    });
    return this.router.navigate([], { relativeTo: this.route, queryParams: buildEventListQueryParams(query), ...extras });
  }
  private searchStorageKey(): string { return `${SEARCH_KEY}.${this.auth.profile()?.id ?? 'anonymous'}`; }
  private preferredView(): CalendarView {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'calendar'; } catch { return 'calendar'; }
  }
}

/** Splits the flat 42-cell month into the seven-day rows ARIA's grid pattern requires. */
function hasSearchFilterParams(params: import('@angular/router').ParamMap): boolean {
  return ['q', 'from', 'to', 'country', 'region', 'city', 'format', 'type'].some(key => params.has(key));
}

function chunkIntoWeeks(days: MonthDay[]): MonthDay[][] {
  const weeks: MonthDay[][] = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));
  return weeks;
}


