import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule],
  template: `
    <section class="home-landing" aria-labelledby="home-title">
      <div class="home-hero">
        <div class="home-hero__copy">
          <p class="kicker">Gones tournament organization</p>
          <h1 id="home-title">Magic nights, recorded like they matter.</h1>
          <p class="home-hero__lead">Gones gathers leagues, tournament results, player histories, and event information for the local Magic: The Gathering community.</p>
          <div class="home-hero__actions" aria-label="Primary destinations">
            <a mat-flat-button class="home-primary-action" routerLink="/leagues" data-cy="menu-leagues-link">Open leagues</a>
            <a mat-stroked-button class="secondary-action" routerLink="/calendar" data-cy="menu-calendar-link">See calendar</a>
          </div>
        </div>

        <div class="home-hero__relic" aria-label="Gones tournament board preview" role="img">
          <div class="relic-card relic-card--front">
            <span class="relic-card__label">Round 4</span>
            <strong>Top tables</strong>
            <div class="relic-pairing"><span>Alice</span><b>2</b><small>vs</small><b>1</b><span>Marc</span></div>
            <div class="relic-pairing"><span>Noémie</span><b>1</b><small>vs</small><b>1</b><span>David</span></div>
            <div class="relic-pairing"><span>Samir</span><b>0</b><small>vs</small><b>2</b><span>Léa</span></div>
          </div>
          <div class="relic-card relic-card--back">
            <span>League file</span>
            <strong>Standings sealed</strong>
          </div>
        </div>
      </div>

      <nav class="home-destinations" aria-label="Main menu">
        <a class="home-destination home-destination--leagues" routerLink="/leagues">
          <span>Run the night</span>
          <strong>Leagues</strong>
          <p>Create leagues, open tournaments, enter rounds, import results, and review standings.</p>
        </a>
        <a class="home-destination home-destination--about" routerLink="/about">
          <span>Know the crew</span>
          <strong>About Gones</strong>
          <p>Learn what the organization does and how tournament information is preserved.</p>
        </a>
        <a class="home-destination home-destination--calendar" routerLink="/calendar">
          <span>Find the next event</span>
          <strong>Calendar</strong>
          <p>Upcoming tournaments, league nights, special formats, and future organized play.</p>
        </a>
      </nav>

      <section class="home-info-band" aria-labelledby="home-info-title">
        <div>
          <p class="kicker">Built for event floors</p>
          <h2 id="home-info-title">Fast on a phone, serious on a projector.</h2>
        </div>
        <p>Gones keeps the practical pieces close: pairings, wins, losses, rankings, player pages, exports, and the public context players need before they arrive.</p>
      </section>
    </section>
  `
})
export class HomeMenuComponent {}
