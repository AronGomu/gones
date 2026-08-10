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
        <a class="home-destination home-destination--leagues" [class.home-destination--running-active]="hasActiveRunningTournament()" routerLink="/live-tournaments" data-cy="menu-running-tournaments-card">
          <strong data-cy="menu-running-tournaments-card-title">{{ i18n.t('home.runningTournaments') }}</strong>
          <p data-cy="menu-running-tournaments-card-desc">{{ i18n.t('home.runningTournamentsDesc') }}</p>
        </a>
        <a class="home-destination home-destination--leagues" routerLink="/leagues-archive" data-cy="menu-leagues-archive-card">
          <strong data-cy="menu-leagues-archive-card-title">{{ i18n.t('home.leagues') }}</strong>
          <p data-cy="menu-leagues-archive-card-desc">{{ i18n.t('home.leaguesDesc') }}</p>
        </a>
        <a class="home-destination home-destination--calendar" routerLink="/calendar" data-cy="menu-calendar-card">
          <strong data-cy="menu-calendar-card-title">{{ i18n.t('home.calendar') }}</strong>
          <p data-cy="menu-calendar-card-desc">{{ i18n.t('home.calendarDesc') }}</p>
        </a>
        @if (auth.profile()) {
          <a class="home-destination home-destination--calendar" routerLink="/registrations" data-cy="menu-registrations-card">
            <strong data-cy="menu-registrations-card-title">{{ i18n.t('registration.myRegistrations') }}</strong>
            <p data-cy="menu-registrations-card-desc">{{ i18n.t('home.registrationsDesc') }}</p>
          </a>
        }
        <a class="home-destination home-destination--about" routerLink="/about" data-cy="menu-about-link" lang="fr">
          <strong data-cy="menu-about-link-title">{{ i18n.t('home.about') }}</strong>
          <p data-cy="menu-about-link-desc">{{ i18n.t('home.aboutDesc') }}</p>
        </a>
        <a class="home-destination home-destination--settings" routerLink="/settings" data-cy="menu-settings-link">
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

  constructor(private readonly liveRepo: LiveTournamentRepository) { void this.loadLiveTournamentState(); }

  private async loadLiveTournamentState(): Promise<void> {
    try {
      this.liveTournaments.set(await this.liveRepo.list());
    } catch (error) {
      logBoundaryError('home-menu.load-live-tournament-state', error);
      this.liveTournaments.set([]);
    }
  }
}
