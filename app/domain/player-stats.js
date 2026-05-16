import { entryScores, validateRoundEntry } from "./validation.js";

export function calculatePlayerStatistics(data, playerName, filters = {}) {
  const selectedName = String(playerName ?? "");
  const stats = { playerName: selectedName, playedMatchCount: 0, byeCount: 0, matchWins: 0, gameWins: 0, gameLosses: 0, matchWinrate: null, gameWinrate: null, nemesis: null, rival: null, matches: [] };
  const lossesByOpponent = new Map();
  const matchesByOpponent = new Map();

  for (const league of data.leagues ?? []) {
    if (filters.leagueId && league.id !== filters.leagueId) continue;
    for (const tournament of league.tournaments ?? []) {
      if (filters.tournamentId && tournament.id !== filters.tournamentId) continue;
      for (const [roundIndex, round] of (tournament.rounds ?? []).entries()) {
        for (const entry of round.entries ?? []) {
          if (!validateRoundEntry(entry).valid) continue;
          if (entry.kind === "bye" && entry.player === selectedName) {
            stats.byeCount += 1;
            stats.matches.push({ kind: "bye", league, tournament, roundIndex, entry });
            continue;
          }
          if (entry.kind !== "match") continue;
          const side = entry.player === selectedName ? "player" : entry.opponent === selectedName ? "opponent" : null;
          if (!side) continue;
          const opponentName = side === "player" ? entry.opponent : entry.player;
          if (filters.opponentName && !includesNormalized(opponentName, filters.opponentName)) continue;

          const scores = entryScores(entry);
          const ownScore = side === "player" ? scores.playerScore : scores.opponentScore;
          const opponentScore = side === "player" ? scores.opponentScore : scores.playerScore;
          stats.playedMatchCount += 1;
          stats.gameWins += ownScore;
          stats.gameLosses += opponentScore;
          if (ownScore > opponentScore) stats.matchWins += 1;
          if (ownScore < opponentScore) lossesByOpponent.set(opponentName, (lossesByOpponent.get(opponentName) ?? 0) + 1);
          matchesByOpponent.set(opponentName, (matchesByOpponent.get(opponentName) ?? 0) + 1);
          stats.matches.push({ kind: "match", league, tournament, roundIndex, entry, opponentName, ownScore, opponentScore });
        }
      }
    }
  }

  stats.matchWinrate = stats.playedMatchCount ? stats.matchWins / stats.playedMatchCount : null;
  stats.gameWinrate = stats.gameWins + stats.gameLosses ? stats.gameWins / (stats.gameWins + stats.gameLosses) : null;
  stats.nemesis = topName(lossesByOpponent, "name");
  stats.rival = topName(matchesByOpponent, "last");
  return stats;
}

function topName(map, tieBreak) {
  const entries = [...map.entries()];
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1] || (tieBreak === "name" ? a[0].localeCompare(b[0]) : 0)).at(0)[0];
}

function includesNormalized(value, search) {
  return String(value ?? "").toLocaleLowerCase().includes(String(search ?? "").trim().toLocaleLowerCase());
}
