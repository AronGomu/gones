import { PLACEHOLDER_LEAGUE_ID } from '../domain/models';

/** A league stored in this browser carries this prefix; it is the whole routing rule (ADR 0028). */
export const LOCAL_LEAGUE_ID_PREFIX = 'local-';
export const LOCAL_PLACEHOLDER_LEAGUE_ID = `${LOCAL_LEAGUE_ID_PREFIX}${PLACEHOLDER_LEAGUE_ID}`;

export function isLocalLeagueId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_LEAGUE_ID_PREFIX);
}

export function newLocalLeagueId(uuid = crypto.randomUUID()): string {
  return `${LOCAL_LEAGUE_ID_PREFIX}${uuid}`;
}

/** Any placeholder, from either store. Both are "Unassigned Tournaments" to the user. */
export function isAnyPlaceholderLeagueId(id: string | null | undefined): boolean {
  return id === PLACEHOLDER_LEAGUE_ID || id === LOCAL_PLACEHOLDER_LEAGUE_ID;
}
