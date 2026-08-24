import { Component, InjectionToken, Signal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { firstValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import { Client } from '../../api/generated/gones-api';
import { ArchiveRepository } from '../../data/archive-repository.service';
import { isArchiveTournamentRowLocked } from '../../data/archive-summary';
import { PersistedArchiveTournament, toTournamentDocument } from '../../domain/archive-models';
import { LeagueStatus, RoundEntry, TournamentDocument, formatPlayerWithArchetype } from '../../domain/models';
import { calculateTournamentResult } from '../../domain/results';
import { I18nService } from '../../i18n/i18n.service';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { RankingTableComponent } from '../../shared/ranking-table.component';

/**
 * The whole Tournament document as `GET /api/archive/tournaments/{id}` serves it. It is the archive's
 * own persisted shape — reused rather than redeclared, so the ranking adapter below stays the single
 * one in the app.
 */
export type ArchiveTournamentDetail = PersistedArchiveTournament;

export interface ArchiveTournamentDetailSource {
  /** `undefined` for `404` — an absent or soft-deleted Tournament is a page state, not an error. */
  getTournament(tournamentId: string): Promise<ArchiveTournamentDetail | undefined>;
  getSeasonName(seasonId: string): Promise<string | undefined>;
}

/** Exactly the one archive read this page makes, and nothing else on `Client`. */
interface ArchiveDetailReadClient {
  archiveTournamentDetail(tournamentId: string): Observable<RawArchiveTournamentDetail>;
}

/** The runtime JSON of the detail route: `updatedAt` arrives as an ISO string, `seasonId` as `null`. */
interface RawArchiveTournamentDetail {
  id: string;
  name: string;
  seasonId?: string | null;
  tournamentDate: unknown;
  status: string;
  rounds?: RawRound[];
  playerArchetypes?: { playerName: string; archetype: string }[];
  documentVersion: number;
  updatedAt: unknown;
}

/**
 * `entries` is `unknown[]` on purpose: the generated client renders a `RoundEntry` as an opaque
 * index-signature interface, which is not assignable to the domain union even though the JSON on the
 * wire is exactly it. Widening here keeps `inject(Client)` assignable to the port and confines the
 * conversion to the one cast below.
 */
interface RawRound { id: string; entries: unknown[] }

function archiveTournamentDetailSourceFactory(): ArchiveTournamentDetailSource {
  const client: ArchiveDetailReadClient = inject(Client);
  const repo = inject(ArchiveRepository);
  return {
    // A Tournament document is not catalog data: it is the read-through, never-cached half of the
    // archive, so it comes straight off the route instead of through the catalog cache.
    getTournament: async (tournamentId) => {
      try {
        const raw = await firstValueFrom(client.archiveTournamentDetail(tournamentId));
        return {
          id: raw.id,
          name: raw.name,
          seasonId: raw.seasonId ?? null,
          tournamentDate: String(raw.tournamentDate ?? ''),
          status: raw.status === 'completed' ? 'completed' : ('active' as LeagueStatus),
          rounds: (raw.rounds ?? []).map((round) => ({ id: round.id, entries: round.entries as RoundEntry[] })),
          playerArchetypes: raw.playerArchetypes ?? [],
          documentVersion: raw.documentVersion,
          updatedAt: String(raw.updatedAt ?? '')
        };
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    getSeasonName: async (seasonId) => (await repo.listLeagueSeasons()).items.find((season) => season.id === seasonId)?.name
  };
}

/** A `404` is a page state; every other status stays an error the page renders as one.
 *  `ApiException` carries the status the generated client threw with. */
function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: number }).status === 404;
}

export const ARCHIVE_TOURNAMENT_DETAIL_SOURCE = new InjectionToken<ArchiveTournamentDetailSource>(
  'ARCHIVE_TOURNAMENT_DETAIL_SOURCE',
  { providedIn: 'root', factory: archiveTournamentDetailSourceFactory }
);

/**
 * Adapts the three-tier document to the shape the two result calculators take. The legacy `leagueId`
 * slot is filled with `seasonId ?? ''` and is never read: `calculateTournamentResult` and
 * `buildTournamentSummary` reach only `rounds` and `playerArchetypes`.
 */
export function toResultInput(detail: ArchiveTournamentDetail): TournamentDocument {
  return toTournamentDocument(detail, detail.seasonId ?? '');
}

/** One round, numbered for display. The document stores order, not numbers. */
interface RoundView {
  readonly number: number;
  readonly entries: readonly RoundEntry[];
}

/**
 * `/archive/tournaments/:tournamentId` — the archived Tournament, read-only: its date, status, lock,
 * Season (or the standalone marker), the computed ranking, its rounds and a link to the result.
 */
@Component({
  selector: 'gones-tournament-detail',
  standalone: true,
  imports: [RouterLink, MatCardModule, RankingTableComponent, BackButtonComponent],
  template: `
    <gones-back-button data-cy="archive-tournament-back-top" [link]="['/archive/tournaments']" [label]="i18n.t('archiveDetail.backToTournaments')" position="top" />

    @if (error()) { <p class="error" role="alert" data-cy="archive-tournament-error">{{ error() }}</p> }

    @if (tournament(); as t) {
      <section class="page-heading" data-cy="archive-tournament-heading">
        <h1 data-cy="archive-tournament-title">{{ t.name }}</h1>
        <p class="archive-tournament-dates" data-cy="archive-tournament-dates">
          <span data-cy="archive-tournament-played">{{ i18n.formatDate(t.tournamentDate, { dateStyle: 'long' }) }}</span>
          <span class="archive-tournament-updated" data-cy="archive-tournament-updated">{{ i18n.t('archiveDetail.updated', { date: i18n.formatDateTime(t.updatedAt) }) }}</span>
        </p>
        <p class="archive-tournament-badges" data-cy="archive-tournament-badges">
          <span class="status" [class.completed]="t.status === 'completed'" data-cy="archive-tournament-status"><span class="status-dot" aria-hidden="true" data-cy="archive-tournament-status-dot"></span>{{ statusLabel() }}</span>
          @if (locked()) {
            <span class="archive-lock" role="img" [attr.aria-label]="i18n.t('archiveDetail.locked')" [attr.title]="i18n.t('archiveDetail.locked')" data-cy="archive-tournament-lock">🔒</span>
          }
        </p>
        @if (t.seasonId) {
          <p class="archive-tournament-season" data-cy="archive-tournament-season">
            <span data-cy="archive-tournament-season-label">{{ i18n.t('archiveDetail.season') }}</span>
            <a [routerLink]="['/archive/league-seasons', t.seasonId]" data-cy="archive-tournament-season-link">{{ seasonName() || t.seasonId }}</a>
          </p>
        } @else {
          <p class="archive-tournament-season" data-cy="archive-tournament-standalone">{{ i18n.t('archiveDetail.standalone') }}</p>
        }
      </section>

      <section class="stack" data-cy="archive-tournament-ranking-section">
        <h2 data-cy="archive-tournament-ranking-title">{{ i18n.t('tournament.ranking') }}</h2>
        <gones-ranking-table [rows]="result().rows" [emptyText]="i18n.t('tournament.emptyRanking')" data-cy="archive-tournament-ranking" />
      </section>

      <section class="stack" data-cy="archive-tournament-rounds-section">
        <h2 data-cy="archive-tournament-rounds-title">{{ i18n.t('tournament.rounds') }}</h2>
        @for (round of rounds(); track round.number) {
          <article class="archive-round" [attr.data-cy]="'archive-tournament-round-' + round.number">
            <h3 [attr.data-cy]="'archive-tournament-round-title-' + round.number">{{ i18n.t('tournament.roundN', { n: round.number }) }}<span class="archive-round-count" [attr.data-cy]="'archive-tournament-round-count-' + round.number">{{ i18n.t('tournament.entriesCount', { count: round.entries.length }) }}</span></h3>
            <div class="table-wrap" [attr.data-cy]="'archive-tournament-round-wrap-' + round.number">
              <table class="ranking-table" [attr.data-cy]="'archive-tournament-round-table-' + round.number">
                <tbody [attr.data-cy]="'archive-tournament-round-body-' + round.number">
                  @for (entry of round.entries; track entry.id) {
                    <tr [attr.data-cy]="'archive-tournament-entry-' + entry.id">
                      <td [attr.data-cy]="'archive-tournament-entry-table-' + entry.id">{{ entry.table }}</td>
                      <td [attr.data-cy]="'archive-tournament-entry-text-' + entry.id">{{ entryLabel(entry) }}</td>
                    </tr>
                  } @empty {
                    <tr [attr.data-cy]="'archive-tournament-round-empty-row-' + round.number">
                      <td colspan="2" class="empty" [attr.data-cy]="'archive-tournament-round-empty-' + round.number">{{ i18n.t('tournament.emptyRanking') }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </article>
        } @empty {
          <p class="empty" data-cy="archive-tournament-no-rounds">{{ i18n.t('tournament.emptyRanking') }}</p>
        }
      </section>

      <p class="archive-tournament-actions" data-cy="archive-tournament-actions">
        <a [routerLink]="['/archive/tournaments', tournamentId(), 'result']" data-cy="archive-tournament-see-result">{{ i18n.t('archiveDetail.seeResult') }}</a>
      </p>
      <p class="muted" data-cy="archive-tournament-read-only">{{ i18n.t('archiveDetail.readOnly') }}</p>
    } @else if (notFound()) {
      <mat-card class="panel" data-cy="archive-tournament-not-found">
        <mat-card-title data-cy="archive-tournament-not-found-title">{{ i18n.t('tournament.notFoundTitle') }}</mat-card-title>
        <mat-card-content data-cy="archive-tournament-not-found-body"><p data-cy="archive-tournament-not-found-text">{{ i18n.t('tournament.notFoundBody') }}</p></mat-card-content>
      </mat-card>
    }

    <gones-back-button data-cy="archive-tournament-back-bottom" [link]="['/archive/tournaments']" [label]="i18n.t('archiveDetail.backToTournaments')" position="bottom" />
  `,
  styles: [`
    .archive-tournament-dates { display: flex; flex-wrap: wrap; gap: .6rem; margin: .2rem 0 0; color: var(--dim-ash); font-size: .88rem; }
    .archive-tournament-updated { color: var(--steel); }
    .archive-tournament-badges { display: flex; align-items: center; gap: .4rem; margin: .5rem 0 0; }
    .archive-tournament-season { display: flex; align-items: baseline; gap: .45rem; margin: .4rem 0 0; color: var(--steel); font-size: .88rem; }
    .archive-lock { color: var(--steel); font-size: .78rem; }
    .archive-round h3 { display: flex; flex-wrap: wrap; align-items: baseline; gap: .6rem; margin: .9rem 0 .3rem; color: var(--dim-ash); font-size: .8rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
    .archive-round-count { color: var(--steel); font-size: .74rem; font-weight: 700; letter-spacing: normal; text-transform: none; }
    .archive-tournament-actions { margin: 1rem 0 .2rem; }
  `]
})
export class TournamentDetailComponent {
  readonly i18n = inject(I18nService);
  private readonly source = inject(ARCHIVE_TOURNAMENT_DETAIL_SOURCE);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly error = signal('');
  readonly notFound = signal(false);
  readonly tournament = signal<ArchiveTournamentDetail | null>(null);
  readonly seasonName = signal('');
  readonly tournamentId = signal('');

  readonly result: Signal<ReturnType<typeof calculateTournamentResult> | { rows: []; incomplete: true; provisional: false }>;
  readonly locked: Signal<boolean>;
  readonly rounds: Signal<RoundView[]>;

  constructor() {
    this.result = computed(() => {
      const detail = this.tournament();
      return detail ? calculateTournamentResult(toResultInput(detail)) : { rows: [], incomplete: true, provisional: false };
    });
    this.locked = computed(() => {
      const detail = this.tournament();
      return detail ? isArchiveTournamentRowLocked(detail) : false;
    });
    this.rounds = computed(() =>
      (this.tournament()?.rounds ?? []).map((round, index) => ({ number: index + 1, entries: round.entries })));
    void this.load();
  }

  /** Never throws: a failed read is a rendered message, never an error thrown into the router. */
  async load(): Promise<void> {
    const tournamentId = this.route.snapshot.paramMap.get('tournamentId') ?? '';
    this.tournamentId.set(tournamentId);
    this.loading.set(true);
    this.error.set('');
    try {
      const detail = await this.source.getTournament(tournamentId);
      if (!detail) {
        this.notFound.set(true);
        return;
      }
      this.tournament.set(detail);
      if (detail.seasonId) {
        void this.source.getSeasonName(detail.seasonId).then((name) => this.seasonName.set(name ?? ''));
      }
    } catch (error) {
      logBoundaryError('archive-tournament-detail.load', error, { tournamentId });
      this.error.set(this.i18n.t('archiveDetail.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  statusLabel(): string {
    return this.i18n.t(this.tournament()?.status === 'completed' ? 'archive.tournamentCompleted' : 'archive.tournamentActive');
  }

  /** One read-only line per entry, in the same vocabulary the ranking speaks. */
  entryLabel(entry: RoundEntry): string {
    if (entry.kind === 'bye') return formatPlayerWithArchetype(entry.playerName, entry.deckArchetype);
    if (entry.kind === 'invalid') return entry.rawText;
    const left = formatPlayerWithArchetype(entry.player1Name, entry.player1DeckArchetype);
    const right = formatPlayerWithArchetype(entry.player2Name, entry.player2DeckArchetype);
    return `${left} ${entry.player1Score} – ${entry.player2Score} ${right}`;
  }
}
