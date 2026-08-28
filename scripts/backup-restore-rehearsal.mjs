#!/usr/bin/env node
/**
 * Encrypted backup and restore rehearsal (C41).
 *
 * A backup that has never been restored is a guess. This drives the shipped backup image against a
 * real PostgreSQL and proves:
 *
 *   - the archive is written only inside the mounted backup root, encrypted, with a checksum
 *   - a corrupted archive is refused before the restore touches the database
 *   - a wrong key is refused before the restore touches the database
 *   - a correct key restores data that was deleted after the dump was taken
 *   - destroying the data volume entirely and restoring into a clean database recovers the schema,
 *     the data and the append-only audit guard, and the migration job is then a no-op (C43)
 *
 * The restore duration it prints is a local wall-clock measurement on one machine. It is not an RPO
 * or an RTO: recovery objectives need real hardware and a real hosting decision, both deferred.
 * Remote storage, retention sweeps and PITR stay deferred with the hosting decision too.
 */
import { run } from './release-images.mjs';

const composeFile = 'compose.release-test.yaml';
const failures = [];
const check = (condition, message) => {
  if (condition) {
    console.log(`  ok   ${message}`);
    return true;
  }
  failures.push(message);
  console.error(`  FAIL ${message}`);
  return false;
};

const compose = (args, options = {}) => run('docker', ['compose', '-f', composeFile, ...args], { stdio: 'inherit', ...options });
const composeOut = (args) => run('docker', ['compose', '-f', composeFile, ...args]);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const psql = (statement) => composeOut(['exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', statement]);
const tool = (args, environment = []) => composeOut(['--profile', 'tools', 'run', '--rm', ...environment.flatMap((entry) => ['-e', entry]), ...args]);

try {
  console.log('=== starting a minimal database stack ===');
  compose(['down', '--volumes', '--remove-orphans'], { stdio: 'ignore' });
  if (compose(['up', '--build', '--detach', 'postgres', 'bootstrap']).status !== 0) throw new Error('database stack failed to start');
  if (compose(['run', '--rm', 'migrator', 'database', 'update']).status !== 0) throw new Error('migration job failed');

  // A row that exists in the dump and is destroyed afterwards, so a successful restore is provable.
  // It lives in its own table: `audit_records` is append-only by trigger and cannot be un-inserted.
  const marker = `backup-rehearsal-${Date.now()}`;
  psql('CREATE TABLE IF NOT EXISTS backup_rehearsal_marker (id text primary key);');
  psql(`INSERT INTO backup_rehearsal_marker (id) VALUES ('${marker}');`);
  check(psql(`select count(*) from backup_rehearsal_marker where id = '${marker}';`).stdout.trim() === '1', 'a marker row exists before the dump');

  // `run` reuses whatever image is already tagged, so a stale one would let an edited backup script
  // pass unread. Build the tools image explicitly before anything asserts on its behaviour.
  if (compose(['--profile', 'tools', 'build', 'backup']).status !== 0) throw new Error('the backup image failed to build');

  console.log('\n=== taking an encrypted backup ===');
  const backup = tool(['backup'], ['GONES_BACKUP_NAME=rehearsal']);
  check(backup.status === 0, `backup command succeeds (${backup.stdout.trim().split('\n').pop() ?? backup.stderr.trim()})`);

  const listing = tool(['--entrypoint', 'ls', 'backup', '-1', '/backups']).stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean);
  check(listing.includes('rehearsal.dump.enc'), `the archive lands in the mounted backup root (${listing.join(', ')})`);
  check(listing.includes('rehearsal.dump.enc.sha256'), 'a checksum is written next to the archive');
  check(listing.includes('rehearsal.dump.enc.hmac'), 'an HMAC sidecar is written next to the archive');
  check(listing.includes('rehearsal.meta.json'), 'provenance metadata is written next to the archive');

  const header = tool(['--entrypoint', 'sh', 'backup', '-c', 'head -c 8 /backups/rehearsal.dump.enc | od -An -c | tr -d " \\n"']).stdout.trim();
  check(header.startsWith('Salted__'), `the archive is encrypted, not a readable dump (header ${header.slice(0, 16)})`);
  const escaped = tool(['--entrypoint', 'sh', 'backup', '-c', 'ls /tmp /var/tmp 2>/dev/null | grep -c dump || true']).stdout.trim();
  check(escaped === '0' || escaped === '', 'nothing is written outside the mounted backup root');

  console.log('\n=== a wrong key must fail at MAC verification, before decryption ===');
  const wrongKey = tool(['--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', 'rehearsal.dump.enc'], ['GONES_BACKUP_KEY_FILE=', 'GONES_BACKUP_KEY=definitely-not-the-backup-key']);
  check(wrongKey.status === 12, `restore with a wrong key exits 12 at MAC verification (got ${wrongKey.status})`);
  check(/tampered|wrong key/i.test(wrongKey.stderr), `restore with a wrong key says so (${wrongKey.stderr.trim().slice(0, 90)})`);

  console.log('\n=== a corrupt archive must fail before the database is touched ===');
  tool(['--entrypoint', 'sh', 'backup', '-c', 'cp /backups/rehearsal.dump.enc /backups/corrupt.dump.enc && cp /backups/rehearsal.dump.enc.sha256 /backups/corrupt.dump.enc.sha256 && sed -i "s/rehearsal/corrupt/" /backups/corrupt.dump.enc.sha256 && printf "corruption" | dd of=/backups/corrupt.dump.enc bs=1 seek=64 conv=notrunc 2>/dev/null']);
  const corrupt = tool(['--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', 'corrupt.dump.enc']);
  check(corrupt.status === 10, `restore of a corrupt archive exits 10 (got ${corrupt.status})`);
  check(/corrupt/i.test(corrupt.stderr), `restore of a corrupt archive says so (${corrupt.stderr.trim().slice(0, 90)})`);

  console.log('\n=== a tampered archive with a regenerated checksum must still be refused ===');
  tool(['--entrypoint', 'sh', 'backup', '-c', 'cp /backups/rehearsal.dump.enc /backups/tampered.dump.enc && cp /backups/rehearsal.dump.enc.hmac /backups/tampered.dump.enc.hmac && printf "substitution" | dd of=/backups/tampered.dump.enc bs=1 seek=64 conv=notrunc 2>/dev/null && cd /backups && sha256sum tampered.dump.enc > tampered.dump.enc.sha256']);
  const tampered = tool(['--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', 'tampered.dump.enc']);
  check(tampered.status === 12, `restore of a tampered archive with a matching checksum exits 12 (got ${tampered.status})`);
  check(/MAC verification failed/.test(tampered.stderr), `the refusal names the MAC (${tampered.stderr.trim().slice(0, 90)})`);

  console.log('\n=== an archive without a MAC sidecar must be refused outright ===');
  tool(['--entrypoint', 'sh', 'backup', '-c', 'cp /backups/rehearsal.dump.enc /backups/nomac.dump.enc && cd /backups && sha256sum nomac.dump.enc > nomac.dump.enc.sha256']);
  const noMac = tool(['--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', 'nomac.dump.enc']);
  check(noMac.status === 12, `restore without a MAC sidecar exits 12 (got ${noMac.status})`);
  check(/unauthenticated archive/.test(noMac.stderr), `the refusal says the archive is unauthenticated (${noMac.stderr.trim().slice(0, 90)})`);

  console.log('\n=== paths outside the mounted root are refused ===');
  const escape = tool(['--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', '/etc/passwd']);
  check(escape.status === 2, `restore refuses a path outside the backup root (got ${escape.status})`);

  console.log('\n=== the correct key restores the lost data ===');
  psql('DROP TABLE backup_rehearsal_marker;');
  check(psql(`select count(*) from backup_rehearsal_marker where id = '${marker}';`).stderr.includes('does not exist'), 'the marker table is gone before the restore');

  const restore = tool(['--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', 'rehearsal.dump.enc'], ['GONES_BACKUP_DSN=postgresql://gones_migration:local-migration-only@postgres:5432/gones']);
  check(restore.status === 0, `restore succeeds (${(restore.stderr || restore.stdout).trim().split('\n').pop() ?? ''})`);
  await sleep(500);
  check(psql(`select count(*) from backup_rehearsal_marker where id = '${marker}';`).stdout.trim() === '1', 'the marker row is back after the restore');

  // A restore into a database that still exists only proves `pg_restore` runs. The disaster case is
  // the one where the volume is gone, so that is the one the rehearsal actually performs.
  console.log('\n=== destroying the database volume and restoring into a clean database ===');
  const beforeCount = psql('select count(*) from "__EFMigrationsHistory";').stdout.trim();
  compose(['stop', 'postgres'], { stdio: 'ignore' });
  compose(['rm', '--force', '--stop', '--volumes', 'postgres'], { stdio: 'ignore' });
  const removedVolume = run('docker', ['volume', 'rm', '--force', 'gones-release-test_postgres-data']);
  check(removedVolume.status === 0, 'the PostgreSQL data volume is destroyed, not merely emptied');

  const restoreStartedAt = Date.now();
  if (compose(['up', '--detach', '--wait', 'postgres']).status !== 0) throw new Error('the clean database did not start');
  const freshTables = psql("select count(*) from information_schema.tables where table_schema = 'public';").stdout.trim();
  check(freshTables === '0', `the replacement database really is empty before the restore (${freshTables} tables)`);

  const disasterRestore = tool(
    ['--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', 'rehearsal.dump.enc'],
    ['GONES_BACKUP_DSN=postgresql://gones_migration:local-migration-only@postgres:5432/gones']);
  check(disasterRestore.status === 0, `the encrypted archive restores into the clean database (${(disasterRestore.stderr || disasterRestore.stdout).trim().split('\n').pop() ?? ''})`);
  const restoreSeconds = Math.round((Date.now() - restoreStartedAt) / 1000);

  const afterCount = psql('select count(*) from "__EFMigrationsHistory";').stdout.trim();
  check(afterCount === beforeCount && Number(afterCount) > 0, `the restored schema carries the same migration history (${beforeCount} -> ${afterCount})`);
  check(psql(`select count(*) from backup_rehearsal_marker where id = '${marker}';`).stdout.trim() === '1', 'the marker row survives a full volume loss');

  // Re-running the migration job against the restored database must be a no-op: that is the smoke
  // test an operator would run before letting the API back in.
  const smoke = compose(['run', '--rm', 'migrator', 'database', 'update']);
  check(smoke.status === 0, 'the migration job runs cleanly against the restored database');
  const afterSmoke = psql('select count(*) from "__EFMigrationsHistory";').stdout.trim();
  check(afterSmoke === afterCount, `the post-restore migration smoke applies nothing new (${afterSmoke})`);
  const auditGuard = psql("select count(*) from pg_trigger where tgrelid = 'audit_records'::regclass and not tgisinternal;").stdout.trim();
  check(Number(auditGuard) > 0, `the append-only audit guard is restored with the schema (${auditGuard} trigger(s))`);

  // A local wall-clock number on one developer machine. It is NOT an RPO or RTO: those need real
  // hardware, real data volumes and a real hosting decision, all of which stay deferred.
  console.log(`\n  note  local restore duration on this machine: ${restoreSeconds}s (measurement only; no recovery objective is claimed)`);
} finally {
  console.log('\n=== tearing the database stack down ===');
  compose(['--profile', 'tools', 'down', '--volumes', '--remove-orphans'], { stdio: 'ignore' });
}

if (failures.length > 0) {
  console.error(`\nBackup/restore rehearsal failed with ${failures.length} finding(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nBackup/restore rehearsal passed: encrypted dump, safe failures, verified restore.');
