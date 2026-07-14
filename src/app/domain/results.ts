import { LeagueDocument, MatchRoundEntry, RoundEntry, TournamentDocument } from './models';
import { tournamentPlayerArchetypeRows } from './tournament-archetypes';
import { validateRoundEntry } from './validation';

export interface RankingRow {
  rank: number;
  playerName: string;
  /** Tournament-level deck archetype when known; empty for league aggregates / missing. */
  archetype?: string;
  points: number;
  matchWins: number;
  matchDraws: number;
  matchLosses: number;
  byes: number;
  playedMatchCount: number;
  matchAssignmentCount: number;
  gameWins: number;
  gameLosses: number;
  gameWinPercentage: number;
  opponentsMatchWinPercentage: number;
  opponentsGameWinPercentage: number;
}

interface MutableRankingRecord extends Omit<RankingRow, 'rank' | 'gameWinPercentage' | 'opponentsMatchWinPercentage' | 'opponentsGameWinPercentage'> {}

export function calculateTournamentResult(tournament: TournamentDocument) {
  const entries = collectTournamentEntries(tournament);
  const archetypes = new Map(tournamentPlayerArchetypeRows(tournament).map((row) => [row.playerName, row.archetype]));
  const rows = calculateRows(entries.map((ref) => ref.entry)).map((row) => ({
    ...row,
    archetype: archetypes.get(row.playerName) ?? ''
  }));
  const hasInvalid = entries.some(({ entry }) => !validateRoundEntry(entry).valid);
  const incomplete = !tournament.rounds?.length || hasInvalid;
  return { scope: 'tournament' as const, incomplete, provisional: incomplete && rows.length > 0, rows };
}

export function calculateLeagueResult(league: LeagueDocument) {
  const entries = (league.tournaments ?? []).flatMap((tournament) => collectTournamentEntries(tournament));
  const rows = calculateRows(entries.map((ref) => ref.entry));
  const incomplete = (league.tournaments ?? []).some((tournament) => calculateTournamentResult(tournament).incomplete);
  return { scope: 'league' as const, startDate: calculateLeagueStartDate(league), endDate: calculateLeagueEndDate(league), incomplete, provisional: incomplete && rows.length > 0, rows };
}

export function calculateLeagueStartDate(league: LeagueDocument): string {
  return getSortedTournamentDates(league)[0] ?? '';
}

export function calculateLeagueEndDate(league: LeagueDocument): string {
  return getSortedTournamentDates(league).at(-1) ?? '';
}

function getSortedTournamentDates(league: LeagueDocument): string[] {
  return (league.tournaments ?? []).map((tournament) => tournament.tournamentDate).filter(Boolean).sort((left, right) => left.localeCompare(right));
}

function collectTournamentEntries(tournament: TournamentDocument): Array<{ tournament: TournamentDocument; entry: RoundEntry; roundIndex: number }> {
  return (tournament.rounds ?? []).flatMap((round, roundIndex) => (round.entries ?? []).map((entry) => ({ tournament, roundIndex, entry })));
}

function calculateRows(entries: RoundEntry[]): RankingRow[] {
  const records = new Map<string, MutableRankingRecord>();
  const opponentNamesByPlayer = new Map<string, string[]>();

  for (const entry of entries) {
    if (!validateRoundEntry(entry).valid) continue;
    if (entry.kind === 'bye') {
      const record = ensureRecord(records, entry.playerName);
      record.matchWins += 1;
      record.byes += 1;
      record.points += 3;
      record.matchAssignmentCount += 1;
      continue;
    }
    if (entry.kind !== 'match') continue;
    const player = ensureRecord(records, entry.player1Name);
    const opponent = ensureRecord(records, entry.player2Name);
    player.playedMatchCount += 1;
    opponent.playedMatchCount += 1;
    player.matchAssignmentCount += 1;
    opponent.matchAssignmentCount += 1;
    player.gameWins += entry.player1Score;
    player.gameLosses += entry.player2Score;
    opponent.gameWins += entry.player2Score;
    opponent.gameLosses += entry.player1Score;
    addOpponent(opponentNamesByPlayer, entry.player1Name, entry.player2Name);
    addOpponent(opponentNamesByPlayer, entry.player2Name, entry.player1Name);
    applyMatchPoints(player, opponent, entry);
  }

  return [...records.values()].map((record) => {
    const gameWinPercentage = percentage(record.gameWins, record.gameWins + record.gameLosses) ?? 0;
    const opponents = opponentNamesByPlayer.get(record.playerName) ?? [];
    return {
      ...record,
      rank: 0,
      gameWinPercentage,
      opponentsMatchWinPercentage: averageOpponentPercentage(opponents, records, matchWinPercentage),
      opponentsGameWinPercentage: averageOpponentPercentage(opponents, records, gameWinPercentageForRecord)
    };
  }).sort(compareRankingRows).map((row, index) => ({ ...row, rank: index + 1 }));
}

function applyMatchPoints(player: MutableRankingRecord, opponent: MutableRankingRecord, entry: MatchRoundEntry): void {
  if (entry.player1Score > entry.player2Score) {
    player.matchWins += 1;
    opponent.matchLosses += 1;
    player.points += 3;
  } else if (entry.player2Score > entry.player1Score) {
    opponent.matchWins += 1;
    player.matchLosses += 1;
    opponent.points += 3;
  } else {
    player.matchDraws += 1;
    opponent.matchDraws += 1;
    player.points += 1;
    opponent.points += 1;
  }
}

function ensureRecord(records: Map<string, MutableRankingRecord>, playerName: string): MutableRankingRecord {
  const existing = records.get(playerName);
  if (existing) return existing;
  const record: MutableRankingRecord = { playerName, points: 0, matchWins: 0, matchDraws: 0, matchLosses: 0, byes: 0, playedMatchCount: 0, matchAssignmentCount: 0, gameWins: 0, gameLosses: 0 };
  records.set(playerName, record);
  return record;
}

function addOpponent(map: Map<string, string[]>, playerName: string, opponentName: string): void {
  map.set(playerName, [...(map.get(playerName) ?? []), opponentName]);
}

function matchWinPercentage(record: MutableRankingRecord | undefined): number | null {
  return record ? percentage(record.points, record.matchAssignmentCount * 3) : null;
}

function gameWinPercentageForRecord(record: MutableRankingRecord | undefined): number | null {
  return record ? percentage(record.gameWins, record.gameWins + record.gameLosses) : null;
}

function averageOpponentPercentage(opponents: string[], records: Map<string, MutableRankingRecord>, getPercentage: (record: MutableRankingRecord | undefined) => number | null): number {
  if (!opponents.length) return 0;
  const values = opponents.map((name) => Math.max(1 / 3, getPercentage(records.get(name)) ?? 0));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

function compareRankingRows(a: RankingRow, b: RankingRow): number {
  return b.points - a.points || b.opponentsMatchWinPercentage - a.opponentsMatchWinPercentage || b.gameWinPercentage - a.gameWinPercentage || b.opponentsGameWinPercentage - a.opponentsGameWinPercentage || a.playerName.localeCompare(b.playerName);
}
