import { TournamentDocument } from './models';
import { RankingRow, calculateTournamentResult } from './results';
import { tournamentPlayerArchetypeRows } from './tournament-archetypes';
import { validateRoundEntry } from './validation';

export interface TournamentSummaryTopRow extends RankingRow {
  record: string;
  archetype: string;
}

export interface ArchetypeShare {
  archetype: string;
  playerCount: number;
  totalPlayerCount: number;
  percentage: number;
}

export interface TournamentSummary {
  tournamentName: string;
  tournamentDate: string;
  generatedAt: string;
  status: 'Final' | 'Provisional' | 'Incomplete';
  topRows: TournamentSummaryTopRow[];
  archetypeShares: ArchetypeShare[];
  stats: {
    playerCount: number;
    roundCount: number;
    matchCount: number;
    byeCount: number;
    gameCount: number;
  };
}

export function buildTournamentSummary(tournament: TournamentDocument, now = new Date()): TournamentSummary {
  const result = calculateTournamentResult(tournament);
  const facts = collectTournamentSummaryFacts(tournament, result.rows.length);
  const topRows = result.rows.map((row) => ({
    ...row,
    record: formatRecord(row),
    archetype: facts.archetypesByPlayer.get(row.playerName) || 'Unknown'
  }));
  return {
    tournamentName: tournament.name,
    tournamentDate: tournament.tournamentDate,
    generatedAt: now.toISOString(),
    status: result.provisional ? 'Provisional' : result.incomplete ? 'Incomplete' : 'Final',
    topRows,
    archetypeShares: calculateArchetypeShares(facts.archetypesByPlayer, facts.stats.playerCount),
    stats: facts.stats
  };
}

export function formatSummaryPercentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function collectTournamentSummaryFacts(tournament: TournamentDocument, playerCount: number): { archetypesByPlayer: Map<string, string>; stats: TournamentSummary['stats'] } {
  const archetypesByPlayer = new Map(tournamentPlayerArchetypeRows(tournament).map((row) => [row.playerName, row.archetype]));
  const stats: TournamentSummary['stats'] = { playerCount, roundCount: tournament.rounds?.length ?? 0, matchCount: 0, byeCount: 0, gameCount: 0 };
  for (const round of tournament.rounds ?? []) {
    for (const entry of round.entries ?? []) {
      if (!validateRoundEntry(entry).valid) continue;
      if (entry.kind === 'match') {
        stats.matchCount += 1;
        stats.gameCount += entry.player1Score + entry.player2Score;
      } else if (entry.kind === 'bye') {
        stats.byeCount += 1;
      }
    }
  }
  return { archetypesByPlayer, stats };
}

function calculateArchetypeShares(archetypesByPlayer: Map<string, string>, totalPlayerCount: number): ArchetypeShare[] {
  const archetypeCounts = new Map<string, number>();
  for (const archetype of archetypesByPlayer.values()) {
    const normalizedArchetype = archetype.trim();
    if (isMissingArchetype(normalizedArchetype)) continue;
    archetypeCounts.set(normalizedArchetype, (archetypeCounts.get(normalizedArchetype) ?? 0) + 1);
  }
  if (!archetypeCounts.size || totalPlayerCount <= 0) return [];
  return [...archetypeCounts.entries()]
    .map(([archetype, playerCount]) => ({
      archetype,
      playerCount,
      totalPlayerCount,
      percentage: playerCount / totalPlayerCount
    }))
    .sort((left, right) => right.playerCount - left.playerCount || left.archetype.localeCompare(right.archetype));
}

function isMissingArchetype(archetype: string): boolean {
  return !archetype || ['unknown', 'null', 'n/a', 'na', 'none', 'no archetype', '-'].includes(archetype.toLowerCase());
}

function formatRecord(row: RankingRow): string {
  const byeSuffix = row.byes ? `, ${row.byes} bye${row.byes === 1 ? '' : 's'}` : '';
  return `${row.matchWins}-${row.matchLosses}-${row.matchDraws}${byeSuffix}`;
}
