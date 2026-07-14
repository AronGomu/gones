import { Component, computed, ElementRef, HostListener, signal, ViewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { LeagueRepository } from '../../data/league-repository.service';
import { createByeRoundEntry, createMatchRoundEntry, createRound, getDefaultTournamentName, LeagueDocument, PersistedLeague, RoundDocument, RoundEntry, TournamentDocument } from '../../domain/models';
import { importRoundEntries } from '../../domain/round-import';
import { archetypeForPlayer, mergeImportedRoundArchetypes, setTournamentPlayerArchetype, tournamentPlayerArchetypeRows, validateTournamentPlayerArchetypes } from '../../domain/tournament-archetypes';
import { calculateTournamentResult } from '../../domain/results';
import { getTournamentWarnings, TournamentWarning } from '../../domain/warnings';
import { validateRoundEntry } from '../../domain/validation';
import { RankingTableComponent } from '../../shared/ranking-table.component';
import { logBoundaryError } from '../../shared/app-logger';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { BackButtonComponent } from '../../shared/back-button.component';
import { DeckArchetypeInputComponent } from '../../shared/deck-archetype-input.component';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatMenuModule, MatSelectModule, RankingTableComponent, BackButtonComponent, DeckArchetypeInputComponent],
  template: `
    <gones-back-button [link]="leagueBackLink()" label="Back to League" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (tournament(); as t) {
      <section class="page-heading" data-cy="tournament-detail-page" (input)="markDirty()">
        <div>
          <p class="kicker">Tournament</p>
          <div class="tournament-heading-fields">
            @if (titleOnlyEditing()) { <mat-form-field appearance="outline" class="title-field"><mat-label>Tournament name</mat-label><input #tournamentNameInput data-cy="tournament-name-input" matInput [(ngModel)]="t.name" [readonly]="saving()" (blur)="saveTitleEdit({ restoreFocus: false })" (keydown.enter)="$event.preventDefault(); saveTitleEdit({ restoreFocus: true })"></mat-form-field> }
            @else { <h1><button #tournamentTitleButton class="editable-title" type="button" (click)="startTitleEdit()" [attr.aria-label]="'Edit Tournament name: ' + t.name">{{ t.name }}</button></h1> }
            <mat-form-field appearance="outline" class="tournament-date-field"><mat-label>Tournament date</mat-label><input matInput type="date" [(ngModel)]="t.tournamentDate"></mat-form-field>
            <mat-form-field appearance="outline" class="tournament-league-field"><mat-label>League</mat-label><mat-select [ngModel]="leagueId()" (ngModelChange)="moveTournamentToLeague($event)">@for (leagueOption of leagues(); track leagueOption.id) { <mat-option [value]="leagueOption.id">{{ leagueOption.name }}</mat-option> }</mat-select></mat-form-field>
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
      @if (importErrors().length) {
        <div class="error" role="alert" data-cy="round-import-archetype-conflict">
          <p>Round import kept the current Tournament archetype for conflicting player(s).</p>
          <ul>
            @for (message of importErrors(); track message) { <li>{{ message }}</li> }
          </ul>
          <button mat-stroked-button type="button" class="secondary-action" data-cy="dismiss-round-import-archetype-conflict" (click)="importErrors.set([])">Close warning</button>
        </div>
      }
      <section class="stack"><h2>Tournament Ranking</h2><gones-ranking-table [rows]="result().rows" emptyText="No valid Round Entries yet" /></section>
      <section class="stack tournament-rounds-section" (input)="syncPlayerArchetypesFromRoundEntries()">
        <div class="rounds-section-actions"><button class="add-round-button create-action-button" mat-flat-button type="button" aria-label="Add Round" (click)="addRound()"><span>Add Round</span></button></div>
        <mat-expansion-panel class="round-panel rounds-section-panel" [expanded]="roundsExpanded()" (opened)="roundsExpanded.set(true)" (closed)="roundsExpanded.set(false)">
          <mat-expansion-panel-header>
            <mat-panel-title class="round-panel-title">Rounds</mat-panel-title>
            <mat-panel-description>{{ t.rounds.length }} {{ t.rounds.length === 1 ? 'round' : 'rounds' }}</mat-panel-description>
          </mat-expansion-panel-header>
          @for (roundView of roundViewModels(t); track roundView.round.id) {
            <mat-expansion-panel class="round-panel" [attr.id]="'tournament-round-' + roundView.number" [attr.data-cy]="'tournament-round-' + roundView.number" [expanded]="isRoundExpanded(roundView.number)" (opened)="setRoundExpanded(roundView.number, true)" (closed)="setRoundExpanded(roundView.number, false)">
              <mat-expansion-panel-header>
                <mat-panel-title class="round-panel-title">Round {{ roundView.number }}</mat-panel-title>
                <mat-panel-description>{{ roundView.round.entries.length }} entries</mat-panel-description>
                <button class="round-menu-button" mat-icon-button [matMenuTriggerFor]="roundMenu" type="button" aria-label="Round actions" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">⋯</button>
              </mat-expansion-panel-header>
              <mat-menu #roundMenu="matMenu">
                <button class="destructive-menu-item" mat-menu-item type="button" (click)="deleteRound(roundView.round)">Delete Round</button>
              </mat-menu>
              <div class="import-row">
                <mat-form-field appearance="outline"><mat-label>Round Import</mat-label><textarea matInput #importText data-cy="round-import-input" rows="4" [placeholder]="roundImportPlaceholder"></textarea></mat-form-field>
                @if (hasValidRoundImport(importText.value)) { <button class="round-import-button create-action-button" mat-flat-button type="button" (click)="replaceRound(roundView.round, importText.value); importText.value = ''">Import Round Data</button> }
              </div>
              @if (roundView.round.entries.length) {
                <div class="table-wrap round-entry-table-wrap">
                  <table class="ranking-table round-entry-table" data-cy="round-entry-table">
                    <thead>
                      <tr>
                        <th scope="col">Table</th>
                        <th scope="col">Player 1 name</th>
                        <th scope="col">Player 1 score</th>
                        <th scope="col">Player 2 name</th>
                        <th scope="col">Player 2 score</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (entry of roundView.round.entries; track entry.id; let entryIndex = $index) {
                        <tr [class.invalid]="entryInvalid(entry)" [class.is-warning]="entryHasWarning(roundView.round, entry)">
                          @if (entry.kind === 'match') {
                            <td class="round-entry-table__compact"><input [(ngModel)]="entry.table" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'table')"></td>
                            <td><input [(ngModel)]="entry.player1Name" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 1 name')"></td>
                            <td class="round-entry-table__score"><input type="number" [(ngModel)]="entry.player1Score" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 1 score')"></td>
                            <td><input [(ngModel)]="entry.player2Name" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 2 name')"></td>
                            <td class="round-entry-table__score"><input type="number" [(ngModel)]="entry.player2Score" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 2 score')"></td>
                            <td><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">Delete</button></td>
                          } @else if (entry.kind === 'bye') {
                            <td class="round-entry-table__compact"><input [(ngModel)]="entry.table" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'table')"></td>
                            <td><input [(ngModel)]="entry.playerName" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'bye player')"></td>
                            <td class="round-entry-table__empty"></td>
                            <td class="round-entry-table__empty"></td>
                            <td class="round-entry-table__empty"></td>
                            <td><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">Delete</button></td>
                          }
                          @else {
                            <td class="round-entry-table__compact"><input [(ngModel)]="entry.table" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row table')"></td>
                            <td><input [(ngModel)]="entry.rawText" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 1')"></td>
                            <td class="round-entry-table__score"><input [(ngModel)]="entry.result" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 1 score')"></td>
                            <td><input [(ngModel)]="entry.opponent" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 2')"></td>
                            <td class="round-entry-table__empty"></td>
                            <td><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">Delete</button></td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              <div class="round-entry-actions"><button mat-stroked-button type="button" (click)="addMatch(roundView.round)">Add Match</button><button mat-stroked-button type="button" (click)="addBye(roundView.round)">Add Bye</button></div>
            </mat-expansion-panel>
          }
        </mat-expansion-panel>
      </section>
      <section class="stack tournament-player-archetypes-section" (input)="markDirty()">
        <mat-expansion-panel class="round-panel player-archetype-panel" data-cy="player-archetype-panel" [expanded]="false">
          <mat-expansion-panel-header>
            <mat-panel-title class="round-panel-title">Player Archetypes</mat-panel-title>
            <mat-panel-description>{{ playerArchetypeRows(t).length }} players</mat-panel-description>
          </mat-expansion-panel-header>
          <p class="muted">One deck archetype is stored per player for this Tournament.</p>
          @if (playerArchetypeRows(t).length) {
            <div class="player-archetype-list" role="group" aria-label="Player Archetypes">
              <div class="player-archetype-list__header" aria-hidden="true">
                <span>Player</span>
                <span>Deck Archetype</span>
              </div>
              @for (row of playerArchetypeRows(t); track row.playerName; let rowIndex = $index) {
                <div class="player-archetype-row" data-cy="player-archetype-row">
                  <label class="player-archetype-row__player" [attr.for]="'player-archetype-' + rowIndex"><span class="sr-only">Deck archetype for </span>{{ row.playerName }}</label>
                  <gones-deck-archetype-input [inputId]="'player-archetype-' + rowIndex" [label]="'Deck archetype for ' + row.playerName" [value]="archetypeFor(t, row.playerName)" (valueChange)="setArchetype(row.playerName, $event)" />
                </div>
              }
            </div>
          } @else { <p class="empty">No players yet. Add or import Round Entries first.</p> }
        </mat-expansion-panel>
      </section>
    } @else if (!loading()) { <mat-card class="panel"><mat-card-title>Tournament not found</mat-card-title><mat-card-content><p>The requested Tournament does not exist or was deleted.</p></mat-card-content></mat-card> }
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
  readonly importErrors = signal<string[]>([]);
  readonly roundsExpanded = signal(false);
  readonly expandedRoundNumbers = signal<ReadonlySet<number>>(new Set());
  readonly leagues = signal<PersistedLeague[]>([]);
  readonly currentLeague = computed(() => this.editing() ? this.draft() : this.league()!);
  readonly tournament = computed(() => this.currentLeague()?.tournaments.find((item) => item.id === this.tournamentId()) ?? null);
  readonly result = computed(() => this.tournament() ? calculateTournamentResult(this.tournament()!) : { rows: [], incomplete: true, provisional: false });
  readonly warnings = computed(() => this.tournament() ? getTournamentWarnings(this.tournament()!) : []);
  readonly completionIssues = computed(() => this.tournament() ? tournamentCompletionIssues(this.tournament()!) : []);
  readonly warningMessages = computed(() => this.tournament() ? this.warnings().map((warning) => tournamentWarningMessage(warning, this.tournament()!)) : []);
  readonly leagueId = signal('');
  private readonly tournamentId = signal('');
  readonly leagueBackLink = computed(() => ['/leagues', this.leagueId()]);
  readonly roundImportPlaceholder = 'table number, player name, result, opponent name, player deck archetype, opponent deck archetype\n7,Alice,Won 2-1,Bob,Fire,Ice\n8,Charlie,Lost 1-2,Dana,Water,Earth\n9,Eve,Draw 1-1,Frank,Air,Metal';

  constructor(private readonly repo: LeagueRepository, private readonly route: ActivatedRoute, private readonly router: Router, private readonly dialog: MatDialog) { void this.load(); }
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
      const [league, leagues] = await Promise.all([this.repo.getLeague(leagueId), this.repo.listLeagues()]);
      this.league.set(league);
      this.leagues.set(leagues);
      this.startEdit(league);
      this.openRoundFromQuery();
    }
    catch (error) { logBoundaryError('tournament-detail.load', error, { leagueId, tournamentId: this.tournamentId() }); this.error.set('Could not load this Tournament.'); }
    finally { this.loading.set(false); }
  }

  isRoundExpanded(roundNumber: number): boolean {
    return this.expandedRoundNumbers().has(roundNumber);
  }

  setRoundExpanded(roundNumber: number, expanded: boolean): void {
    const next = new Set(this.expandedRoundNumbers());
    if (expanded) next.add(roundNumber);
    else next.delete(roundNumber);
    this.expandedRoundNumbers.set(next);
  }

  private openRoundFromQuery(): void {
    const raw = this.route.snapshot.queryParamMap.get('round');
    const roundNumber = raw ? Number(raw) : NaN;
    if (!Number.isInteger(roundNumber) || roundNumber < 1) return;
    const tournament = this.tournament();
    if (!tournament || roundNumber > (tournament.rounds?.length ?? 0)) return;
    this.roundsExpanded.set(true);
    this.setRoundExpanded(roundNumber, true);
    setTimeout(() => {
      document.getElementById(`tournament-round-${roundNumber}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
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
  addRound(): void {
    this.roundsExpanded.set(true);
    this.updateTournament((tournament) => ({ ...tournament, rounds: [...tournament.rounds, createRound()] }));
  }
  addMatch(round: RoundDocument): void { this.updateRound(round.id, (item) => ({ ...item, entries: [...item.entries, createMatchRoundEntry({ table: String(item.entries.length + 1) })] })); }
  addBye(round: RoundDocument): void { this.updateRound(round.id, (item) => ({ ...item, entries: [...item.entries, createByeRoundEntry({ table: String(item.entries.length + 1) })] })); }
  replaceRound(round: RoundDocument, text: string): void {
    const imported = importRoundEntries(text);
    this.updateTournament((tournament) => {
      const merged = mergeImportedRoundArchetypes(tournament, imported.entries);
      this.importErrors.set(merged.conflicts.map((conflict) => `${conflict.playerName}: imported "${conflict.importedArchetype || 'No archetype'}" conflicts with current "${conflict.existingArchetype || 'No archetype'}".`));
      return { ...tournament, playerArchetypes: merged.playerArchetypes, rounds: tournament.rounds.map((item) => item.id === round.id ? { ...item, entries: merged.entries } : item) };
    });
  }
  playerArchetypeRows(tournament: TournamentDocument) { return tournamentPlayerArchetypeRows(tournament); }
  archetypeFor(tournament: TournamentDocument, playerName: string): string { return archetypeForPlayer(tournament, playerName); }
  syncPlayerArchetypesFromRoundEntries(): void {
    const tournament = this.tournament();
    if (!tournament) return;
    const rows = tournamentPlayerArchetypeRows(tournament);
    const sameRows = rows.length === (tournament.playerArchetypes ?? []).length && rows.every((row, index) => row.playerName === tournament.playerArchetypes[index]?.playerName && row.archetype === tournament.playerArchetypes[index]?.archetype);
    if (sameRows) {
      this.markDirty();
      return;
    }
    this.updateTournament((item) => ({ ...item, playerArchetypes: rows }));
  }
  setArchetype(playerName: string, archetype: string): void {
    this.importErrors.set([]);
    this.updateTournament((tournament) => setTournamentPlayerArchetype(tournament, playerName, archetype));
  }
  hasValidRoundImport(text: string): boolean {
    const entries = importRoundEntries(text).entries;
    return entries.length > 0 && entries.every((entry) => entry.kind === 'match');
  }
  roundEntryInputLabel(roundNumber: number, entryIndex: number, field: string): string { return `Round ${roundNumber}, entry ${entryIndex + 1}: ${field}`; }
  roundEntryDeleteLabel(roundNumber: number, entryIndex: number): string { return `Delete Round ${roundNumber}, entry ${entryIndex + 1}`; }
  entryInvalid(entry: RoundEntry): boolean { return !validateRoundEntry(entry).valid; }
  entryHasWarning(round: RoundDocument, entry: RoundEntry): boolean {
    return this.warnings().some((warning) => warning.roundId === round.id && (warning.entryIds?.includes(entry.id) ?? false));
  }
  roundViewModels(tournament: TournamentDocument): Array<{ round: RoundDocument; number: number }> {
    return tournament.rounds.map((round, index) => ({ round, number: index + 1 })).reverse();
  }
  async moveTournamentToLeague(targetLeagueId: string): Promise<void> {
    const saved = this.league();
    const tournament = this.tournament();
    if (!saved || !tournament || targetLeagueId === saved.id) return;
    if (this.dirty()) { this.error.set('Save or discard changes before moving this Tournament to another League.'); return; }
    this.saving.set(true);
    try {
      const result = await this.repo.moveTournament(tournament.id, saved.id, targetLeagueId);
      this.error.set('');
      await this.router.navigate(['/leagues', result.toLeague.id, 'tournaments', tournament.id]);
    } catch (error) {
      logBoundaryError('tournament-detail.moveTournament', error, { leagueId: saved.id, tournamentId: tournament.id, targetLeagueId });
      this.error.set('Could not move this Tournament to the selected League. Reload and try again.');
    } finally {
      this.saving.set(false);
    }
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
    try { const league = await this.repo.saveLeague(this.draft(), saved.documentVersion); this.league.set(league); this.startEdit(league); this.error.set(''); this.importErrors.set([]); if (restoreFocus) this.focusTournamentTitleButton(); }
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
  for (const conflict of validateTournamentPlayerArchetypes(tournament)) {
    issues.push(`Player Archetypes: ${conflict.playerName} has both ${conflict.existingArchetype || 'No archetype'} and ${conflict.importedArchetype || 'No archetype'}; keep one archetype for the Tournament.`);
  }
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
    resultInvalid: 'enter non-negative whole-number game scores',
    resultTooManyGameWins: 'game wins cannot be over 2',
    resultTooManyGameLosses: 'game losses cannot be over 2'
  };
  return messages[code] ?? `fix ${code}`;
}

function tournamentWarningMessage(warning: TournamentWarning, tournament: TournamentDocument): string {
  const roundNumber = warning.roundId ? tournament.rounds.findIndex((round) => round.id === warning.roundId) + 1 : 0;
  if (warning.code === 'missingBye') return `Round ${roundNumber}: add the missing Bye for the unpaired player.`;
  if (warning.code === 'duplicateSameRoundPlayerName') return `Round ${roundNumber}: ${warning.playerName ?? 'A player'} appears more than once; correct the duplicate entry.`;
  if (warning.code === 'newPlayerAfterRoundOne') return `Round ${roundNumber}: ${warning.playerName ?? 'A player'} was not present in previous rounds.`;
  if (warning.code === 'missingDeckArchetype') return `${warning.playerName ?? 'A player'} is missing a deck archetype.`;
  return 'A player pairing appears more than once; correct one of the repeated matches.';
}

function todayDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
