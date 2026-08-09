import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as account-settings.component.test.ts: no TestBed / zone.js in this repo, so
// `effect()` is stubbed to a no-op and the component is built with a bare Injector. These tests
// assert on component state and spy calls, not on rendered DOM.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { PublicCalendarComponent } from './public-calendar.component';
import { AllTournamentsCacheService, AllTournamentsResult } from './all-tournaments-cache.service';
import { PublicTournamentService } from './public-tournament.service';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { AuthService } from '../../auth/auth.service';
import { PublicTournamentView } from './public-calendar';
import { UserProfileResponse } from '../../api/generated/gones-api';

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

function setup(options: { params?: Record<string, string>; result?: Partial<AllTournamentsResult>; profile?: UserProfileResponse | null; authEnabled?: boolean } = {}) {
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
  const initialParams = paramMap({ month: '2026-08', view: 'calendar', ...options.params });

  // The router stub feeds the query params it is handed straight back into `queryParamMap`, the way
  // a real navigation does. A `of(initialParams)` stub emits once and completes, so the `ngOnInit`
  // subscription can never re-fire and *every* claim about what happens after a navigation — month
  // navigation not refetching, above all — holds for any implementation whatsoever. With the loop
  // closed the subscription runs again on each navigate, so those claims constrain something.
  const params$ = new BehaviorSubject<ParamMap>(initialParams);
  const navigate = vi.fn(async (_commands: unknown[], extras?: { queryParams?: Record<string, string> }) => {
    params$.next(paramMap(extras?.queryParams ?? {}));
    return true;
  });
  const router = { navigate } as unknown as Router;
  const route = {
    snapshot: { queryParamMap: initialParams },
    queryParamMap: params$.asObservable()
  } as unknown as ActivatedRoute;

  const auth = { enabled: options.authEnabled ?? true, profile: signal<UserProfileResponse | null>(options.profile ?? null) } as unknown as AuthService;

  const injector = Injector.create({ providers: [
    { provide: AllTournamentsCacheService, useValue: catalog },
    { provide: PublicTournamentService, useValue: { icsUrl: vi.fn(() => 'https://api.example/x.ics') } },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: router },
    { provide: AuthService, useValue: auth },
    DeckArchetypeSettingsService,
    I18nService
  ] });

  const component = runInInjectionContext(injector, () => new PublicCalendarComponent());
  return { component, load, navigate };
}

const verifiedUserProfile = {
  id: '44444444-4444-4444-4444-444444444444',
  email: 'plain-user@example.test',
  emailVerified: true,
  globalRole: 'User',
  username: 'plain-user',
  firstName: 'Plain',
  lastName: 'User',
  preferredLanguage: 'en',
  isFirstNamePublic: false,
  isLastNamePublic: false,
  isLocationPublic: false,
  isBirthDatePublic: false,
  isPreferredLanguagePublic: false
} as unknown as UserProfileResponse;

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

  // The claim is *debounced*, not *silent*: the visible list narrows on the keystroke while the URL
  // write waits out SEARCH_DEBOUNCE_MS. Checking `navigate` synchronously proves only that the write
  // is not synchronous, which is true for a debounce of 0 ms — a value that churns the URL on every
  // keystroke. The window is spelled out here rather than imported from the component, so that
  // shortening the debounce fails the test instead of moving the goalposts with it.
  const SEARCH_DEBOUNCE_MS = 300;

  it('filters on the keystroke but debounces the URL write by 300 ms', async () => {
    vi.useFakeTimers();
    try {
      const { component, navigate } = setup();
      component.ngOnInit();
      await Promise.resolve();
      await Promise.resolve();
      navigate.mockClear();

      component.setSearchDraft('lyon');

      // The list is filtered immediately — no wait, no request.
      expect(component.items()).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();

      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      expect(navigate).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate.mock.calls[0][1]?.queryParams).toMatchObject({ q: 'lyon' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces a burst of keystrokes into a single URL write', async () => {
    vi.useFakeTimers();
    try {
      const { component, navigate } = setup();
      component.ngOnInit();
      await Promise.resolve();
      await Promise.resolve();
      navigate.mockClear();

      for (const draft of ['l', 'ly', 'lyo', 'lyon']) {
        component.setSearchDraft(draft);
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      }
      expect(navigate).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate.mock.calls[0][1]?.queryParams).toMatchObject({ q: 'lyon' });
    } finally {
      vi.useRealTimers();
    }
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

  // ADR 0023 / acceptance row `doc05-full-catalog-cache`: the catalog is fetched once and month
  // navigation re-slices it in the browser. The navigation has to actually round-trip through the
  // `ngOnInit` subscription for that to mean anything, which is what the router stub now arranges.
  it('month navigation re-slices the cached catalog without refetching', async () => {
    const { component, load, navigate } = setup();
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    load.mockClear();

    component.moveMonth(1);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(component.query().month).toBe('2026-09');
    expect(component.allItems()).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();

    component.moveMonth(-1);

    expect(component.query().month).toBe('2026-08');
    expect(load).not.toHaveBeenCalled();
  });

  it('hides the create button when anonymous', () => {
    const { component } = setup({ profile: null });
    expect(component.canCreateTournament()).toBe(false);
  });

  it('hides the create button when unverified', () => {
    const { component } = setup({ profile: { ...verifiedUserProfile, emailVerified: false } });
    expect(component.canCreateTournament()).toBe(false);
  });

  it('shows the create button when signed in with a verified email', () => {
    const { component } = setup({ profile: verifiedUserProfile });
    expect(component.canCreateTournament()).toBe(true);
  });
});
