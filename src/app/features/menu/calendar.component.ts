import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { BackButtonComponent } from '../../shared/back-button.component';

interface CalendarEvent {
  day: string;
  month: string;
  title: string;
  format: string;
  note: string;
  status: string;
}

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" label="Back to Home" position="top" />
    <section class="info-page calendar-page" aria-labelledby="calendar-title">
      <div class="info-hero calendar-hero">
        <p class="kicker">Tournament calendar</p>
        <h1 id="calendar-title">Upcoming nights will live here.</h1>
        <p>The calendar page is ready for scheduled tournaments, league nights, special formats, and organizer notes.</p>
      </div>

      <section class="calendar-board" aria-label="Upcoming tournament placeholders">
        @for (event of events; track event.title) {
          <article class="calendar-event">
            <time class="calendar-date"><span>{{ event.month }}</span><strong>{{ event.day }}</strong></time>
            <div>
              <span class="calendar-status">{{ event.status }}</span>
              <h2>{{ event.title }}</h2>
              <p>{{ event.format }}</p>
              <small>{{ event.note }}</small>
            </div>
          </article>
        }
      </section>

      <section class="calendar-empty-callout" aria-labelledby="calendar-empty-title">
        <div>
          <p class="kicker">Organizer tools coming later</p>
          <h2 id="calendar-empty-title">Publish once, let players plan ahead.</h2>
        </div>
        <p>Future calendar tools can connect tournament records, locations, formats, registration links, and league seasons.</p>
      </section>

      <div class="info-actions">
        <a mat-flat-button class="home-primary-action" routerLink="/leagues">Open current leagues</a>
        <a mat-stroked-button class="secondary-action" routerLink="/about">About Gones</a>
      </div>
    </section>
    <gones-back-button [link]="['/']" label="Back to Home" position="bottom" />
  `
})
export class CalendarComponent {
  readonly events: CalendarEvent[] = [
    { month: 'Soon', day: '01', title: 'League night', format: 'Constructed tournament', note: 'Date, venue, and registration details will be added here.', status: 'Planned' },
    { month: 'Soon', day: '02', title: 'Season checkpoint', format: 'League standings review', note: 'A place for standings exports and organizer announcements.', status: 'Draft' },
    { month: 'Soon', day: '03', title: 'Special format event', format: 'Community format to be confirmed', note: 'Future support can add format pages, prizes, and deck notes.', status: 'Future' }
  ];
}
