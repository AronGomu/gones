import { Component, computed, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { LeagueRepository } from '../../data/league-repository.service';
import { GonesData, GONES_DATA_VERSION, PersistedLeague } from '../../domain/models';
import { calculatePlayerStatistics, PlayerMatch } from '../../domain/player-stats';
import { BackButtonComponent } from '../../shared/back-button.component';
import { I18nService } from '../../i18n/i18n.service';

interface HighlightPart {
  text: string;
  highlighted: boolean;
}

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, BackButtonComponent],
  template: `
    <gones-back-button [label]="i18n.t('nav.backToPrevious')" position="top" />
    <section class="page-heading"><div><p class="kicker">{{ i18n.t('player.statsKicker') }}</p><h1 data-cy="player-name">{{ playerName() }}</h1></div></section>
    <div class="stat-grid" data-cy="player-stat-grid">
      <mat-card class="player-stat-card"><mat-card-title>{{ i18n.t('player.playedMatches') }}</mat-card-title><mat-card-content class="stat-number" data-cy="stat-played-matches">{{ stats().playedMatchCount }}</mat-card-content></mat-card>
      <mat-card class="player-stat-card"><mat-card-title>{{ i18n.t('player.byes') }}</mat-card-title><mat-card-content class="stat-number" data-cy="stat-byes">{{ stats().byeCount }}</mat-card-content></mat-card>
      <mat-card class="player-stat-card"><mat-card-title>{{ i18n.t('player.matchWinRate') }}</mat-card-title><mat-card-content [class]="winrateStatClass(stats().matchWinrate)" data-cy="stat-match-winrate">{{ pct(stats().matchWinrate) }}</mat-card-content></mat-card>
      <mat-card class="player-stat-card"><mat-card-title>{{ i18n.t('player.gameWinRate') }}</mat-card-title><mat-card-content [class]="winrateStatClass(stats().gameWinrate)" data-cy="stat-game-winrate">{{ pct(stats().gameWinrate) }}</mat-card-content></mat-card>
      <mat-card class="player-stat-card"><mat-card-title>{{ i18n.t('player.nemesis') }}</mat-card-title><mat-card-content>@if (stats().nemesis; as nemesis) { <button type="button" class="stat-filter-button stat-filter-button--nemesis" data-cy="stat-nemesis" (click)="filterByExact(nemesis)">{{ nemesis }}</button> } @else { <span data-cy="stat-nemesis">{{ i18n.t('common.na') }}</span> }</mat-card-content></mat-card>
      <mat-card class="player-stat-card"><mat-card-title>{{ i18n.t('player.rival') }}</mat-card-title><mat-card-content>@if (stats().rival; as rival) { <button type="button" class="stat-filter-button" [class.stat-filter-button--nemesis]="rival === stats().nemesis" [class.stat-filter-button--rival]="rival !== stats().nemesis" data-cy="stat-rival" (click)="filterByExact(rival)">{{ rival }}</button> } @else { <span data-cy="stat-rival">{{ i18n.t('common.na') }}</span> }</mat-card-content></mat-card>
    </div>
    <section class="stack">
      <div class="matches-heading">
        <h2>{{ i18n.t('player.matches') }}</h2>
        <div class="match-filter-controls">
          <mat-form-field appearance="outline" class="match-filter" subscriptSizing="dynamic">
            <input matInput data-cy="match-filter-input" [placeholder]="i18n.t('player.filterPlaceholder')" [value]="matchSearch()" (input)="matchSearch.set($any($event.target).value)" [attr.aria-label]="i18n.t('player.filterAria')">
          </mat-form-field>
          @if (matchSearch()) {
            <button type="button" class="match-filter-clear" data-cy="match-filter-clear" (click)="clearMatchSearch()" [attr.aria-label]="i18n.t('player.clearFilterAria')">{{ i18n.t('common.clear') }}</button>
          }
        </div>
        <button type="button" class="order-toggle" data-cy="match-order-toggle" (click)="invertMatchOrder()" [attr.aria-label]="newestFirst() ? i18n.t('player.sortOldest') : i18n.t('player.sortNewest')">
          <span class="order-toggle__icon" aria-hidden="true">{{ newestFirst() ? '↓' : '↑' }}</span>
          <span>{{ newestFirst() ? i18n.t('player.newestFirst') : i18n.t('player.oldestFirst') }}</span>
        </button>
        <span class="match-count" data-cy="match-count" aria-live="polite">{{ i18n.plural(filteredMatches().length, 'player.matchCountOne', 'player.matchCountMany') }}</span>
      </div>
      @if (!filteredMatches().length) { <p class="muted" data-cy="no-matches">{{ i18n.t('player.noMatches') }}</p> }
      @for (match of filteredMatches(); track match.tournament.id + match.roundIndex + match.opponentName) {
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
          <mat-card-title>
            <span class="match-card__line match-card__line--meta">
              <button type="button" class="match-filter-token match-card__date" data-cy="match-date" (click)="filterByExact(matchDateLabel(match), $event)">@for (part of highlightParts(matchDateReadable(match)); track $index) { <span [class.match-highlight]="part.highlighted">{{ part.text }}</span> }</button>
              <button type="button" class="match-filter-token match-card__league" data-cy="match-league" (click)="filterByExact(match.league.name, $event)">@for (part of highlightParts(match.league.name); track $index) { <span [class.match-highlight]="part.highlighted">{{ part.text }}</span> }</button>
              <button type="button" class="match-filter-token match-card__tournament" data-cy="match-tournament" (click)="filterByExact(match.tournament.name, $event)">@for (part of highlightParts(match.tournament.name); track $index) { <span [class.match-highlight]="part.highlighted">{{ part.text }}</span> }</button>
              <button type="button" class="match-filter-token match-card__round" data-cy="match-round" (click)="filterByExact(matchRoundLabel(match), $event)">@for (part of highlightParts(matchRoundLabel(match)); track $index) { <span [class.match-highlight]="part.highlighted">{{ part.text }}</span> }</button>
            </span>
          </mat-card-title>
          <mat-card-content>
            <span class="match-card__line match-card__line--result">
              <button type="button" class="match-filter-token match-card__result-pill" data-cy="match-result" (click)="filterByExact(matchResultLabel(match), $event)">@for (part of highlightParts(matchResultLabel(match)); track $index) { <span [class.match-highlight]="part.highlighted">{{ part.text }}</span> }</button>
              <span class="match-card__opponent-group">
                <strong class="match-card__vs">VS</strong>
                <button
                  type="button"
                  class="match-filter-token match-card__opponent"
                  data-cy="match-opponent"
                  [class.match-card__opponent--nemesis]="opponentTone(match.opponentName) === 'nemesis'"
                  [class.match-card__opponent--rival]="opponentTone(match.opponentName) === 'rival'"
                  (click)="filterByExact(match.opponentName, $event)"
                >@for (part of highlightParts(match.opponentName); track $index) { <span [class.match-highlight]="part.highlighted">{{ part.text }}</span> }</button>
              </span>
              <span class="match-card__score" data-cy="match-score">
                <span [class.score-number--win]="match.ownScore !== match.opponentScore">@for (part of highlightParts(matchWinningScore(match)); track $index) { <span [class.match-highlight]="part.highlighted">{{ part.text }}</span> }</span>
                <span class="match-card__score-separator">–</span>
                <span [class.score-number--loss]="match.ownScore !== match.opponentScore">@for (part of highlightParts(matchLosingScore(match)); track $index) { <span [class.match-highlight]="part.highlighted">{{ part.text }}</span> }</span>
              </span>
            </span>
          </mat-card-content>
        </mat-card>
      }
    </section>
    <footer class="live-tournament-footer player-detail-footer" data-cy="player-footer">
      <gones-back-button [label]="i18n.t('nav.backToPrevious')" position="top" />
      <button mat-stroked-button class="secondary-action live-scroll-top-button" type="button" data-cy="player-scroll-top-button" (click)="scrollToTop()" [attr.aria-label]="i18n.t('live.backToTop')">↑</button>
    </footer>
  `,
  styles: [`
    .stat-grid { margin-top: 1.1rem; margin-bottom: 1.35rem; }
    .player-stat-card { display: flex; flex-direction: column; border: 1px solid #000; }
    .player-stat-card mat-card-title { margin: .35rem .5rem 0; text-align: left; }
    .player-stat-card mat-card-content { flex: 1; display: flex; align-items: center; justify-content: center; color: oklch(86% 0.16 82); font-size: clamp(1.65rem, 4vw, 2.35rem); font-weight: 900; line-height: 1.1; text-align: center; }
    .player-stat-card mat-card-content.stat-number { font-size: clamp(2.4rem, 7vw, 4rem); }
    .player-stat-card mat-card-content.stat-number--high { color: oklch(80% 0.15 145); }
    .player-stat-card mat-card-content.stat-number--low { color: oklch(78% 0.14 25); }
    .player-stat-card mat-card-content.stat-number--even { color: #fff; }
    .stat-filter-button { border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; line-height: inherit; padding: 0; text-align: center; }
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
    .match-highlight { border-radius: .18rem; background: oklch(86% 0.16 82 / .3); color: oklch(92% 0.16 82); box-shadow: 0 0 0 2px oklch(86% 0.16 82 / .16); }
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
    private readonly repo: LeagueRepository,
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
    const parsed = parseDateOnly(raw);
    if (!parsed) return raw;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(parsed);
  }

  matchRoundLabel(match: PlayerMatch): string { return this.i18n.t('player.roundN', { n: match.roundIndex + 1 }); }
  matchHeaderLabel(match: PlayerMatch): string { return `${this.matchDateLabel(match)} ${match.league.name} ${match.tournament.name} ${this.matchRoundLabel(match)}`; }
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
    this.matchSearch.set(quoteSearchTerm(text));
  }

  clearMatchSearch(): void { this.matchSearch.set(''); }
  invertMatchOrder(): void { this.newestFirst.update((value) => !value); }
  highlightParts(text: string): HighlightPart[] { return highlightSearchText(text, this.matchSearch()); }
  scrollToTop(): void { window.scrollTo({ top: 0, behavior: 'smooth' }); }

  openMatchTournament(match: PlayerMatch): void {
    void this.router.navigate(
      ['/leagues', match.league.id, 'tournaments', match.tournament.id],
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

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
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

function highlightSearchText(text: string, query: string): HighlightPart[] {
  const words = searchWords(query);
  if (!words.length) return [{ text, highlighted: false }];

  const indexed = normalizeSearchTextWithIndex(text);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const word of words) {
    let index = indexed.normalized.indexOf(word);
    while (index !== -1) {
      ranges.push({ start: indexed.originalIndexes[index], end: indexed.originalIndexes[index + word.length - 1] + 1 });
      index = indexed.normalized.indexOf(word, index + 1);
    }
  }

  if (!ranges.length) return [{ text, highlighted: false }];
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = ranges.reduce<Array<{ start: number; end: number }>>((acc, range) => {
    const previous = acc.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else acc.push({ ...range });
    return acc;
  }, []);

  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (cursor < range.start) parts.push({ text: text.slice(cursor, range.start), highlighted: false });
    parts.push({ text: text.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false });
  return parts;
}

function searchWords(query: string): string[] {
  return parseSearchTerms(query).map(normalizeSearchText).filter(Boolean);
}

function parseSearchTerms(query: string): string[] {
  const terms: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (char === '"') {
      if (quoted) {
        if (current.trim()) terms.push(current.trim());
        current = '';
        quoted = false;
      } else {
        if (current.trim()) terms.push(current.trim());
        current = '';
        quoted = true;
      }
      continue;
    }

    if (!quoted && /\s/.test(char)) {
      if (current.trim()) terms.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) terms.push(current.trim());
  return terms;
}

function quoteSearchTerm(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeSearchTextWithIndex(value: string): { normalized: string; originalIndexes: number[] } {
  let normalized = '';
  const originalIndexes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = normalizeSearchText(value[index]);
    if (!char) continue;
    normalized += char;
    for (let offset = 0; offset < char.length; offset += 1) originalIndexes.push(index);
  }
  return { normalized, originalIndexes };
}
