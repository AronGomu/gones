import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { LiveTournamentDocument } from '../../domain/live-tournament';
import { logBoundaryError } from '../../shared/app-logger';

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="home-landing" aria-label="Gones main menu">
      <nav class="home-destinations" aria-label="Main menu">
        <a class="home-destination home-destination--leagues" [class.home-destination--running-active]="hasActiveRunningTournament()" routerLink="/live-tournaments" data-cy="menu-running-tournaments-card">
          <strong>Running Tournaments</strong>
          <p>Resume a saved live tournament, create a new running tournament, or delete old local drafts from one place.</p>
        </a>
        <a class="home-destination home-destination--about" routerLink="/leagues">
          <strong>Leagues</strong>
          <p>Create leagues, open tournaments, enter rounds, import results, and review standings.</p>
        </a>
        <a class="home-destination home-destination--calendar" routerLink="/calendar">
          <strong>Calendar</strong>
          <p>Upcoming tournaments, league nights, special formats, and future organized play.</p>
        </a>
        <a class="home-destination home-destination--settings" routerLink="/settings" data-cy="menu-settings-link">
          <strong>Settings</strong>
          <p>Manage archetype labels, import tools, and local app configuration.</p>
        </a>
      </nav>

    </section>
  `
})
export class HomeMenuComponent {
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
