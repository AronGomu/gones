import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, WritableSignal, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../../i18n/i18n.service';
import type { MessageKey } from '../../i18n/messages';
import { BackButtonComponent } from '../../shared/back-button.component';
import { SyncBarComponent } from '../../shared/sync-bar.component';
import { logBoundaryError } from '../../shared/app-logger';
import { EventCatalogCacheService } from '../events/event-catalog-cache.service';
import { EventDatePresentation, PublicEventView, eventDatePresentation } from '../events/public-event-list';
import { selectUpcomingEvents } from './about-upcoming-events';

export interface AboutStaffMember {
  readonly id: 'gregory' | 'ganesh' | 'edouart' | 'alex' | 'loic' | 'luka' | 'nathan' | 'yoan' | 'simon';
  readonly name: string;
  readonly image?: string;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
  readonly roleKey?: MessageKey;
  readonly bioKey: MessageKey;
  readonly complete: boolean;
}

export interface AboutContributor {
  readonly id: 'contributor-1' | 'contributor-2' | 'contributor-3';
  readonly nameKey: MessageKey;
  readonly descriptionKey: MessageKey;
}

export interface AboutTournamentBand {
  readonly id: 'weekly' | 'monthly' | 'salty' | 'leagues';
  readonly titleKey: MessageKey;
  readonly whenKey: MessageKey;
  readonly whereKey: MessageKey;
  readonly fieldKey: MessageKey;
  readonly bodyKey: MessageKey;
  readonly actionKey: MessageKey;
  readonly image: string;
  readonly imageAltKey: MessageKey;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

export const aboutStaff: readonly AboutStaffMember[] = [
  { id: 'gregory', name: 'Gregory Millon', image: 'assets/images/greg-avatar.jpeg', imageWidth: 1152, imageHeight: 2048, roleKey: 'about.team.roleFounder', bioKey: 'about.team.bioGregory', complete: true },
  { id: 'ganesh', name: 'Ganesh', roleKey: 'about.team.roleFounder', bioKey: 'about.team.bioPending', complete: false },
  { id: 'edouart', name: 'Edouart', roleKey: 'about.team.roleFounder', bioKey: 'about.team.bioPending', complete: false },
  { id: 'alex', name: 'Alex Noir', image: 'assets/images/alex-avatar-alpha-bolt.jpeg', imageWidth: 672, imageHeight: 936, bioKey: 'about.team.bioAlex', complete: true },
  { id: 'loic', name: 'Loïc Chowchow', image: 'assets/images/chowchow-avatar.jpg', imageWidth: 1080, imageHeight: 1920, roleKey: 'about.team.roleCook', bioKey: 'about.team.bioLoic', complete: true },
  { id: 'luka', name: 'Luka Mrakovcic', image: 'assets/images/lukas-avatar.jpg', imageWidth: 720, imageHeight: 719, roleKey: 'about.team.roleCommunityManager', bioKey: 'about.team.bioLuka', complete: true },
  { id: 'nathan', name: 'Nathan Flachaire', bioKey: 'about.team.bioPending', complete: false },
  { id: 'yoan', name: 'Yoan', roleKey: 'about.team.roleOrganizer', bioKey: 'about.team.bioPending', complete: false },
  { id: 'simon', name: 'Simon', roleKey: 'about.team.roleOrganizer', bioKey: 'about.team.bioPending', complete: false }
];

export const aboutContributors: readonly AboutContributor[] = [
  { id: 'contributor-1', nameKey: 'about.contributors.pendingName', descriptionKey: 'about.contributors.pendingDescription' },
  { id: 'contributor-2', nameKey: 'about.contributors.pendingName', descriptionKey: 'about.contributors.pendingDescription' },
  { id: 'contributor-3', nameKey: 'about.contributors.pendingName', descriptionKey: 'about.contributors.pendingDescription' }
];

export const aboutTournamentBands: readonly AboutTournamentBand[] = [
  { id: 'weekly', titleKey: 'about.tournament.weekly.title', whenKey: 'about.tournament.weekly.when', whereKey: 'about.tournament.weekly.where', fieldKey: 'about.tournament.weekly.field', bodyKey: 'about.tournament.weekly.body', actionKey: 'about.tournament.weekly.action', image: 'assets/images/2024-01-gones-legacy-brindas-01.jpeg', imageAltKey: 'about.tournament.weekly.imageAlt', imageWidth: 2048, imageHeight: 1536 },
  { id: 'monthly', titleKey: 'about.tournament.monthly.title', whenKey: 'about.tournament.monthly.when', whereKey: 'about.tournament.monthly.where', fieldKey: 'about.tournament.monthly.field', bodyKey: 'about.tournament.monthly.body', actionKey: 'about.tournament.monthly.action', image: 'assets/images/2021-12-gones-legacy-top-8-cartajeu.jpeg', imageAltKey: 'about.tournament.monthly.imageAlt', imageWidth: 2048, imageHeight: 1536 },
  { id: 'salty', titleKey: 'about.tournament.salty.title', whenKey: 'about.tournament.salty.when', whereKey: 'about.tournament.salty.where', fieldKey: 'about.tournament.salty.field', bodyKey: 'about.tournament.salty.body', actionKey: 'about.tournament.salty.action', image: 'assets/images/2023-05-gones-legacy-fact-top-8.jpeg', imageAltKey: 'about.tournament.salty.imageAlt', imageWidth: 2048, imageHeight: 1536 },
  { id: 'leagues', titleKey: 'about.tournament.leagues.title', whenKey: 'about.tournament.leagues.when', whereKey: 'about.tournament.leagues.where', fieldKey: 'about.tournament.leagues.field', bodyKey: 'about.tournament.leagues.body', actionKey: 'about.tournament.leagues.action', image: 'assets/images/2025-01-mtgones-10-years-top-2.jpeg', imageAltKey: 'about.tournament.leagues.imageAlt', imageWidth: 2048, imageHeight: 1152 }
];

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, BackButtonComponent, SyncBarComponent],
  host: { '[attr.lang]': 'i18n.language()', class: 'about-route' },
  styles: [`
    :host.about-route .about-next-up__skeleton {
      display: block;
      min-height: 5.5rem;
      width: 100%;
      box-sizing: border-box;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 4px;
      background: linear-gradient(90deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.06));
    }
  `],
  template: `
    <gones-back-button data-cy="about-back-top" [link]="['/']" [label]="i18n.t('about.back')" position="top" />
    <nav class="about-internal-nav" data-cy="about-internal-nav" [attr.aria-label]="i18n.t('about.nav.aria')">
      <a href="#association" data-cy="about-nav-association">{{ i18n.t('about.nav.association') }}</a>
      <a href="#tournaments" data-cy="about-nav-tournaments">{{ i18n.t('about.nav.tournaments') }}</a>
      <a href="#staff" data-cy="about-nav-staff">{{ i18n.t('about.nav.staff') }}</a>
      <a routerLink="/events" data-cy="about-nav-calendar">{{ i18n.t('about.nav.calendar') }}</a>
    </nav>
    <div class="about-page" data-cy="about-page">
      <section class="about-hero" data-cy="about-hero" aria-labelledby="about-title">
        <img class="about-hero__image" src="assets/images/2025-01-ice-mtgones-10-years.jpeg" alt="MTGones players gathered at the 10-year anniversary Ice tournament" width="2048" height="1152" data-cy="about-hero-image">
        <div class="about-hero__copy" data-cy="about-hero-copy">
          <p class="kicker" data-cy="about-hero-kicker" data-reveal>{{ i18n.t('about.hero.kicker') }}</p>
          <h1 id="about-title" data-cy="about-hero-title" data-reveal style="--reveal-delay: 70ms">{{ i18n.t('about.hero.title') }}</h1>
          <p class="about-hero__lede" data-cy="about-hero-lede" data-reveal style="--reveal-delay: 140ms">{{ i18n.t('about.hero.lede') }}</p>
          <div class="info-actions" data-cy="about-hero-actions" data-reveal style="--reveal-delay: 210ms">
            <a mat-flat-button class="home-primary-action" routerLink="/events" data-cy="about-hero-calendar-link">{{ i18n.t('about.hero.calendar') }}</a>
            <a mat-stroked-button class="secondary-action" href="#tournaments" data-cy="about-hero-team-link">{{ i18n.t('about.hero.team') }}</a>
          </div>
        </div>
      </section>

      <section class="about-next-up" data-cy="about-next-up" aria-labelledby="about-next-up-title">
        <header class="about-section-heading" data-cy="about-next-up-heading">
          <p class="kicker" data-cy="about-next-up-kicker">{{ i18n.t('about.nextUp.kicker') }}</p>
          <h2 id="about-next-up-title" data-cy="about-next-up-title">{{ i18n.t('about.nextUp.title') }}</h2>
          <gones-sync-bar cyPrefix="about-next-up" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="syncUpcomingEvents()" data-cy="about-next-up-sync-bar" />
        </header>
        @if (loading()) {
          <div class="about-next-up__loading" aria-busy="true" aria-live="polite" data-cy="about-next-up-loading">
            <span class="sr-only" data-cy="about-next-up-loading-label">{{ i18n.t('common.loading') }}</span>
            @for (_ of upcomingSkeletons; track $index) { <div class="about-next-up__skeleton" [attr.data-cy]="'about-next-up-skeleton-' + $index"></div> }
          </div>
        } @else if (error()) {
          <div class="panel about-next-up__state" role="alert" data-cy="about-next-up-error">
            <p data-cy="about-next-up-error-body">{{ i18n.t('about.nextUp.loadFailed') }}</p>
            <a mat-stroked-button class="secondary-action" routerLink="/events" data-cy="about-next-up-error-calendar-link">{{ i18n.t('about.nextUp.calendar') }}</a>
            <button mat-stroked-button type="button" data-cy="about-next-up-retry" [disabled]="loading()" (click)="retryUpcomingEvents()">{{ i18n.t('common.retry') }}</button>
          </div>
        } @else if (upcomingEvents().length) {
          <div class="about-next-up__list" data-cy="about-next-up-list">
            @for (event of upcomingEvents(); track event.id) {
              <a class="panel about-next-up__row" [routerLink]="['/events', event.slug]" [attr.data-cy]="'about-next-up-event-' + event.slug">
                <span class="about-next-up__row-copy" [attr.data-cy]="'about-next-up-event-copy-' + event.slug">
                  <strong [attr.data-cy]="'about-next-up-event-title-' + event.slug">{{ event.displayTitle }}</strong>
                  <time [attr.datetime]="event.startsAtUtc" [attr.data-cy]="'about-next-up-event-date-' + event.slug">{{ upcomingDate(event).primary }}</time>
                  @if (upcomingDate(event).secondary; as secondary) { <span class="viewer-date" [attr.data-cy]="'about-next-up-event-viewer-date-' + event.slug">{{ i18n.t('event.viewerTime') }}: {{ secondary }}</span> }
                </span>
                <span class="about-next-up__venue" [attr.data-cy]="'about-next-up-event-venue-' + event.slug">{{ event.venue.city }}, {{ event.venue.country }}</span>
              </a>
            }
          </div>
        } @else {
          <div class="panel about-next-up__state" data-cy="about-next-up-empty">
            <p data-cy="about-next-up-empty-title">{{ i18n.t('about.nextUp.emptyTitle') }}</p>
            <p data-cy="about-next-up-empty-body">{{ i18n.t('about.nextUp.emptyBody') }}</p>
            <a mat-stroked-button class="secondary-action" routerLink="/events" data-cy="about-next-up-empty-calendar-link">{{ i18n.t('about.nextUp.calendar') }}</a>
          </div>
        }
      </section>

      <section id="association" class="about-intro" data-cy="about-association" aria-labelledby="association-title">
        <div class="about-intro__heading" data-cy="about-association-heading" data-reveal="left">
          <p class="kicker" data-cy="about-association-kicker">{{ i18n.t('about.intro.kicker') }}</p>
          <h2 id="association-title" data-cy="about-association-title">{{ i18n.t('about.intro.title') }}</h2>
        </div>
        <div class="about-intro__copy" data-cy="about-association-copy" data-reveal="right" style="--reveal-delay: 70ms">
          <p data-cy="about-association-paragraph-1">{{ i18n.t('about.intro.paragraph1') }}</p>
          <p data-cy="about-association-paragraph-2">{{ i18n.t('about.intro.paragraph2') }}</p>
        </div>
        <img class="about-content-image about-intro__image" src="assets/images/2019-10-mtglyon-mtgones-gathering.jpeg" alt="MTGones and MTGLyon players gathered together" width="2048" height="1536" loading="lazy" decoding="async" data-cy="about-association-image">
      </section>

      <section id="tournaments" class="about-tournaments" data-cy="about-tournaments" aria-labelledby="tournaments-title">
        <header class="about-section-heading" data-cy="about-tournaments-heading" data-reveal>
          <p class="kicker" data-cy="about-tournaments-kicker">{{ i18n.t('about.tournaments.kicker') }}</p>
          <h2 id="tournaments-title" data-cy="about-tournaments-title">{{ i18n.t('about.tournaments.title') }}</h2>
          <p data-cy="about-tournaments-body">{{ i18n.t('about.tournaments.body') }}</p>
        </header>
        @for (band of tournamentBands.slice(0, 3); track band.id) {
          <article class="about-tournament-band" [attr.id]="'about-' + band.id" [attr.data-cy]="'about-' + band.id" data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
            <div class="about-tournament-band__copy" [attr.data-cy]="'about-' + band.id + '-copy'">
              <h3 [attr.data-cy]="'about-' + band.id + '-title'">{{ i18n.t(band.titleKey) }}</h3>
              <dl class="about-tournament-band__slots" [attr.data-cy]="'about-' + band.id + '-metadata'">
                <div [attr.data-cy]="'about-' + band.id + '-when'"><dt [attr.data-cy]="'about-' + band.id + '-when-label'">{{ i18n.t('about.tournament.when') }}</dt><dd [attr.data-cy]="'about-' + band.id + '-when-value'">{{ i18n.t(band.whenKey) }}</dd></div>
                <div [attr.data-cy]="'about-' + band.id + '-where'"><dt [attr.data-cy]="'about-' + band.id + '-where-label'">{{ i18n.t('about.tournament.where') }}</dt><dd [attr.data-cy]="'about-' + band.id + '-where-value'">{{ i18n.t(band.whereKey) }}</dd></div>
                <div [attr.data-cy]="'about-' + band.id + '-field'"><dt [attr.data-cy]="'about-' + band.id + '-field-label'">{{ i18n.t('about.tournament.field') }}</dt><dd [attr.data-cy]="'about-' + band.id + '-field-value'">{{ i18n.t(band.fieldKey) }}</dd></div>
              </dl>
              <p [attr.data-cy]="'about-' + band.id + '-body'">{{ i18n.t(band.bodyKey) }}</p>
              <a mat-stroked-button class="secondary-action" routerLink="/events" [attr.data-cy]="'about-' + band.id + '-calendar-link'">{{ i18n.t(band.actionKey) }}</a>
            </div>
            <img class="about-content-image about-tournament-band__image" [src]="band.image" [alt]="i18n.t(band.imageAltKey)" [attr.width]="band.imageWidth" [attr.height]="band.imageHeight" loading="lazy" decoding="async" [attr.data-cy]="'about-' + band.id + '-image'">
          </article>
        }
        <article class="about-fire-ice" data-cy="about-fire-ice" aria-labelledby="about-fire-ice-title" data-reveal="scale">
          <div class="about-fire-ice__art" aria-hidden="true" data-art="assets/card-art/fire-ice.jpg" data-cy="about-fire-ice-art">
            <div class="about-fire-ice__art-half about-fire-ice__art-half--fire" data-cy="about-fire-ice-art-fire"></div>
            <div class="about-fire-ice__art-half about-fire-ice__art-half--ice" data-cy="about-fire-ice-art-ice"></div>
          </div>
          <div class="about-fire-ice__content" data-cy="about-fire-ice-content">
            <h2 id="about-fire-ice-title" data-cy="about-fire-ice-title"><span class="about-fire-ice__fire" data-cy="about-fire-ice-fire">{{ i18n.t('about.fireIce.fire') }}</span> &amp; <span class="about-fire-ice__ice" data-cy="about-fire-ice-ice">{{ i18n.t('about.fireIce.ice') }}</span> — {{ i18n.t('about.fireIce.titleSuffix') }}</h2>
            <p data-cy="about-fire-ice-body">{{ i18n.t('about.fireIce.body') }}</p>
            <div class="about-fire-ice__editions" data-cy="about-fire-ice-editions">
              <div data-cy="about-fire-ice-edition-fire"><strong class="about-fire-ice__fire" data-cy="about-fire-ice-edition-fire-title">{{ i18n.t('about.fireIce.fireEdition') }}</strong><span data-cy="about-fire-ice-edition-fire-body">{{ i18n.t('about.fireIce.fireEditionBody') }}</span></div>
              <div data-cy="about-fire-ice-edition-ice"><strong class="about-fire-ice__ice" data-cy="about-fire-ice-edition-ice-title">{{ i18n.t('about.fireIce.iceEdition') }}</strong><span data-cy="about-fire-ice-edition-ice-body">{{ i18n.t('about.fireIce.iceEditionBody') }}</span></div>
            </div>
            <div class="about-fire-ice__photos" data-cy="about-fire-ice-photos">
              <img src="assets/images/2025-06-fire-team-orga.jpeg" alt="The Fire 2025 organizing team behind the prize table" width="2048" height="1152" loading="lazy" decoding="async" data-cy="about-fire-ice-fire-image">
              <img src="assets/images/2026-01-ice-01.jpeg" alt="Packed tournament hall during the Ice 2026" width="2048" height="1536" loading="lazy" decoding="async" data-cy="about-fire-ice-ice-image">
            </div>
          </div>
        </article>
        @for (band of tournamentBands.slice(3); track band.id) {
          <article class="about-tournament-band" [attr.id]="'about-' + band.id" [attr.data-cy]="'about-' + band.id" data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
            <div class="about-tournament-band__copy" [attr.data-cy]="'about-' + band.id + '-copy'">
              <h3 [attr.data-cy]="'about-' + band.id + '-title'">{{ i18n.t(band.titleKey) }}</h3>
              <dl class="about-tournament-band__slots" [attr.data-cy]="'about-' + band.id + '-metadata'">
                <div [attr.data-cy]="'about-' + band.id + '-when'"><dt [attr.data-cy]="'about-' + band.id + '-when-label'">{{ i18n.t('about.tournament.when') }}</dt><dd [attr.data-cy]="'about-' + band.id + '-when-value'">{{ i18n.t(band.whenKey) }}</dd></div>
                <div [attr.data-cy]="'about-' + band.id + '-where'"><dt [attr.data-cy]="'about-' + band.id + '-where-label'">{{ i18n.t('about.tournament.where') }}</dt><dd [attr.data-cy]="'about-' + band.id + '-where-value'">{{ i18n.t(band.whereKey) }}</dd></div>
                <div [attr.data-cy]="'about-' + band.id + '-field'"><dt [attr.data-cy]="'about-' + band.id + '-field-label'">{{ i18n.t('about.tournament.field') }}</dt><dd [attr.data-cy]="'about-' + band.id + '-field-value'">{{ i18n.t(band.fieldKey) }}</dd></div>
              </dl>
              <p [attr.data-cy]="'about-' + band.id + '-body'">{{ i18n.t(band.bodyKey) }}</p>
              <a mat-stroked-button class="secondary-action" routerLink="/events" [attr.data-cy]="'about-' + band.id + '-calendar-link'">{{ i18n.t(band.actionKey) }}</a>
            </div>
            <img class="about-content-image about-tournament-band__image" [src]="band.image" [alt]="i18n.t(band.imageAltKey)" [attr.width]="band.imageWidth" [attr.height]="band.imageHeight" loading="lazy" decoding="async" [attr.data-cy]="'about-' + band.id + '-image'">
          </article>
        }
      </section>

      <section id="staff" class="about-team" data-cy="about-staff" aria-labelledby="team-title" tabindex="-1">
        <header class="about-section-heading" data-cy="about-staff-heading" data-reveal>
          <p class="kicker" data-cy="about-staff-kicker">{{ i18n.t('about.team.kicker') }}</p>
          <h2 id="team-title" data-cy="about-staff-title">{{ i18n.t('about.team.title') }}</h2>
          <p data-cy="about-staff-body">{{ i18n.t('about.team.body') }}</p>
        </header>
        <div class="about-team-grid" data-cy="about-staff-grid">
          <h3 data-cy="about-staff-founders-title">{{ i18n.t('about.team.founders') }}</h3>
          @for (member of founders; track member.id) {
            <article class="about-person" [attr.data-cy]="'about-person-' + member.id" data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
              @if (member.image; as image) {
                <img class="about-person__portrait" [src]="image" [attr.width]="member.imageWidth" [attr.height]="member.imageHeight" [attr.alt]="member.name" loading="lazy" decoding="async" [attr.data-cy]="'about-person-image-' + member.id">
              } @else {
                <div class="about-person__portrait about-person__portrait--pending" [attr.data-cy]="'about-person-portrait-' + member.id" aria-hidden="true"><span [attr.data-cy]="'about-person-initials-' + member.id">{{ member.name.charAt(0) }}</span><small [attr.data-cy]="'about-person-photo-pending-' + member.id">{{ i18n.t('about.team.photoPending') }}</small></div>
              }
              <div class="about-person__copy" [attr.data-cy]="'about-person-copy-' + member.id">
                @if (member.roleKey; as roleKey) { <p class="about-person__role" [attr.data-cy]="'about-person-role-' + member.id">{{ i18n.t(roleKey) }}</p> }
                <h3 [attr.data-cy]="'about-person-name-' + member.id">{{ member.name }}</h3>
                @if (!member.complete) { <p class="about-person__detail" [attr.data-cy]="'about-person-detail-' + member.id">{{ i18n.t('about.team.namePending') }}</p> }
                <p class="about-person__bio" [attr.data-cy]="'about-person-bio-' + member.id">{{ i18n.t(member.bioKey) }}</p>
              </div>
            </article>
          }
          <h3 data-cy="about-staff-members-title">{{ i18n.t('about.team.members') }}</h3>
          @for (member of members; track member.id) {
            <article class="about-person" [attr.data-cy]="'about-person-' + member.id" data-reveal [style.--reveal-delay]="($index + 3) * 70 + 'ms'">
              @if (member.image; as image) {
                <img class="about-person__portrait" [src]="image" [attr.width]="member.imageWidth" [attr.height]="member.imageHeight" [attr.alt]="member.name" loading="lazy" decoding="async" [attr.data-cy]="'about-person-image-' + member.id">
              } @else {
                <div class="about-person__portrait about-person__portrait--pending" [attr.data-cy]="'about-person-portrait-' + member.id" aria-hidden="true"><span [attr.data-cy]="'about-person-initials-' + member.id">{{ member.name.charAt(0) }}</span><small [attr.data-cy]="'about-person-photo-pending-' + member.id">{{ i18n.t('about.team.photoPending') }}</small></div>
              }
              <div class="about-person__copy" [attr.data-cy]="'about-person-copy-' + member.id">
                @if (member.roleKey; as roleKey) { <p class="about-person__role" [attr.data-cy]="'about-person-role-' + member.id">{{ i18n.t(roleKey) }}</p> }
                <h3 [attr.data-cy]="'about-person-name-' + member.id">{{ member.name }}</h3>
                @if (!member.complete) { <p class="about-person__detail" [attr.data-cy]="'about-person-detail-' + member.id">{{ i18n.t('about.team.namePending') }}</p> }
                <p class="about-person__bio" [attr.data-cy]="'about-person-bio-' + member.id">{{ i18n.t(member.bioKey) }}</p>
              </div>
            </article>
          }
        </div>
      </section>

      <section class="about-contributors" data-cy="about-contributors" aria-labelledby="contributors-title">
        <header class="about-section-heading" data-cy="about-contributors-heading" data-reveal>
          <p class="kicker" data-cy="about-contributors-kicker">{{ i18n.t('about.contributors.kicker') }}</p>
          <h2 id="contributors-title" data-cy="about-contributors-title">{{ i18n.t('about.contributors.title') }}</h2>
          <p data-cy="about-contributors-body">{{ i18n.t('about.contributors.body') }}</p>
        </header>
        <div class="about-contributor-grid" data-cy="about-contributor-grid">
          @for (contributor of contributors; track contributor.id) {
            <article class="about-contributor" [attr.data-cy]="'about-contributor-' + contributor.id" data-reveal [style.--reveal-delay]="$index * 70 + 'ms'">
              <div class="about-contributor__portrait" [attr.data-cy]="'about-contributor-portrait-' + contributor.id" aria-hidden="true"><span [attr.data-cy]="'about-contributor-placeholder-' + contributor.id">?</span></div>
              <div [attr.data-cy]="'about-contributor-copy-' + contributor.id"><h3 [attr.data-cy]="'about-contributor-name-' + contributor.id">{{ i18n.t(contributor.nameKey, { number: contributorNumber($index) }) }}</h3><p [attr.data-cy]="'about-contributor-description-' + contributor.id">{{ i18n.t(contributor.descriptionKey) }}</p></div>
            </article>
          }
        </div>
      </section>

      <section class="about-contact" data-cy="about-contact" aria-labelledby="contact-title">
        <div data-cy="about-contact-copy" data-reveal="left">
          <p class="kicker" data-cy="about-contact-kicker">{{ i18n.t('about.contact.kicker') }}</p>
          <h2 id="contact-title" data-cy="about-contact-title">{{ i18n.t('about.contact.title') }}</h2>
          <p data-cy="about-contact-body">{{ i18n.t('about.contact.body') }}</p>
          <div class="info-actions" data-cy="about-contact-actions"><a mat-flat-button class="home-primary-action" routerLink="/events" data-cy="about-contact-calendar-link">{{ i18n.t('about.contact.calendar') }}</a></div>
        </div>
        <address class="about-contact__details" data-cy="about-contact-details">
          <p data-cy="about-contact-location" data-reveal="right"><span data-cy="about-contact-location-label">{{ i18n.t('about.contact.locationLabel') }}</span><strong data-cy="about-contact-location-value">{{ i18n.t('about.contact.locationValue') }}</strong></p>
          <p data-cy="about-contact-email" data-reveal="right" style="--reveal-delay: 70ms"><span data-cy="about-contact-email-label">{{ i18n.t('about.contact.emailLabel') }}</span><strong data-cy="about-contact-email-value" aria-disabled="true" tabindex="-1">{{ i18n.t('about.contact.comingSoon') }}</strong></p>
          <div class="about-contact__socials" data-cy="about-contact-socials" data-reveal="right" style="--reveal-delay: 140ms">
            <span data-cy="about-contact-socials-label">{{ i18n.t('about.contact.socialsLabel') }}</span>
            <div class="about-social-links" data-cy="about-social-links">
              <a class="about-social-link" href="https://discord.gg/znGRG36Kz" target="_blank" rel="noopener noreferrer" data-cy="about-social-discord" [attr.aria-label]="i18n.t('about.contact.discordAria')"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-cy="about-social-discord-icon"><path d="M8.1 7.2a14 14 0 0 1 7.8 0l.8 1.1a8.4 8.4 0 0 1 2.1 6.1 10.6 10.6 0 0 1-3.3 1.7l-.8-1.1a5.7 5.7 0 0 0 1.2-.6 6.8 6.8 0 0 1-7.8 0c.4.3.8.5 1.2.6l-.8 1.1a10.6 10.6 0 0 1-3.3-1.7 8.4 8.4 0 0 1 2.1-6.1l.8-1.1Zm1.5 4.7c0 .8.5 1.4 1.1 1.4s1.1-.6 1.1-1.4-.5-1.4-1.1-1.4-1.1.6-1.1 1.4Zm3.6 0c0 .8.5 1.4 1.1 1.4s1.1-.6 1.1-1.4-.5-1.4-1.1-1.4-1.1.6-1.1 1.4-1.1 1.4-1.1 1.4Z" data-cy="about-social-discord-path" /></svg><b data-cy="about-social-discord-label">Discord</b></a>
              <a class="about-social-link" href="https://www.facebook.com/mtgones/" target="_blank" rel="noopener noreferrer" data-cy="about-social-facebook" [attr.aria-label]="i18n.t('about.contact.facebookAria')"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-cy="about-social-facebook-icon"><path d="M13.7 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5H17V4a22 22 0 0 0-2.4-.1c-2.4 0-4 1.5-4 4.2V10H8v3h2.6v8h3.1Z" data-cy="about-social-facebook-path" /></svg><b data-cy="about-social-facebook-label">Facebook</b></a>
              <a class="about-social-link" href="https://x.com/MtgOnes" target="_blank" rel="noopener noreferrer" data-cy="about-social-x" [attr.aria-label]="i18n.t('about.contact.xAria')"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-cy="about-social-x-icon"><path d="M18.3 3h3.4l-7.4 8.5L23 21h-6.8l-5.3-6.9L4.8 21H1.4l7.9-9.1L1 3h7l4.8 6.3L18.3 3Zm-1.2 16.3H19L6.9 4.6h-2l12.2 14.7Z" data-cy="about-social-x-path" /></svg><b data-cy="about-social-x-label">X</b></a>
              <span class="about-social-link about-social-link--disabled" data-cy="about-social-instagram" aria-disabled="true" tabindex="-1">Instagram — {{ i18n.t('about.contact.comingSoon') }}</span>
            </div>
          </div>
        </address>
      </section>
    </div>
    <gones-back-button data-cy="about-back-bottom" [link]="['/']" [label]="i18n.t('about.back')" position="bottom" />
  `
})
export class AboutComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly i18n = inject(I18nService);
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly catalog = inject(EventCatalogCacheService);
  private revealObserver?: IntersectionObserver;
  private upcomingLoadId = 0;

  readonly upcomingEvents: WritableSignal<readonly PublicEventView[]> = signal<readonly PublicEventView[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly stale = signal(false);
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly upcomingSkeletons: readonly [0, 1, 2] = [0, 1, 2];
  readonly tournamentBands = aboutTournamentBands;
  readonly founders = aboutStaff.slice(0, 3);
  readonly members = aboutStaff.slice(3);
  readonly staff = aboutStaff;
  readonly contributors = aboutContributors;

  contributorNumber(index: number): string {
    return String(index + 1).padStart(2, '0');
  }

  ngOnInit(): void {
    void this.loadUpcomingEvents();
  }

  async loadUpcomingEvents(force = false): Promise<void> {
    const loadId = ++this.upcomingLoadId;
    this.loading.set(true);
    this.error.set(false);
    try {
      const result = force ? await this.catalog.load({ force: true }) : await this.catalog.load();
      if (loadId !== this.upcomingLoadId) return;
      this.upcomingEvents.set(selectUpcomingEvents(result.items, new Date()));
      this.syncedAt.set(result.fetchedAt);
      this.stale.set(result.stale);
      this.error.set(false);
    } catch (error) {
      if (loadId !== this.upcomingLoadId) return;
      logBoundaryError('about.load-upcoming-events', error);
      this.upcomingEvents.set([]);
      this.error.set(true);
      this.stale.set(false);
      this.syncedAt.set(undefined);
    } finally {
      if (loadId === this.upcomingLoadId) this.loading.set(false);
    }
  }

  retryUpcomingEvents(): void {
    void this.loadUpcomingEvents(true);
  }

  syncUpcomingEvents(): void {
    void this.loadUpcomingEvents(true);
  }

  upcomingDate(event: PublicEventView): EventDatePresentation {
    return eventDatePresentation(event, this.i18n.locale());
  }

  ngAfterViewInit(): void {
    if (!('IntersectionObserver' in window)) return;

    const revealElements = this.hostElement.nativeElement.querySelectorAll<HTMLElement>('[data-reveal]');
    this.hostElement.nativeElement.classList.add('about-motion-ready');
    this.revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        this.revealObserver?.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    revealElements.forEach(element => this.revealObserver?.observe(element));
  }

  ngOnDestroy(): void {
    this.revealObserver?.disconnect();
  }
}
