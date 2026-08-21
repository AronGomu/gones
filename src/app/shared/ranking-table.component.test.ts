import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../i18n/i18n.service';
import { DeckArchetypeSettingsService } from './deck-archetype-settings.service';
import { RankingTableComponent } from './ranking-table.component';
import type { RankingRow } from '../domain/results';

const source = readFileSync(join(__dirname, 'ranking-table.component.ts'), 'utf8');

function makeRow(rank: number, playerName: string): RankingRow {
  return { rank, playerName, points: 3, matchWins: 1, matchLosses: 0, matchDraws: 0, byes: 0, playedMatchCount: 1, matchAssignmentCount: 1, gameWins: 2, gameLosses: 1, opponentsMatchWinPercentage: 0.6, gameWinPercentage: 0.7, opponentsGameWinPercentage: 0.6 };
}

function build() {
  const router = { navigate: vi.fn() } as unknown as Router;
  const injector = Injector.create({ providers: [
    { provide: Router, useValue: router },
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const comp = runInInjectionContext(injector, () => new RankingTableComponent(router));
  return comp;
}

describe('RankingTableComponent columns getter', () => {
  it('renders seven columns without ratings', () => {
    const comp = build();
    comp.ratings = null;
    expect(comp.columns).toHaveLength(7);
    expect(comp.columns).not.toContain('rating');
    expect(comp.columns.some((c: string) => c === 'rating')).toBe(false);
  });

  it('renders eight columns with ratings', () => {
    const comp = build();
    comp.ratings = new Map([['Alice', 1524]]);
    expect(comp.columns).toHaveLength(8);
    expect(comp.columns.at(-1)).toBe('rating');
  });

  it('the informational rating column does not reorder Swiss standings', () => {
    const comp = build();
    // Swiss order is Alice, Bob, Carol. The ratings invert it: Carol is the strongest player and must
    // still be last, because the rating column is informational and Swiss points own the order.
    comp.rows = [makeRow(1, 'Alice'), makeRow(2, 'Bob'), makeRow(3, 'Carol')];
    comp.ratings = new Map([['Carol', 1600], ['Bob', 1550], ['Alice', 1500]]);

    // Read the columns first: a getter that sorted `rows` in place to line the new column up would do
    // it here, and comparing `comp.rows` to its own reference afterwards could never see it.
    expect(comp.columns.at(-1)).toBe('rating');

    // One rendered row per entry of `rows`, in `rows` order, every cell read through the accessors the
    // template uses. The rating column shows the inverted numbers next to the untouched Swiss ranks.
    expect(comp.rows.map((row) => [row.rank, comp.playerLabel(row), comp.ratingLabel(row)])).toEqual([
      [1, 'Alice', '1500'],
      [2, 'Bob', '1550'],
      [3, 'Carol', '1600'],
    ]);

    // Material renders the array it is handed, so the untouched input binding is what makes the order
    // above the order on screen. A sorted copy behind a getter would pass every assertion but this one.
    expect(source).toContain('[dataSource]="rows"');
  });
});

describe('RankingTableComponent ratingLabel', () => {
  it('prints the rating for a known player', () => {
    const comp = build();
    comp.ratings = new Map([['Alice', 1524]]);
    expect(comp.ratingLabel(makeRow(1, 'Alice'))).toBe('1524');
  });

  it('prints n/a for an unknown player', () => {
    const comp = build();
    comp.ratings = new Map(); // empty map — Alice is absent
    expect(comp.ratingLabel(makeRow(1, 'Alice'))).toBe(comp.i18n.t('common.na'));
  });
});

describe('RankingTableComponent template — rating header not sortable', () => {
  it('the rating header has no aria-sort and no click handler', () => {
    const ratingHeaderIdx = source.indexOf('"ranking-header-rating"');
    expect(ratingHeaderIdx, 'ranking-header-rating data-cy must be present in source').toBeGreaterThan(-1);
    const tagStart = source.lastIndexOf('<', ratingHeaderIdx);
    const tagEnd = source.indexOf('>', ratingHeaderIdx);
    const tag = source.slice(tagStart, tagEnd + 1);
    expect(tag).not.toContain('aria-sort');
    expect(tag).not.toContain('(click)');
  });
});
