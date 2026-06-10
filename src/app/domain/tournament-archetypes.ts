import { trimPlayerName } from './models';
import type { PlayerArchetypeDocument, RoundEntry, TournamentDocument } from './models';
import { validateRoundEntry } from './validation';

export interface ArchetypeConflict {
  playerName: string;
  existingArchetype: string;
  importedArchetype: string;
}

export interface TournamentPlayerArchetypeRow {
  playerName: string;
  archetype: string;
}

export function normalizePlayerArchetypes(archetypes: unknown): PlayerArchetypeDocument[] {
  if (!Array.isArray(archetypes)) return [];
  const rows: PlayerArchetypeDocument[] = [];
  const seen = new Set<string>();
  for (const item of archetypes) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const playerName = trimPlayerName(value['playerName']);
    if (!playerName || seen.has(playerName)) continue;
    seen.add(playerName);
    rows.push({ playerName, archetype: normalizeArchetype(value['archetype']) });
  }
  return rows.sort(compareByPlayerName);
}

export function derivePlayerArchetypesFromRounds(tournament: Pick<TournamentDocument, 'rounds'>): PlayerArchetypeDocument[] {
  const map = new Map<string, string>();
  for (const round of tournament.rounds ?? []) {
    for (const entry of round.entries ?? []) {
      for (const candidate of entryArchetypeCandidates(entry)) {
        if (!candidate.playerName || map.has(candidate.playerName)) continue;
        map.set(candidate.playerName, candidate.archetype);
      }
    }
  }
  return [...map.entries()].map(([playerName, archetype]) => ({ playerName, archetype })).sort(compareByPlayerName);
}

export function tournamentPlayerArchetypeRows(tournament: TournamentDocument): TournamentPlayerArchetypeRow[] {
  const archetypes = new Map<string, string>();
  for (const item of tournament.playerArchetypes ?? []) {
    const playerName = trimPlayerName(item.playerName);
    if (playerName) archetypes.set(playerName, normalizeArchetype(item.archetype));
  }
  for (const round of tournament.rounds ?? []) {
    for (const entry of round.entries ?? []) {
      for (const candidate of entryArchetypeCandidates(entry)) {
        if (candidate.playerName && !archetypes.has(candidate.playerName)) archetypes.set(candidate.playerName, candidate.archetype);
      }
    }
  }
  return [...archetypes.entries()].map(([playerName, archetype]) => ({ playerName, archetype })).sort(compareByPlayerName);
}

export function setTournamentPlayerArchetype(tournament: TournamentDocument, playerName: string, archetype: string): TournamentDocument {
  const normalizedPlayerName = trimPlayerName(playerName);
  if (!normalizedPlayerName) return tournament;
  const next = new Map<string, string>();
  for (const row of tournament.playerArchetypes ?? []) {
    const rowPlayerName = trimPlayerName(row.playerName);
    if (rowPlayerName) next.set(rowPlayerName, normalizeArchetype(row.archetype));
  }
  next.set(normalizedPlayerName, normalizeArchetype(archetype));
  return { ...tournament, playerArchetypes: [...next.entries()].map(([itemPlayerName, itemArchetype]) => ({ playerName: itemPlayerName, archetype: itemArchetype })).sort(compareByPlayerName) };
}

export function mergeImportedRoundArchetypes(tournament: TournamentDocument, entries: RoundEntry[]): { entries: RoundEntry[]; playerArchetypes: PlayerArchetypeDocument[]; conflicts: ArchetypeConflict[] } {
  const map = new Map<string, string>();
  for (const row of tournament.playerArchetypes ?? []) {
    const playerName = trimPlayerName(row.playerName);
    if (playerName) map.set(playerName, normalizeArchetype(row.archetype));
  }

  const conflicts: ArchetypeConflict[] = [];
  const normalizedEntries = entries.map((entry) => normalizeEntryArchetypes(entry, map, conflicts));
  return {
    entries: normalizedEntries,
    playerArchetypes: [...map.entries()].map(([playerName, archetype]) => ({ playerName, archetype })).sort(compareByPlayerName),
    conflicts: dedupeConflicts(conflicts)
  };
}

export function validateTournamentPlayerArchetypes(tournament: TournamentDocument): ArchetypeConflict[] {
  const seen = new Map<string, string>();
  const conflicts: ArchetypeConflict[] = [];
  for (const row of tournament.playerArchetypes ?? []) {
    const playerName = trimPlayerName(row.playerName);
    const archetype = normalizeArchetype(row.archetype);
    if (!playerName) continue;
    const existing = seen.get(playerName);
    if (existing !== undefined && existing !== archetype) conflicts.push({ playerName, existingArchetype: existing, importedArchetype: archetype });
    else seen.set(playerName, archetype);
  }
  return dedupeConflicts(conflicts);
}

export function archetypeForPlayer(tournament: TournamentDocument, playerName: string): string {
  const normalizedPlayerName = trimPlayerName(playerName);
  const stored = tournament.playerArchetypes?.find((row) => trimPlayerName(row.playerName) === normalizedPlayerName)?.archetype;
  if (stored !== undefined) return stored;
  return tournamentPlayerArchetypeRows(tournament).find((row) => row.playerName === normalizedPlayerName)?.archetype ?? '';
}

function normalizeEntryArchetypes(entry: RoundEntry, archetypes: Map<string, string>, conflicts: ArchetypeConflict[]): RoundEntry {
  if (entry.kind === 'match') {
    const player1 = resolveImportedArchetype(archetypes, conflicts, entry.player1Name, entry.player1DeckArchetype);
    const player2 = resolveImportedArchetype(archetypes, conflicts, entry.player2Name, entry.player2DeckArchetype);
    return { ...entry, player1DeckArchetype: player1, player2DeckArchetype: player2 };
  }
  if (entry.kind === 'bye') {
    return { ...entry, deckArchetype: resolveImportedArchetype(archetypes, conflicts, entry.playerName, entry.deckArchetype) };
  }
  return entry;
}

function resolveImportedArchetype(archetypes: Map<string, string>, conflicts: ArchetypeConflict[], playerName: string, archetype: string): string {
  const normalizedPlayerName = trimPlayerName(playerName);
  const normalizedArchetype = normalizeArchetype(archetype);
  if (!normalizedPlayerName) return normalizedArchetype;
  const existing = archetypes.get(normalizedPlayerName);
  if (existing === undefined) {
    archetypes.set(normalizedPlayerName, normalizedArchetype);
    return normalizedArchetype;
  }
  if (existing !== normalizedArchetype) conflicts.push({ playerName: normalizedPlayerName, existingArchetype: existing, importedArchetype: normalizedArchetype });
  return existing;
}

function entryArchetypeCandidates(entry: RoundEntry): PlayerArchetypeDocument[] {
  if (!validateRoundEntry(entry).valid) return [];
  if (entry.kind === 'match') {
    return [
      { playerName: trimPlayerName(entry.player1Name), archetype: normalizeArchetype(entry.player1DeckArchetype) },
      { playerName: trimPlayerName(entry.player2Name), archetype: normalizeArchetype(entry.player2DeckArchetype) }
    ];
  }
  if (entry.kind === 'bye') return [{ playerName: trimPlayerName(entry.playerName), archetype: normalizeArchetype(entry.deckArchetype) }];
  return [];
}

function normalizeArchetype(value: unknown): string {
  return String(value ?? '').trim();
}

function dedupeConflicts(conflicts: ArchetypeConflict[]): ArchetypeConflict[] {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = `${conflict.playerName}\u0000${conflict.existingArchetype}\u0000${conflict.importedArchetype}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareByPlayerName(left: { playerName: string }, right: { playerName: string }): number {
  return left.playerName.localeCompare(right.playerName);
}
