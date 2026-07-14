import { Component, computed, ElementRef, HostListener, signal, ViewChild, inject } from '@angular/core';
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
import { I18nService } from '../../i18n/i18n.service';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatMenuModule, MatSelectModule, RankingTableComponent, BackButtonComponent, DeckArchetypeInputComponent],
  template: `
    <gones-back-button [link]="leagueBackLink()" [label]="i18n.t('nav.backToLeague')" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (tournament(); as t) {
      <section class="page-heading" data-cy="tournament-detail-page" (input)="markDirty()">
        <div>
          <p class="kicker">{{ i18n.t('tournament.kicker') }}</p>
          <div class="tournament-heading-fields">
            @if (titleOnlyEditing()) { <mat-form-field appearance="outline" class="title-field"><mat-label>{{ i18n.t('tournament.name') }}</mat-label><input #tournamentNameInput data-cy="tournament-name-input" matInput [(ngModel)]="t.name" [readonly]="saving()" (blur)="saveTitleEdit({ restoreFocus: false })" (keydown.enter)="$event.preventDefault(); saveTitleEdit({ restoreFocus: true })"></mat-form-field> }
            @else { <h1><button #tournamentTitleButton class="editable-title" type="button" (click)="startTitleEdit()" [attr.aria-label]="i18n.t('tournament.editNameAria', { name: t.name })">{{ t.name }}</button></h1> }
            <mat-form-field appearance="outline" class="tournament-date-field"><mat-label>{{ i18n.t('tournament.date') }}</mat-label><input matInput type="date" [(ngModel)]="t.tournamentDate"></mat-form-field>
            <mat-form-field appearance="outline" class="tournament-league-field"><mat-label>{{ i18n.t('tournament.league') }}</mat-label><mat-select [ngModel]="leagueId()" (ngModelChange)="moveTournamentToLeague($event)">@for (leagueOption of leagues(); track leagueOption.id) { <mat-option [value]="leagueOption.id">{{ leagueOption.name }}</mat-option> }</mat-select></mat-form-field>
          </div>
          @if (result().provisional || result().incomplete) {
            <div class="warning">
              <p>{{ result().provisional ? i18n.t('tournament.provisional') : i18n.t('tournament.incomplete') }}</p>
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
          <p>{{ i18n.t('tournament.warnings', { count: warnings().length }) }}</p>
          <ul>
            @for (warning of warningMessages(); track warning) { <li>{{ warning }}</li> }
          </ul>
        </div>
      }
      @if (importErrors().length) {
        <div class="error" role="alert" data-cy="round-import-archetype-conflict">
          <p>{{ i18n.t('tournament.importConflict') }}</p>
          <ul>
            @for (message of importErrors(); track message) { <li>{{ message }}</li> }
          </ul>
          <button mat-stroked-button type="button" class="secondary-action" data-cy="dismiss-round-import-archetype-conflict" (click)="importErrors.set([])">{{ i18n.t('tournament.closeWarning') }}</button>
        </div>
      }
      <section class="stack"><h2>{{ i18n.t('tournament.ranking') }}</h2><gones-ranking-table [rows]="result().rows" [emptyText]="i18n.t('tournament.emptyRanking')" /></section>
      <section class="stack tournament-rounds-section" (input)="syncPlayerArchetypesFromRoundEntries()">
        <div class="rounds-section-actions"><button class="add-round-button create-action-button" mat-flat-button type="button" [attr.aria-label]="i18n.t('tournament.addRound')" (click)="addRound()"><span>{{ i18n.t('tournament.addRound') }}</span></button></div>
        <mat-expansion-panel class="round-panel rounds-section-panel" [expanded]="roundsExpanded()" (opened)="roundsExpanded.set(true)" (closed)="roundsExpanded.set(false)">
          <mat-expansion-panel-header>
            <mat-panel-title class="round-panel-title">{{ i18n.t('tournament.rounds') }}</mat-panel-title>
            <mat-panel-description>{{ i18n.plural(t.rounds.length, 'tournament.roundCountOne', 'tournament.roundCountMany') }}</mat-panel-description>
          </mat-expansion-panel-header>
          @for (roundView of roundViewModels(t); track roundView.round.id) {
            <mat-expansion-panel class="round-panel" [attr.id]="'tournament-round-' + roundView.number" [attr.data-cy]="'tournament-round-' + roundView.number" [expanded]="isRoundExpanded(roundView.number)" (opened)="setRoundExpanded(roundView.number, true)" (closed)="setRoundExpanded(roundView.number, false)">
              <mat-expansion-panel-header>
                <mat-panel-title class="round-panel-title">{{ i18n.t('tournament.roundN', { n: roundView.number }) }}</mat-panel-title>
                <mat-panel-description>{{ i18n.t('tournament.entriesCount', { count: roundView.round.entries.length }) }}</mat-panel-description>
                <button class="round-menu-button" mat-icon-button [matMenuTriggerFor]="roundMenu" type="button" [attr.aria-label]="i18n.t('tournament.roundActions')" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">⋯</button>
              </mat-expansion-panel-header>
              <mat-menu #roundMenu="matMenu">
                <button class="destructive-menu-item" mat-menu-item type="button" (click)="deleteRound(roundView.round)">{{ i18n.t('tournament.deleteRound') }}</button>
              </mat-menu>
              <div class="import-row">
                <mat-form-field appearance="outline"><mat-label>{{ i18n.t('tournament.roundImport') }}</mat-label><textarea matInput #importText data-cy="round-import-input" rows="4" [placeholder]="roundImportPlaceholder"></textarea></mat-form-field>
                @if (hasValidRoundImport(importText.value)) { <button class="round-import-button create-action-button" mat-flat-button type="button" (click)="replaceRound(roundView.round, importText.value); importText.value = ''">{{ i18n.t('tournament.importRoundData') }}</button> }
              </div>
              @if (roundView.round.entries.length) {
                <div class="table-wrap round-entry-table-wrap">
                  <table class="ranking-table round-entry-table" data-cy="round-entry-table">
                    <thead>
                      <tr>
                        <th scope="col">{{ i18n.t('common.table') }}</th>
                        <th scope="col">{{ i18n.t('tournament.player1Name') }}</th>
                        <th scope="col">{{ i18n.t('tournament.player1Score') }}</th>
                        <th scope="col">{{ i18n.t('tournament.player2Name') }}</th>
                        <th scope="col">{{ i18n.t('tournament.player2Score') }}</th>
                        <th scope="col">{{ i18n.t('common.actions') }}</th>
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
                            <td><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">{{ i18n.t('common.delete') }}</button></td>
                          } @else if (entry.kind === 'bye') {
                            <td class="round-entry-table__compact"><input [(ngModel)]="entry.table" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'table')"></td>
                            <td><input [(ngModel)]="entry.playerName" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'bye player')"></td>
                            <td class="round-entry-table__empty"></td>
                            <td class="round-entry-table__empty"></td>
                            <td class="round-entry-table__empty"></td>
                            <td><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">{{ i18n.t('common.delete') }}</button></td>
                          }
                          @else {
                            <td class="round-entry-table__compact"><input [(ngModel)]="entry.table" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row table')"></td>
                            <td><input [(ngModel)]="entry.rawText" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 1')"></td>
                            <td class="round-entry-table__score"><input [(ngModel)]="entry.result" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 1 score')"></td>
                            <td><input [(ngModel)]="entry.opponent" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 2')"></td>
                            <td class="round-entry-table__empty"></td>
                            <td><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">{{ i18n.t('common.delete') }}</button></td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              <div class="round-entry-actions"><button mat-stroked-button type="button" (click)="addMatch(roundView.round)">{{ i18n.t('tournament.addMatch') }}</button><button mat-stroked-button type="button" (click)="addBye(roundView.round)">{{ i18n.t('tournament.addBye') }}</button></div>
            </mat-expansion-panel>
          }
        </mat-expansion-panel>
      </section>
      <section class="stack tournament-player-archetypes-section" (input)="markDirty()">
        <mat-expansion-panel class="round-panel player-archetype-panel" data-cy="player-archetype-panel" [expanded]="false">
          <mat-expansion-panel-header>
            <mat-panel-title class="round-panel-title">{{ i18n.t('tournament.playerArchetypes') }}</mat-panel-title>
            <mat-panel-description>{{ i18n.t('tournament.playersCount', { count: playerArchetypeRows(t).length }) }}</mat-panel-description>
          </mat-expansion-panel-header>
          <p class="muted">{{ i18n.t('tournament.archetypeHelp') }}</p>
          @if (playerArchetypeRows(t).length) {
            <div class="player-archetype-list" role="group" [attr.aria-label]="i18n.t('tournament.playerArchetypes')">
              <div class="player-archetype-list__header" aria-hidden="true">
                <span>{{ i18n.t('common.player') }}</span>
                <span>{{ i18n.t('tournament.deckArchetypeCol') }}</span>
              </div>
              @for (row of playerArchetypeRows(t); track row.playerName; let rowIndex = $index) {
                <div class="player-archetype-row" data-cy="player-archetype-row">
                  <label class="player-archetype-row__player" [attr.for]="'player-archetype-' + rowIndex"><span class="sr-only">Deck archetype for </span>{{ row.playerName }}</label>
                  <gones-deck-archetype-input [inputId]="'player-archetype-' + rowIndex" [label]="i18n.t('live.deckArchetypeFor', { name: row.playerName })" [value]="archetypeFor(t, row.playerName)" (valueChange)="setArchetype(row.playerName, $event)" />
                </div>
              }
            </div>
          } @else { <p class="empty">{{ i18n.t('tournament.noPlayersYet') }}</p> }
        </mat-expansion-panel>
      </section>
    } @else if (!loading()) { <mat-card class="panel"><mat-card-title>{{ i18n.t('tournament.notFoundTitle') }}</mat-card-title><mat-card-content><p>{{ i18n.t('tournament.notFoundBody') }}</p></mat-card-content></mat-card> }
    @if (!loading()) { <gones-back-button [link]="leagueBackLink()" [label]="i18n.t('nav.backToLeague')" position="bottom" /> }
  `
})
export class TournamentDetailComponent {
  readonly i18n = inject(I18nService);
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
  readonly completionIssues = computed(() => this.tournament() ? tournamentCompletionIssues(this.tournament()!, this.i18n) : []);
  readonly warningMessages = computed(() => this.tournament() ? this.warnings().map((warning) => tournamentWarningMessage(warning, this.tournament()!, this.i18n)) : []);
  readonly leagueId = signal('');
  private readonly tournamentId = signal('');
  readonly leagueBackLink = computed(() => ['/leagues', this.leagueId()]);
  get roundImportPlaceholder(): string { return this.i18n.t('tournament.roundImportPlaceholder'); }

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
    catch (error) { logBoundaryError('tournament-detail.load', error, { leagueId, tournamentId: this.tournamentId() }); this.error.set(this.i18n.t('tournament.loadFailed')); }
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
      this.importErrors.set(merged.conflicts.map((conflict) => this.i18n.t('tournament.importConflictRow', {
        player: conflict.playerName,
        imported: conflict.importedArchetype || this.i18n.t('tournament.noArchetype'),
        existing: conflict.existingArchetype || this.i18n.t('tournament.noArchetype')
      })));
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
  roundEntryInputLabel(roundNumber: number, entryIndex: number, field: string): string { return this.i18n.t('tournament.roundEntryLabel', { round: roundNumber, entry: entryIndex + 1, field }); }
  roundEntryDeleteLabel(roundNumber: number, entryIndex: number): string { return this.i18n.t('tournament.roundEntryDelete', { round: roundNumber, entry: entryIndex + 1 }); }
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
    if (this.dirty()) { this.error.set(this.i18n.t('tournament.saveBeforeMove')); return; }
    this.saving.set(true);
    try {
      const result = await this.repo.moveTournament(tournament.id, saved.id, targetLeagueId);
      this.error.set('');
      await this.router.navigate(['/leagues', result.toLeague.id, 'tournaments', tournament.id]);
    } catch (error) {
      logBoundaryError('tournament-detail.moveTournament', error, { leagueId: saved.id, tournamentId: tournament.id, targetLeagueId });
      this.error.set(this.i18n.t('tournament.moveFailed'));
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
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: this.i18n.t('tournament.deleteMatchTitle'), message: this.i18n.t('tournament.deleteMatchMessage'), confirmLabel: this.i18n.t('tournament.deleteMatchConfirm'), destructive: true } }).afterClosed());
    if (confirmed) this.updateRound(round.id, (item) => ({ ...item, entries: item.entries.filter((entry) => entry.id !== entryId) }));
  }
  async deleteRound(round: RoundDocument): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: this.i18n.t('tournament.deleteRoundTitle'), message: this.i18n.t('tournament.deleteRoundMessage'), confirmLabel: this.i18n.t('tournament.deleteRoundConfirm'), destructive: true } }).afterClosed());
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
    catch (error) { logBoundaryError('tournament-detail.save', error, { leagueId: saved.id, tournamentId: this.tournamentId() }); this.error.set(error instanceof Error && error.message === 'staleLeagueDocument' ? this.i18n.t('tournament.staleSave') : this.i18n.t('tournament.saveFailed')); }
    finally { this.saving.set(false); }
  }
}

function tournamentCompletionIssues(tournament: TournamentDocument, i18n: I18nService): string[] {
  const issues: string[] = [];
  if (!tournament.rounds?.length) issues.push(i18n.t('tournament.needOneRound'));
  tournament.rounds?.forEach((round, roundIndex) => {
    round.entries.forEach((entry, entryIndex) => {
      const validation = validateRoundEntry(entry);
      if (validation.valid) return;
      for (const code of validation.codes) {
        issues.push(i18n.t('tournament.entryIssue', { round: roundIndex + 1, entry: entryIndex + 1, issue: validationMessage(code, i18n) }));
      }
    });
  });
  for (const conflict of validateTournamentPlayerArchetypes(tournament)) {
    issues.push(i18n.t('tournament.archetypeConflict', {
      player: conflict.playerName,
      existing: conflict.existingArchetype || i18n.t('tournament.noArchetype'),
      imported: conflict.importedArchetype || i18n.t('tournament.noArchetype')
    }));
  }
  return issues;
}

function validationMessage(code: string, i18n: I18nService): string {
  const keys: Record<string, Parameters<I18nService['t']>[0]> = {
    invalidRoundEntry: 'validation.invalidRoundEntry',
    playerRequired: 'validation.playerRequired',
    opponentRequired: 'validation.opponentRequired',
    byeReservedPlayerName: 'validation.byeReservedPlayerName',
    byeReservedOpponentName: 'validation.byeReservedOpponentName',
    samePlayerName: 'validation.samePlayerName',
    resultInvalid: 'validation.resultInvalid',
    resultTooManyGameWins: 'validation.resultTooManyGameWins',
    resultTooManyGameLosses: 'validation.resultTooManyGameLosses'
  };
  return keys[code] ? i18n.t(keys[code]) : i18n.t('validation.fixCode', { code });
}

function tournamentWarningMessage(warning: TournamentWarning, tournament: TournamentDocument, i18n: I18nService): string {
  const roundNumber = warning.roundId ? tournament.rounds.findIndex((round) => round.id === warning.roundId) + 1 : 0;
  const player = warning.playerName ?? i18n.t('tournament.aPlayer');
  if (warning.code === 'missingBye') return i18n.t('tournament.warnMissingBye', { round: roundNumber });
  if (warning.code === 'duplicateSameRoundPlayerName') return i18n.t('tournament.warnDuplicatePlayer', { round: roundNumber, player });
  if (warning.code === 'newPlayerAfterRoundOne') return i18n.t('tournament.warnNewPlayer', { round: roundNumber, player });
  if (warning.code === 'missingDeckArchetype') return i18n.t('tournament.warnMissingArchetype', { player });
  return i18n.t('tournament.warnRepeatedPairing');
}

function todayDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
