import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { CalendarEventRepository } from '../../data/calendar-event-repository.service';
import { buildCalendarIcs, calendarIcsFilename } from '../../domain/calendar-ics';
import { CalendarEventDocument, createCalendarEvent, normalizeCalendarEvent, normalizeSlug } from '../../domain/models';
import { logBoundaryError, logBoundaryInfo } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { saveTextFile } from '../../shared/save-text-file';
import { I18nService } from '../../i18n/i18n.service';

interface CalendarDay {
  date: string;
  dayNumber: number;
  inMonth: boolean;
  events: CalendarEventDocument[];
}

const COUNTRIES = ['France', 'Germany', 'Italy', 'Spain', 'United Kingdom', 'United States'] as const;

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatMenuModule, MatSelectModule, MatTabsModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    <section class="info-page calendar-page" aria-labelledby="calendar-title">
      <h1 id="calendar-title" class="sr-only">{{ i18n.t('calendar.title') }}</h1>

      <section class="calendar-toolbar" [attr.aria-label]="i18n.t('calendar.navAria')">
        <div class="calendar-month-controls">
          <button mat-stroked-button class="secondary-action" type="button" (click)="previousMonth()">{{ i18n.t('common.previous') }}</button>
          <h2>{{ monthLabel() }}</h2>
          <button mat-stroked-button class="secondary-action" type="button" (click)="nextMonth()">{{ i18n.t('common.next') }}</button>
        </div>
        <button mat-stroked-button class="secondary-action calendar-download-button" type="button" [disabled]="!events().length" (click)="downloadAllEvents()">{{ i18n.t('calendar.downloadIcs') }}</button>
      </section>

      <mat-tab-group class="calendar-tabs" mat-stretch-tabs="false" animationDuration="150ms">
        <mat-tab [label]="i18n.t('calendar.tabCalendar')">
          <section class="classic-calendar" role="grid" [attr.aria-label]="i18n.t('calendar.monthAria')">
            <div class="classic-calendar__weekday" role="columnheader">{{ i18n.t('calendar.weekday.sun') }}</div>
            <div class="classic-calendar__weekday" role="columnheader">{{ i18n.t('calendar.weekday.mon') }}</div>
            <div class="classic-calendar__weekday" role="columnheader">{{ i18n.t('calendar.weekday.tue') }}</div>
            <div class="classic-calendar__weekday" role="columnheader">{{ i18n.t('calendar.weekday.wed') }}</div>
            <div class="classic-calendar__weekday" role="columnheader">{{ i18n.t('calendar.weekday.thu') }}</div>
            <div class="classic-calendar__weekday" role="columnheader">{{ i18n.t('calendar.weekday.fri') }}</div>
            <div class="classic-calendar__weekday" role="columnheader">{{ i18n.t('calendar.weekday.sat') }}</div>
            @for (day of monthDays(); track day.date) {
              <article class="classic-calendar__day" role="gridcell" [attr.aria-label]="dayLabel(day)" [class.classic-calendar__day--muted]="!day.inMonth">
                <button class="classic-calendar__day-add" type="button" [disabled]="saving()" [attr.aria-label]="addEventLabel(day)" (click)="startEventOnDate(day.date)"><time [attr.datetime]="day.date">{{ day.dayNumber }}</time></button>
                @for (event of day.events; track event.id) {
                  <button class="calendar-pill" type="button" [attr.aria-label]="editEventLabel(event)" (click)="editEvent(event)">{{ event.startTime || i18n.t('common.allDay') }} {{ event.title }}</button>
                }
              </article>
            }
          </section>
        </mat-tab>
        <mat-tab [label]="i18n.t('calendar.tabUpcoming')">
          <section class="calendar-board calendar-board--tab" [attr.aria-label]="i18n.t('calendar.upcomingAria')">
            @if (upcomingEvents().length) {
              @for (event of upcomingEvents(); track event.id) {
                <ng-container *ngTemplateOutlet="eventCard; context: { $implicit: event }" />
              }
            } @else if (loading()) {
              <section class="calendar-empty-callout" aria-live="polite"><div><p class="kicker">{{ i18n.t('common.loading') }}</p><h2>{{ i18n.t('calendar.loadingPages') }}</h2></div></section>
            } @else {
              <section class="calendar-empty-callout" aria-labelledby="calendar-empty-title">
                <div><p class="kicker">{{ i18n.t('calendar.noUpcomingKicker') }}</p><h2 id="calendar-empty-title">{{ i18n.t('calendar.noUpcomingTitle') }}</h2></div>
                <p>{{ i18n.t('calendar.noUpcomingHelp') }}</p>
              </section>
            }
          </section>
        </mat-tab>
      </mat-tab-group>

      <section #calendarEditor class="calendar-editor panel" [attr.aria-label]="i18n.t('calendar.editorAria')" [attr.aria-busy]="saving()">
          <div class="section-header">
            <div>
              <p class="kicker">{{ editingExisting() ? i18n.t('calendar.editEventPage') : i18n.t('calendar.eventPage') }}</p>
            </div>
            @if (editingExisting()) { <a mat-stroked-button class="secondary-action" [routerLink]="['/events', draft().slug]">{{ i18n.t('calendar.viewPage') }}</a> }
          </div>
          <form class="calendar-form event-form" (ngSubmit)="saveEvent()">
            <mat-form-field appearance="outline"><mat-label>{{ i18n.t('calendar.eventName') }}</mat-label><input matInput name="title" required [ngModel]="draft().title" (ngModelChange)="updateTitle($event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>{{ i18n.t('calendar.slug') }}</mat-label><input matInput name="slug" required [ngModel]="draft().slug" (ngModelChange)="updateDraft('slug', normalizeSlugInput($event))" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>{{ i18n.t('common.date') }}</mat-label><input matInput name="eventDate" type="date" required [ngModel]="draft().eventDate" (ngModelChange)="updateDraft('eventDate', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>{{ i18n.t('calendar.startTime') }}</mat-label><input matInput name="startTime" type="time" [ngModel]="draft().startTime" (ngModelChange)="updateDraft('startTime', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>{{ i18n.t('calendar.endTime') }}</mat-label><input matInput name="endTime" type="time" [ngModel]="draft().endTime" (ngModelChange)="updateDraft('endTime', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>{{ i18n.t('calendar.country') }}</mat-label><mat-select name="country" [ngModel]="draft().country" (ngModelChange)="updateCountry($event)" [disabled]="saving()"><mat-option value="">{{ i18n.t('calendar.selectCountry') }}</mat-option><mat-option *ngFor="let country of countries" [value]="country">{{ country }}</mat-option></mat-select></mat-form-field>
            <mat-form-field appearance="outline" class="calendar-form__double"><mat-label>{{ i18n.t('calendar.address') }}</mat-label><input matInput name="address" autocomplete="street-address" [disabled]="saving() || !draft().country.trim()" [ngModel]="draft().address" (ngModelChange)="updateCombinedAddress($event)"><mat-hint>{{ i18n.t('calendar.addressHint') }}</mat-hint></mat-form-field>
            <mat-form-field appearance="outline" class="calendar-form__wide"><mat-label>{{ i18n.t('calendar.plainSummary') }}</mat-label><textarea matInput name="description" rows="3" [ngModel]="draft().description" (ngModelChange)="updateDraft('description', $event)" [readonly]="saving()"></textarea></mat-form-field>
            <mat-form-field appearance="outline" class="calendar-form__wide"><mat-label>{{ i18n.t('calendar.externalLink') }}</mat-label><input matInput name="externalLink" type="url" [ngModel]="draft().externalLink" (ngModelChange)="updateDraft('externalLink', $event)" [readonly]="saving()"></mat-form-field>

            <section class="calendar-form__wide rich-editor" aria-labelledby="rich-editor-title">
              <div class="rich-editor__toolbar" [attr.aria-label]="i18n.t('calendar.richToolbarAria')">
                <h3 id="rich-editor-title">{{ i18n.t('calendar.richTitle') }}</h3>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="formatBlock('H2')">{{ i18n.t('calendar.header') }}</button>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="formatBlock('P')">{{ i18n.t('calendar.paragraph') }}</button>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="formatText('bold')">{{ i18n.t('calendar.bold') }}</button>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="formatText('italic')">{{ i18n.t('calendar.italic') }}</button>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="formatText('insertUnorderedList')">{{ i18n.t('calendar.list') }}</button>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="insertImage()">{{ i18n.t('calendar.imageUrl') }}</button>
              </div>
              <div #richEditor class="rich-editor__surface" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="rich-editor-title" [attr.aria-disabled]="saving()" (input)="syncRichDescription()" (blur)="syncRichDescription()"></div>
            </section>

            <div class="actions calendar-form__wide">
              <button mat-flat-button class="home-primary-action" type="submit" [disabled]="saving() || !draft().title.trim() || !draft().eventDate || !draft().slug.trim()">{{ saving() ? i18n.t('common.saving') : i18n.t('calendar.saveEvent') }}</button>
            </div>
          </form>
      </section>

      <ng-template #eventCard let-event>
        <article class="calendar-event">
          <time class="calendar-date" [attr.datetime]="event.eventDate"><span>{{ eventMonth(event) }}</span><strong>{{ eventDay(event) }}</strong></time>
          <div class="calendar-event__body">
            <span class="calendar-status">{{ eventTime(event) }}</span>
            <h2><a [routerLink]="['/events', event.slug]">{{ event.title }}</a></h2>
            @if (eventLocation(event)) { <p>{{ eventLocation(event) }}</p> }
            @if (event.description) { <small>{{ event.description }}</small> }
            <div class="calendar-event__actions">
              <a mat-stroked-button class="secondary-action" [routerLink]="['/events', event.slug]">{{ i18n.t('calendar.viewPage') }}</a>
              <button mat-stroked-button class="secondary-action" type="button" [attr.aria-label]="editEventLabel(event)" (click)="editEvent(event)">{{ i18n.t('common.edit') }}</button>
              <button mat-stroked-button class="secondary-action" type="button" [attr.aria-label]="downloadEventLabel(event)" (click)="downloadEvent(event)">{{ i18n.t('calendar.addToCalendar') }}</button>
              <button mat-button color="warn" type="button" [disabled]="deletingEventId() === event.id" [attr.aria-label]="deleteEventLabel(event)" (click)="confirmDelete(event)">{{ deletingEventId() === event.id ? i18n.t('common.deleting') : i18n.t('common.delete') }}</button>
            </div>
          </div>
        </article>
      </ng-template>
    </section>
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" />
  `
})
export class CalendarComponent implements OnInit {
  readonly i18n = inject(I18nService);
  @ViewChild('richEditor') private richEditor?: ElementRef<HTMLElement>;
  @ViewChild('calendarEditor') private calendarEditor?: ElementRef<HTMLElement>;

  readonly countries = COUNTRIES;
  readonly events = signal<CalendarEventDocument[]>([]);
  readonly draft = signal<CalendarEventDocument>(createCalendarEvent());
  readonly editingExisting = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly deletingEventId = signal('');
  readonly error = signal('');
  readonly visibleMonth = signal(startOfMonth(new Date()));
  readonly monthLabel = computed(() => this.visibleMonth().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  readonly upcomingEvents = computed(() => this.events().filter((event) => event.eventDate >= todayDateInputValue()));
  readonly monthDays = computed(() => buildMonthDays(this.visibleMonth(), this.events()));
  private loadRequest = 0;

  constructor(private readonly repo: CalendarEventRepository, private readonly dialog: MatDialog) {}
  async ngOnInit(): Promise<void> { await this.load(); }

  @HostListener('document:keydown', ['$event'])
  handleShortcut(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.saveEvent();
    }
  }

  async load(): Promise<void> {
    const request = ++this.loadRequest;
    this.loading.set(true);
    try {
      const events = await this.repo.list();
      if (request !== this.loadRequest) return;
      this.events.set(events);
      this.error.set('');
      logBoundaryInfo('calendar.load.success', { eventCount: events.length });
    } catch (error) {
      if (request === this.loadRequest) {
        logBoundaryError('calendar.load', error);
        this.error.set(this.i18n.t('calendar.loadFailed'));
      }
    } finally {
      if (request === this.loadRequest) this.loading.set(false);
    }
  }

  startNewEvent(): void {
    this.editingExisting.set(false);
    this.setDraft(createCalendarEvent({ eventDate: toDateInputValue(this.visibleMonth()) }));
  }

  startEventOnDate(eventDate: string): void {
    if (this.saving()) return;
    this.editingExisting.set(false);
    this.visibleMonth.set(startOfMonth(new Date(`${eventDate}T00:00:00`)));
    this.setDraft(createCalendarEvent({ eventDate }));
    this.scrollToForm();
  }

  editEvent(event: CalendarEventDocument): void {
    this.editingExisting.set(true);
    this.setDraft(structuredClone(event));
  }

  updateTitle(value: string): void {
    this.draft.update((draft) => ({ ...draft, title: value, slug: draft.slug && draft.slug !== normalizeSlug(draft.title) ? draft.slug : normalizeSlug(value) }));
  }

  updateDraft(field: keyof CalendarEventDocument, value: string): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  updateCountry(value: string): void {
    this.draft.update((draft) => {
      const country = String(value ?? '');
      const next = country.trim() ? { ...draft, country } : { ...draft, country, address: '', city: '' };
      return { ...next, location: [next.address, next.city, next.country].filter(Boolean).join(', ') };
    });
  }

  updateCombinedAddress(value: string): void {
    this.draft.update((draft) => {
      const next = { ...draft, address: String(value ?? ''), city: '' };
      return { ...next, location: [next.address, next.country].filter(Boolean).join(', ') };
    });
  }

  resetDraft(): void {
    this.editingExisting.set(false);
    this.setDraft(createCalendarEvent({ eventDate: toDateInputValue(this.visibleMonth()) }));
  }

  async saveEvent(): Promise<void> {
    this.syncRichDescription();
    if (this.saving() || !this.draft().title.trim() || !this.draft().eventDate || !this.draft().slug.trim()) return;
    this.saving.set(true);
    const savedDraft = normalizeCalendarEvent(this.draft());
    try {
      await this.repo.save(savedDraft);
      await this.load();
      logBoundaryInfo('calendar.saveEvent.success', { eventId: savedDraft.id, slug: savedDraft.slug });
      if (this.draft().id === savedDraft.id) this.resetDraft();
    } catch (error) {
      logBoundaryError('calendar.saveEvent', error, { eventId: savedDraft.id });
      this.error.set(this.i18n.t('calendar.saveFailed'));
    } finally { this.saving.set(false); }
  }

  async confirmDelete(event: CalendarEventDocument): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: this.i18n.t('calendar.deleteTitle'), message: this.i18n.t('calendar.deleteMessage', { name: event.title }), confirmLabel: this.i18n.t('calendar.deleteConfirm'), destructive: true } }).afterClosed());
    if (!confirmed) return;
    this.deletingEventId.set(event.id);
    try { await this.repo.delete(event.id); await this.load(); logBoundaryInfo('calendar.deleteEvent.success', { eventId: event.id }); if (this.draft().id === event.id) this.resetDraft(); }
    catch (error) { logBoundaryError('calendar.deleteEvent', error, { eventId: event.id }); this.error.set(this.i18n.t('calendar.deleteFailed')); }
    finally { this.deletingEventId.set(''); }
  }

  formatBlock(tagName: 'H2' | 'P'): void {
    this.focusEditor();
    document.execCommand('formatBlock', false, tagName);
    this.syncRichDescription();
  }

  formatText(command: 'bold' | 'italic' | 'insertUnorderedList'): void {
    this.focusEditor();
    document.execCommand(command);
    this.syncRichDescription();
  }

  insertImage(): void {
    const url = window.prompt(this.i18n.t('calendar.imagePrompt'));
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error('unsupportedImageUrl');
      const alt = window.prompt(this.i18n.t('calendar.imageAltPrompt')) ?? '';
      this.focusEditor();
      document.execCommand('insertHTML', false, `<img src="${parsed.toString().replaceAll('"', '&quot;')}" alt="${alt.replaceAll('"', '&quot;')}" loading="lazy">`);
      this.syncRichDescription();
    } catch {
      this.error.set(this.i18n.t('calendar.badImageUrl'));
    }
  }

  syncRichDescription(): void {
    const html = this.richEditor?.nativeElement.innerHTML ?? this.draft().richDescriptionHtml;
    this.draft.update((draft) => ({ ...draft, richDescriptionHtml: html }));
  }

  previousMonth(): void { this.visibleMonth.set(addMonths(this.visibleMonth(), -1)); }
  nextMonth(): void { this.visibleMonth.set(addMonths(this.visibleMonth(), 1)); }

  downloadAllEvents(): void {
    const filename = 'gones-calendar.ics';
    try {
      saveTextFile(buildCalendarIcs(this.events()), filename, 'text/calendar;charset=utf-8');
      logBoundaryInfo('calendar.downloadAllEvents.success', { eventCount: this.events().length, filename });
    } catch (error) {
      logBoundaryError('calendar.downloadAllEvents', error, { eventCount: this.events().length, filename });
      this.error.set(this.i18n.t('calendar.downloadAllFailed'));
    }
  }

  downloadEvent(event: CalendarEventDocument): void {
    const filename = calendarIcsFilename(event);
    try {
      saveTextFile(buildCalendarIcs([event], { calendarName: event.title }), filename, 'text/calendar;charset=utf-8');
      logBoundaryInfo('calendar.downloadEvent.success', { eventId: event.id, filename });
    } catch (error) {
      logBoundaryError('calendar.downloadEvent', error, { eventId: event.id, filename });
      this.error.set(this.i18n.t('calendar.downloadOneFailed'));
    }
  }

  normalizeSlugInput(value: string): string { return normalizeSlug(value); }
  eventLocation(event: CalendarEventDocument): string { return [event.address, event.city, event.country].filter(Boolean).join(', ') || event.location; }
  dayLabel(day: CalendarDay): string { return this.i18n.t('calendar.dayLabel', { date: new Date(`${day.date}T00:00:00`).toLocaleDateString(this.i18n.locale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), count: day.events.length, eventsWord: day.events.length === 1 ? this.i18n.t('calendar.eventWord') : this.i18n.t('calendar.eventsWord') }); }
  addEventLabel(day: CalendarDay): string { return this.i18n.t('calendar.addEventLabel', { date: new Date(`${day.date}T00:00:00`).toLocaleDateString(this.i18n.locale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) }); }
  editEventLabel(event: CalendarEventDocument): string { return this.i18n.t('calendar.editEventLabel', { title: event.title, date: event.eventDate, time: event.startTime ? this.i18n.t('calendar.editEventAt', { time: event.startTime }) : '' }); }
  downloadEventLabel(event: CalendarEventDocument): string { return this.i18n.t('calendar.downloadEventLabel', { title: event.title }); }
  deleteEventLabel(event: CalendarEventDocument): string { return this.i18n.t('calendar.deleteEventLabel', { title: event.title }); }
  eventMonth(event: CalendarEventDocument): string { return monthShort(event.eventDate); }
  eventDay(event: CalendarEventDocument): string { return String(new Date(`${event.eventDate}T00:00:00`).getDate()).padStart(2, '0'); }
  eventTime(event: CalendarEventDocument): string { return event.startTime ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : this.i18n.t('common.allDay'); }

  private setDraft(event: CalendarEventDocument): void {
    const normalized = normalizeCalendarEvent(event);
    this.draft.set(normalized);
    setTimeout(() => {
      if (this.richEditor) this.richEditor.nativeElement.innerHTML = normalized.richDescriptionHtml;
    });
  }

  private scrollToForm(): void {
    setTimeout(() => {
      const editor = this.calendarEditor?.nativeElement;
      if (!editor) return;
      const top = editor.getBoundingClientRect().top + window.scrollY - 8;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  }

  private focusEditor(): void { this.richEditor?.nativeElement.focus(); }
}

function buildMonthDays(month: Date, events: CalendarEventDocument[]): CalendarDay[] {
  const first = startOfMonth(month);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dateString = toDateInputValue(date);
    return { date: dateString, dayNumber: date.getDate(), inMonth: date.getMonth() === month.getMonth(), events: events.filter((event) => event.eventDate === dateString) };
  });
}

function startOfMonth(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addMonths(date: Date, count: number): Date { return new Date(date.getFullYear(), date.getMonth() + count, 1); }
function toDateInputValue(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function todayDateInputValue(): string { return toDateInputValue(new Date()); }
function monthShort(date: string): string { return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short' }); }
