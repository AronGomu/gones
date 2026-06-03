import { Component, computed, HostListener, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { LeagueRepository } from '../../data/league-repository.service';
import { createMatchRoundEntry, createRound, LeagueDocument, PersistedLeague, RoundDocument } from '../../domain/models';
import { importRoundEntries } from '../../domain/round-import';
import { calculateTournamentResult } from '../../domain/results';
import { getTournamentWarnings } from '../../domain/warnings';
import { RankingTableComponent } from '../../shared/ranking-table.component';
import { logBoundaryError } from '../../shared/app-logger';
import { ConfirmDialogComponent } from '../../shared/dialogs';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatExpansionModule, MatFormFieldModule, MatInputModule, RankingTableComponent],
  template: `
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (tournament(); as t) {
      <a mat-button [routerLink]="['/leagues', currentLeague().id]">← {{ currentLeague().name }}</a>
      <section class="page-heading">
        <div>
          <p class="kicker">Tournament</p>
          @if (editing()) {
            <mat-form-field appearance="outline"><mat-label>Tournament name</mat-label><input matInput [(ngModel)]="t.name"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Tournament date</mat-label><input matInput type="date" [(ngModel)]="t.tournamentDate"></mat-form-field>
          } @else { <h1>{{ t.name }}</h1><p class="muted">{{ t.tournamentDate || 'No Tournament Date' }}</p> }
          @if (result().provisional || result().incomplete) { <p class="warning">{{ result().provisional ? 'Provisional Result' : 'Incomplete Tournament' }}</p> }
        </div>
        @if (!editing()) { <button mat-flat-button color="primary" (click)="startEdit()" [disabled]="currentLeague().status === 'completed'">Edit source data</button> }
      </section>
      @if (currentLeague().status === 'completed') { <p class="muted">Completed Leagues block normal Tournament source-data edits until reopened as active.</p> }
      @if (editing()) { <mat-card class="panel edit-banner"><mat-card-title>Unsaved tournament draft</mat-card-title><mat-card-actions align="end"><button mat-button (click)="cancelEdit()">Cancel Esc</button><button mat-flat-button color="primary" (click)="save()" [disabled]="saving()">Save {{ saveShortcutLabel }}</button></mat-card-actions></mat-card> }
      @if (warnings().length) { <p class="warning">Warnings: {{ warnings().length }} source-data issue(s) need review.</p> }
      <section class="stack"><h2>Tournament Ranking</h2><gones-ranking-table [rows]="result().rows" emptyText="No valid Round Entries yet" /></section>
      <section class="stack">
        <div class="section-header"><h2>Rounds</h2>@if (editing()) { <button mat-flat-button color="primary" (click)="addRound()">Add Round</button> }</div>
        @for (round of t.rounds; track round.id; let index = $index) {
          <mat-expansion-panel class="round-panel" [expanded]="editing()">
            <mat-expansion-panel-header><mat-panel-title>Round {{ index + 1 }}</mat-panel-title><mat-panel-description>{{ round.entries.length }} entries</mat-panel-description></mat-expansion-panel-header>
            @if (editing()) {
              <div class="import-row"><mat-form-field appearance="outline"><mat-label>Round Import</mat-label><textarea matInput #importText placeholder="Table,Player,Result,Opponent,Player_Decklist,Opponent_Decklist"></textarea></mat-form-field><button mat-stroked-button (click)="replaceRound(round, importText.value); importText.value = ''">Import</button></div>
              <button mat-stroked-button (click)="addMatch(round)">Add Match</button>
              <button mat-button color="warn" (click)="deleteRound(round)">Delete Round</button>
            }
            <div class="entry-list">
              @for (entry of round.entries; track entry.id) {
                <div class="entry-row" [class.invalid]="entry.kind === 'invalid'">
                  @if (entry.kind === 'match') {
                    @if (editing()) {
                      <input [(ngModel)]="entry.table" aria-label="Table"><input [(ngModel)]="entry.player1Name" aria-label="Player 1"><input [(ngModel)]="entry.player1DeckArchetype" aria-label="Player 1 Deck Archetype"><input type="number" [(ngModel)]="entry.player1Score" aria-label="Player 1 Score"><input type="number" [(ngModel)]="entry.player2Score" aria-label="Player 2 Score"><input [(ngModel)]="entry.player2Name" aria-label="Player 2"><input [(ngModel)]="entry.player2DeckArchetype" aria-label="Player 2 Deck Archetype"><button mat-button color="warn" (click)="deleteEntry(round, entry.id)">Delete</button>
                    } @else { <span>Table {{ entry.table }}</span><span>{{ entry.player1Name }} {{ entry.player1Score }}-{{ entry.player2Score }} {{ entry.player2Name }}</span><span>{{ entry.player1DeckArchetype }} / {{ entry.player2DeckArchetype }}</span> }
                  } @else if (entry.kind === 'bye') { <span>Table {{ entry.table }}</span><span>{{ entry.playerName }} bye</span> }
                  @else { <span>Invalid row</span><span>{{ entry.rawText }}</span> }
                </div>
              }
            </div>
          </mat-expansion-panel>
        }
      </section>
    } @else if (!loading()) { <mat-card class="panel"><mat-card-title>Tournament not found</mat-card-title><mat-card-actions><a mat-button routerLink="/leagues">Back to Leagues</a></mat-card-actions></mat-card> }
  `
})
export class TournamentDetailComponent {
  readonly league = signal<PersistedLeague | null>(null);
  readonly draft = signal<LeagueDocument>(null as unknown as LeagueDocument);
  readonly editing = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly currentLeague = computed(() => this.editing() ? this.draft() : this.league()!);
  readonly tournament = computed(() => this.currentLeague()?.tournaments.find((item) => item.id === this.tournamentId()) ?? null);
  readonly result = computed(() => this.tournament() ? calculateTournamentResult(this.tournament()!) : { rows: [], incomplete: true, provisional: false });
  readonly warnings = computed(() => this.tournament() ? getTournamentWarnings(this.tournament()!) : []);
  private readonly tournamentId = signal('');
  readonly saveShortcutLabel = navigator.platform.toLowerCase().includes('mac') ? '⌘S' : 'Ctrl+S';

  constructor(private readonly repo: LeagueRepository, private readonly route: ActivatedRoute, private readonly dialog: MatDialog) { void this.load(); }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void { if (this.editing()) event.preventDefault(); }
  @HostListener('document:keydown', ['$event']) handleShortcut(event: KeyboardEvent): void {
    if (!this.editing()) return;
    if (event.key === 'Escape') { event.preventDefault(); this.cancelEdit(); }
    if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void this.save(); }
  }

  async load(): Promise<void> {
    const leagueId = this.route.snapshot.paramMap.get('leagueId') ?? '';
    this.tournamentId.set(this.route.snapshot.paramMap.get('tournamentId') ?? '');
    try { this.league.set(await this.repo.getLeague(leagueId)); }
    catch (error) { logBoundaryError('tournament-detail.load', error, { leagueId, tournamentId: this.tournamentId() }); this.error.set('Could not load this Tournament.'); }
    finally { this.loading.set(false); }
  }

  startEdit(): void { this.draft.set(structuredClone(this.league()!)); this.editing.set(true); }
  cancelEdit(): void { this.editing.set(false); }
  addRound(): void { this.tournament()?.rounds.push(createRound()); }
  addMatch(round: RoundDocument): void { round.entries.push(createMatchRoundEntry({ table: String(round.entries.length + 1) })); }
  replaceRound(round: RoundDocument, text: string): void { round.entries = importRoundEntries(text).entries; }
  async deleteEntry(round: RoundDocument, entryId: string): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete Match', message: 'Delete this match?', confirmLabel: 'Delete Match', destructive: true } }).afterClosed());
    if (confirmed) round.entries = round.entries.filter((entry) => entry.id !== entryId);
  }
  async deleteRound(round: RoundDocument): Promise<void> {
    const tournament = this.tournament();
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete Round', message: 'Delete this entire round?', confirmLabel: 'Delete Round', destructive: true } }).afterClosed());
    if (tournament && confirmed) tournament.rounds = tournament.rounds.filter((item) => item.id !== round.id);
  }

  async save(): Promise<void> {
    const saved = this.league();
    if (!saved) return;
    this.saving.set(true);
    try { this.league.set(await this.repo.saveLeague(this.draft(), saved.documentVersion)); this.editing.set(false); this.error.set(''); }
    catch (error) { logBoundaryError('tournament-detail.save', error, { leagueId: saved.id, tournamentId: this.tournamentId() }); this.error.set(error instanceof Error && error.message === 'staleLeagueDocument' ? 'This League changed since you opened it. Reload the latest saved data before saving again.' : 'Could not save this Tournament.'); }
    finally { this.saving.set(false); }
  }
}
