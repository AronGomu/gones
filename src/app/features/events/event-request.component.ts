import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { ApiProblemError } from '../../api/api-boundary';
import { EventProposalReviewResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { EventProposalService } from './event-proposal.service';
import { ServerSanitizedHtmlComponent } from './server-sanitized-html.component';

type EventRequestState = 'loading' | 'review' | 'reason' | 'approved' | 'refused' | 'expired' | 'handled' | 'error';

@Component({
  standalone: true,
  imports: [RouterLink, FormsModule, MatButtonModule, BackButtonComponent, ServerSanitizedHtmlComponent],
  template: `
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="top" data-cy="event-request-back-top" />
    <section class="info-page" data-cy="event-request-page" aria-labelledby="event-request-title">
      @switch (state()) {
        @case ('loading') {
          <p role="status" data-cy="event-request-loading">{{ i18n.t('common.loading') }}</p>
        }
        @case ('expired') {
          <section class="panel" data-cy="event-request-expired">
            <h1 data-cy="event-request-expired-title">{{ i18n.t('proposal.expiredTitle') }}</h1>
            <p data-cy="event-request-expired-body">{{ i18n.t('proposal.expiredBody') }}</p>
          </section>
        }
        @case ('handled') {
          <section class="panel" data-cy="event-request-handled">
            <h1 data-cy="event-request-handled-title">{{ i18n.t('proposal.handledTitle') }}</h1>
            <p data-cy="event-request-handled-body">{{ i18n.t('proposal.handledBody') }}</p>
          </section>
        }
        @case ('error') {
          <section class="panel" role="alert" data-cy="event-request-error">
            <p data-cy="event-request-error-message">{{ i18n.t('proposal.reviewLoadFailed') }}</p>
            <button mat-stroked-button type="button" data-cy="event-request-retry" (click)="load()">{{ i18n.t('common.retry') }}</button>
          </section>
        }
        @case ('review') {
          @if (proposal(); as review) {
            <h1 id="event-request-title" data-cy="event-request-title">{{ review.event.title }}</h1>
            <p data-cy="event-request-submitted-by">{{ i18n.t('proposal.submittedBy', { username: review.submittedByUsername }) }}</p>
            <dl class="tournament-request-facts" data-cy="event-request-facts">
              <dt data-cy="event-request-fact-organization-label">{{ i18n.t('event.organization') }}</dt>
              <dd data-cy="event-request-fact-organization">{{ review.organizationName || '—' }}</dd>
              <dt data-cy="event-request-fact-formats-label">{{ i18n.t('event.format') }}</dt>
              <dd data-cy="event-request-fact-formats">{{ review.formatNames.join(', ') }}</dd>
              <dt data-cy="event-request-fact-venue-label">{{ i18n.t('common.location') }}</dt>
              <dd data-cy="event-request-fact-venue">{{ venueLine(review) }}</dd>
              <dt data-cy="event-request-fact-starts-label">{{ i18n.t('eventCreate.start') }}</dt>
              <dd data-cy="event-request-fact-starts">{{ review.event.startsAtLocal }}</dd>
              <dt data-cy="event-request-fact-ends-label">{{ i18n.t('eventCreate.end') }}</dt>
              <dd data-cy="event-request-fact-ends">{{ review.endsAtLocal || '—' }}</dd>
              <dt data-cy="event-request-fact-timezone-label">{{ i18n.t('eventCreate.zone') }}</dt>
              <dd data-cy="event-request-fact-timezone">{{ review.timeZoneId }}</dd>
              <dt data-cy="event-request-fact-capacity-label">{{ i18n.t('event.capacity') }}</dt>
              <dd data-cy="event-request-fact-capacity">{{ review.event.capacity }}</dd>
              <dt data-cy="event-request-fact-summary-label">{{ i18n.t('eventCreate.summary') }}</dt>
              <dd data-cy="event-request-fact-summary">{{ review.event.summary || '—' }}</dd>
            </dl>
            <gones-server-sanitized-html class="tournament-request-body" data-cy="event-request-body" [html]="review.bodyHtml || ''" />
            <div class="info-actions" data-cy="event-request-actions">
              <button mat-flat-button class="home-primary-action" type="button" data-cy="event-request-validate" [disabled]="pending()" (click)="approve()">{{ i18n.t('proposal.validate') }}</button>
              <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="event-request-refuse" [disabled]="pending()" (click)="state.set('reason')">{{ i18n.t('proposal.refuse') }}</button>
            </div>
          }
        }
        @case ('reason') {
          <h1 data-cy="event-request-reason-title">{{ i18n.t('proposal.reviewTitle') }}</h1>
          <label for="event-request-reason-input" data-cy="event-request-reason-label">{{ i18n.t('proposal.reasonLabel') }}</label>
          <textarea id="event-request-reason-input" data-cy="event-request-reason" maxlength="500" [ngModel]="reason()" (ngModelChange)="reason.set($event)"></textarea>
          <div class="info-actions" data-cy="event-request-reason-actions">
            <button mat-stroked-button type="button" data-cy="event-request-reason-cancel" [disabled]="pending()" (click)="state.set('review')">{{ i18n.t('common.cancel') }}</button>
            <button mat-flat-button class="home-primary-action" type="button" data-cy="event-request-send-reason" [disabled]="!reason().trim() || pending()" (click)="sendReason()">{{ i18n.t('proposal.sendCancellationReasons') }}</button>
          </div>
        }
        @case ('approved') {
          <section class="panel" role="status" data-cy="event-request-approved">
            <h1 data-cy="event-request-approved-title">{{ i18n.t('proposal.approvedTitle') }}</h1>
            <p data-cy="event-request-approved-body">{{ i18n.t('proposal.approvedBody') }}</p>
            @if (slug()) {
              <a mat-flat-button class="home-primary-action" [routerLink]="['/events', slug()]" data-cy="event-request-approved-link">{{ i18n.t('event.title') }}</a>
            }
          </section>
        }
        @case ('refused') {
          <section class="panel" role="status" data-cy="event-request-refused">
            <h1 data-cy="event-request-refused-title">{{ i18n.t('proposal.refusedTitle') }}</h1>
            <p data-cy="event-request-refused-body">{{ i18n.t('proposal.refusedBody') }}</p>
          </section>
        }
      }
    </section>
    <gones-back-button [link]="['/']" [label]="i18n.t('nav.returnToMenu')" position="bottom" data-cy="event-request-back-bottom" />
  `
})
export class EventRequestComponent {
  readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly proposals = inject(EventProposalService);

  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  readonly state = signal<EventRequestState>('loading');
  readonly proposal = signal<EventProposalReviewResponse | null>(null);
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

  venueLine(review: EventProposalReviewResponse): string {
    const t = review.event;
    return [t.location.streetAddress, t.location.postalCode, t.location.city, t.location.country].filter(Boolean).join(', ');
  }

  private stateForError(error: unknown): EventRequestState {
    if (error instanceof ApiProblemError) {
      if (error.status === 404) return 'expired';
      if (error.status === 409) return 'handled';
    }
    return 'error';
  }
}
