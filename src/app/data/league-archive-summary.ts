import { LeagueStatus, PersistedLeague } from '../domain/models';
import { calculateLeagueResult } from '../domain/results';
import { isLocalLeagueId } from './league-archive-origin';

/**
 * One row of the slim League catalog (ADR 0042). The list page prints a name, a status and two
 * numbers, so this is everything it needs and nothing it does not — the whole-document catalog it
 * replaces shipped every Round and Match to answer two integers.
 *
 * `updatedAt` and `documentVersion` are optional because a browser-local League is summarized from a
 * document that may predate either stamp; nothing on the list renders them.
 */
export interface LeagueArchiveSummary {
  id: string;
  name: string;
  status: LeagueStatus;
  updatedAt?: string;
  documentVersion?: number;
  tournamentCount: number;
  playerCount: number;
  isLocal: boolean;
}

/**
 * The browser half of the catalog. The server denormalizes both counts onto its aggregate, but a
 * browser-local League (ADR 0028) has no server to ask, so it derives them here with exactly the
 * formula the list card used to run inline — `calculateLeagueResult`, the same one the backend
 * mirrors — and the merged list stays uniform.
 */
export function summarizeLeague(league: PersistedLeague): LeagueArchiveSummary {
  return {
    id: league.id,
    name: league.name,
    status: league.status,
    updatedAt: league.updatedAt,
    documentVersion: league.documentVersion,
    tournamentCount: league.tournaments.length,
    playerCount: calculateLeagueResult(league).rows.length,
    isLocal: isLocalLeagueId(league.id)
  };
}
