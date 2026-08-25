import '@angular/compiler';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DataAuthorityConfigurationError, resolveDataAuthority } from '../config/data-authority';
import { resolveBackendMode, resolveLiveBackendMode } from './application-backend';
import { AspNetApiBackend } from './aspnet-api-backend.service';

/**
 * Authority boundary (C42, narrowed to server-only by ADR 0020, then narrowed again for the Live
 * Tournament capability by ADR 0021 and for the Archive by ADR 0028).
 *
 * The API database is still the authority for Calendar, auth, organizer, admin and every server
 * archive record. These assertions fail if a canonical browser store, a whole-document mutation path,
 * or the retired CalendarEvent store comes back — or if the two sanctioned browser stores, the Live
 * local adapter (ADR 0021, `gones-live`) and the archive local adapter (ADR 0028,
 * `gones-archive-local`), spread beyond the files those ADRs confine them to.
 */

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = join(sourceRoot, '..');

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles()
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repoRoot, path).split('\\').join('/'))
    .sort();
}

const serverAuthority = resolveDataAuthority({ dataMode: 'server', apiBaseUrl: 'https://api.example', features: { authV1: true, adminV1: true } });

describe('server adapter surface', () => {
  it('exposes no whole-document League or Live mutation', () => {
    for (const method of ['saveLeague', 'insertLeague', 'saveLiveTournament']) {
      expect(Object.getOwnPropertyNames(AspNetApiBackend.prototype)).not.toContain(method);
    }
  });

  it('exposes no retired CalendarEvent store path', () => {
    for (const method of ['listCalendarEvents', 'saveCalendarEvent', 'deleteCalendarEvent']) {
      expect(Object.getOwnPropertyNames(AspNetApiBackend.prototype)).not.toContain(method);
    }
  });

  it('never touches browser storage', () => {
    const source = readFileSync(join(sourceRoot, 'app', 'backend', 'aspnet-api-backend.service.ts'), 'utf8');

    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});

describe('backend port selection', () => {
  it('binds every League port to the API', () => {
    // Leagues did not move. There is one League adapter and it is the server (ADR 0020).
    expect(resolveBackendMode(serverAuthority)).toBe('aspnet-api');
  });

  it('binds the Live port by role, and only by role', () => {
    // ADR 0021: synchronisation is an Organizer privilege; everyone else is strictly offline.
    expect(resolveLiveBackendMode(serverAuthority, undefined)).toBe('browser-local');
    expect(resolveLiveBackendMode(serverAuthority, 'User')).toBe('browser-local');
    expect(resolveLiveBackendMode(serverAuthority, 'Organizer')).toBe('aspnet-api');
    expect(resolveLiveBackendMode(serverAuthority, 'Admin')).toBe('aspnet-api');
  });

  it('refuses to bind the Live port for anything but the server authority', () => {
    expect(() => resolveLiveBackendMode({ ...serverAuthority, serverAuthority: false }, 'Admin')).toThrowError('serverAuthorityRequired');
  });

  it('refuses to bind a port for anything but the server authority', () => {
    const notServer = { ...serverAuthority, serverAuthority: false };

    expect(() => resolveBackendMode(notServer)).toThrowError('serverAuthorityRequired');
  });

  it('rejects the retired legacy-browser declaration instead of resolving it', () => {
    expect(() => resolveDataAuthority({ dataMode: 'legacy-browser', apiBaseUrl: '', features: { authV1: false, adminV1: false } }))
      .toThrowError(DataAuthorityConfigurationError);
  });
});

describe('canonical browser store containment', () => {
  it('names no canonical browser store key anywhere in the application', () => {
    expect(filesMatching(/gones\.frontend\.backend\.v1|gones\.live-tournaments\.v1/)).toEqual([]);
  });

  it('ships no browser store adapter to import', () => {
    expect(filesMatching(/from '.*local-frontend-backend\.service'/)).toEqual([]);
  });

  it('confines IndexedDB to the sanctioned local adapters', () => {
    // ADR 0021 reopened a browser store for Live Tournaments, ADR 0028 for the Archive, and for
    // nothing else. The pattern covers the whole IndexedDB surface, not just the `indexedDB`
    // global, so a leaked `IDBDatabase` parameter in a repository or component is caught too. Adding
    // a file here is an ADR decision.
    expect(filesMatching(/\bindexedDB\b|\bIDB[A-Z]\w*/)).toEqual([
      // The single writer of the public year partitions: one year, one transaction, whole or absent.
      'src/app/backend/archive-backfill-queue.ts',
      // Public archive catalog cache (ADR 0039 TTL). It is on IndexedDB rather than the shared
      // key-value budget because one year partition may hold 25,000 rows. Public answers only, so
      // logout does not purge it; anything user-scoped still belongs to `server-read-cache.service.ts`.
      'src/app/backend/archive-cache.service.ts',
      // Promise wrapper over the raw request/transaction API. No data rules.
      'src/app/backend/indexed-db.ts',
      // The three-tier archive browser-local authority (ADR 0028), composing the pure domain.
      'src/app/backend/local-archive-backend.service.ts',
      // The Live browser-local adapter itself (anonymous + `User`), composing the pure domain.
      'src/app/backend/local-live-backend.service.ts',
      // Per-user offline read cache for server responses (ADR 0031). Reads only; purged on logout.
      'src/app/backend/server-read-cache.service.ts'
    ]);
  });

  it('permits only exact marker/generation/probe storage operations for auth coordination', () => {
    const authSource = readFileSync(join(sourceRoot, 'app', 'auth', 'auth.service.ts'), 'utf8');
    const coordinationSource = readFileSync(join(sourceRoot, 'app', 'auth', 'auth-session-coordination.service.ts'), 'utf8');
    expect(authSource).not.toMatch(/localStorage\??\.(get|set|remove)Item/);
    expect(coordinationSource).toContain("const AUTH_COORDINATION_PROBE_KEY = 'gones.auth.coordinationProbe';");
    expect(coordinationSource).toContain("const AUTH_PRIVATE_PURGE_REQUIRED_KEY = 'gones.auth.privatePurgeRequired';");
    expect(coordinationSource).toContain("const AUTH_SESSION_GENERATION_KEY = 'gones.auth.sessionGeneration';");

    const allowed = new Map([
      ['globalThis.localStorage?.getItem(AUTH_SESSION_GENERATION_KEY)', 3],
      ['globalThis.localStorage?.getItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY)', 4],
      ['globalThis.localStorage?.setItem(AUTH_SESSION_GENERATION_KEY, String(generation))', 1],
      ["globalThis.localStorage?.setItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY, '1')", 1],
      ['globalThis.localStorage?.removeItem(AUTH_PRIVATE_PURGE_REQUIRED_KEY)', 1],
      ["globalThis.localStorage?.setItem(AUTH_COORDINATION_PROBE_KEY, '1')", 1],
      ['globalThis.localStorage?.getItem(AUTH_COORDINATION_PROBE_KEY)', 2],
      ['globalThis.localStorage?.removeItem(AUTH_COORDINATION_PROBE_KEY)', 1]
    ]);
    let unexplained = coordinationSource;
    for (const [operation, count] of allowed) {
      expect(coordinationSource.split(operation).length - 1, operation).toBe(count);
      unexplained = unexplained.split(operation).join('');
    }
    expect(unexplained).not.toMatch(/localStorage\??\.(get|set|remove)Item/);
  });

  it('keeps global browser storage access inside the documented browser-only allowlist', () => {
    expect(filesMatching(/localStorage\??\.(get|set|remove)Item/)).toEqual([
      // Cross-tab marker + generation only; values contain no profile or domain data.
      'src/app/auth/auth-session-coordination.service.ts',
      // Browser view preference.
      'src/app/features/events/public-event-list.component.ts',
      // Public read cache (C39) — anonymous GET responses only, never a mutation source.
      'src/app/features/events/public-event.service.ts',
      // Two Player Statistics display preferences only: source visibility + page size.
      'src/app/features/players/player-stats-preferences.ts',
      // Public read cache (C39, ADR 0039) — the 24h full-catalog snapshot, public GET responses only.
      'src/app/shared/catalog-cache.ts',
      // Language + local Deck Archetype preference.
      'src/app/shared/deck-archetype-settings.service.ts',
      // First-visit flag — routes the very first load to /about, never a data source.
      'src/app/shared/first-visit.service.ts',
      // Boolean UI capability preference only; never auth, authority, or domain data.
      'src/app/shared/power-user-settings.service.ts'
    ]);
  });

  /**
   * The allowlist above only sees raw `localStorage` calls, and `catalog-cache.ts` is now the single
   * file that makes them for public reads — so without this second list a new file could put private
   * user data in `localStorage` through `writeCatalogEntry` and still pass. `localStorage` outlives
   * logout and is readable by the next account on this browser, so each importer is named on purpose
   * and adding one is a deliberate edit here.
   */
  it('keeps the public catalog cache helper to its declared importers', () => {
    expect(filesMatching(/from '[^']*shared\/catalog-cache'/)).toEqual([
      // Imports `CATALOG_TTL_MS` only — the archive catalog cache is IndexedDB and writes no row here.
      'src/app/backend/archive-cache.service.ts',
      // Public Event catalog — anonymous GET responses.
      'src/app/features/events/event-catalog-cache.service.ts',
      // Public global Player Statistics catalog — anonymous GET responses.
      'src/app/features/players/global-stats-catalog-cache.service.ts',
      // Public per-player statistics — anonymous GET responses.
      'src/app/features/players/player-detail-cache.service.ts'
    ]);
  });
});
