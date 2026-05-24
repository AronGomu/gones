import { RoundEntry, TournamentDocument } from './models';
import { validateRoundEntry } from './validation';

export interface TournamentWarning {
  code: 'missingBye' | 'duplicateSameRoundPlayerName' | 'repeatedPairing';
  roundId?: string;
  playerName?: string;
  entryIds?: string[];
}

export function getTournamentWarnings(tournament: TournamentDocument): TournamentWarning[] {
  const warnings: TournamentWarning[] = [];
  const pairings = new Map<string, string[]>();
  const tournamentPlayers = collectTournamentPlayers(tournament);

  for (const round of tournament.rounds ?? []) {
    const seenInRound = new Map<string, string[]>();
    let hasBye = false;
    for (const entry of round.entries ?? []) {
      if (!validateRoundEntry(entry).valid) continue;
      if (entry.kind === 'bye') {
        hasBye = true;
        recordSeen(seenInRound, entry.playerName, entry.id);
        continue;
      }
      if (entry.kind !== 'match') continue;
      recordSeen(seenInRound, entry.player1Name, entry.id);
      recordSeen(seenInRound, entry.player2Name, entry.id);
      const key = [entry.player1Name, entry.player2Name].sort().join('\u0000');
      pairings.set(key, [...(pairings.get(key) ?? []), entry.id]);
    }
    if (tournamentPlayers.size % 2 === 1 && !hasBye) warnings.push({ code: 'missingBye', roundId: round.id });
    for (const [playerName, entryIds] of seenInRound.entries()) {
      if (entryIds.length > 1) warnings.push({ code: 'duplicateSameRoundPlayerName', playerName, entryIds, roundId: round.id });
    }
  }

  for (const entryIds of pairings.values()) {
    if (entryIds.length > 1) warnings.push({ code: 'repeatedPairing', entryIds });
  }
  return warnings;
}

export function hasMissingByeWarning(tournament: TournamentDocument): boolean {
  return getTournamentWarnings(tournament).some((warning) => warning.code === 'missingBye');
}

function collectTournamentPlayers(tournament: TournamentDocument): Set<string> {
  const players = new Set<string>();
  for (const round of tournament.rounds ?? []) {
    for (const entry of round.entries ?? []) addEntryPlayers(players, entry);
  }
  return players;
}

function addEntryPlayers(players: Set<string>, entry: RoundEntry): void {
  if (!validateRoundEntry(entry).valid) return;
  if (entry.kind === 'bye') players.add(entry.playerName);
  if (entry.kind === 'match') {
    players.add(entry.player1Name);
    players.add(entry.player2Name);
  }
}

function recordSeen(map: Map<string, string[]>, playerName: string, entryId: string): void {
  map.set(playerName, [...(map.get(playerName) ?? []), entryId]);
}
