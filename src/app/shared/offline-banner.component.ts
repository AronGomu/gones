import { Component, inject, input } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { OnlineStatusService } from './online-status.service';

/**
 * Labels a page that is showing cached public data, or that is online-read-only because the
 * browser is offline. Both states tell the visitor that writes are disabled and nothing queues.
 */
@Component({
  selector: 'gones-offline-banner',
  standalone: true,
  template: `
    @if (stale()) {
      <aside class="warning calendar-offline-banner" role="status" data-cy="event-stale">{{ staleMessage() }}</aside>
    } @else if (!online()) {
      <aside class="warning calendar-offline-banner" role="status" data-cy="offline-banner">{{ i18n.t('offline.readOnly') }}</aside>
    }
  `
})
export class OfflineBannerComponent {
  readonly i18n = inject(I18nService);
  readonly online = inject(OnlineStatusService).online;
  readonly stale = input(false);
  readonly cachedAt = input<string | undefined>(undefined);

  staleMessage(): string {
    const cachedAt = this.cachedAt();
    return cachedAt
      ? this.i18n.t('event.cachedStaleAt', { time: this.i18n.formatDateTime(cachedAt) })
      : this.i18n.t('event.cachedStale');
  }
}
