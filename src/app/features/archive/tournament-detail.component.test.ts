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

import { Injector, WritableSignal, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { ApiProblemError } from '../../api/api-boundary';
import { AuthService } from '../../auth/auth.service';
import { ArchiveConcurrencyError } from '../../backend/local-archive-backend.service';
import { ArchiveRepository } from '../../data/archive-repository.service';
import type { ArchiveLeagueSeasonRow, ArchiveStagedSave } from '../../data/archive-repository.service';
import { PersistedArchiveTournament } from '../../domain/archive-models';
import { ARCHIVE_STANDALONE_SEASON_VALUE } from '../../domain/archive-staged-edit';
import { I18nService } from '../../i18n/i18n.service';
import { calculateTournamentResult } from '../../domain/results';
import { translate } from '../../i18n/messages';
import { DeckArchetypeSettingsService, SettingsLanguage } from '../../shared/deck-archetype-settings.service';
import { PowerUserSettingsService } from '../../shared/power-user-settings.service';
import {
  ARCHIVE_TOURNAMENT_DETAIL_SOURCE,
  ArchiveTournamentDetailSource,
  TournamentDetailComponent
} from './tournament-detail.component';

const source = readFileSync(join(__dirname, 'tournament-detail.component.ts'), 'utf8');

function match(id: string, player1: string, player2: string, score1: number, score2: number) {
  return {
    kind: 'match' as const,
    id,
    table: id,
    player1Name: player1,
    player2Name: player2,
    player1Score: score1,
    player2Score: score2,
    player1DeckArchetype: 'Burn',
    player2DeckArchetype: 'Control'
  };
}

function detail(overrides: Partial<PersistedArchiveTournament> = {}): PersistedArchiveTournament {
  return {
    id: 't-1',
    name: 'Étape 1',
    seasonId: 's-1',
    tournamentDate: '2026-02-14',
    status: 'completed',
    rounds: [
      { id: 'r-1', entries: [match('m-1', 'Ana', 'Ben', 2, 1)] },
      { id: 'r-2', entries: [match('m-2', 'Ana', 'Cleo', 2, 0)] }
    ],
    playerArchetypes: [{ playerName: 'Ana', archetype: 'Burn' }],
    documentVersion: 3,
    updatedAt: '2026-02-15T10:00:00Z',
    ...overrides
  };
}

function build(overrides: Partial<ArchiveTournamentDetailSource> = {}): TournamentDetailComponent {
  return editor({ detailSource: overrides }).page;
}

/** ISO day `days` before today, UTC. Used to put a fixture inside or outside the 365-day lock window. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function season(id: string, isLocal: boolean, name = `Season ${id}`): ArchiveLeagueSeasonRow {
  return {
    id, name, leagueId: 'l1', status: 'active', updatedAt: '2026-01-02T00:00:00.000Z', documentVersion: 1,
    tournamentCount: 0, playerCount: 0, firstTournamentDate: null, lastTournamentDate: null, isLocal
  };
}

interface EditorOptions {
  detailSource?: Partial<ArchiveTournamentDetailSource>;
  tournamentId?: string;
  seasons?: ArchiveLeagueSeasonRow[];
  listRejects?: boolean;
  saveResult?: PersistedArchiveTournament;
  saveRejects?: unknown;
  reloadResult?: PersistedArchiveTournament | null;
  confirm?: boolean | undefined;
  power?: boolean;
  role?: string | null;
}

interface DialogCall { data: { title: string; message: string; confirmLabel: string; destructive?: boolean } }

/**
 * The read-only harness plus the four staged-edit collaborators. Every existing T14 test runs
 * through this too, via `build()`, so one builder covers both halves of the page.
 */
function editor(options: EditorOptions = {}) {
  const detailSource: ArchiveTournamentDetailSource = {
    getTournament: async () => detail(),
    getSeasonName: async () => 'Ligue Lyon 2026',
    ...options.detailSource
  };
  const repo = {
    listLeagueSeasons: vi.fn(async () => {
      if (options.listRejects) throw new Error('offline');
      return { items: options.seasons ?? [], totalCount: 0, truncated: false, fetchedAt: '', fromCache: false, stale: false };
    }),
    getTournament: vi.fn(async () => options.reloadResult ?? null),
    // Typed on `ArchiveStagedSave` so `mock.calls[0][0]` is the batch, not `never`.
    saveTournamentEdits: vi.fn(async (_save: ArchiveStagedSave) => {
      if (options.saveRejects) throw options.saveRejects;
      return options.saveResult ?? detail({ documentVersion: 4 });
    })
  };
  const dialogCalls: DialogCall[] = [];
  // Mutable so one page can confirm the save and then cancel the Reload Latest that follows it.
  let answer: boolean | undefined = options.confirm;
  const dialog = {
    open: (_component: unknown, config: DialogCall) => {
      dialogCalls.push(config);
      return { afterClosed: () => of(answer) };
    }
  };
  const setConfirm = (value: boolean | undefined) => { answer = value; };
  const power: WritableSignal<boolean> = signal(options.power ?? false);
  const profile: WritableSignal<{ globalRole: string } | null> =
    signal(options.role ? { globalRole: options.role } : null);
  const injector = Injector.create({
    providers: [
      { provide: ARCHIVE_TOURNAMENT_DETAIL_SOURCE, useValue: detailSource },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => options.tournamentId ?? 't-1' } } } },
      { provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>('en') } },
      { provide: ArchiveRepository, useValue: repo },
      { provide: AuthService, useValue: { profile } },
      { provide: PowerUserSettingsService, useValue: { enabled: power, requireEnabled: () => undefined } },
      { provide: MatDialog, useValue: dialog },
      I18nService
    ]
  });
  const page = runInInjectionContext(injector, () => new TournamentDetailComponent());
  return { page, repo, dialogCalls, power, profile, setConfirm };
}

/** A loaded page already in edit mode, with an Organizer who has Power mode on. */
async function editing(options: EditorOptions = {}) {
  const harness = editor({ power: true, role: 'Organizer', ...options });
  await harness.page.load();
  harness.page.startEdit();
  return harness;
}

/**
 * The `toResultInput` adapter is retired with the legacy `TournamentDocument`: the result calculators
 * now take the three-tier document directly, so there is no shape to convert between and nothing to
 * carry a legacy `leagueId` slot. The detail document reaching them unchanged is asserted here.
 */
describe('result input', () => {
  it('hands the three-tier document to the calculators with no conversion', () => {
    const input = detail();
    expect(input.id).toBe('t-1');
    expect(input.seasonId).toBe('s-1');
    expect(calculateTournamentResult(input).rows.length).toBeGreaterThan(0);
    expect(detail({ seasonId: null }).seasonId).toBeNull();
  });
});

describe('archived tournament detail page', () => {
  it('reads a browser-local Tournament from the browser store, and never puts its id on the wire', () => {
    // ADR 0028: a `local-` id lives in this browser and is never sent to a server. Without the guard
    // the detail route issues `GET /api/archive/tournaments/local-…`, which leaks the id and then
    // renders not-found on the 404 — the row is listed in both tabs but cannot be opened.
    const factory = source.slice(
      source.indexOf('function archiveTournamentDetailSourceFactory'),
      source.indexOf('export const ARCHIVE_TOURNAMENT_DETAIL_SOURCE')
    );
    const guard = factory.indexOf('isLocalArchiveId(tournamentId)');
    const wire = factory.indexOf('client.archiveTournamentDetail(tournamentId)');

    expect(guard, 'the browser-local guard').toBeGreaterThan(-1);
    expect(wire, 'the server read').toBeGreaterThan(-1);
    // The guard returns BEFORE the wire call, which is the whole invariant.
    expect(guard).toBeLessThan(wire);
    // Routed through the repository, which already picks its port from the id prefix — not a second
    // reader of `gones-archive-local`.
    expect(factory).toContain('repo.getTournament(tournamentId)');
  });

  it('computes the ranking from the document', async () => {
    const page = build();
    await page.load();
    expect(page.result().rows.map((row) => row.playerName).sort()).toEqual(['Ana', 'Ben', 'Cleo']);
  });

  it('links the season of a season-bound tournament', async () => {
    const page = build();
    await page.load();
    expect(page.seasonName()).toBe('Ligue Lyon 2026');
    expect(source).toContain(`[routerLink]="['/archive/league-seasons', t.seasonId]"`);
  });

  it('says standalone instead of linking a season', async () => {
    const page = build({ getTournament: async () => detail({ seasonId: null }) });
    await page.load();
    expect(page.seasonName()).toBe('');
    expect(source).toContain('archive-tournament-standalone');
    expect(source).toContain('@if (t.seasonId) {');
  });

  it('marks a locked tournament', async () => {
    const page = build({ getTournament: async () => detail({ tournamentDate: '2019-01-04' }) });
    await page.load();
    expect(page.locked()).toBe(true);
  });

  it('never locks a browser-local tournament', async () => {
    const page = build({ getTournament: async () => detail({ id: 'local-1', tournamentDate: '2019-01-04' }) });
    await page.load();
    expect(page.locked()).toBe(false);
  });

  it('renders the not-found card for a missing tournament', async () => {
    const page = build({ getTournament: async () => undefined });
    await page.load();
    expect(page.notFound()).toBe(true);
    expect(page.error()).toBe('');
  });

  it('renders the error when the read rejects', async () => {
    const page = build({ getTournament: async () => { throw new Error('offline'); } });
    await page.load();
    expect(page.error()).toBe(translate('en', 'archiveDetail.loadFailed'));
  });

  // T14 asserted this page could not mutate at all. T17 gives it ADR 0037's staged editor, so the
  // guarantee narrows from "no mutation exists" to "no mutation without an explicit Edit": every
  // ngModel lives inside a canManage()/editing() guard, and editing() starts false.
  it('the detail page starts read-only for everyone', async () => {
    const page = build();
    await page.load();
    expect(page.editing()).toBe(false);
    expect(page.draft()).toBeNull();
    expect(source).toContain('data-cy="archive-tournament-read-only"');

    const template = source.slice(source.indexOf('template: `'), source.indexOf('styles: ['));
    for (const at of [...template.matchAll(/ngModel/g)].map((hit) => hit.index ?? 0)) {
      const before = template.slice(0, at);
      const guard = Math.max(before.lastIndexOf('@if (canManage())'), before.lastIndexOf('@if (editing())'));
      expect(guard, `ngModel at ${at} sits outside a canManage()/editing() guard`).toBeGreaterThan(-1);
      // The guard must still be open: no `}` closing it between the guard and this binding.
      const opened = (before.slice(guard).match(/\{/g) ?? []).length;
      const closed = (before.slice(guard).match(/\}/g) ?? []).length;
      expect(opened, `ngModel at ${at} escaped its guard`).toBeGreaterThan(closed);
    }
  });

  it('links the result page', () => {
    expect(source).toContain(`[routerLink]="['/archive/tournaments', tournamentId(), 'result']"`);
  });

  it('carries both back buttons', () => {
    expect(source).toContain('position="top"');
    expect(source).toContain('position="bottom"');
  });
});

describe('archive staged edit — the three gates', () => {
  it('the edit control needs power mode, authority and an unlocked row', async () => {
    for (const power of [true, false]) {
      for (const role of ['User', 'Organizer', 'Admin']) {
        for (const id of ['local-1', 'server-1']) {
          for (const old of [false, true]) {
            const tournamentDate = old ? daysAgo(400) : daysAgo(0);
            const harness = editor({
              power, role, tournamentId: id,
              detailSource: { getTournament: async () => detail({ id, tournamentDate }) }
            });
            await harness.page.load();
            // Restated independently of the component: a `local-` row is exempt from the window,
            // an Admin bypasses it, and the browser preference alone never grants authority.
            const locked = !id.startsWith('local-') && old;
            const authority = id.startsWith('local-') || role === 'Organizer' || role === 'Admin';
            const expected = power && authority && (!locked || role === 'Admin');
            expect(harness.page.canEdit(), `power=${power} role=${role} id=${id} old=${old}`).toBe(expected);
          }
        }
      }
    }
  });

  it('an admin may still edit a locked tournament', async () => {
    const harness = editor({
      power: true, role: 'Admin', tournamentId: 'server-1',
      detailSource: { getTournament: async () => detail({ id: 'server-1', tournamentDate: daysAgo(400) }) }
    });
    await harness.page.load();
    expect(harness.page.lockBlocksEdit()).toBe(false);
    expect(harness.page.canEdit()).toBe(true);
  });

  it('a browser-local record is never locked', async () => {
    const harness = editor({
      power: true, role: 'User', tournamentId: 'local-1',
      detailSource: { getTournament: async () => detail({ id: 'local-1', tournamentDate: daysAgo(400) }) }
    });
    await harness.page.load();
    expect(harness.page.lockBlocksEdit()).toBe(false);
    expect(harness.page.canEdit()).toBe(true);
  });
});

describe('archive staged edit — drafting', () => {
  it('starting an edit clones the document and calls no repository method', async () => {
    const harness = editor({ power: true, role: 'Organizer' });
    await harness.page.load();
    harness.repo.listLeagueSeasons.mockClear();
    harness.page.startEdit();
    expect(harness.page.editing()).toBe(true);
    expect(harness.page.draft()).not.toBe(harness.page.tournament());
    expect(harness.page.draft()!.rounds[0]).not.toBe(harness.page.tournament()!.rounds[0]);
    expect(harness.repo.listLeagueSeasons).not.toHaveBeenCalled();
    expect(harness.repo.getTournament).not.toHaveBeenCalled();
    expect(harness.repo.saveTournamentEdits).not.toHaveBeenCalled();
  });

  it('cancelling a clean edit exits without a dialog', async () => {
    const harness = await editing();
    await harness.page.cancelEdit();
    expect(harness.dialogCalls).toHaveLength(0);
    expect(harness.page.editing()).toBe(false);
  });

  it('cancelling a dirty edit asks first', async () => {
    const harness = await editing({ confirm: undefined });
    harness.page.markDirty();
    await harness.page.cancelEdit();
    expect(harness.dialogCalls).toHaveLength(1);
    expect(harness.page.editing()).toBe(true);
    expect(harness.page.draft()).not.toBeNull();
  });
});

describe('archive staged edit — saving', () => {
  it('an empty save exits edit mode without a repository call', async () => {
    const harness = await editing();
    await harness.page.save();
    expect(harness.repo.saveTournamentEdits).not.toHaveBeenCalled();
    expect(harness.dialogCalls).toHaveLength(0);
    expect(harness.page.editing()).toBe(false);
  });

  it('a blank name is refused before any request', async () => {
    const harness = await editing();
    harness.page.draft()!.name = '   ';
    await harness.page.save();
    expect(harness.page.error()).toBe(translate('en', 'archiveEdit.nameRequired'));
    expect(harness.repo.saveTournamentEdits).not.toHaveBeenCalled();
    expect(harness.page.draft()).not.toBeNull();
  });

  it('an invalid entry is refused before any request', async () => {
    const harness = await editing();
    harness.page.draft()!.rounds[0].entries.push(match('m-bad', 'Zed', '', 2, 0));
    await harness.page.save();
    expect(harness.page.error()).toBe(translate('en', 'archiveEdit.invalidDraft', { count: 1 }));
    expect(harness.repo.saveTournamentEdits).not.toHaveBeenCalled();
    expect(harness.page.draft()).not.toBeNull();
  });

  it('the save dialog reports the move and both deletion counts', async () => {
    const harness = await editing({ confirm: true, seasons: [season('s-2', false, 'Autumn Season')] });
    harness.page.draft()!.rounds = [{ id: 'r-1', entries: [] }];
    harness.page.moveTournamentToSeason('s-2');
    await harness.page.save();
    expect(harness.dialogCalls).toHaveLength(1);
    expect(harness.dialogCalls[0].data.message).toContain('Autumn Season');
    expect(harness.dialogCalls[0].data.message).toContain('Deleted rounds: 1');
    expect(harness.dialogCalls[0].data.message).toContain('Deleted entries: 1');
    expect(harness.dialogCalls[0].data.destructive).toBe(true);
  });

  it('a save with no deletion is not destructive', async () => {
    const harness = await editing({ confirm: true });
    harness.page.draft()!.name = 'Renamed';
    await harness.page.save();
    expect(harness.dialogCalls[0].data.destructive).toBe(false);
    expect(harness.dialogCalls[0].data.message).toContain(translate('en', 'archiveEdit.noSeasonMove'));
  });

  it('a cancelled confirmation issues no request', async () => {
    const harness = await editing({ confirm: undefined });
    harness.page.draft()!.name = 'Renamed';
    await harness.page.save();
    expect(harness.dialogCalls).toHaveLength(1);
    expect(harness.repo.saveTournamentEdits).not.toHaveBeenCalled();
    expect(harness.page.editing()).toBe(true);
    expect(harness.page.draft()!.name).toBe('Renamed');
  });

  it('a successful save adopts the response without refetching', async () => {
    const harness = await editing({ confirm: true, saveResult: detail({ name: 'Committed', documentVersion: 5 }) });
    harness.page.draft()!.name = 'Committed';
    await harness.page.save();
    expect(harness.repo.saveTournamentEdits).toHaveBeenCalledTimes(1);
    expect(harness.page.tournament()!.name).toBe('Committed');
    expect(harness.page.tournament()!.documentVersion).toBe(5);
    expect(harness.page.editing()).toBe(false);
    expect(harness.page.dirty()).toBe(false);
    expect(harness.repo.getTournament).not.toHaveBeenCalled();
  });

  it('the save sends the version the draft was cloned from', async () => {
    const harness = await editing({ confirm: true });
    harness.page.draft()!.name = 'Renamed';
    await harness.page.save();
    expect(harness.repo.saveTournamentEdits).toHaveBeenCalledWith(expect.objectContaining({
      tournamentId: 't-1',
      expectedVersion: 3
    }));
  });
});

/** How the browser-local authority reports a locked Tournament: a local message, not a wire code. */
class LocalArchiveLockedError extends Error {
  readonly status = 409;
  constructor() {
    super('archiveTournamentLocked');
    this.name = 'LocalArchiveLockedError';
  }
}

describe('archive staged edit — refusals', () => {
  async function refused(error: unknown) {
    const harness = await editing({ confirm: true, saveRejects: error });
    harness.page.draft()!.name = 'Unsaved Draft';
    await harness.page.save();
    return harness;
  }

  it('a 412 keeps the draft and offers Reload Latest', async () => {
    const harness = await refused(new ApiProblemError(412, { code: 'stale_version' }));
    expect(harness.page.stale()).toBe(true);
    expect(harness.page.editing()).toBe(true);
    expect(harness.page.draft()!.name).toBe('Unsaved Draft');
    expect(harness.page.error()).toBe(translate('en', 'archiveEdit.staleSave'));
  });

  it('a browser-local stale write is the same conflict', async () => {
    const harness = await refused(new ArchiveConcurrencyError());
    expect(harness.page.stale()).toBe(true);
    expect(harness.page.editing()).toBe(true);
    expect(harness.page.draft()!.name).toBe('Unsaved Draft');
    expect(harness.page.error()).toBe(translate('en', 'archiveEdit.staleSave'));
  });

  it('a 409 lock refusal is reported as a lock', async () => {
    const harness = await refused(new ApiProblemError(409, { code: 'archive_tournament_locked' }));
    expect(harness.page.error()).toBe(translate('en', 'archiveEdit.lockedSave'));
    expect(harness.page.stale()).toBe(false);
    expect(harness.page.draft()!.name).toBe('Unsaved Draft');
  });

  // The ticket's Test plan wrote this input as `new ApiProblemError(409, { code: 'archiveTournamentLocked' })`.
  // That is not reachable: `archiveCommandError` matches the camelCase spelling on `Error.message`,
  // never on `problem.code`, and the API only ever emits the snake_case `archive_tournament_locked`
  // (`ArchiveTournamentCommandEndpoints.cs:703`). camelCase is the BROWSER-LOCAL mirror, so that is
  // the shape asserted here — the wire/local distinction stays exact instead of being blurred.
  it('a camelCase lock code is reported the same way', async () => {
    const harness = await refused(new LocalArchiveLockedError());
    expect(harness.page.error()).toBe(translate('en', 'archiveEdit.lockedSave'));
    expect(harness.page.stale()).toBe(false);
    expect(harness.page.draft()!.name).toBe('Unsaved Draft');
  });

  it('a 403 is reported as forbidden', async () => {
    const harness = await refused(new ApiProblemError(403, {}));
    expect(harness.page.error()).toBe(translate('en', 'archiveEdit.forbidden'));
    expect(harness.page.draft()!.name).toBe('Unsaved Draft');
  });

  it('a 404 says the tournament is gone', async () => {
    const harness = await refused(new ApiProblemError(404, { code: 'not_found' }));
    expect(harness.page.error()).toBe(translate('en', 'archiveEdit.notFoundSave'));
    expect(harness.page.draft()!.name).toBe('Unsaved Draft');
  });

  it('a 400 is reported as a refusal, not a crash', async () => {
    const harness = await refused(new ApiProblemError(400, { code: 'validation_failed' }));
    expect(harness.page.error()).toBe(translate('en', 'archiveEdit.invalidSave'));
    expect(harness.page.draft()!.name).toBe('Unsaved Draft');
  });
});

describe('archive staged edit — reload latest', () => {
  it('cancelling Reload Latest keeps the draft', async () => {
    const harness = await editing({ confirm: true, saveRejects: new ApiProblemError(412, { code: 'stale_version' }) });
    harness.page.draft()!.name = 'Unsaved Draft';
    await harness.page.save();
    harness.repo.getTournament.mockClear();
    harness.setConfirm(undefined);
    await harness.page.reloadLatest();
    expect(harness.repo.getTournament).not.toHaveBeenCalled();
    expect(harness.page.draft()!.name).toBe('Unsaved Draft');
    expect(harness.page.stale()).toBe(true);
  });

  it('confirming Reload Latest replaces the document and drops the draft', async () => {
    const harness = await editing({
      confirm: true,
      saveRejects: new ApiProblemError(412, { code: 'stale_version' }),
      reloadResult: detail({ documentVersion: 6 })
    });
    harness.page.draft()!.name = 'Unsaved Draft';
    await harness.page.save();
    await harness.page.reloadLatest();
    expect(harness.repo.getTournament).toHaveBeenCalledTimes(1);
    expect(harness.page.tournament()!.documentVersion).toBe(6);
    expect(harness.page.draft()).toBeNull();
    expect(harness.page.editing()).toBe(false);
    expect(harness.page.stale()).toBe(false);
  });
});


describe('archive staged edit — status toggle', () => {
  it('the status toggle sends a status-only batch', async () => {
    const harness = editor({
      power: true, role: 'Organizer',
      confirm: true,
      detailSource: { getTournament: async () => detail({ status: 'active' }) }
    });
    await harness.page.load();
    await harness.page.toggleStatus();
    expect(harness.repo.saveTournamentEdits).toHaveBeenCalledTimes(1);
    expect(harness.repo.saveTournamentEdits.mock.calls[0][0]).toEqual({
      tournamentId: 't-1',
      expectedVersion: 3,
      batch: { status: 'completed', addRounds: [], deleteRoundIds: [], replaceRounds: [], updateArchetypes: [] }
    });
  });

  it('the status toggle is hidden while editing', async () => {
    const harness = await editing();
    expect(harness.page.canToggleStatus()).toBe(false);
    await harness.page.cancelEdit();
    expect(harness.page.canToggleStatus()).toBe(true);
  });
});

describe('archive staged edit — the season move', () => {
  it('the season selector offers only same-authority seasons plus standalone', async () => {
    const harness = editor({
      power: true, role: 'Organizer', tournamentId: 'server-1',
      seasons: [season('s1', false), season('local-s2', true)],
      detailSource: { getTournament: async () => detail({ id: 'server-1' }) }
    });
    await harness.page.load();
    expect(harness.page.seasonOptions().map((option) => option.id)).toEqual(['s1']);
    expect(source).toContain('[value]="standaloneValue"');
  });

  it('selecting the standalone option stages a null season', async () => {
    const harness = await editing({ seasons: [season('s-1', false)] });
    harness.page.moveTournamentToSeason(ARCHIVE_STANDALONE_SEASON_VALUE);
    expect(harness.page.selectedSeasonId()).toBeNull();
    expect(harness.page.dirty()).toBe(true);
  });

  it('an unknown season value is ignored', async () => {
    const harness = await editing({ seasons: [season('s-1', false)] });
    harness.page.moveTournamentToSeason('nope');
    expect(harness.page.selectedSeasonId()).toBe('s-1');
    expect(harness.page.dirty()).toBe(false);
  });

  it('a failed season catalog read still renders the page', async () => {
    const harness = editor({ power: true, role: 'Organizer', listRejects: true });
    await harness.page.load();
    expect(harness.page.tournament()).not.toBeNull();
    expect(harness.page.seasonOptions()).toEqual([]);
    expect(harness.page.error()).toBe('');
  });
});

