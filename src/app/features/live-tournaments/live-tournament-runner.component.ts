import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
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
            <div class="live-add-player-row">
              <mat-form-field appearance="outline"><mat-label>Player name</mat-label><input matInput data-cy="live-player-name-input" [(ngModel)]="newPlayerName" [disabled]="live.stage === 'round'" (keydown.enter)="$event.preventDefault(); addPlayer()"></mat-form-field>
              <button mat-flat-button class="create-action-button" type="button" data-cy="live-add-player-button" [disabled]="live.stage === 'round'" (click)="addPlayer()"><span class="create-action-button__icon" aria-hidden="true">+</span><span>Add Player</span></button>
            </div>
            <p class="muted" data-cy="live-player-count">{{ activePlayerCount(live) }} player{{ activePlayerCount(live) === 1 ? '' : 's' }} registered</p>
            @if (!live.players.length) { <p class="empty">No players yet. Add at least two active players to start.</p> }
            @else {
              <div class="table-wrap live-player-table-wrap">
                <table class="live-player-table">
                  <thead><tr><th scope="col">Player</th>@if (live.paidTrackingEnabled) { <th scope="col">Paid</th> }<th scope="col">Dropped</th><th scope="col">Starting record</th><th scope="col">Actions</th></tr></thead>
                  <tbody>
                    @for (player of live.players; track player.id) {
                      <tr data-cy="live-player-row" [class.is-dropped]="player.dropped">
                        <td><span class="sr-only">{{ player.name }}</span><input [ngModel]="player.name" (ngModelChange)="updatePlayer(player.id, { name: $event })" [readonly]="live.rounds.length > 0" [attr.aria-label]="'Player name for ' + player.name"></td>
                        @if (live.paidTrackingEnabled) { <td><input type="checkbox" data-cy="live-player-paid-checkbox" [ngModel]="player.paid" (ngModelChange)="updatePlayer(player.id, { paid: $event })" [attr.aria-label]="'Paid status for ' + player.name" [disabled]="live.stage === 'round'"></td> }
                        <td><input type="checkbox" [ngModel]="player.dropped" (ngModelChange)="updatePlayer(player.id, { dropped: $event })" [attr.aria-label]="'Dropped status for ' + player.name" [disabled]="live.stage === 'round'"></td>
                        <td class="live-record-inputs">
                          <label><span>W</span><input type="number" min="0" [ngModel]="player.initialWins" (ngModelChange)="updatePlayer(player.id, { initialWins: numberValue($event) })"></label>
                          <label><span>D</span><input type="number" min="0" [ngModel]="player.initialDraws" (ngModelChange)="updatePlayer(player.id, { initialDraws: numberValue($event) })"></label>
                          <label><span>L</span><input type="number" min="0" [ngModel]="player.initialLosses" (ngModelChange)="updatePlayer(player.id, { initialLosses: numberValue($event) })"></label>
                        </td>
                        <td><button mat-button color="warn" type="button" data-cy="live-player-remove-button" [disabled]="live.stage === 'round'" (click)="removePlayer(player.id)">{{ live.rounds.length ? 'Drop' : 'Remove' }}</button></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            <div class="live-round-count-settings" data-cy="live-round-count-settings">
              <label class="live-custom-round-toggle"><input type="checkbox" data-cy="live-tournament-custom-round-count-checkbox" [ngModel]="live.customRoundCount" (ngModelChange)="setCustomRoundCount($event)"> <span>custom round number</span></label>
              <mat-form-field appearance="outline"><mat-label>Number of Swiss rounds</mat-label><input matInput data-cy="live-tournament-round-count-input" type="number" min="0" [ngModel]="displayRoundCount(live)" (ngModelChange)="setRoundCount($event)" [disabled]="!live.customRoundCount || live.stage !== 'registration'"></mat-form-field>
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
                <ng-container [ngTemplateOutlet]="standingsTable" [ngTemplateOutletContext]="{ rows: standingRowsForRound(live, round.roundNumber) }" />
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

      <ng-template #standingsTable let-rows="rows">
        <div class="table-wrap">
          <table class="ranking-table live-standings-table" data-cy="live-standings-table">
            <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Pts</th><th scope="col">Record</th><th scope="col">Status</th></tr></thead>
            <tbody>@for (row of rows; track row.playerId) { <tr [class.is-dropped]="row.dropped"><td>{{ row.rank }}</td><td>{{ row.playerName }}</td><td>{{ row.points }}</td><td><span class="record-win">{{ row.matchWins }}</span>-<span class="record-loss">{{ row.matchLosses }}</span>-<span class="record-draw">{{ row.matchDraws }}</span> @if (row.byes) { <span class="record-byes">({{ row.byes }} bye)</span> }</td><td>{{ playerStatus(row, live) }}</td></tr> }</tbody>
          </table>
        </div>
      </ng-template>

      <ng-template #roundTable let-round="round" let-editable="editable">
        <div class="table-wrap round-entry-table-wrap">
          <table class="ranking-table round-entry-table live-round-table" data-cy="live-round-panel">
            <thead><tr><th scope="col">Table</th><th scope="col">Player 1</th><th scope="col">Wins</th><th scope="col">Losses</th><th scope="col">Player 2</th><th scope="col">Status</th></tr></thead>
            <tbody>
              @for (item of round.entries; track item.entry.id) {
                @if (item.entry.kind === 'match') {
                  <tr [attr.data-cy]="live.stage === 'round' && round.roundNumber === live.currentRoundNumber ? 'live-match-row' : 'live-validated-match-row'" [attr.data-table]="item.entry.table" [class.is-invalid]="matchScoreIssue(item.entry)" [class.is-valid]="item.resultEntered && !matchScoreIssue(item.entry) && !isDrawMatch(item.entry)" [class.is-draw-warning]="!matchScoreIssue(item.entry) && isDrawMatch(item.entry)">
                    <td class="round-entry-table__compact">Table {{ item.entry.table }}</td>
                    <td>{{ item.entry.player1Name }}</td>
                    <td class="round-entry-table__compact"><input data-cy="live-match-player1-score" type="number" min="0" [ngModel]="item.entry.player1Score" (ngModelChange)="setMatchScore(round.id, item.entry, 'player1Score', $event)" [attr.aria-label]="'Wins for ' + item.entry.player1Name + ' at table ' + item.entry.table"></td>
                    <td class="round-entry-table__compact"><input data-cy="live-match-player2-score" type="number" min="0" [ngModel]="item.entry.player2Score" (ngModelChange)="setMatchScore(round.id, item.entry, 'player2Score', $event)" [attr.aria-label]="'Wins for ' + item.entry.player2Name + ' at table ' + item.entry.table"></td>
                    <td>{{ item.entry.player2Name }}</td>
                    <td>{{ matchScoreIssue(item.entry) || (item.resultEntered ? 'Result entered' : 'Needs result') }}</td>
                  </tr>
                } @else if (item.entry.kind === 'bye') {
                  <tr class="live-bye-row" [attr.data-cy]="live.stage === 'round' && round.roundNumber === live.currentRoundNumber ? 'live-bye-row' : 'live-validated-bye-row'"><td class="round-entry-table__compact">{{ item.entry.table }}</td><td colspan="4"><strong>{{ item.entry.playerName }}</strong> has a bye</td><td>Auto win</td></tr>
                }
              }
            </tbody>
          </table>
        </div>
      </ng-template>
    } @else { <mat-card class="panel"><mat-card-title>Live tournament not found</mat-card-title><mat-card-content><p>This live tournament does not exist or was deleted.</p></mat-card-content></mat-card> }
  `
})
export class LiveTournamentRunnerComponent implements OnDestroy {
  @ViewChild('liveTournamentNameInput') private liveTournamentNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('liveTournamentTitleButton') private liveTournamentTitleButton?: ElementRef<HTMLButtonElement>;

  readonly loading = signal(true);
  readonly error = signal('');
  readonly tournament = signal<LiveTournamentDocument | null>(null);
  readonly leagues = signal<PersistedLeague[]>([]);
  newPlayerName = '';
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
    try {
      this.leagues.set(await this.leagueRepo.listLeagues());
      const id = this.route.snapshot.paramMap.get('liveTournamentId') ?? 'new';
      if (id === 'new') {
        const created = this.withAutomaticRoundCount(await this.liveRepo.create());
        this.tournament.set(created);
        this.tournamentNameDraft = created.name;
        await this.router.navigate(['/live-tournaments', created.id], { replaceUrl: true });
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
    }
  }

  patch(patch: Partial<LiveTournamentDocument>): void { this.update((live) => this.withAutomaticRoundCount({ ...live, ...patch })); }
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
  matchScoreIssue(entry: RoundEntry): string | null { return liveMatchScoreIssue(entry); }
  isDrawMatch(entry: RoundEntry): boolean { return entry.kind === 'match' && entry.player1Score === entry.player2Score; }
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

  addPlayer(): void {
    const name = trimPlayerName(this.newPlayerName);
    if (!name) return;
    if (this.tournament()?.players.some((player) => trimPlayerName(player.name).toLowerCase() === name.toLowerCase())) {
      this.error.set('This player is already registered.');
      return;
    }
    this.error.set('');
    this.newPlayerName = '';
    this.update((live) => this.withAutomaticRoundCount({ ...live, players: [...live.players, createLiveTournamentPlayer({ name })] }));
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
    this.update((live) => this.withAutomaticRoundCount(live.rounds.length
      ? { ...live, players: live.players.map((player) => player.id === playerId ? { ...player, dropped: true } : player) }
      : { ...live, players: live.players.filter((player) => player.id !== playerId) }));
  }

  startTournament(): void { this.update((live) => generateNextSwissRound(this.withAutomaticRoundCount(live))); }
  generateNextRound(): void { this.update((live) => generateNextSwissRound(this.withAutomaticRoundCount(live))); }
  regenerateRound(): void { this.update((live) => regenerateCurrentSwissRound(live)); }
  cancelRound(): void { this.update((live) => cancelCurrentSwissRound(live)); }
  validateRound(): void { this.update((live) => validateCurrentSwissRound(live)); }
  restoreCheckpoint(checkpoint: LiveTournamentCheckpointDocument): void { this.update((live) => restoreLiveTournamentCheckpoint(live, checkpoint.id)); }

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

  private focusTournamentNameInput(): void { setTimeout(() => this.liveTournamentNameInput?.nativeElement.focus()); }
  private focusTournamentTitleButton(): void { setTimeout(() => this.liveTournamentTitleButton?.nativeElement.focus()); }

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

type LiveTournamentAdvancedSettingsDraft = Pick<LiveTournamentDocument, 'tournamentDate' | 'leagueId' | 'paidTrackingEnabled'>;

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>Advanced settings</h2>
    <mat-dialog-content class="live-advanced-settings-dialog">
      <mat-form-field appearance="outline"><mat-label>Tournament date</mat-label><input matInput data-cy="live-tournament-date-input" type="date" [(ngModel)]="draft.tournamentDate"></mat-form-field>
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
    tournamentDate: this.data.live.tournamentDate,
    leagueId: this.data.live.leagueId,
    paidTrackingEnabled: this.data.live.paidTrackingEnabled
  };

  close(): void { this.dialogRef.close(); }

  apply(): void {
    this.dialogRef.close({
      tournamentDate: String(this.draft.tournamentDate || this.data.live.tournamentDate),
      leagueId: String(this.draft.leagueId ?? ''),
      paidTrackingEnabled: Boolean(this.draft.paidTrackingEnabled)
    });
  }
}
