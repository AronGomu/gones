import { isValidRoundEntry } from "./validation.js";

export function getTournamentWarnings(tournament) {
  const warnings = [];
  const pairings = new Map();

  for (const round of tournament.rounds ?? []) {
    const seenInRound = new Map();
    const byeEntries = [];

    for (const entry of round.entries ?? []) {
      if (!isValidRoundEntry(entry)) continue;
      if (entry.kind === "bye") {
        recordSeen(seenInRound, entry.playerName, entry.id);
        byeEntries.push(entry.id);
        continue;
      }

      recordSeen(seenInRound, entry.player1Name, entry.id);
      recordSeen(seenInRound, entry.player2Name, entry.id);
      const key = [entry.player1Name, entry.player2Name].sort().join("\u0000");
      if (pairings.has(key)) {
        warnings.push({
          code: "repeatedPairing",
          entryIds: [pairings.get(key), entry.id],
          roundId: round.id
        });
      } else {
        pairings.set(key, entry.id);
      }
    }

    for (const [playerName, entryIds] of seenInRound.entries()) {
      if (entryIds.length > 1) {
        warnings.push({ code: "duplicateSameRoundPlayerName", playerName, entryIds, roundId: round.id });
      }
    }
    if (byeEntries.length > 1) {
      warnings.push({ code: "multipleByesInRound", entryIds: byeEntries, roundId: round.id });
    }
  }

  return warnings;
}

function recordSeen(map, playerName, entryId) {
  const list = map.get(playerName) ?? [];
  list.push(entryId);
  map.set(playerName, list);
}

