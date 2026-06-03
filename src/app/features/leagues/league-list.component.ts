import { Component, computed, signal } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LeagueRepository } from '../../data/league-repository.service';
import { PersistedLeague } from '../../domain/models';
import { calculateLeagueResult } from '../../domain/results';
import { logBoundaryError } from '../../shared/app-logger';
import { TextPromptDialogComponent } from '../../shared/dialogs';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatCardModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  template: `
    <section class="page-heading">
      <div><h1>Leagues</h1><p class="muted">Consult public data, export backups, and modify source data in the frontend-only MVP.</p></div>
    </section>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    <div class="league-toolbar">
      <mat-form-field appearance="outline" class="search"><mat-label>Search Leagues</mat-label><input matInput [(ngModel)]="searchTerm"></mat-form-field>
      <button mat-flat-button color="primary" (click)="createLeague()">New League</button>
    </div>
    @if (loading()) { <mat-spinner diameter="40" /> }
    @else if (!filteredLeagues().length) { <mat-card class="panel"><mat-card-title>No Leagues</mat-card-title><mat-card-content>No public Leagues match this view.</mat-card-content></mat-card> }
    @else {
      <div class="league-grid">
        @for (league of filteredLeagues(); track league.id) {
          <a class="league-card" [routerLink]="['/leagues', league.id]" data-cy="league-list-item">
            <span class="status league-card-status" [class.completed]="league.status === 'completed'"><span class="status-dot" aria-hidden="true"></span>{{ league.status === 'completed' ? 'Completed' : 'Active' }}</span>
            <h2>{{ league.name }}</h2>
            <p>{{ league.tournaments.length }} Tournament{{ league.tournaments.length === 1 ? '' : 's' }} · {{ playerCount(league) }} Player{{ playerCount(league) === 1 ? '' : 's' }}</p>
            <span class="open-affordance">→</span>
          </a>
        }
      </div>
    }
  `
})
export class LeagueListComponent {
  readonly leagues = signal<PersistedLeague[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  searchTerm = '';
  readonly filteredLeagues = computed(() => {
    const search = this.searchTerm.trim().toLowerCase();
    return this.leagues().filter((league) => !search || league.name.toLowerCase().includes(search));
  });

  constructor(private readonly repo: LeagueRepository, private readonly router: Router, private readonly dialog: MatDialog) {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try { this.leagues.set(await this.repo.listLeagues()); }
    catch (error) { logBoundaryError('league-list.load', error); this.error.set('Could not load Leagues from browser storage.'); }
    finally { this.loading.set(false); }
  }

  playerCount(league: PersistedLeague): number { return calculateLeagueResult(league).rows.length; }

  async createLeague(): Promise<void> {
    const name = await firstDialogValue(this.dialog.open(TextPromptDialogComponent, { data: { title: 'New League', label: 'League name', confirmLabel: 'Create League' } }).afterClosed());
    if (!name) return;
    const league = await this.repo.createLeague(name);
    await this.router.navigate(['/leagues', league.id]);
  }

}

function firstDialogValue<T>(source: Observable<T | undefined>): Promise<T | undefined> {
  return firstValueFrom(source);
}
