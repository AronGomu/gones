import { spawnSync } from 'node:child_process';

function run(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

run(['compose', 'run', '--rm', 'migrator', 'database', 'seed']);
const count = run(['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', "select count(*) from audit_records where id = '00000000-0000-0000-0000-000000000005';"]);
if (count.trim() !== '1') throw new Error('Deterministic seed marker missing.');
const placeholderCount = run(['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', "select count(*) from league_aggregates where document_id = 'placeholder-league' and name = 'Unassigned Tournaments' and canonical_document ->> 'id' = 'placeholder-league';"]);
if (placeholderCount.trim() !== '1') throw new Error('Fixed placeholder League missing or duplicated.');
console.log('Deterministic V1 seed complete.');
