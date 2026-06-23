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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { LeagueRepository } from '../../data/league-repository.service';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { activeLivePlayers, autoLiveSwissRoundCount, cancelCurrentSwissRound, canStartLiveTournament, calculateLiveStandings, calculateLiveStandingsThroughRound, createLiveTournamentPlayer, currentLiveRound, currentRoundComplete, finalizeLiveTournament, generateNextSwissRound, liveMatchScoreIssue, liveTournamentFinished, LiveStandingRow, LiveTournamentCheckpointDocument, LiveTournamentDocument, LiveTournamentPlayerDocument, LiveTournamentRoundDocument, regenerateCurrentSwissRound, restoreLiveTournamentCheckpoint, unpaidActivePlayers, validateCurrentSwissRound } from '../../domain/live-tournament';
import { PersistedLeague, PLACEHOLDER_LEAGUE_ID, RoundEntry, TournamentDocument, trimPlayerName } from '../../domain/models';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { ConfirmDialogComponent } from '../../shared/dialogs';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatDialogModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/live-tournaments']" label="Back to Running Tournaments" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (loading()) { <mat-spinner diameter="40" /> }
    @else if (tournament(); as live) {
      <section class="page-heading live-tournament-title-heading">
        <div class="tournament-heading-fields">
          @if (titleEditing()) { <mat-form-field appearance="outline" class="title-field"><mat-label>Tournament name</mat-label><input #liveTournamentNameInput data-cy="live-tournament-name-input" matInput [(ngModel)]="tournamentNameDraft" (blur)="saveTitleEdit({ restoreFocus: false })" (keydown.enter)="$event.preventDefault(); saveTitleEdit({ restoreFocus: true })"></mat-form-field> }
          @else { <h1><button #liveTournamentTitleButton class="editable-title" type="button" data-cy="live-tournament-title-button" (click)="startTitleEdit()" [attr.aria-label]="'Edit Live Tournament name: ' + (live.name || 'Live Tournament')">{{ live.name || 'Live Tournament' }}</button></h1> }
        </div>
        <mat-form-field appearance="outline" class="live-tournament-date-field"><mat-label>Date</mat-label><input matInput data-cy="live-tournament-date-input" type="date" [ngModel]="live.tournamentDate" (ngModelChange)="patch({ tournamentDate: stringValue($event, live.tournamentDate) })" [disabled]="finalizing()"></mat-form-field>
      </section>
      <div class="live-warning-stack" aria-live="polite">
        @if (notEnoughPlayers(live)) {
          <div class="warning live-warning" role="status" data-cy="live-warning-not-enough-players">
            <p>Not enough player to start tournament. Add at least two active players.</p>
          </div>
        }
        @if (live.paidTrackingEnabled && unpaidPlayers().length) {
          <div class="warning live-warning" role="status" data-cy="live-warning-unpaid-players">
            <p>All players have not paid yet: {{ unpaidPlayerNames() }}.</p>
          </div>
        }
        @if (showByeWarning(live)) {
          <div class="warning live-warning" role="status" data-cy="live-warning-bye">
            <p>Odd player count: a bye will be generated this round.</p>
          </div>
        }
      </div>

      <section class="live-tournament-grid live-tournament-grid--compact">
        <mat-expansion-panel class="round-panel panel live-panel live-roster-panel" [expanded]="registrationExpanded()" (opened)="registrationExpanded.set(true)" (closed)="registrationExpanded.set(false)">
          <mat-expansion-panel-header>
            <mat-panel-title class="round-panel-title">Registration / Players</mat-panel-title>
            <mat-panel-description>{{ activePlayerCount(live) }} player{{ activePlayerCount(live) === 1 ? '' : 's' }}</mat-panel-description>
          </mat-expansion-panel-header>
          <div class="live-form-stack">
            <p class="muted" data-cy="live-player-count">{{ activePlayerCount(live) }} player{{ activePlayerCount(live) === 1 ? '' : 's' }} registered</p>
            <div class="live-registration-player-grid" aria-label="Registered players">
              @for (player of live.players; track player.id) {
                <article class="live-registration-player-card" data-cy="live-player-row" [class.is-dropped]="player.dropped">
                  <label class="live-registration-player-card__name"><span>Player</span><span class="sr-only">{{ player.name || 'New player' }}</span><input data-cy="live-player-name-input" [ngModel]="player.name" (ngModelChange)="updatePlayer(player.id, { name: $event })" [readonly]="live.stage !== 'registration'" [attr.aria-label]="player.name ? 'Player name for ' + player.name : 'Player name for new player'"></label>
                  @if (live.paidTrackingEnabled) {
                    <label class="live-registration-player-card__paid"><input type="checkbox" data-cy="live-player-paid-checkbox" [ngModel]="player.paid" (ngModelChange)="updatePlayer(player.id, { paid: $event })" [attr.aria-label]="'Paid status for ' + (player.name || 'new player')" [disabled]="live.stage === 'round'"> <span>Paid</span></label>
                  }
                  <button mat-button color="warn" type="button" data-cy="live-player-remove-button" [disabled]="live.stage !== 'registration'" (click)="removePlayer(player.id)">Remove</button>
                </article>
              }
              <article class="live-registration-player-card live-registration-add-card" data-cy="live-add-player-card">
                <label class="live-registration-player-card__name live-registration-add-card__name"><span>Player</span><span class="sr-only">New player</span><input #newPlayerNameInput data-cy="live-add-player-name-input" placeholder="Input player name" [(ngModel)]="newPlayerName" (keydown.enter)="$event.preventDefault(); addPlayer()" [disabled]="live.stage !== 'registration'" aria-label="New player name" aria-keyshortcuts="Enter"></label>
                <button mat-flat-button class="create-action-button live-registration-add-card__button" type="button" data-cy="live-add-player-button" [disabled]="!canSubmitNewPlayer(live)" (click)="addPlayer()" aria-label="Add player"><span class="create-action-button__icon" aria-hidden="true">+</span><span>Add ↵</span></button>
              </article>
            </div>
            @if (!live.players.length) { <p class="empty">No players yet. Add at least two active players to start.</p> }
            <div class="live-round-count-settings" data-cy="live-round-count-settings">
              <mat-form-field appearance="outline" class="live-round-count-field"><mat-label>Number of Swiss rounds</mat-label><input matInput data-cy="live-tournament-round-count-input" type="number" min="0" [ngModel]="displayRoundCount(live)" (ngModelChange)="setRoundCount($event)" [disabled]="!live.customRoundCount || live.stage !== 'registration'"></mat-form-field>
              <label class="live-custom-round-toggle"><span>custom round number</span> <input type="checkbox" data-cy="live-tournament-custom-round-count-checkbox" [ngModel]="live.customRoundCount" (ngModelChange)="setCustomRoundCount($event)"></label>
            </div>
          </div>
        </mat-expansion-panel>
      </section>

      @if (live.stage === 'registration') {
        <section class="live-step-panel panel">
          <h2>Step 1 — Inscription</h2>
          <p class="muted">{{ registrationCopy(live) }}</p>
          <button mat-flat-button class="home-primary-action" type="button" data-cy="live-start-tournament-button" [disabled]="!canStart(live)" (click)="startTournament()">Start Tournament & Generate Round 1</button>
          @if (!canStart(live)) { <p class="muted">Add at least two active players before starting.</p> }
        </section>
      }

      @if (live.rounds.length) {
        <section class="stack live-round-progress">
          <h2>Tournament progress</h2>
          <p class="muted">Each validated transition is saved with a restore point, so you can return to a previous pairing or standing state.</p>
          @for (round of orderedRounds(live); track round.id) {
            <section class="live-step-panel panel live-progress-section">
              <div class="section-header">
                <div><h2>Pairing {{ round.roundNumber }}</h2><p class="muted">{{ round.validated ? 'Validated pairings' : 'Round running — enter every result before validating.' }}</p></div>
                @if (checkpointFor(live, 'Pairing ' + round.roundNumber); as checkpoint) { <button mat-stroked-button class="secondary-action" type="button" (click)="restoreCheckpoint(checkpoint)">Restore {{ checkpoint.label }}</button> }
                @if (live.stage === 'round' && round.roundNumber === live.currentRoundNumber) { <div class="actions"><button mat-stroked-button class="secondary-action" type="button" data-cy="live-regenerate-pairings-button" (click)="regenerateRound()">Regenerate Pairings</button><button mat-stroked-button class="secondary-action" type="button" data-cy="live-cancel-round-button" (click)="cancelRound()">Cancel Round</button></div> }
              </div>
              <ng-container [ngTemplateOutlet]="roundTable" [ngTemplateOutletContext]="{ round: round, editable: true }" />
              @if (live.stage === 'round' && round.roundNumber === live.currentRoundNumber) {
                @if (allCurrentMatchesAreDraws(live)) { <p class="warning" role="status" data-cy="live-all-draws-warning">All current matches are draws. Confirm this is intentional before validating.</p> }
                <button mat-flat-button class="home-primary-action" type="button" data-cy="live-validate-round-button" [disabled]="!currentRoundComplete(live)" [attr.title]="validateRoundTitle(live)" (click)="validateRound()">Validate Round & View Standings</button>
                @if (!currentRoundComplete(live)) { <p class="muted">The validate button unlocks once every match result is entered and every score is valid.</p> }
              }
            </section>

            @if (round.validated) {
              <section class="live-step-panel panel live-progress-section">
                <div class="section-header">
                  <div><h2>Standing {{ round.roundNumber }}</h2><p class="muted">Standings after round {{ round.roundNumber }}.</p></div>
                  @if (checkpointFor(live, 'Standing ' + round.roundNumber); as checkpoint) { <button mat-stroked-button class="secondary-action" type="button" (click)="restoreCheckpoint(checkpoint)">Restore {{ checkpoint.label }}</button> }
                  @if (checkpointFor(live, 'Pairing ' + round.roundNumber); as pairingCheckpoint) { <button mat-stroked-button class="secondary-action" type="button" data-cy="live-cancel-standings-button" (click)="restoreCheckpoint(pairingCheckpoint)">Cancel Standings</button> }
                </div>
                @if (canEditStanding(live, round.roundNumber)) {
                  <div class="live-standing-add-player" data-cy="live-standing-add-player-form">
                    <mat-form-field appearance="outline"><mat-label>New player name</mat-label><input matInput data-cy="live-standing-player-name-input" [(ngModel)]="latePlayerDraft.name" (keydown.enter)="$event.preventDefault(); addLatePlayer(round.roundNumber)"></mat-form-field>
                    <div class="live-record-inputs live-standing-record-inputs" aria-label="Starting record for new player">
                      <label><span>W</span><input data-cy="live-standing-player-wins-input" type="number" inputmode="numeric" step="1" min="0" [ngModel]="latePlayerDraft.wins" (ngModelChange)="setLatePlayerRecord('wins', $event)" [attr.aria-invalid]="latePlayerRecordIssue(round.roundNumber) ? 'true' : null" [attr.aria-describedby]="latePlayerRecordIssue(round.roundNumber) ? 'late-player-record-issue-' + round.roundNumber : null"></label>
                      <label><span>D</span><input data-cy="live-standing-player-draws-input" type="number" inputmode="numeric" step="1" min="0" [ngModel]="latePlayerDraft.draws" (ngModelChange)="setLatePlayerRecord('draws', $event)" [attr.aria-invalid]="latePlayerRecordIssue(round.roundNumber) ? 'true' : null" [attr.aria-describedby]="latePlayerRecordIssue(round.roundNumber) ? 'late-player-record-issue-' + round.roundNumber : null"></label>
                      <label><span>L</span><input data-cy="live-standing-player-losses-input" type="number" inputmode="numeric" step="1" min="0" [ngModel]="latePlayerDraft.losses" (ngModelChange)="setLatePlayerRecord('losses', $event)" [attr.aria-invalid]="latePlayerRecordIssue(round.roundNumber) ? 'true' : null" [attr.aria-describedby]="latePlayerRecordIssue(round.roundNumber) ? 'late-player-record-issue-' + round.roundNumber : null"></label>
                    </div>
                    <button mat-flat-button class="create-action-button" type="button" data-cy="live-standing-add-player-button" [disabled]="!canAddLatePlayer(live, round.roundNumber)" (click)="addLatePlayer(round.roundNumber)"><span class="create-action-button__icon" aria-hidden="true">+</span><span>Add Player</span></button>
                    @if (latePlayerRecordIssue(round.roundNumber)) { <p class="warning" role="status" [id]="'late-player-record-issue-' + round.roundNumber">{{ latePlayerRecordIssue(round.roundNumber) }}</p> }
                  </div>
                }
                <ng-container [ngTemplateOutlet]="standingsTable" [ngTemplateOutletContext]="{ rows: standingRowsForRound(live, round.roundNumber), roundNumber: round.roundNumber, live: live }" />
                @if (live.currentRoundNumber === round.roundNumber && (live.stage === 'standings' || live.stage === 'completed')) {
                  <div class="actions live-next-actions">
                    @if (!finished(live)) { <button mat-flat-button class="create-action-button" type="button" data-cy="live-generate-next-round-button" (click)="generateNextRound()"><span class="create-action-button__icon" aria-hidden="true">+</span><span>Generate Round {{ validatedRoundCount(live) + 1 }}</span></button> }
                    @else { <button mat-flat-button class="home-primary-action" type="button" data-cy="live-archive-tournament-button" [disabled]="finalizing()" (click)="finalize()">{{ finalizing() ? 'Archiving…' : 'Archive Tournament' }}</button> }
                  </div>
                  @if (finished(live) && !live.leagueId) { <p class="warning" role="status">No league selected. Finalizing will attach this tournament to Unassigned Tournaments.</p> }
                }
              </section>
            }
          }
        </section>
      }

      <ng-template #standingsTable let-rows="rows" let-roundNumber="roundNumber" let-live="live">
        <div class="table-wrap">
          <table class="ranking-table live-standings-table" data-cy="live-standings-table">
            <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Pts</th><th scope="col">Record</th><th scope="col">OMW</th><th scope="col">GWR</th><th scope="col">OGW</th><th scope="col">Status</th>@if (canEditStanding(live, roundNumber)) { <th scope="col">Actions</th> }</tr></thead>
            <tbody>@for (row of rows; track row.playerId) { <tr [class.is-dropped]="row.dropped"><td>{{ row.rank }}</td><td>{{ row.playerName }}</td><td>{{ row.points }}</td><td><span class="record-win">{{ row.matchWins }}</span>-<span class="record-loss">{{ row.matchLosses }}</span>-<span class="record-draw">{{ row.matchDraws }}</span> @if (row.byes) { <span class="record-byes">({{ row.byes }} bye)</span> }</td><td>{{ formatPercentage(row.opponentsMatchWinPercentage) }}</td><td>{{ formatPercentage(row.gameWinPercentage) }}</td><td>{{ formatPercentage(row.opponentsGameWinPercentage) }}</td><td>{{ playerStatus(row, live) }}</td>@if (canEditStanding(live, roundNumber)) { <td><button mat-button color="warn" type="button" data-cy="live-standing-drop-player-button" [disabled]="row.dropped" [attr.aria-label]="standingPlayerActionLabel(live, row) + ' ' + row.playerName" (click)="confirmDropPlayer(row)">{{ standingPlayerActionLabel(live, row) }}</button></td> }</tr> }</tbody>
          </table>
        </div>
      </ng-template>

      <ng-template #roundTable let-round="round" let-editable="editable">
        <div class="live-round-card-grid round-entry-table-wrap" data-cy="live-round-panel" role="list" aria-label="Round pairings">
          @for (item of round.entries; track item.entry.id) {
            @if (item.entry.kind === 'match') {
              <article class="live-round-card" role="listitem" [attr.data-cy]="live.stage === 'round' && round.roundNumber === live.currentRoundNumber ? 'live-match-row' : 'live-validated-match-row'" [attr.data-table]="item.entry.table" [class.is-invalid]="matchScoreIssue(item.entry)" [class.is-valid]="item.resultEntered && !matchScoreIssue(item.entry) && !isDrawMatch(item.entry)" [class.is-draw-warning]="!matchScoreIssue(item.entry) && isDrawMatch(item.entry)">
                <div class="live-round-card__table round-entry-table__number">Table {{ item.entry.table }} @if (matchScoreIssue(item.entry)) { <span class="sr-only" [id]="'live-match-score-issue-' + item.entry.id">{{ matchScoreIssue(item.entry) }}</span> }</div>
                <div class="live-round-card__player live-round-card__player--one">
                  <span class="round-entry-table__player">{{ item.entry.player1Name }}</span>
                  <div class="score-stepper"><button class="score-stepper__button score-stepper__button--decrement" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player1Score', -1)" [disabled]="!canAdjustMatchScore(item.entry, 'player1Score', -1)" [attr.aria-label]="'Decrease score for ' + item.entry.player1Name">−</button><input data-cy="live-match-player1-score" type="number" inputmode="numeric" step="1" min="0" [ngModel]="item.entry.player1Score" (ngModelChange)="setMatchScore(round.id, item.entry, 'player1Score', $event)" [attr.aria-label]="'Score player 1 for ' + item.entry.player1Name + ' at table ' + item.entry.table" [attr.aria-invalid]="matchScoreIssue(item.entry) ? 'true' : null" [attr.aria-describedby]="matchScoreIssue(item.entry) ? 'live-match-score-issue-' + item.entry.id : null"><button class="score-stepper__button score-stepper__button--increment" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player1Score', 1)" [disabled]="!canAdjustMatchScore(item.entry, 'player1Score', 1)" [attr.aria-label]="'Increase score for ' + item.entry.player1Name">+</button></div>
                </div>
                <span class="live-round-card__versus" aria-label="versus">VS</span>
                <div class="live-round-card__player live-round-card__player--two">
                  <div class="score-stepper"><button class="score-stepper__button score-stepper__button--decrement" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player2Score', -1)" [disabled]="!canAdjustMatchScore(item.entry, 'player2Score', -1)" [attr.aria-label]="'Decrease score for ' + item.entry.player2Name">−</button><input data-cy="live-match-player2-score" type="number" inputmode="numeric" step="1" min="0" [ngModel]="item.entry.player2Score" (ngModelChange)="setMatchScore(round.id, item.entry, 'player2Score', $event)" [attr.aria-label]="'Score player 2 for ' + item.entry.player2Name + ' at table ' + item.entry.table" [attr.aria-invalid]="matchScoreIssue(item.entry) ? 'true' : null" [attr.aria-describedby]="matchScoreIssue(item.entry) ? 'live-match-score-issue-' + item.entry.id : null"><button class="score-stepper__button score-stepper__button--increment" type="button" (click)="adjustMatchScore(round.id, item.entry, 'player2Score', 1)" [disabled]="!canAdjustMatchScore(item.entry, 'player2Score', 1)" [attr.aria-label]="'Increase score for ' + item.entry.player2Name">+</button></div>
                  <span class="round-entry-table__player">{{ item.entry.player2Name }}</span>
                </div>
              </article>
            } @else if (item.entry.kind === 'bye') {
              <article class="live-round-card live-bye-row" role="listitem" [attr.data-cy]="live.stage === 'round' && round.roundNumber === live.currentRoundNumber ? 'live-bye-row' : 'live-validated-bye-row'">
                <div class="live-round-card__table round-entry-table__number">Table {{ item.entry.table }}</div>
                <div class="live-round-card__bye"><strong>{{ item.entry.playerName }}</strong> has a bye — automatic win</div>
              </article>
            }
          }
        </div>
      </ng-template>
    } @else { <mat-card class="panel"><mat-card-title>Live tournament not found</mat-card-title><mat-card-content><p>This live tournament does not exist or was deleted.</p></mat-card-content></mat-card> }
  `
})
export class LiveTournamentRunnerComponent implements OnDestroy {
  @ViewChild('liveTournamentNameInput') private liveTournamentNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('liveTournamentTitleButton') private liveTournamentTitleButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('newPlayerNameInput') private newPlayerNameInput?: ElementRef<HTMLInputElement>;

  readonly loading = signal(true);
  readonly error = signal('');
  readonly tournament = signal<LiveTournamentDocument | null>(null);
  readonly leagues = signal<PersistedLeague[]>([]);
  newPlayerName = '';
  latePlayerDraft = { name: '', wins: 0, draws: 0, losses: 0 };
  tournamentNameDraft = '';
  readonly titleEditing = signal(false);
  readonly registrationExpanded = signal(true);
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
      this.error.set('Could not load this live tournament.');
    } finally {
      this.loading.set(false);
      if (editTitleAfterLoad) this.startTitleEdit();
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
  stageLabel(live: LiveTournamentDocument): string { return live.stage === 'registration' ? 'Registration' : live.stage === 'round' ? `Round ${live.currentRoundNumber} running` : live.stage === 'standings' ? 'Between rounds' : 'Completed'; }
  registrationCopy(live: LiveTournamentDocument): string { return live.paidTrackingEnabled ? 'Add players and mark who has paid. Unpaid players can still be paired.' : 'Add players and start the tournament. Paid-player tracking is disabled in advanced settings.'; }
  playerStatus(row: LiveStandingRow, live: LiveTournamentDocument): string { return row.dropped ? 'Dropped' : live.paidTrackingEnabled ? (row.paid ? 'Paid' : 'Unpaid') : 'Active'; }
  standingPlayerActionLabel(live: LiveTournamentDocument, row: LiveStandingRow): 'Drop' | 'Remove' { return this.canDeleteStandingPlayer(live, row) ? 'Remove' : 'Drop'; }
  canEditStanding(live: LiveTournamentDocument, roundNumber: number): boolean { return live.stage === 'standings' && live.currentRoundNumber === roundNumber; }
  matchScoreIssue(entry: RoundEntry): string | null { return liveMatchScoreIssue(entry); }
  isDrawMatch(entry: RoundEntry): boolean { return entry.kind === 'match' && entry.player1Score === entry.player2Score; }
  formatPercentage(value: number): string { return `${Math.round(value * 100)}%`; }
  canAdjustMatchScore(entry: Extract<RoundEntry, { kind: 'match' }>, field: 'player1Score' | 'player2Score', delta: -1 | 1): boolean {
    const nextScore = entry[field] + delta;
    return Number.isInteger(nextScore) && nextScore >= 0;
  }
  allCurrentMatchesAreDraws(live: LiveTournamentDocument): boolean {
    const round = currentLiveRound(live);
    const matches = round?.entries.filter((item) => item.entry.kind === 'match') ?? [];
    return live.stage === 'round' && matches.length > 0 && matches.every((item) => item.entry.kind === 'match' && !liveMatchScoreIssue(item.entry) && item.entry.player1Score === item.entry.player2Score);
  }
  validateRoundTitle(live: LiveTournamentDocument): string | null {
    const invalidTables = this.invalidCurrentRoundTables(live);
    return invalidTables.length ? `Invalid result at ${invalidTables.map((table) => `table ${table}`).join(', ')}` : null;
  }

  startTitleEdit(): void {
    const live = this.tournament();
    if (!live || this.finalizing()) return;
    this.tournamentNameDraft = live.name;
    this.titleEditing.set(true);
    this.focusTournamentNameInput();
  }

  saveTitleEdit({ restoreFocus }: { restoreFocus: boolean }): void {
    const live = this.tournament();
    if (!live || !this.titleEditing() || this.finalizing()) return;
    const name = String(this.tournamentNameDraft || live.name || 'Live Tournament').trim() || 'Live Tournament';
    this.tournamentNameDraft = name;
    this.titleEditing.set(false);
    if (name !== live.name) this.patch({ name });
    if (restoreFocus) this.focusTournamentTitleButton();
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
      this.error.set('This player is already registered.');
      this.focusNewPlayerNameInput();
      return;
    }
    this.error.set('');
    this.newPlayerName = '';
    const player = createLiveTournamentPlayer({ name });
    this.update((current) => this.withAutomaticRoundCount({ ...current, players: [player, ...current.players] }));
    this.focusNewPlayerNameInput();
  }

  setLatePlayerRecord(field: 'wins' | 'draws' | 'losses', value: unknown): void {
    this.latePlayerDraft = { ...this.latePlayerDraft, [field]: this.numberValue(value) };
  }

  latePlayerRecordIssue(roundNumber: number): string {
    const total = this.latePlayerRecordTotal();
    return total > roundNumber ? `Record total cannot be over ${roundNumber} played round${roundNumber === 1 ? '' : 's'}.` : '';
  }

  canAddLatePlayer(live: LiveTournamentDocument, roundNumber: number): boolean {
    const name = trimPlayerName(this.latePlayerDraft.name);
    return this.canEditStanding(live, roundNumber) && Boolean(name) && !this.playerNameExists(live, name) && !this.latePlayerRecordIssue(roundNumber);
  }

  addLatePlayer(roundNumber: number): void {
    const live = this.tournament();
    if (!live || !this.canAddLatePlayer(live, roundNumber)) {
      if (this.latePlayerRecordIssue(roundNumber)) this.error.set(this.latePlayerRecordIssue(roundNumber));
      return;
    }
    const name = trimPlayerName(this.latePlayerDraft.name);
    this.error.set('');
    const { wins, draws, losses } = this.latePlayerDraft;
    this.latePlayerDraft = { name: '', wins: 0, draws: 0, losses: 0 };
    this.update((current) => ({
      ...current,
      players: [...current.players, createLiveTournamentPlayer({ name, initialWins: wins, initialDraws: draws, initialLosses: losses })]
    }));
  }

  async confirmDropPlayer(row: LiveStandingRow): Promise<void> {
    if (row.dropped) return;
    const live = this.tournament();
    const deleteInsteadOfDrop = live ? this.canDeleteStandingPlayer(live, row) : false;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: deleteInsteadOfDrop ? 'Remove Player' : 'Drop Player',
        message: deleteInsteadOfDrop
          ? `Remove ${row.playerName}? They were added during this standings step and have not been paired yet.`
          : `Drop ${row.playerName}? They stay in completed standings but will not be paired in future rounds.`,
        confirmLabel: deleteInsteadOfDrop ? 'Remove Player' : 'Drop Player',
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
        this.error.set('Player names must be unique.');
        return live;
      }
      return this.withAutomaticRoundCount({ ...live, players: live.players.map((player) => player.id === playerId ? { ...player, ...patch, name: nextName === null ? player.name : nextName } : player) });
    });
  }

  removePlayer(playerId: string): void {
    this.update((live) => live.stage === 'registration'
      ? this.withAutomaticRoundCount({ ...live, players: live.players.filter((player) => player.id !== playerId) })
      : live);
  }

  startTournament(): void { this.update((live) => generateNextSwissRound(this.withAutomaticRoundCount(live))); }
  generateNextRound(): void { this.update((live) => generateNextSwissRound(this.withAutomaticRoundCount(live))); }
  regenerateRound(): void { this.update((live) => regenerateCurrentSwissRound(live)); }
  cancelRound(): void { this.update((live) => cancelCurrentSwissRound(live)); }
  validateRound(): void { this.update((live) => validateCurrentSwissRound(live)); }
  restoreCheckpoint(checkpoint: LiveTournamentCheckpointDocument): void { this.update((live) => restoreLiveTournamentCheckpoint(live, checkpoint.id)); }

  adjustMatchScore(roundId: string, entry: Extract<RoundEntry, { kind: 'match' }>, field: 'player1Score' | 'player2Score', delta: -1 | 1): void {
    if (!this.canAdjustMatchScore(entry, field, delta)) return;
    this.setMatchScore(roundId, entry, field, entry[field] + delta);
  }

  setMatchScore(roundId: string, entry: Extract<RoundEntry, { kind: 'match' }>, field: 'player1Score' | 'player2Score', value: unknown): void {
    const score = this.numberValue(value);
    this.update((live) => {
      if (live.stage === 'completed') return live;
      const editedRound = live.rounds.find((round) => round.id === roundId);
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
      if (!league) { this.error.set('Selected league could not be found.'); return; }
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
      this.error.set('Could not finalize this live tournament. Reload the latest league data and try again.');
    } finally {
      this.finalizing.set(false);
    }
  }

  saveDraft(): void { void this.persist(); }

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

  private latePlayerRecordTotal(): number {
    return this.latePlayerDraft.wins + this.latePlayerDraft.draws + this.latePlayerDraft.losses;
  }

  private playerNameExists(live: LiveTournamentDocument, name: string): boolean {
    return live.players.some((player) => trimPlayerName(player.name).toLowerCase() === name.toLowerCase());
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
    const updated = updater(live);
    this.tournament.set(updated);
    if (!this.titleEditing()) this.tournamentNameDraft = updated.name;
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
  private focusTournamentTitleButton(): void { setTimeout(() => this.liveTournamentTitleButton?.nativeElement.focus()); }

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
    catch (error) { logBoundaryError('live-tournament.save', error, { liveTournamentId: live.id }); this.error.set('Could not save this live tournament.'); }
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

type LiveTournamentAdvancedSettingsDraft = Pick<LiveTournamentDocument, 'leagueId' | 'paidTrackingEnabled'>;

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Advanced settings</h2>
    <mat-dialog-content class="live-advanced-settings-dialog">
      <mat-form-field appearance="outline"><mat-label>League for finalization</mat-label><mat-select data-cy="live-tournament-league-select" [(ngModel)]="draft.leagueId"><mat-option value="">Unassigned Tournaments</mat-option>@for (league of data.leagues; track league.id) { <mat-option [value]="league.id">{{ league.name }}</mat-option> }</mat-select></mat-form-field>
      <mat-checkbox data-cy="live-tournament-paid-tracking-checkbox" [(ngModel)]="draft.paidTrackingEnabled">Track paid players</mat-checkbox>
      <p class="muted">Turn this off to deactivate the paid option, hide paid checkboxes, and suppress unpaid-player warnings for this tournament.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="close()">Cancel</button>
      <button mat-flat-button class="home-primary-action" type="button" (click)="apply()">Apply settings</button>
    </mat-dialog-actions>
  `
})
export class LiveTournamentAdvancedSettingsDialogComponent {
  readonly data = inject<LiveTournamentAdvancedSettingsDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<LiveTournamentAdvancedSettingsDialogComponent, LiveTournamentAdvancedSettingsDraft>);
  readonly draft: LiveTournamentAdvancedSettingsDraft = {
    leagueId: this.data.live.leagueId,
    paidTrackingEnabled: this.data.live.paidTrackingEnabled
  };

  close(): void { this.dialogRef.close(); }

  apply(): void {
    this.dialogRef.close({
      leagueId: String(this.draft.leagueId ?? ''),
      paidTrackingEnabled: Boolean(this.draft.paidTrackingEnabled)
    });
  }
}
