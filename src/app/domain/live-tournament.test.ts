import { describe, expect, it } from 'vitest';
import { calculateLiveStandings, calculateLiveStandingsThroughRound, cancelCurrentSwissRound, createLiveTournament, createLiveTournamentPlayer, currentRoundComplete, finalizeLiveTournament, generateNextSwissRound, liveMatchScoreIssue, LiveTournamentDocument, regenerateCurrentSwissRound, restoreLiveTournamentCheckpoint, updateLiveRoundEntryResult, validateCurrentSwissRound } from './live-tournament';
import { calculateTournamentResult } from './results';
import { createMatchRoundEntry } from './models';

function pairKey(left: string, right: string): string {
  return [left, right].sort((a, b) => a.localeCompare(b)).join('::');
}

function pairKeySet(tournament: LiveTournamentDocument): Set<string> {
  return new Set(
    tournament.rounds[0]?.entries
      .filter((item) => item.entry.kind === 'match')
      .map((item) => item.entry.kind === 'match' ? pairKey(item.entry.player1Name, item.entry.player2Name) : '')
      .filter(Boolean) ?? []
  );
}

function idFactory(prefix = 'test') {
  let next = 1;
  return () => `${prefix}-${next++}`;
}

describe('live tournament', () => {
  it('generates first-round pairings from a random seed, not inscription order', () => {
    const ids = idFactory();
    const players = ['Alice', 'Bob', 'Charlie'].map((name) => createLiveTournamentPlayer({ name, paid: true }, { idFactory: ids }));
    const tournament = createLiveTournament({ players }, { idFactory: ids });

    const running = generateNextSwissRound(tournament, { idFactory: ids, randomSeed: () => 42 });

    expect(running.stage).toBe('round');
    expect(running.pairingSeed).toBe(42);
    expect(running.firstRoundPlayerOrder).toHaveLength(3);
    expect(running.rounds[0].entries).toHaveLength(2);
    expect(running.rounds[0].entries.some((item) => item.entry.kind === 'bye')).toBe(true);
    expect(running.rounds[0].entries.some((item) => item.entry.kind === 'match')).toBe(true);
    // Same seed + empty order always yields the same shuffle (not registration list order alone).
    const again = generateNextSwissRound({ ...tournament, pairingSeed: 0, firstRoundPlayerOrder: [] }, { idFactory: ids, randomSeed: () => 42 });
    expect(again.firstRoundPlayerOrder).toEqual(running.firstRoundPlayerOrder);
  });

  it('keeps first-round seed/order on cancel and reuses pairings when relaunched without new players', () => {
    const ids = idFactory();
    const players = ['Alice', 'Bob', 'Charlie', 'Dana'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }));
    const started = generateNextSwissRound(createLiveTournament({ players }, { idFactory: ids }), { idFactory: ids, randomSeed: () => 7 });
    const canceled = cancelCurrentSwissRound(started);

    expect(canceled.stage).toBe('registration');
    expect(canceled.pairingSeed).toBe(7);
    expect(canceled.firstRoundPlayerOrder).toEqual(started.firstRoundPlayerOrder);
    expect(canceled.rounds).toEqual([]);

    const relaunched = generateNextSwissRound(canceled, { idFactory: ids, randomSeed: () => 999 });
    expect(relaunched.pairingSeed).toBe(7);
    expect(relaunched.firstRoundPlayerOrder).toEqual(started.firstRoundPlayerOrder);
    expect(pairKeySet(relaunched)).toEqual(pairKeySet(started));
  });

  it('pairs one new player against the previous bye (or gives bye if none)', () => {
    const ids = idFactory();
    const alice = createLiveTournamentPlayer({ name: 'Alice' }, { idFactory: ids });
    const bob = createLiveTournamentPlayer({ name: 'Bob' }, { idFactory: ids });
    const charlie = createLiveTournamentPlayer({ name: 'Charlie' }, { idFactory: ids });
    const base = generateNextSwissRound(createLiveTournament({
      players: [alice, bob, charlie],
      pairingSeed: 1,
      firstRoundPlayerOrder: [alice.id, bob.id, charlie.id]
    }, { idFactory: ids }), { idFactory: ids });
    expect(base.rounds[0].entries.find((item) => item.entry.kind === 'bye')?.entry).toMatchObject({ playerName: 'Charlie' });

    const canceled = cancelCurrentSwissRound(base);
    const dana = createLiveTournamentPlayer({ name: 'Dana' }, { idFactory: ids });
    const withOneNew = generateNextSwissRound({
      ...canceled,
      players: [...canceled.players, dana]
    }, { idFactory: ids });

    expect(withOneNew.rounds[0].entries.some((item) => item.entry.kind === 'bye')).toBe(false);
    expect(withOneNew.rounds[0].entries).toHaveLength(2);
    expect(pairKeySet(withOneNew).has(pairKey('Alice', 'Bob'))).toBe(true);
    expect(pairKeySet(withOneNew).has(pairKey('Charlie', 'Dana'))).toBe(true);

    const evenBase = generateNextSwissRound(createLiveTournament({
      players: [alice, bob],
      pairingSeed: 2,
      firstRoundPlayerOrder: [alice.id, bob.id]
    }, { idFactory: ids }), { idFactory: ids });
    const evenCanceled = cancelCurrentSwissRound(evenBase);
    const eve = createLiveTournamentPlayer({ name: 'Eve' }, { idFactory: ids });
    const withByeNew = generateNextSwissRound({
      ...evenCanceled,
      players: [...evenCanceled.players, eve]
    }, { idFactory: ids });
    expect(withByeNew.rounds[0].entries.find((item) => item.entry.kind === 'bye')?.entry).toMatchObject({ playerName: 'Eve' });
    expect(pairKeySet(withByeNew).has(pairKey('Alice', 'Bob'))).toBe(true);
  });

  it('pairs multiple new players among themselves without reshuffling locked pairings', () => {
    const ids = idFactory();
    const alice = createLiveTournamentPlayer({ name: 'Alice' }, { idFactory: ids });
    const bob = createLiveTournamentPlayer({ name: 'Bob' }, { idFactory: ids });
    const charlie = createLiveTournamentPlayer({ name: 'Charlie' }, { idFactory: ids });
    const base = generateNextSwissRound(createLiveTournament({
      players: [alice, bob, charlie],
      pairingSeed: 3,
      firstRoundPlayerOrder: [alice.id, bob.id, charlie.id]
    }, { idFactory: ids }), { idFactory: ids });
    const canceled = cancelCurrentSwissRound(base);
    const dana = createLiveTournamentPlayer({ name: 'Dana' }, { idFactory: ids });
    const eve = createLiveTournamentPlayer({ name: 'Eve' }, { idFactory: ids });
    const relaunched = generateNextSwissRound({
      ...canceled,
      players: [...canceled.players, dana, eve]
    }, { idFactory: ids });

    expect(pairKeySet(relaunched).has(pairKey('Alice', 'Bob'))).toBe(true);
    expect(relaunched.rounds[0].entries.find((item) => item.entry.kind === 'bye' && item.entry.playerName === 'Charlie')).toBeTruthy();
    expect(pairKeySet(relaunched).has(pairKey('Dana', 'Eve'))).toBe(true);
  });

  it('allows untouched 0-0 matches to validate as intentional draws', () => {
    const ids = idFactory();
    const tournament = generateNextSwissRound(createLiveTournament({
      players: ['Alice', 'Bob'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }))
    }, { idFactory: ids }), { idFactory: ids });
    const round = tournament.rounds[0];
    const match = round.entries[0].entry;
    expect(match.kind).toBe('match');

    expect(currentRoundComplete(tournament)).toBe(true);
    const validatedDraw = validateCurrentSwissRound(tournament);
    expect(validatedDraw.stage).toBe('standings');
    expect(validatedDraw.rounds[0].entries[0].resultEntered).toBe(true);

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
    const alice = createLiveTournamentPlayer({ name: 'Alice' }, { idFactory: ids });
    const bob = createLiveTournamentPlayer({ name: 'Bob' }, { idFactory: ids });
    const charlie = createLiveTournamentPlayer({ name: 'Charlie' }, { idFactory: ids });
    const running = generateNextSwissRound(createLiveTournament({
      players: [alice, bob, charlie],
      pairingSeed: 1,
      firstRoundPlayerOrder: [alice.id, bob.id, charlie.id]
    }, { idFactory: ids }), { idFactory: ids });
    const match = running.rounds[0].entries.find((item) => item.entry.kind === 'match')?.entry;
    expect(match?.kind).toBe('match');

    const standings = calculateLiveStandings(validateCurrentSwissRound(updateLiveRoundEntryResult(running, running.rounds[0].id, match!.id, { player1Score: 2, player2Score: 0 })));

    expect(standings[0]).toMatchObject({ playerName: 'Alice', gameWins: 2, gameLosses: 0, gameWinPercentage: 1, opponentsMatchWinPercentage: 1 / 3, opponentsGameWinPercentage: 1 / 3 });
    expect(standings.find((row) => row.playerName === 'Bob')).toMatchObject({ gameWins: 0, gameLosses: 2, gameWinPercentage: 0 });
  });

  it('rejects match scores above best-of-three values and impossible 2-2 results', () => {
    const ids = idFactory();
    const tournament = generateNextSwissRound(createLiveTournament({
      players: ['Alice', 'Bob'].map((name) => createLiveTournamentPlayer({ name }, { idFactory: ids }))
    }, { idFactory: ids }), { idFactory: ids });
    const round = tournament.rounds[0];
    const match = round.entries[0].entry;
    expect(match.kind).toBe('match');

    const overLimit = updateLiveRoundEntryResult(tournament, round.id, match.id, { player1Score: 7, player2Score: 1 });
    const impossibleDraw = updateLiveRoundEntryResult(tournament, round.id, match.id, { player1Score: 2, player2Score: 2 });

    expect(overLimit.rounds[0].entries[0].entry.kind).toBe('match');
    expect(liveMatchScoreIssue(overLimit.rounds[0].entries[0].entry)).toBe('Scores cannot be over 2 victories.');
    expect(currentRoundComplete(overLimit)).toBe(false);
    expect(liveMatchScoreIssue(impossibleDraw.rounds[0].entries[0].entry)).toBe('Only one player can reach 2 victories.');
    expect(currentRoundComplete(impossibleDraw)).toBe(false);
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
        paidTrackingEnabled: true,
        players: [createLiveTournamentPlayer({ id: 'player-1', name: 'Alice' })],
        rounds: [{ id: 'round-1', roundNumber: 1, validated: false, entries: [{ entry: null as unknown as never, resultEntered: false }] }]
      }]
    });

    expect(tournament.checkpoints[0].rounds[0].entries).toEqual([]);
  });

  it('calculates standings through a selected validated round', () => {
    const ids = idFactory();
    const alice = createLiveTournamentPlayer({ name: 'Alice' }, { idFactory: ids });
    const bob = createLiveTournamentPlayer({ name: 'Bob' }, { idFactory: ids });
    const round1 = generateNextSwissRound(createLiveTournament({
      roundCount: 2,
      players: [alice, bob],
      pairingSeed: 1,
      firstRoundPlayerOrder: [alice.id, bob.id]
    }, { idFactory: ids }), { idFactory: ids });
    const match1 = round1.rounds[0].entries[0].entry;
    expect(match1.kind).toBe('match');
    const standing1 = validateCurrentSwissRound(updateLiveRoundEntryResult(round1, round1.rounds[0].id, match1.id, { player1Score: 2, player2Score: 0 }));
    const round2 = generateNextSwissRound(standing1, { idFactory: ids });
    const match2 = round2.rounds[1].entries[0].entry;
    expect(match2.kind).toBe('match');
    // Alice is player1 in R1 win; in R2 score Alice side to keep her at 3 pts if she is player2.
    const aliceIsPlayer1 = match2.kind === 'match' && match2.player1Name === 'Alice';
    const standing2 = validateCurrentSwissRound(updateLiveRoundEntryResult(round2, round2.rounds[1].id, match2.id, aliceIsPlayer1 ? { player1Score: 0, player2Score: 2 } : { player1Score: 2, player2Score: 0 }));

    expect(calculateLiveStandingsThroughRound(standing2, 1)[0]).toMatchObject({ playerName: 'Alice', points: 3 });
    expect(calculateLiveStandingsThroughRound(standing2, 2)[0]).toMatchObject({ playerName: 'Alice', points: 3 });
  });

  it('finalizes validated live rounds to a standard tournament document', () => {
    const ids = idFactory();
    const alice = createLiveTournamentPlayer({ name: 'Alice', archetype: 'Fire' }, { idFactory: ids });
    const bob = createLiveTournamentPlayer({ name: 'Bob', archetype: 'Ice' }, { idFactory: ids });
    const running = generateNextSwissRound(createLiveTournament({
      name: 'Friday Night',
      leagueId: 'league-1',
      players: [alice, bob],
      pairingSeed: 1,
      firstRoundPlayerOrder: [alice.id, bob.id]
    }, { idFactory: ids }), { idFactory: ids });
    const round = running.rounds[0];
    const match = round.entries[0].entry;
    const scored = updateLiveRoundEntryResult(running, round.id, match.id, { player1Score: 2, player2Score: 0 });
    const validated = validateCurrentSwissRound(scored);

    const tournament = finalizeLiveTournament(validated, { idFactory: ids });

    expect(tournament).toMatchObject({ name: 'Friday Night', leagueId: 'league-1' });
    expect(tournament.rounds).toHaveLength(1);
    expect(tournament.playerArchetypes).toEqual([
      { playerName: 'Alice', archetype: 'Fire' },
      { playerName: 'Bob', archetype: 'Ice' }
    ]);
    expect(tournament.rounds[0].entries[0]).toMatchObject({ kind: 'match', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 0, player1DeckArchetype: 'Fire', player2DeckArchetype: 'Ice' });
  });

  it('breaks live ties by match wins where the finalized archive falls through to player name (pinned divergence)', () => {
    const ids = idFactory();
    const players = ['Amy', 'Zoe', 'Ben', 'Cal', 'Dev', 'Eli', 'Fay', 'Gus', 'Hal']
      .map((name) => createLiveTournamentPlayer({ name, paid: true }, { idFactory: ids }));
    const match = (player1Name: string, player2Name: string, player1Score: number, player2Score: number) =>
      ({ entry: createMatchRoundEntry({ player1Name, player2Name, player1Score, player2Score }, { idFactory: ids }), resultEntered: true });
    const rounds = [
      [match('Zoe', 'Ben', 2, 1), match('Amy', 'Dev', 1, 1), match('Gus', 'Eli', 2, 0)],
      [match('Cal', 'Zoe', 2, 1), match('Amy', 'Eli', 1, 1), match('Gus', 'Dev', 2, 0), match('Hal', 'Fay', 2, 0)],
      [match('Amy', 'Fay', 1, 1), match('Gus', 'Cal', 2, 0)],
      [match('Hal', 'Cal', 2, 0)]
    ].map((entries, index) => ({ id: ids(), roundNumber: index + 1, entries, validated: true }));
    const tournament = createLiveTournament({ players, rounds, roundCount: 4, stage: 'standings', currentRoundNumber: 4 }, { idFactory: ids });

    const live = calculateLiveStandings(tournament);
    const amyLive = live.find((row) => row.playerName === 'Amy')!;
    const zoeLive = live.find((row) => row.playerName === 'Zoe')!;
    // Guard: all four shared tiebreak keys tie exactly; only matchWins differs.
    expect(amyLive.points).toBe(3);
    expect(zoeLive.points).toBe(3);
    expect(amyLive.gameWinPercentage).toBe(0.5);
    expect(zoeLive.gameWinPercentage).toBe(0.5);
    expect(amyLive.opponentsMatchWinPercentage).toBe(zoeLive.opponentsMatchWinPercentage);
    expect(amyLive.opponentsGameWinPercentage).toBe(zoeLive.opponentsGameWinPercentage);
    expect(amyLive.matchWins).toBe(0);
    expect(zoeLive.matchWins).toBe(1);
    // Live-only tiebreak: more match wins ranks higher.
    expect(zoeLive.rank).toBeLessThan(amyLive.rank);

    const archive = calculateTournamentResult({ ...finalizeLiveTournament(tournament, { idFactory: ids }), seasonId: null });
    const amyArchive = archive.rows.find((row) => row.playerName === 'Amy')!;
    const zoeArchive = archive.rows.find((row) => row.playerName === 'Zoe')!;
    // Archive chain has no match-wins key: the same rounds fall through to player name.
    expect(amyArchive.rank).toBeLessThan(zoeArchive.rank);
  });
});
