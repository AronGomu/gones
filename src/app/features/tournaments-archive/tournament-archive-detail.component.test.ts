import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { of } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { LeagueArchiveRepository } from '../../data/league-archive-repository.service';
import { createLeague, createMatchRoundEntry, createRound, createTournament, PersistedLeague } from '../../domain/models';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import { TournamentArchiveDetailComponent } from './tournament-archive-detail.component';

function league(id = 'server-source', name = 'Source', tournamentStatus: 'active' | 'completed' = 'completed'): PersistedLeague {
  return {
    ...createLeague({ id, name, status: 'active', tournaments: [createTournament({
      id: 't1', leagueId: id, name: 'Cup', tournamentDate: '2026-08-13', status: tournamentStatus,
      rounds: [createRound({ id: 'r1', entries: [createMatchRoundEntry({ id: 'e1', player1Name: 'Alice', player2Name: 'Bob' })] })],
      playerArchetypes: [{ playerName: 'Alice', archetype: 'Burn' }]
    })] }),
    documentVersion: 2
  };
}

async function build(options: { power?: boolean; role?: string; source?: PersistedLeague; leagues?: PersistedLeague[]; confirmations?: boolean[]; saveError?: unknown } = {}) {
  const source = options.source ?? league();
  const leagues = options.leagues ?? [source];
  const confirmations = [...(options.confirmations ?? [true])];
  const getLeague = vi.fn(async (id: string) => leagues.find(item => item.id === id) ?? null);
  const saveTournamentEdits = options.saveError
    ? vi.fn(async (_source: PersistedLeague, _tournamentId: string, _target: PersistedLeague | null, _command: unknown) => { throw options.saveError; })
    : vi.fn(async (_source: PersistedLeague, _tournamentId: string, target: PersistedLeague | null, _command: unknown) => ({
      sourceLeague: { ...source, documentVersion: source.documentVersion + 1 },
      destinationLeague: target ? { ...target, tournaments: source.tournaments, documentVersion: target.documentVersion + 1 } : null
    }));
  const repo = { getLeague, listLeagues: vi.fn(async () => leagues), saveTournamentEdits } as unknown as LeagueArchiveRepository;
  const navigate = vi.fn(async () => true);
  const open = vi.fn((_dialog: unknown, _config?: unknown) => ({ afterClosed: () => of(confirmations.shift() ?? false) }));
  const power = signal(options.power ?? true);
  const injector = Injector.create({ providers: [
    { provide: LeagueArchiveRepository, useValue: repo },
    { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['leagueId', source.id], ['tournamentId', 't1']]), queryParamMap: new Map() } } },
    { provide: Router, useValue: { navigate } },
    { provide: MatDialog, useValue: { open } },
    { provide: AuthService, useValue: { profile: signal(options.role ? { globalRole: options.role } : null) } },
    { provide: PowerUserSettingsService, useValue: { enabled: power } },
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new TournamentArchiveDetailComponent(repo, injector.get(AuthService), injector.get(ActivatedRoute), injector.get(Router), injector.get(MatDialog)));
  await vi.waitFor(() => expect(component.loading()).toBe(false));
  return { component, repo, getLeague, saveTournamentEdits, navigate, open, power };
}

const sourceText = readFileSync(join(__dirname, 'tournament-archive-detail.component.ts'), 'utf8');
const stylesheet = readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8');

describe('TournamentArchiveDetailComponent staged edit state', () => {
  it('loads read-only for every role while exposing Edit only to authorized Power users on active Leagues', async () => {
    const organizer = await build({ role: 'Organizer' });
    expect(organizer.component.editing()).toBe(false);
    expect(organizer.component.draft()).toBeNull();
    expect(organizer.component.canEdit()).toBe(true);

    expect((await build({ role: 'User' })).component.canEdit()).toBe(false);
    expect((await build({ role: 'Organizer', power: false })).component.canEdit()).toBe(false);
    expect((await build({ source: league('local-source'), role: 'User' })).component.canEdit()).toBe(true);
    const completed = { ...league(), status: 'completed' as const };
    expect((await build({ source: completed, role: 'Admin' })).component.canEdit()).toBe(false);
  });

  it('stages round, entry, import, archetype, and move changes without repository mutations', async () => {
    const target = league('server-target', 'Target');
    const { component, saveTournamentEdits } = await build({ role: 'Organizer', leagues: [league(), target] });
    component.startEdit();
    component.addRound();
    const round = component.tournament()!.rounds.at(-1)!;
    component.addMatch(round);
    component.replaceRound(round, '1,Alice,won 2-0,Bob,Burn,Control');
    component.setArchetype('Alice', 'Tempo');
    component.moveTournamentToLeague(target.id);
    component.deleteEntry(component.tournament()!.rounds[0], 'e1');
    expect(saveTournamentEdits).not.toHaveBeenCalled();
    expect(component.dirty()).toBe(true);
    expect(component.selectedLeagueId()).toBe(target.id);
  });

  it('Cancel Edit keeps a dirty draft when declined, then discards without a repository call', async () => {
    const { component, saveTournamentEdits } = await build({ role: 'Organizer', confirmations: [false, true] });
    component.startEdit();
    component.tournament()!.name = 'Draft';
    component.markDirty();
    await component.cancelEdit();
    expect(component.editing()).toBe(true);
    expect(component.tournament()!.name).toBe('Draft');
    await component.cancelEdit();
    expect(component.editing()).toBe(false);
    expect(component.tournament()!.name).toBe('Cup');
    expect(saveTournamentEdits).not.toHaveBeenCalled();
  });

  it('empty Save exits without confirmation or repository call', async () => {
    const { component, saveTournamentEdits, open } = await build({ role: 'Organizer' });
    component.startEdit();
    await component.save();
    expect(component.editing()).toBe(false);
    expect(saveTournamentEdits).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('confirms a multi-change summary then sends exactly one atomic batch', async () => {
    const { component, saveTournamentEdits, open } = await build({ role: 'Organizer' });
    component.startEdit();
    component.tournament()!.name = 'Renamed';
    component.deleteEntry(component.tournament()!.rounds[0], 'e1');
    await Promise.all([component.save(), component.save()]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1]).toMatchObject({ data: { destructive: true } });
    expect(saveTournamentEdits).toHaveBeenCalledTimes(1);
    expect(saveTournamentEdits.mock.calls[0][3]).toMatchObject({ editTournament: { name: 'Renamed' }, replaceRounds: [{ roundId: 'r1', entries: [] }] });
    expect(component.editing()).toBe(false);
  });

  it('allows deleting the final round and summarizes it in the batch', async () => {
    const { component, saveTournamentEdits, open } = await build({ role: 'Organizer' });
    component.startEdit();
    component.deleteRound(component.tournament()!.rounds[0]);
    await component.save();
    expect(open.mock.calls[0][1]).toMatchObject({ data: { message: component.i18n.t('tournament.saveChangesSummary', { move: component.i18n.t('tournament.noLeagueMove'), rounds: 1, entries: 0 }) } });
    expect(saveTournamentEdits.mock.calls[0][3]).toMatchObject({ deleteRoundIds: ['r1'] });
  });

  it('move Save adopts destination and navigates target route', async () => {
    const source = league();
    const target = league('server-target', 'Target');
    const { component, saveTournamentEdits, navigate } = await build({ source, role: 'Organizer', leagues: [source, target] });
    component.startEdit();
    component.moveTournamentToLeague(target.id);
    await component.save();
    expect(saveTournamentEdits).toHaveBeenCalledWith(source, 't1', target, expect.any(Object));
    expect(component.league()?.id).toBe(target.id);
    expect(navigate).toHaveBeenCalledWith(['/leagues-archive', target.id, 'tournaments-archive', 't1']);
  });

  it('shows invalid duplicate-entry errors immediately and retains the draft without a request', async () => {
    const { component, saveTournamentEdits } = await build({ role: 'Organizer' });
    component.startEdit();
    const entry = component.tournament()!.rounds[0].entries[0];
    if (entry.kind !== 'match') throw new Error('matchFixtureRequired');
    entry.player2Name = entry.player1Name;
    component.markDirty();
    expect(component.completionIssues()).not.toEqual([]);
    await component.save();
    expect(saveTournamentEdits).not.toHaveBeenCalled();
    expect(component.editing()).toBe(true);
    expect(component.tournament()!.rounds[0].entries[0]).toMatchObject({ player2Name: 'Alice' });
  });

  it('retains a network-failed draft for explicit retry', async () => {
    const { component, saveTournamentEdits } = await build({ role: 'Organizer', saveError: new Error('offline') });
    component.startEdit();
    component.tournament()!.name = 'Network Draft';
    component.markDirty();
    await component.save();
    expect(saveTournamentEdits).toHaveBeenCalledTimes(1);
    expect(component.editing()).toBe(true);
    expect(component.tournament()!.name).toBe('Network Draft');
    expect(component.stale()).toBe(false);
    expect(component.error()).toBe(component.i18n.t('tournament.saveFailed'));
  });

  it('retains stale draft; Reload Latest cancellation keeps it; confirmation reloads authoritative and exits', async () => {
    const { component, getLeague, saveTournamentEdits } = await build({ role: 'Organizer', confirmations: [true, false, true], saveError: { status: 412 } });
    component.startEdit();
    component.tournament()!.name = 'Draft survives';
    component.markDirty();
    await component.save();
    expect(saveTournamentEdits).toHaveBeenCalledTimes(1);
    expect(component.stale()).toBe(true);
    expect(component.tournament()!.name).toBe('Draft survives');
    const readsBefore = getLeague.mock.calls.length;
    await component.reloadLatest();
    expect(getLeague).toHaveBeenCalledTimes(readsBefore);
    expect(component.editing()).toBe(true);
    await component.reloadLatest();
    expect(getLeague.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(component.editing()).toBe(false);
    expect(component.tournament()!.name).toBe('Cup');
  });
});

describe('Tournament completion status badge and toggle', () => {
  it('shows the active badge', async () => {
    const { component } = await build({ role: 'Organizer', source: league('local-s', 'S', 'active') });
    expect(component.statusLabel()).toBe(component.i18n.t('archive.tournamentActive'));
  });

  it('shows the completed badge', async () => {
    const { component } = await build({ role: 'Organizer', source: league('local-s', 'S', 'completed') });
    expect(component.statusLabel()).toBe(component.i18n.t('archive.tournamentCompleted'));
  });

  it('offers Mark complete to a power organizer', async () => {
    const { component } = await build({ power: true, role: 'Organizer', source: league('local-s', 'S', 'active') });
    expect(component.canToggleStatus()).toBe(true);
    expect(component.toggleLabel()).toBe(component.i18n.t('archive.markComplete'));
  });

  it('offers Reopen when completed', async () => {
    const { component } = await build({ power: true, role: 'Organizer', source: league('local-s', 'S', 'completed') });
    expect(component.canToggleStatus()).toBe(true);
    expect(component.toggleLabel()).toBe(component.i18n.t('archive.reopen'));
  });

  it('hides the toggle without power mode', async () => {
    const { component } = await build({ power: false, role: 'Organizer', source: league('local-s', 'S', 'active') });
    expect(component.canToggleStatus()).toBe(false);
    expect(component.statusLabel()).toBe(component.i18n.t('archive.tournamentActive'));
  });

  it('hides the toggle without write rights', async () => {
    const { component } = await build({ power: true, role: 'User', source: league('server-s', 'S', 'active') });
    expect(component.canToggleStatus()).toBe(false);
  });

  it('confirms before toggling', async () => {
    const { component, saveTournamentEdits, open } = await build({
      power: true, role: 'Organizer',
      source: league('local-s', 'S', 'active'),
      confirmations: [false]
    });
    await component.toggleStatus();
    expect(open).toHaveBeenCalledTimes(1);
    expect(saveTournamentEdits).not.toHaveBeenCalled();
  });

  it('sends the status in the edit intent', async () => {
    const { component, saveTournamentEdits } = await build({
      power: true, role: 'Organizer',
      source: league('local-s', 'S', 'active'),
      confirmations: [true]
    });
    await component.toggleStatus();
    expect(saveTournamentEdits).toHaveBeenCalledTimes(1);
    expect(saveTournamentEdits.mock.calls[0][3]).toMatchObject({ status: 'completed' });
  });
});

describe('Tournament Archive staged editor template and CSS', () => {
  it('uses explicit unique staged actions and no title-only/autosave/immediate repository commands', () => {
    expect(sourceText).toContain('data-cy="tournament-archive-detail-edit"');
    expect(sourceText).toContain('data-cy="tournament-archive-detail-cancel-edit"');
    expect(sourceText).toContain('data-cy="tournament-archive-detail-save-changes"');
    expect(sourceText).not.toContain('startTitleEdit');
    expect(sourceText).not.toContain('archetypePersistTimer');
    expect(sourceText).not.toMatch(/repo\.(addResult|deleteResultRound|deleteResultEntry|importResultRound|replaceResultRound|editResultEntry|updateResultPlayerArchetype|moveTournament)/);
    const dataCy = [...sourceText.matchAll(/data-cy="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(dataCy).size).toBe(dataCy.length);
  });

  it('gives Player Archetype header exact round inset without negative offset', () => {
    expect(stylesheet).toMatch(/\.player-archetype-panel\.mat-expansion-panel \.mat-expansion-panel-header[\s\S]*?padding-inline: 24px;/);
    expect(stylesheet).not.toMatch(/\.player-archetype-panel[\s\S]{0,500}margin-inline:\s*-\.?\d/);
  });
});
