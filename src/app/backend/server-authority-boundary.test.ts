import '@angular/compiler';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DataAuthorityConfigurationError, resolveDataAuthority } from '../config/data-authority';
import { resolveBackendMode } from './application-backend';
import { AspNetApiBackend } from './aspnet-api-backend.service';

/**
 * Authority boundary (C42, narrowed to server-only by ADR 0020).
 *
 * There is exactly one data authority: the API database. These assertions fail if a canonical
 * browser store, a whole-document mutation path, or the retired CalendarEvent store comes back.
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
  it('binds every League and Live port to the API', () => {
    expect(resolveBackendMode(serverAuthority)).toBe('aspnet-api');
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

  it('keeps global browser storage access inside the documented browser-only allowlist', () => {
    expect(filesMatching(/localStorage\??\.(get|set|remove)Item/)).toEqual([
      // Public read cache (C39) — the 24h full-catalog snapshot, anonymous GET responses only.
      'src/app/features/calendar/all-tournaments-cache.service.ts',
      // Browser view preference.
      'src/app/features/calendar/public-calendar.component.ts',
      // Public read cache (C39) — anonymous GET responses only, never a mutation source.
      'src/app/features/calendar/public-tournament.service.ts',
      // Language + local Deck Archetype preference.
      'src/app/shared/deck-archetype-settings.service.ts',
      // First-visit flag — routes the very first load to /about, never a data source.
      'src/app/shared/first-visit.service.ts'
    ]);
  });
});
