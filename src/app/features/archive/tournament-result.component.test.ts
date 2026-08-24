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
import { PersistedArchiveTournament } from '../../domain/archive-models';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService, SettingsLanguage } from '../../shared/deck-archetype-settings.service';
import { ARCHIVE_TOURNAMENT_DETAIL_SOURCE, ArchiveTournamentDetailSource } from './tournament-detail.component';
import { TournamentResultComponent } from './tournament-result.component';

const source = readFileSync(join(__dirname, 'tournament-result.component.ts'), 'utf8');
const legacySource = readFileSync(
  join(__dirname, '..', 'tournaments-archive', 'tournament-archive-result.component.ts'),
  'utf8'
);

function match(id: string, player1: string, player2: string, archetype1: string, archetype2: string) {
  return {
    kind: 'match' as const,
    id,
    table: id,
    player1Name: player1,
    player2Name: player2,
    player1Score: 2,
    player2Score: 1,
    player1DeckArchetype: archetype1,
    player2DeckArchetype: archetype2
  };
}

/** `players` players spread over `decks` archetypes, paired in one round. */
function detail(players: number, overrides: Partial<PersistedArchiveTournament> = {}, decks = players): PersistedArchiveTournament {
  const names = Array.from({ length: players }, (_, index) => `Player ${index + 1}`);
  const deckOf = (index: number) => `Deck ${index % decks}`;
  const entries = [];
  for (let index = 0; index + 1 < names.length; index += 2) {
    entries.push(match(`m-${index}`, names[index], names[index + 1], deckOf(index), deckOf(index + 1)));
  }
  return {
    id: 't-1',
    name: 'Étape 1',
    seasonId: 's-1',
    tournamentDate: '2026-02-14',
    status: 'completed',
    rounds: [{ id: 'r-1', entries }],
    playerArchetypes: names.map((playerName, index) => ({ playerName, archetype: deckOf(index) })),
    documentVersion: 1,
    updatedAt: '2026-02-15T10:00:00Z',
    ...overrides
  };
}

function build(options: { url?: string; document?: PersistedArchiveTournament | undefined } = {}): TournamentResultComponent {
  const detailSource: ArchiveTournamentDetailSource = {
    getTournament: async () => ('document' in options ? options.document : detail(12)),
    getSeasonName: async () => 'Ligue Lyon 2026'
  };
  const injector = Injector.create({
    providers: [
      { provide: ARCHIVE_TOURNAMENT_DETAIL_SOURCE, useValue: detailSource },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 't-1' } } } },
      { provide: Router, useValue: { url: options.url ?? '/archive/tournaments/t-1/result' } },
      { provide: DeckArchetypeSettingsService, useValue: { language: signal<SettingsLanguage>('en') } },
      I18nService
    ]
  });
  return runInInjectionContext(injector, () => new TournamentResultComponent());
}

describe('archived tournament result page', () => {
  it('shows the top eight standings rows', async () => {
    const page = build();
    await page.load();
    expect(page.topStandingRows().length).toBe(8);
  });

  it('opens the metagame page on the metagames route', async () => {
    const page = build({ url: '/archive/tournaments/t-1/result/metagames' });
    await page.load();
    expect(page.page()).toBe('metagames');
  });

  it('opens the standings page on the result route', async () => {
    const page = build();
    await page.load();
    expect(page.page()).toBe('standings');
  });

  it('splits the metagame bars into two columns', async () => {
    const page = build({ document: detail(18, {}, 9) });
    await page.load();
    expect(page.metagameBars().length).toBe(9);
    expect(page.metagameColumns().length).toBe(2);
    expect(page.metagameColumns()[0].length).toBe(5);
    expect(page.metagameColumns()[1].length).toBe(4);
  });

  it('titles a standalone tournament without naming a league it does not have', async () => {
    const page = build({ document: detail(4, { seasonId: null }) });
    await page.load();
    expect(page.seasonName()).toBe('');
    expect(source).not.toContain('result.unknownLeague');
  });

  it('cross-links both views and the tournament', () => {
    expect(source).toContain(`['/archive/tournaments', tournamentId(), 'result', 'metagames']`);
    expect(source).toContain(`['/archive/tournaments', tournamentId(), 'result']`);
    expect(source).toContain(`['/archive/tournaments', tournamentId()]`);
  });

  it('keeps both download controls', () => {
    expect(source).toContain('data-cy="archive-tournament-result-download-image"');
    expect(source).toContain('data-cy="archive-tournament-result-download-all"');
  });

  it('renders the not-found card for a missing tournament', async () => {
    const page = build({ document: undefined });
    await page.load();
    expect(page.notFound()).toBe(true);
  });

  it('carries both back buttons', () => {
    expect(source).toContain('position="top"');
    expect(source).toContain('position="bottom"');
  });

  it('carries the pure export helpers verbatim, because the file they came from is deleted at the end of the plan', () => {
    const block = legacySource.slice(legacySource.indexOf('interface MetagameBar {'));
    expect(source).toContain(block.trimEnd());
  });
});
