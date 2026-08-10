import { PersistedLeague, trimPlayerName } from '../../domain/models';
import { playerNameKey } from '../../domain/rename-player';

export interface LocalPlayerSummary {
  name: string;
  occurrenceCount: number;
  leagueCount: number;
}

/**
 * Every player named by a round entry of the given leagues, folded case-insensitively on
 * `playerNameKey` and sorted by name. `occurrenceCount` counts round-entry appearances;
 * `leagueCount` counts distinct leagues.
 *
 * There is no local player table (ADR 0032): a player exists because a round entry names them, so
 * this projection is derived on every read and can never drift out of sync with the leagues.
 */
export function localPlayerNames(leagues: PersistedLeague[]): LocalPlayerSummary[] {
  const summaries = new Map<string, LocalPlayerSummary & { leagues: Set<string> }>();

  for (const league of leagues) {
    for (const tournament of league.tournaments ?? []) {
      for (const round of tournament.rounds ?? []) {
        for (const entry of round.entries ?? []) {
          if (entry.kind === 'match') {
            count(summaries, entry.player1Name, league.id);
            count(summaries, entry.player2Name, league.id);
          } else if (entry.kind === 'bye') {
            count(summaries, entry.playerName, league.id);
          }
        }
      }
    }
  }

  return [...summaries.values()]
    .map(({ name, occurrenceCount, leagues: leagueIds }) => ({ name, occurrenceCount, leagueCount: leagueIds.size }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function count(summaries: Map<string, LocalPlayerSummary & { leagues: Set<string> }>, rawName: string, leagueId: string): void {
  const name = trimPlayerName(rawName);
  if (!name) return;
  const key = playerNameKey(name);
  // First spelling seen wins the display name; later leagues only add to the counts.
  const existing = summaries.get(key) ?? { name, occurrenceCount: 0, leagueCount: 0, leagues: new Set<string>() };
  existing.occurrenceCount++;
  existing.leagues.add(leagueId);
  summaries.set(key, existing);
}
