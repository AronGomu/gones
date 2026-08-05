import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { ApiProblemError } from '../api/api-boundary';
import { canManageLive, liveCommandError } from './live-command-ux';

describe('live command UX helpers', () => {
  it('allows every visitor to mutate while liveServer is off', () => {
    expect(canManageLive(false, undefined)).toBe(true);
    expect(canManageLive(false, 'User')).toBe(true);
  });

  it('restricts server mutations to Organizer and Admin roles', () => {
    expect(canManageLive(true, 'Organizer')).toBe(true);
    expect(canManageLive(true, 'Admin')).toBe(true);
    expect(canManageLive(true, 'User')).toBe(false);
    expect(canManageLive(true, null)).toBe(false);
  });

  it('maps 403 to forbidden and 412 to stale', () => {
    expect(liveCommandError(new ApiProblemError(403, { code: 'forbidden' }))).toBe('forbidden');
    expect(liveCommandError(new ApiProblemError(412, { code: 'stale_etag' }))).toBe('stale');
    expect(liveCommandError(new ApiProblemError(500, { code: 'boom' }))).toBe('failed');
  });

  it('maps local stale document errors to stale and everything else to failed', () => {
    expect(liveCommandError(new Error('staleLiveTournamentDocument'))).toBe('stale');
    expect(liveCommandError(new Error('anything'))).toBe('failed');
    expect(liveCommandError(undefined)).toBe('failed');
  });
});
