import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_LEAGUE_ID } from '../domain/models';
import { isAnyPlaceholderLeagueId, isLocalLeagueId, LOCAL_PLACEHOLDER_LEAGUE_ID, newLocalLeagueId } from './league-archive-origin';

/**
 * The whole routing rule of ADR 0028: origin is encoded in the id, there is no origin column and no
 * lookup table. These cases pin the prefix contract both stores depend on.
 */
describe('league archive origin', () => {
  it('a prefixed id is local', () => {
    expect(isLocalLeagueId('local-abc')).toBe(true);
  });

  it('a server id is not local', () => {
    expect(isLocalLeagueId('7f3a1d2c-0b44-4f9e-9a1e-2c8f0d6b5a11')).toBe(false);
    expect(isLocalLeagueId(PLACEHOLDER_LEAGUE_ID)).toBe(false);
  });

  it('nullish ids are not local', () => {
    expect(isLocalLeagueId(null)).toBe(false);
    expect(isLocalLeagueId(undefined)).toBe(false);
    expect(isLocalLeagueId('')).toBe(false);
  });

  it('a generated id is local', () => {
    expect(isLocalLeagueId(newLocalLeagueId())).toBe(true);
  });

  it('generated ids are unique', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newLocalLeagueId()));

    expect(ids.size).toBe(100);
  });

  it('the local placeholder is local', () => {
    expect(LOCAL_PLACEHOLDER_LEAGUE_ID).toBe('local-placeholder-league');
    expect(isLocalLeagueId(LOCAL_PLACEHOLDER_LEAGUE_ID)).toBe(true);
  });

  it('both placeholders are recognised', () => {
    expect(isAnyPlaceholderLeagueId(PLACEHOLDER_LEAGUE_ID)).toBe(true);
    expect(isAnyPlaceholderLeagueId(LOCAL_PLACEHOLDER_LEAGUE_ID)).toBe(true);
    expect(isAnyPlaceholderLeagueId('local-other')).toBe(false);
  });
});
