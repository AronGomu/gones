import { Component, computed, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { GonesData, GONES_DATA_VERSION, PersistedLeague, PLACEHOLDER_LEAGUE_ID } from '../../domain/models';
import { calculatePlayerStatistics, PlayerMatch } from '../../domain/player-stats';
import { BackButtonComponent } from '../../shared/back-button.component';
import { I18nService } from '../../i18n/i18n.service';
import { escapeSearchTerm, HighlightPart, highlightSearchText, normalizeSearchText, searchWords } from '../../shared/search-highlight';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, BackButtonComponent],
  template: `
    <gones-back-button data-cy="player-back-top" [label]="i18n.t('nav.backToPrevious')" position="top" />
    <section class="page-heading" data-cy="player-heading"><div data-cy="player-heading-text"><p class="kicker" data-cy="player-kicker">{{ i18n.t('player.statsKicker') }}</p><h1 data-cy="player-name">{{ playerName() }}</h1></div></section>
    <div class="stat-grid" data-cy="player-stat-grid">
      <div class="stat-grid__row stat-grid__row--numbers" data-cy="player-stat-row-numbers">
        <div class="player-stat-cell" data-cy="player-stat-cell-played-matches">
          <p class="player-stat-label" data-cy="player-stat-label-played-matches">{{ i18n.t('player.playedMatches') }}</p>
          <mat-card class="player-stat-card" data-cy="player-stat-card-played-matches"><mat-card-content class="stat-number" data-cy="stat-played-matches">{{ stats().playedMatchCount }}</mat-card-content></mat-card>
        </div>
        <div class="player-stat-cell" data-cy="player-stat-cell-match-winrate">
          <p class="player-stat-label" data-cy="player-stat-label-match-winrate">{{ i18n.t('player.matchWinRate') }}</p>
          <mat-card class="player-stat-card" data-cy="player-stat-card-match-winrate"><mat-card-content [class]="winrateStatClass(stats().matchWinrate)" data-cy="stat-match-winrate">{{ pct(stats().matchWinrate) }}</mat-card-content></mat-card>
        </div>
        <div class="player-stat-cell" data-cy="player-stat-cell-game-winrate">
          <p class="player-stat-label" data-cy="player-stat-label-game-winrate">{{ i18n.t('player.gameWinRate') }}</p>
          <mat-card class="player-stat-card" data-cy="player-stat-card-game-winrate"><mat-card-content [class]="winrateStatClass(stats().gameWinrate)" data-cy="stat-game-winrate">{{ pct(stats().gameWinrate) }}</mat-card-content></mat-card>
        </div>
      </div>
      <div class="stat-grid__row stat-grid__row--names" data-cy="player-stat-row-names">
        <div class="player-stat-cell" data-cy="player-stat-cell-nemesis">
          <p class="player-stat-label" data-cy="player-stat-label-nemesis">{{ i18n.t('player.nemesis') }}</p>
          <mat-card class="player-stat-card" data-cy="player-stat-card-nemesis">
            <mat-card-content class="player-stat-card__name" data-cy="player-stat-content-nemesis">
              @if (stats().nemesis; as nemesis) {
                <button type="button" class="stat-filter-button stat-filter-button--nemesis" data-cy="stat-nemesis" [attr.title]="nemesis" [attr.aria-label]="nemesis" (click)="filterByExact(nemesis)">{{ nemesis }}</button>
              } @else {
                <span [attr.data-cy]="'stat-nemesis'">{{ i18n.t('common.na') }}</span>
              }
            </mat-card-content>
          </mat-card>
        </div>
        <div class="player-stat-cell" data-cy="player-stat-cell-rival">
          <p class="player-stat-label" data-cy="player-stat-label-rival">{{ i18n.t('player.rival') }}</p>
          <mat-card class="player-stat-card" data-cy="player-stat-card-rival">
            <mat-card-content class="player-stat-card__name" data-cy="player-stat-content-rival">
              @if (stats().rival; as rival) {
                <button type="button" class="stat-filter-button" [class.stat-filter-button--nemesis]="rival === stats().nemesis" [class.stat-filter-button--rival]="rival !== stats().nemesis" data-cy="stat-rival" [attr.title]="rival" [attr.aria-label]="rival" (click)="filterByExact(rival)">{{ rival }}</button>
              } @else {
                <span [attr.data-cy]="'stat-rival'">{{ i18n.t('common.na') }}</span>
              }
            </mat-card-content>
          </mat-card>
        </div>
      </div>
    </div>
    <section class="stack" data-cy="player-matches-section">
      <div class="matches-heading" data-cy="player-matches-heading">
        <h2 data-cy="player-matches-title">{{ i18n.t('player.matches') }}</h2>
        <div class="match-filter-controls" data-cy="match-filter-controls">
          <mat-form-field appearance="outline" class="match-filter" subscriptSizing="dynamic" data-cy="match-filter-field">
            <input matInput data-cy="match-filter-input" [placeholder]="i18n.t('player.filterPlaceholder')" [value]="matchSearch()" (input)="matchSearch.set($any($event.target).value)" [attr.aria-label]="i18n.t('player.filterAria')">
          </mat-form-field>
          @if (matchSearch()) {
            <button type="button" class="match-filter-clear" data-cy="match-filter-clear" (click)="clearMatchSearch()" [attr.aria-label]="i18n.t('player.clearFilterAria')">{{ i18n.t('common.clear') }}</button>
          }
        </div>
        <button type="button" class="order-toggle" data-cy="match-order-toggle" (click)="invertMatchOrder()" [attr.aria-label]="newestFirst() ? i18n.t('player.sortOldest') : i18n.t('player.sortNewest')">
          <span class="order-toggle__icon" data-cy="match-order-toggle-icon" aria-hidden="true">{{ newestFirst() ? '↓' : '↑' }}</span>
          <span data-cy="match-order-toggle-label">{{ newestFirst() ? i18n.t('player.newestFirst') : i18n.t('player.oldestFirst') }}</span>
        </button>
        <span class="match-count" data-cy="match-count" aria-live="polite">{{ i18n.plural(filteredMatches().length, 'player.matchCountOne', 'player.matchCountMany') }}</span>
      </div>
      @if (!filteredMatches().length) { <p class="muted" data-cy="no-matches">{{ i18n.t('player.noMatches') }}</p> }
      @for (match of filteredMatches(); track match.tournament.id + match.roundIndex + match.opponentName; let matchIndex = $index) {
        <mat-card
          class="match-card"
          data-cy="match-card"
          role="link"
          tabindex="0"
          [attr.aria-label]="matchCardAriaLabel(match)"
          [class.match-card--win]="matchResult(match) === 'win'"
          [class.match-card--loss]="matchResult(match) === 'loss'"
          [class.match-card--draw]="matchResult(match) === 'draw'"
          (click)="openMatchTournament(match)"
          (keydown.enter)="openMatchTournament(match)"
          (keydown.space)="$event.preventDefault(); openMatchTournament(match)"
        >
          <mat-card-title [attr.data-cy]="'match-card-title-' + matchIndex">
            <span class="match-card__line match-card__line--meta" [attr.data-cy]="'match-card-meta-' + matchIndex">
              <button type="button" class="match-filter-token match-card__date" data-cy="match-date" (click)="filterByExact(matchDateLabel(match), $event)">@for (part of highlightParts(matchDateReadable(match)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-date-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
              <button type="button" class="match-filter-token match-card__league" data-cy="match-league" (click)="filterByExact(leagueDisplayName(match.league), $event)">@for (part of highlightParts(leagueDisplayName(match.league)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-league-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
              <button type="button" class="match-filter-token match-card__tournament" data-cy="match-tournament" (click)="filterByExact(match.tournament.name, $event)">@for (part of highlightParts(match.tournament.name); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-tournament-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
              <button type="button" class="match-filter-token match-card__round" data-cy="match-round" (click)="filterByExact(matchRoundLabel(match), $event)">@for (part of highlightParts(matchRoundLabel(match)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-round-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
            </span>
          </mat-card-title>
          <mat-card-content [attr.data-cy]="'match-card-content-' + matchIndex">
            <span class="match-card__line match-card__line--result" [attr.data-cy]="'match-card-result-line-' + matchIndex">
              <button type="button" class="match-filter-token match-card__result-pill" data-cy="match-result" (click)="filterByExact(matchResultLabel(match), $event)">@for (part of highlightParts(matchResultLabel(match)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-result-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
              <span class="match-card__opponent-group" [attr.data-cy]="'match-card-opponent-group-' + matchIndex">
                <strong class="match-card__vs" [attr.data-cy]="'match-card-vs-' + matchIndex">VS</strong>
                <button
                  type="button"
                  class="match-filter-token match-card__opponent"
                  data-cy="match-opponent"
                  [class.match-card__opponent--nemesis]="opponentTone(match.opponentName) === 'nemesis'"
                  [class.match-card__opponent--rival]="opponentTone(match.opponentName) === 'rival'"
                  (click)="filterByExact(match.opponentName, $event)"
                >@for (part of highlightParts(match.opponentName); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-opponent-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
              </span>
              <span class="match-card__score" data-cy="match-score">
                <span [class.score-number--win]="match.ownScore !== match.opponentScore" [attr.data-cy]="'match-score-winning-' + matchIndex">@for (part of highlightParts(matchWinningScore(match)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-score-winning-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</span>
                <span class="match-card__score-separator" [attr.data-cy]="'match-score-separator-' + matchIndex">–</span>
                <span [class.score-number--loss]="match.ownScore !== match.opponentScore" [attr.data-cy]="'match-score-losing-' + matchIndex">@for (part of highlightParts(matchLosingScore(match)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-score-losing-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</span>
              </span>
            </span>
          </mat-card-content>
        </mat-card>
      }
    </section>
    <footer class="live-tournament-footer player-detail-footer" data-cy="player-footer">
      <gones-back-button data-cy="player-back-footer" [label]="i18n.t('nav.backToPrevious')" position="top" />
      <button mat-stroked-button class="secondary-action live-scroll-top-button" type="button" data-cy="player-scroll-top-button" (click)="scrollToTop()" [attr.aria-label]="i18n.t('live.backToTop')">↑</button>
    </footer>
  `,
  styles: [`
    .stat-grid {
      display: grid;
      gap: 1rem;
      margin-top: 1.1rem;
      margin-bottom: 1.35rem;
      width: 100%;
      min-width: 0;
    }
    .stat-grid__row {
      display: grid;
      gap: 1rem;
      width: 100%;
      min-width: 0;
      align-items: stretch;
    }
    .stat-grid__row--numbers {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .stat-grid__row--names {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .player-stat-cell {
      display: grid;
      grid-template-rows: auto var(--player-stat-card-height, 6rem);
      gap: .45rem;
      min-width: 0;
    }
    .player-stat-label {
      margin: 0;
      min-height: 1.2em;
      color: var(--dim-ash);
      font-size: .78rem;
      font-weight: 900;
      letter-spacing: .08em;
      line-height: 1.2;
      text-align: center;
      text-transform: uppercase;
    }
    .player-stat-card {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: stretch;
      box-sizing: border-box;
      width: 100%;
      height: var(--player-stat-card-height, 6rem);
      min-height: var(--player-stat-card-height, 6rem);
      max-height: var(--player-stat-card-height, 6rem);
      border: 1px solid #000;
      overflow: hidden;
    }
    .player-stat-card mat-card-content {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      padding: .65rem .7rem;
      color: oklch(86% 0.16 82);
      font-size: clamp(1.65rem, 4vw, 2.35rem);
      font-weight: 900;
      line-height: 1.1;
      text-align: center;
      overflow: hidden;
    }
    .player-stat-card mat-card-content.player-stat-card__name { padding-inline: .75rem; }
    .player-stat-card mat-card-content.stat-number { font-size: clamp(2.2rem, 6vw, 3.6rem); }
    .player-stat-card mat-card-content.stat-number--high { color: oklch(80% 0.15 145); }
    .player-stat-card mat-card-content.stat-number--low { color: oklch(78% 0.14 25); }
    .player-stat-card mat-card-content.stat-number--even { color: #fff; }
    .stat-filter-button {
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      max-width: 100%;
      min-width: 0;
      max-height: 2.3em;
      padding: 0;
      font: inherit;
      line-height: 1.15;
      text-align: center;
      white-space: normal;
      overflow: hidden;
      text-overflow: ellipsis;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    @media (max-width: 900px) {
      .stat-grid__row--numbers {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr));
      }
      .stat-grid__row--names {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
      }
    }
    @media (max-width: 640px) {
      .stat-grid__row--numbers,
      .stat-grid__row--names {
        grid-template-columns: 1fr;
      }
    }
    .stat-filter-button:hover, .stat-filter-button:focus-visible { text-decoration: underline; text-underline-offset: .16em; outline: none; }
    .stat-filter-button--nemesis { color: oklch(78% 0.14 25); }
    .stat-filter-button--nemesis:hover, .stat-filter-button--nemesis:focus-visible { color: oklch(84% 0.15 25); }
    .stat-filter-button--rival { color: oklch(78% 0.12 250); }
    .stat-filter-button--rival:hover, .stat-filter-button--rival:focus-visible { color: oklch(84% 0.13 250); }
    .matches-heading { display: flex; align-items: center; justify-content: flex-start; gap: .75rem; flex-wrap: wrap; }
    .matches-heading h2 { margin: 0; }
    .match-filter-controls { display: inline-flex; align-items: center; gap: .45rem; min-width: min(100%, 22rem); }
    .match-filter { width: min(100%, 22rem); }
    .match-filter-clear { border: 1px solid var(--soot); background: var(--black-metal); color: var(--dim-ash); cursor: pointer; min-height: 2.5rem; padding: .45rem .75rem; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; }
    .match-filter-clear:hover, .match-filter-clear:focus-visible { border-color: var(--steel); color: var(--ash); outline: none; }
    .order-toggle { display: inline-flex; align-items: center; gap: .4rem; border: 1px solid var(--soot); background: var(--black-metal); color: var(--dim-ash); cursor: pointer; min-height: 2.5rem; padding: .45rem .75rem; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; }
    .order-toggle:hover, .order-toggle:focus-visible { border-color: var(--steel); color: var(--ash); outline: none; }
    .order-toggle__icon { font-size: 1.05rem; line-height: 1; }
    .match-count { align-self: center; color: var(--dim-ash); font-size: .9rem; font-weight: 800; white-space: nowrap; }
    .match-card { position: relative; overflow: hidden; border: 1px solid var(--soot); background: linear-gradient(135deg, color-mix(in oklch, var(--raised-iron) 70%, var(--iron)), var(--iron)); box-shadow: 0 14px 28px oklch(4% 0.012 29 / 0.34); cursor: pointer; transition: border-color .28s ease, box-shadow .28s ease, transform .28s ease; }
    .match-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: .35rem; background: var(--steel); opacity: .95; transition: background .28s ease, box-shadow .28s ease; z-index: 1; }
    .match-card::after { content: ''; position: absolute; inset: 0; opacity: 0; pointer-events: none; transition: opacity .35s ease, transform .45s cubic-bezier(.2,.8,.2,1); transform: scale(1.02); z-index: 0; }
    .match-card:hover, .match-card:focus-visible { outline: none; transform: translateY(-1px); box-shadow: 0 18px 36px oklch(4% 0.012 29 / 0.42); }
    .match-card:hover::after, .match-card:focus-visible::after { opacity: 1; transform: scale(1); }
    .match-card--win { border-color: oklch(72% 0.14 145 / .45); }
    .match-card--win::before { background: oklch(80% 0.15 145); box-shadow: 0 0 12px oklch(80% 0.15 145 / .28); }
    .match-card--win::after { background: linear-gradient(135deg, oklch(24% 0.06 145 / .82), var(--iron)); }
    .match-card--win:hover, .match-card--win:focus-visible { border-color: oklch(72% 0.14 145 / .85); }
    .match-card--win:hover::before, .match-card--win:focus-visible::before { box-shadow: 0 0 18px oklch(80% 0.15 145 / .45); }
    .match-card--loss { border-color: oklch(72% 0.13 25 / .45); }
    .match-card--loss::before { background: oklch(78% 0.14 25); box-shadow: 0 0 12px oklch(78% 0.14 25 / .26); }
    .match-card--loss::after { background: linear-gradient(135deg, oklch(24% 0.07 25 / .82), var(--iron)); }
    .match-card--loss:hover, .match-card--loss:focus-visible { border-color: oklch(72% 0.13 25 / .82); }
    .match-card--loss:hover::before, .match-card--loss:focus-visible::before { box-shadow: 0 0 18px oklch(78% 0.14 25 / .42); }
    .match-card--draw { border-color: oklch(72% 0.06 82 / .55); background: linear-gradient(135deg, oklch(28% 0.015 82 / .22), oklch(16% 0.01 29 / .5)); box-shadow: none; }
    .match-card--draw::before { background: oklch(78% 0.08 82 / .55); box-shadow: none; }
    .match-card--draw::after { display: none; }
    .match-card mat-card-title, .match-card mat-card-content { position: relative; z-index: 1; }
    .match-card mat-card-title { padding-left: 1.75rem; }
    .match-card mat-card-content { padding-top: .35rem; padding-left: 1.75rem; }
    .match-card__line { display: block; overflow-wrap: anywhere; }
    .match-card__line--meta { display: flex; align-items: center; gap: .45rem; flex-wrap: wrap; color: var(--dim-ash); font-size: .9rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
    .match-card__line--result { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; color: var(--ash); font-size: 1.12rem; font-weight: 800; }
    .match-card__line--result strong { color: var(--dim-ash); font-size: .85em; letter-spacing: .08em; }
    .match-filter-token { display: inline-flex; align-items: center; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; letter-spacing: inherit; line-height: 1.2; padding: 0; text-align: left; text-transform: inherit; }
    .match-filter-token:hover, .match-filter-token:focus-visible { text-decoration: underline; text-underline-offset: .16em; outline: none; }
    .match-card__date, .match-card__round { color: var(--dim-ash); }
    .match-card__league { color: oklch(78% 0.1 230); }
    .match-card__tournament { color: oklch(82% 0.14 75); }
    .match-card__opponent-group { display: inline-flex; align-items: center; gap: .45rem; }
    .match-card__opponent { color: var(--ash); font-weight: 900; text-transform: none; }
    .match-card__opponent--nemesis { color: oklch(78% 0.14 25); }
    .match-card__opponent--rival { color: oklch(78% 0.12 250); }
    .match-card__result-pill { display: inline-flex; align-items: center; border: 1px solid color-mix(in oklch, currentColor 45%, transparent); border-radius: 999px; color: var(--dim-ash); padding: .22rem .65rem; font-size: .88rem; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; vertical-align: middle; }
    .match-card--win .match-card__result-pill { background: oklch(88% 0.12 145 / .16); color: oklch(88% 0.12 145); }
    .match-card--loss .match-card__result-pill { background: oklch(86% 0.12 25 / .14); color: oklch(88% 0.11 25); }
    .match-card--draw .match-card__result-pill { background: oklch(86% 0.06 82 / .08); color: oklch(86% 0.06 82 / .9); border-color: oklch(86% 0.06 82 / .28); }
    .match-card__score { color: var(--ash); font-size: 1.18rem; font-weight: 950; white-space: nowrap; }
    .match-card__score-separator { color: var(--dim-ash); margin-inline: .12rem; }
    .score-number--win { color: oklch(82% 0.15 145); }
    .score-number--loss { color: oklch(78% 0.14 25); }
    .player-detail-footer { margin-top: 2rem; }
  `]
})
export class PlayerDetailComponent {
  readonly i18n = inject(I18nService);
  readonly playerName = signal('');
  readonly leagues = signal<PersistedLeague[]>([]);
  readonly matchSearch = signal('');
  readonly newestFirst = signal(true);
  readonly data = computed<GonesData>(() => ({ version: GONES_DATA_VERSION, leagues: this.leagues(), calendarEvents: [] }));
  readonly stats = computed(() => calculatePlayerStatistics(this.data(), this.playerName()));
  readonly orderedMatches = computed(() => orderMatches(this.stats().matches, this.newestFirst()));
  readonly filteredMatches = computed(() => {
    const search = this.matchSearch().trim();
    if (!search) return this.orderedMatches();
    return this.orderedMatches().filter((match) => matchHistoryContains(this.matchSearchText(match), search));
  });

  constructor(
    private readonly repo: LeagueArchiveRepository,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {
    this.playerName.set(this.route.snapshot.paramMap.get('playerName') ?? '');
    void this.repo.listLeagues().then((leagues) => this.leagues.set(leagues));
  }

  pct(value: number | null): string { return value == null ? this.i18n.t('common.na') : `${Math.round(value * 100)}%`; }

  winrateStatClass(value: number | null): string {
    if (value == null) return 'stat-number';
    const percent = Math.round(value * 100);
    if (percent > 50) return 'stat-number stat-number--high';
    if (percent < 50) return 'stat-number stat-number--low';
    return 'stat-number stat-number--even';
  }

  matchResult(match: PlayerMatch): 'win' | 'loss' | 'draw' {
    if (match.ownScore > match.opponentScore) return 'win';
    if (match.ownScore < match.opponentScore) return 'loss';
    return 'draw';
  }

  matchResultLabel(match: PlayerMatch): string {
    if (match.kind === 'bye') return this.i18n.t('player.victory');
    const result = this.matchResult(match);
    return result === 'win' ? this.i18n.t('player.victory') : result === 'loss' ? this.i18n.t('player.defeat') : this.i18n.t('player.draw');
  }

  matchDateLabel(match: PlayerMatch): string { return match.tournament.tournamentDate || this.i18n.t('common.noDate'); }

  matchDateReadable(match: PlayerMatch): string {
    const raw = match.tournament.tournamentDate;
    if (!raw) return this.i18n.t('common.noDate');
    return this.i18n.formatDate(raw, { dateStyle: 'long' });
  }

  matchRoundLabel(match: PlayerMatch): string { return this.i18n.t('player.roundN', { n: match.roundIndex + 1 }); }
  leagueDisplayName(league: { id: string; name: string }): string {
    return league.id === PLACEHOLDER_LEAGUE_ID ? this.i18n.t('liveList.unassigned') : league.name;
  }

  matchHeaderLabel(match: PlayerMatch): string { return `${this.matchDateLabel(match)} ${this.leagueDisplayName(match.league)} ${match.tournament.name} ${this.matchRoundLabel(match)}`; }
  matchWinningScore(match: PlayerMatch): string { return Math.max(match.ownScore, match.opponentScore).toString(); }
  matchLosingScore(match: PlayerMatch): string { return Math.min(match.ownScore, match.opponentScore).toString(); }
  matchScoreLabel(match: PlayerMatch): string { return `${this.matchWinningScore(match)}–${this.matchLosingScore(match)}`; }

  matchCardAriaLabel(match: PlayerMatch): string {
    return this.i18n.t('player.matchCardAria', { result: this.matchResultLabel(match), opponent: match.opponentName, tournament: match.tournament.name, round: this.matchRoundLabel(match) });
  }

  opponentTone(name: string): 'nemesis' | 'rival' | null {
    const nemesis = this.stats().nemesis;
    if (nemesis && nemesis === name) return 'nemesis';
    const rival = this.stats().rival;
    if (rival && rival === name) return 'rival';
    return null;
  }

  filterByExact(text: string, event?: Event): void {
    event?.stopPropagation();
    this.matchSearch.set(escapeSearchTerm(text));
  }

  clearMatchSearch(): void { this.matchSearch.set(''); }
  invertMatchOrder(): void { this.newestFirst.update((value) => !value); }
  highlightParts(text: string): HighlightPart[] { return highlightSearchText(text, this.matchSearch()); }
  scrollToTop(): void { window.scrollTo({ top: 0, behavior: 'smooth' }); }

  openMatchTournament(match: PlayerMatch): void {
    void this.router.navigate(
      ['/leagues-archive', match.league.id, 'tournaments-archive', match.tournament.id],
      { queryParams: { round: match.roundIndex + 1 } },
    );
  }

  private matchSearchText(match: PlayerMatch): string {
    return [
      this.matchHeaderLabel(match),
      this.matchDateReadable(match),
      'VS',
      match.opponentName,
      this.matchResultLabel(match),
      this.matchScoreLabel(match),
    ].join(' ');
  }
}

function orderMatches(matches: PlayerMatch[], newestFirst: boolean): PlayerMatch[] {
  return [...matches].sort((a, b) => {
    const direction = newestFirst ? -1 : 1;
    return direction * (matchChronologyValue(a) - matchChronologyValue(b));
  });
}

function matchChronologyValue(match: PlayerMatch): number {
  const dateTime = Date.parse(match.tournament.tournamentDate || '');
  const safeDateTime = Number.isNaN(dateTime) ? 0 : dateTime;
  return safeDateTime + match.roundIndex;
}

function matchHistoryContains(value: string, query: string): boolean {
  const haystack = normalizeSearchText(value);
  return searchWords(query).every((word) => haystack.includes(word));
}

