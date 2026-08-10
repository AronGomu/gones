import { ApiProblemError } from '../api/api-boundary';
import { isLocalLeagueId } from './league-archive-origin';

export type GlobalRole = 'User' | 'Organizer' | 'Admin' | string;
export type LeagueCommandError = 'forbidden' | 'stale' | 'failed';

/** The server owns League data, so managing it is a role question only (ADR 0020). */
export function canManageLeagues(role: GlobalRole | null | undefined): boolean {
  return role === 'Organizer' || role === 'Admin';
}

/** A league in this browser is owned by whoever can see it; a server league needs the role (ADR 0028). */
export function canManageLeague(leagueId: string | null | undefined, role: GlobalRole | null | undefined): boolean {
  return isLocalLeagueId(leagueId) || canManageLeagues(role);
}

/** Where a brand-new league is written. */
export function createLeagueTarget(role: GlobalRole | null | undefined): 'server' | 'local' {
  return canManageLeagues(role) ? 'server' : 'local';
}

export function leagueCommandError(error: unknown): LeagueCommandError {
  const status = error instanceof ApiProblemError
    ? error.status
    : typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : undefined;
  if (status === 403) return 'forbidden';
  if (status === 412) return 'stale';
  if (error instanceof Error && error.message === 'staleLeagueDocument') return 'stale';
  return 'failed';
}
