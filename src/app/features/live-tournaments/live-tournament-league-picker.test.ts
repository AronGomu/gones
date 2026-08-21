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
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { LOCAL_PLACEHOLDER_LEAGUE_ID } from '../../data/league-archive-origin';
import { LiveTournamentRepository } from '../../data/live-tournament-repository.service';
import { PersistedLeague, PLACEHOLDER_LEAGUE_ID } from '../../domain/models';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { OnlineStatusService } from '../../shared/online-status.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { LiveTournamentRunnerComponent } from './live-tournament-runner.component';

const SERVER_ID = '7f3a1d2c-0b44-4f9e-9a1e-2c8f0d6b5a11';
const LOCAL_ID = 'local-4d6f1f0e-2a11-4a1a-8f0c-8a7a2f6d9e33';

function league(id: string, name: string): PersistedLeague {
  return { id, name, status: 'active', tournaments: [], documentVersion: 1, updatedAt: '2026-08-09T10:00:00.000Z' };
}

function paramMap(values: Record<string, string>): ParamMap {
  return {
    keys: Object.keys(values),
    has: (name) => Object.prototype.hasOwnProperty.call(values, name),
    get: (name) => values[name] ?? null,
    getAll: (name) => values[name] ? [values[name]] : []
  };
}

async function setup(leagues: PersistedLeague[]) {
  const leagueRepo = { listLeagues: vi.fn(async () => leagues) } as unknown as LeagueArchiveRepository;
  const liveRepo = { get: vi.fn(async () => null) } as unknown as LiveTournamentRepository;
  const route = { snapshot: { paramMap: paramMap({ liveTournamentId: 'live-1' }) } } as unknown as ActivatedRoute;
  const router = { navigate: vi.fn(async () => true), getCurrentNavigation: () => null } as unknown as Router;
  const auth = { enabled: true, profile: signal(null) } as unknown as AuthService;
  const injector = Injector.create({ providers: [
    { provide: AuthService, useValue: auth },
    { provide: OnlineStatusService, useValue: { online: signal(true) } },
    { provide: LIVE_BACKEND_MODE, useValue: 'server' },
    { provide: ServerReadCacheService, useValue: { invalidate: vi.fn(async () => undefined) } },
    { provide: PowerUserSettingsService, useValue: { enabled: signal(true), setEnabled: vi.fn(), requireEnabled: vi.fn() } },
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new LiveTournamentRunnerComponent(liveRepo, leagueRepo, route, router, new MatDialogStub() as unknown as MatDialog));
  await component.load();
  return component;
}

class MatDialogStub {
  open = vi.fn();
}

describe('the Live settings League picker', () => {
  /**
   * ADR 0028: `listLeagues()` is the union of both stores, but Live settings are a server document
   * and `RequireLeagueReferenceAsync` only resolves server leagues. Offering a `local-` league here
   * produced a `PATCH` the backend rejects with "League was not found." — a cross-authority
   * assignment offered as a normal menu option.
   */
  it('the live league picker excludes browser-local leagues', async () => {
    const component = await setup([
      league(PLACEHOLDER_LEAGUE_ID, 'Unassigned Tournaments'),
      league(LOCAL_PLACEHOLDER_LEAGUE_ID, 'Unassigned Tournaments'),
      league(SERVER_ID, 'Summer'),
      league(LOCAL_ID, 'Browser League')
    ]);

    expect(component.assignableLeagues().map((item) => item.id)).toEqual([SERVER_ID]);
  });

  it('the picker keeps every server league', async () => {
    const other = '9c1b4e77-1c2a-4b1c-9d3e-5f6a7b8c9d01';
    const component = await setup([league(SERVER_ID, 'Summer'), league(other, 'Winter')]);

    expect(component.assignableLeagues().map((item) => item.id)).toEqual([SERVER_ID, other]);
  });
});
