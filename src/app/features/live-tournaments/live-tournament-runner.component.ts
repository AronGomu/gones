import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { LeagueRepository } from '../../data/league-repository.service';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { cancelCurrentSwissRound, canStartLiveTournament, calculateLiveStandings, calculateLiveStandingsThroughRound, createLiveTournamentPlayer, currentLiveRound, currentRoundComplete, finalizeLiveTournament, generateNextSwissRound, liveTournamentFinished, LiveStandingRow, LiveTournamentCheckpointDocument, LiveTournamentDocument, LiveTournamentPlayerDocument, LiveTournamentRoundDocument, regenerateCurrentSwissRound, restoreLiveTournamentCheckpoint, unpaidActivePlayers, validateCurrentSwissRound } from '../../domain/live-tournament';
import { PersistedLeague, PLACEHOLDER_LEAGUE_ID, RoundEntry, TournamentDocument, trimPlayerName } from '../../domain/models';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCardModule, MatCheckboxModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/live-tournaments']" label="Back to Running Tournaments" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (loading()) { <mat-spinner diameter="40" /> }
    @else if (tournament(); as live) {
      <section class="page-heading live-tournament-heading" (input)="saveDraft()">
        <div>
          <p class="kicker">Live Tournament</p>
          <h1>{{ live.name || 'Live Tournament' }}</h1>
          <p class="muted">{{ stageLabel(live) }} · Swiss · {{ live.roundCount }} rounds</p>
        </div>
        <div class="actions">
          <button mat-stroked-button class="secondary-action" type="button" (click)="saveDraft()">Save Live Tournament</button>
        </div>
      </section>

      @if (unpaidPlayers().length) {
        <div class="warning live-warning" role="status">
          <p>{{ unpaidPlayers().length }} active player{{ unpaidPlayers().length === 1 ? '' : 's' }} not marked as paid: {{ unpaidPlayerNames() }}.</p>
        </div>
      }

      <section class="live-tournament-grid">
        <mat-card class="panel live-panel">
          <mat-card-title>Setup</mat-card-title>
          <mat-card-content class="live-form-stack" (input)="saveDraft()">
            <mat-form-field appearance="outline"><mat-label>Tournament name</mat-label><input matInput [ngModel]="live.name" (ngModelChange)="patch({ name: $event })"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Tournament date</mat-label><input matInput type="date" [ngModel]="live.tournamentDate" (ngModelChange)="patch({ tournamentDate: $event })"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>League for finalization</mat-label><mat-select [ngModel]="live.leagueId" (ngModelChange)="patch({ leagueId: $event })"><mat-option value="">Unassigned Tournaments</mat-option>@for (league of leagues(); track league.id) { <mat-option [value]="league.id">{{ league.name }}</mat-option> }</mat-select></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Number of Swiss rounds</mat-label><input matInput type="number" min="1" [ngModel]="live.roundCount" (ngModelChange)="setRoundCount($event)" [readonly]="live.stage !== 'registration'"></mat-form-field>
          </mat-card-content>
        </mat-card>

        <mat-card class="panel live-panel live-roster-panel">
          <mat-card-title>Registration / Players</mat-card-title>
          <mat-card-content class="live-form-stack">
            <div class="live-add-player-row">
              <mat-form-field appearance="outline"><mat-label>Player name</mat-label><input matInput [(ngModel)]="newPlayerName" (keydown.enter)="$event.preventDefault(); addPlayer()"></mat-form-field>
              <button mat-flat-button class="create-action-button" type="button" (click)="addPlayer()"><span class="create-action-button__icon" aria-hidden="true">+</span><span>Add Player</span></button>
            </div>
            @if (!live.players.length) { <p class="empty">No players yet. Add at least two active players to start.</p> }
            @else {
              <div class="table-wrap live-player-table-wrap">
                <table class="live-player-table">
                  <thead><tr><th scope="col">Player</th><th scope="col">Paid</th><th scope="col">Dropped</th><th scope="col">Starting record</th><th scope="col">Actions</th></tr></thead>
                  <tbody>
                    @for (player of live.players; track player.id) {
                      <tr [class.is-dropped]="player.dropped">
                        <td><input [ngModel]="player.name" (ngModelChange)="updatePlayer(player.id, { name: $event })" [readonly]="live.rounds.length > 0" [attr.aria-label]="'Player name for ' + player.name"></td>
                        <td><mat-checkbox [ngModel]="player.paid" (ngModelChange)="updatePlayer(player.id, { paid: $event })" [attr.aria-label]="'Paid status for ' + player.name"></mat-checkbox></td>
                        <td><mat-checkbox [ngModel]="player.dropped" (ngModelChange)="updatePlayer(player.id, { dropped: $event })" [attr.aria-label]="'Dropped status for ' + player.name"></mat-checkbox></td>
                        <td class="live-record-inputs">
                          <label><span>W</span><input type="number" min="0" [ngModel]="player.initialWins" (ngModelChange)="updatePlayer(player.id, { initialWins: numberValue($event) })"></label>
                          <label><span>D</span><input type="number" min="0" [ngModel]="player.initialDraws" (ngModelChange)="updatePlayer(player.id, { initialDraws: numberValue($event) })"></label>
                          <label><span>L</span><input type="number" min="0" [ngModel]="player.initialLosses" (ngModelChange)="updatePlayer(player.id, { initialLosses: numberValue($event) })"></label>
                        </td>
                        <td><button mat-button color="warn" type="button" (click)="removePlayer(player.id)">{{ live.rounds.length ? 'Drop' : 'Remove' }}</button></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </mat-card-content>
        </mat-card>
      </section>

      @if (live.stage === 'registration') {
        <section class="live-step-panel panel">
          <h2>Step 1 — Inscription</h2>
          <p class="muted">Select Swiss rounds, add players, and mark who has paid. Unpaid players can still be paired.</p>
          <button mat-flat-button class="home-primary-action" type="button" [disabled]="!canStart(live)" (click)="startTournament()">Start Tournament & Generate Round 1</button>
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
                @if (live.stage === 'round' && round.roundNumber === live.currentRoundNumber) { <div class="actions"><button mat-stroked-button class="secondary-action" type="button" (click)="regenerateRound()">Regenerate Pairings</button><button mat-stroked-button class="secondary-action" type="button" (click)="cancelRound()">Cancel Round</button></div> }
              </div>
              <ng-container [ngTemplateOutlet]="roundTable" [ngTemplateOutletContext]="{ round: round, editable: true }" />
              @if (live.stage === 'round' && round.roundNumber === live.currentRoundNumber) {
                <button mat-flat-button class="home-primary-action" type="button" [disabled]="!currentRoundComplete(live)" (click)="validateRound()">Validate Round & View Standings</button>
                @if (!currentRoundComplete(live)) { <p class="muted">The validate button unlocks once every match result is entered.</p> }
              }
            </section>

            @if (round.validated) {
              <section class="live-step-panel panel live-progress-section">
                <div class="section-header">
                  <div><h2>Standing {{ round.roundNumber }}</h2><p class="muted">Standings after round {{ round.roundNumber }}.</p></div>
                  @if (checkpointFor(live, 'Standing ' + round.roundNumber); as checkpoint) { <button mat-stroked-button class="secondary-action" type="button" (click)="restoreCheckpoint(checkpoint)">Restore {{ checkpoint.label }}</button> }
                </div>
                <ng-container [ngTemplateOutlet]="standingsTable" [ngTemplateOutletContext]="{ rows: standingRowsForRound(live, round.roundNumber) }" />
                @if (live.currentRoundNumber === round.roundNumber && (live.stage === 'standings' || live.stage === 'completed')) {
                  <div class="actions live-next-actions">
                    @if (!finished(live)) { <button mat-flat-button class="create-action-button" type="button" (click)="generateNextRound()"><span class="create-action-button__icon" aria-hidden="true">+</span><span>Generate Round {{ validatedRoundCount(live) + 1 }}</span></button> }
                    @else { <button mat-flat-button class="home-primary-action" type="button" [disabled]="finalizing()" (click)="finalize()">{{ finalizing() ? 'Finalizing…' : 'Finalize Tournament' }}</button> }
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
          <table class="ranking-table live-standings-table">
            <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Pts</th><th scope="col">Record</th><th scope="col">Status</th></tr></thead>
            <tbody>@for (row of rows; track row.playerId) { <tr [class.is-dropped]="row.dropped"><td>{{ row.rank }}</td><td>{{ row.playerName }}</td><td>{{ row.points }}</td><td><span class="record-win">{{ row.matchWins }}</span>-<span class="record-loss">{{ row.matchLosses }}</span>-<span class="record-draw">{{ row.matchDraws }}</span> @if (row.byes) { <span class="record-byes">({{ row.byes }} bye)</span> }</td><td>{{ row.dropped ? 'Dropped' : (row.paid ? 'Paid' : 'Unpaid') }}</td></tr> }</tbody>
          </table>
        </div>
      </ng-template>

      <ng-template #roundTable let-round="round" let-editable="editable">
        <div class="table-wrap round-entry-table-wrap">
          <table class="ranking-table round-entry-table live-round-table">
            <thead><tr><th scope="col">Table</th><th scope="col">Player 1</th><th scope="col">Wins</th><th scope="col">Losses</th><th scope="col">Player 2</th><th scope="col">Status</th></tr></thead>
            <tbody>
              @for (item of round.entries; track item.entry.id) {
                @if (item.entry.kind === 'match') {
                  <tr>
                    <td class="round-entry-table__compact">{{ item.entry.table }}</td>
                    <td>{{ item.entry.player1Name }}</td>
                    <td class="round-entry-table__compact"><input type="number" min="0" [ngModel]="item.entry.player1Score" (ngModelChange)="setMatchScore(round.id, item.entry, 'player1Score', $event)" [attr.aria-label]="'Wins for ' + item.entry.player1Name + ' at table ' + item.entry.table"></td>
                    <td class="round-entry-table__compact"><input type="number" min="0" [ngModel]="item.entry.player2Score" (ngModelChange)="setMatchScore(round.id, item.entry, 'player2Score', $event)" [attr.aria-label]="'Wins for ' + item.entry.player2Name + ' at table ' + item.entry.table"></td>
                    <td>{{ item.entry.player2Name }}</td>
                    <td>{{ item.resultEntered ? 'Result entered' : 'Needs result' }}</td>
                  </tr>
                } @else if (item.entry.kind === 'bye') {
                  <tr class="live-bye-row"><td class="round-entry-table__compact">{{ item.entry.table }}</td><td colspan="4"><strong>{{ item.entry.playerName }}</strong> has a bye</td><td>Auto win</td></tr>
                }
              }
            </tbody>
          </table>
        </div>
      </ng-template>
    } @else { <mat-card class="panel"><mat-card-title>Live tournament not found</mat-card-title><mat-card-content><p>This live tournament does not exist or was deleted.</p></mat-card-content></mat-card> }
  `
})
export class LiveTournamentRunnerComponent {
  readonly loading = signal(true);
  readonly error = signal('');
  readonly tournament = signal<LiveTournamentDocument | null>(null);
  readonly leagues = signal<PersistedLeague[]>([]);
  newPlayerName = '';
  readonly finalizing = signal(false);
  private saving = false;
  private pendingSave = false;
  readonly unpaidPlayers = computed(() => this.tournament() ? unpaidActivePlayers(this.tournament()!) : []);
  readonly unpaidPlayerNames = computed(() => this.unpaidPlayers().map((player) => player.name).join(', '));
  readonly currentRound = computed(() => this.tournament() ? currentLiveRound(this.tournament()!) : null);
  readonly standings = computed(() => this.tournament() ? calculateLiveStandings(this.tournament()!) : []);

  constructor(private readonly liveRepo: LiveTournamentRepository, private readonly leagueRepo: LeagueRepository, private readonly route: ActivatedRoute, private readonly router: Router) { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.leagues.set(await this.leagueRepo.listLeagues());
      const id = this.route.snapshot.paramMap.get('liveTournamentId') ?? 'new';
      if (id === 'new') {
        const created = await this.liveRepo.create();
        this.tournament.set(created);
        await this.router.navigate(['/live-tournaments', created.id], { replaceUrl: true });
      } else {
        this.tournament.set(await this.liveRepo.get(id));
      }
    } catch (error) {
      logBoundaryError('live-tournament.load', error);
      this.error.set('Could not load this live tournament.');
    } finally {
      this.loading.set(false);
    }
  }

  patch(patch: Partial<LiveTournamentDocument>): void { this.update((live) => ({ ...live, ...patch })); }
  numberValue(value: unknown): number { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; }
  setRoundCount(value: unknown): void { this.patch({ roundCount: Math.max(1, this.numberValue(value)) }); }
  canStart(live: LiveTournamentDocument): boolean { return canStartLiveTournament(live); }
  currentRoundComplete(live: LiveTournamentDocument): boolean { return currentRoundComplete(live); }
  finished(live: LiveTournamentDocument): boolean { return liveTournamentFinished(live); }
  validatedRoundCount(live: LiveTournamentDocument): number { return live.rounds.filter((round) => round.validated).length; }
  orderedRounds(live: LiveTournamentDocument): LiveTournamentRoundDocument[] { return [...live.rounds].sort((left, right) => left.roundNumber - right.roundNumber); }
  standingRowsForRound(live: LiveTournamentDocument, roundNumber: number): LiveStandingRow[] { return calculateLiveStandingsThroughRound(live, roundNumber); }
  checkpointFor(live: LiveTournamentDocument, label: string): LiveTournamentCheckpointDocument | null { return [...live.checkpoints].reverse().find((checkpoint) => checkpoint.label === label) ?? null; }
  stageLabel(live: LiveTournamentDocument): string { return live.stage === 'registration' ? 'Registration' : live.stage === 'round' ? `Round ${live.currentRoundNumber} running` : live.stage === 'standings' ? 'Between rounds' : 'Completed'; }

  addPlayer(): void {
    const name = trimPlayerName(this.newPlayerName);
    if (!name) return;
    if (this.tournament()?.players.some((player) => trimPlayerName(player.name).toLowerCase() === name.toLowerCase())) {
      this.error.set('This player is already registered.');
      return;
    }
    this.error.set('');
    this.newPlayerName = '';
    this.update((live) => ({ ...live, players: [...live.players, createLiveTournamentPlayer({ name })] }));
  }

  updatePlayer(playerId: string, patch: Partial<LiveTournamentPlayerDocument>): void {
    this.update((live) => {
      const nextName = patch.name === undefined ? null : trimPlayerName(patch.name);
      if (nextName && live.players.some((player) => player.id !== playerId && trimPlayerName(player.name).toLowerCase() === nextName.toLowerCase())) {
        this.error.set('Player names must be unique.');
        return live;
      }
      return { ...live, players: live.players.map((player) => player.id === playerId ? { ...player, ...patch, name: nextName === null ? player.name : nextName } : player) };
    });
  }

  removePlayer(playerId: string): void {
    this.update((live) => live.rounds.length
      ? { ...live, players: live.players.map((player) => player.id === playerId ? { ...player, dropped: true } : player) }
      : { ...live, players: live.players.filter((player) => player.id !== playerId) });
  }

  startTournament(): void { this.update((live) => generateNextSwissRound(live)); }
  generateNextRound(): void { this.update((live) => generateNextSwissRound(live)); }
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
    this.tournament.set(updater(live));
    void this.persist();
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
      this.tournament.set(latest && latest.id === saved.id && this.pendingSave ? { ...latest, documentVersion: saved.documentVersion, updatedAt: saved.updatedAt } : saved);
    }
    catch (error) { logBoundaryError('live-tournament.save', error, { liveTournamentId: live.id }); this.error.set('Could not save this live tournament.'); }
    finally {
      this.saving = false;
      if (this.pendingSave) void this.persist();
    }
  }
}
