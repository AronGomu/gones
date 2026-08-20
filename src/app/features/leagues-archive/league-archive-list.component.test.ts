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

    component.searchTerm = 'lyon';
    expect(component.filteredLeagues().map((item) => item.id)).toEqual(['local-1']);
    // The filter is a signal recompute, not a refetch: neither store was asked a second time.
    expect(load).toHaveBeenCalledTimes(1);
    expect(listLocalLeagueSummaries).toHaveBeenCalledTimes(1);
  });
});
