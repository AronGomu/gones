import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { ApiProblemError } from '../api/api-boundary';
import { canManageLeagues, leagueCommandError } from './league-command-ux';

describe('League server access and stale UX', () => {
  it('keeps legacy controls while limiting server commands to Organizer/Admin', () => {
    expect(canManageLeagues(false, null)).toBe(true);
    expect(canManageLeagues(true, null)).toBe(false);
    expect(canManageLeagues(true, 'User')).toBe(false);
    expect(canManageLeagues(true, 'Organizer')).toBe(true);
    expect(canManageLeagues(true, 'Admin')).toBe(true);
  });

  it('distinguishes explicit forbidden and stale compare/reload states', () => {
    expect(leagueCommandError(new ApiProblemError(403, { code: 'forbidden' }))).toBe('forbidden');
    expect(leagueCommandError(new ApiProblemError(412, { code: 'stale_etag' }))).toBe('stale');
    expect(leagueCommandError({ status: 403, response: '{}' })).toBe('forbidden');
    expect(leagueCommandError({ status: 412, response: '{}' })).toBe('stale');
    expect(leagueCommandError(new Error('staleLeagueDocument'))).toBe('stale');
    expect(leagueCommandError(new Error('network'))).toBe('failed');
  });
});
