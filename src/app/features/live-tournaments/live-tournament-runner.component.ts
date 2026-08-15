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
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { AuthService } from '../../auth/auth.service';
import { LIVE_BACKEND_MODE } from '../../backend/application-backend';
import { isAnyPlaceholderLeagueId, isLocalLeagueId } from '../../data/league-archive-origin';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { canManageLive, liveCommandError, liveDeleteOutcome } from '../../data/live-command-ux';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { activeLivePlayers, autoLiveSwissRoundCount, canStartLiveTournament, calculateLiveStandings, calculateLiveStandingsThroughRound, currentLiveRound, currentRoundComplete, finalizeLiveTournament as finalizeLiveTournamentDocument, liveMatchScoreIssue, liveTournamentFinished, LiveStandingRow, LiveTournamentCheckpointDocument, LiveTournamentDocument, LiveTournamentPlayerDocument, LiveTournamentRoundDocument, unpaidActivePlayers } from '../../domain/live-tournament';
import { PersistedLeague, PLACEHOLDER_LEAGUE_ID, RoundEntry, trimPlayerName } from '../../domain/models';
import { collectKnownPlayerNames, suggestPlayerNames } from '../../domain/player-stats';
import { logBoundaryError } from '../../shared/app-logger';
import { OnlineStatusService } from '../../shared/online-status.service';
import { saveJsonFile } from '../../shared/save-json-file';
import { BackButtonComponent } from '../../shared/back-button.component';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { DeckArchetypeInputComponent } from '../../shared/deck-archetype-input.component';
import { fuzzyMatchIndices } from '../../shared/deck-archetype-settings.service';
import { I18nService } from '../../i18n/i18n.service';
import { canUsePowerMutation, PowerUserSettingsService } from '../../shared/power-user-settings.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatAutocompleteModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatDialogModule, MatExpansionModule, MatFormFieldModule, MatIconModule, MatInputModule, MatMenuModule, MatProgressSpinnerModule, MatSelectModule, BackButtonComponent],
  template: `
    <gones-back-button data-cy="live-runner-back-top" [link]="['/live-tournaments']" [label]="i18n.t('nav.backToRunningTournaments')" position="top" />
    @if (error()) { <p class="error" role="alert" data-cy="live-runner-error">{{ error() }}</p> }
    @if (liveRepo.detailStale()) { <p class="warning" role="status" data-cy="live-runner-cached-stale">{{ i18n.t('offline.cachedServerRead') }}</p> }
    @if (stale()) { <button mat-stroked-button class="secondary-action" type="button" data-cy="live-reload" (click)="load()">{{ i18n.t('live.reloadLatest') }}</button> }
    @if (readOnly() && tournament()) { <p class="muted" data-cy="live-read-only">{{ i18n.t('live.readOnly') }}</p> }
    @if (localMode && tournament()) { <p class="muted" role="status" data-cy="live-local-mode-notice">{{ i18n.t('live.localModeNotice') }}</p> }
    @if (localFinalized()) {
      <section class="panel" role="status" data-cy="live-local-finalize-notice">
        <h2 data-cy="live-local-finalize-title">{{ i18n.t('live.localFinalizeTitle') }}</h2>
        <p data-cy="live-local-finalize-body">{{ i18n.t('live.localFinalizeBody') }}</p>
      </section>
    }
    @if (loading()) { <mat-spinner diameter="40" data-cy="live-runner-spinner" /> }
    @else if (tournament(); as live) {
      <section class="page-heading live-tournament-title-heading" data-cy="live-runner-heading">
        <h1 data-cy="live-runner-title">{{ live.name || i18n.t('live.defaultLiveName') }}</h1>
        @if (!readOnly()) {
          <div class="live-tournament-meta-fields" data-cy="live-runner-meta-fields">
            <mat-form-field appearance="outline" class="title-field" data-cy="live-runner-name-field"><mat-label data-cy="live-runner-name-label">{{ i18n.t('live.tournamentName') }}</mat-label><input #liveTournamentNameInput data-cy="live-tournament-name-input" matInput [(ngModel)]="tournamentNameDraft" (blur)="saveTitleEdit()" (keydown.enter)="$event.preventDefault(); saveTitleEdit()" [disabled]="finalizing()"></mat-form-field>
            <mat-form-field appearance="outline" class="live-tournament-date-field" data-cy="live-runner-date-field"><mat-label data-cy="live-runner-date-label">{{ i18n.t('live.date') }}</mat-label><input matInput data-cy="live-tournament-date-input" type="date" [ngModel]="live.tournamentDate" (ngModelChange)="patch({ tournamentDate: stringValue($event, live.tournamentDate) })" [disabled]="finalizing()"></mat-form-field>
            @if (!localMode) { <mat-form-field appearance="outline" class="live-tournament-league-field" data-cy="live-runner-league-field"><mat-label data-cy="live-runner-league-label">{{ i18n.t('live.leagueFinalize') }}</mat-label><mat-select data-cy="live-tournament-league-select" [ngModel]="leagueSelectValue(live.leagueId)" (ngModelChange)="patch({ leagueId: stringValue($event, '') })" [disabled]="finalizing()"><mat-option value="" data-cy="live-runner-league-option-unassigned">{{ i18n.t('live.unassigned') }}</mat-option>@for (league of assignableLeagues(); track league.id) { <mat-option [value]="league.id" [attr.data-cy]="'live-runner-league-option-' + league.id">{{ league.name }}</mat-option> }</mat-select></mat-form-field> }
          </div>
        } @else {
          <dl class="live-tournament-meta-fields" data-cy="live-runner-meta-read-only">
            <div data-cy="live-runner-meta-date-read-only"><dt data-cy="live-runner-meta-date-label-read-only">{{ i18n.t('live.date') }}</dt><dd data-cy="live-runner-meta-date-value-read-only">{{ i18n.formatDate(live.tournamentDate, { dateStyle: 'medium' }) }}</dd></div>
            <div data-cy="live-runner-meta-round-count-read-only"><dt data-cy="live-runner-meta-round-count-label-read-only">{{ i18n.t('live.swissRoundCount') }}</dt><dd data-cy="live-runner-meta-round-count-value-read-only">{{ displayRoundCount(live) }}</dd></div>
            @if (!localMode) { <div data-cy="live-runner-meta-league-read-only"><dt data-cy="live-runner-meta-league-label-read-only">{{ i18n.t('live.leagueFinalize') }}</dt><dd data-cy="live-runner-meta-league-value-read-only">{{ selectedLeagueName(live) }}</dd></div> }
          </dl>
        }
      </section>
      <div class="live-warning-stack" data-cy="live-warning-stack" aria-live="polite">
        @if (notEnoughPlayers(live)) {
          <div class="warning live-warning" role="status" data-cy="live-warning-not-enough-players">
            <p data-cy="live-warning-not-enough-players-text">{{ i18n.t('live.warnNotEnough') }}</p>
          </div>
        }
        @if (live.paidTrackingEnabled && unpaidPlayers().length) {
          <div class="warning live-warning" role="status" data-cy="live-warning-unpaid-players">
            <p data-cy="live-warning-unpaid-players-text">{{ i18n.t('live.warnUnpaid', { names: unpaidPlayerNames() }) }}</p>
          </div>
        }
        @if (showByeWarning(live)) {
          <div class="warning live-warning" role="status" data-cy="live-warning-bye">
            <p data-cy="live-warning-bye-text">{{ i18n.t('live.warnBye') }}</p>
          </div>
        }
      </div>

      <section class="live-tournament-grid live-tournament-grid--compact" data-cy="live-registration-section">
        <mat-expansion-panel class="round-panel panel live-panel live-roster-panel" data-cy="live-registration-panel" [expanded]="registrationExpanded()" (opened)="registrationExpanded.set(true)" (closed)="registrationExpanded.set(false)">
          <mat-expansion-panel-header data-cy="live-registration-panel-header">
            <mat-panel-title class="round-panel-title" data-cy="live-registration-panel-title">{{ i18n.t('live.registrationTitle') }}</mat-panel-title>
            <mat-panel-description data-cy="live-registration-panel-description">{{ i18n.plural(activePlayerCount(live), 'live.playerCountDesc', 'live.playerCountDescPlural') }}</mat-panel-description>
          </mat-expansion-panel-header>
          <div class="live-form-stack" data-cy="live-registration-form-stack">
            <p class="muted" data-cy="live-player-count">{{ i18n.plural(activePlayerCount(live), 'live.playersRegistered', 'live.playersRegisteredPlural') }}</p>
            @if (!readOnly()) {
              <div class="live-add-player-row" data-cy="live-add-player-card">
                <label class="live-registration-player-card__name live-registration-add-card__name" data-cy="live-add-player-label"><span data-cy="live-add-player-label-text">{{ i18n.t('live.newPlayer') }}</span><span class="sr-only" data-cy="live-add-player-label-sr">{{ i18n.t('live.newPlayerSr') }}</span><input #newPlayerNameInput data-cy="live-add-player-name-input" [placeholder]="i18n.t('live.playerNamePlaceholder')" [(ngModel)]="newPlayerName" [matAutocomplete]="playerNameAutocomplete" (keydown.enter)="$event.preventDefault(); addPlayer()" [disabled]="live.stage !== 'registration'" [attr.aria-label]="i18n.t('live.newPlayerNameAria')" autocomplete="off" spellcheck="false" aria-keyshortcuts="Enter"><mat-autocomplete #playerNameAutocomplete="matAutocomplete" class="live-player-name-autocomplete" data-cy="live-add-player-autocomplete" [autoActiveFirstOption]="newPlayerSuggestions(live).length > 0" (optionSelected)="selectNewPlayerSuggestion($event)">@for (name of newPlayerSuggestions(live); track name) { <mat-option [value]="name" [attr.data-cy]="'live-add-player-suggestion-' + name"><span class="live-player-name-option" [attr.data-cy]="'live-add-player-suggestion-label-' + name">@for (segment of playerNameHighlightSegments(name); track $index) {@if (segment.highlighted) { <strong [attr.data-cy]="'live-add-player-suggestion-highlight-' + name + '-' + $index">{{ segment.text }}</strong> } @else { <span [attr.data-cy]="'live-add-player-suggestion-plain-' + name + '-' + $index">{{ segment.text }}</span> }}</span></mat-option> }</mat-autocomplete></label>
                <button mat-flat-button class="create-action-button live-registration-add-card__button" type="button" data-cy="live-add-player-button" [disabled]="!canSubmitNewPlayer(live)" (click)="addPlayer()" [attr.aria-label]="i18n.t('live.addPlayerAria')"><mat-icon class="create-action-button__icon" data-cy="live-add-player-icon" aria-hidden="true">add</mat-icon><span data-cy="live-add-player-button-label">{{ i18n.t('live.addEnter') }}</span></button>
              </div>
            }
            <div class="live-registration-player-grid" data-cy="live-registration-player-grid" [attr.aria-label]="i18n.t('live.registeredPlayersAria')">
              @for (player of live.players; track player.id) {
                <article class="live-registration-player-card" data-cy="live-player-row" [class.is-dropped]="player.dropped">
                  @if (!readOnly()) {
                    <label class="live-registration-player-card__name" [attr.data-cy]="'live-player-name-label-' + player.id"><span [attr.data-cy]="'live-player-name-label-text-' + player.id">{{ i18n.t('common.player') }}</span><span class="sr-only" [attr.data-cy]="'live-player-name-label-sr-' + player.id">{{ player.name || i18n.t('live.newPlayerSr') }}</span><input data-cy="live-player-name-input" [ngModel]="player.name" (ngModelChange)="updatePlayer(player.id, { name: $event })" [attr.aria-label]="player.name ? i18n.t('live.playerNameFor', { name: player.name }) : i18n.t('live.playerNameForNew')"></label>
                    @if (live.paidTrackingEnabled) {
                      <label class="live-registration-player-card__paid" [attr.data-cy]="'live-player-paid-label-' + player.id"><input type="checkbox" data-cy="live-player-paid-checkbox" [ngModel]="player.paid" (ngModelChange)="updatePlayer(player.id, { paid: $event })" [attr.aria-label]="i18n.t('live.paidStatusFor', { name: player.name || i18n.t('live.newPlayerSr') })" [disabled]="live.stage === 'round'"> <span [attr.data-cy]="'live-player-paid-label-text-' + player.id">{{ i18n.t('live.paid') }}</span></label>
                    }
                    <button mat-button color="warn" type="button" data-cy="live-player-remove-button" [disabled]="live.stage !== 'registration' || pendingCommand()" (click)="confirmRemovePlayer(player.id)">{{ i18n.t('common.remove') }}</button>
                  } @else {
                    <span class="live-registration-player-card__name" data-cy="live-player-name-read-only">{{ player.name }}</span>
                    @if (live.paidTrackingEnabled) { <span data-cy="live-player-paid-read-only">{{ player.paid ? i18n.t('live.paid') : i18n.t('live.unpaid') }}</span> }
                  }
                </article>
              }
            </div>
            @if (!live.players.length) { <p class="empty" data-cy="live-no-players">{{ i18n.t('live.noPlayersYet') }}</p> }
            @if (!readOnly()) {
              <div class="live-round-count-settings" data-cy="live-round-count-settings">
                <mat-form-field appearance="outline" class="live-round-count-field" data-cy="live-round-count-field"><mat-label data-cy="live-round-count-label">{{ i18n.t('live.swissRoundCount') }}</mat-label><input matInput data-cy="live-tournament-round-count-input" type="number" min="0" [ngModel]="displayRoundCount(live)" (ngModelChange)="setRoundCount($event)" [disabled]="!live.customRoundCount || live.stage !== 'registration'"></mat-form-field>
                <label class="live-custom-round-toggle" data-cy="live-custom-round-toggle-label"><span data-cy="live-custom-round-toggle-text">{{ i18n.t('live.customRoundNumber') }}</span> <input type="checkbox" data-cy="live-tournament-custom-round-count-checkbox" [ngModel]="live.customRoundCount" (ngModelChange)="setCustomRoundCount($event)"></label>
              </div>
            }
          </div>
        </mat-expansion-panel>
      </section>

      @if (live.stage === 'registration') {
        <section class="live-step-panel panel" data-cy="live-start-step">
          <h2 data-cy="live-start-step-title">{{ i18n.t('live.step1') }}</h2>
          <p class="muted" data-cy="live-start-step-copy">{{ registrationCopy(live) }}</p>
          @if (!readOnly()) { <button mat-flat-button class="home-primary-action" type="button" data-cy="live-start-tournament-button" [disabled]="!canStart(live) || pendingCommand()" (click)="startTournament()">{{ i18n.t('live.startGenerateR1') }}</button> }
          @if (!canStart(live)) { <p class="muted" data-cy="live-start-step-blocked">{{ i18n.t('live.needTwoPlayers') }}</p> }
        </section>
      }

      @if (live.rounds.length) {
        <section class="stack live-round-progress" data-cy="live-round-progress">
          @for (round of orderedRounds(live); track round.id) {
            <mat-expansion-panel class="live-step-panel panel live-progress-section" data-cy="live-pairing-step" [attr.data-round]="round.roundNumber" [expanded]="stepExpanded(pairingStepKey(round.roundNumber), isActivePairingStep(live, round.roundNumber))" (opened)="onStepOpened(pairingStepKey(round.roundNumber), isActivePairingStep(live, round.roundNumber))" (closed)="setStepExpanded(pairingStepKey(round.roundNumber), false)">
              <mat-expansion-panel-header [attr.data-cy]="'live-pairing-header-' + round.roundNumber">
                <mat-panel-title class="live-panel-title" [attr.data-cy]="'live-pairing-panel-title-' + round.roundNumber"><h2 class="live-panel-heading" [attr.data-cy]="'live-pairing-heading-' + round.roundNumber">{{ i18n.t('live.pairing', { n: round.roundNumber }) }}</h2></mat-panel-title>
                <mat-panel-description [attr.data-cy]="'live-pairing-panel-description-' + round.roundNumber">
                  <span class="live-step-status" [attr.data-cy]="'live-pairing-step-status-' + round.roundNumber" [class.live-step-status--active]="isActivePairingStep(live, round.roundNumber)" [class.live-step-status--readonly]="!isActivePairingStep(live, round.roundNumber)">@if (isActivePairingStep(live, round.roundNumber)) { <span class="status-dot" [attr.data-cy]="'live-pairing-step-dot-' + round.roundNumber" aria-hidden="true"></span> {{ i18n.t('live.activeStep') }} } @else { {{ i18n.t('live.readonlyStep') }} }</span>
                  @if (live.stage === 'round' && round.roundNumber === live.currentRoundNumber && !readOnly()) {
                    <button mat-icon-button class="live-step-actions-trigger" type="button" data-cy="live-pairing-actions-button" [matMenuTriggerFor]="pairingActionsMenu" [attr.aria-label]="i18n.t('live.pairingActions')" [disabled]="!isActivePairingStep(live, round.roundNumber)" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">⋮</button>
                    <mat-menu #pairingActionsMenu="matMenu" [attr.data-cy]="'live-pairing-actions-menu-' + round.roundNumber">
                      <button mat-menu-item class="destructive-menu-item" type="button" data-cy="live-cancel-round-button" [disabled]="!isActivePairingStep(live, round.roundNumber) || readOnly() || pendingCommand()" (click)="cancelRound()">{{ i18n.t('live.cancelRound') }}</button>
                    </mat-menu>
                  }
                </mat-panel-description>
              </mat-expansion-panel-header>
              <ng-container [ngTemplateOutlet]="roundTable" [ngTemplateOutletContext]="{ round: round, editable: isActivePairingStep(live, round.roundNumber) && !readOnly() }" />
              @if (live.stage === 'round' && round.roundNumber === live.currentRoundNumber) {
                @if (allCurrentMatchesAreDraws(live)) { <p class="warning" role="status" data-cy="live-all-draws-warning">{{ i18n.t('live.allDrawsWarning') }}</p> }
                @if (!readOnly()) { <div class="live-validate-actions" [attr.data-cy]="'live-validate-actions-' + round.roundNumber"><button mat-flat-button class="home-primary-action create-action-button" type="button" data-cy="live-validate-round-button" [disabled]="!!validateRoundIssue(live) || !isActivePairingStep(live, round.roundNumber) || pendingCommand()" [attr.title]="validateRoundIssue(live)" (click)="validateRound()">{{ i18n.t('live.validateRound') }}</button>@if (validateRoundIssue(live); as issue) { <p class="muted live-validate-issue" [attr.data-cy]="'live-validate-issue-' + round.roundNumber">{{ issue }}</p> }</div> }
              }
            </mat-expansion-panel>

            @if (round.validated) {
              <mat-expansion-panel class="live-step-panel panel live-progress-section" data-cy="live-standing-step" [attr.data-round]="round.roundNumber" [expanded]="stepExpanded(standingStepKey(round.roundNumber), isActiveStandingStep(live, round.roundNumber))" (opened)="onStepOpened(standingStepKey(round.roundNumber), isActiveStandingStep(live, round.roundNumber))" (closed)="setStepExpanded(standingStepKey(round.roundNumber), false)">
                <mat-expansion-panel-header [attr.data-cy]="'live-standing-header-' + round.roundNumber">
                  <mat-panel-title class="live-panel-title" [attr.data-cy]="'live-standing-panel-title-' + round.roundNumber"><h2 class="live-panel-heading" [attr.data-cy]="'live-standing-heading-' + round.roundNumber">{{ i18n.t('live.standing', { n: round.roundNumber }) }}</h2></mat-panel-title>
                  <mat-panel-description [attr.data-cy]="'live-standing-panel-description-' + round.roundNumber">
                    <span class="live-step-status" [attr.data-cy]="'live-standing-step-status-' + round.roundNumber" [class.live-step-status--active]="isActiveStandingStep(live, round.roundNumber)" [class.live-step-status--readonly]="!isActiveStandingStep(live, round.roundNumber)">@if (isActiveStandingStep(live, round.roundNumber)) { <span class="status-dot" [attr.data-cy]="'live-standing-step-dot-' + round.roundNumber" aria-hidden="true"></span> {{ i18n.t('live.activeStep') }} } @else { {{ i18n.t('live.readonlyStep') }} }</span>
                    @if (!readOnly() && (canEditStanding(live, round.roundNumber) || checkpointFor(live, 'Standing ' + round.roundNumber) || checkpointFor(live, 'Pairing ' + round.roundNumber))) {
                      <button mat-icon-button class="live-step-actions-trigger" type="button" data-cy="live-standing-actions-button" [matMenuTriggerFor]="standingActionsMenu" [attr.aria-label]="i18n.t('live.standingActions')" [disabled]="!isActiveStandingStep(live, round.roundNumber)" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">⋮</button>
                      <mat-menu #standingActionsMenu="matMenu" [attr.data-cy]="'live-standing-actions-menu-' + round.roundNumber">
                        @if (canEditStanding(live, round.roundNumber)) {
                          <button mat-menu-item type="button" data-cy="live-standing-add-player-button" [disabled]="!isActiveStandingStep(live, round.roundNumber) || pendingCommand()" (click)="addLatePlayer(round.roundNumber)" [attr.aria-label]="i18n.t('live.addPlayerStandingsAria')">{{ i18n.t('live.addPlayer') }}</button>
                        }
                        @if (checkpointFor(live, 'Standing ' + round.roundNumber); as checkpoint) {
                          <button mat-menu-item type="button" data-cy="live-restore-standing-button" [disabled]="!isActiveStandingStep(live, round.roundNumber) || pendingCommand()" (click)="restoreCheckpoint(checkpoint)">{{ i18n.t('live.restoreCheckpoint', { label: i18n.checkpointLabel(checkpoint.label) }) }}</button>
                        }
                        @if (checkpointFor(live, 'Pairing ' + round.roundNumber); as pairingCheckpoint) {
                          <button mat-menu-item class="destructive-menu-item" type="button" data-cy="live-cancel-standings-button" [disabled]="!isActiveStandingStep(live, round.roundNumber) || pendingCommand()" (click)="restoreCheckpoint(pairingCheckpoint)">{{ i18n.t('live.cancelStandings') }}</button>
                        }
                      </mat-menu>
                    }
                  </mat-panel-description>
                </mat-expansion-panel-header>
                <ng-container [ngTemplateOutlet]="standingsTable" [ngTemplateOutletContext]="{ rows: standingRowsForRound(live, round.roundNumber), roundNumber: round.roundNumber, live: live }" />
                @if (live.currentRoundNumber === round.roundNumber && (live.stage === 'standings' || live.stage === 'completed')) {
                  <div class="live-standing-footer-actions" [attr.data-cy]="'live-standing-footer-actions-' + round.roundNumber">
                    @if (!readOnly()) {
                      <div class="actions live-next-actions" [attr.data-cy]="'live-standing-next-actions-' + round.roundNumber">
                        @if (!finished(live)) { <button mat-flat-button class="create-action-button" type="button" data-cy="live-generate-next-round-button" [disabled]="pendingCommand()" (click)="generateNextRound()">{{ i18n.t('live.generateRound', { n: validatedRoundCount(live) + 1 }) }}</button> }
                        @else { <button mat-flat-button class="home-primary-action" type="button" data-cy="live-archive-tournament-button" [disabled]="finalizing() || pendingCommand()" (click)="finalize()">{{ finalizing() ? i18n.t('common.archiving') : i18n.t('live.archiveTournament') }}</button> }
                      </div>
                    }
                  </div>
                  @if (finished(live) && !leagueSelectValue(live.leagueId) && !localMode) { <p class="warning" role="status" [attr.data-cy]="'live-no-league-finalize-warning-' + round.roundNumber">{{ i18n.t('live.noLeagueFinalizeWarn') }}</p> }
                }
              </mat-expansion-panel>
            }
          }
        </section>
      }

      <footer class="live-tournament-footer" data-cy="live-runner-footer">
        <button mat-stroked-button class="secondary-action" type="button" data-cy="live-footer-back-button" (click)="returnToRunningTournaments()">{{ i18n.t('nav.backToRunningTournaments') }}</button>
        <button mat-stroked-button class="secondary-action live-scroll-top-button" type="button" data-cy="live-scroll-top-button" (click)="scrollToTop()" [attr.aria-label]="i18n.t('live.backToTop')">↑</button>
      </footer>

      <ng-template #standingsTable let-rows="rows" let-roundNumber="roundNumber" let-live="live">
        <div class="table-wrap" [attr.data-cy]="'live-standings-table-wrap-' + roundNumber">
          <table class="ranking-table live-standings-table" data-cy="live-standings-table">
            <thead [attr.data-cy]="'live-standings-head-' + roundNumber"><tr [attr.data-cy]="'live-standings-head-row-' + roundNumber"><th scope="col" [attr.data-cy]="'live-standings-column-rank-' + roundNumber">{{ i18n.t('common.rank') }}</th><th scope="col" [attr.data-cy]="'live-standings-column-player-' + roundNumber">{{ i18n.t('common.player') }}</th><th scope="col" [attr.data-cy]="'live-standings-column-points-' + roundNumber">{{ i18n.t('common.pts') }}</th><th scope="col" [attr.data-cy]="'live-standings-column-record-' + roundNumber">{{ i18n.t('common.record') }}</th><th scope="col" [attr.data-cy]="'live-standings-column-omw-' + roundNumber">{{ i18n.t('common.omw') }}</th><th scope="col" [attr.data-cy]="'live-standings-column-gwr-' + roundNumber">{{ i18n.t('common.gwr') }}</th><th scope="col" [attr.data-cy]="'live-standings-column-ogw-' + roundNumber">{{ i18n.t('common.ogw') }}</th>@if (canEditStanding(live, roundNumber)) { <th scope="col" [attr.data-cy]="'live-standings-column-actions-' + roundNumber">{{ i18n.t('common.actions') }}</th> }</tr></thead>
            <tbody [attr.data-cy]="'live-standings-body-' + roundNumber">@for (row of rows; track row.playerId) { <tr [attr.data-cy]="'live-standings-row-' + roundNumber + '-' + row.playerId" [class.is-dropped]="row.dropped"><td [attr.data-cy]="'live-standings-cell-rank-' + roundNumber + '-' + row.playerId">{{ row.rank }}</td><td [attr.data-cy]="'live-standings-cell-player-' + roundNumber + '-' + row.playerId">@if (canEditStandingPlayerRecord(live, row)) { <input class="live-standing-player-name-input" data-cy="live-standing-player-name-input" [ngModel]="row.playerName" (ngModelChange)="updatePlayer(row.playerId, { name: $event })" [attr.aria-label]="'Player name for ' + row.playerName"> } @else { {{ row.playerName }} }</td><td [attr.data-cy]="'live-standings-cell-points-' + roundNumber + '-' + row.playerId">{{ row.points }}</td><td [attr.data-cy]="'live-standings-cell-record-' + roundNumber + '-' + row.playerId">@if (canEditStandingPlayerRecord(live, row)) { <div class="live-record-inputs live-standing-record-inputs" [attr.data-cy]="'live-standings-record-inputs-' + roundNumber + '-' + row.playerId" [attr.aria-label]="'Starting record for ' + row.playerName"><label [attr.data-cy]="'live-standings-wins-label-' + roundNumber + '-' + row.playerId"><span [attr.data-cy]="'live-standings-wins-label-text-' + roundNumber + '-' + row.playerId">W</span><input data-cy="live-standing-player-wins-input" type="number" inputmode="numeric" step="1" min="0" [ngModel]="row.matchWins" (ngModelChange)="updateStandingPlayerRecord(row.playerId, 'initialWins', $event)" [attr.aria-label]="'Starting wins for ' + row.playerName"></label><label [attr.data-cy]="'live-standings-draws-label-' + roundNumber + '-' + row.playerId"><span [attr.data-cy]="'live-standings-draws-label-text-' + roundNumber + '-' + row.playerId">D</span><input data-cy="live-standing-player-draws-input" type="number" inputmode="numeric" step="1" min="0" [ngModel]="row.matchDraws" (ngModelChange)="updateStandingPlayerRecord(row.playerId, 'initialDraws', $event)" [attr.aria-label]="'Starting draws for ' + row.playerName"></label><label [attr.data-cy]="'live-standings-losses-label-' + roundNumber + '-' + row.playerId"><span [attr.data-cy]="'live-standings-losses-label-text-' + roundNumber + '-' + row.playerId">L</span><input data-cy="live-standing-player-losses-input" type="number" inputmode="numeric" step="1" min="0" [ngModel]="row.matchLosses" (ngModelChange)="updateStandingPlayerRecord(row.playerId, 'initialLosses', $event)" [attr.aria-label]="'Starting losses for ' + row.playerName"></label></div> } @else { <span class="record-win" [attr.data-cy]="'live-standings-record-wins-' + roundNumber + '-' + row.playerId">{{ row.matchWins }}</span>-<span class="record-loss" [attr.data-cy]="'live-standings-record-losses-' + roundNumber + '-' + row.playerId">{{ row.matchLosses }}</span>-<span class="record-draw" [attr.data-cy]="'live-standings-record-draws-' + roundNumber + '-' + row.playerId">{{ row.matchDraws }}</span> @if (row.byes) { <span class="record-byes" [attr.data-cy]="'live-standings-record-byes-' + roundNumber + '-' + row.playerId">{{ i18n.t('ranking.bye', { count: row.byes }) }}</span> } }</td><td [attr.data-cy]="'live-standings-cell-omw-' + roundNumber + '-' + row.playerId">{{ formatPercentage(row.opponentsMatchWinPercentage) }}</td><td [attr.data-cy]="'live-standings-cell-gwr-' + roundNumber + '-' + row.playerId">{{ formatPercentage(row.gameWinPercentage) }}</td><td [attr.data-cy]="'live-standings-cell-ogw-' + roundNumber + '-' + row.playerId">{{ formatPercentage(row.opponentsGameWinPercentage) }}</td>@if (canEditStanding(live, roundNumber)) { <td [attr.data-cy]="'live-standings-cell-actions-' + roundNumber + '-' + row.playerId"><button mat-button color="warn" type="button" data-cy="live-standing-drop-player-button" [disabled]="row.dropped || pendingCommand()" [attr.aria-label]="standingPlayerActionLabel(live, row) + ' ' + row.playerName" (click)="confirmDropPlayer(row)">{{ standingPlayerActionLabel(live, row) }}</button></td> }</tr> }</tbody>
          </table>
        </div>
      </ng-template>

      <ng-template #roundTable let-round="round" let-editable="editable">
        <div class="live-round-card-grid round-entry-table-wrap" data-cy="live-round-panel" role="list" [attr.aria-label]="i18n.t('live.roundPairingsAria')">
          @for (item of round.entries; track item.entry.id) {
            @if (item.entry.kind === 'match') {
              <article class="live-round-card" role="listitem" [attr.data-cy]="live.stage === 'round' && round.roundNumber === live.currentRoundNumber ? 'live-match-row' : 'live-validated-match-row'" [attr.data-table]="item.entry.table" [class.is-invalid]="matchScoreIssue(item.entry)" [class.is-valid]="item.resultEntered && !matchScoreIssue(item.entry) && !isDrawMatch(item.entry)" [class.is-draw-warning]="!matchScoreIssue(item.entry) && isDrawMatch(item.entry)">
                <div class="live-round-card__table round-entry-table__number" [attr.data-cy]="'live-match-table-' + item.entry.id">{{ i18n.t('live.table', { n: item.entry.table }) }} @if (matchScoreIssue(item.entry)) { <span class="sr-only" [id]="'live-match-score-issue-' + item.entry.id" [attr.data-cy]="'live-match-score-issue-text-' + item.entry.id">{{ matchScoreIssue(item.entry) }}</span> }</div>
                <div class="live-round-card__sides" [attr.data-cy]="'live-match-sides-' + item.entry.id">
                  <div class="live-round-card__side live-round-card__side--one" [attr.data-cy]="'live-match-side1-' + item.entry.id">
                    <span class="live-round-card__player round-entry-table__player" [attr.data-cy]="'live-match-player1-name-' + item.entry.id">{{ livePlayerName(live, item.entry.player1Name) }}</span>
                    @if (editable) { <div class="score-stepper live-round-card__score" [attr.data-cy]="'live-match-player1-stepper-' + item.entry.id"><button class="score-stepper__button score-stepper__button--decrement" data-cy="live-match-player1-decrement" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player1Score', -1)" [disabled]="!canAdjustMatchScore(item.entry, 'player1Score', -1)" [attr.aria-label]="i18n.t('live.decreaseScore', { name: livePlayerName(live, item.entry.player1Name) })">−</button><input data-cy="live-match-player1-score" type="number" inputmode="numeric" step="1" min="0" max="2" [ngModel]="item.entry.player1Score" (ngModelChange)="setMatchScore(round.id, item.entry, 'player1Score', $event)" [attr.aria-label]="i18n.t('live.scorePlayer1', { name: livePlayerName(live, item.entry.player1Name), table: item.entry.table })" [attr.aria-invalid]="matchScoreIssue(item.entry) ? 'true' : null" [attr.aria-describedby]="matchScoreIssue(item.entry) ? 'live-match-score-issue-' + item.entry.id : null"><button class="score-stepper__button score-stepper__button--increment" data-cy="live-match-player1-increment" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player1Score', 1)" [disabled]="!canAdjustMatchScore(item.entry, 'player1Score', 1)" [attr.aria-label]="i18n.t('live.increaseScore', { name: livePlayerName(live, item.entry.player1Name) })">+</button></div> } @else { <span class="live-round-card__score" data-cy="live-match-player1-score-read-only">{{ item.entry.player1Score }}</span> }
                  </div>
                  <div class="live-round-card__side live-round-card__side--two" [attr.data-cy]="'live-match-side2-' + item.entry.id">
                    <span class="live-round-card__player round-entry-table__player" [attr.data-cy]="'live-match-player2-name-' + item.entry.id">{{ livePlayerName(live, item.entry.player2Name) }}</span>
                    @if (editable) { <div class="score-stepper live-round-card__score" [attr.data-cy]="'live-match-player2-stepper-' + item.entry.id"><button class="score-stepper__button score-stepper__button--decrement" data-cy="live-match-player2-decrement" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player2Score', -1)" [disabled]="!canAdjustMatchScore(item.entry, 'player2Score', -1)" [attr.aria-label]="i18n.t('live.decreaseScore', { name: livePlayerName(live, item.entry.player2Name) })">−</button><input data-cy="live-match-player2-score" type="number" inputmode="numeric" step="1" min="0" max="2" [ngModel]="item.entry.player2Score" (ngModelChange)="setMatchScore(round.id, item.entry, 'player2Score', $event)" [attr.aria-label]="i18n.t('live.scorePlayer2', { name: livePlayerName(live, item.entry.player2Name), table: item.entry.table })" [attr.aria-invalid]="matchScoreIssue(item.entry) ? 'true' : null" [attr.aria-describedby]="matchScoreIssue(item.entry) ? 'live-match-score-issue-' + item.entry.id : null"><button class="score-stepper__button score-stepper__button--increment" data-cy="live-match-player2-increment" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player2Score', 1)" [disabled]="!canAdjustMatchScore(item.entry, 'player2Score', 1)" [attr.aria-label]="i18n.t('live.increaseScore', { name: livePlayerName(live, item.entry.player2Name) })">+</button></div> } @else { <span class="live-round-card__score" data-cy="live-match-player2-score-read-only">{{ item.entry.player2Score }}</span> }
                  </div>
                </div>
              </article>
            } @else if (item.entry.kind === 'bye') {
              <article class="live-round-card live-bye-row" role="listitem" [attr.data-cy]="live.stage === 'round' && round.roundNumber === live.currentRoundNumber ? 'live-bye-row' : 'live-validated-bye-row'">
                <div class="live-round-card__table round-entry-table__number" [attr.data-cy]="'live-bye-table-' + item.entry.id">{{ i18n.t('live.table', { n: item.entry.table }) }}</div>
                <div class="live-round-card__bye" [attr.data-cy]="'live-bye-text-' + item.entry.id">{{ i18n.t('live.byeAutoWin', { name: livePlayerName(live, item.entry.playerName) }) }}</div>
              </article>
            }
          }
        </div>
      </ng-template>
    } @else { <mat-card class="panel" data-cy="live-runner-not-found"><mat-card-title data-cy="live-runner-not-found-title">{{ i18n.t('live.notFoundTitle') }}</mat-card-title><mat-card-content data-cy="live-runner-not-found-content"><p data-cy="live-runner-not-found-body">{{ i18n.t('live.notFoundBody') }}</p></mat-card-content></mat-card> }

    <gones-back-button data-cy="live-runner-back-bottom" [link]="['/live-tournaments']" [label]="i18n.t('nav.backToRunningTournaments')" position="bottom" />
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
  /**
   * Server leagues only — unassigned is the empty option tied to PLACEHOLDER_LEAGUE_ID on finalize,
   * and both placeholders are dropped with it. The League list is the union of both stores (ADR
   * 0028) but these settings are a server document: assigning a `local-` league would be a
   * cross-authority reference the server rejects with "League was not found.".
   */
  readonly assignableLeagues = computed(() => this.leagues().filter((league) => !isLocalLeagueId(league.id) && !isAnyPlaceholderLeagueId(league.id)));
  /** Player names already present in saved leagues — source for registration autocomplete. */
  readonly knownPlayerNames = computed(() => collectKnownPlayerNames(this.leagues()));
  newPlayerName = '';
  tournamentNameDraft = '';
  readonly registrationExpanded = signal(true);
  readonly manuallyExpandedSteps = signal<ReadonlySet<string>>(new Set<string>());
  readonly finalizing = signal(false);
  /** Structural server command in flight — locks buttons until the response lands. */
  readonly pendingCommand = signal(false);
  /** Server rejected a write with 412 — the user must reload the latest document and reapply. */
  readonly stale = signal(false);
  private readonly auth = inject(AuthService);
  private readonly power = inject(PowerUserSettingsService);
  private readonly onlineStatus = inject(OnlineStatusService);
  /** Resolved once, with the port itself (ADR 0021): a role change mid-session needs a reload. */
  readonly localMode = inject(LIVE_BACKEND_MODE) === 'browser-local';
  /** In the browser-local store the visitor owns everything they can see, so they have Live authority. */
  readonly existingAuthorityAllowed = computed(() => this.localMode || canManageLive(this.auth.profile()?.globalRole));
  readonly canManage = computed(() => canUsePowerMutation(this.power.enabled(), this.existingAuthorityAllowed()));
  readonly readOnly = computed(() => !this.canManage());
  /** Set after a local finalize: there is no League to navigate to, only the JSON that was saved. */
  readonly localFinalized = signal(false);
  private saving = false;
  private pendingSave = false;
  /** Latest documentVersion acknowledged by the server; the If-Match source for every intent. */
  private serverVersion = 1;
  private addSequence = 0;
  private readonly debouncedIntents = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => Promise<LiveTournamentDocument> }>();
  private readonly queuedIntents = new Map<string, () => Promise<LiveTournamentDocument>>();
  private pumping = false;
  private readonly openAdvancedSettingsListener = () => this.openAdvancedSettings();
  readonly unpaidPlayers = computed(() => this.tournament() ? unpaidActivePlayers(this.tournament()!) : []);
  readonly unpaidPlayerNames = computed(() => this.unpaidPlayers().map((player) => player.name).join(', '));
  readonly currentRound = computed(() => this.tournament() ? currentLiveRound(this.tournament()!) : null);
  readonly standings = computed(() => this.tournament() ? calculateLiveStandings(this.tournament()!) : []);

  /** Map stored placeholder id to empty select value so one unassigned option covers all languages. */
  leagueSelectValue(leagueId: string): string {
    return !leagueId || leagueId === PLACEHOLDER_LEAGUE_ID ? '' : leagueId;
  }

  constructor(readonly liveRepo: LiveTournamentRepository, private readonly leagueRepo: LeagueArchiveRepository, private readonly route: ActivatedRoute, private readonly router: Router, private readonly dialog: MatDialog) {
    window.addEventListener('gones-open-live-tournament-advanced-settings', this.openAdvancedSettingsListener);
    void this.load();
  }

  ngOnDestroy(): void {
    window.removeEventListener('gones-open-live-tournament-advanced-settings', this.openAdvancedSettingsListener);
    for (const pending of this.debouncedIntents.values()) clearTimeout(pending.timer);
    this.debouncedIntents.clear();
    this.queuedIntents.clear();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    let editTitleAfterLoad = false;
    try {
      // Local mode finalizes to a JSON download, never into a League, and the anonymous visitor is
      // not entitled to the server League list either — so it is not requested at all.
      this.leagues.set(this.localMode ? [] : await this.leagueRepo.listLeagues());
      const id = this.route.snapshot.paramMap.get('liveTournamentId') ?? 'new';
      editTitleAfterLoad = id === 'new' || this.shouldEditTitleFromNavigationState();
      if (id === 'new') {
        const created = this.withAutomaticRoundCount(await this.liveRepo.create());
        this.serverVersion = created.documentVersion;
        this.tournament.set(created);
        this.tournamentNameDraft = created.name;
        await this.router.navigate(['/live-tournaments', created.id], { replaceUrl: true, state: { editTitle: true } });
      } else {
        const existing = await this.liveRepo.get(id);
        const normalized = existing ? this.withAutomaticRoundCount(existing) : null;
        if (existing) this.serverVersion = existing.documentVersion;
        this.tournament.set(normalized);
        this.tournamentNameDraft = normalized?.name ?? '';
      }
      this.stale.set(false);
      this.error.set('');
    } catch (error) {
      logBoundaryError('live-tournament.load', error);
      this.error.set(this.i18n.t('live.loadFailed'));
    } finally {
      this.loading.set(false);
      if (editTitleAfterLoad) this.focusTournamentNameInput();
    }
  }

  patch(patch: Partial<LiveTournamentDocument>): void {
    if (this.readOnly()) return;
    this.update((live) => this.withAutomaticRoundCount({ ...live, ...patch }));
    this.queueSettingsIntent();
  }
  stringValue(value: unknown, fallback = ''): string { return String(value || fallback); }
  numberValue(value: unknown): number { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; }
  setRoundCount(value: unknown): void { this.patch({ roundCount: this.numberValue(value), customRoundCount: true }); }
  setCustomRoundCount(customRoundCount: boolean): void { this.patch({ customRoundCount, roundCount: customRoundCount ? this.displayRoundCount(this.tournament()!) : autoLiveSwissRoundCount(this.tournament()!) }); }
  displayRoundCount(live: LiveTournamentDocument): number { return live.customRoundCount ? live.roundCount : autoLiveSwissRoundCount(live); }
  selectedLeagueName(live: LiveTournamentDocument): string { return this.assignableLeagues().find((league) => league.id === live.leagueId)?.name ?? this.i18n.t('live.unassigned'); }
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
  canEditStanding(live: LiveTournamentDocument, roundNumber: number): boolean { return this.isActiveStandingStep(live, roundNumber) && !this.readOnly(); }
  isActivePairingStep(live: LiveTournamentDocument, roundNumber: number): boolean { return live.stage === 'round' && live.currentRoundNumber === roundNumber; }
  isActiveStandingStep(live: LiveTournamentDocument, roundNumber: number): boolean { return (live.stage === 'standings' || live.stage === 'completed') && live.currentRoundNumber === roundNumber; }
  pairingStepKey(roundNumber: number): string { return `pairing-${roundNumber}`; }
  standingStepKey(roundNumber: number): string { return `standing-${roundNumber}`; }
  stepExpanded(key: string, active: boolean): boolean { return active || this.manuallyExpandedSteps().has(key); }
  /**
   * Track only user-driven expansions of non-active steps. Material emits (opened) when the
   * expand animation of the active step completes, which can land after the active step already
   * moved on; re-adding that key would re-expand a read-only panel forever.
   */
  onStepOpened(key: string, active: boolean): void {
    if (!active) this.setStepExpanded(key, true);
  }
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
    if (this.readOnly()) return;
    const live = this.tournament();
    if (!live || this.finalizing()) return;
    const name = String(this.tournamentNameDraft || live.name || this.i18n.t('live.defaultLiveName')).trim() || this.i18n.t('live.defaultLiveName');
    this.tournamentNameDraft = name;
    if (name !== live.name) this.patch({ name });
  }

  canSubmitNewPlayer(live: LiveTournamentDocument): boolean {
    return live.stage === 'registration' && Boolean(trimPlayerName(this.newPlayerName));
  }

  newPlayerSuggestions(live: LiveTournamentDocument): string[] {
    return suggestPlayerNames(this.knownPlayerNames(), this.newPlayerName, {
      exclude: live.players.map((player) => player.name)
    });
  }

  selectNewPlayerSuggestion(event: MatAutocompleteSelectedEvent): void {
    this.newPlayerName = String(event.option.value ?? '');
  }

  playerNameHighlightSegments(name: string): { text: string; highlighted: boolean }[] {
    const highlightedIndices = new Set(fuzzyMatchIndices(name, this.newPlayerName));
    if (!highlightedIndices.size) return [{ text: name, highlighted: false }];
    const segments: { text: string; highlighted: boolean }[] = [];
    let currentText = '';
    let currentHighlighted = highlightedIndices.has(0);
    for (let index = 0; index < name.length; index++) {
      const highlighted = highlightedIndices.has(index);
      if (highlighted !== currentHighlighted && currentText) {
        segments.push({ text: currentText, highlighted: currentHighlighted });
        currentText = '';
        currentHighlighted = highlighted;
      }
      currentText += name[index];
    }
    if (currentText) segments.push({ text: currentText, highlighted: currentHighlighted });
    return segments;
  }

  addPlayer(): void {
    if (this.readOnly()) return;
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
    this.queueIntent(`add:${++this.addSequence}`, () => this.liveRepo.addLivePlayer(live.id, this.serverVersion, { name, initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' }));
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
    this.queueIntent(`add:${++this.addSequence}`, () => this.liveRepo.addLivePlayer(live.id, this.serverVersion, { name, initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' }));
  }

  updateStandingPlayerRecord(playerId: string, field: 'initialWins' | 'initialDraws' | 'initialLosses', value: unknown): void {
    this.updatePlayer(playerId, { [field]: this.numberValue(value) });
  }

  async confirmDropPlayer(row: LiveStandingRow): Promise<void> {
    if (this.readOnly() || row.dropped) return;
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
    if (!live) return;
    if (deleteInsteadOfDrop) {
      await this.runExclusive((version) => this.liveRepo.removeLivePlayer(live.id, row.playerId, version));
      return;
    }
    await this.runExclusive((version) => this.liveRepo.dropLivePlayer(live.id, row.playerId, version));
  }

  updatePlayer(playerId: string, patch: Partial<LiveTournamentPlayerDocument>): void {
    if (this.readOnly()) return;
    const before = this.tournament();
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
    if (this.tournament() === before) return;
    if ('paid' in patch) {
      this.queueIntent(`paid:${playerId}`, () => {
        const live = this.tournament();
        const player = live?.players.find((item) => item.id === playerId);
        if (!live || !player) return Promise.resolve(live ?? this.tournament()!);
        return this.liveRepo.setLivePlayerPaid(live.id, playerId, this.serverVersion, player.paid);
      });
      return;
    }
    if ('dropped' in patch) return; // server drops go through the explicit drop intent
    this.queuePlayerEditIntent(playerId);
  }

  async confirmRemovePlayer(playerId: string): Promise<void> {
    if (this.readOnly()) return;
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
    await this.runExclusive((version) => this.liveRepo.removeLivePlayer(live.id, playerId, version));
  }

  async startTournament(): Promise<void> {
    if (this.readOnly()) return;
    const live = this.tournament();
    if (!live || !(await this.confirmWarnings(this.i18n.t('live.startTournamentQ'), this.startWarnings(live), this.i18n.t('live.startTournament')))) return;
    await this.runExclusive((version) => this.liveRepo.startLiveRound(live.id, version));
  }

  async generateNextRound(): Promise<void> {
    if (this.readOnly()) return;
    const live = this.tournament();
    if (!live || !(await this.confirmWarnings(this.i18n.t('live.generateNextQ'), this.nextRoundWarnings(live), this.i18n.t('live.generateRoundConfirm')))) return;
    await this.runExclusive((version) => this.liveRepo.startLiveRound(live.id, version));
  }

  cancelRound(): void {
    if (this.readOnly()) return;
    const live = this.tournament();
    if (live && live.stage === 'round') void this.runExclusive((version) => this.liveRepo.cancelLiveRound(live.id, version));
  }

  async validateRound(): Promise<void> {
    if (this.readOnly()) return;
    const live = this.tournament();
    if (!live || live.stage !== 'round' || this.validateRoundIssue(live)) return;
    if (!(await this.confirmWarnings(this.i18n.t('live.validateRoundQ'), this.validateRoundWarnings(live), this.i18n.t('live.validateRoundConfirm')))) return;
    await this.runExclusive((version) => this.liveRepo.validateLiveRound(live.id, version));
  }

  restoreCheckpoint(checkpoint: LiveTournamentCheckpointDocument): void {
    if (this.readOnly()) return;
    const live = this.tournament();
    if (live && this.canRestoreCheckpoint(live, checkpoint)) void this.runExclusive((version) => this.liveRepo.restoreLiveCheckpoint(live.id, checkpoint.id, version));
  }

  adjustMatchScore(roundId: string, entry: Extract<RoundEntry, { kind: 'match' }>, field: 'player1Score' | 'player2Score', delta: -1 | 1): void {
    if (this.readOnly() || !this.canAdjustMatchScore(entry, field, delta)) return;
    this.setMatchScore(roundId, entry, field, entry[field] + delta);
  }

  setMatchScore(roundId: string, entry: Extract<RoundEntry, { kind: 'match' }>, field: 'player1Score' | 'player2Score', value: unknown): void {
    if (this.readOnly()) return;
    const score = this.numberValue(value);
    const before = this.tournament();
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
    if (this.tournament() !== before) this.queueScoreIntent(roundId, entry.id);
  }

  /**
   * Atomic finalization through the Live backend port: the server archives the finished Live
   * Tournament into its League and tombstones the live document in one command; the runner only
   * navigates to the resulting Result page.
   */
  async finalize(): Promise<void> {
    const live = this.tournament();
    if (!live || this.finalizing() || this.readOnly()) return;
    if (!(await this.confirmWarnings(this.i18n.t('live.archiveQ'), this.finalizeWarnings(live), this.i18n.t('live.archiveTournament')))) return;
    if (!this.requireOnline()) return;
    this.finalizing.set(true);
    try {
      await this.flushIntents();
      const latestLive = this.tournament();
      if (!latestLive) return;
      const version = this.serverVersion;
      const result = await this.liveRepo.finalizeLiveTournament(latestLive.id, version);
      if (!result.leagueId) {
        // Browser-local authority (ADR 0021): there is no League to write into, so the finished
        // tournament is handed to the user as the JSON the server would have archived.
        const archived = finalizeLiveTournamentDocument({ ...latestLive, finalizedTournamentId: result.finalizedTournamentId });
        saveJsonFile(archived, `gones-live-tournament-${latestLive.tournamentDate}.json`);
        this.localFinalized.set(true);
        await this.load();
        return;
      }
      await this.router.navigate(['/leagues-archive', result.leagueId, 'tournaments-archive', result.finalizedTournamentId]);
    } catch (error) {
      logBoundaryError('live-tournament.finalize', error, { liveTournamentId: live.id, leagueId: live.leagueId });
      if (liveCommandError(error) === 'stale') {
        this.stale.set(true);
        this.error.set(this.i18n.t('live.staleDocument'));
      } else {
        this.error.set(error instanceof Error && error.message === 'leagueNotFound' ? this.i18n.t('live.leagueNotFound') : this.i18n.t('live.finalizeFailed'));
      }
    } finally {
      this.finalizing.set(false);
    }
  }

  saveDraft(): void {
    void this.flushIntents();
  }

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
    // Local mode never writes a League, so "no League selected" is not a warning there — the copy
    // that matters is that finalizing produces a JSON download instead (ADR 0021).
    if (this.localMode) warnings.push(this.i18n.t('live.localFinalizeBody'));
    else if (!this.leagueSelectValue(live.leagueId)) warnings.push(this.i18n.t('live.noLeagueFinalizeWarn'));
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
    if (this.readOnly()) return;
    const live = this.tournament();
    if (!live) return;
    this.dialog.open<LiveTournamentAdvancedSettingsDialogComponent, LiveTournamentAdvancedSettingsDialogData, LiveTournamentAdvancedSettingsResult>(LiveTournamentAdvancedSettingsDialogComponent, {
      width: 'min(92vw, 42rem)',
      data: { live, leagues: this.leagues(), canManage: this.canManage() }
    }).afterClosed().subscribe((result) => {
      if (!result) return;
      if (result.kind === 'delete') { void this.deleteTournament(); return; }
      const before = this.tournament();
      this.update((current) => this.withAutomaticRoundCount({ ...current, ...result.draft }));
      if (!before || this.tournament() === before) return;
      this.queueSettingsIntent();
      for (const player of result.draft.players) {
        const previous = before.players.find((item) => item.id === player.id);
        if (previous && previous.archetype !== player.archetype) this.queuePlayerEditIntent(player.id);
      }
    });
  }

  async deleteTournament(): Promise<void> {
    const live = this.tournament();
    if (!live || this.readOnly() || this.pendingCommand()) return;
    const confirmed = Boolean(await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.i18n.t('live.deleteConfirmTitle'),
        message: this.i18n.t('live.deleteConfirmMessage', { name: live.name || this.i18n.t('liveList.liveTournament') }),
        confirmLabel: this.i18n.t('live.deleteTournament'),
        destructive: true
      }
    }).afterClosed()));
    if (!confirmed) return;
    this.pendingCommand.set(true);
    this.error.set('');
    try {
      await this.liveRepo.delete(live.id);
      await this.router.navigate(['/live-tournaments']);
    } catch (error) {
      logBoundaryError('live-tournament-runner.delete', error, { liveTournamentId: live.id });
      const outcome = liveDeleteOutcome(true, error);
      this.error.set(outcome === 'forbidden' ? this.i18n.t('live.forbidden') : outcome === 'stale' ? this.i18n.t('live.deleteStale') : this.i18n.t('live.deleteFailed'));
    } finally {
      this.pendingCommand.set(false);
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

  /**
   * Optimistic in-memory transform. Flag off it persists the whole document (legacy autosave);
   * flag on the matching intent command is dispatched separately by the caller.
   */
  private update(updater: (live: LiveTournamentDocument) => LiveTournamentDocument): void {
    const live = this.tournament();
    if (!live || this.finalizing() || this.readOnly()) return;
    const previousActiveStepKey = this.activeStepKey(live);
    const updated = updater(live);
    if (this.activeStepKey(updated) !== previousActiveStepKey) this.manuallyExpandedSteps.set(new Set<string>());
    this.tournament.set(updated);
    this.tournamentNameDraft = updated.name;
    window.dispatchEvent(new CustomEvent('gones-live-tournament-updated', { detail: { liveTournamentId: updated.id, name: updated.name } }));
  }

  private queueSettingsIntent(): void {
    this.debounceIntent('settings', () => {
      const live = this.tournament();
      if (!live) return Promise.reject(new Error('liveTournamentNotFound'));
      return this.liveRepo.updateLiveSettings(live.id, this.serverVersion, {
        name: live.name,
        leagueId: live.leagueId,
        tournamentDate: live.tournamentDate,
        roundCount: live.roundCount,
        customRoundCount: live.customRoundCount,
        paidTrackingEnabled: live.paidTrackingEnabled
      });
    });
  }

  private queuePlayerEditIntent(playerId: string): void {
    this.debounceIntent(`player:${playerId}`, () => {
      const live = this.tournament();
      if (!live) return Promise.reject(new Error('liveTournamentNotFound'));
      const player = live.players.find((item) => item.id === playerId);
      if (!player) return Promise.resolve(live); // removed before the debounce fired
      return this.liveRepo.editLivePlayer(live.id, playerId, this.serverVersion, {
        name: player.name,
        initialWins: player.initialWins,
        initialDraws: player.initialDraws,
        initialLosses: player.initialLosses,
        archetype: player.archetype
      });
    });
  }

  private queueScoreIntent(roundId: string, entryId: string): void {
    this.debounceIntent(`score:${roundId}:${entryId}`, () => {
      const live = this.tournament();
      const entry = live?.rounds.find((round) => round.id === roundId)?.entries.find((item) => item.entry.id === entryId)?.entry;
      if (!live) return Promise.reject(new Error('liveTournamentNotFound'));
      // Invalid drafts stay local-only (the UI flags them); a corrected score sends the next intent.
      if (!entry || entry.kind !== 'match' || liveMatchScoreIssue(entry)) return Promise.resolve(live);
      return this.liveRepo.scoreLiveRoundEntry(live.id, roundId, entryId, this.serverVersion, { player1Score: entry.player1Score, player2Score: entry.player2Score });
    });
  }

  /** Debounce a coalescing intent: a newer edit for the same key replaces the not-yet-sent one. */
  private debounceIntent(key: string, run: () => Promise<LiveTournamentDocument>, delay = 400): void {
    if (this.readOnly()) return;
    const existing = this.debouncedIntents.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.debouncedIntents.delete(key);
      this.queueIntent(key, run);
    }, delay);
    this.debouncedIntents.set(key, { timer, run });
  }

  /** Latest write per key wins; commands run one at a time and never queue while offline. */
  private queueIntent(key: string, run: () => Promise<LiveTournamentDocument>): void {
    if (this.readOnly() || !this.requireOnline()) return;
    this.queuedIntents.set(key, run);
    void this.pumpIntents();
  }

  private async pumpIntents(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queuedIntents.size) {
        const next = this.queuedIntents.entries().next().value as [string, () => Promise<LiveTournamentDocument>];
        this.queuedIntents.delete(next[0]);
        const saved = await next[1]();
        this.serverVersion = Math.max(this.serverVersion, saved.documentVersion);
        // Latest-response guard: only the final response (no newer local edit pending) replaces the doc.
        if (!this.queuedIntents.size && !this.debouncedIntents.size) this.applyServerDocument(saved);
      }
    } catch (error) {
      await this.handleCommandError('live-tournament.intent', error);
    } finally {
      this.pumping = false;
    }
  }

  private async flushIntents(): Promise<void> {
    for (const [key, pending] of [...this.debouncedIntents]) {
      clearTimeout(pending.timer);
      this.debouncedIntents.delete(key);
      this.queueIntent(key, pending.run);
    }
    while (this.pumping || this.queuedIntents.size) await new Promise((resolve) => setTimeout(resolve, 15));
  }

  /** Pending lock for structural commands: one server command at a time, no optimistic apply. */
  private async runExclusive(run: (version: number) => Promise<LiveTournamentDocument>): Promise<void> {
    if (this.readOnly() || this.pendingCommand()) return;
    if (!this.requireOnline()) return;
    this.pendingCommand.set(true);
    try {
      await this.flushIntents();
      const saved = await run(this.serverVersion);
      this.applyServerDocument(saved);
      this.error.set('');
      this.stale.set(false);
    } catch (error) {
      await this.handleCommandError('live-tournament.command', error);
    } finally {
      this.pendingCommand.set(false);
    }
  }

  private applyServerDocument(saved: LiveTournamentDocument): void {
    this.serverVersion = Math.max(this.serverVersion, saved.documentVersion);
    const previous = this.tournament();
    if (previous && this.activeStepKey(saved) !== this.activeStepKey(previous)) this.manuallyExpandedSteps.set(new Set<string>());
    this.tournament.set(saved);
    if (!previous || previous.name !== saved.name) this.tournamentNameDraft = saved.name;
    window.dispatchEvent(new CustomEvent('gones-live-tournament-updated', { detail: { liveTournamentId: saved.id, name: saved.name } }));
  }

  private async handleCommandError(context: string, error: unknown): Promise<void> {
    logBoundaryError(context, error, { liveTournamentId: this.tournament()?.id });
    this.clearPendingIntents();
    const kind = liveCommandError(error);
    if (kind === 'stale') {
      this.stale.set(true);
      this.error.set(this.i18n.t('live.staleDocument'));
      return;
    }
    this.error.set(kind === 'forbidden' ? this.i18n.t('live.forbidden') : this.i18n.t('live.saveFailed'));
    await this.resyncTournament();
  }

  private async resyncTournament(): Promise<void> {
    const live = this.tournament();
    if (!live) return;
    try {
      const latest = await this.liveRepo.get(live.id);
      if (latest) this.applyServerDocument(latest);
    } catch (resyncError) {
      logBoundaryError('live-tournament.resync', resyncError, { liveTournamentId: live.id });
    }
  }

  /** Writes require the server while liveServer is on — nothing is queued for later. */
  private requireOnline(): boolean {
    if (this.localMode) return true; // the browser-local store needs no connection, ever
    if (this.onlineStatus.isOnline()) return true;
    this.clearPendingIntents();
    this.error.set(this.i18n.t('live.onlineRequired'));
    return false;
  }

  private clearPendingIntents(): void {
    for (const pending of this.debouncedIntents.values()) clearTimeout(pending.timer);
    this.debouncedIntents.clear();
    this.queuedIntents.clear();
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

}

interface LiveTournamentAdvancedSettingsDialogData {
  live: LiveTournamentDocument;
  leagues: PersistedLeague[];
  canManage: boolean;
}

type LiveTournamentAdvancedSettingsDraft = Pick<LiveTournamentDocument, 'leagueId' | 'paidTrackingEnabled' | 'players'>;
type LiveTournamentAdvancedSettingsResult =
  | { kind: 'apply'; draft: LiveTournamentAdvancedSettingsDraft }
  | { kind: 'delete' };

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatSelectModule, DeckArchetypeInputComponent],
  template: `
    <h2 mat-dialog-title data-cy="live-advanced-title">{{ i18n.t('live.advancedTitle') }}</h2>
    <mat-dialog-content class="live-advanced-settings-dialog" data-cy="live-advanced-content">
      <mat-checkbox data-cy="live-tournament-paid-tracking-checkbox" [(ngModel)]="draft.paidTrackingEnabled">{{ i18n.t('live.trackPaid') }}</mat-checkbox>
      <p class="muted" data-cy="live-advanced-paid-tracking-help">{{ i18n.t('live.trackPaidHelp') }}</p>
      <mat-expansion-panel class="round-panel live-player-archetype-panel" data-cy="live-advanced-archetype-panel" [expanded]="false">
        <mat-expansion-panel-header data-cy="live-advanced-archetype-panel-header">
          <mat-panel-title class="round-panel-title" data-cy="live-advanced-archetype-panel-title">{{ i18n.t('live.deckArchetypes') }}</mat-panel-title>
          <mat-panel-description data-cy="live-advanced-archetype-panel-description">{{ i18n.plural(namedPlayers().length, 'live.playerCountOne', 'live.playerCountMany') }}</mat-panel-description>
        </mat-expansion-panel-header>
        @if (namedPlayers().length) {
          <div class="player-archetype-list live-player-archetype-list" data-cy="live-advanced-archetype-list" role="group" [attr.aria-label]="i18n.t('live.playerArchetypesAria')">
            <div class="player-archetype-list__header" data-cy="live-advanced-archetype-list-header" aria-hidden="true">
              <span data-cy="live-advanced-archetype-column-player">{{ i18n.t('common.player') }}</span>
              <span data-cy="live-advanced-archetype-column-archetype">{{ i18n.t('live.deckArchetypeCol') }}</span>
            </div>
            @for (player of namedPlayers(); track player.id; let rowIndex = $index) {
              <div class="player-archetype-row" data-cy="live-player-archetype-row">
                <label class="player-archetype-row__player" [attr.data-cy]="'live-player-archetype-label-' + rowIndex" [attr.for]="'live-player-archetype-' + rowIndex"><span class="sr-only" [attr.data-cy]="'live-player-archetype-label-sr-' + rowIndex">Deck archetype for </span>{{ player.name }}</label>
                <gones-deck-archetype-input [attr.data-cy]="'live-player-archetype-input-' + rowIndex" [inputId]="'live-player-archetype-' + rowIndex" [label]="i18n.t('live.deckArchetypeFor', { name: player.name })" [value]="player.archetype" [allowAdd]="false" (valueChange)="setPlayerArchetype(player.id, $event)" />
              </div>
            }
          </div>
        } @else { <p class="empty" data-cy="live-advanced-archetype-empty">{{ i18n.t('live.addPlayersBeforeArchetypes') }}</p> }
      </mat-expansion-panel>
    </mat-dialog-content>
    <mat-dialog-actions align="end" data-cy="live-advanced-actions">
      <button mat-button type="button" data-cy="live-advanced-cancel" (click)="close()">{{ i18n.t('common.cancel') }}</button>
      <button mat-flat-button class="home-primary-action" type="button" data-cy="live-advanced-apply" (click)="apply()">{{ i18n.t('live.applySettings') }}</button>
    </mat-dialog-actions>
    @if (data.canManage) {
      <div class="live-advanced-danger-zone" data-cy="live-advanced-danger-zone">
        <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="live-advanced-delete" (click)="requestDelete()">{{ i18n.t('live.deleteTournament') }}</button>
      </div>
    }
  `
})
export class LiveTournamentAdvancedSettingsDialogComponent {
  readonly i18n = inject(I18nService);
  readonly data = inject<LiveTournamentAdvancedSettingsDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<LiveTournamentAdvancedSettingsDialogComponent, LiveTournamentAdvancedSettingsResult>);
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
      kind: 'apply',
      draft: {
        leagueId: String(this.draft.leagueId ?? ''),
        paidTrackingEnabled: Boolean(this.draft.paidTrackingEnabled),
        players: this.draft.players.map((player) => ({ ...player, archetype: String(player.archetype ?? '').trim() }))
      }
    });
  }

  requestDelete(): void { this.dialogRef.close({ kind: 'delete' }); }
}
