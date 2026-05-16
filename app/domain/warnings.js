import { validateRoundEntry } from "./validation.js";

export function getTournamentWarnings(tournament) {
  const warnings = [];
  const pairings = new Map();

  for (const round of tournament.rounds ?? []) {
    const seenInRound = new Map();
    for (const entry of round.entries ?? []) {
      if (!validateRoundEntry(entry).valid) continue;
      if (entry.kind === "bye") {
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
    for (const [playerName, entryIds] of seenInRound.entries()) {
      if (entryIds.length > 1) warnings.push({ code: "duplicateSameRoundPlayerName", playerName, entryIds, roundId: round.id });
    }
  }

  for (const entryIds of pairings.values()) {
    if (entryIds.length > 1) warnings.push({ code: "repeatedPairing", entryIds });
  }
  return warnings;
}

function recordSeen(map, playerName, entryId) {
  const list = map.get(playerName) ?? [];
  list.push(entryId);
  map.set(playerName, list);
}
