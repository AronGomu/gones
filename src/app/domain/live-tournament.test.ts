import { describe, expect, it } from 'vitest';
import { calculateLiveStandings, calculateLiveStandingsThroughRound, createLiveTournament, createLiveTournamentPlayer, currentRoundComplete, finalizeLiveTournament, generateNextSwissRound, liveMatchScoreIssue, regenerateCurrentSwissRound, restoreLiveTournamentCheckpoint, updateLiveRoundEntryResult, validateCurrentSwissRound } from './live-tournament';

function idFactory(prefix = 'test') {
  let next = 1;
  return () => `${prefix}-${next++}`;
}

describe('live tournament', () => {
  it('generates simple Swiss pairings and assigns the lowest eligible player a bye', () => {
    const ids = idFactory();
    const tournament = createLiveTournament({
      players: ['Alice', 'Bob', 'Charlie'].map((name) => createLiveTournamentPlayer({ name, paid: true }, { idFactory: ids }))
    }, { idFactory: ids });

    const running = generateNextSwissRound(tournament, { idFactory: ids });

    expect(running.stage).toBe('round');
    expect(running.rounds[0].entries).toHaveLength(2);
    expect(running.rounds[0].entries.find((item) => item.entry.kind === 'bye')?.entry).toMatchObject({ kind: 'bye', playerName: 'Charlie' });
    expect(running.rounds[0].entries.find((item) => item.entry.kind === 'match')?.entry).toMatchObject({ kind: 'match', player1Name: 'Alice', player2Name: 'Bob' });
  });

  it('blocks round validation until all match results are entered', () => {
    const ids = idFactory();
    const tournament = generateNextSwissRound(createLiveTournament({
      players: ['Alice', 'Bob'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }))
    }, { idFactory: ids }), { idFactory: ids });
    const round = tournament.rounds[0];
    const match = round.entries[0].entry;
    expect(match.kind).toBe('match');

    expect(currentRoundComplete(tournament)).toBe(false);
    expect(validateCurrentSwissRound(tournament).stage).toBe('round');

    const scored = updateLiveRoundEntryResult(tournament, round.id, match.id, { player1Score: 2, player2Score: 1 });
    expect(currentRoundComplete(scored)).toBe(true);
    expect(validateCurrentSwissRound(scored).stage).toBe('standings');
  });

  it('calculates standings from late-player records and validated rounds', () => {
    const ids = idFactory();
    const tournament = createLiveTournament({
      players: [
        createLiveTournamentPlayer({ name: 'Late Player', initialWins: 1, initialLosses: 1 }, { idFactory: ids }),
        createLiveTournamentPlayer({ name: 'Alice' }, { idFactory: ids }),
        createLiveTournamentPlayer({ name: 'Bob' }, { idFactory: ids })
      ]
    }, { idFactory: ids });

    const standings = calculateLiveStandings(tournament);

    expect(standings[0]).toMatchObject({ playerName: 'Late Player', points: 3, matchWins: 1, matchLosses: 1 });
  });

  it('adds game-win and opponent tiebreaker stats to live standings', () => {
    const ids = idFactory();
    const running = generateNextSwissRound(createLiveTournament({
      players: ['Alice', 'Bob', 'Charlie'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }))
    }, { idFactory: ids }), { idFactory: ids });
    const match = running.rounds[0].entries.find((item) => item.entry.kind === 'match')?.entry;
    expect(match?.kind).toBe('match');

    const standings = calculateLiveStandings(validateCurrentSwissRound(updateLiveRoundEntryResult(running, running.rounds[0].id, match!.id, { player1Score: 2, player2Score: 0 })));

    expect(standings[0]).toMatchObject({ playerName: 'Alice', gameWins: 2, gameLosses: 0, gameWinPercentage: 1, opponentsMatchWinPercentage: 1 / 3, opponentsGameWinPercentage: 1 / 3 });
    expect(standings.find((row) => row.playerName === 'Bob')).toMatchObject({ gameWins: 0, gameLosses: 2, gameWinPercentage: 0 });
  });

  it('accepts whole-number match scores above best-of-three values', () => {
    const ids = idFactory();
    const tournament = generateNextSwissRound(createLiveTournament({
      players: ['Alice', 'Bob'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }))
    }, { idFactory: ids }), { idFactory: ids });
    const round = tournament.rounds[0];
    const match = round.entries[0].entry;
    expect(match.kind).toBe('match');

    const scored = updateLiveRoundEntryResult(tournament, round.id, match.id, { player1Score: 7, player2Score: 5 });
    const scoredMatch = scored.rounds[0].entries[0].entry;

    expect(scoredMatch.kind).toBe('match');
    expect(liveMatchScoreIssue(scoredMatch)).toBeNull();
    expect(currentRoundComplete(scored)).toBe(true);
  });

  it('regenerates only an unvalidated current round', () => {
    const ids = idFactory();
    const tournament = generateNextSwissRound(createLiveTournament({
      players: ['Alice', 'Bob', 'Charlie', 'Dana'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }))
    }, { idFactory: ids }), { idFactory: ids });
    const originalRoundId = tournament.rounds[0].id;

    const regenerated = regenerateCurrentSwissRound(tournament, { idFactory: ids });

    expect(regenerated.rounds).toHaveLength(1);
    expect(regenerated.rounds[0].id).toBe(originalRoundId);
    expect(regenerated.rounds[0].entries[0].entry.id).not.toBe(tournament.rounds[0].entries[0].entry.id);
  });

  it('creates restore points for round-running and standing states', () => {
    const ids = idFactory();
    const running = generateNextSwissRound(createLiveTournament({
      roundCount: 2,
      players: ['Alice', 'Bob'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }))
    }, { idFactory: ids }), { idFactory: ids });
    const round = running.rounds[0];
    const match = round.entries[0].entry;
    expect(match.kind).toBe('match');

    const scored = updateLiveRoundEntryResult(running, round.id, match.id, { player1Score: 2, player2Score: 0 });
    const standings = validateCurrentSwissRound(scored);
    const nextRound = generateNextSwissRound(standings, { idFactory: ids });

    expect(standings.checkpoints.at(-1)).toMatchObject({ label: 'Pairing 1', stage: 'round', currentRoundNumber: 1 });
    expect(nextRound.checkpoints.at(-1)).toMatchObject({ label: 'Standing 1', stage: 'standings', currentRoundNumber: 1 });

    const restoredPairing = restoreLiveTournamentCheckpoint(nextRound, standings.checkpoints[0].id);
    expect(restoredPairing).toMatchObject({ stage: 'round', currentRoundNumber: 1 });
    expect(restoredPairing.rounds).toHaveLength(1);
    expect(restoredPairing.rounds[0].validated).toBe(false);
  });

  it('prunes future restore points when returning to an earlier checkpoint', () => {
    const ids = idFactory();
    const running = generateNextSwissRound(createLiveTournament({
      roundCount: 2,
      players: ['Alice', 'Bob'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }))
    }, { idFactory: ids }), { idFactory: ids });
    const match = running.rounds[0].entries[0].entry;
    expect(match.kind).toBe('match');
    const standing = validateCurrentSwissRound(updateLiveRoundEntryResult(running, running.rounds[0].id, match.id, { player1Score: 2, player2Score: 0 }));
    const nextRound = generateNextSwissRound(standing, { idFactory: ids });

    const restored = restoreLiveTournamentCheckpoint(nextRound, standing.checkpoints[0].id);

    expect(restored.checkpoints.map((checkpoint) => checkpoint.label)).toEqual(['Pairing 1']);
  });

  it('drops malformed persisted checkpoint entries instead of rejecting the whole tournament', () => {
    const tournament = createLiveTournament({
      checkpoints: [{
        id: 'checkpoint-1',
        label: 'Pairing 1',
        createdAt: '2026-01-01T00:00:00.000Z',
        stage: 'round',
        currentRoundNumber: 1,
        roundCount: 1,
        players: [createLiveTournamentPlayer({ id: 'player-1', name: 'Alice' })],
        rounds: [{ id: 'round-1', roundNumber: 1, validated: false, entries: [{ entry: null as unknown as never, resultEntered: false }] }]
      }]
    });

    expect(tournament.checkpoints[0].rounds[0].entries).toEqual([]);
  });

  it('calculates standings through a selected validated round', () => {
    const ids = idFactory();
    const round1 = generateNextSwissRound(createLiveTournament({
      roundCount: 2,
      players: ['Alice', 'Bob'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }))
    }, { idFactory: ids }), { idFactory: ids });
    const match1 = round1.rounds[0].entries[0].entry;
    expect(match1.kind).toBe('match');
    const standing1 = validateCurrentSwissRound(updateLiveRoundEntryResult(round1, round1.rounds[0].id, match1.id, { player1Score: 2, player2Score: 0 }));
    const round2 = generateNextSwissRound(standing1, { idFactory: ids });
    const match2 = round2.rounds[1].entries[0].entry;
    expect(match2.kind).toBe('match');
    const standing2 = validateCurrentSwissRound(updateLiveRoundEntryResult(round2, round2.rounds[1].id, match2.id, { player1Score: 0, player2Score: 2 }));

    expect(calculateLiveStandingsThroughRound(standing2, 1)[0]).toMatchObject({ playerName: 'Alice', points: 3 });
    expect(calculateLiveStandingsThroughRound(standing2, 2)[0]).toMatchObject({ playerName: 'Alice', points: 3 });
  });

  it('finalizes validated live rounds to a standard tournament document', () => {
    const ids = idFactory();
    const running = generateNextSwissRound(createLiveTournament({
      name: 'Friday Night',
      leagueId: 'league-1',
      players: ['Alice', 'Bob'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }))
    }, { idFactory: ids }), { idFactory: ids });
    const round = running.rounds[0];
    const match = round.entries[0].entry;
    const scored = updateLiveRoundEntryResult(running, round.id, match.id, { player1Score: 2, player2Score: 0 });
    const validated = validateCurrentSwissRound(scored);

    const tournament = finalizeLiveTournament(validated, { idFactory: ids });

    expect(tournament).toMatchObject({ name: 'Friday Night', leagueId: 'league-1' });
    expect(tournament.rounds).toHaveLength(1);
    expect(tournament.rounds[0].entries[0]).toMatchObject({ kind: 'match', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0 });
  });
});
