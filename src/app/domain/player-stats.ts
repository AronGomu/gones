import { GonesData, LeagueDocument, MatchRoundEntry, TournamentDocument, trimPlayerName } from './models';
import { validateRoundEntry } from './validation';

export interface PlayerMatch {
  kind: 'match' | 'bye';
  league: LeagueDocument;
  tournament: TournamentDocument;
  roundIndex: number;
  opponentName: string;
  ownScore: number;
  opponentScore: number;
}

export interface PlayerStatistics {
  playerName: string;
  playedMatchCount: number;
  byeCount: number;
  matchWins: number;
  gameWins: number;
  gameLosses: number;
  matchWinrate: number | null;
  gameWinrate: number | null;
  nemesis: string | null;
  rival: string | null;
  matches: PlayerMatch[];
}

export function calculatePlayerStatistics(data: GonesData, playerName: string, filters: { leagueId?: string; tournamentId?: string; opponentName?: string } = {}): PlayerStatistics {
  const selectedName = String(playerName ?? '');
  const stats: PlayerStatistics = { playerName: selectedName, playedMatchCount: 0, byeCount: 0, matchWins: 0, gameWins: 0, gameLosses: 0, matchWinrate: null, gameWinrate: null, nemesis: null, rival: null, matches: [] };
  const lossesByOpponent = new Map<string, number>();
  const matchesByOpponent = new Map<string, number>();

  for (const league of data.leagues ?? []) {
    if (filters.leagueId && league.id !== filters.leagueId) continue;
    for (const tournament of league.tournaments ?? []) {
      if (filters.tournamentId && tournament.id !== filters.tournamentId) continue;
      for (const [roundIndex, round] of (tournament.rounds ?? []).entries()) {
        for (const entry of round.entries ?? []) {
          if (!validateRoundEntry(entry).valid) continue;
          if (entry.kind === 'bye' && entry.playerName === selectedName) {
            stats.byeCount += 1;
            stats.matches.push({ kind: 'bye', league, tournament, roundIndex, opponentName: 'Bye', ownScore: 2, opponentScore: 0 });
            continue;
          }
          if (entry.kind !== 'match') continue;
          collectMatchStats(stats, entry, selectedName, { league, tournament, roundIndex }, filters, lossesByOpponent, matchesByOpponent);
        }
      }
    }
  }

  stats.matchWinrate = stats.playedMatchCount ? stats.matchWins / stats.playedMatchCount : null;
  stats.gameWinrate = stats.gameWins + stats.gameLosses ? stats.gameWins / (stats.gameWins + stats.gameLosses) : null;
  stats.nemesis = topName(lossesByOpponent, 'name');
  stats.rival = topName(matchesByOpponent, 'last');
  return stats;
}

function collectMatchStats(stats: PlayerStatistics, entry: MatchRoundEntry, selectedName: string, context: { league: LeagueDocument; tournament: TournamentDocument; roundIndex: number }, filters: { opponentName?: string }, lossesByOpponent: Map<string, number>, matchesByOpponent: Map<string, number>): void {
  const side = entry.player1Name === selectedName ? 'player1' : entry.player2Name === selectedName ? 'player2' : null;
  if (!side) return;
  const opponentName = side === 'player1' ? entry.player2Name : entry.player1Name;
  if (filters.opponentName && !includesNormalized(opponentName, filters.opponentName)) return;
  const ownScore = side === 'player1' ? entry.player1Score : entry.player2Score;
  const opponentScore = side === 'player1' ? entry.player2Score : entry.player1Score;
  stats.playedMatchCount += 1;
  stats.gameWins += ownScore;
  stats.gameLosses += opponentScore;
  if (ownScore > opponentScore) stats.matchWins += 1;
  if (ownScore < opponentScore) lossesByOpponent.set(opponentName, (lossesByOpponent.get(opponentName) ?? 0) + 1);
  matchesByOpponent.set(opponentName, (matchesByOpponent.get(opponentName) ?? 0) + 1);
  stats.matches.push({ kind: 'match', ...context, opponentName, ownScore, opponentScore });
}

function topName(map: Map<string, number>, tieBreak: 'name' | 'last'): string | null {
  const entries = [...map.entries()];
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1] || (tieBreak === 'name' ? a[0].localeCompare(b[0]) : 0)).at(0)?.[0] ?? null;
}

function includesNormalized(value: string, search: string): boolean {
  return value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
}

/** Unique player names seen across league tournament rounds + archetype rosters. */
export function collectKnownPlayerNames(leagues: readonly LeagueDocument[]): string[] {
  const names = new Set<string>();
  for (const league of leagues ?? []) {
    for (const tournament of league.tournaments ?? []) {
      for (const row of tournament.playerArchetypes ?? []) {
        const name = trimPlayerName(row.playerName);
        if (name) names.add(name);
      }
      for (const round of tournament.rounds ?? []) {
        for (const entry of round.entries ?? []) {
          if (entry.kind === 'match') {
            const player1 = trimPlayerName(entry.player1Name);
            const player2 = trimPlayerName(entry.player2Name);
            if (player1) names.add(player1);
            if (player2) names.add(player2);
          } else if (entry.kind === 'bye') {
            const player = trimPlayerName(entry.playerName);
            if (player) names.add(player);
          }
        }
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
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
