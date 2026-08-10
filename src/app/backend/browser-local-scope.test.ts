import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCAL_LEAGUE_DB_NAME } from './local-league-archive-backend.service';
import { LOCAL_LIVE_DB_NAME } from './local-live-backend.service';
import { SERVER_READ_CACHE_DB_NAME } from './server-read-cache.service';

/**
 * ADR 0032 — the browser-local stores are deliberately browser-wide: `gones-leagues` (ADR 0028),
 * `gones-live` (ADR 0021) and `gones.settings` are origin-scoped, so anyone opening the site in this
 * browser sees the same local data. That is a property, not an accident, so it is asserted: those
 * sources name no profile, no user id and do not import `AuthService`.
 *
 * The one browser store that *is* user-scoped, the read cache of ADR 0031, is asserted from the
 * other direction. Without that inverse the suite would pass just as happily if the read cache
 * silently stopped scoping its rows.
 */

const backendDirectory = dirname(fileURLToPath(import.meta.url));
const sharedDirectory = join(backendDirectory, '..', 'shared');

/** Any of these in a source is a per-user scope: a profile lookup, a user id, or the auth service. */
const USER_SCOPE_MARKERS = [/profile\(\)/, /userId/, /auth\.service/];

const BROWSER_WIDE_SOURCES = [
  ['local-league-archive-backend.service.ts', join(backendDirectory, 'local-league-archive-backend.service.ts')],
  ['local-live-backend.service.ts', join(backendDirectory, 'local-live-backend.service.ts')],
  ['deck-archetype-settings.service.ts', join(sharedDirectory, 'deck-archetype-settings.service.ts')]
] as const;

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('browser-local store scope', () => {
  it('names the browser-wide databases as constants, not per-user template strings', () => {
    expect(LOCAL_LEAGUE_DB_NAME).toBe('gones-leagues');
    expect(LOCAL_LIVE_DB_NAME).toBe('gones-live');
  });

  it.each(BROWSER_WIDE_SOURCES)('%s is namespaced by nothing but the origin', (_name, path) => {
    const content = source(path);

    for (const marker of USER_SCOPE_MARKERS) expect(content).not.toMatch(marker);
  });

  it('scopes the read cache to one user, and only the read cache', () => {
    const content = source(join(backendDirectory, 'server-read-cache.service.ts'));

    expect(SERVER_READ_CACHE_DB_NAME).toBe('gones-cache');
    for (const marker of USER_SCOPE_MARKERS) expect(content).toMatch(marker);
  });
});
