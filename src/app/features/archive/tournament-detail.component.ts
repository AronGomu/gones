import { Component, HostListener, InjectionToken, Signal, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule, MatExpansionPanel } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import { Client } from '../../api/generated/gones-api';
import { AuthService } from '../../auth/auth.service';
import { ArchiveRepository } from '../../data/archive-repository.service';
import { archiveCommandError, canManageArchiveRecord } from '../../data/archive-command-ux';
import { isLocalArchiveId } from '../../data/archive-origin';
import { isArchiveTournamentRowLocked } from '../../data/archive-summary';
import {
  ArchiveTournamentDocument, PersistedArchiveTournament, toArchiveTournamentDocument, toTournamentDocument
} from '../../domain/archive-models';
import {
  ARCHIVE_STANDALONE_SEASON_VALUE, archiveStagedDeletionSummary, archiveStagedEditBatchIsEmpty, buildArchiveStagedEditBatch
} from '../../domain/archive-staged-edit';
import {
  LeagueStatus, RoundDocument, RoundEntry, TournamentDocument, createByeRoundEntry, createMatchRoundEntry, createRound,
  formatPlayerWithArchetype
} from '../../domain/models';
import { calculateTournamentResult } from '../../domain/results';
import { importRoundEntries } from '../../domain/round-import';
import {
  archetypeForPlayer, mergeImportedRoundArchetypes, setTournamentPlayerArchetype, tournamentPlayerArchetypeRows,
  validateTournamentPlayerArchetypes
} from '../../domain/tournament-archetypes';
import { validateRoundEntry } from '../../domain/validation';
import { TournamentWarning, getTournamentWarnings } from '../../domain/warnings';
import { I18nService } from '../../i18n/i18n.service';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { DeckArchetypeInputComponent } from '../../shared/deck-archetype-input.component';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { PowerUserSettingsService, canUsePowerMutation } from '../../shared/power-user-settings.service';
import { RankingTableComponent } from '../../shared/ranking-table.component';

/**
 * The whole Tournament document as `GET /api/archive/tournaments/{id}` serves it. It is the archive's
 * own persisted shape — reused rather than redeclared, so the ranking adapter below stays the single
 * one in the app.
 */
export type ArchiveTournamentDetail = PersistedArchiveTournament;

/** A move target: a Season this Tournament may be attached to, in the same authority. */
export interface ArchiveSeasonOption {
  readonly id: string;
  readonly name: string;
}

export interface ArchiveTournamentDetailSource {
  /** `undefined` for `404` — an absent or soft-deleted Tournament is a page state, not an error. */
  getTournament(tournamentId: string): Promise<ArchiveTournamentDetail | undefined>;
  getSeasonName(seasonId: string): Promise<string | undefined>;
}

/** Exactly the one archive read this page makes, and nothing else on `Client`. */
interface ArchiveDetailReadClient {
  archiveTournamentDetail(tournamentId: string): Observable<RawArchiveTournamentDetail>;
}

/** The runtime JSON of the detail route: `updatedAt` arrives as an ISO string, `seasonId` as `null`. */
interface RawArchiveTournamentDetail {
  id: string;
  name: string;
  seasonId?: string | null;
  tournamentDate: unknown;
  status: string;
  rounds?: RawRound[];
  playerArchetypes?: { playerName: string; archetype: string }[];
  documentVersion: number;
  updatedAt: unknown;
}

/**
 * `entries` is `unknown[]` on purpose: the generated client renders a `RoundEntry` as an opaque
 * index-signature interface, which is not assignable to the domain union even though the JSON on the
 * wire is exactly it. Widening here keeps `inject(Client)` assignable to the port and confines the
 * conversion to the one cast below.
 */
interface RawRound { id: string; entries: unknown[] }

function archiveTournamentDetailSourceFactory(): ArchiveTournamentDetailSource {
  const client: ArchiveDetailReadClient = inject(Client);
  const repo = inject(ArchiveRepository);
  return {
    // A Tournament document is not catalog data: it is the read-through, never-cached half of the
    // archive, so it comes straight off the route instead of through the catalog cache.
    getTournament: async (tournamentId) => {
      try {
        const raw = await firstValueFrom(client.archiveTournamentDetail(tournamentId));
        return {
          id: raw.id,
          name: raw.name,
          seasonId: raw.seasonId ?? null,
          tournamentDate: String(raw.tournamentDate ?? ''),
          status: raw.status === 'completed' ? 'completed' : ('active' as LeagueStatus),
          rounds: (raw.rounds ?? []).map((round) => ({ id: round.id, entries: round.entries as RoundEntry[] })),
          playerArchetypes: raw.playerArchetypes ?? [],
          documentVersion: raw.documentVersion,
          updatedAt: String(raw.updatedAt ?? '')
        };
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    getSeasonName: async (seasonId) => (await repo.listLeagueSeasons()).items.find((season) => season.id === seasonId)?.name
  };
}

/** A `404` is a page state; every other status stays an error the page renders as one.
 *  `ApiException` carries the status the generated client threw with. */
function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: number }).status === 404;
}

export const ARCHIVE_TOURNAMENT_DETAIL_SOURCE = new InjectionToken<ArchiveTournamentDetailSource>(
  'ARCHIVE_TOURNAMENT_DETAIL_SOURCE',
  { providedIn: 'root', factory: archiveTournamentDetailSourceFactory }
);

/**
 * Adapts the three-tier document to the shape the two result calculators take. The legacy `leagueId`
 * slot is filled with `seasonId ?? ''` and is never read: `calculateTournamentResult` and
 * `buildTournamentSummary` reach only `rounds` and `playerArchetypes`.
 */
export function toResultInput(detail: ArchiveTournamentDetail): TournamentDocument {
  return toTournamentDocument(detail, detail.seasonId ?? '');
}

/** One round, numbered for display. The document stores order, not numbers. */
interface RoundView {
  readonly number: number;
  readonly entries: readonly RoundEntry[];
}

/**
 * `/archive/tournaments/:tournamentId` — the archived Tournament: its date, status, lock, Season (or
 * the standalone marker), the computed ranking, its rounds and a link to the result.
 *
 * Read-only for everyone on load. An authorized Power User (ADR 0037) clicks Edit, mutates an
 * in-memory draft that never touches a store, and one confirmed Save Changes sends a single
 * explicit-intent batch whose response carries the authoritative document back.
 */
@Component({
  selector: 'gones-tournament-detail',
  standalone: true,
  imports: [
    RouterLink, FormsModule, MatButtonModule, MatCardModule, MatExpansionModule, MatFormFieldModule, MatInputModule,
    MatMenuModule, MatSelectModule, RankingTableComponent, BackButtonComponent, DeckArchetypeInputComponent
  ],
  template: `
    <gones-back-button data-cy="archive-tournament-back-top" [link]="['/archive/tournaments']" [label]="i18n.t('archiveDetail.backToTournaments')" position="top" />

    <div class="section-header" data-cy="archive-tournament-edit-actions">
      @if (editing()) {
        <button mat-stroked-button type="button" class="secondary-action" data-cy="archive-tournament-cancel-edit" [disabled]="saving()" (click)="cancelEdit()">{{ i18n.t('archiveEdit.cancelEdit') }}</button>
        <button mat-flat-button type="button" class="create-action-button" data-cy="archive-tournament-save-changes" [disabled]="saving()" (click)="save()">{{ saving() ? i18n.t('common.saving') : i18n.t('archiveEdit.saveChanges') }}</button>
      } @else if (canEdit()) {
        <button mat-stroked-button type="button" class="secondary-action" data-cy="archive-tournament-edit" (click)="startEdit()">{{ i18n.t('archiveEdit.edit') }}</button>
      }
      @if (canToggleStatus()) {
        <button mat-stroked-button type="button" class="secondary-action" data-cy="archive-tournament-complete-toggle" [disabled]="saving()" (click)="toggleStatus()">{{ toggleLabel() }}</button>
      }
    </div>
    @if (error()) { <p class="error" role="alert" data-cy="archive-tournament-edit-error">{{ error() }}</p> }
    @if (lockBlocksEdit()) { <p class="muted" data-cy="archive-tournament-locked-notice">{{ i18n.t('archiveEdit.lockedNotice') }}</p> }

    @if (tournament(); as t) {
      <section class="page-heading" data-cy="archive-tournament-heading">
        @if (editing()) {
          <div class="tournament-heading-fields" data-cy="archive-tournament-edit-fields" (input)="markDirty()">
            <mat-form-field appearance="outline" class="title-field" data-cy="archive-tournament-edit-name-field"><mat-label data-cy="archive-tournament-edit-name-label">{{ i18n.t('tournament.name') }}</mat-label><input matInput data-cy="archive-tournament-edit-name-input" [(ngModel)]="draft()!.name" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline" class="tournament-date-field" data-cy="archive-tournament-edit-date-field"><mat-label data-cy="archive-tournament-edit-date-label">{{ i18n.t('tournament.date') }}</mat-label><input matInput type="date" data-cy="archive-tournament-edit-date-input" [(ngModel)]="draft()!.tournamentDate" [readonly]="saving()"></mat-form-field>
            <mat-form-field appearance="outline" class="tournament-league-field" data-cy="archive-tournament-edit-season-field"><mat-label data-cy="archive-tournament-edit-season-label">{{ i18n.t('archiveEdit.season') }}</mat-label><mat-select data-cy="archive-tournament-edit-season-select" [ngModel]="selectedSeasonId() ?? standaloneValue" [disabled]="saving()" (ngModelChange)="moveTournamentToSeason($event)"><mat-option [value]="standaloneValue" data-cy="archive-tournament-edit-season-option-standalone">{{ i18n.t('archiveEdit.standaloneOption') }}</mat-option>@for (option of seasonOptions(); track option.id) { <mat-option [attr.data-cy]="'archive-tournament-edit-season-option-' + option.id" [value]="option.id">{{ seasonOptionLabel(option) }}</mat-option> }</mat-select></mat-form-field>
          </div>
        } @else {
          <h1 data-cy="archive-tournament-title">{{ t.name }}</h1>
          <p class="archive-tournament-dates" data-cy="archive-tournament-dates">
            <span data-cy="archive-tournament-played">{{ i18n.formatDate(t.tournamentDate, { dateStyle: 'long' }) }}</span>
            <span class="archive-tournament-updated" data-cy="archive-tournament-updated">{{ i18n.t('archiveDetail.updated', { date: i18n.formatDateTime(t.updatedAt) }) }}</span>
          </p>
        }
        <p class="archive-tournament-badges" data-cy="archive-tournament-badges">
          <span class="status" [class.completed]="t.status === 'completed'" data-cy="archive-tournament-status"><span class="status-dot" aria-hidden="true" data-cy="archive-tournament-status-dot"></span>{{ statusLabel() }}</span>
          @if (locked()) {
            <span class="archive-lock" role="img" [attr.aria-label]="i18n.t('archiveDetail.locked')" [attr.title]="i18n.t('archiveDetail.locked')" data-cy="archive-tournament-lock">🔒</span>
          }
        </p>
        @if (!editing()) {
          @if (t.seasonId) {
            <p class="archive-tournament-season" data-cy="archive-tournament-season">
              <span data-cy="archive-tournament-season-label">{{ i18n.t('archiveDetail.season') }}</span>
              <a [routerLink]="['/archive/league-seasons', t.seasonId]" data-cy="archive-tournament-season-link">{{ seasonName() || t.seasonId }}</a>
            </p>
          } @else {
            <p class="archive-tournament-season" data-cy="archive-tournament-standalone">{{ i18n.t('archiveDetail.standalone') }}</p>
          }
        }
      </section>

      @if (result().provisional || result().incomplete) {
        <div class="warning" data-cy="archive-tournament-completion-warning">
          <p data-cy="archive-tournament-completion-warning-text">{{ result().provisional ? i18n.t('tournament.provisional') : i18n.t('tournament.incomplete') }}</p>
          @if (completionIssues().length) {
            <ul data-cy="archive-tournament-completion-issue-list">
              @for (issue of completionIssues(); track issue) { <li data-cy="archive-tournament-completion-issue">{{ issue }}</li> }
            </ul>
          }
        </div>
      }
      @if (warnings().length) {
        <div class="warning" data-cy="archive-tournament-warnings">
          <p data-cy="archive-tournament-warnings-text">{{ i18n.t('tournament.warnings', { count: warnings().length }) }}</p>
          <ul data-cy="archive-tournament-warning-list">
            @for (warning of warningMessages(); track warning) { <li data-cy="archive-tournament-warning">{{ warning }}</li> }
          </ul>
        </div>
      }
      @if (importErrors().length) {
        <div class="error" role="alert" data-cy="archive-tournament-import-conflict">
          <p data-cy="archive-tournament-import-conflict-text">{{ i18n.t('tournament.importConflict') }}</p>
          <ul data-cy="archive-tournament-import-conflict-list">
            @for (message of importErrors(); track message) { <li data-cy="archive-tournament-import-conflict-row">{{ message }}</li> }
          </ul>
          <button mat-stroked-button type="button" class="secondary-action" data-cy="archive-tournament-dismiss-import-conflict" (click)="importErrors.set([])">{{ i18n.t('tournament.closeWarning') }}</button>
        </div>
      }

      <section class="stack" data-cy="archive-tournament-ranking-section">
        <h2 data-cy="archive-tournament-ranking-title">{{ i18n.t('tournament.ranking') }}</h2>
        <gones-ranking-table [rows]="result().rows" [emptyText]="i18n.t('tournament.emptyRanking')" data-cy="archive-tournament-ranking" />
      </section>

      <section class="stack tournament-rounds-section" data-cy="archive-tournament-rounds-section" (input)="syncPlayerArchetypesFromRoundEntries()">
        <h2 data-cy="archive-tournament-rounds-title">{{ i18n.t('tournament.rounds') }}</h2>
        @if (editing()) {
          @if (canManage()) { <div class="rounds-section-actions" data-cy="archive-tournament-rounds-actions"><button class="add-round-button create-action-button" mat-flat-button type="button" data-cy="archive-tournament-add-round" [disabled]="saving()" [attr.aria-label]="i18n.t('tournament.addRound')" (click)="addRound()"><span data-cy="archive-tournament-add-round-label">{{ i18n.t('tournament.addRound') }}</span></button></div> }
          <mat-expansion-panel #roundsPanel class="round-panel rounds-section-panel" data-cy="archive-tournament-rounds-panel" [expanded]="true">
            <mat-expansion-panel-header data-cy="archive-tournament-rounds-panel-header">
              <mat-panel-title class="round-panel-title" data-cy="archive-tournament-rounds-panel-title">{{ i18n.t('tournament.rounds') }}</mat-panel-title>
              <mat-panel-description data-cy="archive-tournament-rounds-panel-description">{{ i18n.plural(draft()!.rounds.length, 'tournament.roundCountOne', 'tournament.roundCountMany') }}</mat-panel-description>
            </mat-expansion-panel-header>
            @for (roundView of roundViewModels(draft()!); track roundView.round.id) {
              <mat-expansion-panel class="round-panel" [attr.id]="'archive-tournament-round-' + roundView.number" [attr.data-cy]="'archive-tournament-edit-round-' + roundView.number" [expanded]="isRoundExpanded(roundView.number)" (opened)="setRoundExpanded(roundView.number, true)" (closed)="setRoundExpanded(roundView.number, false)">
                <mat-expansion-panel-header data-cy="archive-tournament-edit-round-header">
                  <mat-panel-title class="round-panel-title" data-cy="archive-tournament-edit-round-title">{{ i18n.t('tournament.roundN', { n: roundView.number }) }}</mat-panel-title>
                  <mat-panel-description data-cy="archive-tournament-edit-round-description">{{ i18n.t('tournament.entriesCount', { count: roundView.round.entries.length }) }}</mat-panel-description>
                  @if (canManage()) { <button class="round-menu-button" mat-icon-button data-cy="archive-tournament-round-menu-trigger" [matMenuTriggerFor]="roundMenu" type="button" [disabled]="saving()" [attr.aria-label]="i18n.t('tournament.roundActions')" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">⋯</button> }
                </mat-expansion-panel-header>
                <mat-menu #roundMenu="matMenu" data-cy="archive-tournament-round-menu">
                  <button class="destructive-menu-item" mat-menu-item type="button" data-cy="archive-tournament-delete-round" (click)="deleteRound(roundView.round)">{{ i18n.t('tournament.deleteRound') }}</button>
                </mat-menu>
                @if (canManage()) {
                  <div class="import-row" data-cy="archive-tournament-import-row">
                    <mat-form-field appearance="outline" data-cy="archive-tournament-round-import-field"><mat-label data-cy="archive-tournament-round-import-label">{{ i18n.t('tournament.roundImport') }}</mat-label><textarea matInput #importText data-cy="archive-tournament-round-import-input" rows="4" [placeholder]="roundImportPlaceholder"></textarea></mat-form-field>
                    @if (hasValidRoundImport(importText.value)) { <button class="round-import-button create-action-button" mat-flat-button type="button" data-cy="archive-tournament-round-import-submit" [disabled]="saving()" (click)="replaceRound(roundView.round, importText.value); importText.value = ''">{{ i18n.t('tournament.importRoundData') }}</button> }
                  </div>
                }
                @if (roundView.round.entries.length) {
                  <div class="table-wrap round-entry-table-wrap" data-cy="archive-tournament-round-entry-table-wrap">
                    <table class="ranking-table round-entry-table" data-cy="archive-tournament-round-entry-table">
                      <thead data-cy="archive-tournament-round-entry-head">
                        <tr data-cy="archive-tournament-round-entry-head-row">
                          <th scope="col" data-cy="archive-tournament-round-entry-head-table">{{ i18n.t('common.table') }}</th>
                          <th scope="col" data-cy="archive-tournament-round-entry-head-player1">{{ i18n.t('tournament.player1Name') }}</th>
                          <th scope="col" data-cy="archive-tournament-round-entry-head-player1-score">{{ i18n.t('tournament.player1Score') }}</th>
                          <th scope="col" data-cy="archive-tournament-round-entry-head-player2">{{ i18n.t('tournament.player2Name') }}</th>
                          <th scope="col" data-cy="archive-tournament-round-entry-head-player2-score">{{ i18n.t('tournament.player2Score') }}</th>
                          <th scope="col" data-cy="archive-tournament-round-entry-head-actions">{{ i18n.t('common.actions') }}</th>
                        </tr>
                      </thead>
                      <tbody data-cy="archive-tournament-round-entry-body">
                        @for (entry of roundView.round.entries; track entry.id; let entryIndex = $index) {
                          <tr data-cy="archive-tournament-round-entry-row" [class.invalid]="entryInvalid(entry)" [class.is-warning]="entryHasWarning(roundView.round, entry)">
                            @if (entry.kind === 'match') {
                              <td class="round-entry-table__compact" data-cy="archive-tournament-match-table-cell"><input data-cy="archive-tournament-match-table-input" [(ngModel)]="entry.table" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'table')"></td>
                              <td data-cy="archive-tournament-match-player1-cell"><input data-cy="archive-tournament-match-player1-input" [(ngModel)]="entry.player1Name" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 1')"></td>
                              <td class="round-entry-table__score" data-cy="archive-tournament-match-player1-score-cell"><input type="number" data-cy="archive-tournament-match-player1-score-input" [(ngModel)]="entry.player1Score" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 1 wins')"></td>
                              <td data-cy="archive-tournament-match-player2-cell"><input data-cy="archive-tournament-match-player2-input" [(ngModel)]="entry.player2Name" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 2')"></td>
                              <td class="round-entry-table__score" data-cy="archive-tournament-match-player2-score-cell"><input type="number" data-cy="archive-tournament-match-player2-score-input" [(ngModel)]="entry.player2Score" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'player 1 losses')"></td>
                              <td data-cy="archive-tournament-match-actions-cell"><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" data-cy="archive-tournament-match-delete" [disabled]="!canManage() || saving()" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">{{ i18n.t('common.delete') }}</button></td>
                            } @else if (entry.kind === 'bye') {
                              <td class="round-entry-table__compact" data-cy="archive-tournament-bye-table-cell"><input data-cy="archive-tournament-bye-table-input" [(ngModel)]="entry.table" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'table')"></td>
                              <td data-cy="archive-tournament-bye-player-cell"><input data-cy="archive-tournament-bye-player-input" [(ngModel)]="entry.playerName" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'bye player')"></td>
                              <td class="round-entry-table__empty" data-cy="archive-tournament-bye-empty-1"></td>
                              <td class="round-entry-table__empty" data-cy="archive-tournament-bye-empty-2"></td>
                              <td class="round-entry-table__empty" data-cy="archive-tournament-bye-empty-3"></td>
                              <td data-cy="archive-tournament-bye-actions-cell"><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" data-cy="archive-tournament-bye-delete" [disabled]="!canManage() || saving()" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">{{ i18n.t('common.delete') }}</button></td>
                            } @else {
                              <td class="round-entry-table__compact" data-cy="archive-tournament-invalid-table-cell"><input data-cy="archive-tournament-invalid-table-input" [(ngModel)]="entry.table" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row table')"></td>
                              <td data-cy="archive-tournament-invalid-raw-cell"><input data-cy="archive-tournament-invalid-raw-input" [(ngModel)]="entry.rawText" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 1')"></td>
                              <td class="round-entry-table__score" data-cy="archive-tournament-invalid-result-cell"><input data-cy="archive-tournament-invalid-result-input" [(ngModel)]="entry.result" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 1 score')"></td>
                              <td data-cy="archive-tournament-invalid-opponent-cell"><input data-cy="archive-tournament-invalid-opponent-input" [(ngModel)]="entry.opponent" [readonly]="!canManage()" [attr.aria-label]="roundEntryInputLabel(roundView.number, entryIndex, 'invalid row player 2')"></td>
                              <td class="round-entry-table__empty" data-cy="archive-tournament-invalid-empty"></td>
                              <td data-cy="archive-tournament-invalid-actions-cell"><button mat-stroked-button class="secondary-action danger-ghost-action" type="button" data-cy="archive-tournament-invalid-delete" [disabled]="!canManage() || saving()" [attr.aria-label]="roundEntryDeleteLabel(roundView.number, entryIndex)" (click)="deleteEntry(roundView.round, entry.id)">{{ i18n.t('common.delete') }}</button></td>
                            }
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
                @if (canManage()) { <div class="round-entry-actions" data-cy="archive-tournament-round-entry-actions"><button mat-stroked-button type="button" data-cy="archive-tournament-add-match" [disabled]="saving()" (click)="addMatch(roundView.round)">{{ i18n.t('tournament.addMatch') }}</button><button mat-stroked-button type="button" data-cy="archive-tournament-add-bye" [disabled]="saving()" (click)="addBye(roundView.round)">{{ i18n.t('tournament.addBye') }}</button></div> }
              </mat-expansion-panel>
            }
          </mat-expansion-panel>
        } @else {
          @for (round of rounds(); track round.number) {
            <article class="archive-round" [attr.data-cy]="'archive-tournament-round-' + round.number">
              <h3 [attr.data-cy]="'archive-tournament-round-title-' + round.number">{{ i18n.t('tournament.roundN', { n: round.number }) }}<span class="archive-round-count" [attr.data-cy]="'archive-tournament-round-count-' + round.number">{{ i18n.t('tournament.entriesCount', { count: round.entries.length }) }}</span></h3>
              <div class="table-wrap" [attr.data-cy]="'archive-tournament-round-wrap-' + round.number">
                <table class="ranking-table" [attr.data-cy]="'archive-tournament-round-table-' + round.number">
                  <tbody [attr.data-cy]="'archive-tournament-round-body-' + round.number">
                    @for (entry of round.entries; track entry.id) {
                      <tr [attr.data-cy]="'archive-tournament-entry-' + entry.id">
                        <td [attr.data-cy]="'archive-tournament-entry-table-' + entry.id">{{ entry.table }}</td>
                        <td [attr.data-cy]="'archive-tournament-entry-text-' + entry.id">{{ entryLabel(entry) }}</td>
                      </tr>
                    } @empty {
                      <tr [attr.data-cy]="'archive-tournament-round-empty-row-' + round.number">
                        <td colspan="2" class="empty" [attr.data-cy]="'archive-tournament-round-empty-' + round.number">{{ i18n.t('tournament.emptyRanking') }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </article>
          } @empty {
            <p class="empty" data-cy="archive-tournament-no-rounds">{{ i18n.t('tournament.emptyRanking') }}</p>
          }
        }
      </section>

      <section class="stack tournament-player-archetypes-section" data-cy="archive-tournament-archetypes-section" (input)="markDirty()">
        <mat-expansion-panel class="round-panel player-archetype-panel" data-cy="archive-tournament-player-archetype-panel" [expanded]="false">
          <mat-expansion-panel-header data-cy="archive-tournament-player-archetype-header">
            <mat-panel-title class="round-panel-title" data-cy="archive-tournament-player-archetype-title">{{ i18n.t('tournament.playerArchetypes') }}</mat-panel-title>
            <mat-panel-description data-cy="archive-tournament-player-archetype-description">{{ i18n.t('tournament.playersCount', { count: playerArchetypeRows(current()!).length }) }}</mat-panel-description>
          </mat-expansion-panel-header>
          <p class="muted" data-cy="archive-tournament-archetype-help">{{ i18n.t('tournament.archetypeHelp') }}</p>
          @if (playerArchetypeRows(current()!).length) {
            <div class="player-archetype-list" role="group" data-cy="archive-tournament-player-archetype-list" [attr.aria-label]="i18n.t('tournament.playerArchetypes')">
              <div class="player-archetype-list__header" aria-hidden="true" data-cy="archive-tournament-player-archetype-list-header">
                <span data-cy="archive-tournament-player-archetype-player-column">{{ i18n.t('common.player') }}</span>
                <span data-cy="archive-tournament-player-archetype-deck-column">{{ i18n.t('tournament.deckArchetypeCol') }}</span>
              </div>
              @for (row of playerArchetypeRows(current()!); track row.playerName; let rowIndex = $index) {
                <div class="player-archetype-row" data-cy="archive-tournament-player-archetype-row">
                  <label class="player-archetype-row__player" data-cy="archive-tournament-player-archetype-label" [attr.for]="'archive-player-archetype-' + rowIndex"><span class="sr-only" data-cy="archive-tournament-player-archetype-sr-label">Deck archetype for </span>{{ row.playerName }}</label>
                  @if (canManage()) { <gones-deck-archetype-input data-cy="archive-tournament-player-archetype-input" [inputId]="'archive-player-archetype-' + rowIndex" [label]="i18n.t('live.deckArchetypeFor', { name: row.playerName })" [value]="archetypeFor(current()!, row.playerName)" (valueChange)="setArchetype(row.playerName, $event)" /> }
                  @else { <span data-cy="archive-tournament-player-archetype-value">{{ archetypeFor(current()!, row.playerName) || i18n.t('tournament.noArchetype') }}</span> }
                </div>
              }
            </div>
          } @else { <p class="empty" data-cy="archive-tournament-no-players">{{ i18n.t('tournament.noPlayersYet') }}</p> }
        </mat-expansion-panel>
      </section>

      <p class="archive-tournament-actions" data-cy="archive-tournament-actions">
        <a [routerLink]="['/archive/tournaments', tournamentId(), 'result']" data-cy="archive-tournament-see-result">{{ i18n.t('archiveDetail.seeResult') }}</a>
      </p>
      @if (!editing()) { <p class="muted" data-cy="archive-tournament-read-only">{{ i18n.t('archiveDetail.readOnly') }}</p> }
      @if (stale()) { <button type="button" class="secondary-action" data-cy="archive-tournament-reload" [disabled]="saving()" (click)="reloadLatest()">{{ i18n.t('archiveEdit.reloadLatest') }}</button> }
    } @else if (notFound()) {
      <mat-card class="panel" data-cy="archive-tournament-not-found">
        <mat-card-title data-cy="archive-tournament-not-found-title">{{ i18n.t('tournament.notFoundTitle') }}</mat-card-title>
        <mat-card-content data-cy="archive-tournament-not-found-body"><p data-cy="archive-tournament-not-found-text">{{ i18n.t('tournament.notFoundBody') }}</p></mat-card-content>
      </mat-card>
    }

    <gones-back-button data-cy="archive-tournament-back-bottom" [link]="['/archive/tournaments']" [label]="i18n.t('archiveDetail.backToTournaments')" position="bottom" />
  `,
  styles: [`
    .archive-tournament-dates { display: flex; flex-wrap: wrap; gap: .6rem; margin: .2rem 0 0; color: var(--dim-ash); font-size: .88rem; }
    .archive-tournament-updated { color: var(--steel); }
    .archive-tournament-badges { display: flex; align-items: center; gap: .4rem; margin: .5rem 0 0; }
    .archive-tournament-season { display: flex; align-items: baseline; gap: .45rem; margin: .4rem 0 0; color: var(--steel); font-size: .88rem; }
    .archive-lock { color: var(--steel); font-size: .78rem; }
    .archive-round h3 { display: flex; flex-wrap: wrap; align-items: baseline; gap: .6rem; margin: .9rem 0 .3rem; color: var(--dim-ash); font-size: .8rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    .archive-round-count { color: var(--steel); font-size: .74rem; font-weight: 700; letter-spacing: normal; text-transform: none; }
    .archive-tournament-actions { margin: 1rem 0 .2rem; }
  `]
})
export class TournamentDetailComponent {
  readonly i18n = inject(I18nService);
  private readonly source = inject(ARCHIVE_TOURNAMENT_DETAIL_SOURCE);
  private readonly route = inject(ActivatedRoute);
  private readonly repo = inject(ArchiveRepository);
  private readonly auth = inject(AuthService);
  private readonly power = inject(PowerUserSettingsService);
  private readonly dialog = inject(MatDialog);
  @ViewChild('roundsPanel') private roundsPanel?: MatExpansionPanel;

  readonly loading = signal(true);
  readonly error = signal('');
  readonly notFound = signal(false);
  readonly tournament = signal<ArchiveTournamentDetail | null>(null);
  readonly seasonName = signal('');
  readonly tournamentId = signal('');

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly dirty = signal(false);
  readonly stale = signal(false);
  readonly draft = signal<ArchiveTournamentDocument | null>(null);
  readonly importErrors = signal<string[]>([]);
  readonly seasonOptions = signal<readonly ArchiveSeasonOption[]>([]);
  /** `null` means standalone. Held apart from the draft because the move is its own intent. */
  readonly selectedSeasonId = signal<string | null>(null);
  readonly expandedRoundNumbers = signal<ReadonlySet<number>>(new Set<number>());
  /** The template never names a module constant, so the sentinel is mirrored onto the class. */
  readonly standaloneValue = ARCHIVE_STANDALONE_SEASON_VALUE;

  /** The document currently rendered: the draft while editing, the authoritative one otherwise. */
  readonly current = computed<ArchiveTournamentDocument | null>(() => this.draft() ?? this.tournament());

  /** Locked and not an Admin ⇒ the server would refuse every write with `409`, so offer none. */
  readonly lockBlocksEdit = computed(() => {
    const tournament = this.tournament();
    if (!tournament) return false;
    // The lock is derived from the date, never stored, and a browser-local record is exempt.
    // An Admin bypasses it server-side, so offering the control to an Admin is honest.
    return isArchiveTournamentRowLocked({ id: tournament.id, tournamentDate: tournament.tournamentDate })
      && this.auth.profile()?.globalRole !== 'Admin';
  });

  /** Power mode never replaces role/origin authority; all three gates must pass. */
  readonly canEdit = computed(() => {
    const tournament = this.tournament();
    return Boolean(tournament
      && !this.lockBlocksEdit()
      && canUsePowerMutation(this.power.enabled(), canManageArchiveRecord(tournament.id, this.auth.profile()?.globalRole)));
  });

  readonly canManage = computed(() => this.editing() && this.canEdit());
  readonly canToggleStatus = computed(() => !this.editing() && this.canEdit());
  readonly statusLabel = computed(() => this.i18n.t(this.current()?.status === 'completed' ? 'archive.tournamentCompleted' : 'archive.tournamentActive'));
  readonly toggleLabel = computed(() => this.i18n.t(this.current()?.status === 'completed' ? 'archive.reopen' : 'archive.markComplete'));
  readonly warnings = computed<readonly TournamentWarning[]>(() => {
    const tournament = this.current();
    return tournament ? getTournamentWarnings(toTournamentDocument(tournament)) : [];
  });
  readonly warningMessages = computed<readonly string[]>(() => {
    const tournament = this.current();
    return tournament ? this.warnings().map((warning) => tournamentWarningMessage(warning, toTournamentDocument(tournament), this.i18n)) : [];
  });
  readonly completionIssues = computed<readonly string[]>(() => {
    const tournament = this.current();
    return tournament ? tournamentCompletionIssues(toTournamentDocument(tournament), this.i18n) : [];
  });

  readonly result: Signal<ReturnType<typeof calculateTournamentResult> | { rows: []; incomplete: true; provisional: false }>;
  readonly locked: Signal<boolean>;
  readonly rounds: Signal<RoundView[]>;

  constructor() {
    this.result = computed(() => {
      const detail = this.current();
      return detail ? calculateTournamentResult(toTournamentDocument(detail, detail.seasonId ?? '')) : { rows: [], incomplete: true, provisional: false };
    });
    this.locked = computed(() => {
      const detail = this.tournament();
      return detail ? isArchiveTournamentRowLocked({ id: detail.id, tournamentDate: detail.tournamentDate }) : false;
    });
    this.rounds = computed(() =>
      (this.tournament()?.rounds ?? []).map((round, index) => ({ number: index + 1, entries: round.entries })));
    void this.load();
  }

  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  @HostListener('document:keydown', ['$event']) handleShortcut(event: KeyboardEvent): void {
    if (!this.editing() || this.saving()) return;
    if (event.key === 'Escape' && this.dirty()) { event.preventDefault(); void this.cancelEdit(); }
    if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey) && this.dirty()) { event.preventDefault(); void this.save(); }
  }

  get roundImportPlaceholder(): string { return this.i18n.t('tournament.roundImportPlaceholder'); }

  /** Never throws: a failed read is a rendered message, never an error thrown into the router. */
  async load(): Promise<void> {
    const tournamentId = this.route.snapshot.paramMap.get('tournamentId') ?? '';
    this.tournamentId.set(tournamentId);
    this.loading.set(true);
    this.error.set('');
    try {
      const detail = await this.source.getTournament(tournamentId);
      if (!detail) {
        this.notFound.set(true);
        return;
      }
      this.tournament.set(detail);
      if (detail.seasonId) {
        void this.source.getSeasonName(detail.seasonId).then((name) => this.seasonName.set(name ?? ''));
      }
    } catch (error) {
      logBoundaryError('archive-tournament-detail.load', error, { tournamentId });
      this.error.set(this.i18n.t('archiveDetail.loadFailed'));
    } finally {
      this.loading.set(false);
    }
    try {
      const catalog = await this.repo.listLeagueSeasons();
      const local = isLocalArchiveId(this.tournamentId());
      this.seasonOptions.set(catalog.items
        .filter((row) => row.isLocal === local)
        .map((row) => ({ id: row.id, name: row.name })));
    } catch (error) {
      // A move target list the user cannot see is a smaller failure than a page that will not
      // render. The Season selector simply offers standalone and the current Season.
      logBoundaryError('archive-tournament-detail.seasons', error, { tournamentId: this.tournamentId() });
      this.seasonOptions.set([]);
    }
    this.selectedSeasonId.set(this.tournament()?.seasonId ?? null);
  }

  startEdit(): void {
    const tournament = this.tournament();
    if (!tournament || !this.canEdit()) return;
    // A deep clone, so an aborted edit cannot leak a single entry back into the authoritative row.
    this.draft.set(structuredClone(tournament));
    this.selectedSeasonId.set(tournament.seasonId);
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
      const confirmed = await this.confirmDiscard('archiveEdit.discardEditTitle', 'archiveEdit.discardEditMessage');
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
    this.updateDraft((tournament) => ({ ...tournament, rounds: [...tournament.rounds, createRound()] }));
  }

  addMatch(round: RoundDocument): void {
    if (!this.canManage() || this.saving()) return;
    this.updateRound(round.id, (item) => ({ ...item, entries: [...item.entries, createMatchRoundEntry({ table: String(item.entries.length + 1) })] }));
  }

  addBye(round: RoundDocument): void {
    if (!this.canManage() || this.saving()) return;
    this.updateRound(round.id, (item) => ({ ...item, entries: [...item.entries, createByeRoundEntry({ table: String(item.entries.length + 1) })] }));
  }

  deleteRound(round: RoundDocument): void {
    if (!this.canManage() || this.saving()) return;
    this.updateDraft((tournament) => ({ ...tournament, rounds: tournament.rounds.filter((item) => item.id !== round.id) }));
  }

  deleteEntry(round: RoundDocument, entryId: string): void {
    if (!this.canManage() || this.saving()) return;
    this.updateRound(round.id, (item) => ({ ...item, entries: item.entries.filter((entry) => entry.id !== entryId) }));
  }

  replaceRound(round: RoundDocument, text: string): void {
    if (!this.canManage() || this.saving()) return;
    const draft = this.draft();
    if (!draft) return;
    const imported = importRoundEntries(text);
    const merged = mergeImportedRoundArchetypes(toTournamentDocument(draft), imported.entries);
    this.importErrors.set(merged.conflicts.map((conflict) => this.i18n.t('tournament.importConflictRow', {
      player: conflict.playerName,
      imported: conflict.importedArchetype || this.i18n.t('tournament.noArchetype'),
      existing: conflict.existingArchetype || this.i18n.t('tournament.noArchetype')
    })));
    this.updateDraft((tournament) => ({
      ...tournament,
      rounds: tournament.rounds.map((candidate) => candidate.id === round.id ? { ...candidate, entries: merged.entries } : candidate),
      playerArchetypes: merged.playerArchetypes
    }));
  }

  hasValidRoundImport(text: string): boolean {
    const entries = importRoundEntries(text).entries;
    return entries.length > 0 && entries.every((entry) => entry.kind === 'match');
  }

  setArchetype(playerName: string, archetype: string): void {
    if (!this.canManage()) return;
    this.importErrors.set([]);
    this.updateDraft((tournament) => toArchiveTournamentDocument(
      setTournamentPlayerArchetype(toTournamentDocument(tournament), playerName, archetype), tournament.seasonId));
  }

  syncPlayerArchetypesFromRoundEntries(): void {
    if (!this.canManage()) return;
    const draft = this.draft();
    if (!draft) return;
    const rows = tournamentPlayerArchetypeRows(toTournamentDocument(draft));
    const sameRows = rows.length === (draft.playerArchetypes ?? []).length
      && rows.every((row, index) => row.playerName === draft.playerArchetypes[index]?.playerName && row.archetype === draft.playerArchetypes[index]?.archetype);
    if (sameRows) {
      this.markDirty();
      return;
    }
    this.updateDraft((tournament) => ({ ...tournament, playerArchetypes: rows }));
  }

  moveTournamentToSeason(value: string): void {
    if (!this.canManage() || this.saving()) return;
    const seasonId = value === ARCHIVE_STANDALONE_SEASON_VALUE ? null : value;
    // Same-authority only (ADR 0037). `seasonOptions()` is already filtered by authority, so
    // membership is the whole check — a cross-authority id can never be an option.
    if (seasonId !== null && !this.seasonOptions().some((option) => option.id === seasonId)) return;
    this.selectedSeasonId.set(seasonId);
    this.markDirty();
  }

  seasonOptionLabel(option: ArchiveSeasonOption): string { return option.name; }

  isRoundExpanded(roundNumber: number): boolean {
    return this.expandedRoundNumbers().has(roundNumber);
  }

  setRoundExpanded(roundNumber: number, expanded: boolean): void {
    const next = new Set(this.expandedRoundNumbers());
    if (expanded) next.add(roundNumber);
    else next.delete(roundNumber);
    this.expandedRoundNumbers.set(next);
  }

  /** Newest round first, the order the legacy editor established. */
  roundViewModels(tournament: ArchiveTournamentDocument): { round: RoundDocument; number: number }[] {
    return tournament.rounds.map((round, index) => ({ round, number: index + 1 })).reverse();
  }

  playerArchetypeRows(tournament: ArchiveTournamentDocument): { playerName: string; archetype: string }[] {
    return tournamentPlayerArchetypeRows(toTournamentDocument(tournament));
  }

  archetypeFor(tournament: ArchiveTournamentDocument, playerName: string): string {
    return archetypeForPlayer(toTournamentDocument(tournament), playerName);
  }

  entryInvalid(entry: RoundEntry): boolean { return !validateRoundEntry(entry).valid; }

  entryHasWarning(round: RoundDocument, entry: RoundEntry): boolean {
    return this.warnings().some((warning) => warning.roundId === round.id && (warning.entryIds?.includes(entry.id) ?? false));
  }

  roundEntryInputLabel(roundNumber: number, entryIndex: number, field: string): string {
    return this.i18n.t('tournament.roundEntryLabel', { round: roundNumber, entry: entryIndex + 1, field });
  }

  roundEntryDeleteLabel(roundNumber: number, entryIndex: number): string {
    return this.i18n.t('tournament.roundEntryDelete', { round: roundNumber, entry: entryIndex + 1 });
  }

  /** One staged save: one batch, one `If-Match`, one version bump, no refetch (ADR 0037). */
  async save(): Promise<void> {
    if (!this.canManage() || this.saving()) return;
    const source = this.tournament();
    const draft = this.draft();
    if (!source || !draft) return;

    draft.name = String(draft.name ?? '').trim();
    if (!draft.name) {
      this.error.set(this.i18n.t('archiveEdit.nameRequired'));
      return;
    }

    const batch = buildArchiveStagedEditBatch(source, draft, this.selectedSeasonId());
    if (archiveStagedEditBatchIsEmpty(batch)) {
      // ADR 0037: an empty Save leaves edit mode and touches no store.
      this.exitEdit();
      return;
    }

    const issues = tournamentCompletionIssues(toTournamentDocument(draft), this.i18n, { includeMissingRound: false });
    if (issues.length) {
      this.error.set(this.i18n.t('archiveEdit.invalidDraft', { count: issues.length }));
      return;
    }

    const deleted = archiveStagedDeletionSummary(source, draft);
    this.saving.set(true);
    try {
      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: this.i18n.t('archiveEdit.saveChangesTitle'),
          message: this.i18n.t('archiveEdit.saveChangesSummary', {
            move: this.moveSummary(source),
            rounds: deleted.rounds,
            entries: deleted.entries
          }),
          confirmLabel: this.i18n.t('archiveEdit.saveChanges'),
          destructive: deleted.rounds > 0 || deleted.entries > 0
        }
      }).afterClosed());
      if (!confirmed) return;
      const saved = await this.repo.saveTournamentEdits({
        tournamentId: source.id,
        expectedVersion: source.documentVersion,
        batch
      });
      this.error.set('');
      this.stale.set(false);
      this.importErrors.set([]);
      this.adopt(saved);
    } catch (error) {
      logBoundaryError('archive-tournament-detail.save', error, { tournamentId: source.id, seasonId: this.selectedSeasonId() });
      this.applyCommandError(error);
    } finally {
      this.saving.set(false);
    }
  }

  /** Never merges, never rebases, never retries: it replaces the document and drops the draft. */
  async reloadLatest(): Promise<void> {
    if (!this.stale() || this.saving()) return;
    this.saving.set(true);
    try {
      const confirmed = await this.confirmDiscard('archiveEdit.reloadLatestTitle', 'archiveEdit.reloadLatestMessage');
      if (!confirmed) return;
      const latest = await this.repo.getTournament(this.tournamentId());
      if (!latest) throw new Error('archiveTournamentNotFound');
      this.adopt(latest);
    } catch (error) {
      logBoundaryError('archive-tournament-detail.reloadLatest', error, { tournamentId: this.tournamentId() });
      this.applyCommandError(error);
    } finally {
      this.saving.set(false);
    }
  }

  async toggleStatus(): Promise<void> {
    if (!this.canToggleStatus() || this.saving()) return;
    const source = this.tournament();
    if (!source) return;
    const next: LeagueStatus = source.status === 'completed' ? 'active' : 'completed';
    const labelKey = next === 'completed' ? 'archive.markComplete' : 'archive.reopen';
    const confirmKey = next === 'completed' ? 'archive.completeConfirm' : 'archive.reopenConfirm';
    this.saving.set(true);
    try {
      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: { title: this.i18n.t(labelKey), message: this.i18n.t(confirmKey), confirmLabel: this.i18n.t(labelKey) }
      }).afterClosed());
      if (!confirmed) return;
      const saved = await this.repo.saveTournamentEdits({
        tournamentId: source.id,
        expectedVersion: source.documentVersion,
        batch: { status: next, addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: [] }
      });
      this.error.set('');
      this.adopt(saved);
    } catch (error) {
      logBoundaryError('archive-tournament-detail.toggleStatus', error, { tournamentId: source.id });
      this.applyCommandError(error);
    } finally {
      this.saving.set(false);
    }
  }

  /** One read-only line per entry, in the same vocabulary the ranking speaks. */
  entryLabel(entry: RoundEntry): string {
    if (entry.kind === 'bye') return formatPlayerWithArchetype(entry.playerName, entry.deckArchetype);
    if (entry.kind === 'invalid') return entry.rawText;
    const left = formatPlayerWithArchetype(entry.player1Name, entry.player1DeckArchetype);
    const right = formatPlayerWithArchetype(entry.player2Name, entry.player2DeckArchetype);
    return `${left} ${entry.player1Score} – ${entry.player2Score} ${right}`;
  }

  private updateDraft(updater: (tournament: ArchiveTournamentDocument) => ArchiveTournamentDocument): void {
    this.draft.update((draft) => (draft ? updater(draft) : null));
    this.markDirty();
  }

  private updateRound(roundId: string, updater: (round: RoundDocument) => RoundDocument): void {
    this.updateDraft((tournament) => ({
      ...tournament,
      rounds: tournament.rounds.map((round) => (round.id === roundId ? updater(round) : round))
    }));
  }

  /** What the final Save dialog names as the move, per ADR 0037's one summary. */
  private moveSummary(source: ArchiveTournamentDetail): string {
    const target = this.selectedSeasonId();
    if (target === source.seasonId) return this.i18n.t('archiveEdit.noSeasonMove');
    if (target === null) return this.i18n.t('archiveEdit.standaloneOption');
    return this.seasonOptions().find((option) => option.id === target)?.name ?? target;
  }

  private async confirmDiscard(
    title: 'archiveEdit.discardEditTitle' | 'archiveEdit.reloadLatestTitle',
    message: 'archiveEdit.discardEditMessage' | 'archiveEdit.reloadLatestMessage'
  ): Promise<boolean> {
    return Boolean(await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.i18n.t(title),
        message: this.i18n.t(message),
        confirmLabel: this.i18n.t('archiveEdit.discardDraft'),
        destructive: true
      }
    }).afterClosed()));
  }

  /** HTTP status first, code second — the one classifier both authorities feed. */
  private applyCommandError(error: unknown): void {
    const kind = archiveCommandError(error);
    this.stale.set(kind === 'stale');
    this.error.set(this.i18n.t(
      kind === 'stale' ? 'archiveEdit.staleSave'
        : kind === 'locked' ? 'archiveEdit.lockedSave'
          : kind === 'forbidden' ? 'archiveEdit.forbidden'
            : kind === 'notFound' ? 'archiveEdit.notFoundSave'
              : kind === 'invalid' ? 'archiveEdit.invalidSave'
                : 'archiveEdit.saveFailed'
    ));
  }

  /** Adopt the authoritative document the write returned. No refetch: the response carries it. */
  private adopt(saved: PersistedArchiveTournament): void {
    this.tournament.set(saved);
    this.selectedSeasonId.set(saved.seasonId);
    this.exitEdit();
    void this.loadSeasonName(saved.seasonId);
  }

  private exitEdit(): void {
    this.draft.set(null);
    this.editing.set(false);
    this.dirty.set(false);
    this.stale.set(false);
    this.error.set('');
    this.importErrors.set([]);
    this.selectedSeasonId.set(this.tournament()?.seasonId ?? null);
  }

  /** A name the page could not fetch is a blank label, never a failed save. */
  private async loadSeasonName(seasonId: string | null): Promise<void> {
    if (!seasonId) {
      this.seasonName.set('');
      return;
    }
    try {
      this.seasonName.set((await this.source.getSeasonName(seasonId)) ?? '');
    } catch (error) {
      logBoundaryError('archive-tournament-detail.seasonName', error, { seasonId });
    }
  }
}

// Copied, not imported: the file these live in is deleted when the legacy archive surface is
// retired, so a reference into it would break at deletion time.
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
