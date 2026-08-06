/**
 * C38 migration CLI runtime smoke, extended for the C43 release rehearsal.
 *
 * Proves the dry-run-first contract against the running compose stack:
 *   1. a dry run over a multi-source bundle set reports the batch and writes nothing,
 *   2. an import without an accepted report hash is refused,
 *   3. a fault injected mid-import leaves zero partial rows,
 *   4. the accepted import commits every store in one transaction,
 *   5. a rerun returns the stored batch result without duplicating rows,
 *   6. a changed bundle invalidates the accepted report hash.
 *
 * The bundle checksums are computed here in TypeScript-equivalent JavaScript (the same canonical
 * JSON the browser exporter uses) and verified by the C# importer, so a run of this script is also
 * the C#/TypeScript canonical-hash parity proof.
 *
 * Set GONES_COMPOSE_FILE to point it at another Compose project — the release rehearsal runs it
 * against the isolated release-test stack rather than the development one.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const composeArgs = process.env.GONES_COMPOSE_FILE ? ['compose', '-f', process.env.GONES_COMPOSE_FILE] : ['compose'];

function psql(sql, tuplesOnly = false) {
  const args = [...composeArgs, 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-v', 'ON_ERROR_STOP=1'];
  if (tuplesOnly) args.push('-At');
  const result = spawnSync('docker', args, { input: sql, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

/** Mirrors canonicalJsonStringify in src/app/domain/export-schemas.ts and CanonicalJson.cs. */
function canonicalJsonStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`).join(',')}}`;
}

function sha256Checksum(payload) {
  return `sha256:${createHash('sha256').update(canonicalJsonStringify(payload), 'utf8').digest('hex')}`;
}

function migrator(args, extraEnvironment = {}) {
  const runArgs = [...composeArgs, 'run', '--rm', '-v', `${fixtures}:/fixtures:ro`];
  for (const [key, value] of Object.entries(extraEnvironment)) runArgs.push('-e', `${key}=${value}`);
  runArgs.push('migrator', ...args);
  const result = spawnSync('docker', runArgs, { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function importArgs(bundleFiles, extra = []) {
  return [
    'import',
    ...[bundleFiles].flat().flatMap((file) => ['--bundle', `/fixtures/${file}`]),
    '--manifest', '/fixtures/manifest.json',
    '--mapping', '/fixtures/mapping.json',
    ...extra
  ];
}

function reportHashOf(output) {
  const match = /Report hash:\s+(sha256:[0-9a-f]{64})/.exec(output);
  if (!match) throw new Error(`No report hash in migrator output:\n${output}`);
  return match[1];
}

function census() {
  const ids = (values) => values.map((value) => `'${value}'`).join(',');
  return psql(`
    SELECT
      (SELECT count(*) FROM league_aggregates WHERE document_id IN (${ids(sources.map((source) => source.leagueId))})) || '|' ||
      (SELECT count(*) FROM live_aggregates WHERE document_id IN (${ids(sources.map((source) => source.liveId))})) || '|' ||
      (SELECT count(*) FROM scheduled_tournaments WHERE slug IN (${ids(sources.map((source) => source.slug))})) || '|' ||
      (SELECT count(*) FROM deck_archetypes WHERE normalized_name IN (${ids(sources.map((source) => source.archetypeKey))})) || '|' ||
      (SELECT count(*) FROM audit_records WHERE action = 'migration.import') || '|' ||
      (SELECT count(*) FROM idempotency_records WHERE scope = 'migration-import');
  `, true);
}

function requireCensus(expected, label) {
  const actual = census();
  if (actual !== expected) throw new Error(`${label}: expected census ${expected} but found ${actual}`);
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const userId = randomUUID();
const organizationId = randomUUID();
const memberId = randomUUID();
const email = `migration-${suffix}@example.test`;

/**
 * Two independent browser origins, exactly like two club laptops each holding their own
 * localStorage. The batch has to merge both in one transaction or write nothing at all.
 */
function browserOrigin(label) {
  const originSuffix = `${suffix}-${label}`;
  const archetypeName = `Smoke Archetype ${originSuffix}`;
  return {
    label,
    sourceInstanceId: randomUUID(),
    leagueId: `smoke-league-${originSuffix}`,
    liveId: `smoke-live-${originSuffix}`,
    eventId: `smoke-event-${originSuffix}`,
    slug: `smoke-cup-${originSuffix}`,
    archetypeName,
    archetypeKey: archetypeName.toLowerCase()
  };
}

const sources = [browserOrigin('a'), browserOrigin('b')];

const fixtures = mkdtempSync(join(tmpdir(), 'gones-migration-smoke-'));
// The migrator image runs as a non-root user, so the read-only bind mount must be world-readable.
chmodSync(fixtures, 0o755);

function writeFixture(name, contents) {
  const path = join(fixtures, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o644);
}

psql(`
INSERT INTO asp_net_users
  (id, global_role, user_name, normalized_user_name, email, normalized_email, email_confirmed,
   phone_number_confirmed, two_factor_enabled, lockout_enabled, access_failed_count, security_stamp, concurrency_stamp)
VALUES
  ('${userId}', 'User', '${email}', upper('${email}'), '${email}', upper('${email}'), true,
   false, false, false, 0, '${suffix}', '${suffix}');
INSERT INTO organizations
  (id, name, normalized_name, created_at, updated_at, version)
VALUES
  ('${organizationId}', 'Migration Smoke ${suffix}', upper('Migration Smoke ${suffix}'), now(), now(), 1);
INSERT INTO organization_members
  (id, organization_id, user_id, role, created_at, updated_at, version)
VALUES
  ('${memberId}', '${organizationId}', '${userId}', 'Owner', now(), now(), 1);
`);

function buildBundle(source, extraArchetypes = []) {
  const { sourceInstanceId, leagueId, liveId, eventId, slug, archetypeName } = source;
  const deckArchetypes = [archetypeName, ...extraArchetypes];
  const payload = {
    kind: 'gones.private-migration-bundle',
    bundleFormatVersion: 1,
    gonesDataVersion: 4,
    gonesAppVersion: '0.1.0',
    exportedAt: '2026-08-01T09:00:00.000Z',
    sourceInstanceId,
    storeHashes: { 'gones.frontend.backend.v1': `sha256:${'a'.repeat(64)}` },
    storeErrors: [],
    counts: { leagues: 1, tournaments: 1, calendarEvents: 1, liveTournaments: 1, deckArchetypes: deckArchetypes.length },
    leagues: [{
      id: leagueId,
      name: 'Legacy Smoke League',
      status: 'active',
      tournaments: [{
        id: `${leagueId}-t1`,
        leagueId,
        name: 'Round One',
        tournamentDate: '2026-01-10',
        rounds: [{
          id: `${leagueId}-r1`,
          entries: [{
            kind: 'match',
            id: `${leagueId}-e1`,
            table: '1',
            player1Name: 'Alice',
            player2Name: 'Bob',
            player1Score: 2,
            player2Score: 1,
            player1DeckArchetype: 'Tempo',
            player2DeckArchetype: 'Control'
          }]
        }],
        playerArchetypes: [{ playerName: 'Alice', archetype: 'Tempo' }]
      }]
    }],
    calendarEvents: [{
      id: eventId,
      slug,
      title: 'Migration Smoke Cup',
      eventDate: '2026-09-12',
      startTime: '10:00',
      endTime: '18:00',
      location: 'Club',
      country: 'France',
      city: 'Lyon',
      address: '12 Rue de la Republique',
      description: 'Friendly legacy cup',
      richDescriptionHtml: '<p>Welcome</p>',
      externalLink: ''
    }],
    liveTournaments: [{ id: liveId, name: 'Legacy Live Draft', stage: 'registration', tournamentDate: '2026-08-01' }],
    deckArchetypes
  };
  return { ...payload, bundleChecksum: sha256Checksum(payload) };
}

const bundles = sources.map((source) => ({ source, bundle: buildBundle(source) }));
const bundleFiles = bundles.map(({ source }) => `bundle-${source.label}.private.json`);
for (const [index, entry] of bundles.entries()) writeFixture(bundleFiles[index], JSON.stringify(entry.bundle));
const changedBundle = buildBundle(sources[0], [`Extra Archetype ${suffix}`]);
writeFixture('changed.private.json', JSON.stringify(changedBundle));
writeFixture('manifest.json', JSON.stringify({
  kind: 'gones.migration-manifest',
  manifestFormatVersion: 1,
  sourceInstances: bundles.map(({ source, bundle }, index) => ({
    sourceInstanceId: source.sourceInstanceId,
    bundleChecksum: bundle.bundleChecksum,
    role: index === 0 ? 'authoritative' : 'secondary'
  })),
  resolutions: {}
}));
writeFixture('mapping.json', JSON.stringify({
  kind: 'gones.migration-mapping',
  mappingFormatVersion: 1,
  organizationId,
  ownerUserId: userId,
  calendarEvents: Object.fromEntries(sources.map((source) => [source.eventId, {
    timeZone: 'Europe/Paris',
    address: '12 Rue de la Republique',
    city: 'Lyon',
    country: 'France',
    postalCode: '69002',
    formatSlugs: ['legacy'],
    status: 'published',
    capacity: 32
  }]))
}));

const empty = '0|0|0|0|0|0';
const merged = `${sources.length}|${sources.length}|${sources.length}|${sources.length}|1|1`;
requireCensus(empty, 'before the smoke');

// 1. Dry run over the whole bundle set reports the batch and writes nothing.
const dryRun = migrator(importArgs(bundleFiles, ['--dry-run']));
if (dryRun.status !== 0) throw new Error(`Dry run failed:\n${dryRun.output}`);
const reportHash = reportHashOf(dryRun.output);
if (!/"result":"dry-run-ok"/.test(dryRun.output)) throw new Error(`Dry run did not emit the dry-run-ok metric:\n${dryRun.output}`);
requireCensus(empty, 'after the dry run');

// 2. An import without an accepted report hash is refused before any DB work.
const unaccepted = migrator(importArgs(bundleFiles));
if (unaccepted.status !== 2) throw new Error(`Import without --accept-report-hash should exit 2:\n${unaccepted.output}`);
requireCensus(empty, 'after the unaccepted import');

// 3. A fault injected mid-import must leave zero partial rows.
const faulted = migrator(importArgs(bundleFiles, ['--accept-report-hash', reportHash]), {
  GONES_ALLOW_FAULT_INJECTION: 'true',
  GONES_MIGRATION_FAULT: 'after-scheduled'
});
if (faulted.status !== 5) throw new Error(`Faulted import should exit 5:\n${faulted.output}`);
if (!/rolled back/.test(faulted.output)) throw new Error(`Faulted import did not report a rollback:\n${faulted.output}`);
requireCensus(empty, 'after the forced mid-import failure');

// 4. The accepted import commits every store from every source and verifies the result.
const imported = migrator(importArgs(bundleFiles, ['--accept-report-hash', reportHash]));
if (imported.status !== 0) throw new Error(`Accepted import failed:\n${imported.output}`);
if (!/Post-import verification passed/.test(imported.output)) throw new Error(`Post-import verification did not pass:\n${imported.output}`);
requireCensus(merged, 'after the accepted import');

// 5. Rerunning the same batch returns the stored result without duplicating rows.
const rerun = migrator(importArgs(bundleFiles, ['--accept-report-hash', reportHash]));
if (rerun.status !== 0) throw new Error(`Rerun failed:\n${rerun.output}`);
if (!/already imported/.test(rerun.output)) throw new Error(`Rerun did not return the stored result:\n${rerun.output}`);
requireCensus(merged, 'after the rerun');

// 6. A changed bundle invalidates the accepted report hash: a new dry run is required.
const changed = migrator(importArgs(['changed.private.json', bundleFiles[1]], ['--accept-report-hash', reportHash]));
if (changed.status === 0) throw new Error(`A changed bundle must not import with the old report hash:\n${changed.output}`);
requireCensus(merged, 'after the changed-bundle attempt');

// The audit trail never carries the full batch hash or bundle contents.
const auditEntityId = psql("SELECT entity_id FROM audit_records WHERE action = 'migration.import';", true);
if (auditEntityId.length !== 12) throw new Error(`Audit record should carry a truncated batch hash, got '${auditEntityId}'`);

// Canonical-hash parity: the checksums were produced here by the browser exporter's algorithm and
// accepted by the C# importer. A drift on either side fails the dry run before this line is reached.
for (const { source, bundle } of bundles) {
  if (!/^sha256:[0-9a-f]{64}$/.test(bundle.bundleChecksum)) throw new Error(`Bundle ${source.label} produced a malformed canonical checksum.`);
}

console.log(`C38 migration smoke passed over ${sources.length} browser origins: dry run wrote nothing, unaccepted import refused, forced failure left zero partial rows, accepted import verified with C#/TypeScript canonical-hash parity, rerun idempotent, changed bundle rejected.`);
