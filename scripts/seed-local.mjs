import { spawnSync } from 'node:child_process';

function run(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

run(['compose', 'run', '--rm', 'migrator', 'database', 'seed']);
const count = run(['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', "select count(*) from audit_records where id = '00000000-0000-0000-0000-000000000005';"]);
if (count.trim() !== '1') throw new Error('Deterministic seed marker missing.');
// The fixed placeholder League this used to assert on is retired (T19) and InitialCreate seeds no
// archive row in its place, so there is nothing archive-side left to count here. The table itself
// must be gone: a seed run against a database that still has it never applied the retirement.
const retiredTable = run(['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', "select to_regclass('league_archive_aggregates');"]);
if (retiredTable.trim() !== '') throw new Error('Retired league_archive_aggregates table is still present.');
const liveCount = run(['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', "select count(*) from live_aggregates where document_id = 'local-live-demo' and stage = 'standings' and canonical_document ->> 'id' = 'local-live-demo';"]);
if (liveCount.trim() !== '1') throw new Error('Seeded Live Tournament missing or duplicated.');
console.log('Deterministic V1 seed complete.');
