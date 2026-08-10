import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * ADR 0028 — the full data export is fed the *merged* league list, so a bundle carries the
 * browser-local leagues next to the server ones. Same rationale as
 * `public-calendar.component.test.ts`: no TestBed in this repo, so the component is built with a
 * bare `Injector` and hand-written fakes, and `saveJsonFile` is mocked to capture the artifact.
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
import { LeagueArchiveRepository } from './data/league-archive-repository.service';
import { LOCAL_PLACEHOLDER_LEAGUE_ID } from './data/league-archive-origin';
import { LiveTournamentRepository } from './data/live-tournament-repository.service';
import { verifyExportChecksum } from './domain/export-schemas';
import { createTournament, PersistedLeague, PLACEHOLDER_LEAGUE_ID, TournamentDocument } from './domain/models';
import { I18nService } from './i18n/i18n.service';
import { DeckArchetypeSettingsService } from './shared/deck-archetype-settings.service';

const SERVER_ID = '7f3a1d2c-0b44-4f9e-9a1e-2c8f0d6b5a11';
const LOCAL_ID = 'local-4d6f1f0e-2a11-4a1a-8f0c-8a7a2f6d9e33';

function league(id: string, name = `League ${id}`, tournaments: TournamentDocument[] = []): PersistedLeague {
  return { id, name, status: 'active', tournaments, documentVersion: 3, updatedAt: '2026-08-09T10:00:00.000Z' };
}

function setup(leagues: PersistedLeague[], { serverUnavailable = false, signedIn = false }: { serverUnavailable?: boolean; signedIn?: boolean } = {}) {
  saveJsonFileMock.mockClear();
  const listLeagues = vi.fn(async () => leagues);
  const repo = { listLeagues, getLeague: vi.fn(async () => null), serverUnavailable: signal(serverUnavailable) } as unknown as LeagueArchiveRepository;
  const router = { url: '/leagues-archive', events: new Subject<unknown>(), navigate: vi.fn(async () => true) } as unknown as Router;
  const auth = { enabled: true, profile: signal(signedIn ? { id: 'organizer', globalRole: 'Organizer' } : null) } as unknown as AuthService;
  const injector = Injector.create({ providers: [
    { provide: LeagueArchiveRepository, useValue: repo },
    { provide: LiveTournamentRepository, useValue: { get: vi.fn(async () => null) } },
    { provide: Router, useValue: router },
    { provide: AuthService, useValue: auth },
    { provide: MatDialog, useValue: { open: vi.fn() } },
    LastVisitedUrlService,
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new AppComponent());
  return { component, listLeagues };
}

/** The single argument `saveJsonFile` was handed, as the file's JSON round trip would see it. */
function savedBundle(): { leagues: { id: string }[]; checksum: string } {
  expect(saveJsonFileMock).toHaveBeenCalledTimes(1);
  return saveJsonFileMock.mock.calls[0][0];
}

function savedFilename(): string {
  return saveJsonFileMock.mock.calls[0][1];
}

describe('AppComponent full data export', () => {
  it('the full export carries leagues from both stores', async () => {
    const { component } = setup([league(SERVER_ID), league(LOCAL_ID)]);

    await component.downloadFullExport();

    const bundle = savedBundle();
    expect(bundle.leagues).toHaveLength(2);
    expect(bundle.leagues.map((item) => item.id)).toEqual([SERVER_ID, LOCAL_ID]);
  });

  it('the full export drops the server placeholder', async () => {
    const { component } = setup([league(PLACEHOLDER_LEAGUE_ID), league(SERVER_ID)]);

    await component.downloadFullExport();

    expect(savedBundle().leagues.map((item) => item.id)).toEqual([SERVER_ID]);
  });

  it('the full export drops the local placeholder', async () => {
    const { component } = setup([league(LOCAL_PLACEHOLDER_LEAGUE_ID), league(LOCAL_ID)]);

    await component.downloadFullExport();

    expect(savedBundle().leagues.map((item) => item.id)).toEqual([LOCAL_ID]);
  });

  it('a placeholder holding tournaments is still dropped', async () => {
    const orphan = createTournament({ leagueId: LOCAL_PLACEHOLDER_LEAGUE_ID, name: 'Orphan' });
    const { component } = setup([league(LOCAL_PLACEHOLDER_LEAGUE_ID, 'Unassigned Tournaments', [orphan]), league(LOCAL_ID)]);

    await component.downloadFullExport();

    expect(savedBundle().leagues.map((item) => item.id)).toEqual([LOCAL_ID]);
  });

  it('the full export keeps its filename and checksum', async () => {
    const { component } = setup([league(SERVER_ID), league(LOCAL_ID)]);

    await component.downloadFullExport();

    expect(savedFilename()).toBe('gones-full-data.gones.json');
    await expect(verifyExportChecksum(savedBundle())).resolves.toBe(true);
  });

  /**
   * `listLeagues()` degrades to the local list alone when the server read rejects (offline, expired
   * token, 500) and raises `serverUnavailable`. Writing the file anyway would hand the user a
   * `gones-full-data.gones.json` that silently omits every server league — and export is ADR 0028's
   * only bridge against "clearing site data destroys local leagues".
   */
  it('a full export refuses to write when the server list failed', async () => {
    const { component } = setup([league(LOCAL_ID)], { serverUnavailable: true, signedIn: true });

    await component.downloadFullExport();

    expect(saveJsonFileMock).not.toHaveBeenCalled();
    expect(component.importError()).toBe(component.i18n.t('msg.fullDataExportServerUnavailable'));
  });

  /**
   * The other half of that guard, and the reason it is not a blanket refusal: a signed-out visitor
   * has no server leagues, so their local list *is* the whole archive and the bundle is complete.
   * Refusing here would take away ADR 0028's only backup from exactly the people who own
   * browser-local leagues.
   */
  it('a signed-out visitor can still export while the server is unreachable', async () => {
    const { component } = setup([league(LOCAL_ID)], { serverUnavailable: true });

    await component.downloadFullExport();

    expect(savedBundle().leagues.map((item) => item.id)).toEqual([LOCAL_ID]);
    expect(component.importError()).toBe('');
  });

  it('a full export still writes when the server list succeeded', async () => {
    const { component } = setup([league(SERVER_ID), league(LOCAL_PLACEHOLDER_LEAGUE_ID), league(LOCAL_ID)]);

    await component.downloadFullExport();

    expect(savedBundle().leagues.map((item) => item.id)).toEqual([SERVER_ID, LOCAL_ID]);
    expect(component.importError()).toBe('');
  });

  it('a local league exports on its own', async () => {
    const local = league(LOCAL_ID, 'Browser League');
    const { component } = setup([local]);

    await component.downloadLeagueExport(local);

    const bundle = saveJsonFileMock.mock.calls[0][0] as { kind: string; league: { id: string }; exportedAt: string };
    expect(bundle.kind).toBe('league');
    expect(bundle.league.id).toBe(LOCAL_ID);
    expect(savedFilename()).toBe(`${bundle.exportedAt.slice(0, 10)} Browser League.json`);
    await expect(verifyExportChecksum(bundle)).resolves.toBe(true);
  });
});

describe('AppComponent header import affordance', () => {
  // No TestBed / zone.js in this repo — assert on the template source, like
  // `app.component.auth-entry.test.ts` does.
  const source = readFileSync(join(__dirname, 'app.component.ts'), 'utf8');

  it('the import button is always offered', () => {
    const start = source.indexOf('data-cy="app-leagues-header-actions"');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf('data-cy="app-full-data-export-button"'));
    expect(block).toContain('data-cy="app-leagues-import-button"');
    expect(block).toContain('data-cy="header-import-input"');
    expect(block).not.toMatch(/@if \(/);
    expect(source).not.toContain('canManageLeagueData');
  });
});
