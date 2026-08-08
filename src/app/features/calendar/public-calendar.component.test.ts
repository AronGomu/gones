import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as account-settings.component.test.ts: no TestBed / zone.js in this repo, so
// `effect()` is stubbed to a no-op and the component is built with a bare Injector. These tests
// assert on component state and spy calls, not on rendered DOM.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { PublicCalendarComponent } from './public-calendar.component';
import { AllTournamentsCacheService, AllTournamentsResult } from './all-tournaments-cache.service';
import { PublicTournamentService } from './public-tournament.service';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { PublicTournamentView } from './public-calendar';

const tournament: PublicTournamentView = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Lyon Legacy',
  slug: 'lyon-legacy',
  summary: 'Legacy tournament',
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris',
  venueStartDate: '2026-08-01',
  venueStartTime: '23:30:00',
  venueEndDate: '2026-08-02',
  venueEndTime: '01:30:00',
  startsAtUtc: '2026-08-01T21:30:00Z',
  endsAtUtc: '2026-08-01T23:30:00Z',
  capacity: 32,
  status: 'Published',
  organization: { id: '22222222-2222-2222-2222-222222222222', name: 'Gones', description: undefined, website: undefined, contactEmail: undefined },
  formats: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Legacy', slug: 'legacy', sortOrder: 1 }]
};

function paramMap(values: Record<string, string> = {}): ParamMap {
  return {
    keys: Object.keys(values),
    has: name => Object.prototype.hasOwnProperty.call(values, name),
    get: name => values[name] ?? null,
    getAll: name => values[name] ? [values[name]] : []
  };
}

function setup(options: { params?: Record<string, string>; result?: Partial<AllTournamentsResult> } = {}) {
  const result: AllTournamentsResult = {
    items: [tournament],
    fetchedAt: '2026-08-08T10:00:00.000Z',
    fromCache: false,
    stale: false,
    truncated: false,
    ...options.result
  };
  const load = vi.fn(async () => result);
  const catalog = { load } as unknown as AllTournamentsCacheService;
  const navigate = vi.fn(async () => true);
  const router = { navigate } as unknown as Router;
  const initialParams = paramMap({ month: '2026-08', view: 'calendar', ...options.params });
  const route = {
    snapshot: { queryParamMap: initialParams },
    queryParamMap: of(initialParams)
  } as unknown as ActivatedRoute;

  const injector = Injector.create({ providers: [
    { provide: AllTournamentsCacheService, useValue: catalog },
    { provide: PublicTournamentService, useValue: { icsUrl: vi.fn(() => 'https://api.example/x.ics') } },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: router },
    DeckArchetypeSettingsService,
    I18nService
  ] });

  const component = runInInjectionContext(injector, () => new PublicCalendarComponent());
  return { component, load, navigate };
}

describe('PublicCalendarComponent', () => {
  it('renders the grid with zero matches: filtering to nothing keeps the catalog untouched', async () => {
    const { component } = setup();
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.allItems()).toHaveLength(1);
    component.setSearchDraft('zzzzzz');
    expect(component.items()).toHaveLength(0);
  });

  it('filters without navigating: typing never triggers router.navigate', async () => {
    const { component, navigate } = setup();
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    navigate.mockClear();

    component.setSearchDraft('lyon');

    expect(component.items()).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('synchronise forces a refetch', async () => {
    const { component, load } = setup();
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    load.mockClear();

    component.sync();
    await Promise.resolve();

    expect(load).toHaveBeenCalledWith({ force: true });
  });

  it('shows the last sync time', async () => {
    const { component } = setup({ result: { fetchedAt: '2026-08-08T12:34:00.000Z' } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.syncedAt()).toBe('2026-08-08T12:34:00.000Z');
  });

  it('month navigation does not refetch', async () => {
    const { component, load } = setup();
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    load.mockClear();

    component.moveMonth(1);

    expect(load).not.toHaveBeenCalled();
  });
});
