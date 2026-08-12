import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { PublicTournamentDetailResponse, TournamentPreviewRenderResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { statusPresentation, tournamentDatePresentation, venueMapsUrl } from './public-calendar';
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
        <h1 id="tournament-title" data-cy="tournament-detail-title">@if (titleFormat(); as format) { <span data-cy="tournament-detail-title-format">[{{ format }}]</span>&ngsp; }<span data-cy="tournament-detail-title-text">{{ tournament().title }}</span>@if (tournament().capacity; as capacity) { &ngsp;<span data-cy="tournament-detail-title-capacity">({{ capacity }})</span> }</h1>
        @if (tournament().summary) { <p class="event-description-fallback" data-cy="tournament-detail-summary">{{ tournament().summary }}</p> }
        <p class="event-when-where" data-cy="tournament-detail-when-where"><span data-cy="tournament-detail-when">{{ date().primary }}</span><span data-cy="tournament-detail-when-where-separator">-</span>@if (mapsUrl(); as url) { <a data-cy="tournament-detail-where-link" [href]="url" target="_blank" rel="noopener noreferrer" [attr.aria-label]="i18n.t('calendar.openInMaps', { address: venue() })"><svg class="maps-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>{{ venue() }}</a> } @else { <span data-cy="tournament-detail-where">{{ venue() }}</span> }</p>
        @if (date().secondary; as secondary) { <p class="viewer-date" data-cy="tournament-detail-fact-date-viewer">{{ i18n.t('calendar.viewerTime') }}: {{ secondary }}</p> }
        @if ((showIcsAction() && icsUrl()) || tournament().organization.website) {
          <div class="info-actions info-actions--end" data-cy="tournament-detail-actions">
            @if (showIcsAction() && icsUrl(); as url) { <a mat-flat-button class="home-primary-action" [href]="url" download data-cy="tournament-ics">{{ i18n.t('calendar.addToCalendar') }}</a> }
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
  readonly showIcsAction = input<boolean>(true);
  readonly status = computed(() => statusPresentation(this.tournament().status));
  readonly date = computed(() => tournamentDatePresentation(this.tournament(), this.i18n.locale()));
  readonly titleFormat = computed(() => this.tournament().formats.map(format => format.name).join(' / '));
  readonly mapsUrl = computed(() => venueMapsUrl(this.tournament().venue));

  venue(): string {
    const venue = this.tournament().venue;
    return [venue.streetAddress, venue.postalCode, venue.city, venue.country].filter(Boolean).join(', ');
  }
}
