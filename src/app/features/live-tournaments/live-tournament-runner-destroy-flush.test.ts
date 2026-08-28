import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as `public-calendar.component.test.ts`: no TestBed / zone.js in this repo, so the
// component is built with a bare `Injector` and hand-written fakes and `effect()` is a no-op.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { LIVE_BACKEND_MODE } from '../../backend/application-backend';
import { ServerReadCacheService } from '../../backend/server-read-cache.service';
import { ArchiveRepository } from '../../data/archive-repository.service';
import { GlobalStatsCatalogCacheService } from '../players/global-stats-catalog-cache.service';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { createLiveTournament } from '../../domain/live-tournament';
import type { MatchRoundEntry } from '../../domain/models';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { OnlineStatusService } from '../../shared/online-status.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { LiveTournamentRunnerComponent } from './live-tournament-runner.component';

function paramMap(values: Record<string, string>): ParamMap {
  return {
    keys: Object.keys(values),
    has: (name) => Object.prototype.hasOwnProperty.call(values, name),
    get: (name) => values[name] ?? null,
    getAll: (name) => values[name] ? [values[name]] : []
  };
}

const MATCH_ENTRY: MatchRoundEntry = {
  kind: 'match', id: 'entry-1', table: '1', player1Name: 'Alice', player2Name: 'Bob',
  player1Score: 0, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: ''
};

function liveDocument() {
  return createLiveTournament({
    id: 'local-live-1',
    stage: 'round',
    currentRoundNumber: 1,
    roundCount: 1,
    customRoundCount: true,
    players: [
      { id: 'p1', name: 'Alice', paid: true, dropped: false, initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' },
      { id: 'p2', name: 'Bob', paid: true, dropped: false, initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' }
    ],
    rounds: [{ id: 'round-1', roundNumber: 1, validated: false, entries: [{ entry: MATCH_ENTRY, resultEntered: false }] }]
  });
}

async function setup() {
  const live = liveDocument();
  const liveRepo = {
    get: vi.fn(async () => live),
    scoreLiveRoundEntry: vi.fn(async () => ({ ...live, documentVersion: 2 }))
  } as unknown as LiveTournamentRepository;
  const archiveRepo = { listLeagueSeasons: vi.fn(async () => ({ items: [] })) } as unknown as ArchiveRepository;
  const route = { snapshot: { paramMap: paramMap({ liveTournamentId: live.id }) } } as unknown as ActivatedRoute;
  const router = { navigate: vi.fn(async () => true), getCurrentNavigation: () => null } as unknown as Router;
  const injector = Injector.create({ providers: [
    { provide: AuthService, useValue: { enabled: true, profile: signal(null) } as unknown as AuthService },
    { provide: OnlineStatusService, useValue: { online: signal(true), isOnline: () => true } },
    { provide: LIVE_BACKEND_MODE, useValue: 'browser-local' },
    { provide: ServerReadCacheService, useValue: { invalidate: vi.fn(async () => undefined) } },
    { provide: GlobalStatsCatalogCacheService, useValue: { load: vi.fn(async () => ({ items: [], fetchedAt: '', fromCache: false, stale: false, truncated: false })) } },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(true), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new LiveTournamentRunnerComponent(liveRepo, archiveRepo, route, router, new MatDialogStub() as unknown as MatDialog));
  await component.load();
  return { component, liveRepo, live };
}

class MatDialogStub {
  open = vi.fn();
}

describe('destroying the Live runner with a debounced intent pending', () => {
  /**
   * F10: `ngOnDestroy` used to clear the debounce timers and drop both intent maps, so a score
   * typed within 400 ms of navigating away was shown optimistically but never sent to the store.
   */
  it('a score typed just before leaving still reaches the store', async () => {
    const { component, liveRepo, live } = await setup();
    const entry = component.tournament()!.rounds[0].entries[0].entry as MatchRoundEntry;

    component.setMatchScore('round-1', entry, 'player1Score', 2);
    component.ngOnDestroy();

    await vi.waitFor(() => expect(liveRepo.scoreLiveRoundEntry).toHaveBeenCalledTimes(1));
    expect(liveRepo.scoreLiveRoundEntry).toHaveBeenCalledWith(live.id, 'round-1', entry.id, 1, { player1Score: 2, player2Score: 0 });
  });

  it('destroy with nothing pending issues no command', async () => {
    const { component, liveRepo } = await setup();

    component.ngOnDestroy();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(liveRepo.scoreLiveRoundEntry).not.toHaveBeenCalled();
  });
});
