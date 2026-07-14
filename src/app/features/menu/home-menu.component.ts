import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { LiveTournamentDocument } from '../../domain/live-tournament';
import { I18nService } from '../../i18n/i18n.service';
import { logBoundaryError } from '../../shared/app-logger';

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="home-landing" [attr.aria-label]="i18n.t('home.aria')">
      <nav class="home-destinations" [attr.aria-label]="i18n.t('home.navAria')">
        <a class="home-destination home-destination--leagues" [class.home-destination--running-active]="hasActiveRunningTournament()" routerLink="/live-tournaments" data-cy="menu-running-tournaments-card">
          <strong>{{ i18n.t('home.runningTournaments') }}</strong>
          <p>{{ i18n.t('home.runningTournamentsDesc') }}</p>
        </a>
        <a class="home-destination home-destination--leagues" routerLink="/leagues">
          <strong>{{ i18n.t('home.leagues') }}</strong>
          <p>{{ i18n.t('home.leaguesDesc') }}</p>
        </a>
        <a class="home-destination home-destination--calendar" routerLink="/calendar">
          <strong>{{ i18n.t('home.calendar') }}</strong>
          <p>{{ i18n.t('home.calendarDesc') }}</p>
        </a>
        <a class="home-destination home-destination--settings" routerLink="/settings" data-cy="menu-settings-link">
          <strong>{{ i18n.t('home.settings') }}</strong>
          <p>{{ i18n.t('home.settingsDesc') }}</p>
        </a>
        <a class="home-destination home-destination--about" routerLink="/about" data-cy="menu-about-link" lang="fr">
          <strong>{{ i18n.t('home.about') }}</strong>
          <p>{{ i18n.t('home.aboutDesc') }}</p>
        </a>
      </nav>

    </section>
  `
})
export class HomeMenuComponent {
  readonly i18n = inject(I18nService);
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
