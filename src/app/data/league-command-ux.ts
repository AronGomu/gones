import { ApiProblemError } from '../api/api-boundary';

export type GlobalRole = 'User' | 'Organizer' | 'Admin' | string;
export type LeagueCommandError = 'forbidden' | 'stale' | 'failed';

export function canManageLeagues(serverMode: boolean, role: GlobalRole | null | undefined): boolean {
  return !serverMode || role === 'Organizer' || role === 'Admin';
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
