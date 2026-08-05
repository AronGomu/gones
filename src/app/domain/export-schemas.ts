/**
 * Versioned contracts for Gones export artifacts (data versions 1–4).
 *
 * v4 public exports are allowlist-only: League/Result source documents plus public
 * Scheduled (calendar) fields. Everything account-, delivery- or Live-draft-related is
 * on an explicit denylist and must never appear in a public artifact.
 */

export type SupportedExportVersion = 1 | 2 | 3 | 4;

/** Public League source fields allowed in v4 exports. */
export const PUBLIC_EXPORT_V4_LEAGUE_FIELDS = ['id', 'name', 'status', 'tournaments'] as const;

/** Public Scheduled (calendar event) fields allowed in v4 exports. */
export const PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS = [
  'id', 'slug', 'title', 'eventDate', 'startTime', 'endTime', 'location', 'country', 'city', 'address', 'description', 'richDescriptionHtml', 'externalLink'
] as const;

/** Field names that must never appear anywhere in a public export artifact. */
export const PUBLIC_EXPORT_DENYLIST_FIELDS: readonly string[] = [
  'email', 'emails', 'users', 'user', 'userId', 'username', 'password', 'passwordHash', 'token', 'tokens',
  'refreshToken', 'accessToken', 'memberships', 'registrations', 'blocks', 'audit', 'auditLog', 'outbox',
  'history', 'liveTournaments', 'liveDrafts', 'sessions', 'phone', 'secret', 'apiKey', 'authorization'
];

/** Shared maximum sizes and counts for export/import artifacts. */
export const EXPORT_LIMITS = {
  /** Browser import file cap (public League/Full exports). */
  maxImportFileBytes: 2 * 1024 * 1024,
  /** Maximum Leagues accepted in one fullData artifact. */
  maxFullDataLeagues: 100,
  /** Maximum Scheduled calendar events in one fullData artifact. */
  maxCalendarEvents: 500,
  /** Private migration bundle serialized size cap. */
  maxMigrationBundleBytes: 16 * 1024 * 1024,
  /** Maximum Live drafts in one private migration bundle. */
  maxLiveTournaments: 200,
  /** Maximum Deck Archetypes in one private migration bundle. */
  maxDeckArchetypes: 2000
} as const;

interface ExportJsonSchema {
  $id: string;
  type: 'object';
  additionalProperties: boolean;
  required: readonly string[];
  properties: Record<string, unknown>;
}

const versionConst = (version: number) => ({ const: version });

function kindTaggedSchema(version: SupportedExportVersion, extra: Record<string, unknown>, { closed = false, required = [] as readonly string[] } = {}): ExportJsonSchema {
  return {
    $id: `https://gones.app/schemas/export-v${version}.json`,
    type: 'object',
    additionalProperties: !closed,
    required: ['kind', 'gonesDataVersion', ...required],
    properties: {
      kind: { enum: ['league', 'fullData'] },
      gonesDataVersion: versionConst(version),
      gonesAppVersion: { type: 'string' },
      exportedAt: { type: 'string' },
      ...extra
    }
  };
}

const leagueSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...PUBLIC_EXPORT_V4_LEAGUE_FIELDS],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    status: { enum: ['active', 'completed'] },
    tournaments: { type: 'array' }
  }
} as const;

const calendarEventSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS],
  properties: Object.fromEntries(PUBLIC_EXPORT_V4_CALENDAR_EVENT_FIELDS.map((field) => [field, { type: 'string' }]))
} as const;

/**
 * JSON Schemas for every supported export data version.
 * v1–v3 stay permissive (`additionalProperties: true`) because historical files carry
 * shape drift; v4 is closed and only the public allowlist may appear.
 */
export const EXPORT_JSON_SCHEMAS: Record<SupportedExportVersion, ExportJsonSchema> = {
  1: kindTaggedSchema(1, { league: { type: 'object' }, version: versionConst(1) }),
  2: kindTaggedSchema(2, { league: { type: 'object' }, leagues: { type: 'array' } }),
  3: kindTaggedSchema(3, { league: { type: 'object' }, leagues: { type: 'array' }, calendarEvents: { type: 'array' } }),
  4: kindTaggedSchema(4, {
    league: leagueSchema,
    leagues: { type: 'array', maxItems: EXPORT_LIMITS.maxFullDataLeagues, items: leagueSchema },
    calendarEvents: { type: 'array', maxItems: EXPORT_LIMITS.maxCalendarEvents, items: calendarEventSchema },
    checksum: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' }
  }, { closed: true })
};

/** Deep-scan an export payload; throws `deniedExportField:<name>` on the first denylisted key. */
export function assertNoDeniedFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoDeniedFields(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PUBLIC_EXPORT_DENYLIST_FIELDS.includes(key)) throw new Error(`deniedExportField:${key}`);
    assertNoDeniedFields(nested);
  }
}

/** Deterministic JSON with recursively sorted object keys, for stable checksums. */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortKeysDeep(item));
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(entries.map(([key, nested]) => [key, sortKeysDeep(nested)]));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const CHECKSUM_PREFIX = 'sha256:';

async function payloadChecksum(payload: Record<string, unknown>): Promise<string> {
  const { checksum: _ignored, ...rest } = payload;
  return `${CHECKSUM_PREFIX}${await sha256Hex(canonicalJsonStringify(rest))}`;
}

/** Adds a `checksum` covering the canonical JSON of the artifact (checksum field excluded). */
export async function attachExportChecksum<T extends object>(file: T): Promise<T & { checksum: string }> {
  return { ...file, checksum: await payloadChecksum(file as Record<string, unknown>) };
}

/**
 * True when the artifact has no checksum (legacy v1–v3 files) or its checksum matches.
 * Callers must reject the file before any mutation when this returns false.
 */
export async function verifyExportChecksum(file: unknown): Promise<boolean> {
  if (!file || typeof file !== 'object') return false;
  const payload = file as Record<string, unknown>;
  if (payload['checksum'] === undefined) return true;
  return typeof payload['checksum'] === 'string' && payload['checksum'] === await payloadChecksum(payload);
}
