import { toScore, validateRoundEntry } from "./validation.js";

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
      const record = ensureRecord(records, entry.playerName);
      record.matchWins += 1;
      record.byes += 1;
      record.points += 3;
      record.matchAssignmentCount += 1;
      continue;
    }

    const player1Score = toScore(entry.player1Score);
    const player2Score = toScore(entry.player2Score);
    const player1 = ensureRecord(records, entry.player1Name);
    const player2 = ensureRecord(records, entry.player2Name);

    player1.playedMatchCount += 1;
    player2.playedMatchCount += 1;
    player1.matchAssignmentCount += 1;
    player2.matchAssignmentCount += 1;
    player1.gameWins += player1Score;
    player1.gameLosses += player2Score;
    player2.gameWins += player2Score;
    player2.gameLosses += player1Score;
    addOpponent(opponentNamesByPlayer, entry.player1Name, entry.player2Name);
    addOpponent(opponentNamesByPlayer, entry.player2Name, entry.player1Name);

    if (player1Score > player2Score) {
      player1.matchWins += 1;
      player2.matchLosses += 1;
      player1.points += 3;
    } else if (player2Score > player1Score) {
      player2.matchWins += 1;
      player1.matchLosses += 1;
      player2.points += 3;
    } else {
      player1.matchDraws += 1;
      player2.matchDraws += 1;
      player1.points += 1;
      player2.points += 1;
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

