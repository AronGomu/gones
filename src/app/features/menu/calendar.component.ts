import { Component, HostListener, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { CalendarEventRepository } from '../../data/calendar-event-repository.service';
import { buildCalendarIcs, calendarIcsFilename } from '../../domain/calendar-ics';
import { CalendarEventDocument, createCalendarEvent, normalizeCalendarEvent } from '../../domain/models';
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

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatMenuModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" label="Back to Home" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    <section class="info-page calendar-page" aria-labelledby="calendar-title">
      <div class="info-hero calendar-hero">
        <p class="kicker">Tournament calendar</p>
        <h1 id="calendar-title">Plan the next night.</h1>
        <p>Add events once, edit them as details change, and export dates to any calendar app with ICS files.</p>
        <div class="info-actions">
          <button mat-flat-button class="home-primary-action" type="button" (click)="startNewEvent()">Add Event</button>
          <button mat-stroked-button class="secondary-action" type="button" [disabled]="!events().length" (click)="downloadAllEvents()">Download Calendar ICS</button>
        </div>
      </div>

      <section class="calendar-toolbar" aria-label="Calendar navigation">
        <button mat-stroked-button class="secondary-action" type="button" (click)="previousMonth()">Previous</button>
        <h2>{{ monthLabel() }}</h2>
        <button mat-stroked-button class="secondary-action" type="button" (click)="nextMonth()">Next</button>
      </section>

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
            <time [attr.datetime]="day.date">{{ day.dayNumber }}</time>
            @for (event of day.events; track event.id) {
              <button class="calendar-pill" type="button" [attr.aria-label]="editEventLabel(event)" (click)="editEvent(event)">{{ event.startTime || 'All day' }} {{ event.title }}</button>
            }
          </article>
        }
      </section>

      <section class="calendar-layout">
        <section class="calendar-editor panel" aria-labelledby="calendar-editor-title" [attr.aria-busy]="saving()">
          <div class="section-header">
            <div>
              <p class="kicker">{{ editingExisting() ? 'Edit event' : 'New event' }}</p>
              <h2 id="calendar-editor-title">{{ draft().title || 'Calendar event' }}</h2>
            </div>
          </div>
          <form class="calendar-form" (ngSubmit)="saveEvent()">
            <mat-form-field appearance="outline"><mat-label>Title</mat-label><input matInput name="title" required [ngModel]="draft().title" (ngModelChange)="updateDraft('title', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Date</mat-label><input matInput name="eventDate" type="date" required [ngModel]="draft().eventDate" (ngModelChange)="updateDraft('eventDate', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Start time</mat-label><input matInput name="startTime" type="time" [ngModel]="draft().startTime" (ngModelChange)="updateDraft('startTime', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>End time</mat-label><input matInput name="endTime" type="time" [ngModel]="draft().endTime" (ngModelChange)="updateDraft('endTime', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Location</mat-label><input matInput name="location" [ngModel]="draft().location" (ngModelChange)="updateDraft('location', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>External link</mat-label><input matInput name="externalLink" type="url" [ngModel]="draft().externalLink" (ngModelChange)="updateDraft('externalLink', $event)" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline" class="calendar-form__wide"><mat-label>Description</mat-label><textarea matInput name="description" rows="4" [ngModel]="draft().description" (ngModelChange)="updateDraft('description', $event)" [readonly]="saving()"></textarea></mat-form-field>
            <div class="actions calendar-form__wide">
              <button mat-stroked-button class="secondary-action" type="button" [disabled]="saving()" (click)="resetDraft()">Cancel Esc</button>
              <button mat-flat-button class="home-primary-action" type="submit" [disabled]="saving() || !draft().title.trim() || !draft().eventDate">{{ saving() ? 'Saving…' : 'Save Event Ctrl+S' }}</button>
            </div>
          </form>
        </section>

        <section class="calendar-board" aria-label="Upcoming events">
          @if (events().length) {
            @for (event of events(); track event.id) {
              <article class="calendar-event">
                <time class="calendar-date" [attr.datetime]="event.eventDate"><span>{{ eventMonth(event) }}</span><strong>{{ eventDay(event) }}</strong></time>
                <div class="calendar-event__body">
                  <span class="calendar-status">{{ eventTime(event) }}</span>
                  <h2>{{ event.title }}</h2>
                  @if (event.location) { <p>{{ event.location }}</p> }
                  @if (event.description) { <small>{{ event.description }}</small> }
                  @if (event.externalLink) { <a [href]="event.externalLink" target="_blank" rel="noopener">Event link</a> }
                  <div class="calendar-event__actions">
                    <button mat-stroked-button class="secondary-action" type="button" [attr.aria-label]="editEventLabel(event)" (click)="editEvent(event)">Edit</button>
                    <button mat-stroked-button class="secondary-action" type="button" [attr.aria-label]="downloadEventLabel(event)" (click)="downloadEvent(event)">Add to Calendar</button>
                    <button mat-button color="warn" type="button" [attr.aria-label]="deleteEventLabel(event)" (click)="confirmDelete(event)">Delete</button>
                  </div>
                </div>
              </article>
            }
          } @else {
            <section class="calendar-empty-callout" aria-labelledby="calendar-empty-title">
              <div><p class="kicker">No dates yet</p><h2 id="calendar-empty-title">Create the first calendar event.</h2></div>
              <p>Add a tournament night, league checkpoint, or special format event, then share it with players as an ICS calendar file.</p>
            </section>
          }
        </section>
      </section>
    </section>
    <gones-back-button [link]="['/']" label="Back to Home" position="bottom" />
  `
})
export class CalendarComponent implements OnInit {
  readonly events = signal<CalendarEventDocument[]>([]);
  readonly draft = signal<CalendarEventDocument>(createCalendarEvent());
  readonly editingExisting = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly visibleMonth = signal(startOfMonth(new Date()));
  readonly monthLabel = computed(() => this.visibleMonth().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  private loadRequest = 0;
  readonly monthDays = computed(() => buildMonthDays(this.visibleMonth(), this.events()));

  constructor(private readonly repo: CalendarEventRepository, private readonly dialog: MatDialog) {}

  async ngOnInit(): Promise<void> { await this.load(); }

  @HostListener('document:keydown', ['$event'])
  handleShortcut(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.saveEvent();
    }
    if (event.key === 'Escape') this.resetDraft();
  }

  async load(): Promise<void> {
    const request = ++this.loadRequest;
    try {
      const events = await this.repo.list();
      if (request !== this.loadRequest) return;
      this.events.set(events);
      this.error.set('');
      logBoundaryInfo('calendar.load.success', { eventCount: events.length });
    }
    catch (error) { if (request === this.loadRequest) { logBoundaryError('calendar.load', error); this.error.set('Could not load calendar events.'); } }
  }

  startNewEvent(): void {
    this.editingExisting.set(false);
    this.draft.set(createCalendarEvent({ eventDate: toDateInputValue(this.visibleMonth()) }));
  }

  editEvent(event: CalendarEventDocument): void {
    this.editingExisting.set(true);
    this.draft.set(structuredClone(event));
  }

  updateDraft(field: keyof CalendarEventDocument, value: string): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  resetDraft(): void {
    this.editingExisting.set(false);
    this.draft.set(createCalendarEvent({ eventDate: toDateInputValue(this.visibleMonth()) }));
  }

  async saveEvent(): Promise<void> {
    if (this.saving() || !this.draft().title.trim() || !this.draft().eventDate) return;
    this.saving.set(true);
    const savedDraft = this.draft();
    try {
      await this.repo.save(normalizeCalendarEvent(savedDraft));
      await this.load();
      logBoundaryInfo('calendar.saveEvent.success', { eventId: savedDraft.id });
      if (this.draft().id === savedDraft.id) this.resetDraft();
    } catch (error) {
      logBoundaryError('calendar.saveEvent', error, { eventId: savedDraft.id });
      this.error.set('Could not save this calendar event.');
    } finally { this.saving.set(false); }
  }

  async confirmDelete(event: CalendarEventDocument): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete Event', message: `Delete ${event.title}? This removes it from the downloadable calendar.`, confirmLabel: 'Delete Event', destructive: true } }).afterClosed());
    if (!confirmed) return;
    try { await this.repo.delete(event.id); await this.load(); logBoundaryInfo('calendar.deleteEvent.success', { eventId: event.id }); if (this.draft().id === event.id) this.resetDraft(); }
    catch (error) { logBoundaryError('calendar.deleteEvent', error, { eventId: event.id }); this.error.set('Could not delete this calendar event.'); }
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

  dayLabel(day: CalendarDay): string { return `${new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}: ${day.events.length} ${day.events.length === 1 ? 'event' : 'events'}`; }
  editEventLabel(event: CalendarEventDocument): string { return `Edit event ${event.title} on ${event.eventDate}${event.startTime ? ` at ${event.startTime}` : ''}`; }
  downloadEventLabel(event: CalendarEventDocument): string { return `Add ${event.title} to calendar`; }
  deleteEventLabel(event: CalendarEventDocument): string { return `Delete event ${event.title}`; }

  eventMonth(event: CalendarEventDocument): string { return monthShort(event.eventDate); }
  eventDay(event: CalendarEventDocument): string { return String(new Date(`${event.eventDate}T00:00:00`).getDate()).padStart(2, '0'); }
  eventTime(event: CalendarEventDocument): string { return event.startTime ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : 'All day'; }
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
function monthShort(date: string): string { return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short' }); }
