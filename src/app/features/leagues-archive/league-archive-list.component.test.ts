import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { LOCAL_PLACEHOLDER_LEAGUE_ID } from '../../data/league-archive-origin';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { LeagueArchiveSummary } from '../../data/league-archive-summary';
import { PLACEHOLDER_LEAGUE_ID } from '../../domain/models';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService, SettingsLanguage } from '../../shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { LeagueArchiveCatalogCacheService } from './league-archive-catalog-cache.service';
import { LeagueArchiveListComponent } from './league-archive-list.component';
import { catalogs } from '../../i18n/messages';

/**
 * ADR 0028 turns the League list into a heterogeneous grid: the create affordance is offered to
 * everyone because every visitor can always write their own browser store, and the rows that live
 * there say so. These are source assertions — the component drives Material and a Router, and this
 * repo has no TestBed to render it in — so each one pins the exact template shape the Cypress spec
 * then drives for real.
 */
const source = readFileSync(join(__dirname, 'league-archive-list.component.ts'), 'utf8');

/**
 * The source slice a control-flow block owns, from its opening `{` to the `}` that balances it.
 * Lets an assertion say "this element is *inside* that guard" rather than "both strings exist
 * somewhere in the file", which a badge hoisted out of the guard would still satisfy.
 */
function templateBlock(opening: string): string {
  const start = source.indexOf(opening);
  expect(start, `template block "${opening}"`).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = start + opening.length - 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unbalanced template block "${opening}"`);
}

describe('league archive list template', () => {
  it('offers create only after browser Power User opt-in, without adding a role gate', () => {
    expect(source.match(/data-cy="leagues-archive-list-create-card"/g)).toHaveLength(1);
    expect(templateBlock('@if (power.enabled()) {')).toContain('data-cy="leagues-archive-list-create-card"');
    expect(source).not.toContain('@if (canManage())');
    expect(source).not.toMatch(/readonly canManage = computed/);
  });

  it('the read-only notice is about server leagues only', () => {
    expect(source).toContain('@if (hasUnmanageableServerLeagues()) { <p class="muted" data-cy="leagues-archive-list-read-only"');
  });

  it('local rows are badged, and only local rows', () => {
    // Asserting the guard and the badge independently is satisfied by a badge hoisted out of the
    // guard with a dummy element left inside — which would badge every server row too. The badge is
    // rendered exactly once in the template, and that one occurrence is inside the local guard.
    expect(source.match(/data-cy="leagues-archive-list-item-local-badge"/g)).toHaveLength(1);
    expect(templateBlock('@if (isLocal(league)) {')).toContain('data-cy="leagues-archive-list-item-local-badge"');
  });

  it('the local notice explains the store', () => {
    expect(source).toContain('data-cy="leagues-archive-local-notice"');
    expect(source).toContain("i18n.t('leagues.localNotice')");
  });

  it('a failed server read is surfaced, not swallowed', () => {
    expect(source).toContain('@if (repo.serverUnavailable()) {');
    expect(source).toContain('data-cy="leagues-archive-server-unavailable"');
  });

  // A capped catalog (ADR 0039) renders a shorter list that looks exactly like a complete one. The
  // page has to say so, because nothing else on it distinguishes the two.
  it('a capped catalog is surfaced too', () => {
    expect(source).toContain('@if (repo.catalogTruncated()) {');
    expect(source).toContain('data-cy="leagues-archive-truncated"');
    expect(source).toContain("i18n.t('leagues.truncated')");
  });

  it('renders the sync bar', () => {
    expect(source).toContain('gones-sync-bar');
    expect(source).toContain('cyPrefix="leagues-archive-list"');
    // SyncBarComponent produces data-cy="{prefix}-sync-button"
    expect(source).toContain('cyPrefix="leagues-archive-list"');
  });

  it('sync forces a refetch', () => {
    expect(source).toContain('sync(): void { void this.load({ force: true }); }');
  });

  it('always reads local leagues live', () => {
    expect(source).toContain('this.repo.listLocalLeagueSummaries()');
    expect(source).toContain('this.catalogCache.load(options)');
  });

  /**
   * ADR 0042: both counts arrive on the row. Recomputing either one here would mean holding the
   * documents this slice exists to stop downloading.
   */
  it('never recomputes a count the catalog already carries', () => {
    expect(source).not.toContain('calculateLeagueResult');
    expect(source).not.toContain('playerCount(league');
    expect(source).not.toContain('league.tournaments');
  });

  /**
   * ADR 0039: creating a League here must not leave it missing from this very page for 24h. The
   * create stays on the list rather than announcing `gones-league-updated`, so it drops the snapshot
   * itself.
   */
  it('drops the catalog snapshot after a successful create', () => {
    const body = source.slice(source.indexOf('async createLeague(): Promise<void>'));
    const handler = body.slice(0, body.indexOf('\n  }'));
    expect(handler).toContain('const league = await this.repo.createLeague(name);\n      clearLeagueCatalogCache();');
  });

  it('both placeholders are hidden and labelled the same way', () => {
    expect(source).toContain('!isAnyPlaceholderLeagueId(league.id) || league.tournamentCount > 0');
    expect(source).toContain("isAnyPlaceholderLeagueId(league.id) ? this.i18n.t('liveList.unassigned') : league.name");
  });
});

/**
 * The behavioural half. Same harness as `global-stats.component.test.ts`: no TestBed in this repo, so
 * the component is built in a bare `Injector` and its public surface driven directly. These pin what
 * the template *renders* through, which the source assertions above cannot.
 */
function summary(overrides: Partial<LeagueArchiveSummary> = {}): LeagueArchiveSummary {
  return { id: 'server-1', name: 'Server League', status: 'active', tournamentCount: 2, playerCount: 3, isLocal: false, ...overrides };
}

/** The constructor loads; these tests wait that fire-and-forget read out rather than calling it twice. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function buildComponent(options: { server?: LeagueArchiveSummary[]; local?: LeagueArchiveSummary[]; language?: SettingsLanguage } = {}) {
  const load = vi.fn(async () => ({
    items: options.server ?? [summary()],
    fetchedAt: '2026-08-20T10:00:00.000Z',
    fromCache: false,
    stale: false,
    truncated: false
  }));
  const listLocalLeagueSummaries = vi.fn(async () => options.local ?? []);
  const injector = Injector.create({ providers: [
    { provide: LeagueArchiveCatalogCacheService, useValue: { load } },
    { provide: LeagueArchiveRepository, useValue: { listLocalLeagueSummaries, serverUnavailable: signal(false), catalogTruncated: signal(false) } },
    { provide: PowerUserSettingsService, useValue: { enabled: () => true } },
    // The real service defaults to French and reads `localStorage`; the language is pinned here so the
    // rendered meta line is a stable assertion rather than a property of the test environment.
    { provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>(options.language ?? 'en') } },
    I18nService
  ] });
  const repo = injector.get(LeagueArchiveRepository);
  const auth = { profile: () => ({ globalRole: 'Organizer' }) } as unknown as AuthService;
  const router = { navigate: vi.fn(async () => true) } as unknown as Router;
  const dialog = { open: vi.fn() } as unknown as MatDialog;
  const component = runInInjectionContext(injector, () => new LeagueArchiveListComponent(repo, auth, router, dialog));
  return { component, load, listLocalLeagueSummaries };
}

describe('league archive list behaviour', () => {
  it('renders the meta line from the stored counts', async () => {
    const { component } = buildComponent();
    await settled();

    expect(component.leagueMeta(summary({ tournamentCount: 2, playerCount: 3 }))).toBe('2 Tournaments · 3 Players');
    expect(component.leagueMeta(summary({ tournamentCount: 1, playerCount: 1 }))).toBe('1 Tournament · 1 Player');
    expect(component.leagueMeta(summary({ tournamentCount: 0, playerCount: 0 }))).toBe('0 Tournaments · 0 Players');
  });

  it('the meta line still goes through i18n', async () => {
    const { component } = buildComponent({ language: 'fr' });
    await settled();

    expect(component.leagueMeta(summary({ tournamentCount: 2, playerCount: 3 }))).toBe('2 tournois · 3 joueurs');
  });

  it('merges server summaries with local ones', async () => {
    const { component } = buildComponent({
      server: [summary({ id: 'server-1', name: 'Server League' })],
      local: [summary({ id: 'local-1', name: 'Local League', isLocal: true })]
    });

    await settled();

    expect(component.filteredLeagues().map((item) => item.id)).toEqual(['server-1', 'local-1']);
    expect(component.filteredLeagues().map((item) => component.isLocal(item))).toEqual([false, true]);
  });

  it('hides an empty placeholder league', async () => {
    const { component } = buildComponent({
      server: [summary({ id: PLACEHOLDER_LEAGUE_ID, name: 'Unassigned Tournaments', tournamentCount: 0, playerCount: 0 }), summary({ id: 'server-2' })],
      local: [summary({ id: LOCAL_PLACEHOLDER_LEAGUE_ID, name: 'Unassigned Tournaments', tournamentCount: 0, playerCount: 0, isLocal: true })]
    });

    await settled();

    expect(component.filteredLeagues().map((item) => item.id)).toEqual(['server-2']);
  });

  it('keeps a placeholder that actually holds tournaments', async () => {
    const { component } = buildComponent({
      server: [summary({ id: PLACEHOLDER_LEAGUE_ID, tournamentCount: 1, playerCount: 4 })],
      local: []
    });

    await settled();

    expect(component.filteredLeagues().map((item) => item.id)).toEqual([PLACEHOLDER_LEAGUE_ID]);
  });

  /**
   * ADR 0042 point 6: the catalog arrives whole and the browser filters it. A server-side search
   * would have to re-merge the browser-local half server-side, which it cannot see.
   */
  it('filters by name over the merged list', async () => {
    const server = Array.from({ length: 9 }, (_, index) => summary({ id: `server-${index}`, name: `Server ${index}` }));
    const { component, load, listLocalLeagueSummaries } = buildComponent({
      server,
      local: [summary({ id: 'local-1', name: 'Lyon Locals', isLocal: true })]
    });

    await settled();
    expect(component.showLeagueFilter()).toBe(true);

    component.onSearchChange('lyon');
    expect(component.filteredLeagues().map((item) => item.id)).toEqual(['local-1']);
    // The filter is a signal recompute, not a refetch: neither store was asked a second time.
    expect(load).toHaveBeenCalledTimes(1);
    expect(listLocalLeagueSummaries).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T21: Browser-side pagination
// ---------------------------------------------------------------------------

function paginationSummary(id: string, overrides: Partial<LeagueArchiveSummary> = {}): LeagueArchiveSummary {
  return { id, name: id, status: 'active', tournamentCount: 0, playerCount: 0, isLocal: false, ...overrides };
}

function buildPaginationComponent(serverItems: LeagueArchiveSummary[] = [], localItems: LeagueArchiveSummary[] = []) {
  const catalogLoad = vi.fn(async () => ({
    items: serverItems, fetchedAt: new Date().toISOString(), fromCache: false, stale: false, truncated: false
  }));
  const catalogCache = { load: catalogLoad } as unknown as LeagueArchiveCatalogCacheService;
  const repo = {
    listLocalLeagueSummaries: vi.fn(async () => localItems),
    serverUnavailable: signal(false),
    catalogTruncated: signal(false),
  } as unknown as LeagueArchiveRepository;
  const auth = { profile: signal(null) } as unknown as AuthService;
  const router = { navigate: vi.fn(async () => true) } as unknown as Router;
  const dialog = { open: vi.fn() } as unknown as MatDialog;
  const power = { enabled: signal(false) } as unknown as PowerUserSettingsService;
  const injector = Injector.create({
    providers: [
      { provide: LeagueArchiveCatalogCacheService, useValue: catalogCache },
      { provide: LeagueArchiveRepository, useValue: repo },
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: router },
      { provide: MatDialog, useValue: dialog },
      { provide: PowerUserSettingsService, useValue: power },
      { provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>('en') } },
      I18nService,
    ],
  });
  const comp = runInInjectionContext(injector, () => new LeagueArchiveListComponent(repo, auth, router, dialog));
  return { comp };
}

describe('LeagueArchiveListComponent template — pagination controls', () => {
  it('renders previous and next buttons with data-cy hooks', () => {
    expect(source).toContain('data-cy="leagues-archive-list-page-previous"');
    expect(source).toContain('data-cy="leagues-archive-list-page-next"');
  });

  it('renders a page status element with data-cy hook', () => {
    expect(source).toContain('data-cy="leagues-archive-list-page-status"');
  });

  it('renders a pagination nav with data-cy hook', () => {
    expect(source).toContain('data-cy="leagues-archive-list-pagination"');
  });

  it('uses pagedLeagues() in the @for loop', () => {
    expect(source).toContain('pagedLeagues()');
    expect(source).toMatch(/for.*league of pagedLeagues\(\)/);
  });

  it('disables previous button when pageIndex <= 1', () => {
    expect(source).toMatch(/\[disabled\].*pageIndex\(\) ?<= ?1/);
  });

  it('disables next button when pageIndex >= totalPages', () => {
    expect(source).toMatch(/\[disabled\].*pageIndex\(\) ?>= ?totalPages\(\)/);
  });

  it('hides the paginator when there is only one page', () => {
    expect(source).toMatch(/totalPages\(\) ?> ?1/);
  });

  it('paginator nav carries an aria-label', () => {
    const navIdx = source.indexOf('leagues-archive-list-pagination');
    const vicinity = source.slice(Math.max(0, navIdx - 300), navIdx + 200);
    expect(vicinity).toMatch(/aria-label/);
  });
});

describe('LeagueArchiveListComponent — slices to one page by default', () => {
  it('shows only the first page when total exceeds default page size', async () => {
    const { comp } = buildPaginationComponent(
      Array.from({ length: 30 }, (_, i) => paginationSummary(`server-${i + 1}`))
    );
    await vi.waitFor(() => expect(comp.loading()).toBe(false));

    const paged = comp.pagedLeagues();
    const total = comp.totalLeagues();
    expect(total).toBe(30);
    expect(paged.length).toBeGreaterThan(0);
    expect(paged.length).toBeLessThan(30);
  });

  it('starts on page 1', async () => {
    const { comp } = buildPaginationComponent(
      Array.from({ length: 30 }, (_, i) => paginationSummary(`server-${i + 1}`))
    );
    await vi.waitFor(() => expect(comp.loading()).toBe(false));
    expect(comp.pageIndex()).toBe(1);
  });
});

describe('LeagueArchiveListComponent — goPage', () => {
  it('changes pageIndex and shows different rows', async () => {
    const { comp } = buildPaginationComponent(
      Array.from({ length: 30 }, (_, i) => paginationSummary(`server-${i + 1}`))
    );
    await vi.waitFor(() => expect(comp.loading()).toBe(false));

    const page1Ids = comp.pagedLeagues().map(l => l.id);
    comp.goPage(2);
    const page2Ids = comp.pagedLeagues().map(l => l.id);

    expect(comp.pageIndex()).toBe(2);
    expect(page2Ids.length).toBeGreaterThan(0);
    expect(page2Ids.every(id => !page1Ids.includes(id))).toBe(true);
  });

  it('previous is available after moving to page 2', async () => {
    const { comp } = buildPaginationComponent(
      Array.from({ length: 30 }, (_, i) => paginationSummary(`server-${i + 1}`))
    );
    await vi.waitFor(() => expect(comp.loading()).toBe(false));
    comp.goPage(2);
    expect(comp.pageIndex()).toBeGreaterThan(1);
  });
});

describe('LeagueArchiveListComponent — boundary disabled states', () => {
  it('page 1: previous disabled condition (pageIndex <= 1)', async () => {
    const { comp } = buildPaginationComponent(
      Array.from({ length: 30 }, (_, i) => paginationSummary(`server-${i + 1}`))
    );
    await vi.waitFor(() => expect(comp.loading()).toBe(false));
    expect(comp.pageIndex() <= 1).toBe(true);
  });

  it('last page: next disabled condition (pageIndex >= totalPages)', async () => {
    const { comp } = buildPaginationComponent(
      Array.from({ length: 30 }, (_, i) => paginationSummary(`server-${i + 1}`))
    );
    await vi.waitFor(() => expect(comp.loading()).toBe(false));

    comp.goPage(comp.totalPages());
    expect(comp.pageIndex() >= comp.totalPages()).toBe(true);
  });
});

describe('LeagueArchiveListComponent — filter then page', () => {
  it('filtered to 3 rows gives totalPages === 1', async () => {
    const items = [
      ...Array.from({ length: 30 }, (_, i) => paginationSummary(`server-${i + 1}`)),
      paginationSummary('zz-1', { name: 'Zephyr Alpha' }),
      paginationSummary('zz-2', { name: 'Zephyr Beta' }),
      paginationSummary('zz-3', { name: 'Zephyr Gamma' }),
    ];
    const { comp } = buildPaginationComponent(items);
    await vi.waitFor(() => expect(comp.loading()).toBe(false));

    comp.onSearchChange('zephyr');
    expect(comp.totalLeagues()).toBe(3);
    expect(comp.totalPages()).toBe(1);
  });
});

describe('LeagueArchiveListComponent — filter resets page', () => {
  it('resets pageIndex to 1 when the filter changes', async () => {
    const { comp } = buildPaginationComponent(
      Array.from({ length: 30 }, (_, i) => paginationSummary(`server-${i + 1}`))
    );
    await vi.waitFor(() => expect(comp.loading()).toBe(false));

    comp.goPage(2);
    expect(comp.pageIndex()).toBe(2);

    comp.onSearchChange('server-1');
    expect(comp.pageIndex()).toBe(1);
  });
});

describe('LeagueArchiveListComponent — local + server union pages together', () => {
  it('combines local and server items and pages them as one list in original order', async () => {
    const server = Array.from({ length: 15 }, (_, i) => paginationSummary(`server-${i + 1}`));
    const local = Array.from({ length: 15 }, (_, i) => paginationSummary(`local-${i + 1}`, { isLocal: true }));
    const { comp } = buildPaginationComponent(server, local);
    await vi.waitFor(() => expect(comp.loading()).toBe(false));

    expect(comp.totalLeagues()).toBe(30);

    const page1 = comp.pagedLeagues();
    expect(page1.length).toBeGreaterThan(0);
    // Server rows come first in the union (leagues = [...server, ...local])
    const firstLocalPos = page1.findIndex(l => l.isLocal);
    const lastServerPos = [...page1].reverse().findIndex(l => !l.isLocal);
    if (firstLocalPos !== -1 && lastServerPos !== -1) {
      expect(firstLocalPos).toBeGreaterThan(page1.length - 1 - lastServerPos);
    }
  });
});

describe('LeagueArchiveListComponent — small archive shows no paginator', () => {
  it('totalPages === 1 when all rows fit on one page', async () => {
    const { comp } = buildPaginationComponent(
      Array.from({ length: 5 }, (_, i) => paginationSummary(`server-${i + 1}`))
    );
    await vi.waitFor(() => expect(comp.loading()).toBe(false));
    expect(comp.totalPages()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// i18n coverage for new pagination keys
// ---------------------------------------------------------------------------

describe('LeagueArchiveListComponent — i18n keys for pagination', () => {
  const requiredKeys = ['leagues.paginationAria', 'leagues.pageStatus'] as const;

  for (const key of requiredKeys) {
    it(`has ${key} in both en and fr catalogs`, () => {
      expect(catalogs.en[key as keyof typeof catalogs.en], `en missing ${key}`).toBeTruthy();
      expect(catalogs.fr[key as keyof typeof catalogs.fr], `fr missing ${key}`).toBeTruthy();
    });
  }
});
