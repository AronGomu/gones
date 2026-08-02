import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { PublicTournamentDetailResponse } from '../../api/generated/gones-api';
import { ApiProblemError } from '../../api/api-boundary';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { statusPresentation, tournamentDatePresentation } from './public-calendar';
import { PublicTournamentService } from './public-tournament.service';
import { ServerSanitizedHtmlComponent } from './server-sanitized-html.component';

@Component({
  standalone: true,
  imports: [MatButtonModule, BackButtonComponent, ServerSanitizedHtmlComponent],
  template: `
    <gones-back-button [link]="['/calendar']" [label]="i18n.t('nav.backToEvents')" position="top" />
    @if (stale()) { <aside class="warning calendar-offline-banner" role="status" data-cy="calendar-stale">{{ i18n.t('calendar.cachedStale') }}</aside> }
    @if (loading()) { <section class="panel event-section calendar-detail-skeleton" aria-busy="true" data-cy="calendar-loading"><div></div><div></div><div></div></section> }
    @else if (error()) { <section class="panel calendar-state" role="alert" data-cy="calendar-error"><h1>{{ i18n.t('calendar.detailLoadFailed') }}</h1><button mat-stroked-button type="button" (click)="load()">{{ i18n.t('common.retry') }}</button></section> }
    @else if (notFound()) { <section class="panel calendar-state" data-cy="calendar-not-found"><h1>{{ i18n.t('event.notFoundTitle') }}</h1><p>{{ i18n.t('event.notFoundBody') }}</p></section> }
    @else if (tournament(); as item) {
      <article class="event-page public-tournament-detail" aria-labelledby="tournament-title" data-cy="public-tournament-detail">
        <section class="event-hero panel">
          <p class="kicker">{{ item.organization.name }}</p>
          <span [class]="'calendar-status calendar-status--' + status().className">{{ status().label }}</span>
          <h1 id="tournament-title">{{ item.title }}</h1>
          @if (item.summary) { <p class="event-description-fallback">{{ item.summary }}</p> }
          <dl class="event-facts">
            <div><dt>{{ i18n.t('calendar.venueTime') }}</dt><dd>{{ date().primary }}</dd>@if (date().secondary; as secondary) { <dd class="viewer-date">{{ i18n.t('calendar.viewerTime') }}: {{ secondary }}</dd> }</div>
            <div><dt>{{ i18n.t('common.location') }}</dt><dd>{{ venue() }}</dd></div>
            <div><dt>{{ i18n.t('calendar.organization') }}</dt><dd>{{ item.organization.name }}</dd></div>
            @if (item.formats.length) { <div><dt>{{ i18n.t('calendar.format') }}</dt><dd>{{ formats() }}</dd></div> }
            @if (item.capacity) { <div><dt>{{ i18n.t('calendar.capacity') }}</dt><dd>{{ item.capacity }}</dd></div> }
          </dl>
          <div class="info-actions"><a mat-flat-button class="home-primary-action" [href]="service.icsUrl(item.slug)" download data-cy="tournament-ics">{{ i18n.t('calendar.addToCalendar') }}</a>@if (item.organization.website) { <a mat-stroked-button [href]="item.organization.website" target="_blank" rel="noopener noreferrer">{{ i18n.t('calendar.organizationWebsite') }}</a> }</div>
        </section>
        <section class="event-section panel" aria-labelledby="tournament-description-title"><h2 id="tournament-description-title">{{ i18n.t('event.infoTitle') }}</h2>@if (item.bodyHtml) { <gones-server-sanitized-html [html]="item.bodyHtml" /> } @else { <p class="muted">{{ i18n.t('event.noDescription') }}</p> }</section>
      </article>
    }
    <gones-back-button [link]="['/calendar']" [label]="i18n.t('nav.backToEvents')" position="bottom" />
  `
})
export class PublicTournamentDetailComponent implements OnInit {
  readonly i18n = inject(I18nService);
  readonly service = inject(PublicTournamentService);
  private readonly route = inject(ActivatedRoute);
  readonly tournament = signal<PublicTournamentDetailResponse | null>(null);
  readonly loading = signal(true);
  readonly stale = signal(false);
  readonly error = signal(false);
  readonly notFound = signal(false);
  readonly status = () => statusPresentation(this.tournament()?.status ?? '');
  readonly date = () => tournamentDatePresentation(this.tournament()!, this.i18n.locale());

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.loading.set(true);
    this.error.set(false);
    this.notFound.set(false);
    try {
      const result = await this.service.detail(slug);
      this.tournament.set(result.data);
      this.stale.set(result.stale);
    } catch (error) {
      this.tournament.set(null);
      this.stale.set(false);
      if (error instanceof ApiProblemError && error.status === 404) this.notFound.set(true);
      else this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  venue(): string {
    const venue = this.tournament()!.venue;
    return [venue.streetAddress, venue.postalCode, venue.city, venue.country].filter(Boolean).join(', ');
  }
  formats(): string { return this.tournament()!.formats.map(format => format.name).join(', '); }
}
