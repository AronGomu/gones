import { Component, computed, effect, ElementRef, inject, Injector, signal, ViewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ARCHIVE_UPDATED_EVENT, ArchiveRepository } from './data/archive-repository.service';
import { LiveTournamentRepository } from './data/live-tournament-repository.service';
import { archiveBundleFilename, attachArchiveChecksum } from './domain/archive-export-schemas';
import type { PersistedArchiveTournament, PersistedLeagueSeason } from './domain/archive-models';
import { logBoundaryError, logBoundaryInfo } from './shared/app-logger';
import { DeckArchetypeSettingsService, parseAppSettings } from './shared/deck-archetype-settings.service';
import { I18nService } from './i18n/i18n.service';
import { ConfirmDialogComponent } from './shared/dialogs';
import { saveJsonFile } from './shared/save-json-file';
import { AuthService } from './auth/auth.service';
import { LastVisitedUrlService } from './auth/last-visited-url.service';
import { ApiProblemError } from './api/api-boundary';
import { BreadcrumbItem, buildBreadcrumbs } from './app-breadcrumbs';
import { PowerUserSettingsService } from './shared/power-user-settings.service';
import { purgeRetiredLeagueDatabase } from './backend/local-archive-backend.service';

const AUTH_PATHS = ['/login', '/register', '/auth/complete-profile', '/verify-email', '/forgot-password', '/reset-password'];

interface HeaderTournament {
  season: PersistedLeagueSeason | null;
  tournament: PersistedArchiveTournament;
}

@Component({
  selector: 'gones-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, MatButtonModule, MatToolbarModule],
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
            <a mat-stroked-button class="secondary-action" data-cy="tournament-result-link" [routerLink]="['/archive', 'tournaments', item.tournament.id, 'result']" [attr.aria-label]="i18n.t('header.viewResultAria', { name: item.tournament.name })">{{ i18n.t('header.viewResult') }}</a>
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
              @if (showSignInLink()) {
                <a mat-stroked-button class="secondary-action" routerLink="/login" data-cy="toolbar-sign-in-link" [attr.aria-label]="i18n.t('auth.signInAria')">{{ i18n.t('auth.signIn') }}</a>
              }
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
  private readonly repo = inject(ArchiveRepository);
  private readonly liveRepo = inject(LiveTournamentRepository);
  private readonly settings = inject(DeckArchetypeSettingsService);
  readonly power = inject(PowerUserSettingsService);
  private readonly dialog = inject(MatDialog);
  readonly currentUrl = signal(this.router.url);
  readonly isResultPage = computed(() => this.pathOnly(this.currentUrl()).split('/').includes('result'));
  readonly showSignInLink = computed(() => !AUTH_PATHS.includes(this.pathOnly(this.currentUrl())));
  readonly importing = signal(false);
  readonly settingsImporting = signal(false);
  readonly importError = signal('');
  readonly settingsMessage = signal('');
  readonly resendPending = signal(false);
  readonly resendStatus = signal('');
  // No role gate on the `/archive` import: every Power User can write some store, and the repository
  // routes the restore to the one `createArchiveTarget(role)` names (ADR 0028). The header carries no
  // per-record mutation any more — the Tournament delete menu retired with the legacy surface — so the
  // per-record gate lives with the one surface that still writes, the staged editor.
  readonly showHeaderImport = signal(this.pathOnly(this.router.url) === '/archive/league-seasons');
  readonly showLiveTournamentActions = signal(this.isLiveTournamentRunnerPath(this.pathOnly(this.router.url)));
  readonly showSettingsActions = signal(this.pathOnly(this.router.url) === '/settings');
  readonly headerTournament = signal<HeaderTournament | null>(null);
  readonly breadcrumbs = signal<BreadcrumbItem[]>([]);
  private routeStateRequest = 0;

  constructor() {
    purgeRetiredLeagueDatabase();
    void this.updateRouteState(this.router.url);
    window.addEventListener('gones-live-tournament-updated', (event) => this.handleLiveTournamentUpdated(event));
    // Every archive mutation announces itself here, so this is the one place the header rebuilds for
    // all of them. This handler clears no cache — `invalidateArchiveCaches()` already did, before it
    // dispatched (ADR 0039).
    window.addEventListener(ARCHIVE_UPDATED_EVENT, () => {
      void this.updateRouteState(this.router.url);
    });
    this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
      this.lastVisited.record(event.urlAfterRedirects);
      void this.updateRouteState(event.urlAfterRedirects);
    });
    // Breadcrumb labels are translated when the array is built, not when it is rendered, so a
    // language change has to rebuild them. `updateRouteState` is already guarded by
    // `routeStateRequest`, so a rebuild racing a navigation cannot win over the newer one.
    effect(() => {
      this.i18n.language();
      void this.updateRouteState(this.router.url);
    });
  }

  private pathOnly(url: string): string {
    return url.split(/[?#]/)[0] || '/';
  }

  private async updateRouteState(url: string): Promise<void> {
    const request = ++this.routeStateRequest;
    this.currentUrl.set(url);
    const path = this.pathOnly(url);
    this.showHeaderImport.set(path === '/archive/league-seasons');
    this.showLiveTournamentActions.set(this.isLiveTournamentRunnerPath(path));
    this.showSettingsActions.set(path === '/settings');
    if (path !== '/settings') this.settingsMessage.set('');
    this.headerTournament.set(await this.buildHeaderTournament(path));
    const breadcrumbs = await this.buildBreadcrumbs(path);
    if (request === this.routeStateRequest) this.breadcrumbs.set(breadcrumbs);
  }

  openLiveTournamentAdvancedSettings(): void {
    if (!this.power.enabled()) return;
    window.dispatchEvent(new CustomEvent('gones-open-live-tournament-advanced-settings'));
  }

  async logout(): Promise<void> {
    const returnUrl = this.currentUrl();
    await this.auth.logout();
    await this.router.navigate(['/login'], { queryParams: { returnUrl } });
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

  /** Only the Tournament detail page. Its Season is looked up for the label, never for the link. */
  private async buildHeaderTournament(path: string): Promise<HeaderTournament | null> {
    const segments = path.split('/').filter(Boolean);
    if (segments[0] !== 'archive' || segments[1] !== 'tournaments' || !segments[2] || segments.length !== 3) return null;
    const tournament = await this.safeGetArchiveTournament(decodeURIComponent(segments[2]));
    return tournament ? { season: null, tournament } : null;
  }

  private async buildBreadcrumbs(path: string): Promise<BreadcrumbItem[]> {
    return buildBreadcrumbs(
      path,
      (key, params) => this.i18n.t(key, params),
      (liveTournamentId) => this.safeGetLiveTournament(liveTournamentId)
    );
  }

  private async safeGetArchiveTournament(tournamentId: string): Promise<PersistedArchiveTournament | null> {
    try { return await this.repo.getTournament(tournamentId); }
    catch (error) { logBoundaryError('app-header.loadArchiveTournament', error, { tournamentId }); return null; }
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

  /**
   * ADR 0028's export bridge. Browser-local records only: the three-tier read surface serves slim
   * catalogs and one detail per Tournament (ADR 0039/0042), so there is no whole-document server read
   * to build a server half from. A signed-in visitor's archive lives on the server, so writing this
   * bundle for them would hand over a backup missing everything it claims to hold — the same "a
   * partial export fails loudly" rule the League export already applied, for a different reason.
   */
  async downloadFullExport(): Promise<void> {
    if (this.auth.profile()) {
      this.importError.set(this.i18n.t('msg.fullDataExportServerUnavailable'));
      return;
    }
    this.importError.set('');
    const bundle = await this.repo.exportBundle();
    saveJsonFile(await attachArchiveChecksum(bundle), archiveBundleFilename());
  }

  async importLeague(event: Event): Promise<void> {
    if (!this.power.enabled()) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.importing()) return;
    this.importing.set(true);
    try {
      const { ArchiveImportService } = await import('./data/archive-import.service');
      const parsed = await this.injector.get(ArchiveImportService).readBundle(file);
      const restored = await this.repo.restoreBundle(parsed.bundle);
      this.importError.set('');
      logBoundaryInfo('app-header.importArchive.success', {
        leagueCount: restored.leagueIds.length,
        leagueSeasonCount: restored.leagueSeasonIds.length,
        tournamentCount: restored.tournamentIds.length
      });
    } catch (error) {
      logBoundaryError('app-header.importArchive', error, { fileName: file.name });
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
