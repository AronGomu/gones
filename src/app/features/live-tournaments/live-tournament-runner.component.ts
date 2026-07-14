import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { LeagueRepository } from '../../data/league-repository.service';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { activeLivePlayers, autoLiveSwissRoundCount, cancelCurrentSwissRound, canStartLiveTournament, calculateLiveStandings, calculateLiveStandingsThroughRound, createLiveTournamentPlayer, currentLiveRound, currentRoundComplete, finalizeLiveTournament, generateNextSwissRound, liveMatchScoreIssue, liveTournamentFinished, LiveStandingRow, LiveTournamentCheckpointDocument, LiveTournamentDocument, LiveTournamentPlayerDocument, LiveTournamentRoundDocument, restoreLiveTournamentCheckpoint, unpaidActivePlayers, validateCurrentSwissRound } from '../../domain/live-tournament';
import { PersistedLeague, PLACEHOLDER_LEAGUE_ID, RoundEntry, TournamentDocument, trimPlayerName } from '../../domain/models';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { DeckArchetypeInputComponent } from '../../shared/deck-archetype-input.component';
import { I18nService } from '../../i18n/i18n.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatDialogModule, MatExpansionModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/live-tournaments']" [label]="i18n.t('nav.backToRunningTournaments')" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (loading()) { <mat-spinner diameter="40" /> }
    @else if (tournament(); as live) {
      <section class="page-heading live-tournament-title-heading">
        <h1>{{ live.name || i18n.t('live.defaultLiveName') }}</h1>
        <div class="live-tournament-meta-fields">
          <mat-form-field appearance="outline" class="title-field"><mat-label>{{ i18n.t('live.tournamentName') }}</mat-label><input #liveTournamentNameInput data-cy="live-tournament-name-input" matInput [(ngModel)]="tournamentNameDraft" (blur)="saveTitleEdit()" (keydown.enter)="$event.preventDefault(); saveTitleEdit()" [disabled]="finalizing()"></mat-form-field>
          <mat-form-field appearance="outline" class="live-tournament-date-field"><mat-label>{{ i18n.t('live.date') }}</mat-label><input matInput data-cy="live-tournament-date-input" type="date" [ngModel]="live.tournamentDate" (ngModelChange)="patch({ tournamentDate: stringValue($event, live.tournamentDate) })" [disabled]="finalizing()"></mat-form-field>
          <mat-form-field appearance="outline" class="live-tournament-league-field"><mat-label>{{ i18n.t('live.leagueFinalize') }}</mat-label><mat-select data-cy="live-tournament-league-select" [ngModel]="live.leagueId" (ngModelChange)="patch({ leagueId: stringValue($event, '') })" [disabled]="finalizing()"><mat-option value="">{{ i18n.t('live.unassigned') }}</mat-option>@for (league of leagues(); track league.id) { <mat-option [value]="league.id">{{ league.name }}</mat-option> }</mat-select></mat-form-field>
        </div>
      </section>
      <div class="live-warning-stack" aria-live="polite">
        @if (notEnoughPlayers(live)) {
          <div class="warning live-warning" role="status" data-cy="live-warning-not-enough-players">
            <p>{{ i18n.t('live.warnNotEnough') }}</p>
          </div>
        }
        @if (live.paidTrackingEnabled && unpaidPlayers().length) {
          <div class="warning live-warning" role="status" data-cy="live-warning-unpaid-players">
            <p>{{ i18n.t('live.warnUnpaid', { names: unpaidPlayerNames() }) }}</p>
          </div>
        }
        @if (showByeWarning(live)) {
          <div class="warning live-warning" role="status" data-cy="live-warning-bye">
            <p>{{ i18n.t('live.warnBye') }}</p>
          </div>
        }
      </div>

      <section class="live-tournament-grid live-tournament-grid--compact">
        <mat-expansion-panel class="round-panel panel live-panel live-roster-panel" [expanded]="registrationExpanded()" (opened)="registrationExpanded.set(true)" (closed)="registrationExpanded.set(false)">
          <mat-expansion-panel-header>
            <mat-panel-title class="round-panel-title">{{ i18n.t('live.registrationTitle') }}</mat-panel-title>
            <mat-panel-description>{{ i18n.plural(activePlayerCount(live), 'live.playerCountDesc', 'live.playerCountDescPlural') }}</mat-panel-description>
          </mat-expansion-panel-header>
          <div class="live-form-stack">
            <p class="muted" data-cy="live-player-count">{{ i18n.plural(activePlayerCount(live), 'live.playersRegistered', 'live.playersRegisteredPlural') }}</p>
            <div class="live-add-player-row" data-cy="live-add-player-card">
              <label class="live-registration-player-card__name live-registration-add-card__name"><span>{{ i18n.t('live.newPlayer') }}</span><span class="sr-only">{{ i18n.t('live.newPlayerSr') }}</span><input #newPlayerNameInput data-cy="live-add-player-name-input" [placeholder]="i18n.t('live.playerNamePlaceholder')" [(ngModel)]="newPlayerName" (keydown.enter)="$event.preventDefault(); addPlayer()" [disabled]="live.stage !== 'registration'" [attr.aria-label]="i18n.t('live.newPlayerNameAria')" aria-keyshortcuts="Enter"></label>
              <button mat-flat-button class="create-action-button live-registration-add-card__button" type="button" data-cy="live-add-player-button" [disabled]="!canSubmitNewPlayer(live)" (click)="addPlayer()" [attr.aria-label]="i18n.t('live.addPlayerAria')"><mat-icon class="create-action-button__icon" aria-hidden="true">add</mat-icon><span>{{ i18n.t('live.addEnter') }}</span></button>
            </div>
            <div class="live-registration-player-grid" [attr.aria-label]="i18n.t('live.registeredPlayersAria')">
              @for (player of live.players; track player.id) {
                <article class="live-registration-player-card" data-cy="live-player-row" [class.is-dropped]="player.dropped">
                  <label class="live-registration-player-card__name"><span>{{ i18n.t('common.player') }}</span><span class="sr-only">{{ player.name || i18n.t('live.newPlayerSr') }}</span><input data-cy="live-player-name-input" [ngModel]="player.name" (ngModelChange)="updatePlayer(player.id, { name: $event })" [attr.aria-label]="player.name ? i18n.t('live.playerNameFor', { name: player.name }) : i18n.t('live.playerNameForNew')"></label>
                  @if (live.paidTrackingEnabled) {
                    <label class="live-registration-player-card__paid"><input type="checkbox" data-cy="live-player-paid-checkbox" [ngModel]="player.paid" (ngModelChange)="updatePlayer(player.id, { paid: $event })" [attr.aria-label]="i18n.t('live.paidStatusFor', { name: player.name || i18n.t('live.newPlayerSr') })" [disabled]="live.stage === 'round'"> <span>{{ i18n.t('live.paid') }}</span></label>
                  }
                  <button mat-button color="warn" type="button" data-cy="live-player-remove-button" [disabled]="live.stage !== 'registration'" (click)="confirmRemovePlayer(player.id)">{{ i18n.t('common.remove') }}</button>
                </article>
              }
            </div>
            @if (!live.players.length) { <p class="empty">{{ i18n.t('live.noPlayersYet') }}</p> }
            <div class="live-round-count-settings" data-cy="live-round-count-settings">
              <mat-form-field appearance="outline" class="live-round-count-field"><mat-label>{{ i18n.t('live.swissRoundCount') }}</mat-label><input matInput data-cy="live-tournament-round-count-input" type="number" min="0" [ngModel]="displayRoundCount(live)" (ngModelChange)="setRoundCount($event)" [disabled]="!live.customRoundCount || live.stage !== 'registration'"></mat-form-field>
              <label class="live-custom-round-toggle"><span>{{ i18n.t('live.customRoundNumber') }}</span> <input type="checkbox" data-cy="live-tournament-custom-round-count-checkbox" [ngModel]="live.customRoundCount" (ngModelChange)="setCustomRoundCount($event)"></label>
            </div>
          </div>
        </mat-expansion-panel>
      </section>

      @if (live.stage === 'registration') {
        <section class="live-step-panel panel">
          <h2>{{ i18n.t('live.step1') }}</h2>
          <p class="muted">{{ registrationCopy(live) }}</p>
          <button mat-flat-button class="home-primary-action" type="button" data-cy="live-start-tournament-button" [disabled]="!canStart(live)" (click)="startTournament()">{{ i18n.t('live.startGenerateR1') }}</button>
          @if (!canStart(live)) { <p class="muted">{{ i18n.t('live.needTwoPlayers') }}</p> }
        </section>
      }

      @if (live.rounds.length) {
        <section class="stack live-round-progress">
          @for (round of orderedRounds(live); track round.id) {
            <mat-expansion-panel class="live-step-panel panel live-progress-section" data-cy="live-pairing-step" [attr.data-round]="round.roundNumber" [expanded]="stepExpanded(pairingStepKey(round.roundNumber), isActivePairingStep(live, round.roundNumber))" (opened)="setStepExpanded(pairingStepKey(round.roundNumber), true)" (closed)="setStepExpanded(pairingStepKey(round.roundNumber), false)">
              <mat-expansion-panel-header>
                <mat-panel-title class="live-panel-title"><h2 class="live-panel-heading">{{ i18n.t('live.pairing', { n: round.roundNumber }) }}</h2></mat-panel-title>
                <mat-panel-description>@if (live.stage === 'round' && round.roundNumber === live.currentRoundNumber) { <button mat-stroked-button class="secondary-action danger-ghost-action live-cancel-round-button" type="button" data-cy="live-cancel-round-button" [disabled]="!isActivePairingStep(live, round.roundNumber)" (click)="$event.stopPropagation(); cancelRound()" (keydown)="$event.stopPropagation()">{{ i18n.t('live.cancelRound') }}</button> } <span class="live-step-status" [class.live-step-status--active]="isActivePairingStep(live, round.roundNumber)" [class.live-step-status--readonly]="!isActivePairingStep(live, round.roundNumber)">@if (isActivePairingStep(live, round.roundNumber)) { <span class="status-dot" aria-hidden="true"></span> {{ i18n.t('live.activeStep') }} } @else { {{ i18n.t('live.readonlyStep') }} }</span></mat-panel-description>
              </mat-expansion-panel-header>
              <ng-container [ngTemplateOutlet]="roundTable" [ngTemplateOutletContext]="{ round: round, editable: isActivePairingStep(live, round.roundNumber) }" />
              @if (live.stage === 'round' && round.roundNumber === live.currentRoundNumber) {
                @if (allCurrentMatchesAreDraws(live)) { <p class="warning" role="status" data-cy="live-all-draws-warning">{{ i18n.t('live.allDrawsWarning') }}</p> }
                <div class="live-validate-actions"><button mat-flat-button class="home-primary-action create-action-button" type="button" data-cy="live-validate-round-button" [disabled]="!!validateRoundIssue(live) || !isActivePairingStep(live, round.roundNumber)" [attr.title]="validateRoundIssue(live)" (click)="validateRound()">{{ i18n.t('live.validateRound') }}</button>@if (validateRoundIssue(live); as issue) { <p class="muted live-validate-issue">{{ issue }}</p> }</div>
              }
            </mat-expansion-panel>

            @if (round.validated) {
              <mat-expansion-panel class="live-step-panel panel live-progress-section" data-cy="live-standing-step" [attr.data-round]="round.roundNumber" [expanded]="stepExpanded(standingStepKey(round.roundNumber), isActiveStandingStep(live, round.roundNumber))" (opened)="setStepExpanded(standingStepKey(round.roundNumber), true)" (closed)="setStepExpanded(standingStepKey(round.roundNumber), false)">
                <mat-expansion-panel-header>
                  <mat-panel-title class="live-panel-title"><h2 class="live-panel-heading">{{ i18n.t('live.standing', { n: round.roundNumber }) }}</h2></mat-panel-title>
                  <mat-panel-description>
                    @if (canEditStanding(live, round.roundNumber)) { <button mat-stroked-button class="secondary-action success-ghost-action" type="button" data-cy="live-standing-add-player-button" [disabled]="!isActiveStandingStep(live, round.roundNumber)" (click)="$event.stopPropagation(); addLatePlayer(round.roundNumber)" (keydown)="$event.stopPropagation()" [attr.aria-label]="i18n.t('live.addPlayerStandingsAria')"><mat-icon class="create-action-button__icon" aria-hidden="true">add</mat-icon><span>{{ i18n.t('live.addPlayer') }}</span></button> }
                    @if (checkpointFor(live, 'Standing ' + round.roundNumber); as checkpoint) { <button mat-stroked-button class="secondary-action" type="button" data-cy="live-restore-standing-button" [disabled]="!isActiveStandingStep(live, round.roundNumber)" (click)="$event.stopPropagation(); restoreCheckpoint(checkpoint)" (keydown)="$event.stopPropagation()">{{ i18n.t('live.restoreCheckpoint', { label: i18n.checkpointLabel(checkpoint.label) }) }}</button> }
                    @if (checkpointFor(live, 'Pairing ' + round.roundNumber); as pairingCheckpoint) { <button mat-stroked-button class="secondary-action danger-ghost-action" type="button" data-cy="live-cancel-standings-button" [disabled]="!isActiveStandingStep(live, round.roundNumber)" (click)="$event.stopPropagation(); restoreCheckpoint(pairingCheckpoint)" (keydown)="$event.stopPropagation()">{{ i18n.t('live.cancelStandings') }}</button> }
                    <span class="live-step-status" [class.live-step-status--active]="isActiveStandingStep(live, round.roundNumber)" [class.live-step-status--readonly]="!isActiveStandingStep(live, round.roundNumber)">@if (isActiveStandingStep(live, round.roundNumber)) { <span class="status-dot" aria-hidden="true"></span> {{ i18n.t('live.activeStep') }} } @else { {{ i18n.t('live.readonlyStep') }} }</span>
                  </mat-panel-description>
                </mat-expansion-panel-header>
                <ng-container [ngTemplateOutlet]="standingsTable" [ngTemplateOutletContext]="{ rows: standingRowsForRound(live, round.roundNumber), roundNumber: round.roundNumber, live: live }" />
                @if (live.currentRoundNumber === round.roundNumber && (live.stage === 'standings' || live.stage === 'completed')) {
                  <div class="live-standing-footer-actions">
                    <div class="actions live-next-actions">
                      @if (!finished(live)) { <button mat-flat-button class="create-action-button" type="button" data-cy="live-generate-next-round-button" (click)="generateNextRound()">{{ i18n.t('live.generateRound', { n: validatedRoundCount(live) + 1 }) }}</button> }
                      @else { <button mat-flat-button class="home-primary-action" type="button" data-cy="live-archive-tournament-button" [disabled]="finalizing()" (click)="finalize()">{{ finalizing() ? i18n.t('common.archiving') : i18n.t('live.archiveTournament') }}</button> }
                    </div>
                  </div>
                  @if (finished(live) && !live.leagueId) { <p class="warning" role="status">{{ i18n.t('live.noLeagueFinalizeWarn') }}</p> }
                }
              </mat-expansion-panel>
            }
          }
        </section>
      }

      <footer class="live-tournament-footer">
        <button mat-stroked-button class="secondary-action" type="button" data-cy="live-footer-back-button" (click)="returnToRunningTournaments()">{{ i18n.t('nav.backToRunningTournaments') }}</button>
        <button mat-stroked-button class="secondary-action live-scroll-top-button" type="button" data-cy="live-scroll-top-button" (click)="scrollToTop()" [attr.aria-label]="i18n.t('live.backToTop')">↑</button>
      </footer>

      <ng-template #standingsTable let-rows="rows" let-roundNumber="roundNumber" let-live="live">
        <div class="table-wrap">
          <table class="ranking-table live-standings-table" data-cy="live-standings-table">
            <thead><tr><th scope="col">{{ i18n.t('common.rank') }}</th><th scope="col">{{ i18n.t('common.player') }}</th><th scope="col">{{ i18n.t('common.pts') }}</th><th scope="col">{{ i18n.t('common.record') }}</th><th scope="col">{{ i18n.t('common.omw') }}</th><th scope="col">{{ i18n.t('common.gwr') }}</th><th scope="col">{{ i18n.t('common.ogw') }}</th>@if (canEditStanding(live, roundNumber)) { <th scope="col">{{ i18n.t('common.actions') }}</th> }</tr></thead>
            <tbody>@for (row of rows; track row.playerId) { <tr [class.is-dropped]="row.dropped"><td>{{ row.rank }}</td><td>@if (canEditStandingPlayerRecord(live, row)) { <input class="live-standing-player-name-input" data-cy="live-standing-player-name-input" [ngModel]="row.playerName" (ngModelChange)="updatePlayer(row.playerId, { name: $event })" [attr.aria-label]="'Player name for ' + row.playerName"> } @else { {{ row.playerName }} }</td><td>{{ row.points }}</td><td>@if (canEditStandingPlayerRecord(live, row)) { <div class="live-record-inputs live-standing-record-inputs" [attr.aria-label]="'Starting record for ' + row.playerName"><label><span>W</span><input data-cy="live-standing-player-wins-input" type="number" inputmode="numeric" step="1" min="0" [ngModel]="row.matchWins" (ngModelChange)="updateStandingPlayerRecord(row.playerId, 'initialWins', $event)" [attr.aria-label]="'Starting wins for ' + row.playerName"></label><label><span>D</span><input data-cy="live-standing-player-draws-input" type="number" inputmode="numeric" step="1" min="0" [ngModel]="row.matchDraws" (ngModelChange)="updateStandingPlayerRecord(row.playerId, 'initialDraws', $event)" [attr.aria-label]="'Starting draws for ' + row.playerName"></label><label><span>L</span><input data-cy="live-standing-player-losses-input" type="number" inputmode="numeric" step="1" min="0" [ngModel]="row.matchLosses" (ngModelChange)="updateStandingPlayerRecord(row.playerId, 'initialLosses', $event)" [attr.aria-label]="'Starting losses for ' + row.playerName"></label></div> } @else { <span class="record-win">{{ row.matchWins }}</span>-<span class="record-loss">{{ row.matchLosses }}</span>-<span class="record-draw">{{ row.matchDraws }}</span> @if (row.byes) { <span class="record-byes">{{ i18n.t('ranking.bye', { count: row.byes }) }}</span> } }</td><td>{{ formatPercentage(row.opponentsMatchWinPercentage) }}</td><td>{{ formatPercentage(row.gameWinPercentage) }}</td><td>{{ formatPercentage(row.opponentsGameWinPercentage) }}</td>@if (canEditStanding(live, roundNumber)) { <td><button mat-button color="warn" type="button" data-cy="live-standing-drop-player-button" [disabled]="row.dropped" [attr.aria-label]="standingPlayerActionLabel(live, row) + ' ' + row.playerName" (click)="confirmDropPlayer(row)">{{ standingPlayerActionLabel(live, row) }}</button></td> }</tr> }</tbody>
          </table>
        </div>
      </ng-template>

      <ng-template #roundTable let-round="round" let-editable="editable">
        <div class="live-round-card-grid round-entry-table-wrap" data-cy="live-round-panel" role="list" [attr.aria-label]="i18n.t('live.roundPairingsAria')">
          @for (item of round.entries; track item.entry.id) {
            @if (item.entry.kind === 'match') {
              <article class="live-round-card" role="listitem" [attr.data-cy]="live.stage === 'round' && round.roundNumber === live.currentRoundNumber ? 'live-match-row' : 'live-validated-match-row'" [attr.data-table]="item.entry.table" [class.is-invalid]="matchScoreIssue(item.entry)" [class.is-valid]="item.resultEntered && !matchScoreIssue(item.entry) && !isDrawMatch(item.entry)" [class.is-draw-warning]="!matchScoreIssue(item.entry) && isDrawMatch(item.entry)">
                <div class="live-round-card__table round-entry-table__number">{{ i18n.t('live.table', { n: item.entry.table }) }} @if (matchScoreIssue(item.entry)) { <span class="sr-only" [id]="'live-match-score-issue-' + item.entry.id">{{ matchScoreIssue(item.entry) }}</span> }</div>
                <span class="live-round-card__player live-round-card__player--one round-entry-table__player">{{ livePlayerName(live, item.entry.player1Name) }}</span>
                <div class="score-stepper live-round-card__score live-round-card__score--one"><button class="score-stepper__button score-stepper__button--decrement" data-cy="live-match-player1-decrement" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player1Score', -1)" [disabled]="!editable || !canAdjustMatchScore(item.entry, 'player1Score', -1)" [attr.aria-label]="i18n.t('live.decreaseScore', { name: livePlayerName(live, item.entry.player1Name) })">−</button><input data-cy="live-match-player1-score" type="number" inputmode="numeric" step="1" min="0" max="2" [ngModel]="item.entry.player1Score" (ngModelChange)="setMatchScore(round.id, item.entry, 'player1Score', $event)" [disabled]="!editable" [attr.aria-label]="i18n.t('live.scorePlayer1', { name: livePlayerName(live, item.entry.player1Name), table: item.entry.table })" [attr.aria-invalid]="matchScoreIssue(item.entry) ? 'true' : null" [attr.aria-describedby]="matchScoreIssue(item.entry) ? 'live-match-score-issue-' + item.entry.id : null"><button class="score-stepper__button score-stepper__button--increment" data-cy="live-match-player1-increment" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player1Score', 1)" [disabled]="!editable || !canAdjustMatchScore(item.entry, 'player1Score', 1)" [attr.aria-label]="i18n.t('live.increaseScore', { name: livePlayerName(live, item.entry.player1Name) })">+</button></div>
                <span class="live-round-card__versus" [attr.aria-label]="i18n.t('common.versus')">VS</span>
                <span class="live-round-card__player live-round-card__player--two round-entry-table__player">{{ livePlayerName(live, item.entry.player2Name) }}</span>
                <div class="score-stepper live-round-card__score live-round-card__score--two"><button class="score-stepper__button score-stepper__button--decrement" data-cy="live-match-player2-decrement" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player2Score', -1)" [disabled]="!editable || !canAdjustMatchScore(item.entry, 'player2Score', -1)" [attr.aria-label]="i18n.t('live.decreaseScore', { name: livePlayerName(live, item.entry.player2Name) })">−</button><input data-cy="live-match-player2-score" type="number" inputmode="numeric" step="1" min="0" max="2" [ngModel]="item.entry.player2Score" (ngModelChange)="setMatchScore(round.id, item.entry, 'player2Score', $event)" [disabled]="!editable" [attr.aria-label]="i18n.t('live.scorePlayer2', { name: livePlayerName(live, item.entry.player2Name), table: item.entry.table })" [attr.aria-invalid]="matchScoreIssue(item.entry) ? 'true' : null" [attr.aria-describedby]="matchScoreIssue(item.entry) ? 'live-match-score-issue-' + item.entry.id : null"><button class="score-stepper__button score-stepper__button--increment" data-cy="live-match-player2-increment" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player2Score', 1)" [disabled]="!editable || !canAdjustMatchScore(item.entry, 'player2Score', 1)" [attr.aria-label]="i18n.t('live.increaseScore', { name: livePlayerName(live, item.entry.player2Name) })">+</button></div>
              </article>
            } @else if (item.entry.kind === 'bye') {
              <article class="live-round-card live-bye-row" role="listitem" [attr.data-cy]="live.stage === 'round' && round.roundNumber === live.currentRoundNumber ? 'live-bye-row' : 'live-validated-bye-row'">
                <div class="live-round-card__table round-entry-table__number">{{ i18n.t('live.table', { n: item.entry.table }) }}</div>
                <div class="live-round-card__bye">{{ i18n.t('live.byeAutoWin', { name: livePlayerName(live, item.entry.playerName) }) }}</div>
              </article>
            }
          }
        </div>
      </ng-template>
    } @else { <mat-card class="panel"><mat-card-title>{{ i18n.t('live.notFoundTitle') }}</mat-card-title><mat-card-content><p>{{ i18n.t('live.notFoundBody') }}</p></mat-card-content></mat-card> }
  `
})
export class LiveTournamentRunnerComponent implements OnDestroy {
  readonly i18n = inject(I18nService);
  @ViewChild('liveTournamentNameInput') private liveTournamentNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('newPlayerNameInput') private newPlayerNameInput?: ElementRef<HTMLInputElement>;

  readonly loading = signal(true);
  readonly error = signal('');
  readonly tournament = signal<LiveTournamentDocument | null>(null);
  readonly leagues = signal<PersistedLeague[]>([]);
  newPlayerName = '';
  tournamentNameDraft = '';
  readonly registrationExpanded = signal(true);
  readonly manuallyExpandedSteps = signal<ReadonlySet<string>>(new Set<string>());
  readonly finalizing = signal(false);
  private saving = false;
  private pendingSave = false;
  private readonly openAdvancedSettingsListener = () => this.openAdvancedSettings();
  readonly unpaidPlayers = computed(() => this.tournament() ? unpaidActivePlayers(this.tournament()!) : []);
  readonly unpaidPlayerNames = computed(() => this.unpaidPlayers().map((player) => player.name).join(', '));
  readonly currentRound = computed(() => this.tournament() ? currentLiveRound(this.tournament()!) : null);
  readonly standings = computed(() => this.tournament() ? calculateLiveStandings(this.tournament()!) : []);

  constructor(private readonly liveRepo: LiveTournamentRepository, private readonly leagueRepo: LeagueRepository, private readonly route: ActivatedRoute, private readonly router: Router, private readonly dialog: MatDialog) {
    window.addEventListener('gones-open-live-tournament-advanced-settings', this.openAdvancedSettingsListener);
    void this.load();
  }

  ngOnDestroy(): void {
    window.removeEventListener('gones-open-live-tournament-advanced-settings', this.openAdvancedSettingsListener);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    let editTitleAfterLoad = false;
    try {
      this.leagues.set(await this.leagueRepo.listLeagues());
      const id = this.route.snapshot.paramMap.get('liveTournamentId') ?? 'new';
      editTitleAfterLoad = id === 'new' || this.shouldEditTitleFromNavigationState();
      if (id === 'new') {
        const created = this.withAutomaticRoundCount(await this.liveRepo.create());
        this.tournament.set(created);
        this.tournamentNameDraft = created.name;
        await this.router.navigate(['/live-tournaments', created.id], { replaceUrl: true, state: { editTitle: true } });
      } else {
        const existing = await this.liveRepo.get(id);
        const normalized = existing ? this.withAutomaticRoundCount(existing) : null;
        this.tournament.set(normalized);
        this.tournamentNameDraft = normalized?.name ?? '';
      }
    } catch (error) {
      logBoundaryError('live-tournament.load', error);
      this.error.set(this.i18n.t('live.loadFailed'));
    } finally {
      this.loading.set(false);
      if (editTitleAfterLoad) this.focusTournamentNameInput();
    }
  }

  patch(patch: Partial<LiveTournamentDocument>): void { this.update((live) => this.withAutomaticRoundCount({ ...live, ...patch })); }
  stringValue(value: unknown, fallback = ''): string { return String(value || fallback); }
  numberValue(value: unknown): number { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; }
  setRoundCount(value: unknown): void { this.patch({ roundCount: this.numberValue(value), customRoundCount: true }); }
  setCustomRoundCount(customRoundCount: boolean): void { this.patch({ customRoundCount, roundCount: customRoundCount ? this.displayRoundCount(this.tournament()!) : autoLiveSwissRoundCount(this.tournament()!) }); }
  displayRoundCount(live: LiveTournamentDocument): number { return live.customRoundCount ? live.roundCount : autoLiveSwissRoundCount(live); }
  activePlayerCount(live: LiveTournamentDocument): number { return activeLivePlayers(live).length; }
  notEnoughPlayers(live: LiveTournamentDocument): boolean { return live.stage === 'registration' && this.activePlayerCount(live) < 2; }
  showByeWarning(live: LiveTournamentDocument): boolean { const count = this.activePlayerCount(live); return live.stage === 'registration' && count > 2 && count % 2 === 1; }
  canStart(live: LiveTournamentDocument): boolean { return canStartLiveTournament(this.withAutomaticRoundCount(live)); }
  currentRoundComplete(live: LiveTournamentDocument): boolean { return currentRoundComplete(live); }
  finished(live: LiveTournamentDocument): boolean { return liveTournamentFinished(live); }
  validatedRoundCount(live: LiveTournamentDocument): number { return live.rounds.filter((round) => round.validated).length; }
  orderedRounds(live: LiveTournamentDocument): LiveTournamentRoundDocument[] { return [...live.rounds].sort((left, right) => left.roundNumber - right.roundNumber); }
  standingRowsForRound(live: LiveTournamentDocument, roundNumber: number): LiveStandingRow[] { return calculateLiveStandingsThroughRound(live, roundNumber); }
  checkpointFor(live: LiveTournamentDocument, label: string): LiveTournamentCheckpointDocument | null { return [...live.checkpoints].reverse().find((checkpoint) => checkpoint.label === label) ?? null; }
  stageLabel(live: LiveTournamentDocument): string { return live.stage === 'registration' ? this.i18n.t('live.stageRegistration') : live.stage === 'round' ? this.i18n.t('live.stageRound', { n: live.currentRoundNumber }) : live.stage === 'standings' ? this.i18n.t('live.stageBetween') : this.i18n.t('live.stageCompleted'); }
  registrationCopy(live: LiveTournamentDocument): string { return live.paidTrackingEnabled ? this.i18n.t('live.regCopyPaid') : this.i18n.t('live.regCopyUnpaidOff'); }
  playerStatus(row: LiveStandingRow, live: LiveTournamentDocument): string { return row.dropped ? this.i18n.t('live.dropped') : live.paidTrackingEnabled ? (row.paid ? this.i18n.t('live.paid') : this.i18n.t('live.unpaid')) : this.i18n.t('common.active'); }
  standingPlayerActionLabel(live: LiveTournamentDocument, row: LiveStandingRow): string { return this.canDeleteStandingPlayer(live, row) ? this.i18n.t('common.remove') : this.i18n.t('live.drop'); }
  canEditStanding(live: LiveTournamentDocument, roundNumber: number): boolean { return this.isActiveStandingStep(live, roundNumber); }
  isActivePairingStep(live: LiveTournamentDocument, roundNumber: number): boolean { return live.stage === 'round' && live.currentRoundNumber === roundNumber; }
  isActiveStandingStep(live: LiveTournamentDocument, roundNumber: number): boolean { return (live.stage === 'standings' || live.stage === 'completed') && live.currentRoundNumber === roundNumber; }
  pairingStepKey(roundNumber: number): string { return `pairing-${roundNumber}`; }
  standingStepKey(roundNumber: number): string { return `standing-${roundNumber}`; }
  stepExpanded(key: string, active: boolean): boolean { return active || this.manuallyExpandedSteps().has(key); }
  setStepExpanded(key: string, expanded: boolean): void {
    const next = new Set(this.manuallyExpandedSteps());
    if (expanded) next.add(key);
    else next.delete(key);
    this.manuallyExpandedSteps.set(next);
  }
  scrollToTop(): void { window.scrollTo({ top: 0, behavior: 'smooth' }); }
  returnToRunningTournaments(): void { void this.router.navigate(['/live-tournaments']); }
  matchScoreIssue(entry: RoundEntry): string | null { return liveMatchScoreIssue(entry); }
  isDrawMatch(entry: RoundEntry): boolean { return entry.kind === 'match' && entry.player1Score === entry.player2Score; }
  formatPercentage(value: number): string { return `${Math.round(value * 100)}%`; }
  livePlayerName(live: LiveTournamentDocument, storedName: string): string {
    return this.findPlayerByStoredName(live, storedName)?.name || storedName;
  }
  canAdjustMatchScore(entry: Extract<RoundEntry, { kind: 'match' }>, field: 'player1Score' | 'player2Score', delta: -1 | 1): boolean {
    const nextScore = entry[field] + delta;
    const opponentField = field === 'player1Score' ? 'player2Score' : 'player1Score';
    return Number.isInteger(nextScore) && nextScore >= 0 && nextScore <= 2 && !(nextScore === 2 && entry[opponentField] === 2);
  }
  allCurrentMatchesAreDraws(live: LiveTournamentDocument): boolean {
    const round = currentLiveRound(live);
    const matches = round?.entries.filter((item) => item.entry.kind === 'match') ?? [];
    return live.stage === 'round' && matches.length > 0 && matches.every((item) => item.entry.kind === 'match' && !liveMatchScoreIssue(item.entry) && item.entry.player1Score === item.entry.player2Score);
  }

  defaultDrawTables(live: LiveTournamentDocument): string[] {
    const round = currentLiveRound(live);
    if (live.stage !== 'round' || !round) return [];
    return round.entries.flatMap((item) => item.entry.kind === 'match' && !item.resultEntered && !liveMatchScoreIssue(item.entry) && item.entry.player1Score === 0 && item.entry.player2Score === 0 ? [item.entry.table] : []);
  }
  validateRoundIssue(live: LiveTournamentDocument): string | null {
    const invalidTables = this.invalidCurrentRoundTables(live);
    if (invalidTables.length) return this.i18n.t('live.invalidResultTables', { tables: invalidTables.map((table) => this.i18n.t('live.tableWord', { n: table })).join(', ') });
    return currentRoundComplete(live) ? null : this.i18n.t('live.enterAllResults');
  }

  saveTitleEdit(): void {
    const live = this.tournament();
    if (!live || this.finalizing()) return;
    const name = String(this.tournamentNameDraft || live.name || this.i18n.t('live.defaultLiveName')).trim() || this.i18n.t('live.defaultLiveName');
    this.tournamentNameDraft = name;
    if (name !== live.name) this.patch({ name });
  }

  canSubmitNewPlayer(live: LiveTournamentDocument): boolean {
    return live.stage === 'registration' && Boolean(trimPlayerName(this.newPlayerName));
  }

  addPlayer(): void {
    const live = this.tournament();
    const name = trimPlayerName(this.newPlayerName);
    if (!live || live.stage !== 'registration' || !name) {
      this.focusNewPlayerNameInput();
      return;
    }
    if (this.playerNameExists(live, name)) {
      this.error.set(this.i18n.t('live.playerAlreadyRegistered'));
      this.focusNewPlayerNameInput();
      return;
    }
    this.error.set('');
    this.newPlayerName = '';
    const player = createLiveTournamentPlayer({ name });
    this.update((current) => this.withAutomaticRoundCount({ ...current, players: [player, ...current.players] }));
    this.focusNewPlayerNameInput();
  }

  canEditStandingPlayerRecord(live: LiveTournamentDocument, row: LiveStandingRow): boolean {
    return this.canEditStanding(live, live.currentRoundNumber) && this.canDeleteStandingPlayer(live, row);
  }

  addLatePlayer(roundNumber: number): void {
    const live = this.tournament();
    if (!live || !this.canEditStanding(live, roundNumber)) return;
    const name = this.nextLatePlayerName(live);
    this.error.set('');
    this.update((current) => ({
      ...current,
      players: [...current.players, createLiveTournamentPlayer({ name })]
    }));
  }

  updateStandingPlayerRecord(playerId: string, field: 'initialWins' | 'initialDraws' | 'initialLosses', value: unknown): void {
    this.updatePlayer(playerId, { [field]: this.numberValue(value) });
  }

  async confirmDropPlayer(row: LiveStandingRow): Promise<void> {
    if (row.dropped) return;
    const live = this.tournament();
    const deleteInsteadOfDrop = live ? this.canDeleteStandingPlayer(live, row) : false;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: deleteInsteadOfDrop ? this.i18n.t('live.removePlayerTitle') : this.i18n.t('live.dropPlayerTitle'),
        message: deleteInsteadOfDrop
          ? this.i18n.t('live.removeStandingMessage', { name: row.playerName })
          : this.i18n.t('live.dropStandingMessage', { name: row.playerName }),
        confirmLabel: deleteInsteadOfDrop ? this.i18n.t('live.removePlayerTitle') : this.i18n.t('live.dropPlayerTitle'),
        destructive: true
      }
    }).afterClosed());
    if (!confirmed) return;
    if (deleteInsteadOfDrop) {
      this.removeStandingPlayer(row.playerId);
      return;
    }
    this.updatePlayer(row.playerId, { dropped: true });
  }

  updatePlayer(playerId: string, patch: Partial<LiveTournamentPlayerDocument>): void {
    this.update((live) => {
      const nextName = patch.name === undefined ? null : trimPlayerName(patch.name);
      if (nextName && live.players.some((player) => player.id !== playerId && trimPlayerName(player.name).toLowerCase() === nextName.toLowerCase())) {
        this.error.set(this.i18n.t('live.namesMustBeUnique'));
        return live;
      }
      const currentPlayer = live.players.find((player) => player.id === playerId);
      const oldName = currentPlayer?.name ?? '';
      const updatedPlayers = live.players.map((player) => player.id === playerId ? { ...player, ...patch, name: nextName === null ? player.name : nextName } : player);
      const updatedRounds = nextName === null || nextName === oldName ? live.rounds : this.renameRoundEntries(live.rounds, oldName, nextName);
      return this.withAutomaticRoundCount({ ...live, players: updatedPlayers, rounds: updatedRounds });
    });
  }

  async confirmRemovePlayer(playerId: string): Promise<void> {
    const live = this.tournament();
    const player = live?.players.find((item) => item.id === playerId);
    if (!live || live.stage !== 'registration' || !player) return;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.i18n.t('live.removePlayerTitle'),
        message: this.i18n.t('live.removeRegistrationMessage', { name: player.name || this.i18n.t('live.thisPlayer') }),
        confirmLabel: this.i18n.t('live.removePlayerTitle'),
        destructive: true
      }
    }).afterClosed());
    if (!confirmed) return;
    this.removePlayer(playerId);
  }

  private removePlayer(playerId: string): void {
    this.update((live) => live.stage === 'registration'
      ? this.withAutomaticRoundCount({ ...live, players: live.players.filter((player) => player.id !== playerId) })
      : live);
  }

  async startTournament(): Promise<void> {
    const live = this.tournament();
    if (!live || !(await this.confirmWarnings(this.i18n.t('live.startTournamentQ'), this.startWarnings(live), this.i18n.t('live.startTournament')))) return;
    this.update((current) => generateNextSwissRound(this.withAutomaticRoundCount(current)));
  }

  async generateNextRound(): Promise<void> {
    const live = this.tournament();
    if (!live || !(await this.confirmWarnings(this.i18n.t('live.generateNextQ'), this.nextRoundWarnings(live), this.i18n.t('live.generateRoundConfirm')))) return;
    this.update((current) => generateNextSwissRound(this.withAutomaticRoundCount(current)));
  }

  cancelRound(): void { this.update((live) => live.stage === 'round' ? cancelCurrentSwissRound(live) : live); }

  async validateRound(): Promise<void> {
    const live = this.tournament();
    if (!live || live.stage !== 'round' || this.validateRoundIssue(live)) return;
    if (!(await this.confirmWarnings(this.i18n.t('live.validateRoundQ'), this.validateRoundWarnings(live), this.i18n.t('live.validateRoundConfirm')))) return;
    this.update((current) => current.stage === 'round' ? validateCurrentSwissRound(current) : current);
  }
  restoreCheckpoint(checkpoint: LiveTournamentCheckpointDocument): void {
    this.update((live) => this.canRestoreCheckpoint(live, checkpoint) ? restoreLiveTournamentCheckpoint(live, checkpoint.id) : live);
  }

  adjustMatchScore(roundId: string, entry: Extract<RoundEntry, { kind: 'match' }>, field: 'player1Score' | 'player2Score', delta: -1 | 1): void {
    if (!this.canAdjustMatchScore(entry, field, delta)) return;
    this.setMatchScore(roundId, entry, field, entry[field] + delta);
  }

  setMatchScore(roundId: string, entry: Extract<RoundEntry, { kind: 'match' }>, field: 'player1Score' | 'player2Score', value: unknown): void {
    const score = this.numberValue(value);
    this.update((live) => {
      if (live.stage !== 'round') return live;
      const editedRound = live.rounds.find((round) => round.id === roundId);
      if (!editedRound || !this.isActivePairingStep(live, editedRound.roundNumber)) return live;
      const rounds = live.rounds
        .filter((round) => !editedRound || round.roundNumber <= editedRound.roundNumber)
        .map((round) => round.id !== roundId ? round : {
          ...round,
          entries: round.entries.map((item) => item.entry.id !== entry.id || item.entry.kind !== 'match' ? item : { ...item, resultEntered: true, entry: { ...item.entry, [field]: score } })
        });
      return editedRound && live.rounds.some((round) => round.roundNumber > editedRound.roundNumber)
        ? { ...live, stage: 'standings', currentRoundNumber: editedRound.roundNumber, rounds, checkpoints: this.pruneCheckpointsAfterEditedRound(live, editedRound.roundNumber) }
        : { ...live, rounds };
    });
  }

  async finalize(): Promise<void> {
    const live = this.tournament();
    if (!live || this.finalizing()) return;
    if (!(await this.confirmWarnings(this.i18n.t('live.archiveQ'), this.finalizeWarnings(live), this.i18n.t('live.archiveTournament')))) return;
    this.finalizing.set(true);
    try {
      await this.waitForSaveIdle();
      const latestLive = this.tournament();
      if (!latestLive) return;
      const targetLeagueId = latestLive.leagueId || PLACEHOLDER_LEAGUE_ID;
      await this.leagueRepo.ensurePlaceholderLeague();
      const stableLive = latestLive.finalizedTournamentId ? { ...latestLive, leagueId: targetLeagueId } : await this.liveRepo.save({ ...latestLive, leagueId: targetLeagueId, finalizedTournamentId: crypto.randomUUID() });
      this.tournament.set(stableLive);
      const league = await this.leagueRepo.getLeague(stableLive.leagueId);
      if (!league) { this.error.set(this.i18n.t('live.leagueNotFound')); return; }
      const tournament = finalizeLiveTournament(stableLive);
      const nextTournament: TournamentDocument = { ...tournament, leagueId: league.id };
      const nextLeague = { ...league, tournaments: league.tournaments.some((item) => item.id === nextTournament.id) ? league.tournaments.map((item) => item.id === nextTournament.id ? nextTournament : item) : [...league.tournaments, nextTournament] };
      const saved = await this.leagueRepo.saveLeague(nextLeague, league.documentVersion);
      const savedTournament = saved.tournaments.find((item) => item.id === nextTournament.id) ?? nextTournament;
      await this.liveRepo.save({ ...stableLive, stage: 'completed', finalizedTournamentId: savedTournament.id });
      await this.deleteFinalizedLiveTournament(stableLive.id);
      await this.router.navigate(['/leagues', saved.id, 'tournaments', savedTournament.id]);
    } catch (error) {
      logBoundaryError('live-tournament.finalize', error, { liveTournamentId: live.id, leagueId: live.leagueId });
      this.error.set(this.i18n.t('live.finalizeFailed'));
    } finally {
      this.finalizing.set(false);
    }
  }

  saveDraft(): void { void this.persist(); }

  private startWarnings(live: LiveTournamentDocument): string[] {
    const warnings: string[] = [];
    const unpaid = unpaidActivePlayers(live);
    if (live.paidTrackingEnabled && unpaid.length) warnings.push(this.i18n.t('live.warnUnpaid', { names: unpaid.map((player) => player.name).join(', ') }));
    if (this.showByeWarning(live)) warnings.push(this.i18n.t('live.warnBye'));
    return warnings;
  }

  private validateRoundWarnings(live: LiveTournamentDocument): string[] {
    if (this.allCurrentMatchesAreDraws(live)) return [this.i18n.t('live.allDrawsWarning')];
    const defaultDrawTables = this.defaultDrawTables(live);
    return defaultDrawTables.length ? [this.i18n.t('live.defaultDrawTables', { tables: defaultDrawTables.map((table) => this.i18n.t('live.tableWord', { n: table })).join(', ') })] : [];
  }

  private nextRoundWarnings(live: LiveTournamentDocument): string[] {
    const unpaid = unpaidActivePlayers(live);
    return live.paidTrackingEnabled && unpaid.length ? [this.i18n.t('live.warnUnpaid', { names: unpaid.map((player) => player.name).join(', ') })] : [];
  }

  private finalizeWarnings(live: LiveTournamentDocument): string[] {
    const warnings: string[] = [];
    if (!live.leagueId) warnings.push(this.i18n.t('live.noLeagueFinalizeWarn'));
    warnings.push(...this.nextRoundWarnings(live));
    return warnings;
  }

  private async confirmWarnings(title: string, warnings: string[], confirmLabel: string): Promise<boolean> {
    if (!warnings.length) return true;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: { title, message: warnings.join('\n\n'), confirmLabel, destructive: false }
    }).afterClosed());
    return Boolean(confirmed);
  }

  openAdvancedSettings(): void {
    const live = this.tournament();
    if (!live) return;
    this.dialog.open<LiveTournamentAdvancedSettingsDialogComponent, LiveTournamentAdvancedSettingsDialogData, LiveTournamentAdvancedSettingsDraft>(LiveTournamentAdvancedSettingsDialogComponent, {
      width: 'min(92vw, 42rem)',
      data: { live, leagues: this.leagues() }
    }).afterClosed().subscribe((result) => {
      if (!result) return;
      this.update((current) => this.withAutomaticRoundCount({ ...current, ...result }));
    });
  }

  private async deleteFinalizedLiveTournament(liveTournamentId: string): Promise<void> {
    try {
      await this.liveRepo.delete(liveTournamentId);
    } catch (error) {
      logBoundaryError('live-tournament.finalize.cleanup', error, { liveTournamentId });
    }
  }

  private canRestoreCheckpoint(live: LiveTournamentDocument, checkpoint: LiveTournamentCheckpointDocument): boolean {
    const match = /^(Pairing|Standing) (\d+)$/.exec(checkpoint.label);
    if (!match) return false;
    const roundNumber = Number(match[2]);
    return match[1] === 'Pairing' ? this.isActivePairingStep(live, roundNumber) || this.isActiveStandingStep(live, roundNumber) : this.isActiveStandingStep(live, roundNumber);
  }

  private activeStepKey(live: LiveTournamentDocument): string {
    if (live.stage === 'round') return this.pairingStepKey(live.currentRoundNumber);
    if (live.stage === 'standings' || live.stage === 'completed') return this.standingStepKey(live.currentRoundNumber);
    return 'registration';
  }

  private playerNameExists(live: LiveTournamentDocument, name: string): boolean {
    return live.players.some((player) => trimPlayerName(player.name).toLowerCase() === name.toLowerCase());
  }

  private nextLatePlayerName(live: LiveTournamentDocument): string {
    let index = live.players.length + 1;
    let name = this.i18n.t('live.newPlayerN', { n: index });
    while (this.playerNameExists(live, name)) name = this.i18n.t('live.newPlayerN', { n: ++index });
    return name;
  }

  private findPlayerByStoredName(live: LiveTournamentDocument, storedName: string): LiveTournamentPlayerDocument | null {
    const normalizedName = trimPlayerName(storedName).toLowerCase();
    return live.players.find((player) => trimPlayerName(player.name).toLowerCase() === normalizedName) ?? null;
  }

  private renameRoundEntries(rounds: LiveTournamentRoundDocument[], oldName: string, newName: string): LiveTournamentRoundDocument[] {
    const normalizedOldName = trimPlayerName(oldName);
    if (!normalizedOldName) return rounds;
    return rounds.map((round) => ({
      ...round,
      entries: round.entries.map((item) => {
        const entry = item.entry;
        if (entry.kind === 'bye' && trimPlayerName(entry.playerName) === normalizedOldName) return { ...item, entry: { ...entry, playerName: newName } };
        if (entry.kind === 'match') {
          return {
            ...item,
            entry: {
              ...entry,
              player1Name: trimPlayerName(entry.player1Name) === normalizedOldName ? newName : entry.player1Name,
              player2Name: trimPlayerName(entry.player2Name) === normalizedOldName ? newName : entry.player2Name
            }
          };
        }
        return item;
      })
    }));
  }

  private pruneCheckpointsAfterEditedRound(live: LiveTournamentDocument, roundNumber: number): LiveTournamentCheckpointDocument[] {
    return live.checkpoints.filter((checkpoint) => {
      const match = /^(Pairing|Standing) (\d+)$/.exec(checkpoint.label);
      if (!match) return true;
      const checkpointRoundNumber = Number(match[2]);
      return checkpointRoundNumber < roundNumber || (match[1] === 'Pairing' && checkpointRoundNumber === roundNumber);
    });
  }

  private update(updater: (live: LiveTournamentDocument) => LiveTournamentDocument): void {
    const live = this.tournament();
    if (!live || this.finalizing()) return;
    const previousActiveStepKey = this.activeStepKey(live);
    const updated = updater(live);
    if (this.activeStepKey(updated) !== previousActiveStepKey) this.manuallyExpandedSteps.set(new Set<string>());
    this.tournament.set(updated);
    this.tournamentNameDraft = updated.name;
    window.dispatchEvent(new CustomEvent('gones-live-tournament-updated', { detail: { liveTournamentId: updated.id, name: updated.name } }));
    void this.persist();
  }

  private withAutomaticRoundCount(live: LiveTournamentDocument): LiveTournamentDocument {
    if (live.customRoundCount || live.stage !== 'registration') return live;
    return { ...live, roundCount: autoLiveSwissRoundCount(live) };
  }

  private focusTournamentNameInput(): void {
    setTimeout(() => {
      this.liveTournamentNameInput?.nativeElement.focus();
      this.liveTournamentNameInput?.nativeElement.select();
    });
  }
  private shouldEditTitleFromNavigationState(): boolean {
    return Boolean(this.router.getCurrentNavigation()?.extras.state?.['editTitle'] || history.state?.['editTitle']);
  }
  private focusNewPlayerNameInput(): void { setTimeout(() => this.newPlayerNameInput?.nativeElement.focus()); }

  private canDeleteStandingPlayer(live: LiveTournamentDocument, row: LiveStandingRow): boolean {
    return live.stage === 'standings' && !this.playerHasRoundEntry(live, row.playerName);
  }

  private removeStandingPlayer(playerId: string): void {
    this.update((live) => live.stage === 'standings' ? { ...live, players: live.players.filter((player) => player.id !== playerId) } : live);
  }

  private playerHasRoundEntry(live: LiveTournamentDocument, playerName: string): boolean {
    const normalizedName = trimPlayerName(playerName);
    return live.rounds.some((round) => round.entries.some(({ entry }) => {
      if (entry.kind === 'bye') return trimPlayerName(entry.playerName) === normalizedName;
      if (entry.kind === 'match') return trimPlayerName(entry.player1Name) === normalizedName || trimPlayerName(entry.player2Name) === normalizedName;
      return false;
    }));
  }

  private invalidCurrentRoundTables(live: LiveTournamentDocument): string[] {
    const round = currentLiveRound(live);
    if (!round) return [];
    return round.entries.flatMap((item) => item.entry.kind === 'match' && liveMatchScoreIssue(item.entry) ? [item.entry.table] : []);
  }

  private async waitForSaveIdle(): Promise<void> {
    while (this.saving || this.pendingSave) await new Promise((resolve) => setTimeout(resolve, 25));
  }

  private async persist(): Promise<void> {
    if (this.saving) { this.pendingSave = true; return; }
    const live = this.tournament();
    if (!live) return;
    this.saving = true;
    this.pendingSave = false;
    try {
      const saved = await this.liveRepo.save(live);
      const latest = this.tournament();
      this.tournament.set(latest && latest.id === saved.id ? { ...latest, documentVersion: saved.documentVersion, updatedAt: saved.updatedAt } : saved);
      window.dispatchEvent(new CustomEvent('gones-live-tournament-updated', { detail: { liveTournamentId: saved.id, name: saved.name } }));
    }
    catch (error) { logBoundaryError('live-tournament.save', error, { liveTournamentId: live.id }); this.error.set(this.i18n.t('live.saveFailed')); }
    finally {
      this.saving = false;
      if (this.pendingSave) void this.persist();
    }
  }
}

interface LiveTournamentAdvancedSettingsDialogData {
  live: LiveTournamentDocument;
  leagues: PersistedLeague[];
}

type LiveTournamentAdvancedSettingsDraft = Pick<LiveTournamentDocument, 'leagueId' | 'paidTrackingEnabled' | 'players'>;

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatSelectModule, DeckArchetypeInputComponent],
  template: `
    <h2 mat-dialog-title>{{ i18n.t('live.advancedTitle') }}</h2>
    <mat-dialog-content class="live-advanced-settings-dialog">
      <mat-checkbox data-cy="live-tournament-paid-tracking-checkbox" [(ngModel)]="draft.paidTrackingEnabled">{{ i18n.t('live.trackPaid') }}</mat-checkbox>
      <p class="muted">{{ i18n.t('live.trackPaidHelp') }}</p>
      <mat-expansion-panel class="round-panel live-player-archetype-panel" [expanded]="false">
        <mat-expansion-panel-header>
          <mat-panel-title class="round-panel-title">{{ i18n.t('live.deckArchetypes') }}</mat-panel-title>
          <mat-panel-description>{{ i18n.plural(namedPlayers().length, 'live.playerCountOne', 'live.playerCountMany') }}</mat-panel-description>
        </mat-expansion-panel-header>
        @if (namedPlayers().length) {
          <div class="player-archetype-list live-player-archetype-list" role="group" [attr.aria-label]="i18n.t('live.playerArchetypesAria')">
            <div class="player-archetype-list__header" aria-hidden="true">
              <span>{{ i18n.t('common.player') }}</span>
              <span>{{ i18n.t('live.deckArchetypeCol') }}</span>
            </div>
            @for (player of namedPlayers(); track player.id; let rowIndex = $index) {
              <div class="player-archetype-row" data-cy="live-player-archetype-row">
                <label class="player-archetype-row__player" [attr.for]="'live-player-archetype-' + rowIndex"><span class="sr-only">Deck archetype for </span>{{ player.name }}</label>
                <gones-deck-archetype-input [inputId]="'live-player-archetype-' + rowIndex" [label]="i18n.t('live.deckArchetypeFor', { name: player.name })" [value]="player.archetype" (valueChange)="setPlayerArchetype(player.id, $event)" />
              </div>
            }
          </div>
        } @else { <p class="empty">{{ i18n.t('live.addPlayersBeforeArchetypes') }}</p> }
      </mat-expansion-panel>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="close()">{{ i18n.t('common.cancel') }}</button>
      <button mat-flat-button class="home-primary-action" type="button" (click)="apply()">{{ i18n.t('live.applySettings') }}</button>
    </mat-dialog-actions>
  `
})
export class LiveTournamentAdvancedSettingsDialogComponent {
  readonly i18n = inject(I18nService);
  readonly data = inject<LiveTournamentAdvancedSettingsDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<LiveTournamentAdvancedSettingsDialogComponent, LiveTournamentAdvancedSettingsDraft>);
  readonly draft: LiveTournamentAdvancedSettingsDraft = {
    leagueId: this.data.live.leagueId,
    paidTrackingEnabled: this.data.live.paidTrackingEnabled,
    players: this.data.live.players.map((player) => ({ ...player }))
  };

  namedPlayers(): LiveTournamentPlayerDocument[] {
    return this.draft.players.filter((player) => trimPlayerName(player.name));
  }

  setPlayerArchetype(playerId: string, archetype: string): void {
    this.draft.players = this.draft.players.map((player) => player.id === playerId ? { ...player, archetype } : player);
  }

  close(): void { this.dialogRef.close(); }

  apply(): void {
    this.dialogRef.close({
      leagueId: String(this.draft.leagueId ?? ''),
      paidTrackingEnabled: Boolean(this.draft.paidTrackingEnabled),
      players: this.draft.players.map((player) => ({ ...player, archetype: String(player.archetype ?? '').trim() }))
    });
  }
}
