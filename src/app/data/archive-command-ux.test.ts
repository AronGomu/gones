import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { ApiProblemError } from '../api/api-boundary';
import { ArchiveConcurrencyError, ArchiveLeagueNotEmptyError, ArchiveNotFoundError } from '../backend/local-archive-backend.service';
import { archiveCommandError, canManageArchive, canManageArchiveRecord, createArchiveTarget } from './archive-command-ux';

describe('archive access', () => {
  it('limits archive commands to Organizer and Admin', () => {
    expect(canManageArchive(null)).toBe(false);
    expect(canManageArchive(undefined)).toBe(false);
    expect(canManageArchive('User')).toBe(false);
    expect(canManageArchive('Organizer')).toBe(true);
    expect(canManageArchive('Admin')).toBe(true);
  });

  it('a browser-local record is managed by whoever can see it', () => {
    expect(canManageArchiveRecord('local-1', 'User')).toBe(true);
    expect(canManageArchiveRecord('server-1', 'User')).toBe(false);
    expect(canManageArchiveRecord('server-1', 'Admin')).toBe(true);
  });

  it('routes a new record by role', () => {
    expect(createArchiveTarget('User')).toBe('local');
    expect(createArchiveTarget('Organizer')).toBe('server');
    expect(createArchiveTarget(null)).toBe('local');
  });
});

describe('archiveCommandError', () => {
  it('classifies the wire vocabulary on status first', () => {
    expect(archiveCommandError(new ApiProblemError(403, { code: 'forbidden' }))).toBe('forbidden');
    expect(archiveCommandError(new ApiProblemError(412, { code: 'stale_version' }))).toBe('stale');
    expect(archiveCommandError(new ApiProblemError(404, { code: 'not_found' }))).toBe('notFound');
    expect(archiveCommandError(new ApiProblemError(400, { code: 'validation_failed' }))).toBe('invalid');
  });

  it('separates the two 409s by code', () => {
    expect(archiveCommandError(new ApiProblemError(409, { code: 'archive_tournament_locked' }))).toBe('locked');
    expect(archiveCommandError(new ApiProblemError(409, { code: 'archive_league_not_empty' }))).toBe('notEmpty');
    expect(archiveCommandError(new ApiProblemError(409, { code: 'something_else' }))).toBe('failed');
  });

  it('classifies a duck-typed generated-client failure', () => {
    expect(archiveCommandError({ status: 403 })).toBe('forbidden');
    expect(archiveCommandError({ status: 412 })).toBe('stale');
  });

  it('classifies the browser-local errors the local adapter throws', () => {
    expect(archiveCommandError(new ArchiveConcurrencyError())).toBe('stale');
    expect(archiveCommandError(new ArchiveLeagueNotEmptyError())).toBe('notEmpty');
    expect(archiveCommandError(new ArchiveNotFoundError('league'))).toBe('notFound');
  });

  it('classifies a bare stale message with no status', () => {
    expect(archiveCommandError(new Error('staleArchiveDocument'))).toBe('stale');
  });

  it('an unknown failure is failed', () => {
    expect(archiveCommandError(new Error('network'))).toBe('failed');
    expect(archiveCommandError(undefined)).toBe('failed');
    expect(archiveCommandError('boom')).toBe('failed');
  });
});
