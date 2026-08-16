import { describe, expect, it } from 'vitest';
import { createGonesData, createLeague, createTournament, LeagueDocument, TournamentDocument } from './models';
import { calculateGlobalPlayerStatistics, calculatePlayerStatistics } from './player-stats';

function tournament(
  id: string,
  entries: TournamentDocument['rounds'][number]['entries'],
  playerArchetypes: TournamentDocument['playerArchetypes'] = [],
  status: TournamentDocument['status'] = 'completed',
): TournamentDocument {
  return createTournament({ id, leagueId: 'league', name: id, status, rounds: [{ id: `${id}-round`, entries }], playerArchetypes });
}

function data(leagues: LeagueDocument[]) {
  return createGonesData({ leagues });
}

describe('calculatePlayerStatistics', () => {
  it('counts match wins, losses, draws, and games while keeping byes out of performance', () => {
    const league = createLeague({
      id: 'league',
      tournaments: [tournament('event', [
        { kind: 'match', id: 'win', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 1, player1DeckArchetype: 'Fire', player2DeckArchetype: '' },
        { kind: 'match', id: 'loss', table: '2', player1Name: 'Carol', player2Name: 'Alice', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: 'Water' },
        { kind: 'match', id: 'draw', table: '3', player1Name: 'Alice', player2Name: 'Dana', player1Score: 1, player2Score: 1, player1DeckArchetype: 'Earth', player2DeckArchetype: '' },
        { kind: 'bye', id: 'bye', table: '4', playerName: 'Alice', deckArchetype: 'Ignored' },
      ])],
    });

    const stats = calculatePlayerStatistics(data([league]), 'Alice');

    expect(stats).toMatchObject({
      playedMatchCount: 3,
      byeCount: 1,
      matchWins: 1,
      matchLosses: 1,
      matchDraws: 1,
      playedGameCount: 7,
      gameWins: 3,
      gameLosses: 4,
      matchWinrate: 1 / 3,
      gameWinrate: 3 / 7,
    });
    expect(stats.matches.map((match) => match.kind)).toEqual(['match', 'match', 'match', 'bye']);
  });

  it('reports selected-player opponent records and breaks tied Nemesis/Rival names alphabetically', () => {
    const league = createLeague({
      id: 'league',
      tournaments: [tournament('event', [
        { kind: 'match', id: 'b-loss', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 0, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' },
        { kind: 'match', id: 'c-loss', table: '2', player1Name: 'Alice', player2Name: 'Carol', player1Score: 1, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' },
        { kind: 'match', id: 'b-win', table: '3', player1Name: 'Bob', player2Name: 'Alice', player1Score: 0, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' },
        { kind: 'match', id: 'c-win', table: '4', player1Name: 'Carol', player2Name: 'Alice', player1Score: 0, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' },
      ])],
    });

    const stats = calculatePlayerStatistics(data([league]), 'Alice');

    expect(stats.nemesis).toEqual({ name: 'Bob', wins: 1, losses: 1 });
    expect(stats.rival).toEqual({ name: 'Bob', wins: 1, losses: 1 });
  });

  it('uses selected Match-side archetype, falls back to Tournament roster, omits blank, and breaks ties alphabetically', () => {
    const league = createLeague({
      id: 'league',
      tournaments: [
        tournament('match-source', [
          { kind: 'match', id: 'm1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: 'Zoo', player2DeckArchetype: '' },
        ], [{ playerName: 'Alice', archetype: 'Ignored roster' }]),
        tournament('roster-fallback', [
          { kind: 'match', id: 'm2', table: '1', player1Name: 'Carol', player2Name: 'Alice', player1Score: 0, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' },
        ], [{ playerName: 'Alice', archetype: 'Alpha' }]),
        tournament('blank-omitted', [
          { kind: 'match', id: 'm3', table: '1', player1Name: 'Alice', player2Name: 'Dana', player1Score: 1, player2Score: 1, player1DeckArchetype: '   ', player2DeckArchetype: '' },
        ]),
      ],
    });

    expect(calculatePlayerStatistics(data([league]), 'Alice').mostPlayedArchetype).toEqual({ name: 'Alpha', matchCount: 1 });
  });

  it('keeps exact case-sensitive Player Names separate', () => {
    const league = createLeague({
      id: 'league',
      tournaments: [tournament('event', [
        { kind: 'match', id: 'case', table: '1', player1Name: 'Alice', player2Name: 'alice', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' },
      ])],
    });

    expect(calculatePlayerStatistics(data([league]), 'Alice')).toMatchObject({ playedMatchCount: 1, matchWins: 1 });
    expect(calculatePlayerStatistics(data([league]), 'alice')).toMatchObject({ playedMatchCount: 1, matchLosses: 1 });
  });
});

describe('calculateGlobalPlayerStatistics', () => {
  it('includes completed-Tournament Match players only, excludes active-Tournament/bye/roster-only names, and sorts exact names ordinally', () => {
    const completed = createLeague({
      id: 'league',
      status: 'completed',
      tournaments: [tournament('completed', [
        { kind: 'match', id: 'case', table: '1', player1Name: 'Alice', player2Name: 'alice', player1Score: 2, player2Score: 0, player1DeckArchetype: 'Fire', player2DeckArchetype: 'Water' },
        { kind: 'bye', id: 'bye', table: '2', playerName: 'Bye Only', deckArchetype: 'Earth' },
      ], [{ playerName: 'Roster Only', archetype: 'Air' }])],
    });
    const active = createLeague({
      id: 'active',
      status: 'active',
      tournaments: [tournament('active', [
        { kind: 'match', id: 'active-match', table: '1', player1Name: 'Alice', player2Name: 'Zed', player1Score: 0, player2Score: 2, player1DeckArchetype: '', player2DeckArchetype: '' },
      ], [], 'active')],
    });

    const rows = calculateGlobalPlayerStatistics(data([active, completed]));

    expect(rows.map((row) => row.playerName)).toEqual(['Alice', 'alice']);
    expect(rows[0]).toEqual({
      playerName: 'Alice',
      playedMatchCount: 1,
      matchWins: 1,
      matchLosses: 0,
      matchDraws: 0,
      matchWinrate: 1,
      playedGameCount: 2,
      gameWins: 2,
      gameLosses: 0,
      gameWinrate: 1,
      nemesis: null,
      rival: { name: 'alice', wins: 1, losses: 0 },
      mostPlayedArchetype: { name: 'Fire', matchCount: 1 },
    });
    expect(rows[1]).toMatchObject({ playerName: 'alice', playedMatchCount: 1, matchLosses: 1 });
  });

  it('scopes on the Tournament, not the League: a completed Tournament of an active League counts, an active Tournament of a completed League does not', () => {
    const activeLeague = createLeague({
      id: 'active-league',
      status: 'active',
      tournaments: [tournament('done', [
        { kind: 'match', id: 'done-match', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' },
      ])],
    });
    const completedLeague = createLeague({
      id: 'completed-league',
      status: 'completed',
      tournaments: [tournament('ongoing', [
        { kind: 'match', id: 'ongoing-match', table: '1', player1Name: 'Carol', player2Name: 'Dana', player1Score: 2, player2Score: 0, player1DeckArchetype: '', player2DeckArchetype: '' },
      ], [], 'active')],
    });

    const rows = calculateGlobalPlayerStatistics(data([activeLeague, completedLeague]));

    expect(rows.map((row) => row.playerName)).toEqual(['Alice', 'Bob']);
  });
});
