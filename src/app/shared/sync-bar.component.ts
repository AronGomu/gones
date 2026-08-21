import { Component, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../i18n/i18n.service';
import { OfflineBannerComponent } from './offline-banner.component';

/**
 * The one sync affordance of ADR 0039: when the page last synchronised, a button that forces a
 * refetch, and the stale/offline banner that says the copy on screen is not live.
 *
 * Every page on the cache contract renders this bar, and each one keeps its own stable test ids by
 * passing `cyPrefix` — `event-list` yields `event-list-sync-button`, `admin-users` yields
 * `admin-users-sync-button`. The bar owns no data: the host page loads, and the bar reports.
 */
@Component({
  selector: 'gones-sync-bar',
  standalone: true,
  imports: [MatButtonModule, OfflineBannerComponent],
  template: `
    <div class="calendar-sync-group" [attr.data-cy]="cyPrefix() + '-sync-group'">
      @if (syncedAt(); as instant) { <span class="muted calendar-synced-at" [attr.data-cy]="cyPrefix() + '-sync-synced-at'">{{ i18n.t('sync.syncedAt', { instant: i18n.formatDateTime(instant) }) }}</span> }
      <button mat-stroked-button type="button" class="secondary-action calendar-sync-button" [attr.data-cy]="cyPrefix() + '-sync-button'" [disabled]="loading()" (click)="sync.emit()" [attr.aria-label]="i18n.t('sync.synchroniseAria')">
        <svg class="calendar-sync-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.9-3" /><path d="M4 5v5h5" /><path d="M4 13a8 8 0 0 0 14.9 3" /><path d="M20 19v-5h-5" /></svg>
        <span [attr.data-cy]="cyPrefix() + '-sync-label'">{{ i18n.t('sync.synchronise') }}</span>
      </button>
    </div>
    <gones-offline-banner [stale]="stale()" [cachedAt]="syncedAt()" [attr.data-cy]="cyPrefix() + '-sync-offline-banner'" />
  `
})
export class SyncBarComponent {
  readonly i18n = inject(I18nService);
  readonly cyPrefix = input.required<string>();
  readonly syncedAt = input<string | undefined>(undefined);
  readonly loading = input(false);
  readonly stale = input(false);
  readonly sync = output<void>();
}
