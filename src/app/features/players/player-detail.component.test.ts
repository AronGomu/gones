import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createLeague, createTournament, PersistedLeague } from '../../domain/models';
import { PlayerDetailComponent, paginateMatches } from './player-detail.component';

function league(id: string, opponent: string, count = 1): PersistedLeague {
  return { ...createLeague({
    id,
    tournaments: [createTournament({
      id: `${id}-event`,
      leagueId: id,
      name: id,
      rounds: Array.from({ length: count }, (_, index) => ({
        id: `${id}-round-${index}`,
        entries: [{ kind: 'match', id: `${id}-match-${index}`, table: '1', player1Name: 'Alice', player2Name: opponent, player1Score: 2, player2Score: 0, player1DeckArchetype: 'Tempo', player2DeckArchetype: '' }],
      })),
    })],
  }), documentVersion: 1 };
}

function component(leagues: PersistedLeague[] = []): PlayerDetailComponent {
  const repo = { listLeagues: vi.fn().mockResolvedValue(leagues) };
  const route = { snapshot: { paramMap: { get: () => 'Alice' } } };
  const router = { navigate: vi.fn() };
  const i18n = { t: (key: string) => key, plural: (count: number) => String(count), formatDate: (value: string) => value };
  return new PlayerDetailComponent(repo as never, route as never, router as never, i18n as never);
}

describe('PlayerDetailComponent', () => {
  it('defaults to server Leagues and recomputes stats/history when local data is enabled', async () => {
    localStorage.clear();
    const player = component([league('server-league', 'Bob'), league('local-league', 'Carol')]);
    await Promise.resolve();

    expect(player.onlineOnly()).toBe(true);
    expect(player.selectedLeagues().map((item) => item.id)).toEqual(['server-league']);
    expect(player.stats()).toMatchObject({
      playedMatchCount: 1,
      matchWins: 1,
      matchLosses: 0,
      matchDraws: 0,
      playedGameCount: 2,
      gameWins: 2,
      gameLosses: 0,
      matchWinrate: 1,
      gameWinrate: 1,
      nemesis: null,
      rival: { name: 'Bob', wins: 1, losses: 0 },
      mostPlayedArchetype: { name: 'Tempo', matchCount: 1 },
    });

    player.setOnlineOnly(false);
    expect(player.selectedLeagues().map((item) => item.id)).toEqual(['server-league', 'local-league']);
    expect(player.stats().playedMatchCount).toBe(2);
    expect(player.filteredMatches()).toHaveLength(2);
  });

  it('renders exact seven-count then five-metric card order', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/features/players/player-detail.component.ts'), 'utf8');
    const cards = [...source.matchAll(/data-cy="player-stat-card-([^"]+)"/g)].map((match) => match[1]);
    expect(cards).toEqual([
      'played-matches', 'match-wins', 'match-losses', 'match-draws', 'played-games', 'game-wins', 'game-losses',
      'match-winrate', 'game-winrate', 'nemesis', 'rival', 'most-played-archetype',
    ]);
  });

  it('slices pages and resets/clamps page after view changes', async () => {
    localStorage.clear();
    const player = component([league('server-league', 'Bob', 120)]);
    await Promise.resolve();

    expect(player.matchPageSize()).toBe(50);
    expect(player.pagedMatches()).toHaveLength(50);
    expect(player.totalPages()).toBe(3);
    player.nextPage();
    player.nextPage();
    expect(player.matchPage()).toBe(3);
    expect(player.pagedMatches()).toHaveLength(20);
    player.nextPage();
    expect(player.matchPage()).toBe(3);

    player.setMatchPageSize(10);
    expect(player.matchPage()).toBe(1);
    expect(player.pagedMatches()).toHaveLength(10);
    expect(localStorage.getItem('gones.playerStats.matchPageSize')).toBe('10');

    player.nextPage();
    player.setMatchSearch('Bob');
    expect(player.matchPage()).toBe(1);
    player.nextPage();
    player.invertMatchOrder();
    expect(player.matchPage()).toBe(1);
    player.nextPage();
    player.setOnlineOnly(false);
    expect(player.matchPage()).toBe(1);
  });

  it('pagination helper clamps unsupported page bounds', () => {
    expect(paginateMatches([1, 2, 3], 0, 2)).toEqual([1, 2]);
    expect(paginateMatches([1, 2, 3], 9, 2)).toEqual([3]);
  });
});
