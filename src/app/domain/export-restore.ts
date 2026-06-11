import { CalendarEventDocument, CalendarEventTournamentLink, createByeRoundEntry, createCalendarEvent, createIdFactory, createInvalidRoundEntry, createLeague, createMatchRoundEntry, createRound, createTournament, GONES_DATA_VERSION, LeagueDocument, normalizeCalendarEvents, normalizeLeague, normalizeLeagueStatus, RoundEntry } from './models';

export type ExportKind = 'league' | 'fullData';

export interface LeagueExportFile {
  kind: 'league';
  gonesDataVersion: number;
  gonesAppVersion: string;
  exportedAt: string;
  league: LeagueDocument;
}

export interface FullDataExportFile {
  kind: 'fullData';
  gonesDataVersion: number;
  gonesAppVersion: string;
  exportedAt: string;
  leagues: LeagueDocument[];
  calendarEvents: CalendarEventDocument[];
}

export type GonesExportFile = LeagueExportFile | FullDataExportFile;

export function exportLeague(league: LeagueDocument, { appVersion = '0.1.0', now = new Date() } = {}): LeagueExportFile {
  return { kind: 'league', gonesDataVersion: GONES_DATA_VERSION, gonesAppVersion: appVersion, exportedAt: now.toISOString(), league: structuredClone(normalizeLeague(league)) };
}

export function leagueExportFilename(league: Pick<LeagueDocument, 'name'>, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `${date} ${league.name || 'League'}.json`;
}

export function exportFullData(leagues: LeagueDocument[], { appVersion = '0.1.0', now = new Date(), calendarEvents = [] as CalendarEventDocument[] } = {}): FullDataExportFile {
  return { kind: 'fullData', gonesDataVersion: GONES_DATA_VERSION, gonesAppVersion: appVersion, exportedAt: now.toISOString(), leagues: leagues.map((league) => structuredClone(normalizeLeague(league))), calendarEvents: structuredClone(normalizeCalendarEvents(calendarEvents)) };
}

export function restoreLeague(file: unknown, { idFactory = createIdFactory('restored'), existingLeagues = [] }: { idFactory?: () => string; existingLeagues?: LeagueDocument[] } = {}): LeagueDocument {
  const normalized = normalizeExportFile(file);
  if (normalized.kind !== 'league') throw new Error('wrongExportKind');
  return remapLeague(normalized.league, { idFactory, existingLeagues });
}

export function restoreFullData(file: unknown, { idFactory = createIdFactory('restored'), existingLeagues = [] }: { idFactory?: () => string; existingLeagues?: LeagueDocument[] } = {}): LeagueDocument[] {
  return restoreFullDataBundle(file, { idFactory, existingLeagues }).leagues;
}

export function restoreFullDataBundle(file: unknown, { idFactory = createIdFactory('restored'), existingLeagues = [] }: { idFactory?: () => string; existingLeagues?: LeagueDocument[] } = {}): { leagues: LeagueDocument[]; calendarEvents: CalendarEventDocument[] } {
  const normalized = normalizeExportFile(file);
  if (normalized.kind !== 'fullData') throw new Error('wrongExportKind');
  const restored: LeagueDocument[] = [];
  const tournamentIdMap = new Map<string, CalendarEventTournamentLink>();
  for (const league of normalized.leagues) {
    const result = remapLeagueWithTournamentMap(league, { idFactory, existingLeagues: [...existingLeagues, ...restored] });
    restored.push(result.league);
    for (const [oldKey, link] of result.tournamentIdMap) tournamentIdMap.set(oldKey, link);
  }
  return { leagues: restored, calendarEvents: normalized.calendarEvents.map((event) => createCalendarEvent({ ...event, id: undefined, tournamentLinks: remapCalendarEventTournamentLinks(event.tournamentLinks, tournamentIdMap) }, { idFactory })) };
}

export function normalizeExportFile(file: unknown): GonesExportFile {
  if (!file || typeof file !== 'object') throw new Error('unsupportedGonesExport');
  const value = file as Record<string, unknown>;

  if (value['kind'] === 'league') {
    assertSupportedVersion(value['gonesDataVersion']);
    return { kind: 'league', gonesDataVersion: Number(value['gonesDataVersion']), gonesAppVersion: String(value['gonesAppVersion'] ?? ''), exportedAt: String(value['exportedAt'] ?? ''), league: normalizeLeague(value['league'] as Partial<LeagueDocument>) };
  }
  if (value['kind'] === 'fullData') {
    assertSupportedVersion(value['gonesDataVersion']);
    const leagues = Array.isArray(value['leagues']) ? value['leagues'].map((league) => normalizeLeague(league as Partial<LeagueDocument>)) : [];
    return { kind: 'fullData', gonesDataVersion: Number(value['gonesDataVersion']), gonesAppVersion: String(value['gonesAppVersion'] ?? ''), exportedAt: String(value['exportedAt'] ?? ''), leagues, calendarEvents: normalizeCalendarEvents(value['calendarEvents']) };
  }

  // Legacy pre-Angular League Export shape: { version, exportedAt, league }.
  if (value['version'] === 1 && value['league']) {
    return { kind: 'league', gonesDataVersion: GONES_DATA_VERSION, gonesAppVersion: 'legacy', exportedAt: String(value['exportedAt'] ?? ''), league: normalizeLegacyLeague(value['league'] as Record<string, unknown>) };
  }

  throw new Error('unsupportedGonesExport');
}

function assertSupportedVersion(version: unknown): void {
  if (version !== 1 && version !== 2 && version !== 3) throw new Error('unsupportedGonesExport');
}

function remapLeague(source: LeagueDocument, { idFactory, existingLeagues }: { idFactory: () => string; existingLeagues: LeagueDocument[] }): LeagueDocument {
  return remapLeagueWithTournamentMap(source, { idFactory, existingLeagues }).league;
}

function remapLeagueWithTournamentMap(source: LeagueDocument, { idFactory, existingLeagues }: { idFactory: () => string; existingLeagues: LeagueDocument[] }): { league: LeagueDocument; tournamentIdMap: Map<string, CalendarEventTournamentLink> } {
  const name = uniqueRestoredName(source.name, existingLeagues);
  const league = createLeague({ name, status: source.status, tournaments: [] }, { idFactory });
  const tournamentIdMap = new Map<string, CalendarEventTournamentLink>();
  league.tournaments = (source.tournaments ?? []).map((tournament) => {
    const next = createTournament({ leagueId: league.id, name: tournament.name, tournamentDate: tournament.tournamentDate, playerArchetypes: tournament.playerArchetypes, rounds: [] }, { idFactory });
    tournamentIdMap.set(`${source.id}:${tournament.id}`, { leagueId: league.id, tournamentId: next.id });
    next.rounds = (tournament.rounds ?? []).map((round) => createRound({ entries: (round.entries ?? []).map((entry) => remapEntry(entry, { idFactory })) }, { idFactory }));
    return next;
  });
  return { league, tournamentIdMap };
}

function remapCalendarEventTournamentLinks(links: CalendarEventTournamentLink[], tournamentIdMap: Map<string, CalendarEventTournamentLink>): CalendarEventTournamentLink[] {
  return links.map((link) => tournamentIdMap.get(`${link.leagueId}:${link.tournamentId}`) ?? link);
}

function remapEntry(entry: RoundEntry, { idFactory }: { idFactory: () => string }): RoundEntry {
  if (entry.kind === 'invalid') {
    const { id: _oldId, ...entryWithoutId } = entry;
    return createInvalidRoundEntry(entryWithoutId, { idFactory });
  }
  if (entry.kind === 'bye') {
    const { id: _oldId, ...entryWithoutId } = entry;
    return createByeRoundEntry(entryWithoutId, { idFactory });
  }
  const { id: _oldId, ...entryWithoutId } = entry;
  return createMatchRoundEntry(entryWithoutId, { idFactory });
}

function uniqueRestoredName(name: string, existingLeagues: LeagueDocument[]): string {
  const existingNames = new Set(existingLeagues.map((league) => league.name));
  if (!existingNames.has(name)) return name;
  const base = `${name} (restored)`;
  if (!existingNames.has(base)) return base;
  let suffix = 2;
  while (existingNames.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function normalizeLegacyLeague(source: Record<string, unknown>): LeagueDocument {
  const leagueId = String(source['id'] ?? 'legacy-league');
  const tournaments = Array.isArray(source['tournaments']) ? source['tournaments'].map((tournament) => normalizeLegacyTournament(tournament as Record<string, unknown>, leagueId)) : [];
  return createLeague({ id: leagueId, name: String(source['name'] ?? 'Restored League'), status: normalizeLeagueStatus(source['status']), tournaments });
}

function normalizeLegacyTournament(source: Record<string, unknown>, leagueId: string) {
  return createTournament({
    id: String(source['id'] ?? ''),
    leagueId,
    name: String(source['name'] ?? ''),
    tournamentDate: String(source['tournamentDate'] ?? ''),
    rounds: Array.isArray(source['rounds']) ? source['rounds'].map((round) => ({ id: String((round as Record<string, unknown>)['id'] ?? ''), entries: normalizeLegacyEntries((round as Record<string, unknown>)['entries']) })) : []
  });
}

function normalizeLegacyEntries(entries: unknown): RoundEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    const value = entry as Record<string, unknown>;
    if (value['kind'] === 'invalid') return createInvalidRoundEntry(value as never);
    if (value['kind'] === 'bye') return createByeRoundEntry({ id: String(value['id'] ?? ''), table: String(value['table'] ?? ''), playerName: String(value['player'] ?? ''), deckArchetype: String(value['playerDecklist'] ?? '') });
    const score = parseLegacyScore(String(value['result'] ?? ''));
    return createMatchRoundEntry({ id: String(value['id'] ?? ''), table: String(value['table'] ?? ''), player1Name: String(value['player'] ?? ''), player2Name: String(value['opponent'] ?? ''), player1Score: score.playerScore, player2Score: score.opponentScore, player1DeckArchetype: String(value['playerDecklist'] ?? ''), player2DeckArchetype: String(value['opponentDecklist'] ?? '') });
  });
}

function parseLegacyScore(result: string): { playerScore: number; opponentScore: number } {
  const match = result.match(/(\d+)\s*-\s*(\d+)/);
  return { playerScore: match ? Number(match[1]) : 0, opponentScore: match ? Number(match[2]) : 0 };
}
