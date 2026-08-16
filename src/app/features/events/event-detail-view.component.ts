import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { PublicEventDetailResponse, EventPreviewRenderResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { eventDatePresentation, venueMapsUrl } from './public-event-list';
import { ServerSanitizedHtmlComponent } from './server-sanitized-html.component';

export type EventDetailView = PublicEventDetailResponse | EventPreviewRenderResponse;

@Component({
  selector: 'gones-event-detail-view',
  standalone: true,
  imports: [MatButtonModule, ServerSanitizedHtmlComponent],
  template: `
    <article class="event-page public-tournament-detail" aria-labelledby="event-title" data-cy="event-detail-view">
      <section class="event-hero panel" data-cy="event-detail-hero">
        <p class="kicker" data-cy="event-detail-kicker">{{ event().organization.name }}</p>
        <h1 id="event-title" data-cy="event-detail-title"><span data-cy="event-detail-title-text">{{ event().displayTitle }}</span>&ngsp;<span class="event-player-count" data-cy="event-detail-player-count">{{ playerCount() }}</span></h1>
        @if (event().summary) { <p class="event-description-fallback" data-cy="event-detail-summary">{{ event().summary }}</p> }
        <p class="event-when-where" data-cy="event-detail-when-where"><span data-cy="event-detail-when">{{ date().primary }}</span><span data-cy="event-detail-when-where-separator">-</span>@if (mapsUrl(); as url) { <a data-cy="event-detail-where-link" [href]="url" target="_blank" rel="noopener noreferrer" [attr.aria-label]="i18n.t('event.openInMaps', { address: venue() })"><svg class="maps-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>{{ venue() }}</a> } @else { <span data-cy="event-detail-where">{{ venue() }}</span> }</p>
        @if (date().secondary; as secondary) { <p class="viewer-date" data-cy="event-detail-fact-date-viewer">{{ i18n.t('event.viewerTime') }}: {{ secondary }}</p> }
        @if ((showIcsAction() && icsUrl()) || event().liveTournamentUrl || event().archiveTournamentUrl || event().organization.website) {
          <div class="event-detail-actions info-actions info-actions--end" data-cy="event-detail-actions">
            @if (showIcsAction() && icsUrl(); as url) { <a mat-flat-button class="home-primary-action" [href]="url" type="text/calendar" data-cy="event-ics">{{ i18n.t('event.addToCalendar') }}</a> }
            @if (event().liveTournamentUrl; as url) { <a mat-stroked-button data-cy="event-detail-live-tournament" [href]="url" [attr.target]="externalLinkAttrs(url).target" [attr.rel]="externalLinkAttrs(url).rel">{{ i18n.t('event.liveTournament') }}</a> }
            @if (event().archiveTournamentUrl; as url) { <a mat-stroked-button data-cy="event-detail-archive-tournament" [href]="url" [attr.target]="externalLinkAttrs(url).target" [attr.rel]="externalLinkAttrs(url).rel">{{ i18n.t('event.archiveTournament') }}</a> }
            @if (event().organization.website; as url) { <a mat-stroked-button data-cy="event-detail-organization-website" [href]="url" [attr.target]="externalLinkAttrs(url).target" [attr.rel]="externalLinkAttrs(url).rel">{{ i18n.t('event.organizationWebsite') }}</a> }
          </div>
        }
      </section>
      <section class="event-section panel" data-cy="event-detail-description" aria-labelledby="event-description-title">
        <h2 id="event-description-title" data-cy="event-detail-description-title">{{ i18n.t('event.infoTitle') }}</h2>
        @if (event().bodyHtml) { <gones-server-sanitized-html data-cy="event-detail-body" [html]="event().bodyHtml!" /> }
        @else { <p class="muted" data-cy="event-detail-no-description">{{ i18n.t('event.noDescription') }}</p> }
      </section>
    </article>
  `
})
export class EventDetailViewComponent {
  readonly i18n = inject(I18nService);
  readonly event = input.required<EventDetailView>();
  readonly icsUrl = input<string>();
  readonly showIcsAction = input<boolean>(true);
  readonly date = computed(() => eventDatePresentation(this.event(), this.i18n.locale()));
  readonly playerCount = computed(() => {
    const capacity = this.event().capacity;
    if (capacity === undefined || capacity === null) return this.i18n.t('registration.unlimited');
    return this.i18n.t(capacity === 1 ? 'event.playerCount' : 'event.playerCountPlural', { count: capacity });
  });
  readonly mapsUrl = computed(() => venueMapsUrl(this.event().venue));

  externalLinkAttrs(url: string): { target?: '_blank'; rel?: 'noopener noreferrer' } {
    return /^https?:\/\//i.test(url) ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  }

  venue(): string {
    const venue = this.event().venue;
    return [venue.streetAddress, venue.postalCode, venue.city, venue.country].filter(Boolean).join(', ');
  }
}
