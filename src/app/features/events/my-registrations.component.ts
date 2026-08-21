import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { EventRegistrationHistoryResponse } from '../../api/generated/gones-api';
import { ServerReadCacheService } from '../../backend/server-read-cache.service';
import { I18nService } from '../../i18n/i18n.service';
import { partitionRegistrationAttempts, registrationsCacheKey, registrationVenueTime } from './my-registrations';
import { EventRegistrationService } from './event-registration.service';
import { LatestRequest } from '../../shared/async-guards';
import { BackButtonComponent } from '../../shared/back-button.component';
import { SyncBarComponent } from '../../shared/sync-bar.component';

@Component({
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, MatButtonModule, BackButtonComponent, SyncBarComponent],
  template: `
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="registrations-back-top" />
    <section class="registrations-page stack" aria-labelledby="registrations-title" data-cy="registrations-page">
      <header class="page-heading" data-cy="registrations-header"><div data-cy="registrations-header-text"><h1 id="registrations-title" data-cy="registrations-title">{{ i18n.t('registration.myRegistrations') }}</h1></div></header>
      <gones-sync-bar cyPrefix="registrations" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="sync()" data-cy="registrations-sync-bar" />
      @if (loading()) {
        <section class="panel calendar-state" aria-busy="true" data-cy="registrations-loading"><p data-cy="registrations-loading-label">{{ i18n.t('common.loading') }}</p></section>
      } @else if (error()) {
        <section class="panel calendar-state" role="alert" data-cy="registrations-error"><p data-cy="registrations-error-label">{{ i18n.t('registration.loadFailed') }}</p><button mat-stroked-button type="button" data-cy="registrations-retry" (click)="load()">{{ i18n.t('common.retry') }}</button></section>
      } @else {
        <section class="stack" aria-labelledby="upcoming-registrations-title" data-cy="registrations-upcoming">
          <h2 id="upcoming-registrations-title" data-cy="registrations-upcoming-title">{{ i18n.t('registration.upcoming') }}</h2>
          @if (!groups().upcoming.length) { <p class="panel registration-empty" data-cy="registrations-upcoming-empty">{{ i18n.t('registration.noUpcoming') }}</p> }
          @for (attempt of groups().upcoming; track attempt.attemptId) { <ng-container [ngTemplateOutlet]="attemptCard" [ngTemplateOutletContext]="{ $implicit: attempt }" /> }
        </section>
        <section class="stack" aria-labelledby="registration-history-title" data-cy="registrations-history">
          <h2 id="registration-history-title" data-cy="registrations-history-title">{{ i18n.t('registration.history') }}</h2>
          @if (!groups().history.length) { <p class="panel registration-empty" data-cy="registrations-history-empty">{{ i18n.t('registration.noHistory') }}</p> }
          @for (attempt of groups().history; track attempt.attemptId) { <ng-container [ngTemplateOutlet]="attemptCard" [ngTemplateOutletContext]="{ $implicit: attempt }" /> }
        </section>
        @if (totalCount() > pageSize) {
          <nav class="pagination" [attr.aria-label]="i18n.t('registration.pagesAria')" data-cy="registrations-pagination"><button mat-stroked-button type="button" data-cy="registrations-page-prev" [disabled]="page() === 1" (click)="changePage(page() - 1)">{{ i18n.t('common.previous') }}</button><span data-cy="registrations-page-label">{{ page() }} / {{ pageCount() }}</span><button mat-stroked-button type="button" data-cy="registrations-page-next" [disabled]="page() >= pageCount()" (click)="changePage(page() + 1)">{{ i18n.t('common.next') }}</button></nav>
        }
      }
    </section>
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" data-cy="registrations-back-bottom" />

    <ng-template #attemptCard let-attempt>
      <article class="panel registration-card" data-cy="registration-attempt">
        <div data-cy="registration-attempt-header"><p class="kicker" data-cy="registration-attempt-org">{{ attempt.organizationName }}</p><h3 data-cy="registration-attempt-title"><a [routerLink]="['/events', attempt.eventSlug]" data-cy="registration-attempt-link">{{ attempt.eventTitle }}</a></h3></div>
        <dl data-cy="registration-attempt-details"><div data-cy="registration-attempt-venue-row"><dt data-cy="registration-attempt-venue-time-label">{{ i18n.t('event.venueTime') }}</dt><dd data-cy="registration-attempt-venue-time">{{ venueTime(attempt) }}</dd></div><div data-cy="registration-attempt-status-row"><dt data-cy="registration-attempt-status-label">{{ i18n.t('registration.status') }}</dt><dd data-cy="registration-attempt-status">{{ statusLabel(attempt.status) }}</dd></div></dl>
      </article>
    </ng-template>
  `
})
export class MyRegistrationsComponent implements OnInit {
  readonly i18n = inject(I18nService);
  private readonly registrations = inject(EventRegistrationService);
  private readonly cache = inject(ServerReadCacheService);
  readonly items = signal<EventRegistrationHistoryResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly page = signal(1);
  readonly totalCount = signal(0);
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly stale = signal(false);
  readonly pageSize = 20;
  private readonly latest = new LatestRequest();
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));
  readonly groups = computed(() => partitionRegistrationAttempts(this.items()));

  ngOnInit(): void { void this.load(); }

  async load(options: { force?: boolean } = {}): Promise<void> {
    const request = this.latest.begin();
    this.loading.set(true);
    this.error.set(false);
    try {
      const result = await this.cache.readCached(registrationsCacheKey(this.page()), () => this.registrations.list(this.page(), this.pageSize), options);
      if (!this.latest.isCurrent(request)) return;
      this.items.set(result.value.items);
      this.totalCount.set(result.value.totalCount);
      this.syncedAt.set(result.fetchedAt);
      this.stale.set(result.stale);
    } catch {
      if (this.latest.isCurrent(request)) this.error.set(true);
    } finally {
      if (this.latest.isCurrent(request)) this.loading.set(false);
    }
  }

  sync(): void { void this.load({ force: true }); }

  changePage(page: number): void {
    this.page.set(Math.min(Math.max(page, 1), this.pageCount()));
    void this.load();
  }

  venueTime(attempt: EventRegistrationHistoryResponse): string {
    return registrationVenueTime(attempt, this.i18n.language());
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'Confirmed': return this.i18n.t('registration.statusConfirmed');
      case 'CancelledByUser': return this.i18n.t('registration.statusCancelledByUser');
      case 'CancelledByTournament': return this.i18n.t('registration.statusCancelledByEvent');
      case 'RemovedByOrganizer': return this.i18n.t('registration.statusRemovedByOrganizer');
      default: return status;
    }
  }
}
