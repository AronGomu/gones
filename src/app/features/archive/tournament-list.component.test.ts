import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// No TestBed / zone.js in this repo, so `effect()` — which drags `ChangeDetectionScheduler` into
// I18nService — is stubbed and the component is built in a bare Injector.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { ArchiveTournamentRow } from '../../data/archive-repository.service';
import { I18nService } from '../../i18n/i18n.service';
import { translate } from '../../i18n/messages';
import { DeckArchetypeSettingsService, SettingsLanguage } from '../../shared/deck-archetype-settings.service';
import { ARCHIVE_SEARCH_DEBOUNCE_MS } from './league-season-list.component';
import {
  ARCHIVE_TOURNAMENT_SORT_KEYS,
  ARCHIVE_TOURNAMENT_TAB_SOURCE,
  ArchiveTournamentQuery,
  ArchiveTournamentTabSource,
  ArchiveYearRows,
  TournamentListComponent,
  archiveTournamentQueryParams,
  filterArchiveTournamentRows,
  parseArchiveTournamentQuery,
  sortArchiveTournamentRows,
  toggleArchiveTournamentSort
} from './tournament-list.component';

const source = readFileSync(join(__dirname, 'tournament-list.component.ts'), 'utf8');

const params = (query: string) => new URLSearchParams(query);

const DEFAULT_QUERY: ArchiveTournamentQuery = {
  sort: 'date',
  dir: 'desc',
  page: 1,
  size: 25,
  search: '',
  year: null,
  season: null
};

function row(overrides: Partial<ArchiveTournamentRow> = {}): ArchiveTournamentRow {
  return {
    id: 't-1',
    name: 'Étape 1',
    seasonId: 's-1',
    tournamentDate: '2026-02-14',
    status: 'completed',
    updatedAt: '2026-02-15T10:00:00Z',
    documentVersion: 1,
    playerCount: 8,
    isLocal: false,
    ...overrides
  };
}

const leagueOf = (names: Record<string, string>) => (item: ArchiveTournamentRow) =>
  item.seasonId === null ? '' : names[item.seasonId] ?? '';

interface Harness {
  component: TournamentListComponent;
  router: { navigate: ReturnType<typeof vi.fn> };
  loadYear: ReturnType<typeof vi.fn>;
  listYears: ReturnType<typeof vi.fn>;
}

function build(options: {
  query?: string;
  years?: { year: number; locked: boolean; tournamentCount: number }[];
  rows?: ArchiveTournamentRow[];
  yearRows?: ArchiveYearRows;
  seasonLeagues?: Map<string, string>;
  listYears?: ReturnType<typeof vi.fn>;
  loadYear?: ReturnType<typeof vi.fn>;
} = {}): Harness {
  const years = options.years ?? [
    { year: 2024, locked: true, tournamentCount: 2 },
    { year: 2026, locked: false, tournamentCount: 3 }
  ];
  const listYears = options.listYears ?? vi.fn(async () => years);
  const loadYear = options.loadYear
    ?? vi.fn(async () => options.yearRows ?? { items: options.rows ?? [row()], totalCount: (options.rows ?? [row()]).length, truncated: false, syncedAt: '2026-08-22T08:00:00Z', stale: false });
  const source: ArchiveTournamentTabSource = {
    listYears: listYears as unknown as ArchiveTournamentTabSource['listYears'],
    loadYear: loadYear as unknown as ArchiveTournamentTabSource['loadYear'],
    listSeasonLeagueNames: async () => options.seasonLeagues ?? new Map([['s-1', 'Ligue Lyon']])
  };
  const router = { navigate: vi.fn() };
  const injector = Injector.create({
    providers: [
      { provide: ARCHIVE_TOURNAMENT_TAB_SOURCE, useValue: source },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(params(options.query ?? '')) } },
      { provide: Router, useValue: router },
      { provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>('en') } },
      I18nService
    ]
  });
  const component = runInInjectionContext(injector, () => new TournamentListComponent());
  return { component, router, loadYear, listYears };
}

/** The constructor kicks off an async load; let its microtasks drain before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('parseArchiveTournamentQuery', () => {
  it('defaults every field', () => {
    expect(parseArchiveTournamentQuery(params(''))).toEqual(DEFAULT_QUERY);
  });

  it('reads every field', () => {
    expect(parseArchiveTournamentQuery(params('sort=players&dir=asc&page=3&size=100&search=lyon&year=2024&season=s1'))).toEqual({
      sort: 'players', dir: 'asc', page: 3, size: 100, search: 'lyon', year: 2024, season: 's1'
    });
  });

  it('rejects an unknown sort key', () => {
    expect(parseArchiveTournamentQuery(params('sort=rating')).sort).toBe('date');
  });

  it('rejects an unknown page size', () => {
    expect(parseArchiveTournamentQuery(params('size=42')).size).toBe(25);
  });

  it('rejects a non-integer year', () => {
    expect(parseArchiveTournamentQuery(params('year=20x4')).year).toBe(null);
  });
});

describe('archiveTournamentQueryParams', () => {
  it('omits defaults but always writes the year', () => {
    expect(archiveTournamentQueryParams({ ...DEFAULT_QUERY, year: 2026 })).toEqual({ year: 2026 });
  });

  it('round-trips a full query', () => {
    const query: ArchiveTournamentQuery = { sort: 'players', dir: 'asc', page: 3, size: 100, search: 'lyon', year: 2024, season: 's1' };
    const serialised = archiveTournamentQueryParams(query);
    expect(parseArchiveTournamentQuery(new URLSearchParams(serialised as Record<string, string>))).toEqual(query);
  });
});

describe('toggleArchiveTournamentSort', () => {
  it('opens a new key descending', () => {
    expect(toggleArchiveTournamentSort({ ...DEFAULT_QUERY, page: 4 }, 'name')).toMatchObject({ sort: 'name', dir: 'desc', page: 1 });
  });

  it('flips the current key', () => {
    expect(toggleArchiveTournamentSort({ ...DEFAULT_QUERY, page: 4 }, 'date')).toMatchObject({ sort: 'date', dir: 'asc', page: 1 });
  });
});

describe('filterArchiveTournamentRows', () => {
  const names = leagueOf({ 's-1': 'Ligue Lyon' });

  it('matches the tournament name case-insensitively', () => {
    const rows = [row(), row({ id: 't-2', name: 'Autre' })];
    expect(filterArchiveTournamentRows(rows, 'ÉTAPE', null, names).map((item) => item.id)).toEqual(['t-1']);
    expect(filterArchiveTournamentRows(rows, 'étape', null, names).map((item) => item.id)).toEqual(['t-1']);
  });

  it('matches the league name', () => {
    const rows = [row(), row({ id: 't-2', seasonId: null, name: 'Autre' })];
    expect(filterArchiveTournamentRows(rows, 'lyon', null, names).map((item) => item.id)).toEqual(['t-1']);
  });

  it('keeps one season when asked, excluding standalone rows', () => {
    const rows = [row(), row({ id: 't-2', seasonId: 's-2' }), row({ id: 't-3', seasonId: null })];
    expect(filterArchiveTournamentRows(rows, '', 's-1', names).map((item) => item.id)).toEqual(['t-1']);
  });
});

describe('sortArchiveTournamentRows', () => {
  const names = leagueOf({ 's-1': 'Ligue Lyon', 's-2': 'Ardennes' });

  it('sorts by date desc by default, id ascending within a date', () => {
    const rows = [
      row({ id: 'b', tournamentDate: '2026-01-01' }),
      row({ id: 'a', tournamentDate: '2026-01-01' }),
      row({ id: 'c', tournamentDate: '2026-02-01' })
    ];
    expect(sortArchiveTournamentRows(rows, 'date', 'desc', names).map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('sorts by players ascending', () => {
    const rows = [row({ id: 'a', playerCount: 3 }), row({ id: 'b', playerCount: 1 }), row({ id: 'c', playerCount: 2 })];
    expect(sortArchiveTournamentRows(rows, 'players', 'asc', names).map((item) => item.playerCount)).toEqual([1, 2, 3]);
  });

  it('puts a standalone row last in both directions when sorting by league name', () => {
    const rows = [row({ id: 'a', seasonId: null }), row({ id: 'b', seasonId: 's-1' }), row({ id: 'c', seasonId: 's-2' })];
    expect(sortArchiveTournamentRows(rows, 'leagueName', 'asc', names).map((item) => item.id).at(-1)).toBe('a');
    expect(sortArchiveTournamentRows(rows, 'leagueName', 'desc', names).map((item) => item.id).at(-1)).toBe('a');
  });

  it('is total: rows sharing every sorted value fall back to id ascending', () => {
    const rows = [row({ id: 'b' }), row({ id: 'a' })];
    expect(sortArchiveTournamentRows(rows, 'status', 'desc', names).map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('tournaments tab', () => {
  it('selects the newest indexed year on first load', async () => {
    const { router, loadYear } = build();
    await settle();
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate.mock.calls[0][1]).toMatchObject({ queryParams: { year: 2026 }, replaceUrl: true });
    expect(loadYear).not.toHaveBeenCalled();
  });

  it('honours the year in the url', async () => {
    const { router, loadYear } = build({ query: 'year=2024' });
    await settle();
    expect(loadYear).toHaveBeenCalledTimes(1);
    expect(loadYear).toHaveBeenCalledWith(2024, false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('falls back to the newest indexed year when the url year is unknown', async () => {
    const { router } = build({ query: 'year=1999' });
    await settle();
    expect(router.navigate.mock.calls[0][1].queryParams).toMatchObject({ year: 2026 });
  });

  it('asks for no year when the archive is empty', async () => {
    const { component, loadYear, router } = build({ years: [], query: '' });
    await settle();
    expect(loadYear).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.emptyArchive()).toBe(true);
  });

  it('offers the indexed years newest first, and no all-years option', async () => {
    const { component } = build({ query: 'year=2026', years: [
      { year: 2024, locked: true, tournamentCount: 1 },
      { year: 2025, locked: true, tournamentCount: 1 },
      { year: 2026, locked: false, tournamentCount: 1 }
    ] });
    await settle();
    expect(component.yearOptions().map((option) => option.year)).toEqual([2026, 2025, 2024]);
    expect(source).not.toContain('allYears');
  });

  it('renders an empty league line for a standalone tournament', async () => {
    const { component } = build({ query: 'year=2026' });
    await settle();
    expect(component.leagueNameOf(row({ seasonId: null }))).toBe('');
  });

  it('renders an empty league line when the season is unknown', async () => {
    const { component } = build({ query: 'year=2026', seasonLeagues: new Map() });
    await settle();
    expect(component.leagueNameOf(row({ seasonId: 'ghost' }))).toBe('');
  });

  it('renders the league line as a real element even when it is empty', () => {
    const nameStack = source.slice(source.indexOf('archive-tournaments-name-'), source.indexOf('archive-tournaments-dates-'));
    expect(nameStack).toContain('class="archive-sub"');
    // The League sub-line is never guarded. The one conditional the name cell carries is the
    // browser-local badge, which is about the row's authority, not about the line's height.
    expect(nameStack.match(/@if/g)).toHaveLength(1);
    expect(nameStack).toContain('@if (row.isLocal) {');
  });

  it('marks a locked row and leaves a row played exactly 365 days ago unmarked', async () => {
    const { component } = build({ query: 'year=2026' });
    await settle();
    const now = new Date('2026-08-22T00:00:00Z');
    const daysAgo = (days: number) => new Date(Date.UTC(2026, 7, 22 - days)).toISOString().slice(0, 10);
    expect(component.isLocked(row({ tournamentDate: daysAgo(400) }), now)).toBe(true);
    expect(component.isLocked(row({ tournamentDate: daysAgo(365) }), now)).toBe(false);
  });

  it('never marks a browser-local row as locked', async () => {
    const { component } = build({ query: 'year=2026' });
    await settle();
    expect(component.isLocked(row({ id: 'local-1', isLocal: true, tournamentDate: '2019-01-01' }))).toBe(false);
  });

  it('states both counts in the truncation warning', async () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
    const { component } = build({
      query: 'year=2026',
      rows,
      yearRows: { items: rows, totalCount: 6214, truncated: true, syncedAt: '2026-08-22T08:00:00Z', stale: false }
    });
    await settle();
    expect(component.truncated()).toBe(true);
    expect(component.truncationMessage()).toContain('6214');
    expect(component.truncationMessage()).toContain('2026');
  });

  it('pages the sorted rows without repeating an id', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => row({ id: `t-${index}`, tournamentDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}` }));
    const { component } = build({ query: 'year=2026', rows });
    await settle();
    const first = component.pagedRows().map((item) => item.id);
    expect(first.length).toBe(25);
    component.query.set({ ...component.query(), page: 2 });
    const second = component.pagedRows().map((item) => item.id);
    expect(second.length).toBe(5);
    expect(new Set([...first, ...second]).size).toBe(30);
  });

  it('asks the repository for one year and re-derives no year rule of its own', () => {
    // The bucketing rule is `archiveTournamentYear` in the repository, and it is total: an undated
    // browser-local Tournament falls into the current UTC year rather than being dropped. A second
    // rule here would file that record under no year at all.
    expect(source).toContain('repo.listTournaments({ force, year })');
    expect(source).not.toContain('rowsForYear');
    expect(source).not.toContain('archiveRowYear');
  });

  it('resets the page when the search changes', async () => {
    const { component, router } = build({ query: 'year=2026&page=3' });
    await settle();
    router.navigate.mockClear();
    component.setSearchDraft('lyon');
    // Same debounce as Tab 1, imported rather than re-chosen, so both tabs settle together.
    await new Promise((resolve) => setTimeout(resolve, ARCHIVE_SEARCH_DEBOUNCE_MS + 20));
    expect(router.navigate.mock.calls[0][1].queryParams).toEqual({ year: 2026, search: 'lyon' });
  });

  it('renders the error rather than an empty table when the load fails', async () => {
    const { component } = build({ listYears: vi.fn(async () => { throw new Error('offline'); }) });
    await settle();
    expect(component.error()).toBe(translate('en', 'archiveTournaments.loadFailed'));
    expect(component.rows().length).toBe(0);
  });

  it('renders skeleton rows while loading', () => {
    expect(source).toContain('@if (loading())');
    const loadingBlock = source.slice(source.indexOf('@if (loading())'), source.indexOf('@else if'));
    expect(loadingBlock).toContain('class="archive-skel');
  });

  it('joins the shared archive shell rather than rendering a second tab strip', () => {
    expect(source).toContain('activeTab="tournaments"');
    expect(source).toContain('gones-archive-shell');
    expect(source).not.toContain('class="archive-tabs"');
  });

  it('reaches every sort key from the select', () => {
    expect([...ARCHIVE_TOURNAMENT_SORT_KEYS]).toEqual(['name', 'leagueName', 'date', 'updated', 'players', 'status']);
    for (const key of ARCHIVE_TOURNAMENT_SORT_KEYS) {
      expect(source).toContain(`'archive-tournaments-sort-option-' + key`);
      expect(translate('en', `archiveTournaments.sort${key[0].toUpperCase()}${key.slice(1)}` as never)).toBeTruthy();
    }
  });

  it('carries both back buttons', () => {
    expect(source).toContain('position="top"');
    expect(source).toContain('position="bottom"');
  });
});

describe('tournaments tab — browser-local rows (ADR 0028)', () => {
  const localRow = (overrides: Partial<ArchiveTournamentRow> = {}) =>
    row({ id: 'local-1', name: 'Kitchen Table', isLocal: true, ...overrides });

  it('offers a year only a browser-local Tournament occupies', async () => {
    const { component } = build({
      query: 'year=2019',
      years: [{ year: 2025, locked: true, tournamentCount: 3 }, { year: 2019, locked: false, tournamentCount: 1 }]
    });
    await settle();

    expect(component.yearOptions().map((option) => option.year)).toEqual([2025, 2019]);
  });

  it('renders exactly the year the repository unioned, with no second filter of its own', async () => {
    const rows = [row({ id: 't-1', tournamentDate: '2025-06-01' }), localRow({ tournamentDate: '2025-07-01' })];
    const { component, loadYear } = build({
      query: 'year=2025',
      years: [{ year: 2025, locked: false, tournamentCount: 1 }, { year: 2019, locked: false, tournamentCount: 1 }],
      rows
    });
    await settle();

    expect(loadYear).toHaveBeenCalledTimes(1);
    expect(loadYear).toHaveBeenCalledWith(2025, false);
    expect(component.rows().map((item) => item.id)).toEqual(['t-1', 'local-1']);
  });

  it('searches a browser-local Tournament beside a server one', async () => {
    const { component } = build({
      query: 'year=2026&search=kitchen',
      rows: [row({ id: 't-1', name: 'Grand Prix' }), localRow()]
    });
    await settle();

    expect(component.pagedRows().map((item) => item.id)).toEqual(['local-1']);
  });

  it('sorts a browser-local Tournament among the server rows', async () => {
    const { component } = build({
      query: 'year=2026',
      rows: [row({ id: 't-1', tournamentDate: '2025-06-01' }), localRow({ tournamentDate: '2025-07-01' })]
    });
    await settle();

    expect(component.pagedRows()[0].id).toBe('local-1');
  });

  it('counts a browser-local Tournament in the pager and reaches it on page 2', async () => {
    const rows = [
      ...Array.from({ length: 25 }, (_, index) => row({ id: `t-${index}`, tournamentDate: '2026-02-14' })),
      localRow({ tournamentDate: '2019-01-01' })
    ];
    const first = build({ query: 'year=2026', rows });
    const second = build({ query: 'year=2026&page=2', rows });
    await settle();

    expect(first.component.totalRows()).toBe(26);
    expect(first.component.totalPages()).toBe(2);
    expect(first.component.pagedRows().some((item) => item.isLocal)).toBe(false);
    expect(second.component.pagedRows().map((item) => item.id)).toEqual(['local-1']);
  });

  it('holds a local row only when one is on the page', async () => {
    const serverOnly = build({ query: 'year=2026' });
    const withLocal = build({ query: 'year=2026', rows: [localRow()] });
    await settle();

    expect(serverOnly.component.hasLocalRows()).toBe(false);
    expect(withLocal.component.hasLocalRows()).toBe(true);
  });

  it('explains the undated bucket only while an undated local row is shown', async () => {
    const undated = build({ query: 'year=2026', rows: [localRow({ tournamentDate: '' })] });
    const dated = build({ query: 'year=2026', rows: [localRow()] });
    await settle();

    expect(undated.component.localNotice()).toBe(
      `${translate('en', 'archive.localNotice')} ${translate('en', 'archive.localUndated', { year: 2026 })}`);
    expect(undated.component.localNotice()).toContain('2026');
    expect(dated.component.localNotice()).toBe(translate('en', 'archive.localNotice'));
  });

  it('never locks a browser-local row it renders', async () => {
    const { component } = build({ query: 'year=2026', rows: [localRow({ tournamentDate: '1990-01-01' })] });
    await settle();

    expect(component.isLocked(component.pagedRows()[0])).toBe(false);
  });

  it('badges a browser-local row in the name cell, and only there', () => {
    expect(source.match(/data-cy\]="'archive-tournaments-local-badge-/g)).toHaveLength(1);
    const nameCell = source.slice(source.indexOf(`'archive-tournaments-cell-name-'`), source.indexOf(`'archive-tournaments-dates-'`));
    expect(nameCell).toContain(`'archive-tournaments-local-badge-'`);
    expect(nameCell).toContain('@if (row.isLocal) {');
  });

  it('renders the local notice only when the page holds a local row', () => {
    expect(source).toContain('@if (hasLocalRows()) {');
    expect(source).toContain('data-cy="archive-tournaments-local-notice"');
  });
});
