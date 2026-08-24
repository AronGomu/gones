import { ApiProblemError } from '../api/api-boundary';
import { isLocalArchiveId } from './archive-origin';

export type GlobalRole = 'User' | 'Organizer' | 'Admin' | string;
export type ArchiveCommandError = 'forbidden' | 'stale' | 'locked' | 'notEmpty' | 'notFound' | 'invalid' | 'failed';

/** The server owns archive data, so managing it is a role question only (ADR 0020). */
export function canManageArchive(role: GlobalRole | null | undefined): boolean {
  return role === 'Organizer' || role === 'Admin';
}

/** A record in this browser is owned by whoever can see it; a server record needs the role (ADR 0028). */
export function canManageArchiveRecord(id: string | null | undefined, role: GlobalRole | null | undefined): boolean {
  return isLocalArchiveId(id) || canManageArchive(role);
}

/** Where a brand-new record is written. */
export function createArchiveTarget(role: GlobalRole | null | undefined): 'server' | 'local' {
  return canManageArchive(role) ? 'server' : 'local';
}

/**
 * HTTP status first, code/message second. The wire vocabulary is snake_case because that is what
 * `Gones.Api/Errors/ApiExceptions.cs` emits API-wide; the browser-local authority raises camelCase
 * messages because those are local strings, never wire codes. Both are accepted here so one classifier
 * serves both authorities.
 */
export function archiveCommandError(error: unknown): ArchiveCommandError {
  const status = errorStatus(error);
  const code = error instanceof ApiProblemError ? error.problem.code : undefined;
  const message = error instanceof Error ? error.message : undefined;
  if (status === 403) return 'forbidden';
  if (status === 412) return 'stale';
  if (status === 404) return 'notFound';
  if (status === 400) return 'invalid';
  if (status === 409) {
    if (code === 'archive_league_not_empty' || message === 'archiveLeagueNotEmpty') return 'notEmpty';
    if (code === 'archive_tournament_locked' || message === 'archiveTournamentLocked') return 'locked';
    return 'failed';
  }
  if (message === 'staleArchiveDocument') return 'stale';
  return 'failed';
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof ApiProblemError) return error.status;
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}
