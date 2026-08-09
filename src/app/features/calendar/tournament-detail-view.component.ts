import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { PublicTournamentDetailResponse, TournamentPreviewRenderResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { statusPresentation, tournamentDatePresentation } from './public-calendar';
import { ServerSanitizedHtmlComponent } from './server-sanitized-html.component';

export type TournamentDetailView = PublicTournamentDetailResponse | TournamentPreviewRenderResponse;

@Component({
  selector: 'gones-tournament-detail-view',
  standalone: true,
  imports: [MatButtonModule, ServerSanitizedHtmlComponent],
  template: `
    <article class="event-page public-tournament-detail" aria-labelledby="tournament-title" data-cy="tournament-detail-view">
      <section class="event-hero panel" data-cy="tournament-detail-hero">
        <p class="kicker" data-cy="tournament-detail-kicker">{{ tournament().organization.name }}</p>
        <span data-cy="tournament-detail-status" [class]="'calendar-status calendar-status--' + status().className">{{ status().label }}</span>
        <h1 id="tournament-title" data-cy="tournament-detail-title">{{ tournament().title }}</h1>
        @if (tournament().summary) { <p class="event-description-fallback" data-cy="tournament-detail-summary">{{ tournament().summary }}</p> }
        <dl class="event-facts" data-cy="tournament-detail-facts">
          <div data-cy="tournament-detail-fact-date"><dt data-cy="tournament-detail-fact-date-term">{{ i18n.t('calendar.venueTime') }}</dt><dd data-cy="tournament-detail-fact-date-value">{{ date().primary }}</dd>@if (date().secondary; as secondary) { <dd class="viewer-date" data-cy="tournament-detail-fact-date-viewer">{{ i18n.t('calendar.viewerTime') }}: {{ secondary }}</dd> }</div>
          <div data-cy="tournament-detail-fact-venue"><dt data-cy="tournament-detail-fact-venue-term">{{ i18n.t('common.location') }}</dt><dd data-cy="tournament-detail-fact-venue-value">{{ venue() }}</dd></div>
          <div data-cy="tournament-detail-fact-organization"><dt data-cy="tournament-detail-fact-organization-term">{{ i18n.t('calendar.organization') }}</dt><dd data-cy="tournament-detail-fact-organization-value">{{ tournament().organization.name }}</dd></div>
          @if (tournament().formats.length) { <div data-cy="tournament-detail-fact-formats"><dt data-cy="tournament-detail-fact-formats-term">{{ i18n.t('calendar.format') }}</dt><dd data-cy="tournament-detail-fact-formats-value">{{ formats() }}</dd></div> }
          @if (tournament().capacity) { <div data-cy="tournament-detail-fact-capacity"><dt data-cy="tournament-detail-fact-capacity-term">{{ i18n.t('calendar.capacity') }}</dt><dd data-cy="tournament-detail-fact-capacity-value">{{ tournament().capacity }}</dd></div> }
        </dl>
        @if (icsUrl() || tournament().organization.website) {
          <div class="info-actions" data-cy="tournament-detail-actions">
            @if (icsUrl(); as url) { <a mat-flat-button class="home-primary-action" [href]="url" download data-cy="tournament-ics">{{ i18n.t('calendar.addToCalendar') }}</a> }
            @if (tournament().organization.website) { <a mat-stroked-button data-cy="tournament-detail-organization-website" [href]="tournament().organization.website" target="_blank" rel="noopener noreferrer">{{ i18n.t('calendar.organizationWebsite') }}</a> }
          </div>
        }
      </section>
      <section class="event-section panel" data-cy="tournament-detail-description" aria-labelledby="tournament-description-title">
        <h2 id="tournament-description-title" data-cy="tournament-detail-description-title">{{ i18n.t('event.infoTitle') }}</h2>
        @if (tournament().bodyHtml) { <gones-server-sanitized-html data-cy="tournament-detail-body" [html]="tournament().bodyHtml!" /> }
        @else { <p class="muted" data-cy="tournament-detail-no-description">{{ i18n.t('event.noDescription') }}</p> }
      </section>
    </article>
  `
})
export class TournamentDetailViewComponent {
  readonly i18n = inject(I18nService);
  readonly tournament = input.required<TournamentDetailView>();
  readonly icsUrl = input<string>();
  readonly status = computed(() => statusPresentation(this.tournament().status));
  readonly date = computed(() => tournamentDatePresentation(this.tournament(), this.i18n.locale()));

  venue(): string {
    const venue = this.tournament().venue;
    return [venue.streetAddress, venue.postalCode, venue.city, venue.country].filter(Boolean).join(', ');
  }

  formats(): string { return this.tournament().formats.map(format => format.name).join(', '); }
}
