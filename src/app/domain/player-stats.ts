import { MatchRoundEntry, trimPlayerName } from './models';
import type { ArchiveTournamentDocument } from './archive-models';
import { validateRoundEntry } from './validation';

export interface PlayerMatch {
  kind: 'match' | 'bye';
  tournament: ArchiveTournamentDocument;
  roundIndex: number;
  opponentName: string;
  ownScore: number;
  opponentScore: number;
}

export interface OpponentRecord {
  name: string;
  wins: number;
  losses: number;
}

export interface PlayerArchetypeUsage {
  name: string;
  matchCount: number;
}

export interface PlayerStatistics {
  playerName: string;
  playedMatchCount: number;
  byeCount: number;
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
  playedGameCount: number;
  gameWins: number;
  gameLosses: number;
  matchWinrate: number | null;
  gameWinrate: number | null;
  nemesis: OpponentRecord | null;
  rival: OpponentRecord | null;
  mostPlayedArchetype: PlayerArchetypeUsage | null;
  matches: PlayerMatch[];
}

export interface GlobalPlayerStatistics {
  playerName: string;
  playedMatchCount: number;
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
  matchWinrate: number | null;
  playedGameCount: number;
  gameWins: number;
  gameLosses: number;
  gameWinrate: number | null;
  nemesis: OpponentRecord | null;
  rival: OpponentRecord | null;
  mostPlayedArchetype: PlayerArchetypeUsage | null;
}

interface OpponentAccumulator extends OpponentRecord {
  matchCount: number;
}

interface StatisticsAccumulator {
  stats: PlayerStatistics;
  opponents: Map<string, OpponentAccumulator>;
  archetypes: Map<string, number>;
}

export function calculatePlayerStatistics(tournaments: readonly ArchiveTournamentDocument[], playerName: string, filters: { seasonId?: string; tournamentId?: string; opponentName?: string } = {}): PlayerStatistics {
  const accumulator = createStatisticsAccumulator(trimPlayerName(playerName));
  for (const tournament of tournaments ?? []) collectTournamentStatistics(accumulator, tournament, filters);
  return finalizeStatistics(accumulator);
}

export function calculateGlobalPlayerStatistics(tournaments: readonly ArchiveTournamentDocument[]): GlobalPlayerStatistics[] {
  const accumulators = new Map<string, StatisticsAccumulator>();
  for (const tournament of tournaments ?? []) {
    // ADR 0040: scope is the Tournament, not the League. A played Match is history, and an archive is
    // complete per Tournament, not per season. Mirrors LeagueRules.CalculateGlobalPlayerStatistics.
    if (tournament.status !== 'completed') continue;
    for (const [roundIndex, round] of (tournament.rounds ?? []).entries()) {
      for (const entry of round.entries ?? []) {
        if (entry.kind !== 'match' || !validateRoundEntry(entry).valid) continue;
        collectMatchStats(ensureAccumulator(entry.player1Name), entry, 'player1', { tournament, roundIndex });
        collectMatchStats(ensureAccumulator(entry.player2Name), entry, 'player2', { tournament, roundIndex });
      }
    }
  }

  return [...accumulators.values()]
    .map(finalizeStatistics)
    .filter((stats) => stats.playedMatchCount > 0)
    .map((stats): GlobalPlayerStatistics => ({
      playerName: stats.playerName,
      playedMatchCount: stats.playedMatchCount,
      matchWins: stats.matchWins,
      matchLosses: stats.matchLosses,
      matchDraws: stats.matchDraws,
      matchWinrate: stats.matchWinrate,
      playedGameCount: stats.playedGameCount,
      gameWins: stats.gameWins,
      gameLosses: stats.gameLosses,
      gameWinrate: stats.gameWinrate,
      nemesis: stats.nemesis,
      rival: stats.rival,
      mostPlayedArchetype: stats.mostPlayedArchetype,
    }))
    .sort((left, right) => compareOrdinal(left.playerName, right.playerName));

  function ensureAccumulator(playerName: string): StatisticsAccumulator {
    const name = trimPlayerName(playerName);
    let accumulator = accumulators.get(name);
    if (!accumulator) {
      accumulator = createStatisticsAccumulator(name);
      accumulators.set(name, accumulator);
    }
    return accumulator;
  }
}

function createStatisticsAccumulator(playerName: string): StatisticsAccumulator {
  return {
    stats: {
      playerName,
      playedMatchCount: 0,
      byeCount: 0,
      matchWins: 0,
      matchLosses: 0,
      matchDraws: 0,
      playedGameCount: 0,
      gameWins: 0,
      gameLosses: 0,
      matchWinrate: null,
      gameWinrate: null,
      nemesis: null,
      rival: null,
      mostPlayedArchetype: null,
      matches: [],
    },
    opponents: new Map(),
    archetypes: new Map(),
  };
}

function collectTournamentStatistics(accumulator: StatisticsAccumulator, tournament: ArchiveTournamentDocument, filters: { seasonId?: string; tournamentId?: string; opponentName?: string }): void {
  if (filters.seasonId && tournament.seasonId !== filters.seasonId) return;
  if (filters.tournamentId && tournament.id !== filters.tournamentId) return;
  for (const [roundIndex, round] of (tournament.rounds ?? []).entries()) {
    for (const entry of round.entries ?? []) {
      if (!validateRoundEntry(entry).valid) continue;
      if (entry.kind === 'bye' && trimPlayerName(entry.playerName) === accumulator.stats.playerName) {
        accumulator.stats.byeCount += 1;
        accumulator.stats.matches.push({ kind: 'bye', tournament, roundIndex, opponentName: 'Bye', ownScore: 2, opponentScore: 0 });
        continue;
      }
      if (entry.kind !== 'match') continue;
      const side = trimPlayerName(entry.player1Name) === accumulator.stats.playerName ? 'player1' : trimPlayerName(entry.player2Name) === accumulator.stats.playerName ? 'player2' : null;
      if (!side) continue;
      const opponentName = trimPlayerName(side === 'player1' ? entry.player2Name : entry.player1Name);
      if (filters.opponentName && !includesNormalized(opponentName, filters.opponentName)) continue;
      collectMatchStats(accumulator, entry, side, { tournament, roundIndex });
    }
  }
}

function collectMatchStats(accumulator: StatisticsAccumulator, entry: MatchRoundEntry, side: 'player1' | 'player2', context: { tournament: ArchiveTournamentDocument; roundIndex: number }): void {
  const stats = accumulator.stats;
  const opponentName = trimPlayerName(side === 'player1' ? entry.player2Name : entry.player1Name);
  const ownScore = side === 'player1' ? entry.player1Score : entry.player2Score;
  const opponentScore = side === 'player1' ? entry.player2Score : entry.player1Score;
  const opponent = accumulator.opponents.get(opponentName) ?? { name: opponentName, wins: 0, losses: 0, matchCount: 0 };
  stats.playedMatchCount += 1;
  stats.gameWins += ownScore;
  stats.gameLosses += opponentScore;
  if (ownScore > opponentScore) {
    stats.matchWins += 1;
    opponent.wins += 1;
  } else if (ownScore < opponentScore) {
    stats.matchLosses += 1;
    opponent.losses += 1;
  } else {
    stats.matchDraws += 1;
  }
  opponent.matchCount += 1;
  accumulator.opponents.set(opponentName, opponent);
  const archetype = selectedArchetype(entry, side, context.tournament, stats.playerName);
  if (archetype) accumulator.archetypes.set(archetype, (accumulator.archetypes.get(archetype) ?? 0) + 1);
  stats.matches.push({ kind: 'match', ...context, opponentName, ownScore, opponentScore });
}

function finalizeStatistics(accumulator: StatisticsAccumulator): PlayerStatistics {
  const stats = accumulator.stats;
  stats.playedGameCount = stats.gameWins + stats.gameLosses;
  stats.matchWinrate = stats.playedMatchCount ? stats.matchWins / stats.playedMatchCount : null;
  stats.gameWinrate = stats.playedGameCount ? stats.gameWins / stats.playedGameCount : null;
  stats.nemesis = topOpponent(accumulator.opponents, (record) => record.losses, true);
  stats.rival = topOpponent(accumulator.opponents, (record) => record.matchCount);
  stats.mostPlayedArchetype = topArchetype(accumulator.archetypes);
  return stats;
}

function topOpponent(map: Map<string, OpponentAccumulator>, value: (record: OpponentAccumulator) => number, requirePositive = false): OpponentRecord | null {
  const records = [...map.values()].filter((record) => !requirePositive || value(record) > 0);
  if (!records.length) return null;
  const top = records.sort((left, right) => value(right) - value(left) || compareOrdinal(left.name, right.name))[0];
  return { name: top.name, wins: top.wins, losses: top.losses };
}

function topArchetype(map: Map<string, number>): PlayerArchetypeUsage | null {
  const top = [...map.entries()].sort((left, right) => right[1] - left[1] || compareOrdinal(left[0], right[0]))[0];
  return top ? { name: top[0], matchCount: top[1] } : null;
}

function selectedArchetype(entry: MatchRoundEntry, side: 'player1' | 'player2', tournament: ArchiveTournamentDocument, playerName: string): string {
  const matchArchetype = (side === 'player1' ? entry.player1DeckArchetype : entry.player2DeckArchetype).trim();
  if (matchArchetype) return matchArchetype;
  return tournament.playerArchetypes.find((row) => trimPlayerName(row.playerName) === playerName)?.archetype.trim() ?? '';
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function includesNormalized(value: string, search: string): boolean {
  return value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
}

/** Fuzzy-ish player name suggestions (prefix / includes / subsequence), excluding reserved names. Empty query → full list. */
export function suggestPlayerNames(names: readonly string[], query: string, options: { exclude?: readonly string[]; limit?: number } = {}): string[] {
  const excluded = new Set((options.exclude ?? []).map((name) => trimPlayerName(name).toLocaleLowerCase()).filter(Boolean));
  const available = names.filter((name) => !excluded.has(trimPlayerName(name).toLocaleLowerCase()));
  const normalizedQuery = trimPlayerName(query).toLocaleLowerCase();
  // Empty input: show every known player (not just first page / A-names).
  if (!normalizedQuery) return options.limit == null ? available : available.slice(0, options.limit);

  const ranked = available
    .map((name) => ({ name, score: playerNameMatchScore(name, normalizedQuery) }))
    .filter((item) => item.score !== Number.POSITIVE_INFINITY)
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
    .map((item) => item.name);
  return options.limit == null ? ranked : ranked.slice(0, options.limit);
}

function playerNameMatchScore(name: string, normalizedQuery: string): number {
  const candidate = trimPlayerName(name).toLocaleLowerCase();
  if (!candidate) return Number.POSITIVE_INFINITY;
  if (candidate === normalizedQuery) return 0;
  if (candidate.startsWith(normalizedQuery)) return 10 + candidate.length - normalizedQuery.length;
  const includesIndex = candidate.indexOf(normalizedQuery);
  if (includesIndex !== -1) return 30 + includesIndex;

  let queryIndex = 0;
  let firstMatch = -1;
  let gaps = 0;
  for (let candidateIndex = 0; candidateIndex < candidate.length && queryIndex < normalizedQuery.length; candidateIndex++) {
    if (candidate[candidateIndex] !== normalizedQuery[queryIndex]) continue;
    if (firstMatch === -1) firstMatch = candidateIndex;
    gaps += candidateIndex - queryIndex;
    queryIndex++;
  }
  return queryIndex === normalizedQuery.length ? 60 + firstMatch + gaps : Number.POSITIVE_INFINITY;
}
