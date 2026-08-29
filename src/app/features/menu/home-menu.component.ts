import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { LiveTournamentDocument } from '../../domain/live-tournament';
import { I18nService } from '../../i18n/i18n.service';
import { logBoundaryError } from '../../shared/app-logger';
import { AuthService } from '../../auth/auth.service';

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="home-landing" [attr.aria-label]="i18n.t('home.aria')" data-cy="menu-section">
      <nav class="home-destinations" [attr.aria-label]="i18n.t('home.navAria')" data-cy="menu-nav">
        <a class="home-destination home-destination--calendar" routerLink="/events" data-cy="menu-calendar-card">
          <img class="home-destination__art" src="/assets/card-art/snapcaster-mage.jpg" alt="" decoding="async" data-cy="menu-calendar-card-art">
          <strong data-cy="menu-calendar-card-title">{{ i18n.t('home.calendar') }}</strong>
          <p data-cy="menu-calendar-card-desc">{{ i18n.t('home.calendarDesc') }}</p>
        </a>
        @if (auth.profile()) {
          <a class="home-destination home-destination--calendar" routerLink="/registrations" data-cy="menu-registrations-card">
            <img class="home-destination__art" src="/assets/card-art/scroll-rack.jpg" alt="" loading="lazy" decoding="async" data-cy="menu-registrations-card-art">
            <strong data-cy="menu-registrations-card-title">{{ i18n.t('registration.myRegistrations') }}</strong>
            <p data-cy="menu-registrations-card-desc">{{ i18n.t('home.registrationsDesc') }}</p>
          </a>
        } @else {
          <a class="home-destination home-destination--calendar home-destination--disabled" role="link" aria-disabled="true" data-cy="menu-registrations-card-disabled">
            <img class="home-destination__art" src="/assets/card-art/scroll-rack.jpg" alt="" loading="lazy" decoding="async" data-cy="menu-registrations-card-disabled-art">
            <strong data-cy="menu-registrations-card-disabled-title">{{ i18n.t('registration.myRegistrations') }}</strong>
            <p data-cy="menu-registrations-card-disabled-desc">{{ i18n.t('home.registrationsDesc') }}</p>
          </a>
        }
        @if (showUnreleasedCards()) {
          <a class="home-destination home-destination--leagues" routerLink="/global-stats" data-cy="menu-global-stats-card">
            <img class="home-destination__art" src="/assets/card-art/force-of-will.jpg" alt="" loading="lazy" decoding="async" data-cy="menu-global-stats-card-art">
            <strong data-cy="menu-global-stats-card-title">{{ i18n.t('home.globalStats') }}</strong>
            <p data-cy="menu-global-stats-card-desc">{{ i18n.t('home.globalStatsDesc') }}</p>
          </a>
          <a class="home-destination home-destination--leagues" routerLink="/archive/league-seasons" data-cy="menu-archive-card">
            <img class="home-destination__art" src="/assets/card-art/library-of-alexandria.jpg" alt="" loading="lazy" decoding="async" data-cy="menu-archive-card-art">
            <strong data-cy="menu-archive-card-title">{{ i18n.t('home.leagues') }}</strong>
            <p data-cy="menu-archive-card-desc">{{ i18n.t('home.leaguesDesc') }}</p>
          </a>
          <a class="home-destination home-destination--leagues" [class.home-destination--running-active]="hasActiveRunningTournament()" routerLink="/live-tournaments" data-cy="menu-running-tournaments-card">
            <img class="home-destination__art" src="/assets/card-art/lightning-bolt.jpg" alt="" loading="lazy" decoding="async" data-cy="menu-running-tournaments-card-art">
            <strong data-cy="menu-running-tournaments-card-title">{{ i18n.t('home.runningTournaments') }}</strong>
            <p data-cy="menu-running-tournaments-card-desc">{{ i18n.t('home.runningTournamentsDesc') }}</p>
          </a>
        }
        <a class="home-destination home-destination--about" routerLink="/about" data-cy="menu-about-link">
          <img class="home-destination__art home-destination__art--fire-left" src="/assets/card-art/fire-ice.jpg" alt="" loading="lazy" decoding="async" data-cy="menu-about-link-art-fire">
          <img class="home-destination__art home-destination__art--fire-right" src="/assets/card-art/fire-ice.jpg" alt="" loading="lazy" decoding="async" data-cy="menu-about-link-art-ice">
          <strong data-cy="menu-about-link-title">{{ i18n.t('home.about') }}</strong>
          <p data-cy="menu-about-link-desc">{{ i18n.t('home.aboutDesc') }}</p>
        </a>
        <a class="home-destination home-destination--settings" routerLink="/settings" data-cy="menu-settings-link">
          <img class="home-destination__art" src="/assets/card-art/grim-monolith.jpg" alt="" loading="lazy" decoding="async" data-cy="menu-settings-link-art">
          <strong data-cy="menu-settings-link-title">{{ i18n.t('home.settings') }}</strong>
          <p data-cy="menu-settings-link-desc">{{ i18n.t('home.settingsDesc') }}</p>
        </a>
      </nav>

    </section>
  `
})
export class HomeMenuComponent {
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  readonly liveTournaments = signal<LiveTournamentDocument[]>([]);
  readonly hasActiveRunningTournament = computed(() => this.liveTournaments().some((tournament) => tournament.stage !== 'completed'));
  readonly showUnreleasedCards = computed(() => {
    const role = this.auth.profile()?.globalRole;
    return role !== 'User' && role !== 'Organizer';
  });

  constructor(private readonly liveRepo: LiveTournamentRepository) { void this.loadLiveTournamentState(); }

  private async loadLiveTournamentState(): Promise<void> {
    await this.auth.whenSessionReady();
    if (!this.showUnreleasedCards()) return;
    try {
      this.liveTournaments.set(await this.liveRepo.list());
    } catch (error) {
      logBoundaryError('home-menu.load-live-tournament-state', error);
      this.liveTournaments.set([]);
    }
  }
}
