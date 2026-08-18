import { Component, computed, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { GonesData, GONES_DATA_VERSION, PersistedLeague, PLACEHOLDER_LEAGUE_ID, TournamentDocument, trimPlayerName } from '../../domain/models';
import { calculatePlayerStatistics, OpponentRecord, PlayerArchetypeUsage, PlayerMatch, PlayerStatistics } from '../../domain/player-stats';
import { GlobalPlayerStatisticsRow, PlayerDetailResponse, PlayerMatchRow } from '../../api/generated/gones-api';
import { BackButtonComponent } from '../../shared/back-button.component';
import { SyncBarComponent } from '../../shared/sync-bar.component';
import { I18nService } from '../../i18n/i18n.service';
import { escapeSearchTerm, HighlightPart, highlightSearchText, normalizeSearchText, searchWords } from '../../shared/search-highlight';
import { isLocalLeagueId } from '../../data/league-archive-origin';
import { PlayerDetailCacheService } from './player-detail-cache.service';
import { MATCH_PAGE_SIZES, MatchPageSize, readMatchPageSize, readOnlineOnly, writeMatchPageSize, writeOnlineOnly } from './player-stats-preferences';

/**
 * One shape for the history whatever produced it: the server's flat rows (ADR 0039 read model) and
 * the browser-local leagues computed here both land as this, so the template never branches on
 * origin except to badge it.
 */
export interface PlayerMatchView {
  kind: 'match' | 'bye';
  leagueId: string;
  leagueName: string;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  roundIndex: number;
  opponentName: string;
  ownScore: number;
  opponentScore: number;
  ownArchetype: string;
  opponentArchetype: string;
  isLocal: boolean;
}

/** The totals the page renders — the server row alone, or the server row plus the local half. */
export interface PlayerStatsView {
  playedMatchCount: number;
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
  playedGameCount: number;
  gameWins: number;
  gameLosses: number;
  matchWinrate: number | null;
  gameWinrate: number | null;
  nemesis: OpponentRecord | null;
  rival: OpponentRecord | null;
  mostPlayedArchetype: PlayerArchetypeUsage | null;
}

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatCheckboxModule, MatSelectModule, BackButtonComponent, SyncBarComponent],
  template: `
    <div class="player-top-controls" data-cy="player-top-controls">
      <gones-back-button data-cy="player-back-top" [label]="i18n.t('nav.backToPrevious')" position="top" />
      <div class="player-source-controls" data-cy="player-source-controls">
        <mat-checkbox data-cy="player-online-only-toggle" [checked]="onlineOnly()" (change)="setOnlineOnly($event.checked)">{{ i18n.t('player.onlineOnly') }}</mat-checkbox>
        <gones-sync-bar cyPrefix="player" data-cy="player-sync-bar" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="onSync()" />
      </div>
    </div>
    <section class="page-heading" data-cy="player-heading"><div data-cy="player-heading-text"><p class="kicker" data-cy="player-kicker">{{ i18n.t('player.statsKicker') }}</p><h1 data-cy="player-name">{{ playerName() }}</h1></div></section>
    <div class="stat-grid" data-cy="player-stat-grid">
      <div class="stat-grid__row stat-grid__row--five" data-cy="player-stat-row-1">
        <div class="player-stat-cell" data-cy="player-stat-cell-played-matches"><p class="player-stat-label" data-cy="player-stat-label-played-matches">{{ i18n.t('player.playedMatches') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-played-matches"><mat-card-content class="stat-number" data-cy="player-stat-value-played-matches">{{ stats().playedMatchCount }}</mat-card-content></mat-card></div>
        <div class="player-stat-cell" data-cy="player-stat-cell-match-winrate"><p class="player-stat-label" data-cy="player-stat-label-match-winrate">{{ i18n.t('player.matchWinRate') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-match-winrate"><mat-card-content [class]="winrateStatClass(stats().matchWinrate)" data-cy="player-stat-value-match-winrate">{{ pct(stats().matchWinrate) }}</mat-card-content></mat-card></div>
        <div class="player-stat-cell" data-cy="player-stat-cell-match-wins"><p class="player-stat-label" data-cy="player-stat-label-match-wins">{{ i18n.t('player.matchWins') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-match-wins"><mat-card-content class="stat-number" data-cy="player-stat-value-match-wins">{{ stats().matchWins }}</mat-card-content></mat-card></div>
        <div class="player-stat-cell" data-cy="player-stat-cell-match-losses"><p class="player-stat-label" data-cy="player-stat-label-match-losses">{{ i18n.t('player.matchLosses') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-match-losses"><mat-card-content class="stat-number" data-cy="player-stat-value-match-losses">{{ stats().matchLosses }}</mat-card-content></mat-card></div>
        <div class="player-stat-cell" data-cy="player-stat-cell-match-draws"><p class="player-stat-label" data-cy="player-stat-label-match-draws">{{ i18n.t('player.matchDraws') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-match-draws"><mat-card-content class="stat-number" data-cy="player-stat-value-match-draws">{{ stats().matchDraws }}</mat-card-content></mat-card></div>
      </div>
      <div class="stat-grid__row stat-grid__row--five" data-cy="player-stat-row-2">
        <div class="player-stat-cell" data-cy="player-stat-cell-played-games"><p class="player-stat-label" data-cy="player-stat-label-played-games">{{ i18n.t('player.playedGames') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-played-games"><mat-card-content class="stat-number" data-cy="player-stat-value-played-games">{{ stats().playedGameCount }}</mat-card-content></mat-card></div>
        <div class="player-stat-cell" data-cy="player-stat-cell-game-winrate"><p class="player-stat-label" data-cy="player-stat-label-game-winrate">{{ i18n.t('player.gameWinRate') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-game-winrate"><mat-card-content [class]="winrateStatClass(stats().gameWinrate)" data-cy="player-stat-value-game-winrate">{{ pct(stats().gameWinrate) }}</mat-card-content></mat-card></div>
        <div class="player-stat-cell" data-cy="player-stat-cell-game-wins"><p class="player-stat-label" data-cy="player-stat-label-game-wins">{{ i18n.t('player.gameWins') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-game-wins"><mat-card-content class="stat-number" data-cy="player-stat-value-game-wins">{{ stats().gameWins }}</mat-card-content></mat-card></div>
        <div class="player-stat-cell" data-cy="player-stat-cell-game-losses"><p class="player-stat-label" data-cy="player-stat-label-game-losses">{{ i18n.t('player.gameLosses') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-game-losses"><mat-card-content class="stat-number" data-cy="player-stat-value-game-losses">{{ stats().gameLosses }}</mat-card-content></mat-card></div>
        <div class="player-stat-cell" data-cy="player-stat-cell-match-draw-rate"><p class="player-stat-label" data-cy="player-stat-label-match-draw-rate">{{ i18n.t('player.matchDrawRate') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-match-draw-rate"><mat-card-content class="stat-number" data-cy="player-stat-value-match-draw-rate">{{ pct(matchDrawRate()) }}</mat-card-content></mat-card></div>
      </div>
      <div class="stat-grid__row stat-grid__row--three" data-cy="player-stat-row-3">
        <div class="player-stat-cell" data-cy="player-stat-cell-most-played-archetype"><p class="player-stat-label" data-cy="player-stat-label-most-played-archetype">{{ i18n.t('player.mostPlayedArchetype') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-most-played-archetype"><mat-card-content class="player-stat-card__name" data-cy="player-stat-value-most-played-archetype">@if (stats().mostPlayedArchetype; as archetype) { <span data-cy="player-stat-archetype">{{ i18n.t('player.archetypeMatches', { name: archetype.name, count: archetype.matchCount }) }}</span> } @else { <span data-cy="player-stat-na-archetype">{{ i18n.t('common.na') }}</span> }</mat-card-content></mat-card></div>
        <div class="player-stat-cell" data-cy="player-stat-cell-nemesis"><p class="player-stat-label" data-cy="player-stat-label-nemesis">{{ i18n.t('player.nemesis') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-nemesis"><mat-card-content class="player-stat-card__name" data-cy="player-stat-value-nemesis">@if (stats().nemesis; as nemesis) { <button type="button" class="stat-filter-button stat-filter-button--nemesis" data-cy="player-stat-filter-nemesis" (click)="filterByExact(nemesis.name)">{{ nemesis.name }}</button> } @else { <span data-cy="player-stat-na-nemesis">{{ i18n.t('common.na') }}</span> }</mat-card-content></mat-card></div>
        <div class="player-stat-cell" data-cy="player-stat-cell-rival"><p class="player-stat-label" data-cy="player-stat-label-rival">{{ i18n.t('player.rival') }}</p><mat-card class="player-stat-card" data-cy="player-stat-card-rival"><mat-card-content class="player-stat-card__name" data-cy="player-stat-value-rival">@if (stats().rival; as rival) { <button type="button" class="stat-filter-button stat-filter-button--rival" data-cy="player-stat-filter-rival" (click)="filterByExact(rival.name)">{{ rival.name }}</button> } @else { <span data-cy="player-stat-na-rival">{{ i18n.t('common.na') }}</span> }</mat-card-content></mat-card></div>
      </div>
    </div>
    <section class="stack" data-cy="player-matches-section">
      <div class="matches-heading" data-cy="player-matches-heading">
        <h2 data-cy="player-matches-title">{{ i18n.t('player.matches') }}</h2>
        <div class="match-filter-controls" data-cy="match-filter-controls">
          <mat-form-field appearance="outline" class="match-filter" subscriptSizing="dynamic" data-cy="match-filter-field">
            <input matInput data-cy="match-filter-input" [placeholder]="i18n.t('player.filterPlaceholder')" [value]="matchSearch()" (input)="setMatchSearch($any($event.target).value)" [attr.aria-label]="i18n.t('player.filterAria')">
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
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="player-page-size" data-cy="player-page-size-field">
          <mat-label data-cy="player-page-size-label">{{ i18n.t('player.matchesPerPage') }}</mat-label>
          <mat-select data-cy="player-page-size-select" [value]="matchPageSize()" (selectionChange)="setMatchPageSize($event.value)">
            @for (size of matchPageSizes; track size) { <mat-option [value]="size" [attr.data-cy]="'player-page-size-option-' + size">{{ size }}</mat-option> }
          </mat-select>
        </mat-form-field>
      </div>
      @if (truncated()) { <p class="warning" role="status" data-cy="player-history-truncated">{{ i18n.t('player.historyTruncated', { shown: serverMatchCount(), total: totalMatchCount() }) }}</p> }
      @if (!filteredMatches().length) { <p class="muted" data-cy="no-matches">{{ i18n.t('player.noMatches') }}</p> }
      @for (match of pagedMatches(); track match.leagueId + match.tournamentId + match.roundIndex + match.opponentName; let matchIndex = $index) {
        <mat-card
          class="match-card"
          data-cy="match-card"
          role="link"
          tabindex="0"
          [attr.aria-label]="matchCardAriaLabel(match)"
          [class.match-card--win]="matchResult(match) === 'win'"
          [class.match-card--loss]="matchResult(match) === 'loss'"
          [class.match-card--draw]="matchResult(match) === 'draw'"
          [class.match-card--local]="match.isLocal"
          (click)="openMatchTournament(match)"
          (keydown.enter)="openMatchTournament(match)"
          (keydown.space)="$event.preventDefault(); openMatchTournament(match)"
        >
          <mat-card-title [attr.data-cy]="'match-card-title-' + matchIndex">
            <span class="match-card__line match-card__line--meta" [attr.data-cy]="'match-card-meta-' + matchIndex">
              <button type="button" class="match-filter-token match-card__date" data-cy="match-date" (click)="filterByExact(matchDateLabel(match), $event)">@for (part of highlightParts(matchDateReadable(match)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-date-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
              <button type="button" class="match-filter-token match-card__league" data-cy="match-league" (click)="filterByExact(leagueDisplayName(match), $event)">@for (part of highlightParts(leagueDisplayName(match)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-league-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
              <button type="button" class="match-filter-token match-card__tournament" data-cy="match-tournament" (click)="filterByExact(match.tournamentName, $event)">@for (part of highlightParts(match.tournamentName); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-tournament-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
              <button type="button" class="match-filter-token match-card__round" data-cy="match-round" (click)="filterByExact(matchRoundLabel(match), $event)">@for (part of highlightParts(matchRoundLabel(match)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-round-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
              @if (match.isLocal) { <span class="match-card__local-badge" data-cy="player-match-local">{{ i18n.t('player.localMatch') }}</span> }
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
              <span class="match-card__archetypes" [attr.data-cy]="'match-archetypes-' + matchIndex">
                <button type="button" class="match-filter-token match-card__archetype match-card__archetype--own" data-cy="match-own-archetype" (click)="filterByExact(ownArchetypeLabel(match), $event)">@for (part of highlightParts(ownArchetypeLabel(match)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-own-archetype-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
                @if (match.kind !== 'bye') {
                  <span class="match-card__archetype-vs" [attr.data-cy]="'match-archetype-vs-' + matchIndex">{{ i18n.t('player.archetypeVersus') }}</span>
                  <button type="button" class="match-filter-token match-card__archetype match-card__archetype--opponent" data-cy="match-opponent-archetype" (click)="filterByExact(opponentArchetypeLabel(match), $event)">@for (part of highlightParts(opponentArchetypeLabel(match)); track $index) { <span [class.match-highlight]="part.highlighted" [attr.data-cy]="'match-opponent-archetype-part-' + matchIndex + '-' + $index">{{ part.text }}</span> }</button>
                }
              </span>
            </span>
          </mat-card-content>
        </mat-card>
      }
      @if (filteredMatches().length) {
        <nav class="player-pagination" data-cy="player-pagination" [attr.aria-label]="i18n.t('player.paginationAria')">
          <button type="button" data-cy="player-page-previous" (click)="previousPage()" [disabled]="matchPage() === 1">{{ i18n.t('common.previous') }}</button>
          <span data-cy="player-page-status" aria-live="polite">{{ i18n.t('player.pageStatus', { page: matchPage(), total: totalPages() }) }}</span>
          <button type="button" data-cy="player-page-next" (click)="nextPage()" [disabled]="matchPage() === totalPages()">{{ i18n.t('common.next') }}</button>
        </nav>
      }
    </section>
    <footer class="live-tournament-footer player-detail-footer" data-cy="player-footer">
      <gones-back-button data-cy="player-back-bottom" [label]="i18n.t('nav.backToPrevious')" position="bottom" />
      <button mat-stroked-button class="secondary-action live-scroll-top-button" type="button" data-cy="player-scroll-top-button" (click)="scrollToTop()" [attr.aria-label]="i18n.t('live.backToTop')">↑</button>
    </footer>
  `,
  styles: [`
    .player-top-controls { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .player-source-controls { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
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
    .stat-grid__row--five {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
    .stat-grid__row--three {
      grid-template-columns: repeat(3, minmax(0, 1fr));
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
    @media (max-width: 1100px) {
      .stat-grid__row--five,
      .stat-grid__row--three {
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr));
      }
    }
    @media (max-width: 640px) {
      .player-top-controls { align-items: flex-start; flex-direction: column; }
      .player-source-controls { align-items: flex-start; flex-direction: column; }
      .stat-grid__row--five,
      .stat-grid__row--three { grid-template-columns: 1fr; }
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
    .player-page-size { width: 9rem; }
    .player-pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: .5rem; }
    .player-pagination button { border: 1px solid var(--soot); background: var(--black-metal); color: var(--ash); cursor: pointer; min-height: 2.5rem; padding: .45rem .75rem; }
    .player-pagination button:disabled { cursor: default; opacity: .45; }
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
    .match-card--local { border-style: dashed; }
    .match-card__local-badge { border: 1px solid var(--soot); color: var(--dim-ash); padding: .1rem .4rem; font-size: .72rem; font-weight: 900; letter-spacing: .08em; }
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
    .match-card__archetypes { display: inline-flex; align-items: center; gap: .4rem; font-size: .95rem; font-weight: 800; }
    .match-card__archetype--own { color: oklch(80% 0.12 200); }
    .match-card__archetype--opponent { color: oklch(78% 0.14 25); }
    .match-card__archetype-vs { color: var(--dim-ash); font-size: .85em; text-transform: lowercase; }
    .match-card__score { color: var(--ash); font-size: 1.18rem; font-weight: 950; white-space: nowrap; }
    .match-card__score-separator { color: var(--dim-ash); margin-inline: .12rem; }
    .score-number--win { color: oklch(82% 0.15 145); }
    .score-number--loss { color: oklch(78% 0.14 25); }
    .player-detail-footer { margin-top: 2rem; }
  `]
})
export class PlayerDetailComponent {
  readonly playerName = signal('');
  readonly onlineOnly = signal(readOnlineOnly());
  /** The server's answer for this player, or `null` when it knows no played Match for them. */
  readonly serverPayload = signal<PlayerDetailResponse | null>(null);
  /** Only ever the browser store (ADR 0028) — the server half already arrived as `serverPayload`. */
  readonly localLeagues = signal<PersistedLeague[]>([]);
  readonly loading = signal(false);
  readonly stale = signal(false);
  readonly truncated = signal(false);
  readonly syncedAt = signal<string | undefined>(undefined);
  readonly matchSearch = signal('');
  readonly newestFirst = signal(true);
  readonly matchPageSizes = MATCH_PAGE_SIZES;
  readonly matchPageSize = signal<MatchPageSize>(readMatchPageSize());
  private readonly requestedMatchPage = signal(1);
  private localLeaguesLoaded = false;
  readonly serverMatchCount = computed(() => this.serverPayload()?.matches?.length ?? 0);
  readonly totalMatchCount = computed(() => this.serverPayload()?.totalMatchCount ?? 0);
  /** `null` while Online-only is on: nothing browser-local counts, so nothing browser-local is read. */
  readonly localStats = computed<PlayerStatistics | null>(() => this.onlineOnly()
    ? null
    : calculatePlayerStatistics({ version: GONES_DATA_VERSION, leagues: this.localLeagues(), calendarEvents: [] } satisfies GonesData, this.playerName()));
  readonly allMatches = computed<PlayerMatchView[]>(() => {
    const server = (this.serverPayload()?.matches ?? []).map(toServerMatchView);
    const local = this.localStats()?.matches ?? [];
    return [...server, ...local.map((match) => toLocalMatchView(match, this.playerName()))];
  });
  readonly stats = computed<PlayerStatsView>(() => {
    const server = this.serverPayload()?.statistics ?? null;
    const local = this.localStats();
    return local ? mergeStats(server, local, this.allMatches()) : serverStatsView(server);
  });
  readonly matchDrawRate = computed(() => { const s = this.stats(); return s.playedMatchCount > 0 ? s.matchDraws / s.playedMatchCount : null; });
  readonly orderedMatches = computed(() => orderMatches(this.allMatches(), this.newestFirst()));
  readonly filteredMatches = computed(() => {
    const search = this.matchSearch().trim();
    if (!search) return this.orderedMatches();
    return this.orderedMatches().filter((match) => matchHistoryContains(this.matchSearchText(match), search));
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredMatches().length / this.matchPageSize())));
  readonly matchPage = computed(() => Math.min(this.requestedMatchPage(), this.totalPages()));
  readonly pagedMatches = computed(() => paginateMatches(this.filteredMatches(), this.matchPage(), this.matchPageSize()));

  constructor(
    private readonly repo: LeagueArchiveRepository,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    readonly i18n: I18nService,
    private readonly cache: PlayerDetailCacheService,
  ) {
    this.playerName.set(this.route.snapshot.paramMap.get('playerName') ?? '');
    void this.loadPlayer();
    if (!this.onlineOnly()) void this.loadLocalLeagues();
  }

  private async loadPlayer(options: { force?: boolean } = {}): Promise<void> {
    this.loading.set(true);
    try {
      const result = await this.cache.load(this.playerName(), options);
      this.serverPayload.set(result.items);
      this.syncedAt.set(result.fetchedAt);
      this.stale.set(result.stale);
      this.truncated.set(result.truncated);
      // The route value is whatever was typed or linked; the read model owns the spelling.
      const canonical = result.items?.statistics?.playerName;
      if (canonical) this.playerName.set(canonical);
    } catch {
      // An unreachable server is what the offline banner says; the local half still renders.
      this.stale.set(true);
    } finally {
      this.loading.set(false);
      this.resetMatchPage();
    }
  }

  /**
   * Browser-local leagues only, and only once. Filtering on the `local-` prefix is the guard against
   * counting a server League twice: its matches are already in `serverPayload`.
   */
  private async loadLocalLeagues(): Promise<void> {
    if (this.localLeaguesLoaded) return;
    this.localLeaguesLoaded = true;
    try {
      const leagues = await this.repo.listLocalLeagues();
      this.localLeagues.set(leagues.filter((league) => isLocalLeagueId(league.id)));
    } catch {
      this.localLeaguesLoaded = false;
    }
    this.resetMatchPage();
  }

  onSync(): void { void this.loadPlayer({ force: true }); }

  pct(value: number | null): string { return value == null ? this.i18n.t('common.na') : `${(value * 100).toFixed(2)}%`; }

  winrateStatClass(value: number | null): string {
    if (value == null) return 'stat-number';
    const percent = Math.round(value * 100);
    if (percent > 50) return 'stat-number stat-number--high';
    if (percent < 50) return 'stat-number stat-number--low';
    return 'stat-number stat-number--even';
  }

  matchResult(match: PlayerMatchView): 'win' | 'loss' | 'draw' {
    if (match.ownScore > match.opponentScore) return 'win';
    if (match.ownScore < match.opponentScore) return 'loss';
    return 'draw';
  }

  matchResultLabel(match: PlayerMatchView): string {
    if (match.kind === 'bye') return this.i18n.t('player.victory');
    const result = this.matchResult(match);
    return result === 'win' ? this.i18n.t('player.victory') : result === 'loss' ? this.i18n.t('player.defeat') : this.i18n.t('player.draw');
  }

  matchDateLabel(match: PlayerMatchView): string { return match.tournamentDate || this.i18n.t('common.noDate'); }

  matchDateReadable(match: PlayerMatchView): string {
    const raw = match.tournamentDate;
    if (!raw) return this.i18n.t('common.noDate');
    return this.i18n.formatDate(raw, { dateStyle: 'long' });
  }

  matchRoundLabel(match: PlayerMatchView): string { return this.i18n.t('player.roundN', { n: match.roundIndex + 1 }); }
  leagueDisplayName(match: PlayerMatchView): string {
    return match.leagueId === PLACEHOLDER_LEAGUE_ID ? this.i18n.t('liveList.unassigned') : match.leagueName;
  }

  matchHeaderLabel(match: PlayerMatchView): string { return `${this.matchDateLabel(match)} ${this.leagueDisplayName(match)} ${match.tournamentName} ${this.matchRoundLabel(match)}`; }
  matchWinningScore(match: PlayerMatchView): string { return Math.max(match.ownScore, match.opponentScore).toString(); }
  matchLosingScore(match: PlayerMatchView): string { return Math.min(match.ownScore, match.opponentScore).toString(); }
  matchScoreLabel(match: PlayerMatchView): string { return `${this.matchWinningScore(match)}–${this.matchLosingScore(match)}`; }

  ownArchetypeLabel(match: PlayerMatchView): string { return match.ownArchetype || this.i18n.t('player.missingArchetype'); }
  opponentArchetypeLabel(match: PlayerMatchView): string { return match.opponentArchetype || this.i18n.t('player.missingArchetype'); }

  matchCardAriaLabel(match: PlayerMatchView): string {
    return this.i18n.t('player.matchCardAria', { result: this.matchResultLabel(match), opponent: match.opponentName, tournament: match.tournamentName, round: this.matchRoundLabel(match), own: this.ownArchetypeLabel(match), opponent2: match.kind !== 'bye' ? this.opponentArchetypeLabel(match) : '' });
  }

  opponentTone(name: string): 'nemesis' | 'rival' | null {
    const nemesis = this.stats().nemesis;
    if (nemesis?.name === name) return 'nemesis';
    const rival = this.stats().rival;
    if (rival?.name === name) return 'rival';
    return null;
  }

  setOnlineOnly(value: boolean): void {
    this.onlineOnly.set(value);
    writeOnlineOnly(value);
    if (!value) void this.loadLocalLeagues();
    this.resetMatchPage();
  }

  setMatchPageSize(value: MatchPageSize): void {
    if (!MATCH_PAGE_SIZES.includes(value)) return;
    this.matchPageSize.set(value);
    writeMatchPageSize(value);
    this.resetMatchPage();
  }

  setMatchSearch(value: string): void {
    this.matchSearch.set(value);
    this.resetMatchPage();
  }

  previousPage(): void { this.requestedMatchPage.update((page) => Math.max(1, page - 1)); }
  nextPage(): void { this.requestedMatchPage.update((page) => Math.min(this.totalPages(), page + 1)); }

  filterByExact(text: string, event?: Event): void {
    event?.stopPropagation();
    this.setMatchSearch(escapeSearchTerm(text));
  }

  clearMatchSearch(): void { this.setMatchSearch(''); }
  invertMatchOrder(): void {
    this.newestFirst.update((value) => !value);
    this.resetMatchPage();
  }
  highlightParts(text: string): HighlightPart[] { return highlightSearchText(text, this.matchSearch()); }
  scrollToTop(): void { window.scrollTo({ top: 0, behavior: 'smooth' }); }

  openMatchTournament(match: PlayerMatchView): void {
    void this.router.navigate(
      ['/leagues-archive', match.leagueId, 'tournaments-archive', match.tournamentId],
      { queryParams: { round: match.roundIndex + 1 } },
    );
  }

  private resetMatchPage(): void { this.requestedMatchPage.set(1); }

  private matchSearchText(match: PlayerMatchView): string {
    return [
      this.matchHeaderLabel(match),
      this.matchDateReadable(match),
      'VS',
      match.opponentName,
      this.matchResultLabel(match),
      this.matchScoreLabel(match),
      this.ownArchetypeLabel(match),
      ...(match.kind !== 'bye' ? [this.opponentArchetypeLabel(match)] : []),
    ].join(' ');
  }
}

export function paginateMatches<T>(matches: readonly T[], page: number, pageSize: number): T[] {
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return matches.slice(start, start + pageSize);
}

function orderMatches(matches: PlayerMatchView[], newestFirst: boolean): PlayerMatchView[] {
  return [...matches].sort((a, b) => {
    const direction = newestFirst ? -1 : 1;
    return direction * (matchChronologyValue(a) - matchChronologyValue(b));
  });
}

function matchChronologyValue(match: PlayerMatchView): number {
  const dateTime = Date.parse(match.tournamentDate || '');
  const safeDateTime = Number.isNaN(dateTime) ? 0 : dateTime;
  return safeDateTime + match.roundIndex;
}

function toServerMatchView(row: PlayerMatchRow): PlayerMatchView {
  return {
    kind: row.kind === 'bye' ? 'bye' : 'match',
    leagueId: row.leagueId,
    leagueName: row.leagueName,
    tournamentId: row.tournamentId,
    tournamentName: row.tournamentName,
    tournamentDate: row.tournamentDate ?? '',
    roundIndex: row.roundIndex,
    opponentName: row.opponentName,
    ownScore: row.ownScore,
    opponentScore: row.opponentScore,
    ownArchetype: row.ownArchetype ?? '',
    opponentArchetype: row.opponentArchetype ?? '',
    isLocal: false,
  };
}

function toLocalMatchView(match: PlayerMatch, playerName: string): PlayerMatchView {
  return {
    kind: match.kind,
    leagueId: match.league.id,
    leagueName: match.league.name,
    tournamentId: match.tournament.id,
    tournamentName: match.tournament.name,
    tournamentDate: match.tournament.tournamentDate ?? '',
    roundIndex: match.roundIndex,
    opponentName: match.opponentName,
    ownScore: match.ownScore,
    opponentScore: match.opponentScore,
    ownArchetype: rosterArchetype(match.tournament, playerName),
    opponentArchetype: match.kind === 'bye' ? '' : rosterArchetype(match.tournament, match.opponentName),
    isLocal: true,
  };
}

function rosterArchetype(tournament: TournamentDocument, playerName: string): string {
  const name = trimPlayerName(playerName);
  return tournament.playerArchetypes?.find((row) => trimPlayerName(row.playerName) === name)?.archetype.trim() ?? '';
}

/** Online-only: the read model's row is the answer, rendered exactly as it arrived. */
function serverStatsView(row: GlobalPlayerStatisticsRow | null): PlayerStatsView {
  return {
    playedMatchCount: row?.playedMatchCount ?? 0,
    matchWins: row?.matchWins ?? 0,
    matchLosses: row?.matchLosses ?? 0,
    matchDraws: row?.matchDraws ?? 0,
    playedGameCount: row?.playedGameCount ?? 0,
    gameWins: row?.gameWins ?? 0,
    gameLosses: row?.gameLosses ?? 0,
    matchWinrate: row?.matchWinrate ?? null,
    gameWinrate: row?.gameWinrate ?? null,
    nemesis: row?.nemesis ?? null,
    rival: row?.rival ?? null,
    mostPlayedArchetype: row?.mostPlayedArchetype ?? null,
  };
}

/**
 * Counts add; ratios do not. Nemesis, Rival and the most played Archetype are recomputed from the
 * merged history — two "top of my half" summaries cannot be combined into the top of the whole.
 */
function mergeStats(server: GlobalPlayerStatisticsRow | null, local: PlayerStatistics, matches: readonly PlayerMatchView[]): PlayerStatsView {
  const playedMatchCount = (server?.playedMatchCount ?? 0) + local.playedMatchCount;
  const matchWins = (server?.matchWins ?? 0) + local.matchWins;
  const playedGameCount = (server?.playedGameCount ?? 0) + local.playedGameCount;
  const gameWins = (server?.gameWins ?? 0) + local.gameWins;
  return {
    playedMatchCount,
    matchWins,
    matchLosses: (server?.matchLosses ?? 0) + local.matchLosses,
    matchDraws: (server?.matchDraws ?? 0) + local.matchDraws,
    playedGameCount,
    gameWins,
    gameLosses: (server?.gameLosses ?? 0) + local.gameLosses,
    matchWinrate: playedMatchCount ? matchWins / playedMatchCount : null,
    gameWinrate: playedGameCount ? gameWins / playedGameCount : null,
    ...summarizeMatches(matches),
  };
}

interface OpponentTally extends OpponentRecord { matchCount: number; }

/** Mirrors `finalizeStatistics` in `domain/player-stats`: a Bye is history, never a played Match. */
function summarizeMatches(matches: readonly PlayerMatchView[]): Pick<PlayerStatsView, 'nemesis' | 'rival' | 'mostPlayedArchetype'> {
  const opponents = new Map<string, OpponentTally>();
  const archetypes = new Map<string, number>();
  for (const match of matches) {
    if (match.kind !== 'match') continue;
    const tally = opponents.get(match.opponentName) ?? { name: match.opponentName, wins: 0, losses: 0, matchCount: 0 };
    if (match.ownScore > match.opponentScore) tally.wins += 1;
    else if (match.ownScore < match.opponentScore) tally.losses += 1;
    tally.matchCount += 1;
    opponents.set(match.opponentName, tally);
    if (match.ownArchetype) archetypes.set(match.ownArchetype, (archetypes.get(match.ownArchetype) ?? 0) + 1);
  }
  const byLosses = topTally(opponents, (tally) => tally.losses, true);
  const byMatches = topTally(opponents, (tally) => tally.matchCount);
  const topArchetype = [...archetypes.entries()].sort((left, right) => right[1] - left[1] || compareOrdinal(left[0], right[0]))[0];
  return {
    nemesis: byLosses && { name: byLosses.name, wins: byLosses.wins, losses: byLosses.losses },
    rival: byMatches && { name: byMatches.name, wins: byMatches.wins, losses: byMatches.losses },
    mostPlayedArchetype: topArchetype ? { name: topArchetype[0], matchCount: topArchetype[1] } : null,
  };
}

function topTally(opponents: Map<string, OpponentTally>, value: (tally: OpponentTally) => number, requirePositive = false): OpponentTally | null {
  const records = [...opponents.values()].filter((tally) => !requirePositive || value(tally) > 0);
  if (!records.length) return null;
  return records.sort((left, right) => value(right) - value(left) || compareOrdinal(left.name, right.name))[0];
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function matchHistoryContains(value: string, query: string): boolean {
  const haystack = normalizeSearchText(value);
  return searchWords(query).every((word) => haystack.includes(word));
}

