import { describe, expect, it } from 'vitest';
import {
  assertNoDeniedFields,
  attachExportChecksum,
  canonicalJsonStringify,
  EXPORT_LIMITS,
  PUBLIC_EXPORT_DENYLIST_FIELDS,
  PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS,
  sha256Hex,
  verifyExportChecksum
} from './export-schemas';
import { buildArchiveBundle } from './archive-export-schemas';
import { createArchiveLeague } from './archive-models';
import { createCalendarEvent } from './models';

describe('version-agnostic export helpers', () => {
  it('declares an explicit secret/PII denylist that never intersects the allowlists', () => {
    for (const denied of ['email', 'users', 'password', 'passwordHash', 'token', 'refreshToken', 'accessToken', 'memberships', 'registrations', 'blocks', 'audit', 'outbox', 'history', 'liveTournaments', 'sessions', 'phone']) {
      expect(PUBLIC_EXPORT_DENYLIST_FIELDS).toContain(denied);
    }
    for (const denied of PUBLIC_EXPORT_DENYLIST_FIELDS) {
      expect(PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS).not.toContain(denied);
    }
  });

  it('rejects denied fields anywhere in an export payload and accepts a clean v5 bundle', () => {
    const clean = buildArchiveBundle({
      leagues: [createArchiveLeague({ name: 'League' })],
      leagueSeasons: [],
      tournaments: [],
      calendarEvents: [createCalendarEvent({ title: 'Modern Night' })]
    });
    expect(() => assertNoDeniedFields(clean)).not.toThrow();
    expect(() => assertNoDeniedFields({ ...clean, leagues: [{ ...clean.leagues[0], email: 'pii-probe@example.com' }] })).toThrow('deniedExportField:email');
    expect(() => assertNoDeniedFields({ nested: { deep: [{ refreshToken: 'fake-refresh-token-123' }] } })).toThrow('deniedExportField:refreshToken');
  });

  it('defines max sizes and counts shared with browser import limits', () => {
    expect(EXPORT_LIMITS.maxImportFileBytes).toBe(2 * 1024 * 1024);
    expect(EXPORT_LIMITS.maxFullDataLeagues).toBe(100);
    expect(EXPORT_LIMITS.maxCalendarEvents).toBeGreaterThan(0);
    expect(EXPORT_LIMITS.maxMigrationBundleBytes).toBeGreaterThanOrEqual(EXPORT_LIMITS.maxImportFileBytes);
    expect(EXPORT_LIMITS.maxLiveTournaments).toBeGreaterThan(0);
    expect(EXPORT_LIMITS.maxDeckArchetypes).toBeGreaterThan(0);
  });

  it('canonicalizes JSON with stable key order for hashing', () => {
    expect(canonicalJsonStringify({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } })).toBe('{"a":{"c":3,"d":[2,{"y":2,"z":1}]},"b":1}');
  });

  it('hashes with SHA-256 hex', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('attaches and verifies an export checksum, rejecting tampered payloads', async () => {
    const bundle = buildArchiveBundle({ leagues: [createArchiveLeague({ id: 'l-1', name: 'League' })], leagueSeasons: [], tournaments: [] });
    const file = await attachExportChecksum(bundle);
    expect(file.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await verifyExportChecksum(file)).toBe(true);
    expect(await verifyExportChecksum({ ...file, leagues: [{ ...file.leagues[0], name: 'Tampered' }] })).toBe(false);
    // A payload with no checksum at all is not a tampered one; the helper is version-agnostic.
    expect(await verifyExportChecksum({ version: 5, leagues: [] })).toBe(true);
  });
});
