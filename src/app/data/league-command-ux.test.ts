import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { ApiProblemError } from '../api/api-boundary';
import { canManageLeagues, leagueCommandError } from './league-command-ux';

describe('League server access and stale UX', () => {
  it('limits League commands to Organizer and Admin', () => {
    expect(canManageLeagues(null)).toBe(false);
    expect(canManageLeagues(undefined)).toBe(false);
    expect(canManageLeagues('User')).toBe(false);
    expect(canManageLeagues('Organizer')).toBe(true);
    expect(canManageLeagues('Admin')).toBe(true);
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
