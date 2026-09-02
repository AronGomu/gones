import '@angular/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Same rationale as account-settings.component.test.ts: no TestBed / zone.js in this repo, so
// `effect()` is stubbed to a no-op and the component is built with a bare Injector. These tests
// assert on component state and spy calls, not on rendered DOM.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { PublicEventListComponent } from './public-event-list.component';
import { EventCatalogCacheService, EventCatalogResult } from './event-catalog-cache.service';
import { PublicEventService } from './public-event.service';
import { EventRegistrationService } from './event-registration.service';
import { ConfirmDialogComponent } from '../../shared/dialogs';
import { RegistrationSuccessDialogComponent } from './registration-success-dialog.component';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { AuthService } from '../../auth/auth.service';
import { GeoService } from '../../shared/geo.service';
import { PublicEventView, shiftMonth } from './public-event-list';
import { Client, MyOrganizationResponse, UserProfileResponse } from '../../api/generated/gones-api';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const event: PublicEventView = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Lyon Legacy',
  displayTitle: 'Legacy — Lyon Legacy',
  slug: 'lyon-legacy',
  summary: 'Legacy event',
  venue: { streetAddress: '1 Rue Test', postalCode: '69001', city: 'Lyon', country: 'France' },
  timeZoneId: 'Europe/Paris',
  venueStartDate: '2026-08-01',
  venueStartTime: '23:30:00',
  venueEndDate: '2026-08-02',
  venueEndTime: '01:30:00',
  startsAtUtc: '2099-08-01T21:30:00Z',
  endsAtUtc: '2099-08-01T23:30:00Z',
  capacity: 32,
  status: 'Published',
  organization: { id: '22222222-2222-2222-2222-222222222222', name: 'Gones', description: undefined, website: undefined, contactEmail: undefined, organizers: [] },
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

const eventB: PublicEventView = {
  ...event,
  id: '55555555-5555-5555-5555-555555555555',
  slug: 'paris-modern',
  title: 'Paris Modern'
};

/**
 * jsdom has no layout: `scrollY` is a getter-only property and `scrollTo` is unimplemented, so both
 * are replaced. `requestAnimationFrame` runs its callback inline to keep the assertions synchronous
 * with the awaited navigation.
 */
const scrollYDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY') as PropertyDescriptor;

function stubScrolling(scrollY: number) {
  const scrollTo = vi.fn();
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });
  vi.stubGlobal('scrollTo', scrollTo);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
  return scrollTo;
}

function makeItems(count: number): PublicEventView[] {
  return Array.from({ length: count }, (_, index) => ({
    ...event,
    id: `item-${String(index).padStart(3, '0')}`,
    slug: `item-${String(index).padStart(3, '0')}`,
    title: `Event ${String(index).padStart(3, '0')}`
  }));
}

function setup(options: {
  params?: Record<string, string>;
  result?: Partial<EventCatalogResult>;
  profile?: UserProfileResponse | null;
  authEnabled?: boolean;
  itemCount?: number;
  capability?: ReturnType<typeof vi.fn>;
  register?: ReturnType<typeof vi.fn>;
  open?: ReturnType<typeof vi.fn>;
  organizations?: MyOrganizationResponse[];
  organizationsError?: boolean;
  organizationsAll?: ReturnType<typeof vi.fn>;
  bareParams?: boolean;
  geoCountries?: Array<{ code: string; name: string }>;
  geoRegions?: Array<{ code: string; name: string }>;
} = {}) {
  const result: EventCatalogResult = {
    items: options.itemCount !== undefined ? makeItems(options.itemCount) : [event],
    fetchedAt: '2026-08-08T10:00:00.000Z',
    fromCache: false,
    stale: false,
    truncated: false,
    ...options.result
  };
  const load = vi.fn(async () => result);
  const catalog = { load } as unknown as EventCatalogCacheService;
  const initialValues = options.bareParams ? (options.params ?? {}) : { month: '2026-08', view: 'calendar', from: '2000-01-01', to: '2100-01-01', ...options.params };
  const initialParams = paramMap(initialValues);

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
  const navigateByUrl = vi.fn(async () => true);
  const router = { navigate, navigateByUrl, url: `/events?${new URLSearchParams(initialValues).toString()}` } as unknown as Router;
  const route = {
    snapshot: { queryParamMap: initialParams },
    queryParamMap: params$.asObservable()
  } as unknown as ActivatedRoute;

  const auth = {
    enabled: options.authEnabled ?? true,
    profile: signal<UserProfileResponse | null>(options.profile ?? null),
    whenSessionReady: vi.fn(async () => undefined)
  } as unknown as AuthService;
  const capability = options.capability ?? vi.fn(async () => ({ canRegister: true, canUnregister: false, reason: 'available', activeParticipantCount: 0, capacity: 32 }));
  const register = options.register ?? vi.fn(async () => ({ status: 'Confirmed' }));
  const open = options.open ?? vi.fn(() => ({ afterClosed: () => of(true) }));

  const organizationsAll = options.organizationsAll ?? vi.fn(() => {
    if (options.organizationsError) throw new Error('membership failed');
    return of(options.organizations ?? []);
  });
  const injector = Injector.create({ providers: [
    { provide: EventCatalogCacheService, useValue: catalog },
    { provide: PublicEventService, useValue: { icsUrl: vi.fn(() => 'https://api.example/x.ics') } },
    { provide: EventRegistrationService, useValue: { capability, register } },
    { provide: MatDialog, useValue: { open } },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: router },
    { provide: AuthService, useValue: auth },
    { provide: Client, useValue: { organizationsAll } },
    { provide: GeoService, useValue: { countries: vi.fn(async () => options.geoCountries ?? []), regions: vi.fn(async () => options.geoRegions ?? []) } },
    DeckArchetypeSettingsService,
    I18nService
  ] });

  const component = runInInjectionContext(injector, () => new PublicEventListComponent());
  return { component, load, navigate, navigateByUrl, capability, register, open, organizationsAll, lastQueryParams: () => navigate.mock.calls[navigate.mock.calls.length - 1]?.[1]?.queryParams };
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

describe('PublicEventListComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'scrollY', scrollYDescriptor);
  });

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

  it('moving month restores the scroll position the reader was at', async () => {
    const { component } = setup();
    const scrollTo = stubScrolling(800);
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    await component.moveMonth(1);

    expect(scrollTo).toHaveBeenCalledWith({ top: 800 });
  });

  // The router schedules its own scroll well after the navigation resolves, so without this opt-out
  // it lands on the top of the page last and the restore above is undone.
  it('moving month opts the navigation out of the router scroll restoration', async () => {
    const { component, navigate } = setup();
    stubScrolling(800);
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    navigate.mockClear();

    await component.moveMonth(1);

    const [, extras] = navigate.mock.calls[0] as [unknown, { scroll?: string }];
    expect(extras.scroll).toBe('manual');
  });

  it('moving month does not scroll when the reader is already at the top', async () => {
    const { component } = setup();
    const scrollTo = stubScrolling(0);
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    await component.moveMonth(-1);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  // Without the pin the document shrinks while the new month renders, and the browser clamps the
  // scroll position that is about to be restored down to the shorter page.
  it('moving month pins the grid height until the scroll position is restored', async () => {
    const { component } = setup();
    stubScrolling(800);
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    (component as unknown as { monthGrid?: { nativeElement: { offsetHeight: number } } }).monthGrid = { nativeElement: { offsetHeight: 640 } };

    const pending = component.moveMonth(1);
    expect(component.gridMinHeight()).toBe(640);

    await pending;
    expect(component.gridMinHeight()).toBeNull();
  });

  // The debounced `q` write is the same query-param navigation as month navigation, so it hits the
  // same `scrollPositionRestoration: 'enabled'` and drops the reader on the top of the page.
  it('committing a search opts the URL write out of the router scroll restoration', async () => {
    vi.useFakeTimers();
    try {
      const { component, navigate } = setup();
      stubScrolling(800);
      component.ngOnInit();
      await Promise.resolve();
      await Promise.resolve();
      navigate.mockClear();

      component.setSearchDraft('lyon');
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

      const [, extras] = navigate.mock.calls[0] as [unknown, { scroll?: string }];
      expect(extras.scroll).toBe('manual');
    } finally {
      vi.useRealTimers();
    }
  });

  // The filter narrows the results on the keystroke, well before the URL write: without the pin the
  // document shrinks under the reader on every character typed, and the browser clamps the scroll
  // position down with it. The pin is taken on the keystroke and released once the search settles.
  // No `requestAnimationFrame` is stubbed here on purpose: a hidden tab never runs the callback, so
  // a release that needed one would strand the page at the pinned height.
  it('holds the page height from the keystroke until the search settles', async () => {
    vi.useFakeTimers();
    try {
      const { component } = setup();
      component.ngOnInit();
      await Promise.resolve();
      await Promise.resolve();
      (component as unknown as { calendarPage?: { nativeElement: { offsetHeight: number } } }).calendarPage = { nativeElement: { offsetHeight: 940 } };

      component.setSearchDraft('lyon');
      expect(component.pageMinHeight()).toBe(940);

      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
      expect(component.pageMinHeight()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the create button when anonymous or a plain User', () => {
    expect(setup({ profile: null }).component.showCreateEvent()).toBe(false);
    expect(setup({ profile: verifiedUserProfile }).component.showCreateEvent()).toBe(false);
  });

  it.each(['Organizer', 'Admin'] as const)('always shows the create button for %s', role => {
    const { component } = setup({ profile: { ...verifiedUserProfile, globalRole: role } });
    expect(component.showCreateEvent()).toBe(true);
  });

  it('disables creation for an unverified organizer, explains verification, and skips the membership lookup', async () => {
    const { component, organizationsAll } = setup({ profile: { ...verifiedUserProfile, globalRole: 'Organizer', emailVerified: false }, organizations: [{ id: 'org-1' } as MyOrganizationResponse] });
    component.sync();
    await Promise.resolve();

    expect(component.canCreateEvent()).toBe(false);
    expect(component.createEventDisabledReason()).toBe(component.i18n.t('event.createRequiresVerifiedEmail'));
    expect(organizationsAll).not.toHaveBeenCalled();
  });

  it('disables creation with zero direct memberships and enables it with one', async () => {
    const zero = setup({ profile: { ...verifiedUserProfile, globalRole: 'Admin' }, organizations: [] }).component;
    zero.sync();
    await vi.waitFor(() => expect(zero.createEventMembershipState()).toBe('empty'));
    expect(zero.canCreateEvent()).toBe(false);
    expect(zero.createEventDisabledReason()).toBe(zero.i18n.t('event.createRequiresOrganization'));

    const one = setup({ profile: { ...verifiedUserProfile, globalRole: 'Admin' }, organizations: [{ id: 'org-1' } as MyOrganizationResponse] }).component;
    one.sync();
    await vi.waitFor(() => expect(one.createEventMembershipState()).toBe('enabled'));
    expect(one.canCreateEvent()).toBe(true);
    expect(one.createEventDisabledReason()).toBeNull();
  });

  it('keeps creation disabled when the membership lookup fails', async () => {
    const { component } = setup({ profile: { ...verifiedUserProfile, globalRole: 'Organizer' }, organizationsError: true });
    component.sync();
    await vi.waitFor(() => expect(component.createEventMembershipState()).toBe('failed'));

    expect(component.canCreateEvent()).toBe(false);
  });

  it('does not let an older membership response overwrite a newer retry', async () => {
    const first = new Subject<MyOrganizationResponse[]>();
    const organizationsAll = vi.fn()
      .mockReturnValueOnce(first.asObservable())
      .mockReturnValueOnce(of([{ id: 'org-1' } as MyOrganizationResponse]));
    const { component } = setup({ profile: { ...verifiedUserProfile, globalRole: 'Admin' }, organizationsAll });
    component.sync();
    await vi.waitFor(() => expect(organizationsAll).toHaveBeenCalledTimes(1));

    component.sync();
    await vi.waitFor(() => expect(component.createEventMembershipState()).toBe('enabled'));
    first.next([]);
    first.complete();
    await Promise.resolve();

    expect(component.createEventMembershipState()).toBe('enabled');
  });
});

describe('PublicEventListComponent top action row layout', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');
  // T7 moved the affordance itself into the shared `gones-sync-bar`, so the assertions about what
  // the button looks like read the bar's own source. What stays here is what this page decides:
  // where the bar sits, which prefix its test ids carry, and which signals feed it.
  const barSource = readFileSync(join(__dirname, '..', '..', 'shared', 'sync-bar.component.ts'), 'utf8');

  it('the sync bar shares the back-button row', () => {
    const open = source.indexOf('data-cy="event-list-top-actions"');
    expect(open).toBeGreaterThan(-1);
    const rowStart = source.lastIndexOf('<div', open);
    const rowEnd = source.indexOf('</div>\n    <section', rowStart);
    expect(rowEnd).toBeGreaterThan(-1);
    const row = source.slice(rowStart, rowEnd);
    expect(row).toContain('data-cy="event-list-back-top"');
    expect(row).toContain('<gones-sync-bar cyPrefix="event-list"');
  });

  it('the bar renders this page\u2019s stable test ids', () => {
    const ids = [...barSource.matchAll(/\[attr\.data-cy\]="cyPrefix\(\) \+ '([^']+)'"/g)].map(([, suffix]) => 'event-list' + suffix);
    expect(ids).toEqual(expect.arrayContaining(['event-list-sync-button', 'event-list-sync-synced-at']));
  });

  it('the bar is fed by the page\u2019s own load state', () => {
    const barStart = source.indexOf('<gones-sync-bar');
    const bar = source.slice(barStart, source.indexOf('>', barStart));
    expect(bar).toContain('[syncedAt]="syncedAt()"');
    expect(bar).toContain('[loading]="loading()"');
    expect(bar).toContain('[stale]="stale()"');
    expect(bar).toContain('(sync)="sync()"');
  });

  it('the last-sync stamp is to the left of the button', () => {
    const syncedAtIndex = barSource.indexOf('calendar-synced-at');
    const syncIndex = barSource.indexOf("'-sync-button'");
    expect(syncedAtIndex).toBeGreaterThan(-1);
    expect(syncedAtIndex).toBeLessThan(syncIndex);
  });

  it('the sync button carries an icon', () => {
    const buttonStart = barSource.indexOf("cyPrefix() + '-sync-button'");
    const button = barSource.slice(buttonStart, barSource.indexOf('</button>', buttonStart));
    expect(button).toContain('<svg');
    expect(button).toContain('class="calendar-sync-icon"');
  });

  it('the icon is decorative', () => {
    const iconStart = barSource.indexOf('class="calendar-sync-icon"');
    const icon = barSource.slice(barSource.lastIndexOf('<svg', iconStart), barSource.indexOf('>', iconStart));
    expect(icon).toContain('aria-hidden="true"');
  });

  it('the header no longer holds the sync affordance', () => {
    const headerStart = source.indexOf('data-cy="event-list-header"');
    const headerEnd = source.indexOf('</header>', headerStart);
    expect(headerEnd).toBeGreaterThan(-1);
    const header = source.slice(headerStart, headerEnd);
    expect(header).not.toContain('gones-sync-bar');
    expect(header).not.toContain('calendar-synced-at');
  });

  // T6 moved the create action out of the header entirely, onto the view-tab row; see the
  // 'search row layout' describe block below for that assertion.

  it('the top row is laid out as a justified row', () => {
    const ruleStart = stylesheet.indexOf('.calendar-top-actions {');
    expect(ruleStart).toBeGreaterThan(-1);
    const ruleEnd = stylesheet.indexOf('}', ruleStart);
    const rule = stylesheet.slice(ruleStart, ruleEnd);
    expect(rule).toContain('display: flex');
    expect(rule).toContain('justify-content: space-between');
  });
});

describe('PublicEventListComponent search row layout', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  it('the title and view tabs sit above the search row', () => {
    const titleIndex = source.indexOf('data-cy="event-list-title"');
    const viewTabsIndex = source.indexOf('data-cy="event-list-view-tabs"');
    const searchRowIndex = source.indexOf('data-cy="event-list-search-row"');
    expect(titleIndex).toBeGreaterThan(-1);
    expect(viewTabsIndex).toBeGreaterThan(-1);
    expect(searchRowIndex).toBeGreaterThan(-1);
    expect(titleIndex).toBeLessThan(viewTabsIndex);
    expect(viewTabsIndex).toBeLessThan(searchRowIndex);
  });

  it('the search input has no visible label', () => {
    expect(source).not.toContain('calendar-search-label');
  });

  it('the search input names itself for assistive tech', () => {
    const inputStart = source.indexOf('data-cy="event-list-search"');
    const inputEnd = source.indexOf('>', inputStart);
    const input = source.slice(inputStart, inputEnd);
    expect(input).toContain(`[attr.aria-label]="i18n.t('common.search')"`);
  });

  it('the search row is not a panel', () => {
    const rowStart = source.lastIndexOf('<form', source.indexOf('data-cy="event-list-search-row"'));
    const rowTagEnd = source.indexOf('>', rowStart);
    const rowTag = source.slice(rowStart, rowTagEnd);
    expect(rowTag).not.toContain('panel');
    expect(rowTag).not.toContain('calendar-filter-form');
  });

  // T6 reversed the chrome-less input from T8: round-3 feedback #7 wants a normal bordered input
  // back; see the 'toolbar row' describe block below for that assertion.

  it('the input is shorter than before', () => {
    const ruleStart = stylesheet.indexOf('.calendar-search-input {');
    const ruleEnd = stylesheet.indexOf('}', ruleStart);
    const rule = stylesheet.slice(ruleStart, ruleEnd);
    expect(rule).not.toContain('min-height: 48px');
  });

  it('focus is still visible', () => {
    const ruleStart = stylesheet.indexOf('.calendar-search-input:focus-visible {');
    expect(ruleStart).toBeGreaterThan(-1);
    const ruleEnd = stylesheet.indexOf('}', ruleStart);
    const rule = stylesheet.slice(ruleStart, ruleEnd);
    expect(rule).toContain('outline');
  });

  it('the view tabs share the title header row', () => {
    const headerStart = source.indexOf('data-cy="event-list-header"');
    const headerEnd = source.indexOf('</header>', headerStart);
    const header = source.slice(headerStart, headerEnd);
    expect(header).toContain('calendar-view-tabs');
    expect(header).toContain('data-cy="event-list-title"');
  });

  it('left-aligns the Calendar and List buttons with the title at equal heights', () => {
    const headerRule = stylesheet.match(/\.public-calendar-page > \.section-header \{[^}]*\}/)?.[0] ?? '';
    expect(headerRule).toContain('display: flex');
    expect(headerRule).toContain('justify-content: flex-start');
    expect(headerRule).toContain('align-items: center');

    const buttonRule = stylesheet.match(/\.calendar-view-tabs > button \{[^}]*\}/)?.[0] ?? '';
    expect(buttonRule).toContain('width: auto');
    expect(buttonRule).toContain('height: 44px');
  });

  it('filtering removes non-matching events from both views', async () => {
    const { component } = setup({ result: { items: [event, eventB] } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    // The slug is the field the clone actually varies; searching it (rather than the title, whose
    // words `Lyon` and `Legacy` also appear in the shared venue/format fields the clone keeps) is
    // what proves the filter narrows to exactly one item instead of fuzzy-matching both.
    component.setSearchDraft(event.slug);

    expect(component.items()).toHaveLength(1);
    expect(component.items()[0].id).toBe(event.id);
    expect(component.groups().flatMap(group => group.items).map(item => item.id)).toEqual([event.id]);
  });

  it('an empty query keeps every event', async () => {
    const { component } = setup({ result: { items: [event, eventB] } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    component.setSearchDraft(event.slug);
    component.setSearchDraft('');

    expect(component.items()).toHaveLength(2);
  });

  it('orders structured filters after the whole-card fuzzy search', () => {
    const controls = [
      'event-list-search', 'event-list-filter-from', 'event-list-filter-to', 'event-list-filter-country',
      'event-list-filter-region', 'event-list-filter-city', 'event-list-filter-format', 'event-list-filter-type'
    ].map(cy => source.indexOf(`data-cy="${cy}"`));
    expect(controls.every(index => index >= 0)).toBe(true);
    expect(controls).toEqual([...controls].sort((left, right) => left - right));
  });

  it('ANDs structured filters with fuzzy whole-card matching', async () => {
    const weekly = { ...event, eventType: 'weekly', venue: { ...event.venue, region: 'Auvergne-Rhône-Alpes' } };
    const major = { ...eventB, eventType: 'major', venue: { ...eventB.venue, city: 'Paris', region: 'Île-de-France' } };
    const { component } = setup({
      params: { from: '2026-01-01', to: '2100-01-01', country: 'France', type: 'weekly' },
      result: { items: [weekly, major] }
    });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    component.setSearchDraft('legacy');

    expect(component.items()).toEqual([weekly]);
  });

  it('loads defaults when URL carries only navigation params', async () => {
    localStorage.removeItem('gones.events.search.v1.anonymous');
    const { component } = setup({ bareParams: true, params: { view: 'list' } });
    component.ngOnInit();
    await vi.waitFor(() => {
      expect(component.query().from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(component.query().to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    expect(component.query().view).toBe('list');
  });

  it('restores per-user search memory before profile defaults', async () => {
    const key = 'gones.events.search.v1.44444444-4444-4444-4444-444444444444';
    localStorage.setItem(key, JSON.stringify({ version: 1, q: 'stored', filters: {
      from: '2028-01-01', to: '2028-06-30', country: 'Belgium', region: 'Wallonia', city: 'Liège', format: 'legacy', eventType: 'monthly'
    } }));
    const profile = { ...verifiedUserProfile, locationCountry: 'FR', locationRegion: 'ARA', locationCity: 'Lyon' } as UserProfileResponse;
    const { component } = setup({ bareParams: true, params: { view: 'list' }, profile });
    component.ngOnInit();
    await vi.waitFor(() => expect(component.searchDraft()).toBe('stored'));
    expect(component.query()).toMatchObject({ country: 'Belgium', region: 'Wallonia', city: 'Liège', eventType: 'monthly' });
    localStorage.removeItem(key);
  });

  it('round-trips intentionally empty stored date bounds through router params', async () => {
    const key = 'gones.events.search.v1.44444444-4444-4444-4444-444444444444';
    localStorage.setItem(key, JSON.stringify({ version: 1, q: '', filters: {
      from: '', to: '', country: '', region: '', city: '', format: '', eventType: ''
    } }));
    const { component } = setup({ bareParams: true, params: { view: 'list' }, profile: verifiedUserProfile });
    component.ngOnInit();
    await vi.waitFor(() => expect(component.query()).toMatchObject({ from: '', to: '' }));
    localStorage.removeItem(key);
  });

  it('keeps explicit URL filters ahead of search memory and profile defaults', async () => {
    const key = 'gones.events.search.v1.44444444-4444-4444-4444-444444444444';
    localStorage.setItem(key, JSON.stringify({ version: 1, q: 'stored', filters: {
      from: '2028-01-01', to: '2028-06-30', country: 'Belgium', region: '', city: '', format: '', eventType: ''
    } }));
    const { component } = setup({ bareParams: true, profile: verifiedUserProfile, params: {
      q: 'url', from: '2029-01-01', to: '2029-06-30', country: 'France', region: 'Île-de-France', city: 'Paris', type: 'major'
    } });
    component.ngOnInit();
    await Promise.resolve();
    expect(component.query()).toMatchObject({ q: 'url', country: 'France', region: 'Île-de-France', city: 'Paris', eventType: 'major' });
    localStorage.removeItem(key);
  });

  it('defaults an empty navigation from per-user profile location', async () => {
    localStorage.removeItem('gones.events.search.v1.44444444-4444-4444-4444-444444444444');
    const profile = { ...verifiedUserProfile, locationCountry: 'FR', locationRegion: 'ARA', locationCity: 'Lyon' } as UserProfileResponse;
    const { component } = setup({
      bareParams: true,
      profile,
      geoCountries: [{ code: 'FR', name: 'France' }],
      geoRegions: [{ code: 'ARA', name: 'Auvergne-Rhône-Alpes' }]
    });
    component.ngOnInit();
    await vi.waitFor(() => {
      expect(component.query()).toMatchObject({ country: 'France', region: 'Auvergne-Rhône-Alpes', city: 'Lyon' });
    });
  });
});

describe('PublicEventListComponent past-event toggle', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');

  it('renders hide-past checkbox after list button, checked by default', () => {
    const listButton = source.indexOf('data-cy="list-view"');
    const checkbox = source.indexOf('data-cy="event-list-hide-past"');
    expect(listButton).toBeGreaterThan(-1);
    expect(checkbox).toBeGreaterThan(listButton);
    expect(source.slice(checkbox, source.indexOf('</label>', checkbox))).toContain("i18n.t('event.hidePast')");
  });

  it('calendar view applies the checked hide-past state to day cells', async () => {
    const started = { ...event, id: 'started', startsAtUtc: '2000-01-01T00:00:00Z' };
    const available = { ...eventB, startsAtUtc: '2099-01-01T00:00:00Z' };
    const { component } = setup({ result: { items: [started, available] } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    expect(component.dayEvents(event.venueStartDate)).toEqual([available]);
    component.hidePastEvents.set(false);
    expect(component.dayEvents(event.venueStartDate)).toEqual([started, available]);
  });

  it('defaults to hiding past events and can show them', async () => {
    const started = { ...event, id: 'started', startsAtUtc: '2000-01-01T00:00:00Z' };
    const { component } = setup({ params: { view: 'list' }, result: { items: [started, eventB] } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.hidePastEvents()).toBe(true);
    expect(component.pagedItems()).toEqual([eventB]);

    component.hidePastEvents.set(false);
    expect(component.pagedItems()).toEqual([started, eventB]);
  });
});

describe('PublicEventListComponent toolbar row', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  it('the create button lives on the view-tab row', () => {
    const tabsStart = source.indexOf('data-cy="event-list-view-tabs"');
    expect(tabsStart).toBeGreaterThan(-1);
    const tabsOpen = source.lastIndexOf('<div', tabsStart);
    const tabsEnd = source.indexOf('</div>', tabsStart);
    const tabs = source.slice(tabsOpen, tabsEnd);
    expect(tabs).toContain('data-cy="event-list-create-event"');
  });

  it('the view controls live in the page header', () => {
    const headerStart = source.indexOf('data-cy="event-list-header"');
    const headerEnd = source.indexOf('</header>', headerStart);
    const header = source.slice(headerStart, headerEnd);
    expect(header).toContain('data-cy="event-list-view-tabs"');
    expect(header).toContain('data-cy="event-list-create-event"');
  });

  it('the create button wears the success green and exposes its disabled reason as a tooltip', () => {
    const buttonStart = source.indexOf('data-cy="event-list-create-event"');
    const tagStart = source.lastIndexOf('<a', buttonStart);
    const tagEnd = source.indexOf('>', buttonStart);
    const tag = source.slice(tagStart, tagEnd);
    expect(tag).toContain('create-action-button');
    expect(tag).not.toContain('home-primary-action');
    expect(tag).toContain('[routerLink]="canCreateEvent() ? \'/events/new\' : null"');
    expect(tag).toContain('role="link"');
    expect(tag).toContain('tabindex="0"');
    expect(tag).toContain('[disabled]="!canCreateEvent()"');
    expect(tag).toContain('[disabledInteractive]="!canCreateEvent()"');
    expect(tag).toContain('[matTooltip]="disabledReason ?? \'\'"');
    expect(tag).toContain('[matTooltipDisabled]="!disabledReason"');
  });

  it('the search input is a normal bordered input and its row is bare', () => {
    const inputRule = stylesheet.match(/\.calendar-search-input\s*\{[^}]*\}/)?.[0] ?? '';
    expect(inputRule).toContain('border: 1px solid var(--steel)');
    expect(inputRule).toContain('background: var(--black-metal)');
    expect(inputRule).not.toContain('border: 0');

    const rowRule = stylesheet.match(/\.calendar-search-row\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rowRule).not.toContain('border');
    expect(rowRule).not.toContain('background');
  });
});

describe('PublicEventListComponent month nav layout', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  it('the month nav is the element immediately above the grid', () => {
    const navIndex = source.indexOf('data-cy="event-list-month-controls"');
    const gridIndex = source.indexOf('class="public-month-grid"');
    expect(navIndex).toBeGreaterThan(-1);
    expect(gridIndex).toBeGreaterThan(-1);
    expect(navIndex).toBeLessThan(gridIndex);

    const navClose = source.indexOf('</nav>', navIndex);
    const gridOpen = source.lastIndexOf('<section', gridIndex);
    const between = source.slice(navClose + '</nav>'.length, gridOpen);
    expect(between).not.toContain('data-cy=');
  });

  it('the month nav spans the row', () => {
    const ruleStart = stylesheet.indexOf('.calendar-month-controls {');
    expect(ruleStart).toBeGreaterThan(-1);
    const ruleEnd = stylesheet.indexOf('}', ruleStart);
    const rule = stylesheet.slice(ruleStart, ruleEnd);
    expect(rule).toContain('display: flex');
    expect(rule).toContain('width: 100%');
  });

  it('previous and next are pushed to the edges', () => {
    const ruleStart = stylesheet.indexOf('.calendar-month-controls {');
    const ruleEnd = stylesheet.indexOf('}', ruleStart);
    const rule = stylesheet.slice(ruleStart, ruleEnd);
    expect(rule).toContain('justify-content: space-between');
  });

  it('the month label takes the middle', () => {
    const ruleStart = stylesheet.indexOf('.calendar-month-controls h2 {');
    expect(ruleStart).toBeGreaterThan(-1);
    const ruleEnd = stylesheet.indexOf('}', ruleStart);
    const rule = stylesheet.slice(ruleStart, ruleEnd);
    expect(rule).toContain('flex: 1');
    expect(rule).toContain('text-align: center');
  });

  it('the dead grid placement is gone', () => {
    const regex = /\.calendar-month-controls[^{}]*\{[^}]*\}/g;
    const matches = stylesheet.match(regex) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const rule of matches) {
      expect(rule).not.toContain('grid-column');
      expect(rule).not.toContain('justify-self');
    }
  });

  it('moving month keeps the view', async () => {
    const { component, navigate } = setup();
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    component.moveMonth(1);

    expect(navigate).toHaveBeenCalled();
    const [, extras] = navigate.mock.calls[navigate.mock.calls.length - 1] as [unknown, { queryParams: Record<string, string> }];
    expect(extras.queryParams['month']).toBe('2026-09');
    expect(extras.queryParams['view']).toBe('calendar');
  });

  it('moving month backwards crosses the year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('PublicEventListComponent calendar day cells', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  it('renders current event links without the retired pill markup', () => {
    expect(source).toContain('class="public-month-event"');
    expect(source).not.toContain('calendar-pill');
  });

  it('the day cell still renders its date', () => {
    const cellStart = source.indexOf('class="public-month-day"');
    expect(cellStart).toBeGreaterThan(-1);
    const cellEnd = source.indexOf('</article>', cellStart);
    const cell = source.slice(cellStart, cellEnd);
    expect(cell).toContain('data-cy="event-list-month-day-date"');
  });

  it('the month model carries no events', () => {
    const listSource = readFileSync(join(__dirname, 'public-event-list.ts'), 'utf8');
    const declStart = listSource.indexOf('interface MonthDay');
    const declEnd = listSource.indexOf('}', declStart);
    const decl = listSource.slice(declStart, declEnd);
    expect(decl).not.toContain('items');
  });

  it('building a month needs only the month', () => {
    const listSource = readFileSync(join(__dirname, 'public-event-list.ts'), 'utf8');
    expect(listSource).toMatch(/function buildMonthDays\(month: string\)/);
  });

  it('the grid is still 42 cells over six rows', async () => {
    const { component } = setup();
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.monthDays()).toHaveLength(42);
    const weeks = component.monthWeeks();
    expect(weeks).toHaveLength(6);
    for (const week of weeks) expect(week).toHaveLength(7);
  });

  it('in-month flags survive the change', async () => {
    const { component } = setup({ params: { month: '2026-08' } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    const inMonth = component.monthDays().filter(day => day.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0]).toMatchObject({ date: '2026-08-01', day: 1 });
  });

  it('the empty state still answers the filter', async () => {
    const { component } = setup();
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    component.setSearchDraft('zzzz-no-match');

    expect(component.items()).toHaveLength(0);
  });

  it('the list view still groups events', async () => {
    const eventOnAnotherDate: PublicEventView = { ...eventB, venueStartDate: '2026-08-15' };
    const { component } = setup({ result: { items: [event, eventOnAnotherDate] } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    const groups = component.groups();
    expect(groups).toHaveLength(2);
    const dates = groups.map(group => group.date);
    expect(dates).toEqual([...dates].sort());
  });

  it('no pill styling is left behind', () => {
    expect(stylesheet).not.toContain('calendar-pill');
  });
});

/**
 * The source slice a control-flow block owns, from its opening `{` to the `}` that balances it.
 * Lets a template assertion say "this element is *inside* that guard" rather than "both strings
 * exist somewhere in the file", which is what a hoisted element would still satisfy.
 */
function templateBlock(source: string, opening: string): string {
  const start = source.indexOf(opening);
  expect(start, `template block "${opening}"`).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = start + opening.length - 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unbalanced template block "${opening}"`);
}

describe('PublicEventListComponent list pagination', () => {
  it('list view hides events that already started while calendar keeps them', async () => {
    const started = { ...event, id: 'started', slug: 'started', startsAtUtc: '2000-01-01T00:00:00Z' };
    const available = { ...eventB, startsAtUtc: '2099-01-01T00:00:00Z' };
    const { component } = setup({ params: { view: 'list' }, result: { items: [started, available] } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.items()).toHaveLength(2);
    expect(component.pagedItems()).toEqual([available]);
  });

  it('the list renders only one page of events', async () => {
    const { component } = setup({ params: { view: 'list' }, itemCount: 45 });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.pagedItems()).toHaveLength(20);
    expect(component.groups().reduce((sum, group) => sum + group.items.length, 0)).toBe(20);
  });

  it('pagination is hidden for a single page', async () => {
    const { component } = setup({ params: { view: 'list' }, itemCount: 20 });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.pageCount()).toBe(1);
    // `pageCount() === 1` alone says nothing about what is rendered: without the guard the nav ships
    // on every single-page list as a dead bar with two disabled buttons. There is no TestBed here to
    // render it in, so the guard is asserted structurally — the nav must live inside the block that
    // only opens past one page, and nowhere else in the template.
    const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
    expect(source).toContain("place === 'top' ? 'event-list-pagination-top' : 'event-list-pagination'");
    const listBlock = templateBlock(source.slice(source.indexOf('} @else {', source.indexOf("query().view === 'calendar'")) + 2), '@else {');
    expect(listBlock).toContain("paginationNav; context: { $implicit: 'top' }");
    expect(listBlock).toContain("paginationNav; context: { $implicit: 'bottom' }");
  });

  it('pagination appears past twenty', async () => {
    const { component } = setup({ params: { view: 'list' }, itemCount: 21 });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.pageCount()).toBe(2);
  });

  it('clicking a page number navigates with the page parameter', async () => {
    const { component, navigate } = setup({ params: { view: 'list' }, itemCount: 45 });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    navigate.mockClear();

    component.goPage(2);

    expect(navigate).toHaveBeenCalled();
    const [, extras] = navigate.mock.calls[0] as [unknown, { queryParams: Record<string, string> }];
    expect(extras.queryParams['page']).toBe('2');
  });

  it('uses the Global Rankings numbered page window', async () => {
    const { component } = setup({ params: { view: 'list', page: '9' }, itemCount: 400 });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.pageWindow()).toEqual([1, 'gap', 8, 9, 10, 'gap', 20]);
    const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
    expect(source).toContain("@for (item of pageWindow(); track $index)");
    expect(source).toContain("'event-list-page-number-' + place + '-' + item");
    expect(source).not.toContain('event-list-page-prev');
    expect(source).not.toContain('event-list-page-next');
  });

  it('searching resets to page one', async () => {
    vi.useFakeTimers();
    try {
      const { component, navigate } = setup({ params: { view: 'list', page: '3' }, itemCount: 45 });
      component.ngOnInit();
      await Promise.resolve();
      await Promise.resolve();
      navigate.mockClear();

      component.setSearchDraft('x');
      vi.advanceTimersByTime(300);

      expect(navigate).toHaveBeenCalledTimes(1);
      const [, extras] = navigate.mock.calls[0] as [unknown, { queryParams: Record<string, string> }];
      expect(extras.queryParams).not.toHaveProperty('page');
    } finally {
      vi.useRealTimers();
    }
  });

  it('changing month resets to page one', async () => {
    const { component, navigate } = setup({ params: { view: 'list', page: '3' }, itemCount: 45 });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    navigate.mockClear();

    component.moveMonth(1);

    const [, extras] = navigate.mock.calls[0] as [unknown, { queryParams: Record<string, string> }];
    expect(extras.queryParams).not.toHaveProperty('page');
  });

  it('changing view resets to page one', async () => {
    const { component, navigate } = setup({ params: { view: 'list', page: '3' }, itemCount: 45 });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    navigate.mockClear();

    component.setView('calendar');

    const [, extras] = navigate.mock.calls[0] as [unknown, { queryParams: Record<string, string> }];
    expect(extras.queryParams).not.toHaveProperty('page');
  });

  it('a page beyond the last page clamps rather than showing nothing', async () => {
    const { component } = setup({ params: { view: 'list', page: '99' }, itemCount: 45 });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.currentPage()).toBe(3);
    expect(component.pagedItems()).toHaveLength(5);
  });

  it('the pagination nav exists in the list block only', () => {
    const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
    const listIndex = source.indexOf('data-cy="event-list-list"');
    const paginationTemplate = source.indexOf('<ng-template #paginationNav');
    expect(listIndex).toBeGreaterThan(-1);
    expect(paginationTemplate).toBeGreaterThan(listIndex);

    const calendarBlock = templateBlock(source, "@if (query().view === 'calendar') {");
    expect(calendarBlock).not.toContain('#paginationNav');
    const listViewStart = source.indexOf('} @else {', source.indexOf("query().view === 'calendar'"));
    expect(paginationTemplate).toBeGreaterThan(listViewStart);
  });
});

describe('PublicEventListComponent day-cell events', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');

  it('day cells render their events', () => {
    const cellStart = source.indexOf('class="public-month-day"');
    expect(cellStart).toBeGreaterThan(-1);
    const cellEnd = source.indexOf('</article>', cellStart);
    const cell = source.slice(cellStart, cellEnd);

    expect(cell).toContain('visibleDayEvents(day.date)');
    expect(cell).toContain('event-list-month-day-event-');
  });

  it('the calendar tab lists nothing under the grid', () => {
    const calendarBlock = templateBlock(source, "@if (query().view === 'calendar') {");

    expect(calendarBlock).not.toContain('data-cy="event-list-list"');
    expect(calendarBlock).not.toContain('calendar-venue-date-');
    expect(calendarBlock).not.toContain('#paginationNav');
  });

  it('the list tab keeps its list', () => {
    const calendarViewStart = source.indexOf("query().view === 'calendar'");
    const elseStart = source.indexOf('} @else {', calendarViewStart);
    expect(elseStart).toBeGreaterThan(-1);
    const listBlock = templateBlock(source.slice(elseStart + 2), '@else {');

    expect(listBlock).toContain('data-cy="event-list-list"');
    expect(listBlock).toContain("paginationNav; context: { $implicit: 'top' }");
    expect(listBlock).toContain("paginationNav; context: { $implicit: 'bottom' }");
  });
});

describe('PublicEventListComponent list card', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');
  const cardTag = source.slice(source.indexOf('<article class="panel public-tournament-card"'), source.indexOf('>', source.indexOf('<article class="panel public-tournament-card"')));
  const cardActions = source.slice(source.indexOf('data-cy="event-list-card-actions"'), source.indexOf('</article></ng-template>'));

  it('clicking the card navigates to the event page', async () => {
    const { component, navigate } = setup({ params: { view: 'list' } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    navigate.mockClear();

    component.openEvent(event);

    expect(navigate).toHaveBeenCalledWith(['/events', 'lyon-legacy']);
  });

  // Space would scroll the page before it ever reached the card, so the handler takes the event.
  it('space on a focused card navigates without scrolling the page', async () => {
    const { component, navigate } = setup({ params: { view: 'list' } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    navigate.mockClear();
    const keyEvent = { preventDefault: vi.fn() } as unknown as Event;

    component.openEvent(event, keyEvent);

    expect(keyEvent.preventDefault).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/events', 'lyon-legacy']);
  });

  it('the card is the click target, and reads as a link to assistive tech', () => {
    expect(cardTag).toContain('(click)="openEvent(item)"');
    expect(cardTag).toContain('(keydown.enter)="openEvent(item)"');
    expect(cardTag).toContain('(keydown.space)="openEvent(item, $event)"');
    expect(cardTag).toContain('role="link"');
    expect(cardTag).toContain('tabindex="0"');
    expect(cardTag).toContain('[attr.aria-label]="item.displayTitle"');
  });

  // The card handler sits on the ancestor: without stopPropagation, downloading the ICS or
  // following the title link would also fire the card's navigation.
  it('clicking add to calendar does not navigate', () => {
    const icsMarker = cardActions.indexOf('data-cy="event-list-card-ics"');
    const icsAnchor = cardActions.slice(cardActions.lastIndexOf('<a', icsMarker), cardActions.indexOf('</a>', icsMarker));

    expect(icsAnchor).toContain('(click)="$event.stopPropagation()"');
    expect(icsAnchor).toContain('[href]="service.icsUrl(item.slug)"');
  });

  // Enter on the anchor bubbles as a keydown *before* the click it synthesises, so the click guard
  // alone would still let the card navigate the reader away from their download.
  it('keyboard activation of add to calendar does not navigate either', () => {
    const icsMarker = cardActions.indexOf('data-cy="event-list-card-ics"');
    const icsAnchor = cardActions.slice(cardActions.lastIndexOf('<a', icsMarker), cardActions.indexOf('</a>', icsMarker));

    expect(icsAnchor).toContain('(keydown.enter)="$event.stopPropagation()"');
    expect(icsAnchor).toContain('(keydown.space)="$event.stopPropagation()"');
  });

  it('does not force a download from a card', () => {
    const icsMarker = cardActions.indexOf('data-cy="event-list-card-ics"');
    const icsAnchor = cardActions.slice(cardActions.lastIndexOf('<a', icsMarker), cardActions.indexOf('</a>', icsMarker));

    expect(icsAnchor).not.toContain(' download');
    expect(icsAnchor).toContain('type="text/calendar"');
  });

  it('the title link stays and stops pointer plus keyboard card navigation', () => {
    const titleStart = source.indexOf('data-cy="event-list-card-title"');
    const titleAnchor = source.slice(titleStart, source.indexOf('</h3>', titleStart));

    expect(titleAnchor).toContain('data-cy="event-list-card-link"');
    expect(titleAnchor).toContain('(click)="$event.stopPropagation()"');
    expect(titleAnchor).toContain('(keydown.enter)="$event.stopPropagation()"');
    expect(titleAnchor).toContain('(keydown.space)="$event.stopPropagation()"');
  });

  it('the view page button is gone', () => {
    expect(source).not.toContain('data-cy="event-list-card-view"');
    expect(cardActions).toContain('data-cy="event-list-card-ics"');
  });

  it('the standalone venue date is gone while differing viewer time stays', () => {
    const cardBody = source.slice(source.indexOf('data-cy="event-list-card-body"'), source.indexOf('data-cy="event-list-card-venue"'));

    expect(cardBody).not.toContain('data-cy="event-list-card-date"');
    expect(cardBody).not.toContain('date(item).primary');
    expect(cardBody).toContain('data-cy="event-list-card-viewer-date"');
  });

  it('removes the status and standalone date lines, then puts backend title and start time on one row', () => {
    const cardBody = source.slice(source.indexOf('data-cy="event-list-card-body"'), source.indexOf('data-cy="event-list-card-actions"'));

    expect(cardBody).not.toContain('data-cy="event-list-card-status"');
    expect(cardBody).not.toContain('data-cy="event-list-card-date"');
    expect(cardBody).toContain('data-cy="event-list-card-heading"');
    expect(cardBody).toContain('item.displayTitle');
    expect(cardBody).toContain('data-cy="event-list-card-start-time"');
  });

  it('puts green Register beside Add to Calendar and guards pointer plus keyboard propagation', () => {
    expect(cardActions).toContain('data-cy="event-list-card-register"');
    expect(cardActions).toContain('registration-register-button');
    const marker = cardActions.indexOf('data-cy="event-list-card-register"');
    const button = cardActions.slice(cardActions.lastIndexOf('<button', marker), cardActions.indexOf('</button>', marker));
    expect(button).toContain('(click)="registerFromCard(item, $event)"');
    expect(button).toContain('(keydown.enter)="$event.stopPropagation()"');
    expect(button).toContain('(keydown.space)="$event.stopPropagation()"');
  });

  it('anonymous Register carries safe Calendar intent to login and stops card navigation', async () => {
    const { component, navigate } = setup({ params: { view: 'list', q: 'legacy' } });
    const activation = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event;

    await component.registerFromCard(event, activation);

    expect(activation.preventDefault).toHaveBeenCalled();
    expect(activation.stopPropagation).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/events?month=2026-08&view=list&from=2000-01-01&to=2100-01-01&q=legacy&register=lyon-legacy' } });
  });

  it('rechecks capability and never mutates before confirmation', async () => {
    const closed = new Subject<boolean>();
    const open = vi.fn(() => ({ afterClosed: () => closed.asObservable() }));
    const { component, capability, register } = setup({ profile: verifiedUserProfile, open });
    const pending = component.registerFromCard(event, { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event);
    await Promise.resolve();
    await Promise.resolve();

    expect(capability).toHaveBeenCalledWith(event.id);
    expect(open).toHaveBeenCalledWith(ConfirmDialogComponent, expect.objectContaining({ data: expect.objectContaining({ confirmLabel: component.i18n.t('registration.register') }) }));
    expect(register).not.toHaveBeenCalled();

    closed.next(false);
    closed.complete();
    await pending;
    expect(register).not.toHaveBeenCalled();
  });

  it('confirmed card registration mutates once and opens existing success dialog', async () => {
    const { component, register, open } = setup({ profile: verifiedUserProfile });

    await component.registerFromCard(event, { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(event.id);
    expect(open).toHaveBeenLastCalledWith(RegistrationSuccessDialogComponent, { data: { title: event.title } });
  });

  it('loads at most twenty visible capabilities and drops stale responses', async () => {
    const first = new Subject<never>();
    let generation = 0;
    const capability = vi.fn(() => generation === 0 ? new Promise(resolve => first.subscribe({ complete: () => resolve({ canRegister: true }) })) : Promise.resolve({ canRegister: false }));
    const { component } = setup({ params: { view: 'list' }, profile: verifiedUserProfile, itemCount: 21, capability });
    component.allItems.set(makeItems(21));

    const stale = component.refreshVisibleCapabilities();
    generation = 1;
    await component.refreshVisibleCapabilities();
    first.complete();
    await stale;

    expect(capability).toHaveBeenCalledTimes(40);
    expect(Object.values(component.registrationCapabilities()).every(value => value.canRegister === false)).toBe(true);
  });

  it('resumed eligible intent rechecks, confirms, mutates once, then strips register', async () => {
    const { component, capability, register, navigateByUrl } = setup({ params: { view: 'list', register: event.slug }, profile: verifiedUserProfile });
    component.allItems.set([event]);

    await component.resumeRegistrationIntent();

    expect(capability).toHaveBeenCalledWith(event.id);
    expect(register).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/events?month=2026-08&view=list&from=2000-01-01&to=2100-01-01', { replaceUrl: true });
  });

  it('resumed cancellation performs no mutation and strips register', async () => {
    const open = vi.fn(() => ({ afterClosed: () => of(false) }));
    const { component, register, navigateByUrl } = setup({ params: { view: 'list', register: event.slug }, profile: verifiedUserProfile, open });
    component.allItems.set([event]);

    await component.resumeRegistrationIntent();

    expect(register).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/events?month=2026-08&view=list&from=2000-01-01&to=2100-01-01', { replaceUrl: true });
  });

  it('resumed ineligible intent shows server reason and strips register', async () => {
    const capability = vi.fn(async () => ({ canRegister: false, canUnregister: false, reason: 'event_full', activeParticipantCount: 32, capacity: 32 }));
    const { component, register, navigateByUrl } = setup({ params: { view: 'list', register: event.slug }, profile: verifiedUserProfile, capability });
    component.allItems.set([event]);

    await component.resumeRegistrationIntent();

    expect(component.registrationMessageKey()).toBe('registration.full');
    expect(register).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/events?month=2026-08&view=list&from=2000-01-01&to=2100-01-01', { replaceUrl: true });
  });

  it('resumed missing intent reports unavailable and strips register via replacement URL', async () => {
    const { component, register, navigateByUrl } = setup({ params: { view: 'list', register: 'missing-event' }, profile: verifiedUserProfile });
    component.allItems.set([event]);

    await component.resumeRegistrationIntent();

    expect(component.registrationMessageKey()).toBe('registration.unavailable');
    expect(register).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/events?month=2026-08&view=list&from=2000-01-01&to=2100-01-01', { replaceUrl: true });
  });

  it('the card lifts on hover and on keyboard focus', () => {
    const baseRule = stylesheet.match(/\.public-tournament-card \{[^}]*\}/)?.[0] ?? '';
    expect(baseRule).toContain('cursor: pointer');
    expect(baseRule).toContain('transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease');

    const hoverRule = stylesheet.match(/\.public-tournament-card:hover, \.public-tournament-card:focus-visible \{[^}]*\}/)?.[0] ?? '';
    expect(hoverRule).toContain('transform: translateY(-2px)');
    expect(hoverRule).toContain('box-shadow: 0 12px 28px');
    expect(hoverRule).toContain('border-color: var(--hot-blood)');
  });

  it('future card keeps its actions enabled', async () => {
    const futureEvent: PublicEventView = { ...event, startsAtUtc: '2099-01-01T00:00:00Z' };
    const { component } = setup({ params: { view: 'list' }, result: { items: [futureEvent] } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.cardActionsDisabled(component.allItems()[0])).toBe(false);
  });

  it('started card keeps Register and Add to Calendar visible but disabled', async () => {
    const pastEvent: PublicEventView = { ...event, startsAtUtc: '2020-01-01T00:00:00Z' };
    const { component } = setup({ params: { view: 'list' }, result: { items: [pastEvent] } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.cardActionsDisabled(component.allItems()[0])).toBe(true);
    expect(cardActions).not.toContain('@if (showCardIcs(item))');
    expect(cardActions).toContain('@if (cardActionsDisabled(item) || showCardRegister(item))');

    const registerMarker = cardActions.indexOf('data-cy="event-list-card-register"');
    const registerButton = cardActions.slice(cardActions.lastIndexOf('<button', registerMarker), cardActions.indexOf('</button>', registerMarker));
    expect(registerButton).toContain('[disabled]="cardActionsDisabled(item) || pendingEventId() === item.id"');

    const icsMarker = cardActions.indexOf('data-cy="event-list-card-ics"');
    const icsAnchor = cardActions.slice(cardActions.lastIndexOf('<a', icsMarker), cardActions.indexOf('</a>', icsMarker));
    expect(icsAnchor).toContain('[disabled]="cardActionsDisabled(item)"');
  });
});

describe('PublicEventListComponent past day cells', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  // There is no TestBed in this suite, so "the cell carries the past marker" is asserted the way
  // every other template claim here is: the component answers `isPast` per day, and the template
  // is read to prove that answer is what feeds the class and the data-cy value.
  it('past day cells carry the past marker, and today does not', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 12, 9, 0, 0));
      const { component } = setup({ params: { month: '2026-08' } });
      component.ngOnInit();
      await Promise.resolve();
      await Promise.resolve();

      const past = component.monthDays().filter(day => component.isPast(day.date));

      expect(past.length).toBeGreaterThan(0);
      expect(past.map(day => day.date)).not.toContain('2026-08-12');
      expect(past.every(day => day.date < '2026-08-12')).toBe(true);
      expect(component.isPast('2026-08-11')).toBe(true);
      expect(component.isPast('2026-08-12')).toBe(false);
      expect(component.isPast('2026-08-13')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the day cell binds the past class, marker, and disabled semantics', () => {
    const cellStart = source.indexOf('class="public-month-day"');
    expect(cellStart).toBeGreaterThan(-1);
    const cell = source.slice(cellStart, source.indexOf('>', cellStart));

    expect(source).toContain('@let dayIsPast = isPast(day.date);');
    expect(cell).toContain('[class.public-month-day--past]="dayIsPast"');
    expect(cell).toContain('[attr.aria-disabled]="dayIsPast"');
    expect(cell).toContain(`[attr.data-cy]="dayIsPast ? 'event-list-month-day-past' : 'event-list-month-day'"`);
  });

  it('keeps past events visible but disables their links', () => {
    const cellStart = source.indexOf('class="public-month-day"');
    const cell = source.slice(cellStart, source.indexOf('</article>', cellStart));

    const pastBlock = templateBlock(cell, '@if (dayIsPast) {');
    expect(pastBlock).toContain('class="public-month-event public-month-event--disabled"');
    expect(pastBlock).toContain('[attr.data-cy]="\'event-list-month-day-event-\' + event.slug"');
    expect(pastBlock).not.toContain('[routerLink]');
    expect(cell).toContain("@for (event of visibleDayEvents(day.date); track event.id)");
    expect(cell).toContain("@else {");
    expect(cell).toContain("[routerLink]=\"['/events', event.slug]\"");
  });

  // Blanket `opacity` on the cell dragged every descendant below the AA contrast bar (axe
  // color-contrast, 2.06:1 on the day number). The past state is a darker cell plus a muted-but-AA
  // day number instead, and the event chips stay at full strength.
  it('the past cell is a darker tint with a muted day number, never a blanket opacity', () => {
    expect(stylesheet).toContain('.public-month-day--past { background: color-mix(in oklch, var(--forge) 45%, var(--iron)); cursor: default; }');
    expect(stylesheet).toContain('.public-month-day--past.public-month-day--muted { background: color-mix(in oklch, var(--forge) 80%, var(--iron)); }');
    expect(stylesheet).toContain('.public-month-day--past > time { color: var(--steel); font-weight: 700; }');
    const disabledEventRule = stylesheet.match(/\.public-month-day--past \.public-month-event--disabled \{[^}]*\}/)?.[0] ?? '';
    expect(disabledEventRule).toContain('cursor: default');
    expect(stylesheet).toContain('a.public-month-event:hover, a.public-month-event:focus-visible');
    expect(stylesheet).not.toContain('.public-month-event:hover, .public-month-event:focus-visible');

    const pastRules = stylesheet.split('\n').filter(line => line.startsWith('.public-month-day--past'));
    expect(pastRules.length).toBeGreaterThan(0);
    expect(pastRules.some(rule => rule.includes('opacity'))).toBe(false);
  });
});

describe('PublicEventListComponent search match highlighting', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  // No TestBed in this repo, so the rendered class is proved in two halves: the parts the component
  // hands the template (highlighted flags) and the template binding that turns them into the class.
  it('the list card title highlights the query', async () => {
    const { component } = setup({ params: { view: 'list' } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    component.setSearchDraft('lyon');
    const parts = component.highlightParts(event.displayTitle);

    expect(parts.map(part => part.text).join('')).toBe(event.displayTitle);
    expect(parts.filter(part => part.highlighted)).toEqual([{ text: 'Lyon', highlighted: true }]);

    const titleStart = source.indexOf('data-cy="event-list-card-title"');
    const title = source.slice(titleStart, source.indexOf('</h3>', titleStart));
    expect(title).toContain('@for (part of highlightParts(item.displayTitle); track $index)');
    expect(title).toContain('[class.match-highlight]="part.highlighted"');
    expect(title).toContain(`[attr.data-cy]="'event-list-card-title-part-' + item.slug + '-' + $index"`);
  });

  it('the month cell title highlights the query', async () => {
    const { component } = setup();
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    component.setSearchDraft('lyon');
    expect(component.highlightParts(event.title).some(part => part.highlighted)).toBe(true);

    const titleStart = source.indexOf('data-cy="event-list-month-day-event-title"');
    const title = source.slice(titleStart, source.indexOf('</span>', source.indexOf('</span>', titleStart) + 1));
    expect(title).toContain('@for (part of highlightParts(event.title); track $index)');
    expect(title).toContain('[class.match-highlight]="part.highlighted"');
    expect(title).toContain(`[attr.data-cy]="'event-list-month-day-event-title-part-' + event.slug + '-' + $index"`);
  });

  it('the remaining venue and summary lines highlight too', () => {
    for (const field of ['venue', 'summary']) {
      expect(source).toContain(`[attr.data-cy]="'event-list-card-${field}-part-' + item.slug + '-' + $index"`);
    }
    expect(source).not.toContain("'event-list-card-date-part-'");
  });

  // The query is user input: it reaches the DOM as interpolated text nodes only, never as HTML.
  it('never binds the query or its parts as HTML', () => {
    expect(source).not.toContain('innerHTML');
    expect(source).not.toContain('bypassSecurityTrust');
  });

  it('the highlight treatment is the shared global rule, not a component-scoped copy', () => {
    const playerDetail = readFileSync(join(__dirname, '..', 'players', 'player-detail.component.ts'), 'utf8');
    expect(stylesheet).toContain('.match-highlight { border-radius: .18rem; background: oklch(86% 0.16 82 / .3); color: oklch(92% 0.16 82); box-shadow: 0 0 0 2px oklch(86% 0.16 82 / .16); }');
    expect(playerDetail).not.toContain('.match-highlight {');
  });
});

describe('PublicEventListComponent calendar and card polish', () => {
  const source = readFileSync(join(__dirname, 'public-event-list.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  it('renders localised Monday-first headers', () => {
    const { component } = setup();
    const headers = component.weekdays();
    const expectedMonday = new Intl.DateTimeFormat(component.i18n.locale(), { weekday: 'short' })
      .format(new Date(Date.UTC(2026, 5, 1)));
    expect(headers).toHaveLength(7);
    expect(headers[0]).toBe(expectedMonday);
    expect(source).toContain('weekdays()');
  });

  it('links the card address to maps', () => {
    const { component } = setup();
    const url = component.cardMapsUrl(event);
    expect(url).toContain('maps/search');
    expect(url).toContain(encodeURIComponent('1 Rue Test'));
    expect(source).toContain('event-list-card-venue-link');
  });

  it('omits the link with no address', () => {
    const { component } = setup();
    const emptyVenueEvent: PublicEventView = { ...event, venue: {} as typeof event.venue };
    expect(component.cardMapsUrl(emptyVenueEvent)).toBeNull();
  });

  it('puts register before add to calendar', () => {
    const registerIndex = source.indexOf('event-list-card-register');
    const icsIndex = source.indexOf('event-list-card-ics');
    expect(registerIndex).toBeGreaterThan(-1);
    expect(icsIndex).toBeGreaterThan(-1);
    expect(registerIndex).toBeLessThan(icsIndex);
  });

  it('the venue link inherits colour and underlines only on hover and focus-visible', () => {
    expect(stylesheet).toContain('.event-card-venue-link { color: inherit; text-decoration: none; }');
    expect(stylesheet).toContain('.event-card-venue-link:hover, .event-card-venue-link:focus-visible { text-decoration: underline; }');
  });
});
