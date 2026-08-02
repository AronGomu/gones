import { NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { TournamentRegistrationHistoryResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { partitionRegistrationAttempts, registrationVenueTime } from './my-registrations';
import { TournamentRegistrationService } from './tournament-registration.service';

@Component({
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, MatButtonModule],
  template: `
    <section class="registrations-page stack" aria-labelledby="registrations-title" data-cy="registrations-page">
      <header class="page-heading"><div><p class="kicker">{{ i18n.t('registration.accountKicker') }}</p><h1 id="registrations-title">{{ i18n.t('registration.myRegistrations') }}</h1></div></header>
      @if (loading()) {
        <section class="panel calendar-state" aria-busy="true" data-cy="registrations-loading"><p>{{ i18n.t('common.loading') }}</p></section>
      } @else if (error()) {
        <section class="panel calendar-state" role="alert" data-cy="registrations-error"><p>{{ i18n.t('registration.loadFailed') }}</p><button mat-stroked-button type="button" (click)="load()">{{ i18n.t('common.retry') }}</button></section>
      } @else {
        <section class="stack" aria-labelledby="upcoming-registrations-title">
          <h2 id="upcoming-registrations-title">{{ i18n.t('registration.upcoming') }}</h2>
          @if (!groups().upcoming.length) { <p class="panel registration-empty">{{ i18n.t('registration.noUpcoming') }}</p> }
          @for (attempt of groups().upcoming; track attempt.attemptId) { <ng-container [ngTemplateOutlet]="attemptCard" [ngTemplateOutletContext]="{ $implicit: attempt }" /> }
        </section>
        <section class="stack" aria-labelledby="registration-history-title">
          <h2 id="registration-history-title">{{ i18n.t('registration.history') }}</h2>
          @if (!groups().history.length) { <p class="panel registration-empty">{{ i18n.t('registration.noHistory') }}</p> }
          @for (attempt of groups().history; track attempt.attemptId) { <ng-container [ngTemplateOutlet]="attemptCard" [ngTemplateOutletContext]="{ $implicit: attempt }" /> }
        </section>
        @if (totalCount() > pageSize) {
          <nav class="pagination" [attr.aria-label]="i18n.t('registration.pagesAria')"><button mat-stroked-button type="button" [disabled]="page() === 1" (click)="changePage(page() - 1)">{{ i18n.t('common.previous') }}</button><span>{{ page() }} / {{ pageCount() }}</span><button mat-stroked-button type="button" [disabled]="page() >= pageCount()" (click)="changePage(page() + 1)">{{ i18n.t('common.next') }}</button></nav>
        }
      }
    </section>

    <ng-template #attemptCard let-attempt>
      <article class="panel registration-card" data-cy="registration-attempt">
        <div><p class="kicker">{{ attempt.organizationName }}</p><h3><a [routerLink]="['/calendar/tournaments', attempt.tournamentSlug]">{{ attempt.tournamentTitle }}</a></h3></div>
        <dl><div><dt>{{ i18n.t('calendar.venueTime') }}</dt><dd>{{ venueTime(attempt) }}</dd></div><div><dt>{{ i18n.t('registration.status') }}</dt><dd>{{ statusLabel(attempt.status) }}</dd></div></dl>
      </article>
    </ng-template>
  `
})
export class MyRegistrationsComponent implements OnInit {
  readonly i18n = inject(I18nService);
  private readonly registrations = inject(TournamentRegistrationService);
  readonly items = signal<TournamentRegistrationHistoryResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly page = signal(1);
  readonly totalCount = signal(0);
  readonly pageSize = 20;
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));
  readonly groups = computed(() => partitionRegistrationAttempts(this.items()));

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const response = await this.registrations.list(this.page(), this.pageSize);
      this.items.set(response.items);
      this.totalCount.set(response.totalCount);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  changePage(page: number): void {
    this.page.set(Math.min(Math.max(page, 1), this.pageCount()));
    void this.load();
  }

  venueTime(attempt: TournamentRegistrationHistoryResponse): string {
    return registrationVenueTime(attempt, this.i18n.language());
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'Confirmed': return this.i18n.t('registration.statusConfirmed');
      case 'CancelledByUser': return this.i18n.t('registration.statusCancelledByUser');
      case 'CancelledByTournament': return this.i18n.t('registration.statusCancelledByTournament');
      case 'RemovedByOrganizer': return this.i18n.t('registration.statusRemovedByOrganizer');
      default: return status;
    }
  }
}
