import { Component, computed, ElementRef, HostListener, signal, ViewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { LeagueRepository } from '../../data/league-repository.service';
import { createMatchRoundEntry, createRound, getDefaultTournamentName, LeagueDocument, PersistedLeague, RoundDocument, TournamentDocument } from '../../domain/models';
import { importRoundEntries } from '../../domain/round-import';
import { calculateTournamentResult } from '../../domain/results';
import { getTournamentWarnings, TournamentWarning } from '../../domain/warnings';
import { validateRoundEntry } from '../../domain/validation';
import { RankingTableComponent } from '../../shared/ranking-table.component';
import { logBoundaryError } from '../../shared/app-logger';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatMenuModule, RankingTableComponent, BackButtonComponent],
  template: `
    <gones-back-button [link]="leagueBackLink()" label="Back to League" position="top" />
    <div class="tournament-detail-content">
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (tournament(); as t) {
      <section class="page-heading tournament-page-heading" (input)="markDirty()">
        <div>
          <p class="kicker">Tournament</p>
          <div class="tournament-heading-fields">
            @if (titleOnlyEditing()) { <mat-form-field appearance="outline" class="title-field"><mat-label>Tournament name</mat-label><input #tournamentNameInput data-cy="tournament-name-input" matInput [(ngModel)]="t.name" [readonly]="saving()" (blur)="saveTitleEdit({ restoreFocus: false })" (keydown.enter)="$event.preventDefault(); saveTitleEdit({ restoreFocus: true })"></mat-form-field> }
            @else { <h1><button #tournamentTitleButton class="editable-title" type="button" (click)="startTitleEdit()" [attr.aria-label]="'Edit Tournament name: ' + t.name">{{ t.name }}</button></h1> }
            <mat-form-field appearance="outline" class="tournament-date-field"><mat-label>Tournament date</mat-label><input matInput type="date" [(ngModel)]="t.tournamentDate"></mat-form-field>
          </div>
          @if (result().provisional || result().incomplete) {
            <div class="warning">
              <p>{{ result().provisional ? 'Provisional Result' : 'Incomplete Tournament' }}</p>
              @if (completionIssues().length) {
                <ul>
                  @for (issue of completionIssues(); track issue) { <li>{{ issue }}</li> }
                </ul>
              }
            </div>
          }
        </div>
      </section>
      @if (warnings().length) {
        <div class="warning">
          <p>Warnings: {{ warnings().length }} source-data issue(s) need review.</p>
          <ul>
            @for (warning of warningMessages(); track warning) { <li>{{ warning }}</li> }
          </ul>
        </div>
      }
      <section class="stack"><h2>Tournament Ranking</h2><gones-ranking-table [rows]="result().rows" emptyText="No valid Round Entries yet" /></section>
      <section class="stack" (input)="markDirty()">
        <div class="section-header"><h2>Rounds</h2><button class="add-round-button" mat-flat-button color="primary" (click)="addRound()">Add Round</button></div>
        @for (roundView of roundViewModels(t); track roundView.round.id) {
          <mat-expansion-panel class="round-panel" [expanded]="true">
            <mat-expansion-panel-header>
              <mat-panel-title class="round-panel-title">Round {{ roundView.number }}</mat-panel-title>
              <mat-panel-description>{{ roundView.round.entries.length }} entries</mat-panel-description>
              <button class="round-menu-button" mat-icon-button [matMenuTriggerFor]="roundMenu" type="button" aria-label="Round actions" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">⋯</button>
            </mat-expansion-panel-header>
            <mat-menu #roundMenu="matMenu">
              <button class="destructive-menu-item" mat-menu-item type="button" (click)="deleteRound(roundView.round)">Delete Round</button>
            </mat-menu>
            <div class="import-row"><mat-form-field appearance="outline"><mat-label>Round Import</mat-label><textarea matInput #importText data-cy="round-import-input" rows="4" [placeholder]="roundImportPlaceholder"></textarea></mat-form-field><button mat-stroked-button (click)="replaceRound(roundView.round, importText.value); importText.value = ''">Import</button></div>
            <button mat-stroked-button (click)="addMatch(roundView.round)">Add Match</button>
            <div class="entry-list">
              @for (entry of roundView.round.entries; track entry.id) {
                <div class="entry-row" [class.invalid]="entry.kind === 'invalid'">
                  @if (entry.kind === 'match') {
                    <label><span>Table</span><input [(ngModel)]="entry.table" aria-label="Table"></label><label><span>Player 1</span><input [(ngModel)]="entry.player1Name" aria-label="Player 1"></label><label><span>Deck 1</span><input [(ngModel)]="entry.player1DeckArchetype" aria-label="Player 1 Deck Archetype"></label><label><span>Score</span><input type="number" [(ngModel)]="entry.player1Score" aria-label="Player 1 Score"></label><label><span>Score</span><input type="number" [(ngModel)]="entry.player2Score" aria-label="Player 2 Score"></label><label><span>Player 2</span><input [(ngModel)]="entry.player2Name" aria-label="Player 2"></label><label><span>Deck 2</span><input [(ngModel)]="entry.player2DeckArchetype" aria-label="Player 2 Deck Archetype"></label><button mat-button color="warn" (click)="deleteEntry(roundView.round, entry.id)">Delete</button>
                  } @else if (entry.kind === 'bye') {
                    <label><span>Table</span><input [(ngModel)]="entry.table" aria-label="Table"></label><label><span>Player</span><input [(ngModel)]="entry.playerName" aria-label="Bye Player"></label><label><span>Deck</span><input [(ngModel)]="entry.deckArchetype" aria-label="Bye Deck Archetype"></label><button mat-button color="warn" (click)="deleteEntry(roundView.round, entry.id)">Delete</button>
                  }
                  @else { <label><span>Invalid row</span><input [(ngModel)]="entry.rawText" aria-label="Invalid row"></label><label><span>Table</span><input [(ngModel)]="entry.table" aria-label="Invalid row table"></label><label><span>Player</span><input [(ngModel)]="entry.player" aria-label="Invalid row player"></label><label><span>Result</span><input [(ngModel)]="entry.result" aria-label="Invalid row result"></label><label><span>Opponent</span><input [(ngModel)]="entry.opponent" aria-label="Invalid row opponent"></label><button mat-button color="warn" (click)="deleteEntry(roundView.round, entry.id)">Delete</button> }
                </div>
              }
            </div>
          </mat-expansion-panel>
        }
      </section>
    } @else if (!loading()) { <mat-card class="panel"><mat-card-title>Tournament not found</mat-card-title><mat-card-content><p>The requested Tournament does not exist or was deleted.</p></mat-card-content></mat-card> }
    </div>
    @if (!loading()) { <gones-back-button [link]="leagueBackLink()" label="Back to League" position="bottom" /> }
  `
})
export class TournamentDetailComponent {
  @ViewChild('tournamentNameInput') private tournamentNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('tournamentTitleButton') private tournamentTitleButton?: ElementRef<HTMLButtonElement>;

  readonly league = signal<PersistedLeague | null>(null);
  readonly draft = signal<LeagueDocument>(null as unknown as LeagueDocument);
  readonly editing = signal(false);
  readonly titleOnlyEditing = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly dirty = signal(false);
  readonly error = signal('');
  readonly currentLeague = computed(() => this.editing() ? this.draft() : this.league()!);
  readonly tournament = computed(() => this.currentLeague()?.tournaments.find((item) => item.id === this.tournamentId()) ?? null);
  readonly result = computed(() => this.tournament() ? calculateTournamentResult(this.tournament()!) : { rows: [], incomplete: true, provisional: false });
  readonly warnings = computed(() => this.tournament() ? getTournamentWarnings(this.tournament()!) : []);
  readonly completionIssues = computed(() => this.tournament() ? tournamentCompletionIssues(this.tournament()!) : []);
  readonly warningMessages = computed(() => this.tournament() ? this.warnings().map((warning) => tournamentWarningMessage(warning, this.tournament()!)) : []);
  private readonly leagueId = signal('');
  private readonly tournamentId = signal('');
  readonly leagueBackLink = computed(() => ['/leagues', this.leagueId()]);
  readonly saveShortcutLabel = navigator.platform.toLowerCase().includes('mac') ? '⌘S' : 'Ctrl+S';
  readonly roundImportPlaceholder = 'table number, player name, result, opponent name, player deck archetype, opponent deck archetype\n7,Alice,Won 2-1,Bob,Fire,Ice\n8,Charlie,Lost 1-2,Dana,Water,Earth\n9,Eve,Draw 1-1,Frank,Air,Metal';

  constructor(private readonly repo: LeagueRepository, private readonly route: ActivatedRoute, private readonly dialog: MatDialog) { void this.load(); }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void { if (this.dirty()) event.preventDefault(); }
  @HostListener('document:keydown', ['$event']) handleShortcut(event: KeyboardEvent): void {
    if (!this.editing() || this.saving()) return;
    if (event.key === 'Escape' && this.dirty()) { event.preventDefault(); this.cancelEdit(); }
    if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey) && this.dirty()) { event.preventDefault(); void this.save(); }
  }

  async load(): Promise<void> {
    const leagueId = this.route.snapshot.paramMap.get('leagueId') ?? '';
    this.leagueId.set(leagueId);
    this.tournamentId.set(this.route.snapshot.paramMap.get('tournamentId') ?? '');
    try {
      const league = await this.repo.getLeague(leagueId);
      this.league.set(league);
      this.startEdit(league);
    }
    catch (error) { logBoundaryError('tournament-detail.load', error, { leagueId, tournamentId: this.tournamentId() }); this.error.set('Could not load this Tournament.'); }
    finally { this.loading.set(false); }
  }

  startEdit(league = this.league()): void {
    if (!league) return;
    const draft = structuredClone(league);
    const tournament = draft.tournaments.find((item) => item.id === this.tournamentId());
    if (tournament && !tournament.tournamentDate) tournament.tournamentDate = todayDateInputValue();
    this.titleOnlyEditing.set(false);
    this.draft.set(draft);
    this.editing.set(true);
    this.dirty.set(false);
  }
  startTitleEdit(): void { if (!this.editing()) this.startEdit(); this.titleOnlyEditing.set(true); this.focusTournamentNameInput(); }
  cancelEdit(): void { this.startEdit(); this.focusTournamentTitleButton(); }
  markDirty(): void { if (!this.saving()) this.dirty.set(true); }
  addRound(): void { this.updateTournament((tournament) => ({ ...tournament, rounds: [...tournament.rounds, createRound()] })); }
  addMatch(round: RoundDocument): void { this.updateRound(round.id, (item) => ({ ...item, entries: [...item.entries, createMatchRoundEntry({ table: String(item.entries.length + 1) })] })); }
  replaceRound(round: RoundDocument, text: string): void { this.updateRound(round.id, (item) => ({ ...item, entries: importRoundEntries(text).entries })); }
  roundViewModels(tournament: TournamentDocument): Array<{ round: RoundDocument; number: number }> {
    return tournament.rounds.map((round, index) => ({ round, number: index + 1 })).reverse();
  }
  private focusTournamentNameInput(): void { setTimeout(() => this.tournamentNameInput?.nativeElement.focus()); }
  private focusTournamentTitleButton(): void { setTimeout(() => this.tournamentTitleButton?.nativeElement.focus()); }
  private updateTournament(updater: (tournament: TournamentDocument) => TournamentDocument): void {
    this.draft.update((league) => ({ ...league, tournaments: league.tournaments.map((tournament) => tournament.id === this.tournamentId() ? updater(tournament) : tournament) }));
    this.markDirty();
  }
  private updateRound(roundId: string, updater: (round: RoundDocument) => RoundDocument): void {
    this.updateTournament((tournament) => ({ ...tournament, rounds: tournament.rounds.map((round) => round.id === roundId ? updater(round) : round) }));
  }
  async deleteEntry(round: RoundDocument, entryId: string): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete Match', message: 'Delete this match?', confirmLabel: 'Delete Match', destructive: true } }).afterClosed());
    if (confirmed) this.updateRound(round.id, (item) => ({ ...item, entries: item.entries.filter((entry) => entry.id !== entryId) }));
  }
  async deleteRound(round: RoundDocument): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete Round', message: 'Delete this entire round?', confirmLabel: 'Delete Round', destructive: true } }).afterClosed());
    if (confirmed) this.updateTournament((tournament) => ({ ...tournament, rounds: tournament.rounds.filter((item) => item.id !== round.id) }));
  }

  async saveTitleEdit({ restoreFocus }: { restoreFocus: boolean }): Promise<void> {
    if (!this.titleOnlyEditing() || this.saving()) return;
    const tournament = this.tournament();
    if (tournament) tournament.name = String(tournament.name ?? '').trim() || getDefaultTournamentName();
    await this.save({ restoreFocus });
  }

  async save({ restoreFocus = true }: { restoreFocus?: boolean } = {}): Promise<void> {
    const saved = this.league();
    if (!saved || this.saving()) return;
    this.saving.set(true);
    try { const league = await this.repo.saveLeague(this.draft(), saved.documentVersion); this.league.set(league); this.startEdit(league); this.error.set(''); if (restoreFocus) this.focusTournamentTitleButton(); }
    catch (error) { logBoundaryError('tournament-detail.save', error, { leagueId: saved.id, tournamentId: this.tournamentId() }); this.error.set(error instanceof Error && error.message === 'staleLeagueDocument' ? 'This League changed since you opened it. Reload the latest saved data before saving again.' : 'Could not save this Tournament.'); }
    finally { this.saving.set(false); }
  }
}

function tournamentCompletionIssues(tournament: TournamentDocument): string[] {
  const issues: string[] = [];
  if (!tournament.rounds?.length) issues.push('Add at least one Round.');
  tournament.rounds?.forEach((round, roundIndex) => {
    round.entries.forEach((entry, entryIndex) => {
      const validation = validateRoundEntry(entry);
      if (validation.valid) return;
      const prefix = `Round ${roundIndex + 1}, entry ${entryIndex + 1}`;
      for (const code of validation.codes) issues.push(`${prefix}: ${validationMessage(code)}.`);
    });
  });
  return issues;
}

function validationMessage(code: string): string {
  const messages: Record<string, string> = {
    invalidRoundEntry: 'replace the invalid imported row with a valid Match or Bye',
    playerRequired: 'enter the player name',
    opponentRequired: 'enter the opponent name',
    byeReservedPlayerName: 'use the real player name instead of Bye',
    byeReservedOpponentName: 'use the real opponent name instead of Bye',
    samePlayerName: 'use two different player names',
    resultInvalid: 'enter non-negative whole-number game scores'
  };
  return messages[code] ?? `fix ${code}`;
}

function tournamentWarningMessage(warning: TournamentWarning, tournament: TournamentDocument): string {
  const roundNumber = warning.roundId ? tournament.rounds.findIndex((round) => round.id === warning.roundId) + 1 : 0;
  if (warning.code === 'missingBye') return `Round ${roundNumber}: add the missing Bye for the unpaired player.`;
  if (warning.code === 'duplicateSameRoundPlayerName') return `Round ${roundNumber}: ${warning.playerName ?? 'A player'} appears more than once; correct the duplicate entry.`;
  return 'A player pairing appears more than once; correct one of the repeated matches.';
}

function todayDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
