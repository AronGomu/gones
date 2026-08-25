import { trimPlayerName } from '../../domain/models';
import type { PersistedArchiveTournament } from '../../domain/archive-models';
import { playerNameKey } from '../../domain/rename-player';

export interface LocalPlayerSummary {
  name: string;
  occurrenceCount: number;
  leagueCount: number;
}

/**
 * Every player named by a round entry of the given archive Tournaments, folded case-insensitively on
 * `playerNameKey` and sorted by name. `occurrenceCount` counts round-entry appearances;
 * `leagueCount` counts distinct Tournaments — the archive rebuild made a Tournament the record that
 * holds rounds, and the field keeps its name because the server-side twin renders through the same
 * `settings.playerUsage` message.
 *
 * There is no local player table (ADR 0032): a player exists because a round entry names them, so
 * this projection is derived on every read and can never drift out of sync with the Tournaments.
 */
export function localPlayerNames(tournaments: readonly PersistedArchiveTournament[]): LocalPlayerSummary[] {
  const summaries = new Map<string, LocalPlayerSummary & { tournaments: Set<string> }>();

  for (const tournament of tournaments) {
    for (const round of tournament.rounds ?? []) {
      for (const entry of round.entries ?? []) {
        if (entry.kind === 'match') {
          count(summaries, entry.player1Name, tournament.id);
          count(summaries, entry.player2Name, tournament.id);
        } else if (entry.kind === 'bye') {
          count(summaries, entry.playerName, tournament.id);
        }
      }
    }
  }

  return [...summaries.values()]
    .map(({ name, occurrenceCount, tournaments: tournamentIds }) => ({ name, occurrenceCount, leagueCount: tournamentIds.size }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function count(summaries: Map<string, LocalPlayerSummary & { tournaments: Set<string> }>, rawName: string, tournamentId: string): void {
  const name = trimPlayerName(rawName);
  if (!name) return;
  const key = playerNameKey(name);
  // First spelling seen wins the display name; later Tournaments only add to the counts.
  const existing = summaries.get(key) ?? { name, occurrenceCount: 0, leagueCount: 0, tournaments: new Set<string>() };
  existing.occurrenceCount++;
  existing.tournaments.add(tournamentId);
  summaries.set(key, existing);
}
