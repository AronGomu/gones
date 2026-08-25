import { ApiProblemError } from '../api/api-boundary';
import type { GlobalRole } from './archive-command-ux';

export type LiveCommandError = 'forbidden' | 'stale' | 'failed';

export type LiveDeleteOutcome = 'deleted' | 'cancelled' | 'forbidden' | 'stale' | 'failed';

/** The server owns Live data, so managing it is a role question only (ADR 0020). */
export function canManageLive(role: GlobalRole | null | undefined): boolean {
  return role === 'Organizer' || role === 'Admin';
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

/** Maps a delete attempt's result to the outcome the runner reports. */
export function liveDeleteOutcome(confirmed: boolean, error?: unknown): LiveDeleteOutcome {
  if (!confirmed) return 'cancelled';
  if (error === undefined) return 'deleted';
  return liveCommandError(error);
}
