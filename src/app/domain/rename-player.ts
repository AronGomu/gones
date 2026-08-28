import { RoundEntry, trimPlayerName } from './models';
import type { ArchiveTournamentDocument } from './archive-models';

export function playerNameKey(name: string): string {
  return trimPlayerName(name).toLocaleLowerCase();
}

export function samePlayerName(left: string, right: string): boolean {
  const a = playerNameKey(left);
  const b = playerNameKey(right);
  return Boolean(a) && a === b;
}

/** Rename (or merge into) a player across tournament round entries + archetype rows. Rounds are source of truth. */
export function renamePlayerInTournament(tournament: ArchiveTournamentDocument, fromName: string, toName: string): ArchiveTournamentDocument {
  const from = trimPlayerName(fromName);
  const to = trimPlayerName(toName);
  if (!from || !to) return tournament;
  return {
    ...tournament,
    rounds: tournament.rounds.map((round) => ({
      ...round,
      entries: round.entries.map((entry) => renamePlayerInRoundEntry(entry, from, to))
    })),
    playerArchetypes: renamePlayerArchetypes(tournament.playerArchetypes ?? [], from, to)
  };
}

export function renamePlayerInRoundEntry(entry: RoundEntry, fromName: string, toName: string): RoundEntry {
  const from = trimPlayerName(fromName);
  const to = trimPlayerName(toName);
  if (entry.kind === 'match') {
    return {
      ...entry,
      player1Name: samePlayerName(entry.player1Name, from) ? to : entry.player1Name,
      player2Name: samePlayerName(entry.player2Name, from) ? to : entry.player2Name
    };
  }
  if (entry.kind === 'bye') {
    return { ...entry, playerName: samePlayerName(entry.playerName, from) ? to : entry.playerName };
  }
  return {
    ...entry,
    player: samePlayerName(entry.player, from) ? to : entry.player,
    opponent: samePlayerName(entry.opponent, from) ? to : entry.opponent
  };
}

function renamePlayerArchetypes(
  rows: { playerName: string; archetype: string }[],
  from: string,
  to: string
): { playerName: string; archetype: string }[] {
  const displayByKey = new Map<string, string>();
  const archetypeByKey = new Map<string, string>();

  for (const row of rows) {
    const original = trimPlayerName(row.playerName);
    if (!original) continue;
    const name = samePlayerName(original, from) ? to : original;
    const key = playerNameKey(name);
    displayByKey.set(key, key === playerNameKey(to) ? to : name);
    const archetype = String(row.archetype ?? '').trim();
    const existing = archetypeByKey.get(key) ?? '';
    // Keep existing non-empty archetype on merge; otherwise take the incoming one.
    if (!existing && archetype) archetypeByKey.set(key, archetype);
    else if (!archetypeByKey.has(key)) archetypeByKey.set(key, archetype);
  }

  return [...displayByKey.entries()]
    .map(([key, playerName]) => ({ playerName, archetype: archetypeByKey.get(key) ?? '' }))
    .sort((left, right) => left.playerName.localeCompare(right.playerName));
}
