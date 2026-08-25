import '@angular/compiler';
import { signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SettingsComponent } from './settings.component';

/**
 * ADR 0032 gives a viewer with no server-backed catalog the browser-local one instead. These are
 * source assertions — this repo has no TestBed — so each one pins the guard the section lives in
 * and the fact that no local path ever reaches the API client.
 */
const source = readFileSync(join(__dirname, 'settings.component.ts'), 'utf8');

/** The source slice a block owns, from its opening `{` to the `}` that balances it. */
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

describe('settings page local sections', () => {
  it('renders both local sections behind their flags', () => {
    expect(templateBlock('@if (capabilities().localCatalog) {')).toContain('data-cy="settings-local-archetype-card"');
    expect(templateBlock('@if (power.enabled() && capabilities().localMaintenance) {')).toContain('data-cy="settings-local-players-card"');
  });

  it('reloads truthful local player state after a partial sequential rename failure', async () => {
    const tournament = (id: string, player1Name: string) => ({
      id, name: id, seasonId: null, tournamentDate: '2026-08-10', status: 'completed', documentVersion: 1, updatedAt: '2026-08-10T00:00:00Z',
      playerArchetypes: [], rounds: [{ id: `${id}-r`, entries: [{ id: `${id}-e`, kind: 'match', table: '1', player1Name, player2Name: 'Other', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }]
    });
    let stored = [tournament('local-1', 'Alice'), tournament('local-2', 'Alice')];
    const localBackend = {
      listArchiveTournaments: vi.fn(async () => ({ items: stored, totalCount: stored.length, truncated: false })),
      renameArchiveTournamentPlayer: vi.fn(async (id: string) => {
        if (id === 'local-2') throw new Error('write failed');
        stored = stored.map((item) => item.id === id ? tournament(id, 'Alicia') : item);
        return stored.find((item) => item.id === id);
      })
    };
    const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
    Object.assign(component, {
      localBackend,
      i18n: { t: (key: string) => key },
      power: { enabled: signal(true) },
      playerSaving: signal(false),
      playerMessage: signal(''),
      playerEdits: signal({ Alice: 'Alicia' }),
      editingPlayer: signal<string | null>('Alice'),
      localPlayers: signal([])
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await component.saveLocalPlayerEdit({ name: 'Alice', occurrenceCount: 2, leagueCount: 2 });

    expect(localBackend.listArchiveTournaments).toHaveBeenCalledTimes(2);
    expect(component.localPlayers().map((player) => player.name)).toEqual(['Alice', 'Alicia', 'Other']);
    expect(component.playerMessage()).toBe('settings.localPlayerRenamePartial');
    expect(component.playerSaving()).toBe(false);
    logged.mockRestore();
  });

  it('keeps partial-rename warning when final local player reload also fails', async () => {
    const tournament = (id: string) => ({
      id, name: id, seasonId: null, tournamentDate: '2026-08-10', status: 'completed', documentVersion: 1, updatedAt: '2026-08-10T00:00:00Z',
      playerArchetypes: [], rounds: [{ id: `${id}-r`, entries: [{ id: `${id}-e`, kind: 'match', table: '1', player1Name: 'Alice', player2Name: 'Other', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }]
    });
    const stored = [tournament('local-1'), tournament('local-2')];
    const localBackend = {
      listArchiveTournaments: vi.fn()
        .mockResolvedValueOnce({ items: stored, totalCount: stored.length, truncated: false })
        .mockRejectedValueOnce(new Error('reload failed')),
      renameArchiveTournamentPlayer: vi.fn(async (id: string) => {
        if (id === 'local-2') throw new Error('write failed');
        return tournament(id);
      })
    };
    const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
    Object.assign(component, {
      localBackend,
      i18n: { t: (key: string) => key },
      power: { enabled: signal(true) },
      playerSaving: signal(false),
      playerMessage: signal(''),
      playerEdits: signal({ Alice: 'Alicia' }),
      editingPlayer: signal<string | null>('Alice'),
      localPlayers: signal([])
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await component.saveLocalPlayerEdit({ name: 'Alice', occurrenceCount: 2, leagueCount: 2 });

    expect(localBackend.renameArchiveTournamentPlayer).toHaveBeenCalledTimes(2);
    expect(localBackend.listArchiveTournaments).toHaveBeenCalledTimes(2);
    expect(component.playerMessage()).toBe('settings.localPlayerRenamePartial');
    expect(component.playerSaving()).toBe(false);
    logged.mockRestore();
  });

  it('keeps generic load-failed copy for standalone local player reload failure', async () => {
    const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
    Object.assign(component, {
      localBackend: { listArchiveTournaments: vi.fn(async () => { throw new Error('reload failed'); }) },
      i18n: { t: (key: string) => key },
      playerMessage: signal('')
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await component.loadLocalPlayers();

    expect(component.playerMessage()).toBe('settings.loadFailed');
    logged.mockRestore();
  });

  it('never calls the API client from a local path', () => {
    const slices = [
      templateBlock('@if (capabilities().localCatalog) {'),
      templateBlock('@if (power.enabled() && capabilities().localMaintenance) {'),
      templateBlock('async addLocalArchetype(): Promise<void> {'),
      templateBlock('async saveLocalArchetypeEdit(archetype: string): Promise<void> {'),
      templateBlock('async removeLocalArchetype(archetype: string): Promise<void> {'),
      templateBlock('async loadLocalPlayers(preserveMessage = false): Promise<void> {'),
      templateBlock('async saveLocalPlayerEdit(player: LocalPlayerSummary): Promise<void> {')
    ];

    for (const slice of slices) expect(slice).not.toContain('this.client.');
  });
});

describe('settings server catalog cache', () => {
  it('caches the signed-in catalog read via readCached', async () => {
    const archetypes = [{ id: '1', name: 'Control', deletedAt: undefined }];
    const readCached = vi.fn().mockResolvedValue({ value: archetypes, fetchedAt: new Date().toISOString(), fromCache: false, stale: false });
    const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
    Object.assign(component, {
      cache: { readCached, invalidate: vi.fn() },
      client: { listAdminDeckArchetypes: vi.fn() },
      i18n: { t: (key: string) => key },
      serverArchetypes: signal([]),
      settingsSyncedAt: signal<string | undefined>(undefined),
      settingsStale: signal(false),
      settingsCatalogLoading: signal(false),
      archetypeMessage: signal('')
    });

    await component.loadServerArchetypes();

    expect(readCached).toHaveBeenCalledWith('settings-catalogs', expect.any(Function), {});
    expect(component.serverArchetypes()).toEqual(archetypes);
  });

  it('leaves the signed-out path uncached (localCatalog section has no readCached call)', () => {
    const localSlice = templateBlock('@if (capabilities().localCatalog) {');
    expect(localSlice).not.toContain('readCached');
    expect(localSlice).not.toContain('this.cache');
  });

  it('invalidates after a save and refetches — each mutation method calls invalidate before reload', () => {
    const mutations = [
      templateBlock('async addServerArchetype(): Promise<void> {'),
      templateBlock('async saveServerArchetypeEdit(archetype: AdminDeckArchetypeResponse): Promise<void> {'),
      templateBlock('async removeServerArchetype(archetype: AdminDeckArchetypeResponse): Promise<void> {'),
      templateBlock('async restoreServerArchetype(archetype: AdminDeckArchetypeResponse): Promise<void> {'),
      templateBlock('async importServerArchetypes(event: Event): Promise<void> {')
    ];
    for (const slice of mutations) {
      expect(slice).toContain("this.cache.invalidate('settings-catalogs')");
      const invalidatePos = slice.indexOf("this.cache.invalidate('settings-catalogs')");
      const reloadPos = slice.indexOf('this.loadServerArchetypes()');
      expect(invalidatePos).toBeLessThan(reloadPos);
    }
  });
});

/**
 * The Archive cache serves a locked year partition from IndexedDB forever with no request, so an
 * edit to data older than a year is invisible here until the user asks for it. That staleness is an
 * accepted risk of the caching design; this control is its escape hatch, and these tests pin that it
 * stays collapsed, single-flight, and ordered clear-then-refill.
 */
describe('settings archive resynchronize', () => {
  /** Clear first, then refill: a forced read must re-enqueue every year against an empty cache. */
  function resyncComponent(archiveRepo: Record<string, unknown>, resyncing = false): SettingsComponent {
    const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
    Object.assign(component, {
      archiveRepo,
      i18n: { t: (key: string) => key },
      archiveResyncing: signal(resyncing),
      archiveResyncMessage: signal('')
    });
    return component;
  }

  it('keeps the resynchronize section collapsed by default', () => {
    expect(source).toContain('data-cy="settings-archive-resync-panel" [expanded]="false"');
    expect(source).not.toContain('archiveResyncPanelExpanded');
  });

  it('clears the archive caches, then refills every catalog', async () => {
    const order: string[] = [];
    const archiveRepo = {
      invalidateArchiveCaches: vi.fn(async () => { order.push('invalidate'); }),
      listLeagues: vi.fn(async () => { order.push('leagues'); }),
      listLeagueSeasons: vi.fn(async () => { order.push('seasons'); }),
      listTournaments: vi.fn(async () => { order.push('tournaments'); })
    };
    const component = resyncComponent(archiveRepo);
    const logged = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await component.resynchronizeArchive();

    expect(order).toEqual(['invalidate', 'leagues', 'seasons', 'tournaments']);
    // Every refill is forced, or the read it just emptied would be answered from the copy it dropped.
    for (const read of [archiveRepo.listLeagues, archiveRepo.listLeagueSeasons, archiveRepo.listTournaments]) {
      expect(read).toHaveBeenCalledWith({ force: true });
    }
    expect(component.archiveResyncMessage()).toBe('settings.archiveResyncDone');
    expect(component.archiveResyncing()).toBe(false);
    logged.mockRestore();
  });

  it('reports a failed resynchronize and releases the button', async () => {
    const archiveRepo = {
      invalidateArchiveCaches: vi.fn(async () => undefined),
      listLeagues: vi.fn(async () => { throw new Error('boom'); }),
      listLeagueSeasons: vi.fn(async () => undefined),
      listTournaments: vi.fn(async () => undefined)
    };
    const component = resyncComponent(archiveRepo);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await component.resynchronizeArchive();

    expect(component.archiveResyncMessage()).toBe('settings.archiveResyncFailed');
    expect(component.archiveResyncing()).toBe(false);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it('ignores a second run while one is in flight', async () => {
    const archiveRepo = {
      invalidateArchiveCaches: vi.fn(async () => undefined),
      listLeagues: vi.fn(async () => undefined),
      listLeagueSeasons: vi.fn(async () => undefined),
      listTournaments: vi.fn(async () => undefined)
    };
    const component = resyncComponent(archiveRepo, true);

    await component.resynchronizeArchive();

    expect(archiveRepo.invalidateArchiveCaches).not.toHaveBeenCalled();
    expect(archiveRepo.listLeagues).not.toHaveBeenCalled();
  });
});
