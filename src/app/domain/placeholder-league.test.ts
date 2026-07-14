import { describe, expect, it } from 'vitest';
import {
  createLeague,
  createPlaceholderLeague,
  isPlaceholderLeagueId,
  isUnassignedLeagueName,
  PLACEHOLDER_LEAGUE_ID,
  PLACEHOLDER_LEAGUE_NAME
} from './models';

describe('placeholder unassigned league identity', () => {
  it('recognizes fixed placeholder id', () => {
    expect(isPlaceholderLeagueId(PLACEHOLDER_LEAGUE_ID)).toBe(true);
    expect(isPlaceholderLeagueId('demo-league')).toBe(false);
    expect(isPlaceholderLeagueId('')).toBe(false);
  });

  it('treats EN and FR unassigned labels as the same reserved name', () => {
    expect(isUnassignedLeagueName('Unassigned Tournaments')).toBe(true);
    expect(isUnassignedLeagueName('unassigned tournaments')).toBe(true);
    expect(isUnassignedLeagueName('Tournois non assignés')).toBe(true);
    expect(isUnassignedLeagueName('  tournois non assignes  ')).toBe(true);
    expect(isUnassignedLeagueName('Demo League')).toBe(false);
  });

  it('always stores canonical English name for placeholder id regardless of input name', () => {
    const renamed = createLeague({ id: PLACEHOLDER_LEAGUE_ID, name: 'Tournois non assignés', tournaments: [] });
    expect(renamed.id).toBe(PLACEHOLDER_LEAGUE_ID);
    expect(renamed.name).toBe(PLACEHOLDER_LEAGUE_NAME);

    const created = createPlaceholderLeague();
    expect(created.id).toBe(PLACEHOLDER_LEAGUE_ID);
    expect(created.name).toBe(PLACEHOLDER_LEAGUE_NAME);
  });

  it('does not force non-placeholder leagues onto the unassigned id', () => {
    const league = createLeague({ name: 'Tournois non assignés' });
    expect(league.id).not.toBe(PLACEHOLDER_LEAGUE_ID);
    expect(league.name).toBe('Tournois non assignés');
  });
});
