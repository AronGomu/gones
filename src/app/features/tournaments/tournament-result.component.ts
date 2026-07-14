import { Component, ElementRef, ViewChild, computed, signal, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { LeagueRepository } from '../../data/league-repository.service';
import { formatPlayerWithArchetype, PersistedLeague, TournamentDocument } from '../../domain/models';
import { ArchetypeShare, buildTournamentSummary, TournamentSummary } from '../../domain/tournament-summary';
import { logBoundaryError } from '../../shared/app-logger';
import { I18nService } from '../../i18n/i18n.service';

@Component({
  standalone: true,
  imports: [MatButtonModule, MatCardModule, RouterLink],
  template: `
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (summary(); as report) {
      <section #resultSection class="tournament-result-page" [class.result-page--metagame]="page() === 'metagames'" data-cy="tournament-result-page">
        <section class="result-hero">
          <div class="result-title-block">
            <h1><span>{{ league()?.name || i18n.t('result.unknownLeague') }}</span><span>&nbsp;</span><span>{{ report.tournamentName }}</span><span class="result-page-separator" aria-hidden="true"> — </span><span class="result-page-label">{{ pageLabel() }}</span></h1>
            <p class="result-subtitle">{{ formatTournamentDate(report.tournamentDate) }}</p>
          </div>
          @if (page() === 'standings') {
            <div class="result-counts" [attr.aria-label]="i18n.t('result.statsAria')">
              <div class="result-player-badge"><span>{{ i18n.t('common.players') }}</span><strong>{{ report.stats.playerCount }}</strong></div>
              <div class="result-player-badge"><span>{{ i18n.t('common.rounds') }}</span><strong>{{ report.stats.roundCount }}</strong></div>
              <div class="result-player-badge"><span>{{ i18n.t('common.matches') }}</span><strong>{{ report.stats.matchCount }}</strong></div>
            </div>
          }
        </section>

        <section class="result-page-body">
          @if (page() === 'standings') {
            <section class="result-panel result-standings" [attr.aria-label]="i18n.t('result.standings')">
              <table>
                <thead><tr><th>#</th><th>{{ i18n.t('common.player') }}</th><th>{{ i18n.t('common.record') }}</th></tr></thead>
                <tbody>
                  @for (row of topStandingRows(); track row.playerName) {
                    <tr><td class="rank">{{ row.rank }}</td><td><strong>{{ playerLabel(row.playerName, row.archetype) }}</strong></td><td>{{ row.record }}</td></tr>
                  } @empty {
                    <tr><td colspan="3" class="empty">{{ i18n.t('result.noValidResults') }}</td></tr>
                  }
                </tbody>
              </table>
            </section>
          } @else {
            <section class="result-panel result-metagame" [attr.aria-label]="i18n.t('result.metagame')">
              @if (metagameBars().length) {
                <div
                  class="metagame-bar-columns"
                  [class.metagame-bar-columns--sparse]="metagameBars().length <= 8"
                  [class.metagame-bar-columns--comfortable]="metagameBars().length > 8 && metagameBars().length <= 18"
                  [class.metagame-bar-columns--dense]="metagameBars().length > 18"
                  role="list"
                  [attr.aria-label]="i18n.t('result.metagameBarsAria')"
                >
                  @for (column of metagameColumns(); track $index) {
                    <div class="metagame-bar-column">
                      @for (bar of column; track bar.archetype) {
                        <article class="metagame-bar-row" role="listitem" [attr.aria-label]="bar.ariaLabel">
                          <strong>{{ bar.archetype }}</strong>
                          <div class="metagame-bar-track" aria-hidden="true">
                            <span [style.width.%]="bar.percentageValue"></span>
                          </div>
                          <span class="metagame-bar-row__percent">{{ bar.percentageLabel }}</span>
                          <span class="metagame-bar-row__count">{{ bar.playerCount }}/{{ bar.totalPlayerCount }}</span>
                        </article>
                      }
                    </div>
                  }
                </div>
              } @else {
                <p class="empty">{{ i18n.t('result.noArchetypeData') }}</p>
              }
              <div class="result-player-badge metagame-player-badge"><span>{{ i18n.t('common.players') }}</span><strong>{{ report.stats.playerCount }}</strong></div>
            </section>
          }
        </section>
      </section>
    } @else if (!loading()) {
      <mat-card class="panel"><mat-card-title>{{ i18n.t('result.notFoundTitle') }}</mat-card-title><mat-card-content><p>{{ i18n.t('result.notFoundBody') }}</p></mat-card-content></mat-card>
    }
    @if (!loading() && leagueId()) {
      <footer class="back-button-row back-button-row--bottom result-footer" [attr.aria-label]="i18n.t('result.navAria')">
        <a mat-stroked-button class="back-button secondary-action" [routerLink]="['/leagues', leagueId(), 'tournaments', tournamentId()]">{{ i18n.t('nav.backToTournament') }}</a>
        @if (page() === 'standings') {
          <a mat-stroked-button class="back-button secondary-action" [routerLink]="['/leagues', leagueId(), 'tournaments', tournamentId(), 'result', 'metagames']">{{ i18n.t('result.seeArchetypeShare') }}</a>
        } @else {
          <a mat-stroked-button class="back-button secondary-action" [routerLink]="['/leagues', leagueId(), 'tournaments', tournamentId(), 'result']">{{ i18n.t('result.seeStandings') }}</a>
        }
        <span class="result-footer__spacer"></span>
        <button mat-stroked-button class="back-button secondary-action" type="button" [disabled]="downloading()" (click)="downloadResultImage()">{{ i18n.t('result.downloadImage') }}</button>
        <button mat-stroked-button class="back-button secondary-action" type="button" [disabled]="downloading()" (click)="downloadAllResultImages()">{{ i18n.t('result.downloadAll') }}</button>
      </footer>
    }
  `
})
export class TournamentResultComponent {
  readonly i18n = inject(I18nService);
  @ViewChild('resultSection') private resultSection?: ElementRef<HTMLElement>;

  readonly loading = signal(true);
  readonly error = signal('');
  readonly downloading = signal(false);
  readonly league = signal<PersistedLeague | null>(null);
  readonly leagueId = signal('');
  readonly tournamentId = signal('');
  readonly tournament = computed(() => this.league()?.tournaments.find((item) => item.id === this.tournamentId()) ?? null);
  readonly summary = computed<TournamentSummary | null>(() => this.tournament() ? buildTournamentSummary(this.tournament() as TournamentDocument) : null);
  readonly page = signal<'standings' | 'metagames'>('standings');
  readonly pageLabel = computed(() => this.page() === 'metagames' ? this.i18n.t('result.metagame') : this.i18n.t('result.standings'));
  readonly topStandingRows = computed(() => this.summary()?.topRows.slice(0, 8) ?? []);
  readonly metagameBars = computed(() => buildMetagameBars(this.summary()?.archetypeShares.slice(0, 30) ?? []));
  readonly metagameColumns = computed(() => splitMetagameBars(this.metagameBars()));

  constructor(private readonly repo: LeagueRepository, private readonly route: ActivatedRoute, private readonly router: Router) { void this.load(); }

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
    catch (error) { logBoundaryError('tournament-result.downloadImage', error, { leagueId: this.leagueId(), tournamentId: this.tournamentId(), page: this.page() }); this.error.set(this.i18n.t('result.downloadImageFailed')); }
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
    catch (error) { logBoundaryError('tournament-result.downloadAllImages', error, { leagueId: this.leagueId(), tournamentId: this.tournamentId() }); this.error.set(this.i18n.t('result.downloadAllFailed')); }
    finally { this.page.set(originalPage); this.downloading.set(false); }
  }

  private resultFilenameBase(): string {
    return sanitizeFilename(`${this.league()?.name || 'league'}-${this.summary()?.tournamentName || 'tournament'}`);
  }

  async load(): Promise<void> {
    const leagueId = this.route.snapshot.paramMap.get('leagueId') ?? '';
    const tournamentId = this.route.snapshot.paramMap.get('tournamentId') ?? '';
    this.leagueId.set(leagueId);
    this.tournamentId.set(tournamentId);
    this.page.set(this.router.url.endsWith('/metagames') ? 'metagames' : 'standings');
    try { this.league.set(await this.repo.getLeague(leagueId)); }
    catch (error) { logBoundaryError('tournament-result.load', error, { leagueId, tournamentId }); this.error.set(this.i18n.t('result.loadFailed')); }
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
