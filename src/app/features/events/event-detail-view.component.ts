import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { PublicEventDetailResponse } from '../../api/generated/gones-api';
import { joinApiUrl } from '../../api/api-boundary';
import { dataAuthority } from '../../config/data-authority';
import { I18nService } from '../../i18n/i18n.service';
import type { MessageKey } from '../../i18n/messages';
import { venueMapsUrl } from './public-event-list';
import { ServerSanitizedHtmlComponent } from './server-sanitized-html.component';

export interface EventDetailView {
  id?: string;
  title: string;
  displayTitle: string;
  slug: string;
  summary: string | undefined;
  bodyHtml: string | undefined;
  liveTournamentUrl: string | undefined;
  archiveTournamentUrl: string | undefined;
  venue: PublicEventDetailResponse['venue'];
  timeZoneId: string;
  venueStartDate: string;
  venueStartTime: string;
  venueEndDate: string;
  venueEndTime: string;
  startsAtUtc: PublicEventDetailResponse['startsAtUtc'] | string;
  endsAtUtc: PublicEventDetailResponse['endsAtUtc'] | string;
  capacity: number | null | undefined;
  status: string;
  eventType: PublicEventDetailResponse['eventType'];
  organization: PublicEventDetailResponse['organization'];
  formats: PublicEventDetailResponse['formats'];
  image?: PublicEventDetailResponse['image'];
}
export type EventDetailImage = NonNullable<EventDetailView['image']>;

@Component({
  selector: 'gones-event-detail-view',
  standalone: true,
  imports: [MatButtonModule, ServerSanitizedHtmlComponent],
  template: `
    <article class="event-page public-tournament-detail" aria-labelledby="event-title" data-cy="event-detail-view">
      <section class="event-hero panel" data-cy="event-detail-hero">
        <div class="event-hero-topline" data-cy="event-detail-topline">@if (event().organization.website; as url) { <a class="kicker" data-cy="event-detail-kicker-link" [href]="url" [attr.target]="externalLinkAttrs(url).target" [attr.rel]="externalLinkAttrs(url).rel">{{ organizationName() }}</a> } @else { <p class="kicker" data-cy="event-detail-kicker" [class.muted]="showOrganizationPlaceholder()">{{ organizationName() }}</p> }<span class="event-type-label" data-cy="event-detail-event-type" [class.muted]="showEventTypePlaceholder()">{{ eventTypeLabel() }}</span><span class="event-player-count" data-cy="event-detail-player-count" [class.muted]="showCapacityPlaceholder()">{{ playerCount() }}</span></div>
        <h1 id="event-title" data-cy="event-detail-title"><span data-cy="event-detail-title-text" [class.muted]="showTitlePlaceholder()">{{ displayTitle() }}</span></h1>
        @if (showIcsAction() && icsUrl(); as url) { <a mat-stroked-button class="event-hero-ics" [href]="url" type="text/calendar" data-cy="event-ics">{{ i18n.t('event.addToCalendar') }}</a> }
        @if (event().summary) { <p class="event-description-fallback" data-cy="event-detail-summary">{{ event().summary }}</p> }
        <p class="event-when" data-cy="event-detail-when-row" [class.muted]="showDatePlaceholder()"><span data-cy="event-detail-when">{{ naturalDate() }}</span><span data-cy="event-detail-when-separator">-</span><span class="event-starting-hour" data-cy="event-detail-starting-hour">{{ i18n.t('event.startingHour') }} : {{ startTime() }}</span></p>
        <p class="event-where" data-cy="event-detail-where-row">@if (mapsUrl(); as url) { <a data-cy="event-detail-where-link" [href]="url" target="_blank" rel="noopener noreferrer" [attr.aria-label]="i18n.t('event.openInMaps', { address: venue() })"><svg class="maps-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>{{ venueDisplay() }}</a> } @else { <span data-cy="event-detail-where" [class.muted]="showVenuePlaceholder()">{{ venueDisplay() }}</span> }</p>
        @if (organizers().length) { <p class="event-hero-organizers" data-cy="event-detail-organizers">{{ organizers().join(', ') }}</p> }
      </section>
      @if (heroImage(); as image) {
        <section class="event-media" data-cy="event-detail-media">
          <button type="button" class="event-media-trigger event-media-hero" data-cy="event-detail-media-hero" (click)="openLightbox($event.currentTarget)">
            <img class="event-media-image" data-cy="event-detail-media-hero-image" [src]="imageSource(image)" [srcset]="imageSourceSet(image)" sizes="100vw" [attr.width]="largestVariant(image)?.width" [attr.height]="largestVariant(image)?.height" [alt]="imageAlt()" loading="eager" />
          </button>
        </section>
      }
      <section class="event-section panel" data-cy="event-detail-description" aria-labelledby="event-description-title">
        <h2 id="event-description-title" data-cy="event-detail-description-title">{{ i18n.t('event.infoTitle') }}</h2>
        @if (event().bodyHtml) { <gones-server-sanitized-html data-cy="event-detail-body" [html]="event().bodyHtml!" /> }
        @else { <p class="muted" data-cy="event-detail-no-description">{{ i18n.t('event.noDescription') }}</p> }
      </section>
      @if (lightboxImage(); as image) {
        <div class="event-lightbox-backdrop" data-cy="event-detail-lightbox-backdrop">
          <div #lightbox class="event-lightbox" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t('event.imageDialogLabel')" tabindex="-1" data-cy="event-detail-lightbox" (keydown)="onLightboxKeydown($event)">
            <button #lightboxClose mat-stroked-button type="button" class="event-lightbox-close" data-cy="event-detail-lightbox-close" [attr.aria-label]="i18n.t('event.imageClose')" (click)="closeLightbox()">×</button>
            <img class="event-lightbox-image" data-cy="event-detail-lightbox-image" [src]="imageSource(image)" [srcset]="imageSourceSet(image)" sizes="100vw" [attr.width]="largestVariant(image)?.width" [attr.height]="largestVariant(image)?.height" [alt]="imageAlt()" />
          </div>
        </div>
      }
    </article>
  `
})
export class EventDetailViewComponent {
  readonly i18n = inject(I18nService);
  readonly event = input.required<EventDetailView>();
  readonly icsUrl = input<string>();
  readonly showIcsAction = input<boolean>(true);
  readonly draftPlaceholderMode = input<boolean>(false);
  readonly lightboxOpen = signal(false);
  private lightboxTrigger: HTMLElement | null = null;

  readonly eventTypeLabel = computed(() => {
    const eventType = this.event().eventType;
    return eventType
      ? this.i18n.t(`event.type.${eventType}` as MessageKey)
      : this.draftPlaceholderMode() ? this.i18n.t('event.draftTypePlaceholder') : '';
  });
  readonly playerCount = computed(() => {
    const capacity = this.event().capacity;
    if (capacity === undefined || capacity === null) return this.draftPlaceholderMode()
      ? this.i18n.t('event.draftCapacityPlaceholder')
      : this.i18n.t('registration.unlimited');
    return this.i18n.t(capacity === 1 ? 'event.playerCount' : 'event.playerCountPlural', { count: capacity });
  });
  readonly mapsUrl = computed(() => this.showVenuePlaceholder() ? undefined : venueMapsUrl(this.event().venue));
  readonly naturalDate = computed(() => this.showDatePlaceholder()
    ? this.i18n.t('event.draftDatePlaceholder')
    : this.i18n.formatDate(this.event().venueStartDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
  readonly startTime = computed(() => this.showDatePlaceholder() ? '—' : this.event().venueStartTime.slice(0, 5));
  readonly organizers = computed(() => this.event().organization.organizers ?? []);
  readonly heroImage = computed(() => this.event().image ?? undefined);
  readonly lightboxImage = computed(() => this.lightboxOpen() ? this.heroImage() : undefined);
  readonly displayTitle = computed(() => this.event().displayTitle.trim() || (this.draftPlaceholderMode() ? this.i18n.t('event.draftTitlePlaceholder') : ''));
  readonly organizationName = computed(() => this.event().organization.name.trim() || (this.draftPlaceholderMode() ? this.i18n.t('event.draftOrganizationPlaceholder') : ''));
  readonly showTitlePlaceholder = computed(() => this.draftPlaceholderMode() && !this.event().displayTitle.trim());
  readonly showVenuePlaceholder = computed(() => this.draftPlaceholderMode() && !this.locationComplete());
  readonly showOrganizationPlaceholder = computed(() => this.draftPlaceholderMode() && !this.event().organization.name.trim());
  readonly showEventTypePlaceholder = computed(() => this.draftPlaceholderMode() && !this.event().eventType);
  readonly showDatePlaceholder = computed(() => this.draftPlaceholderMode() && (!this.event().venueStartDate || !this.event().venueStartTime));
  readonly showCapacityPlaceholder = computed(() => this.draftPlaceholderMode() && this.event().capacity == null);
  readonly venueDisplay = computed(() => this.showVenuePlaceholder() ? this.i18n.t('event.draftLocationPlaceholder') : this.venue());

  externalLinkAttrs(url: string): { target?: '_blank'; rel?: 'noopener noreferrer' } {
    return /^https?:\/\//i.test(url) ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  }

  locationComplete(): boolean {
    const venue = this.event().venue;
    return [venue.streetAddress, venue.postalCode, venue.city, venue.country, venue.region].every(value => (value ?? '').trim());
  }

  venue(): string {
    const venue = this.event().venue;
    return [venue.streetAddress, venue.postalCode, venue.city, venue.country].filter(Boolean).join(', ');
  }

  imageAlt(): string {
    return `${this.displayTitle()} — ${this.i18n.t('event.image')}`;
  }

  largestVariant(image: EventDetailImage): EventDetailImage['variants'][number] | undefined {
    return image.variants.reduce<EventDetailImage['variants'][number] | undefined>(
      (largest, variant) => !largest || variant.width > largest.width ? variant : largest,
      undefined
    );
  }

  imageSource(image: EventDetailImage): string {
    const url = this.largestVariant(image)?.url ?? '';
    return resolveApiAssetUrl(url, dataAuthority().apiBaseUrl);
  }

  imageSourceSet(image: EventDetailImage): string {
    return image.variants
      .map(variant => `${resolveApiAssetUrl(variant.url, dataAuthority().apiBaseUrl)} ${variant.width}w`)
      .join(', ');
  }

  openLightbox(trigger: EventTarget | null): void {
    if (!this.heroImage()) return;
    this.lightboxTrigger = trigger instanceof HTMLElement ? trigger : null;
    this.lightboxOpen.set(true);
    setTimeout(() => {
      if (!this.lightboxOpen()) return;
      const root = this.lightboxTrigger?.closest<HTMLElement>('[data-cy="event-detail-view"]');
      (root?.querySelector<HTMLElement>('[data-cy="event-detail-lightbox-close"]')
        ?? root?.querySelector<HTMLElement>('[data-cy="event-detail-lightbox"]'))?.focus();
    });
  }

  closeLightbox(): void {
    if (!this.lightboxOpen()) return;
    this.lightboxOpen.set(false);
    const trigger = this.lightboxTrigger;
    this.lightboxTrigger = null;
    trigger?.focus();
  }


  onLightboxKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeLightbox();
      return;
    }
    const dialog = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (dialog) trapDialogFocus(event, dialog);
  }
}

export function resolveApiAssetUrl(url: string, apiBaseUrl: string): string {
  return url.startsWith('/api/') ? joinApiUrl(apiBaseUrl, url) : url;
}

export function trapDialogFocus(event: KeyboardEvent, dialog: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
