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
import { PersistedArchiveTournament } from '../../domain/archive-models';
import { I18nService } from '../../i18n/i18n.service';
import { translate } from '../../i18n/messages';
import { DeckArchetypeSettingsService, SettingsLanguage } from '../../shared/deck-archetype-settings.service';
import {
  ARCHIVE_TOURNAMENT_DETAIL_SOURCE,
  ArchiveTournamentDetailSource,
  TournamentDetailComponent,
  toResultInput
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
  const detailSource: ArchiveTournamentDetailSource = {
    getTournament: async () => detail(),
    getSeasonName: async () => 'Ligue Lyon 2026',
    ...overrides
  };
  const injector = Injector.create({
    providers: [
      { provide: ARCHIVE_TOURNAMENT_DETAIL_SOURCE, useValue: detailSource },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 't-1' } } } },
      { provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>('en') } },
      I18nService
    ]
  });
  return runInInjectionContext(injector, () => new TournamentDetailComponent());
}

describe('toResultInput', () => {
  it('fills the legacy league slot without inventing a league', () => {
    expect(toResultInput(detail()).leagueId).toBe('s-1');
    expect(toResultInput(detail({ seasonId: null })).leagueId).toBe('');
  });

  it('keeps every other field identical', () => {
    const input = toResultInput(detail());
    expect(input.id).toBe('t-1');
    expect(input.name).toBe('Étape 1');
    expect(input.tournamentDate).toBe('2026-02-14');
    expect(input.status).toBe('completed');
    expect(input.rounds.length).toBe(2);
    expect(input.playerArchetypes).toEqual([{ playerName: 'Ana', archetype: 'Burn' }]);
    expect('seasonId' in input).toBe(false);
  });
});

describe('archived tournament detail page', () => {
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

  it('offers no mutation', () => {
    for (const forbidden of ['save(', 'delete(', 'rename(', 'edit-batch', 'startEdit', 'ngModel']) {
      expect(source, forbidden).not.toContain(forbidden);
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
