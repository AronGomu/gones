import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createLeague, createTournament, PersistedLeague } from '../../domain/models';
import { PlayerDetailResponse, PlayerMatchRow } from '../../api/generated/gones-api';
import { PlayerDetailResult } from './player-detail-cache.service';
import { PlayerDetailComponent, paginateMatches } from './player-detail.component';

function league(id: string, opponent: string, count = 1): PersistedLeague {
  return { ...createLeague({
    id,
    name: id,
    tournaments: [createTournament({
      id: `${id}-event`,
      leagueId: id,
      name: id,
      tournamentDate: '2026-01-01',
      playerArchetypes: [{ playerName: 'Alice', archetype: 'Tempo' }],
      rounds: Array.from({ length: count }, (_, index) => ({
        id: `${id}-round-${index}`,
        entries: [{ kind: 'match', id: `${id}-match-${index}`, table: '1', player1Name: 'Alice', player2Name: opponent, player1Score: 2, player2Score: 0, player1DeckArchetype: 'Tempo', player2DeckArchetype: '' }],
      })),
    })],
  }), documentVersion: 1 };
}

function serverMatch(overrides: Partial<PlayerMatchRow> = {}): PlayerMatchRow {
  return {
    kind: 'match', leagueId: 'server-league', leagueName: 'Server League',
    tournamentId: 'server-event', tournamentName: 'Server Event', tournamentDate: '2026-03-05',
    roundIndex: 0, opponentName: 'Bob', ownScore: 2, opponentScore: 1,
    ownArchetype: 'Control', opponentArchetype: 'Aggro',
    ...overrides
  };
}

function serverPayload(overrides: Partial<PlayerDetailResponse> = {}): PlayerDetailResponse {
  const matches = overrides.matches ?? [serverMatch()];
  return {
    statistics: {
      // The endpoint always emits 1 here — it is the row's index in its own response, not a rank.
      position: 1, playerName: 'Alice', playedMatchCount: 1, matchWins: 1, matchLosses: 0, matchDraws: 0,
      matchWinrate: 1, playedGameCount: 3, gameWins: 2, gameLosses: 1, gameWinrate: 2 / 3,
      nemesis: undefined, rival: { name: 'Bob', wins: 1, losses: 0 }, mostPlayedArchetype: { name: 'Control', matchCount: 1 }
    },
    matches,
    totalMatchCount: matches.length,
    truncated: false,
    ...overrides
  };
}

function result(items: PlayerDetailResponse | null, extra: Partial<PlayerDetailResult> = {}): PlayerDetailResult {
  return { items, fetchedAt: new Date().toISOString(), fromCache: false, stale: false, truncated: false, ...extra };
}

function component(options: { payload?: PlayerDetailResponse | null; local?: PersistedLeague[]; truncated?: boolean } = {}) {
  const listLocalLeagues = vi.fn().mockResolvedValue(options.local ?? []);
  const repo = { listLocalLeagues, listLeagues: vi.fn().mockResolvedValue([]) };
  const route = { snapshot: { paramMap: { get: () => 'Alice' } } };
  const router = { navigate: vi.fn() };
  const i18n = { t: (key: string) => key, plural: (count: number) => String(count), formatDate: (value: string) => value };
  const payload = options.payload === undefined ? serverPayload() : options.payload;
  const load = vi.fn().mockResolvedValue(result(payload, { truncated: options.truncated ?? payload?.truncated ?? false }));
  const cache = { load };
  const player = new PlayerDetailComponent(repo as never, route as never, router as never, i18n as never, cache as never);
  return { player, load, listLocalLeagues, router };
}

/** Both loads are promise chains started in the constructor / a setter. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('PlayerDetailComponent', () => {
  it('reads the server and never downloads a league with online-only on', async () => {
    localStorage.clear();
    const { player, load, listLocalLeagues } = component({ local: [league('local-league', 'Carol')] });
    await settle();

    expect(player.onlineOnly()).toBe(true);
    expect(load).toHaveBeenCalledWith('Alice', {});
    expect(listLocalLeagues).not.toHaveBeenCalled();
    expect(player.stats()).toMatchObject({
      playedMatchCount: 1, matchWins: 1, matchLosses: 0, matchDraws: 0,
      playedGameCount: 3, gameWins: 2, gameLosses: 1, matchWinrate: 1,
      nemesis: null, rival: { name: 'Bob', wins: 1, losses: 0 }, mostPlayedArchetype: { name: 'Control', matchCount: 1 },
    });
    expect(player.filteredMatches()).toHaveLength(1);
  });

  it('does not merge a browser-local league while online-only is on', async () => {
    localStorage.clear();
    const { player } = component({ local: [league('local-league', 'Carol')] });
    await settle();

    // Totals are the server row verbatim, even though a local league exists in this browser.
    expect(player.stats().playedMatchCount).toBe(1);
    expect(player.allMatches().every((match) => !match.isLocal)).toBe(true);
  });

  it('merges browser-local leagues into the totals and the history with online-only off', async () => {
    localStorage.clear();
    const { player, listLocalLeagues } = component({ local: [league('local-league', 'Carol')] });
    await settle();

    player.setOnlineOnly(false);
    await settle();

    expect(listLocalLeagues).toHaveBeenCalledTimes(1);
    expect(player.stats()).toMatchObject({
      playedMatchCount: 2, matchWins: 2, matchLosses: 0, matchDraws: 0,
      playedGameCount: 5, gameWins: 4, gameLosses: 1,
    });
    // Ratios are recomputed from the merged counts, never averaged.
    expect(player.stats().matchWinrate).toBe(1);
    expect(player.stats().gameWinrate).toBeCloseTo(4 / 5, 10);
    // Rival is recomputed over the merged history: Bob and Carol tie on one match, ordinal wins.
    expect(player.stats().rival).toEqual({ name: 'Bob', wins: 1, losses: 0 });
    expect(player.filteredMatches()).toHaveLength(2);
    expect(player.filteredMatches().map((match) => match.opponentName).sort()).toEqual(['Bob', 'Carol']);
  });

  it('marks each browser-local match and leaves the server ones unmarked', async () => {
    localStorage.clear();
    const { player } = component({ local: [league('local-league', 'Carol')] });
    await settle();
    player.setOnlineOnly(false);
    await settle();

    const local = player.allMatches().filter((match) => match.isLocal);
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ leagueId: 'local-league', tournamentId: 'local-league-event', opponentName: 'Carol', ownArchetype: 'Tempo' });
    expect(player.allMatches().filter((match) => !match.isLocal).map((match) => match.opponentName)).toEqual(['Bob']);
  });

  it('never counts a server league twice when it is also handed back as local', async () => {
    localStorage.clear();
    // A repository that answers with a server-id league is filtered out: those matches are already
    // in the server payload, and adding them again would double the totals.
    const { player } = component({ local: [league('server-league', 'Bob')] });
    await settle();
    player.setOnlineOnly(false);
    await settle();

    expect(player.localLeagues()).toEqual([]);
    expect(player.stats().playedMatchCount).toBe(1);
  });

  it('renders a browser-local-only player when the server answers 404 and online-only is off', async () => {
    localStorage.clear();
    const { player } = component({ payload: null, local: [league('local-league', 'Carol')] });
    await settle();
    player.setOnlineOnly(false);
    await settle();

    expect(player.stats()).toMatchObject({ playedMatchCount: 1, matchWins: 1, playedGameCount: 2, gameWins: 2, gameLosses: 0 });
    expect(player.filteredMatches()).toHaveLength(1);
    expect(player.filteredMatches()[0].isLocal).toBe(true);
  });

  it('shows the empty state for a browser-local-only player while online-only is on', async () => {
    localStorage.clear();
    const { player } = component({ payload: null, local: [league('local-league', 'Carol')] });
    await settle();

    expect(player.stats().playedMatchCount).toBe(0);
    expect(player.stats().matchWinrate).toBeNull();
    expect(player.filteredMatches()).toHaveLength(0);
  });

  it('forces a refetch when Synchronize is pressed', async () => {
    localStorage.clear();
    const { player, load } = component();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    player.onSync();
    await settle();

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith('Alice', { force: true });
    expect(player.syncedAt()).toBeTruthy();
  });

  it('reports the truncation the server declared', async () => {
    localStorage.clear();
    const { player } = component({ payload: serverPayload({ truncated: true, totalMatchCount: 6000 }), truncated: true });
    await settle();

    expect(player.truncated()).toBe(true);
    expect(player.totalMatchCount()).toBe(6000);
    expect(player.serverMatchCount()).toBe(1);
  });

  it('takes the canonical spelling from the read model', async () => {
    localStorage.clear();
    const { player } = component({ payload: serverPayload({ statistics: { ...serverPayload().statistics, playerName: 'ALICE' } }) });
    await settle();

    expect(player.playerName()).toBe('ALICE');
  });

  it('keeps the match filter narrowing and highlighting', async () => {
    localStorage.clear();
    const { player } = component({ payload: serverPayload({ matches: [serverMatch(), serverMatch({ opponentName: 'Carol', roundIndex: 1 })] }) });
    await settle();

    expect(player.filteredMatches()).toHaveLength(2);
    player.setMatchSearch('Carol');
    expect(player.filteredMatches()).toHaveLength(1);
    expect(player.filteredMatches()[0].opponentName).toBe('Carol');
    expect(player.highlightParts('Carol').some((part) => part.highlighted)).toBe(true);
    player.clearMatchSearch();
    expect(player.filteredMatches()).toHaveLength(2);
  });

  it('keeps the order toggle, the page size and pagination', async () => {
    localStorage.clear();
    const matches = Array.from({ length: 120 }, (_, index) => serverMatch({
      roundIndex: index, opponentName: `Rival ${index}`, tournamentDate: `2026-03-${String((index % 28) + 1).padStart(2, '0')}`
    }));
    const { player } = component({ payload: serverPayload({ matches }) });
    await settle();

    expect(player.matchPageSize()).toBe(50);
    expect(player.pagedMatches()).toHaveLength(50);
    expect(player.totalPages()).toBe(3);
    player.nextPage();
    player.nextPage();
    expect(player.matchPage()).toBe(3);
    expect(player.pagedMatches()).toHaveLength(20);
    player.nextPage();
    expect(player.matchPage()).toBe(3);

    const newestFirst = player.orderedMatches()[0];
    player.invertMatchOrder();
    expect(player.matchPage()).toBe(1);
    expect(player.orderedMatches().at(-1)).toEqual(newestFirst);

    player.setMatchPageSize(10);
    expect(player.matchPage()).toBe(1);
    expect(player.pagedMatches()).toHaveLength(10);
    expect(localStorage.getItem('gones.playerStats.matchPageSize')).toBe('10');

    player.nextPage();
    player.setMatchSearch('Rival 7');
    expect(player.matchPage()).toBe(1);
  });

  it('still opens the archive tournament of a match', async () => {
    localStorage.clear();
    const { player, router } = component();
    await settle();

    player.openMatchTournament(player.filteredMatches()[0]);

    expect(router.navigate).toHaveBeenCalledWith(
      ['/leagues-archive', 'server-league', 'tournaments-archive', 'server-event'],
      { queryParams: { round: 1 } },
    );
  });

  it('tints the opponent of the nemesis and the rival', async () => {
    localStorage.clear();
    const { player } = component();
    await settle();

    expect(player.opponentTone('Bob')).toBe('rival');
    expect(player.opponentTone('Carol')).toBeNull();
  });

  it('renders exact seven-count then five-metric card order', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/features/players/player-detail.component.ts'), 'utf8');
    const cards = [...source.matchAll(/data-cy="player-stat-card-([^"]+)"/g)].map((match) => match[1]);
    expect(cards).toEqual([
      'played-matches', 'match-wins', 'match-losses', 'match-draws', 'played-games', 'game-wins', 'game-losses',
      'match-winrate', 'game-winrate', 'nemesis', 'rival', 'most-played-archetype',
    ]);
  });

  it('pagination helper clamps unsupported page bounds', () => {
    expect(paginateMatches([1, 2, 3], 0, 2)).toEqual([1, 2]);
    expect(paginateMatches([1, 2, 3], 9, 2)).toEqual([3]);
  });
});
