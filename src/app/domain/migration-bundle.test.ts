import { describe, expect, it } from 'vitest';
import {
  buildMigrationBundle,
  getOrCreateSourceInstanceId,
  LEGACY_STORE_KEYS,
  MIGRATION_BUNDLE_KIND,
  MIGRATION_BUNDLE_SOURCE_INSTANCE_KEY,
  migrationBundleFilename,
  parseMigrationBundle
} from './migration-bundle';
import { sha256Hex } from './export-schemas';

const PII_EMAIL = 'pii-probe@example.com';
const PII_TOKEN = 'fake-refresh-token-123';
const PII_PASSWORD = 'Sup3rSecretPassword!';

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); }
  };
}

function seededStorage(): Storage {
  return fakeStorage({
    'gones.frontend.backend.v1': JSON.stringify({
      version: 1,
      leagues: [
        { id: 'league-1', name: 'Ligue Lyon', status: 'active', documentVersion: 3, updatedAt: '2026-08-01T00:00:00Z', tournaments: [{ id: 't-1', leagueId: 'league-1', name: 'Weekly', tournamentDate: '2026-07-01', playerArchetypes: [], rounds: [] }] }
      ],
      calendarEvents: [{ id: 'event-1', slug: 'modern-night', title: 'Modern Night', eventDate: '2026-08-10', startTime: '19:00', endTime: '22:00', location: 'Store', country: 'France', city: 'Lyon', address: '1 rue', description: '', richDescriptionHtml: '', externalLink: '' }]
    }),
    'gones.live-tournaments.v1': JSON.stringify({
      version: 1,
      tournaments: [{ id: 'live-1', name: 'Draft Friday', leagueId: '', tournamentDate: '2026-08-07', type: 'swiss', roundCount: 3, stage: 'setup', currentRoundNumber: 0, players: [], rounds: [], checkpoints: [], documentVersion: 1, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }],
      deletedTournamentIds: ['live-gone']
    }),
    'gones.settings': JSON.stringify({ language: 'fr', deckArchetypes: ['Control', 'Aggro'] }),
    'gones.settings.language': 'fr',
    'gones.settings.deckArchetypes': JSON.stringify(['Control', 'Aggro']),
    // Secrets/PII that must never leak into the bundle.
    'gones.auth.session.v1': JSON.stringify({ email: PII_EMAIL, refreshToken: PII_TOKEN, password: PII_PASSWORD })
  });
}

describe('private migration bundle', () => {
  it('reads every legacy browser store key', () => {
    expect([...LEGACY_STORE_KEYS]).toEqual(['gones.frontend.backend.v1', 'gones.live-tournaments.v1', 'gones.settings', 'gones.settings.language', 'gones.settings.deckArchetypes']);
  });

  it('creates a stable per-browser source instance id persisted in storage', () => {
    const storage = fakeStorage();
    const first = getOrCreateSourceInstanceId(storage);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getOrCreateSourceInstanceId(storage)).toBe(first);
    expect(storage.getItem(MIGRATION_BUNDLE_SOURCE_INSTANCE_KEY)).toBe(first);
  });

  it('keeps localStorage origin-scoped: two origins yield distinct instance ids and never share data', async () => {
    // Legacy origins each hold their own localStorage — the cutover runbook must deploy this
    // exporter on every legacy origin and inventory every known device/browser.
    const originA = seededStorage();
    const originB = fakeStorage();
    const bundleA = await buildMigrationBundle({ storage: originA, now: new Date('2026-08-05T10:00:00Z'), appVersion: '0.1.0' });
    const bundleB = await buildMigrationBundle({ storage: originB, now: new Date('2026-08-05T10:00:00Z'), appVersion: '0.1.0' });
    expect(bundleA.sourceInstanceId).not.toBe(bundleB.sourceInstanceId);
    expect(bundleB.counts.leagues).toBe(0);
    expect(bundleB.counts.liveTournaments).toBe(0);
  });

  it('bundles League source, Scheduled events, Live drafts and Deck Archetypes with hashes, counts and versions', async () => {
    const storage = seededStorage();
    const now = new Date('2026-08-05T10:00:00Z');
    const bundle = await buildMigrationBundle({ storage, now, appVersion: '0.1.0' });

    expect(bundle.kind).toBe(MIGRATION_BUNDLE_KIND);
    expect(bundle.bundleFormatVersion).toBe(1);
    expect(bundle.gonesDataVersion).toBe(4);
    expect(bundle.gonesAppVersion).toBe('0.1.0');
    expect(bundle.exportedAt).toBe('2026-08-05T10:00:00.000Z');
    expect(bundle.sourceInstanceId).toBe(storage.getItem(MIGRATION_BUNDLE_SOURCE_INSTANCE_KEY));

    expect(bundle.leagues.map((league) => league.id)).toEqual(['league-1']);
    expect(bundle.calendarEvents.map((event) => event.id)).toEqual(['event-1']);
    expect(bundle.liveTournaments.map((tournament) => tournament.id)).toEqual(['live-1']);
    expect(bundle.deckArchetypes).toEqual(['Aggro', 'Control']);
    expect(bundle.counts).toEqual({ leagues: 1, tournaments: 1, calendarEvents: 1, liveTournaments: 1, deckArchetypes: 2 });

    expect(bundle.storeHashes['gones.frontend.backend.v1']).toBe(await sha256Hex(storage.getItem('gones.frontend.backend.v1')!));
    expect(bundle.storeHashes['gones.live-tournaments.v1']).toBe(await sha256Hex(storage.getItem('gones.live-tournaments.v1')!));
    expect(bundle.storeHashes['gones.settings']).toBe(await sha256Hex(storage.getItem('gones.settings')!));
    expect(bundle.bundleChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('excludes language, auth and every fake email/token/password from the bundle artifact', async () => {
    const bundle = await buildMigrationBundle({ storage: seededStorage(), now: new Date('2026-08-05T10:00:00Z'), appVersion: '0.1.0' });
    const artifact = JSON.stringify(bundle);
    expect(bundle).not.toHaveProperty('language');
    expect(artifact).not.toContain(PII_EMAIL);
    expect(artifact).not.toContain(PII_TOKEN);
    expect(artifact).not.toContain(PII_PASSWORD);
    expect(artifact).not.toContain('gones.auth');
    expect(artifact.toLowerCase()).not.toContain('refreshtoken');
  });

  it('excludes fake email/token/password from the public v4 full export artifact built from the same browser', async () => {
    const { exportFullData } = await import('./export-restore');
    const { attachExportChecksum } = await import('./export-schemas');
    const bundle = await buildMigrationBundle({ storage: seededStorage(), now: new Date('2026-08-05T10:00:00Z'), appVersion: '0.1.0' });
    const artifact = JSON.stringify(await attachExportChecksum(exportFullData(bundle.leagues, { calendarEvents: bundle.calendarEvents })));
    for (const probe of [PII_EMAIL, PII_TOKEN, PII_PASSWORD]) expect(artifact).not.toContain(probe);
    expect(artifact).not.toContain('liveTournaments');
  });

  it('hashes corrupt stores as evidence but bundles zero items from them', async () => {
    const storage = fakeStorage({ 'gones.frontend.backend.v1': '{corrupt-json' });
    const bundle = await buildMigrationBundle({ storage, now: new Date('2026-08-05T10:00:00Z'), appVersion: '0.1.0' });
    expect(bundle.storeHashes['gones.frontend.backend.v1']).toBe(await sha256Hex('{corrupt-json'));
    expect(bundle.counts.leagues).toBe(0);
    expect(bundle.storeErrors).toEqual(['gones.frontend.backend.v1']);
  });

  it('round-trips through JSON and rejects malformed or tampered bundles before any use', async () => {
    const bundle = await buildMigrationBundle({ storage: seededStorage(), now: new Date('2026-08-05T10:00:00Z'), appVersion: '0.1.0' });
    const parsed = await parseMigrationBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed).toEqual(bundle);

    await expect(parseMigrationBundle(null)).rejects.toThrow('unsupportedMigrationBundle');
    await expect(parseMigrationBundle({ ...bundle, kind: 'league' })).rejects.toThrow('unsupportedMigrationBundle');
    await expect(parseMigrationBundle({ ...bundle, bundleFormatVersion: 99 })).rejects.toThrow('unsupportedMigrationBundle');
    await expect(parseMigrationBundle({ ...bundle, storeHashes: undefined })).rejects.toThrow('unsupportedMigrationBundle');
    await expect(parseMigrationBundle({ ...bundle, deckArchetypes: ['Tampered'] })).rejects.toThrow('migrationBundleChecksumMismatch');
  });

  it('names bundle files with date and truncated source instance id', () => {
    expect(migrationBundleFilename('12345678-abcd-4000-8000-000000000000', new Date('2026-08-05T10:00:00Z'))).toBe('2026-08-05 gones-migration-12345678.private.json');
  });
});
