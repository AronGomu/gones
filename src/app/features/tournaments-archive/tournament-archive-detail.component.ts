import { Component, computed, HostListener, signal, ViewChild, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule, MatExpansionPanel } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { AuthService } from '../../auth/auth.service';
import { canManageLeague, leagueCommandError } from '../../data/league-archive-command-ux';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { archiveTournamentDeletionSummary, archiveTournamentEditBatchIsEmpty, buildArchiveTournamentEditBatch, sameAuthorityLeagueOptions } from '../../domain/archive-tournament-edit-batch';
import { createByeRoundEntry, createMatchRoundEntry, createRound, getDefaultTournamentName, LeagueDocument, LeagueStatus, PersistedLeague, PLACEHOLDER_LEAGUE_ID, RoundDocument, RoundEntry, TournamentDocument } from '../../domain/models';
import { ArchiveTournamentEditBatchCommand } from '../../backend/application-backend';
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
import { canUsePowerMutation, PowerUserSettingsService } from '../../shared/power-user-settings.service';

@Component({
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatCardModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatMenuModule, MatSelectModule, RankingTableComponent, BackButtonComponent, DeckArchetypeInputComponent],
  template: `
    <div class="tournament-archive-detail-action-row" data-cy="tournament-archive-detail-action-row">
      <gones-back-button data-cy="tournament-archive-detail-back-top" [link]="leagueBackLink()" [label]="i18n.t('nav.backToLeague')" position="top" />
      <div class="tournament-archive-detail-edit-actions" data-cy="tournament-archive-detail-edit-actions">
        @if (editing()) {
          <button mat-stroked-button type="button" class="secondary-action" data-cy="tournament-archive-detail-cancel-edit" [disabled]="saving()" (click)="cancelEdit()">{{ i18n.t('tournament.cancelEdit') }}</button>
          <button mat-flat-button type="button" class="create-action-button" data-cy="tournament-archive-detail-save-changes" [disabled]="saving()" (click)="save()">{{ saving() ? i18n.t('common.saving') : i18n.t('tournament.saveChanges') }}</button>
        } @else if (canEdit()) {
          <button mat-stroked-button type="button" class="secondary-action" data-cy="tournament-archive-detail-edit" (click)="startEdit()">{{ i18n.t('tournament.edit') }}</button>
        }
        @if (canToggleStatus() && !editing()) {
          <button mat-stroked-button type="button" class="secondary-action" data-cy="archive-tournament-complete-toggle" [disabled]="saving()" (click)="toggleStatus()">{{ toggleLabel() }}</button>
        }
      </div>
    </div>
    @if (error()) { <p class="error" role="alert" data-cy="tournament-archive-detail-error">{{ error() }}</p> }
    @if (tournament(); as t) {
      <section class="page-heading" data-cy="tournament-archive-detail-page" (input)="markDirty()">
        <div data-cy="tournament-archive-detail-heading-block">
          <p class="kicker" data-cy="tournament-archive-detail-kicker">{{ i18n.t('tournament.kicker') }}</p>
          <span class="status archive-tournament-status" [class.completed]="t.status === 'completed'" data-cy="archive-tournament-status-badge"><span class="status-dot" aria-hidden="true" data-cy="archive-tournament-status-dot"></span>{{ statusLabel() }}</span>
          <div class="tournament-heading-fields" data-cy="tournament-archive-detail-heading-fields">
            @if (editing()) { <mat-form-field appearance="outline" class="title-field" data-cy="tournament-archive-detail-name-field"><mat-label data-cy="tournament-archive-detail-name-label">{{ i18n.t('tournament.name') }}</mat-label><input data-cy="tournament-archive-detail-name-input" matInput [(ngModel)]="t.name" [readonly]="saving()"></mat-form-field> }
            @else { <h1 data-cy="tournament-archive-detail-title">{{ t.name }}</h1> }
            <mat-form-field appearance="outline" class="tournament-date-field" data-cy="tournament-archive-detail-date-field"><mat-label data-cy="tournament-archive-detail-date-label">{{ i18n.t('tournament.date') }}</mat-label><input matInput type="date" data-cy="tournament-archive-detail-date-input" [(ngModel)]="t.tournamentDate" [readonly]="!canManage()"></mat-form-field>
            <mat-form-field appearance="outline" class="tournament-league-field" data-cy="tournament-archive-detail-league-field"><mat-label data-cy="tournament-archive-detail-league-label">{{ i18n.t('tournament.league') }}</mat-label><mat-select data-cy="tournament-archive-detail-league-select" [ngModel]="selectedLeagueId()" [disabled]="!canManage() || saving()" (ngModelChange)="moveTournamentToLeague($event)">@for (leagueOption of leagueOptions(); track leagueOption.id) { <mat-option [attr.data-cy]="'tournament-archive-detail-league-option-' + leagueOption.id" [value]="leagueOption.id">{{ leagueDisplayName(leagueOption) }}</mat-option> }</mat-select></mat-form-field>
          </div>
          @if (result().provisional || result().incomplete) {
            <div class="warning" data-cy="tournament-archive-detail-completion-warning">
              <p data-cy="tournament-archive-detail-completion-warning-text">{{ result().provisional ? i18n.t('tournament.provisional') : i18n.t('tournament.incomplete') }}</p>
              @if (completionIssues().length) {
                <ul data-cy="tournament-archive-detail-completion-issue-list">
                  @for (issue of completionIssues(); track issue) { <li data-cy="tournament-archive-detail-completion-issue">{{ issue }}</li> }
                </ul>
              }
            </div>
          }
        </div>
      </section>
      @if (warnings().length) {
        <div class="warning" data-cy="tournament-archive-detail-warnings">
          <p data-cy="tournament-archive-detail-warnings-text">{{ i18n.t('tournament.warnings', { count: warnings().length }) }}</p>
          <ul data-cy="tournament-archive-detail-warning-list">
            @for (warning of warningMessages(); track warning) { <li data-cy="tournament-archive-detail-warning">{{ warning }}</li> }
          </ul>
        </div>
      }
      @if (importErrors().length) {
        <div class="error" role="alert" data-cy="tournament-archive-detail-import-conflict">
          <p data-cy="tournament-archive-detail-import-conflict-text">{{ i18n.t('tournament.importConflict') }}</p>
          <ul data-cy="tournament-archive-detail-import-conflict-list">
            @for (message of importErrors(); track message) { <li data-cy="tournament-archive-detail-import-conflict-row">{{ message }}</li> }
          </ul>
          <button mat-stroked-button type="button" class="secondary-action" data-cy="tournament-archive-detail-dismiss-import-conflict" (click)="importErrors.set([])">{{ i18n.t('tournament.closeWarning') }}</button>
        </div>
      }
      <section class="stack" data-cy="tournament-archive-detail-ranking-section"><h2 data-cy="tournament-archive-detail-ranking-title">{{ i18n.t('tournament.ranking') }}</h2><gones-ranking-table data-cy="tournament-archive-detail-ranking-table" [rows]="result().rows" [emptyText]="i18n.t('tournament.emptyRanking')" /></section>
      <section class="stack tournament-rounds-section" data-cy="tournament-archive-detail-rounds-section" (input)="syncPlayerArchetypesFromRoundEntries()">
        @if (canManage()) { <div class="rounds-section-actions" data-cy="tournament-archive-detail-rounds-actions"><button class="add-round-button create-action-button" mat-flat-button type="button" data-cy="tournament-archive-detail-add-round" [disabled]="saving()" [attr.aria-label]="i18n.t('tournament.addRound')" (click)="addRound()"><span data-cy="tournament-archive-detail-add-round-label">{{ i18n.t('tournament.addRound') }}</span></button></div> }
        <mat-expansion-panel #roundsPanel class="round-panel rounds-section-panel" data-cy="tournament-archive-detail-rounds-panel">
          <mat-expansion-panel-header data-cy="tournament-archive-detail-rounds-panel-header">
            <mat-panel-title class="round-panel-title" data-cy="tournament-archive-detail-rounds-panel-title">{{ i18n.t('tournament.rounds') }}</mat-panel-title>
            <mat-panel-description data-cy="tournament-archive-detail-rounds-panel-description">{{ i18n.plural(t.rounds.length, 'tournament.roundCountOne', 'tournament.roundCountMany') }}</mat-panel-description>
          </mat-expansion-panel-header>
          @for (roundView of roundViewModels(t); track roundView.round.id) {
            <mat-expansion-panel class="round-panel" [attr.id]="'tournament-round-' + roundView.number" [attr.data-cy]="'tournament-archive-detail-round-' + roundView.number" [expanded]="isRoundExpanded(roundView.number)" (opened)="setRoundExpanded(roundView.number, true)" (closed)="setRoundExpanded(roundView.number, false)">
              <mat-expansion-panel-header data-cy="tournament-archive-detail-round-header">
                <mat-panel-title class="round-panel-title" data-cy="tournament-archive-detail-round-title">{{ i18n.t('tournament.roundN', { n: roundView.number }) }}</mat-panel-title>
                <mat-panel-description data-cy="tournament-archive-detail-round-description">{{ i18n.t('tournament.entriesCount', { count: roundView.round.entries.length }) }}</mat-panel-description>
                @if (canManage()) { <button class="round-menu-button" mat-icon-button data-cy="tournament-archive-detail-round-menu-trigger" [matMenuTriggerFor]="roundMenu" type="button" [disabled]="saving()" [attr.aria-label]="i18n.t('tournament.roundActions')" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">⋯</button> }
              </mat-expansion-panel-header>
              <mat-menu #roundMenu="matMenu" data-cy="tournament-archive-detail-round-menu">
                <button class="destructive-menu-item" mat-menu-item type="button" data-cy="tournament-archive-detail-delete-round" (click)="deleteRound(roundView.round)">{{ i18n.t('tournament.deleteRound') }}</button>
              </mat-menu>
              @if (canManage()) {
                <div class="import-row" data-cy="tournament-archive-detail-import-row">
                  <mat-form-field appearance="outline" data-cy="tournament-archive-detail-round-import-field"><mat-label data-cy="tournament-archive-detail-round-import-label">{{ i18n.t('tournament.roundImport') }}</mat-label><textarea matInput #importText data-cy="tournament-archive-detail-round-import-input" rows="4" [placeholder]="roundImportPlaceholder"></textarea></mat-form-field>
                  @if (hasValidRoundImport(importText.value)) { <button class="round-import-button create-action-button" mat-flat-button type="button" data-cy="tournament-archive-detail-round-import-submit" [disabled]="saving()" (click)="replaceRound(roundView.round, importText.value); importText.value = ''">{{ i18n.t('tournament.importRoundData') }}</button> }
                </div>
              }
              @if (roundView.round.entries.length) {
                <div class="table-wrap round-entry-table-wrap" data-cy="tournament-archive-detail-round-entry-table-wrap">
                  <table class="ranking-table round-entry-table" data-cy="tournament-archive-detail-round-entry-table">
                    <thead data-cy="tournament-archive-detail-round-entry-head">
                      <tr data-cy="tournament-archive-detail-round-entry-head-row">
                        <th scope="col" data-cy="tournament-archive-detail-round-entry-head-table">{{ i18n.t('common.table') }}</th>
                        <th scope="col" data-cy="tournament-archive-detail-round-entry-head-player1">{{ i18n.t('tournament.player1Name') }}</th>
                        <th scope="col" data-cy="tournament-archive-detail-round-entry-head-player1-score">{{ i18n.t('tournament.player1Score') }}</th>
                        <th scope="col" data-cy="tournament-archive-detail-round-entry-head-player2">{{ i18n.t('tournament.player2Name') }}</th>
                        <th scope="col" data-cy="tournament-archive-detail-round-entry-head-player2-score">{{ i18n.t('tournament.player2Score') }}</th>
                        <th scope="col" data-cy="tournament-archive-detail-round-entry-head-actions">{{ i18n.t('common.actions') }}</th>
                      </tr>
                    </thead>
                    <tbody data-cy="tournament-archive-detail-round-entry-body">
                      @for (entry of roundView.round.entries; track entry.id; let entryIndex = $index) {
                        <tr data-cy="tournament-archive-detail-round-entry-row" [class.invalid]="entryInvalid(entry)" [class.is-warning]="entryHasWarning(roundView.round, entry)">
                          @if (entry.kind === 'match') {
                            <td class="round-entry-table__compact" data-cy="tournament-archive-detail-match-table-cell"><input data-cy="tournament-archive-detail-match-table-input" [(ngModel)]="entry.table" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'table')"></td>
                            <td data-cy="tournament-archive-detail-match-player1-cell"><input data-cy="tournament-archive-detail-match-player1-input" [(ngModel)]="entry.player1Name" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 1')"></td>
                            <td class="round-entry-table__score" data-cy="tournament-archive-detail-match-player1-score-cell"><input type="number" data-cy="tournament-archive-detail-match-player1-score-input" [(ngModel)]="entry.player1Score" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 1 wins')"></td>
                            <td data-cy="tournament-archive-detail-match-player2-cell"><input data-cy="tournament-archive-detail-match-player2-input" [(ngModel)]="entry.player2Name" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 2')"></td>
                            <td class="round-entry-table__score" data-cy="tournament-archive-detail-match-player2-score-cell"><input type="number" data-cy="tournament-archive-detail-match-player2-score-input" [(ngModel)]="entry.player2Score" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 1 losses')"></td>
                            <td data-cy="tournament-archive-detail-match-actions-cell"><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" data-cy="tournament-archive-detail-match-delete" [disabled]="!canManage() || saving()" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">{{ i18n.t('common.delete') }}</button></td>
                          } @else if (entry.kind === 'bye') {
                            <td class="round-entry-table__compact" data-cy="tournament-archive-detail-bye-table-cell"><input data-cy="tournament-archive-detail-bye-table-input" [(ngModel)]="entry.table" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'table')"></td>
                            <td data-cy="tournament-archive-detail-bye-player-cell"><input data-cy="tournament-archive-detail-bye-player-input" [(ngModel)]="entry.playerName" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'bye player')"></td>
                            <td class="round-entry-table__empty" data-cy="tournament-archive-detail-bye-empty-1"></td>
                            <td class="round-entry-table__empty" data-cy="tournament-archive-detail-bye-empty-2"></td>
                            <td class="round-entry-table__empty" data-cy="tournament-archive-detail-bye-empty-3"></td>
                            <td data-cy="tournament-archive-detail-bye-actions-cell"><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" data-cy="tournament-archive-detail-bye-delete" [disabled]="!canManage() || saving()" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">{{ i18n.t('common.delete') }}</button></td>
                          }
                          @else {
                            <td class="round-entry-table__compact" data-cy="tournament-archive-detail-invalid-table-cell"><input data-cy="tournament-archive-detail-invalid-table-input" [(ngModel)]="entry.table" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row table')"></td>
                            <td data-cy="tournament-archive-detail-invalid-raw-cell"><input data-cy="tournament-archive-detail-invalid-raw-input" [(ngModel)]="entry.rawText" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 1')"></td>
                            <td class="round-entry-table__score" data-cy="tournament-archive-detail-invalid-result-cell"><input data-cy="tournament-archive-detail-invalid-result-input" [(ngModel)]="entry.result" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 1 score')"></td>
                            <td data-cy="tournament-archive-detail-invalid-opponent-cell"><input data-cy="tournament-archive-detail-invalid-opponent-input" [(ngModel)]="entry.opponent" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 2')"></td>
                            <td class="round-entry-table__empty" data-cy="tournament-archive-detail-invalid-empty"></td>
                            <td data-cy="tournament-archive-detail-invalid-actions-cell"><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" data-cy="tournament-archive-detail-invalid-delete" [disabled]="!canManage() || saving()" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">{{ i18n.t('common.delete') }}</button></td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              @if (canManage()) { <div class="round-entry-actions" data-cy="tournament-archive-detail-round-entry-actions"><button mat-stroked-button type="button" data-cy="tournament-archive-detail-add-match" [disabled]="saving()" (click)="addMatch(roundView.round)">{{ i18n.t('tournament.addMatch') }}</button><button mat-stroked-button type="button" data-cy="tournament-archive-detail-add-bye" [disabled]="saving()" (click)="addBye(roundView.round)">{{ i18n.t('tournament.addBye') }}</button></div> }
            </mat-expansion-panel>
          }
        </mat-expansion-panel>
      </section>
      <section class="stack tournament-player-archetypes-section" data-cy="tournament-archive-detail-archetypes-section" (input)="markDirty()">
        <mat-expansion-panel class="round-panel player-archetype-panel" data-cy="tournament-archive-detail-player-archetype-panel" [expanded]="false">
          <mat-expansion-panel-header data-cy="tournament-archive-detail-player-archetype-header">
            <mat-panel-title class="round-panel-title" data-cy="tournament-archive-detail-player-archetype-title">{{ i18n.t('tournament.playerArchetypes') }}</mat-panel-title>
            <mat-panel-description data-cy="tournament-archive-detail-player-archetype-description">{{ i18n.t('tournament.playersCount', { count: playerArchetypeRows(t).length }) }}</mat-panel-description>
          </mat-expansion-panel-header>
          <p class="muted" data-cy="tournament-archive-detail-archetype-help">{{ i18n.t('tournament.archetypeHelp') }}</p>
          @if (playerArchetypeRows(t).length) {
            <div class="player-archetype-list" role="group" data-cy="tournament-archive-detail-player-archetype-list" [attr.aria-label]="i18n.t('tournament.playerArchetypes')">
              <div class="player-archetype-list__header" aria-hidden="true" data-cy="tournament-archive-detail-player-archetype-list-header">
                <span data-cy="tournament-archive-detail-player-archetype-player-column">{{ i18n.t('common.player') }}</span>
                <span data-cy="tournament-archive-detail-player-archetype-deck-column">{{ i18n.t('tournament.deckArchetypeCol') }}</span>
              </div>
              @for (row of playerArchetypeRows(t); track row.playerName; let rowIndex = $index) {
                <div class="player-archetype-row" data-cy="tournament-archive-detail-player-archetype-row">
                  <label class="player-archetype-row__player" data-cy="tournament-archive-detail-player-archetype-label" [attr.for]="'player-archetype-' + rowIndex"><span class="sr-only" data-cy="tournament-archive-detail-player-archetype-sr-label">Deck archetype for </span>{{ row.playerName }}</label>
                  @if (canManage()) { <gones-deck-archetype-input data-cy="tournament-archive-detail-player-archetype-input" [inputId]="'player-archetype-' + rowIndex" [label]="i18n.t('live.deckArchetypeFor', { name: row.playerName })" [value]="archetypeFor(t, row.playerName)" (valueChange)="setArchetype(row.playerName, $event)" /> }
                  @else { <span data-cy="tournament-archive-detail-player-archetype-value">{{ archetypeFor(t, row.playerName) || i18n.t('tournament.noArchetype') }}</span> }
                </div>
              }
            </div>
          } @else { <p class="empty" data-cy="tournament-archive-detail-no-players">{{ i18n.t('tournament.noPlayersYet') }}</p> }
        </mat-expansion-panel>
      </section>
      @if (!editing()) { <p class="muted" data-cy="tournament-archive-detail-read-only">{{ i18n.t('leagues.readOnly') }}</p> }
      @if (stale()) { <button type="button" class="secondary-action" data-cy="tournament-archive-detail-reload" [disabled]="saving()" (click)="reloadLatest()">{{ i18n.t('leagues.reloadLatest') }}</button> }
    } @else if (!loading()) { <mat-card class="panel" data-cy="tournament-archive-detail-not-found"><mat-card-title data-cy="tournament-archive-detail-not-found-title">{{ i18n.t('tournament.notFoundTitle') }}</mat-card-title><mat-card-content data-cy="tournament-archive-detail-not-found-body"><p data-cy="tournament-archive-detail-not-found-text">{{ i18n.t('tournament.notFoundBody') }}</p></mat-card-content></mat-card> }
    @if (!loading()) { <gones-back-button data-cy="tournament-archive-detail-back-bottom" [link]="leagueBackLink()" [label]="i18n.t('nav.backToLeague')" position="bottom" /> }
  `
})
export class TournamentArchiveDetailComponent {
  readonly i18n = inject(I18nService);
  @ViewChild('roundsPanel') private roundsPanel?: MatExpansionPanel;

  readonly league = signal<PersistedLeague | null>(null);
  readonly draft = signal<LeagueDocument | null>(null);
  readonly editing = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly dirty = signal(false);
  readonly error = signal('');
  readonly stale = signal(false);
  readonly importErrors = signal<string[]>([]);
  private readonly power = inject(PowerUserSettingsService);
  /** Power mode never replaces per-league role/origin authority. */
  readonly canEdit = computed(() => {
    const league = this.league();
    return Boolean(league && league.status === 'active' && canUsePowerMutation(this.power.enabled(), canManageLeague(league.id, this.auth.profile()?.globalRole)));
  });
  readonly canManage = computed(() => this.editing() && this.canEdit());
  readonly canToggleStatus = computed(() => canUsePowerMutation(this.power.enabled(), canManageLeague(this.leagueId(), this.auth.profile()?.globalRole)));
  readonly statusLabel = computed(() => this.i18n.t(this.tournament()?.status === 'completed' ? 'archive.tournamentCompleted' : 'archive.tournamentActive'));
  readonly toggleLabel = computed(() => this.tournament()?.status === 'completed' ? this.i18n.t('archive.reopen') : this.i18n.t('archive.markComplete'));
  readonly expandedRoundNumbers = signal<ReadonlySet<number>>(new Set());
  readonly leagues = signal<PersistedLeague[]>([]);
  readonly leagueOptions = computed(() => this.league() ? sameAuthorityLeagueOptions(this.league()!, this.leagues()) : []);
  readonly currentLeague = computed(() => this.editing() ? this.draft() : this.league());
  readonly tournament = computed(() => this.currentLeague()?.tournaments.find((item) => item.id === this.tournamentId()) ?? null);
  readonly result = computed(() => this.tournament() ? calculateTournamentResult(this.tournament()!) : { rows: [], incomplete: true, provisional: false });
  readonly warnings = computed(() => this.tournament() ? getTournamentWarnings(this.tournament()!) : []);
  readonly completionIssues = computed(() => this.tournament() ? tournamentCompletionIssues(this.tournament()!, this.i18n) : []);
  readonly warningMessages = computed(() => this.tournament() ? this.warnings().map((warning) => tournamentWarningMessage(warning, this.tournament()!, this.i18n)) : []);
  readonly leagueId = signal('');
  readonly selectedLeagueId = signal('');
  private readonly tournamentId = signal('');
  readonly leagueBackLink = computed(() => ['/leagues-archive', this.leagueId()]);
  get roundImportPlaceholder(): string { return this.i18n.t('tournament.roundImportPlaceholder'); }

  constructor(readonly repo: LeagueArchiveRepository, private readonly auth: AuthService, private readonly route: ActivatedRoute, private readonly router: Router, private readonly dialog: MatDialog) { void this.load(); }
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
      this.selectedLeagueId.set(league?.id ?? leagueId);
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
    if (this.roundsPanel) this.roundsPanel.expanded = true;
    this.setRoundExpanded(roundNumber, true);
    setTimeout(() => {
      document.getElementById(`tournament-round-${roundNumber}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  startEdit(league = this.league()): void {
    if (!league || !this.canEdit()) return;
    this.draft.set(structuredClone(league));
    this.selectedLeagueId.set(league.id);
    this.editing.set(true);
    this.dirty.set(false);
    this.stale.set(false);
    this.error.set('');
    this.importErrors.set([]);
  }

  async cancelEdit(): Promise<void> {
    if (!this.editing() || this.saving()) return;
    if (!this.dirty()) {
      this.exitEdit();
      return;
    }
    this.saving.set(true);
    try {
      const confirmed = await this.confirmDiscard('tournament.discardEditTitle', 'tournament.discardEditMessage');
      if (confirmed) this.exitEdit();
    } finally {
      this.saving.set(false);
    }
  }

  markDirty(): void {
    if (this.canManage() && !this.saving()) this.dirty.set(true);
  }

  addRound(): void {
    if (!this.canManage() || this.saving()) return;
    if (this.roundsPanel) this.roundsPanel.expanded = true;
    this.updateTournament(tournament => ({ ...tournament, rounds: [...tournament.rounds, createRound()] }));
  }

  addMatch(round: RoundDocument): void {
    if (!this.canManage() || this.saving()) return;
    this.updateRound(round.id, item => ({ ...item, entries: [...item.entries, createMatchRoundEntry({ table: String(item.entries.length + 1) })] }));
  }

  addBye(round: RoundDocument): void {
    if (!this.canManage() || this.saving()) return;
    this.updateRound(round.id, item => ({ ...item, entries: [...item.entries, createByeRoundEntry({ table: String(item.entries.length + 1) })] }));
  }

  replaceRound(round: RoundDocument, text: string): void {
    if (!this.canManage() || this.saving()) return;
    const tournament = this.tournament();
    if (!tournament) return;
    const imported = importRoundEntries(text);
    const merged = mergeImportedRoundArchetypes(tournament, imported.entries);
    this.importErrors.set(merged.conflicts.map((conflict) => this.i18n.t('tournament.importConflictRow', {
      player: conflict.playerName,
      imported: conflict.importedArchetype || this.i18n.t('tournament.noArchetype'),
      existing: conflict.existingArchetype || this.i18n.t('tournament.noArchetype')
    })));
    this.updateTournament(item => ({
      ...item,
      rounds: item.rounds.map(candidate => candidate.id === round.id ? { ...candidate, entries: merged.entries } : candidate),
      playerArchetypes: merged.playerArchetypes
    }));
  }

  playerArchetypeRows(tournament: TournamentDocument) { return tournamentPlayerArchetypeRows(tournament); }
  archetypeFor(tournament: TournamentDocument, playerName: string): string { return archetypeForPlayer(tournament, playerName); }

  syncPlayerArchetypesFromRoundEntries(): void {
    if (!this.canManage()) return;
    const tournament = this.tournament();
    if (!tournament) return;
    const rows = tournamentPlayerArchetypeRows(tournament);
    const sameRows = rows.length === (tournament.playerArchetypes ?? []).length
      && rows.every((row, index) => row.playerName === tournament.playerArchetypes[index]?.playerName && row.archetype === tournament.playerArchetypes[index]?.archetype);
    if (sameRows) {
      this.markDirty();
      return;
    }
    this.updateTournament(item => ({ ...item, playerArchetypes: rows }));
  }

  setArchetype(playerName: string, archetype: string): void {
    if (!this.canManage()) return;
    this.importErrors.set([]);
    this.updateTournament(tournament => setTournamentPlayerArchetype(tournament, playerName, archetype));
  }

  hasValidRoundImport(text: string): boolean {
    const entries = importRoundEntries(text).entries;
    return entries.length > 0 && entries.every(entry => entry.kind === 'match');
  }

  roundEntryInputLabel(roundNumber: number, entryIndex: number, field: string): string { return this.i18n.t('tournament.roundEntryLabel', { round: roundNumber, entry: entryIndex + 1, field }); }
  roundEntryDeleteLabel(roundNumber: number, entryIndex: number): string { return this.i18n.t('tournament.roundEntryDelete', { round: roundNumber, entry: entryIndex + 1 }); }
  entryInvalid(entry: RoundEntry): boolean { return !validateRoundEntry(entry).valid; }
  entryHasWarning(round: RoundDocument, entry: RoundEntry): boolean {
    return this.warnings().some(warning => warning.roundId === round.id && (warning.entryIds?.includes(entry.id) ?? false));
  }
  roundViewModels(tournament: TournamentDocument): Array<{ round: RoundDocument; number: number }> {
    return tournament.rounds.map((round, index) => ({ round, number: index + 1 })).reverse();
  }
  leagueDisplayName(league: Pick<PersistedLeague, 'id' | 'name'>): string {
    return league.id === PLACEHOLDER_LEAGUE_ID ? this.i18n.t('liveList.unassigned') : league.name;
  }

  moveTournamentToLeague(targetLeagueId: string): void {
    if (!this.canManage() || this.saving()) return;
    if (!this.leagueOptions().some(league => league.id === targetLeagueId)) return;
    this.selectedLeagueId.set(targetLeagueId);
    this.markDirty();
  }

  private updateTournament(updater: (tournament: TournamentDocument) => TournamentDocument): void {
    this.draft.update(league => league ? ({ ...league, tournaments: league.tournaments.map(tournament => tournament.id === this.tournamentId() ? updater(tournament) : tournament) }) : null);
    this.markDirty();
  }

  private updateRound(roundId: string, updater: (round: RoundDocument) => RoundDocument): void {
    this.updateTournament(tournament => ({ ...tournament, rounds: tournament.rounds.map(round => round.id === roundId ? updater(round) : round) }));
  }

  deleteEntry(round: RoundDocument, entryId: string): void {
    if (!this.canManage() || this.saving()) return;
    this.updateRound(round.id, item => ({ ...item, entries: item.entries.filter(entry => entry.id !== entryId) }));
  }

  deleteRound(round: RoundDocument): void {
    if (!this.canManage() || this.saving()) return;
    this.updateTournament(tournament => ({ ...tournament, rounds: tournament.rounds.filter(item => item.id !== round.id) }));
  }

  async save(): Promise<void> {
    if (!this.canManage() || this.saving()) return;
    const sourceLeague = this.league();
    const draftLeague = this.draft();
    const sourceTournament = sourceLeague?.tournaments.find(item => item.id === this.tournamentId());
    const draftTournament = draftLeague?.tournaments.find(item => item.id === this.tournamentId());
    if (!sourceLeague || !draftLeague || !sourceTournament || !draftTournament) return;

    draftTournament.name = String(draftTournament.name ?? '').trim() || getDefaultTournamentName();
    const command = buildArchiveTournamentEditBatch(sourceTournament, draftTournament);
    const targetLeague = this.selectedLeagueId() === sourceLeague.id
      ? null
      : this.leagueOptions().find(item => item.id === this.selectedLeagueId()) ?? null;
    if (!targetLeague && this.selectedLeagueId() !== sourceLeague.id) {
      this.error.set(this.i18n.t('tournament.invalidMoveTarget'));
      return;
    }
    if (archiveTournamentEditBatchIsEmpty(command) && !targetLeague) {
      this.exitEdit();
      return;
    }

    const issues = tournamentCompletionIssues(draftTournament, this.i18n, { includeMissingRound: false });
    if (issues.length) {
      this.error.set(this.i18n.t('tournament.invalidDraft', { count: issues.length }));
      return;
    }

    const deleted = archiveTournamentDeletionSummary(sourceTournament, draftTournament);
    this.saving.set(true);
    try {
      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: this.i18n.t('tournament.saveChangesTitle'),
          message: this.i18n.t('tournament.saveChangesSummary', {
            move: targetLeague ? targetLeague.name : this.i18n.t('tournament.noLeagueMove'),
            rounds: deleted.rounds,
            entries: deleted.entries
          }),
          confirmLabel: this.i18n.t('tournament.saveChanges'),
          destructive: deleted.rounds > 0 || deleted.entries > 0
        }
      }).afterClosed());
      if (!confirmed) return;
      const result = await this.repo.saveTournamentEdits(sourceLeague, this.tournamentId(), targetLeague, command);
      this.error.set('');
      this.stale.set(false);
      this.importErrors.set([]);
      this.notifyLeagueUpdated(result.sourceLeague.id);
      if (targetLeague) {
        if (!result.destinationLeague) throw new Error('destinationLeagueMissing');
        this.adoptLeague(result.destinationLeague);
        this.notifyLeagueUpdated(result.destinationLeague.id);
        await this.router.navigate(['/leagues-archive', result.destinationLeague.id, 'tournaments-archive', this.tournamentId()]);
      } else {
        this.adoptLeague(result.sourceLeague);
      }
    } catch (error) {
      logBoundaryError('tournament-detail.save', error, { leagueId: sourceLeague.id, tournamentId: this.tournamentId(), targetLeagueId: targetLeague?.id ?? null });
      this.applyCommandError(error, 'tournament.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  async reloadLatest(): Promise<void> {
    if (!this.stale() || this.saving()) return;
    this.saving.set(true);
    try {
      const confirmed = await this.confirmDiscard('tournament.reloadLatestTitle', 'tournament.reloadLatestMessage');
      if (!confirmed) return;
      const latest = await this.repo.getLeague(this.leagueId());
      if (!latest) throw new Error('leagueNotFound');
      this.adoptLeague(latest);
      this.error.set('');
      this.stale.set(false);
    } catch (error) {
      logBoundaryError('tournament-detail.reloadLatest', error, { leagueId: this.leagueId(), tournamentId: this.tournamentId() });
      this.applyCommandError(error, 'tournament.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  async toggleStatus(): Promise<void> {
    if (!this.canToggleStatus() || this.saving()) return;
    const sourceLeague = this.league();
    const tournament = sourceLeague?.tournaments.find(item => item.id === this.tournamentId());
    if (!sourceLeague || !tournament) return;
    const newStatus: LeagueStatus = tournament.status === 'completed' ? 'active' : 'completed';
    const confirmKey = newStatus === 'completed' ? 'archive.completeConfirm' : 'archive.reopenConfirm';
    const labelKey = newStatus === 'completed' ? 'archive.markComplete' : 'archive.reopen';
    this.saving.set(true);
    try {
      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: { title: this.i18n.t(labelKey), message: this.i18n.t(confirmKey), confirmLabel: this.i18n.t(labelKey) }
      }).afterClosed());
      if (!confirmed) return;
      const command: ArchiveTournamentEditBatchCommand = { status: newStatus, addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: [] };
      const result = await this.repo.saveTournamentEdits(sourceLeague, this.tournamentId(), null, command);
      this.error.set('');
      this.notifyLeagueUpdated(result.sourceLeague.id);
      this.adoptLeague(result.sourceLeague);
    } catch (error) {
      logBoundaryError('tournament-detail.toggleStatus', error, { leagueId: sourceLeague.id, tournamentId: this.tournamentId() });
      this.applyCommandError(error, 'tournament.saveFailed');
    } finally {
      this.saving.set(false);
    }
  }

  private async confirmDiscard(title: 'tournament.discardEditTitle' | 'tournament.reloadLatestTitle', message: 'tournament.discardEditMessage' | 'tournament.reloadLatestMessage'): Promise<boolean> {
    return Boolean(await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.i18n.t(title),
        message: this.i18n.t(message),
        confirmLabel: this.i18n.t('tournament.discardDraft'),
        destructive: true
      }
    }).afterClosed()));
  }

  private exitEdit(): void {
    this.draft.set(null);
    this.editing.set(false);
    this.dirty.set(false);
    this.stale.set(false);
    this.error.set('');
    this.importErrors.set([]);
    this.selectedLeagueId.set(this.league()?.id ?? this.leagueId());
  }

  private adoptLeague(league: PersistedLeague): void {
    const reopenRounds = this.roundsPanel?.expanded ?? false;
    this.league.set(league);
    this.leagueId.set(league.id);
    this.exitEdit();
    if (reopenRounds && this.roundsPanel) this.roundsPanel.expanded = true;
  }

  private notifyLeagueUpdated(leagueId: string): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gones-league-updated', { detail: { leagueId } }));
  }

  private applyCommandError(error: unknown, fallback: 'tournament.moveFailed' | 'tournament.saveFailed'): void {
    const kind = leagueCommandError(error);
    this.stale.set(kind === 'stale');
    this.error.set(kind === 'stale' ? this.i18n.t('tournament.staleSave') : kind === 'forbidden' ? this.i18n.t('leagues.forbidden') : this.i18n.t(fallback));
  }

}

function tournamentCompletionIssues(tournament: TournamentDocument, i18n: I18nService, { includeMissingRound = true }: { includeMissingRound?: boolean } = {}): string[] {
  const issues: string[] = [];
  if (includeMissingRound && !tournament.rounds?.length) issues.push(i18n.t('tournament.needOneRound'));
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
  if (warning.code === 'missingDeckArchetype') {
    const players = (warning.playerNames?.length ? warning.playerNames : player ? [player] : []).join(', ');
    return i18n.t('tournament.warnMissingArchetype', { players });
  }
  return i18n.t('tournament.warnRepeatedPairing');
}
