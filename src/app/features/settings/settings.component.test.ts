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
    expect(templateBlock('@if (capabilities().localMaintenance) {')).toContain('data-cy="settings-local-players-card"');
  });

  it('reloads truthful local player state after a partial sequential rename failure', async () => {
    const league = (id: string, player1Name: string) => ({
      id, name: id, status: 'active', documentVersion: 1, updatedAt: '2026-08-10T00:00:00Z',
      tournaments: [{ id: `${id}-t`, leagueId: id, name: 'Day', tournamentDate: '2026-08-10', playerArchetypes: [], rounds: [{ id: `${id}-r`, entries: [{ id: `${id}-e`, kind: 'match', table: '1', player1Name, player2Name: 'Other', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }] }]
    });
    let stored = [league('local-1', 'Alice'), league('local-2', 'Alice')];
    const localBackend = {
      listLeagueArchives: vi.fn(async () => stored),
      renameLeagueArchivePlayerName: vi.fn(async (id: string) => {
        if (id === 'local-2') throw new Error('write failed');
        stored = stored.map((item) => item.id === id ? league(id, 'Alicia') : item);
        return stored.find((item) => item.id === id);
      })
    };
    const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
    Object.assign(component, {
      localBackend,
      i18n: { t: (key: string) => key },
      playerSaving: signal(false),
      playerMessage: signal(''),
      playerEdits: signal({ Alice: 'Alicia' }),
      editingPlayer: signal<string | null>('Alice'),
      localPlayers: signal([])
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await component.saveLocalPlayerEdit({ name: 'Alice', occurrenceCount: 2, leagueCount: 2 });

    expect(localBackend.listLeagueArchives).toHaveBeenCalledTimes(2);
    expect(component.localPlayers().map((player) => player.name)).toEqual(['Alice', 'Alicia', 'Other']);
    expect(component.playerMessage()).toBe('settings.localPlayerRenamePartial');
    expect(component.playerSaving()).toBe(false);
    logged.mockRestore();
  });

  it('keeps partial-rename warning when final local player reload also fails', async () => {
    const league = (id: string) => ({
      id, name: id, status: 'active', documentVersion: 1, updatedAt: '2026-08-10T00:00:00Z',
      tournaments: [{ id: `${id}-t`, leagueId: id, name: 'Day', tournamentDate: '2026-08-10', playerArchetypes: [], rounds: [{ id: `${id}-r`, entries: [{ id: `${id}-e`, kind: 'match', table: '1', player1Name: 'Alice', player2Name: 'Other', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' }] }] }]
    });
    const stored = [league('local-1'), league('local-2')];
    const localBackend = {
      listLeagueArchives: vi.fn()
        .mockResolvedValueOnce(stored)
        .mockRejectedValueOnce(new Error('reload failed')),
      renameLeagueArchivePlayerName: vi.fn(async (id: string) => {
        if (id === 'local-2') throw new Error('write failed');
        return league(id);
      })
    };
    const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
    Object.assign(component, {
      localBackend,
      i18n: { t: (key: string) => key },
      playerSaving: signal(false),
      playerMessage: signal(''),
      playerEdits: signal({ Alice: 'Alicia' }),
      editingPlayer: signal<string | null>('Alice'),
      localPlayers: signal([])
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await component.saveLocalPlayerEdit({ name: 'Alice', occurrenceCount: 2, leagueCount: 2 });

    expect(localBackend.renameLeagueArchivePlayerName).toHaveBeenCalledTimes(2);
    expect(localBackend.listLeagueArchives).toHaveBeenCalledTimes(2);
    expect(component.playerMessage()).toBe('settings.localPlayerRenamePartial');
    expect(component.playerSaving()).toBe(false);
    logged.mockRestore();
  });

  it('keeps generic load-failed copy for standalone local player reload failure', async () => {
    const component = Object.create(SettingsComponent.prototype) as SettingsComponent;
    Object.assign(component, {
      localBackend: { listLeagueArchives: vi.fn(async () => { throw new Error('reload failed'); }) },
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
      templateBlock('@if (capabilities().localMaintenance) {'),
      templateBlock('async addLocalArchetype(): Promise<void> {'),
      templateBlock('async saveLocalArchetypeEdit(archetype: string): Promise<void> {'),
      templateBlock('async removeLocalArchetype(archetype: string): Promise<void> {'),
      templateBlock('async loadLocalPlayers(preserveMessage = false): Promise<void> {'),
      templateBlock('async saveLocalPlayerEdit(player: LocalPlayerSummary): Promise<void> {')
    ];

    for (const slice of slices) expect(slice).not.toContain('this.client.');
  });
});
