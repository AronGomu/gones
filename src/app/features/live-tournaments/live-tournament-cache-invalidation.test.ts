import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as `live-tournament-league-picker.test.ts`: no TestBed / zone.js in this repo, so
// the component is built with a bare `Injector` and hand-written fakes and `effect()` is a no-op.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { LIVE_BACKEND_MODE, LiveFinalizeResult } from '../../backend/application-backend';
import { ServerReadCacheService } from '../../backend/server-read-cache.service';
import { ArchiveRepository } from '../../data/archive-repository.service';
import { GlobalStatsCatalogCacheService } from '../players/global-stats-catalog-cache.service';
import type { ArchiveLeagueSeasonSummary } from '../../data/archive-summary';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { createLiveTournament, LiveTournamentDocument } from '../../domain/live-tournament';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { OnlineStatusService } from '../../shared/online-status.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { LiveTournamentRunnerComponent } from './live-tournament-runner.component';

const LEAGUE_ID = '7f3a1d2c-0b44-4f9e-9a1e-2c8f0d6b5a11';

function paramMap(values: Record<string, string>): ParamMap {
  return {
    keys: Object.keys(values),
    has: (name) => Object.prototype.hasOwnProperty.call(values, name),
    get: (name) => values[name] ?? null,
    getAll: (name) => values[name] ? [values[name]] : []
  };
}

function finalizeResult(leagueId: string): LiveFinalizeResult {
  return { liveTournamentId: 'live-1', leagueId, finalizedTournamentId: 'archived-1', liveDocumentVersion: 2 };
}

function season(): ArchiveLeagueSeasonSummary {
  return {
    id: LEAGUE_ID, name: 'Season', leagueId: 'league-1', status: 'active', updatedAt: '2026-08-09T10:00:00.000Z',
    documentVersion: 1, tournamentCount: 0, playerCount: 0, firstTournamentDate: null, lastTournamentDate: null
  };
}

async function setup(overrides: Partial<LiveTournamentDocument> = {}) {
  const live = createLiveTournament({ id: 'live-1', leagueId: LEAGUE_ID, paidTrackingEnabled: false, ...overrides });
  const invalidateArchiveCaches = vi.fn(async () => undefined);
  const archiveRepo = { listLeagueSeasons: vi.fn(async () => ({ items: [season()] })), invalidateArchiveCaches } as unknown as ArchiveRepository;
  const liveRepo = {
    get: vi.fn(async () => live),
    delete: vi.fn(async () => undefined),
    finalizeLiveTournament: vi.fn(async () => finalizeResult(LEAGUE_ID))
  } as unknown as LiveTournamentRepository;
  const route = { snapshot: { paramMap: paramMap({ liveTournamentId: 'live-1' }) } } as unknown as ActivatedRoute;
  const navigate = vi.fn(async () => true);
  const router = { navigate, getCurrentNavigation: () => null } as unknown as Router;
  const auth = { enabled: true, profile: signal({ globalRole: 'Admin' }) } as unknown as AuthService;
  const cache = { invalidate: vi.fn(async () => undefined), invalidateFamily: vi.fn(async () => undefined) };
  const dialog = { open: vi.fn(() => ({ afterClosed: () => of(true) })) } as unknown as MatDialog;
  const injector = Injector.create({ providers: [
    { provide: AuthService, useValue: auth },
    { provide: OnlineStatusService, useValue: { isOnline: () => true } },
    { provide: LIVE_BACKEND_MODE, useValue: 'server' },
    { provide: ServerReadCacheService, useValue: cache },
    { provide: GlobalStatsCatalogCacheService, useValue: { load: vi.fn(async () => ({ items: [], fetchedAt: '', fromCache: false, stale: false, truncated: false })) } },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(true), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new LiveTournamentRunnerComponent(liveRepo, archiveRepo, route, router, dialog));
  await component.load();
  return { component, cache, liveRepo, navigate, invalidateArchiveCaches };
}

/**
 * ADR 0039: a page that mutates its own data drops its cache row instead of waiting out the 24h TTL.
 * The Live Tournament list caches `live-tournaments`, but the two commands that remove a tournament
 * from it both live on the runner — so without these calls a finalized or deleted tournament stayed
 * listed at `/live-tournaments` for a day. Removing either `invalidate` fails one of these.
 */
describe('Live Tournament runner cache invalidation', () => {
  it('invalidates the list after finalizing into a Season', async () => {
    const { component, cache } = await setup();

    await component.finalize();

    expect(cache.invalidate).toHaveBeenCalledWith('live-tournaments');
  });

  it('invalidates the list after a local finalize', async () => {
    const { component, cache, liveRepo } = await setup();
    // Browser-local authority produces no Season to write into (ADR 0021).
    vi.mocked(liveRepo.finalizeLiveTournament).mockResolvedValue(finalizeResult(''));

    await component.finalize();

    expect(cache.invalidate).toHaveBeenCalledWith('live-tournaments');
  });

  it('invalidates the list after a delete', async () => {
    const { component, cache } = await setup();

    await component.deleteTournament();

    expect(cache.invalidate).toHaveBeenCalledWith('live-tournaments');
  });

  it('keeps the cache when the command failed', async () => {
    const { component, cache, liveRepo } = await setup();
    vi.mocked(liveRepo.delete).mockRejectedValue(new Error('boom'));

    await component.deleteTournament();

    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  /** The finalize also writes an Archive Tournament, so every public archive catalog is stale too. */
  it('drops the public archive catalogs after finalizing into a Season', async () => {
    const { component, invalidateArchiveCaches } = await setup();

    await component.finalize();

    expect(invalidateArchiveCaches).toHaveBeenCalled();
  });
});
