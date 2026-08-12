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
import { PublicTournamentView, shiftMonth } from './public-calendar';
import { UserProfileResponse } from '../../api/generated/gones-api';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const tournamentB: PublicTournamentView = {
  ...tournament,
  id: '55555555-5555-5555-5555-555555555555',
  slug: 'paris-modern',
  title: 'Paris Modern'
};

function makeItems(count: number): PublicTournamentView[] {
  return Array.from({ length: count }, (_, index) => ({
    ...tournament,
    id: `item-${String(index).padStart(3, '0')}`,
    slug: `item-${String(index).padStart(3, '0')}`,
    title: `Tournament ${String(index).padStart(3, '0')}`
  }));
}

function setup(options: { params?: Record<string, string>; result?: Partial<AllTournamentsResult>; profile?: UserProfileResponse | null; authEnabled?: boolean; itemCount?: number } = {}) {
  const result: AllTournamentsResult = {
    items: options.itemCount !== undefined ? makeItems(options.itemCount) : [tournament],
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
  return { component, load, navigate, lastQueryParams: () => navigate.mock.calls[navigate.mock.calls.length - 1]?.[1]?.queryParams };
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

describe('PublicCalendarComponent top action row layout', () => {
  const source = readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  it('the sync button shares the back-button row', () => {
    const open = source.indexOf('data-cy="calendar-top-actions"');
    expect(open).toBeGreaterThan(-1);
    const rowStart = source.lastIndexOf('<div', open);
    const rowEnd = source.indexOf('</div>\n    </div>', rowStart);
    expect(rowEnd).toBeGreaterThan(-1);
    const row = source.slice(rowStart, rowEnd);
    expect(row).toContain('data-cy="calendar-back-top"');
    expect(row).toContain('data-cy="calendar-sync"');
  });

  it('the last-sync stamp is to the left of the button', () => {
    const groupStart = source.indexOf('data-cy="calendar-sync-group"');
    expect(groupStart).toBeGreaterThan(-1);
    const groupEnd = source.indexOf('</div>', source.indexOf('data-cy="calendar-sync"', groupStart));
    const group = source.slice(groupStart, groupEnd);
    const syncedAtIndex = group.indexOf('calendar-synced-at');
    const syncIndex = group.indexOf('calendar-sync"');
    expect(syncedAtIndex).toBeGreaterThan(-1);
    expect(syncedAtIndex).toBeLessThan(syncIndex);
  });

  it('the sync button carries an icon', () => {
    const buttonStart = source.indexOf('data-cy="calendar-sync"');
    const buttonEnd = source.indexOf('</button>', buttonStart);
    const button = source.slice(buttonStart, buttonEnd);
    expect(button).toContain('<svg');
    expect(button).toContain('class="calendar-sync-icon"');
  });

  it('the icon is decorative', () => {
    const iconStart = source.indexOf('class="calendar-sync-icon"');
    const iconTagStart = source.lastIndexOf('<svg', iconStart);
    const iconTagEnd = source.indexOf('>', iconStart);
    const icon = source.slice(iconTagStart, iconTagEnd);
    expect(icon).toContain('aria-hidden="true"');
  });

  it('the header no longer holds the sync affordance', () => {
    const headerStart = source.indexOf('data-cy="calendar-header"');
    const headerEnd = source.indexOf('</header>', headerStart);
    expect(headerEnd).toBeGreaterThan(-1);
    const header = source.slice(headerStart, headerEnd);
    expect(header).not.toContain('calendar-sync"');
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

describe('PublicCalendarComponent search row layout', () => {
  const source = readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  it('the search row sits between the title and the view tabs', () => {
    const titleIndex = source.indexOf('data-cy="calendar-title"');
    const searchRowIndex = source.indexOf('data-cy="calendar-search-row"');
    const viewTabsIndex = source.indexOf('data-cy="calendar-view-tabs"');
    expect(titleIndex).toBeGreaterThan(-1);
    expect(searchRowIndex).toBeGreaterThan(-1);
    expect(viewTabsIndex).toBeGreaterThan(-1);
    expect(titleIndex).toBeLessThan(searchRowIndex);
    expect(searchRowIndex).toBeLessThan(viewTabsIndex);
  });

  it('the search input has no visible label', () => {
    expect(source).not.toContain('calendar-search-label');
  });

  it('the search input names itself for assistive tech', () => {
    const inputStart = source.indexOf('data-cy="calendar-search"');
    const inputEnd = source.indexOf('>', inputStart);
    const input = source.slice(inputStart, inputEnd);
    expect(input).toContain(`[attr.aria-label]="i18n.t('common.search')"`);
  });

  it('the search row is not a panel', () => {
    const rowStart = source.lastIndexOf('<form', source.indexOf('data-cy="calendar-search-row"'));
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

  it('the view tabs are on their own row', () => {
    const headerStart = source.indexOf('data-cy="calendar-header"');
    const headerEnd = source.indexOf('</header>', headerStart);
    const header = source.slice(headerStart, headerEnd);
    expect(header).not.toContain('calendar-view-tabs');
  });

  it('filtering removes non-matching tournaments from both views', async () => {
    const { component } = setup({ result: { items: [tournament, tournamentB] } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    // The slug is the field the clone actually varies; searching it (rather than the title, whose
    // words `Lyon` and `Legacy` also appear in the shared venue/format fields the clone keeps) is
    // what proves the filter narrows to exactly one item instead of fuzzy-matching both.
    component.setSearchDraft(tournament.slug);

    expect(component.items()).toHaveLength(1);
    expect(component.items()[0].id).toBe(tournament.id);
    expect(component.groups().flatMap(group => group.items).map(item => item.id)).toEqual([tournament.id]);
  });

  it('an empty query keeps every tournament', async () => {
    const { component } = setup({ result: { items: [tournament, tournamentB] } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    component.setSearchDraft(tournament.slug);
    component.setSearchDraft('');

    expect(component.items()).toHaveLength(2);
  });
});

describe('PublicCalendarComponent toolbar row', () => {
  const source = readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  it('the create button lives on the view-tab row', () => {
    const tabsStart = source.indexOf('data-cy="calendar-view-tabs"');
    expect(tabsStart).toBeGreaterThan(-1);
    const tabsOpen = source.lastIndexOf('<div', tabsStart);
    const tabsEnd = source.indexOf('</div>', tabsStart);
    const tabs = source.slice(tabsOpen, tabsEnd);
    expect(tabs).toContain('data-cy="calendar-create-tournament"');
  });

  it('the create button is not in the page header any more', () => {
    expect(source).not.toContain('data-cy="calendar-header-actions"');
    const createIndex = source.indexOf('data-cy="calendar-create-tournament"');
    const tabsIndex = source.indexOf('data-cy="calendar-view-tabs"');
    expect(createIndex).toBeGreaterThan(-1);
    expect(tabsIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(tabsIndex);
  });

  it('the create button wears the success green', () => {
    const buttonStart = source.indexOf('data-cy="calendar-create-tournament"');
    const tagStart = source.lastIndexOf('<a', buttonStart);
    const tagEnd = source.indexOf('>', buttonStart);
    const tag = source.slice(tagStart, tagEnd);
    expect(tag).toContain('create-action-button');
    expect(tag).not.toContain('home-primary-action');
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

describe('PublicCalendarComponent month nav layout', () => {
  const source = readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

  it('the month nav is the element immediately above the grid', () => {
    const navIndex = source.indexOf('data-cy="calendar-month-controls"');
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

describe('PublicCalendarComponent calendar day cells', () => {
  const source = readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8');
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
    expect(cell).toContain('data-cy="calendar-month-day-date"');
  });

  it('the month model carries no tournaments', () => {
    const declStart = source.indexOf('interface MonthDay');
    const declEnd = source.indexOf('}', declStart);
    const decl = source.slice(declStart, declEnd);
    expect(decl).not.toContain('items');
  });

  it('building a month needs only the month', () => {
    expect(source).toMatch(/function buildMonthDays\(month: string\)/);
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

  it('the list view still groups tournaments', async () => {
    const tournamentOnAnotherDate: PublicTournamentView = { ...tournamentB, venueStartDate: '2026-08-15' };
    const { component } = setup({ result: { items: [tournament, tournamentOnAnotherDate] } });
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

describe('PublicCalendarComponent list pagination', () => {
  it('the list renders only one page of tournaments', async () => {
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
    const source = readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8');
    expect(source.match(/data-cy="calendar-pagination"/g)).toHaveLength(1);
    expect(templateBlock(source, '@if (pageCount() > 1) {')).toContain('data-cy="calendar-pagination"');
  });

  it('pagination appears past twenty', async () => {
    const { component } = setup({ params: { view: 'list' }, itemCount: 21 });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.pageCount()).toBe(2);
  });

  it('moving page navigates with the page parameter', async () => {
    const { component, navigate } = setup({ params: { view: 'list' }, itemCount: 45 });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    navigate.mockClear();

    component.movePage(1);

    expect(navigate).toHaveBeenCalled();
    const [, extras] = navigate.mock.calls[0] as [unknown, { queryParams: Record<string, string> }];
    expect(extras.queryParams['page']).toBe('2');
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
    const source = readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8');
    const listIndex = source.indexOf('data-cy="calendar-list"');
    const paginationIndex = source.indexOf('data-cy="calendar-pagination"');
    expect(listIndex).toBeGreaterThan(-1);
    expect(paginationIndex).toBeGreaterThan(listIndex);

    const calendarViewStart = source.indexOf("query().view === 'calendar'");
    const listViewStart = source.indexOf("} @else {", calendarViewStart);
    expect(paginationIndex).toBeGreaterThan(listViewStart);
  });
});

describe('PublicCalendarComponent day-cell events', () => {
  const source = readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8');

  it('day cells render their events', () => {
    const cellStart = source.indexOf('class="public-month-day"');
    expect(cellStart).toBeGreaterThan(-1);
    const cellEnd = source.indexOf('</article>', cellStart);
    const cell = source.slice(cellStart, cellEnd);

    expect(cell).toContain('visibleDayEvents(day.date)');
    expect(cell).toContain('calendar-month-day-event-');
  });

  it('the calendar tab lists nothing under the grid', () => {
    const calendarBlock = templateBlock(source, "@if (query().view === 'calendar') {");

    expect(calendarBlock).not.toContain('data-cy="calendar-list"');
    expect(calendarBlock).not.toContain('calendar-venue-date-');
    expect(calendarBlock).not.toContain('data-cy="calendar-pagination"');
  });

  it('the list tab keeps its list', () => {
    const calendarViewStart = source.indexOf("query().view === 'calendar'");
    const elseStart = source.indexOf('} @else {', calendarViewStart);
    expect(elseStart).toBeGreaterThan(-1);
    const listBlock = templateBlock(source.slice(elseStart + 2), '@else {');

    expect(listBlock).toContain('data-cy="calendar-list"');
    expect(listBlock).toContain('data-cy="calendar-pagination"');
  });
});

describe('PublicCalendarComponent list card', () => {
  const source = readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8');
  const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');
  const cardTag = source.slice(source.indexOf('<article class="panel public-tournament-card"'), source.indexOf('>', source.indexOf('<article class="panel public-tournament-card"')));
  const cardActions = source.slice(source.indexOf('data-cy="calendar-card-actions"'), source.indexOf('</article></ng-template>'));

  it('clicking the card navigates to the event page', async () => {
    const { component, navigate } = setup({ params: { view: 'list' } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    navigate.mockClear();

    component.openTournament(tournament);

    expect(navigate).toHaveBeenCalledWith(['/calendar/tournaments', 'lyon-legacy']);
  });

  // Space would scroll the page before it ever reached the card, so the handler takes the event.
  it('space on a focused card navigates without scrolling the page', async () => {
    const { component, navigate } = setup({ params: { view: 'list' } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    navigate.mockClear();
    const event = { preventDefault: vi.fn() } as unknown as Event;

    component.openTournament(tournament, event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/calendar/tournaments', 'lyon-legacy']);
  });

  it('the card is the click target, and reads as a link to assistive tech', () => {
    expect(cardTag).toContain('(click)="openTournament(item)"');
    expect(cardTag).toContain('(keydown.enter)="openTournament(item)"');
    expect(cardTag).toContain('(keydown.space)="openTournament(item, $event)"');
    expect(cardTag).toContain('role="link"');
    expect(cardTag).toContain('tabindex="0"');
    expect(cardTag).toContain('[attr.aria-label]="item.title"');
  });

  // The card handler sits on the ancestor: without stopPropagation, downloading the ICS or
  // following the title link would also fire the card's navigation.
  it('clicking add to calendar does not navigate', () => {
    const icsMarker = cardActions.indexOf('data-cy="calendar-card-ics"');
    const icsAnchor = cardActions.slice(cardActions.lastIndexOf('<a', icsMarker), cardActions.indexOf('</a>', icsMarker));

    expect(icsAnchor).toContain('(click)="$event.stopPropagation()"');
    expect(icsAnchor).toContain('[href]="service.icsUrl(item.slug)"');
  });

  // Enter on the anchor bubbles as a keydown *before* the click it synthesises, so the click guard
  // alone would still let the card navigate the reader away from their download.
  it('keyboard activation of add to calendar does not navigate either', () => {
    const icsMarker = cardActions.indexOf('data-cy="calendar-card-ics"');
    const icsAnchor = cardActions.slice(cardActions.lastIndexOf('<a', icsMarker), cardActions.indexOf('</a>', icsMarker));

    expect(icsAnchor).toContain('(keydown.enter)="$event.stopPropagation()"');
    expect(icsAnchor).toContain('(keydown.space)="$event.stopPropagation()"');
  });

  it('the title link stays and stops the card handler firing twice', () => {
    const titleAnchor = source.slice(source.indexOf('data-cy="calendar-card-title"'), source.indexOf('data-cy="calendar-card-date"'));

    expect(titleAnchor).toContain('data-cy="calendar-card-link"');
    expect(titleAnchor).toContain('(click)="$event.stopPropagation()"');
  });

  it('the view page button is gone', () => {
    expect(source).not.toContain('data-cy="calendar-card-view"');
    expect(cardActions).toContain('data-cy="calendar-card-ics"');
  });

  it('the card date line drops the zone and the viewer-time line stays', () => {
    const cardBody = source.slice(source.indexOf('data-cy="calendar-card-body"'), source.indexOf('data-cy="calendar-card-venue"'));

    expect(cardBody).toContain('data-cy="calendar-card-date">{{ cardDate(item) }}');
    expect(cardBody).not.toContain('date(item).primary');
    expect(cardBody).toContain('data-cy="calendar-card-viewer-date"');
  });

  it('the card date carries no zone short name and no IANA id', async () => {
    const { component } = setup({ params: { view: 'list' } });
    component.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.cardDate(tournament)).not.toContain('Europe/Paris');
    expect(component.cardDate(tournament)).not.toContain('(');
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
});

describe('PublicCalendarComponent past day cells', () => {
  const source = readFileSync(join(__dirname, 'public-calendar.component.ts'), 'utf8');
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

  it('the day cell binds the past class and the past marker', () => {
    const cellStart = source.indexOf('class="public-month-day"');
    expect(cellStart).toBeGreaterThan(-1);
    const cell = source.slice(cellStart, source.indexOf('>', cellStart));

    expect(cell).toContain('[class.public-month-day--past]="isPast(day.date)"');
    expect(cell).toContain(`[attr.data-cy]="isPast(day.date) ? 'calendar-month-day-past' : 'calendar-month-day'"`);
  });

  it('the past cell is dimmed with a muted day number', () => {
    expect(stylesheet).toContain('.public-month-day--past { opacity: .5; }');
    expect(stylesheet).toContain('.public-month-day--past > time { color: var(--steel); font-weight: 700; }');
  });
});
