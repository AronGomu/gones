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
import { I18nService } from './i18n/i18n.service';
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
        <a class="brand" routerLink="/" [attr.aria-label]="i18n.t('nav.homeAria')"><img src="assets/gones_logo.png" alt="Gones"></a>
        <span class="spacer"></span>
        @if (showLiveTournamentActions()) {
          <div class="header-actions live-tournament-header-actions">
            <button mat-stroked-button class="secondary-action" type="button" data-cy="live-tournament-advanced-settings-button" (click)="openLiveTournamentAdvancedSettings()">{{ i18n.t('header.advancedSettings') }}</button>
          </div>
        } @else if (showHeaderImport()) {
          <div class="header-actions">
            <button mat-stroked-button class="secondary-action toolbar-import" type="button" [disabled]="importing()" (click)="openImportPicker()">{{ importing() ? i18n.t('common.importing') : i18n.t('common.import') }}</button>
            <input #headerImportInput class="toolbar-import-input" data-cy="header-import-input" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" [disabled]="importing()" (change)="importLeague($event)">
            <button mat-stroked-button class="secondary-action" type="button" (click)="downloadFullExport()">{{ i18n.t('header.fullDataExport') }}</button>
          </div>
        } @else if (headerTournament(); as item) {
          <div class="header-actions tournament-header-actions">
            <a mat-stroked-button class="secondary-action" data-cy="tournament-result-link" [routerLink]="['/leagues', item.league.id, 'tournaments', item.tournament.id, 'result']" [attr.aria-label]="i18n.t('header.viewResultAria', { name: item.tournament.name })">{{ i18n.t('header.viewResult') }}</a>
            <button mat-icon-button class="league-actions-trigger" [matMenuTriggerFor]="tournamentActionsMenu" [attr.aria-label]="i18n.t('header.tournamentActions')" [disabled]="deletingTournament()">⋮</button>
            <mat-menu #tournamentActionsMenu="matMenu">
              <button mat-menu-item class="destructive-menu-item" [disabled]="deletingTournament()" (click)="deleteTournament(item)">{{ deletingTournament() ? i18n.t('header.deletingTournament') : i18n.t('header.deleteTournament') }}</button>
            </mat-menu>
          </div>
        } @else if (headerLeague(); as league) {
          <div class="header-actions league-header-actions">
            <button mat-stroked-button class="secondary-action" type="button" (click)="downloadLeagueExport(league)">{{ i18n.t('header.exportLeague') }}</button>
            <button mat-icon-button class="league-actions-trigger" [matMenuTriggerFor]="leagueActionsMenu" [attr.aria-label]="i18n.t('header.leagueActions')">⋮</button>
            <mat-menu #leagueActionsMenu="matMenu">
              <button mat-menu-item class="destructive-menu-item" [disabled]="isPlaceholderLeague(league)" (click)="deleteLeague(league)">{{ isPlaceholderLeague(league) ? i18n.t('header.placeholderLeagueLocked') : i18n.t('header.deleteLeague') }}</button>
            </mat-menu>
          </div>
        } @else if (showSettingsActions()) {
          <div class="header-actions settings-header-actions" [attr.aria-label]="i18n.t('header.settingsActionsAria')">
            <button mat-stroked-button class="secondary-action" type="button" data-cy="settings-export-button" [disabled]="settingsImporting()" (click)="downloadSettingsExport()">{{ i18n.t('header.exportSettings') }}</button>
            <button mat-flat-button class="home-primary-action" type="button" data-cy="settings-import-button" [disabled]="settingsImporting()" (click)="openSettingsImportPicker()">{{ settingsImporting() ? i18n.t('common.importing') : i18n.t('header.importSettings') }}</button>
            <input #settingsImportInput class="toolbar-import-input" data-cy="settings-import-input" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" [disabled]="settingsImporting()" (change)="importSettings($event)">
          </div>
        } @else if (showHomeActions()) {
          <div class="header-actions home-header-actions">
            <a mat-stroked-button class="secondary-action" routerLink="/settings" data-cy="menu-settings-link">{{ i18n.t('header.settings') }}</a>
          </div>
        }
      </mat-toolbar>
      <nav class="breadcrumb-shell breadcrumb-shell--header" [attr.aria-label]="i18n.t('nav.breadcrumb')">
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
  readonly i18n = inject(I18nService);
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
  readonly isResultPage = computed(() => this.pathOnly(this.currentUrl()).split('/').includes('result'));
  readonly importing = signal(false);
  readonly settingsImporting = signal(false);
  readonly deletingTournament = signal(false);
  readonly importError = signal('');
  readonly settingsMessage = signal('');
  readonly showHeaderImport = signal(this.pathOnly(this.router.url) === '/leagues');
  readonly showLiveTournamentActions = signal(this.isLiveTournamentRunnerPath(this.pathOnly(this.router.url)));
  readonly showSettingsActions = signal(this.pathOnly(this.router.url) === '/settings');
  readonly showHomeActions = signal(this.pathOnly(this.router.url) === '/');
  readonly headerLeague = signal<PersistedLeague | null>(null);
  readonly headerTournament = signal<HeaderTournament | null>(null);
  readonly breadcrumbs = signal<BreadcrumbItem[]>([]);
  private routeStateRequest = 0;

  constructor() {
    void this.updateRouteState(this.router.url);
    window.addEventListener('gones-live-tournament-updated', (event) => this.handleLiveTournamentUpdated(event));
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      void this.updateRouteState(event.urlAfterRedirects);
    });
  }

  private pathOnly(url: string): string {
    return url.split(/[?#]/)[0] || '/';
  }

  private async updateRouteState(url: string): Promise<void> {
    const request = ++this.routeStateRequest;
    this.currentUrl.set(url);
    const path = this.pathOnly(url);
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
    const segments = this.pathOnly(this.router.url).split('/').filter(Boolean);
    if (segments[0] === 'live-tournaments' && segments[1] && segments[1] === detail.liveTournamentId && detail.name) {
      this.breadcrumbs.set([{ label: this.i18n.t('nav.menu'), link: ['/'] }, { label: this.i18n.t('crumb.runningTournaments'), link: ['/live-tournaments'] }, { label: this.i18n.t('crumb.liveSuffix', { name: detail.name }) }]);
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
    const menu = this.i18n.t('nav.menu');
    const segments = path.split('/').filter(Boolean);
    if (!segments.length) return [{ label: menu }];
    if (segments[0] === 'about') return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.about'), lang: 'fr' }];
    if (segments[0] === 'calendar') return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.calendar') }];
    if (segments[0] === 'events') {
      const eventPage = segments[1] ? await this.safeGetEvent(decodeURIComponent(segments[1])) : null;
      return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.calendar'), link: ['/calendar'] }, { label: eventPage?.title || this.i18n.t('crumb.event') }];
    }
    if (segments[0] === 'settings') return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.settings') }];
    if (segments[0] === 'players') return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.player') }];
    if (segments[0] === 'live-tournaments') {
      if (!segments[1]) return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.runningTournaments') }];
      const liveTournament = segments[1] === 'new' ? null : await this.safeGetLiveTournament(decodeURIComponent(segments[1]));
      const label = segments[1] === 'new'
        ? this.i18n.t('crumb.newTournament')
        : this.i18n.t('crumb.liveSuffix', { name: liveTournament?.name || this.i18n.t('crumb.liveTournament') });
      return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.runningTournaments'), link: ['/live-tournaments'] }, { label }];
    }
    if (segments[0] !== 'leagues') return [{ label: menu, link: ['/'] }, { label: this.i18n.t('nav.notFound') }];
    if (!segments[1]) return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.leagues') }];

    const leagueId = decodeURIComponent(segments[1]);
    const league = await this.safeGetLeague(leagueId);
    const leagueLabel = league
      ? (league.id === PLACEHOLDER_LEAGUE_ID ? this.i18n.t('liveList.unassigned') : league.name)
      : this.i18n.t('crumb.league');
    if (segments[2] !== 'tournaments' || !segments[3]) return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.leagues'), link: ['/leagues'] }, { label: leagueLabel }];

    const tournamentId = decodeURIComponent(segments[3]);
    const tournamentLabel = league?.tournaments.find((item) => item.id === tournamentId)?.name || this.i18n.t('crumb.tournament');
    if (segments[4] === 'result') return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.leagues'), link: ['/leagues'] }, { label: leagueLabel, link: ['/leagues', leagueId] }, { label: tournamentLabel, link: ['/leagues', leagueId, 'tournaments', tournamentId] }, { label: this.i18n.t('crumb.result') }];
    return [{ label: menu, link: ['/'] }, { label: this.i18n.t('crumb.leagues'), link: ['/leagues'] }, { label: leagueLabel, link: ['/leagues', leagueId] }, { label: tournamentLabel }];
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
      this.settingsMessage.set(this.i18n.t('msg.settingsExported'));
      this.importError.set('');
      logBoundaryInfo('app-header.exportSettings', { language: settings.language, deckArchetypes: settings.deckArchetypes.length });
    } catch (error) {
      logBoundaryError('app-header.exportSettings', error, { language: settings.language, deckArchetypes: settings.deckArchetypes.length });
      this.importError.set(this.i18n.t('msg.settingsExportFailed'));
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
        this.importError.set(this.i18n.t('msg.settingsImportInvalid'));
        this.settingsMessage.set('');
        return;
      }

      const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: this.i18n.t('dialog.importSettingsTitle'),
          message: this.i18n.t('dialog.importSettingsMessage', {
            count: parsed.deckArchetypes.length,
            plural: parsed.deckArchetypes.length === 1 ? '' : 's',
            language: this.i18n.languageWord(parsed.language)
          }),
          confirmLabel: this.i18n.t('dialog.replaceSettings'),
          destructive: true
        }
      }).afterClosed());
      if (!confirmed) {
        this.settingsMessage.set(this.i18n.t('msg.settingsImportCanceled'));
        this.importError.set('');
        return;
      }

      await this.settings.replaceSettings(parsed);
      this.settingsMessage.set(this.i18n.t('msg.settingsImported', { count: parsed.deckArchetypes.length, plural: parsed.deckArchetypes.length === 1 ? '' : 's', language: this.i18n.languageLabel(parsed.language) }));
      this.importError.set('');
      logBoundaryInfo('app-header.importSettings', { fileName: file.name, language: parsed.language, deckArchetypes: parsed.deckArchetypes.length });
    } catch (error) {
      logBoundaryError('app-header.importSettings', error, { fileName: file.name });
      this.importError.set(error instanceof SyntaxError ? this.i18n.t('msg.settingsImportBadJson') : this.i18n.t('msg.settingsImportFailed'));
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
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: this.i18n.t('dialog.deleteLeagueTitle'), message: this.i18n.t('dialog.deleteLeagueMessage', { name: league.name }), confirmLabel: this.i18n.t('dialog.deleteLeagueTitle'), destructive: true } }).afterClosed());
    if (!confirmed) return;
    await this.repo.deleteLeague(league.id);
    this.headerLeague.set(null);
    await this.router.navigate(['/leagues']);
  }

  async deleteTournament({ league, tournament }: HeaderTournament): Promise<void> {
    if (this.deletingTournament()) return;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: this.i18n.t('dialog.deleteTournamentTitle'), message: this.i18n.t('dialog.deleteTournamentMessage', { name: tournament.name }), confirmLabel: this.i18n.t('dialog.deleteTournamentTitle'), destructive: true } }).afterClosed());
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
      this.importError.set(error instanceof Error && error.message === 'staleLeagueDocument' ? this.i18n.t('msg.staleLeagueDeleteTournament') : this.i18n.t('msg.deleteTournamentFailed'));
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
      this.importError.set(importErrorMessage(error, this.i18n));
    } finally {
      this.importing.set(false);
      input.value = '';
    }
  }
}

function importErrorMessage(error: unknown, i18n: I18nService): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return i18n.t('msg.importQuota');
  if (error instanceof Error) {
    if (error.message === 'gonesImportFileTooLarge') return i18n.t('msg.importTooLarge');
    if (error.message === 'gonesImportTooManyLeagues') return i18n.t('msg.importTooManyLeagues');
    if (error.message === 'unsupportedGonesExport' || error.message === 'wrongExportKind') return i18n.t('msg.importUnsupported');
  }
  if (error instanceof SyntaxError) return i18n.t('msg.importBadJson');
  return i18n.t('msg.importFailed');
}
