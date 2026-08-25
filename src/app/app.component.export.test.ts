import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * ADR 0028 — the header's Gones Export is the browser-local store's one bridge out. It carries the
 * browser-local records and nothing else: the three-tier read surface serves slim catalogs and one
 * detail per Tournament (ADR 0039/0042), so there is no whole-document server read to build a server
 * half from, and a bundle that silently omitted every server record would be a backup that lies.
 * A signed-in visitor is refused for exactly that reason.
 *
 * Same rationale as `public-calendar.component.test.ts`: no TestBed in this repo, so the component is
 * built with a bare `Injector` and hand-written fakes, and `saveJsonFile` is mocked to capture the
 * artifact.
 */
const { saveJsonFileMock } = vi.hoisted(() => ({ saveJsonFileMock: vi.fn() }));
vi.mock('./shared/save-json-file', () => ({ saveJsonFile: saveJsonFileMock }));

// Same rationale as `public-calendar.component.test.ts`: no zone.js and no change-detection
// scheduler outside TestBed, so `effect()` is stubbed to a no-op.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AppComponent } from './app.component';
import { AuthService } from './auth/auth.service';
import { LastVisitedUrlService } from './auth/last-visited-url.service';
import { ArchiveRepository } from './data/archive-repository.service';
import { LiveTournamentRepository } from './data/live-tournament-repository.service';
import { buildArchiveBundle } from './domain/archive-export-schemas';
import { createArchiveLeague, createArchiveTournament, createLeagueSeason } from './domain/archive-models';
import { verifyExportChecksum } from './domain/export-schemas';
import { I18nService } from './i18n/i18n.service';
import { DeckArchetypeSettingsService } from './shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from './shared/power-user-settings.service';

const LOCAL_ID = 'local-4d6f1f0e-2a11-4a1a-8f0c-8a7a2f6d9e33';

function localBundle() {
  return buildArchiveBundle({
    leagues: [createArchiveLeague({ id: LOCAL_ID, name: 'Browser League', createdAt: '2026-08-09T10:00:00.000Z' })],
    leagueSeasons: [createLeagueSeason({ id: `${LOCAL_ID}-s`, name: 'Browser Season', leagueId: LOCAL_ID })],
    tournaments: [createArchiveTournament({ id: `${LOCAL_ID}-t`, name: 'Browser Tournament', seasonId: `${LOCAL_ID}-s`, tournamentDate: '2026-08-09' })]
  });
}

function setup({ signedIn = false }: { signedIn?: boolean } = {}) {
  saveJsonFileMock.mockClear();
  const exportBundle = vi.fn(async () => localBundle());
  const repo = { exportBundle, getTournament: vi.fn(async () => null) } as unknown as ArchiveRepository;
  const router = { url: '/archive/league-seasons', events: new Subject<unknown>(), navigate: vi.fn(async () => true) } as unknown as Router;
  const auth = { enabled: true, profile: signal(signedIn ? { id: 'organizer', globalRole: 'Organizer' } : null) } as unknown as AuthService;
  const injector = Injector.create({ providers: [
    { provide: ArchiveRepository, useValue: repo },
    { provide: LiveTournamentRepository, useValue: { get: vi.fn(async () => null) } },
    { provide: Router, useValue: router },
    { provide: AuthService, useValue: auth },
    { provide: MatDialog, useValue: { open: vi.fn() } },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(true), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
    LastVisitedUrlService,
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new AppComponent());
  return { component, exportBundle };
}

/** The single argument `saveJsonFile` was handed, as the file's JSON round trip would see it. */
function savedBundle(): { version: number; leagues: { id: string }[]; leagueSeasons: { id: string }[]; tournaments: { id: string }[]; checksum: string } {
  expect(saveJsonFileMock).toHaveBeenCalledTimes(1);
  return saveJsonFileMock.mock.calls[0][0];
}

function savedFilename(): string {
  return saveJsonFileMock.mock.calls[0][1];
}

describe('AppComponent archive export', () => {
  it('writes the browser-local records as a v5 bundle', async () => {
    const { component, exportBundle } = setup();

    await component.downloadFullExport();

    expect(exportBundle).toHaveBeenCalledTimes(1);
    const bundle = savedBundle();
    expect(bundle.version).toBe(5);
    expect(bundle.leagues.map((item) => item.id)).toEqual([LOCAL_ID]);
    expect(bundle.leagueSeasons.map((item) => item.id)).toEqual([`${LOCAL_ID}-s`]);
    expect(bundle.tournaments.map((item) => item.id)).toEqual([`${LOCAL_ID}-t`]);
  });

  it('keeps its filename and a verifiable checksum', async () => {
    const { component } = setup();

    await component.downloadFullExport();

    expect(savedFilename()).toMatch(/^\d{4}-\d{2}-\d{2} Gones Archive\.json$/);
    expect(savedBundle().checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await verifyExportChecksum(savedBundle())).toBe(true);
  });

  it('refuses to write for a signed-in visitor rather than omit their server records', async () => {
    const { component, exportBundle } = setup({ signedIn: true });

    await component.downloadFullExport();

    expect(saveJsonFileMock).not.toHaveBeenCalled();
    expect(exportBundle).not.toHaveBeenCalled();
    expect(component.importError()).toBeTruthy();
  });

  it('a signed-out visitor exports: the browser store is the whole archive they can see', async () => {
    const { component } = setup();

    await component.downloadFullExport();

    expect(saveJsonFileMock).toHaveBeenCalledTimes(1);
    expect(component.importError()).toBe('');
  });
});

describe('AppComponent header import affordance', () => {
  // No TestBed / zone.js in this repo — assert on the template source, like
  // `app.component.auth-entry.test.ts` does.
  const source = readFileSync(join(__dirname, 'app.component.ts'), 'utf8');

  it('Power-gates import while always offering full export', () => {
    const start = source.indexOf('data-cy="app-leagues-header-actions"');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf('</div>', start));
    expect(block).toMatch(/@if \(power\.enabled\(\)\) \{[\s\S]*data-cy="app-leagues-import-button"[\s\S]*data-cy="header-import-input"[\s\S]*\}[\s\S]*data-cy="app-full-data-export-button"/);
    expect(source).not.toContain('canManageLeagueData');
  });
});
