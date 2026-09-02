import { describe, expect, it } from 'vitest';
import {
  calculateLiveStandings,
  createLiveTournament,
  createLiveTournamentPlayer,
  LiveStandingRow as DomainLiveStandingRow,
  LiveTournamentDocument as DomainLiveTournamentDocument
} from '../domain/live-tournament';
import {
  LiveStandingRow as GeneratedLiveStandingRow,
  LiveTournamentDocument as GeneratedLiveTournamentDocument,
  PublicLiveTournamentDetailResponse
} from './generated/gones-api';

function demoTournament(): DomainLiveTournamentDocument {
  let next = 1;
  const idFactory = () => `dto-${next++}`;
  return createLiveTournament({
    id: 'dto-live',
    name: 'DTO Parity',
    leagueId: 'league-1',
    tournamentDate: '2026-08-05',
    roundCount: 1,
    pairingSeed: 7,
    stage: 'standings',
    currentRoundNumber: 1,
    players: [
      createLiveTournamentPlayer({ name: 'Alice', paid: true }, { idFactory }),
      createLiveTournamentPlayer({ name: 'Bob' }, { idFactory })
    ],
    rounds: [{
      id: 'dto-round-1',
      roundNumber: 1,
      validated: true,
      entries: [{ entry: { kind: 'match', id: 'dto-match-1', table: '1', player1Name: 'Alice', player2Name: 'Bob', player1Score: 2, player2Score: 1, player1DeckArchetype: '', player2DeckArchetype: '' }, resultEntered: true }]
    }],
    checkpoints: [{
      id: 'dto-checkpoint-1',
      label: 'Pairing 1',
      createdAt: '2026-08-05T10:00:00.000Z',
      stage: 'round',
      currentRoundNumber: 1,
      roundCount: 1,
      paidTrackingEnabled: true,
      players: [],
      rounds: []
    }],
    createdAt: '2026-08-05T09:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z'
  }, { idFactory });
}

describe('Live DTO parity with generated API client', () => {
  it('domain Live document satisfies the generated full-document DTO shape', () => {
    const domainDocument = demoTournament();
    const generated: GeneratedLiveTournamentDocument = {
      ...domainDocument,
      finalizedTournamentId: domainDocument.finalizedTournamentId
    };
    expect(generated.id).toBe('dto-live');
    expect(generated.pairingSeed).toBe(7);
    expect(generated.checkpoints).toHaveLength(1);
    expect(generated.documentVersion).toBe(1);
  });

  it('domain standings rows satisfy the generated standings DTO shape', () => {
    const rows: DomainLiveStandingRow[] = calculateLiveStandings(demoTournament());
    const generatedRows: GeneratedLiveStandingRow[] = rows;
    expect(generatedRows[0]).toMatchObject({ rank: 1, playerName: 'Alice', points: 3, gameWins: 2, gameLosses: 1 });
    expect(Object.keys(generatedRows[0]).sort()).toEqual([
      'byes', 'dropped', 'gameLosses', 'gameWinPercentage', 'gameWins',
      'matchAssignmentCount', 'matchDraws', 'matchLosses', 'matchWins',
      'opponentsGameWinPercentage', 'opponentsMatchWinPercentage', 'paid',
      'playedMatchCount', 'playerId', 'playerName', 'points', 'rank'
    ]);
  });

  it('public detail DTO exposes reads but never the restricted mutation details', () => {
    const domainDocument = demoTournament();
    const detail: PublicLiveTournamentDetailResponse = {
      id: domainDocument.id,
      name: domainDocument.name,
      leagueId: domainDocument.leagueId,
      tournamentDate: domainDocument.tournamentDate,
      type: domainDocument.type,
      roundCount: domainDocument.roundCount,
      customRoundCount: domainDocument.customRoundCount,
      paidTrackingEnabled: domainDocument.paidTrackingEnabled,
      stage: domainDocument.stage,
      currentRoundNumber: domainDocument.currentRoundNumber,
      players: domainDocument.players,
      rounds: domainDocument.rounds,
      finalizedTournamentId: domainDocument.finalizedTournamentId,
      createdAt: domainDocument.createdAt,
      updatedAt: domainDocument.updatedAt,
      documentVersion: 1,
      serverUpdatedAt: '2026-08-05T10:00:00Z'
    };
    // Locked security review: the pairing seed, locked first-round order, and checkpoints
    // are Organizer/Admin mutation details and must stay out of the public detail contract.
    const declaredPublicKeys = Object.keys(detail);
    expect(declaredPublicKeys).not.toContain('pairingSeed');
    expect(declaredPublicKeys).not.toContain('firstRoundPlayerOrder');
    expect(declaredPublicKeys).not.toContain('checkpoints');
    expect(detail.players).toHaveLength(2);
  });
});
