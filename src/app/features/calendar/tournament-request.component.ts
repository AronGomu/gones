import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { ApiProblemError } from '../../api/api-boundary';
import { TournamentProposalReviewResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { TournamentProposalService } from './tournament-proposal.service';

type TournamentRequestState = 'loading' | 'review' | 'reason' | 'approved' | 'refused' | 'expired' | 'handled' | 'error';

@Component({
  standalone: true,
  imports: [RouterLink, FormsModule, MatButtonModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="tournament-request-back-top" />
    <section class="info-page" data-cy="tournament-request-page" aria-labelledby="tournament-request-title">
      @switch (state()) {
        @case ('loading') {
          <p role="status" data-cy="tournament-request-loading">{{ i18n.t('common.loading') }}</p>
        }
        @case ('expired') {
          <section class="panel" data-cy="tournament-request-expired">
            <h1 data-cy="tournament-request-expired-title">{{ i18n.t('proposal.expiredTitle') }}</h1>
            <p data-cy="tournament-request-expired-body">{{ i18n.t('proposal.expiredBody') }}</p>
          </section>
        }
        @case ('handled') {
          <section class="panel" data-cy="tournament-request-handled">
            <h1 data-cy="tournament-request-handled-title">{{ i18n.t('proposal.handledTitle') }}</h1>
            <p data-cy="tournament-request-handled-body">{{ i18n.t('proposal.handledBody') }}</p>
          </section>
        }
        @case ('error') {
          <section class="panel" role="alert" data-cy="tournament-request-error">
            <p data-cy="tournament-request-error-message">{{ i18n.t('proposal.reviewLoadFailed') }}</p>
            <button mat-stroked-button type="button" data-cy="tournament-request-retry" (click)="load()">{{ i18n.t('common.retry') }}</button>
          </section>
        }
        @case ('review') {
          @if (proposal(); as review) {
            <h1 id="tournament-request-title" data-cy="tournament-request-title">{{ review.tournament.title }}</h1>
            <p data-cy="tournament-request-submitted-by">{{ i18n.t('proposal.submittedBy', { username: review.submittedByUsername }) }}</p>
            <dl class="tournament-request-facts" data-cy="tournament-request-facts">
              <dt data-cy="tournament-request-fact-organization-label">{{ i18n.t('calendar.organization') }}</dt>
              <dd data-cy="tournament-request-fact-organization">{{ review.organizationName || '—' }}</dd>
              <dt data-cy="tournament-request-fact-formats-label">{{ i18n.t('calendar.format') }}</dt>
              <dd data-cy="tournament-request-fact-formats">{{ review.formatNames.join(', ') }}</dd>
              <dt data-cy="tournament-request-fact-venue-label">{{ i18n.t('common.location') }}</dt>
              <dd data-cy="tournament-request-fact-venue">{{ venueLine(review) }}</dd>
              <dt data-cy="tournament-request-fact-starts-label">{{ i18n.t('tournamentCreate.start') }}</dt>
              <dd data-cy="tournament-request-fact-starts">{{ review.tournament.startsAtLocal }}</dd>
              <dt data-cy="tournament-request-fact-ends-label">{{ i18n.t('tournamentCreate.end') }}</dt>
              <dd data-cy="tournament-request-fact-ends">{{ review.tournament.endsAtLocal || '—' }}</dd>
              <dt data-cy="tournament-request-fact-timezone-label">{{ i18n.t('tournamentCreate.zone') }}</dt>
              <dd data-cy="tournament-request-fact-timezone">{{ review.tournament.timeZoneId }}</dd>
              <dt data-cy="tournament-request-fact-capacity-label">{{ i18n.t('calendar.capacity') }}</dt>
              <dd data-cy="tournament-request-fact-capacity">{{ review.tournament.capacity ?? '—' }}</dd>
              <dt data-cy="tournament-request-fact-summary-label">{{ i18n.t('tournamentCreate.summary') }}</dt>
              <dd data-cy="tournament-request-fact-summary">{{ review.tournament.summary || '—' }}</dd>
            </dl>
            <pre class="tournament-request-body" data-cy="tournament-request-body">{{ review.tournament.bodyHtml || '' }}</pre>
            <div class="info-actions" data-cy="tournament-request-actions">
              <button mat-flat-button class="home-primary-action" type="button" data-cy="tournament-request-validate" [disabled]="pending()" (click)="approve()">{{ i18n.t('proposal.validate') }}</button>
              <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="tournament-request-refuse" [disabled]="pending()" (click)="state.set('reason')">{{ i18n.t('proposal.refuse') }}</button>
            </div>
          }
        }
        @case ('reason') {
          <h1 data-cy="tournament-request-reason-title">{{ i18n.t('proposal.reviewTitle') }}</h1>
          <label for="tournament-request-reason-input" data-cy="tournament-request-reason-label">{{ i18n.t('proposal.reasonLabel') }}</label>
          <textarea id="tournament-request-reason-input" data-cy="tournament-request-reason" maxlength="500" [ngModel]="reason()" (ngModelChange)="reason.set($event)"></textarea>
          <div class="info-actions" data-cy="tournament-request-reason-actions">
            <button mat-stroked-button type="button" data-cy="tournament-request-reason-cancel" [disabled]="pending()" (click)="state.set('review')">{{ i18n.t('common.cancel') }}</button>
            <button mat-flat-button class="home-primary-action" type="button" data-cy="tournament-request-send-reason" [disabled]="!reason().trim() || pending()" (click)="sendReason()">{{ i18n.t('proposal.sendCancellationReasons') }}</button>
          </div>
        }
        @case ('approved') {
          <section class="panel" role="status" data-cy="tournament-request-approved">
            <h1 data-cy="tournament-request-approved-title">{{ i18n.t('proposal.approvedTitle') }}</h1>
            <p data-cy="tournament-request-approved-body">{{ i18n.t('proposal.approvedBody') }}</p>
            @if (slug()) {
              <a mat-flat-button class="home-primary-action" [routerLink]="['/calendar/tournaments', slug()]" data-cy="tournament-request-approved-link">{{ i18n.t('calendar.title') }}</a>
            }
          </section>
        }
        @case ('refused') {
          <section class="panel" role="status" data-cy="tournament-request-refused">
            <h1 data-cy="tournament-request-refused-title">{{ i18n.t('proposal.refusedTitle') }}</h1>
            <p data-cy="tournament-request-refused-body">{{ i18n.t('proposal.refusedBody') }}</p>
          </section>
        }
      }
    </section>
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" data-cy="tournament-request-back-bottom" />
  `
})
export class TournamentRequestComponent {
  readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly proposals = inject(TournamentProposalService);

  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  readonly state = signal<TournamentRequestState>('loading');
  readonly proposal = signal<TournamentProposalReviewResponse | null>(null);
  readonly slug = signal('');
  readonly reason = signal('');
  readonly pending = signal(false);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const review = await this.proposals.reviewByToken(this.token);
      this.proposal.set(review);
      this.state.set('review');
    } catch (error) {
      this.state.set(this.stateForError(error));
    }
  }

  async approve(): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    try {
      const decision = await this.proposals.approveByToken(this.token);
      this.slug.set(decision.slug ?? '');
      this.state.set('approved');
    } catch (error) {
      this.state.set(this.stateForError(error));
    } finally {
      this.pending.set(false);
    }
  }

  async sendReason(): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    try {
      await this.proposals.rejectByToken(this.token, this.reason().trim());
      this.state.set('refused');
    } catch (error) {
      this.state.set(this.stateForError(error));
    } finally {
      this.pending.set(false);
    }
  }

  venueLine(review: TournamentProposalReviewResponse): string {
    const t = review.tournament;
    return [t.streetAddress, t.postalCode, t.city, t.country].filter(Boolean).join(', ');
  }

  private stateForError(error: unknown): TournamentRequestState {
    if (error instanceof ApiProblemError) {
      if (error.status === 404) return 'expired';
      if (error.status === 409) return 'handled';
    }
    return 'error';
  }
}
