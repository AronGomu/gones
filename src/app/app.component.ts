import { Component, computed, ElementRef, inject, Injector, signal, ViewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { canManageLeague, leagueCommandError } from './data/league-archive-command-ux';
import { isAnyPlaceholderLeagueId } from './data/league-archive-origin';
import { LeagueArchiveRepository } from './data/league-archive-repository.service';
import { LiveTournamentRepository } from './data/live-tournament-repository.service';
import { exportFullData, exportLeague, leagueExportFilename } from './domain/export-restore';
import { attachExportChecksum } from './domain/export-schemas';
import { PersistedLeague, TournamentDocument } from './domain/models';
import { logBoundaryError, logBoundaryInfo } from './shared/app-logger';
import { DeckArchetypeSettingsService, parseAppSettings } from './shared/deck-archetype-settings.service';
import { I18nService } from './i18n/i18n.service';
import { ConfirmDialogComponent } from './shared/dialogs';
import { saveJsonFile } from './shared/save-json-file';
import { AuthService } from './auth/auth.service';
import { LastVisitedUrlService } from './auth/last-visited-url.service';
import { ApiProblemError } from './api/api-boundary';
import { BreadcrumbItem, buildBreadcrumbs } from './app-breadcrumbs';
import { canUsePowerMutation, PowerUserSettingsService } from './shared/power-user-settings.service';

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
      <mat-toolbar class="app-toolbar" data-cy="app-toolbar">
        <a class="brand" routerLink="/" [attr.aria-label]="i18n.t('nav.homeAria')" data-cy="app-brand-link"><img src="assets/gones_logo.png" alt="Gones" data-cy="app-brand-logo"></a>
        <span class="spacer" data-cy="app-header-spacer"></span>
        @if (showLiveTournamentActions() && power.enabled()) {
          <div class="header-actions live-tournament-header-actions" data-cy="app-live-tournament-header-actions">
            <button mat-stroked-button class="secondary-action" type="button" data-cy="live-tournament-advanced-settings-button" (click)="openLiveTournamentAdvancedSettings()">{{ i18n.t('header.advancedSettings') }}</button>
          </div>
        } @else if (showHeaderImport()) {
          <div class="header-actions" data-cy="app-leagues-header-actions">
            @if (power.enabled()) {
              <button mat-stroked-button class="secondary-action toolbar-import" type="button" data-cy="app-leagues-import-button" [disabled]="importing()" (click)="openImportPicker()">{{ importing() ? i18n.t('common.importing') : i18n.t('common.import') }}</button>
              <input #headerImportInput class="toolbar-import-input" data-cy="header-import-input" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" [disabled]="importing()" (change)="importLeague($event)">
            }
            <button mat-stroked-button class="secondary-action" type="button" data-cy="app-full-data-export-button" (click)="downloadFullExport()">{{ i18n.t('header.fullDataExport') }}</button>
          </div>
        } @else if (headerTournament(); as item) {
          <div class="header-actions tournament-header-actions" data-cy="app-tournament-header-actions">
            <a mat-stroked-button class="secondary-action" data-cy="tournament-result-link" [routerLink]="['/leagues-archive', item.league.id, 'tournaments-archive', item.tournament.id, 'result']" [attr.aria-label]="i18n.t('header.viewResultAria', { name: item.tournament.name })">{{ i18n.t('header.viewResult') }}</a>
            @if (canManageHeaderLeague()) {
              <button mat-icon-button class="league-actions-trigger" data-cy="app-tournament-actions-trigger" [matMenuTriggerFor]="tournamentActionsMenu" [attr.aria-label]="i18n.t('header.tournamentActions')" [disabled]="deletingTournament()">⋮</button>
              <mat-menu #tournamentActionsMenu="matMenu" data-cy="app-tournament-actions-menu">
                <button mat-menu-item class="destructive-menu-item" data-cy="app-delete-tournament-button" [disabled]="deletingTournament()" (click)="deleteTournament(item)">{{ deletingTournament() ? i18n.t('header.deletingTournament') : i18n.t('header.deleteTournament') }}</button>
              </mat-menu>
            }
          </div>
        } @else if (headerLeague(); as league) {
          <div class="header-actions league-header-actions" data-cy="app-league-header-actions">
            <button mat-stroked-button class="secondary-action" type="button" data-cy="app-export-league-button" (click)="downloadLeagueExport(league)">{{ i18n.t('header.exportLeague') }}</button>
            @if (canManageHeaderLeague()) {
              <button mat-icon-button class="league-actions-trigger" data-cy="app-league-actions-trigger" [matMenuTriggerFor]="leagueActionsMenu" [attr.aria-label]="i18n.t('header.leagueActions')">⋮</button>
              <mat-menu #leagueActionsMenu="matMenu" data-cy="app-league-actions-menu">
                <button mat-menu-item class="destructive-menu-item" data-cy="app-delete-league-button" [disabled]="isPlaceholderLeague(league)" (click)="deleteLeague(league)">{{ isPlaceholderLeague(league) ? i18n.t('header.placeholderLeagueLocked') : i18n.t('header.deleteLeague') }}</button>
              </mat-menu>
            }
          </div>
        } @else if (showSettingsActions()) {
          <div class="header-actions settings-header-actions" data-cy="app-settings-header-actions" [attr.aria-label]="i18n.t('header.settingsActionsAria')">
            <button mat-stroked-button class="secondary-action" type="button" data-cy="settings-export-button" [disabled]="settingsImporting()" (click)="downloadSettingsExport()">{{ i18n.t('header.exportSettings') }}</button>
            <button mat-flat-button class="home-primary-action" type="button" data-cy="settings-import-button" [disabled]="settingsImporting()" (click)="openSettingsImportPicker()">{{ settingsImporting() ? i18n.t('common.importing') : i18n.t('header.importSettings') }}</button>
            <input #settingsImportInput class="toolbar-import-input" data-cy="settings-import-input" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" [disabled]="settingsImporting()" (change)="importSettings($event)">
          </div>
        }
        @if (auth.enabled) {
          <div class="auth-toolbar-actions" data-cy="auth-toolbar-actions">
            @if (auth.profile(); as profile) {
              <a class="toolbar-profile-link" routerLink="/settings/account" data-cy="profile-link">{{ profile.username }}</a>
              <button mat-stroked-button class="danger-ghost-action" type="button" data-cy="logout-button" (click)="logout()">{{ i18n.t('auth.logout') }}</button>
            } @else {
              <a mat-stroked-button class="secondary-action" routerLink="/login" data-cy="toolbar-sign-in-link" [attr.aria-label]="i18n.t('auth.signInAria')">{{ i18n.t('auth.signIn') }}</a>
            }
          </div>
        }
      </mat-toolbar>
      <nav class="breadcrumb-shell breadcrumb-shell--header" data-cy="app-breadcrumb-nav" [attr.aria-label]="i18n.t('nav.breadcrumb')">
        <ol class="breadcrumbs" data-cy="breadcrumbs">
          @for (item of breadcrumbs(); track item.label + $index) {
            <li class="breadcrumb-item" [class.active]="$last" [attr.aria-current]="$last ? 'page' : null" [attr.data-cy]="'app-breadcrumb-item-' + $index">
              @if (!$last && item.link) { <a [routerLink]="item.link" [attr.data-cy]="'app-breadcrumb-link-' + $index">{{ item.label }}</a> }
              @else { <span [attr.data-cy]="$last ? 'breadcrumb-current' : null" [attr.lang]="item.lang">{{ item.label }}</span> }
            </li>
          }
        </ol>
      </nav>
    }
    @if (auth.enabled && auth.profile() && !auth.profile()!.emailVerified) {
      <aside class="warning app-banner verification-banner" role="status" aria-live="polite" data-cy="unverified-banner">
        <span data-cy="app-unverified-banner-text">{{ i18n.t('auth.unverifiedBanner') }}</span>
        <button mat-stroked-button type="button" data-cy="app-resend-verification-button" [disabled]="resendPending()" (click)="resendBanner()">{{ resendPending() ? i18n.t('auth.resending') : i18n.t('auth.resendVerification') }}</button>
        @if (resendStatus()) { <span data-cy="app-resend-status-text">{{ resendStatus() }}</span> }
      </aside>
    }
    @if (importError()) { <p class="error app-banner" role="alert" data-cy="app-import-error-banner">{{ importError() }}</p> }
    @if (settingsMessage()) { <p class="settings-saved app-banner" role="status" data-cy="app-settings-saved-banner">{{ settingsMessage() }}</p> }
    <main class="app-main" data-cy="app-main"><router-outlet data-cy="app-router-outlet" /></main>
  `
})
export class AppComponent {
  readonly i18n = inject(I18nService);
  @ViewChild('headerImportInput') private headerImportInput?: ElementRef<HTMLInputElement>;
  @ViewChild('settingsImportInput') private settingsImportInput?: ElementRef<HTMLInputElement>;

  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  private readonly lastVisited = inject(LastVisitedUrlService);
  private readonly repo = inject(LeagueArchiveRepository);
  private readonly liveRepo = inject(LiveTournamentRepository);
  private readonly settings = inject(DeckArchetypeSettingsService);
  readonly power = inject(PowerUserSettingsService);
  private readonly dialog = inject(MatDialog);
  readonly currentUrl = signal(this.router.url);
  readonly isResultPage = computed(() => this.pathOnly(this.currentUrl()).split('/').includes('result'));
  readonly importing = signal(false);
  readonly settingsImporting = signal(false);
  readonly deletingTournament = signal(false);
  readonly importError = signal('');
  readonly settingsMessage = signal('');
  readonly resendPending = signal(false);
  readonly resendStatus = signal('');
  // No role gate on `/leagues-archive` import: every Power User can write some store, and the
  // repository routes the restore to the one `createLeagueTarget(role)` names (ADR 0028).
  /** Power mode never replaces per-league role/origin authority. */
  readonly canManageHeaderLeague = computed(() => canUsePowerMutation(
    this.power.enabled(),
    canManageLeague(this.headerLeague()?.id ?? this.headerTournament()?.league.id, this.auth.profile()?.globalRole)
  ));
  readonly showHeaderImport = signal(this.pathOnly(this.router.url) === '/leagues-archive');
  readonly showLiveTournamentActions = signal(this.isLiveTournamentRunnerPath(this.pathOnly(this.router.url)));
  readonly showSettingsActions = signal(this.pathOnly(this.router.url) === '/settings');
  readonly headerLeague = signal<PersistedLeague | null>(null);
  readonly headerTournament = signal<HeaderTournament | null>(null);
  readonly breadcrumbs = signal<BreadcrumbItem[]>([]);
  private routeStateRequest = 0;

  constructor() {
    void this.updateRouteState(this.router.url);
    window.addEventListener('gones-live-tournament-updated', (event) => this.handleLiveTournamentUpdated(event));
    window.addEventListener('gones-league-updated', () => void this.updateRouteState(this.router.url));
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      this.lastVisited.record(event.urlAfterRedirects);
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
    this.showHeaderImport.set(path === '/leagues-archive');
    this.showLiveTournamentActions.set(this.isLiveTournamentRunnerPath(path));
    this.showSettingsActions.set(path === '/settings');
    if (path !== '/settings') this.settingsMessage.set('');
    this.headerLeague.set(await this.buildHeaderLeague(path));
    this.headerTournament.set(await this.buildHeaderTournament(path));
    const breadcrumbs = await this.buildBreadcrumbs(path);
    if (request === this.routeStateRequest) this.breadcrumbs.set(breadcrumbs);
  }

  openLiveTournamentAdvancedSettings(): void {
    if (!this.power.enabled()) return;
    window.dispatchEvent(new CustomEvent('gones-open-live-tournament-advanced-settings'));
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/']);
  }

  async resendBanner(): Promise<void> {
    const email = this.auth.profile()?.email;
    if (!email || this.resendPending()) return;
    this.resendPending.set(true);
    try {
      await this.auth.resendVerification({ email, returnUrl: undefined });
      this.resendStatus.set(this.i18n.t('auth.resendStatus'));
    } catch {
      this.resendStatus.set(this.i18n.t('auth.genericError'));
    } finally {
      this.resendPending.set(false);
    }
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
    if (segments[0] !== 'leagues-archive' || !segments[1] || segments.length !== 2) return null;
    return this.safeGetLeague(decodeURIComponent(segments[1]));
  }

  private async buildHeaderTournament(path: string): Promise<HeaderTournament | null> {
    const segments = path.split('/').filter(Boolean);
    if (segments[0] !== 'leagues-archive' || !segments[1] || segments[2] !== 'tournaments-archive' || !segments[3]) return null;
    const league = await this.safeGetLeague(decodeURIComponent(segments[1]));
    const tournament = league?.tournaments.find((item) => item.id === decodeURIComponent(segments[3]));
    return league && tournament ? { league, tournament } : null;
  }

  private async buildBreadcrumbs(path: string): Promise<BreadcrumbItem[]> {
    return buildBreadcrumbs(
      path,
      (key, params) => this.i18n.t(key, params),
      (leagueId) => this.safeGetLeague(leagueId),
      (liveTournamentId) => this.safeGetLiveTournament(liveTournamentId)
    );
  }

  private async safeGetLeague(leagueId: string): Promise<PersistedLeague | null> {
    try { return await this.repo.getLeague(leagueId); }
    catch (error) { logBoundaryError('app-breadcrumb.loadLeague', error, { leagueId }); return null; }
  }

  private async safeGetLiveTournament(liveTournamentId: string) {
    try { return await this.liveRepo.get(liveTournamentId); }
    catch (error) { logBoundaryError('app-breadcrumb.loadLiveTournament', error, { liveTournamentId }); return null; }
  }

  openImportPicker(): void {
    if (!this.power.enabled()) return;
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
    // The list is merged now, so the bundle carries the browser's leagues too — minus *both*
    // placeholders, since neither is user data (ADR 0028).
    const merged = await this.repo.listLeagues();
    // `listLeagues()` degrades to the local list alone when the server read rejects, so writing the
    // file here would present a bundle missing every server league as a complete backup. Export is
    // ADR 0028's only bridge, so a partial one fails loudly instead. Only a signed-in visitor has
    // server leagues to be missing: for a signed-out one the local list *is* the whole archive, and
    // refusing there would take away the only backup they have. An expired session whose `profile()`
    // has already been cleared reads as signed out and still exports browser-only; the UI shows that
    // visitor as signed out, so the bundle matches what they can see.
    if (this.repo.serverUnavailable() && this.auth.profile()) {
      this.importError.set(this.i18n.t('msg.fullDataExportServerUnavailable'));
      return;
    }
    const leagues = merged.filter((league) => !isAnyPlaceholderLeagueId(league.id));
    this.importError.set('');
    saveJsonFile(await attachExportChecksum(exportFullData(leagues, { calendarEvents: [] })), 'gones-full-data.gones.json');
  }

  async downloadLeagueExport(league: PersistedLeague): Promise<void> { const exported = exportLeague(league); saveJsonFile(await attachExportChecksum(exported), leagueExportFilename(league, new Date(exported.exportedAt))); }
  // Both stores seed their own placeholder row and the repository refuses to delete either one, so
  // the menu item is locked for both (ADR 0028).
  isPlaceholderLeague(league: PersistedLeague): boolean { return isAnyPlaceholderLeagueId(league.id); }

  async deleteLeague(league: PersistedLeague): Promise<void> {
    if (!this.power.enabled()) return;
    if (this.isPlaceholderLeague(league)) return;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: this.i18n.t('dialog.deleteLeagueTitle'), message: this.i18n.t('dialog.deleteLeagueMessage', { name: league.name }), confirmLabel: this.i18n.t('dialog.deleteLeagueTitle'), destructive: true } }).afterClosed());
    if (!confirmed) return;
    try {
      await this.repo.deleteLeague(league.id);
      this.headerLeague.set(null);
      await this.router.navigate(['/leagues-archive']);
    } catch (error) {
      logBoundaryError('app-header.deleteLeague', error, { leagueId: league.id });
      const kind = leagueCommandError(error);
      this.importError.set(kind === 'forbidden' ? this.i18n.t('leagues.forbidden') : kind === 'stale' ? this.i18n.t('leagues.staleDelete') : this.i18n.t('leagues.deleteFailed'));
    }
  }

  async deleteTournament({ league, tournament }: HeaderTournament): Promise<void> {
    if (!this.power.enabled()) return;
    if (this.deletingTournament()) return;
    const confirmed = await firstValueFrom(this.dialog.open(ConfirmDialogComponent, { data: { title: this.i18n.t('dialog.deleteTournamentTitle'), message: this.i18n.t('dialog.deleteTournamentMessage', { name: tournament.name }), confirmLabel: this.i18n.t('dialog.deleteTournamentTitle'), destructive: true } }).afterClosed());
    if (!confirmed) return;
    this.deletingTournament.set(true);
    this.importError.set('');
    try {
      await this.repo.deleteResultTournament(league, tournament.id);
      this.headerTournament.set(null);
      await this.router.navigate(['/leagues-archive', league.id]);
    } catch (error) {
      logBoundaryError('app-header.deleteTournament', error, { leagueId: league.id, tournamentId: tournament.id });
      const kind = leagueCommandError(error);
      this.importError.set(kind === 'stale' ? this.i18n.t('msg.staleLeagueDeleteTournament') : kind === 'forbidden' ? this.i18n.t('leagues.forbidden') : this.i18n.t('msg.deleteTournamentFailed'));
    } finally {
      this.deletingTournament.set(false);
    }
  }

  async importLeague(event: Event): Promise<void> {
    if (!this.power.enabled()) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.importing()) return;
    this.importing.set(true);
    try {
      const { LeagueArchiveImportService } = await import('./data/league-archive-import.service');
      const result = await this.injector.get(LeagueArchiveImportService).importFile(file);
      this.importError.set('');
      const firstImportedLeagueId = result.importedLeagueIds[0];
      logBoundaryInfo('app-header.importLeague.success', { kind: result.kind, importedLeagueCount: result.importedLeagueIds.length, destinationLeagueId: firstImportedLeagueId ?? null });
      await this.router.navigate(firstImportedLeagueId ? ['/leagues-archive', firstImportedLeagueId] : ['/leagues-archive']);
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
  if (error instanceof ApiProblemError && error.status === 403) return i18n.t('leagues.forbidden');
  if (error instanceof ApiProblemError && error.status === 412) return i18n.t('leagues.staleDelete');
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return i18n.t('msg.importQuota');
  if (error instanceof Error) {
    if (error.message === 'gonesImportFileTooLarge') return i18n.t('msg.importTooLarge');
    if (error.message === 'gonesImportTooManyLeagues') return i18n.t('msg.importTooManyLeagues');
    if (error.message === 'unsupportedGonesExport' || error.message === 'wrongExportKind') return i18n.t('msg.importUnsupported');
    if (error.message === 'gonesExportChecksumMismatch') return i18n.t('msg.importChecksumMismatch');
  }
  if (error instanceof SyntaxError) return i18n.t('msg.importBadJson');
  return i18n.t('msg.importFailed');
}
