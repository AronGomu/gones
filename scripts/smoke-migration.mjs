/**
 * C38 migration CLI runtime smoke.
 *
 * Proves the dry-run-first contract against the running compose stack:
 *   1. a dry run reports the batch and writes nothing,
 *   2. an import without an accepted report hash is refused,
 *   3. a fault injected mid-import leaves zero partial rows,
 *   4. the accepted import commits every store in one transaction,
 *   5. a rerun returns the stored batch result without duplicating rows,
 *   6. a changed bundle invalidates the accepted report hash.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function psql(sql, tuplesOnly = false) {
  const args = ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-v', 'ON_ERROR_STOP=1'];
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
  const runArgs = ['compose', 'run', '--rm', '-v', `${fixtures}:/fixtures:ro`];
  for (const [key, value] of Object.entries(extraEnvironment)) runArgs.push('-e', `${key}=${value}`);
  runArgs.push('migrator', ...args);
  const result = spawnSync('docker', runArgs, { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function importArgs(bundleFile, extra = []) {
  return ['import', '--bundle', `/fixtures/${bundleFile}`, '--manifest', '/fixtures/manifest.json', '--mapping', '/fixtures/mapping.json', ...extra];
}

function reportHashOf(output) {
  const match = /Report hash:\s+(sha256:[0-9a-f]{64})/.exec(output);
  if (!match) throw new Error(`No report hash in migrator output:\n${output}`);
  return match[1];
}

function census() {
  return psql(`
    SELECT
      (SELECT count(*) FROM league_aggregates WHERE document_id = '${leagueId}') || '|' ||
      (SELECT count(*) FROM live_aggregates WHERE document_id = '${liveId}') || '|' ||
      (SELECT count(*) FROM scheduled_tournaments WHERE slug = '${slug}') || '|' ||
      (SELECT count(*) FROM deck_archetypes WHERE normalized_name = '${archetypeKey}') || '|' ||
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
const sourceInstanceId = randomUUID();
const leagueId = `smoke-league-${suffix}`;
const liveId = `smoke-live-${suffix}`;
const eventId = `smoke-event-${suffix}`;
const slug = `smoke-cup-${suffix}`;
const archetypeName = `Smoke Archetype ${suffix}`;
const archetypeKey = archetypeName.toLowerCase();
const email = `migration-${suffix}@example.test`;

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

function buildBundle(extraArchetypes = []) {
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

const bundle = buildBundle();
const changedBundle = buildBundle([`Extra Archetype ${suffix}`]);
writeFixture('bundle.private.json', JSON.stringify(bundle));
writeFixture('changed.private.json', JSON.stringify(changedBundle));
writeFixture('manifest.json', JSON.stringify({
  kind: 'gones.migration-manifest',
  manifestFormatVersion: 1,
  sourceInstances: [{ sourceInstanceId, bundleChecksum: bundle.bundleChecksum, role: 'authoritative' }],
  resolutions: {}
}));
writeFixture('mapping.json', JSON.stringify({
  kind: 'gones.migration-mapping',
  mappingFormatVersion: 1,
  organizationId,
  ownerUserId: userId,
  calendarEvents: {
    [eventId]: {
      timeZone: 'Europe/Paris',
      address: '12 Rue de la Republique',
      city: 'Lyon',
      country: 'France',
      postalCode: '69002',
      formatSlugs: ['legacy'],
      status: 'published',
      capacity: 32
    }
  }
}));

const empty = '0|0|0|0|0|0';
requireCensus(empty, 'before the smoke');

// 1. Dry run reports the batch and writes nothing.
const dryRun = migrator(importArgs('bundle.private.json', ['--dry-run']));
if (dryRun.status !== 0) throw new Error(`Dry run failed:\n${dryRun.output}`);
const reportHash = reportHashOf(dryRun.output);
if (!/"result":"dry-run-ok"/.test(dryRun.output)) throw new Error(`Dry run did not emit the dry-run-ok metric:\n${dryRun.output}`);
requireCensus(empty, 'after the dry run');

// 2. An import without an accepted report hash is refused before any DB work.
const unaccepted = migrator(importArgs('bundle.private.json'));
if (unaccepted.status !== 2) throw new Error(`Import without --accept-report-hash should exit 2:\n${unaccepted.output}`);
requireCensus(empty, 'after the unaccepted import');

// 3. A fault injected mid-import must leave zero partial rows.
const faulted = migrator(importArgs('bundle.private.json', ['--accept-report-hash', reportHash]), {
  GONES_ALLOW_FAULT_INJECTION: 'true',
  GONES_MIGRATION_FAULT: 'after-scheduled'
});
if (faulted.status !== 5) throw new Error(`Faulted import should exit 5:\n${faulted.output}`);
if (!/rolled back/.test(faulted.output)) throw new Error(`Faulted import did not report a rollback:\n${faulted.output}`);
requireCensus(empty, 'after the forced mid-import failure');

// 4. The accepted import commits every store and verifies the result.
const imported = migrator(importArgs('bundle.private.json', ['--accept-report-hash', reportHash]));
if (imported.status !== 0) throw new Error(`Accepted import failed:\n${imported.output}`);
if (!/Post-import verification passed/.test(imported.output)) throw new Error(`Post-import verification did not pass:\n${imported.output}`);
requireCensus('1|1|1|1|1|1', 'after the accepted import');

// 5. Rerunning the same batch returns the stored result without duplicating rows.
const rerun = migrator(importArgs('bundle.private.json', ['--accept-report-hash', reportHash]));
if (rerun.status !== 0) throw new Error(`Rerun failed:\n${rerun.output}`);
if (!/already imported/.test(rerun.output)) throw new Error(`Rerun did not return the stored result:\n${rerun.output}`);
requireCensus('1|1|1|1|1|1', 'after the rerun');

// 6. A changed bundle invalidates the accepted report hash: a new dry run is required.
const changed = migrator(importArgs('changed.private.json', ['--accept-report-hash', reportHash]));
if (changed.status === 0) throw new Error(`A changed bundle must not import with the old report hash:\n${changed.output}`);
requireCensus('1|1|1|1|1|1', 'after the changed-bundle attempt');

// The audit trail never carries the full batch hash or bundle contents.
const auditEntityId = psql("SELECT entity_id FROM audit_records WHERE action = 'migration.import';", true);
if (auditEntityId.length !== 12) throw new Error(`Audit record should carry a truncated batch hash, got '${auditEntityId}'`);

console.log('C38 migration smoke passed: dry run wrote nothing, unaccepted import refused, forced failure left zero partial rows, accepted import verified, rerun idempotent, changed bundle rejected.');
