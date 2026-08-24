import { Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../i18n/i18n.service';
import { SyncBarComponent } from '../../shared/sync-bar.component';

/** Which tab the host page is. Route segment and value are deliberately the same string. */
export type ArchiveTab = 'league-seasons' | 'tournaments';

/**
 * The chrome the two Archive tabs share: the page title, the ADR 0039 sync bar and the tab strip.
 * It owns no data and issues no request — the host page loads, and the shell reports what it was
 * handed, so the two tabs cannot drift into two different sync affordances.
 */
@Component({
  selector: 'gones-archive-shell',
  standalone: true,
  imports: [RouterLink, SyncBarComponent],
  template: `
    <div class="archive-heading-row" data-cy="archive-heading-row">
      <section class="page-heading" data-cy="archive-heading">
        <div data-cy="archive-heading-text"><h1 data-cy="archive-title">{{ i18n.t('archive.title') }}</h1></div>
      </section>
      <gones-sync-bar cyPrefix="archive" [syncedAt]="syncedAt()" [loading]="loading()" [stale]="stale()" (sync)="sync.emit()" data-cy="archive-sync-bar" />
    </div>
    <nav class="archive-tabs" [attr.aria-label]="i18n.t('archive.tabsAria')" data-cy="archive-tabs">
      <a
        class="archive-tab"
        [class.is-selected]="activeTab() === 'league-seasons'"
        [attr.aria-current]="activeTab() === 'league-seasons' ? 'page' : null"
        routerLink="/archive/league-seasons"
        data-cy="archive-tab-league-seasons"
      >{{ i18n.t('archive.tabLeagueSeasons') }}</a>
      <a
        class="archive-tab"
        [class.is-selected]="activeTab() === 'tournaments'"
        [attr.aria-current]="activeTab() === 'tournaments' ? 'page' : null"
        routerLink="/archive/tournaments"
        data-cy="archive-tab-tournaments"
      >{{ i18n.t('archive.tabTournaments') }}</a>
    </nav>
    <ng-content />
  `,
  styles: [`
    .archive-heading-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; }
    .archive-heading-row .page-heading { flex: 1 1 auto; min-width: 0; margin: 0; }
    .archive-tabs { display: flex; gap: 2px; margin: 1rem 0 1rem; border-bottom: 1px solid var(--soot); }
    .archive-tab { padding: .7rem 1.15rem; border: 1px solid transparent; border-bottom: 0; color: var(--steel); font-size: .9rem; font-weight: 700; text-decoration: none; }
    .archive-tab:hover, .archive-tab:focus-visible { color: var(--ash); }
    .archive-tab:focus-visible { outline: 2px solid var(--hot-blood); outline-offset: -2px; }
    .archive-tab.is-selected { position: relative; top: 1px; border-color: var(--soot); background: var(--iron); color: var(--ash); }
  `]
})
export class ArchiveShellComponent {
  readonly i18n = inject(I18nService);
  readonly activeTab = input.required<ArchiveTab>();
  readonly syncedAt = input<string | undefined>(undefined);
  readonly loading = input(false);
  readonly stale = input(false);
  readonly sync = output<void>();
}
