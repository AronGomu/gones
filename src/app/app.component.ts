import { Component, inject, Injector, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { LeagueRepository } from './data/league-repository.service';
import { exportFullData } from './domain/export-restore';
import { PersistedLeague } from './domain/models';
import { logBoundaryError, logBoundaryInfo } from './shared/app-logger';
import { saveJsonFile } from './shared/save-json-file';

interface BreadcrumbItem {
  label: string;
  link?: unknown[];
}

@Component({
  selector: 'gones-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, MatButtonModule, MatIconModule, MatToolbarModule],
  template: `
    <mat-toolbar class="app-toolbar">
      <a class="brand" routerLink="/leagues" aria-label="Gones home"><img src="assets/gones_logo.png" alt="Gones"></a>
      <nav class="breadcrumb-shell breadcrumb-shell--desktop" aria-label="Breadcrumb">
        <ol class="breadcrumbs">
          @for (item of breadcrumbs(); track item.label + $index) {
            <li class="breadcrumb-item" [class.active]="$last" [attr.aria-current]="$last ? 'page' : null">
              @if (!$last && item.link) { <a [routerLink]="item.link">{{ item.label }}</a> }
              @else { <span>{{ item.label }}</span> }
            </li>
          }
        </ol>
      </nav>
      <span class="spacer"></span>
      @if (showHeaderImport()) {
        <div class="header-actions">
          <label class="file-button toolbar-import secondary-action" [class.disabled]="importing()" mat-stroked-button>{{ importing() ? 'Importing…' : 'Import' }}<input data-cy="header-import-input" type="file" accept=".json,application/json" [disabled]="importing()" (change)="importLeague($event)"></label>
          <button mat-stroked-button class="secondary-action" type="button" (click)="downloadFullExport()">Full Data Export</button>
        </div>
      }
    </mat-toolbar>
    <nav class="breadcrumb-shell breadcrumb-shell--mobile" aria-label="Breadcrumb">
      <ol class="breadcrumbs">
        @for (item of breadcrumbs(); track item.label + $index) {
          <li class="breadcrumb-item" [class.active]="$last" [attr.aria-current]="$last ? 'page' : null">
            @if (!$last && item.link) { <a [routerLink]="item.link">{{ item.label }}</a> }
            @else { <span>{{ item.label }}</span> }
          </li>
        }
      </ol>
    </nav>
    @if (importError()) { <p class="error app-banner" role="alert">{{ importError() }}</p> }
    <main class="app-main"><router-outlet /></main>
  `
})
export class AppComponent {
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly repo = inject(LeagueRepository);
  readonly currentUrl = signal(this.router.url);
  readonly importing = signal(false);
  readonly importError = signal('');
  readonly showHeaderImport = signal(true);
  readonly breadcrumbs = signal<BreadcrumbItem[]>([{ label: 'Leagues' }]);
  private routeStateRequest = 0;

  constructor() {
    void this.updateRouteState(this.router.url);
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      void this.updateRouteState(event.urlAfterRedirects);
    });
  }

  private async updateRouteState(url: string): Promise<void> {
    const request = ++this.routeStateRequest;
    this.currentUrl.set(url);
    const path = url.split('?')[0];
    this.showHeaderImport.set(path === '/leagues');
    const breadcrumbs = await this.buildBreadcrumbs(path);
    if (request === this.routeStateRequest) this.breadcrumbs.set(breadcrumbs);
  }

  private async buildBreadcrumbs(path: string): Promise<BreadcrumbItem[]> {
    const segments = path.split('/').filter(Boolean);
    if (segments[0] !== 'leagues' || !segments[1]) return [{ label: 'Leagues' }];

    const leagueId = decodeURIComponent(segments[1]);
    const league = await this.safeGetLeague(leagueId);
    const leagueLabel = league?.name || 'League';
    if (segments[2] !== 'tournaments' || !segments[3]) return [{ label: 'Leagues', link: ['/leagues'] }, { label: leagueLabel }];

    const tournamentId = decodeURIComponent(segments[3]);
    const tournamentLabel = league?.tournaments.find((item) => item.id === tournamentId)?.name || 'Tournament';
    return [{ label: 'Leagues', link: ['/leagues'] }, { label: leagueLabel, link: ['/leagues', leagueId] }, { label: tournamentLabel }];
  }

  private async safeGetLeague(leagueId: string): Promise<PersistedLeague | null> {
    try { return await this.repo.getLeague(leagueId); }
    catch (error) { logBoundaryError('app-breadcrumb.loadLeague', error, { leagueId }); return null; }
  }

  async downloadFullExport(): Promise<void> {
    saveJsonFile(exportFullData(await this.repo.listLeagues()), 'gones-full-data.gones.json');
  }

  async importLeague(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.importing()) return;
    this.importing.set(true);
    try {
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
    if (error.message === 'gonesImportFileTooLarge') return 'That Gones Export is too large to import in the browser.';
    if (error.message === 'gonesImportTooManyLeagues') return 'That Full Data Export contains too many Leagues for browser import.';
    if (error.message === 'unsupportedGonesExport' || error.message === 'wrongExportKind') return 'That file is not a supported Gones Export.';
  }
  if (error instanceof SyntaxError) return 'That file is not valid JSON.';
  return 'Could not import that Gones Export. Please try again.';
}
