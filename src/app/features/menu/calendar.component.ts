import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, signal } from '@angular/core';
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
    <gones-back-button [link]="['/']" label="Return to Menu" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    <section class="info-page calendar-page" aria-labelledby="calendar-title">
      <h1 id="calendar-title" class="sr-only">Tournament events calendar</h1>

      <section class="calendar-toolbar" aria-label="Calendar navigation">
        <div class="calendar-month-controls">
          <button mat-stroked-button class="secondary-action" type="button" (click)="previousMonth()">Previous</button>
          <h2>{{ monthLabel() }}</h2>
          <button mat-stroked-button class="secondary-action" type="button" (click)="nextMonth()">Next</button>
        </div>
        <button mat-stroked-button class="secondary-action calendar-download-button" type="button" [disabled]="!events().length" (click)="downloadAllEvents()">Download Calendar ICS</button>
      </section>

      <mat-tab-group class="calendar-tabs" mat-stretch-tabs="false" animationDuration="150ms">
        <mat-tab label="Calendar">
          <section class="classic-calendar" role="grid" aria-label="Monthly calendar">
            <div class="classic-calendar__weekday" role="columnheader">Sun</div>
            <div class="classic-calendar__weekday" role="columnheader">Mon</div>
            <div class="classic-calendar__weekday" role="columnheader">Tue</div>
            <div class="classic-calendar__weekday" role="columnheader">Wed</div>
            <div class="classic-calendar__weekday" role="columnheader">Thu</div>
            <div class="classic-calendar__weekday" role="columnheader">Fri</div>
            <div class="classic-calendar__weekday" role="columnheader">Sat</div>
            @for (day of monthDays(); track day.date) {
              <article class="classic-calendar__day" role="gridcell" [attr.aria-label]="dayLabel(day)" [class.classic-calendar__day--muted]="!day.inMonth">
                <button class="classic-calendar__day-add" type="button" [disabled]="saving()" [attr.aria-label]="addEventLabel(day)" (click)="startEventOnDate(day.date)"><time [attr.datetime]="day.date">{{ day.dayNumber }}</time></button>
                @for (event of day.events; track event.id) {
                  <button class="calendar-pill" type="button" [attr.aria-label]="editEventLabel(event)" (click)="editEvent(event)">{{ event.startTime || 'All day' }} {{ event.title }}</button>
                }
              </article>
            }
          </section>
        </mat-tab>
        <mat-tab label="Upcoming tournaments">
          <section class="calendar-board calendar-board--tab" aria-label="Upcoming events">
            @if (upcomingEvents().length) {
              @for (event of upcomingEvents(); track event.id) {
                <ng-container *ngTemplateOutlet="eventCard; context: { $implicit: event }" />
              }
            } @else if (loading()) {
              <section class="calendar-empty-callout" aria-live="polite"><div><p class="kicker">Loading</p><h2>Loading event pages…</h2></div></section>
            } @else {
              <section class="calendar-empty-callout" aria-labelledby="calendar-empty-title">
                <div><p class="kicker">No upcoming events</p><h2 id="calendar-empty-title">Create the first tournament event.</h2></div>
                <p>Click any calendar day to prefill the event form with that date.</p>
              </section>
            }
          </section>
        </mat-tab>
      </mat-tab-group>

      <section #calendarEditor class="calendar-editor panel" aria-label="Calendar editor" [attr.aria-busy]="saving()">
          <div class="section-header">
            <div>
              <p class="kicker">{{ editingExisting() ? 'Edit event page' : 'Event page' }}</p>
            </div>
            @if (editingExisting()) { <a mat-stroked-button class="secondary-action" [routerLink]="['/events', draft().slug]">View Page</a> }
          </div>
          <form class="calendar-form event-form" (ngSubmit)="saveEvent()">
            <mat-form-field appearance="outline"><mat-label>Event name</mat-label><input matInput name="title" required [ngModel]="draft().title" (ngModelChange)="updateTitle($event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Slug</mat-label><input matInput name="slug" required [ngModel]="draft().slug" (ngModelChange)="updateDraft('slug', normalizeSlugInput($event))" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Date</mat-label><input matInput name="eventDate" type="date" required [ngModel]="draft().eventDate" (ngModelChange)="updateDraft('eventDate', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Start time</mat-label><input matInput name="startTime" type="time" [ngModel]="draft().startTime" (ngModelChange)="updateDraft('startTime', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Estimated finish</mat-label><input matInput name="endTime" type="time" [ngModel]="draft().endTime" (ngModelChange)="updateDraft('endTime', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Country</mat-label><mat-select name="country" [ngModel]="draft().country" (ngModelChange)="updateCountry($event)" [disabled]="saving()"><mat-option value="">Select a country</mat-option><mat-option *ngFor="let country of countries" [value]="country">{{ country }}</mat-option></mat-select></mat-form-field>
            <mat-form-field appearance="outline" class="calendar-form__double"><mat-label>City and address</mat-label><input matInput name="address" autocomplete="street-address" [disabled]="saving() || !draft().country.trim()" [ngModel]="draft().address" (ngModelChange)="updateCombinedAddress($event)"><mat-hint>Select a country first to enable address autocomplete.</mat-hint></mat-form-field>
            <mat-form-field appearance="outline" class="calendar-form__wide"><mat-label>Plain summary for calendar export</mat-label><textarea matInput name="description" rows="3" [ngModel]="draft().description" (ngModelChange)="updateDraft('description', $event)" [readonly]="saving()"></textarea></mat-form-field>
            <mat-form-field appearance="outline" class="calendar-form__wide"><mat-label>External link</mat-label><input matInput name="externalLink" type="url" [ngModel]="draft().externalLink" (ngModelChange)="updateDraft('externalLink', $event)" [readonly]="saving()"></mat-form-field>

            <section class="calendar-form__wide rich-editor" aria-labelledby="rich-editor-title">
              <div class="rich-editor__toolbar" aria-label="Rich description formatting controls">
                <h3 id="rich-editor-title">Event Description</h3>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="formatBlock('H2')">Header</button>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="formatBlock('P')">Paragraph</button>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="formatText('bold')">Bold</button>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="formatText('italic')">Italic</button>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="formatText('insertUnorderedList')">List</button>
                <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="insertImage()">Image URL</button>
              </div>
              <div #richEditor class="rich-editor__surface" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="rich-editor-title" [attr.aria-disabled]="saving()" (input)="syncRichDescription()" (blur)="syncRichDescription()"></div>
            </section>

            <div class="actions calendar-form__wide">
              <button mat-flat-button class="home-primary-action" type="submit" [disabled]="saving() || !draft().title.trim() || !draft().eventDate || !draft().slug.trim()">{{ saving() ? 'Saving…' : 'Save Event Ctrl+S' }}</button>
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
              <a mat-stroked-button class="secondary-action" [routerLink]="['/events', event.slug]">View Page</a>
              <button mat-stroked-button class="secondary-action" type="button" [attr.aria-label]="editEventLabel(event)" (click)="editEvent(event)">Edit</button>
              <button mat-stroked-button class="secondary-action" type="button" [attr.aria-label]="downloadEventLabel(event)" (click)="downloadEvent(event)">Add to Calendar</button>
              <button mat-button color="warn" type="button" [disabled]="deletingEventId() === event.id" [attr.aria-label]="deleteEventLabel(event)" (click)="confirmDelete(event)">{{ deletingEventId() === event.id ? 'Deleting…' : 'Delete' }}</button>
            </div>
          </div>
        </article>
      </ng-template>
    </section>
    <gones-back-button [link]="['/']" label="Return to Menu" position="bottom" />
  `
})
export class CalendarComponent implements OnInit {
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
        this.error.set('Could not load event pages.');
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
      this.error.set('Could not save this event page.');
    } finally { this.saving.set(false); }
  }

  async confirmDelete(event: CalendarEventDocument): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete Event', message: `Delete ${event.title}? This removes the public Event page and downloadable calendar date.`, confirmLabel: 'Delete Event', destructive: true } }).afterClosed());
    if (!confirmed) return;
    this.deletingEventId.set(event.id);
    try { await this.repo.delete(event.id); await this.load(); logBoundaryInfo('calendar.deleteEvent.success', { eventId: event.id }); if (this.draft().id === event.id) this.resetDraft(); }
    catch (error) { logBoundaryError('calendar.deleteEvent', error, { eventId: event.id }); this.error.set('Could not delete this event page.'); }
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
    const url = window.prompt('Image URL (https://...)');
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error('unsupportedImageUrl');
      const alt = window.prompt('Image alt text') ?? '';
      this.focusEditor();
      document.execCommand('insertHTML', false, `<img src="${parsed.toString().replaceAll('"', '&quot;')}" alt="${alt.replaceAll('"', '&quot;')}" loading="lazy">`);
      this.syncRichDescription();
    } catch {
      this.error.set('Use a valid https image URL.');
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
      this.error.set('Could not download the calendar file.');
    }
  }

  downloadEvent(event: CalendarEventDocument): void {
    const filename = calendarIcsFilename(event);
    try {
      saveTextFile(buildCalendarIcs([event], { calendarName: event.title }), filename, 'text/calendar;charset=utf-8');
      logBoundaryInfo('calendar.downloadEvent.success', { eventId: event.id, filename });
    } catch (error) {
      logBoundaryError('calendar.downloadEvent', error, { eventId: event.id, filename });
      this.error.set('Could not download this event file.');
    }
  }

  normalizeSlugInput(value: string): string { return normalizeSlug(value); }
  eventLocation(event: CalendarEventDocument): string { return [event.address, event.city, event.country].filter(Boolean).join(', ') || event.location; }
  dayLabel(day: CalendarDay): string { return `${new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}: ${day.events.length} ${day.events.length === 1 ? 'event' : 'events'}`; }
  addEventLabel(day: CalendarDay): string { return `Add event on ${new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`; }
  editEventLabel(event: CalendarEventDocument): string { return `Edit event ${event.title} on ${event.eventDate}${event.startTime ? ` at ${event.startTime}` : ''}`; }
  downloadEventLabel(event: CalendarEventDocument): string { return `Add ${event.title} to calendar`; }
  deleteEventLabel(event: CalendarEventDocument): string { return `Delete event ${event.title}`; }
  eventMonth(event: CalendarEventDocument): string { return monthShort(event.eventDate); }
  eventDay(event: CalendarEventDocument): string { return String(new Date(`${event.eventDate}T00:00:00`).getDate()).padStart(2, '0'); }
  eventTime(event: CalendarEventDocument): string { return event.startTime ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : 'All day'; }

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
