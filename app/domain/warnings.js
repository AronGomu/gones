import { validateRoundEntry } from "./validation.js";

export function getTournamentWarnings(tournament) {
  const warnings = [];
  const pairings = new Map();
  const tournamentPlayers = collectTournamentPlayers(tournament);

  for (const round of tournament.rounds ?? []) {
    const seenInRound = new Map();
    let hasBye = false;
    for (const entry of round.entries ?? []) {
      if (!validateRoundEntry(entry).valid) continue;
      if (entry.kind === "bye") {
        hasBye = true;
        recordSeen(seenInRound, entry.player, entry.id);
        continue;
      }
      recordSeen(seenInRound, entry.player, entry.id);
      recordSeen(seenInRound, entry.opponent, entry.id);
      const key = [entry.player, entry.opponent].sort().join("\u0000");
      const existing = pairings.get(key) ?? [];
      existing.push(entry.id);
      pairings.set(key, existing);
    }
    if (tournamentPlayers.size % 2 === 1 && !hasBye) {
      warnings.push({ code: "missingBye", roundId: round.id });
    }
    for (const [playerName, entryIds] of seenInRound.entries()) {
      if (entryIds.length > 1) warnings.push({ code: "duplicateSameRoundPlayerName", playerName, entryIds, roundId: round.id });
    }
  }

  for (const entryIds of pairings.values()) {
    if (entryIds.length > 1) warnings.push({ code: "repeatedPairing", entryIds });
  }
  return warnings;
}

export function hasMissingByeWarning(tournament) {
  return getTournamentWarnings(tournament).some((warning) => warning.code === "missingBye");
}

function collectTournamentPlayers(tournament) {
  const players = new Set();
  for (const round of tournament.rounds ?? []) {
    for (const entry of round.entries ?? []) {
      if (!validateRoundEntry(entry).valid) continue;
      if (entry.kind === "bye") players.add(entry.player);
      if (entry.kind === "match") {
        players.add(entry.player);
        players.add(entry.opponent);
      }
    }
  }
  return players;
}

function recordSeen(map, playerName, entryId) {
  const list = map.get(playerName) ?? [];
  list.push(entryId);
  map.set(playerName, list);
}
