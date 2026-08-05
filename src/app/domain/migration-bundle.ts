import { CalendarEventDocument, LeagueDocument, normalizeCalendarEvents, normalizeLeague } from './models';
import { LiveTournamentDocument, normalizeLiveTournament } from './live-tournament';
import { canonicalJsonStringify, EXPORT_LIMITS, sha256Hex } from './export-schemas';

/**
 * Private migration bundle: a per-browser snapshot of every legacy origin-scoped
 * localStorage store, built for the offline migration CLI. It contains private data
 * (Live drafts) and must never be uploaded from the browser to the server.
 *
 * localStorage is origin-scoped: the future cutover runbook must deploy this exporter
 * on every legacy origin and inventory every known device/browser before cutover.
 */

export const MIGRATION_BUNDLE_KIND = 'gones.private-migration-bundle';
export const MIGRATION_BUNDLE_FORMAT_VERSION = 1;
export const MIGRATION_BUNDLE_SOURCE_INSTANCE_KEY = 'gones.migration.source-instance.v1';

/** Every legacy browser store read into the bundle. Auth and language are deliberately excluded. */
export const LEGACY_STORE_KEYS = [
  'gones.frontend.backend.v1',
  'gones.live-tournaments.v1',
  'gones.settings',
  'gones.settings.language',
  'gones.settings.deckArchetypes'
] as const;

export type LegacyStoreKey = (typeof LEGACY_STORE_KEYS)[number];

export interface MigrationBundleCounts {
  leagues: number;
  tournaments: number;
  calendarEvents: number;
  liveTournaments: number;
  deckArchetypes: number;
}

export interface MigrationBundle {
  kind: typeof MIGRATION_BUNDLE_KIND;
  bundleFormatVersion: typeof MIGRATION_BUNDLE_FORMAT_VERSION;
  gonesDataVersion: number;
  gonesAppVersion: string;
  exportedAt: string;
  sourceInstanceId: string;
  storeHashes: Record<LegacyStoreKey, string | null>;
  storeErrors: LegacyStoreKey[];
  counts: MigrationBundleCounts;
  leagues: LeagueDocument[];
  calendarEvents: CalendarEventDocument[];
  liveTournaments: LiveTournamentDocument[];
  deckArchetypes: string[];
  bundleChecksum: string;
}

/** Stable per-browser (per-origin) instance id, created once and persisted in storage. */
export function getOrCreateSourceInstanceId(storage: Storage): string {
  const existing = storage.getItem(MIGRATION_BUNDLE_SOURCE_INSTANCE_KEY);
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing;
  const created = globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
  storage.setItem(MIGRATION_BUNDLE_SOURCE_INSTANCE_KEY, created);
  return created;
}

export async function buildMigrationBundle({ storage, now = new Date(), appVersion = '0.1.0' }: { storage: Storage; now?: Date; appVersion?: string }): Promise<MigrationBundle> {
  const raw = {} as Record<LegacyStoreKey, string | null>;
  const storeHashes = {} as Record<LegacyStoreKey, string | null>;
  for (const key of LEGACY_STORE_KEYS) {
    raw[key] = storage.getItem(key);
    storeHashes[key] = raw[key] === null ? null : await sha256Hex(raw[key]!);
  }

  const storeErrors: LegacyStoreKey[] = [];
  const frontend = parseStore(raw['gones.frontend.backend.v1'], 'gones.frontend.backend.v1', storeErrors);
  const live = parseStore(raw['gones.live-tournaments.v1'], 'gones.live-tournaments.v1', storeErrors);
  const settings = parseStore(raw['gones.settings'], 'gones.settings', storeErrors);
  const legacyArchetypes = parseStore(raw['gones.settings.deckArchetypes'], 'gones.settings.deckArchetypes', storeErrors);

  const leagues = asArray(recordField(frontend, 'leagues')).map((league) => normalizeLeague(league as Partial<LeagueDocument>));
  const calendarEvents = normalizeCalendarEvents(asArray(recordField(frontend, 'calendarEvents')));
  const liveTournaments = asArray(recordField(live, 'tournaments')).map((tournament) => normalizeLiveTournament(tournament as Partial<LiveTournamentDocument>));
  // Deck Archetypes come from the settings store; language and auth state are excluded by design.
  const deckArchetypes = uniqueSortedArchetypes([
    ...stringArray(recordField(settings, 'deckArchetypes')),
    ...stringArray(legacyArchetypes)
  ]);

  if (liveTournaments.length > EXPORT_LIMITS.maxLiveTournaments) throw new Error('migrationBundleTooManyLiveTournaments');
  if (deckArchetypes.length > EXPORT_LIMITS.maxDeckArchetypes) throw new Error('migrationBundleTooManyDeckArchetypes');

  const withoutChecksum = {
    kind: MIGRATION_BUNDLE_KIND,
    bundleFormatVersion: MIGRATION_BUNDLE_FORMAT_VERSION,
    gonesDataVersion: 4,
    gonesAppVersion: appVersion,
    exportedAt: now.toISOString(),
    sourceInstanceId: getOrCreateSourceInstanceId(storage),
    storeHashes,
    storeErrors,
    counts: {
      leagues: leagues.length,
      tournaments: leagues.reduce((total, league) => total + league.tournaments.length, 0),
      calendarEvents: calendarEvents.length,
      liveTournaments: liveTournaments.length,
      deckArchetypes: deckArchetypes.length
    },
    leagues,
    calendarEvents,
    liveTournaments,
    deckArchetypes
  } satisfies Omit<MigrationBundle, 'bundleChecksum'>;

  const bundle: MigrationBundle = { ...withoutChecksum, bundleChecksum: await bundleChecksum(withoutChecksum) };
  if (JSON.stringify(bundle).length > EXPORT_LIMITS.maxMigrationBundleBytes) throw new Error('migrationBundleTooLarge');
  return bundle;
}

/** Validates shape and checksum. Rejects malformed/tampered bundles before any use. */
export async function parseMigrationBundle(value: unknown): Promise<MigrationBundle> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('unsupportedMigrationBundle');
  const bundle = value as Record<string, unknown>;
  const shapeValid = bundle['kind'] === MIGRATION_BUNDLE_KIND
    && bundle['bundleFormatVersion'] === MIGRATION_BUNDLE_FORMAT_VERSION
    && typeof bundle['gonesDataVersion'] === 'number'
    && typeof bundle['gonesAppVersion'] === 'string'
    && typeof bundle['exportedAt'] === 'string'
    && typeof bundle['sourceInstanceId'] === 'string'
    && !!bundle['storeHashes'] && typeof bundle['storeHashes'] === 'object'
    && Array.isArray(bundle['storeErrors'])
    && !!bundle['counts'] && typeof bundle['counts'] === 'object'
    && Array.isArray(bundle['leagues'])
    && Array.isArray(bundle['calendarEvents'])
    && Array.isArray(bundle['liveTournaments'])
    && Array.isArray(bundle['deckArchetypes'])
    && typeof bundle['bundleChecksum'] === 'string';
  if (!shapeValid) throw new Error('unsupportedMigrationBundle');
  const { bundleChecksum: declared, ...payload } = bundle;
  if (declared !== await bundleChecksum(payload)) throw new Error('migrationBundleChecksumMismatch');
  return bundle as unknown as MigrationBundle;
}

export function migrationBundleFilename(sourceInstanceId: string, now = new Date()): string {
  return `${now.toISOString().slice(0, 10)} gones-migration-${sourceInstanceId.slice(0, 8)}.private.json`;
}

async function bundleChecksum(payload: object): Promise<string> {
  return `sha256:${await sha256Hex(canonicalJsonStringify(payload))}`;
}

function parseStore(raw: string | null, key: LegacyStoreKey, storeErrors: LegacyStoreKey[]): unknown {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    // Primitive stores parse to non-objects — nothing to bundle from them.
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // gones.settings.language holds a bare language code, not JSON — excluded by design anyway.
    if (key === 'gones.settings.language') return null;
    storeErrors.push(key);
    return null;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordField(store: unknown, field: string): unknown {
  return store && typeof store === 'object' && !Array.isArray(store) ? (store as Record<string, unknown>)[field] : undefined;
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

function uniqueSortedArchetypes(values: string[]): string[] {
  const seen = new Set<string>();
  const archetypes: string[] = [];
  for (const value of values) {
    const archetype = value.trim().replace(/\s+/g, ' ');
    const key = archetype.toLocaleLowerCase();
    if (!archetype || seen.has(key)) continue;
    seen.add(key);
    archetypes.push(archetype);
  }
  return archetypes.sort((left, right) => left.localeCompare(right));
}

function fallbackUuid(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}
