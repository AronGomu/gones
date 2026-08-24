#!/usr/bin/env node
/**
 * Bulk-inserts the five largest slices of the `stress` environment straight into the local Compose
 * Postgres: Events, registrations, the three-tier archive (`archive_leagues`,
 * `archive_league_seasons`, `archive_tournaments`), the legacy League reference rows and audit rows
 * (T29, round 2 Q6).
 *
 * **Test-only, and unreachable from any release artifact.** `fixtures/` is in no image, nothing under
 * `deploy/` or `backend/` imports this file, and the guard below refuses to run against anything but
 * the local Compose stack reached over a Unix Docker socket. Accounts, organizations and formats still
 * go through the real HTTP API, and running tournaments are still replayed command by command — this
 * path exists because thousands of Events and hundreds of League Archives through the API would take
 * hours, not because the API path is wrong.
 *
 * What this bypasses, and what the seeder does about it:
 * - the domain, so every row here must already be the shape a real write would produce. A League
 *   document whose Archive Tournament claims another League is refused on read and would take the
 *   startup rebuild with it; `validateEnvironment` and the generator both enforce the match, and
 *   `scripts/seed-dev-environment.mjs` reads a sample back through the API afterwards.
 * - the `player_statistics` write-side rebuild (T22, ADR 0040), which only runs inside an archive write
 *   transaction. The seeder triggers the startup rebuild explicitly once this returns.
 * - the archive tables' denormalized counters. `tournament_count`, `player_count` and the Season date
 *   bounds are columns the domain would have computed inside the write; here they are written by hand,
 *   which is why `countArchiveTournamentPlayers` mirrors the Swiss standings rule byte for byte. A
 *   count that disagreed with the document would print a wrong number on every catalog row.
 * - the notification outbox and the Event lifecycle log, which a bulk Event carries none of. Reminder
 *   mails for the generated Events therefore do not exist; nothing in this environment tests them.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { countArchiveSeasonPlayers, countArchiveTournamentPlayers, expectedEventSlug, isLocalDockerEndpoint, localDateTime } from './dev-environments.mjs';

/** One statement per chunk of rows: a single multi-megabyte INSERT is slower to parse than ten. */
const CHUNK_SIZE = 500;
/**
 * League rows are whole archive documents — hundreds of kilobytes each, where every other row here is a
 * few hundred bytes — so they chunk on their own count. Five hundred of them in one statement would be
 * the entire archive in a single INSERT.
 */
const LEAGUE_CHUNK_SIZE = 20;
/** A Tournament row carries a whole document; twenty per statement, like the legacy League rows. */
const TOURNAMENT_CHUNK_SIZE = 20;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function dockerOutput(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) fail(`Bulk load refused: could not ask Docker where it points (${String(result.stderr || result.error || 'docker failed').trim()}).`);
  return result.stdout.trim();
}

/**
 * The one target this script accepts is the `postgres` service of the local Compose project, reached
 * over a local Unix Docker socket. Everything here writes rows the domain never validated, so pointing
 * it anywhere else — a remote context, a staging host — has to be impossible rather than discouraged.
 */
export function requireLocalComposePostgres() {
  const context = String(process.env.DOCKER_CONTEXT ?? '').trim();
  const endpoint = context
    ? dockerOutput(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}'])
    : String(process.env.DOCKER_HOST ?? '').trim() || dockerOutput(['context', 'inspect', dockerOutput(['context', 'show']), '--format', '{{.Endpoints.docker.Host}}']);

  if (!isLocalDockerEndpoint(endpoint)) {
    fail(`Bulk load refused: Docker points at "${endpoint}", and this script writes unvalidated rows that may only ever reach a local Compose database.`);
  }
  const container = dockerOutput(['compose', 'ps', '--quiet', 'postgres']);
  if (container === '') {
    fail('Bulk load refused: the local Compose "postgres" service is not running. Start the stack first (docker compose up -d postgres).');
  }
  return { endpoint, container };
}

/** Single quotes are the only SQL metacharacter reachable from a generated string. */
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const nullable = (value) => (value === null || value === undefined ? 'NULL' : literal(value));
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;

function psql(sql, { capture = false } = {}) {
  const result = spawnSync('docker', [
    'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones',
    '-v', 'ON_ERROR_STOP=1', ...(capture ? ['-tA'] : []), '-f', '-'
  ], { encoding: 'utf8', input: sql, stdio: ['pipe', capture ? 'pipe' : 'inherit', 'inherit'] });
  if (result.status !== 0) {
    console.error('Bulk load failed: psql refused the generated SQL.');
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? '';
}

/** `INSERT INTO table (columns) VALUES ...;` in chunks, as one SQL script. */
function insertStatements(table, columns, rows, chunkSize = CHUNK_SIZE) {
  const statements = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    statements.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${chunk.map((row) => `  (${row.join(', ')})`).join(',\n')};`);
  }
  return statements;
}

/**
 * `YYYY-MM-DDTHH:mm` in an IANA zone as a UTC instant. Two passes because the offset depends on the
 * instant being resolved: the first pass guesses with the zone's offset at the naive timestamp, the
 * second corrects it across a DST boundary.
 */
function zonedLocalToUtc(localIso, timeZoneId) {
  const naive = new Date(`${localIso}:00Z`);
  const offsetAt = (instant) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: timeZoneId, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(instant).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)) - instant.getTime();
  };
  const first = new Date(naive.getTime() - offsetAt(naive));
  return new Date(naive.getTime() - offsetAt(first));
}

/** The search column the server derives from an Event's own fields, byte for byte (`Event.BuildSearchText`). */
function searchText(event) {
  return [event.title, event.summary, event.city, event.country]
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    .map((value) => String(value).trim())
    .join(' ')
    .normalize('NFKC')
    .toUpperCase()
    .slice(0, 600);
}

/**
 * The stored `document` jsonb, byte-compatible with what the server writes: camelCase keys, and
 * `seasonId` OMITTED when null so `document ->> 'seasonId' IS NOT DISTINCT FROM season_id` holds.
 *
 * The server's JSON options set `DefaultIgnoreCondition = WhenWritingNull`, so a standalone Tournament
 * simply has no `seasonId` key and `->>` on an absent key yields SQL NULL. Writing `"seasonId": null`
 * instead would be a JSON null, which is distinct from SQL NULL, and
 * `ck_archive_tournament_document_metadata` would refuse the row.
 */
function archiveTournamentDocument(tournament) {
  const document = {
    id: tournament.id,
    name: tournament.name,
    tournamentDate: tournament.tournamentDate,
    status: tournament.status,
    rounds: tournament.rounds,
    playerArchetypes: tournament.playerArchetypes
  };
  return tournament.seasonId === null || tournament.seasonId === undefined
    ? document
    : { ...document, seasonId: tournament.seasonId };
}

/** email -> user id, for every account the API already registered. One query, not one per row. */
export function readUserIds() {
  const rows = psql('SELECT lower(normalized_email), id FROM asp_net_users;', { capture: true });
  return new Map(rows.split('\n').filter(Boolean).map((line) => {
    const [email, id] = line.split('|');
    return [email, id];
  }));
}

/**
 * Writes Events (with their single format), registrations, the three-tier archive, the legacy League
 * reference rows and audit rows in one psql run. Returns the ids the caller needs afterwards: Events by
 * fixture key, and every archive row by document id — which for a bulk-inserted row is the fixture id
 * itself, because nothing minted a new one, unlike the HTTP restore path.
 */
export function bulkLoadStress({ environment, auditRecords, organizationIds, formatIds, formatSlugs, now = new Date() }) {
  requireLocalComposePostgres();
  const userIds = readUserIds();
  const nowIso = now.toISOString();
  const requireUser = (email) => {
    const id = userIds.get(String(email).toLowerCase());
    if (id === undefined) fail(`Bulk load refused: ${email} was never registered, so its rows would dangle.`);
    return id;
  };

  const eventIds = new Map();
  const eventRows = [];
  const eventFormatRows = [];
  for (const event of environment.tournaments) {
    const id = randomUUID();
    const slug = expectedEventSlug(event.title, formatSlugs.get(event.formatKeys[0]));
    const startsLocal = localDateTime(event.startsAtLocalOffsetDays, event.startsAtLocalTime, now);
    const endsLocal = localDateTime(event.endsAtLocalOffsetDays, event.endsAtLocalTime, now);
    eventIds.set(event.key, { id, slug });
    eventRows.push([
      literal(id),
      literal(organizationIds.get(event.organizationKey)),
      literal(event.title),
      literal(slug),
      nullable(event.summary),
      nullable(event.bodyHtml),
      literal(event.streetAddress),
      nullable(event.postalCode),
      literal(event.city),
      literal(event.country),
      literal(event.timeZoneId),
      literal(startsLocal.slice(0, 10)),
      literal(`${startsLocal.slice(11)}:00`),
      literal(endsLocal.slice(0, 10)),
      literal(`${endsLocal.slice(11)}:00`),
      literal(zonedLocalToUtc(startsLocal, event.timeZoneId).toISOString()),
      literal(zonedLocalToUtc(endsLocal, event.timeZoneId).toISOString()),
      event.capacity === null || event.capacity === undefined ? 'NULL' : String(event.capacity),
      literal('Published'),
      literal(requireUser(event.organizerEmail)),
      literal(nowIso),
      literal(nowIso),
      literal(searchText(event)),
      '1'
    ]);
    eventFormatRows.push([literal(id), literal(formatIds.get(event.formatKeys[0]))]);
  }

  const registrationRows = environment.registrations.map(({ tournamentKey, userEmail }) => {
    const userId = requireUser(userEmail);
    return [
      literal(randomUUID()),
      literal(eventIds.get(tournamentKey).id),
      literal(userId),
      literal('Confirmed'),
      literal(userId),
      literal(nowIso),
      'NULL',
      'NULL',
      '1'
    ];
  });

  const leagueRows = environment.leagues.map((league) => [
    literal(randomUUID()),
    literal(league.id),
    literal(league.name),
    literal(league.status),
    literal(nowIso),
    'NULL',
    json(league),
    '1'
  ]);

  // The catalog reads order by `updated_at DESC, document_id ASC`, and a bulk load that stamped one
  // identical instant on two thousand rows would collapse that ordering onto the ID and hide every
  // ordering bug this environment exists to surface. 61 seconds per row is a synthetic,
  // seed-independent, strictly descending spread. Only `tournament_date` is history; `updated_at` is
  // always measured from the seeding clock, because the year-partitioned catalog's ETag is a stamp over
  // `max(updated_at)` and a backdated write would make a stale partition servable.
  const writtenAt = (index) => literal(new Date(now.getTime() - index * 61_000).toISOString());

  const archiveLeagueRows = environment.archiveLeagues.map((league, index) => [
    literal(league.id),
    literal(league.name),
    literal(league.createdAt),
    writtenAt(index),
    '1',
    'NULL'
  ]);

  const tournamentsBySeason = new Map();
  for (const tournament of environment.archiveTournaments) {
    if (tournament.seasonId === null || tournament.seasonId === undefined) continue;
    const grouped = tournamentsBySeason.get(tournament.seasonId) ?? [];
    grouped.push(tournament);
    tournamentsBySeason.set(tournament.seasonId, grouped);
  }

  const archiveSeasonRows = environment.archiveLeagueSeasons.map((season, index) => {
    const played = tournamentsBySeason.get(season.id) ?? [];
    const dates = played.map((tournament) => tournament.tournamentDate).sort();
    return [
      literal(season.id),
      literal(season.leagueId),
      literal(season.name),
      literal(season.status),
      writtenAt(index),
      '1',
      'NULL',
      String(played.length),
      String(countArchiveSeasonPlayers(played)),
      nullable(dates[0] ?? null),
      nullable(dates[dates.length - 1] ?? null),
      '1'
    ];
  });

  const archiveTournamentRows = environment.archiveTournaments.map((tournament, index) => [
    literal(tournament.id),
    nullable(tournament.seasonId),
    literal(tournament.name),
    literal(tournament.tournamentDate),
    literal(tournament.status),
    json(archiveTournamentDocument(tournament)),
    writtenAt(index),
    '1',
    'NULL',
    String(countArchiveTournamentPlayers(tournament)),
    '1'
  ]);

  const auditRows = (auditRecords ?? []).map((record) => [
    literal(randomUUID()),
    record.actorEmail === null ? 'NULL' : literal(requireUser(record.actorEmail)),
    literal(record.action),
    literal(record.entityType),
    literal(record.entityId),
    json(record.redactedDiff),
    literal(new Date(now.getTime() + record.occurredAtOffsetMinutes * 60000).toISOString()),
    '1'
  ]);

  const script = [
    'BEGIN;',
    ...insertStatements('events', [
      'id', 'organization_id', 'title', 'slug', 'summary', 'body_html', 'street_address', 'postal_code',
      'city', 'country', 'time_zone_id', 'venue_start_date', 'venue_start_time', 'venue_end_date',
      'venue_end_time', 'starts_at_utc', 'ends_at_utc', 'capacity', 'status', 'created_by_user_id',
      'created_at', 'updated_at', 'normalized_search_text', 'version'
    ], eventRows),
    ...insertStatements('event_formats', ['event_id', 'tournament_format_id'], eventFormatRows),
    ...insertStatements('event_registration_attempts', [
      'id', 'event_id', 'user_id', 'status', 'registered_by_user_id', 'registered_at',
      'status_changed_by_user_id', 'status_changed_at', 'version'
    ], registrationRows),
    ...insertStatements('league_archive_aggregates', [
      'id', 'document_id', 'name', 'status', 'updated_at', 'deleted_at', 'canonical_document', 'version'
    ], leagueRows, LEAGUE_CHUNK_SIZE),
    // Leagues, then Seasons, then Tournaments: the foreign keys are checked immediately, not deferred.
    ...insertStatements('archive_leagues', [
      'document_id', 'name', 'created_at', 'updated_at', 'version', 'deleted_at'
    ], archiveLeagueRows),
    ...insertStatements('archive_league_seasons', [
      'document_id', 'league_id', 'name', 'status', 'updated_at', 'version', 'deleted_at',
      'tournament_count', 'player_count', 'first_tournament_date', 'last_tournament_date', 'counts_version'
    ], archiveSeasonRows),
    ...insertStatements('archive_tournaments', [
      'document_id', 'season_id', 'name', 'tournament_date', 'status', 'document', 'updated_at',
      'version', 'deleted_at', 'player_count', 'counts_version'
    ], archiveTournamentRows, TOURNAMENT_CHUNK_SIZE),
    ...insertStatements('audit_records', [
      'id', 'actor_id', 'action', 'entity_type', 'entity_id', 'redacted_diff', 'occurred_at', 'version'
    ], auditRows),
    'COMMIT;'
  ].join('\n');

  psql(script);

  return {
    eventIds,
    leagueIds: new Map(environment.leagues.map((league) => [league.id, league.id])),
    archiveIds: {
      leagues: new Map(environment.archiveLeagues.map((league) => [league.id, league.id])),
      leagueSeasons: new Map(environment.archiveLeagueSeasons.map((season) => [season.id, season.id])),
      tournaments: new Map(environment.archiveTournaments.map((tournament) => [tournament.id, tournament.id]))
    },
    counts: {
      events: eventRows.length,
      registrations: registrationRows.length,
      leagues: leagueRows.length,
      archiveLeagues: archiveLeagueRows.length,
      archiveLeagueSeasons: archiveSeasonRows.length,
      archiveTournaments: archiveTournamentRows.length,
      auditRecords: auditRows.length
    }
  };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { endpoint } = requireLocalComposePostgres();
  console.log(`Local Compose Postgres reachable over ${endpoint}. This module is loaded by scripts/seed-dev-environment.mjs; it seeds nothing on its own.`);
}
