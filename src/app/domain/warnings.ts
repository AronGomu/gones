import { RoundEntry } from './models';
import type { ArchiveTournamentDocument } from './archive-models';
import { archetypeForPlayer } from './tournament-archetypes';
import { validateRoundEntry } from './validation';

export interface TournamentWarning {
  code: 'missingBye' | 'duplicateSameRoundPlayerName' | 'repeatedPairing' | 'newPlayerAfterRoundOne' | 'missingDeckArchetype';
  roundId?: string;
  playerName?: string;
  /** All players missing a deck archetype (single combined warning). */
  playerNames?: string[];
  entryIds?: string[];
}

export function getTournamentWarnings(tournament: ArchiveTournamentDocument): TournamentWarning[] {
  const warnings: TournamentWarning[] = [];
  const pairings = new Map<string, string[]>();
  const knownPlayers = new Set<string>();
  const missingArchetypePlayers = new Set<string>();

  for (const [roundIndex, round] of (tournament.rounds ?? []).entries()) {
    const seenInRound = new Map<string, string[]>();
    let hasBye = false;
    for (const entry of round.entries ?? []) {
      if (!validateRoundEntry(entry).valid) continue;
      const players = entryPlayers(entry);
      if (entry.kind === 'bye') hasBye = true;
      for (const playerName of players) {
        recordSeen(seenInRound, playerName, entry.id);
        if (roundIndex > 0 && !knownPlayers.has(playerName)) warnings.push({ code: 'newPlayerAfterRoundOne', playerName, entryIds: [entry.id], roundId: round.id });
        if (!playerArchetype(tournament, playerName)) missingArchetypePlayers.add(playerName);
      }
      if (entry.kind === 'match') {
        const key = [entry.player1Name, entry.player2Name].sort().join('\u0000');
        pairings.set(key, [...(pairings.get(key) ?? []), entry.id]);
      }
    }
    const tournamentPlayers = collectTournamentPlayers(tournament);
    if (tournamentPlayers.size % 2 === 1 && !hasBye && seenInRound.size === tournamentPlayers.size - 1) warnings.push({ code: 'missingBye', roundId: round.id });
    for (const [playerName, entryIds] of seenInRound.entries()) {
      if (entryIds.length > 1) warnings.push({ code: 'duplicateSameRoundPlayerName', playerName, entryIds, roundId: round.id });
    }
    for (const playerName of seenInRound.keys()) knownPlayers.add(playerName);
  }

  for (const entryIds of pairings.values()) {
    if (entryIds.length > 1) warnings.push({ code: 'repeatedPairing', entryIds });
  }
  if (missingArchetypePlayers.size) {
    const playerNames = [...missingArchetypePlayers].sort((left, right) => left.localeCompare(right));
    warnings.push({ code: 'missingDeckArchetype', playerNames, playerName: playerNames[0] });
  }
  return warnings;
}

export function hasMissingByeWarning(tournament: ArchiveTournamentDocument): boolean {
  return getTournamentWarnings(tournament).some((warning) => warning.code === 'missingBye');
}

function collectTournamentPlayers(tournament: ArchiveTournamentDocument): Set<string> {
  const players = new Set<string>();
  for (const round of tournament.rounds ?? []) {
    for (const entry of round.entries ?? []) {
      for (const playerName of entryPlayers(entry)) players.add(playerName);
    }
  }
  return players;
}

function entryPlayers(entry: RoundEntry): string[] {
  if (!validateRoundEntry(entry).valid) return [];
  if (entry.kind === 'bye') return [entry.playerName];
  if (entry.kind === 'match') return [entry.player1Name, entry.player2Name];
  return [];
}

function recordSeen(map: Map<string, string[]>, playerName: string, entryId: string): void {
  map.set(playerName, [...(map.get(playerName) ?? []), entryId]);
}

function playerArchetype(tournament: ArchiveTournamentDocument, playerName: string): string {
  return archetypeForPlayer(tournament, playerName).trim();
}
