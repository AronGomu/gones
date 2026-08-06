import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalFrontendBackend } from '../backend/local-frontend-backend.service';
import { LiveTournamentRepository } from './live-tournament-repository.service';

describe('LiveTournamentRepository (local Live backend)', () => {
  let repository: LiveTournamentRepository;

  beforeEach(() => {
    localStorage.clear();
    // Legacy browser authority: the same adapter serves the intent port and the whole-document store.
    const legacyBrowserStore = new LocalFrontendBackend();
    repository = new LiveTournamentRepository(legacyBrowserStore, legacyBrowserStore);
  });

  it('stores created live tournaments locally', async () => {
    const created = await repository.create();

    await expect(repository.get(created.id)).resolves.toMatchObject({ id: created.id, name: created.name });
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it('does not resurrect a deleted tournament from a stale save', async () => {
    const created = await repository.create();
    await repository.delete(created.id);

    await expect(repository.save(created)).rejects.toThrow('deletedLiveTournamentDocument');
    await expect(repository.get(created.id)).resolves.toBeNull();
  });

  it('runs registration intents against the local store with version checks', async () => {
    const created = await repository.create();
    const withPlayer = await repository.addLivePlayer(created.id, created.documentVersion, { name: 'Alice', initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' });
    expect(withPlayer.players.map((player) => player.name)).toEqual(['Alice']);
    expect(withPlayer.documentVersion).toBe(created.documentVersion + 1);

    await expect(
      repository.addLivePlayer(created.id, created.documentVersion, { name: 'Bob', initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' })
    ).rejects.toThrow('staleLiveTournamentDocument');
  });

  it('starts, scores, and validates a swiss round through intents', async () => {
    const created = await repository.create();
    let live = await repository.addLivePlayer(created.id, created.documentVersion, { name: 'Alice', initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' });
    live = await repository.addLivePlayer(live.id, live.documentVersion, { name: 'Bob', initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' });

    live = await repository.startLiveRound(live.id, live.documentVersion);
    expect(live.stage).toBe('round');
    expect(live.rounds).toHaveLength(1);
    const round = live.rounds[0];
    const match = round.entries.find((entry) => entry.entry.kind === 'match');
    expect(match).toBeDefined();

    live = await repository.scoreLiveRoundEntry(live.id, round.id, match!.entry.id, live.documentVersion, { player1Score: 2, player2Score: 0 });
    live = await repository.validateLiveRound(live.id, live.documentVersion);
    expect(live.stage).toBe('standings');
    expect(live.rounds[0].validated).toBe(true);
    expect(live.checkpoints.length).toBeGreaterThan(0);
  });

  it('finalizes a finished tournament into the local placeholder League and tombstones the live document', async () => {
    const created = await repository.create();
    let live = await repository.addLivePlayer(created.id, created.documentVersion, { name: 'Alice', initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' });
    live = await repository.addLivePlayer(live.id, live.documentVersion, { name: 'Bob', initialWins: 0, initialDraws: 0, initialLosses: 0, archetype: '' });
    live = await repository.startLiveRound(live.id, live.documentVersion);
    const round = live.rounds[0];
    const match = round.entries.find((entry) => entry.entry.kind === 'match')!;
    live = await repository.scoreLiveRoundEntry(live.id, round.id, match.entry.id, live.documentVersion, { player1Score: 2, player2Score: 1 });
    live = await repository.validateLiveRound(live.id, live.documentVersion);

    const result = await repository.finalizeLiveTournament(live.id, live.documentVersion);
    expect(result.leagueId).toBe('placeholder-league');
    expect(result.finalizedTournamentId).toBeTruthy();
    await expect(repository.get(live.id)).resolves.toBeNull();

    const backend = new LocalFrontendBackend();
    const league = await backend.getLeague('placeholder-league');
    expect(league?.tournaments.some((tournament) => tournament.id === result.finalizedTournamentId)).toBe(true);
  });
});
