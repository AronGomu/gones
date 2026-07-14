import { Component, OnInit, signal, inject } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { CalendarEventRepository } from '../../data/calendar-event-repository.service';
import { CalendarEventDocument } from '../../domain/models';
import { logBoundaryError, logBoundaryInfo } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { I18nService } from '../../i18n/i18n.service';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/calendar']" [label]="i18n.t('nav.backToEvents')" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (loading()) { <section class="panel event-section" aria-live="polite" aria-busy="true"><p class="kicker">{{ i18n.t('common.loading') }}</p><h1>{{ i18n.t('event.loadingTitle') }}</h1></section> }
    @else if (event(); as eventPage) {
      <article class="event-page" aria-labelledby="event-title">
        <section class="event-hero panel">
          <p class="kicker">{{ i18n.t('event.tournamentEvent') }}</p>
          <h1 id="event-title">{{ eventPage.title }}</h1>
          <dl class="event-facts" [attr.aria-label]="i18n.t('event.factsAria')">
            <div><dt>{{ i18n.t('common.date') }}</dt><dd>{{ formatDate(eventPage.eventDate) }}</dd></div>
            <div><dt>{{ i18n.t('common.hours') }}</dt><dd>{{ eventTime(eventPage) }}</dd></div>
            @if (eventLocation(eventPage)) { <div><dt>{{ i18n.t('common.location') }}</dt><dd>{{ eventLocation(eventPage) }}</dd></div> }
          </dl>
          <div class="info-actions">
            <a mat-stroked-button class="secondary-action" [routerLink]="['/calendar']">{{ i18n.t('event.editInCalendar') }}</a>
            @if (eventPage.externalLink) { <a mat-stroked-button class="secondary-action" [href]="eventPage.externalLink" target="_blank" rel="noopener noreferrer">{{ i18n.t('event.externalLink') }}</a> }
          </div>
        </section>

        <section class="event-section panel" aria-labelledby="event-description-title">
          <div class="section-header"><div><p class="kicker">{{ i18n.t('common.description') }}</p><h2 id="event-description-title">{{ i18n.t('event.infoTitle') }}</h2></div></div>
          @if (eventPage.richDescriptionHtml) { <div class="rich-content" [innerHTML]="eventPage.richDescriptionHtml"></div> }
          @else if (eventPage.description) { <p class="event-description-fallback">{{ eventPage.description }}</p> }
          @else { <p class="muted">{{ i18n.t('event.noDescription') }}</p> }
        </section>
      </article>
    } @else if (!error()) {
      <section class="panel event-section"><p class="kicker">{{ i18n.t('event.notFoundKicker') }}</p><h1>{{ i18n.t('event.notFoundTitle') }}</h1><p class="muted">{{ i18n.t('event.notFoundBody') }}</p></section>
    }
    <gones-back-button [link]="['/calendar']" [label]="i18n.t('nav.backToEvents')" position="bottom" />
  `
})
export class EventDetailComponent implements OnInit {
  readonly i18n = inject(I18nService);
  readonly event = signal<CalendarEventDocument | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor(private readonly route: ActivatedRoute, private readonly eventRepo: CalendarEventRepository) {}

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.loading.set(true);
    try {
      const events = await this.eventRepo.list();
      const eventPage = events.find((event) => event.slug === slug) ?? null;
      this.event.set(eventPage);
      this.error.set('');
      logBoundaryInfo('event-detail.load.success', { slug, found: Boolean(eventPage) });
    } catch (error) {
      logBoundaryError('event-detail.load', error, { slug });
      this.error.set(this.i18n.t('event.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  formatDate(value: string): string {
    return this.i18n.formatDate(value, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  eventTime(event: CalendarEventDocument): string { return event.startTime ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : this.i18n.t('common.allDay'); }
  eventLocation(event: CalendarEventDocument): string { return [event.address, event.city, event.country].filter(Boolean).join(', ') || event.location; }
}
