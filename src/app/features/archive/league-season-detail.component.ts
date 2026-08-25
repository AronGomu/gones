import { Component, InjectionToken, Signal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { ArchiveLeagueSeasonRow, ArchiveRepository, ArchiveTournamentRow } from '../../data/archive-repository.service';
import { isArchiveTournamentRowLocked, isLeagueSeasonRowLocked } from '../../data/archive-summary';
import { I18nService } from '../../i18n/i18n.service';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';

/**
 * The Season page and the Tab 1 expansion read the same list the same way, so the shape of that read
 * lives here once. `ArchiveTournamentRow` and `ArchiveLeagueSeasonRow` are the catalog's own row
 * types — re-exported rather than redeclared, so a view can never drift from the summary both
 * authorities produce.
 */
export type { ArchiveLeagueSeasonRow, ArchiveTournamentRow } from '../../data/archive-repository.service';

/** The §8.1 read, exactly as the repository answers it. Structural: the real result is assignable. */
export interface SeasonTournamentsPage {
  readonly items: readonly ArchiveTournamentRow[];
  /** true ⇒ served from IndexedDB or the browser-local store; no request was made. */
  readonly fromCache: boolean;
  /** The server half's row cap. A cache-served or browser-local answer is never truncated. */
  readonly truncated: boolean;
}

/**
 * The one read a Season expansion is allowed to perform — and nothing else. There is deliberately no
 * writer on this port: `archive-backfill-queue.ts` is the single writer of year partitions, and a
 * port that cannot write cannot become a second one. The repository owns the
 * cached-and-complete-and-locked decision; this module never re-derives it.
 */
export interface SeasonTournamentsSource {
  listSeasonTournaments(season: SeasonSpan): Promise<SeasonTournamentsPage>;
}

/** What the read path needs off a Season: its id and the span its Tournaments fall in. */
export type SeasonSpan = Pick<ArchiveLeagueSeasonRow, 'id' | 'firstTournamentDate' | 'lastTournamentDate'>;

/** What the Season page additionally needs, on top of the read above. */
export interface ArchiveSeasonSource extends SeasonTournamentsSource {
  getSeason(seasonId: string): Promise<ArchiveLeagueSeasonRow | undefined>;
  getLeagueName(leagueId: string): Promise<string | undefined>;
}

function archiveSeasonSourceFactory(): ArchiveSeasonSource {
  const repo = inject(ArchiveRepository);
  return {
    listSeasonTournaments: (season) => repo.listSeasonTournaments(season),
    getSeason: async (seasonId) => (await repo.listLeagueSeasons()).items.find((season) => season.id === seasonId),
    getLeagueName: async (leagueId) => (await repo.listLeagues()).items.find((league) => league.id === leagueId)?.name
  };
}

export const ARCHIVE_SEASON_SOURCE = new InjectionToken<ArchiveSeasonSource>('ARCHIVE_SEASON_SOURCE', {
  providedIn: 'root',
  factory: archiveSeasonSourceFactory
});

/** `'cache'` ⇒ served locally with no request. `'server'` ⇒ read through, and deliberately not cached. */
export interface SeasonTournamentsRead {
  readonly origin: 'cache' | 'server';
  readonly items: readonly ArchiveTournamentRow[];
  readonly truncated: boolean;
}

export type SeasonExpansionState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly origin: 'cache' | 'server'; readonly items: readonly ArchiveTournamentRow[] }
  | { readonly status: 'failed' };

/** Lines shown inside an expanded Season row before the "show all" line replaces the rest. */
export const SEASON_EXPANSION_PREVIEW_LIMIT = 10;

/**
 * The §8.1 read path. Thin on purpose: whether the span is fully cached, complete and locked is the
 * repository's decision and is made in exactly one place, so this adapter only names what came back.
 * A read-through answer is rendered and dropped — caching it here would make a second writer of the
 * year partitions and could leave a half-year behind.
 */
export async function readSeasonTournaments(
  season: SeasonSpan,
  source: SeasonTournamentsSource
): Promise<SeasonTournamentsRead> {
  const page = await source.listSeasonTournaments(season);
  return { origin: page.fromCache ? 'cache' : 'server', items: [...page.items], truncated: page.truncated };
}

/**
 * `/archive/league-seasons/:seasonId` — one Season, its League, its counters and its whole Tournament
 * list, read-only. The list comes through the shared read path, and the page says so when it was read
 * from the server rather than from this browser.
 */
@Component({
  selector: 'gones-league-season-detail',
  standalone: true,
  imports: [RouterLink, MatCardModule, BackButtonComponent],
  template: `
    <gones-back-button data-cy="archive-season-back-top" [link]="['/archive/league-seasons']" [label]="i18n.t('archiveSeason.backToSeasons')" position="top" />

    @if (error()) { <p class="error" role="alert" data-cy="archive-season-error">{{ error() }}</p> }

    @if (season(); as row) {
      <section class="page-heading" data-cy="archive-season-heading">
        <h1 data-cy="archive-season-title">{{ row.name }}</h1>
        @if (season()?.isLocal) {
          <span class="archive-local-badge" [attr.title]="i18n.t('archive.localBadgeTitle')" data-cy="archive-season-local-badge">{{ i18n.t('archive.localBadge') }}</span>
        }
        <p class="archive-season-league" data-cy="archive-season-league">{{ leagueLabel() }}</p>
        <p class="archive-season-badges" data-cy="archive-season-badges">
          <span class="status" [class.completed]="row.status === 'completed'" data-cy="archive-season-status"><span class="status-dot" aria-hidden="true" data-cy="archive-season-status-dot"></span>{{ statusLabel() }}</span>
          @if (locked()) {
            <span class="archive-lock" role="img" [attr.aria-label]="i18n.t('archiveSeason.locked')" [attr.title]="i18n.t('archiveSeason.locked')" data-cy="archive-season-lock">🔒</span>
          }
        </p>
      </section>

      <p class="archive-season-meta" data-cy="archive-season-meta">{{ metaLabel() }}</p>
      <p class="archive-season-dates" data-cy="archive-season-dates">{{ datesLabel() }}</p>

      <section class="archive-season-tournaments" data-cy="archive-season-tournaments">
        <h2 data-cy="archive-season-tournaments-title">{{ i18n.t('archiveSeason.tournaments') }}</h2>
        <div class="archive-child-list" data-cy="archive-season-child-list">
          @if (loading()) {
            <span class="archive-child-placeholder" data-cy="archive-season-child-loading">{{ i18n.t('archiveSeason.fetching') }}</span>
          } @else {
            @for (child of tournaments(); track child.id) {
              <a class="archive-child-line" [routerLink]="['/archive/tournaments', child.id]" [attr.data-cy]="'archive-season-tournament-' + child.id">
                <b [attr.data-cy]="'archive-season-tournament-name-' + child.id">{{ child.name }}</b>@if (child.isLocal) {
                  <span class="archive-local-badge" [attr.title]="i18n.t('archive.localBadgeTitle')" [attr.data-cy]="'archive-season-tournament-local-' + child.id">{{ i18n.t('archive.localBadge') }}</span>
                }<span class="archive-child-separator" aria-hidden="true" [attr.data-cy]="'archive-season-tournament-separator-' + child.id">·</span><span class="archive-child-meta" [attr.data-cy]="'archive-season-tournament-meta-' + child.id">{{ childLine(child) }}</span>
                @if (isLocked(child)) {
                  <span class="archive-lock" role="img" [attr.aria-label]="i18n.t('archiveSeason.tournamentLocked')" [attr.data-cy]="'archive-season-tournament-lock-' + child.id">🔒</span>
                }
              </a>
            } @empty {
              <span class="archive-child-placeholder" data-cy="archive-season-child-empty">{{ i18n.t('archiveSeason.noTournaments') }}</span>
            }
          }
        </div>
        @if (origin() === 'server') {
          <p class="muted archive-season-read-through" data-cy="archive-season-read-through">{{ i18n.t('archiveSeason.readThrough') }}</p>
        }
      </section>
    } @else if (notFound()) {
      <mat-card class="panel" data-cy="archive-season-not-found">
        <mat-card-title data-cy="archive-season-not-found-title">{{ i18n.t('archiveSeason.notFoundTitle') }}</mat-card-title>
        <mat-card-content data-cy="archive-season-not-found-body"><p data-cy="archive-season-not-found-text">{{ i18n.t('archiveSeason.notFoundBody') }}</p></mat-card-content>
      </mat-card>
    }

    <gones-back-button data-cy="archive-season-back-bottom" [link]="['/archive/league-seasons']" [label]="i18n.t('archiveSeason.backToSeasons')" position="bottom" />
  `,
  styles: [`
    .archive-season-league { margin: .2rem 0 0; color: var(--steel); font-size: .9rem; }
    .archive-season-badges { display: flex; align-items: center; gap: .4rem; margin: .5rem 0 0; }
    .archive-season-meta, .archive-season-dates { margin: .2rem 0; color: var(--dim-ash); font-size: .86rem; }
    .archive-season-tournaments h2 { margin: 1.2rem 0 .4rem; color: var(--dim-ash); font-size: .78rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .archive-season-read-through { margin: .5rem 0 0; color: var(--steel); font-size: .8rem; font-style: italic; }
    .archive-lock { color: var(--steel); font-size: .78rem; }
    .archive-child-list { padding: .2rem 0 .3rem; }
    .archive-child-line { display: block; margin: .1rem 0; padding: .4rem .5rem .4rem .75rem; border-left: 2px solid var(--rust-plate); font-size: .88rem; text-decoration: none; }
    .archive-child-line:hover, .archive-child-line:focus-visible { border-left-color: var(--hot-blood); background: color-mix(in oklch, var(--blood) 14%, transparent); }
    .archive-child-meta { color: var(--dim-ash); }
    .archive-child-separator { margin: 0 .45rem; color: var(--soot); }
    .archive-child-placeholder { display: block; padding: .4rem .5rem .4rem .75rem; border-left: 2px solid var(--rust-plate); color: var(--steel); font-size: .88rem; font-style: italic; }
  `]
})
export class LeagueSeasonDetailComponent {
  readonly i18n = inject(I18nService);
  private readonly source = inject(ARCHIVE_SEASON_SOURCE);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly notFound = signal(false);
  readonly season = signal<ArchiveLeagueSeasonRow | null>(null);
  readonly leagueName = signal('');
  readonly origin = signal<'cache' | 'server'>('cache');
  readonly tournaments = signal<readonly ArchiveTournamentRow[]>([]);
  readonly locked: Signal<boolean>;

  constructor() {
    this.locked = computed(() => {
      const row = this.season();
      return row ? isLeagueSeasonRowLocked(row) : false;
    });
    void this.load();
  }

  /** Never throws: a failed read is a rendered message, never an error thrown into the router. */
  async load(): Promise<void> {
    const seasonId = this.route.snapshot.paramMap.get('seasonId') ?? '';
    this.loading.set(true);
    this.error.set('');
    try {
      const season = await this.source.getSeason(seasonId);
      if (!season) {
        this.notFound.set(true);
        return;
      }
      this.season.set(season);
      void this.source.getLeagueName(season.leagueId).then((name) => this.leagueName.set(name ?? ''));
      const read = await readSeasonTournaments(season, this.source);
      this.origin.set(read.origin);
      this.tournaments.set(read.items);
    } catch (error) {
      logBoundaryError('archive-season-detail.load', error, { seasonId });
      this.error.set(this.i18n.t('archiveSeason.loadOneFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  leagueLabel(): string { return this.leagueName() || this.i18n.t('archive.unknownLeague'); }

  statusLabel(): string {
    return this.i18n.t(this.season()?.status === 'completed' ? 'common.completed' : 'common.active');
  }

  metaLabel(): string {
    const row = this.season();
    if (!row) return '';
    return this.i18n.t('archiveSeason.meta', {
      tournaments: this.i18n.plural(row.tournamentCount, 'archiveSeason.tournamentCount', 'archiveSeason.tournamentCountPlural'),
      players: this.i18n.plural(row.playerCount, 'archiveSeason.playerCount', 'archiveSeason.playerCountPlural')
    });
  }

  datesLabel(): string {
    const row = this.season();
    if (!row?.firstTournamentDate || !row.lastTournamentDate) return this.i18n.t('archiveSeason.noDates');
    return this.i18n.t('archiveSeason.datesRange', {
      start: this.i18n.formatDate(row.firstTournamentDate),
      end: this.i18n.formatDate(row.lastTournamentDate)
    });
  }

  childLine(row: ArchiveTournamentRow): string {
    return this.i18n.t('archiveSeason.childLine', {
      date: this.i18n.formatDate(row.tournamentDate),
      players: this.i18n.plural(row.playerCount, 'archiveSeason.playerCount', 'archiveSeason.playerCountPlural'),
      status: this.i18n.t(row.status === 'completed' ? 'common.completed' : 'common.active')
    });
  }

  /** Derived at read time from the date, never from a stored flag — and never for a local row. */
  isLocked(row: ArchiveTournamentRow): boolean { return isArchiveTournamentRowLocked(row); }
}
