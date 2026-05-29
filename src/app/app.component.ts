import { Component, computed, inject, Injector, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { APP_BACKEND, ApplicationBackend } from './backend/application-backend';
import { AuthService } from './auth/auth.service';
import { logBoundaryError, logBoundaryInfo } from './shared/app-logger';

@Component({
  selector: 'gones-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatToolbarModule],
  template: `
    <mat-toolbar class="app-toolbar">
      <a class="brand" routerLink="/leagues" aria-label="Gones home"><img src="assets/gones_logo.png" alt="Gones"></a>
      <nav class="nav-links" aria-label="Primary"><a mat-button routerLink="/leagues">Leagues</a>@if (auth.isAdmin()) { <a mat-button routerLink="/admin/users">Admin Users</a> }</nav>
      <span class="spacer"></span>
      @if (showHeaderImport()) {
        <label class="file-button toolbar-import" [class.disabled]="importing()" mat-stroked-button>{{ importing() ? 'Importing…' : 'Import' }}<input data-cy="header-import-input" type="file" accept=".json,application/json" [disabled]="importing()" (change)="importLeague($event)"></label>
      }
      @if (backend.mode === 'frontend-local') { <span class="setup-chip">Frontend-only mode</span> }
      @if (state().email) {
        <button mat-stroked-button [matMenuTriggerFor]="accountMenu">{{ state().email }} · {{ state().role }}</button>
        <mat-menu #accountMenu="matMenu"><button mat-menu-item (click)="signOut()">Sign out</button></mat-menu>
      } @else {
        <button mat-flat-button color="primary" (click)="login()" [disabled]="signingIn()">{{ signingIn() ? 'Signing in…' : 'Sign in locally' }}</button>
      }
    </mat-toolbar>
    @if (importError()) { <p class="error app-banner" role="alert">{{ importError() }}</p> }
    <main class="app-main"><router-outlet /></main>
  `
})
export class AppComponent {
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  readonly backend: ApplicationBackend = inject(APP_BACKEND);
  readonly currentUrl = signal(this.router.url);
  readonly importing = signal(false);
  readonly signingIn = signal(false);
  readonly importError = signal('');
  readonly state = computed(() => this.auth.state());
  readonly showHeaderImport = computed(() => this.currentUrl().split('?')[0] === '/leagues' && (!this.state().email || this.auth.canEdit()));

  constructor(public readonly auth: AuthService) {
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => this.currentUrl.set(event.urlAfterRedirects));
  }

  async login(): Promise<void> {
    if (this.signingIn()) return;
    this.signingIn.set(true);
    try {
      await this.auth.login();
      this.importError.set('');
    } catch (error) {
      logBoundaryError('app-header.login', error);
      this.importError.set('Could not sign in locally. Please try again.');
    } finally {
      this.signingIn.set(false);
    }
  }
  signOut(): void { void this.auth.signOut(); }

  async importLeague(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.importing()) return;
    this.importing.set(true);
    try {
      if (!this.auth.canEdit()) await this.auth.login();
      const { LeagueImportService } = await import('./data/league-import.service');
      const result = await this.injector.get(LeagueImportService).importFile(file);
      this.importError.set('');
      const firstImportedLeagueId = result.importedLeagueIds[0];
      logBoundaryInfo('app-header.importLeague.success', { kind: result.kind, importedCount: result.importedLeagueIds.length, destinationLeagueId: firstImportedLeagueId ?? null });
      await this.router.navigate(firstImportedLeagueId ? ['/leagues', firstImportedLeagueId] : ['/leagues']);
    } catch (error) {
      logBoundaryError('app-header.importLeague', error, { fileName: file.name });
      this.importError.set(importErrorMessage(error));
    } finally {
      this.importing.set(false);
      input.value = '';
    }
  }
}

function importErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'Browser storage is full. Export a backup or clear space, then try again.';
  if (error instanceof Error) {
    if (error.message === 'adminOnlyFullDataRestore') return 'Only Admin Users can restore a Full Data Export.';
    if (error.message === 'gonesImportFileTooLarge') return 'That Gones Export is too large to import in the browser.';
    if (error.message === 'gonesImportTooManyLeagues') return 'That Full Data Export contains too many Leagues for browser import.';
    if (error.message === 'unsupportedGonesExport' || error.message === 'wrongExportKind') return 'That file is not a supported Gones Export.';
  }
  if (error instanceof SyntaxError) return 'That file is not valid JSON.';
  return 'Could not import that Gones Export. Please try again.';
}
