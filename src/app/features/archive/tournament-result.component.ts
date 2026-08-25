import { Component, ElementRef, Signal, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { formatPlayerWithArchetype } from '../../domain/models';
import { ArchetypeShare, TournamentSummary, buildTournamentSummary } from '../../domain/tournament-summary';
import { I18nService } from '../../i18n/i18n.service';
import { logBoundaryError } from '../../shared/app-logger';
import { BackButtonComponent } from '../../shared/back-button.component';
import { ARCHIVE_TOURNAMENT_DETAIL_SOURCE, ArchiveTournamentDetail } from './tournament-detail.component';

/**
 * `/archive/tournaments/:tournamentId/result[/metagames]` — the standings and the archetype share of
 * one archived Tournament, with the two download controls the legacy result page has.
 *
 * The pure export helpers below (`MetagameBar` through `crc32`) are a verbatim copy of
 * the retired result page it was carried over from, not a
 * reference into it: that file is deleted at the end of the archive rebuild, and a reference would
 * break at deletion time. The backend slice of this plan set the same precedent with its three
 * HTTP-caching helpers.
 */
@Component({
  selector: 'gones-tournament-result',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, RouterLink, BackButtonComponent],
  template: `
    <gones-back-button data-cy="archive-tournament-result-back-top" [link]="['/archive/tournaments', tournamentId()]" [label]="i18n.t('nav.backToTournament')" position="top" />

    @if (error()) { <p class="error" role="alert" data-cy="archive-tournament-result-error">{{ error() }}</p> }
    @if (summary(); as report) {
      <section #resultSection class="tournament-result-page" [class.result-page--metagame]="page() === 'metagames'" data-cy="archive-tournament-result-page">
        <section class="result-hero" data-cy="archive-tournament-result-hero">
          <div class="result-title-block" data-cy="archive-tournament-result-title-block">
            <h1 data-cy="archive-tournament-result-title">@if (seasonName()) { <span data-cy="archive-tournament-result-season-name">{{ seasonName() }}</span><span data-cy="archive-tournament-result-title-gap">&nbsp;</span> }<span data-cy="archive-tournament-result-tournament-name">{{ report.tournamentName }}</span><span class="result-page-separator" aria-hidden="true" data-cy="archive-tournament-result-title-separator"> — </span><span class="result-page-label" data-cy="archive-tournament-result-page-label">{{ pageLabel() }}</span></h1>
            <p class="result-subtitle" data-cy="archive-tournament-result-subtitle">{{ formatTournamentDate(report.tournamentDate) }}</p>
          </div>
          @if (page() === 'standings') {
            <div class="result-counts" data-cy="archive-tournament-result-counts" [attr.aria-label]="i18n.t('result.statsAria')">
              <div class="result-player-badge" data-cy="archive-tournament-result-player-badge"><span data-cy="archive-tournament-result-player-badge-label">{{ i18n.t('common.players') }}</span><strong data-cy="archive-tournament-result-player-badge-value">{{ report.stats.playerCount }}</strong></div>
              <div class="result-player-badge" data-cy="archive-tournament-result-round-badge"><span data-cy="archive-tournament-result-round-badge-label">{{ i18n.t('common.rounds') }}</span><strong data-cy="archive-tournament-result-round-badge-value">{{ report.stats.roundCount }}</strong></div>
              <div class="result-player-badge" data-cy="archive-tournament-result-match-badge"><span data-cy="archive-tournament-result-match-badge-label">{{ i18n.t('common.matches') }}</span><strong data-cy="archive-tournament-result-match-badge-value">{{ report.stats.matchCount }}</strong></div>
            </div>
          }
        </section>

        <section class="result-page-body" data-cy="archive-tournament-result-body">
          @if (page() === 'standings') {
            <section class="result-panel result-standings" data-cy="archive-tournament-result-standings-panel" [attr.aria-label]="i18n.t('result.standings')">
              <table data-cy="archive-tournament-result-standings-table">
                <thead data-cy="archive-tournament-result-standings-head"><tr data-cy="archive-tournament-result-standings-head-row"><th data-cy="archive-tournament-result-standings-rank-header">#</th><th data-cy="archive-tournament-result-standings-player-header">{{ i18n.t('common.player') }}</th><th data-cy="archive-tournament-result-standings-record-header">{{ i18n.t('common.record') }}</th></tr></thead>
                <tbody data-cy="archive-tournament-result-standings-body">
                  @for (row of topStandingRows(); track row.playerName) {
                    <tr data-cy="archive-tournament-result-standings-row"><td class="rank" data-cy="archive-tournament-result-standings-rank">{{ row.rank }}</td><td data-cy="archive-tournament-result-standings-player"><strong data-cy="archive-tournament-result-standings-player-name">{{ playerLabel(row.playerName, row.archetype) }}</strong></td><td data-cy="archive-tournament-result-standings-record">{{ row.record }}</td></tr>
                  } @empty {
                    <tr data-cy="archive-tournament-result-standings-empty-row"><td colspan="3" class="empty" data-cy="archive-tournament-result-standings-empty">{{ i18n.t('result.noValidResults') }}</td></tr>
                  }
                </tbody>
              </table>
            </section>
          } @else {
            <section class="result-panel result-metagame" data-cy="archive-tournament-result-metagame-panel" [attr.aria-label]="i18n.t('result.metagame')">
              @if (metagameBars().length) {
                <div
                  class="metagame-bar-columns"
                  data-cy="archive-tournament-result-metagame-columns"
                  [class.metagame-bar-columns--sparse]="metagameBars().length <= 8"
                  [class.metagame-bar-columns--comfortable]="metagameBars().length > 8 && metagameBars().length <= 18"
                  [class.metagame-bar-columns--dense]="metagameBars().length > 18"
                  role="list"
                  [attr.aria-label]="i18n.t('result.metagameBarsAria')"
                >
                  @for (column of metagameColumns(); track $index) {
                    <div class="metagame-bar-column" data-cy="archive-tournament-result-metagame-column">
                      @for (bar of column; track bar.archetype) {
                        <article class="metagame-bar-row" role="listitem" data-cy="archive-tournament-result-metagame-row" [attr.aria-label]="bar.ariaLabel">
                          <strong data-cy="archive-tournament-result-metagame-archetype">{{ bar.archetype }}</strong>
                          <div class="metagame-bar-track" aria-hidden="true" data-cy="archive-tournament-result-metagame-track">
                            <span data-cy="archive-tournament-result-metagame-fill" [style.width.%]="bar.percentageValue"></span>
                          </div>
                          <span class="metagame-bar-row__percent" data-cy="archive-tournament-result-metagame-percent">{{ bar.percentageLabel }}</span>
                          <span class="metagame-bar-row__count" data-cy="archive-tournament-result-metagame-count">{{ bar.playerCount }}/{{ bar.totalPlayerCount }}</span>
                        </article>
                      }
                    </div>
                  }
                </div>
              } @else {
                <p class="empty" data-cy="archive-tournament-result-metagame-empty">{{ i18n.t('result.noArchetypeData') }}</p>
              }
              <div class="result-player-badge metagame-player-badge" data-cy="archive-tournament-result-metagame-player-badge"><span data-cy="archive-tournament-result-metagame-player-label">{{ i18n.t('common.players') }}</span><strong data-cy="archive-tournament-result-metagame-player-value">{{ report.stats.playerCount }}</strong></div>
            </section>
          }
        </section>
      </section>
    } @else if (!loading()) {
      <mat-card class="panel" data-cy="archive-tournament-result-not-found"><mat-card-title data-cy="archive-tournament-result-not-found-title">{{ i18n.t('result.notFoundTitle') }}</mat-card-title><mat-card-content data-cy="archive-tournament-result-not-found-body"><p data-cy="archive-tournament-result-not-found-text">{{ i18n.t('result.notFoundBody') }}</p></mat-card-content></mat-card>
    }
    @if (!loading() && tournament()) {
      <footer class="back-button-row back-button-row--bottom result-footer" data-cy="archive-tournament-result-footer" [attr.aria-label]="i18n.t('result.navAria')">
        <a mat-stroked-button class="back-button secondary-action" data-cy="archive-tournament-result-back-to-tournament" [routerLink]="['/archive/tournaments', tournamentId()]">{{ i18n.t('nav.backToTournament') }}</a>
        @if (page() === 'standings') {
          <a mat-stroked-button class="back-button secondary-action" data-cy="archive-tournament-result-see-metagames" [routerLink]="['/archive/tournaments', tournamentId(), 'result', 'metagames']">{{ i18n.t('result.seeArchetypeShare') }}</a>
        } @else {
          <a mat-stroked-button class="back-button secondary-action" data-cy="archive-tournament-result-see-standings" [routerLink]="['/archive/tournaments', tournamentId(), 'result']">{{ i18n.t('result.seeStandings') }}</a>
        }
        <span class="result-footer__spacer" data-cy="archive-tournament-result-footer-spacer"></span>
        <button mat-stroked-button class="back-button secondary-action" type="button" data-cy="archive-tournament-result-download-image" [disabled]="downloading()" (click)="downloadResultImage()">{{ i18n.t('result.downloadImage') }}</button>
        <button mat-stroked-button class="back-button secondary-action" type="button" data-cy="archive-tournament-result-download-all" [disabled]="downloading()" (click)="downloadAllResultImages()">{{ i18n.t('result.downloadAll') }}</button>
      </footer>
    }

    <gones-back-button data-cy="archive-tournament-result-back-bottom" [link]="['/archive/tournaments', tournamentId()]" [label]="i18n.t('nav.backToTournament')" position="bottom" />
  `
})
export class TournamentResultComponent {
  readonly i18n = inject(I18nService);
  private readonly source = inject(ARCHIVE_TOURNAMENT_DETAIL_SOURCE);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  @ViewChild('resultSection') private resultSection?: ElementRef<HTMLElement>;

  readonly loading = signal(true);
  readonly error = signal('');
  readonly notFound = signal(false);
  readonly downloading = signal(false);
  readonly tournament = signal<ArchiveTournamentDetail | null>(null);
  readonly seasonName = signal('');
  readonly tournamentId = signal('');
  readonly page = signal<'standings' | 'metagames'>('standings');

  readonly summary: Signal<TournamentSummary | null>;
  readonly pageLabel: Signal<string>;
  readonly topStandingRows: Signal<TournamentSummary['topRows']>;
  readonly metagameBars: Signal<MetagameBar[]>;
  readonly metagameColumns: Signal<MetagameBar[][]>;

  constructor() {
    this.summary = computed(() => {
      const detail = this.tournament();
      return detail ? buildTournamentSummary(detail) : null;
    });
    this.pageLabel = computed(() => this.i18n.t(this.page() === 'metagames' ? 'result.metagame' : 'result.standings'));
    this.topStandingRows = computed(() => this.summary()?.topRows.slice(0, 8) ?? []);
    this.metagameBars = computed(() => buildMetagameBars(this.summary()?.archetypeShares.slice(0, 30) ?? []));
    this.metagameColumns = computed(() => splitMetagameBars(this.metagameBars()));
    void this.load();
  }

  playerLabel(playerName: string, archetype: string): string {
    return formatPlayerWithArchetype(playerName, archetype);
  }

  formatTournamentDate(value: string): string {
    if (!value) return this.i18n.t('common.noDate');
    return this.i18n.formatDate(value, { dateStyle: 'long' });
  }

  async downloadResultImage(): Promise<void> {
    if (!this.resultSection) return;
    this.downloading.set(true);
    try {
      const blob = await captureElementAsPng(this.resultSection.nativeElement);
      downloadBlob(blob, `${this.resultFilenameBase()}-${this.page()}.png`);
    }
    catch (error) { logBoundaryError('archive-tournament-result.downloadImage', error, { tournamentId: this.tournamentId(), page: this.page() }); this.error.set(this.i18n.t('result.downloadImageFailed')); }
    finally { this.downloading.set(false); }
  }

  async downloadAllResultImages(): Promise<void> {
    if (!this.resultSection) return;
    this.downloading.set(true);
    const originalPage = this.page();
    try {
      const files: ZipFile[] = [];
      for (const resultPage of ['standings', 'metagames'] as const) {
        this.page.set(resultPage);
        await nextFrame();
        const blob = await captureElementAsPng(this.resultSection.nativeElement);
        files.push({ name: `${this.resultFilenameBase()}-${resultPage}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      downloadBlob(createZip(files), `${this.resultFilenameBase()}-results.zip`);
    }
    catch (error) { logBoundaryError('archive-tournament-result.downloadAllImages', error, { tournamentId: this.tournamentId() }); this.error.set(this.i18n.t('result.downloadAllFailed')); }
    finally { this.page.set(originalPage); this.downloading.set(false); }
  }

  /** A standalone Tournament contributes no Season name, and no invented one either. */
  private resultFilenameBase(): string {
    return sanitizeFilename(`${this.seasonName() || 'archive'}-${this.summary()?.tournamentName || 'tournament'}`);
  }

  /** Never throws: a failed read is a rendered message, never an error thrown into the router. */
  async load(): Promise<void> {
    const tournamentId = this.route.snapshot.paramMap.get('tournamentId') ?? '';
    this.tournamentId.set(tournamentId);
    this.page.set(this.router.url.endsWith('/metagames') ? 'metagames' : 'standings');
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
    }
    catch (error) { logBoundaryError('archive-tournament-result.load', error, { tournamentId }); this.error.set(this.i18n.t('result.loadFailed')); }
    finally { this.loading.set(false); }
  }

}

interface MetagameBar {
  archetype: string;
  playerCount: number;
  totalPlayerCount: number;
  percentageValue: number;
  percentageLabel: string;
  ariaLabel: string;
}

function buildMetagameBars(shares: ArchetypeShare[]): MetagameBar[] {
  return shares.map((share) => {
    const percentageValue = Math.round(share.percentage * 1000) / 10;
    const percentageLabel = `${percentageValue.toFixed(percentageValue % 1 === 0 ? 0 : 1)}%`;
    return {
      archetype: share.archetype,
      playerCount: share.playerCount,
      totalPlayerCount: share.totalPlayerCount,
      percentageValue,
      percentageLabel,
      ariaLabel: `${share.archetype}: ${percentageLabel}, ${share.playerCount} of ${share.totalPlayerCount} players`
    };
  });
}

function splitMetagameBars(bars: MetagameBar[]): MetagameBar[][] {
  const midpoint = Math.ceil(bars.length / 2);
  return [bars.slice(0, midpoint), bars.slice(midpoint)];
}

async function captureElementAsPng(element: HTMLElement): Promise<Blob> {
  await document.fonts.ready;
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  const clone = element.cloneNode(true) as HTMLElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.margin = '0';
  clone.style.fontFamily = getComputedStyle(element).fontFamily;
  clone.classList.add('result-page--capture');

  const style = document.createElement('style');
  style.textContent = collectDocumentCss();
  clone.prepend(style);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.decoding = 'sync';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not render result image.'));
    });
    image.src = svgUrl;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode PNG.')), 'image/png'));
  }
  finally { URL.revokeObjectURL(svgUrl); }
}

function collectDocumentCss(): string {
  return Array.from(document.styleSheets).map((sheet) => {
    try { return Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n'); }
    catch { return ''; }
  }).join('\n');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilename(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'result';
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

interface ZipFile {
  name: string;
  data: Uint8Array;
}

function createZip(files: ZipFile[]): Blob {
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const localHeader = zipLocalHeader(name, crc, file.data.length);
    chunks.push(localHeader, file.data);
    centralDirectory.push(zipCentralHeader(name, crc, file.data.length, offset));
    offset += localHeader.length + file.data.length;
  }
  const centralDirectorySize = centralDirectory.reduce((sum, item) => sum + item.length, 0);
  chunks.push(...centralDirectory, zipEndRecord(files.length, centralDirectorySize, offset));
  return new Blob(chunks.map(copyUint8ArrayBuffer), { type: 'application/zip' });
}

function copyUint8ArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function zipLocalHeader(name: Uint8Array, crc: number, size: number): Uint8Array {
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  header.set(name, 30);
  return header;
}

function zipCentralHeader(name: Uint8Array, crc: number, size: number, offset: number): Uint8Array {
  const header = new Uint8Array(46 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.length, true);
  view.setUint32(42, offset, true);
  header.set(name, 46);
  return header;
}

function zipEndRecord(fileCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Uint8Array {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  return header;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
