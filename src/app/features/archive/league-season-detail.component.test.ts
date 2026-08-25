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
import { ActivatedRoute } from '@angular/router';
import { ArchiveLeagueSeasonRow, ArchiveTournamentRow } from '../../data/archive-repository.service';
import { I18nService } from '../../i18n/i18n.service';
import { translate } from '../../i18n/messages';
import { DeckArchetypeSettingsService, SettingsLanguage } from '../../shared/deck-archetype-settings.service';
import {
  ARCHIVE_SEASON_SOURCE,
  ArchiveSeasonSource,
  LeagueSeasonDetailComponent,
  SEASON_EXPANSION_PREVIEW_LIMIT,
  SeasonTournamentsSource,
  readSeasonTournaments
} from './league-season-detail.component';
import { LeagueSeasonListComponent, LeagueSeasonRow } from './league-season-list.component';

const detailSource = readFileSync(join(__dirname, 'league-season-detail.component.ts'), 'utf8');
const listSource = readFileSync(join(__dirname, 'league-season-list.component.ts'), 'utf8');

/** The source slice a block owns, from its opening `{` to the `}` that balances it. */
function block(source: string, opening: string): string {
  const start = source.indexOf(opening);
  expect(start, `block "${opening}"`).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = start + opening.length - 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unbalanced block "${opening}"`);
}

function tournamentRow(overrides: Partial<ArchiveTournamentRow> = {}): ArchiveTournamentRow {
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

function seasonRow(overrides: Partial<ArchiveLeagueSeasonRow> = {}): ArchiveLeagueSeasonRow {
  return {
    id: 's-1',
    name: 'Ligue Lyon 2026',
    leagueId: 'lg-1',
    status: 'active',
    updatedAt: '2026-02-15T10:00:00Z',
    documentVersion: 2,
    tournamentCount: 3,
    playerCount: 12,
    firstTournamentDate: '2026-01-04',
    lastTournamentDate: '2026-02-14',
    isLocal: false,
    ...overrides
  };
}

/** The Tab 1 row: the catalog row joined to its League name and stamped with the derived lock. */
function listRow(overrides: Partial<ArchiveLeagueSeasonRow> = {}): LeagueSeasonRow {
  return { ...seasonRow(overrides), leagueName: 'Ligue Lyon', locked: false };
}


/** A source that records every member touched, so "the read path wrote nothing" is observable. */
function recordingSource(result: { items: ArchiveTournamentRow[]; fromCache: boolean; truncated?: boolean }): {
  source: SeasonTournamentsSource;
  calls: string[];
} {
  const calls: string[] = [];
  const target: SeasonTournamentsSource = {
    listSeasonTournaments: async (season) => {
      calls.push(`listSeasonTournaments:${season.id}`);
      return { truncated: false, ...result };
    }
  };
  const source = new Proxy(target, {
    get(object, property: string | symbol) {
      if (property !== 'listSeasonTournaments' && property !== 'then') {
        throw new Error(`the season read path touched a forbidden member: ${String(property)}`);
      }
      return Reflect.get(object, property) as unknown;
    }
  });
  return { source, calls };
}

function buildSeasonPage(overrides: Partial<ArchiveSeasonSource> = {}, seasonId = 's-1'): LeagueSeasonDetailComponent {
  const source: ArchiveSeasonSource = {
    listSeasonTournaments: async () => ({ items: [], fromCache: true, truncated: false }),
    getSeason: async () => seasonRow(),
    getLeagueName: async () => 'Ligue Lyon',
    ...overrides
  };
  const injector = Injector.create({
    providers: [
      { provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>('en') } },
      { provide: I18nService, useClass: I18nService },
      { provide: ARCHIVE_SEASON_SOURCE, useValue: source },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => seasonId } } } },
      { provide: LeagueSeasonDetailComponent, useClass: LeagueSeasonDetailComponent }
    ]
  });
  return runInInjectionContext(injector, () => injector.get(LeagueSeasonDetailComponent));
}

function buildTab1(source: Partial<SeasonTournamentsSource> = {}): LeagueSeasonListComponent {
  const injector = Injector.create({
    providers: [
      { provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>('en') } },
      { provide: I18nService, useClass: I18nService },
      {
        provide: ARCHIVE_SEASON_SOURCE,
        useValue: { listSeasonTournaments: async () => ({ items: [], fromCache: true, truncated: false }), ...source }
      },
      {
        provide: 'ArchiveRepositoryStub',
        useValue: {}
      }
    ]
  });
  // The list component's own catalog repository is not exercised here: only the expansion members
  // are, and they reach ARCHIVE_SEASON_SOURCE. Its constructor load is stubbed by the router double.
  return runInInjectionContext(injector, () =>
    Object.create(LeagueSeasonListComponent.prototype, Object.getOwnPropertyDescriptors(
      expansionHarness(injector.get(I18nService), injector.get(ARCHIVE_SEASON_SOURCE))
    )) as LeagueSeasonListComponent);
}

/** The expansion state the component owns, built without its catalog constructor. */
function expansionHarness(i18n: I18nService, seasonSource: SeasonTournamentsSource): Record<string, unknown> {
  return {
    i18n,
    seasonSource,
    expandedSeasonId: signal<string | null>(null),
    expansion: signal({ status: 'loading' as const })
  };
}

describe('season tournaments read path', () => {
  it('reports a cache-served list as cache origin', async () => {
    const { source, calls } = recordingSource({ items: [tournamentRow()], fromCache: true });
    const read = await readSeasonTournaments(seasonRow(), source);
    expect(read.origin).toBe('cache');
    expect(read.items.map((row) => row.id)).toEqual(['t-1']);
    expect(calls).toEqual(['listSeasonTournaments:s-1']);
  });

  it('reports a read-through list as server origin', async () => {
    const { source, calls } = recordingSource({ items: [tournamentRow({ id: 't-2' })], fromCache: false });
    const read = await readSeasonTournaments(seasonRow(), source);
    expect(read.origin).toBe('server');
    expect(read.items.map((row) => row.id)).toEqual(['t-2']);
    expect(calls).toEqual(['listSeasonTournaments:s-1']);
  });

  it('carries the server half’s row cap through untouched', async () => {
    const truncated = recordingSource({ items: [], fromCache: false, truncated: true });
    const whole = recordingSource({ items: [], fromCache: true, truncated: false });

    expect(await readSeasonTournaments(seasonRow(), truncated.source)).toMatchObject({ origin: 'server', truncated: true });
    expect(await readSeasonTournaments(seasonRow(), whole.source)).toMatchObject({ origin: 'cache', truncated: false });
  });

  it('never writes the cache on the read-through path', async () => {
    const { source, calls } = recordingSource({ items: [], fromCache: false });
    await expect(readSeasonTournaments(seasonRow(), source)).resolves.toBeDefined();
    // The proxy throws on any member other than the single read, so an empty call log beyond it is
    // proof by construction as well as by observation.
    expect(calls).toEqual(['listSeasonTournaments:s-1']);
  });

  it('passes the season span through untouched, so one module decides the cache question', async () => {
    const spans: unknown[] = [];
    const source: SeasonTournamentsSource = {
      listSeasonTournaments: async (season) => {
        spans.push(season);
        return { items: [], fromCache: true, truncated: false };
      }
    };
    const season = seasonRow({ firstTournamentDate: null, lastTournamentDate: null });
    const read = await readSeasonTournaments(season, source);
    expect(read).toEqual({ origin: 'cache', items: [], truncated: false });
    expect(spans).toEqual([season]);
  });

  it('imports no cache writer', () => {
    // The doc comment names the backfill queue as the single writer; what must not exist is a way
    // to reach it from here.
    expect(detailSource).not.toMatch(/from '[^']*archive-backfill-queue'/);
    expect(detailSource).not.toMatch(/from '[^']*archive-cache\.service'/);
    expect(detailSource).not.toContain('writeYearPartition');
    expect(detailSource).not.toContain('completedAt');
    expect(detailSource).not.toMatch(/\bindexedDB\b/);
    expect(detailSource).not.toMatch(/\bIDB[A-Za-z]*\b/);
  });

  it('declares a source port with no writer', () => {
    const port = block(detailSource, 'export interface SeasonTournamentsSource {');
    const members = [...port.matchAll(/^\s{2}(\w+)/gm)].map((match) => match[1]);
    expect(members).toEqual(['listSeasonTournaments']);
  });

  it('derives no second year-span or lock rule of its own', () => {
    expect(detailSource).not.toContain('seasonSpanYears');
    expect(detailSource).not.toContain('isArchiveYearLocked');
    expect(detailSource).not.toContain('12-31');
  });
});

describe('league season detail page', () => {
  it('renders its tournaments through the read path', async () => {
    const page = buildSeasonPage({ listSeasonTournaments: async () => ({ items: [tournamentRow()], fromCache: false, truncated: false }) });
    await page.load();
    expect(page.tournaments().map((row) => row.id)).toEqual(['t-1']);
    expect(page.origin()).toBe('server');
    expect(page.error()).toBe('');
  });

  it('says so when the list came from the server', () => {
    expect(detailSource).toContain('archive-season-read-through');
    expect(block(detailSource, "@if (origin() === 'server') {")).toContain('archive-season-read-through');
  });

  it('renders the not-found card for a missing season, not an error', async () => {
    const page = buildSeasonPage({ getSeason: async () => undefined });
    await page.load();
    expect(page.notFound()).toBe(true);
    expect(page.error()).toBe('');
  });

  it('renders the error when the season read rejects', async () => {
    const page = buildSeasonPage({
      getSeason: async () => {
        throw new Error('offline');
      }
    });
    await page.load();
    expect(page.error()).toBe(translate('en', 'archiveSeason.loadOneFailed'));
    expect(page.notFound()).toBe(false);
  });

  it('marks a season whose latest tournament is locked', async () => {
    const page = buildSeasonPage({ getSeason: async () => seasonRow({ lastTournamentDate: '2019-01-04' }) });
    await page.load();
    expect(page.locked()).toBe(true);
  });

  it('carries both back buttons', () => {
    expect(detailSource).toContain('position="top"');
    expect(detailSource).toContain('position="bottom"');
  });

  it('marks a browser-local Season and never locks it', async () => {
    const page = buildSeasonPage(
      { getSeason: async () => seasonRow({ id: 'local-1', isLocal: true, lastTournamentDate: '1990-01-01' }) },
      'local-1'
    );
    await page.load();

    expect(page.season()?.isLocal).toBe(true);
    expect(page.locked()).toBe(false);
    expect(block(detailSource, '@if (season()?.isLocal) {')).toContain('archive-season-local-badge');
  });

  it('never locks a browser-local Tournament of the Season, however old it is', async () => {
    const page = buildSeasonPage();
    await page.load();

    expect(page.isLocked(tournamentRow({ id: 'local-t1', isLocal: true, tournamentDate: '1990-01-01' }))).toBe(false);
    expect(page.isLocked(tournamentRow({ id: 't-1', tournamentDate: '1990-01-01' }))).toBe(true);
  });

  it('badges a browser-local Tournament in the Season’s list', () => {
    expect(detailSource.match(/data-cy\]="'archive-season-tournament-local-/g)).toHaveLength(1);
    expect(block(detailSource, '@if (child.isLocal) {')).toContain(`i18n.t('archive.localBadge')`);
  });
});

describe('tab 1 season expansion', () => {
  it('marks the row expandable in the markup', () => {
    // The expander button owns `aria-expanded`: on a `role=row` outside a treegrid the attribute is
    // an axe `aria-conditional-attr` violation and nothing reads it.
    const expanderStart = listSource.indexOf('<button type="button" class="archive-expand"');
    expect(expanderStart, 'the expander button').toBeGreaterThan(-1);
    const expander = listSource.slice(expanderStart, listSource.indexOf('</button>', expanderStart));
    expect(expander).toContain('[attr.aria-expanded]="isSeasonExpanded(row.id)"');
    expect(expander).toContain('[attr.aria-controls]="seasonChildrenRowId(row.id)"');
    expect(expander).toContain('[attr.aria-label]="expandLabel(row)"');
    expect(expander).toContain("'archive-seasons-expand-' + row.id");
    expect(listSource).toContain('class="archive-children"');
    expect(listSource).toContain('toggleSeasonExpansion(row)');
    // The row itself carries no ARIA expansion state.
    const rowTag = listSource.slice(listSource.indexOf(`<tr [attr.data-cy]="'archive-seasons-row-'`), listSource.indexOf('<td [attr.data-cy]="\'archive-seasons-cell-name-'));
    expect(rowTag).not.toContain('aria-expanded');
  });

  it('points aria-controls at the id the children row actually renders', () => {
    const tab = buildTab1();
    const row = listRow({ id: 's-a' });
    // The children `<tr>` binds `[id]="seasonChildrenRowId(row.id)"`, so the same call resolves both
    // ends of the pairing — a dangling `aria-controls` is the failure that replaces the removed one.
    expect(listSource).toContain('[id]="seasonChildrenRowId(row.id)"');
    expect(tab.seasonChildrenRowId(row.id)).toBe('archive-season-children-s-a');
    expect(tab.isSeasonExpanded(row.id)).toBe(false);
  });

  it('tracks the expansion state on the button label as well as the attribute', async () => {
    const tab = buildTab1();
    const row = listRow({ id: 's-a', name: 'Ligue Lyon 2026' });
    expect(tab.expandLabel(row)).toBe(translate('en', 'archiveSeason.expandAria', { name: row.name }));
    await tab.toggleSeasonExpansion(row);
    expect(tab.isSeasonExpanded(row.id)).toBe(true);
    expect(tab.expandLabel(row)).toBe(translate('en', 'archiveSeason.collapseAria', { name: row.name }));
  });

  it('uses the shared read path rather than a second one', () => {
    expect(listSource).toContain('readSeasonTournaments(');
    expect(listSource).toMatch(/import \{[^}]*readSeasonTournaments[^}]*\} from '\.\/league-season-detail\.component'/s);
  });

  it('renders the expanded children as links, not a nested table', () => {
    const start = listSource.indexOf('<div class="archive-child-list"');
    expect(start, 'the expanded child list').toBeGreaterThan(-1);
    const list = listSource.slice(start, listSource.indexOf('</div>', start));
    expect(list).toContain('<a class="archive-child-line"');
    expect(list).not.toContain('<table');
  });

  it('collapses the first season when a second one is expanded', async () => {
    const tab = buildTab1();
    await tab.toggleSeasonExpansion(listRow({ id: 's-a' }));
    await tab.toggleSeasonExpansion(listRow({ id: 's-b' }));
    expect(tab.isSeasonExpanded('s-a')).toBe(false);
    expect(tab.isSeasonExpanded('s-b')).toBe(true);
  });

  it('collapses a season toggled twice', async () => {
    const tab = buildTab1();
    const season = listRow({ id: 's-a' });
    await tab.toggleSeasonExpansion(season);
    await tab.toggleSeasonExpansion(season);
    expect(tab.expandedSeasonId()).toBe(null);
  });

  it('lists the browser-local Tournaments of an expanded browser-local Season, each badged', async () => {
    const items = [tournamentRow({ id: 'local-t1', isLocal: true }), tournamentRow({ id: 'local-t2', isLocal: true })];
    const tab = buildTab1({ listSeasonTournaments: async () => ({ items, fromCache: true, truncated: false }) });

    await tab.toggleSeasonExpansion(listRow({ id: 'local-1', isLocal: true }));

    expect(tab.expandedChildren().map((child) => child.id)).toEqual(['local-t1', 'local-t2']);
    expect(tab.expandedChildren().every((child) => child.isLocal)).toBe(true);
    expect(listSource.match(/data-cy\]="'archive-seasons-child-local-/g)).toHaveLength(1);
  });

  it('caps the expanded list and offers the rest', async () => {
    const items = Array.from({ length: 14 }, (_, index) => tournamentRow({ id: `t-${index}` }));
    const tab = buildTab1({ listSeasonTournaments: async () => ({ items, fromCache: true, truncated: false }) });
    await tab.toggleSeasonExpansion(listRow());
    expect(tab.expandedChildren().length).toBe(SEASON_EXPANSION_PREVIEW_LIMIT);
    expect(tab.hasMoreChildren()).toBe(true);
    expect(tab.expandedTotal()).toBe(14);
  });

  it('offers no show-all line for a short list', async () => {
    const items = Array.from({ length: 3 }, (_, index) => tournamentRow({ id: `t-${index}` }));
    const tab = buildTab1({ listSeasonTournaments: async () => ({ items, fromCache: true, truncated: false }) });
    await tab.toggleSeasonExpansion(listRow());
    expect(tab.expandedChildren().length).toBe(3);
    expect(tab.hasMoreChildren()).toBe(false);
  });

  it('renders the failure line when the expansion read rejects', async () => {
    const tab = buildTab1({
      listSeasonTournaments: async () => {
        throw new Error('offline');
      }
    });
    await tab.toggleSeasonExpansion(listRow());
    expect(tab.expansion().status).toBe('failed');
    expect(tab.expandedChildren()).toEqual([]);
  });
});
