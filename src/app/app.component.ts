import { Component, computed, ElementRef, inject, Injector, signal, ViewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { CalendarEventRepository } from './data/calendar-event-repository.service';
import { LeagueRepository } from './data/league-repository.service';
import { LiveTournamentRepository } from './data/live-tournament-repository.service';
import { exportFullData, exportLeague, leagueExportFilename } from './domain/export-restore';
import { CalendarEventDocument, PersistedLeague, PLACEHOLDER_LEAGUE_ID, TournamentDocument } from './domain/models';
import { logBoundaryError, logBoundaryInfo } from './shared/app-logger';
import { DeckArchetypeSettingsService, parseAppSettings } from './shared/deck-archetype-settings.service';
import { ConfirmDialogComponent } from './shared/dialogs';
import { saveJsonFile } from './shared/save-json-file';

interface BreadcrumbItem {
  label: string;
  link?: unknown[];
  lang?: string;
}

interface HeaderTournament {
  league: PersistedLeague;
  tournament: TournamentDocument;
}

@Component({
  selector: 'gones-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, MatButtonModule, MatIconModule, MatMenuModule, MatToolbarModule],
  template: `
    @if (!isResultPage()) {
      <mat-toolbar class="app-toolbar">
        <a class="brand" routerLink="/" aria-label="Gones home"><img src="assets/gones_logo.png" alt="Gones"></a>
        <span class="spacer"></span>
        @if (showLiveTournamentActions()) {
          <div class="header-actions live-tournament-header-actions">
            <button mat-stroked-button class="secondary-action" type="button" data-cy="live-tournament-advanced-settings-button" (click)="openLiveTournamentAdvancedSettings()">Advanced Settings</button>
          </div>
        } @else if (showHeaderImport()) {
          <div class="header-actions">
            <button mat-stroked-button class="secondary-action toolbar-import" type="button" [disabled]="importing()" (click)="openImportPicker()">{{ importing() ? 'Importing…' : 'Import' }}</button>
            <input #headerImportInput class="toolbar-import-input" data-cy="header-import-input" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" [disabled]="importing()" (change)="importLeague($event)">
            <button mat-stroked-button class="secondary-action" type="button" (click)="downloadFullExport()">Full Data Export</button>
          </div>
        } @else if (headerTournament(); as item) {
          <div class="header-actions tournament-header-actions">
            <a mat-stroked-button class="secondary-action" data-cy="tournament-result-link" [routerLink]="['/leagues', item.league.id, 'tournaments', item.tournament.id, 'result']" [attr.aria-label]="'View result page for ' + item.tournament.name">View Result</a>
            <button mat-icon-button class="league-actions-trigger" [matMenuTriggerFor]="tournamentActionsMenu" aria-label="Tournament actions" [disabled]="deletingTournament()">⋮</button>
            <mat-menu #tournamentActionsMenu="matMenu">
              <button mat-menu-item class="destructive-menu-item" [disabled]="deletingTournament()" (click)="deleteTournament(item)">{{ deletingTournament() ? 'Deleting Tournament…' : 'Delete Tournament' }}</button>
            </mat-menu>
          </div>
        } @else if (headerLeague(); as league) {
          <div class="header-actions league-header-actions">
            <button mat-stroked-button class="secondary-action" type="button" (click)="downloadLeagueExport(league)">Export League</button>
            <button mat-icon-button class="league-actions-trigger" [matMenuTriggerFor]="leagueActionsMenu" aria-label="League actions">⋮</button>
            <mat-menu #leagueActionsMenu="matMenu">
              <button mat-menu-item class="destructive-menu-item" [disabled]="isPlaceholderLeague(league)" (click)="deleteLeague(league)">{{ isPlaceholderLeague(league) ? 'Placeholder League cannot be deleted' : 'Delete League' }}</button>
            </mat-menu>
          </div>
        } @else if (showSettingsActions()) {
          <div class="header-actions settings-header-actions" aria-label="Settings import and export actions">
            <button mat-stroked-button class="secondary-action" type="button" data-cy="settings-export-button" [disabled]="settingsImporting()" (click)="downloadSettingsExport()">Export Settings</button>
            <button mat-flat-button class="home-primary-action" type="button" data-cy="settings-import-button" [disabled]="settingsImporting()" (click)="openSettingsImportPicker()">{{ settingsImporting() ? 'Importing…' : 'Import Settings' }}</button>
            <input #settingsImportInput class="toolbar-import-input" data-cy="settings-import-input" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" [disabled]="settingsImporting()" (change)="importSettings($event)">
          </div>
        } @else if (showHomeActions()) {
          <div class="header-actions home-header-actions">
            <a mat-stroked-button class="secondary-action" routerLink="/settings" data-cy="menu-settings-link">Settings</a>
          </div>
        }
      </mat-toolbar>
      <nav class="breadcrumb-shell breadcrumb-shell--header" aria-label="Breadcrumb">
        <ol class="breadcrumbs" data-cy="breadcrumbs">
          @for (item of breadcrumbs(); track item.label + $index) {
            <li class="breadcrumb-item" [class.active]="$last" [attr.aria-current]="$last ? 'page' : null">
              @if (!$last && item.link) { <a [routerLink]="item.link">{{ item.label }}</a> }
              @else { <span [attr.data-cy]="$last ? 'breadcrumb-current' : null" [attr.lang]="item.lang">{{ item.label }}</span> }
            </li>
          }
        </ol>
      </nav>
    }
    @if (importError()) { <p class="error app-banner" role="alert">{{ importError() }}</p> }
    @if (settingsMessage()) { <p class="settings-saved app-banner" role="status">{{ settingsMessage() }}</p> }
    <main class="app-main"><router-outlet /></main>
  `
})
export class AppComponent {
  @ViewChild('headerImportInput') private headerImportInput?: ElementRef<HTMLInputElement>;
  @ViewChild('settingsImportInput') private settingsImportInput?: ElementRef<HTMLInputElement>;

  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly repo = inject(LeagueRepository);
  private readonly liveRepo = inject(LiveTournamentRepository);
  private readonly calendarRepo = inject(CalendarEventRepository);
  private readonly settings = inject(DeckArchetypeSettingsService);
  private readonly dialog = inject(MatDialog);
  readonly currentUrl = signal(this.router.url);
  readonly isResultPage = computed(() => this.currentUrl().split('?')[0].split('/').includes('result'));
  readonly importing = signal(false);
  readonly settingsImporting = signal(false);
  readonly deletingTournament = signal(false);
  readonly importError = signal('');
  readonly settingsMessage = signal('');
  readonly showHeaderImport = signal(this.router.url.split('?')[0] === '/leagues');
  readonly showLiveTournamentActions = signal(this.isLiveTournamentRunnerPath(this.router.url.split('?')[0]));
  readonly showSettingsActions = signal(this.router.url.split('?')[0] === '/settings');
  readonly showHomeActions = signal(this.router.url.split('?')[0] === '/');
  readonly headerLeague = signal<PersistedLeague | null>(null);
  readonly headerTournament = signal<HeaderTournament | null>(null);
  readonly breadcrumbs = signal<BreadcrumbItem[]>([{ label: 'Menu' }]);
  private routeStateRequest = 0;

  constructor() {
    void this.updateRouteState(this.router.url);
    window.addEventListener('gones-live-tournament-updated', (event) => this.handleLiveTournamentUpdated(event));
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      void this.updateRouteState(event.urlAfterRedirects);
    });
  }

  private async updateRouteState(url: string): Promise<void> {
    const request = ++this.routeStateRequest;
    this.currentUrl.set(url);
    const path = url.split('?')[0];
    this.showHeaderImport.set(path === '/leagues');
    this.showLiveTournamentActions.set(this.isLiveTournamentRunnerPath(path));
    this.showSettingsActions.set(path === '/settings');
    this.showHomeActions.set(path === '/');
    if (path !== '/settings') this.settingsMessage.set('');
    this.headerLeague.set(await this.buildHeaderLeague(path));
    this.headerTournament.set(await this.buildHeaderTournament(path));
    const breadcrumbs = await this.buildBreadcrumbs(path);
    if (request === this.routeStateRequest) this.breadcrumbs.set(breadcrumbs);
  }

  openLiveTournamentAdvancedSettings(): void {
    window.dispatchEvent(new CustomEvent('gones-open-live-tournament-advanced-settings'));
  }

  private handleLiveTournamentUpdated(event: Event): void {
    const detail = event instanceof CustomEvent ? event.detail as { liveTournamentId?: string; name?: string } : {};
    const segments = this.router.url.split('?')[0].split('/').filter(Boolean);
    if (segments[0] === 'live-tournaments' && segments[1] && segments[1] === detail.liveTournamentId && detail.name) {
      this.breadcrumbs.set([{ label: 'Menu', link: ['/'] }, { label: 'Running Tournaments', link: ['/live-tournaments'] }, { label: `${detail.name} (live)` }]);
      return;
    }
    void this.updateRouteState(this.router.url);
  }

  private isLiveTournamentRunnerPath(path: string): boolean {
    const segments = path.split('/').filter(Boolean);
    return segments[0] === 'live-tournaments' && Boolean(segments[1]);
  }

  private async buildHeaderLeague(path: string): Promise<PersistedLeague | null> {
    const segments = path.split('/').filter(Boolean);
    if (segments[0] !== 'leagues' || !segments[1] || segments.length !== 2) return null;
    return this.safeGetLeague(decodeURIComponent(segments[1]));
  }

  private async buildHeaderTournament(path: string): Promise<HeaderTournament | null> {
    const segments = path.split('/').filter(Boolean);
    if (segments[0] !== 'leagues' || !segments[1] || segments[2] !== 'tournaments' || !segments[3]) return null;
    const league = await this.safeGetLeague(decodeURIComponent(segments[1]));
    const tournament = league?.tournaments.find((item) => item.id === decodeURIComponent(segments[3]));
    return league && tournament ? { league, tournament } : null;
  }

  private async buildBreadcrumbs(path: string): Promise<BreadcrumbItem[]> {
    const segments = path.split('/').filter(Boolean);
    if (!segments.length) return [{ label: 'Menu' }];
    if (segments[0] === 'about') return [{ label: 'Menu', link: ['/'] }, { label: 'À propos', lang: 'fr' }];
    if (segments[0] === 'calendar') return [{ label: 'Menu', link: ['/'] }, { label: 'Calendar' }];
    if (segments[0] === 'events') {
      const eventPage = segments[1] ? await this.safeGetEvent(decodeURIComponent(segments[1])) : null;
      return [{ label: 'Menu', link: ['/'] }, { label: 'Calendar', link: ['/calendar'] }, { label: eventPage?.title || 'Event' }];
    }
    if (segments[0] === 'settings') return [{ label: 'Menu', link: ['/'] }, { label: 'Settings' }];
    if (segments[0] === 'players') return [{ label: 'Menu', link: ['/'] }, { label: 'Player' }];
    if (segments[0] === 'live-tournaments') {
      if (!segments[1]) return [{ label: 'Menu', link: ['/'] }, { label: 'Running Tournaments' }];
      const liveTournament = segments[1] === 'new' ? null : await this.safeGetLiveTournament(decodeURIComponent(segments[1]));
      const label = segments[1] === 'new' ? 'New Tournament' : `${liveTournament?.name || 'Live Tournament'} (live)`;
      return [{ label: 'Menu', link: ['/'] }, { label: 'Running Tournaments', link: ['/live-tournaments'] }, { label }];
    }
    if (segments[0] !== 'leagues') return [{ label: 'Menu', link: ['/'] }, { label: 'Not Found' }];
    if (!segments[1]) return [{ label: 'Menu', link: ['/'] }, { label: 'Leagues' }];

    const leagueId = decodeURIComponent(segments[1]);
    const league = await this.safeGetLeague(leagueId);
    const leagueLabel = league?.name || 'League';
    if (segments[2] !== 'tournaments' || !segments[3]) return [{ label: 'Menu', link: ['/'] }, { label: 'Leagues', link: ['/leagues'] }, { label: leagueLabel }];

    const tournamentId = decodeURIComponent(segments[3]);
    const tournamentLabel = league?.tournaments.find((item) => item.id === tournamentId)?.name || 'Tournament';
    if (segments[4] === 'result') return [{ label: 'Menu', link: ['/'] }, { label: 'Leagues', link: ['/leagues'] }, { label: leagueLabel, link: ['/leagues', leagueId] }, { label: tournamentLabel, link: ['/leagues', leagueId, 'tournaments', tournamentId] }, { label: 'Result' }];
    return [{ label: 'Menu', link: ['/'] }, { label: 'Leagues', link: ['/leagues'] }, { label: leagueLabel, link: ['/leagues', leagueId] }, { label: tournamentLabel }];
  }

  private async safeGetLeague(leagueId: string): Promise<PersistedLeague | null> {
    try { return await this.repo.getLeague(leagueId); }
    catch (error) { logBoundaryError('app-breadcrumb.loadLeague', error, { leagueId }); return null; }
  }

  private async safeGetEvent(slug: string): Promise<CalendarEventDocument | null> {
    try { return (await this.calendarRepo.list()).find((event) => event.slug === slug) ?? null; }
    catch (error) { logBoundaryError('app-breadcrumb.loadEvent', error, { slug }); return null; }
  }

  private async safeGetLiveTournament(liveTournamentId: string) {
    try { return await this.liveRepo.get(liveTournamentId); }
    catch (error) { logBoundaryError('app-breadcrumb.loadLiveTournament', error, { liveTournamentId }); return null; }
  }

  openImportPicker(): void {
    if (!this.importing()) this.headerImportInput?.nativeElement.click();
  }

  openSettingsImportPicker(): void {
    if (!this.settingsImporting()) this.settingsImportInput?.nativeElement.click();
  }

  downloadSettingsExport(): void {
    const settings = this.settings.exportSettings();
    try {
      saveJsonFile(settings, `gones-settings-${new Date().toISOString().slice(0, 10)}.json`);
      this.settingsMessage.set('Settings exported.');
      this.importError.set('');
      logBoundaryInfo('app-header.exportSettings', { language: settings.language, deckArchetypes: settings.deckArchetypes.length });
    } catch (error) {
      logBoundaryError('app-header.exportSettings', error, { language: settings.language, deckArchetypes: settings.deckArchetypes.length });
      this.importError.set('Could not export settings.');
      this.settingsMessage.set('');
    }
  }

  async importSettings(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.settingsImporting()) return;

    this.settingsImporting.set(true);
    try {
      const parsed = parseAppSettings(JSON.parse(await file.text()));
      if (!parsed) {
        this.importError.set('Choose a valid Gones settings JSON file.');
        this.settingsMessage.set('');
        return;
      }

      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: 'Import settings',
          message: `Replace your current settings with ${parsed.deckArchetypes.length} imported deck archetype${parsed.deckArchetypes.length === 1 ? '' : 's'} and ${parsed.language === 'fr' ? 'French' : 'English'} language? This cannot be undone.`,
          confirmLabel: 'Replace settings',
          destructive: true
        }
      }).afterClosed());
      if (!confirmed) {
        this.settingsMessage.set('Settings import canceled.');
        this.importError.set('');
        return;
      }

      await this.settings.replaceSettings(parsed);
      this.settingsMessage.set(`Imported ${parsed.deckArchetypes.length} deck archetype${parsed.deckArchetypes.length === 1 ? '' : 's'} and ${parsed.language === 'fr' ? 'Français' : 'English'} language.`);
      this.importError.set('');
      logBoundaryInfo('app-header.importSettings', { fileName: file.name, language: parsed.language, deckArchetypes: parsed.deckArchetypes.length });
    } catch (error) {
      logBoundaryError('app-header.importSettings', error, { fileName: file.name });
      this.importError.set(error instanceof SyntaxError ? 'That settings file is not valid JSON.' : 'Could not import settings. Use a valid Gones settings JSON file.');
      this.settingsMessage.set('');
    } finally {
      this.settingsImporting.set(false);
      input.value = '';
    }
  }

  async downloadFullExport(): Promise<void> {
    const leagues = (await this.repo.listLeagues()).filter((league) => league.id !== PLACEHOLDER_LEAGUE_ID);
    saveJsonFile(exportFullData(leagues, { calendarEvents: await this.calendarRepo.list() }), 'gones-full-data.gones.json');
  }

  downloadLeagueExport(league: PersistedLeague): void { const exported = exportLeague(league); saveJsonFile(exported, leagueExportFilename(league, new Date(exported.exportedAt))); }
  isPlaceholderLeague(league: PersistedLeague): boolean { return league.id === PLACEHOLDER_LEAGUE_ID; }

  async deleteLeague(league: PersistedLeague): Promise<void> {
    if (this.isPlaceholderLeague(league)) return;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete League', message: `Delete ${league.name}? This permanently deletes its Tournaments, rounds, and Player Statistics source data.`, confirmLabel: 'Delete League', destructive: true } }).afterClosed());
    if (!confirmed) return;
    await this.repo.deleteLeague(league.id);
    this.headerLeague.set(null);
    await this.router.navigate(['/leagues']);
  }

  async deleteTournament({ league, tournament }: HeaderTournament): Promise<void> {
    if (this.deletingTournament()) return;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: 'Delete Tournament', message: `Delete ${tournament.name}? This permanently deletes its rounds and Player Statistics source data.`, confirmLabel: 'Delete Tournament', destructive: true } }).afterClosed());
    if (!confirmed) return;
    this.deletingTournament.set(true);
    this.importError.set('');
    try {
      const nextLeague = { ...league, tournaments: league.tournaments.filter((item) => item.id !== tournament.id) };
      await this.repo.saveLeague(nextLeague, league.documentVersion);
      this.headerTournament.set(null);
      await this.router.navigate(['/leagues', league.id]);
    } catch (error) {
      logBoundaryError('app-header.deleteTournament', error, { leagueId: league.id, tournamentId: tournament.id });
      this.importError.set(error instanceof Error && error.message === 'staleLeagueDocument' ? 'This League changed since you opened it. Reload the latest saved data before deleting this Tournament.' : 'Could not delete this Tournament.');
    } finally {
      this.deletingTournament.set(false);
    }
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
      const importedCount = result.importedLeagueIds.length + result.importedCalendarEventIds.length;
      logBoundaryInfo('app-header.importLeague.success', { kind: result.kind, importedCount, importedLeagueCount: result.importedLeagueIds.length, importedCalendarEventCount: result.importedCalendarEventIds.length, destinationLeagueId: firstImportedLeagueId ?? null });
      await this.router.navigate(firstImportedLeagueId ? ['/leagues', firstImportedLeagueId] : result.importedCalendarEventIds.length ? ['/calendar'] : ['/leagues']);
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
