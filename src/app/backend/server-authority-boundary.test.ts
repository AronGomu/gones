import '@angular/compiler';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveDataAuthority } from '../config/data-authority';
import {
  legacyBrowserBackendAvailable,
  requireLegacyBrowserStore,
  resolveLeagueBackendMode,
  resolveLiveBackendMode
} from './application-backend';
import { AspNetApiBackend } from './aspnet-api-backend.service';

/**
 * C42 authority boundary.
 *
 * Server mode must have exactly one data authority: the API database. These assertions fail if a
 * canonical browser store, a whole-document mutation path, or the legacy CalendarEvent store can be
 * reached from a server-mode build again.
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

const legacyAuthority = resolveDataAuthority({ dataMode: 'legacy-browser', apiBaseUrl: '', features: { authV1: false, adminV1: false } });
const serverAuthority = resolveDataAuthority({ dataMode: 'server', apiBaseUrl: 'https://api.example', features: { authV1: true, adminV1: true } });

describe('server adapter surface', () => {
  it('exposes no whole-document League or Live mutation', () => {
    for (const method of ['saveLeague', 'insertLeague', 'saveLiveTournament']) {
      expect(Object.getOwnPropertyNames(AspNetApiBackend.prototype)).not.toContain(method);
    }
  });

  it('exposes no legacy CalendarEvent store path', () => {
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
  it('binds every League and Live port to the API in server mode', () => {
    expect(resolveLeagueBackendMode(serverAuthority)).toBe('aspnet-api');
    expect(resolveLiveBackendMode(serverAuthority)).toBe('aspnet-api');
  });

  it('binds every League and Live port to the browser store in legacy mode', () => {
    expect(resolveLeagueBackendMode(legacyAuthority)).toBe('frontend-local');
    expect(resolveLiveBackendMode(legacyAuthority)).toBe('frontend-local');
  });

  it('removes the legacy browser backend from server-mode dependency injection', () => {
    expect(legacyBrowserBackendAvailable(serverAuthority)).toBe(false);
    expect(legacyBrowserBackendAvailable(legacyAuthority)).toBe(true);
  });

  it('fails closed instead of degrading when a legacy-only path runs without the browser store', () => {
    for (const code of ['leagueWholeDocumentSaveDisabled', 'liveWholeDocumentSaveDisabled', 'calendarEventStoreDisabled']) {
      expect(() => requireLegacyBrowserStore(null, code)).toThrowError(code);
    }
  });
});

describe('canonical browser store containment', () => {
  it('names the canonical store keys only in the legacy adapter and the cutover bundle reader', () => {
    expect(filesMatching(/gones\.frontend\.backend\.v1|gones\.live-tournaments\.v1/)).toEqual([
      'src/app/backend/local-frontend-backend.service.ts',
      'src/app/domain/migration-bundle.ts'
    ]);
  });

  it('imports the legacy browser adapter only from the authority-gated injection module', () => {
    expect(filesMatching(/from '.*local-frontend-backend\.service'/)).toEqual([
      'src/app/backend/application-backend.ts'
    ]);
  });

  it('keeps global browser storage access inside the documented browser-only allowlist', () => {
    expect(filesMatching(/localStorage\??\.(get|set|remove)Item/)).toEqual([
      // Legacy canonical store — provided only when the authority is legacy-browser.
      'src/app/backend/local-frontend-backend.service.ts',
      // Browser view preference.
      'src/app/features/calendar/public-calendar.component.ts',
      // Public read cache (C39) — anonymous GET responses only, never a mutation source.
      'src/app/features/calendar/public-tournament.service.ts',
      // Language + local Deck Archetype preference.
      'src/app/shared/deck-archetype-settings.service.ts'
    ]);
  });
});
