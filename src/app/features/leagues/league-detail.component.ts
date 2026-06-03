import { Component, computed, ElementRef, HostListener, signal, ViewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { LeagueRepository } from '../../data/league-repository.service';
import { createTournament, LeagueDocument, PersistedLeague } from '../../domain/models';
import { calculateLeagueEndDate, calculateLeagueResult, calculateLeagueStartDate } from '../../domain/results';
import { exportLeague } from '../../domain/export-restore';
import { RankingTableComponent } from '../../shared/ranking-table.component';
import { saveJsonFile } from '../../shared/save-json-file';
import { logBoundaryError } from '../../shared/app-logger';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { BackButtonComponent } from '../../shared/back-button.component';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, RankingTableComponent, BackButtonComponent],
  template: `
    <gones-back-button [link]="['/leagues']" label="Back to Leagues" position="top" />
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (league(); as saved) {
      <section class="page-heading">
        <div>
          <p class="kicker">League</p>
          @if (editing()) { <mat-form-field appearance="outline" class="title-field"><mat-label>League name</mat-label><input #leagueNameInput data-cy="league-name-input" matInput [(ngModel)]="draft().name" [readonly]="saving()" (blur)="saveTitleEdit({ restoreFocus: false })" (keydown.enter)="$event.preventDefault(); saveTitleEdit({ restoreFocus: true })"></mat-form-field> }
          @else { <h1><button #leagueTitleButton class="editable-title" type="button" (click)="startTitleEdit(saved)" [attr.aria-label]="'Edit League name: ' + saved.name">{{ saved.name }}</button></h1> }
          <p class="muted">{{ saved.tournaments.length }} Tournaments · {{ startDate(saved) || 'No start date' }} — {{ endDate(saved) || 'No end date' }}</p>
        </div>
        <div class="actions">
          <button mat-stroked-button (click)="downloadExport(saved)">League Export</button>
          @if (!editing()) { <button mat-flat-button color="primary" (click)="startEdit(saved)">Edit source data</button> }
        </div>
      </section>

      @if (editing() && !titleOnlyEditing()) {
        <mat-card class="panel edit-banner">
          <mat-card-title>Unsaved draft</mat-card-title>
          <mat-card-content>
            <mat-form-field appearance="outline"><mat-label>Status</mat-label><mat-select [(ngModel)]="draft().status"><mat-option value="active">Active</mat-option><mat-option value="completed">Completed</mat-option></mat-select></mat-form-field>
          </mat-card-content>
          <mat-card-actions align="end"><button mat-button (click)="cancelEdit()">Cancel Esc</button><button mat-flat-button color="primary" (click)="save()" [disabled]="saving()">Save {{ saveShortcutLabel }}</button></mat-card-actions>
        </mat-card>
      }

      <section class="stack">
        <h2>League Ranking</h2>
        <gones-ranking-table [rows]="result().rows" emptyText="Empty League has no League Result" />
      </section>

      <section class="stack">
        <div class="section-header"><h2>Tournaments</h2>@if (editing() && !titleOnlyEditing() && draft().status === 'active') { <button mat-flat-button color="primary" (click)="addTournament()">Add Tournament</button> }</div>
        @if (!currentLeague().tournaments.length) { <mat-card class="panel"><mat-card-content>No Tournaments yet.</mat-card-content></mat-card> }
        @for (tournament of sortedTournaments(); track tournament.id) {
          <a class="tournament-card" [routerLink]="['/leagues', currentLeague().id, 'tournaments', tournament.id]">
            <strong>{{ tournament.name }}</strong><span>{{ tournament.tournamentDate || 'No Tournament Date' }}</span><span>→</span>
          </a>
        }
      </section>

      @if (!editing()) { <button mat-stroked-button color="warn" (click)="deleteLeague(saved)">Delete League</button> }
    } @else if (!loading()) {
      <mat-card class="panel"><mat-card-title>League not found</mat-card-title><mat-card-content><p>The requested League does not exist or was deleted.</p></mat-card-content></mat-card>
    }
    @if (!loading()) { <gones-back-button [link]="['/leagues']" label="Back to Leagues" position="bottom" /> }
  `
})
export class LeagueDetailComponent {
  @ViewChild('leagueNameInput') private leagueNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('leagueTitleButton') private leagueTitleButton?: ElementRef<HTMLButtonElement>;

  readonly league = signal<PersistedLeague | null>(null);
  readonly draft = signal<LeagueDocument>(null as unknown as LeagueDocument);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly editing = signal(false);
  readonly titleOnlyEditing = signal(false);
  readonly error = signal('');
  readonly currentLeague = computed(() => this.editing() ? this.draft() : this.league()!);
  readonly result = computed(() => calculateLeagueResult(this.currentLeague()));
  readonly sortedTournaments = computed(() => [...(this.currentLeague().tournaments ?? [])].sort((a, b) => (b.tournamentDate || '9999-12-31').localeCompare(a.tournamentDate || '9999-12-31') || b.name.localeCompare(a.name)));
  readonly saveShortcutLabel = navigator.platform.toLowerCase().includes('mac') ? '⌘S' : 'Ctrl+S';

  constructor(private readonly repo: LeagueRepository, private readonly route: ActivatedRoute, private readonly router: Router, private readonly dialog: MatDialog) { void this.load(); }

  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void { if (this.editing()) event.preventDefault(); }
  @HostListener('document:keydown', ['$event']) handleShortcut(event: KeyboardEvent): void {
    if (!this.editing() || this.saving()) return;
    if (event.key === 'Escape') { event.preventDefault(); this.cancelEdit(); }
    if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void this.save(); }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const id = this.route.snapshot.paramMap.get('leagueId') ?? '';
    try { this.league.set(await this.repo.getLeague(id)); }
    catch (error) { logBoundaryError('league-detail.load', error, { leagueId: id }); this.error.set('Could not load this League.'); }
    finally { this.loading.set(false); }
  }

  startDate(league: LeagueDocument): string { return calculateLeagueStartDate(league); }
  endDate(league: LeagueDocument): string { return calculateLeagueEndDate(league); }
  downloadExport(league: LeagueDocument): void { saveJsonFile(exportLeague(league), `${league.name || 'gones-league'}.gones.json`); }
  startEdit(league: LeagueDocument): void { this.titleOnlyEditing.set(false); this.draft.set(structuredClone(league)); this.editing.set(true); }
  startTitleEdit(league: LeagueDocument): void { this.titleOnlyEditing.set(true); this.draft.set(structuredClone(league)); this.editing.set(true); this.focusLeagueNameInput(); }
  cancelEdit(): void { this.editing.set(false); this.titleOnlyEditing.set(false); this.focusLeagueTitleButton(); }
  addTournament(): void { this.draft.update((league) => ({ ...league, tournaments: [...league.tournaments, createTournament({ leagueId: league.id })] })); }

  private focusLeagueNameInput(): void { setTimeout(() => this.leagueNameInput?.nativeElement.focus()); }
  private focusLeagueTitleButton(): void { setTimeout(() => this.leagueTitleButton?.nativeElement.focus()); }

  async saveTitleEdit({ restoreFocus }: { restoreFocus: boolean }): Promise<void> {
    if (!this.titleOnlyEditing() || this.saving()) return;
    await this.save({ restoreFocus });
  }

  async save({ restoreFocus = true }: { restoreFocus?: boolean } = {}): Promise<void> {
    const saved = this.league();
    if (!saved || this.saving()) return;
    this.saving.set(true);
    try { this.league.set(await this.repo.saveLeague(this.draft(), saved.documentVersion)); this.editing.set(false); this.titleOnlyEditing.set(false); this.error.set(''); if (restoreFocus) this.focusLeagueTitleButton(); }
    catch (error) { logBoundaryError('league-detail.save', error, { leagueId: saved.id }); this.error.set(error instanceof Error && error.message === 'staleLeagueDocument' ? 'This League changed since you opened it. Reload the latest saved data before saving again.' : 'Could not save this League.'); }
    finally { this.saving.set(false); }
  }

  async deleteLeague(league: PersistedLeague): Promise<void> {
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete League', message: `Delete ${league.name}? This permanently deletes its Tournaments, rounds, and Player Statistics source data.`, confirmLabel: 'Delete League', destructive: true } }).afterClosed());
    if (!confirmed) return;
    await this.repo.deleteLeague(league.id);
    await this.router.navigate(['/leagues']);
  }
}
