import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { CalendarEventRepository } from '../../data/calendar-event-repository.service';
import { LeagueRepository } from '../../data/league-repository.service';
import { CalendarEventDocument, PersistedLeague } from '../../domain/models';
import { logBoundaryError, logBoundaryInfo } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';

interface LinkedTournamentView {
  leagueId: string;
  tournamentId: string;
  leagueName: string;
  tournamentName: string;
  tournamentDate: string;
}

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/calendar']" label="Back to Events" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (loading()) { <section class="panel event-section" aria-live="polite" aria-busy="true"><p class="kicker">Loading</p><h1>Loading Event page…</h1></section> }
    @else if (event(); as eventPage) {
      <article class="event-page" aria-labelledby="event-title">
        <section class="event-hero panel">
          <p class="kicker">Tournament event</p>
          <h1 id="event-title">{{ eventPage.title }}</h1>
          <dl class="event-facts" aria-label="Event facts">
            <div><dt>Date</dt><dd>{{ formatDate(eventPage.eventDate) }}</dd></div>
            <div><dt>Hours</dt><dd>{{ eventTime(eventPage) }}</dd></div>
            @if (eventLocation(eventPage)) { <div><dt>Location</dt><dd>{{ eventLocation(eventPage) }}</dd></div> }
          </dl>
          <div class="info-actions">
            <a mat-stroked-button class="secondary-action" [routerLink]="['/calendar']">Edit in Calendar</a>
            @if (eventPage.externalLink) { <a mat-stroked-button class="secondary-action" [href]="eventPage.externalLink" target="_blank" rel="noopener noreferrer">External link</a> }
          </div>
        </section>

        @if (linkedTournaments().length) {
          <section class="event-section panel" aria-labelledby="event-tournaments-title">
            <div class="section-header"><div><p class="kicker">Tournament links</p><h2 id="event-tournaments-title">Tournaments in this event</h2></div></div>
            <div class="event-tournament-grid">
              @for (item of linkedTournaments(); track item.leagueId + item.tournamentId) {
                <a class="tournament-rect-card" [routerLink]="['/leagues', item.leagueId, 'tournaments', item.tournamentId]">
                  <span class="tournament-card-copy"><strong>{{ item.tournamentName }}</strong><span>{{ item.leagueName }} · {{ item.tournamentDate || 'No Tournament Date' }}</span></span>
                  <span class="card-view-action">Open</span>
                </a>
              }
            </div>
          </section>
        }

        <section class="event-section panel" aria-labelledby="event-description-title">
          <div class="section-header"><div><p class="kicker">Description</p><h2 id="event-description-title">Event information</h2></div></div>
          @if (eventPage.richDescriptionHtml) { <div class="rich-content" [innerHTML]="eventPage.richDescriptionHtml"></div> }
          @else if (eventPage.description) { <p class="event-description-fallback">{{ eventPage.description }}</p> }
          @else { <p class="muted">No description has been published for this event yet.</p> }
        </section>
      </article>
    } @else if (!error()) {
      <section class="panel event-section"><p class="kicker">Event not found</p><h1>Event page missing.</h1><p class="muted">The requested Event page does not exist or was deleted.</p></section>
    }
    <gones-back-button [link]="['/calendar']" label="Back to Events" position="bottom" />
  `
})
export class EventDetailComponent implements OnInit {
  readonly event = signal<CalendarEventDocument | null>(null);
  readonly leagues = signal<PersistedLeague[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly linkedTournaments = computed<LinkedTournamentView[]>(() => {
    const eventPage = this.event();
    if (!eventPage) return [];
    return eventPage.tournamentLinks.flatMap((link) => {
      const league = this.leagues().find((item) => item.id === link.leagueId);
      const tournament = league?.tournaments.find((item) => item.id === link.tournamentId);
      return league && tournament ? [{ leagueId: league.id, tournamentId: tournament.id, leagueName: league.name, tournamentName: tournament.name, tournamentDate: tournament.tournamentDate }] : [];
    });
  });

  constructor(private readonly route: ActivatedRoute, private readonly eventRepo: CalendarEventRepository, private readonly leagueRepo: LeagueRepository) {}

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.loading.set(true);
    try {
      const [events, leagues] = await Promise.all([this.eventRepo.list(), this.leagueRepo.listLeagues()]);
      const eventPage = events.find((event) => event.slug === slug) ?? null;
      this.event.set(eventPage);
      this.leagues.set(leagues);
      this.error.set('');
      logBoundaryInfo('event-detail.load.success', { slug, found: Boolean(eventPage) });
    } catch (error) {
      logBoundaryError('event-detail.load', error, { slug });
      this.error.set('Could not load this Event page.');
    } finally {
      this.loading.set(false);
    }
  }

  formatDate(value: string): string { return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  eventTime(event: CalendarEventDocument): string { return event.startTime ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : 'All day'; }
  eventLocation(event: CalendarEventDocument): string { return [event.address, event.city, event.country].filter(Boolean).join(', ') || event.location; }
}
