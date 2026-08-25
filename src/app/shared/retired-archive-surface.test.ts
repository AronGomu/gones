import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The legacy League Archive surface is retired (T19): the `/leagues-archive/**` pages, the
 * `LeagueArchiveRepository`, the `gones-leagues` browser store and the flat `LeagueDocument` shapes
 * are gone, replaced by the three-tier archive (League → LeagueSeason → Tournament).
 *
 * This scan is the standing proof that requirement stays true. A re-introduced identifier fails
 * here, at the file level, rather than months later as a second archive authority.
 */

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = join(sourceRoot, '..');

function textFiles(directory = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/**
 * `local-archive-backend.service.ts` names the retired `gones-leagues` database on purpose: it holds
 * `purgeRetiredLeagueDatabase()`, the one-shot delete that removes the store from a developer's
 * browser. Something has to say the name in order to delete it, so that one file is exempt from that
 * one pattern — and from nothing else.
 */
const PURGE_MODULE = 'src/app/backend/local-archive-backend.service.ts';

function filesMatching(pattern: RegExp): string[] {
  const exempt = pattern.source === /\bgones-leagues\b/.source ? PURGE_MODULE : null;
  return textFiles()
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repoRoot, path).split('\\').join('/'))
    .filter((path) => path !== exempt)
    .sort();
}

const RETIRED_IDENTIFIERS = [
  /\bleagues-archive\b/, /\btournaments-archive\b/, /\bLeagueArchiveRepository\b/,
  /\bLocalLeagueArchiveBackend\b/, /\bLeagueConcurrencyError\b/, /\bstaleLeagueDocument\b/,
  /\bPLACEHOLDER_LEAGUE_ID\b/, /\bPLACEHOLDER_LEAGUE_NAME\b/, /\bisPlaceholderLeagueId\b/,
  /\bisUnassignedLeagueName\b/, /\bGONES_DATA_VERSION\b/, /\bSUPPORTED_IMPORT_DATA_VERSIONS\b/,
  /\bgones-league-updated\b/, /\bgones-leagues\b/, /\bcreatePlaceholderLeague\b/,
  /\bLeagueDocument\b/, /\bPersistedLeague\b/, /\bTournamentDocument\b/, /\bGonesData\b/
];

describe('retired legacy archive surface', () => {
  it('names no retired archive identifier anywhere under src/', () => {
    for (const pattern of RETIRED_IDENTIFIERS) {
      expect(filesMatching(pattern), String(pattern)).toEqual([]);
    }
  });

  it('ships no legacy archive feature folder', () => {
    expect(existsSync(join(sourceRoot, 'app', 'features', 'leagues-archive'))).toBe(false);
    expect(existsSync(join(sourceRoot, 'app', 'features', 'tournaments-archive'))).toBe(false);
  });

  it('ships no legacy archive data or backend module', () => {
    expect(readdirSync(join(sourceRoot, 'app', 'data')).filter((name) => name.startsWith('league-archive-'))).toEqual([]);
    expect(existsSync(join(sourceRoot, 'app', 'backend', 'local-league-archive-backend.service.ts'))).toBe(false);
  });

  it('ships no retired parity corpus and no emitter for one', () => {
    expect(existsSync(join(repoRoot, 'fixtures', 'league-domain'))).toBe(false);
    expect(existsSync(join(sourceRoot, 'app', 'domain', 'league-parity-fixtures.test.ts'))).toBe(false);
  });

  it('registers no legacy archive route and no redirect onto one', () => {
    const routes = readFileSync(join(sourceRoot, 'app', 'app.routes.ts'), 'utf8');
    expect(routes).not.toMatch(/leagues-archive|tournaments-archive|archiveRedirectRoutes/);
    expect(routes).toContain("path: 'archive'");
  });

  // Guards against the exact scan-nothing failure the walk can hide.
  it('finds files to scan, so an empty walk can never read as green', () => {
    expect(textFiles().length).toBeGreaterThan(100);
  });
});
