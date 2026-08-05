import { describe, expect, it } from 'vitest';
import {
  assertNoDeniedFields,
  attachExportChecksum,
  canonicalJsonStringify,
  EXPORT_JSON_SCHEMAS,
  EXPORT_LIMITS,
  PUBLIC_EXPORT_DENYLIST_FIELDS,
  PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS,
  PUBLIC_EXPORT_V4_LEAGUE_FIELDS,
  sha256Hex,
  verifyExportChecksum
} from './export-schemas';
import { exportFullData, exportLeague } from './export-restore';
import { createCalendarEvent, createLeague, GONES_DATA_VERSION, SUPPORTED_IMPORT_DATA_VERSIONS } from './models';

describe('versioned export schemas', () => {
  it('defines a JSON Schema for every supported data version up to v4', () => {
    expect(GONES_DATA_VERSION).toBe(4);
    expect([...SUPPORTED_IMPORT_DATA_VERSIONS]).toEqual([1, 2, 3, 4]);
    for (const version of SUPPORTED_IMPORT_DATA_VERSIONS) {
      const schema = EXPORT_JSON_SCHEMAS[version];
      expect(schema, `schema v${version}`).toBeTruthy();
      expect(schema.$id).toContain(`v${version}`);
    }
  });

  it('locks the v4 public allowlist to League/Result source and public Scheduled fields', () => {
    expect([...PUBLIC_EXPORT_V4_LEAGUE_FIELDS]).toEqual(['id', 'name', 'status', 'tournaments']);
    expect([...PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS]).toEqual([
      'id', 'slug', 'title', 'eventDate', 'startTime', 'endTime', 'location', 'country', 'city', 'address', 'description', 'richDescriptionHtml', 'externalLink'
    ]);
    const v4 = EXPORT_JSON_SCHEMAS[4];
    expect(v4.additionalProperties).toBe(false);
  });

  it('declares an explicit secret/PII denylist that never intersects the allowlists', () => {
    for (const denied of ['email', 'users', 'password', 'passwordHash', 'token', 'refreshToken', 'accessToken', 'memberships', 'registrations', 'blocks', 'audit', 'outbox', 'history', 'liveTournaments', 'sessions', 'phone']) {
      expect(PUBLIC_EXPORT_DENYLIST_FIELDS).toContain(denied);
    }
    for (const denied of PUBLIC_EXPORT_DENYLIST_FIELDS) {
      expect(PUBLIC_EXPORT_V4_LEAGUE_FIELDS).not.toContain(denied);
      expect(PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS).not.toContain(denied);
    }
  });

  it('rejects denied fields anywhere in an export payload and accepts clean v4 exports', () => {
    const clean = exportFullData([createLeague({ name: 'League' })], { calendarEvents: [createCalendarEvent({ title: 'Modern Night' })] });
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
    const file = await attachExportChecksum(exportLeague(createLeague({ name: 'League' }), { now: new Date('2026-08-01T00:00:00Z') }));
    expect(file.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await verifyExportChecksum(file)).toBe(true);
    expect(await verifyExportChecksum({ ...file, league: { ...file.league, name: 'Tampered' } })).toBe(false);
    // Legacy v1–v3 exports have no checksum and must stay importable.
    expect(await verifyExportChecksum({ kind: 'league', gonesDataVersion: 3, league: {} })).toBe(true);
  });
});
