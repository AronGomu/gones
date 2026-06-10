import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [RouterLink, MatButtonModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/']" label="Back to Home" position="top" />
    <section class="info-page about-page" aria-labelledby="about-title">
      <div class="info-hero">
        <p class="kicker">About the organization</p>
        <h1 id="about-title">Gones keeps local Magic nights legible.</h1>
        <p>We organize Magic: The Gathering tournaments, preserve results across leagues, and give players a clear place to find standings, history, and upcoming events.</p>
      </div>

      <div class="about-layout">
        <section class="about-manifesto" aria-labelledby="about-work-title">
          <h2 id="about-work-title">What Gones does</h2>
          <p>Gones exists for the practical work around a tournament: gathering players, running rounds, correcting results, publishing rankings, and keeping the story of a league intact after the last match slip is gone.</p>
          <p>The app is the public ledger for that work. It is built so organizers can enter data from the floor and players can check where they stand without digging through chats.</p>
        </section>

        <aside class="about-facts" aria-label="Gones principles">
          <div><span>01</span><strong>Clear pairings</strong><p>Rounds and matches should be easy to read under event pressure.</p></div>
          <div><span>02</span><strong>Persistent leagues</strong><p>Each tournament contributes to a larger season story.</p></div>
          <div><span>03</span><strong>Player memory</strong><p>Statistics and match history give players useful context.</p></div>
        </aside>
      </div>

      <section class="future-strip" aria-labelledby="future-title">
        <h2 id="future-title">What comes next</h2>
        <ul>
          <li>Public calendar for upcoming tournaments.</li>
          <li>Organization news and event announcements.</li>
          <li>Language settings for a broader player base.</li>
          <li>More tournament formats and community resources.</li>
        </ul>
      </section>

      <div class="info-actions">
        <a mat-flat-button class="home-primary-action" routerLink="/calendar">View calendar</a>
        <a mat-stroked-button class="secondary-action" routerLink="/leagues">Open leagues</a>
      </div>
    </section>
    <gones-back-button [link]="['/']" label="Back to Home" position="bottom" />
  `
})
export class AboutComponent {}
