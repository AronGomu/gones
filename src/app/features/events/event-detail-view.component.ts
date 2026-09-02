import { Component, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { PublicEventDetailResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { eventDatePresentation, venueMapsUrl } from './public-event-list';
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
  images: PublicEventDetailResponse['images'];
}
export type EventDetailImage = EventDetailView['images'][number];

@Component({
  selector: 'gones-event-detail-view',
  standalone: true,
  imports: [MatButtonModule, ServerSanitizedHtmlComponent],
  template: `
    <article class="event-page public-tournament-detail" aria-labelledby="event-title" data-cy="event-detail-view">
      <section class="event-hero panel" data-cy="event-detail-hero">
        <div class="event-hero-topline" data-cy="event-detail-topline">@if (event().organization.website; as url) { <a class="kicker" data-cy="event-detail-kicker-link" [href]="url" [attr.target]="externalLinkAttrs(url).target" [attr.rel]="externalLinkAttrs(url).rel">{{ organizationName() }}</a> } @else { <p class="kicker" data-cy="event-detail-kicker" [class.muted]="showOrganizationPlaceholder()">{{ organizationName() }}</p> }<span class="event-player-count" data-cy="event-detail-player-count" [class.muted]="showCapacityPlaceholder()">{{ playerCount() }}</span></div>
        <h1 id="event-title" data-cy="event-detail-title"><span data-cy="event-detail-title-text" [class.muted]="showTitlePlaceholder()">{{ displayTitle() }}</span></h1>
        @if (showIcsAction() && icsUrl(); as url) { <a mat-stroked-button class="event-hero-ics" [href]="url" type="text/calendar" data-cy="event-ics">{{ i18n.t('event.addToCalendar') }}</a> }
        @if (event().summary) { <p class="event-description-fallback" data-cy="event-detail-summary">{{ event().summary }}</p> }
        <p class="event-when" data-cy="event-detail-when-row" [class.muted]="showDatePlaceholder()"><span data-cy="event-detail-when">{{ naturalDate() }}</span><span data-cy="event-detail-when-separator">-</span><span class="event-starting-hour" data-cy="event-detail-starting-hour">{{ i18n.t('event.startingHour') }} : {{ startTime() }}</span></p>
        @if (date().secondary; as secondary) { <p class="viewer-date" data-cy="event-detail-fact-date-viewer">{{ i18n.t('event.viewerTime') }}: {{ secondary }}</p> }
        <p class="event-where" data-cy="event-detail-where-row">@if (mapsUrl(); as url) { <a data-cy="event-detail-where-link" [href]="url" target="_blank" rel="noopener noreferrer" [attr.aria-label]="i18n.t('event.openInMaps', { address: venue() })"><svg class="maps-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>{{ venueDisplay() }}</a> } @else { <span data-cy="event-detail-where" [class.muted]="showVenuePlaceholder()">{{ venueDisplay() }}</span> }</p>
        @if (organizers().length) { <p class="event-hero-organizers" data-cy="event-detail-organizers">{{ organizers().join(', ') }}</p> }
      </section>
      @if (heroImage(); as image) {
        <section class="event-media" data-cy="event-detail-media">
          <button type="button" class="event-media-trigger event-media-hero" data-cy="event-detail-media-hero" (click)="openLightbox(0, $event.currentTarget)">
            <img class="event-media-image" data-cy="event-detail-media-hero-image" [src]="imageSource(image)" [srcset]="imageSourceSet(image)" sizes="100vw" [attr.width]="largestVariant(image)?.width" [attr.height]="largestVariant(image)?.height" [alt]="imageAlt(image, 0)" loading="eager" />
          </button>
          @if (galleryImages().length) {
            <div class="event-media-gallery" data-cy="event-detail-media-gallery">
              @for (image of galleryImages(); track image.id; let position = $index) {
                <button type="button" class="event-media-trigger event-media-gallery-item" [attr.data-cy]="'event-detail-media-gallery-' + position" (click)="openLightbox(position + 1, $event.currentTarget)">
                  <img class="event-media-image" [attr.data-cy]="'event-detail-media-gallery-image-' + position" [src]="imageSource(image)" [srcset]="imageSourceSet(image)" sizes="(max-width: 700px) 100vw, 33vw" [attr.width]="largestVariant(image)?.width" [attr.height]="largestVariant(image)?.height" [alt]="imageAlt(image, position + 1)" loading="lazy" />
                </button>
              }
            </div>
          }
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
            <img class="event-lightbox-image" data-cy="event-detail-lightbox-image" [src]="imageSource(image)" [srcset]="imageSourceSet(image)" sizes="100vw" [attr.width]="largestVariant(image)?.width" [attr.height]="largestVariant(image)?.height" [alt]="imageAlt(image, lightboxIndex()!)" />
            @if (images().length > 1) {
              <div class="event-lightbox-actions" data-cy="event-detail-lightbox-actions">
                <button mat-stroked-button type="button" data-cy="event-detail-lightbox-previous" [attr.aria-label]="i18n.t('event.imagePrevious')" (click)="moveLightbox(-1)">←</button>
                <button mat-stroked-button type="button" data-cy="event-detail-lightbox-next" [attr.aria-label]="i18n.t('event.imageNext')" (click)="moveLightbox(1)">→</button>
              </div>
            }
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
  readonly lightboxIndex = signal<number | null>(null);
  private lightboxTrigger: HTMLElement | null = null;

  readonly date = computed(() => this.draftPlaceholderMode()
    ? { primary: '' }
    : eventDatePresentation(this.event(), this.i18n.locale()));
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
  readonly images = computed(() => this.event().images ?? []);
  readonly heroImage = computed(() => this.images()[0]);
  readonly galleryImages = computed(() => this.images().slice(1));
  readonly lightboxImage = computed(() => {
    const index = this.lightboxIndex();
    return index === null ? undefined : this.images()[index];
  });
  readonly displayTitle = computed(() => this.event().displayTitle.trim() || (this.draftPlaceholderMode() ? this.i18n.t('event.draftTitlePlaceholder') : ''));
  readonly organizationName = computed(() => this.event().organization.name.trim() || (this.draftPlaceholderMode() ? this.i18n.t('event.draftOrganizationPlaceholder') : ''));
  readonly showTitlePlaceholder = computed(() => this.draftPlaceholderMode() && !this.event().displayTitle.trim());
  readonly showVenuePlaceholder = computed(() => this.draftPlaceholderMode() && !this.locationComplete());
  readonly showOrganizationPlaceholder = computed(() => this.draftPlaceholderMode() && !this.event().organization.name.trim());
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

  imageAlt(image: EventDetailImage, position: number): string {
    return image.altText?.trim() || `${this.displayTitle()} — image ${position + 1}`;
  }

  largestVariant(image: EventDetailImage): EventDetailImage['variants'][number] | undefined {
    return image.variants.reduce<EventDetailImage['variants'][number] | undefined>(
      (largest, variant) => !largest || variant.width > largest.width ? variant : largest,
      undefined
    );
  }

  imageSource(image: EventDetailImage): string {
    return this.largestVariant(image)?.url ?? '';
  }

  imageSourceSet(image: EventDetailImage): string {
    return image.variants.map(variant => `${variant.url} ${variant.width}w`).join(', ');
  }

  openLightbox(index: number, trigger: EventTarget | null): void {
    if (!this.images()[index]) return;
    this.lightboxTrigger = trigger instanceof HTMLElement ? trigger : null;
    this.lightboxIndex.set(index);
    setTimeout(() => {
      if (this.lightboxIndex() === null) return;
      const root = this.lightboxTrigger?.closest<HTMLElement>('[data-cy="event-detail-view"]');
      (root?.querySelector<HTMLElement>('[data-cy="event-detail-lightbox-close"]')
        ?? root?.querySelector<HTMLElement>('[data-cy="event-detail-lightbox"]'))?.focus();
    });
  }

  closeLightbox(): void {
    if (this.lightboxIndex() === null) return;
    this.lightboxIndex.set(null);
    const trigger = this.lightboxTrigger;
    this.lightboxTrigger = null;
    trigger?.focus();
  }

  moveLightbox(offset: number): void {
    const current = this.lightboxIndex();
    const count = this.images().length;
    if (current === null || count === 0) return;
    this.lightboxIndex.set((current + offset + count) % count);
  }

  onLightboxKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeLightbox();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.moveLightbox(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    const dialog = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (dialog) trapDialogFocus(event, dialog);
  }
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
