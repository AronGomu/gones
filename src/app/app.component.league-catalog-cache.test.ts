import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as `app.component.export.test.ts`: no zone.js and no change-detection scheduler
// outside TestBed, so `effect()` is stubbed to a no-op and the shell is built with a bare `Injector`.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { AppComponent } from './app.component';
import { AuthService } from './auth/auth.service';
import { LastVisitedUrlService } from './auth/last-visited-url.service';
import { LeagueArchiveRepository } from './data/league-archive-repository.service';
import { LiveTournamentRepository } from './data/live-tournament-repository.service';
import { createTournament, PersistedLeague } from './domain/models';
import { LEAGUE_CATALOG_CACHE_KEY } from './features/leagues-archive/league-archive-catalog-cache.service';
import { I18nService } from './i18n/i18n.service';
import { DeckArchetypeSettingsService } from './shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from './shared/power-user-settings.service';

const SERVER_ID = '7f3a1d2c-0b44-4f9e-9a1e-2c8f0d6b5a11';

function league(): PersistedLeague {
  return {
    id: SERVER_ID,
    name: 'League',
    status: 'active',
    tournaments: [createTournament({ id: 't1', leagueId: SERVER_ID, name: 'Cup', tournamentDate: '2026-08-13' })],
    documentVersion: 3,
    updatedAt: '2026-08-09T10:00:00.000Z'
  };
}

function seedCatalog(): void {
  localStorage.setItem(LEAGUE_CATALOG_CACHE_KEY, JSON.stringify({ items: [], fetchedAt: new Date().toISOString(), truncated: false }));
}

function setup() {
  const repo = {
    listLeagues: vi.fn(async () => []),
    getLeague: vi.fn(async () => null),
    deleteLeague: vi.fn(async () => undefined),
    deleteResultTournament: vi.fn(async () => undefined),
    serverUnavailable: signal(false)
  } as unknown as LeagueArchiveRepository;
  const router = { url: '/leagues-archive', events: new Subject<unknown>(), navigate: vi.fn(async () => true) } as unknown as Router;
  const auth = { enabled: true, profile: signal({ id: 'admin', globalRole: 'Admin' }) } as unknown as AuthService;
  const injector = Injector.create({ providers: [
    { provide: LeagueArchiveRepository, useValue: repo },
    { provide: LiveTournamentRepository, useValue: { get: vi.fn(async () => null) } },
    { provide: Router, useValue: router },
    { provide: AuthService, useValue: auth },
    { provide: MatDialog, useValue: { open: vi.fn(() => ({ afterClosed: () => of(true) })) } },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(true), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
    LastVisitedUrlService,
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new AppComponent());
  return { component, repo };
}

/**
 * ADR 0039: every successful mutation invalidates its own cache entry. `/leagues-archive` serves a
 * 24h `localStorage` snapshot of the server catalog, and nothing used to drop it — so a League
 * created, renamed or deleted stayed wrong there for a day. The shell is the single place every
 * League/Tournament mutation reaches: the `gones-league-updated` announcement for the ones that stay
 * on a League page, and its own two deletions, which navigate away instead.
 */
describe('app shell drops the League catalog snapshot on mutation', () => {
  it('drops it when a League page announces a mutation', () => {
    setup();
    seedCatalog();

    window.dispatchEvent(new CustomEvent('gones-league-updated', { detail: { leagueId: SERVER_ID } }));

    expect(localStorage.getItem(LEAGUE_CATALOG_CACHE_KEY)).toBeNull();
  });

  it('drops it after the header deletes a League', async () => {
    const { component } = setup();
    seedCatalog();

    await component.deleteLeague(league());

    expect(localStorage.getItem(LEAGUE_CATALOG_CACHE_KEY)).toBeNull();
  });

  it('drops it after the header deletes an Archive Tournament', async () => {
    const { component } = setup();
    const source = league();
    seedCatalog();

    await component.deleteTournament({ league: source, tournament: source.tournaments[0] });

    expect(localStorage.getItem(LEAGUE_CATALOG_CACHE_KEY)).toBeNull();
  });

  it('keeps it when the delete failed', async () => {
    const { component, repo } = setup();
    vi.mocked(repo.deleteLeague).mockRejectedValue(new Error('boom'));
    seedCatalog();

    await component.deleteLeague(league());

    expect(localStorage.getItem(LEAGUE_CATALOG_CACHE_KEY)).not.toBeNull();
  });
});
