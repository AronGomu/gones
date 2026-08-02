import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { PublicTournamentDetailResponse } from '../../api/generated/gones-api';
import { ApiProblemError } from '../../api/api-boundary';
import { I18nService } from '../../i18n/i18n.service';
import { BackButtonComponent } from '../../shared/back-button.component';
import { PublicTournamentService } from './public-tournament.service';
import { TournamentDetailViewComponent } from './tournament-detail-view.component';

@Component({
  standalone: true,
  imports: [MatButtonModule, BackButtonComponent, TournamentDetailViewComponent],
  template: `
    <gones-back-button [link]="['/calendar']" [label]="i18n.t('nav.backToEvents')" position="top" />
    @if (stale()) { <aside class="warning calendar-offline-banner" role="status" data-cy="calendar-stale">{{ i18n.t('calendar.cachedStale') }}</aside> }
    @if (loading()) { <section class="panel event-section calendar-detail-skeleton" aria-busy="true" data-cy="calendar-loading"><div></div><div></div><div></div></section> }
    @else if (error()) { <section class="panel calendar-state" role="alert" data-cy="calendar-error"><h1>{{ i18n.t('calendar.detailLoadFailed') }}</h1><button mat-stroked-button type="button" (click)="load()">{{ i18n.t('common.retry') }}</button></section> }
    @else if (notFound()) { <section class="panel calendar-state" data-cy="calendar-not-found"><h1>{{ i18n.t('event.notFoundTitle') }}</h1><p>{{ i18n.t('event.notFoundBody') }}</p></section> }
    @else if (tournament(); as item) {
      <div data-cy="public-tournament-detail"><gones-tournament-detail-view [tournament]="item" [icsUrl]="service.icsUrl(item.slug)" /></div>
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
}
