import { ApiProblemError } from '../api/api-boundary';
import type { GlobalRole } from './league-command-ux';

export type LiveCommandError = 'forbidden' | 'stale' | 'failed';

export function canManageLive(serverMode: boolean, role: GlobalRole | null | undefined): boolean {
  return !serverMode || role === 'Organizer' || role === 'Admin';
}

export function liveCommandError(error: unknown): LiveCommandError {
  const status = error instanceof ApiProblemError
    ? error.status
    : typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : undefined;
  if (status === 403) return 'forbidden';
  if (status === 412) return 'stale';
  if (error instanceof Error && error.message === 'staleLiveTournamentDocument') return 'stale';
  return 'failed';
}
