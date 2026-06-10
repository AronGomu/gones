export const GONES_DATA_VERSION = 2;
export const SUPPORTED_IMPORT_DATA_VERSIONS = [1, 2] as const;
export type LeagueStatus = 'active' | 'completed';
export interface GonesData {
  version: typeof GONES_DATA_VERSION;
  leagues: LeagueDocument[];
}

export interface LeagueDocument {
  id: string;
  name: string;
  status: LeagueStatus;
  tournaments: TournamentDocument[];
}

export interface PersistedLeague extends LeagueDocument {
  documentVersion: number;
  updatedAt?: string;
}

export interface TournamentDocument {
  id: string;
  leagueId: string;
  name: string;
  tournamentDate: string;
  rounds: RoundDocument[];
  playerArchetypes: PlayerArchetypeDocument[];
}

export interface PlayerArchetypeDocument {
  playerName: string;
  archetype: string;
}

export interface RoundDocument {
  id: string;
  entries: RoundEntry[];
}

export type RoundEntry = MatchRoundEntry | ByeRoundEntry | InvalidRoundEntry;

export interface MatchRoundEntry {
  kind: 'match';
  id: string;
  table: string;
  player1Name: string;
  player2Name: string;
  player1Score: number;
  player2Score: number;
  player1DeckArchetype: string;
  player2DeckArchetype: string;
}

export interface ByeRoundEntry {
  kind: 'bye';
  id: string;
  table: string;
  playerName: string;
  deckArchetype: string;
}

export interface InvalidRoundEntry {
  kind: 'invalid';
  id: string;
  rawText: string;
  table: string;
  player: string;
  result: string;
  opponent: string;
  playerDecklist: string;
  opponentDecklist: string;
}

export type IdFactory = () => string;

export function createIdFactory(prefix = 'id'): IdFactory {
  let next = 1;
  return () => `${prefix}-${next++}`;
}

export function defaultIdFactory(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function trimPlayerName(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeLeagueStatus(status: unknown): LeagueStatus {
  return status === 'completed' || status === 'finished' ? 'completed' : 'active';
}

export function createGonesData({ leagues = [] }: { leagues?: Partial<LeagueDocument>[] } = {}): GonesData {
  return { version: GONES_DATA_VERSION, leagues: leagues.map((league) => normalizeLeague(league)) };
}

export function createLeague(
  { id, name = 'New League', status = 'active', tournaments = [] }: Partial<LeagueDocument> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): LeagueDocument {
  const leagueId = id ?? idFactory();
  return {
    id: leagueId,
    name: String(name || 'New League').trim() || 'New League',
    status: normalizeLeagueStatus(status),
    tournaments: tournaments.map((tournament) => createTournament({ ...tournament, leagueId: tournament.leagueId ?? leagueId }, { idFactory }))
  };
}

export function normalizeLeague(league: Partial<LeagueDocument> = {}, options: { idFactory?: IdFactory } = {}): LeagueDocument {
  return createLeague(league, options);
}

export function createTournament(
  { id, leagueId = '', name = getDefaultTournamentName(), tournamentDate = '', rounds = [], playerArchetypes }: Partial<TournamentDocument> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): TournamentDocument {
  const normalizedRounds = rounds.map((round) => createRound(round, { idFactory }));
  return {
    id: id ?? idFactory(),
    leagueId,
    name: String(name || getDefaultTournamentName()).trim() || getDefaultTournamentName(),
    tournamentDate: String(tournamentDate ?? ''),
    rounds: normalizedRounds,
    playerArchetypes: normalizePlayerArchetypeDocuments(playerArchetypes ?? derivePlayerArchetypesFromRoundDocuments(normalizedRounds))
  };
}

export function getDefaultTournamentName(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

export function createRound({ id, entries = [] }: Partial<RoundDocument> = {}, { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}): RoundDocument {
  return { id: id ?? idFactory(), entries: entries.map((entry, index) => createRoundEntry(withDefaultTable(entry, String(index + 1)), { idFactory })) };
}

export function createRoundEntry(entry: Partial<RoundEntry> = {}, { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}): RoundEntry {
  if (entry.kind === 'bye') return createByeRoundEntry(entry, { idFactory });
  if (entry.kind === 'invalid') return createInvalidRoundEntry(entry, { idFactory });
  return createMatchRoundEntry(entry as Partial<MatchRoundEntry>, { idFactory });
}

export function createMatchRoundEntry(
  { id, table = '', player1Name = '', player2Name = '', player1Score = 2, player2Score = 0, player1DeckArchetype = '', player2DeckArchetype = '' }: Partial<MatchRoundEntry> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): MatchRoundEntry {
  return {
    kind: 'match',
    id: id ?? idFactory(),
    table: String(table ?? ''),
    player1Name: trimPlayerName(player1Name),
    player2Name: trimPlayerName(player2Name),
    player1Score: toNonNegativeInteger(player1Score),
    player2Score: toNonNegativeInteger(player2Score),
    player1DeckArchetype: String(player1DeckArchetype ?? ''),
    player2DeckArchetype: String(player2DeckArchetype ?? '')
  };
}

export function createByeRoundEntry(
  { id, table = '', playerName = '', deckArchetype = '' }: Partial<ByeRoundEntry> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): ByeRoundEntry {
  return { kind: 'bye', id: id ?? idFactory(), table: String(table ?? ''), playerName: trimPlayerName(playerName), deckArchetype: String(deckArchetype ?? '') };
}

export function createInvalidRoundEntry(
  { id, rawText = '', table = '', player = '', result = '', opponent = '', playerDecklist = '', opponentDecklist = '' }: Partial<InvalidRoundEntry> = {},
  { idFactory = defaultIdFactory }: { idFactory?: IdFactory } = {}
): InvalidRoundEntry {
  return {
    kind: 'invalid',
    id: id ?? idFactory(),
    rawText: String(rawText ?? ''),
    table: String(table ?? ''),
    player: trimPlayerName(player),
    result: String(result ?? ''),
    opponent: trimPlayerName(opponent),
    playerDecklist: String(playerDecklist ?? ''),
    opponentDecklist: String(opponentDecklist ?? '')
  };
}

function withDefaultTable(entry: RoundEntry, fallbackTable: string): Partial<RoundEntry> {
  if (entry.kind === 'bye') return { ...entry, table: entry.table || fallbackTable };
  if (entry.kind === 'invalid') return { ...entry, table: entry.table || fallbackTable };
  return { ...entry, table: entry.table || fallbackTable };
}

function normalizePlayerArchetypeDocuments(archetypes: unknown): PlayerArchetypeDocument[] {
  if (!Array.isArray(archetypes)) return [];
  const normalized: PlayerArchetypeDocument[] = [];
  const seen = new Set<string>();
  for (const item of archetypes) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Partial<PlayerArchetypeDocument>;
    const playerName = trimPlayerName(value.playerName);
    if (!playerName || seen.has(playerName)) continue;
    seen.add(playerName);
    normalized.push({ playerName, archetype: String(value.archetype ?? '').trim() });
  }
  return normalized.sort((left, right) => left.playerName.localeCompare(right.playerName));
}

function derivePlayerArchetypesFromRoundDocuments(rounds: RoundDocument[]): PlayerArchetypeDocument[] {
  const archetypes = new Map<string, string>();
  for (const round of rounds) {
    for (const entry of round.entries) {
      if (entry.kind === 'match') {
        addDerivedArchetype(archetypes, entry.player1Name, entry.player1DeckArchetype);
        addDerivedArchetype(archetypes, entry.player2Name, entry.player2DeckArchetype);
      } else if (entry.kind === 'bye') {
        addDerivedArchetype(archetypes, entry.playerName, entry.deckArchetype);
      }
    }
  }
  return [...archetypes.entries()].map(([playerName, archetype]) => ({ playerName, archetype }));
}

function addDerivedArchetype(archetypes: Map<string, string>, playerName: string, archetype: string): void {
  const normalizedPlayerName = trimPlayerName(playerName);
  if (!normalizedPlayerName || archetypes.has(normalizedPlayerName)) return;
  archetypes.set(normalizedPlayerName, String(archetype ?? '').trim());
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}
