/**
 * Versioned contract for the Gones Archive export bundle, data version 5.
 *
 * Four flat collections, no nesting: `leagues`, `leagueSeasons`, `tournaments`,
 * `calendarEvents`. A Tournament is a top-level row and may stand alone (`seasonId: null`).
 *
 * ADR 0022 froze the v1–v4 wire names to keep the legacy import door open. That door is closed
 * here on purpose: Gones is unreleased, no user holds a bundle, and there is no converter.
 * A v1–v4 artifact is refused with `legacyArchiveBundleVersion`.
 */
import { ARCHIVE_DATA_VERSION, SUPPORTED_ARCHIVE_IMPORT_VERSIONS } from './archive-models';
import type {
  ArchiveBundle, ArchiveLeagueDocument, ArchiveTournamentDocument,
  CalendarEventDocument, LeagueSeasonDocument, LeagueStatus,
  PlayerArchetypeDocument, RoundDocument
} from './archive-models';
import { assertNoDeniedFields, canonicalJsonStringify, EXPORT_LIMITS, sha256Hex } from './export-schemas';

/**
 * Re-exported so the serialization boundary has exactly one import site.
 *
 * `version: 5` in an export **file** is not the same schema as `version: 5` in a restore
 * **request body**. The body `scripts/dev-environments.mjs` posts to `/api/archive/restore-full` is
 * `{ kind: 'fullArchive', version: 5, leagues, leagueSeasons, tournaments }` — it carries `kind` and
 * no `calendarEvents`. The two are reconciled by conversion, never by being interchangeable.
 */
export { ARCHIVE_DATA_VERSION, SUPPORTED_ARCHIVE_IMPORT_VERSIONS } from './archive-models';
export type { ArchiveBundle } from './archive-models';

export type SupportedArchiveImportVersion = (typeof SUPPORTED_ARCHIVE_IMPORT_VERSIONS)[number];

/** The on-disk artifact: an `ArchiveBundle` plus the optional integrity checksum. */
export interface ArchiveExportFile extends ArchiveBundle {
  checksum?: string;
}

export const ARCHIVE_EXPORT_LIMITS = {
  /** Same browser constraint as the v1–v4 path; the file cap is the real defence. */
  maxImportFileBytes: EXPORT_LIMITS.maxImportFileBytes,
  maxLeagues: 100,
  /** A LeagueSeason is what v4 called a League, so it keeps v4's `maxFullDataLeagues` ceiling. */
  maxLeagueSeasons: EXPORT_LIMITS.maxFullDataLeagues,
  maxTournaments: 2000,
  maxCalendarEvents: EXPORT_LIMITS.maxCalendarEvents
} as const;

export const ARCHIVE_EXPORT_V5_LEAGUE_FIELDS = ['id', 'name', 'createdAt'] as const;
export const ARCHIVE_EXPORT_V5_LEAGUE_SEASON_FIELDS = ['id', 'name', 'leagueId', 'status'] as const;
export const ARCHIVE_EXPORT_V5_TOURNAMENT_FIELDS = ['id', 'name', 'seasonId', 'tournamentDate', 'status', 'rounds', 'playerArchetypes'] as const;
export const ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS = [
  'id', 'slug', 'title', 'eventDate', 'startTime', 'endTime', 'location', 'country', 'city', 'address', 'description', 'richDescriptionHtml', 'externalLink'
] as const;

const stringFields = (fields: readonly string[]) =>
  Object.fromEntries(fields.map((field) => [field, { type: 'string' }]));

const archiveLeagueSchema = {
  type: 'object', additionalProperties: false,
  required: [...ARCHIVE_EXPORT_V5_LEAGUE_FIELDS],
  properties: stringFields(ARCHIVE_EXPORT_V5_LEAGUE_FIELDS)
} as const;

const leagueSeasonSchema = {
  type: 'object', additionalProperties: false,
  required: [...ARCHIVE_EXPORT_V5_LEAGUE_SEASON_FIELDS],
  properties: { id: { type: 'string' }, name: { type: 'string' }, leagueId: { type: 'string' }, status: { enum: ['active', 'completed'] } }
} as const;

const archiveTournamentSchema = {
  type: 'object', additionalProperties: false,
  required: [...ARCHIVE_EXPORT_V5_TOURNAMENT_FIELDS],
  properties: {
    id: { type: 'string' }, name: { type: 'string' },
    seasonId: { type: ['string', 'null'] },
    tournamentDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    status: { enum: ['active', 'completed'] },
    rounds: { type: 'array' }, playerArchetypes: { type: 'array' }
  }
} as const;

const calendarEventSchema = {
  type: 'object', additionalProperties: false,
  required: [...ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS],
  properties: stringFields(ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS)
} as const;

/**
 * The published contract. `parseArchiveBundle` is the hand-rolled enforcer — the repository
 * carries no JSON Schema validator, exactly as `EXPORT_JSON_SCHEMAS` works for v1–v4.
 */
export const ARCHIVE_EXPORT_JSON_SCHEMA = {
  $id: 'https://gones.app/schemas/archive-export-v5.json',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'leagues', 'leagueSeasons', 'tournaments', 'calendarEvents'],
  properties: {
    version: { const: ARCHIVE_DATA_VERSION },
    checksum: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
    leagues: { type: 'array', maxItems: ARCHIVE_EXPORT_LIMITS.maxLeagues, items: archiveLeagueSchema },
    leagueSeasons: { type: 'array', maxItems: ARCHIVE_EXPORT_LIMITS.maxLeagueSeasons, items: leagueSeasonSchema },
    tournaments: { type: 'array', maxItems: ARCHIVE_EXPORT_LIMITS.maxTournaments, items: archiveTournamentSchema },
    calendarEvents: { type: 'array', maxItems: ARCHIVE_EXPORT_LIMITS.maxCalendarEvents, items: calendarEventSchema }
  }
} as const;

const byId = <T extends { id: string }>(left: T, right: T) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export function buildArchiveBundle(source: {
  leagues: readonly ArchiveLeagueDocument[];
  leagueSeasons: readonly LeagueSeasonDocument[];
  tournaments: readonly ArchiveTournamentDocument[];
  calendarEvents?: readonly CalendarEventDocument[];
}): ArchiveBundle {
  return {
    version: ARCHIVE_DATA_VERSION,
    // Field-by-field picks, never a spread: a Persisted* input must not leak
    // `documentVersion`, `updatedAt` or `eTag` into a public artifact.
    leagues: [...source.leagues]
      .map((league) => ({ id: league.id, name: league.name, createdAt: league.createdAt }))
      .sort(byId),
    leagueSeasons: [...source.leagueSeasons]
      .map((season) => ({ id: season.id, name: season.name, leagueId: season.leagueId, status: season.status }))
      .sort(byId),
    tournaments: [...source.tournaments]
      .map((tournament) => ({
        id: tournament.id,
        name: tournament.name,
        seasonId: tournament.seasonId,
        tournamentDate: tournament.tournamentDate,
        status: tournament.status,
        rounds: structuredClone(tournament.rounds) as RoundDocument[],
        playerArchetypes: structuredClone(tournament.playerArchetypes) as PlayerArchetypeDocument[]
      }))
      .sort(byId),
    calendarEvents: [...(source.calendarEvents ?? [])]
      .map((event) => Object.fromEntries(ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS.map((field) => [field, event[field]])) as unknown as CalendarEventDocument)
      .sort(byId)
  };
}

export function archiveBundleFilename(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 10)} Gones Archive.json`;
}

const CHECKSUM_PREFIX = 'sha256:';

async function archiveChecksum(payload: Record<string, unknown>): Promise<string> {
  const { checksum: _ignored, ...rest } = payload;
  return `${CHECKSUM_PREFIX}${await sha256Hex(canonicalJsonStringify(rest))}`;
}

export async function attachArchiveChecksum(bundle: ArchiveBundle): Promise<ArchiveExportFile> {
  return { ...bundle, checksum: await archiveChecksum(bundle as unknown as Record<string, unknown>) };
}

/** True when the artifact carries no checksum (contract section 11 prints none) or it matches. */
export async function verifyArchiveChecksum(file: unknown): Promise<boolean> {
  if (!file || typeof file !== 'object') return false;
  const payload = file as Record<string, unknown>;
  if (payload['checksum'] === undefined) return true;
  return typeof payload['checksum'] === 'string' && payload['checksum'] === await archiveChecksum(payload);
}

/**
 * The three historical shapes of a v1–v4 Gones Export, per `export-restore.ts:57-77`:
 * the `kind`-tagged artifact, the pre-Angular `{ version: 1, league }` file, and a bare
 * numeric `version` of 1 to 4.
 */
export function isLegacyGonesExport(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  if (payload['kind'] === 'league' || payload['kind'] === 'fullData') return true;
  if (payload['version'] === 1 && payload['league'] !== undefined) return true;
  const version = payload['version'];
  return typeof version === 'number' && version >= 1 && version <= 4;
}

export function assertSupportedArchiveBundleVersion(value: unknown): void {
  // Legacy detection runs first: a `kind` tag proves a legacy artifact even if it claims v5.
  if (isLegacyGonesExport(value)) throw new Error('legacyArchiveBundleVersion');
  if (!value || typeof value !== 'object') throw new Error('unsupportedArchiveBundle');
  const version = (value as Record<string, unknown>)['version'];
  if (!SUPPORTED_ARCHIVE_IMPORT_VERSIONS.some((supported) => supported === version)) {
    throw new Error('unsupportedArchiveBundle');
  }
}

const ACCEPTED_TOP_LEVEL_KEYS = ['version', 'checksum', 'leagues', 'leagueSeasons', 'tournaments', 'calendarEvents'];
const ACCEPTED_STATUSES: readonly string[] = ['active', 'completed'];
const ACCEPTED_ENTRY_KINDS: readonly string[] = ['match', 'bye', 'invalid'];

function reject(): never {
  throw new Error('unsupportedArchiveBundle');
}

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, fields: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) reject();
}

function text(value: unknown): string {
  if (typeof value !== 'string') reject();
  return value;
}

function status(value: unknown): LeagueStatus {
  if (typeof value !== 'string' || !ACCEPTED_STATUSES.includes(value)) reject();
  return value as LeagueStatus;
}

function collection(value: unknown, cap: number): unknown[] {
  if (!Array.isArray(value)) reject();
  if (value.length > cap) throw new Error('gonesImportTooManyRecords');
  return value;
}

/** Depth is deliberate: shape only. Field-level entry rules belong to the domain normalizer. */
function rounds(value: unknown): RoundDocument[] {
  if (!Array.isArray(value)) reject();
  for (const round of value) {
    const parsed = row(round);
    text(parsed['id']);
    if (!Array.isArray(parsed['entries'])) reject();
    for (const entry of parsed['entries'] as unknown[]) {
      const parsedEntry = row(entry);
      if (typeof parsedEntry['kind'] !== 'string' || !ACCEPTED_ENTRY_KINDS.includes(parsedEntry['kind'])) reject();
      text(parsedEntry['id']);
    }
  }
  return structuredClone(value) as RoundDocument[];
}

function playerArchetypes(value: unknown): PlayerArchetypeDocument[] {
  if (!Array.isArray(value)) reject();
  for (const archetype of value) {
    const parsed = row(archetype);
    requireExactKeys(parsed, ['playerName', 'archetype']);
    text(parsed['playerName']);
    text(parsed['archetype']);
  }
  return structuredClone(value) as PlayerArchetypeDocument[];
}

/**
 * Strict and non-coercing: a row either matches or the file is refused. Ids and values pass
 * through verbatim, so `buildArchiveBundle` → serialize → `parseArchiveBundle` is an identity.
 *
 * This refuses the `/api/archive/restore-full` request body on purpose, even though that body also
 * says `version: 5`: it carries `kind: 'fullArchive'` and no `calendarEvents`, and an export file a
 * user keeps on disk is validated against a closed schema, not against whatever the wire accepts.
 */
export function parseArchiveBundle(value: unknown): ArchiveBundle {
  assertSupportedArchiveBundleVersion(value);
  const payload = row(value);
  if (Object.keys(payload).some((key) => !ACCEPTED_TOP_LEVEL_KEYS.includes(key))) reject();
  assertNoDeniedFields(payload);

  const leagues = collection(payload['leagues'], ARCHIVE_EXPORT_LIMITS.maxLeagues).map((entry) => {
    const parsed = row(entry);
    requireExactKeys(parsed, ARCHIVE_EXPORT_V5_LEAGUE_FIELDS);
    return { id: text(parsed['id']), name: text(parsed['name']), createdAt: text(parsed['createdAt']) };
  });

  const leagueSeasons = collection(payload['leagueSeasons'], ARCHIVE_EXPORT_LIMITS.maxLeagueSeasons).map((entry) => {
    const parsed = row(entry);
    requireExactKeys(parsed, ARCHIVE_EXPORT_V5_LEAGUE_SEASON_FIELDS);
    return { id: text(parsed['id']), name: text(parsed['name']), leagueId: text(parsed['leagueId']), status: status(parsed['status']) };
  });

  const tournaments = collection(payload['tournaments'], ARCHIVE_EXPORT_LIMITS.maxTournaments).map((entry) => {
    const parsed = row(entry);
    requireExactKeys(parsed, ARCHIVE_EXPORT_V5_TOURNAMENT_FIELDS);
    const seasonId = parsed['seasonId'];
    // `null` is first-class and means standalone; `undefined` is a malformed row.
    if (seasonId !== null && typeof seasonId !== 'string') reject();
    return {
      id: text(parsed['id']),
      name: text(parsed['name']),
      seasonId: seasonId as string | null,
      tournamentDate: text(parsed['tournamentDate']),
      status: status(parsed['status']),
      rounds: rounds(parsed['rounds']),
      playerArchetypes: playerArchetypes(parsed['playerArchetypes'])
    };
  });

  // Mirrors the server restore's refusal: a bundle link must resolve inside the bundle
  // (ArchiveTournamentCommandEndpoints rejects the same input with a 400).
  const leagueIdSet = new Set(leagues.map((league) => league.id));
  for (const season of leagueSeasons) {
    if (!leagueIdSet.has(season.leagueId)) throw new Error('unresolvedArchiveBundleLink:leagueSeasons');
  }
  const seasonIdSet = new Set(leagueSeasons.map((season) => season.id));
  for (const tournament of tournaments) {
    if (tournament.seasonId !== null && !seasonIdSet.has(tournament.seasonId)) throw new Error('unresolvedArchiveBundleLink:tournaments');
  }

  const calendarEvents = collection(payload['calendarEvents'], ARCHIVE_EXPORT_LIMITS.maxCalendarEvents).map((entry) => {
    const parsed = row(entry);
    requireExactKeys(parsed, ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS);
    return Object.fromEntries(ARCHIVE_EXPORT_V5_CALENDAR_EVENT_FIELDS.map((field) => [field, text(parsed[field])])) as unknown as CalendarEventDocument;
  });

  return { version: ARCHIVE_DATA_VERSION, leagues, leagueSeasons, tournaments, calendarEvents };
}
