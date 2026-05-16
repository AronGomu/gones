import { entryScores, validateRoundEntry } from "./validation.js";

export function calculateTournamentResult(tournament) {
  const entries = collectTournamentEntries(tournament);
  const rows = calculateRows(entries);
  const hasInvalid = entries.some(({ entry }) => !validateRoundEntry(entry).valid);
  const incomplete = !tournament.rounds?.length || hasInvalid;
  return {
    scope: "tournament",
    incomplete,
    provisional: incomplete && rows.length > 0,
    rows
  };
}

export function calculateLeagueResult(league) {
  const entries = (league.tournaments ?? []).flatMap((tournament) => collectTournamentEntries(tournament));
  const rows = calculateRows(entries);
  const incomplete = (league.tournaments ?? []).some((tournament) => calculateTournamentResult(tournament).incomplete);
  return {
    scope: "league",
    incomplete,
    provisional: incomplete && rows.length > 0,
    rows
  };
}

function collectTournamentEntries(tournament) {
  return (tournament.rounds ?? []).flatMap((round, roundIndex) =>
    (round.entries ?? []).map((entry, entryIndex) => ({ tournament, round, roundIndex, entry, entryIndex }))
  );
}

function calculateRows(entryRefs) {
  const records = new Map();
  const opponentNamesByPlayer = new Map();

  for (const ref of entryRefs) {
    const { entry } = ref;
    if (!validateRoundEntry(entry).valid) continue;

    if (entry.kind === "bye") {
      const record = ensureRecord(records, entry.player);
      record.matchWins += 1;
      record.byes += 1;
      record.points += 3;
      record.matchAssignmentCount += 1;
      continue;
    }

    const { playerScore, opponentScore } = entryScores(entry);
    const player = ensureRecord(records, entry.player);
    const opponent = ensureRecord(records, entry.opponent);

    player.playedMatchCount += 1;
    opponent.playedMatchCount += 1;
    player.matchAssignmentCount += 1;
    opponent.matchAssignmentCount += 1;
    player.gameWins += playerScore;
    player.gameLosses += opponentScore;
    opponent.gameWins += opponentScore;
    opponent.gameLosses += playerScore;
    addOpponent(opponentNamesByPlayer, entry.player, entry.opponent);
    addOpponent(opponentNamesByPlayer, entry.opponent, entry.player);

    if (playerScore > opponentScore) {
      player.matchWins += 1;
      opponent.matchLosses += 1;
      player.points += 3;
    } else if (opponentScore > playerScore) {
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

  const rows = [...records.values()].map((record) => {
    const gameWinPercentage = percentage(record.gameWins, record.gameWins + record.gameLosses);
    const opponents = opponentNamesByPlayer.get(record.playerName) ?? [];
    const omw = averageOpponentPercentage(opponents, records, matchWinPercentage);
    const ogw = averageOpponentPercentage(opponents, records, gameWinPercentageForRecord);
    return {
      ...record,
      gameWinPercentage: gameWinPercentage ?? 0,
      opponentsMatchWinPercentage: omw,
      opponentsGameWinPercentage: ogw
    };
  });

  return rows.sort(compareRankingRows).map((row, index) => ({ ...row, rank: index + 1 }));
}

function ensureRecord(records, playerName) {
  if (!records.has(playerName)) {
    records.set(playerName, {
      playerName,
      points: 0,
      matchWins: 0,
      matchDraws: 0,
      matchLosses: 0,
      byes: 0,
      playedMatchCount: 0,
      matchAssignmentCount: 0,
      gameWins: 0,
      gameLosses: 0
    });
  }
  return records.get(playerName);
}

function addOpponent(map, playerName, opponentName) {
  const opponents = map.get(playerName) ?? [];
  opponents.push(opponentName);
  map.set(playerName, opponents);
}

function matchWinPercentage(record) {
  return percentage(record.points, record.matchAssignmentCount * 3);
}

function gameWinPercentageForRecord(record) {
  return percentage(record.gameWins, record.gameWins + record.gameLosses);
}

function averageOpponentPercentage(opponents, records, getPercentage) {
  if (!opponents.length) return 0;
  const values = opponents.map((name) => Math.max(1 / 3, getPercentage(records.get(name)) ?? 0));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentage(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

function compareRankingRows(a, b) {
  return (
    b.points - a.points ||
    b.opponentsMatchWinPercentage - a.opponentsMatchWinPercentage ||
    b.gameWinPercentage - a.gameWinPercentage ||
    b.opponentsGameWinPercentage - a.opponentsGameWinPercentage ||
    a.playerName.localeCompare(b.playerName)
  );
}

