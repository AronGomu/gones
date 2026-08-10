import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { canManageLeague, createLeagueTarget } from './league-archive-command-ux';

/**
 * ADR 0028 — permission is per league, not per session, and a brand-new league is the one write with
 * no id to route on. These two helpers are the whole user-facing form of that rule.
 */
describe('league archive write routing', () => {
  it('a local league is manageable by anyone', () => {
    expect(canManageLeague('local-abc', undefined)).toBe(true);
    expect(canManageLeague('local-abc', 'User')).toBe(true);
  });

  it('a server league needs the role', () => {
    expect(canManageLeague('7f3a', undefined)).toBe(false);
    expect(canManageLeague('7f3a', 'User')).toBe(false);
  });

  it('an organizer manages server leagues', () => {
    expect(canManageLeague('7f3a', 'Organizer')).toBe(true);
    expect(canManageLeague('7f3a', 'Admin')).toBe(true);
  });

  it('new leagues go local for the unprivileged', () => {
    expect(createLeagueTarget(undefined)).toBe('local');
    expect(createLeagueTarget('User')).toBe('local');
  });

  it('new leagues go to the server for the privileged', () => {
    expect(createLeagueTarget('Organizer')).toBe('server');
    expect(createLeagueTarget('Admin')).toBe('server');
  });
});
